// Shared CLI/MCP library: config I/O, REST API client, and a "session"
// wrapper that connects to Hocuspocus as a Yjs peer and exposes plain
// list/read/write/create/delete/rename ops over yFiles + content texts.

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import WebSocket from 'ws';
import { hubFetch, registerPin, webSocketFor } from '../hub/tls.mjs';
import {
  readCanvasSnapshot as canvasReadSnapshot,
  applyCanvasSnapshot as canvasApplySnapshot,
  isCanvasMigrated as canvasIsMigrated,
  serializeCanvasDeterministic as canvasSerialize,
} from '../shared/canvas-model.js';
import {
  attachLegacyBridge as commentsAttachBridge,
  readCommentsMap, readNoteComments, readAllComments, findComment as commentsFind,
  readAgentTasks, putAgentTasks, putComment, patchComment, deleteComments,
  addCommentReply, threadRootIdOf, commentTypes,
} from '../shared/comments-model.js';
import { normalizeCollection as _normalizeCollection } from '../shared/collections.js';
import { applyTextDiff } from '../shared/text-diff.mjs';
import { promises as fs } from 'node:fs';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync,
  readdirSync, statSync, renameSync, rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { hubConfig } from '../hub/client.mjs';

export function defaultServer() {
  // Sin servidor por defecto: cada persona usa el suyo (`edinot join <enlace>`) o el hub local.
  return process.env.EDINOT_SERVER || '';
}

function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'edinot');
}
function configFile() { return path.join(configDir(), 'cli.json'); }

export function loadConfig() {
  try {
    const raw = readFileSync(configFile(), 'utf8');
    const cfg = JSON.parse(raw);
    // Servidor con certificado propio: solo se acepta el certificado fijado al emparejar.
    if (cfg && cfg.server && cfg.tlsCa) registerPin(cfg.server, cfg.tlsCa);
    return cfg;
  } catch { return null; }
}
/**
 * La configuración con la que trabajar. Si hay una sesión remota (token) o el
 * modo antiguo de carpeta, se respeta tal cual. Si no hay nada —o se pidió
 * `mode: 'hub'`— se usa el hub local, arrancándolo si hace falta: así el CLI y
 * el MCP funcionan sin red desde el primer comando.
 */
export async function resolveConfig({ start = true } = {}) {
  const c = loadConfig();
  if (c && (c.token || c.mode === 'local')) return c;
  return hubConfig({ start, workspaceId: c && c.workspaceId });
}

export function saveConfig(cfg) {
  if (!cfg) {
    try { unlinkSync(configFile()); } catch {}
    return;
  }
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8');
}

// fetch con tope de tiempo, reintentos en errores de red/5xx y mensajes
// claros («fetch failed» a secas no decía nada: ahora incluye host y causa).
export async function fetchRobust(url, init = {}, { timeoutMs = 30000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await hubFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 && attempt < retries) { lastErr = new Error(`HTTP ${res.status}`); await new Promise(r => setTimeout(r, 400 * (attempt + 1))); continue; }
      return res;
    } catch (e) {
      const cause = e && e.cause ? (e.cause.code || e.cause.message) : null;
      let host = '';
      try { host = new URL(url).host; } catch {}
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      lastErr = new Error(timedOut
        ? `network timeout after ${Math.round(timeoutMs / 1000)}s contacting ${host}`
        : `network error contacting ${host}${cause ? ` (${cause})` : ''}: ${e && e.message ? e.message : e}`);
      lastErr.cause = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetchRobust(url, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }, { retries: (opts.method || 'GET') === 'GET' ? 2 : 0 });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return data;
}

