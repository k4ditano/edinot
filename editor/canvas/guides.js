// Guías inteligentes al mover (como en Figma). Lógica pura, sin React.
//
//   snapMove(box, others, snap) → { dx, dy, v, h, gaps }
//     box     la caja que se mueve, ya desplazada por el ratón { x, y, w, h }
//     others  cajas de los demás elementos (fichas y dibujos)
//     snap    distancia de imán en unidades del mundo
//   dx/dy     corrección a sumar para quedar alineado / con espaciado igual
//   v / h     líneas de alineación verticales (x) y horizontales (y)
//   gaps      segmentos de medida { x1, y1, x2, y2, label } (espaciado igual y distancia a los vecinos)

const ov = (a0, a1, b0, b1) => a0 < b1 && a1 > b0;

function snapAxis(lines, cands, snap) {
  let best = null, bestAbs = snap, at = null;
  for (const ln of lines) for (const c of cands) {
    const d = c - ln;
    if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = d; at = c; }
  }
  return best == null ? null : { delta: best, at };
}

export function snapMove(box, others, snap) {
  const out = { dx: 0, dy: 0, v: [], h: [], gaps: [] };
  if (!others.length) return out;
  const xc = [], yc = [];
  for (const o of others) { xc.push(o.x, o.x + o.w / 2, o.x + o.w); yc.push(o.y, o.y + o.h / 2, o.y + o.h); }
  const sx = snapAxis([box.x, box.x + box.w / 2, box.x + box.w], xc, snap);
  const sy = snapAxis([box.y, box.y + box.h / 2, box.y + box.h], yc, snap);
  if (sx) { out.dx = sx.delta; out.v.push(sx.at); }
  if (sy) { out.dy = sy.delta; out.h.push(sy.at); }

  // Vecinos más cercanos a cada lado (que se solapen en el otro eje).
  const near = (bx, by) => {
    let L = null, R = null, T = null, B = null;
    for (const o of others) {
      if (ov(by, by + box.h, o.y, o.y + o.h)) {
        if (o.x + o.w <= bx + snap && (!L || o.x + o.w > L.x + L.w)) L = o;
        if (o.x >= bx + box.w - snap && (!R || o.x < R.x)) R = o;
      }
      if (ov(bx, bx + box.w, o.x, o.x + o.w)) {
        if (o.y + o.h <= by + snap && (!T || o.y + o.h > T.y + T.h)) T = o;
        if (o.y >= by + box.h - snap && (!B || o.y < B.y)) B = o;
      }
    }
    return { L, R, T, B };
  };
  let n = near(box.x + out.dx, box.y + out.dy);
  // Espaciado igual: centrada entre el vecino de cada lado.
  let eqX = false, eqY = false;
  if (!sx && n.L && n.R) {
    const xt = (n.L.x + n.L.w + n.R.x - box.w) / 2;
    if (Math.abs(box.x - xt) < snap) { out.dx = xt - box.x; eqX = true; }
  }
  if (!sy && n.T && n.B) {
    const yt = (n.T.y + n.T.h + n.B.y - box.h) / 2;
    if (Math.abs(box.y - yt) < snap) { out.dy = yt - box.y; eqY = true; }
  }
  const fx = box.x + out.dx, fy = box.y + out.dy;
  n = near(fx, fy);
  const r = (v) => Math.round(v);
  const cy = fy + box.h / 2, cx = fx + box.w / 2;
  // Medidas a los vecinos (las dos si hay espaciado igual; si no, solo las cercanas, < 400 unidades).
  const MAXD = 400;
  if (n.L && (eqX || fx - (n.L.x + n.L.w) < MAXD)) out.gaps.push({ x1: n.L.x + n.L.w, y1: cy, x2: fx, y2: cy, label: r(fx - (n.L.x + n.L.w)), eq: eqX });
  if (n.R && (eqX || n.R.x - (fx + box.w) < MAXD)) out.gaps.push({ x1: fx + box.w, y1: cy, x2: n.R.x, y2: cy, label: r(n.R.x - (fx + box.w)), eq: eqX });
  if (n.T && (eqY || fy - (n.T.y + n.T.h) < MAXD)) out.gaps.push({ x1: cx, y1: n.T.y + n.T.h, x2: cx, y2: fy, label: r(fy - (n.T.y + n.T.h)), eq: eqY });
  if (n.B && (eqY || n.B.y - (fy + box.h) < MAXD)) out.gaps.push({ x1: cx, y1: fy + box.h, x2: cx, y2: n.B.y, label: r(n.B.y - (fy + box.h)), eq: eqY });
  out.gaps = out.gaps.filter(g => g.label > 0);
  return out;
}

/** Cajas de los dibujos en el mundo (bbox + desplazamiento), sin los indicados. */
export function annoBoxes(annotations, skip) {
  const out = [];
  for (const a of annotations || []) {
    if (!a.bbox || a.hidden || (skip && skip.has(a.id))) continue;
    out.push({ x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h });
  }
  return out;
}
