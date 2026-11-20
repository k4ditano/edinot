// Operaciones booleanas con formas (como en Figma): unir, restar, intersectar y excluir. Lógica pura.
//
// Cada dibujo (forma cerrada o trazo) se pasa a polígonos en coordenadas del mundo (las curvas se muestrean), se
// opera con polygon-clipping y el resultado es un trazo vectorial editable con el estilo de la pieza de más abajo.
// Restar: a la de abajo se le quitan las demás.

import polygonClipping from 'polygon-clipping';
import { normalizePath, arcsToCubics } from './svg-import.js';
import { shapeD } from '../editor/canvas/shapes.js';
import { cornersRectD } from './canvas-effects.js';

const STEPS = 16;
const r2 = (n) => Math.round(n * 100) / 100;

/** Anillos (listas de puntos [x, y]) de un path en coordenadas locales. */
export function pathRings(d) {
  const cmds = arcsToCubics(normalizePath(d));
  const rings = [];
  let cur = null, px = 0, py = 0;
  const close = () => { if (cur && cur.length >= 3) rings.push(cur); cur = null; };
  for (const { c, v } of cmds) {
    if (c === 'M') { close(); cur = [[v[0], v[1]]]; px = v[0]; py = v[1]; continue; }
    if (c === 'Z') { close(); continue; }
    if (!cur) cur = [[px, py]];
    if (c === 'L') { cur.push([v[0], v[1]]); px = v[0]; py = v[1]; }
    else if (c === 'C') {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS, u = 1 - t;
        cur.push([u * u * u * px + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * v[4], u * u * u * py + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * v[5]]);
      }
      px = v[4]; py = v[5];
    } else if (c === 'Q') {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS, u = 1 - t;
        cur.push([u * u * px + 2 * u * t * v[0] + t * t * v[2], u * u * py + 2 * u * t * v[1] + t * t * v[3]]);
      }
      px = v[2]; py = v[3];
    }
  }
  close();
  return rings;
}

/** Contorno (path d, local) de un dibujo cerrado, o null. */
export function outlineD(a) {
  if (a.kind === 'path' && a.d) return a.d;
  if (a.kind !== 'shape' || a.w == null || a.shape === 'line' || a.shape === 'arrow') return null;
  if (a.shape === 'rect') return cornersRectD(a.x, a.y, a.w, a.h, Array.isArray(a.corners) ? a.corners : (a.rx != null ? a.rx : Math.min(8, Math.min(a.w, a.h) * 0.12)));
  if (a.shape === 'ellipse') return `M ${a.x} ${a.y + a.h / 2} A ${a.w / 2} ${a.h / 2} 0 1 0 ${a.x + a.w} ${a.y + a.h / 2} A ${a.w / 2} ${a.h / 2} 0 1 0 ${a.x} ${a.y + a.h / 2} Z`;
  return shapeD(a.shape, a.x, a.y, a.w, a.h);
}

export const canBoolean = (a) => !!outlineD(a);

/** El dibujo como multipolígono en el mundo (con su desplazamiento y su giro). */
export function toMultiPolygon(a) {
  const d = outlineD(a);
  if (!d) return null;
  const ox = a.ox || 0, oy = a.oy || 0;
  let tf = (p) => [p[0] + ox, p[1] + oy];
  if (a.kind === 'shape' && a.rot) {
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2, r = a.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    tf = (p) => [cx + (p[0] - cx) * c - (p[1] - cy) * s + ox, cy + (p[0] - cx) * s + (p[1] - cy) * c + oy];
  }
  const rings = pathRings(d).map(rg => rg.map(tf));
  if (!rings.length) return null;
  // Cada anillo como polígono; se unen entre sí (un trazo con agujeros queda como la unión de sus partes).
  return polygonClipping.union(...rings.map(rg => [[...rg, rg[0]]]));
}

export function multiPolygonD(mp) {
  return mp.map(poly => poly.map(ring => 'M ' + ring.slice(0, -1).map(p => `${r2(p[0])} ${r2(p[1])}`).join(' L ') + ' Z').join(' ')).join(' ');
}

/**
 * op: 'union' | 'subtract' | 'intersect' | 'exclude'. `items` en orden de apilado (el primero, el de más abajo).
 * Devuelve el dibujo resultante (sin id) o null si no queda nada.
 */
export function booleanOp(op, items) {
  const geoms = items.map(toMultiPolygon).filter(Boolean);
  if (geoms.length < 2) return null;
  const [first, ...rest] = geoms;
  const res = op === 'union' ? polygonClipping.union(first, ...rest)
    : op === 'subtract' ? polygonClipping.difference(first, ...rest)
    : op === 'intersect' ? polygonClipping.intersection(first, ...rest)
    : polygonClipping.xor(first, ...rest);
  if (!res.length) return null;
  const d = multiPolygonD(res);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of res) for (const ring of poly) for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const base = items[0];
  const keep = ['fill', 'color', 'strokeWidth', 'opacity', 'gradient', 'shadow', 'innerShadow', 'blur', 'dash', 'fillVar', 'colorVar', 'z', 'grp'];
  const out = { kind: 'path', d, bbox: { x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) } };
  for (const k of keep) if (base[k] !== undefined) out[k] = base[k];
  if (base.kind === 'path' && base.variant === 'pen') { out.fill = base.fill || base.color; out.color = 'none'; }
  if (!out.fill || out.fill === 'none') out.fill = base.color || '#1f2937';
  if (out.strokeWidth == null) out.strokeWidth = base.kind === 'shape' ? 2 : 0.01;
  return out;
}
