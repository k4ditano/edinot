import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapMove, annoBoxes } from '../editor/canvas/guides.js';

test('snaps edges/centres and measures the gap to neighbours', () => {
  const others = [{ x: 0, y: 0, w: 100, h: 50 }];
  const r = snapMove({ x: 150, y: 3, w: 80, h: 50 }, others, 6);
  assert.equal(r.dy, -3);            // top aligned with the neighbour
  assert.deepEqual(r.h, [0]);
  const g = r.gaps.find(x => x.y1 === x.y2);
  assert.equal(g.label, 50);         // 150 - 100
});

test('equal spacing between two neighbours', () => {
  const others = [{ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 0, w: 100, h: 40 }];
  const r = snapMove({ x: 152, y: 0, w: 100, h: 40 }, others, 6);
  assert.equal(r.dx, -2);            // centred: 150
  const eq = r.gaps.filter(g => g.eq);
  assert.deepEqual(eq.map(g => g.label), [50, 50]);
});

test('annoBoxes uses offset and skips hidden / moving ones', () => {
  const b = annoBoxes([{ id: 'a', bbox: { x: 0, y: 0, w: 5, h: 5 }, ox: 10 }, { id: 'b', bbox: { x: 0, y: 0, w: 1, h: 1 }, hidden: true }, { id: 'c', bbox: { x: 0, y: 0, w: 1, h: 1 } }], new Set(['c']));
  assert.deepEqual(b, [{ x: 10, y: 0, w: 5, h: 5 }]);
});

test('measureBetween: gap to a neighbour and distances inside a frame', async () => {
  const { measureBetween } = await import('../editor/canvas/guides.js');
  const m = measureBetween({ x: 0, y: 0, w: 100, h: 50 }, { x: 140, y: 10, w: 50, h: 50 });
  assert.deepEqual(m.map(g => g.label), [40]);
  const n = measureBetween({ x: 20, y: 30, w: 60, h: 40 }, { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(n.map(g => g.label), [20, 20, 30, 30]);
});
