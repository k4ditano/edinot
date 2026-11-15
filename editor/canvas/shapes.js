// Geometría de las formas cerradas del canvas (lógica pura, sin React).
//
// Una forma se define por su caja (x, y, w, h) y un id de forma. De cada una salen:
//   shapeD(shape, x, y, w, h)        trazo SVG (path d) para pintar
//   shapePolygon(shape, x, y, w, h)  vértices, si es un polígono (rough.js: gen.polygon); si no, null
//   shapeOutline(shape, x, y, w, h)  contorno aproximado como polilínea (intersección conector↔forma)
//   shapeInsets(shape)               cuánto se mete el contorno desde el punto medio de cada lado de la
//                                    caja (fracción de w/h): ahí van las anclas de los conectores
//   shapeTextBox(shape, x, y, w, h)  rectángulo interior para el texto
//
// Las formas antiguas (rect, ellipse, diamond) se siguen pintando como siempre en CanvasView; aquí
// sólo se describen para que anclas y contornos de conector las traten igual que a las nuevas.

export const NEW_SHAPES = ['triangle', 'star', 'hexagon', 'cylinder', 'cloud', 'callout'];
export const CLOSED_SHAPES = ['rect', 'ellipse', 'diamond', ...NEW_SHAPES];

const f = (n) => Math.round(n * 100) / 100;

// ---- polígonos
function triangle(x, y, w, h) { return [[x + w / 2, y], [x + w, y + h], [x, y + h]]; }
function hexagon(x, y, w, h) {
  const k = Math.min(w * 0.25, h * 0.5 * 0.9 + w * 0.05);
  return [[x + k, y], [x + w - k, y], [x + w, y + h / 2], [x + w - k, y + h], [x + k, y + h], [x, y + h / 2]];
}
function star(x, y, w, h) {
  // Estrella de 5 puntas inscrita en la caja (ajustada para ocupar todo el ancho y el alto).
  const pts = [];
  const R = 1, r = 0.382;
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R;
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return pts.map(([px, py]) => [x + (px - x0) / (x1 - x0) * w, y + (py - y0) / (y1 - y0) * h]);
}

const POLYS = { triangle, hexagon, star };

// ---- trazos
function cylinderD(x, y, w, h) {
  const rx = w / 2, ry = Math.max(3, Math.min(h * 0.16, w * 0.3));
  const cx = x + rx;
  return `M ${f(x)} ${f(y + ry)} A ${f(rx)} ${f(ry)} 0 0 1 ${f(x + w)} ${f(y + ry)} L ${f(x + w)} ${f(y + h - ry)} A ${f(rx)} ${f(ry)} 0 0 1 ${f(x)} ${f(y + h - ry)} Z`
    + ` M ${f(x)} ${f(y + ry)} A ${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(y + ry)}`;
}
// Nube en una caja unitaria; las coordenadas salen de un ajuste a mano para llenar 0..1 en x e y.
const CLOUD = [
  ['M', 0.22, 1],
  ['C', 0.06, 1, 0, 0.72, 0.14, 0.58],
  ['C', 0.07, 0.36, 0.26, 0.2, 0.40, 0.31],
  ['C', 0.46, 0.08, 0.74, 0.0, 0.80, 0.24],
  ['C', 0.96, 0.2, 1.04, 0.46, 0.90, 0.58],
  ['C', 1.04, 0.74, 0.96, 1, 0.78, 1],
  ['Z'],
];
// Se normaliza al cargar: se muestrea la curva, se halla su caja real y se reescalan las
// coordenadas para que la nube llene exactamente 0..1 en x e y.
const CLOUD_N = (() => {
  let cur = null, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (px, py) => { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); };
  for (const seg of CLOUD) {
    if (seg[0] === 'M') { cur = [seg[1], seg[2]]; add(cur[0], cur[1]); }
    else if (seg[0] === 'C') {
      for (let i = 1; i <= 40; i++) {
        const t = i / 40, u = 1 - t, c1 = [seg[1], seg[2]], c2 = [seg[3], seg[4]], p3 = [seg[5], seg[6]];
        add(u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]);
      }
      cur = [seg[5], seg[6]];
    }
  }
  const nx = (v) => (v - x0) / (x1 - x0), ny = (v) => (v - y0) / (y1 - y0);
  return CLOUD.map(seg => seg[0] === 'Z' ? seg : [seg[0], ...seg.slice(1).map((v, i) => (i % 2 === 0 ? nx(v) : ny(v)))]);
})();
function cloudD(x, y, w, h) {
  return CLOUD_N.map(seg => seg[0] + (seg.length > 1 ? ' ' + seg.slice(1).map((v, i) => f(i % 2 === 0 ? x + v * w : y + v * h)).join(' ') : '')).join(' ');
}
// Bocadillo: rectángulo redondeado en la parte alta (80% del alto) con cola hacia abajo a la izquierda.
function calloutD(x, y, w, h) {
  const bh = h * 0.8, r = Math.min(10, w * 0.12, bh * 0.2);
  const t1 = x + w * 0.16, t2 = x + w * 0.36, tip = [x + w * 0.1, y + h];
  return `M ${f(x + r)} ${f(y)} L ${f(x + w - r)} ${f(y)} Q ${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)} L ${f(x + w)} ${f(y + bh - r)} Q ${f(x + w)} ${f(y + bh)} ${f(x + w - r)} ${f(y + bh)}`
    + ` L ${f(t2)} ${f(y + bh)} L ${f(tip[0])} ${f(tip[1])} L ${f(t1)} ${f(y + bh)} L ${f(x + r)} ${f(y + bh)} Q ${f(x)} ${f(y + bh)} ${f(x)} ${f(y + bh - r)} L ${f(x)} ${f(y + r)} Q ${f(x)} ${f(y)} ${f(x + r)} ${f(y)} Z`;
}

