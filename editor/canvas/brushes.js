// Pinceles del lápiz del canvas. Lógica pura: lo usan la pantalla, la exportación y el MCP.
//
// Cada trazo a mano (`variant: 'pen'`) puede llevar `brush`. El trazo sigue siendo un vector (path `d` relleno),
// así se puede mover, redimensionar, exportar a SVG y editar; la textura la ponen filtros SVG.
//
//   pen        bolígrafo / tinta (por omisión): grosor con la presión, puntas afinadas
//   pencil     lápiz de grafito: fino, gris, con grano de papel
//   marker     rotulador: grosor constante, punta redonda, se superpone como tinta (multiplicar)
//   fountain   pluma estilográfica: grosor según la dirección (plumilla a 45°), mucho contraste
//   calligraphy rotulador de caligrafía: plumilla plana a 30°, trazos fino/grueso muy marcados
//   brush      pincel: grueso con la presión, bordes suaves y algo irregulares
//   charcoal   carboncillo: ancho, granulado y con bordes rotos
//   crayon     cera: textura de cera sobre papel, a rayas
//   watercolor acuarela: translúcido, se mezcla (multiplicar) y oscurece en los bordes
//   spray      espray: nube de puntitos alrededor del trazo
//   neon       neón: trazo brillante con halo de su color

import { strokeOutlineD } from './ink.js';

export const BRUSHES = ['pen', 'pencil', 'marker', 'fountain', 'calligraphy', 'brush', 'charcoal', 'crayon', 'watercolor', 'spray', 'neon'];

// Ajustes de cada pincel: escala del grosor, respuesta a la presión, opacidad, fusión.
const SPEC = {
  pen: { k: 1, pressure: 1, opacity: 1 },
  pencil: { k: 0.75, pressure: 0.6, opacity: 0.9 },
  marker: { k: 1.6, pressure: 0, opacity: 0.92, blend: 'multiply' },
  fountain: { k: 1.4, pressure: 0.5, opacity: 1, nib: 45 },
  calligraphy: { k: 2.4, pressure: 0.2, opacity: 1, nib: 30, flat: true },
  brush: { k: 2.2, pressure: 1.4, opacity: 0.95 },
  charcoal: { k: 2.6, pressure: 0.8, opacity: 0.85 },
  crayon: { k: 2, pressure: 0.4, opacity: 0.9 },
  watercolor: { k: 3.2, pressure: 0.8, opacity: 0.38, blend: 'multiply' },
  spray: { k: 4, pressure: 0.6, opacity: 0.9 },
  neon: { k: 1, pressure: 0.3, opacity: 1 },
};
export const brushSpec = (b) => SPEC[b] || SPEC.pen;

const f1 = (v) => v.toFixed(1);

// Pseudoaleatorio estable (el mismo trazo se pinta siempre igual).
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const seedOf = (pts) => Math.floor(Math.abs((pts[0] ? pts[0][0] * 131 + pts[0][1] * 17 : 7) + pts.length * 7919));

/** Puntos con la presión ajustada a la respuesta del pincel (0 = grosor constante). */
function shapePressure(pts, amount) {
  return pts.map(p => [p[0], p[1], 0.5 + ((p[2] != null ? p[2] : 0.5) - 0.5) * amount]);
}

/** Plumilla: el grosor depende del ángulo del trazo respecto a la plumilla. */
function nibOutlineD(pts, size, nibDeg, flat) {
  const n = pts.length;
  if (n < 2) return strokeOutlineD(pts, size);
  const nib = nibDeg * Math.PI / 180;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
    const ang = Math.atan2(next[1] - prev[1], next[0] - prev[0]);
    const p = pts[i][2] != null ? pts[i][2] : 0.5;
    if (flat) {
      // Plumilla plana: los bordes van siempre en la dirección de la plumilla (como una cinta).
      const h = size / 2 * (0.85 + p * 0.3);
      const dx = Math.cos(nib) * h, dy = -Math.sin(nib) * h;
      left.push([pts[i][0] + dx, pts[i][1] + dy]); right.push([pts[i][0] - dx, pts[i][1] - dy]);
    } else {
      const w = size / 2 * (0.18 + 0.82 * Math.abs(Math.sin(ang - nib))) * (0.8 + p * 0.4);
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]); right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
    }
  }
  const back = right.reverse();
  return `M ${f1(left[0][0])} ${f1(left[0][1])} ${left.slice(1).map(q => `L ${f1(q[0])} ${f1(q[1])}`).join(' ')} ${back.map(q => `L ${f1(q[0])} ${f1(q[1])}`).join(' ')} Z`;
}

