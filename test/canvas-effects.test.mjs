import { test } from 'node:test';
import assert from 'node:assert/strict';

test('several shadows with spread, inner ones on top; several fills and strokes', async () => {
  const { annoFilterSvg, paintStack, shadowList } = await import('../shared/canvas-effects.js');
  const a = { id: 'a', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', strokeWidth: 2, fill: '#fff',
    shadows: [{ dx: 0, dy: 2, blur: 4, spread: 3, color: '#000', opacity: 0.2 }, { dx: 0, dy: 10, blur: 20, color: '#000', opacity: 0.1 }, { inner: true, dy: 1, blur: 2 }] };
  assert.equal(shadowList(a).length, 3);
  const f = annoFilterSvg(a, undefined, 'x');
  assert.match(f, /feMorphology in="SourceAlpha" operator="dilate" radius="3"/);
  assert.match(f, /<feMerge><feMergeNode in="d1"\/><feMergeNode in="d0"\/><feMergeNode in="SourceGraphic"\/><feMergeNode in="i2"\/><\/feMerge>/);
  const p = paintStack({ ...a, fills: [{ color: '#ff0000', opacity: 0.5, blend: 'multiply' }], strokes: [{ color: '#00f', width: 4 }] });
  assert.equal(p.base.color, 'none');
  assert.deepEqual(p.layers.map(l => [l.fill, l.color, l.blend || null]), [['#ff0000', 'none', 'multiply'], ['none', '#000', null], ['none', '#00f', null]]);
  assert.equal(paintStack({ id: 'b' }), null);
});

test('image fill crop (scale + offset) and adjustments', async () => {
  const { imageGeom, imageAdjustSvg } = await import('../shared/canvas-effects.js');
  const a = { kind: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 50, imageFill: { src: 'x.png', scale: 2, ox: 10, oy: -5 } };
  const g = imageGeom(a);
  assert.deepEqual([g.x, g.y, g.w, g.h], [-40, -30, 200, 100]);
  assert.equal(imageAdjustSvg({}, 'f'), '');
  const f = imageAdjustSvg({ exposure: 1, contrast: 0.5, saturation: -1 }, 'f');
  assert.match(f, /type="saturate" values="0"/);
  assert.match(f, /slope="3" intercept="-0.25"/);
});
