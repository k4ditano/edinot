// Colocar y seleccionar con inteligencia (como Figma): alinear, distribuir, «ordenar» (tidy up), espaciado exacto,
// «seleccionar iguales» y buscar y reemplazar texto. Lógica pura. Trabaja con fichas, dibujos y grupos a la vez:
// las piezas de un mismo grupo se mueven como una unidad.

const nodeRect = (n) => ({ x: n.x || 0, y: n.y || 0, w: n.w || 240, h: n.h || 140 });
const annoRect = (a) => (a.bbox ? { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h } : null);
const union = (a, b) => (!a ? b : !b ? a : { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) });

/** Unidades de la selección: [{ nodes:[id], annos:[id], rect, locked }] (un grupo = una unidad). */
export function selectionUnits(json, nodeIds, annoIds) {
  const units = new Map();
  const add = (kind, it, r) => {
    if (!r) return;
    const key = it.grp ? 'g' + it.grp : kind + it.id;
    let u = units.get(key);
    if (!u) { u = { nodes: [], annos: [], rect: null, locked: false }; units.set(key, u); }
    (kind === 'n' ? u.nodes : u.annos).push(it.id);
    u.rect = union(u.rect, r);
    if (it.locked) u.locked = true;
  };
  for (const n of json.nodes || []) if (nodeIds.has(n.id)) add('n', n, nodeRect(n));
  for (const a of json.annotations || []) if (annoIds.has(a.id)) add('a', a, annoRect(a));
  return [...units.values()];
}

/** Aplica desplazamientos por unidad: Map(unit → {dx, dy}). */
export function moveUnits(json, moves) {
  const dn = new Map(), da = new Map();
  for (const [u, d] of moves) {
    if (u.locked || (!d.dx && !d.dy)) continue;
    for (const id of u.nodes) dn.set(id, d);
    for (const id of u.annos) da.set(id, d);
  }
  if (!dn.size && !da.size) return json;
  const R = (v) => Math.round(v * 100) / 100;
  return {
    ...json,
    nodes: (json.nodes || []).map(n => { const d = dn.get(n.id); return d ? { ...n, x: R((n.x || 0) + d.dx), y: R((n.y || 0) + d.dy) } : n; }),
    annotations: (json.annotations || []).map(a => { const d = da.get(a.id); return d ? { ...a, ox: R((a.ox || 0) + d.dx), oy: R((a.oy || 0) + d.dy) } : a; }),
  };
}

export function alignUnits(json, units, how) {
  if (units.length < 2) return json;
  const all = units.reduce((acc, u) => union(acc, u.rect), null);
  const moves = new Map();
  for (const u of units) {
    const r = u.rect;
    let dx = 0, dy = 0;
    if (how === 'left') dx = all.x - r.x;
    else if (how === 'right') dx = all.x + all.w - (r.x + r.w);
    else if (how === 'hcenter') dx = all.x + all.w / 2 - (r.x + r.w / 2);
    else if (how === 'top') dy = all.y - r.y;
    else if (how === 'bottom') dy = all.y + all.h - (r.y + r.h);
    else if (how === 'vcenter') dy = all.y + all.h / 2 - (r.y + r.h / 2);
    moves.set(u, { dx, dy });
  }
  return moveUnits(json, moves);
}

