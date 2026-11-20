// Auto layout (como en Figma), lógica pura. Un marco (grupo con título) con `layout` coloca solo a sus hijos:
//
//   layout = { dir: 'column' | 'row' | 'grid',
//              gap: 16, pad: 16, align: 'start' | 'center' | 'end', hug: true|false,
//              wrap: true|false, gapCross: 16,              (fila/columna con salto de línea)
//              columns: 3, gapY: 16 }                       (rejilla, como CSS Grid)
//
// Hijos = fichas, dibujos y marcos cuyo centro cae dentro del marco (en el marco más pequeño que lo contenga). Un
// grupo ligero (`grp`) cuenta como una sola pieza; un marco hijo, también (con todo lo que tiene dentro). El orden es
// el de su posición actual, así que arrastrar un hijo y soltarlo en otro sitio lo reordena.
// Cada hijo puede llevar (en la propia pieza):
//   sizeW / sizeH: 'fixed' (por omisión) | 'fill'   rellenar el espacio del marco
//   minW, maxW, minH, maxH                          límites al rellenar
//   layoutAbsolute: true                            fuera del auto layout (se queda donde esté)
//   span: 2                                         columnas que ocupa en una rejilla
// Los marcos se resuelven de dentro afuera (un marco hijo que se ajusta a su contenido ya tiene su tamaño cuando
// lo coloca el padre). Devuelve el mismo objeto si no hay nada que mover.

import { resolveFrameVars } from '../../shared/canvas-vars.js';

export const FRAME_HEAD = 26;   // alto de la cabecera del marco (título)
const DEF_W = 240, DEF_H = 140, GROUP_W = 480, GROUP_H = 320;

const nodeRect = (n) => ({ x: n.x || 0, y: n.y || 0, w: n.w || DEF_W, h: n.h || DEF_H });
const annoRect = (a) => (a.bbox ? { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h } : null);
export const frameRect = (g) => ({ x: g.x || 0, y: g.y || 0, w: g.w || GROUP_W, h: g.h || GROUP_H });
const inside = (r, f) => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h; };
const area = (r) => r.w * r.h;
const union = (a, b) => (a ? (() => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }; })() : { ...b });
const clamp = (v, lo, hi) => Math.max(lo ?? -Infinity, Math.min(hi ?? Infinity, v));
const r1 = (n) => Math.round(n * 10) / 10;

/** Árbol de marcos: padre de cada marco y dueño (marco) de cada pieza. */
export function frameTree(json) {
  const groups = json.groups || [];
  const sized = groups.map(g => ({ g, r: frameRect(g) })).sort((a, b) => area(a.r) - area(b.r));
  const ownerOf = (r, self) => { for (const f of sized) if (f.g.id !== self && area(f.r) > area(r) && inside(r, f.r)) return f.g.id; return null; };
  const ownerItem = (r) => { for (const f of sized) if (inside(r, f.r)) return f.g.id; return null; };
  const parent = new Map(groups.map(g => [g.id, ownerOf(frameRect(g), g.id)]));
  return { parent, ownerItem };
}

/** Piezas de cada marco: Map frameId → [unidad]. Unidad = { nodes, annos, groups, rect, items }. */
export function frameMembers(json) {
  const { parent, ownerItem } = frameTree(json);
  const out = new Map((json.groups || []).map(g => [g.id, []]));
  const units = new Map();
  const add = (kind, item, r) => {
    if (!r || item.hidden || item.kind === 'page') return;
    const key = item.grp ? 'g:' + item.grp : kind + ':' + item.id;
    let u = units.get(key);
    if (!u) { u = { nodes: [], annos: [], groups: [], rect: null, items: [] }; units.set(key, u); }
    (kind === 'n' ? u.nodes : u.annos).push(item.id);
    u.items.push({ kind, item });
    u.rect = union(u.rect, r);
  };
  for (const n of json.nodes || []) add('n', n, nodeRect(n));
  for (const a of json.annotations || []) add('a', a, annoRect(a));
  for (const u of units.values()) { const f = ownerItem(u.rect); if (f) out.get(f).push(u); }
  // Marcos hijos como unidades de su padre (con todo lo suyo dentro, para moverlos juntos).
  const descend = (gid, acc) => {
    acc.groups.push(gid);
    for (const u of out.get(gid) || []) { if (u.frame) continue; acc.nodes.push(...u.nodes); acc.annos.push(...u.annos); }
    for (const [cid, p] of parent) if (p === gid) descend(cid, acc);
    return acc;
  };
  for (const g of json.groups || []) {
    const p = parent.get(g.id);
    if (!p) continue;
    const acc = descend(g.id, { nodes: [], annos: [], groups: [] });
    out.get(p).push({ ...acc, rect: frameRect(g), frame: g, items: [] });
  }
  return out;
}

