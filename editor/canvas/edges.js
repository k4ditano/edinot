// Motor de conectores del canvas (geometría pura, sin React): anclas con rotación,
// rutas recta / curva / ángulo recto (A* esquivando obstáculos), puntas por
// extremo y posición de la etiqueta a lo largo del trazo. Idea del A* tomada de
// AFFiNE (blocks/surface/src/utils/a-star.ts), reescrita sobre una cuadrícula
// dispersa construida con los bordes de los obstáculos.
//
// Modelo de arista (todos los campos nuevos son opcionales; sin ellos la arista
// se comporta como antes):
//   id          identificador estable (las aristas antiguas usan from->to:kind)
//   from / to   id de un nodo O de una anotación-forma (o vacío si el extremo es libre)
//   fromSide / toSide   't'|'r'|'b'|'l': ancla en el centro de ese lado
//   fromX,fromY / toX,toY  extremo libre en coordenadas del mundo (sin nodo)
//   route       'curved' (por defecto) | 'straight' | 'ortho'
//   startHead / endHead  'none'|'arrow'|'triangle'|'circle'|'diamond'
//   arrow       legado: 'forward'|'backward'|'both'|'none'
//   labelT      0..1 posición de la etiqueta a lo largo del trazo (0.5 por defecto)

export const EDGE_SIDES = ['t', 'r', 'b', 'l'];
export const EDGE_HEADS = ['none', 'arrow', 'triangle', 'circle', 'diamond'];
export const EDGE_ROUTES = ['curved', 'straight', 'ortho'];

// Normal exterior de cada lado en el sistema local del rectángulo.
const SIDE_N = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };

const rad = (deg) => (deg || 0) * Math.PI / 180;
function rot(x, y, a) { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }

export function rectCenter(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

// Punto de anclaje en el centro de un lado (rect = {x,y,w,h,rot?}), con su normal exterior ya rotada.
export function anchorPoint(rect, side) {
  const c = rectCenter(rect), a = rad(rect.rot);
  // Formas no rectangulares: el ancla se mete hasta el contorno real (rect.insets, fracciones de w/h).
  const ins = rect.insets || null;
  const lx = side === 'l' ? -(rect.w / 2 - (ins ? ins.l * rect.w : 0)) : side === 'r' ? rect.w / 2 - (ins ? ins.r * rect.w : 0) : 0;
  const ly = side === 't' ? -(rect.h / 2 - (ins ? ins.t * rect.h : 0)) : side === 'b' ? rect.h / 2 - (ins ? ins.b * rect.h : 0) : 0;
  const [px, py] = rot(lx, ly, a);
  const [nx, ny] = rot(SIDE_N[side][0], SIDE_N[side][1], a);
  return { x: c.x + px, y: c.y + py, nx, ny, side };
}

// Lado cuyo ancla queda más cerca de un punto del mundo.
export function nearestSide(rect, p) {
  let best = 't', bd = Infinity;
  for (const s of EDGE_SIDES) {
    const a = anchorPoint(rect, s), d = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// Lado "natural" hacia el que mira `rect` para llegar a `toward` (para el modo ortho/curvo automático).
export function sideToward(rect, toward) {
  const c = rectCenter(rect), a = -rad(rect.rot);
  const [dx, dy] = rot(toward.x - c.x, toward.y - c.y, a);   // al sistema local
  // Comparación normalizada por el tamaño: un rectángulo ancho prefiere salir por arriba/abajo antes.
  const nx = dx / Math.max(1, rect.w), ny = dy / Math.max(1, rect.h);
  return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'r' : 'l') : (ny > 0 ? 'b' : 't');
}

// Punto en el borde del rectángulo (con rotación) en la dirección de `toward` — comportamiento clásico.
export function borderPointToward(rect, toward) {
  if (rect.outline && rect.outline.length > 2) {
    // Forma no rectangular: corta el rayo centro→destino con su contorno real (en el sistema sin rotar).
    const c = rectCenter(rect), a = rad(rect.rot);
    const [dx, dy] = rot(toward.x - c.x, toward.y - c.y, -a);
    if (dx || dy) {
      let best = Infinity;
      const o = rect.outline;
      for (let i = 0; i < o.length; i++) {
        const p = o[i], q = o[(i + 1) % o.length];
        const ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p[0] - c.x) * ey - (p[1] - c.y) * ex) / den, u = ((p[0] - c.x) * dy - (p[1] - c.y) * dx) / den;
        if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
      }
      if (best !== Infinity) {
        const [px, py] = rot(dx * best, dy * best, a);
        const side = Math.abs(dx) / Math.max(1e-9, rect.w) > Math.abs(dy) / Math.max(1e-9, rect.h) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't');
        const [nx, ny] = rot(SIDE_N[side][0], SIDE_N[side][1], a);
        return { x: c.x + px, y: c.y + py, nx, ny, side };
      }
    }
  }
  const c = rectCenter(rect), a = -rad(rect.rot);
  const hw = rect.w / 2, hh = rect.h / 2;
  let [dx, dy] = rot(toward.x - c.x, toward.y - c.y, a);
  if (!dx && !dy) return { x: c.x, y: c.y, nx: 0, ny: 0 };
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  const lx = dx * s, ly = dy * s;
  const side = Math.abs(lx) / Math.max(1e-9, hw) > Math.abs(ly) / Math.max(1e-9, hh) ? (lx > 0 ? 'r' : 'l') : (ly > 0 ? 'b' : 't');
  const [px, py] = rot(lx, ly, -a);
  const [nx, ny] = rot(SIDE_N[side][0], SIDE_N[side][1], -a);
  return { x: c.x + px, y: c.y + py, nx, ny, side };
}