export const api = {
  login: (server, email, password) =>
    jsonFetch(server.replace(/\/$/, '') + '/auth/login', { method: 'POST', body: { email, password } }),
  refresh: (server, token) =>
    jsonFetch(server.replace(/\/$/, '') + '/auth/refresh', { method: 'POST', token }),
  workspaces: (server, token) =>
    jsonFetch(server.replace(/\/$/, '') + '/workspaces', { token }),
  snapshots: (server, token, workspaceId, vaultId) =>
    jsonFetch(`${server.replace(/\/$/, '')}/workspaces/${workspaceId}/snapshots${vaultId ? `?vault=${encodeURIComponent(vaultId)}` : ''}`, { token }),
  restoreSnapshot: (server, token, workspaceId, snapshotId) =>
    jsonFetch(`${server.replace(/\/$/, '')}/workspaces/${workspaceId}/snapshots/${snapshotId}/restore`, { method: 'POST', token }),
  blobTextBatch: (server, token, ids) =>
    jsonFetch(`${server.replace(/\/$/, '')}/blobs/text`, { method: 'POST', token, body: { ids } }),
  // Download raw blob bytes. Returns { buffer, mime, size }. Used by the MCP
  // read tools to inline image attachments as vision content blocks.
  blobFetch: async (server, token, sha) => {
    const res = await fetchRobust(`${server.replace(/\/$/, '')}/blobs/${sha}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, { timeoutMs: 60000 });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mime, size: buffer.length };
  },
  // Upload raw bytes to the blob store (content-addressed; re-uploads of the
  // same bytes are deduped server-side). Returns { id: sha, mime, size, ... }.
  blobUpload: async (server, token, { buffer, mime, filename }) => {
    // Subida: 2 min (archivos grandes) y reintentos (el blob es idempotente:
    // mismo contenido → mismo sha).
    const res = await fetchRobust(`${server.replace(/\/$/, '')}/blobs`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': mime || 'application/octet-stream',
        'X-Edinot-Mime': mime || 'application/octet-stream',
        ...(filename ? { 'X-Edinot-Filename': encodeURIComponent(filename) } : {}),
      },
      body: buffer,
    }, { timeoutMs: 120000, retries: 2 });
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
  },
};

export function tokenExpiresAt(token) {
  // Returns ms-epoch of `exp`, or null if undecodable / missing.
  // Decodes payload without verification — only used to decide whether to
  // refresh proactively; the server still enforces the signature.
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? b64 + '='.repeat(4 - (b64.length % 4)) : b64;
    const payload = JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch { return null; }
}

function deriveWsUrl(httpUrl) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString().replace(/\/$/, '');
}

function genFileId() {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// File-based ops used by local-mode MCP. Operates directly on the disk-
// exported vault tree: <vaultDir>/<vault>/<file>.md. The Electron app watches
// this folder and pulls changes back into its Y.Doc, so writes by the MCP
// server appear in the running app within a second.
function sanitizeSeg(s) {
  return String(s || 'untitled')
    .replace(/[\/\\:*?"<>|\0]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/\s+$/, '')
    .slice(0, 120) || 'untitled';
}

function openLocal(cfg) {
  const npath = path;
  const root = cfg.vaultDir;
  if (!root) throw new Error('local mode: vaultDir missing in cli.json');
  if (!existsSync(root)) mkdirSync(root, { recursive: true });

  // id = path relative to root, using forward slashes (stable across platforms).
  // vaultId = first segment of that path.
  function listMdFiles() {
    const out = [];
    let topDirs = [];
    try { topDirs = readdirSync(root); } catch { return out; }
    for (const v of topDirs) {
      const vDir = npath.join(root, v);
      let st;
      try { st = statSync(vDir); } catch { continue; }
      if (!st.isDirectory() || v.startsWith('.')) continue;
      walk(vDir, v, out);
    }
    return out;
  }
  function walk(absDir, vault, out) {
    let entries = [];
    try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = npath.join(absDir, e.name);
      if (e.isDirectory()) { walk(abs, vault, out); continue; }
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      const rel = npath.relative(root, abs).split(npath.sep).join('/');
      out.push({ id: rel, name: e.name, vaultId: vault });
    }
  }

  return {
    listFiles({ vault }) {
      const all = listMdFiles();
      return vault ? all.filter(f => f.vaultId === sanitizeSeg(vault) || f.vaultId === vault) : all;
    },
    vaultName(id) { return id || 'default'; },
    findFileByName(name) {
      const raw = String(name || '').trim();
      const target = raw.toLowerCase().replace(/\.md$/, '');
      const all = listMdFiles();
      for (const f of all) {
        const base = f.name.toLowerCase().replace(/\.md$/, '');
        if (base === target) return f;
      }
      // Fallback: the stable note id (tools return it; it survives renames).
      return all.find(f => f.id === raw) || null;
    },
    readContent(id) {
      const abs = npath.join(root, id);
      try { return readFileSync(abs, 'utf8'); }
      catch { return ''; }
    },
    // Same contract as the synced session (search tools): on disk there is
    // no cheaper copy, both read the file.
    readContentCached(id) { return this.readContent(id); },
    async readContentFresh(id) { return this.readContent(id); },
    // Canvas en modo local: no hay tipos Yjs estructurados; el canvas es el
    // bloque ```edinot-canvas del .md y se reescribe entero (como la ruta
    // «legacy» del modo sincronizado). Antes faltaban y TODAS las
    // herramientas de canvas fallaban con «canvasCommit is not a function».
    async canvasSnapshot() { return { nodes: [], edges: [], groups: [], annotations: [] }; },
    async canvasCommit(id, next, { content, block }) {
      const lines = String(content || '').split('\n');
      const body = JSON.stringify(next, null, 2);
      const out = [...lines.slice(0, block.startLine + 1), ...body.split('\n'), ...lines.slice(block.endLine)].join('\n');
      this.writeContent(id, out);
      return { structured: false };
    },
    writeContent(id, body) {
      const abs = npath.join(root, id);
      mkdirSync(npath.dirname(abs), { recursive: true });
      writeFileSync(abs, body || '', 'utf8');
    },
    createFile(name, vaultId = 'default', folderRef = null) {
      const vault = sanitizeSeg(vaultId);
      const baseName = sanitizeSeg(name.replace(/\.(md|markdown|txt)$/i, '')) + '.md';
      const folderSegs = folderRef
        ? String(folderRef).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(sanitizeSeg)
        : [];
      const id = [vault, ...folderSegs, baseName].join('/');
      const abs = npath.join(root, id);
      mkdirSync(npath.dirname(abs), { recursive: true });
      if (!existsSync(abs)) writeFileSync(abs, '', 'utf8');
      return { id, name: baseName, vaultId: vault, folderId: folderSegs.join('/') || null };
    },
    deleteFile(id) {
      try { unlinkSync(npath.join(root, id)); } catch {}
    },
    renameFile(id, newName) {
      if (/[\/\\]/.test(newName)) {
        throw new Error('rename_note only changes the filename — use move_note');
      }
      const finalName = sanitizeSeg(newName.replace(/\.(md|markdown|txt)$/i, '')) + '.md';
      const abs = npath.join(root, id);
      const newAbs = npath.join(npath.dirname(abs), finalName);
      try { renameSync(abs, newAbs); } catch {}
    },
    // ── Vault ops (local) ───────────────────────────────────────────────
    listVaults() {
      let dirs = [];
      try { dirs = readdirSync(root, { withFileTypes: true }); } catch { return []; }
      const out = [];
      let hasDefault = false;
      for (const e of dirs) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const noteCount = listMdFiles().filter(f => f.vaultId === e.name).length;
        out.push({ id: e.name, name: e.name, noteCount });
        if (e.name.toLowerCase() === 'default') hasDefault = true;
      }
      if (!hasDefault) out.push({ id: 'default', name: 'Default', noteCount: 0 });
      return out;
    },
    createVault(name) {
      const seg = sanitizeSeg(name);
      const dir = npath.join(root, seg);
      if (existsSync(dir)) throw new Error(`vault already exists: ${seg}`);
      mkdirSync(dir, { recursive: true });
      return { id: seg, name: seg };
    },
    renameVault(currentName, newName) {
      const oldSeg = sanitizeSeg(currentName);
      const newSeg = sanitizeSeg(newName);
      if (oldSeg.toLowerCase() === 'default') throw new Error("cannot rename the 'default' vault");
      const oldDir = npath.join(root, oldSeg);
      const newDir = npath.join(root, newSeg);
      if (!existsSync(oldDir)) throw new Error(`vault not found: ${currentName}`);
      if (existsSync(newDir)) throw new Error(`vault already exists: ${newSeg}`);
      renameSync(oldDir, newDir);
      return { id: newSeg, name: newSeg };
    },
    deleteVault(name) {
      const seg = sanitizeSeg(name);
      if (seg.toLowerCase() === 'default') throw new Error("cannot delete the 'default' vault");
      const dir = npath.join(root, seg);
      if (!existsSync(dir)) throw new Error(`vault not found: ${name}`);
      const defaultDir = npath.join(root, 'default');
      mkdirSync(defaultDir, { recursive: true });
      let moved = 0;
      for (const f of listMdFiles().filter(x => x.vaultId === seg)) {
        const fromAbs = npath.join(root, f.id);
        const toAbs = npath.join(defaultDir, npath.basename(f.id));
        try { renameSync(fromAbs, toAbs); moved++; } catch {}
      }
      // Best-effort cleanup; ignores failures (e.g. unexpected files left over).
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      return { id: seg, name: seg, movedFiles: moved };
    },
    // ── Note ops (local extras) ─────────────────────────────────────────
    // `folderRef` optional: undefined preserves current folder when vault is
    // unchanged (clears it otherwise); null/"" puts the note at vault root;
    // a path like "Sub/Deeper" places it under that subdirectory.
    moveFile(id, vaultRef, folderRef) {
      const currentVault = id.split('/')[0] || 'default';
      const targetVault = sanitizeSeg(vaultRef || currentVault);
      // Recover current folder segments from id (everything between vault and basename).
      const idSegs = id.split('/');
      const baseName = idSegs[idSegs.length - 1];
      const currentFolderSegs = idSegs.slice(1, -1);
      let folderSegs;
      if (folderRef === undefined) {
        folderSegs = (targetVault === currentVault) ? currentFolderSegs : [];
      } else if (folderRef === null || folderRef === '') {
        folderSegs = [];
      } else {
        folderSegs = String(folderRef).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(sanitizeSeg);
      }
      const newId = [targetVault, ...folderSegs, baseName].join('/');
      const fromAbs = npath.join(root, id);
      const toAbs = npath.join(root, newId);
      mkdirSync(npath.dirname(toAbs), { recursive: true });
      renameSync(fromAbs, toAbs);
      return { id: newId, name: baseName, vaultId: targetVault, folderId: folderSegs.join('/') || null };
    },
    findFolder(ref, vaultRef) {
      const want = String(ref || '').replace(/^\/+|\/+$/g, '');
      if (!want) return null;
      const v = sanitizeSeg(vaultRef || 'default');
      const abs = npath.join(root, v, want);
      if (!existsSync(abs)) return null;
      return { id: `${v}/${want}`, name: want.split('/').pop(), vaultId: v, path: want };
    },
    createFolder(name, vaultRef = 'default', parentRef = null) {
      if (/[\/\\]/.test(name)) throw new Error('folder name cannot contain "/"');
      const v = sanitizeSeg(vaultRef);
      const parentSegs = parentRef
        ? String(parentRef).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(sanitizeSeg)
        : [];
      const segs = [...parentSegs, sanitizeSeg(name)];
      const id = [v, ...segs].join('/');
      const abs = npath.join(root, id);
      if (existsSync(abs)) throw new Error(`folder already exists: ${segs.join('/')}`);
      mkdirSync(abs, { recursive: true });
      return {
        id, name: sanitizeSeg(name), vaultId: v,
        path: segs.join('/'), parentId: parentSegs.length ? [v, ...parentSegs].join('/') : null,
      };
    },
    renameFolder(ref, newName, vaultRef) {
      if (/[\/\\]/.test(newName)) throw new Error('folder name cannot contain "/"');
      const v = sanitizeSeg(vaultRef || 'default');
      const want = String(ref || '').replace(/^\/+|\/+$/g, '');
      const abs = npath.join(root, v, want);
      const parentAbs = npath.dirname(abs);
      const newAbs = npath.join(parentAbs, sanitizeSeg(newName));
      try { renameSync(abs, newAbs); }
      catch (e) { throw new Error('rename failed: ' + (e.message || e)); }
      const newRel = npath.relative(npath.join(root, v), newAbs).split(npath.sep).join('/');
      return { id: `${v}/${newRel}`, name: sanitizeSeg(newName), vaultId: v, path: newRel };
    },
    deleteFolder(ref, vaultRef) {
      const v = sanitizeSeg(vaultRef || 'default');
      const want = String(ref || '').replace(/^\/+|\/+$/g, '');
      const abs = npath.join(root, v, want);
      if (!existsSync(abs)) throw new Error(`folder not found: ${want}`);
      // Count what's about to disappear so the MCP reply is informative.
      let filesRemoved = 0;
      let foldersRemoved = 0;
      (function tally(p) {
        let entries = [];
        try { entries = readdirSync(p, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const sub = npath.join(p, e.name);
          if (e.isDirectory()) { foldersRemoved++; tally(sub); }
          else if (e.isFile() && e.name.endsWith('.md')) { filesRemoved++; }
        }
      })(abs);
      foldersRemoved++; // include the root being removed
      try { rmSync(abs, { recursive: true, force: true }); }
      catch (e) { throw new Error('delete failed: ' + (e.message || e)); }
      return { foldersRemoved, filesRemoved };
    },
    moveFolder(ref, newParentRef, vaultRef) {
      const v = sanitizeSeg(vaultRef || 'default');
      const src = String(ref || '').replace(/^\/+|\/+$/g, '');
      const baseName = src.split('/').pop();
      const parentSegs = newParentRef
        ? String(newParentRef).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(sanitizeSeg)
        : [];
      const dst = [...parentSegs, baseName].join('/');
      if (dst === src) return { id: `${v}/${dst}`, vaultId: v };
      if (dst.startsWith(src + '/')) throw new Error('cannot move folder into its own descendant');
      const absSrc = npath.join(root, v, src);
      const absDst = npath.join(root, v, dst);
      mkdirSync(npath.dirname(absDst), { recursive: true });
      try { renameSync(absSrc, absDst); }
      catch (e) { throw new Error('move failed: ' + (e.message || e)); }
      return { id: `${v}/${dst}`, vaultId: v, path: dst };
    },
    appendContent(id, body) {
      if (!body) return;
      const abs = npath.join(root, id);
      mkdirSync(npath.dirname(abs), { recursive: true });
      const prev = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
      writeFileSync(abs, prev + body, 'utf8');
    },
    listFolders(vaultRef) {
      const seg = vaultRef ? sanitizeSeg(vaultRef) : null;
      const out = [];
      function walkDirs(absDir, vault, parent) {
        let entries = [];
        try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.')) continue;
          const id = npath.relative(root, npath.join(absDir, e.name)).split(npath.sep).join('/');
          out.push({ id, name: e.name, vaultId: vault, vault, parentId: parent });
          walkDirs(npath.join(absDir, e.name), vault, id);
        }
      }
      if (seg) {
        const vDir = npath.join(root, seg);
        if (existsSync(vDir)) walkDirs(vDir, seg, null);
      } else {
        let topDirs = [];
        try { topDirs = readdirSync(root, { withFileTypes: true }); } catch {}
        for (const e of topDirs) {
          if (!e.isDirectory() || e.name.startsWith('.')) continue;
          walkDirs(npath.join(root, e.name), e.name, null);
        }
      }
      return out;
    },
    fileInfo(id) {
      const abs = npath.join(root, id);
      if (!existsSync(abs)) return null;
      const text = readFileSync(abs, 'utf8');
      const preview = text.length > 200 ? text.slice(0, 200) + '…' : text;
      const vault = id.split('/')[0] || 'default';
      return {
        id, name: npath.basename(id),
        vaultId: vault, vault, size: text.length, preview,
      };
    },
    // No awareness channel in local-filesystem mode — the app picks up
    // changes via fs.watch on the export folder, so the user sees them
    // arrive directly. publishMcpAction is a no-op for parity with the
    // remote ops shape. is_app_open / focus / highlight only make sense
    // when there's a live sync peer to talk to.
    publishMcpAction() { /* noop */ },
    publishAiPointer() { /* noop */ },
    publishAiPresence() { /* noop */ },
    publishAiAgentPresence() { /* noop */ },
    listAiAgents() { return []; },
    listAgentTasks() { return []; },
    getAmbientConfig() { return { enabled: false, staleQuestionMins: 180, stalledRunningMins: 30, unclaimedTaskMins: 60 }; },
    setAmbientConfig() { throw new Error('local mode — ambient config requires live sync'); },
    getProactiveSignals() { return { enabled: false, config: this.getAmbientConfig(), signals: [] }; },
    getAgentPolicy(vaultId) { return vaultId ? null : {}; },
    setAgentPolicy() { throw new Error('local mode — agent policy requires live sync'); },
    isAgentAllowedInVault() { return true; },
    claimAgentTask() { throw new Error('local mode — agent tasks require live sync'); },
    completeAgentTask() { throw new Error('local mode — agent tasks require live sync'); },
    isAppOpen() { return { open: false, count: 0, peers: [], note: 'local mode' }; },
    getActiveContext() { return { activeNote: null, activeVaultId: null, activeVault: null, appOpen: false, pendingReplies: [], note: 'local mode — no presence' }; },
    getPendingUserReplies() { return []; },
    getRecentNotes() { return []; },
    getRecentEdits() { return []; }, // not tracked in local-filesystem mode
    getEditorSelection() { return null; },
    getCanvasSelection() { return null; },
    waitForSelectionChange() { return Promise.resolve({ changed: false, reason: 'local mode — selection events not available' }); },
    addInlineReply() { throw new Error('local mode — anchored comments require live sync'); },
    waitForInlineReply() { return Promise.resolve({ reply: null, reason: 'local mode — anchored comments require live sync' }); },
    screenshotNote() { return Promise.resolve({ ok: false, reason: 'local mode — needs the live app to capture' }); },
    listEvents() { throw new Error('local mode — events require sync mode'); },
    listCollections() { throw new Error('local mode — collections require sync mode'); },
    createEvent() { throw new Error('local mode — events require sync mode'); },
    updateEvent() { throw new Error('local mode — events require sync mode'); },
    deleteEvent() { throw new Error('local mode — events require sync mode'); },
    focusNote(fileId) { return { id: fileId, name: null, note: 'local mode — focus n/a' }; },
    highlightInNote(fileId) { return { id: fileId, note: 'local mode — highlight n/a' }; },
    presentInNote(fileId, steps) { return { id: fileId, stepCount: (steps || []).length, note: 'local mode — present n/a' }; },
    spotlightPulse(fileId) { return { id: fileId, note: 'local mode — pulse n/a' }; },
    // Pinned context — local mode persists to <vault>/_edinot/pinned.json
    pinContext(entry) {
      const dir = path.join(root, '_edinot');
      try { mkdirSync(dir, { recursive: true }); } catch {}
      const file = path.join(dir, 'pinned.json');
      let list = [];
      try { list = JSON.parse(readFileSync(file, 'utf8')); } catch {}
      const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const rec = { id, text: entry.text, label: entry.label || null, noteId: entry.noteId || null, source: entry.source || 'manual', addedAt: new Date().toISOString() };
      list.push(rec);
      writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
      return rec;
    },
    unpinContext(id) {
      const file = path.join(root, '_edinot', 'pinned.json');
      let list = [];
      try { list = JSON.parse(readFileSync(file, 'utf8')); } catch {}
      const before = list.length;
      list = list.filter(p => p.id !== id);
      writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
      return { removed: before - list.length, remaining: list.length };
    },
    listPinnedContext() {
      const file = path.join(root, '_edinot', 'pinned.json');
      try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
    },
    clearPinnedContext() {
      const file = path.join(root, '_edinot', 'pinned.json');
      let list = [];
      try { list = JSON.parse(readFileSync(file, 'utf8')); } catch {}
      const n = list.length;
      try { writeFileSync(file, '[]', 'utf8'); } catch {}
      return { cleared: n };
    },
    async flush() { /* writes land on disk synchronously */ },
    async close() { /* nothing to tear down */ },
    getSetting(_key, fallback = null) { return fallback; },
  };
}

export const ops = {
  async open(cfg) {
    if (cfg && cfg.mode === 'local') return openLocal(cfg);
    if (!cfg || !cfg.token) {
      throw new Error('No CLI token; run: edinot login --email <e> --password <p>');
    }
    // Pre-flight: surface expired tokens with a clear message instead of
    // letting Hocuspocus return the opaque `permission-denied` string.
    // Auto-refresh while still valid — assistants stay logged in without
    // touching their password as long as they reconnect once a week.
    const expMs = tokenExpiresAt(cfg.token);
    const now = Date.now();
    if (expMs != null) {
      if (expMs <= now) {
        const when = new Date(expMs).toISOString();
        throw new Error(`Token expired at ${when}. Run: edinot login --email <e> --password <p>`);
      }
      if (expMs - now < 48 * 3600 * 1000) {
        try {
          const r = await api.refresh(cfg.server, cfg.token);
          if (r && r.token) {
            cfg.token = r.token;
            // El token del hub se pide de nuevo en cada arranque: no se guarda.
            if (!cfg.hub) {
              try {
                const persisted = loadConfig() || {};
                saveConfig({ ...persisted, ...cfg, token: r.token });
              } catch {}
            }
          }
        } catch (err) {
          // Non-fatal: continue with the current token. If it actually
          // expires mid-session the next reconnect surfaces a clear error.
          console.warn('[cli] token refresh failed:', err && err.message);
        }
      }
    }
    const wsUrl = deriveWsUrl(cfg.server);

    // ── Doc topology (Fase B + D) ──────────────────────────────────────
    // Three Y.Doc tiers must all be attached for MCP to see what the app
    // sees:
    //   - Shell    `ws:{wid}`                          — yVaults, yMeta,
    //              ySettings. yMeta still carries activeId, activeVault,
    //              noteComments, fileStats, editLog, pinnedContext,
    //              editorSelection, screenshotResponses (editor.jsx
    //              continues to import the shell yMeta directly).
    //   - Vault    `ws:{wid}:vault:{vid}`              — per-vault
    //              yFiles, yFolders, and a content:{nid} Y.Text per
    //              note (used as the seed for per-note docs).
    //   - Note     `ws:{wid}:vault:{vid}:note:{nid}`   — single Y.Text
    //              keyed `content`. Once the app opens a note, all
    //              edits land here; the vault-doc content Y.Text is
    //              not updated again. MCP must therefore prefer the
    //              per-note doc for reads/writes when available.
    //
    // Vault providers open eagerly for every accessible vault on first
    // session connect so cross-vault `list_notes`, `search_notes`,
    // recent edits etc. see everything. Per-note providers open lazily
    // and only stay alive for the duration of the MCP session.

    // Progress-aware sync gate. `idleMs` is how long we tolerate without ANY
    // incoming WS message — every `message` event from the provider resets
    // the clock, so large initial syncs (a note with megabytes of pasted
    // content, a vault with hundreds of files) keep their slot as long as
    // data is flowing. `hardMs` is the absolute ceiling that catches a
    // genuinely stuck provider that's chatting (keepalives) without ever
    // emitting `synced`. The legacy `timeoutMs` argument is accepted for
    // back-compat and maps onto `hardMs`.
    // Documentos en los que se escribió estando el acceso en SOLO LECTURA (acceso compartido): el servidor
    // descarta esos cambios, y hay que decirlo en vez de aparentar que se guardaron.
    const readOnlyWrites = new Set();
    function openProvider(name, doc, opts = {}) {
      const {
        idleMs    = 45000,
        hardMs    = opts.timeoutMs || 600000,
        requireSync = true,
      } = opts;
      const prov = new HocuspocusProvider({
        url: wsUrl,
        name,
        token: cfg.token,
        document: doc,
        WebSocketPolyfill: webSocketFor(wsUrl),
      });
      let roConn = false;
      prov.on('authenticated', ({ scope } = {}) => { roConn = scope === 'readonly'; });
      doc.on('update', (_u, origin) => { if (roConn && origin !== prov) readOnlyWrites.add(name); });
      const ready = new Promise((resolve, reject) => {
        let done = false;
        let idleTimer = null;
        const hardTimer = setTimeout(() => {
          if (requireSync) finish(false, new Error(`sync hard timeout (${hardMs}ms): ${name}`));
          else finish(true);
        }, hardMs);
        const finish = (ok, err) => {
          if (done) return;
          done = true;
          if (idleTimer) clearTimeout(idleTimer);
          clearTimeout(hardTimer);
          if (ok) resolve(prov);
          else {
            // Si la sincronización inicial falla, el proveedor seguiría reintentando la conexión
            // para siempre (y reteniendo el proceso): se destruye.
            try {
              // Al cerrarse el socket el proveedor programa una reconexión mientras `shouldConnect`
              // sea true, y ese reintento sobrevive a destroy(): se apaga antes (si no, el proceso
              // se quedaba ~30 s con un temporizador de reconexión).
              const ws = prov.configuration && prov.configuration.websocketProvider;
              if (ws) { ws.shouldConnect = false; if (ws.cancelWebsocketRetry) ws.cancelWebsocketRetry(); }
              prov.shouldConnect = false;
              const sock = ws && ws.webSocket;      // destroy() hace un cierre ordenado y `ws` espera 30 s la respuesta
              prov.destroy();
              if (sock && sock.terminate) sock.terminate();
            } catch {}
            reject(err);
          }
        };
        const armIdle = () => {
          // Ya sincronizado (o fallido): no rearmar. Si no, cada mensaje posterior
          // dejaba un temporizador de 45 s que retenía el proceso del CLI.
          if (done) return;
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            if (requireSync) finish(false, new Error(`sync stalled (no data ${idleMs}ms): ${name}`));
            else finish(true);
          }, idleMs);
        };
        armIdle();
        // Anything arriving from the server (sync chunks, awareness pings)
        // means the pipe is alive — reset the idle clock.
        prov.on('message', () => armIdle());
        prov.on('synced', () => finish(true));
        // The server rebuilt this shell doc (server/compact.js) and won't
        // merge the history this process still holds. A restart loads the
        // compacted doc fresh.
        prov.on('stateless', ({ payload } = {}) => {
          let msg = null;
          try { msg = JSON.parse(payload); } catch {}
          if (msg && msg.type === 'stale-shell') {
            console.error(`[edinot] ${name} was compacted on the server — restart to reload it.`);
            process.exit(75);
          }
        });
        prov.on('authenticationFailed', ({ reason } = {}) => {
          finish(false, new Error(`auth failed (${name}): ${reason || ''}`));
        });
        // Terminal close codes (4400-4599) are app-defined Hocuspocus
        // permission/auth rejects — bail immediately. Other close codes
        // are transient (1006 abnormal, 1011 internal); the provider's
        // built-in auto-reconnect handles them and we just keep waiting
        // until idle/hard timer trips.
        prov.on('close', ({ event } = {}) => {
          const code = (event && event.code) || 0;
          if (code >= 4400 && code <= 4599) {
            finish(false, new Error(`closed (${name}): code=${code}`));
          }
        });
      });
      return { provider: prov, ready };
    }

    const ydoc = new Y.Doc();
    const { provider, ready: shellReady } = openProvider(`ws:${cfg.workspaceId}`, ydoc);
    await shellReady;

    const yVaults   = ydoc.getMap('vaults');
    const yMeta     = ydoc.getMap('meta');
    const ySettings = ydoc.getMap('settings');
    // Comments + agent tasks: v2 per-record maps (see shared/comments-model.js).
    // The bridge imports whatever older apps left in yMeta.noteComments /
    // yMeta.agentTasks and keeps absorbing their writes while we're connected.
    commentsAttachBridge(ydoc);

    // ── Per-vault doc registry ────────────────────────────────────────
    // Open all known vault providers up-front; ACL failures are
    // tolerated (user may have a vault row that denies one vault while
    // others stay open).
    //
    // vaultRegistry maps vaultId → { ydoc, provider, yFiles, yFolders, accessible }.
    const vaultRegistry = new Map();
    function makeVaultEntry(vid) {
      const vDoc = new Y.Doc();
      return {
        vaultId: vid,
        ydoc: vDoc,
        provider: null,
        accessible: false,
        yFiles:   vDoc.getMap('files'),
        yFolders: vDoc.getMap('folders'),
        yMeta:    vDoc.getMap('meta'),
        ySettings: vDoc.getMap('settings'),
        yEvents:  vDoc.getMap('events'),
        yCollections: vDoc.getMap('collections'),
      };
    }
    async function ensureVaultProvider(vid) {
      if (!vid) vid = 'default';
      let e = vaultRegistry.get(vid);
      if (e && e.provider) return e;
      if (!e) { e = makeVaultEntry(vid); vaultRegistry.set(vid, e); }
      const { provider: p, ready } = openProvider(
        `ws:${cfg.workspaceId}:vault:${vid}`, e.ydoc,
      );
      e.provider = p;
      try { await ready; e.accessible = true; }
      catch (err) {
        e.accessible = false;
        e.error = err.message;
        try { p.destroy(); } catch {}
        e.provider = null;
      }
      return e;
    }

    // Discover vault ids: yVaults entries on the shell + the synthetic
    // 'default'. ACL Fase B may scope the user to a subset — failed
    // opens are kept in the registry with accessible=false so the
    // caller can see why a vault is missing.
    const knownVaultIds = new Set(['default']);
    for (const vid of yVaults.keys()) knownVaultIds.add(vid);
    await Promise.allSettled(Array.from(knownVaultIds).map(ensureVaultProvider));

    // ── Per-note doc registry (ACL Fase D) ────────────────────────────
    // Lazy. Each read/write to a note pulls in the matching per-note
    // doc since that's where the app's latest content lives after the
    // first time the user opened the note.
    const noteRegistry = new Map();
    // Per-note docs are opened lazily and used to live until close(). Now
    // that a session can span a whole MCP process (many hundreds of notes),
    // that unbounded growth is a leak: cap the registry and evict the
    // least-recently-used providers. Eviction is safe — the next
    // ensureNoteProvider call transparently re-opens the doc, and the two
    // places that read noteRegistry directly treat a miss as "nothing
    // cached".
    const NOTE_REGISTRY_MAX = 24;
    function evictColdNoteProviders() {
      if (noteRegistry.size <= NOTE_REGISTRY_MAX) return;
      const byAge = [...noteRegistry.entries()]
        .filter(([, e]) => !e.pinned)
        .sort((a, b) => (a[1].usedAt || 0) - (b[1].usedAt || 0));
      let over = noteRegistry.size - NOTE_REGISTRY_MAX;
      for (const [nid, e] of byAge) {
        if (over <= 0) break;
        try { e.provider && e.provider.destroy(); } catch {}
        try { e.ydoc && e.ydoc.destroy(); } catch {}
        noteRegistry.delete(nid);
        over--;
      }
    }

    async function ensureNoteProvider(noteId, vaultId) {
      let e = noteRegistry.get(noteId);
      // Match ensureVaultProvider: only short-circuit when we already have
      // a live provider. A stale failure (provider=null) gets re-attempted
      // on the next call so one transient timeout doesn't blacklist the
      // note for the rest of the session.
      if (e && e.provider) { e.usedAt = Date.now(); return e; }
      if (!e) {
        const nDoc = new Y.Doc();
        e = {
          noteId, vaultId,
          ydoc: nDoc,
          provider: null,
          ytext: nDoc.getText('content'),
          accessible: false,
        };
        noteRegistry.set(noteId, e);
      }
      e.usedAt = Date.now();
      // Pinned across the await so a concurrent call's eviction pass can't
      // destroy the doc we're still syncing into.
      e.pinned = true;
      const { provider: p, ready } = openProvider(
        `ws:${cfg.workspaceId}:vault:${vaultId}:note:${noteId}`, e.ydoc,
      );
      e.provider = p;
      try { await ready; e.accessible = true; e.error = null; }
      catch (err) {
        e.accessible = false;
        e.error = err.message;
        try { p.destroy(); } catch {}
        e.provider = null;
      }
      e.pinned = false;
      e.usedAt = Date.now();
      evictColdNoteProviders();
      return e;
    }

    // ── Aggregate views ───────────────────────────────────────────────
    // yFiles / yFolders behave like read-mostly proxies that fan out
    // across vault docs. Writes are dispatched to the right vault doc
    // based on the file's resolved vaultId.
    function* iterFiles() {
      for (const v of vaultRegistry.values()) {
        if (!v.yFiles) continue;
        for (const meta of v.yFiles.values()) if (meta) yield meta;
      }
    }
    function* iterFolders() {
      for (const v of vaultRegistry.values()) {
        if (!v.yFolders) continue;
        for (const f of v.yFolders.values()) if (f) yield f;
      }
    }
    function locateFile(id) {
      for (const v of vaultRegistry.values()) {
        if (!v.yFiles) continue;
        const m = v.yFiles.get(id);
        if (m) return { meta: m, vault: v };
      }
      return null;
    }
    function locateFolder(id) {
      for (const v of vaultRegistry.values()) {
        if (!v.yFolders) continue;
        const f = v.yFolders.get(id);
        if (f) return { folder: f, vault: v };
      }
      return null;
    }
    function vaultEntryFor(vaultId) {
      return vaultRegistry.get(vaultId || 'default') || null;
    }
    // Shim object that mimics the Y.Map surface (the rest of this file
    // was originally written against a single workspace-doc yFiles).
    // .get / .has resolve against any vault; .values / .keys / .entries
    // iterate every vault doc; .set / .delete dispatch to the right
    // vault doc; .size sums across vault docs.
    const yFiles = {
      get(id) { const loc = locateFile(id); return loc ? loc.meta : undefined; },
      has(id) { return !!locateFile(id); },
      delete(id) {
        const loc = locateFile(id);
        if (!loc) return false;
        loc.vault.yFiles.delete(id);
        return true;
      },
      set(id, meta) {
        const targetVid = (meta && meta.vaultId) || 'default';
        const existing = locateFile(id);
        // Vault changed → drop from old vault doc, write to new one.
        if (existing && existing.vault.vaultId !== targetVid) {
          existing.vault.yFiles.delete(id);
          // Also pull existing content text along so the move keeps
          // body intact. Per-vault content texts seed per-note docs;
          // leaving the body in the old vault would orphan it.
          const oldText = existing.vault.ydoc.getText('content:' + id).toString();
          if (oldText) existing.vault.ydoc.getText('content:' + id).delete(0, oldText.length);
          const target = vaultEntryFor(targetVid);
          if (target) {
            target.yFiles.set(id, meta);
            if (oldText) target.ydoc.getText('content:' + id).insert(0, oldText);
          }
          return;
        }
        const v = existing ? existing.vault : vaultEntryFor(targetVid);
        if (v && v.yFiles) v.yFiles.set(id, meta);
      },
      values() { return iterFiles(); },
      keys()   { const out = []; for (const m of iterFiles()) out.push(m.id); return out[Symbol.iterator](); },
      entries(){ const out = []; for (const m of iterFiles()) out.push([m.id, m]); return out[Symbol.iterator](); },
      get size() { let n = 0; for (const _ of iterFiles()) n++; return n; },
      [Symbol.iterator]() { return this.entries(); },
    };
    const yFolders = {
      get(id) { const loc = locateFolder(id); return loc ? loc.folder : undefined; },
      has(id) { return !!locateFolder(id); },
      delete(id) {
        const loc = locateFolder(id);
        if (!loc) return false;
        loc.vault.yFolders.delete(id);
        return true;
      },
      set(id, meta) {
        const targetVid = (meta && meta.vaultId) || 'default';
        const existing = locateFolder(id);
        if (existing && existing.vault.vaultId !== targetVid) {
          existing.vault.yFolders.delete(id);
          const target = vaultEntryFor(targetVid);
          if (target) target.yFolders.set(id, meta);
          return;
        }
        const v = existing ? existing.vault : vaultEntryFor(targetVid);
        if (v && v.yFolders) v.yFolders.set(id, meta);
      },
      values() { return iterFolders(); },
      keys()   { const out = []; for (const f of iterFolders()) out.push(f.id); return out[Symbol.iterator](); },
      entries(){ const out = []; for (const f of iterFolders()) out.push([f.id, f]); return out[Symbol.iterator](); },
      get size() { let n = 0; for (const _ of iterFolders()) n++; return n; },
      [Symbol.iterator]() { return this.entries(); },
    };

    // getContent — synchronous accessor used by the helpers that
    // record edits (length deltas, snippets). Returns the vault-doc
    // content Y.Text. Up to date until the app opens the note; after
    // that, prefer readContentLatest / writeContentLatest below which
    // route through the per-note doc.
    function getContent(id) {
      const loc = locateFile(id);
      if (!loc) {
        // No vault holds this id yet — create a content text in the
        // default vault so callers (createFile) can write the body.
        const v = vaultEntryFor('default');
        return v ? v.ydoc.getText('content:' + id) : new Y.Doc().getText('content:' + id);
      }
      return loc.vault.ydoc.getText('content:' + id);
    }
    // Per-note-aware accessors. Use these from any tool that needs the
    // freshest body (read_note, write_note, append_note, table_*,
    // canvas_*, recall, etc.). They open the per-note provider on
    // demand and mirror writes back into the vault doc so search/list
    // tools that iterate vault content texts stay in sync.
    async function readContentLatest(id) {
      const loc = locateFile(id);
      if (!loc) return '';
      try {
        const e = await ensureNoteProvider(id, loc.vault.vaultId);
        // Per-note doc is the canonical source once it exists on the
        // server — only fall back to the vault mirror when the per-note
        // provider failed to open (e.accessible === false). The old
        // `length > 0` guard treated an empty per-note as "missing" and
        // returned the vault mirror, which is stale for notes the user
        // has edited in the app (the app stops mirroring to the vault
        // text after the first per-note open).
        if (e.accessible) return e.ytext.toString();
      } catch { /* fall through to vault doc */ }
      return loc.vault.ydoc.getText('content:' + id).toString();
    }
    async function writeContentLatest(id, body) {
      const loc = locateFile(id);
      if (!loc) throw new Error(`file not found: ${id}`);
      const text = body == null ? '' : String(body);
      let wroteNote = false;
      try {
        const e = await ensureNoteProvider(id, loc.vault.vaultId);
        if (e.accessible) {
          // Solo el tramo que cambia: borrar todo y reescribir rompía a quien tuviera la nota abierta.
          e.ydoc.transact(() => { applyTextDiff(e.ytext, text); });
          wroteNote = true;
        }
      } catch { /* fall back to vault doc only */ }
      // Always mirror into the vault content text so cross-note views
      // (search, table parsers, canvas readers) keep working without
      // having to open every per-note doc.
      loc.vault.ydoc.transact(() => { applyTextDiff(loc.vault.ydoc.getText('content:' + id), text); });
      return { wroteNote };
    }
    async function appendContentLatest(id, body) {
      if (!body) return { wroteNote: false };
      const loc = locateFile(id);
      if (!loc) throw new Error(`file not found: ${id}`);
      const text = String(body);
      let wroteNote = false;
      try {
        const e = await ensureNoteProvider(id, loc.vault.vaultId);
        if (e.accessible) {
          e.ydoc.transact(() => { e.ytext.insert(e.ytext.length, text); });
          wroteNote = true;
        }
      } catch {}
      loc.vault.ydoc.transact(() => {
        const t = loc.vault.ydoc.getText('content:' + id);
        t.insert(t.length, text);
      });
      return { wroteNote };
    }

    function genVaultId() {
      return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    }
    function findVaultByName(name) {
      if (!name) return null;
      const target = String(name).toLowerCase();
      for (const [id, v] of yVaults.entries()) {
        if (v && typeof v.name === 'string' && v.name.toLowerCase() === target) {
          return { id, name: v.name };
        }
      }
      return null;
    }

    function awaitFlush(prov, timeoutMs = 5000) {
      // Wait until the provider has acked every queued Y.Doc update with
      // the server, so a tool that writes followed immediately by close()
      // doesn't lose data to a 250-ms race. `unsyncedChanges` drops to 0
      // when the provider's outbox is empty; we listen to its change
      // event and resolve as soon as it does (or after `timeoutMs` as a
      // safety net so a dead WS doesn't hang the tool call forever).
      if (!prov) return Promise.resolve();
      if (typeof prov.unsyncedChanges !== 'number' || prov.unsyncedChanges === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return; done = true;
          try { prov.off('unsyncedChanges', handler); } catch {}
          resolve();
        }, timeoutMs);
        const handler = ({ number } = {}) => {
          if (done) return;
          if (number === 0) {
            done = true; clearTimeout(t);
            try { prov.off('unsyncedChanges', handler); } catch {}
            resolve();
          }
        };
        prov.on('unsyncedChanges', handler);
      });
    }
    async function flush() {
      // Drain every live provider's pending Y.Doc updates before the
      // session tears them down. Without this, writes that were queued
      // a millisecond before close() can be dropped on the floor.
      const tasks = [];
      tasks.push(awaitFlush(provider));
      for (const e of vaultRegistry.values()) {
        if (e && e.provider) tasks.push(awaitFlush(e.provider));
      }
      for (const e of noteRegistry.values()) {
        if (e && e.provider) tasks.push(awaitFlush(e.provider));
      }
      await Promise.allSettled(tasks);
    }

    // Resolve a caller-supplied vault reference (name or id) to a real vault
    // id from yVaults. Order: exact id match first (case-sensitive, stable),
    // then name match (case-insensitive, fragile across renames). When
    // nothing matches we throw an error listing the actual vaults so the
    // caller — typically an LLM driving the MCP — can recover with a real
    // name on the next attempt instead of silently writing into 'default'
    // and being convinced everything worked.
    //
    // Empty / missing ref still defaults to 'default' since that's the
    // documented default-vault fallback for callers that don't care.
    function listVaultsForError() {
      const out = [];
      const seen = new Set();
      for (const [id, v] of yVaults.entries()) {
        out.push(`'${(v && v.name) || id}' (id=${id})`);
        seen.add(id);
      }
      if (!seen.has('default')) out.push("'Default' (id=default)");
      return out.join(', ');
    }
    function resolveVaultId(ref, { strict = true } = {}) {
      if (!ref) return 'default';
      if (yVaults.has(ref)) return ref;
      // The synthetic default — yVaults often doesn't carry an explicit
      // 'default' entry, but every workspace can write to that bucket.
      if (ref === 'default') return 'default';
      const target = String(ref).toLowerCase();
      for (const [id, v] of yVaults.entries()) {
        if (v && typeof v.name === 'string' && v.name.toLowerCase() === target) return id;
      }
      if (!strict) return 'default';
      throw new Error(
        `vault not found: '${ref}'. Available: ${listVaultsForError()}. ` +
        `Tip: pass the vault id (stable across renames) when you have it.`
      );
    }

    function genFolderId() {
      return 'fld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    }
    // "Parent/Child/Leaf" path string for a folder id, vault excluded.
    function folderPath(folderId) {
      if (!folderId) return '';
      const parts = [];
      let cur = yFolders.get(folderId);
      const seen = new Set();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        parts.unshift(cur.name || '?');
        cur = cur.parentId ? yFolders.get(cur.parentId) : null;
      }
      return parts.join('/');
    }
    // Resolve a folder reference (id, bare name, or "Parent/Child" path) within
    // a vault. Returns the folder entry or null when not found.
    function resolveFolder(ref, vaultId) {
      if (ref === null || ref === undefined || ref === '') return null;
      const direct = yFolders.get(ref);
      if (direct && (direct.vaultId || null) === vaultId) return direct;
      const segs = String(ref).split('/').filter(Boolean);
      if (segs.length === 0) return null;
      let parentId = null;
      let match = null;
      for (const seg of segs) {
        const segLower = seg.toLowerCase();
        match = null;
        for (const f of yFolders.values()) {
          if ((f.vaultId || null) !== vaultId) continue;
          if ((f.parentId || null) !== parentId) continue;
          if ((f.name || '').toLowerCase() === segLower) { match = f; break; }
        }
        if (!match) return null;
        parentId = match.id;
      }
      return match;
    }
    function resolveFolderId(ref, vaultId) {
      if (ref === null || ref === undefined || ref === '') return null;
      const f = resolveFolder(ref, vaultId);
      if (!f) {
        // Surface the legal options so the AI can self-correct instead of
        // silently dropping the note at the vault root. Limit to 30 names
        // so deep trees don't blow up the error message.
        const avail = [];
        for (const fld of yFolders.values()) {
          if ((fld.vaultId || null) !== vaultId) continue;
          avail.push(folderPath(fld.id));
        }
        avail.sort();
        const hint = avail.length
          ? avail.slice(0, 30).map(p => `'${p}'`).join(', ') + (avail.length > 30 ? ', …' : '')
          : '(no folders exist yet — create one with create_folder)';
        throw new Error(`folder not found in vault '${vaultId}': '${ref}'. Available: ${hint}`);
      }
      return f.id;
    }

    // ── Edit log ─────────────────────────────────────────────────────────
    // Append-only ring buffer of mutations, persisted in yMeta.editLog.
    // Feeds `get_recent_edits` so the AI can resume without re-reading
    // entire notes ("what changed since 5 minutes ago?").
    const EDIT_LOG_CAP = 200;
    function extractMentionsFromText(s) {
      // Pulls out `@email@host.tld` chunks. Conservative: requires the
      // canonical user@host pattern so a plain `@alice` doesn't get
      // counted (we don't have a username resolver, only emails).
      const re = /(?:^|\s)@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
      const out = [];
      const seen = new Set();
      let m;
      while ((m = re.exec(String(s || ''))) !== null) {
        const email = m[1].toLowerCase();
        if (seen.has(email)) continue;
        seen.add(email);
        out.push(email);
        if (out.length >= 20) break;
      }
      return out;
    }
    function normalizeAgentAlias(s) {
      return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    }
    function listOnlineAiAgentsSnapshot() {
      const out = [];
      try {
        provider.awareness.getStates().forEach((state, clientId) => {
          if (state && state.aiAgent && state.aiAgent.alias) {
            out.push({ clientId, online: true, ...state.aiAgent });
          }
        });
      } catch {}
      out.sort((a, b) => String(a.alias || '').localeCompare(String(b.alias || '')));
      return out;
    }
    function knownAiAgentsByAlias() {
      const map = new Map();
      const raw = Array.isArray(yMeta.get('knownAiAgents')) ? yMeta.get('knownAiAgents') : [];
      for (const a of raw) {
        const alias = normalizeAgentAlias(a && a.alias);
        if (alias) map.set(alias, { ...a, alias, online: false });
      }
      for (const a of listOnlineAiAgentsSnapshot()) {
        const alias = normalizeAgentAlias(a && a.alias);
        if (alias) map.set(alias, { ...a, alias, online: true });
      }
      return map;
    }
    // Canonical, device-agnostic tags (Claude-Tag style). `@Claude` is one
    // shared identity that ANY online agent of the matching `kind` can pick
    // up — unlike the per-device aliases (`@claude-mac`) which target one CLI
    // on one machine. Defaults are seeded per kind so no registration step is
    // needed; `yMeta.get('taggedAgents')` lets the workspace add/override tags.
    function canonicalAgentTags() {
      const map = new Map();
      const defaults = [
        { tag: 'claude', kind: 'claude', label: 'Claude' },
        { tag: 'codex', kind: 'codex', label: 'Codex' },
        { tag: 'cursor', kind: 'cursor', label: 'Cursor' },
      ];
      for (const d of defaults) map.set(d.tag, d);
      const raw = Array.isArray(yMeta.get('taggedAgents')) ? yMeta.get('taggedAgents') : [];
      for (const t of raw) {
        const tag = normalizeAgentAlias(t && t.tag);
        if (!tag) continue;
        const kind = normalizeAgentAlias(t && t.kind) || tag;
        map.set(tag, { tag, kind, label: (t && t.label) || tag });
      }
      return map;
    }
    // Is at least one agent of `kind` currently advertising presence?
    function isKindOnline(kind) {
      const k = normalizeAgentAlias(kind);
      if (!k) return false;
      return listOnlineAiAgentsSnapshot().some(a => normalizeAgentAlias(a && a.kind) === k);
    }
    // ── Per-vault agent access policy (Fase 3) ──────────────────────────────
    // `yMeta.agentPolicy` = { [vaultId]: { allowKinds?, denyKinds?, allowAliases?,
    // denyAliases? } }. No entry for a vault = allow everything (back-compat).
    // Deny wins; if any allow* list is non-empty the vault is whitelist-mode.
    function agentPolicyForVault(vaultId) {
      const all = yMeta.get('agentPolicy');
      if (!all || typeof all !== 'object') return null;
      const p = all[vaultId];
      return (p && typeof p === 'object') ? p : null;
    }
    function isAgentAllowedInVault(vaultId, { kind, alias } = {}) {
      const p = agentPolicyForVault(vaultId);
      if (!p) return true;
      const k = normalizeAgentAlias(kind);
      const a = normalizeAgentAlias(alias);
      const arr = (x) => (Array.isArray(x) ? x.map(v => normalizeAgentAlias(v)).filter(Boolean) : []);
      if (a && arr(p.denyAliases).includes(a)) return false;
      if (k && arr(p.denyKinds).includes(k)) return false;
      const allowA = arr(p.allowAliases);
      const allowK = arr(p.allowKinds);
      if (allowA.length || allowK.length) {
        return (!!a && allowA.includes(a)) || (!!k && allowK.includes(k));
      }
      return true;
    }
    function extractAgentMentionsFromText(s) {
      const agents = knownAiAgentsByAlias();
      const tags = canonicalAgentTags();
      if (!agents.size && !tags.size) return [];
      const out = [];
      const seen = new Set();
      const re = /(^|[^\w@.-])@([a-zA-Z0-9][a-zA-Z0-9._-]{1,48})\b/g;
      let m;
      while ((m = re.exec(String(s || ''))) !== null) {
        const alias = normalizeAgentAlias(m[2]);
        if (!alias || seen.has(alias)) continue;
        // Match either a known per-device alias OR a canonical shared tag.
        if (!agents.has(alias) && !tags.has(alias)) continue;
        seen.add(alias);
        out.push(alias);
        if (out.length >= 20) break;
      }
      return out;
    }
    function enqueueAgentTasksForComment(comment, noteMeta, sourceText, requester) {
      const aliases = extractAgentMentionsFromText(sourceText || (comment && comment.text));
      if (!aliases.length || !comment || !noteMeta) return [];
      const agents = knownAiAgentsByAlias();
      const comments = readNoteComments(ydoc, comment.noteId);
      const threadRootId = threadRootIdOf(comment, comments);
      const tags = canonicalAgentTags();
      const vaultId = noteMeta.vaultId || 'default';
      const now = new Date().toISOString();
      const tasks = [];
      for (const alias of aliases) {
        const tag = tags.get(alias);
        // Canonical task: addressed to a shared kind (@Claude), claimable by any
        // online agent of that kind. We still record which device claims/answers
        // it later via `claimedBy`/`completedBy`, so CLI provenance is preserved.
        const agent = tag ? {} : (agents.get(alias) || {});
        const kind = tag ? tag.kind : (agent.kind || 'ai');
        // Fase 3 gate — don't enqueue work for an agent the vault disallows.
        if (!isAgentAllowedInVault(vaultId, { kind, alias })) continue;
        const online = tag ? isKindOnline(kind) : (agent.online === true);
        tasks.push({
          id: 'agt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          targetAlias: alias,
          targetKind: kind,
          canonical: !!tag,
          targetOwnerEmail: tag ? null : (agent.ownerEmail || null),
          targetDevice: tag ? null : (agent.device || null),
          noteId: noteMeta.id || comment.noteId,
          noteName: noteMeta.name || null,
          vaultId,
          commentId: comment.id,
          parentCommentId: comment.parentId || null,
          threadRootId,
          anchorText: comment.anchorText || null,
          prompt: String(sourceText || comment.text || '').slice(0, 4000),
          requestedBy: requester || cfg.email || 'user',
          requestedAt: now,
          status: online ? 'pending' : 'pending-offline',
          history: [{ status: online ? 'pending' : 'pending-offline', ts: now }],
        });
      }
      if (tasks.length) putAgentTasks(ydoc, tasks);
      return tasks;
    }
    function assertAgentCanHandleTask(task, agent, action) {
      const actual = normalizeAgentAlias(agent && agent.alias);
      if (!actual) throw new Error(`cannot ${action} agent task without an agent alias`);
      // Canonical (shared) tasks: any agent whose `kind` matches the tag can
      // handle it, regardless of device alias. Provenance is still recorded via
      // claimedBy/completedBy.
      if (task && task.canonical) {
        const wantKind = normalizeAgentAlias(task.targetKind || task.targetAlias);
        const actualKind = normalizeAgentAlias(agent && agent.kind);
        if (wantKind && actualKind !== wantKind) {
          throw new Error(`agent task ${task.id} is for any @${wantKind} agent, but @${actual} is kind ${actualKind || 'unknown'}`);
        }
        return;
      }
      const target = normalizeAgentAlias(task && task.targetAlias);
      if (target && actual !== target) {
        throw new Error(`agent task ${task.id} is addressed to @${target}, not @${actual}`);
      }
    }

    function snippetOf(s, max = 180) {
      if (!s) return '';
      const trimmed = String(s).replace(/\s+/g, ' ').trim();
      return trimmed.length > max ? trimmed.slice(0, max) + '…' : trimmed;
    }
    function recordEdit(entry) {
      try {
        const list = Array.isArray(yMeta.get('editLog')) ? yMeta.get('editLog') : [];
        const rec = { ts: new Date().toISOString(), ...entry };
        const next = list.length >= EDIT_LOG_CAP
          ? [...list.slice(list.length - EDIT_LOG_CAP + 1), rec]
          : [...list, rec];
        yMeta.set('editLog', next);
      } catch { /* never let logging break the actual write */ }
    }

    return {
      listFiles({ vault }) {
        const arr = Array.from(yFiles.values());
        if (!vault) return arr;
        // Resolve the filter through the same strict path mutations use, so
        // a typo'd vault name throws with the valid list rather than
        // silently returning [] (which would mislead a caller into
        // thinking the vault is empty).
        const targetId = resolveVaultId(vault);
        return arr.filter(f => (f.vaultId || 'default') === targetId);
      },
      vaultName(id) {
        const v = yVaults.get(id);
        return v ? v.name : (id || 'default');
      },
      findFileByName(name) {
        const raw = String(name || '').trim();
        const target = raw.toLowerCase().replace(/\.md$/, '');
        for (const f of yFiles.values()) {
          const n = (f.name || '').toLowerCase().replace(/\.md$/, '');
          if (n === target) return f;
        }
        // Fallback: the stable note id (tools return it; it survives renames).
        const byId = yFiles.get(raw);
        if (byId) return byId;
        for (const f of yFiles.values()) if (f.id === raw) return f;
        return null;
      },
      async readContent(id) { return await readContentLatest(id); },
      // Search fast path (search_notes / recall): the body already in
      // memory — the per-note doc if this session has it open and synced,
      // otherwise the vault doc's content:<id> mirror. No network, no
      // per-note WebSocket: scanning a big vault no longer re-syncs every
      // note through the 24-entry provider LRU.
      readContentCached(id) {
        const e = noteRegistry.get(id);
        if (e && e.provider && e.accessible) return e.ytext.toString();
        const loc = locateFile(id);
        return loc ? loc.vault.ydoc.getText('content:' + id).toString() : '';
      },
      // Fresh body for a few top hits: readContentLatest with a deadline;
      // a stalled per-note sync falls back to the in-memory copy instead of
      // blocking the whole tool call (it used to wait up to 45 s).
      async readContentFresh(id, timeoutMs = 3000) {
        let timer = null;
        const fallback = new Promise((resolve) => {
          timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
        });
        try {
          const r = await Promise.race([readContentLatest(id).then(text => ({ text })), fallback]);
          if (r.timedOut) return this.readContentCached(id);
          return r.text;
        } catch {
          return this.readContentCached(id);
        } finally { clearTimeout(timer); }
      },
      async writeContent(id, body) {
        const before = await readContentLatest(id);
        await writeContentLatest(id, body);
        recordEdit({ noteId: id, kind: before ? 'write' : 'create', bytesBefore: before.length, bytesAfter: (body || '').length, snippetBefore: snippetOf(before), snippetAfter: snippetOf(body || '') });
      },
      // ── Calendar events / reminders ──────────────────────────────────
      // Manual rows in the vault's `events` Y.Map — the exact shape the app
      // reads via store.js getVaultEvents, so an MCP-created reminder syncs
      // into the calendar + fires through the same scheduler. Inline
      // (note-text) events are NOT returned; those live in note bodies.
      // `close()` → flush() drains the vault provider so writes aren't lost.
      listEvents(vaultArg) {
        const ref = (typeof vaultArg === 'string' ? vaultArg : (vaultArg && vaultArg.vault)) || 'default';
        const vid = resolveVaultId(ref);
        const e = vaultEntryFor(vid);
        if (!e || !e.yEvents) return [];
        const out = [];
        for (const raw of e.yEvents.values()) if (raw && raw.id) out.push(raw);
        return out;
      },
      // ── Collections (saved filters of «Todas las notas»; shared/collections.js) ──
      // The definitions only: rules are matched by the caller (the MCP tool does it
      // from the notes' tags/folders/type when asked).
      listCollections(vaultArg) {
        const ref = (typeof vaultArg === 'string' ? vaultArg : (vaultArg && vaultArg.vault)) || 'default';
        const vid = resolveVaultId(ref);
        const e = vaultEntryFor(vid);
        if (!e || !e.yCollections) return [];
        const out = [];
        for (const raw of e.yCollections.values()) { const c = _normalizeCollection(raw); if (c) out.push(c); }
        return out.sort((x, y) => (x.createdAt - y.createdAt) || x.name.localeCompare(y.name));
      },
      async createEvent({ title, start, end, allDay, kind, remindAt, noteId, recurrence, vault, location, description, color, reminderOffset, calendarId } = {}) {
        if (!start) throw new Error('createEvent: `start` is required (YYYY-MM-DD or YYYY-MM-DDTHH:mm)');
        // Some MCP clients flatten a typed object param to a JSON string —
        // accept either so recurrence always lands as a real object.
        if (typeof recurrence === 'string') { try { recurrence = JSON.parse(recurrence); } catch { recurrence = null; } }
        const vid = resolveVaultId(vault || 'default');
        const e = await ensureVaultProvider(vid);
        if (!e || !e.yEvents) throw new Error(`vault not available: ${vault || 'default'}`);
        const id = 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const timed = /[ T]\d{1,2}:\d{2}/.test(String(start));
        const evt = {
          id,
          kind: kind === 'reminder' ? 'reminder' : 'event',
          title: title || '(sin título)',
          start,
          end: end || null,
          allDay: typeof allDay === 'boolean' ? allDay : !timed,
          remindAt: remindAt || (kind === 'reminder' ? start : null) || null,
          noteId: noteId || null,
          recurrence: recurrence || null,
          createdAt: Date.now(),
        };
        // Campos del calendario v2 — sólo se escriben si llegan, así los
        // registros de clientes viejos no cambian de forma.
        if (location) evt.location = String(location);
        if (description) evt.description = String(description);
        if (color) evt.color = String(color);
        if (Number.isFinite(Number(reminderOffset)) && reminderOffset !== null && reminderOffset !== '') {
          evt.reminderOffset = Math.max(0, Math.round(Number(reminderOffset)));
          // Un recordatorio con antelación suena `reminderOffset` min antes.
          if (evt.kind === 'reminder' && !remindAt && timed) {
            const m = String(start).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
            if (m) {
              const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] - evt.reminderOffset);
              const p2 = (n) => String(n).padStart(2, '0');
              evt.remindAt = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
            }
          }
        }
        if (calendarId) evt.calendarId = String(calendarId);
        e.yEvents.set(id, evt);
        return { ok: true, event: evt };
      },
      async updateEvent({ id, patch, vault } = {}) {
        if (!id) throw new Error('updateEvent: `id` is required');
        const vid = resolveVaultId(vault || 'default');
        const e = await ensureVaultProvider(vid);
        if (!e || !e.yEvents) throw new Error(`vault not available: ${vault || 'default'}`);
        const cur = e.yEvents.get(id);
        if (!cur) throw new Error(`event not found: ${id}`);
        let p = patch || {};
        if (typeof p.recurrence === 'string') { try { p = { ...p, recurrence: JSON.parse(p.recurrence) }; } catch { p = { ...p, recurrence: null }; } }
        const next = { ...cur, ...p, id };
        // Recordatorio con antelación: remindAt sigue a start - reminderOffset.
        if (next.kind === 'reminder' && Number.isFinite(next.reminderOffset) && !('remindAt' in p)
          && ('start' in p || 'reminderOffset' in p)) {
          const m = String(next.start || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
          if (m) {
            const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] - next.reminderOffset);
            const p2 = (n) => String(n).padStart(2, '0');
            next.remindAt = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
          }
        }
        e.yEvents.set(id, next);
        return { ok: true, event: next };
      },
      async deleteEvent({ id, vault } = {}) {
        if (!id) throw new Error('deleteEvent: `id` is required');
        const vid = resolveVaultId(vault || 'default');
        const e = await ensureVaultProvider(vid);
        if (!e || !e.yEvents) throw new Error(`vault not available: ${vault || 'default'}`);
        const existed = e.yEvents.has(id);
        e.yEvents.delete(id);
        return { ok: true, deleted: existed, id };
      },
      // ── Structured canvas (co-edición · Fase 1) ──────────────────────
      // A canvas is "structured" once its per-note doc carries the migrated
      // flag (the app migrates on open). When structured, canvas tools must
      // mutate the Yjs types — NOT rewrite the fence text — or the app's
      // deterministic mirror would clobber the change. The legacy fence path
      // stays for un-migrated canvases.
      async isCanvasMigrated(id) {
        const loc = locateFile(id);
        if (!loc) return false;
        try {
          const e = await ensureNoteProvider(id, loc.vault.vaultId);
          return e && e.accessible ? canvasIsMigrated(e.ydoc) : false;
        } catch { return false; }
      },
      async canvasSnapshot(id) {
        const loc = locateFile(id);
        if (!loc) return { nodes: [], edges: [], groups: [], annotations: [] };
        try {
          const e = await ensureNoteProvider(id, loc.vault.vaultId);
          if (e && e.accessible) return canvasReadSnapshot(e.ydoc);
        } catch {}
        return { nodes: [], edges: [], groups: [], annotations: [] };
      },
      // Commit a desired canvas JSON. Structured path: apply granular ops to
      // the Yjs types, then regenerate the deterministic fence mirror into the
      // note body. Legacy path: rewrite the fence with the given JSON.
      async canvasCommit(id, next, { content, block }) {
        const loc = locateFile(id);
        if (!loc) throw new Error(`file not found: ${id}`);
        let e = null, migrated = false;
        try {
          e = await ensureNoteProvider(id, loc.vault.vaultId);
          migrated = e && e.accessible ? canvasIsMigrated(e.ydoc) : false;
        } catch {}
        const replaceFence = (orig, body) => {
          const lines = String(orig || '').split('\n');
          return [...lines.slice(0, block.startLine + 1), ...body.split('\n'), ...lines.slice(block.endLine)].join('\n');
        };
        if (migrated && e) {
          canvasApplySnapshot(e.ydoc, next);
          const before = await readContentLatest(id);
          await writeContentLatest(id, replaceFence(content, canvasSerialize(e.ydoc)));
          recordEdit({ noteId: id, kind: 'write', bytesBefore: before.length, bytesAfter: 0, snippetBefore: snippetOf(before), snippetAfter: 'canvas (structured)' });
          return { structured: true };
        }
        const before = await readContentLatest(id);
        const newSrc = replaceFence(content, JSON.stringify(next, null, 2));
        await writeContentLatest(id, newSrc);
        recordEdit({ noteId: id, kind: 'write', bytesBefore: before.length, bytesAfter: newSrc.length, snippetBefore: snippetOf(before), snippetAfter: snippetOf(newSrc) });
        return { structured: false };
      },
      async appendContent(id, body) {
        const before = await readContentLatest(id);
        await appendContentLatest(id, body);
        recordEdit({ noteId: id, kind: 'append', bytesBefore: before.length, bytesAfter: before.length + (body || '').length, appended: snippetOf(body || '') });
        // Auto-reveal: signal the renderer to switch to this note, scroll
        // to the newly-appended region, and pulse it so the user sees the
        // change without us having to chain focus + spotlight manually.
        try {
          const meta = yFiles.get(id);
          if (meta && body) {
            const trimmed = String(body).trim();
            const snippet = trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
            this.publishAiPointer({
              kind: 'reveal',
              noteId: id,
              noteName: meta.name,
              vaultId: meta.vaultId || 'default',
              fromCh: before.length,
              toCh: before.length + body.length,
              text: snippet,
              reason: 'append',
            });
          }
        } catch { /* non-fatal */ }
      },
      async createFile(name, vaultId = 'default', folderRef = null) {
        const id = genFileId();
        const finalName = /\.(md|markdown|txt)$/i.test(name) ? name : name + '.md';
        const resolvedVaultId = resolveVaultId(vaultId);
        const folderId = folderRef ? resolveFolderId(folderRef, resolvedVaultId) : null;
        const meta = { id, name: finalName, vaultId: resolvedVaultId, folderId };
        const v = await ensureVaultProvider(resolvedVaultId);
        if (!v.accessible) throw new Error(`vault '${resolvedVaultId}' not accessible: ${v.error || 'unknown'}`);
        v.ydoc.transact(() => { v.yFiles.set(id, meta); });
        recordEdit({ noteId: id, kind: 'create', name: finalName, vaultId: resolvedVaultId, folderId });
        return meta;
      },
      async deleteFile(id) {
        const loc = locateFile(id);
        if (!loc) return;
        const meta = loc.meta;
        const before = (await readContentLatest(id)) || '';
        // El documento propio de la nota NO se vacía: la nota va a la
        // papelera y debe poder restaurarse con su contenido.
        // Como en la app: la nota va a la papelera del vault (restaurable 30 días).
        loc.vault.ydoc.transact(() => {
          if (meta) loc.vault.ydoc.getMap('trash').set(id, { meta: { ...meta }, content: before, deletedAt: new Date().toISOString() });
          loc.vault.yFiles.delete(id);
          const t = loc.vault.ydoc.getText('content:' + id);
          if (t.length > 0) t.delete(0, t.length);
        });
        recordEdit({ noteId: id, kind: 'delete', name: meta && meta.name, bytesBefore: before.length });
      },
      // Papelera de cada bóveda (los borrados se pueden restaurar 30 días). Sin `vault`, todas.
      listTrash(vaultRef) {
        const only = vaultRef ? resolveVaultId(vaultRef) : null;
        const out = [];
        for (const v of vaultRegistry.values()) {
          if (!v.ydoc || (only && v.vaultId !== only)) continue;
          for (const [id, it] of v.ydoc.getMap('trash')) {
            if (!it || !it.meta) continue;
            out.push({ id, name: it.meta.name, vaultId: v.vaultId || 'default', vault: this.vaultName(v.vaultId), deletedAt: it.deletedAt || null, chars: String(it.content || '').length });
          }
        }
        return out.sort((x, y) => String(y.deletedAt || '').localeCompare(String(x.deletedAt || '')));
      },
      // Devuelve la nota de la papelera a su bóveda con su contenido. Si ya hay otra con ese nombre, la restaura
      // con «(restaurada)» detrás en vez de pisarla; si su carpeta ya no existe, va a la raíz de la bóveda.
      async restoreFromTrash(id) {
        for (const v of vaultRegistry.values()) {
          if (!v.ydoc) continue;
          const trash = v.ydoc.getMap('trash');
          const it = trash.get(id);
          if (!it || !it.meta) continue;
          const taken = new Set(Array.from(v.yFiles.values()).map(m => String(m && m.name || '').toLowerCase()));
          let name = it.meta.name || id + '.md';
          if (taken.has(name.toLowerCase())) name = name.replace(/(\.(md|markdown|txt))?$/i, ' (restaurada)$1');
          const folderOk = it.meta.folderId && v.yFolders && v.yFolders.get(it.meta.folderId);
          const meta = { ...it.meta, name, folderId: folderOk ? it.meta.folderId : null };
          v.ydoc.transact(() => { v.yFiles.set(id, meta); trash.delete(id); });
          await writeContentLatest(id, String(it.content || ''));
          recordEdit({ noteId: id, kind: 'restore', name });
          return { ...meta, vaultId: v.vaultId || 'default' };
        }
        return null;
      },
      renameFile(id, newName) {
        const loc = locateFile(id);
        if (!loc) return;
        const meta = loc.meta;
        if (/[\/\\]/.test(newName)) {
          throw new Error('rename_note only changes the filename — use move_note to put a note in a folder');
        }
        const finalName = /\.(md|markdown|txt)$/i.test(newName) ? newName : newName + '.md';
        loc.vault.ydoc.transact(() => { loc.vault.yFiles.set(id, { ...meta, name: finalName }); });
        recordEdit({ noteId: id, kind: 'rename', from: meta.name, to: finalName });
      },
      // ── Vault ops ────────────────────────────────────────────────────────
      listVaults() {
        // 'default' isn't in yVaults until materialized; surface it if any
        // file references it (matching the Electron app's UI behavior).
        const counts = new Map();
        for (const f of yFiles.values()) {
          const vid = f.vaultId || 'default';
          counts.set(vid, (counts.get(vid) || 0) + 1);
        }
        const out = [];
        const seen = new Set();
        for (const [id, v] of yVaults.entries()) {
          out.push({ id, name: (v && v.name) || id, noteCount: counts.get(id) || 0 });
          seen.add(id);
        }
        // Synthesize 'default' so callers always see it.
        if (!seen.has('default')) {
          out.push({ id: 'default', name: 'Default', noteCount: counts.get('default') || 0 });
        }
        return out;
      },
      async createVault(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) throw new Error('vault name is empty');
        if (findVaultByName(trimmed)) throw new Error(`vault already exists: ${trimmed}`);
        const id = genVaultId();
        ydoc.transact(() => { yVaults.set(id, { id, name: trimmed }); });
        // Open a provider for the new vault so subsequent file ops
        // resolve. Server creates the doc row on first connect.
        await ensureVaultProvider(id);
        return { id, name: trimmed };
      },
      renameVault(currentName, newName) {
        const v = findVaultByName(currentName);
        if (!v) throw new Error(`vault not found: ${currentName}`);
        if (v.id === 'default') throw new Error("cannot rename the 'default' vault");
        const trimmed = String(newName || '').trim();
        if (!trimmed) throw new Error('new vault name is empty');
        const clash = findVaultByName(trimmed);
        if (clash && clash.id !== v.id) throw new Error(`vault already exists: ${trimmed}`);
        // Conserva color, icono y demás campos del vault: sólo cambia el nombre.
        const prev = yVaults.get(v.id);
        ydoc.transact(() => { yVaults.set(v.id, { ...(prev && typeof prev === 'object' ? prev : {}), id: v.id, name: trimmed }); });
        return { id: v.id, name: trimmed };
      },
      deleteVault(name) {
        const v = findVaultByName(name);
        if (!v) throw new Error(`vault not found: ${name}`);
        if (v.id === 'default') throw new Error("cannot delete the 'default' vault");
        let moved = 0;
        // Move every file in this vault to default, and unparent folders.
        const fromEntry = vaultEntryFor(v.id);
        const toEntry   = vaultEntryFor('default');
        if (fromEntry && toEntry) {
          for (const [fid, meta] of Array.from(fromEntry.yFiles.entries())) {
            const body = fromEntry.ydoc.getText('content:' + fid).toString();
            fromEntry.ydoc.transact(() => {
              fromEntry.yFiles.delete(fid);
              const t = fromEntry.ydoc.getText('content:' + fid);
              if (t.length > 0) t.delete(0, t.length);
            });
            toEntry.ydoc.transact(() => {
              toEntry.yFiles.set(fid, { ...meta, vaultId: 'default', folderId: null });
              if (body) toEntry.ydoc.getText('content:' + fid).insert(0, body);
            });
            moved++;
          }
          // Drop folders that lived in this vault — folder ids are
          // vault-scoped so they don't transfer cleanly.
          for (const fid of Array.from(fromEntry.yFolders.keys())) {
            fromEntry.yFolders.delete(fid);
          }
        }
        ydoc.transact(() => { yVaults.delete(v.id); });
        return { id: v.id, name: v.name, movedFiles: moved };
      },
      // ── Note ops (extras) ────────────────────────────────────────────────
      // Move a note to a different vault and/or folder. `vaultRef` is optional
      // (defaults to the note's current vault). `folderRef` is also optional —
      // when undefined, vault changes clear `folderId` (since the old folder
      // lives in the old vault); when explicitly null or "" the note moves to
      // the vault root; when set, resolves to a folder inside the target vault.
      async moveFile(id, vaultRef, folderRef) {
        const loc = locateFile(id);
        if (!loc) throw new Error(`file not found: ${id}`);
        const meta = loc.meta;
        const resolvedVault = vaultRef ? resolveVaultId(vaultRef) : (meta.vaultId || 'default');
        let folderId;
        if (folderRef === undefined) {
          // Caller didn't specify — keep folder when vault is unchanged,
          // otherwise clear it (the old folderId belongs to the old vault).
          folderId = resolvedVault === (meta.vaultId || 'default') ? (meta.folderId || null) : null;
        } else if (folderRef === null || folderRef === '') {
          folderId = null;
        } else {
          folderId = resolveFolderId(folderRef, resolvedVault);
        }
        const next = { ...meta, vaultId: resolvedVault, folderId };
        if (resolvedVault === (meta.vaultId || 'default')) {
          // In-place — same vault doc handles the metadata update.
          loc.vault.ydoc.transact(() => { loc.vault.yFiles.set(id, next); });
        } else {
          // Cross-vault move — yFiles proxy handles fan-out + content
          // transfer between vault docs. Ensure target vault is up.
          await ensureVaultProvider(resolvedVault);
          yFiles.set(id, next);
        }
        return next;
      },
      // listFolders(vaultRef) keeps the original signature. To filter by
      // parent folder pass `{ vault, parent }` instead: parent may be a
      // folder id, name, or "Parent/Child" path; "" or null restricts to
      // root-level folders inside the vault.
      listFolders(arg) {
        let vaultRef = null;
        let parentRef;
        if (arg && typeof arg === 'object') {
          vaultRef = arg.vault || null;
          parentRef = arg.parent;
        } else {
          vaultRef = arg || null;
        }
        const filterVaultId = vaultRef ? resolveVaultId(vaultRef) : null;
        let parentFilterId;
        if (parentRef !== undefined) {
          if (parentRef === null || parentRef === '') parentFilterId = null;
          else if (filterVaultId) parentFilterId = resolveFolderId(parentRef, filterVaultId);
          else parentFilterId = '__nomatch__'; // can't resolve parent without a vault context
        }
        const out = [];
        for (const f of yFolders.values()) {
          if (filterVaultId && (f.vaultId || null) !== filterVaultId) continue;
          if (parentFilterId !== undefined && (f.parentId || null) !== parentFilterId) continue;
          out.push({
            id: f.id,
            name: f.name,
            vaultId: f.vaultId || null,
            vault: f.vaultId ? this.vaultName(f.vaultId) : null,
            parentId: f.parentId || null,
            path: folderPath(f.id),
          });
        }
        return out;
      },
      findFolder(ref, vaultRef) {
        const vid = vaultRef ? resolveVaultId(vaultRef) : null;
        if (!vid) return null;
        const f = resolveFolder(ref, vid);
        return f ? { ...f, path: folderPath(f.id) } : null;
      },
      async createFolder(name, vaultRef = 'default', parentRef = null) {
        if (!name || typeof name !== 'string') throw new Error('folder name required');
        if (/[\/\\]/.test(name)) throw new Error('folder name cannot contain "/" — use parent to nest');
        const vaultId = resolveVaultId(vaultRef);
        const parentId = parentRef ? resolveFolderId(parentRef, vaultId) : null;
        // Reject duplicate sibling name so callers (LLMs especially) don't
        // create twins they then can't distinguish.
        for (const f of yFolders.values()) {
          if ((f.vaultId || null) !== vaultId) continue;
          if ((f.parentId || null) !== parentId) continue;
          if ((f.name || '').toLowerCase() === name.toLowerCase()) {
            throw new Error(`folder already exists: ${name}`);
          }
        }
        const id = genFolderId();
        const meta = { id, name, vaultId, parentId, icon: '📁' };
        const v = await ensureVaultProvider(vaultId);
        if (!v.accessible) throw new Error(`vault '${vaultId}' not accessible: ${v.error || 'unknown'}`);
        v.ydoc.transact(() => { v.yFolders.set(id, meta); });
        return { ...meta, path: folderPath(id) };
      },
      renameFolder(ref, newName, vaultRef) {
        if (/[\/\\]/.test(newName)) throw new Error('folder name cannot contain "/"');
        const vaultId = vaultRef ? resolveVaultId(vaultRef) : null;
        const direct = vaultId ? resolveFolder(ref, vaultId) : null;
        const folderId = direct ? direct.id : ref;
        const loc = locateFolder(folderId);
        if (!loc) throw new Error(`folder not found: ${ref}`);
        const f = loc.folder;
        loc.vault.ydoc.transact(() => { loc.vault.yFolders.set(f.id, { ...f, name: newName }); });
        return { ...f, name: newName, path: folderPath(f.id) };
      },
      // Cascade-delete: removes the folder, every descendant folder, and
      // every note that lived in any of those folders. Mirrors the editor's
      // delete-folder behavior so the MCP path doesn't leave dangling rows.
      deleteFolder(ref, vaultRef) {
        const vaultId = vaultRef ? resolveVaultId(vaultRef) : null;
        const direct = vaultId ? resolveFolder(ref, vaultId) : null;
        const folderId = direct ? direct.id : ref;
        const rootLoc = locateFolder(folderId);
        if (!rootLoc) throw new Error(`folder not found: ${ref}`);
        const targetVault = rootLoc.vault;
        const toDelete = new Set([rootLoc.folder.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const f of targetVault.yFolders.values()) {
            if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
              toDelete.add(f.id); grew = true;
            }
          }
        }
        let filesRemoved = 0;
        targetVault.ydoc.transact(() => {
          for (const fid of toDelete) targetVault.yFolders.delete(fid);
          for (const file of Array.from(targetVault.yFiles.values())) {
            if (file.folderId && toDelete.has(file.folderId)) {
              targetVault.yFiles.delete(file.id);
              const t = targetVault.ydoc.getText('content:' + file.id);
              if (t.length > 0) t.delete(0, t.length);
              filesRemoved++;
            }
          }
        });
        // Clear any per-note doc bodies in our session cache for the
        // removed notes so future read attempts don't resurrect them.
        for (const [nid, ne] of noteRegistry.entries()) {
          if (ne.vaultId === targetVault.vaultId && ne.ytext && ne.ytext.length > 0) {
            const file = targetVault.yFiles.get(nid);
            if (!file) ne.ydoc.transact(() => ne.ytext.delete(0, ne.ytext.length));
          }
        }
        return { foldersRemoved: toDelete.size, filesRemoved };
      },
      moveFolder(ref, newParentRef, vaultRef) {
        const vaultId = vaultRef ? resolveVaultId(vaultRef) : null;
        const direct = vaultId ? resolveFolder(ref, vaultId) : null;
        const folderId = direct ? direct.id : ref;
        const loc = locateFolder(folderId);
        if (!loc) throw new Error(`folder not found: ${ref}`);
        const f = loc.folder;
        const targetVault = vaultId || f.vaultId;
        // Folders only move WITHIN the same vault doc — they don't
        // cross vault boundaries because folder ids are vault-scoped
        // (resolveFolder walks loc.vault.yFolders). Reject vaultRef
        // pointing somewhere else.
        if (targetVault !== loc.vault.vaultId) {
          throw new Error('move_folder cannot cross vaults — move notes individually instead');
        }
        let newParentId = null;
        if (newParentRef !== null && newParentRef !== '' && newParentRef !== undefined) {
          const p = resolveFolder(newParentRef, targetVault);
          if (!p) throw new Error(`parent folder not found: ${newParentRef}`);
          if (p.id === f.id) throw new Error('cannot move folder into itself');
          let cur = p;
          while (cur) {
            if (cur.parentId === f.id) throw new Error('cannot move folder into its own descendant');
            cur = cur.parentId ? loc.vault.yFolders.get(cur.parentId) : null;
          }
          newParentId = p.id;
        }
        loc.vault.ydoc.transact(() => {
          loc.vault.yFolders.set(f.id, { ...f, parentId: newParentId, vaultId: targetVault });
        });
        return { ...f, parentId: newParentId, vaultId: targetVault, path: folderPath(f.id) };
      },
      async fileInfo(id) {
        const meta = yFiles.get(id);
        if (!meta) return null;
        const text = await readContentLatest(id);
        const preview = text.length > 200 ? text.slice(0, 200) + '…' : text;
        return {
          id: meta.id,
          name: meta.name,
          vaultId: meta.vaultId || 'default',
          vault: this.vaultName(meta.vaultId || 'default'),
          size: text.length,
          preview,
        };
      },
      // Broadcast a structured description of what the MCP just did via
      // the Yjs awareness channel so connected app instances can pop a
      // toast ("AI wrote 'X' to Personal"). awareness is ephemeral — it
      // doesn't persist to the doc — and replaces on each set, so the
      // renderer should treat each `mcpAction` it observes as a one-shot
      // event keyed by `id` (we generate one per call to dedupe replays).
      publishMcpAction(action) {
        try {
          const ident = cfg && cfg.__agentIdentity;
          provider.awareness.setLocalStateField('mcpAction', {
            ...action,
            // Who ran it, so the renderer chip can show "Claude · Creó …".
            agent: ident ? { alias: ident.alias, kind: ident.kind, device: ident.device } : undefined,
            id: 'mcp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            at: Date.now(),
          });
        } catch { /* awareness errors are non-fatal — the data write already succeeded */ }
      },
      // Same channel idea as publishMcpAction but for pointer-style requests
      // ("look at this note", "look at this passage"). The renderer reacts:
      // calls windowFocus IPC, dispatches a CM selection on (fromCh,toCh)
      // when present, and pops a toast carrying `message` verbatim so the
      // AI can speak to the user about a specific passage.
      publishAiPointer(pointer) {
        try {
          provider.awareness.setLocalStateField('aiPointer', {
            ...pointer,
            id: 'ptr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            at: Date.now(),
          });
        } catch { /* same rationale — non-fatal */ }
      },
      // Explicit "I'm doing X right now" pings from the MCP session — used
      // by the presence_pulse tool so the AI can show progress on long
      // multi-step actions ("thinking…", "searching across vault…",
      // "summarising 14 notes…"). Renderer aggregates these alongside
      // mcpAction events into a single animated AI-peer chip.
      publishAiPresence(presence) {
        try {
          const ident = cfg && cfg.__agentIdentity;
          provider.awareness.setLocalStateField('aiPresence', {
            ...presence,
            agent: ident ? { alias: ident.alias, kind: ident.kind, device: ident.device } : undefined,
            id: 'prs-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            at: Date.now(),
          });
        } catch { /* non-fatal */ }
      },
      publishAiAgentPresence(agent) {
        try {
          provider.awareness.setLocalStateField('aiAgent', {
            ...agent,
            at: Date.now(),
          });
        } catch { /* non-fatal */ }
      },
      listAiAgents() {
        return listOnlineAiAgentsSnapshot();
      },
      listAgentTasks({ alias, kind, status } = {}) {
        const tasks = readAgentTasks(ydoc);
        const a = alias ? normalizeAgentAlias(alias) : null;
        const k = kind ? normalizeAgentAlias(kind) : null;
        const statuses = Array.isArray(status) ? status.map(s => String(s)) : (status ? [String(status)] : null);
        return tasks.filter(t => {
          if (a) {
            // An agent sees tasks addressed to its exact alias, plus canonical
            // tasks for its kind (so @Claude tasks surface to claude-<device>).
            const matchesAlias = normalizeAgentAlias(t.targetAlias) === a;
            const matchesCanonical = !!t.canonical && k
              && normalizeAgentAlias(t.targetKind || t.targetAlias) === k;
            if (!matchesAlias && !matchesCanonical) return false;
          }
          if (statuses && !statuses.includes(String(t.status || 'pending'))) return false;
          return true;
        });
      },
      getAgentPolicy(vaultId) {
        const all = (yMeta.get('agentPolicy') && typeof yMeta.get('agentPolicy') === 'object') ? yMeta.get('agentPolicy') : {};
        return vaultId ? (all[vaultId] || null) : all;
      },
      setAgentPolicy(vaultId, patch) {
        if (!vaultId) throw new Error('vaultId required');
        const all = (yMeta.get('agentPolicy') && typeof yMeta.get('agentPolicy') === 'object') ? { ...yMeta.get('agentPolicy') } : {};
        if (patch && patch.clear === true) { delete all[vaultId]; yMeta.set('agentPolicy', all); return null; }
        const cur = (all[vaultId] && typeof all[vaultId] === 'object') ? all[vaultId] : {};
        const next = { ...cur };
        for (const k of ['allowKinds', 'denyKinds', 'allowAliases', 'denyAliases']) {
          if (Array.isArray(patch && patch[k])) {
            next[k] = patch[k].map(v => String(v || '').toLowerCase().replace(/^@+/, '')).filter(Boolean).slice(0, 50);
          }
        }
        all[vaultId] = next;
        yMeta.set('agentPolicy', all);
        return next;
      },
      isAgentAllowedInVault(vaultId, who) { return isAgentAllowedInVault(vaultId, who || {}); },
      claimAgentTask(id, agent) {
        const tasks = readAgentTasks(ydoc);
        const idx = tasks.findIndex(t => t.id === id);
        if (idx < 0) throw new Error(`agent task not found: ${id}`);
        const cur = tasks[idx];
        assertAgentCanHandleTask(cur, agent, 'claim');
        // Fase 3 gate — the real boundary: even if a task exists, an agent the
        // vault disallows cannot claim/run it.
        if (!isAgentAllowedInVault(cur.vaultId, { kind: agent && agent.kind, alias: agent && agent.alias })) {
          throw new Error(`agent @${(agent && agent.alias) || '?'} is not allowed to act in vault ${cur.vaultId}`);
        }
        if (cur.status === 'done' || cur.status === 'failed') throw new Error(`agent task already ${cur.status}: ${id}`);
        const now = new Date().toISOString();
        const nextTask = {
          ...cur,
          status: 'running',
          claimedAt: cur.claimedAt || now,
          runningAt: now,
          claimedBy: agent || null,
          history: [...(Array.isArray(cur.history) ? cur.history : []), { status: 'running', ts: now, agent: agent || null }],
        };
        putAgentTasks(ydoc, [nextTask]);
        return nextTask;
      },
      completeAgentTask(id, { response, status = 'done', error, agent, autoReply = true } = {}) {
        const tasks = readAgentTasks(ydoc);
        const idx = tasks.findIndex(t => t.id === id);
        if (idx < 0) throw new Error(`agent task not found: ${id}`);
        const cur = tasks[idx];
        assertAgentCanHandleTask(cur, agent || cur.claimedBy, 'complete');
        const now = new Date().toISOString();
        const finalStatus = status === 'failed' ? 'failed' : 'done';
        const nextTask = {
          ...cur,
          status: finalStatus,
          completedAt: now,
          response: response || null,
          error: error || null,
          completedBy: agent || cur.claimedBy || null,
          history: [...(Array.isArray(cur.history) ? cur.history : []), { status: finalStatus, ts: now, agent: agent || cur.claimedBy || null, error: error || null }],
        };
        putAgentTasks(ydoc, [nextTask]);
        // Auto-post the response as a thread reply unless the agent opted to
        // reply on its own terms (autoReply:false) — e.g. it wants to format the
        // answer, attach files, or split it across several replies.
        if (autoReply && finalStatus === 'done' && response && cur.noteId && cur.commentId) {
          try {
            this.addAnchoredComment({
              noteId: cur.noteId,
              parentId: cur.commentId,
              text: response,
              author: agent && agent.alias ? agent.alias : cur.targetAlias || 'ai',
              skipAgentTasks: true,
            });
          } catch {}
        }
        return nextTask;
      },
      // Read awareness to detect whether the user's app is open right now.
      // We count peers (not us) that have published a `user` field — which
      // the renderer does on connect (see store.js's connectSync setting
      // user.email/color). Returns counts + a thin preview the LLM can
      // log without exposing tokens or other awareness internals.
      // Snapshot of "what the user is currently looking at" so the AI can
      // be context-aware before suggesting actions. Pulls activeId +
      // activeVault from yMeta and resolves them to friendly names.
      async getActiveContext() {
        try {
          const activeId = yMeta.get('activeId');
          const activeVaultId = yMeta.get('activeVault');
          let activeNote = null;
          if (activeId) {
            const meta = yFiles.get(activeId);
            if (meta) {
              activeNote = {
                id: meta.id,
                name: meta.name,
                vaultId: meta.vaultId || 'default',
                vault: this.vaultName(meta.vaultId),
                folderId: meta.folderId || null,
                // Resolved breadcrumb ("Projects/Edinot/Diarios") so the
                // AI can pass it back as `folder` on create_note/write_note
                // without having to walk yFolders itself.
                folderPath: meta.folderId ? folderPath(meta.folderId) : null,
              };
              try {
                const body = await readContentLatest(meta.id);
                activeNote.isCanvas = /^[ \t]*```edinot-canvas[ \t]*$/m.test(body);
              } catch { activeNote.isCanvas = false; }
            }
          }
          return {
            activeNote,
            activeVaultId: activeVaultId || 'default',
            activeVault: activeVaultId ? this.vaultName(activeVaultId) : 'Default',
            appOpen: this.isAppOpen().open,
            pendingReplies: this.getPendingUserReplies(),
            pendingAgentTasks: this.listAgentTasks({ status: ['pending', 'pending-offline', 'running'] }),
          };
        } catch (err) {
          return { activeNote: null, activeVaultId: null, activeVault: null, appOpen: false, error: String(err && err.message || err) };
        }
      },
      // Per-file open stats persisted by the editor (yMeta key `fileStats`)
      // so the AI can rank "recently opened" without searching the whole
      // vault. Returns top-N by composite score (count + recency).
      getRecentNotes(limit) {
        try {
          const raw = yMeta.get('fileStats');
          if (!raw || typeof raw !== 'object') return [];
          const now = Date.now();
          const RECENCY_MS = 30 * 24 * 60 * 60 * 1000;
          const entries = Object.entries(raw)
            .map(([id, st]) => {
              const meta = yFiles.get(id);
              if (!meta) return null;
              const rec = st && st.t ? Math.max(0, 1 - (now - st.t) / RECENCY_MS) : 0;
              const score = (Math.log((st && st.c) || 1) * 4) + rec * 3;
              return {
                id, name: meta.name,
                vaultId: meta.vaultId || 'default',
                vault: this.vaultName(meta.vaultId),
                openCount: (st && st.c) || 0,
                lastOpenedAt: (st && st.t) ? new Date(st.t).toISOString() : null,
                score: Math.round(score * 100) / 100,
              };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
          return entries;
        } catch (err) {
          return [];
        }
      },
      // Current editor selection. The renderer (App.jsx) writes
      // `{fileId, from, to}` into yMeta on every CodeMirror selection
      // change, so we can read it back without decoding Y.RelativePosition.
      // Returns `{ text, fromCh, toCh, noteName, noteId }` or null.
      async getEditorSelection() {
        try {
          const sel = yMeta.get('editorSelection');
          if (!sel || !sel.fileId) return null;
          const meta = yFiles.get(sel.fileId);
          if (!meta) return null;
          const body = await readContentLatest(sel.fileId);
          // CodeMirror path — exact source offsets.
          if (sel.from != null && sel.to != null && sel.from !== sel.to) {
            return {
              text: body.slice(sel.from, sel.to),
              fromCh: sel.from,
              toCh: sel.to,
              noteId: sel.fileId,
              noteName: meta.name,
              vaultId: meta.vaultId || 'default',
              vault: this.vaultName(meta.vaultId),
              source: sel.source || 'editor',
            };
          }
          // Render-mode fallback — text was captured from the HTML side and
          // offsets may be approximate or missing. Still useful for tools
          // like summarize/translate/explain that just need the substring.
          if (sel.text && typeof sel.text === 'string') {
            return {
              text: sel.text,
              fromCh: sel.from != null ? sel.from : null,
              toCh: sel.to != null ? sel.to : null,
              noteId: sel.fileId,
              noteName: meta.name,
              vaultId: meta.vaultId || 'default',
              vault: this.vaultName(meta.vaultId),
              source: sel.source || 'render',
            };
          }
          return null;
        } catch { return null; }
      },
      // Currently selected canvas node(s). The CanvasView writes its
      // local selection to yMeta on change. Returns `{ noteName, nodeIds, nodes }`
      // or null. `nodes` is the resolved node objects from the canvas JSON.
      async getCanvasSelection() {
        try {
          const sel = yMeta.get('canvasSelection');
          if (!sel || !Array.isArray(sel.nodeIds) || !sel.nodeIds.length) return null;
          const meta = yFiles.get(sel.noteId);
          if (!meta) return null;
          const body = await readContentLatest(sel.noteId);
          // Locate the first edinot-canvas block, parse it, project the
          // selected node ids back to the actual node payloads.
          const lines = body.split('\n');
          let json = null;
          for (let i = 0; i < lines.length; i++) {
            if (!/^[ \t]*```edinot-canvas[ \t]*$/.test(lines[i])) continue;
            const buf = [];
            let end = -1;
            for (let j = i + 1; j < lines.length; j++) {
              if (/^[ \t]*```\s*$/.test(lines[j])) { end = j; break; }
              buf.push(lines[j]);
            }
            if (end < 0) break;
            try { json = JSON.parse(buf.join('\n').trim()); } catch { json = null; }
            break;
          }
          const allNodes = (json && Array.isArray(json.nodes)) ? json.nodes : [];
          const resolved = sel.nodeIds.map(id => allNodes.find(n => n.id === id)).filter(Boolean);
          return {
            noteId: sel.noteId,
            noteName: meta.name,
            vaultId: meta.vaultId || 'default',
            vault: this.vaultName(meta.vaultId),
            nodeIds: sel.nodeIds,
            nodes: resolved,
          };
        } catch { return null; }
      },
      // Long-poll for a selection change. Captures the current selection
      // signature, then resolves the first time yMeta.editorSelection or
      // yMeta.canvasSelection changes (or returns { changed: false } on
      // timeout). `surface`: 'editor' | 'canvas' | 'any'. Use this to
      // build reactive tools — "watch the user, react when they pick
      // something". The await is bounded by `timeoutMs` (default 25s,
      // max 60s) so the MCP request doesn't hang the client.
      waitForSelectionChange({ timeoutMs = 25000, surface = 'any' } = {}) {
        const sigOf = () => {
          const e = yMeta.get('editorSelection');
          const c = yMeta.get('canvasSelection');
          const epart = e ? `${e.fileId || ''}:${e.from || 0}-${e.to || 0}:${(e.text || '').slice(0,40)}` : '∅';
          const cpart = c ? `${c.noteId || ''}:${(c.nodeIds || []).join(',')}` : '∅';
          if (surface === 'editor') return `E:${epart}`;
          if (surface === 'canvas') return `C:${cpart}`;
          return `E:${epart}|C:${cpart}`;
        };
        const baseline = sigOf();
        const bounded = Math.max(1000, Math.min(60000, Number(timeoutMs) || 25000));
        return new Promise((resolve) => {
          let done = false;
          const finish = (payload) => {
            if (done) return;
            done = true;
            yMeta.unobserve(onChange);
            clearTimeout(timer);
            resolve(payload);
          };
          const onChange = async () => {
            if (sigOf() === baseline) return;
            const editor = (surface === 'canvas') ? null : await this.getEditorSelection();
            const canvas = (surface === 'editor') ? null : await this.getCanvasSelection();
            finish({ changed: true, editor, canvas });
          };
          yMeta.observe(onChange);
          const timer = setTimeout(() => finish({ changed: false, reason: 'timeout' }), bounded);
        });
      },
      // Pinned context — persisted to yMeta key 'pinnedContext' as an array
      // of { id, text, label, noteId, source, addedAt }. Survives across
      // restarts (it's in the shared Y.Doc), syncs to other peers.
      pinContext(entry) {
        const list = Array.isArray(yMeta.get('pinnedContext')) ? yMeta.get('pinnedContext') : [];
        const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const rec = {
          id,
          text: String(entry.text || '').slice(0, 4000),
          label: entry.label || null,
          noteId: entry.noteId || null,
          source: entry.source || 'manual',
          addedAt: new Date().toISOString(),
        };
        yMeta.set('pinnedContext', [...list, rec]);
        return rec;
      },
      unpinContext(id) {
        const list = Array.isArray(yMeta.get('pinnedContext')) ? yMeta.get('pinnedContext') : [];
        const next = list.filter(p => p.id !== id);
        yMeta.set('pinnedContext', next);
        return { removed: list.length - next.length, remaining: next.length };
      },
      listPinnedContext() {
        return Array.isArray(yMeta.get('pinnedContext')) ? yMeta.get('pinnedContext') : [];
      },
      clearPinnedContext() {
        const list = Array.isArray(yMeta.get('pinnedContext')) ? yMeta.get('pinnedContext') : [];
        yMeta.set('pinnedContext', []);
        return { cleared: list.length };
      },
      // ── Anchored AI comments ────────────────────────────────────────
      // Comments live in the per-record v2 maps (shared/comments-model.js),
      // read merged with the legacy yMeta.noteComments object older apps
      // still write. They are a non-destructive layer — never edit the
      // markdown body.
      addAnchoredComment({ noteId, text, anchorText, author, kind, parentId, mentions, skipAgentTasks }) {
        const meta = yFiles.get(noteId);
        if (!meta) throw new Error(`note not found: ${noteId}`);
        const list = readNoteComments(ydoc, noteId);
        const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const k = kind === 'question' ? 'question' : 'note';
        // parentId — when set, this comment is a threaded reply to
        // another comment in the same note. Validate it points at an
        // existing comment to avoid orphan trees.
        let parent = null;
        if (parentId) {
          parent = list.find(c => c.id === parentId);
          if (!parent) throw new Error(`parentId not found in this note: ${parentId}`);
        }
        const rec = {
          id,
          noteId,
          kind: k,
          parentId: parentId || null,
          text: String(text || '').slice(0, 4000),
          anchorText: anchorText ? String(anchorText).slice(0, 600) : null,
          author: author || 'ai',
          ts: new Date().toISOString(),
          resolved: false,
          replies: [],
          awaitingReply: k === 'question' && !parentId,
          mentions: Array.isArray(mentions) ? mentions.slice(0, 20) : extractMentionsFromText(text),
        };
        putComment(ydoc, rec);
        if (!skipAgentTasks) {
          try { enqueueAgentTasksForComment(rec, meta, rec.text, author || cfg.email || 'ai'); } catch {}
        }
        return rec;
      },
      // Append a reply to a (question) comment. Both AI and user can call
      // this — the renderer wires its reply input to the same path so the
      // MCP-side `wait_for_inline_reply` resolves naturally.
      // Scan all anchored question comments and surface the ones where
      // the latest activity is a user reply — i.e. the AI asked, the
      // user answered, and we never acted on it. Returns enriched
      // entries with the question + the latest reply + the noteName so
      // the AI can decide what to do without an extra fetch. The IA is
      // expected to either reply back via addInlineReply OR resolve /
      // delete the comment after acting; either removes it from this
      // list on the next call.
      getPendingUserReplies() {
        const map = readCommentsMap(ydoc);
        const out = [];
        for (const nid of Object.keys(map)) {
          const list = map[nid] || [];
          for (const c of list) {
            if (c.resolved) continue;
            if (c.kind !== 'question') continue;
            const replies = Array.isArray(c.replies) ? c.replies : [];
            if (!replies.length) continue;
            const last = replies[replies.length - 1];
            if (!last || last.author === 'ai' || last.author === 'claude') continue;
            const meta = yFiles.get(nid);
            out.push({
              commentId: c.id,
              noteId: nid,
              noteName: meta ? meta.name : null,
              vaultId: meta ? (meta.vaultId || 'default') : null,
              vault: meta ? this.vaultName(meta.vaultId) : null,
              question: c.text,
              anchorText: c.anchorText || null,
              latestReply: {
                text: last.text,
                author: last.author,
                ts: last.ts,
              },
              replyCount: replies.length,
              askedAt: c.ts,
            });
          }
        }
        return out;
      },
      // ── Ambient / proactive mode (Fase 2) ───────────────────────────────
      // Per-workspace config. `enabled` gates whether agents should act on
      // proactive signals at all; the *_Mins fields are the staleness
      // thresholds. Detection (getProactiveSignals) is always safe to call;
      // only acting on it is gated by `enabled`.
      getAmbientConfig() {
        const raw = yMeta.get('ambientConfig');
        const d = { enabled: false, staleQuestionMins: 180, stalledRunningMins: 30, unclaimedTaskMins: 60 };
        return (raw && typeof raw === 'object') ? { ...d, ...raw } : d;
      },
      setAmbientConfig(patch) {
        const cur = this.getAmbientConfig();
        const next = { ...cur };
        if (patch && typeof patch === 'object') {
          if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
          for (const k of ['staleQuestionMins', 'stalledRunningMins', 'unclaimedTaskMins']) {
            if (Number.isFinite(patch[k]) && patch[k] >= 0) next[k] = Math.floor(patch[k]);
          }
        }
        yMeta.set('ambientConfig', next);
        return next;
      },
      // Detect items that have gone quiet and likely need attention:
      // unresolved questions with no AI answer, agent tasks stuck running,
      // and tasks nobody claimed. Pure read — never mutates. The proactive
      // loop (or an agent during idle) decides what to do with these.
      getProactiveSignals({ now } = {}) {
        const cfg2 = this.getAmbientConfig();
        const tNow = Number.isFinite(now) ? now : Date.now();
        const ageMins = (iso) => {
          const t = Date.parse(iso || '');
          return Number.isFinite(t) ? Math.floor((tNow - t) / 60000) : null;
        };
        const out = [];
        // 1) Unanswered questions: unresolved `question` comments whose latest
        //    activity is not an AI reply and which are older than the threshold.
        const map = readCommentsMap(ydoc);
        for (const nid of Object.keys(map)) {
          const list = Array.isArray(map[nid]) ? map[nid] : [];
          for (const c of list) {
            if (!c || c.resolved || c.kind !== 'question' || c.parentId) continue;
            const replies = Array.isArray(c.replies) ? c.replies : [];
            const last = replies[replies.length - 1] || null;
            const lastAuthor = String((last && last.author) || '').toLowerCase();
            const answeredByAi = last && (lastAuthor === 'ai' || lastAuthor.startsWith('claude') || lastAuthor.startsWith('codex') || lastAuthor.startsWith('cursor'));
            if (answeredByAi) continue;
            const age = ageMins((last && last.ts) || c.ts);
            if (age == null || age < cfg2.staleQuestionMins) continue;
            const meta = yFiles.get(nid);
            out.push({
              type: 'unanswered-question',
              severity: 'medium',
              noteId: nid,
              noteName: meta ? meta.name : null,
              commentId: c.id,
              ageMins: age,
              summary: snippetOf(c.text, 140),
              suggestedAction: 'reply_to_comment or resolve_comment',
            });
          }
        }
        // 2) Stalled / unclaimed agent tasks.
        const tasks = readAgentTasks(ydoc);
        for (const t of tasks) {
          if (!t) continue;
          const st = String(t.status || 'pending');
          if (st === 'running') {
            const age = ageMins(t.runningAt || t.claimedAt || t.requestedAt);
            if (age != null && age >= cfg2.stalledRunningMins) {
              out.push({
                type: 'stalled-running-task', severity: 'high', taskId: t.id,
                targetAlias: t.targetAlias, canonical: !!t.canonical, noteId: t.noteId,
                noteName: t.noteName || null, ageMins: age, summary: snippetOf(t.prompt, 140),
                suggestedAction: 'complete_agent_task (done/failed) or re-claim',
              });
            }
          } else if (st === 'pending' || st === 'pending-offline') {
            const age = ageMins(t.requestedAt);
            if (age != null && age >= cfg2.unclaimedTaskMins) {
              out.push({
                type: 'unclaimed-task', severity: st === 'pending' ? 'medium' : 'low', taskId: t.id,
                targetAlias: t.targetAlias, canonical: !!t.canonical, noteId: t.noteId,
                noteName: t.noteName || null, ageMins: age, summary: snippetOf(t.prompt, 140),
                suggestedAction: 'claim_agent_task then handle',
              });
            }
          }
        }
        out.sort((a, b) => (b.ageMins || 0) - (a.ageMins || 0));
        return { enabled: cfg2.enabled, config: cfg2, signals: out };
      },
      addInlineReply(commentId, text, author) {
        const found = addCommentReply(ydoc, commentId, {
          text: String(text || '').slice(0, 4000),
          author: author || 'user',
        });
        if (!found) throw new Error(`comment not found: ${commentId}`);
        return found;
      },
      // Long-poll for the next reply on a question comment. Resolves with
      // the new reply on change, or { reply: null, reason: 'timeout' }.
      waitForInlineReply(commentId, timeoutMs = 60000) {
        const findComment = () => commentsFind(ydoc, commentId);
        const ct = commentTypes(ydoc);
        const baseline = findComment();
        if (!baseline) throw new Error(`comment not found: ${commentId}`);
        const baseLen = (baseline.replies || []).length;
        // If a reply already arrived between the previous call and now,
        // return it immediately.
        if (baseLen > 0 && baseline.awaitingReply === false) {
          return Promise.resolve({ reply: baseline.replies[baseLen - 1], comment: baseline });
        }
        const bounded = Math.max(1000, Math.min(120000, Number(timeoutMs) || 60000));
        return new Promise((resolve) => {
          let done = false;
          const finish = (payload) => {
            if (done) return;
            done = true;
            yMeta.unobserve(onChange);
            ct.comments.unobserve(onChange);
            ct.replies.unobserve(onChange);
            clearTimeout(timer);
            resolve(payload);
          };
          const onChange = () => {
            const cur = findComment();
            if (!cur) return finish({ reply: null, reason: 'comment-deleted' });
            const replies = cur.replies || [];
            if (replies.length > baseLen) {
              finish({ reply: replies[replies.length - 1], comment: cur });
            }
          };
          yMeta.observe(onChange);
          ct.comments.observe(onChange);
          ct.replies.observe(onChange);
          const timer = setTimeout(() => finish({ reply: null, reason: 'timeout' }), bounded);
        });
      },
      listAnchoredComments({ noteId, includeResolved = false } = {}) {
        const all = noteId ? readNoteComments(ydoc, noteId) : readAllComments(ydoc);
        return includeResolved ? all : all.filter(c => !c.resolved);
      },
      resolveAnchoredComment(id) {
        const found = patchComment(ydoc, id, { resolved: true, resolvedAt: new Date().toISOString() });
        if (!found) throw new Error(`comment not found: ${id}`);
        return found;
      },
      // Cambia el texto de un comentario (o de una respuesta) y lo marca como editado. No vuelve a calcular
      // menciones ni a crear tareas para asistentes: eso solo ocurre al crear el comentario.
      editAnchoredComment(id, text) {
        const t = String(text == null ? '' : text).trim();
        if (!t) throw new Error('text must not be empty');
        const found = patchComment(ydoc, id, { text: t, editedAt: new Date().toISOString() });
        if (!found) throw new Error(`comment not found: ${id}`);
        return found;
      },
      deleteAnchoredComment(id) {
        return { removed: deleteComments(ydoc, [id]) };
      },
      // Recent mutations. `since` is an ISO timestamp or millis; entries
      // are returned newest-first, optionally narrowed by noteId.
      getRecentEdits({ since, limit = 50, noteId } = {}) {
        const list = Array.isArray(yMeta.get('editLog')) ? yMeta.get('editLog') : [];
        let cutoff = 0;
        if (since != null) {
          const v = typeof since === 'string' ? Date.parse(since) : Number(since);
          if (Number.isFinite(v)) cutoff = v;
        }
        const out = [];
        for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
          const r = list[i];
          if (!r || !r.ts) continue;
          if (cutoff && Date.parse(r.ts) < cutoff) break;
          if (noteId && r.noteId !== noteId) continue;
          const meta = r.noteId ? yFiles.get(r.noteId) : null;
          out.push({
            ...r,
            noteName: meta ? meta.name : (r.name || null),
            vaultId:  meta ? (meta.vaultId || 'default') : null,
            vault:    meta ? this.vaultName(meta.vaultId) : null,
          });
        }
        return out;
      },
      isAppOpen() {
        try {
          const states = provider.awareness.getStates();
          const selfId = provider.awareness.clientID;
          const peers = [];
          for (const [clientId, state] of states) {
            if (clientId === selfId) continue;
            if (state && state.user) {
              peers.push({
                clientId,
                email: state.user.email || null,
                color: state.user.color || null,
              });
            }
          }
          return { open: peers.length > 0, count: peers.length, peers };
        } catch {
          return { open: false, count: 0, peers: [] };
        }
      },
      // Tell the user's app to switch to a specific note. Both `activeId`
      // and `activeVault` live in yMeta (shared state), so writing them
      // here re-renders the editor on the user's side. The aiPointer
      // awareness event is what triggers the window-focus + toast.
      //
      // Guard: while the user is in `markdown` or `dual` view mode they're
      // actively editing — the AI shouldn't yank the active note out from
      // under them. `render` mode is passive (read-only preview) so a
      // note-switch there doesn't interrupt anything. Same-note focus stays
      // a no-op pass-through. Caller gets `{ deferred: true, reason }` and
      // can decide whether to retry later.
      _userIsEditing() {
        const m = yMeta.get('userMode');
        if (m !== 'markdown' && m !== 'dual' && m !== 'live') return false;
        // Only consider the user "actively editing" if they typed in the
        // last ~15s. Opening markdown view to read a note shouldn't block
        // the AI from focusing a different note.
        const last = Number(yMeta.get('userEditingAt') || 0);
        return last > 0 && (Date.now() - last) < 15000;
      },
      _switchActive(fileId, meta) {
        const current = yMeta.get('activeId');
        if (current === fileId) return true;
        if (this._userIsEditing()) return false;
        ydoc.transact(() => {
          yMeta.set('activeId', fileId);
          if (meta.vaultId) yMeta.set('activeVault', meta.vaultId);
        });
        return true;
      },
      focusNote(fileId) {
        const meta = yFiles.get(fileId);
        if (!meta) throw new Error(`file not found: ${fileId}`);
        const switched = this._switchActive(fileId, meta);
        if (!switched) {
          return {
            id: fileId,
            name: meta.name,
            vaultId: meta.vaultId || 'default',
            deferred: true,
            reason: 'user is editing — focus skipped to avoid breaking their flow',
          };
        }
        this.publishAiPointer({
          kind: 'focus',
          noteId: fileId,
          noteName: meta.name,
          vaultId: meta.vaultId || 'default',
        });
        return { id: fileId, name: meta.name, vaultId: meta.vaultId || 'default' };
      },
      // Walk-through "presentation" mode: a sequence of highlight stops
      // played one after another. The MCP tool resolves all offsets +
      // text up front so we publish a single awareness payload — the
      // renderer drives the pacing locally, which means no per-step
      // network jitter and clean cancellation when the user navigates
      // away mid-presentation.
      presentInNote(fileId, steps) {
        const meta = yFiles.get(fileId);
        if (!meta) throw new Error(`file not found: ${fileId}`);
        const switched = this._switchActive(fileId, meta);
        if (!switched) {
          return {
            id: fileId, name: meta.name, vaultId: meta.vaultId || 'default',
            stepCount: steps.length, deferred: true,
            reason: 'user is editing — presentation skipped',
          };
        }
        this.publishAiPointer({
          kind: 'present',
          noteId: fileId,
          noteName: meta.name,
          vaultId: meta.vaultId || 'default',
          steps,
        });
        return { id: fileId, name: meta.name, vaultId: meta.vaultId || 'default', stepCount: steps.length };
      },
      // Focus + ask the renderer to flash a passage. The MCP tool layer
      // resolves the (fromCh, toCh) offsets from a literal text match
      // before calling here. We also forward the literal `text` so the
      // renderer can highlight the same passage in render mode (where
      // offsets aren't useful because markdown-it doesn't preserve them
      // through to the DOM).
      highlightInNote(fileId, fromCh, toCh, message, text) {
        const meta = yFiles.get(fileId);
        if (!meta) throw new Error(`file not found: ${fileId}`);
        const switched = this._switchActive(fileId, meta);
        if (!switched) {
          return {
            id: fileId, name: meta.name, vaultId: meta.vaultId || 'default',
            fromCh, toCh, deferred: true,
            reason: 'user is editing — highlight skipped',
          };
        }
        this.publishAiPointer({
          kind: 'highlight',
          noteId: fileId,
          noteName: meta.name,
          vaultId: meta.vaultId || 'default',
          fromCh, toCh,
          text: String(text || ''),
          message: String(message || ''),
        });
        return { id: fileId, name: meta.name, vaultId: meta.vaultId || 'default', fromCh, toCh };
      },
      // Capture a screenshot of the live app's current view of a note.
      // Routed via publishAiPointer to the renderer, which calls
      // window.electronAPI.windowCapture and writes the PNG (base64) back
      // into yMeta.screenshotResponses[requestId]. We long-poll that map
      // until the response arrives or the timeout fires.
      screenshotNote({ fileId, rect, maxWidth, timeoutMs = 20000 } = {}) {
        const meta = yFiles.get(fileId);
        if (!meta) throw new Error(`file not found: ${fileId}`);
        const switched = this._switchActive(fileId, meta);
        if (!switched) {
          return Promise.resolve({
            ok: false,
            deferred: true,
            reason: 'user is editing — screenshot skipped (would have switched notes)',
          });
        }
        const requestId = 'sr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        this.publishAiPointer({
          kind: 'screenshot_request',
          noteId: fileId,
          noteName: meta.name,
          vaultId: meta.vaultId || 'default',
          requestId,
          rect: rect || null,
          maxWidth: maxWidth || 1200,
        });
        const bounded = Math.max(1000, Math.min(60000, Number(timeoutMs) || 20000));
        return new Promise((resolve) => {
          let done = false;
          const finish = (payload) => {
            if (done) return;
            done = true;
            yMeta.unobserve(onChange);
            clearTimeout(timer);
            // Garbage-collect our slot so the map doesn't grow unbounded.
            try {
              const map = yMeta.get('screenshotResponses') || {};
              if (map[requestId]) {
                const next = { ...map };
                delete next[requestId];
                yMeta.set('screenshotResponses', next);
              }
            } catch {}
            resolve(payload);
          };
          const onChange = () => {
            try {
              const map = yMeta.get('screenshotResponses') || {};
              const r = map[requestId];
              if (r) finish(r);
            } catch {}
          };
          yMeta.observe(onChange);
          const timer = setTimeout(() => finish({ ok: false, reason: 'timeout — no live app responded' }), bounded);
        });
      },
      // Ephemeral spotlight. Same routing as highlightInNote but signals
      // the renderer to flash (no callout, no persistent selection).
      // Use for momentary "look here" cues — e.g. confirming a recall
      // hit, pointing at the exact word the user asked about, etc.
      spotlightPulse(fileId, fromCh, toCh, text) {
        const meta = yFiles.get(fileId);
        if (!meta) throw new Error(`file not found: ${fileId}`);
        const switched = this._switchActive(fileId, meta);
        if (!switched) {
          return { id: fileId, name: meta.name, vaultId: meta.vaultId || 'default',
            fromCh, toCh, deferred: true,
            reason: 'user is editing — pulse skipped' };
        }
        this.publishAiPointer({
          kind: 'pulse',
          noteId: fileId,
          noteName: meta.name,
          vaultId: meta.vaultId || 'default',
          fromCh, toCh,
          text: String(text || ''),
        });
        return { id: fileId, name: meta.name, vaultId: meta.vaultId || 'default', fromCh, toCh };
      },
      // Drain pending writes WITHOUT tearing the session down. Long-lived
      // callers (the MCP server keeps one session for the whole process)
      // need the durability guarantee that close() used to provide at the
      // end of every tool call, minus the teardown.
      async flush() { await flush(); },
      readOnlyWrites() { return [...readOnlyWrites]; },
      async close() {
        await flush();
        // Note providers first — they reference no vault state, just
        // their own short-lived doc. Tolerate destroy errors so a
        // partial registry doesn't block shell shutdown.
        for (const e of noteRegistry.values()) {
          try { e.provider && e.provider.destroy(); } catch {}
          try { e.ydoc && e.ydoc.destroy(); } catch {}
        }
        for (const e of vaultRegistry.values()) {
          try { e.provider && e.provider.destroy(); } catch {}
          try { e.ydoc && e.ydoc.destroy(); } catch {}
        }
        try { provider.destroy(); } catch {}
        try { ydoc.destroy(); } catch {}
      },
      // ── Workspace-level settings access ──────────────────────────────
      // Shell ySettings carries cross-tool prefs. Surface a getter so
      // tools like `get_ai_instructions` can read user-authored
      // behavior guides without each grabbing the doc directly.
      getSetting(key, fallback = null) {
        const v = ySettings.get(key);
        return v !== undefined ? v : fallback;
      },
    };
  },
};