// ¿Cómo se dimensiona esta unidad? (solo piezas sueltas o marcos hijos pueden rellenar)
const sizing = (u) => {
  const it = u.frame || (u.items.length === 1 ? u.items[0].item : null);
  if (!it) return { w: 'fixed', h: 'fixed' };
  return { w: it.sizeW || 'fixed', h: it.sizeH || 'fixed', minW: it.minW, maxW: it.maxW, minH: it.minH, maxH: it.maxH, span: Math.max(1, Math.round(it.span || 1)) };
};
const isAbsolute = (u) => (u.frame ? !!u.frame.layoutAbsolute : u.items.some(x => x.item.layoutAbsolute));

/** Coloca las unidades de un marco. Devuelve [{ unit, x, y, w, h }] y el tamaño final del marco. */
// Un marco con auto layout nunca deja a sus hijos fuera: si el contenido no cabe (p. ej. al estrecharlo con salto de
// línea), crece lo justo para contenerlo. Sin esto, lo que se sale dejaría de ser suyo en la siguiente pasada.
function growToFit(res, f, pad) {
  let w = res.w, h = res.h;
  for (const p of res.placed) {
    w = Math.max(w, p.x + p.w + pad - f.x);
    h = Math.max(h, p.y + p.h + pad - f.y);
  }
  return { ...res, w: Math.ceil(w), h: Math.ceil(h) };
}