// ---------------------------------------------------------------- extremos

// Resuelve un extremo: ancla fija, punto libre o borde automático hacia `toward`.
export function resolveEnd({ rect, side, free, toward, preferSide }) {
  if (rect) {
    if (side) return anchorPoint(rect, side);
    if (preferSide) return anchorPoint(rect, sideToward(rect, toward));
    return borderPointToward(rect, toward);
  }
  if (free) return { x: free.x, y: free.y, nx: 0, ny: 0, free: true };
  return null;
}

// ---------------------------------------------------------------- trazados
// Un trazado es { type:'poly', pts:[{x,y}...] } o { type:'bez', p:[p0,c1,c2,p3] }.

const STUB = 22;        // tramo recto al salir de un ancla
const MARGIN = 14;      // holgura alrededor de los obstáculos

export function straightPath(a, b) { return { type: 'poly', pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] }; }

export function curvedPath(a, b, useNormals) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  let c1, c2;
  if (useNormals && (a.nx || a.ny || b.nx || b.ny)) {
    const d = Math.max(36, dist * 0.4);
    c1 = { x: a.x + a.nx * d, y: a.y + a.ny * d };
    c2 = { x: b.x + b.nx * d, y: b.y + b.ny * d };
    if (!a.nx && !a.ny) c1 = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 };
    if (!b.nx && !b.ny) c2 = { x: b.x - (b.x - a.x) * 0.3, y: b.y - (b.y - a.y) * 0.3 };
  } else {
    const dx = (b.x - a.x) * 0.45;      // clásico: asas horizontales
    c1 = { x: a.x + dx, y: a.y }; c2 = { x: b.x - dx, y: b.y };
  }
  return { type: 'bez', p: [{ x: a.x, y: a.y }, c1, c2, { x: b.x, y: b.y }] };
}

// -- A* ortogonal sobre una cuadrícula dispersa ---------------------------------

class MinHeap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const n = out.length;
    if (n && Math.abs(out[n - 1].x - p.x) < 0.01 && Math.abs(out[n - 1].y - p.y) < 0.01) continue;
    if (n >= 2) {
      const a = out[n - 2], b = out[n - 1];
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01)) { out[n - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

function zRoute(a, b, a1, b1) {
  // Ruta de respaldo: sale, cruza por el medio y entra (sin esquivar nada).
  const horiz = Math.abs(a1.x - b1.x) >= Math.abs(a1.y - b1.y);
  const pts = [a, a1];
  if (horiz) { const mx = (a1.x + b1.x) / 2; pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y }); }
  else { const my = (a1.y + b1.y) / 2; pts.push({ x: a1.x, y: my }, { x: b1.x, y: my }); }
  pts.push(b1, b);
  return simplify(pts);
}

