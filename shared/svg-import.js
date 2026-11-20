// SVG → elementos editables del canvas (Edinot 1.4.3). Lógica pura, sin DOM: la usan el MCP (los agentes
// dibujan un diseño en SVG y llega al canvas pieza a pieza) y la app.
//
//   rect / circle / ellipse      → forma dibujada (`annotations[]`, kind 'shape': rect | ellipse)
//   line                         → forma 'line'
//   path / polyline / polygon    → trazo vectorial (kind 'path', `d` en coordenadas del mundo)
//   text                         → etiqueta de texto (`nodes[]`, kind 'label')
//   image (href http/https/data) → imagen (`nodes[]`, kind 'image')
//
// Las transformaciones (`transform` en cualquier nivel: translate, scale, rotate, matrix, skew) y el viewBox
// se aplican a las coordenadas: lo que llega al canvas ya está colocado. Un rect/ellipse girado o sesgado pasa
// a ser un trazo para no perder la forma. También entiende: <style> con reglas por etiqueta, .clase, #id y
// descendientes (y el `style` en línea, que manda), <use>/<symbol>, degradados lineales y radiales (fill o
// stroke "url(#…)", con href y unidades), sombras (feDropShadow, feOffset+feGaussianBlur o `filter:
// drop-shadow()`) y recortes (clip-path). Máscaras, patrones y marcadores se ignoran.

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const nums = (s) => (String(s || '').match(NUM) || []).map(Number);
const r2 = (n) => Math.round(n * 100) / 100;