export function layoutFrame(g, units) {
  const L = g.layout;
  const f = frameRect(g);
  const gap = Number.isFinite(L.gap) ? L.gap : 16, pad = Number.isFinite(L.pad) ? L.pad : 16;
  const gapCross = Number.isFinite(L.gapCross) ? L.gapCross : gap;
  const al = L.align || 'start';
  const list = units.filter(u => !isAbsolute(u));
  const placed = [];
  let fw = f.w, fh = f.h;
  const innerW = () => fw - pad * 2, innerH = () => fh - FRAME_HEAD - pad * 2;
  const top0 = f.y + FRAME_HEAD + pad, left0 = f.x + pad;

  if (L.dir === 'grid') {
    const cols = Math.max(1, Math.round(L.columns || 2));
    const gapY = Number.isFinite(L.gapY) ? L.gapY : gap;
    list.sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
    // Ancho de celda: del marco, o (si se ajusta al contenido) del hijo más ancho por columna.
    let cellW = (innerW() - gap * (cols - 1)) / cols;
    if (L.hug) cellW = Math.max(...list.map(u => u.rect.w / sizing(u).span - gap * (sizing(u).span - 1) / sizing(u).span), 1);
    let col = 0, rowY = top0, rowH = 0, rowItems = [];
    const flushRow = () => {
      for (const p of rowItems) {
        const s = sizing(p.unit);
        if (s.h === 'fill') p.h = clamp(rowH, s.minH, s.maxH);
        if (al === 'center') p.y = rowY + (rowH - p.h) / 2; else if (al === 'end') p.y = rowY + rowH - p.h; else p.y = rowY;
      }
      rowY += rowH + gapY; rowH = 0; rowItems = []; col = 0;
    };
    for (const u of list) {
      const s = sizing(u);
      const span = Math.min(cols, s.span);
      if (col + span > cols) flushRow();
      const cw = cellW * span + gap * (span - 1);
      const w = s.w === 'fill' ? clamp(cw, s.minW, s.maxW) : u.rect.w;
      const x = left0 + col * (cellW + gap) + (s.w === 'fill' ? 0 : al === 'center' ? (cw - w) / 2 : al === 'end' ? cw - w : 0);
      const p = { unit: u, x, y: rowY, w, h: u.rect.h };
      placed.push(p); rowItems.push(p);
      rowH = Math.max(rowH, s.h === 'fill' ? 0 : u.rect.h);
      col += span;
      if (col >= cols) flushRow();
    }
    if (rowItems.length) flushRow();
    if (L.hug) { fw = cellW * cols + gap * (cols - 1) + pad * 2; fh = (rowY - gapY) - f.y + pad; }
    return growToFit({ placed, w: fw, h: fh }, f, pad);
  }

  const row = L.dir === 'row';
  // Orden: por posición en el eje principal; con salto de línea, primero por línea (eje cruzado) y luego por posición.
  const cx = (r) => r.x + r.w / 2, cy = (r) => r.y + r.h / 2;
  list.sort((a, b) => {
    if (L.wrap) {
      const dc = row ? cy(a.rect) - cy(b.rect) : cx(a.rect) - cx(b.rect);
      const tol = Math.min(row ? a.rect.h : a.rect.w, row ? b.rect.h : b.rect.w) / 2;
      if (Math.abs(dc) > tol) return dc;
    }
    return row ? cx(a.rect) - cx(b.rect) : cy(a.rect) - cy(b.rect);
  });
  const main = (r) => (row ? r.w : r.h), cross = (r) => (row ? r.h : r.w);
  // Líneas (una sola sin wrap; con wrap, se parte cuando no cabe en el eje principal del marco).
  const lines = [[]];
  const limit = row ? innerW() : innerH();
  let acc = 0;
  for (const u of list) {
    const m = sizing(u)[row ? 'w' : 'h'] === 'fill' ? 0 : main(u.rect);
    const cur = lines[lines.length - 1];
    if (L.wrap && !L.hug && cur.length && acc + gap + m > limit) { lines.push([u]); acc = m; }
    else { cur.push(u); acc += (cur.length > 1 ? gap : 0) + m; }
  }
  let crossOff = 0, maxMain = 0;
  for (const line of lines) {
    if (!line.length) continue;
    const fixedMain = line.reduce((s, u) => s + (sizing(u)[row ? 'w' : 'h'] === 'fill' ? 0 : main(u.rect)), 0) + gap * (line.length - 1);
    const fills = line.filter(u => sizing(u)[row ? 'w' : 'h'] === 'fill');
    const free = Math.max(0, limit - fixedMain);
    const each = fills.length ? free / fills.length : 0;
    const lineCross = Math.max(...line.map(u => (sizing(u)[row ? 'h' : 'w'] === 'fill' ? 0 : cross(u.rect))), 0);
    const crossInner = lines.length === 1 && !L.hug ? (row ? innerH() : innerW()) : lineCross;
    let cur = row ? left0 : top0;
    for (const u of line) {
      const s = sizing(u);
      let w = u.rect.w, h = u.rect.h;
      if (row) {
        if (s.w === 'fill') w = clamp(each, s.minW, s.maxW);
        if (s.h === 'fill') h = clamp(crossInner, s.minH, s.maxH);
      } else {
        if (s.h === 'fill') h = clamp(each, s.minH, s.maxH);
        if (s.w === 'fill') w = clamp(crossInner, s.minW, s.maxW);
      }
      const c0 = (row ? top0 : left0) + crossOff;
      const cs = row ? h : w;
      const cpos = al === 'center' ? c0 + (crossInner - cs) / 2 : al === 'end' ? c0 + crossInner - cs : c0;
      placed.push(row ? { unit: u, x: cur, y: cpos, w, h } : { unit: u, x: cpos, y: cur, w, h });
      cur += (row ? w : h) + gap;
    }
    maxMain = Math.max(maxMain, cur - gap - (row ? left0 : top0));
    crossOff += crossInner + gapCross;
  }
  if (L.hug) {
    const usedCross = crossOff - gapCross;
    if (row) { fw = maxMain + pad * 2; fh = FRAME_HEAD + usedCross + pad * 2; }
    else { fh = FRAME_HEAD + maxMain + pad * 2; fw = usedCross + pad * 2; }
  }
  return growToFit({ placed, w: fw, h: fh }, f, pad);
}