// a, b: extremos {x,y,nx,ny}; obstacles: [{x,y,w,h}] (ya sin los nodos de los extremos).
export function orthoPath(a, b, obstacles = []) {
  const a1 = { x: a.x + a.nx * STUB, y: a.y + a.ny * STUB };
  const b1 = { x: b.x + b.nx * STUB, y: b.y + b.ny * STUB };
  if (!(a.nx || a.ny)) { a1.x = a.x; a1.y = a.y; }
  if (!(b.nx || b.ny)) { b1.x = b.x; b1.y = b.y; }

  // Sólo cuentan los obstáculos cercanos al corredor entre los dos puntos.
  const R = 240;
  const lo = { x: Math.min(a1.x, b1.x) - R, y: Math.min(a1.y, b1.y) - R }, hi = { x: Math.max(a1.x, b1.x) + R, y: Math.max(a1.y, b1.y) + R };
  let obs = obstacles.filter(o => o.x < hi.x && o.x + o.w > lo.x && o.y < hi.y && o.y + o.h > lo.y)
    .map(o => ({ x0: o.x - MARGIN, y0: o.y - MARGIN, x1: o.x + o.w + MARGIN, y1: o.y + o.h + MARGIN }));
  if (obs.length > 70) {
    const cx = (a1.x + b1.x) / 2, cy = (a1.y + b1.y) / 2;
    obs.sort((p, q) => Math.hypot((p.x0 + p.x1) / 2 - cx, (p.y0 + p.y1) / 2 - cy) - Math.hypot((q.x0 + q.x1) / 2 - cx, (q.y0 + q.y1) / 2 - cy));
    obs = obs.slice(0, 70);
  }
  const inside = (x, y) => { for (const o of obs) if (x > o.x0 + 1e-6 && x < o.x1 - 1e-6 && y > o.y0 + 1e-6 && y < o.y1 - 1e-6) return true; return false; };

  const xsSet = new Set([a1.x, b1.x, (a1.x + b1.x) / 2]), ysSet = new Set([a1.y, b1.y, (a1.y + b1.y) / 2]);
  for (const o of obs) { xsSet.add(o.x0); xsSet.add(o.x1); ysSet.add(o.y0); ysSet.add(o.y1); }
  const xs = [...xsSet].sort((p, q) => p - q), ys = [...ysSet].sort((p, q) => p - q);
  const W = xs.length, H = ys.length;
  if (W * H > 30000) return { type: 'poly', pts: zRoute(a, b, a1, b1) };
  const xi = (x) => xs.findIndex(v => Math.abs(v - x) < 1e-6), yi = (y) => ys.findIndex(v => Math.abs(v - y) < 1e-6);
  const sx = xi(a1.x), sy = yi(a1.y), gx = xi(b1.x), gy = yi(b1.y);
  const blockedNode = (i, j) => inside(xs[i], ys[j]);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const startDir = Math.abs(a.nx) > Math.abs(a.ny) ? (a.nx > 0 ? 0 : 1) : (a.ny > 0 ? 2 : 3);
  const key = (i, j, d) => (j * W + i) * 5 + d;
  const g = new Map(), prev = new Map();
  const heap = new MinHeap();
  const h = (i, j) => Math.abs(xs[i] - xs[gx]) + Math.abs(ys[j] - ys[gy]);
  const hasDir = !!(a.nx || a.ny);
  const d0 = hasDir ? startDir : 4;            // 4 = sin dirección inicial (extremo libre)
  g.set(key(sx, sy, d0), 0); heap.push(h(sx, sy), [sx, sy, d0, hasDir ? 1 : 0]);
  const TURN = 28;
  let found = null, expansions = 0;
  while (heap.size && expansions++ < 12000) {
    const [, [i, j, d, locked]] = heap.pop();
    const cur = g.get(key(i, j, d));
    if (i === gx && j === gy) { found = key(i, j, d); break; }
    for (let nd = 0; nd < 4; nd++) {
      if (locked && nd !== d) continue;                    // el primer paso sale por la normal del ancla
      if (d < 4 && nd === (d ^ 1) && !locked) continue;     // sin giros de 180°
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      if (blockedNode(ni, nj)) continue;
      const mx = (xs[i] + xs[ni]) / 2, my = (ys[j] + ys[nj]) / 2;
      if (inside(mx, my)) continue;                         // el tramo cruza un obstáculo
      const cost = cur + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (d < 4 && nd !== d && !locked ? TURN : 0);
      const k = key(ni, nj, nd);
      if (cost < (g.get(k) ?? Infinity)) { g.set(k, cost); prev.set(k, key(i, j, d)); heap.push(cost + h(ni, nj), [ni, nj, nd, 0]); }
    }
  }
  if (found == null) return { type: 'poly', pts: zRoute(a, b, a1, b1) };
  const pts = [];
  for (let k = found; k != null; k = prev.get(k)) { const c = Math.floor(k / 5); pts.push({ x: xs[c % W], y: ys[Math.floor(c / W)] }); }
  pts.reverse();
  return { type: 'poly', pts: simplify([{ x: a.x, y: a.y }, ...pts, { x: b.x, y: b.y }]) };
}