/** Espray: puntitos repartidos alrededor del trazo (más densos con más presión). */
function sprayD(pts, size) {
  const r = rng(seedOf(pts));
  const out = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    acc += seg;
    const p = b[2] != null ? b[2] : 0.5;
    const count = Math.round(seg * (0.6 + p) * size / 10);
    for (let k = 0; k < count; k++) {
      const t = r(), ang = r() * Math.PI * 2, dist = Math.sqrt(r()) * size * (0.6 + p * 0.6);
      const x = a[0] + (b[0] - a[0]) * t + Math.cos(ang) * dist, y = a[1] + (b[1] - a[1]) * t + Math.sin(ang) * dist;
      const dot = 0.35 + r() * 0.9;
      out.push(`M ${f1(x - dot)} ${f1(y)} a ${f1(dot)} ${f1(dot)} 0 1 0 ${f1(dot * 2)} 0 a ${f1(dot)} ${f1(dot)} 0 1 0 ${f1(-dot * 2)} 0 z`);
    }
  }
  if (!out.length && pts[0]) { const [x, y] = pts[0]; out.push(`M ${f1(x - 1)} ${f1(y)} a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 z`); }
  return out.join(' ');
}

/** Contorno (path relleno) de un trazo con su pincel. `size` es el grosor elegido en la barra. */
export function brushOutlineD(pts, size, brush = 'pen') {
  const sp = brushSpec(brush);
  const s = Math.max(0.5, size * sp.k);
  if (brush === 'spray') return sprayD(pts, s);
  if (sp.nib != null) return nibOutlineD(pts, s, sp.nib, !!sp.flat);
  return strokeOutlineD(shapePressure(pts, sp.pressure), s);
}

/** Filtro SVG del pincel (textura, bordes, halo) o '' si no lleva. `id` único por trazo. */
export function brushFilterSvg(brush, id, color = '#000') {
  const seed = Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 997;
  const grain = (freq, oct, keep) =>
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}" result="n"/>`
    + `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 ${keep}" result="m"/>`
    + `<feComposite in="SourceGraphic" in2="m" operator="in"/>`;
  const wrap = (body, extra = '') => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"${extra}>${body}</filter>`;
  switch (brush) {
    case 'pencil': return wrap(grain(0.9, 2, 1.95));
    case 'charcoal':
      return wrap(`<feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="${seed}" result="d"/>`
        + `<feDisplacementMap in="SourceGraphic" in2="d" scale="5" xChannelSelector="R" yChannelSelector="G" result="r"/>`
        + `<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${seed + 1}" result="n"/>`
        + `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.95" result="m"/>`
        + `<feComposite in="r" in2="m" operator="in"/>`);
    case 'crayon':
      return wrap(`<feTurbulence type="fractalNoise" baseFrequency="0.04 0.9" numOctaves="2" seed="${seed}" result="n"/>`
        + `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2 1.5" result="m"/>`
        + `<feComposite in="SourceGraphic" in2="m" operator="in"/>`);
    case 'brush':
      return wrap(`<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="${seed}" result="d"/>`
        + `<feDisplacementMap in="SourceGraphic" in2="d" scale="3" xChannelSelector="R" yChannelSelector="G" result="r"/>`
        + `<feGaussianBlur in="r" stdDeviation="0.4"/>`);
    case 'watercolor':
      // Bordes algo más oscuros (el pigmento se acumula) y contorno irregular y suave.
      return wrap(`<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="${seed}" result="d"/>`
        + `<feDisplacementMap in="SourceGraphic" in2="d" scale="7" xChannelSelector="R" yChannelSelector="G" result="r"/>`
        + `<feGaussianBlur in="r" stdDeviation="1.2" result="b"/>`
        + `<feMorphology in="r" operator="erode" radius="2" result="in"/>`
        + `<feComposite in="r" in2="in" operator="out" result="edge"/>`
        + `<feMerge><feMergeNode in="b"/><feMergeNode in="edge"/></feMerge>`);
    case 'neon':
      return wrap(`<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="g1"/>`
        + `<feFlood flood-color="${color}" flood-opacity="0.9"/><feComposite in2="g1" operator="in" result="glow"/>`
        + `<feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="g2"/>`
        + `<feFlood flood-color="${color}"/><feComposite in2="g2" operator="in" result="glow2"/>`
        + `<feMerge><feMergeNode in="glow"/><feMergeNode in="glow2"/><feMergeNode in="SourceGraphic"/></feMerge>`, ' x="-50%" y="-50%" width="200%" height="200%"');
    default: return '';
  }
}

/** Relleno del trazo: el neón se pinta con un centro claro; el resto, con su color. */
export function brushFill(brush, color) {
  if (brush === 'neon') return '#ffffff';
  if (brush === 'pencil' && (!color || color === '#1f2937')) return '#3f3f46';
  return color;
}
