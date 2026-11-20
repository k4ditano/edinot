import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svgToCanvas, normalizePath, parseTransform, pathBbox } from '../shared/svg-import.js';

test('basic shapes become editable canvas elements, placed at x/y', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
    <rect x="10" y="10" width="80" height="40" fill="#ff0000" stroke="#000" stroke-width="2"/>
    <circle cx="150" cy="50" r="20" fill="none" stroke="blue"/>
    <line x1="0" y1="90" x2="200" y2="90" stroke="#333"/>
    <text x="20" y="80" font-size="12" fill="#111">Hola</text>
  </svg>`;
  const r = svgToCanvas(svg, { x: 1000, y: 500 });
  assert.equal(r.annotations.length, 3);
  const [rect, circ, line] = r.annotations;
  assert.deepEqual([rect.kind, rect.shape, rect.x, rect.y, rect.w, rect.h, rect.fill, rect.color], ['shape', 'rect', 1010, 510, 80, 40, '#ff0000', '#000']);
  assert.deepEqual([circ.shape, circ.x, circ.y, circ.w, circ.fill, circ.color], ['ellipse', 1130, 530, 40, 'none', 'blue']);
  assert.deepEqual([line.shape, line.x1, line.y1, line.x2], ['line', 1000, 590, 1200]);
  assert.equal(r.nodes.length, 1);
  assert.equal(r.nodes[0].kind, 'label');
  assert.equal(r.nodes[0].text, 'Hola');
  assert.equal(r.nodes[0].color, '#111');
});

test('group transforms and inherited styles apply', () => {
  const r = svgToCanvas('<svg><g transform="translate(100 50) scale(2)" fill="green"><rect width="10" height="5"/></g></svg>');
  const a = r.annotations[0];
  assert.deepEqual([a.x, a.y, a.w, a.h, a.fill], [100, 50, 20, 10, 'green']);
});

test('rotated rect turns into a path; relative paths are normalized and moved', () => {
  const r = svgToCanvas('<svg><rect x="0" y="0" width="10" height="10" transform="rotate(45)"/><path d="m10 10 h20 v20 z" stroke="red" fill="none"/></svg>', { x: 5, y: 5 });
  assert.equal(r.annotations[0].kind, 'path');
  const p = r.annotations[1];
  assert.equal(p.kind, 'path');
  assert.equal(p.d, 'M 15 15 L 35 15 L 35 35 Z');
  assert.deepEqual(p.bbox, { x: 15, y: 15, w: 20, h: 20 });
  assert.equal(p.color, 'red');
});

test('helpers', () => {
  assert.deepEqual(parseTransform('translate(3,4)'), [1, 0, 0, 1, 3, 4]);
  const c = normalizePath('M0 0 C 1 1 2 2 3 3 S 5 5 6 6');
  assert.equal(c[2].c, 'C');
  assert.deepEqual(c[2].v.slice(0, 2), [4, 4]);
  assert.deepEqual(pathBbox(normalizePath('M0 0 L 10 0 L 10 5')), { x: 0, y: 0, w: 10, h: 5 });
});

test('images with http/data hrefs become image nodes; unsupported things are skipped', () => {
  const r = svgToCanvas('<svg><image href="https://x/y.png" x="1" y="2" width="30" height="20"/><image href="file:///etc/passwd"/><foo/></svg>');
  assert.equal(r.nodes.length, 1);
  assert.equal(r.nodes[0].url, 'https://x/y.png');
  assert.equal(r.skipped, 2);
});

test('zStart interleaves drawings and labels in SVG order', () => {
  const r = svgToCanvas('<svg><rect width="10" height="10"/><text x="1" y="8">a</text><rect width="5" height="5"/></svg>', { zStart: 100 });
  assert.deepEqual([r.annotations[0].z, r.nodes[0].z, r.annotations[1].z], [100, 101, 102]);
});

test('rect corner radius and unwrapped labels', () => {
  const r = svgToCanvas('<svg><rect width="100" height="40" rx="20"/><text x="0" y="10">420</text></svg>', { scale: 2 });
  assert.equal(r.annotations[0].rx, 40);
  assert.equal(r.nodes[0].noWrap, true);
});

test('clip-path becomes a clip on every drawing inside, in world coords', () => {
  const svg = `<svg><defs><clipPath id="screen"><rect width="100" height="200" rx="20"/></clipPath></defs>
    <g clip-path="url(#screen)"><rect width="100" height="60" fill="orange"/><circle cx="90" cy="30" r="30"/></g>
    <rect x="200" width="10" height="10"/></svg>`;
  const r = svgToCanvas(svg, { x: 1000, y: 0 });
  assert.equal(r.annotations.length, 3);
  assert.match(r.annotations[0].clip.d, /^M 1020 0 L 1080 0 A 20 20/);
  assert.ok(r.annotations[1].clip);
  assert.equal(r.annotations[2].clip, undefined);
});

test('CSS classes, ids, descendants; inline style wins over CSS', () => {
  const svg = `<svg><style>.card{fill:#eee;stroke:#333} #hero{fill:red} g.dark rect{fill:#111} .t{font-size:20px;fill:#0a0}</style>
    <rect class="card" width="10" height="10"/>
    <rect id="hero" class="card" width="10" height="10"/>
    <g class="dark"><rect class="card" width="10" height="10"/></g>
    <rect class="card" style="fill:blue" width="10" height="10"/>
    <text class="t" x="0" y="20">Hi</text></svg>`;
  const r = svgToCanvas(svg);
  assert.deepEqual(r.annotations.map(a => a.fill), ['#eee', 'red', '#111', 'blue']);
  assert.equal(r.annotations[0].color, '#333');
  assert.equal(r.nodes[0].fontSize, 20);
  assert.equal(r.nodes[0].color, '#0a0');
});

test('<use> and <symbol> are expanded with their offset', () => {
  const svg = `<svg><defs><symbol id="dot"><circle cx="5" cy="5" r="5" fill="red"/></symbol><rect id="b" width="4" height="4"/></defs>
    <use href="#dot" x="100" y="0"/><use xlink:href="#b" x="0" y="50"/></svg>`;
  const r = svgToCanvas(svg);
  assert.equal(r.annotations.length, 2);
  assert.deepEqual([r.annotations[0].x, r.annotations[0].fill], [100, 'red']);
  assert.deepEqual([r.annotations[1].x, r.annotations[1].y], [0, 50]);
});

test('linear / radial gradients (with href and userSpaceOnUse) become gradient fills', () => {
  const svg = `<svg><defs>
    <linearGradient id="base"><stop offset="0" stop-color="#f00"/><stop offset="100%" stop-color="#00f" stop-opacity=".5"/></linearGradient>
    <linearGradient id="v" href="#base" x1="0" y1="0" x2="0" y2="1"/>
    <radialGradient id="r" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="25"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient>
    </defs>
    <rect width="100" height="100" fill="url(#v)"/><rect width="100" height="100" fill="url('#r')"/></svg>`;
  const [a, b] = svgToCanvas(svg).annotations;
  assert.equal(a.fill, '#f00');
  assert.deepEqual(a.gradient, { type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f', opacity: 0.5 }] });
  assert.equal(b.gradient.type, 'radial');
  assert.deepEqual([b.gradient.cx, b.gradient.cy, b.gradient.r], [0.5, 0.5, 0.25]);
});

test('shadows: feDropShadow, offset+blur, CSS drop-shadow, and group filters', () => {
  const svg = `<svg><defs>
    <filter id="s1"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity=".2"/></filter>
    <filter id="s2"><feOffset dx="2" dy="3"/><feGaussianBlur stdDeviation="4"/></filter></defs>
    <rect width="10" height="10" filter="url(#s1)"/>
    <g filter="url(#s2)"><rect width="10" height="10"/></g>
    <rect width="10" height="10" style="filter: drop-shadow(0 8px 16px rgba(0,0,0,.3))"/></svg>`;
  const [a, b, c] = svgToCanvas(svg).annotations;
  assert.deepEqual(a.shadow, { dx: 0, dy: 4, blur: 6, color: '#000', opacity: 0.2 });
  assert.deepEqual([b.shadow.dx, b.shadow.dy, b.shadow.blur], [2, 3, 4]);
  assert.deepEqual([c.shadow.dy, c.shadow.blur, c.shadow.color], [8, 8, 'rgba(0,0,0,.3)']);
});

test('!important beats more specific CSS rules', () => {
  const r = svgToCanvas('<svg><style>.row .a{fill:red} .pos{fill:green !important}</style><g class="row"><rect class="a pos" width="5" height="5"/></g></svg>');
  assert.equal(r.annotations[0].fill, 'green');
});

test('centred button text stays centred (text-anchor middle, dominant-baseline middle)', () => {
  const r = svgToCanvas('<svg><rect x="0" y="0" width="200" height="40"/><text x="100" y="20" text-anchor="middle" dominant-baseline="middle" font-size="16">Enviar</text></svg>');
  const n = r.nodes[0];
  assert.equal(n.align, 'center');
  assert.ok(Math.abs(n.x + n.w / 2 - 100) < 0.01);     // caja centrada en x=100
  assert.ok(Math.abs(n.y + n.h / 2 - 20) < 0.01);      // y su línea centrada en y=20
  assert.equal(n.plain, true);
});

test('text styling: family, weight, italic, decoration, spacing, case and multi-line tspans', () => {
  const svg = `<svg><text x="0" y="20" font-family="'Playfair Display', serif" font-weight="800" font-style="italic" text-decoration="underline" letter-spacing="2" style="text-transform:uppercase" font-size="20">Hola<tspan x="0" dy="30">mundo</tspan></text>
    <text x="0" y="90" font-family="monospace">x</text></svg>`;
  const [a, b] = svgToCanvas(svg).nodes;
  assert.equal(a.text, 'Hola\nmundo');
  assert.deepEqual([a.font, a.weight, a.italic, a.underline, a.letterSpacing, a.transform, a.lineHeight], ['Playfair Display', 800, true, true, 2, 'upper', 1.5]);
  assert.equal(b.font, 'mono');
});

test('layer blur and backdrop blur', () => {
  const svg = `<svg><defs><filter id="b"><feGaussianBlur stdDeviation="8"/></filter></defs>
    <circle r="10" filter="url(#b)"/><rect width="10" height="10" style="filter: blur(3px)"/><rect width="10" height="10" style="backdrop-filter: blur(20px)" fill="rgba(255,255,255,.4)"/></svg>`;
  const [a, b, c] = svgToCanvas(svg).annotations;
  assert.equal(a.blur, 8); assert.equal(a.shadow, undefined);
  assert.equal(b.blur, 3);
  assert.equal(c.bgBlur, 20);
});

test('leaf <g> groups become canvas groups (pieces move together); wrappers do not', () => {
  const svg = `<svg><g id="screen"><rect width="300" height="500"/>
    <g id="btn"><rect x="10" y="10" width="100" height="40"/><text x="20" y="35">OK</text></g>
    <g id="row"><circle cx="20" cy="100" r="10"/><text x="40" y="105">Fila</text></g></g></svg>`;
  const r = svgToCanvas(svg);
  const bg = r.annotations[0], btn = r.annotations[1], ok = r.nodes[0], dot = r.annotations[2], fila = r.nodes[1];
  assert.equal(bg.grp, undefined);
  assert.ok(btn.grp && btn.grp === ok.grp);
  assert.ok(dot.grp && dot.grp === fila.grp && dot.grp !== btn.grp);
});

test('arcsToCubics turns a circle into 4 Bézier curves ending where the arcs did', async () => {
  const { arcsToCubics } = await import('../shared/svg-import.js');
  const c = arcsToCubics(normalizePath('M 0 50 A 50 50 0 1 0 100 50 A 50 50 0 1 0 0 50 Z'));
  const curves = c.filter(x => x.c === 'C');
  assert.equal(curves.length, 4);
  const last = curves[curves.length - 1].v;
  assert.ok(Math.abs(last[4] - 0) < 0.01 && Math.abs(last[5] - 50) < 0.01);
  const mid = curves[1].v;
  assert.ok(Math.abs(mid[4] - 100) < 0.01 && Math.abs(mid[5] - 50) < 0.01);
});