// Aplica una colocación a la json: mueve (y si rellena, redimensiona) cada unidad.
function applyPlacement(json, g, res) {
  const moveN = new Map(), moveA = new Map(), moveG = new Map(), sizeN = new Map(), sizeA = new Map(), sizeG = new Map();
  for (const p of res.placed) {
    const u = p.unit;
    const dx = r1(p.x - u.rect.x), dy = r1(p.y - u.rect.y);
    const dw = r1(p.w - u.rect.w), dh = r1(p.h - u.rect.h);
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
      for (const id of u.nodes) moveN.set(id, [dx, dy]);
      for (const id of u.annos) moveA.set(id, [dx, dy]);
      for (const id of u.groups) moveG.set(id, [dx, dy]);
    }
    if (Math.abs(dw) >= 0.5 || Math.abs(dh) >= 0.5) {
      if (u.frame) sizeG.set(u.frame.id, [r1(p.w), r1(p.h)]);
      else if (u.items.length === 1) (u.items[0].kind === 'n' ? sizeN : sizeA).set(u.items[0].item.id, [r1(p.w), r1(p.h)]);
    }
  }
  const resizeSelf = Math.abs(res.w - frameRect(g).w) >= 0.5 || Math.abs(res.h - frameRect(g).h) >= 0.5;
  if (!moveN.size && !moveA.size && !moveG.size && !sizeN.size && !sizeA.size && !sizeG.size && !resizeSelf) return json;
  const resizeAnno = (a, w, h) => {
    if (a.kind !== 'shape' || a.w == null) return a;
    const x = a.x, y = a.y;
    return { ...a, w, h, bbox: { x, y, w, h } };
  };
  return {
    ...json,
    nodes: (json.nodes || []).map(n => {
      let r = n; const m = moveN.get(n.id), s = sizeN.get(n.id);
      if (m) r = { ...r, x: (r.x || 0) + m[0], y: (r.y || 0) + m[1] };
      if (s) r = { ...r, w: s[0], h: s[1] };
      return r;
    }),
    annotations: (json.annotations || []).map(a => {
      let r = a; const m = moveA.get(a.id), s = sizeA.get(a.id);
      if (m) r = { ...r, ox: (r.ox || 0) + m[0], oy: (r.oy || 0) + m[1] };
      if (s) r = resizeAnno(r, s[0], s[1]);
      return r;
    }),
    groups: (json.groups || []).map(x => {
      let r = x; const m = moveG.get(x.id), s = sizeG.get(x.id);
      if (m) r = { ...r, x: (r.x || 0) + m[0], y: (r.y || 0) + m[1] };
      if (s) r = { ...r, w: s[0], h: s[1] };
      if (x.id === g.id && resizeSelf) r = { ...r, w: Math.round(res.w), h: Math.round(res.h) };
      return r;
    }),
  };
}

export function applyAutoLayout(json) {
  if (!(json.groups || []).some(g => g.layout)) return json;
  let j = json;
  // Varias pasadas (de dentro afuera) hasta que no cambie nada: un marco hijo que se ajusta o rellena cambia de
  // tamaño y el padre tiene que volver a colocarlo.
  for (let pass = 0; pass < 4; pass++) {
    const before = j;
    const { parent } = frameTree(j);
    const depth = (id) => { let d = 0, p = parent.get(id); while (p && d < 20) { d++; p = parent.get(p); } return d; };
    const order = (j.groups || []).filter(g => g.layout).map(g => g.id).sort((a, b) => depth(b) - depth(a));
    for (const id of order) {
      const g = (j.groups || []).find(x => x.id === id);
      if (!g || !g.layout) continue;
      const units = frameMembers(j).get(id) || [];
      if (!units.length) continue;
      j = applyPlacement(j, g, layoutFrame(resolveFrameVars(g, j.vars), units));
    }
    if (j === before) break;
  }
  return j;
}