// ---------------------------------------------------------------- utilidades de trazado

export function flatten(path, steps = 28) {
  if (path.type === 'poly') return path.pts;
  const [p0, c1, c2, p3] = path.p, out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
               y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y });
  }
  return out;
}

export function pathLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }

// Punto (y tangente) a fracción t de la longitud del trazado aplanado.
export function pointAt(pts, t) {
  const total = pathLength(pts) || 1;
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (target <= seg || i === pts.length - 1) {
      const k = seg ? Math.min(1, target / seg) : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k, ang: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) };
    }
    target -= seg;
  }
  return { x: pts[0].x, y: pts[0].y, ang: 0 };
}

// Fracción t del trazado más cercana a un punto (para arrastrar la etiqueta a lo largo del trazo).
export function closestT(pts, p) {
  const total = pathLength(pts) || 1;
  let best = 0, bd = Infinity, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
    const dx = bx - ax, dy = by - ay, seg2 = dx * dx + dy * dy, seg = Math.sqrt(seg2);
    const k = seg2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / seg2)) : 0;
    const qx = ax + dx * k, qy = ay + dy * k, d = (p.x - qx) ** 2 + (p.y - qy) ** 2;
    if (d < bd) { bd = d; best = acc + seg * k; }
    acc += seg;
  }
  return best / total;
}

export function pathToD(path) {
  if (path.type === 'bez') { const [p0, c1, c2, p3] = path.p; return `M ${p0.x},${p0.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`; }
  return 'M ' + path.pts.map(p => `${p.x},${p.y}`).join(' L ');
}

// Tangentes de salida en cada extremo (ángulo del movimiento al ENTRAR en el extremo final y al SALIR del inicial).
export function endAngles(path) {
  if (path.type === 'bez') {
    const [p0, c1, c2, p3] = path.p;
    const s = (c1.x === p0.x && c1.y === p0.y) ? c2 : c1, e = (c2.x === p3.x && c2.y === p3.y) ? c1 : c2;
    return { start: Math.atan2(s.y - p0.y, s.x - p0.x), end: Math.atan2(p3.y - e.y, p3.x - e.x) };
  }
  const p = path.pts, n = p.length;
  return { start: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x), end: Math.atan2(p[n - 1].y - p[n - 2].y, p[n - 1].x - p[n - 2].x) };
}

// ---------------------------------------------------------------- puntas

export function headSize(sw) { return Math.max(9, sw * 4.5 + 4); }

// Geometría de una punta en `tip` apuntando hacia `ang` (el ángulo en el que el trazo llega a la punta).
// Devuelve { kind, d?, circle?, filled, inset } — `inset` = cuánto hay que acortar el trazo para que no asome.
export function headGeom(kind, tip, ang, sw = 1.6) {
  if (!kind || kind === 'none') return null;
  const L = headSize(sw), c = Math.cos(ang), s = Math.sin(ang);
  const at = (back, side) => ({ x: tip.x - c * back - s * side, y: tip.y - s * back + c * side });
  if (kind === 'arrow') {
    const p1 = at(L, L * 0.5), p2 = at(L, -L * 0.5);
    return { kind, d: `M ${p1.x},${p1.y} L ${tip.x},${tip.y} L ${p2.x},${p2.y}`, filled: false, inset: 0 };
  }
  if (kind === 'triangle') {
    const p1 = at(L, L * 0.5), p2 = at(L, -L * 0.5);
    return { kind, d: `M ${tip.x},${tip.y} L ${p1.x},${p1.y} L ${p2.x},${p2.y} Z`, filled: true, inset: L * 0.9 };
  }
  if (kind === 'diamond') {
    const m = at(L / 2, 0), p1 = at(L / 2, L * 0.4), p2 = at(L / 2, -L * 0.4), back = at(L, 0);
    return { kind, d: `M ${tip.x},${tip.y} L ${p1.x},${p1.y} L ${back.x},${back.y} L ${p2.x},${p2.y} Z`, filled: true, inset: L * 0.9, _m: m };
  }
  if (kind === 'circle') {
    const r = L * 0.34, ctr = at(r, 0);
    return { kind, circle: { cx: ctr.x, cy: ctr.y, r }, filled: true, inset: r * 2 };
  }
  return null;
}

