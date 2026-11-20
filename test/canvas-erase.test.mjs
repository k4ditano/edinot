import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraseStroke, eraseAnnotations, densify } from '../editor/canvas/erase.js';

const line = (id, x0, x1, y = 0, extra = {}) => ({ id, kind: 'path', variant: 'pen', size: 4, pts: [[x0, y, 0.5], [x1, y, 0.5]], bbox: { x: x0, y, w: x1 - x0, h: 0 }, ...extra });
let n = 0;
const newId = () => 'new' + (++n);

test('densify fills long segments', () => {
  const d = densify([[0, 0, 0.5], [10, 0, 0.5]], 2);
  assert.ok(d.length >= 5);
  assert.deepEqual(d[0], [0, 0, 0.5]);
  assert.deepEqual(d[d.length - 1], [10, 0, 0.5]);
});

test('erasing through the middle splits a stroke in two', () => {
  const res = eraseStroke(line('a', 0, 100), [[50, -20], [50, 20]], 5, newId);
  assert.equal(res.length, 2);
  assert.equal(res[0].id, 'a');
  assert.ok(res[0].bbox.x + res[0].bbox.w < 50 && res[1].bbox.x > 50);
  assert.ok(res.every(p => p.pts.length >= 2));
});

test('not touching returns null, erasing everything returns []', () => {
  assert.equal(eraseStroke(line('a', 0, 100), [[50, 80]], 5, newId), null);
  assert.deepEqual(eraseStroke(line('a', 0, 10), [[0, 0], [10, 0]], 8, newId), []);
});

test('moved strokes (ox/oy) are erased where they are seen', () => {
  const a = line('a', 0, 100, 0, { ox: 0, oy: 200 });
  assert.equal(eraseStroke(a, [[50, -20], [50, 20]], 5, newId), null);
  assert.equal(eraseStroke(a, [[50, 180], [50, 220]], 5, newId).length, 2);
});

test('eraseAnnotations removes touched shapes whole and keeps the rest', () => {
  const shape = { id: 's', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10 };
  const other = { id: 'o', kind: 'shape', shape: 'rect', x: 500, y: 500, w: 10, h: 10 };
  const r = eraseAnnotations([line('a', 0, 100), shape, other], [[50, -20], [50, 20]], 5, { newId, hitWhole: (x) => x.id === 's' });
  assert.deepEqual(r.annotations.map(x => x.id).filter(id => !id.startsWith('new')), ['a', 'o']);
  assert.ok(r.removedIds.has('s'));
  assert.equal(eraseAnnotations([other], [[0, 0]], 5, { newId }), null);
});
