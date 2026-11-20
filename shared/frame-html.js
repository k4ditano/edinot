// Exportar una pantalla (marco) a HTML + CSS (del diseño al código). Lógica pura: la usan la app (descarga) y el
// MCP (export_frame_html). Cada pieza se coloca en absoluto dentro del marco, en su orden de apilado:
//   textos → <div> con tipografía; rectángulos/elipses sencillos → <div> con su CSS (fondo, degradado, borde, radio,
//   sombras, desenfoques, imagen); el resto (trazos, formas raras, recortes) → <svg> en línea; imágenes → <img>.

import { itemCss, gradientCss } from './canvas-css.js';
import { parseRich } from './rich-text.js';
import { fontStack, labelHtml } from './text-style.js';
import { gradientSvg, shadowList, paintStack } from './canvas-effects.js';
import { shapeD } from '../editor/canvas/shapes.js';
import { cornersRectD } from './canvas-effects.js';
import { clipFor } from './canvas-mask.js';
import { resolveCanvas } from './canvas-vars.js';
import { frameMembers, layoutFrame, frameRect } from '../editor/canvas/autolayout.js';

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
  const drops = shadowList(a).filter(s => !s.inner);
  const pad = Math.max(2, (a.strokeWidth || 0)) + drops.reduce((m, s) => Math.max(m, (s.blur ?? 6) * 2 + Math.abs(s.dy || 0) + Math.abs(s.spread || 0)), 0);
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
    filter: drops.length ? drops.map(s => `drop-shadow(${s.dx || 0}px ${s.dy ?? 4}px ${s.blur ?? 6}px ${s.color || 'rgba(0,0,0,.25)'})`).join(' ') : null,
    'mix-blend-mode': a.blend && a.blend !== 'normal' ? a.blend : null,
    opacity: a.opacity != null && a.opacity < 1 ? a.opacity : null });
  const vb = `${r1(b.x - pad)} ${r1(b.y - pad)} ${r1(W)} ${r1(H)}`;
  const ps = paintStack(a);
  const stroke0 = ps ? (ps.base.color && ps.base.color !== 'none' ? ps.base.color : 'none') : stroke;
  let shape = `<path d="${esc(d)}" fill="${esc(fill)}" stroke="${esc(stroke0)}" stroke-width="${a.strokeWidth || 0}" stroke-linecap="round" stroke-linejoin="round"${rot}/>`;
  if (ps) {
    shape += ps.layers.map(l => {
      const lg = l.gradient ? `<defs>${gradientSvg(l, 'g' + l.id, esc)}</defs>` : '';
      const lf = l.gradient ? `url(#g${l.id})` : (l.fill || 'none');
      return `${lg}<path d="${esc(d)}" fill="${esc(lf)}" stroke="${esc(l.color || 'none')}" stroke-width="${l.strokeWidth || 0}" opacity="${l.opacity ?? 1}"${l.blend && l.blend !== 'normal' ? ` style="mix-blend-mode:${l.blend}"` : ''} stroke-linecap="round" stroke-linejoin="round"${rot}/>`;
    }).join('');
  }
  // El recorte está en el mundo; la figura, en su espacio local (sin el desplazamiento ox/oy): se compensa.
  const body = cl ? `<g clip-path="url(#${cid})" transform="translate(${-ocx} ${-ocy})"><g transform="translate(${ocx} ${ocy})">${shape}</g></g>` : shape;
  return `<svg style="${esc(style)}" width="${r1(W)}" height="${r1(H)}" viewBox="${vb}" overflow="visible">${defs}${body}</svg>`;
}