// Partes de un trazo: el cuerpo (se rellena) y, en el cilindro, la tapa (sólo línea) para que un
// relleno translúcido no se superponga.
export function shapeParts(shape, x, y, w, h) {
  const d = shapeD(shape, x, y, w, h);
  if (shape !== 'cylinder') return [{ d, fill: true }];
  const i = d.indexOf(' M ', 1);
  return [{ d: d.slice(0, i), fill: true }, { d: d.slice(i + 1), fill: false }];
}

const polyD = (pts) => 'M ' + pts.map(p => `${f(p[0])} ${f(p[1])}`).join(' L ') + ' Z';

export function shapePolygon(shape, x, y, w, h) {
  const fn = POLYS[shape];
  return fn ? fn(x, y, w, h) : null;
}

export function shapeD(shape, x, y, w, h) {
  if (POLYS[shape]) return polyD(POLYS[shape](x, y, w, h));
  if (shape === 'cylinder') return cylinderD(x, y, w, h);
  if (shape === 'cloud') return cloudD(x, y, w, h);
  if (shape === 'callout') return calloutD(x, y, w, h);
  if (shape === 'diamond') { const cx = x + w / 2, cy = y + h / 2; return `M ${f(cx)} ${f(y)} L ${f(x + w)} ${f(cy)} L ${f(cx)} ${f(y + h)} L ${f(x)} ${f(cy)} Z`; }
  if (shape === 'ellipse') { const rx = w / 2, ry = h / 2; return `M ${f(x)} ${f(y + ry)} A ${f(rx)} ${f(ry)} 0 1 0 ${f(x + w)} ${f(y + ry)} A ${f(rx)} ${f(ry)} 0 1 0 ${f(x)} ${f(y + ry)} Z`; }
  return `M ${f(x)} ${f(y)} H ${f(x + w)} V ${f(y + h)} H ${f(x)} Z`;
}