// ---- XML mínimo -------------------------------------------------------------------------------------
function parseAttrs(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decode(m[3] != null ? m[3] : m[4]);
  return out;
}
function parseDecls(text, important) {
  const out = {};
  for (const part of String(text || '').split(';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim().toLowerCase(), raw = part.slice(i + 1);
    const imp = /!important/i.test(raw), v = raw.replace(/!important/i, '').trim();
    if (!k || !v) continue;
    if (important) { if (imp) important[k] = v; else out[k] = v; } else out[k] = v;
  }
  return out;
}

// ---- CSS mínimo: reglas «selectores { declaraciones }» con etiqueta, #id, .clase y descendientes -------
function parseCompound(c) {
  const out = { tag: null, id: null, cls: [] };
  const re = /([#.]?)([\w-]+|\*)/g;
  let m;
  const clean = c.replace(/:[\w-]+(\([^)]*\))?/g, '');
  while ((m = re.exec(clean))) {
    if (m[1] === '#') out.id = m[2]; else if (m[1] === '.') out.cls.push(m[2]); else if (m[2] !== '*') out.tag = m[2].toLowerCase();
  }
  return out;
}
export function parseCss(text) {
  const rules = [];
  const src = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[^{]+\{[^{}]*(\{[^}]*\}[^{}]*)*\}/g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m, order = 0;
  while ((m = re.exec(src))) {
    const imp = {};
    const decls = parseDecls(m[2], imp);
    for (const selRaw of m[1].split(',')) {
      const sel = selRaw.trim().replace(/\s*>\s*/g, ' ');
      if (!sel) continue;
      const parts = sel.split(/\s+/).map(parseCompound);
      const spec = parts.reduce((a, p) => a + (p.id ? 100 : 0) + p.cls.length * 10 + (p.tag ? 1 : 0), 0);
      rules.push({ parts, spec, order: order++, decls, imp });
    }
  }
  return rules;
}
const matchCompound = (el, p) => {
  if (p.tag && el.tag !== p.tag) return false;
  if (p.id && el.attrs.id !== p.id) return false;
  if (p.cls.length) { const c = String(el.attrs.class || '').split(/\s+/); if (!p.cls.every(k => c.includes(k))) return false; }
  return true;
};
function matchRule(el, ancestors, parts) {
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let k = parts.length - 2, i = ancestors.length - 1;
  while (k >= 0 && i >= 0) { if (matchCompound(ancestors[i], parts[k])) k--; i--; }
  return k < 0;
}
/** Aplica las reglas CSS y el `style` en línea a los atributos (orden: atributo < CSS < en línea). */
function cascade(el, ancestors, rules) {
  if (el.tag !== '#root') {
    const hit = rules.filter(r => matchRule(el, ancestors, r.parts)).sort((a, b) => a.spec - b.spec || a.order - b.order);
    const css = {}, imp = {};
    for (const r of hit) { Object.assign(css, r.decls); Object.assign(imp, r.imp); }
    const inline = el.attrs.style ? parseDecls(el.attrs.style) : {};
    el.attrs = { ...el.attrs, ...css, ...inline, ...imp };   // !important gana a todo
  }
  const next = [...ancestors, el];
  for (const c of el.children) cascade(c, next, rules);
}
const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

/** Árbol { tag, attrs, children, text } del SVG (tolerante: ignora comentarios, CDATA, doctype). */
export function parseSvgTree(svg) {
  const src = String(svg || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<\s*(\/)?\s*([a-zA-Z][\w:.-]*)([^>]*?)(\/)?\s*>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[5] != null) { top.text += m[5]; continue; }
    const tag = m[2].toLowerCase().replace(/^svg:/, '');
    if (m[1]) { // cierre
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const el = { tag, attrs: parseAttrs(m[3] || ''), children: [], text: '' };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  const css = [];
  const grab = (el) => { if (el.tag === 'style') css.push(el.text); for (const c of el.children) grab(c); };
  grab(root);
  cascade(root, [], css.length ? parseCss(css.join('\n')) : []);
  return root;
}

// ---- matrices afines [a b c d e f] ------------------------------------------------------------------
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function parseTransform(s) {
  let m = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(String(s || '')))) {
    const v = nums(t[2]);
    let n = I;
    if (t[1] === 'matrix' && v.length >= 6) n = v.slice(0, 6);
    else if (t[1] === 'translate') n = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (t[1] === 'scale') n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (t[1] === 'rotate') {
      const a = (v[0] || 0) * Math.PI / 180, c = Math.cos(a), s2 = Math.sin(a);
      n = [c, s2, -s2, c, 0, 0];
      if (v.length >= 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (t[1] === 'skewX') n = [1, 0, Math.tan((v[0] || 0) * Math.PI / 180), 1, 0, 0];
    else if (t[1] === 'skewY') n = [1, Math.tan((v[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}
const axisAligned = (m) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;

// ---- paths: a absolutas (M L C Q A Z) y transformadas ----------------------------------------------
/** Comandos absolutos [{c, v:[…]}] con solo M L C Q A Z (H/V/S/T pasan a L/C/Q). */
export function normalizePath(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null, t;
  while ((t = re.exec(String(d || '')))) {
    const cmd = t[1], C = cmd.toUpperCase(), rel = cmd !== C;
    const v = nums(t[2]);
    const take = (k) => { const r = []; for (let i = 0; i + k <= v.length; i += k) r.push(v.slice(i, i + k)); return r; };
    if (C === 'Z') { out.push({ c: 'Z', v: [] }); x = sx; y = sy; lc = lq = null; continue; }
    if (C === 'M') {
      take(2).forEach((p, i) => {
        const nx = rel ? x + p[0] : p[0], ny = rel ? y + p[1] : p[1];
        out.push({ c: i ? 'L' : 'M', v: [nx, ny] }); x = nx; y = ny; if (!i) { sx = x; sy = y; }
      });
      lc = lq = null; continue;
    }
    if (C === 'L') { for (const p of take(2)) { x = rel ? x + p[0] : p[0]; y = rel ? y + p[1] : p[1]; out.push({ c: 'L', v: [x, y] }); } lc = lq = null; continue; }
    if (C === 'H') { for (const p of take(1)) { x = rel ? x + p[0] : p[0]; out.push({ c: 'L', v: [x, y] }); } lc = lq = null; continue; }
    if (C === 'V') { for (const p of take(1)) { y = rel ? y + p[0] : p[0]; out.push({ c: 'L', v: [x, y] }); } lc = lq = null; continue; }
    if (C === 'C' || C === 'S') {
      for (const p of take(C === 'C' ? 6 : 4)) {
        let c1, c2, e;
        if (C === 'C') { c1 = [p[0], p[1]]; c2 = [p[2], p[3]]; e = [p[4], p[5]]; if (rel) { c1 = [x + c1[0], y + c1[1]]; c2 = [x + c2[0], y + c2[1]]; e = [x + e[0], y + e[1]]; } }
        else { c2 = [p[0], p[1]]; e = [p[2], p[3]]; if (rel) { c2 = [x + c2[0], y + c2[1]]; e = [x + e[0], y + e[1]]; } c1 = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]; }
        out.push({ c: 'C', v: [...c1, ...c2, ...e] }); lc = c2; lq = null; x = e[0]; y = e[1];
      }
      continue;
    }
    if (C === 'Q' || C === 'T') {
      for (const p of take(C === 'Q' ? 4 : 2)) {
        let c1, e;
        if (C === 'Q') { c1 = [p[0], p[1]]; e = [p[2], p[3]]; if (rel) { c1 = [x + c1[0], y + c1[1]]; e = [x + e[0], y + e[1]]; } }
        else { e = rel ? [x + p[0], y + p[1]] : [p[0], p[1]]; c1 = lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y]; }
        out.push({ c: 'Q', v: [...c1, ...e] }); lq = c1; lc = null; x = e[0]; y = e[1];
      }
      continue;
    }
    if (C === 'A') {
      for (const p of take(7)) {
        const ex = rel ? x + p[5] : p[5], ey = rel ? y + p[6] : p[6];
        out.push({ c: 'A', v: [p[0], p[1], p[2], p[3], p[4], ex, ey] }); x = ex; y = ey;
      }
      lc = lq = null;
    }
  }
  return out;
}

/** Aplica una matriz a un path normalizado y lo devuelve como `d` (los arcos escalan sus radios). */
export function transformPath(cmds, m) {
  const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const rot = Math.atan2(m[1], m[0]) * 180 / Math.PI;
  const flip = (m[0] * m[3] - m[1] * m[2]) < 0;
  const parts = [];
  for (const { c, v } of cmds) {
    if (c === 'Z') { parts.push('Z'); continue; }
    if (c === 'A') {
      const [ex, ey] = apply(m, v[5], v[6]);
      parts.push(`A ${r2(v[0] * sc)} ${r2(v[1] * sc)} ${r2(v[2] + rot)} ${v[3] ? 1 : 0} ${(flip ? !v[4] : v[4]) ? 1 : 0} ${r2(ex)} ${r2(ey)}`);
      continue;
    }
    const pts = [];
    for (let i = 0; i < v.length; i += 2) pts.push(...apply(m, v[i], v[i + 1]).map(r2));
    parts.push(`${c} ${pts.join(' ')}`);
  }
  return parts.join(' ');
}

/** Caja aproximada (con puntos de control; los arcos cuentan su extremo y su radio). */
export function pathBbox(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, px = 0, py = 0;
  const add = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
  for (const { c, v } of cmds) {
    if (c === 'Z') continue;
    if (c === 'A') { const r = Math.max(v[0], v[1]); add(px, py); add(v[5], v[6]); const mx = (px + v[5]) / 2, my = (py + v[6]) / 2; add(mx - r, my - r); add(mx + r, my + r); px = v[5]; py = v[6]; continue; }
    for (let i = 0; i < v.length; i += 2) add(v[i], v[i + 1]);
    px = v[v.length - 2]; py = v[v.length - 1];
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---- contorno de una figura simple como path (para <clipPath>) ----------------------------------------
function rrD(x, y, w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  if (!r) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
function elementD(el) {
  const A = el.attrs, n = (k, d = 0) => (A[k] != null ? parseFloat(A[k]) || 0 : d);
  switch (el.tag) {
    case 'rect': return rrD(n('x'), n('y'), n('width'), n('height'), A.rx != null ? n('rx') : n('ry'));
    case 'circle': { const cx = n('cx'), cy = n('cy'), r = n('r'); return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`; }
    case 'ellipse': { const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry'); return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`; }
    case 'polygon': case 'polyline': { const v = nums(A.points); if (v.length < 4) return ''; let d = `M ${v[0]} ${v[1]}`; for (let i = 2; i + 1 < v.length; i += 2) d += ` L ${v[i]} ${v[i + 1]}`; return d + ' Z'; }
    case 'path': return A.d || '';
    default: return '';
  }
}

// ---- estilos -----------------------------------------------------------------------------------------
const INHERIT = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'font-family', 'font-style', 'text-decoration', 'text-transform', 'stroke-dasharray', 'text-anchor', 'dominant-baseline', 'letter-spacing'];
const colorOf = (v) => {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s || s === 'currentColor' || /^url\(/i.test(s)) return undefined;
  return s;
};

/**
 * Convierte un SVG en elementos de canvas. Opciones: x, y (dónde poner la esquina del dibujo; 0,0 por omisión),
 * scale (1), newId(prefix). Devuelve { annotations, nodes, bbox, skipped }.
 */
export function svgToCanvas(svg, { x = 0, y = 0, scale = 1, newId, zStart } = {}) {
  let seq = 0;
  const id = newId || ((p) => `${p}-svg-${Date.now().toString(36)}-${(seq++).toString(36)}`);
  const tree = parseSvgTree(svg);
  const rootSvg = tree.children.find(c => c.tag === 'svg') || tree;
  let base = [scale, 0, 0, scale, x, y];
  const vb = nums(rootSvg.attrs && rootSvg.attrs.viewBox);
  if (vb.length === 4) {
    const W = parseFloat(rootSvg.attrs.width), H = parseFloat(rootSvg.attrs.height);
    const sx = W > 0 && vb[2] > 0 ? W / vb[2] : 1, sy = H > 0 && vb[3] > 0 ? H / vb[3] : sx;
    const k = Math.min(sx, sy) || 1;
    base = mul(base, [k, 0, 0, k, -vb[0] * k, -vb[1] * k]);
  }
  // <clipPath id="…"> definidos en cualquier sitio del SVG.
  const clipDefs = new Map();
  const collect = (el) => { if (el.tag === 'clippath' && el.attrs.id) clipDefs.set(el.attrs.id, el); for (const c of el.children || []) collect(c); };
  collect(tree);
  const clipOf = (ref, M) => {
    const m = /url\(\s*#([^)\s]+)\s*\)/.exec(String(ref || ''));
    const def = m && clipDefs.get(m[1]);
    if (!def) return null;
    const parts = [];
    const add = (el, Mx) => {
      const M2 = el.attrs.transform ? mul(Mx, parseTransform(el.attrs.transform)) : Mx;
      if (el.tag === 'g') { for (const c of el.children) add(c, M2); return; }
      const d = elementD(el);
      if (d) parts.push(transformPath(normalizePath(d), M2));
    };
    const M0 = def.attrs.transform ? mul(M, parseTransform(def.attrs.transform)) : M;
    for (const c of def.children) add(c, M0);
    return parts.length ? parts.join(' ') : null;
  };
  // Todo lo que tiene id (para <use>, degradados y filtros).
  const byId = new Map();
  const index = (el) => { if (el.attrs.id) byId.set(el.attrs.id, el); for (const c of el.children || []) index(c); };
  index(tree);
  const refOf = (v) => { const m = /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/.exec(String(v || '')); return m ? byId.get(m[1]) : null; };
  const hrefOf = (el) => { const h = el.attrs.href || el.attrs['xlink:href']; return h && h[0] === '#' ? byId.get(h.slice(1)) : null; };

  // Degradado: atributos y paradas heredados por href; coordenadas pasadas a fracciones de la caja del dibujo.
  const gradientOf = (ref, box) => {
    let g = refOf(ref);
    if (!g || (g.tag !== 'lineargradient' && g.tag !== 'radialgradient')) return null;
    const chain = [];
    for (let k = g; k && chain.length < 8 && !chain.includes(k); k = hrefOf(k)) chain.push(k);
    const attr = (name) => { for (const k of chain) if (k.attrs[name] != null) return k.attrs[name]; return null; };
    const stopsEl = (chain.find(k => k.children.some(c => c.tag === 'stop')) || g).children.filter(c => c.tag === 'stop');
    const stops = stopsEl.map((st, i) => {
      const off = st.attrs.offset != null ? (String(st.attrs.offset).endsWith('%') ? parseFloat(st.attrs.offset) / 100 : parseFloat(st.attrs.offset)) : i / Math.max(1, stopsEl.length - 1);
      const op = st.attrs['stop-opacity'] != null ? parseFloat(st.attrs['stop-opacity']) : 1;
      return { offset: r2(Math.max(0, Math.min(1, off || 0))), color: st.attrs['stop-color'] || '#000000', ...(op < 1 ? { opacity: r2(op) } : {}) };
    });
    if (!stops.length) return null;
    const user = attr('gradientUnits') === 'userSpaceOnUse';
    const B = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: 1, h: 1 };
    const fx = (v, d) => { if (v == null) return d; const t = String(v); if (t.endsWith('%')) return parseFloat(t) / 100; const n = parseFloat(t); return user ? (n - B.x) / B.w : n; };
    const fy = (v, d) => { if (v == null) return d; const t = String(v); if (t.endsWith('%')) return parseFloat(t) / 100; const n = parseFloat(t); return user ? (n - B.y) / B.h : n; };
    const fr = (v, d) => { if (v == null) return d; const t = String(v); if (t.endsWith('%')) return parseFloat(t) / 100; const n = parseFloat(t); return user ? n / ((B.w + B.h) / 2) : n; };
    if (g.tag === 'radialgradient') {
      const cx = fx(attr('cx'), 0.5), cy = fy(attr('cy'), 0.5);
      return { type: 'radial', cx: r2(cx), cy: r2(cy), r: r2(fr(attr('r'), 0.5)), fx: r2(fx(attr('fx'), cx)), fy: r2(fy(attr('fy'), cy)), stops };
    }
    return { type: 'linear', x1: r2(fx(attr('x1'), 0)), y1: r2(fy(attr('y1'), 0)), x2: r2(fx(attr('x2'), 1)), y2: r2(fy(attr('y2'), 0)), stops };
  };
  const firstStop = (ref) => { const g = gradientOf(ref, null); return g ? g.stops[0].color : (refOf(ref) && refOf(ref).tag === 'pattern' ? '#cccccc' : null); };

  // Sombra: feDropShadow, o feOffset + feGaussianBlur (con feFlood para el color), o CSS drop-shadow().
  const shadowOf = (v, sk) => {
    const cssBlur = /(^|\s)blur\(\s*([\d.]+)(?:px)?\s*\)/i.exec(String(v || ''));
    if (cssBlur && !/drop-shadow/i.test(String(v))) return { layerBlur: r2(+cssBlur[2] * sk) };
    const css = /drop-shadow\(\s*([-\d.]+)(?:px)?\s+([-\d.]+)(?:px)?\s*([-\d.]+)?(?:px)?\s*([^)]*\)?)?\s*\)/i.exec(String(v || ''));
    if (css) {
      const col = (css[4] || '').trim();
      return { dx: r2(+css[1] * sk), dy: r2(+css[2] * sk), blur: r2((+(css[3] || 0) / 2) * sk), color: col || '#000000', opacity: col ? 1 : 0.3 };
    }
    const f = refOf(v);
    if (!f || f.tag !== 'filter') return null;
    const all = []; const flat = (e) => { for (const c of e.children) { all.push(c); flat(c); } }; flat(f);
    const ds = all.find(c => c.tag === 'fedropshadow');
    if (ds) {
      const sd = nums(ds.attrs.stdDeviation)[0] ?? 2;
      return { dx: r2((parseFloat(ds.attrs.dx) || 0) * sk), dy: r2((parseFloat(ds.attrs.dy ?? 2) || 0) * sk), blur: r2(sd * sk), color: ds.attrs['flood-color'] || '#000000', opacity: r2(ds.attrs['flood-opacity'] != null ? parseFloat(ds.attrs['flood-opacity']) : 1) };
    }
    const off = all.find(c => c.tag === 'feoffset'), blur = all.find(c => c.tag === 'fegaussianblur');
    if (!off && !blur) return null;
    // Solo un desenfoque sobre la propia figura: desenfoque de capa, no sombra.
    if (blur && !off && !all.some(c => c.tag === 'feflood' || c.tag === 'fecolormatrix' || c.tag === 'femerge') && (!blur.attrs.in || blur.attrs.in === 'SourceGraphic')) {
      return { layerBlur: r2((nums(blur.attrs.stdDeviation)[0] || 0) * sk) };
    }
    const flood = all.find(c => c.tag === 'feflood');
    const cm = all.find(c => c.tag === 'fecolormatrix');
    let opacity = flood && flood.attrs['flood-opacity'] != null ? parseFloat(flood.attrs['flood-opacity']) : 0.3;
    if (cm && !flood) { const v2 = nums(cm.attrs.values); if (v2.length === 20) opacity = v2[18] || opacity; }
    return {
      dx: r2((off ? parseFloat(off.attrs.dx) || 0 : 0) * sk), dy: r2((off ? parseFloat(off.attrs.dy) || 0 : 0) * sk),
      blur: r2((blur ? nums(blur.attrs.stdDeviation)[0] || 0 : 0) * sk),
      color: (flood && flood.attrs['flood-color']) || '#000000', opacity: r2(opacity),
    };
  };

  const annotations0 = [], nodes0 = [];
  // Con `zStart`, cada pieza recibe su puesto en el orden del SVG (lo de después, encima), mezclando dibujos y
  // fichas: así un texto queda sobre su rectángulo aunque las fichas y los dibujos vayan en capas distintas.
  let zc = 0;
  let curClip = null;   // recorte heredado del clip-path más cercano
  let curShadow = null; // sombra de un filtro en un grupo (se aplica a cada pieza de dentro)
  let curGrp = null;    // grupo (<g> con 2+ piezas): las piezas se mueven juntas en el canvas
  let grpSeq = 0;
  const DRAWABLE = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'image', 'use']);
  const countDrawables = (el, d = 0) => {
    if (d > 20 || unknownTags.has(el.tag)) return 0;
    if (DRAWABLE.has(el.tag)) return 1;
    let c = 0; for (const k of el.children || []) { c += countDrawables(k, d + 1); if (c > 1) break; }
    return c;
  };
  const grpBase = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const annotations = { push: (a) => {
    if (zStart != null) a.z = zStart + (zc++);
    if (curClip) a.clip = { d: curClip };
    if (curShadow && curShadow.layerBlur != null) { if (a.blur == null) a.blur = curShadow.layerBlur; }
    else if (curShadow && !a.shadow) a.shadow = curShadow;
    if (curGrp) a.grp = curGrp;
    annotations0.push(a);
  } };
  const nodes = { push: (n) => { if (zStart != null) n.z = zStart + (zc++); if (curGrp) n.grp = curGrp; nodes0.push(n); } };
  let skipped = 0;
  const unknown = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'filter', 'pattern', 'symbol', 'marker']);
  const unknownTags = unknown;

  const walk = (el, m, inh, depth = 0) => {
    if (unknown.has(el.tag)) return;
    if (el.attrs.display === 'none' || el.attrs.visibility === 'hidden') return;
    const st = { ...inh };
    for (const k of INHERIT) if (el.attrs[k] != null) st[k] = el.attrs[k];
    const M = el.attrs.transform ? mul(m, parseTransform(el.attrs.transform)) : m;
    const savedClip = curClip, savedShadow = curShadow, savedGrp = curGrp;
    // Solo grupos «hoja» (un botón, una fila): un <g> que envuelve otros grupos (una pantalla entera) no se
    // agrupa, para que sus partes se puedan seguir moviendo por separado.
    const isGroup = (g) => (g.tag === 'g' || g.tag === 'a') && countDrawables(g) > 1;
    const hasInner = (g, d = 0) => d < 20 && (g.children || []).some(k => (isGroup(k) && k !== g) || hasInner(k, d + 1));
    if (!curGrp && depth === 0 && isGroup(el) && !hasInner(el)) curGrp = `${grpBase}-${grpSeq++}`;
    if (el.attrs['clip-path'] && el.attrs['clip-path'] !== 'none') { const c = clipOf(el.attrs['clip-path'], M); if (c) curClip = c; }
    if (el.attrs.filter && el.attrs.filter !== 'none') { const sh = shadowOf(el.attrs.filter, Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1); if (sh) curShadow = sh; }
    try { walkInner(el, M, st, depth); } finally { curClip = savedClip; curShadow = savedShadow; curGrp = savedGrp; }
  };
  const walkInner = (el, M, st, depth) => {
    const sw = (st['stroke-width'] != null ? parseFloat(st['stroke-width']) : 1) * (Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1);
    const fillGrad = /^url\(/i.test(String(st.fill || '').trim()) ? st.fill : null;
    const fill = st.fill === 'none' ? 'none' : (fillGrad ? (firstStop(fillGrad) || '#000000') : (colorOf(st.fill) || '#000000'));
    const stroke = st.stroke == null || st.stroke === 'none' ? null : (/^url\(/i.test(String(st.stroke).trim()) ? firstStop(st.stroke) : colorOf(st.stroke)) || null;
    const paint = (a, box) => {
      if (!fillGrad) return a;
      const pat = refOf(fillGrad);
      if (pat && pat.tag === 'pattern') {
        // <pattern> con una <image>: imagen como relleno (cubrir, salvo que diga lo contrario).
        const find = (e) => (e.tag === 'image' ? e : (e.children || []).map(find).find(Boolean));
        const img = find(pat);
        const href = img && (img.attrs.href || img.attrs['xlink:href']);
        if (href && /^(https?:|data:image\/)/i.test(href)) {
          const par = String(img.attrs.preserveAspectRatio || '');
          a.imageFill = { src: href, fit: par === 'none' ? 'fill' : /meet/.test(par) ? 'contain' : 'cover' };
        }
        return a;
      }
      const g = gradientOf(fillGrad, box); if (g) a.gradient = g;
      return a;
    };
    const op = (parseFloat(st.opacity ?? 1) || 1) * (fill !== 'none' ? (parseFloat(st['fill-opacity'] ?? 1)) : (parseFloat(st['stroke-opacity'] ?? 1)));
    const style = (a) => {
      const bf = /blur\(\s*([\d.]+)/i.exec(String(el.attrs['backdrop-filter'] || el.attrs['-webkit-backdrop-filter'] || ''));
      if (bf) a.bgBlur = r2(+bf[1]);
      if (op < 1) a.opacity = r2(op);
      if (st['stroke-dasharray'] && st['stroke-dasharray'] !== 'none') a.dash = 'dashed';
      return a;
    };
    const asPath = (cmds) => {
      const d = transformPath(cmds, M);
      const bb = pathBbox(normalizePath(d));
      if (!bb) return;
      annotations.push(paint(style({ id: id('ann'), kind: 'path', d, fill, color: stroke || 'none', strokeWidth: stroke ? r2(Math.max(0.5, sw)) : 0.01, bbox: { x: r2(bb.x), y: r2(bb.y), w: r2(bb.w), h: r2(bb.h) } }), pathBbox(cmds)));
    };
    const shapeBox = (kind, bx, by, bw, bh, rx) => {
      if (!(bw > 0 && bh > 0)) return;
      if (!axisAligned(M)) {
        // girado o sesgado: como trazo, con su forma exacta
        const cmds = kind === 'ellipse'
          ? normalizePath(`M ${bx} ${by + bh / 2} A ${bw / 2} ${bh / 2} 0 1 0 ${bx + bw} ${by + bh / 2} A ${bw / 2} ${bh / 2} 0 1 0 ${bx} ${by + bh / 2} Z`)
          : normalizePath(`M ${bx} ${by} H ${bx + bw} V ${by + bh} H ${bx} Z`);
        asPath(cmds); return;
      }
      const [x0, y0] = apply(M, bx, by), [x1, y1] = apply(M, bx + bw, by + bh);
      const X = Math.min(x0, x1), Y = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
      const sk = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
      const extra = kind === 'rect' ? { rx: r2((rx || 0) * sk) } : {};
      annotations.push(paint(style({ id: id('ann'), kind: 'shape', shape: kind, ...extra, x: r2(X), y: r2(Y), w: r2(W), h: r2(H), color: stroke || 'none', strokeWidth: stroke ? r2(Math.max(0.5, sw)) : 0.01, fill, bbox: { x: r2(X), y: r2(Y), w: r2(W), h: r2(H) } }), { x: bx, y: by, w: bw, h: bh }));
    };
    const A = el.attrs, n = (k, d = 0) => (A[k] != null ? parseFloat(A[k]) || 0 : d);
    switch (el.tag) {
      case 'svg': case 'g': case 'a': case '#root': case 'switch':
        for (const c of el.children) walk(c, M, st, depth);
        return;
      case 'use': {
        const ref = hrefOf(el);
        if (!ref || depth > 8) { skipped++; return; }
        const Mu = mul(M, [1, 0, 0, 1, n('x'), n('y')]);
        if (ref.tag === 'symbol') { for (const c of ref.children) walk(c, Mu, st, depth + 1); }
        else walk(ref, Mu, st, depth + 1);
        return;
      }
      case 'rect': shapeBox('rect', n('x'), n('y'), n('width'), n('height'), A.rx != null ? n('rx') : (A.ry != null ? n('ry') : 0)); return;
      case 'circle': shapeBox('ellipse', n('cx') - n('r'), n('cy') - n('r'), 2 * n('r'), 2 * n('r')); return;
      case 'ellipse': shapeBox('ellipse', n('cx') - n('rx'), n('cy') - n('ry'), 2 * n('rx'), 2 * n('ry')); return;
      case 'line': {
        const [x1, y1] = apply(M, n('x1'), n('y1')), [x2, y2] = apply(M, n('x2'), n('y2'));
        annotations.push(style({ id: id('ann'), kind: 'shape', shape: 'line', x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), color: stroke || '#000000', strokeWidth: r2(Math.max(0.5, sw)), bbox: { x: r2(Math.min(x1, x2)), y: r2(Math.min(y1, y2)), w: r2(Math.abs(x2 - x1)), h: r2(Math.abs(y2 - y1)) } }));
        return;
      }
      case 'polyline': case 'polygon': {
        const v = nums(A.points);
        if (v.length < 4) return;
        let d = `M ${v[0]} ${v[1]}`;
        for (let i = 2; i + 1 < v.length; i += 2) d += ` L ${v[i]} ${v[i + 1]}`;
        if (el.tag === 'polygon') d += ' Z';
        asPath(normalizePath(d));
        return;
      }
      case 'path': if (A.d) asPath(normalizePath(A.d)); return;
      case 'text': {
        // Varias líneas: cada <tspan> con y/dy propio empieza línea (así escriben los textos de varias líneas).
        const lines = [];
        let cur = el.text.replace(/\s+/g, ' ').trim();
        let dyStep = 0;
        for (const c of el.children) {
          const piece = (c.text + c.children.map(x => x.text).join(' ')).replace(/\s+/g, ' ').trim();
          if (c.tag === 'tspan' && (c.attrs.dy != null || c.attrs.y != null) && cur) {
            lines.push(cur); cur = piece;
            if (c.attrs.dy != null && !dyStep) dyStep = String(c.attrs.dy).endsWith('em') ? parseFloat(c.attrs.dy) * (parseFloat(st['font-size']) || 16) : parseFloat(c.attrs.dy);
          } else cur = (cur ? cur + ' ' : '') + piece;
        }
        if (cur) lines.push(cur);
        const txt = lines.join('\n');
        if (!txt) return;
        const fs = (parseFloat(st['font-size']) || 16) * (Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1);
        const [tx, ty] = apply(M, n('x'), n('y'));
        // Caja holgada y el texto alineado dentro como en el SVG (inicio / centro / final): así un texto centrado
        // en un botón sigue centrado aunque el ancho estimado no sea exacto. Línea de 1.25 em y sin relleno: la
        // línea base cae a ~0.98 em de arriba; con dominant-baseline middle/central, `y` es el centro de la línea.
        const longest = Math.max(...lines.map(l => l.length));
        const w = Math.max(40, longest * fs * 0.68 + 12);
        const lh = dyStep > 0 ? dyStep / (parseFloat(st['font-size']) || 16) : 1.25;
        const anchor = st['text-anchor'] || A['text-anchor'];
        const left = anchor === 'middle' ? tx - w / 2 : anchor === 'end' ? tx - w : tx;
        const db = String(st['dominant-baseline'] || A['dominant-baseline'] || A['alignment-baseline'] || '');
        const top = /middle|central/.test(db) ? ty - fs * 0.625 : /hanging|text-before-edge/.test(db) ? ty - fs * 0.1 : ty - fs * 0.98;
        const node = { id: id('n'), kind: 'label', noWrap: true, plain: true, text: txt, x: r2(left), y: r2(top), w: r2(w), h: r2(fs * lh * lines.length), fontSize: r2(fs) };
        if (Math.abs(lh - 1.25) > 0.01) node.lineHeight = r2(lh);
        const fam = String(st['font-family'] || '').split(',')[0].replace(/['"]/g, '').trim();
        if (fam) node.font = /^(sans-serif|system-ui|-apple-system|inter)$/i.test(fam) ? 'sans' : /^serif$/i.test(fam) ? 'serif' : /^monospace$/i.test(fam) ? 'mono' : fam;
        const fwRaw = String(st['font-weight'] || '');
        const fw = fwRaw === 'bold' ? 700 : fwRaw === 'normal' ? 400 : parseInt(fwRaw, 10);
        if (fw && fw !== 400) node.weight = fw;
        if (/italic|oblique/.test(String(st['font-style'] || A['font-style'] || ''))) node.italic = true;
        const deco = String(st['text-decoration'] || A['text-decoration'] || '');
        if (/underline/.test(deco)) node.underline = true;
        if (/line-through/.test(deco)) node.strike = true;
        const lsp = parseFloat(st['letter-spacing']);
        if (lsp) node.letterSpacing = r2(lsp * (Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1));
        const tt = String(st['text-transform'] || '');
        if (tt === 'uppercase') node.transform = 'upper'; else if (tt === 'lowercase') node.transform = 'lower'; else if (tt === 'capitalize') node.transform = 'title';
        if (anchor === 'middle') node.align = 'center'; else if (anchor === 'end') node.align = 'right';
        const col = fillGrad ? firstStop(fillGrad) : colorOf(st.fill);
        if (col && col !== 'none') node.color = col;
        nodes.push(node);
        return;
      }
      case 'image': {
        const href = A.href || A['xlink:href'];
        if (!href || !/^(https?:|data:image\/)/i.test(href)) { skipped++; return; }
        const [x0, y0] = apply(M, n('x'), n('y')), [x1, y1] = apply(M, n('x') + n('width', 100), n('y') + n('height', 100));
        nodes.push({ id: id('n'), kind: 'image', url: href, x: r2(Math.min(x0, x1)), y: r2(Math.min(y0, y1)), w: r2(Math.abs(x1 - x0)), h: r2(Math.abs(y1 - y0)) });
        return;
      }
      default:
        skipped++;
    }
  };
  walk(rootSvg, base, {});
  return finish(annotations0, nodes0, skipped);
}

function finish(annotations, nodes, skipped) {

  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const b of [...annotations.map(a => a.bbox), ...nodes]) {
    if (!b) continue;
    bx0 = Math.min(bx0, b.x); by0 = Math.min(by0, b.y); bx1 = Math.max(bx1, b.x + b.w); by1 = Math.max(by1, b.y + b.h);
  }
  const bbox = bx0 === Infinity ? null : { x: r2(bx0), y: r2(by0), w: r2(bx1 - bx0), h: r2(by1 - by0) };
  return { annotations, nodes, bbox, skipped };
}

/** Arcos → curvas Bézier cúbicas (para editar sus puntos como en Figma). Comandos normalizados de entrada/salida. */
export function arcsToCubics(cmds) {
  const out = [];
  let px = 0, py = 0, sx = 0, sy = 0;
  for (const cmd of cmds) {
    const { c, v } = cmd;
    if (c === 'M') { px = sx = v[0]; py = sy = v[1]; out.push(cmd); continue; }
    if (c === 'Z') { px = sx; py = sy; out.push(cmd); continue; }
    if (c !== 'A') { out.push(cmd); px = v[v.length - 2]; py = v[v.length - 1]; continue; }
    let [rx, ry, rot, large, sweep, x, y] = v;
    if (!rx || !ry) { out.push({ c: 'L', v: [x, y] }); px = x; py = y; continue; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx2 = (px - x) / 2, dy2 = (py - y) / 2;
    const x1p = cos * dx2 + sin * dy2, y1p = -sin * dx2 + cos * dy2;
    let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const sign = large === sweep ? -1 : 1;
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, num / den));
    const cxp = co * ((rx * y1p) / ry), cyp = co * (-(ry * x1p) / rx);
    const cx = cos * cxp - sin * cyp + (px + x) / 2, cy = sin * cxp + cos * cyp + (py + y) / 2;
    const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
    const d = dt / segs, k = (4 / 3) * Math.tan(d / 4);
    let a0 = t1;
    for (let i = 0; i < segs; i++) {
      const a1 = a0 + d;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const pt = (ex, ey) => [cos * rx * ex - sin * ry * ey + cx, sin * rx * ex + cos * ry * ey + cy];
      const p1 = pt(c0 - k * s0, s0 + k * c0), p2 = pt(c1 + k * s1, s1 - k * c1), p3 = pt(c1, s1);
      out.push({ c: 'C', v: [...p1, ...p2, ...p3].map(n => Math.round(n * 100) / 100) });
      a0 = a1;
    }
    px = x; py = y;
  }
  return out;
}
