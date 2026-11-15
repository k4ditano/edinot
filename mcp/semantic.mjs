// Búsqueda semántica PROPIA del MCP (sin depender de la app abierta).
//
// Antes, recall_semantic mandaba la consulta a la app (que tiene los vectores
// en IndexedDB) y esperaba la respuesta: con la app cerrada o sin clave se
// quedaba esperando 30 s y devolvía «unavailable». Ahora el MCP:
//   1. Lee la clave de OpenAI de los ajustes del workspace (la misma que se
//      pone en Ajustes → IA) o de OPENAI_API_KEY.
//   2. Mantiene su propio índice en disco (~/.config/edinot/mcp-embeddings-
//      <workspace>.json, permisos 600): un registro por nota con el hash del
//      texto; solo se re-indexa lo que cambió, en lotes y con tope de tiempo.
//   3. Ordena por coseno igual que la app (mismo modelo y troceado).
// Si no hay clave, el llamador cae a la búsqueda por palabras (recall).

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import nodePath from 'node:path';
import os from 'node:os';

const MODEL = 'text-embedding-3-small';
const CHUNK_MAX = 1500;
const BATCH = 96;
const vecCache = new WeakMap(); // trozo → Float32Array (no se guarda en disco)

function configDir() {
  if (process.env.EDINOT_CONFIG_DIR) return process.env.EDINOT_CONFIG_DIR;
  const home = os.homedir();
  if (process.platform === 'darwin') return nodePath.join(home, 'Library', 'Application Support', 'edinot');
  if (process.platform === 'win32') return nodePath.join(process.env.APPDATA || nodePath.join(home, 'AppData', 'Roaming'), 'edinot');
  return nodePath.join(process.env.XDG_CONFIG_HOME || nodePath.join(home, '.config'), 'edinot');
}

// Mismo texto indexable y troceado que embeddings.js (la app).
export function indexableText(md) {
  let s = String(md || '');
  s = s.replace(/```edinot-canvas[\s\S]*?```/g, '');
  s = s.replace(/!\[[^\]]*\]\(edinot:\/\/blob\/[^)]*\)/g, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  return s.trim();
}

export function chunkText(text, max = CHUNK_MAX) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const chunks = [];
  let cur = '';
  const flush = () => { if (cur) { chunks.push(cur); cur = ''; } };
  for (const p of t.split(/\n{2,}/)) {
    const para = p.trim();
    if (!para) continue;
    if (para.length > max) { flush(); for (let i = 0; i < para.length; i += max) chunks.push(para.slice(i, i + max)); continue; }
    if ((cur ? cur.length + 2 + para.length : para.length) > max) { flush(); cur = para; } else cur = cur ? cur + '\n\n' + para : para;
  }
  flush();
  return chunks;
}

const f32ToB64 = (v) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const b64ToF32 = (b) => { const buf = Buffer.from(b, 'base64'); return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4); };

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function embed(apiKey, inputs, signal) {
  const out = [];
  for (let i = 0; i < inputs.length; i += BATCH) {
    const part = inputs.slice(i, i + BATCH);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: MODEL, input: part }),
          signal: signal || AbortSignal.timeout(30000),
        });
        if (res.status === 401) throw Object.assign(new Error('OpenAI rechazó la clave (401)'), { fatal: true });
        if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
        const data = await res.json();
        for (const d of data.data) out[i + d.index] = d.embedding;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (e.fatal) throw e;
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    if (lastErr) throw lastErr;
  }
  return out;
}

export class SemanticIndex {
  constructor(workspaceKey) {
    const safe = createHash('sha1').update(String(workspaceKey || 'default')).digest('hex').slice(0, 12);
    this.file = nodePath.join(configDir(), `mcp-embeddings-${safe}.json`);
    this.data = null;
    this.dirty = false;
  }
  load() {
    if (this.data) return this.data;
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = d && d.model === MODEL && d.notes ? d : { model: MODEL, notes: {} };
    } catch { this.data = { model: MODEL, notes: {} }; }
    return this.data;
  }
  save() {
    if (!this.dirty) return;
    try {
      mkdirSync(nodePath.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.file);
      try { chmodSync(this.file, 0o600); } catch {}
      this.dirty = false;
    } catch (e) {
      try { process.stderr.write(`[edinot-mcp] semantic index save failed: ${e.message}\n`); } catch {}
    }
  }
  // notes: [{ id, name, vaultId, content }]. Re-indexa lo cambiado hasta
  // `budgetMs`; devuelve { indexed, pending, removed }.
  async sync(apiKey, notes, budgetMs = 45000) {
    const d = this.load();
    const deadline = Date.now() + budgetMs;
    const alive = new Set();
    const todo = [];
    for (const n of notes) {
      alive.add(n.id);
      const text = indexableText(n.content);
      const hash = createHash('sha1').update(text).digest('hex');
      const cur = d.notes[n.id];
      if (cur && cur.hash === hash) { if (cur.name !== n.name || cur.vaultId !== n.vaultId) { cur.name = n.name; cur.vaultId = n.vaultId; this.dirty = true; } continue; }
      if (!text) { if (cur) { delete d.notes[n.id]; this.dirty = true; } continue; }
      todo.push({ n, hash, parts: chunkText(text) });
    }
    let removed = 0;
    for (const id of Object.keys(d.notes)) if (!alive.has(id)) { delete d.notes[id]; removed++; this.dirty = true; }
    let indexed = 0, i = 0;
    // Lotes de varias notas por petición (hasta BATCH trozos).
    while (i < todo.length && Date.now() < deadline) {
      const group = [];
      let count = 0;
      while (i < todo.length && (count === 0 || count + todo[i].parts.length <= BATCH)) { group.push(todo[i]); count += todo[i].parts.length; i++; }
      const vecs = await embed(apiKey, group.flatMap(g => g.parts));
      let k = 0;
      for (const g of group) {
        d.notes[g.n.id] = {
          hash: g.hash, name: g.n.name, vaultId: g.n.vaultId || 'default',
          chunks: g.parts.map(p => ({ text: p.length > 400 ? p.slice(0, 400) : p, v: f32ToB64(vecs[k++]) })),
        };
        indexed++;
      }
      this.dirty = true;
    }
    this.save();
    return { indexed, pending: todo.length - indexed, removed };
  }
  async search(apiKey, query, { limit = 10, threshold = 0.3, vaultId = null } = {}) {
    const d = this.load();
    const [qv] = await embed(apiKey, [query]);
    const byNote = new Map();
    for (const [id, rec] of Object.entries(d.notes)) {
      if (vaultId && rec.vaultId !== vaultId) continue;
      rec.chunks.forEach((c, idx) => {
        let fv = vecCache.get(c);
        if (!fv) { fv = b64ToF32(c.v); vecCache.set(c, fv); }
        const score = cosine(qv, fv);
        if (score < threshold) return;
        const snip = c.text.length > 200 ? c.text.slice(0, 200) + '…' : c.text;
        const cur = byNote.get(id);
        if (!cur) byNote.set(id, { noteId: id, name: rec.name, vaultId: rec.vaultId, score, snippets: [{ chunkIdx: idx, score, text: snip }] });
        else {
          if (score > cur.score) cur.score = score;
          cur.snippets.push({ chunkIdx: idx, score, text: snip });
        }
      });
    }
    const hits = [...byNote.values()];
    for (const h of hits) { h.snippets.sort((a, b) => b.score - a.score); h.snippets = h.snippets.slice(0, 3); h.snippet = h.snippets[0].text; }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