// Pasos de la polilínea de un contorno con curvas (suficiente para cortar con un conector).
function sampleD(shape, x, y, w, h) {
  const pts = [];
  if (shape === 'ellipse') {
    for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; pts.push([x + w / 2 + Math.cos(a) * w / 2, y + h / 2 + Math.sin(a) * h / 2]); }
    return pts;
  }
  if (shape === 'cylinder') {
    const ry = Math.max(3, Math.min(h * 0.16, w * 0.3));
    for (let i = 0; i <= 16; i++) { const a = Math.PI + i / 16 * Math.PI; pts.push([x + w / 2 + Math.cos(a) * w / 2, y + ry + Math.sin(a) * ry]); }   // tapa superior (arriba)
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI; pts.push([x + w / 2 + Math.cos(a) * w / 2, y + h - ry + Math.sin(a) * ry]); }        // fondo (abajo)
    return pts;
  }
  if (shape === 'cloud') {
    let cur = null;
    for (const seg of CLOUD_N) {
      if (seg[0] === 'M') { cur = [x + seg[1] * w, y + seg[2] * h]; pts.push(cur); }
      else if (seg[0] === 'C') {
        const p0 = cur, c1 = [x + seg[1] * w, y + seg[2] * h], c2 = [x + seg[3] * w, y + seg[4] * h], p3 = [x + seg[5] * w, y + seg[6] * h];
        for (let i = 1; i <= 10; i++) {
          const t = i / 10, u = 1 - t;
          pts.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]);
        }
        cur = p3;
      }
    }
    return pts;
  }
  if (shape === 'callout') {
    const bh = h * 0.8;
    return [[x, y], [x + w, y], [x + w, y + bh], [x + w * 0.36, y + bh], [x + w * 0.1, y + h], [x + w * 0.16, y + bh], [x, y + bh]];
  }
  if (shape === 'diamond') return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

export function shapeOutline(shape, x, y, w, h) {
  const poly = shapePolygon(shape, x, y, w, h);
  return poly || sampleD(shape, x, y, w, h);
}

// Distancia de entrada del contorno medida desde el punto medio de cada lado de la caja, como
// fracción del alto/ancho: así t/b se multiplican por h y l/r por w. Se calcula lanzando un rayo
// desde el centro hacia cada lado contra el contorno.
const insetCache = new Map();
export function shapeInsets(shape) {
  if (insetCache.has(shape)) return insetCache.get(shape);
  const W = 100, H = 100;
  const out = shapeOutline(shape, 0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const hit = (dx, dy) => {
    let best = Infinity;
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      const ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - cx) * ey - (a[1] - cy) * ex) / den, u = ((a[0] - cx) * dy - (a[1] - cy) * dx) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
    }
    return best === Infinity ? 0.5 * W : best;
  };
  const r = hit(1, 0), l = hit(-1, 0), b = hit(0, 1), t = hit(0, -1);
  const v = {
    r: Math.max(0, (W / 2 - r) / W), l: Math.max(0, (W / 2 - l) / W),
    b: Math.max(0, (H / 2 - b) / H), t: Math.max(0, (H / 2 - t) / H),
  };
  insetCache.set(shape, v);
  return v;
}

// Zona de texto (dentro de la forma, sin cola ni tapas).
export function shapeTextBox(shape, x, y, w, h) {
  switch (shape) {
    case 'triangle': return { x: x + w * 0.25, y: y + h * 0.4, w: w * 0.5, h: h * 0.55 };
    case 'star': return { x: x + w * 0.26, y: y + h * 0.34, w: w * 0.48, h: h * 0.42 };
    case 'hexagon': return { x: x + w * 0.14, y: y + h * 0.1, w: w * 0.72, h: h * 0.8 };
    case 'cylinder': { const ry = Math.max(3, Math.min(h * 0.16, w * 0.3)); return { x, y: y + ry * 1.6, w, h: Math.max(8, h - ry * 3) }; }
    case 'cloud': return { x: x + w * 0.16, y: y + h * 0.26, w: w * 0.68, h: h * 0.62 };
    case 'callout': return { x, y, w, h: h * 0.8 };
    case 'ellipse': return { x: x + w * 0.1, y: y + h * 0.1, w: w * 0.8, h: h * 0.8 };
    case 'diamond': return { x: x + w * 0.2, y: y + h * 0.2, w: w * 0.6, h: h * 0.6 };
    default: return { x, y, w, h };
  }
}
