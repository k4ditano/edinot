// Exportar una pantalla (marco) a HTML + CSS (del diseño al código). Lógica pura: la usan la app (descarga) y el
// MCP (export_frame_html). Cada pieza se coloca en absoluto dentro del marco, en su orden de apilado:
//   textos → <div> con tipografía; rectángulos/elipses sencillos → <div> con su CSS (fondo, degradado, borde, radio,
//   sombras, desenfoques, imagen); el resto (trazos, formas raras, recortes) → <svg> en línea; imágenes → <img>.

import { itemCss, gradientCss } from './canvas-css.js';
import { parseRich } from './rich-text.js';
import { fontStack } from './text-style.js';
import { gradientSvg } from './canvas-effects.js';
import { shapeD } from '../editor/canvas/shapes.js';
import { cornersRectD } from './canvas-effects.js';
import { clipFor } from './canvas-mask.js';

const FRAME_HEAD = 26;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;
const cssText = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}:${v}`).join(';');
const effZ = (it, i, kind) => (kind === 'n' ? (it.z != null ? it.z : i) : (typeof it.z === 'number' ? it.z : (it.layer === 'back' ? -1e9 + i : 1e9 + i)));

function richHtml(text) {
  return parseRich(text).map(line => line.map(r => {
    const st = {};
    if (r.b) st['font-weight'] = '700';
    if (r.i) st['font-style'] = 'italic';
    if (r.u || r.s) st['text-decoration'] = [r.u && 'underline', r.s && 'line-through'].filter(Boolean).join(' ');
    if (r.color) st.color = r.color;
    if (r.size) st['font-size'] = `${r.size}px`;
    if (r.code) Object.assign(st, { 'font-family': "'JetBrains Mono', monospace", background: 'rgba(127,127,127,.15)', padding: '0 .25em', 'border-radius': '4px' });
    const s = cssText(st);
    return s ? `<span style="${esc(s)}">${esc(r.t)}</span>` : esc(r.t);
  }).join('') || '&nbsp;').join('<br>');
}

function simpleBox(a) {
  return a.kind === 'shape' && (a.shape === 'rect' || a.shape === 'ellipse') && !a.rot && !a.clip && !a.clipTo && a.w != null;
}

function svgPiece(a, ox, oy, byId) {
  const b = a.bbox; if (!b) return '';
  const pad = Math.max(2, (a.strokeWidth || 0)) + (a.shadow ? (a.shadow.blur || 6) * 2 + Math.abs(a.shadow.dy || 0) : 0);
  const X = b.x + (a.ox || 0) - pad, Y = b.y + (a.oy || 0) - pad, W = b.w + pad * 2, H = b.h + pad * 2;
  let d;
  if (a.kind === 'path') d = a.d;
  else if (a.shape === 'line' || a.shape === 'arrow') d = `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`;
  else if (a.shape === 'rect') d = cornersRectD(a.x, a.y, a.w, a.h, Array.isArray(a.corners) ? a.corners : (a.rx != null ? a.rx : 6));
  else if (a.shape === 'ellipse') d = `M ${a.x} ${a.y + a.h / 2} A ${a.w / 2} ${a.h / 2} 0 1 0 ${a.x + a.w} ${a.y + a.h / 2} A ${a.w / 2} ${a.h / 2} 0 1 0 ${a.x} ${a.y + a.h / 2} Z`;
  else d = shapeD(a.shape, a.x, a.y, a.w, a.h);
  const gid = 'g' + a.id;
  // Recorte (clip-path de un SVG importado o máscara con otra forma), en coordenadas del mundo como el viewBox.
  const cl = clipFor(a, byId || new Map());
  const cid = 'c' + a.id;
  const defs = (a.gradient || cl) ? `<defs>${a.gradient ? gradientSvg(a, gid, esc) : ''}${cl ? `<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><path d="${esc(cl.d)}"${cl.transform ? ` transform="${cl.transform}"` : ''}/></clipPath>` : ''}</defs>` : '';
  const ocx = a.ox || 0, ocy = a.oy || 0;
  const pen = a.kind === 'path' && a.variant === 'pen';
  const fill = a.gradient ? `url(#${gid})` : pen ? (a.fill || a.color) : (a.fill && a.fill !== 'none' ? a.fill : 'none');
  const stroke = pen ? 'none' : (a.color && a.color !== 'none' ? a.color : 'none');
  const rot = a.rot && a.w != null ? ` transform="rotate(${a.rot} ${a.x + a.w / 2} ${a.y + a.h / 2})"` : '';
  const style = cssText({ position: 'absolute', left: `${r1(X - ox)}px`, top: `${r1(Y - oy)}px`, overflow: 'visible',
    filter: a.shadow ? `drop-shadow(${a.shadow.dx || 0}px ${a.shadow.dy ?? 4}px ${a.shadow.blur ?? 6}px ${a.shadow.color || 'rgba(0,0,0,.25)'})` : null,
    opacity: a.opacity != null && a.opacity < 1 ? a.opacity : null });
  const vb = `${r1(b.x - pad)} ${r1(b.y - pad)} ${r1(W)} ${r1(H)}`;
  const shape = `<path d="${esc(d)}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${a.strokeWidth || 0}" stroke-linecap="round" stroke-linejoin="round"${rot}/>`;
  // El recorte está en el mundo; la figura, en su espacio local (sin el desplazamiento ox/oy): se compensa.
  const body = cl ? `<g clip-path="url(#${cid})" transform="translate(${-ocx} ${-ocy})"><g transform="translate(${ocx} ${ocy})">${shape}</g></g>` : shape;
  return `<svg style="${esc(style)}" width="${r1(W)}" height="${r1(H)}" viewBox="${vb}" overflow="visible">${defs}${body}</svg>`;
}

