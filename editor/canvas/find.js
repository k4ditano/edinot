// Utilidades puras del canvas: buscar (Ctrl+F) y pegar una lista como notas
// adhesivas.

import { matchOffsets } from '../../ui/find/dom-find.js';
import { ownCanvasRange } from '../../shared/page-canvas.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Texto buscable de cada elemento.
function nodeText(n) {
  return [n.title, n.text, n.label, n.noteName, n.url, n.query, n.name, n.alt].filter(Boolean).join(' ');
}

// Coincidencias dentro del texto de la página (la nota), en posiciones del
// texto completo y sin contar las de su propia valla ```edinot-canvas.
export function pageMatchRanges(src, q) {
  const s = String(src || '');
  const r = ownCanvasRange(s);
  let skipFrom = -1, skipTo = -1;
  if (r) {
    const lines = s.split('\n');
    skipFrom = lines.slice(0, r[0]).reduce((n, l) => n + l.length + 1, 0);
    skipTo = skipFrom + lines.slice(r[0], r[1] + 1).reduce((n, l) => n + l.length + 1, 0);
  }
  return matchOffsets(s, q).filter(([a]) => !(a >= skipFrom && a < skipTo));
}

// → [{ kind: 'node'|'anno'|'group'|'page', id, rect: {x,y,w,h}, at? }] en orden de lectura.
// `pageSource`: el texto de la nota, para buscar dentro del bloque de página
// (una coincidencia por aparición, con `at` = [desde, hasta] en ese texto).
export function searchCanvas(json, q, rectOfNode, pageSource) {
  const needle = fold(q).trim();
  if (!needle) return [];
  const hits = [];
  for (const n of (json && json.nodes) || []) {
    if (n.kind === 'page') {
      if (pageSource == null) continue;
      const rect = rectOfNode(n);
      for (const at of pageMatchRanges(typeof pageSource === 'function' ? pageSource() : pageSource, q)) hits.push({ kind: 'page', id: n.id, rect, at });
      continue;
    }
    if (fold(nodeText(n)).includes(needle)) hits.push({ kind: 'node', id: n.id, rect: rectOfNode(n) });
  }
  for (const a of (json && json.annotations) || []) {
    if (a.text && fold(a.text).includes(needle)) {
      const b = a.bbox || { x: a.x || 0, y: a.y || 0, w: a.w || 0, h: a.h || 0 };
      hits.push({ kind: 'anno', id: a.id, rect: { x: b.x + (a.ox || 0), y: b.y + (a.oy || 0), w: b.w, h: b.h } });
    }
  }
  for (const g of (json && json.groups) || []) {
    if (g.title && fold(g.title).includes(needle)) hits.push({ kind: 'group', id: g.id, rect: { x: g.x, y: g.y, w: g.w, h: 34 } });
  }
  hits.sort((p, q2) => (p.rect.y - q2.rect.y) || (p.rect.x - q2.rect.x));
  return hits;
}

const BULLET_RE = /^\s*(?:[-*+•·]|\d{1,3}[.)]|\[[ xX]\])\s+/;

// Texto pegado → líneas para notas adhesivas, o null si no parece una lista
// (una sola línea larga, código, JSON, una URL…).
export function listLines(text) {
  const raw = String(text || '').replace(/\r/g, '');
  if (!raw.trim() || raw.trimStart().startsWith('{') || raw.includes('```')) return null;
  const lines = raw.split('\n').map(l => l.replace(BULLET_RE, '').replace(BULLET_RE, '').trim()).filter(Boolean);
  if (!lines.length || lines.length > 200) return null;
  if (lines.length === 1 && (/^https?:\/\/\S+$/i.test(lines[0]) || lines[0].length > 280)) return null;
  return lines.map(l => l.slice(0, 500));
}

// Posiciones en rejilla centradas en (cx, cy).
export function gridPositions(count, size, gap, cx, cy) {
  const cols = Math.min(count, Math.max(1, Math.ceil(Math.sqrt(count * 1.6))));
  const rows = Math.ceil(count / cols);
  const W = cols * size + (cols - 1) * gap, H = rows * size + (rows - 1) * gap;
  const x0 = cx - W / 2, y0 = cy - H / 2;
  return Array.from({ length: count }, (_, i) => ({ x: Math.round(x0 + (i % cols) * (size + gap)), y: Math.round(y0 + Math.floor(i / cols) * (size + gap)) }));
}