// ── Restricciones (marcos sin auto layout) ──────────────────────────────
// Al redimensionar un marco, cada hijo con `constraints = { h, v }` sigue a su borde:
//   h: 'left' | 'right' | 'center' | 'stretch' | 'scale'      v: 'top' | 'bottom' | 'center' | 'stretch' | 'scale'
// Sin restricciones, se queda donde estaba (izquierda/arriba), como en Figma.
export function applyConstraints(json, frameId, oldRect, newRect) {
  const g = (json.groups || []).find(x => x.id === frameId);
  if (!g) return json;
  // Qué hay dentro se decide con el marco en su sitio de ANTES (si se ha movido lejos, ya no lo contendría).
  const before = { ...json, groups: (json.groups || []).map(x => (x.id === frameId ? { ...x, ...oldRect } : x)) };
  const units = frameMembers(before).get(frameId) || [];
  if (!units.length) return json;
  if (g.layout) {
    // Con auto layout manda el layout; solo hay que llevar a los hijos dentro del marco nuevo (en proporción, para que
    // conserven su orden) y que el layout los recoloque al aplicarse.
    const kx = oldRect.w ? newRect.w / oldRect.w : 1, ky = oldRect.h ? newRect.h / oldRect.h : 1;
    const ix0 = newRect.x + 1, iy0 = newRect.y + FRAME_HEAD + 1, ix1 = newRect.x + newRect.w - 1, iy1 = newRect.y + newRect.h - 1;
    const placed = units.map(u => {
      const w = Math.min(u.rect.w, Math.max(4, ix1 - ix0)), h = Math.min(u.rect.h, Math.max(4, iy1 - iy0));
      let x = newRect.x + (u.rect.x - oldRect.x) * kx, y = newRect.y + FRAME_HEAD + (u.rect.y - oldRect.y - FRAME_HEAD) * ky;
      x = Math.max(ix0, Math.min(x, ix1 - w)); y = Math.max(iy0, Math.min(y, iy1 - h));
      return { unit: u, x, y, w, h };
    });
    return applyPlacement(json, { ...g, ...newRect }, { placed, w: newRect.w, h: newRect.h });
  }
  const map = (c, o0, o1, n0, n1, p0, p1) => {
    const oldLen = o1 - o0, newLen = n1 - n0;
    switch (c) {
      case 'right': case 'bottom': return [p0 + (n1 - o1), p1 + (n1 - o1)];
      case 'center': { const d = (n0 + n1) / 2 - (o0 + o1) / 2; return [p0 + d, p1 + d]; }
      case 'stretch': return [p0 + (n0 - o0), p1 + (n1 - o1)];
      case 'scale': { const k = oldLen ? newLen / oldLen : 1; return [n0 + (p0 - o0) * k, n0 + (p1 - o0) * k]; }
      default: return [p0 + (n0 - o0), p1 + (n0 - o0)];
    }
  };
  const res = [];
  for (const u of units) {
    const it = u.frame || (u.items.length === 1 ? u.items[0].item : null) || (u.items[0] && u.items[0].item);
    const c = (it && it.constraints) || {};
    const [x0, x1] = map(c.h || 'left', oldRect.x, oldRect.x + oldRect.w, newRect.x, newRect.x + newRect.w, u.rect.x, u.rect.x + u.rect.w);
    const [y0, y1] = map(c.v || 'top', oldRect.y + FRAME_HEAD, oldRect.y + oldRect.h, newRect.y + FRAME_HEAD, newRect.y + newRect.h, u.rect.y, u.rect.y + u.rect.h);
    const canResize = u.frame || u.items.length === 1;
    res.push({ unit: u, x: x0, y: y0, w: canResize ? Math.max(4, x1 - x0) : u.rect.w, h: canResize ? Math.max(4, y1 - y0) : u.rect.h });
  }
  return applyPlacement(json, { ...g, ...newRect }, { placed: res, w: newRect.w, h: newRect.h });
}