/** HTML completo de una pantalla. `frame` = grupo del canvas. */
export function frameToHtml(json, frame, { title } = {}) {
  const fx = frame.x || 0, fy = (frame.y || 0) + FRAME_HEAD, fw = frame.w || 480, fh = (frame.h || 320) - FRAME_HEAD;
  const inside = (b) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx >= fx && cx <= fx + fw && cy >= fy - FRAME_HEAD && cy <= fy + fh + 4000; };
  const items = [];
  (json.nodes || []).forEach((n, i) => { const b = { x: n.x || 0, y: n.y || 0, w: n.w || 240, h: n.h || 140 }; if (!n.hidden && n.kind !== 'page' && inside(b)) items.push({ kind: 'n', it: n, z: effZ(n, i, 'n'), b }); });
  (json.annotations || []).forEach((a, i) => { if (!a.bbox || a.hidden) return; const b = { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h }; if (inside(b)) items.push({ kind: 'a', it: a, z: effZ(a, i, 'a'), b }); });
  items.sort((p, q) => p.z - q.z);
  const aById = new Map((json.annotations || []).map(a => [a.id, a]));
  let bottom = fy + fh;
  for (const x of items) bottom = Math.max(bottom, x.b.y + x.b.h);
  const out = [];
  items.forEach(({ kind, it, b }, k) => {
    const pos = { position: 'absolute', left: `${r1(b.x - fx)}px`, top: `${r1(b.y - fy)}px`, 'z-index': k + 1 };
    if (kind === 'n') {
      if (it.kind === 'label') {
        const css = itemCss(it);
        out.push(`<div style="${esc(cssText({ ...pos, ...css, width: `${r1(b.w)}px`, margin: 0 }))}">${it.rich ? richHtml(it.text) : esc(it.text || '').replace(/\n/g, '<br>')}</div>`);
      } else if (it.kind === 'image' && (it.url || it.sha)) {
        out.push(`<img src="${esc(it.url || `edinot://blob/${it.sha}`)}" alt="${esc(it.alt || '')}" style="${esc(cssText({ ...pos, width: `${r1(b.w)}px`, height: `${r1(b.h)}px`, 'object-fit': 'cover' }))}">`);
      } else if (it.kind === 'shape') {
        const rad = it.shape === 'ellipse' ? '50%' : '8px';
        out.push(`<div style="${esc(cssText({ ...pos, width: `${r1(b.w)}px`, height: `${r1(b.h)}px`, background: it.color || '#e0e7ff', 'border-radius': rad, display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'text-align': 'center', 'font-family': fontStack('sans') }))}">${it.rich ? richHtml(it.text || '') : esc(it.text || '')}</div>`);
      } else if (it.text) {
        out.push(`<div style="${esc(cssText({ ...pos, width: `${r1(b.w)}px`, 'min-height': `${r1(b.h)}px`, background: it.color || (it.sticky ? '#fde68a' : '#fff'), padding: '12px', 'box-sizing': 'border-box', 'border-radius': '8px', 'font-family': fontStack('sans') }))}">${esc(it.text).replace(/\n/g, '<br>')}</div>`);
      }
      return;
    }
    if (simpleBox(it)) {
      const css = itemCss(it);
      if (it.imageFill && it.imageFill.src) Object.assign(css, { background: `url("${it.imageFill.src}") center / ${it.imageFill.fit === 'contain' ? 'contain' : it.imageFill.fit === 'fill' ? '100% 100%' : 'cover'} no-repeat` });
      if (!css.background && !css.border && !css['border-top'] && !css['border-bottom'] && !css['border-left'] && !css['border-right']) css.background = 'transparent';
      out.push(`<div style="${esc(cssText({ ...pos, ...css, 'box-sizing': 'border-box' }))}"></div>`);
    } else out.push(svgPiece(it, fx, fy, aById).replace('position:absolute;', `position:absolute;z-index:${k + 1};`));
  });
  const name = title || frame.title || 'Pantalla';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; background: #f4f4f5; font-family: ${fontStack('sans')}; }
  .screen { position: relative; width: ${r1(fw)}px; height: ${r1(Math.max(fh, bottom - fy))}px; margin: 24px auto; overflow: hidden; }
</style>
</head>
<body>
<main class="screen" aria-label="${esc(name)}">
${out.join('\n')}
</main>
</body>
</html>
`;
}

export const _gradientCss = gradientCss;
