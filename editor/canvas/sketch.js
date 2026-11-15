// Estilo «a mano alzada» (como el modo scribbled de AFFiNE / Excalidraw) con
// rough.js. Se activa por elemento con `sketch: true` (formas) o por arista
// (`sketch: true`). La semilla sale del id, así el trazo no «tiembla» al
// volver a pintar, y los resultados se cachean por geometría + estilo.

import rough from 'roughjs';
import { shapePolygon, shapeParts, NEW_SHAPES } from './shapes.js';

const gen = rough.generator();
const cache = new Map();
const MAX = 800;

function seedOf(id) {
  let h = 2166136261;
  const s = String(id || 'x');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483646 + 1;
}

function remember(key, make) {
  if (cache.has(key)) return cache.get(key);
  const v = make();
  if (cache.size > MAX) cache.clear();
  cache.set(key, v);
  return v;
}

function opts(id, stroke, strokeWidth, fill) {
  const o = { seed: seedOf(id), roughness: 1.3, bowing: 1, stroke, strokeWidth, preserveVertices: true };
  if (fill && fill !== 'none') { o.fill = fill; o.fillStyle = 'solid'; }
  return o;
}

// → [{ d, stroke, strokeWidth, fill }] para una forma de anotación.
export function sketchShapePaths(a) {
  const stroke = a.color || '#1f2937', sw = a.strokeWidth || 2;
  const fill = a.fill && a.fill !== 'none' ? a.fill : null;
  const key = `s|${a.id}|${a.shape}|${a.x}|${a.y}|${a.w}|${a.h}|${a.x1}|${a.y1}|${a.x2}|${a.y2}|${stroke}|${sw}|${fill}`;
  return remember(key, () => {
    const o = opts(a.id, stroke, sw, fill);
    let dr;
    switch (a.shape) {
      case 'rect': dr = gen.rectangle(a.x, a.y, a.w, a.h, o); break;
      case 'ellipse': dr = gen.ellipse(a.x + a.w / 2, a.y + a.h / 2, a.w, a.h, o); break;
      case 'diamond': {
        const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
        dr = gen.polygon([[cx, a.y], [a.x + a.w, cy], [cx, a.y + a.h], [a.x, cy]], o); break;
      }
      case 'line': case 'arrow': dr = gen.line(a.x1, a.y1, a.x2, a.y2, o); break;
      default: {
        if (!NEW_SHAPES.includes(a.shape)) return [];
        const poly = shapePolygon(a.shape, a.x, a.y, a.w, a.h);
        if (poly) { dr = gen.polygon(poly, o); break; }
        // cilindro / nube / bocadillo: trazos con curvas (gen.path); el relleno sólo en el cuerpo
        return shapeParts(a.shape, a.x, a.y, a.w, a.h).flatMap(part => gen.toPaths(gen.path(part.d, part.fill ? o : opts(a.id, stroke, sw, null))));
      }
    }
    return gen.toPaths(dr);
  });
}

// → [{ d, stroke, strokeWidth, fill }] para el trazo `d` de una arista.
export function sketchPathD(id, d, stroke, strokeWidth) {
  const key = `p|${id}|${d}|${stroke}|${strokeWidth}`;
  return remember(key, () => gen.toPaths(gen.path(d, { ...opts(id, stroke, strokeWidth, null), roughness: 1.1 })));
}

// SVG en texto (exportación).
export function sketchSvg(paths, extra = '') {
  return paths.map(p => `<path d="${p.d}" fill="${p.fill || 'none'}" stroke="${p.stroke || 'none'}" stroke-width="${p.strokeWidth || 0}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`).join('');
}
