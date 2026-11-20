// «Copiar como CSS» (como el panel Inspect de Figma): el estilo de un elemento del canvas en CSS listo para pegar.
// Lógica pura: la usan la app (menú de la selección) y el MCP (canvas_item_css).

import { fontStack, weightOf } from './text-style.js';

const px = (n) => `${Math.round(Number(n) * 100) / 100}px`;
const rgbaOf = (color, opacity) => {
  if (opacity == null || opacity >= 1) return color;
  const m = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
  if (!m) return color;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${Math.round(opacity * 100) / 100})`;
};

export function gradientCss(g) {
  if (!g || !Array.isArray(g.stops) || !g.stops.length) return null;
  const stops = g.stops.map((s, i) => `${rgbaOf(s.color, s.opacity)} ${Math.round((s.offset ?? i / Math.max(1, g.stops.length - 1)) * 100)}%`).join(', ');
  if (g.type === 'radial') return `radial-gradient(circle at ${Math.round((g.cx ?? 0.5) * 100)}% ${Math.round((g.cy ?? 0.5) * 100)}%, ${stops})`;
  const dx = (g.x2 ?? 1) - (g.x1 ?? 0), dy = (g.y2 ?? 0) - (g.y1 ?? 0);
  const deg = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;   // 0deg = hacia arriba, como en CSS
  return `linear-gradient(${deg}deg, ${stops})`;
}

const shadowCss = (s, inset) => `${inset ? 'inset ' : ''}${px(s.dx || 0)} ${px(s.dy ?? (inset ? 2 : 4))} ${px((s.blur ?? (inset ? 4 : 6)) * 2)} ${rgbaOf(s.color || '#000000', s.opacity ?? 0.25)}`;

/** Declaraciones CSS de un elemento (ficha o dibujo). Devuelve un objeto { propiedad: valor } en orden. */
export function itemCss(el) {
  if (!el) return {};
  const out = {};
  if (el.kind === 'label') {
    out.width = px(el.w || 0);
    const fam = fontStack(el.font || 'sans');
    out['font-family'] = fam;
    out['font-size'] = px(el.fontSize || 20);
    const w = weightOf(el) ?? (el.plain ? 400 : 600);
    out['font-weight'] = String(w);
    if (el.italic) out['font-style'] = 'italic';
    out['line-height'] = String(el.lineHeight || 1.25);
    if (el.letterSpacing) out['letter-spacing'] = px(el.letterSpacing);
    if (el.color) out.color = el.color;
    if (el.align) out['text-align'] = el.align;
    if (el.transform) out['text-transform'] = el.transform === 'upper' ? 'uppercase' : el.transform === 'lower' ? 'lowercase' : 'capitalize';
    const deco = [el.underline && 'underline', el.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) out['text-decoration'] = deco;
    if (!el.wrap) out['white-space'] = 'pre';
    return out;
  }
  const isShapeAnno = el.kind === 'shape' && el.w != null;
  const isShapeNode = el.kind === 'shape' && el.x != null && el.text != null;
  const w = el.w ?? (el.bbox && el.bbox.w), h = el.h ?? (el.bbox && el.bbox.h);
  if (w != null) out.width = px(w);
  if (h != null) out.height = px(h);
  const grad = gradientCss(el.gradient);
  if (grad) out.background = grad;
  else if (el.fill && el.fill !== 'none') out.background = el.fill;
  else if (isShapeNode && el.color) out.background = el.color;
  const sw = el.strokeWidth, stroke = el.color;
  if (isShapeAnno && stroke && stroke !== 'none' && sw > 0.05) {
    const line = `${px(sw)} ${el.dash === 'dashed' ? 'dashed' : el.dash === 'dotted' ? 'dotted' : 'solid'} ${stroke}`;
    if (el.sides) { for (const [k, name] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) if (el.sides[k]) out[`border-${name}`] = line; }
    else if (el.strokeAlign === 'outside') out.outline = line;
    else { out.border = line; if (el.strokeAlign !== 'inside') out['box-sizing'] = 'border-box'; }
  }
  if (el.shape === 'ellipse') out['border-radius'] = '50%';
  else if (Array.isArray(el.corners)) out['border-radius'] = el.corners.map(px).join(' ');
  else if (el.shape === 'rect') out['border-radius'] = px(el.rx != null ? el.rx : 6);
  const shadows = [el.shadow && shadowCss(el.shadow, false), el.innerShadow && shadowCss(el.innerShadow, true)].filter(Boolean);
  if (shadows.length) out['box-shadow'] = shadows.join(', ');
  if (el.blur > 0) out.filter = `blur(${px(el.blur)})`;
  if (el.bgBlur > 0) out['backdrop-filter'] = `blur(${px(el.bgBlur)})`;
  if (el.opacity != null && el.opacity < 1) out.opacity = String(el.opacity);
  if (el.rot) out.transform = `rotate(${el.rot}deg)`;
  return out;
}

/** Texto CSS («propiedad: valor;» por línea). */
export function itemCssText(el) {
  return Object.entries(itemCss(el)).map(([k, v]) => `${k}: ${v};`).join('\n');
}
