import { test } from 'node:test';
import assert from 'node:assert/strict';
import { booleanOp, toMultiPolygon, canBoolean } from '../shared/canvas-boolean.js';

const sq = (id, x, y, s = 100, extra = {}) => ({ id, kind: 'shape', shape: 'rect', x, y, w: s, h: s, rx: 0, fill: '#f00', color: '#000', strokeWidth: 2, bbox: { x, y, w: s, h: s }, ...extra });
const area = (mp) => mp.reduce((s, poly) => s + poly.reduce((t, ring, k) => {
  let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return t + (k === 0 ? 1 : -1) * Math.abs(a / 2);
}, 0), 0);
const areaOf = (res) => area(toMultiPolygon(res));

test('union, subtract, intersect and exclude of two overlapping squares', () => {
  const a = sq('a', 0, 0), b = sq('b', 50, 50);
  assert.ok(Math.abs(areaOf(booleanOp('union', [a, b])) - 17500) < 1);
  assert.ok(Math.abs(areaOf(booleanOp('subtract', [a, b])) - 7500) < 1);
  assert.ok(Math.abs(areaOf(booleanOp('intersect', [a, b])) - 2500) < 1);
  assert.ok(Math.abs(areaOf(booleanOp('exclude', [a, b])) - 15000) < 1);
});

test('result keeps the style of the bottom item and is an editable path', () => {
  const r = booleanOp('union', [sq('a', 0, 0, 100, { gradient: { type: 'linear', stops: [{ color: '#000' }, { color: '#fff' }] } }), sq('b', 50, 0, 100, { fill: '#0f0' })]);
  assert.equal(r.kind, 'path');
  assert.equal(r.fill, '#f00');
  assert.ok(r.gradient);
  assert.deepEqual(r.bbox, { x: 0, y: 0, w: 150, h: 100 });
});

test('circles are sampled; offsets (ox/oy) are applied; lines are not booleanable', () => {
  const c = { id: 'c', kind: 'shape', shape: 'ellipse', x: 0, y: 0, w: 100, h: 100, bbox: {}, ox: 10 };
  const mp = toMultiPolygon(c);
  const xs = mp[0][0].map(p => p[0]);
  assert.ok(Math.abs(Math.min(...xs) - 10) < 0.5 && Math.abs(Math.max(...xs) - 110) < 0.5);
  assert.ok(Math.abs(area(mp) - Math.PI * 2500) < 30);
  assert.equal(canBoolean({ kind: 'shape', shape: 'line', x1: 0 }), false);
  assert.equal(booleanOp('intersect', [sq('a', 0, 0), sq('b', 500, 500)]), null);
});
