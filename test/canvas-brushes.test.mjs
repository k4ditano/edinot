import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRUSHES, brushOutlineD, brushFilterSvg, brushSpec } from '../editor/canvas/brushes.js';

const pts = Array.from({ length: 30 }, (_, i) => [i * 5, Math.sin(i / 4) * 20, 0.3 + (i % 10) / 15]);

test('every brush gives a closed vector outline', () => {
  for (const b of BRUSHES) {
    const d = brushOutlineD(pts, 4, b);
    assert.ok(d.length > 20, b);
    assert.match(d, /^M /, b);
    assert.match(d, /[Zz]$/, b);
  }
});

test('marker ignores pressure (constant width), fountain varies with direction, spray is stable', () => {
  const flat = pts.map(p => [p[0], 0, p[2]]);
  const w = (d) => { const ys = [...d.matchAll(/(-?\d+\.\d) (-?\d+\.\d)/g)].map(m => Number(m[2])); return Math.max(...ys) - Math.min(...ys); };
  assert.ok(w(brushOutlineD(flat, 4, 'marker')) - 2 * brushSpec('marker').k * 4 / 2 < 1);
  const horiz = brushOutlineD([[0, 0, 0.5], [50, 0, 0.5]], 10, 'fountain'), diag = brushOutlineD([[0, 0, 0.5], [35, -35, 0.5]], 10, 'fountain');
  assert.notEqual(horiz, diag);
  assert.equal(brushOutlineD(pts, 4, 'spray'), brushOutlineD(pts, 4, 'spray'));
});

test('textured brushes carry an SVG filter; strokeD regenerates with the brush', () => {
  assert.match(brushFilterSvg('pencil', 'f1'), /feTurbulence/);
  assert.match(brushFilterSvg('neon', 'f2', '#0ff'), /flood-color="#0ff"/);
  assert.equal(brushFilterSvg('pen', 'f3'), '');
});
