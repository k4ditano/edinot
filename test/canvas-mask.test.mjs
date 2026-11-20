import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskGeometry, clipFor, applyMask, releaseMask, canMask } from '../shared/canvas-mask.js';

const phone = { id: 'p', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 200, rx: 20 };
const head = { id: 'h', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 60, rx: 0 };
const blob = { id: 'b', kind: 'shape', shape: 'ellipse', x: 80, y: 30, w: 60, h: 60 };

test('rounded rect mask follows the radius, offset and rotation', () => {
  const g = maskGeometry({ ...phone, ox: 5, oy: 6, rot: 10 });
  assert.match(g.d, /^M 20 0 H 80 A 20 20/);
  assert.equal(g.transform, 'translate(5 6) rotate(10 50 100)');
  assert.equal(canMask({ kind: 'shape', shape: 'line', x1: 0 }), false);
});

test('applyMask: the bottom shape clips the others; release removes it', () => {
  const json = { annotations: [phone, head, blob] };
  const j = applyMask(json, ['p', 'h', 'b']);
  assert.equal(j.annotations[1].clipTo, 'p');
  assert.equal(j.annotations[2].clipTo, 'p');
  assert.equal(j.annotations[0].clipTo, undefined);
  const byId = new Map(j.annotations.map(a => [a.id, a]));
  assert.ok(clipFor(byId.get('h'), byId).d.startsWith('M 20 0'));
  const r = releaseMask(j, ['h']);
  assert.equal(r.annotations[1].clipTo, undefined);
  assert.equal(r.annotations[2].clipTo, 'p');
  assert.equal(applyMask({ annotations: [{ id: 'l', kind: 'shape', shape: 'line' }, head] }, ['l', 'h']), null);
});

test('a fixed clip (from SVG) is used when there is no clipTo', () => {
  const a = { id: 'x', kind: 'path', d: 'M0 0', clip: { d: 'M 0 0 H 10 V 10 Z' } };
  assert.deepEqual(clipFor(a, new Map()), { d: 'M 0 0 H 10 V 10 Z', transform: '' });
});
