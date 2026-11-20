// Efectos de los dibujos del canvas, como en Figma: degradado, sombra, sombra interior y desenfoque de capa.
// Devuelven SVG en texto: lo usan igual la pantalla (dentro de <defs>) y la exportación a SVG/PNG, así lo
// exportado es lo mismo que se ve.
//
//   gradient     { type: 'linear'|'radial', x1,y1,x2,y2 | cx,cy,r,fx,fy (fracciones de la caja), stops:[{offset,color,opacity}] }
//   shadow       { dx, dy, blur, color, opacity }            sombra paralela
//   innerShadow  { dx, dy, blur, color, opacity }            sombra interior
//   blur         número                                      desenfoque de capa (px)
//   bgBlur       número                                      desenfoque de fondo («cristal»): solo en pantalla

const xesc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function gradientSvg(a, id, esc = xesc) {
  const g = a && a.gradient;
  if (!g || !Array.isArray(g.stops) || !g.stops.length) return '';
  const stops = g.stops.map((st, i) => `<stop offset="${num(st.offset, i / Math.max(1, g.stops.length - 1))}" stop-color="${esc(st.color)}"${st.opacity != null ? ` stop-opacity="${num(st.opacity, 1)}"` : ''}/>`).join('');
  if (g.type === 'radial') {
    const cx = num(g.cx, 0.5), cy = num(g.cy, 0.5);
    return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${num(g.r, 0.5)}" fx="${num(g.fx, cx)}" fy="${num(g.fy, cy)}">${stops}</radialGradient>`;
  }
  return `<linearGradient id="${id}" x1="${num(g.x1, 0)}" y1="${num(g.y1, 0)}" x2="${num(g.x2, 1)}" y2="${num(g.y2, 0)}">${stops}</linearGradient>`;
}

export const hasFilter = (a) => !!(a && (a.shadow || a.innerShadow || (a.blur > 0)));

export function annoFilterSvg(a, esc = xesc, id) {
  if (!hasFilter(a)) return '';
  const parts = [];
  let src = 'SourceGraphic';
  if (a.blur > 0) { parts.push(`<feGaussianBlur in="SourceGraphic" stdDeviation="${num(a.blur, 0)}" result="lb"/>`); src = 'lb'; }
  let top = src;
  if (a.shadow) {
    const s = a.shadow;
    parts.push(`<feDropShadow in="${src}" dx="${num(s.dx, 0)}" dy="${num(s.dy, 4)}" stdDeviation="${num(s.blur, 6)}" flood-color="${esc(s.color || '#000000')}" flood-opacity="${num(s.opacity, 0.25)}" result="ds"/>`);
    top = 'ds';
  }
  if (a.innerShadow) {
    const s = a.innerShadow;
    parts.push(
      `<feOffset in="SourceAlpha" dx="${num(s.dx, 0)}" dy="${num(s.dy, 2)}" result="io"/>`,
      `<feGaussianBlur in="io" stdDeviation="${num(s.blur, 4)}" result="ib"/>`,
      `<feComposite in="SourceAlpha" in2="ib" operator="arithmetic" k2="1" k3="-1" result="ic"/>`,
      `<feFlood flood-color="${esc(s.color || '#000000')}" flood-opacity="${num(s.opacity, 0.25)}" result="if"/>`,
      `<feComposite in="if" in2="ic" operator="in" result="is"/>`,
      `<feMerge><feMergeNode in="${top}"/><feMergeNode in="is"/></feMerge>`,
    );
  }
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}</filter>`;
}

/** Contorno de un rect con un radio por esquina [tl, tr, br, bl]. */
export function cornersRectD(x, y, w, h, r) {
  const lim = (v) => Math.max(0, Math.min(num(v, 0), w / 2, h / 2));
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map(lim);
  return `M ${x + tl} ${y} H ${x + w - tr}${tr ? ` A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : ''} V ${y + h - br}${br ? ` A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : ''} H ${x + bl}${bl ? ` A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : ''} V ${y + tl}${tl ? ` A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : ''} Z`;
}

/** Bordes de solo algunos lados de un rect: { t, r, b, l } booleanos → path de líneas. */
export function sidesD(x, y, w, h, sides) {
  const s = sides || {};
  const out = [];
  if (s.t) out.push(`M ${x} ${y} H ${x + w}`);
  if (s.r) out.push(`M ${x + w} ${y} V ${y + h}`);
  if (s.b) out.push(`M ${x} ${y + h} H ${x + w}`);
  if (s.l) out.push(`M ${x} ${y} V ${y + h}`);
  return out.join(' ');
}
