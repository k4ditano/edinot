// Índice de tablas y etiquetas de todas las notas cargadas (barra lateral,
// Ctrl K, selector de vistas enlazadas y sugerencias de etiquetas).
//
// Cada tabla GFM de una nota ya es una base de datos (editor/db); este índice
// sólo las hace encontrables fuera de su nota. Caché por nota: mientras el
// texto de una nota no cambie (misma cadena) no se vuelve a analizar, así que
// al teclear sólo se re-procesa la nota activa.

import { parseProps, parseTypes, inferType, visibleEntries, splitTags } from '../../editor/blocks/props.js';

const cache = new Map(); // fileId → { content, tables, tags }

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
// Igual que srvExtractTags (mcp/server.mjs): empieza por letra o «_», así que
// «# Título», colores #0a0414 y números #3 no cuentan.
const HASHTAG_RE = /(?:^|[\s(])#([\p{L}_][\p{L}\p{N}_\/-]{0,59})/gu;

export const baseName = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');

function plainHeading(s) {
  return String(s)
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .trim();
}

// Etiquetas de una nota: #hashtags del texto (fuera de bloques de código) y
// las de una propiedad de tipo «tags» de la cabecera.
export function noteTags(content) {
  const out = new Set();
  const text = String(content || '');
  if (text.indexOf('#') >= 0) {
    let fenced = false;
    for (const line of text.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced || line.indexOf('#') < 0) continue;
      // En un encabezado, los # del principio no son una etiqueta.
      scanTags(line.replace(/^\s{0,3}#{1,6}\s+/, ' '), out);
    }
  }
  if (text.indexOf('edinot:props') >= 0) {
    const { props } = parseProps(text);
    const types = parseTypes(props);
    for (const [k, v] of visibleEntries(props)) {
      if (inferType(k, v, types) === 'tags') for (const tg of splitTags(v)) out.add(tg);
    }
  }
  return [...out];
}

function scanTags(line, out) {
  HASHTAG_RE.lastIndex = 0;
  let m;
  while ((m = HASHTAG_RE.exec(line)) !== null) out.add(m[1]);
}

function analyse(f, parseTables) {
  const content = String(f.content || '');
  const hit = cache.get(f.id);
  if (hit && hit.content === content) return hit;
  let tables = [];
  if (content.indexOf('|') >= 0) {
    let parsed = [];
    try { parsed = parseTables(content); } catch { parsed = []; }
    if (parsed.length) {
      const lines = content.split('\n');
      // Desplazamiento (en caracteres) del inicio de cada línea, para saltar.
      const offs = new Array(lines.length);
      let acc = 0;
      for (let i = 0; i < lines.length; i++) { offs[i] = acc; acc += lines[i].length + 1; }
      tables = parsed.map((tb, idx) => {
        let heading = '';
        let fenced = false;
        for (let i = 0; i < tb.startLine; i++) {
          if (/^\s*(```|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
          if (fenced) continue;
          const m = lines[i].match(HEADING_RE);
          if (m) heading = plainHeading(m[2]);
        }
        return {
          idx, heading,
          headers: tb.headers.map(h => String(h || '').trim()),
          rows: tb.rows.length,
          pos: offs[tb.startLine] || 0,
        };
      });
    }
  }
  const entry = { content, tables, tags: noteTags(content) };
  cache.set(f.id, entry);
  return entry;
}

// Entradas de base de datos: una por tabla. `title` es el encabezado más
// cercano por encima (o el nombre de la nota si no hay o si la nota entera es
// una base de datos), `note` el nombre de la nota que la contiene.
export function buildTableIndex(files, parseTables) {
  const out = [];
  const alive = new Set();
  for (const f of files || []) {
    if (!f || !f.id) continue;
    alive.add(f.id);
    const a = analyse(f, parseTables);
    if (!a.tables.length) continue;
    const note = baseName(f.name);
    const dbNote = f.kind === 'database';
    for (const tb of a.tables) {
      const title = (!dbNote && tb.heading) ? tb.heading : note;
      out.push({
        key: f.id + ':' + tb.idx,
        noteId: f.id, note, vaultId: f.vaultId || 'default', icon: f.icon || '',
        idx: tb.idx, title, sub: title === note ? '' : note,
        headers: tb.headers, rows: tb.rows, pos: tb.pos, dbNote,
      });
    }
  }
  for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id);
  return out;
}

// tag en minúsculas → { tag, ids } (ids de las notas que la llevan). El
// nombre visible es el de la primera aparición.
export function buildTagIndex(files, parseTables) {
  const idx = new Map();
  for (const f of files || []) {
    if (!f || !f.id) continue;
    const a = analyse(f, parseTables);
    for (const tg of a.tags) {
      const k = tg.toLowerCase();
      let e = idx.get(k);
      if (!e) { e = { tag: tg, ids: [] }; idx.set(k, e); }
      e.ids.push(f.id);
    }
  }
  return idx;
}

// Firma de una tabla (cabeceras) para reencontrarla si cambia su posición.
export const tableSig = (headers) => (headers || []).map(h => String(h || '').trim()).join('|');
