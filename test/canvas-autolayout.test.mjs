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
