// Trazos vectoriales: puntas de flecha en cualquier trazo y «contorno del trazo» (outline stroke). Lógica pura.

import { normalizePath, arcsToCubics } from '../../shared/svg-import.js';
import { outlineD } from '../../shared/canvas-boolean.js';

const r2 = (v) => Math.round(v * 100) / 100;

export const STROKE_ENDS = ['none', 'arrow', 'triangle', 'circle', 'bar', 'diamond'];

/** Definiciones <marker> para las puntas de un trazo: { defs, start, end } (start/end = url(#…) o null). */
export function markerSvg(a, id, esc = (s) => s) {
  const color = esc(a.color && a.color !== 'none' ? a.color : '#1f2937');
  const out = { defs: '', start: null, end: null };
  const mk = (kind, mid) => {
    // En unidades del grosor del trazo: crecen con él, como en Figma.
    const body = {
      arrow: `<path d="M 0.5 0.5 L 4.5 2.5 L 0.5 4.5" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`,
      triangle: `<path d="M 0 0 L 5 2.5 L 0 5 Z" fill="${color}"/>`,
      circle: `<circle cx="2.5" cy="2.5" r="2" fill="${color}"/>`,
      bar: `<rect x="2" y="0" width="1" height="5" fill="${color}"/>`,
      diamond: `<path d="M 0 2.5 L 2.5 0 L 5 2.5 L 2.5 5 Z" fill="${color}"/>`,
    }[kind];
    if (!body) return null;
    const refX = kind === 'arrow' ? 4.5 : kind === 'triangle' ? 4 : 2.5;
    out.defs += `<marker id="${mid}" viewBox="0 0 5 5" refX="${refX}" refY="2.5" markerWidth="5" markerHeight="5" markerUnits="strokeWidth" orient="auto-start-reverse" overflow="visible">${body}</marker>`;
    return `url(#${mid})`;
  };
  if (a.startCap && a.startCap !== 'none') out.start = mk(a.startCap, `${id}-ms`);
  if (a.endCap && a.endCap !== 'none') out.end = mk(a.endCap, `${id}-me`);
  return out;
}

/** Discontinuas: 'dashed' | 'dotted' | números a medida ("12 4 2 4"). */
export function dashArray(style) {
  if (!style || style === 'solid') return '';
  if (style === 'dashed') return '8 4';
  if (style === 'dotted') return '2 4';
  const s = String(style).trim();
  return /^[\d.]+([\s,]+[\d.]+)*$/.test(s) ? s.replace(/,/g, ' ').replace(/\s+/g, ' ') : '';
}

/**
 * Contorno del trazo: a partir de puntos muestreados del trazado, el polígono que ocupa la línea de grosor `width`.
 * Abierto: un solo contorno (ida por un lado, vuelta por el otro, con extremos redondos o rectos).
 * Cerrado: dos anillos (exterior e interior) para pintar con fill-rule evenodd.
 */
export function outlineFromPoints(pts, width, { closed = false, cap = 'round' } = {}) {
  const P = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
  const n = P.length;
  if (n < 2) return '';
  const h = width / 2;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? P[(i - 1 + n) % n] : P[Math.max(0, i - 1)];
    const next = closed ? P[(i + 1) % n] : P[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0], ty = next[1] - prev[1];
    const L = Math.hypot(tx, ty) || 1;
    tx /= L; ty /= L;
    const nx = -ty, ny = tx;
    left.push([P[i][0] + nx * h, P[i][1] + ny * h]);
    right.push([P[i][0] - nx * h, P[i][1] - ny * h]);
  }
  const poly = (arr) => arr.map((p, i) => `${i ? 'L' : 'M'} ${r2(p[0])} ${r2(p[1])}`).join(' ');
  if (closed) return `${poly(left)} Z ${poly(right.slice().reverse())} Z`;
  const back = right.slice().reverse();
  if (cap === 'round') {
    return `${poly(left)} A ${r2(h)} ${r2(h)} 0 0 1 ${r2(back[0][0])} ${r2(back[0][1])} ${back.slice(1).map(p => `L ${r2(p[0])} ${r2(p[1])}`).join(' ')} A ${r2(h)} ${r2(h)} 0 0 1 ${r2(left[0][0])} ${r2(left[0][1])} Z`;
  }
  if (cap === 'square') {
    const ext = (p, q, s) => { const dx = p[0] - q[0], dy = p[1] - q[1], L = Math.hypot(dx, dy) || 1; return [p[0] + dx / L * h * s, p[1] + dy / L * h * s]; };
    left[0] = ext(left[0], left[1], 1); left[n - 1] = ext(left[n - 1], left[n - 2], 1);
    back[0] = ext(back[0], back[1], 1); back[n - 1] = ext(back[n - 1], back[n - 2], 1);
  }
  return `${poly(left)} ${back.map(p => `L ${r2(p[0])} ${r2(p[1])}`).join(' ')} Z`;
}