/** Huecos iguales entre unidades a lo largo de un eje. Con `gap` (número), ese hueco exacto desde la primera. */
export function spaceUnits(json, units, axis, gap = null) {
  if (units.length < 2) return json;
  const k = axis === 'h' ? 'x' : 'y', s = axis === 'h' ? 'w' : 'h';
  const sorted = [...units].sort((a, b) => a.rect[k] - b.rect[k]);
  const first = sorted[0], last = sorted[sorted.length - 1];
  let g = gap;
  if (g == null) {
    if (units.length < 3) return json;
    const total = sorted.reduce((t, u) => t + u.rect[s], 0);
    g = (last.rect[k] + last.rect[s] - first.rect[k] - total) / (sorted.length - 1);
  }
  const moves = new Map();
  let cur = first.rect[k] + first.rect[s] + g;
  for (let i = 1; i < sorted.length; i++) {
    const u = sorted[i];
    if (gap == null && i === sorted.length - 1) break;   // repartir: los extremos se quedan
    const d = Math.round(cur) - u.rect[k];
    moves.set(u, axis === 'h' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    cur += u.rect[s] + g;
  }
  return moveUnits(json, moves);
}

/** Eje principal de una selección: 'h' si están más repartidas a lo ancho, 'v' si a lo alto. */
export function mainAxis(units) {
  const xs = units.map(u => u.rect.x + u.rect.w / 2), ys = units.map(u => u.rect.y + u.rect.h / 2);
  return Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 'h' : 'v';
}

/** Hueco actual entre unidades consecutivas (redondeado; la media). */
export function currentGap(units, axis = mainAxis(units)) {
  if (units.length < 2) return 0;
  const k = axis === 'h' ? 'x' : 'y', s = axis === 'h' ? 'w' : 'h';
  const sorted = [...units].sort((a, b) => a.rect[k] - b.rect[k]);
  let t = 0;
  for (let i = 1; i < sorted.length; i++) t += sorted[i].rect[k] - (sorted[i - 1].rect[k] + sorted[i - 1].rect[s]);
  return Math.round(t / (sorted.length - 1));
}

/**
 * «Ordenar» (tidy up): detecta filas y columnas aproximadas y lo deja en una rejilla limpia con el mismo hueco
 * (la media de los huecos actuales, mínimo 0), alineada arriba a la izquierda donde empieza la selección.
 */
export function tidyUp(json, units) {
  if (units.length < 2) return json;
  const all = units.reduce((acc, u) => union(acc, u.rect), null);
  // Filas: por el centro vertical; una unidad entra en una fila si su centro cae dentro del alto medio de esa fila.
  const byY = [...units].sort((a, b) => (a.rect.y + a.rect.h / 2) - (b.rect.y + b.rect.h / 2));
  const rows = [];
  for (const u of byY) {
    const cy = u.rect.y + u.rect.h / 2;
    const row = rows.find(r => Math.abs(r.cy - cy) <= Math.max(r.h, u.rect.h) / 2);
    if (row) { row.items.push(u); row.cy = row.items.reduce((t, x) => t + x.rect.y + x.rect.h / 2, 0) / row.items.length; row.h = Math.max(row.h, u.rect.h); }
    else rows.push({ cy, h: u.rect.h, items: [u] });
  }
  rows.sort((a, b) => a.cy - b.cy);
  for (const r of rows) r.items.sort((a, b) => a.rect.x - b.rect.x);
  const cols = Math.max(...rows.map(r => r.items.length));
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...rows.map(r => (r.items[c] ? r.items[c].rect.w : 0))));
  const rowH = rows.map(r => Math.max(...r.items.map(u => u.rect.h)));
  // Hueco: la media de los huecos que ya hay (entre vecinos de fila y entre filas).
  const gaps = [];
  for (const r of rows) for (let i = 1; i < r.items.length; i++) gaps.push(r.items[i].rect.x - (r.items[i - 1].rect.x + r.items[i - 1].rect.w));
  for (let i = 1; i < rows.length; i++) { const top = Math.min(...rows[i].items.map(u => u.rect.y)), bot = Math.max(...rows[i - 1].items.map(u => u.rect.y + u.rect.h)); gaps.push(top - bot); }
  const gap = Math.max(0, Math.round(gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 16));
  const moves = new Map();
  let y = all.y;
  rows.forEach((r, ri) => {
    let x = all.x;
    r.items.forEach((u, c) => {
      // Cada pieza, centrada en su celda a lo ancho si es más estrecha que la columna (y arriba en su fila).
      const tx = cols > 1 && rows.length > 1 ? x + (colW[c] - u.rect.w) / 2 : x;
      moves.set(u, { dx: Math.round(tx - u.rect.x), dy: Math.round(y - u.rect.y) });
      x += (rows.length > 1 ? colW[c] : u.rect.w) + gap;
    });
    y += rowH[ri] + gap;
  });
  return moveUnits(json, moves);
}

