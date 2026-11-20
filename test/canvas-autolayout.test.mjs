import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAutoLayout, FRAME_HEAD } from '../editor/canvas/autolayout.js';

const frame = (layout, extra = {}) => ({ id: 'f', title: 'Lista', x: 0, y: 0, w: 300, h: 400, layout, ...extra });

test('column: stacks children top to bottom with gap and padding, keeping their order', () => {
  const json = {
    groups: [frame({ dir: 'column', gap: 10, pad: 20 })],
    nodes: [{ id: 'b', kind: 'label', x: 50, y: 200, w: 100, h: 30 }, { id: 'a', kind: 'label', x: 80, y: 60, w: 100, h: 40 }],
    annotations: [{ id: 'r', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 120, h: 50, bbox: { x: 0, y: 0, w: 120, h: 50 }, ox: 30, oy: 300 }],
  };
  const j = applyAutoLayout(json);
  const a = j.nodes.find(n => n.id === 'a'), b = j.nodes.find(n => n.id === 'b'), r = j.annotations[0];
  assert.deepEqual([a.x, a.y], [20, FRAME_HEAD + 20]);
  assert.deepEqual([b.x, b.y], [20, FRAME_HEAD + 20 + 40 + 10]);
  assert.deepEqual([r.bbox.x + r.ox, r.bbox.y + r.oy], [20, FRAME_HEAD + 20 + 40 + 10 + 30 + 10]);
  assert.equal(applyAutoLayout(j), j);   // estable: una segunda pasada no cambia nada
});

test('row + center + hug resizes the frame; a grouped button moves as one piece', () => {
  const json = {
    groups: [frame({ dir: 'row', gap: 8, pad: 10, align: 'center', hug: true })],
    nodes: [{ id: 't', kind: 'label', grp: 'btn', x: 115, y: 115, w: 50, h: 20 }],
    annotations: [{ id: 'bg', kind: 'shape', shape: 'rect', grp: 'btn', x: 100, y: 100, w: 80, h: 50, bbox: { x: 100, y: 100, w: 80, h: 50 } },
      { id: 'c', kind: 'shape', shape: 'ellipse', x: 200, y: 100, w: 30, h: 30, bbox: { x: 200, y: 100, w: 30, h: 30 } }],
  };
  const j = applyAutoLayout(json);
  const g = j.groups[0];
  assert.deepEqual([g.w, g.h], [10 + 80 + 8 + 30 + 10, FRAME_HEAD + 10 + 50 + 10]);
  const bg = j.annotations.find(a => a.id === 'bg'), t = j.nodes[0], c = j.annotations.find(a => a.id === 'c');
  assert.deepEqual([bg.x + bg.ox, bg.y + bg.oy], [10, FRAME_HEAD + 10]);
  assert.deepEqual([t.x - (bg.x + bg.ox), t.y - (bg.y + bg.oy)], [15, 15]);   // el texto sigue en su sitio dentro del botón
  assert.deepEqual([c.x + c.ox, c.y + c.oy], [10 + 80 + 8, FRAME_HEAD + 10 + 10]);  // centrado en vertical
});

test('frames without layout are untouched', () => {
  const json = { groups: [{ id: 'f', x: 0, y: 0, w: 100, h: 100 }], nodes: [{ id: 'n', x: 5, y: 50, w: 10, h: 10 }] };
  assert.equal(applyAutoLayout(json), json);
});

const lbl = (id, x, y, w, h, extra = {}) => ({ id, kind: 'label', text: id, x, y, w, h, ...extra });

test('row with wrap breaks into lines inside the frame width', () => {
  const json = { groups: [{ id: 'f', x: 0, y: 0, w: 260, h: 400, layout: { dir: 'row', gap: 10, pad: 10, wrap: true, gapCross: 20 } }],
    nodes: [lbl('a', 10, 40, 100, 30), lbl('b', 120, 40, 100, 30), lbl('c', 150, 100, 100, 30)] };
  const j = applyAutoLayout(json);
  const c = j.nodes.find(n => n.id === 'c');
  assert.deepEqual([c.x, c.y], [10, FRAME_HEAD + 10 + 30 + 20]);
});

test('fill: children share the free space (with min/max) and stretch across', () => {
  const json = { groups: [{ id: 'f', x: 0, y: 0, w: 420, h: 200, layout: { dir: 'row', gap: 10, pad: 10 } }],
    nodes: [lbl('a', 10, 40, 100, 30), lbl('b', 150, 40, 50, 30, { sizeW: 'fill' }), lbl('c', 300, 40, 50, 30, { sizeW: 'fill', maxW: 80, sizeH: 'fill' })] };
  const j = applyAutoLayout(json);
  const b = j.nodes.find(n => n.id === 'b'), c = j.nodes.find(n => n.id === 'c');
  // libre = 400 - 100 - 20 = 280 → 140 cada uno; c tiene máximo 80
  assert.equal(b.w, 140);
  assert.equal(c.w, 80);
  assert.equal(c.h, 200 - FRAME_HEAD - 20);
});