/** Tramos de un path (curvas muestreadas): [{ pts, closed }]. */
export function pathPolylines(d, steps = 16) {
  const cmds = arcsToCubics(normalizePath(d));
  const out = [];
  let cur = null, px = 0, py = 0, sx = 0, sy = 0;
  const end = (closed) => { if (cur && cur.length >= 2) out.push({ pts: cur, closed }); cur = null; };
  for (const { c, v } of cmds) {
    if (c === 'M') { end(false); cur = [[v[0], v[1]]]; px = sx = v[0]; py = sy = v[1]; continue; }
    if (c === 'Z') { px = sx; py = sy; end(true); continue; }
    if (!cur) cur = [[px, py]];
    if (c === 'L') { cur.push([v[0], v[1]]); px = v[0]; py = v[1]; }
    else if (c === 'C') {
      for (let i = 1; i <= steps; i++) { const t = i / steps, u = 1 - t; cur.push([u * u * u * px + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * v[4], u * u * u * py + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * v[5]]); }
      px = v[4]; py = v[5];
    } else if (c === 'Q') {
      for (let i = 1; i <= steps; i++) { const t = i / steps, u = 1 - t; cur.push([u * u * px + 2 * u * t * v[0] + t * t * v[2], u * u * py + 2 * u * t * v[1] + t * t * v[3]]); }
      px = v[2]; py = v[3];
    }
  }
  end(false);
  return out;
}

/**
 * «Contorno del trazo»: el borde de un dibujo pasa a ser una figura rellena (editable como vector).
 * Devuelve los campos del nuevo trazo (en el mismo espacio local que el original, con su ox/oy) o null.
 */
export function outlineStroke(a) {
  const sw = Number(a.strokeWidth) || (a.kind === 'path' ? 2.5 : 2);
  if (!a.color || a.color === 'none' || sw <= 0) return null;
  let lines;
  if (a.kind === 'shape' && (a.shape === 'line' || a.shape === 'arrow')) lines = [{ pts: [[a.x1, a.y1], [a.x2, a.y2]], closed: false }];
  else {
    const d = outlineD(a);
    if (!d) return null;
    lines = pathPolylines(d);
  }
  if (a.kind === 'shape' && a.rot && a.w != null) {
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2, r = a.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    lines = lines.map(l => ({ ...l, pts: l.pts.map(p => [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c]) }));
  }
  const cap = a.strokeCap || (a.kind === 'path' ? 'round' : 'butt');
  const d = lines.map(l => outlineFromPoints(l.pts, sw, { closed: l.closed, cap })).filter(Boolean).join(' ');
  if (!d) return null;
  const all = lines.flatMap(l => l.pts);
  const h = sw / 2 + (cap === 'butt' ? 0 : sw / 2);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.min(...xs) - h, y0 = Math.min(...ys) - h;
  return {
    kind: 'path', d, fill: a.color, color: 'none', strokeWidth: 0, fillRule: 'evenodd',
    bbox: { x: r2(x0), y: r2(y0), w: r2(Math.max(...xs) + h - x0), h: r2(Math.max(...ys) + h - y0) },
    ox: a.ox || 0, oy: a.oy || 0, opacity: a.opacity != null ? a.opacity : 1,
  };
}
