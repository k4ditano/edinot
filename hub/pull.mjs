// Trae una copia completa de un workspace remoto al hub local.
//
// Solo en un sentido: el servidor remoto NO recibe nada. Cada documento remoto se
// abre en un Y.Doc vacío (así no hay nada que enviarle), se guarda su estado, se
// cierra, y ese estado se aplica en el hub, que lo persiste. Los adjuntos que
// cualquier documento menciona (`edinot://blob/<sha>`) se copian comprobando su
// hash. Al final se vuelve a leer cada documento desde el hub y se comprueba que
// contiene todo lo que tenía el remoto.
//
// Requiere que el servidor ofrezca `GET /workspaces/:id/docs` (la lista de
// documentos): sin ella habría que abrir notas que quizá no existen, y abrirlas
// haría que el servidor las creara.

import * as Y from 'yjs';
import { hubFetch, registerPin, webSocketFor } from './tls.mjs';
import { createHash } from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';

const BLOB_REF = /edinot:\/\/blob\/([a-f0-9]{64})/g;

const wsUrl = (httpUrl) => {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString().replace(/\/$/, '');
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// El servidor limita las peticiones REST por IP (240/min en producción). Se va a
// ~200/min y, si aun así responde 429, se espera lo que pide `Retry-After`.
const DEFAULT_GAP_MS = Number(process.env.EDINOT_PULL_GAP_MS || 300);
let gapMs = DEFAULT_GAP_MS;     // se pone a 0 si el origen es este mismo equipo (ver pullWorkspace)
let nextSlot = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gapMs;
  if (at > now) await sleep(at - now);
}
async function remoteFetch(url, init = {}, { timeoutMs = 30000, retries = 8 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await slot();
    try {
      const res = await hubFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429) {
        const wait = Math.min(120, Number(res.headers.get('retry-after')) || 30);
        try { await res.arrayBuffer(); } catch {}
        await sleep(wait * 1000 + Math.floor(Math.random() * 1500));
        lastErr = new Error('HTTP 429 (rate limit)');
        continue;
      }
      if (res.status >= 500 && attempt < retries) { try { await res.arrayBuffer(); } catch {} await sleep(500 * (attempt + 1)); lastErr = new Error(`HTTP ${res.status}`); continue; }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}
// Nombre de archivo de `Content-Disposition: inline; filename*=UTF-8''...`
const filenameOf = (res) => {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('content-disposition') || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
};

async function getJson(base, pathname, token) {
  const res = await remoteFetch(base.replace(/\/$/, '') + pathname, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const e = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/** Abre un documento, espera a que sincronice (con plazo por inactividad) y devuelve {doc, provider, close}. */
function openDoc({ server, token, name, idleMs = 45000, hardMs = 300000 }) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: wsUrl(server), name, token, document: doc, WebSocketPolyfill: webSocketFor(wsUrl(server)), awareness: null,
  });
  const ready = new Promise((resolve, reject) => {
    let done = false, idle = null;
    const finish = (ok, err) => {
      if (done) return;
      done = true; clearTimeout(idle); clearTimeout(hard);
      ok ? resolve() : reject(err);
    };
    const arm = () => {
      if (done) return;
      clearTimeout(idle);
      idle = setTimeout(() => finish(false, new Error(`no data for ${idleMs / 1000} s: ${name}`)), idleMs);
    };
    const hard = setTimeout(() => finish(false, new Error(`deadline exceeded: ${name}`)), hardMs);
    arm();
    provider.on('message', arm);
    provider.on('synced', () => finish(true));
    provider.on('authenticationFailed', ({ reason } = {}) => finish(false, new Error(`authentication rejected (${name}): ${reason || ''}`)));
    provider.on('close', ({ event } = {}) => {
      const code = (event && event.code) || 0;
      if (code >= 4400 && code <= 4599) finish(false, new Error(`connection closed (${name}): code ${code}`));
    });
  });
  const close = () => { try { provider.destroy(); } catch {} try { doc.destroy(); } catch {} };
  return { doc, provider, ready, close };
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Orden de copia: primero el shell, luego los vaults, luego las notas. */
const rank = (name) => (/^ws:\d+$/.test(name) ? 0 : /:note:/.test(name) ? 2 : 1);

// `remoteId` y `hubId` pueden diferir: ws:1 del remoto puede ser ws:3 en el hub.
const mapName = (name, remoteId, hubId) => name.replace(new RegExp(`^ws:${remoteId}(?=$|:)`), `ws:${hubId}`);

const clocksCover = (haveSV, needSV) => {
  const have = Y.decodeStateVector(haveSV);
  for (const [client, clock] of Y.decodeStateVector(needSV)) if ((have.get(client) || 0) < clock) return false;
  return true;
};

/**
 * @param remote { server, token, workspaceId }
 * @param hub    { server, token, workspaceId }
 * @param opts   { dryRun, concurrency, onProgress(evt), skipBlobs }
 */
export async function pullWorkspace({ remote, hub, dryRun = false, concurrency = 4, skipBlobs = false, mergeExisting = false, onProgress = () => {} }) {
  // Servidores con certificado propio: se fija el que se emparejó (si no, solo vale un certificado normal).
  if (remote.ca) registerPin(remote.server, remote.ca);
  if (hub.ca) registerPin(hub.server, hub.ca);
  // Sin límite de ritmo si el origen es este equipo (un hub local no limita peticiones).
  try { gapMs = /^(127\.|localhost|\[::1\])/.test(new URL(remote.server).hostname) ? 0 : DEFAULT_GAP_MS; } catch { gapMs = DEFAULT_GAP_MS; }
  const report = { skippedExisting: [], docs: 0, bytes: 0, failed: [], blobs: { referenced: 0, copied: 0, already: 0, missing: [], failed: [] }, verified: 0, notVerified: [], dryRun };

  let list;
  try {
    list = (await getJson(remote.server, `/workspaces/${remote.workspaceId}/docs`, remote.token)).docs || [];
  } catch (err) {
    if (err.status === 404 || err.status === 501) {
      throw new Error('The server does not offer the document list (GET /workspaces/:id/docs). Update the server and try again.');
    }
    throw err;
  }
  list.sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : 1));
  onProgress({ kind: 'list', docs: list.length, bytes: list.reduce((n, d) => n + (d.bytes || 0), 0) });

  const remoteStates = new Map(); // nombre en el hub → estado remoto (para verificar y para buscar adjuntos)
  const shas = new Set();

  await pool(list, concurrency, async (d, i) => {
    const hubName = mapName(d.name, remote.workspaceId, hub.workspaceId);
    try {
      const r = openDoc({ server: remote.server, token: remote.token, name: d.name });
      let state;
      try { await r.ready; state = Y.encodeStateAsUpdate(r.doc); }
      finally { r.close(); }
      remoteStates.set(hubName, state);
      for (const m of Buffer.from(state).toString('latin1').matchAll(BLOB_REF)) shas.add(m[1]);

      if (!dryRun) {
        const q = `name=${encodeURIComponent(hubName)}${mergeExisting ? '&merge=1' : ''}`;
        const res = await hubFetch(`${hub.server.replace(/\/$/, '')}/hub/docs?${q}`, {
          method: 'POST', body: state, signal: AbortSignal.timeout(180000),
          headers: { Authorization: `Bearer ${hub.token}`, 'Content-Type': 'application/octet-stream' },
        });
        if (res.status === 409) {
          report.skippedExisting.push(hubName);
          remoteStates.delete(hubName);
          onProgress({ kind: 'doc-skipped', name: d.name });
          return;
        }
        if (!res.ok) throw new Error(`the hub answered ${res.status}`);
      }
      report.docs++; report.bytes += state.length;
      onProgress({ kind: 'doc', name: d.name, index: i + 1, total: list.length, bytes: state.length });
    } catch (err) {
      report.failed.push({ name: d.name, error: err.message });
      onProgress({ kind: 'doc-error', name: d.name, error: err.message });
    }
  });

  // ── Adjuntos ──────────────────────────────────────────────────────────────
  report.blobs.referenced = shas.size;
  if (!skipBlobs && shas.size) {
    const all = [...shas];
    let have = new Set();
    if (!dryRun) {
      for (let i = 0; i < all.length; i += 400) {
        const res = await hubFetch(hub.server.replace(/\/$/, '') + '/blobs/meta', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hub.token}` },
          body: JSON.stringify({ ids: all.slice(i, i + 400) }), signal: AbortSignal.timeout(30000),
        });
        for (const b of ((await res.json()).blobs || [])) have.add(b.id);
      }
    }
    const todo = all.filter(s => !have.has(s));
    report.blobs.already = all.length - todo.length;
    await pool(todo, 3, async (sha, i) => {
      try {
        const res = await remoteFetch(`${remote.server.replace(/\/$/, '')}/blobs/${sha}`, { headers: { Authorization: `Bearer ${remote.token}` } }, { timeoutMs: 180000 });
        if (res.status === 404 || res.status === 410) { report.blobs.missing.push(sha); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const meta = { mime: (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim(), filename: filenameOf(res) };
        const bytes = Buffer.from(await res.arrayBuffer());
        if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('el hash no coincide');
        if (!dryRun) {
          const up = await hubFetch(hub.server.replace(/\/$/, '') + '/blobs', {
            method: 'POST', body: bytes, signal: AbortSignal.timeout(180000),
            headers: {
              Authorization: `Bearer ${hub.token}`, 'Content-Type': meta.mime || 'application/octet-stream',
              'X-Edinot-Mime': meta.mime || 'application/octet-stream',
              ...(meta.filename ? { 'X-Edinot-Filename': encodeURIComponent(meta.filename) } : {}),
            },
          });
          const j = await up.json().catch(() => ({}));
          if (!up.ok || j.id !== sha) throw new Error(`the hub did not store the attachment (${up.status})`);
        }
        report.blobs.copied++;
        onProgress({ kind: 'blob', sha, index: i + 1, total: todo.length });
      } catch (err) {
        report.blobs.failed.push({ sha, error: err.message });
      }
    });
  }

  // ── Verificación: releer del hub lo que quedó en disco y comprobar que contiene todo lo del remoto ──
  if (!dryRun) {
    await pool([...remoteStates.entries()], concurrency, async ([hubName, state]) => {
      try {
        const res = await hubFetch(`${hub.server.replace(/\/$/, '')}/hub/docs?name=${encodeURIComponent(hubName)}`, {
          headers: { Authorization: `Bearer ${hub.token}` }, signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const stored = new Uint8Array(await res.arrayBuffer());
        if (clocksCover(Y.encodeStateVectorFromUpdate(stored), Y.encodeStateVectorFromUpdate(state))) report.verified++;
        else report.notVerified.push(hubName);
      } catch (err) { report.notVerified.push(`${hubName} (${err.message})`); }
    });
  }
  onProgress({ kind: 'done' });
  return report;
}