// ── Versión estructurada (cuando hay auto layout): flex / grid reales ────────────────────────────────
const px = (n) => `${r1(n)}px`;
function contentEl(kind, it, b, place, aById) {
  // place = { abs: true, ox, oy, z } (posición absoluta respecto a un origen) o { abs: false, extra } (en el flujo).
  const pos = place.abs ? { position: 'absolute', left: px(b.x - place.ox), top: px(b.y - place.oy), 'z-index': place.z } : { position: 'relative', ...place.extra };
  const sized = (w, h) => ({ ...(place.abs || !place.extra || place.extra.width === undefined ? { width: px(w) } : {}), ...(place.abs || !place.extra || place.extra.height === undefined ? { height: px(h) } : {}) });
  if (kind === 'n') {
    if (it.kind === 'label') return `<div style="${esc(cssText({ ...itemCss(it), ...pos, ...(place.abs || !place.extra || place.extra.width === undefined ? { width: px(b.w) } : {}), margin: 0 }))}">${labelHtml(it, (l) => (it.rich ? richHtml(l) : esc(l))) || (it.rich ? richHtml(it.text) : esc(it.text || '').replace(/\n/g, '<br>'))}</div>`;
    if (it.kind === 'image' && (it.url || it.sha)) return `<img src="${esc(it.url || `edinot://blob/${it.sha}`)}" alt="${esc(it.alt || '')}" style="${esc(cssText({ ...pos, ...sized(b.w, b.h), 'object-fit': 'cover' }))}">`;
    if (it.kind === 'shape') return `<div style="${esc(cssText({ ...pos, ...sized(b.w, b.h), background: it.color || '#e0e7ff', 'border-radius': it.shape === 'ellipse' ? '50%' : '8px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'text-align': 'center', 'box-sizing': 'border-box', 'font-family': fontStack('sans') }))}">${it.rich ? richHtml(it.text || '') : esc(it.text || '')}</div>`;
    if (it.text) return `<div style="${esc(cssText({ ...pos, ...sized(b.w, b.h), background: it.color || (it.sticky ? '#fde68a' : '#fff'), padding: '12px', 'box-sizing': 'border-box', 'border-radius': '8px', 'font-family': fontStack('sans') }))}">${esc(it.text).replace(/\n/g, '<br>')}</div>`;
    return '';
  }
  if (simpleBox(it)) {
    const css = itemCss(it);
    delete css.width; delete css.height;
    if (it.imageFill && it.imageFill.src) {
      const f = it.imageFill, sc = f.scale || 1;
      const size = f.fit === 'contain' ? 'contain' : f.fit === 'fill' ? '100% 100%' : (sc > 1 ? `${Math.round(sc * 100)}% auto` : 'cover');
      const pos = (f.ox || f.oy) ? `calc(50% + ${f.ox || 0}px) calc(50% + ${f.oy || 0}px)` : 'center';
      Object.assign(css, { background: `url("${f.src}") ${pos} / ${size} no-repeat` });
      const flt = [f.exposure && `brightness(${Math.pow(2, f.exposure).toFixed(3)})`, f.contrast && `contrast(${(1 + f.contrast).toFixed(3)})`, f.saturation && `saturate(${Math.max(0, 1 + f.saturation).toFixed(3)})`].filter(Boolean);
      if (flt.length) css.filter = flt.join(' ');
    }
    return `<div style="${esc(cssText({ ...pos, ...sized(b.w, b.h), ...css, 'box-sizing': 'border-box' }))}"></div>`;
  }
  if (place.abs) return svgPiece(it, place.ox, place.oy, aById).replace('position:absolute;', `position:absolute;z-index:${place.z};`);
  return `<div style="${esc(cssText({ ...pos, ...sized(b.w, b.h) }))}">${svgPiece(it, b.x, b.y, aById)}</div>`;
}

