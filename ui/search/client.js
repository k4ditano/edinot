// Cliente del índice de búsqueda (ui/search/worker.js).
//
// El hilo principal sólo hace dos cosas baratas:
//   · sync(files): compara por IDENTIDAD el texto de cada nota con el último
//     que mandó al worker (getContentString devuelve el mismo string mientras
//     la nota no cambia) y envía sólo las nuevas / cambiadas / borradas, por
//     lotes. EdinotApp lo llama en reposo tras arrancar y, con debounce, cada
//     vez que cambia `files` — así el índice sigue a cada Y.Text sin que el
//     store sepa nada de él.
//   · search(q) / contains(q): una petición asíncrona; la respuesta trae ids,
//     recuentos y la posición de la primera aparición en el texto original.
//
// Si el worker no existe (build sin él), no arranca o tarda demasiado, todo
// devuelve null y quien llama usa el escaneo síncrono de siempre.

/* global __EDINOT_SEARCH_WORKER__ */
const WORKER_URL = typeof __EDINOT_SEARCH_WORKER__ === 'string' ? __EDINOT_SEARCH_WORKER__ : null;
const BATCH_CHARS = 1_500_000;   // por mensaje: lotes de ~1,5 MB de texto
const REQ_TIMEOUT_MS = 4000;

class SearchIndexClient {
  constructor() {
    this.worker = null;
    this.failed = !WORKER_URL || typeof Worker === 'undefined';
    this.sent = new Map();       // id → string enviado
    this.pending = new Map();    // reqId → { resolve, timer }
    this.seq = 0;
    this.seeded = false;         // primer sync completo confirmado por el worker
    this.syncing = null;         // promesa del sync en curso
    this.again = null;           // files pendientes de otro sync
    this.lastMs = null;
  }

  _ensure() {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(WORKER_URL, { name: 'edinot-search' });
    } catch (err) {
      this._fail(err);
      return null;
    }
    this.worker.onmessage = (e) => {
      const msg = e.data || {};
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      this.pending.delete(msg.reqId);
      clearTimeout(p.timer);
      p.resolve(msg.ok ? msg : null);
    };
    this.worker.onerror = (e) => { this._fail(e && (e.message || e.error) || 'worker error'); };
    return this.worker;
  }

  _fail(err) {
    if (this.failed) return;
    this.failed = true;
    console.warn('[search] índice en worker desactivado; se usa el escaneo síncrono:', err && err.message || err);
    try { this.worker && this.worker.terminate(); } catch {}
    this.worker = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(null); }
    this.pending.clear();
    this.sent.clear();
    this.seeded = false;
  }

  _request(msg, timeout = REQ_TIMEOUT_MS) {
    const w = this._ensure();
    if (!w) return Promise.resolve(null);
    const reqId = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(reqId); resolve(null); }, timeout);
      this.pending.set(reqId, { resolve, timer });
      try { w.postMessage({ ...msg, reqId }); }
      catch (err) { clearTimeout(timer); this.pending.delete(reqId); this._fail(err); resolve(null); }
    });
  }

  get available() { return !this.failed; }
  get ready() { return !this.failed && this.seeded; }

  // ¿El índice tiene exactamente este texto para la nota?
  isFresh(id, content) { return this.sent.get(id) === (content || ''); }

  // files: [{ id, content }]. Envía sólo lo que cambió. Devuelve una promesa
  // que se resuelve cuando el worker ha indexado todo lo enviado.
  sync(files) {
    if (this.failed || !Array.isArray(files)) return Promise.resolve(false);
    if (this.syncing) { this.again = files; return this.syncing; }
    this.syncing = this._sync(files).finally(() => {
      this.syncing = null;
      if (this.again) { const f = this.again; this.again = null; this.sync(f); }
    });
    return this.syncing;
  }

  async _sync(files) {
    const seen = new Set();
    let batch = [], chars = 0, last = null;
    const flush = (remove) => {
      if (!batch.length && !(remove && remove.length)) return;
      last = this._request({ type: 'upsert', docs: batch, remove }, 20000);
      batch = []; chars = 0;
    };
    for (const f of files) {
      if (!f || f.id == null) continue;
      const id = f.id;
      seen.add(id);
      const text = f.content || '';
      if (this.sent.get(id) === text) continue;
      this.sent.set(id, text);
      batch.push([id, text]);
      chars += text.length;
      if (chars >= BATCH_CHARS) {
        flush(null);
        // Cede el hilo entre lotes: la copia estructurada de un lote grande
        // no debe sumarse a la siguiente en la misma tarea.
        await new Promise(r => setTimeout(r, 0));
        if (this.failed) return false;
      }
    }
    const removed = [];
    for (const id of this.sent.keys()) if (!seen.has(id)) removed.push(id);
    for (const id of removed) this.sent.delete(id);
    flush(removed);
    if (last) {
      const ok = await last;
      if (!ok) return false;
    }
    this.seeded = true;
    return true;
  }

  // → [{ id, phraseIdx, contentMatches, multi, seed: { origIdx, origEnd } }]
  //   o null si no hay índice (el llamador usa el escaneo síncrono).
  async search(q, opts = {}) {
    if (!this.ready) return null;
    const t0 = performance.now();
    const r = await this._request({ type: 'search', q, opts });
    if (!r) return null;
    this.lastMs = { worker: r.ms, roundTrip: performance.now() - t0 };
    return r.hits;
  }

  // → Set de ids cuyo contenido plegado contiene `qFolded`, o null.
  async contains(qFolded, ids = null) {
    if (!this.ready) return null;
    const r = await this._request({ type: 'contains', q: qFolded, ids });
    return r ? new Set(r.ids) : null;
  }
}

export const searchIndex = new SearchIndexClient();
try { if (typeof window !== 'undefined') window.__edinotSearchIndex = searchIndex; } catch {}
