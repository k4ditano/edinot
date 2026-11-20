// Goma tipo Paint (lógica pura, sin React): borra solo por donde pasa.
//
// Los trazos a mano (`kind: 'path'`, con sus puntos `pts`) se cortan: se quitan los puntos que caen dentro
// del radio de la goma y lo que queda a cada lado sigue siendo un trazo. Lo demás (formas, líneas, flechas)
// no se puede partir: si la goma lo toca, se borra entero, como hacía la goma de antes.

// (Sin importar strokes.jsx, que es JSX: quien llama pasa `rebuild(a, pts)` para rehacer el trazo `d`.)
const round = (pts) => pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round((p[2] != null ? p[2] : 0.5) * 100) / 100]);
const bboxOf = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// Puntos intermedios para que un trazo rápido (puntos muy separados) también se pueda cortar por el medio.
export function densify(pts, step) {
  if (!pts || pts.length < 2 || !(step > 0)) return pts || [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor(d / step);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] ?? 0.5) + ((b[2] ?? 0.5) - (a[2] ?? 0.5)) * t]);
    }
    out.push(b);
  }
  return out;
}

// Distancia de un punto a un segmento.
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// ¿Toca la goma (polilínea `path` en coordenadas del mundo, radio r) el punto p?
function hit(p, path, r) {
  if (path.length === 1) return Math.hypot(p[0] - path[0][0], p[1] - path[0][1]) <= r;
  for (let i = 1; i < path.length; i++) if (distSeg(p[0], p[1], path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) <= r) return true;
  return false;
}

const bboxNear = (b, path, r) => {
  if (!b) return true;
  for (const q of path) if (q[0] >= b.x - r && q[0] <= b.x + b.w + r && q[1] >= b.y - r && q[1] <= b.y + b.h + r) return true;
  // la goma puede cruzar la caja sin dejar un punto dentro: se comprueba con segmentos
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], c = path[i];
    const minX = Math.min(a[0], c[0]) - r, maxX = Math.max(a[0], c[0]) + r, minY = Math.min(a[1], c[1]) - r, maxY = Math.max(a[1], c[1]) + r;
    if (maxX >= b.x && minX <= b.x + b.w && maxY >= b.y && minY <= b.y + b.h) return true;
  }
  return false;
};

/**
 * Corta un trazo con la goma. `path` = puntos de la goma en el mundo; `r` = radio de la goma.
 * Devuelve null si no lo toca, o la lista de trozos que quedan (puede ser vacía: se borró entero).
 * `newId` da el id de cada trozo nuevo (el primero conserva el id original).
 */
export function eraseStroke(a, path, r, newId, rebuild = (x) => x.d) {
  if (!a || a.kind !== 'path' || !Array.isArray(a.pts) || a.pts.length < 1) return null;
  const ox = a.ox || 0, oy = a.oy || 0;
  const local = path.map(p => [p[0] - ox, p[1] - oy]);
  const reach = r + (a.variant === 'highlighter' ? (a.size || 4) * 2 : (a.size || 4) / 2);
  if (!bboxNear(a.bbox, local, reach)) return null;
  const pts = densify(a.pts, Math.max(1, reach / 2));
  const keep = pts.map(p => !hit(p, local, reach));
  if (keep.every(Boolean)) return null;
  const pieces = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) cur.push(pts[i]);
    else { if (cur.length >= 2) pieces.push(cur); cur = []; }
  }
  if (cur.length >= 2) pieces.push(cur);
  return pieces.map((pp, i) => {
    const packed = round(pp);
    return { ...a, id: i === 0 ? a.id : newId(), pts: packed, d: rebuild(a, packed), bbox: bboxOf(packed) };
  });
}

/**
 * La goma sobre todas las anotaciones. `hitWhole(a)` dice si una anotación que no es un trazo está tocada
 * (la decide quien llama, que sabe pintar y medir formas). Devuelve { annotations, removedIds } o null si nada cambió.
 */
export function eraseAnnotations(annotations, path, r, { newId, hitWhole, rebuild } = {}) {
  let changed = false;
  const out = [];
  const removedIds = new Set();
  for (const a of annotations || []) {
    if (a.kind === 'path' && Array.isArray(a.pts)) {
      const res = eraseStroke(a, path, r, newId || (() => 'an-' + Math.random().toString(36).slice(2, 10)), rebuild);
      if (res === null) { out.push(a); continue; }
      changed = true;
      if (!res.length) removedIds.add(a.id);
      out.push(...res);
    } else if (hitWhole && hitWhole(a)) {
      changed = true; removedIds.add(a.id);
    } else out.push(a);
  }
  return changed ? { annotations: out, removedIds } : null;
}
