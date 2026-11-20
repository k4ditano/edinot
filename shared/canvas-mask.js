// Recorte (máscara) de dibujos del canvas, como «Usar como máscara» en Figma. Lógica pura.
//
// Un dibujo puede recortarse de dos maneras:
//   · `clipTo: '<id>'`  → por la forma de otro dibujo (rect con su radio, elipse, rombo… o un trazo vectorial).
//                          Se sigue a esa forma: si se mueve o se cambia de tamaño, el recorte va con ella.
//   · `clip: { d }`      → por un contorno fijo en coordenadas del mundo (lo que trae un SVG con clip-path).
// Lo que queda fuera del contorno no se ve. Las fichas (textos, notas) no se recortan.

import { shapeD } from '../editor/canvas/shapes.js';
import { cornersRectD } from './canvas-effects.js';

const f = (n) => Math.round(n * 100) / 100;

function roundRectD(x, y, w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  if (!r) return `M ${f(x)} ${f(y)} H ${f(x + w)} V ${f(y + h)} H ${f(x)} Z`;
  return `M ${f(x + r)} ${f(y)} H ${f(x + w - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)} V ${f(y + h - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)} H ${f(x + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)} V ${f(y + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z`;
}

/** ¿Puede este dibujo servir de máscara? (formas cerradas y trazos vectoriales) */
export function canMask(a) {
  if (!a) return false;
  if (a.kind === 'shape') return a.shape !== 'line' && a.shape !== 'arrow' && a.w != null;
  return a.kind === 'path' && !!a.d;
}

/**
 * Contorno de un dibujo usado como máscara: { d, transform } en coordenadas del mundo (transform = el
 * desplazamiento/giro que tenga el dibujo, en sintaxis SVG, o '').
 */
export function maskGeometry(a) {
  if (!canMask(a)) return null;
  const tr = [];
  if (a.ox || a.oy) tr.push(`translate(${a.ox || 0} ${a.oy || 0})`);
  if (a.kind === 'shape') {
    if (a.rot) tr.push(`rotate(${a.rot} ${a.x + a.w / 2} ${a.y + a.h / 2})`);
    const d = a.shape === 'rect' && Array.isArray(a.corners)
      ? cornersRectD(a.x, a.y, a.w, a.h, a.corners)
      : a.shape === 'rect'
      ? roundRectD(a.x, a.y, a.w, a.h, a.rx != null ? a.rx : Math.min(8, Math.min(a.w, a.h) * 0.12))
      : shapeD(a.shape, a.x, a.y, a.w, a.h);
    return { d, transform: tr.join(' ') };
  }
  return { d: a.d, transform: tr.join(' ') };
}

/** El recorte que se aplica a `a` dentro de `annotations` (o null). */
export function clipFor(a, byId) {
  if (!a) return null;
  if (a.clipTo) {
    const m = byId.get(a.clipTo);
    if (m && m.id !== a.id) return maskGeometry(m);
  }
  if (a.clip && a.clip.d) return { d: a.clip.d, transform: '' };
  return null;
}

/**
 * «Usar como máscara»: la forma de más abajo en el orden (la primera de `orderedIds`) recorta a las demás.
 * Devuelve el json nuevo o null si no se puede (hace falta una forma cerrada abajo y algo más encima).
 */
export function applyMask(json, orderedIds) {
  const annos = json.annotations || [];
  const byId = new Map(annos.map(a => [a.id, a]));
  const ids = orderedIds.filter(id => byId.has(id));
  if (ids.length < 2) return null;
  const mask = byId.get(ids[0]);
  if (!canMask(mask)) return null;
  const rest = new Set(ids.slice(1));
  return { ...json, annotations: annos.map(a => (rest.has(a.id) ? { ...a, clipTo: mask.id } : a)) };
}

/** Quita el recorte de los dibujos indicados. */
export function releaseMask(json, ids) {
  const set = new Set(ids);
  return {
    ...json,
    annotations: (json.annotations || []).map(a => {
      if (!set.has(a.id) || (!a.clipTo && !a.clip)) return a;
      const { clipTo, clip, ...rest } = a;
      return rest;
    }),
  };
}