// ── Seleccionar iguales ─────────────────────────────────────────────────────────────────────────────────

const fillOf = (it) => (it.bbox ? (it.fillVar || (it.fill && it.fill !== 'none' ? String(it.fill).toLowerCase() : null)) : (it.fillVar || (it.kind === 'label' ? null : it.color ? String(it.color).toLowerCase() : null)));
const strokeOf = (it) => (it.bbox ? (it.colorVar || (it.color && it.color !== 'none' ? String(it.color).toLowerCase() : null)) : null);
const fontOf = (it) => (it.kind === 'label' ? (it.textStyle || `${it.font || 'sans'}|${it.fontSize || 20}|${it.weight || (it.bold ? 700 : '')}`) : null);
const textColorOf = (it) => (it.kind === 'label' ? (it.colorVar || (it.color ? String(it.color).toLowerCase() : null)) : null);

export const SAME_KINDS = ['fill', 'stroke', 'font', 'textColor', 'component', 'kind'];

/** Todo lo que comparte `prop` con `ref`: { nodes: Set, annos: Set }. */
export function selectSame(json, ref, prop) {
  const key = {
    fill: fillOf, stroke: strokeOf, font: fontOf, textColor: textColorOf,
    component: (it) => it.cinst || it.cmain || null,
    kind: (it) => (it.bbox ? 'a:' + (it.kind === 'path' ? 'path' : it.shape) : 'n:' + (it.kind || 'text')),
  }[prop];
  const out = { nodes: new Set(), annos: new Set() };
  if (!key) return out;
  const want = key(ref);
  if (want == null) return out;
  for (const n of json.nodes || []) if (!n.hidden && key(n) === want) out.nodes.add(n.id);
  for (const a of json.annotations || []) if (!a.hidden && key(a) === want) out.annos.add(a.id);
  return out;
}

// ── Buscar y reemplazar ─────────────────────────────────────────────────────────────────────────────────

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Piezas cuyo texto contiene `find`: [{ type: 'n'|'a', id, text }]. */
export function findText(json, find, { caseSensitive = false } = {}) {
  if (!find) return [];
  const re = new RegExp(escRe(find), caseSensitive ? '' : 'i');
  const out = [];
  for (const n of json.nodes || []) if (typeof n.text === 'string' && re.test(n.text)) out.push({ type: 'n', id: n.id, text: n.text });
  for (const a of json.annotations || []) if (typeof a.text === 'string' && re.test(a.text)) out.push({ type: 'a', id: a.id, text: a.text });
  for (const g of json.groups || []) if (typeof g.title === 'string' && re.test(g.title)) out.push({ type: 'g', id: g.id, text: g.title });
  return out;
}

/** Reemplaza `find` por `replace` en los textos (solo en `only` si se da: Set de 'n:id' / 'a:id' / 'g:id'). */
export function replaceText(json, find, replace, { caseSensitive = false, only = null } = {}) {
  if (!find) return { json, count: 0 };
  const re = new RegExp(escRe(find), caseSensitive ? 'g' : 'gi');
  let count = 0;
  const fix = (s) => s.replace(re, () => { count++; return replace; });
  const ok = (k) => !only || only.has(k);
  const next = {
    ...json,
    nodes: (json.nodes || []).map(n => (typeof n.text === 'string' && ok('n:' + n.id) && re.test(n.text) ? ((re.lastIndex = 0), { ...n, text: fix(n.text) }) : n)),
    annotations: (json.annotations || []).map(a => (typeof a.text === 'string' && ok('a:' + a.id) && re.test(a.text) ? ((re.lastIndex = 0), { ...a, text: fix(a.text) }) : a)),
    groups: (json.groups || []).map(g => (typeof g.title === 'string' && ok('g:' + g.id) && re.test(g.title) ? ((re.lastIndex = 0), { ...g, title: fix(g.title) }) : g)),
  };
  return { json: count ? next : json, count };
}