test('grid: N columns, spans and row heights', () => {
  const json = { groups: [{ id: 'f', x: 0, y: 0, w: 340, h: 500, layout: { dir: 'grid', columns: 3, gap: 10, gapY: 10, pad: 10 } }],
    nodes: [lbl('a', 10, 40, 50, 40), lbl('b', 120, 40, 50, 60, { sizeW: 'fill' }), lbl('c', 230, 40, 50, 30, { span: 2, sizeW: 'fill' }), lbl('d', 10, 200, 50, 30)] };
  const j = applyAutoLayout(json);
  const get = (id) => j.nodes.find(n => n.id === id);
  // celda = (320 - 20) / 3 = 100
  assert.deepEqual([get('a').x, get('a').y], [10, FRAME_HEAD + 10]);
  assert.deepEqual([get('b').x, get('b').w], [120, 100]);
  // c ocupa 2 columnas → no cabe en la fila 1 (quedaba 1) → fila 2, ancho 210
  assert.deepEqual([get('c').x, get('c').y, get('c').w], [10, FRAME_HEAD + 10 + 60 + 10, 210]);
  assert.deepEqual([get('d').x, get('d').y], [230, FRAME_HEAD + 10 + 60 + 10]);
});

test('nested frames: a hugging child frame is laid out first and moved by its parent with its content', () => {
  const json = { groups: [
    { id: 'outer', x: 0, y: 0, w: 600, h: 600, layout: { dir: 'column', gap: 10, pad: 10 } },
    { id: 'inner', x: 50, y: 300, w: 300, h: 200, layout: { dir: 'row', gap: 5, pad: 5, hug: true } },
  ], nodes: [lbl('top', 10, 40, 100, 30), lbl('i1', 60, 340, 40, 20), lbl('i2', 120, 340, 40, 20)] };
  const j = applyAutoLayout(json);
  const inner = j.groups.find(g => g.id === 'inner');
  assert.deepEqual([inner.w, inner.h], [5 + 40 + 5 + 40 + 5, FRAME_HEAD + 5 + 20 + 5]);
  assert.deepEqual([inner.x, inner.y], [10, FRAME_HEAD + 10 + 30 + 10]);
  const i1 = j.nodes.find(n => n.id === 'i1');
  assert.deepEqual([i1.x, i1.y], [inner.x + 5, inner.y + FRAME_HEAD + 5]);
  assert.equal(applyAutoLayout(j), j);
});

test('absolute children stay put; constraints follow the frame when it is resized', async () => {
  const { applyConstraints } = await import('../editor/canvas/autolayout.js');
  const json = { groups: [{ id: 'f', x: 0, y: 0, w: 300, h: 300, layout: { dir: 'column', pad: 10 } }], nodes: [lbl('a', 10, 100, 50, 20), lbl('abs', 200, 250, 30, 20, { layoutAbsolute: true })] };
  const j = applyAutoLayout(json);
  assert.deepEqual([j.nodes[1].x, j.nodes[1].y], [200, 250]);
  const k = { groups: [{ id: 'g', x: 0, y: 0, w: 300, h: 300 }], nodes: [
    lbl('r', 240, 100, 50, 20, { constraints: { h: 'right' } }), lbl('s', 10, 260, 280, 30, { constraints: { h: 'stretch', v: 'bottom' } }), lbl('l', 10, 100, 50, 20)] };
  const nk = { ...k, groups: [{ id: 'g', x: 0, y: 0, w: 500, h: 400 }] };
  const out = applyConstraints(nk, 'g', { x: 0, y: 0, w: 300, h: 300 }, { x: 0, y: 0, w: 500, h: 400 });
  const get = (id) => out.nodes.find(n => n.id === id);
  assert.equal(get('r').x, 440);
  assert.deepEqual([get('s').x, get('s').w, get('s').y], [10, 480, 360]);
  assert.equal(get('l').x, 10);
});

test('moving a frame without layout carries its content (constraints default)', async () => {
  const { applyConstraints } = await import('../editor/canvas/autolayout.js');
  const json = { groups: [{ id: 'g', x: 1000, y: 1000, w: 300, h: 300 }], nodes: [lbl('a', 20, 60, 50, 20)], annotations: [{ id: 'r', kind: 'shape', shape: 'rect', x: 10, y: 100, w: 40, h: 40, bbox: { x: 10, y: 100, w: 40, h: 40 } }] };
  const out = applyConstraints(json, 'g', { x: 0, y: 0, w: 300, h: 300 }, { x: 1000, y: 1000, w: 300, h: 300 });
  assert.deepEqual([out.nodes[0].x, out.nodes[0].y], [1020, 1060]);
  const r = out.annotations[0];
  assert.deepEqual([r.bbox.x + r.ox, r.bbox.y + r.oy], [1010, 1100]);
});

test('shrinking a wrap auto layout frame keeps every child inside (they wrap instead of falling out)', async () => {
  const { applyConstraints, applyAutoLayout, frameMembers } = await import('../editor/canvas/autolayout.js');
  const j0 = {
    groups: [{ id: 'F', x: 0, y: 0, w: 900, h: 300, layout: { dir: 'row', wrap: true, gap: 16, pad: 24 } }],
    nodes: [0, 1, 2, 3].map(i => ({ id: 'c' + i, kind: 'shape', shape: 'rect', text: 'x', x: 24 + i * 206, y: 50, w: 190, h: 100 })),
    annotations: [],
  };
  const j1 = applyAutoLayout(j0);
  const old = { x: 0, y: 0, w: 900, h: 300 }, nw = { x: 0, y: 0, w: 375, h: 300 };
  const j2 = applyAutoLayout(applyConstraints({ ...j1, groups: j1.groups.map(g => ({ ...g, w: 375 })) }, 'F', old, nw));
  assert.equal((frameMembers(j2).get('F') || []).length, 4);
  assert.ok(j2.nodes.every(n => n.x + n.w <= 375));
});
