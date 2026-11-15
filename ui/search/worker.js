// Índice de búsqueda de contenido (Ctrl K «Contenido»/«Todo», selector de
// notas del canvas) en un Web Worker.
//
// Por nota guarda el texto «buscable» plegado (searchableContent →
// minúsculas → sin acentos, exactamente como gsFoldedSearchable en el hilo
// principal) y lo trocea en tokens (series de letras/dígitos). El índice
// invertido es token → Map(noteId → tf). Una consulta:
//
//   1. Trocea la aguja con el mismo tokenizador. Si la aguja aparece en una
//      nota, cada uno de sus trozos es subcadena de algún token de esa nota
//      (un trozo alfanumérico de una subcadena cae entero dentro de un token
//      del texto). Así que los candidatos son la intersección, por trozo, de
//      las notas cuyos tokens CONTIENEN el trozo — búsqueda dentro de
//      palabras, no sólo prefijos. El vocabulario se recorre una vez por
//      trozo (con caché: «comp» → «compr» sólo revisa lo que ya casaba).
//   2. Verifica cada candidato con indexOf sobre su texto plegado y cuenta
//      apariciones con las mismas reglas que buildGlobalSearchResults
//      (frase literal; si no, todos los términos sin palabras vacías).
//
// El resultado es idéntico al escaneo completo de antes (el filtro sólo
// descarta notas que no pueden casar) pero sin recorrer todo el texto del
// vault en el hilo principal. Devuelve también la posición de la primera
// aparición traducida al texto ORIGINAL para el fragmento y el salto.

import { searchableContent, gsFold, gsQueryTerms } from './core.js';

const docs = new Map();      // id → { raw, folded, ascii, tf: Map(token → n) }
const postings = new Map();  // token → Map(id → tf)
let pieceCache = new Map();  // trozo → { tokens: string[] } (vocabulario que lo contiene)
let vocabVersion = 0;        // invalida pieceCache cuando entran tokens nuevos
let pieceCacheVersion = 0;

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

function isAscii(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return false;
  return true;
}

function tokenize(folded) {
  const tf = new Map();
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(folded)) !== null) {
    const tok = m[0];
    tf.set(tok, (tf.get(tok) || 0) + 1);
  }
  return tf;
}

function removeDoc(id) {
  const d = docs.get(id);
  if (!d) return;
  for (const tok of d.tf.keys()) {
    const p = postings.get(tok);
    if (!p) continue;
    p.delete(id);
    if (!p.size) postings.delete(tok);
  }
  docs.delete(id);
}

function upsert(id, raw) {
  const text = raw == null ? '' : String(raw);
  const prev = docs.get(id);
  if (prev && prev.raw === text) return;
  removeDoc(id);
  const folded = gsFold(searchableContent(text).toLowerCase());
  const tf = tokenize(folded);
  for (const [tok, n] of tf) {
    let p = postings.get(tok);
    if (!p) { p = new Map(); postings.set(tok, p); vocabVersion++; }
    p.set(id, n);
  }
  docs.set(id, { raw: text, folded, ascii: isAscii(text), tf });
}

// Tokens del vocabulario que contienen `piece`. Con caché por trozo y
// refinamiento: si ya resolvimos un trozo que es subcadena de éste, sólo se
// revisan sus tokens.
function tokensContaining(piece) {
  if (pieceCacheVersion !== vocabVersion) { pieceCache = new Map(); pieceCacheVersion = vocabVersion; }
  const hit = pieceCache.get(piece);
  if (hit) return hit;
  let base = null;
  for (const [k, v] of pieceCache) {
    if (piece.includes(k) && (!base || v.length < base.length)) base = v;
  }
  const out = [];
  if (base) { for (const tok of base) if (tok.includes(piece)) out.push(tok); }
  else { for (const tok of postings.keys()) if (tok.includes(piece)) out.push(tok); }
  if (pieceCache.size > 64) pieceCache.delete(pieceCache.keys().next().value);
  pieceCache.set(piece, out);
  return out;
}

function piecesOf(s) {
  const out = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(s)) !== null) out.push(m[0]);
  return out;
}

// Notas que pueden contener `needle` (null = no se puede filtrar: la aguja
// no tiene letras ni dígitos, toca revisar todas).
function candidatesFor(needle) {
  const pieces = piecesOf(needle);
  if (!pieces.length) return null;
  // El trozo más largo primero: suele ser el más selectivo.
  pieces.sort((a, b) => b.length - a.length);
  let acc = null;
  for (const piece of pieces) {
    const ids = new Set();
    for (const tok of tokensContaining(piece)) {
      const p = postings.get(tok);
      if (!p) continue;
      for (const id of p.keys()) if (!acc || acc.has(id)) ids.add(id);
    }
    acc = ids;
    if (!acc.size) break;
  }
  return acc;
}

function countOcc(hay, needle, cap) {
  let n = 0;
  let from = hay.indexOf(needle);
  while (from >= 0 && n < cap) {
    n++;
    from = hay.indexOf(needle, from + needle.length);
  }
  return n;
}