function renderFrameStructured(json, g, members, place, aById, depth = 0) {
  const units = members.get(g.id) || [];
  const fr = frameRect(g);
  const ox = fr.x, oy = fr.y + FRAME_HEAD;
  const outer = place.abs
    ? { position: 'absolute', left: px(fr.x - place.ox), top: px(fr.y + FRAME_HEAD - place.oy), 'z-index': place.z, width: px(fr.w), height: px(fr.h - FRAME_HEAD) }
    : { position: 'relative', width: px(fr.w), height: px(fr.h - FRAME_HEAD), ...(place.extra || {}) };
  const unitHtml = (u, pl) => {
    if (u.frame) return renderFrameStructured(json, u.frame, members, pl, aById, depth + 1);
    if (u.items.length === 1) { const { kind, item } = u.items[0]; const b = kind === 'n' ? { x: item.x || 0, y: item.y || 0, w: item.w || 240, h: item.h || 140 } : { x: item.bbox.x + (item.ox || 0), y: item.bbox.y + (item.oy || 0), w: item.bbox.w, h: item.bbox.h }; return contentEl(kind, item, b, pl, aById); }
    // Grupo (un botón con su texto): una caja con sus piezas en absoluto dentro.
    const box = pl.abs ? { position: 'absolute', left: px(u.rect.x - pl.ox), top: px(u.rect.y - pl.oy), 'z-index': pl.z, width: px(u.rect.w), height: px(u.rect.h) }
      : { position: 'relative', width: px(u.rect.w), height: px(u.rect.h), ...(pl.extra || {}) };
    const inner = u.items.map(({ kind, item }, k) => {
      const b = kind === 'n' ? { x: item.x || 0, y: item.y || 0, w: item.w || 240, h: item.h || 140 } : { x: item.bbox.x + (item.ox || 0), y: item.bbox.y + (item.oy || 0), w: item.bbox.w, h: item.bbox.h };
      return contentEl(kind, item, b, { abs: true, ox: u.rect.x, oy: u.rect.y, z: k + 1 }, aById);
    }).join('');
    return `<div style="${esc(cssText(box))}">${inner}</div>`;
  };
  const L = g.layout;
  if (!L) {
    const body = units.map((u, k) => unitHtml(u, { abs: true, ox, oy, z: k + 1 })).join('\n');
    return `<div style="${esc(cssText(outer))}">${body}</div>`;
  }
  const res = layoutFrame(g, units);
  const gap = Number.isFinite(L.gap) ? L.gap : 16, pad = Number.isFinite(L.pad) ? L.pad : 16;
  const al = { start: 'flex-start', center: 'center', end: 'flex-end' }[L.align || 'start'];
  const container = L.dir === 'grid'
    ? { display: 'grid', 'grid-template-columns': `repeat(${Math.max(1, L.columns || 2)}, minmax(0, 1fr))`, 'column-gap': px(gap), 'row-gap': px(Number.isFinite(L.gapY) ? L.gapY : gap), 'align-items': al === 'flex-start' ? 'start' : al === 'flex-end' ? 'end' : 'center', 'justify-items': 'start', 'align-content': 'start' }
    : { display: 'flex', 'flex-direction': L.dir === 'row' ? 'row' : 'column', gap: L.wrap ? `${px(Number.isFinite(L.gapCross) ? L.gapCross : gap)} ${px(gap)}` : px(gap), 'align-items': al, ...(L.wrap ? { 'flex-wrap': 'wrap', 'align-content': 'flex-start' } : {}) };
  if (L.wrap && L.dir === 'column') container.gap = `${px(gap)} ${px(Number.isFinite(L.gapCross) ? L.gapCross : gap)}`;
  Object.assign(container, { padding: px(pad), 'box-sizing': 'border-box' });
  const row = L.dir === 'row';
  const flowItems = res.placed.map((p) => {
    const it = p.unit.frame || (p.unit.items.length === 1 ? p.unit.items[0].item : {});
    const extra = {};
    if (L.dir === 'grid') {
      if (it.span > 1) extra['grid-column'] = `span ${Math.round(it.span)}`;
      if (it.sizeW === 'fill') { extra.width = 'auto'; extra['justify-self'] = 'stretch'; }
      if (it.sizeH === 'fill') { extra.height = 'auto'; extra['align-self'] = 'stretch'; }
    } else {
      const mainFill = row ? it.sizeW === 'fill' : it.sizeH === 'fill', crossFill = row ? it.sizeH === 'fill' : it.sizeW === 'fill';
      if (mainFill) { extra.flex = '1 1 0'; extra[row ? 'width' : 'height'] = 'auto'; }
      else extra['flex-shrink'] = '0';
      if (crossFill) { extra['align-self'] = 'stretch'; extra[row ? 'height' : 'width'] = 'auto'; }
    }
    for (const [k, css] of [['minW', 'min-width'], ['maxW', 'max-width'], ['minH', 'min-height'], ['maxH', 'max-height']]) if (it[k]) extra[css] = px(it[k]);
    return unitHtml(p.unit, { abs: false, extra });
  });
  const placedSet = new Set(res.placed.map(p => p.unit));
  const absItems = units.filter(u => !placedSet.has(u)).map((u, k) => unitHtml(u, { abs: true, ox, oy, z: 100 + k }));
  return `<div style="${esc(cssText({ ...outer, ...container }))}">${[...flowItems, ...absItems].join('\n')}</div>`;
}

/** HTML completo de una pantalla. `frame` = grupo del canvas. */
export function frameToHtml(json0, frame0, { title } = {}) {
  // Con las variables del modo activo ya aplicadas.
  const json = resolveCanvas(json0);
  const frame = (json.groups || []).find(g => g.id === frame0.id) || frame0;
  // Con auto layout (en la pantalla o en algún marco de dentro): flex/grid reales.
  const members = frameMembers(json);
  const usesLayout = (gid, d = 0) => { const g = (json.groups || []).find(x => x.id === gid); if (!g || d > 20) return false; if (g.layout) return true; return (members.get(gid) || []).some(u => u.frame && usesLayout(u.frame.id, d + 1)); };
  if (usesLayout(frame.id)) {
    const aByIdS = new Map((json.annotations || []).map(a => [a.id, a]));
    const name = title || frame.title || 'Pantalla';
    const inner = renderFrameStructured(json, frame, members, { abs: false, extra: { margin: '24px auto', overflow: 'hidden' } }, aByIdS);
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>
  body { margin: 0; min-height: 100vh; background: #f4f4f5; font-family: ${fontStack('sans')}; }
</style>
</head>
<body>
<main aria-label="${esc(name)}">
${inner}
</main>
</body>
</html>
`;
  }
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
        out.push(`<div style="${esc(cssText({ ...pos, ...css, width: `${r1(b.w)}px`, margin: 0 }))}">${labelHtml(it, (l) => (it.rich ? richHtml(l) : esc(l))) || (it.rich ? richHtml(it.text) : esc(it.text || '').replace(/\n/g, '<br>'))}</div>`);
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
