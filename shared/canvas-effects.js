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

/** Todas las sombras de un dibujo: `shadows` [{ dx, dy, blur, spread, color, opacity, inner }] más las sueltas de antes. */
export function shadowList(a) {
  if (!a) return [];
  const out = Array.isArray(a.shadows) ? a.shadows.filter(Boolean).map(s => ({ ...s })) : [];
  if (a.shadow) out.push({ ...a.shadow, inner: false });
  if (a.innerShadow) out.push({ ...a.innerShadow, inner: true });
  return out;
}

export const hasFilter = (a) => !!(a && (shadowList(a).length || (a.blur > 0)));

export function annoFilterSvg(a, esc = xesc, id) {
  if (!hasFilter(a)) return '';
  const parts = [];
  let src = 'SourceGraphic';
  if (a.blur > 0) { parts.push(`<feGaussianBlur in="SourceGraphic" stdDeviation="${num(a.blur, 0)}" result="lb"/>`); src = 'lb'; }
  const list = shadowList(a);
  const drops = [], inners = [];
  list.forEach((s, k) => {
    const sp = num(s.spread, 0);
    const color = esc(s.color || '#000000'), op = num(s.opacity, 0.25);
    if (!s.inner) {
      // Sombra paralela con extensión: el contorno se engorda (o adelgaza) antes de desplazarlo y difuminarlo.
      let base = 'SourceAlpha';
      if (sp) { parts.push(`<feMorphology in="SourceAlpha" operator="${sp > 0 ? 'dilate' : 'erode'}" radius="${Math.abs(sp)}" result="m${k}"/>`); base = `m${k}`; }
      parts.push(
        `<feOffset in="${base}" dx="${num(s.dx, 0)}" dy="${num(s.dy, 4)}" result="o${k}"/>`,
        `<feGaussianBlur in="o${k}" stdDeviation="${num(s.blur, 6)}" result="b${k}"/>`,
        `<feFlood flood-color="${color}" flood-opacity="${op}" result="f${k}"/>`,
        `<feComposite in="f${k}" in2="b${k}" operator="in" result="d${k}"/>`,
      );
      drops.push(`d${k}`);
    } else {
      let base = 'SourceAlpha';
      if (sp) { parts.push(`<feMorphology in="SourceAlpha" operator="erode" radius="${Math.abs(sp)}" result="m${k}"/>`); base = `m${k}`; }
      parts.push(
        `<feOffset in="${base}" dx="${num(s.dx, 0)}" dy="${num(s.dy, 2)}" result="o${k}"/>`,
        `<feGaussianBlur in="o${k}" stdDeviation="${num(s.blur, 4)}" result="b${k}"/>`,
        `<feComposite in="SourceAlpha" in2="b${k}" operator="arithmetic" k2="1" k3="-1" result="c${k}"/>`,
        `<feFlood flood-color="${color}" flood-opacity="${op}" result="f${k}"/>`,
        `<feComposite in="f${k}" in2="c${k}" operator="in" result="i${k}"/>`,
      );
      inners.push(`i${k}`);
    }
  });
  // De abajo arriba: sombras (la primera de la lista, la de más arriba), el dibujo y las sombras interiores.
  const merge = [...drops.reverse(), src, ...inners];
  if (merge.length > 1) parts.push(`<feMerge>${merge.map(m => `<feMergeNode in="${m}"/>`).join('')}</feMerge>`);
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}</filter>`;
}

/**
 * Varios rellenos y bordes por capa (como Figma). `fills` [{ color | gradient, opacity, blend }] se pintan encima del
 * relleno propio; `strokes` [{ color, width, opacity, dash }] encima de todo. Devuelve { base, layers }: el dibujo base
 * (sin su borde si hay rellenos extra, para que no lo tapen) y las capas que van encima, cada una como un dibujo más.
 */
export function paintStack(a) {
  const fills = Array.isArray(a && a.fills) ? a.fills.filter(f => f && (f.color || f.gradient)) : [];
  const strokes = Array.isArray(a && a.strokes) ? a.strokes.filter(s => s && s.color && num(s.width, 1) > 0) : [];
  if (!fills.length && !strokes.length) return null;
  const strip = { shadow: undefined, innerShadow: undefined, shadows: undefined, blur: undefined, imageFill: undefined, text: undefined, label: undefined, fills: undefined, strokes: undefined, sketch: undefined };
  const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };
  const hasStroke = a.color && a.color !== 'none' && num(a.strokeWidth, 2) > 0;
  const base = fills.length && hasStroke ? { ...a, color: 'none' } : a;
  const layers = [];
  fills.forEach((f, i) => layers.push(clean({ ...a, ...strip, id: `${a.id}-f${i}`, fill: f.color || '#000000', gradient: f.gradient || undefined, color: 'none', opacity: num(f.opacity, 1), blend: f.blend })));
  if (fills.length && hasStroke) layers.push(clean({ ...a, ...strip, id: `${a.id}-s`, fill: 'none', gradient: undefined }));
  strokes.forEach((s, i) => layers.push(clean({ ...a, ...strip, id: `${a.id}-s${i}`, fill: 'none', gradient: undefined, color: s.color, strokeWidth: num(s.width, 1), opacity: num(s.opacity, 1), dash: s.dash, strokeAlign: s.align || a.strokeAlign })));
  return { base, layers };
}

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

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

/** Caja local de un dibujo (sin su desplazamiento), para colocar una imagen de relleno. */
export function localBox(a) {
  if (a.kind === 'shape' && a.w != null) return { x: a.x, y: a.y, w: a.w, h: a.h };
  return a.bbox ? { x: a.bbox.x, y: a.bbox.y, w: a.bbox.w, h: a.bbox.h } : null;
}

/** Imagen como relleno: imageFill = { src, fit: 'cover'|'contain'|'fill', opacity?, scale?, ox?, oy?, exposure?, contrast?, saturation? }.
 *  scale (≥1) acerca la imagen dentro de la forma y ox/oy (px) la mueven: es el «recortar» de Figma.
 *  exposure / contrast / saturation van de -1 a 1 (0 = sin cambio). */
export function imageGeom(a) {
  const f = a && a.imageFill;
  const b = f && f.src ? localBox(a) : null;
  if (!b || !(b.w > 0 && b.h > 0)) return null;
  const sc = Math.max(0.1, num(f.scale, 1));
  const w = b.w * sc, h = b.h * sc;
  const par = f.fit === 'contain' ? 'xMidYMid meet' : f.fit === 'fill' ? 'none' : 'xMidYMid slice';
  return { x: b.x - (w - b.w) / 2 + num(f.ox, 0), y: b.y - (h - b.h) / 2 + num(f.oy, 0), w, h, par, box: b };
}
export const hasImageAdjust = (f) => !!(f && (num(f.exposure, 0) || num(f.contrast, 0) || num(f.saturation, 0)));
/** Filtro SVG con los ajustes de la imagen (exposición, contraste, saturación). */
export function imageAdjustSvg(f, id) {
  if (!hasImageAdjust(f)) return '';
  const e = num(f.exposure, 0), c = num(f.contrast, 0), sat = num(f.saturation, 0);
  const slope = (1 + c) * Math.pow(2, e), icpt = -c / 2;
  const fn = (ch) => `<feFunc${ch} type="linear" slope="${+slope.toFixed(4)}" intercept="${+icpt.toFixed(4)}"/>`;
  return `<filter id="${id}" color-interpolation-filters="sRGB">${sat ? `<feColorMatrix type="saturate" values="${Math.max(0, 1 + sat)}"/>` : ''}`
    + `${(e || c) ? `<feComponentTransfer>${fn('R')}${fn('G')}${fn('B')}</feComponentTransfer>` : ''}</filter>`;
}
export function imageFillSvg(a, id, esc = xesc) {
  const f = a && a.imageFill;
  const g = imageGeom(a);
  if (!g) return '';
  const fx = imageAdjustSvg(f, id + '-fx');
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${g.box.x}" y="${g.box.y}" width="${g.box.w}" height="${g.box.h}">${fx}`
    + `<image href="${esc(f.src)}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" preserveAspectRatio="${g.par}"${f.opacity != null ? ` opacity="${num(f.opacity, 1)}"` : ''}${fx ? ` filter="url(#${id}-fx)"` : ''}/></pattern>`;
}