// Posición en el texto original de la posición `fi` del texto plegado (la
// misma correspondencia que gsFoldWithMap, calculada sólo hasta donde hace
// falta). searchableContent conserva longitudes; toLowerCase casi siempre.
function origOffset(d, fi) {
  if (d.ascii) return fi;
  const src = d.raw.toLowerCase();
  let folded = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const code = ch.charCodeAt(0);
    if (code < 0x80) { if (folded === fi) return i; folded++; continue; }
    const norm = ch.normalize('NFD');
    for (let j = 0; j < norm.length; j++) {
      const c = norm.charCodeAt(j);
      if (c >= 0x0300 && c <= 0x036f) continue;
      if (folded === fi) return i;
      folded++;
    }
  }
  return src.length;
}

function search(q, { limit = 0, ids = null } = {}) {
  const needle = gsFold(String(q || '').toLowerCase());
  const terms = gsQueryTerms(q);
  const multiTerm = terms.length > 1;
  const allowed = ids ? new Set(ids) : null;
  let cands = candidatesFor(needle);
  if (multiTerm) {
    // Notas con todos los términos (aunque la frase literal no aparezca).
    let all = null;
    for (const term of terms) {
      const c = candidatesFor(term);
      if (c === null) { all = null; break; }
      all = all ? new Set([...all].filter(id => c.has(id))) : c;
      if (!all.size) break;
    }
    if (cands !== null && all !== null) for (const id of all) cands.add(id);
    else cands = null;
  }
  const pool = cands === null ? docs.keys() : cands;
  const hits = [];
  for (const id of pool) {
    if (allowed && !allowed.has(id)) continue;
    const d = docs.get(id);
    if (!d) continue;
    const text = d.folded;
    const phraseIdx = text.indexOf(needle);
    let multi = null;
    if (phraseIdx < 0 && multiTerm) {
      let total = 0, firstIdx = Infinity, firstLen = 0, ok = true;
      for (const term of terms) {
        if (!term) continue;
        const idx = text.indexOf(term);
        if (idx < 0) { ok = false; break; }
        total += countOcc(text, term, 999);
        if (idx < firstIdx) { firstIdx = idx; firstLen = term.length; }
      }
      if (ok) multi = { contentMatches: total, firstIdx, firstLen };
    }
    if (phraseIdx < 0 && !multi) continue;
    const contentMatches = phraseIdx >= 0 ? Math.min(1000, countOcc(text, needle, 1000)) : multi.contentMatches;
    const seedIdx = phraseIdx >= 0 ? phraseIdx : multi.firstIdx;
    const seedLen = phraseIdx >= 0 ? needle.length : multi.firstLen;
    const origIdx = origOffset(d, seedIdx);
    const origEnd = d.ascii ? seedIdx + seedLen : origOffset(d, seedIdx + seedLen);
    hits.push({
      id, phraseIdx, contentMatches,
      multi: multi ? { contentMatches: multi.contentMatches } : null,
      seed: { origIdx, origEnd },
      // El texto contra el que se calculó: el cliente descarta el acierto
      // si la nota ha cambiado desde entonces.
      len: d.raw.length,
    });
  }
  if (limit > 0 && hits.length > limit) {
    hits.sort((a, b) => b.contentMatches - a.contentMatches);
    hits.length = limit;
  }
  return hits;
}

// Ids de las notas cuyo contenido plegado contiene `qFolded` (selector de
// notas del canvas).
function contains(qFolded, ids) {
  const allowed = ids ? new Set(ids) : null;
  const cands = candidatesFor(qFolded);
  const pool = cands === null ? docs.keys() : cands;
  const out = [];
  for (const id of pool) {
    if (allowed && !allowed.has(id)) continue;
    const d = docs.get(id);
    if (d && d.folded.includes(qFolded)) out.push(id);
  }
  return out;
}

self.onmessage = (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'upsert') {
      for (const [id, text] of msg.docs) upsert(id, text);
      if (msg.remove) for (const id of msg.remove) removeDoc(id);
      if (msg.reqId != null) self.postMessage({ reqId: msg.reqId, ok: true, size: docs.size });
      return;
    }
    if (msg.type === 'search') {
      const t0 = performance.now();
      const hits = search(msg.q, msg.opts || {});
      self.postMessage({ reqId: msg.reqId, ok: true, hits, ms: performance.now() - t0, size: docs.size });
      return;
    }
    if (msg.type === 'contains') {
      const t0 = performance.now();
      self.postMessage({ reqId: msg.reqId, ok: true, ids: contains(msg.q, msg.ids || null), ms: performance.now() - t0 });
      return;
    }
    if (msg.type === 'stats') {
      self.postMessage({ reqId: msg.reqId, ok: true, docs: docs.size, tokens: postings.size });
      return;
    }
  } catch (err) {
    self.postMessage({ reqId: msg.reqId, ok: false, error: (err && err.message) || String(err) });
  }
};