// Acorta un trazado por sus extremos (para que la línea acabe en la base de la punta).
export function trimPath(path, startInset, endInset) {
  if (!startInset && !endInset) return path;
  const move = (p, q, d) => { const L = Math.hypot(q.x - p.x, q.y - p.y) || 1, k = Math.min(d, L * 0.45) / L; return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k }; };
  if (path.type === 'bez') {
    const [p0, c1, c2, p3] = path.p;
    const np0 = startInset ? move(p0, (c1.x === p0.x && c1.y === p0.y) ? c2 : c1, startInset) : p0;
    const np3 = endInset ? move(p3, (c2.x === p3.x && c2.y === p3.y) ? c1 : c2, endInset) : p3;
    return { type: 'bez', p: [np0, c1, c2, np3] };
  }
  const pts = path.pts.map(p => ({ ...p })), n = pts.length;
  if (startInset) pts[0] = move(pts[0], pts[1], startInset);
  if (endInset) pts[n - 1] = move(pts[n - 1], pts[n - 2], endInset);
  return { type: 'poly', pts };
}

// Puntas efectivas de una arista, aceptando el campo legado `arrow`.
export function edgeHeads(e) {
  let start = 'none', end = 'arrow';
  const arrow = e.arrow || 'forward';
  if (arrow === 'backward') { start = 'arrow'; end = 'none'; }
  else if (arrow === 'both') { start = 'arrow'; end = 'arrow'; }
  else if (arrow === 'none') { start = 'none'; end = 'none'; }
  if (e.startHead && EDGE_HEADS.includes(e.startHead)) start = e.startHead;
  if (e.endHead && EDGE_HEADS.includes(e.endHead)) end = e.endHead;
  return { start, end };
}

// ---------------------------------------------------------------- orquestador

// Calcula todo lo necesario para pintar una arista.
//   e         arista
//   rectOf    id → { x, y, w, h, rot? } | null (nodo o anotación)
//   obstacles rects a esquivar (sólo para route 'ortho')
// Devuelve null si algún extremo no se puede resolver.
export const edgeKeyOf = (e) => e.id || `${e.from}->${e.to}:${e.kind || 'manual'}`;

// `obstacles` puede ser un array o una función (lo, hi) => rects que sólo se evalúa en el modo 'ortho'.
export function layoutEdge(e, rectOf, obstacles = []) {
  const ra = e.from ? rectOf(e.from) : null, rb = e.to ? rectOf(e.to) : null;
  const fa = (!ra && e.fromX != null) ? { x: e.fromX, y: e.fromY } : null;
  const fb = (!rb && e.toX != null) ? { x: e.toX, y: e.toY } : null;
  if ((!ra && !fa) || (!rb && !fb)) return null;
  const route = e.route || 'curved';
  const anchored = !!(e.fromSide || e.toSide);
  const centerA = ra ? rectCenter(ra) : fa, centerB = rb ? rectCenter(rb) : fb;
  const preferSide = route === 'ortho';
  const a = resolveEnd({ rect: ra, side: e.fromSide, free: fa, toward: rb && !e.toSide ? centerB : (rb && e.toSide ? anchorPoint(rb, e.toSide) : centerB), preferSide });
  const b = resolveEnd({ rect: rb, side: e.toSide, free: fb, toward: ra && !e.fromSide ? centerA : (ra && e.fromSide ? anchorPoint(ra, e.fromSide) : centerA), preferSide });
  let path;
  if (route === 'straight') path = straightPath(a, b);
  else if (route === 'ortho') {
    let obs = obstacles;
    if (typeof obstacles === 'function') {
      const R = 260;
      obs = obstacles({ x: Math.min(a.x, b.x) - R, y: Math.min(a.y, b.y) - R }, { x: Math.max(a.x, b.x) + R, y: Math.max(a.y, b.y) + R });
    }
    path = orthoPath(a, b, obs);
  }
  else path = curvedPath(a, b, anchored);
  return { a, b, path, route, heads: edgeHeads(e) };
}
