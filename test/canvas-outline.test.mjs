import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markerSvg, dashArray, outlineFromPoints } from '../editor/canvas/outline.js';

test('markers for start and end caps, coloured like the stroke', () => {
  const m = markerSvg({ color: '#e11d48', startCap: 'circle', endCap: 'triangle' }, 'a');
  assert.equal(m.start, 'url(#a-ms)');
  assert.equal(m.end, 'url(#a-me)');
  assert.match(m.defs, /<circle[^>]*fill="#e11d48"/);
  assert.match(m.defs, /orient="auto-start-reverse"/);
  assert.equal(markerSvg({}, 'b').defs, '');
});

test('custom dashes', () => {
  assert.equal(dashArray('dashed'), '8 4');
  assert.equal(dashArray('12, 4 2 4'), '12 4 2 4');
  assert.equal(dashArray('nope'), '');
});

test('outline stroke of an open line and a closed ring', () => {
  const d = outlineFromPoints([[0, 0], [100, 0]], 10, { cap: 'butt' });
  assert.equal(d, 'M 0 5 L 100 5 L 100 -5 L 0 -5 Z');
  const sq = outlineFromPoints([[0, 0], [100, 0]], 10, { cap: 'square' });
  assert.match(sq, /^M -5 5 L 105 5 L 105 -5 L -5 -5 Z$/);
  const ring = outlineFromPoints([[0, 0], [10, 0], [10, 10], [0, 10]], 2, { closed: true });
  assert.equal((ring.match(/Z/g) || []).length, 2);
});

test('outlineStroke turns a rect border into a filled ring and a curve into a shape', async () => {
  const { outlineStroke, pathPolylines } = await import('../editor/canvas/outline.js');
  const r = outlineStroke({ kind: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 50, rx: 0, color: '#111', strokeWidth: 4, ox: 5 });
  assert.equal(r.fill, '#111');
  assert.equal(r.fillRule, 'evenodd');
  assert.equal(r.ox, 5);
  assert.deepEqual(r.bbox, { x: -2, y: -2, w: 104, h: 54 });
  const pl = pathPolylines('M 0 0 C 10 0 20 10 30 10');
  assert.equal(pl.length, 1);
  assert.equal(pl[0].closed, false);
  assert.equal(outlineStroke({ kind: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'none' }), null);
});
