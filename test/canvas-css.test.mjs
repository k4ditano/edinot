import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemCss, itemCssText, gradientCss } from '../shared/canvas-css.js';

test('a styled rect becomes CSS (gradient, border, radius, shadows, blur)', () => {
  const css = itemCss({
    kind: 'shape', shape: 'rect', x: 0, y: 0, w: 320, h: 56, corners: [16, 16, 0, 0], color: '#6366f1', strokeWidth: 2,
    gradient: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, color: '#22d3ee' }, { offset: 1, color: '#6366f1' }] },
    shadow: { dy: 6, blur: 12, color: '#000000', opacity: 0.2 }, innerShadow: { dy: 2, blur: 4 }, bgBlur: 18, opacity: 0.9,
  });
  assert.equal(css.background, 'linear-gradient(90deg, #22d3ee 0%, #6366f1 100%)');
  assert.equal(css['border-radius'], '16px 16px 0px 0px');
  assert.equal(css.border, '2px solid #6366f1');
  assert.equal(css['box-shadow'], '0px 6px 24px rgba(0, 0, 0, 0.2), inset 0px 2px 8px rgba(0, 0, 0, 0.25)');
  assert.equal(css['backdrop-filter'], 'blur(18px)');
  assert.equal(css.opacity, '0.9');
});

test('text becomes CSS typography', () => {
  const t = itemCssText({ kind: 'label', w: 200, font: 'serif', fontSize: 30, italic: true, weight: 500, letterSpacing: 2, color: '#fff', align: 'center', transform: 'upper' });
  assert.match(t, /font-family: 'Newsreader'/);
  assert.match(t, /font-size: 30px;/);
  assert.match(t, /font-weight: 500;/);
  assert.match(t, /font-style: italic;/);
  assert.match(t, /letter-spacing: 2px;/);
  assert.match(t, /text-transform: uppercase;/);
});

test('gradient angles and radial', () => {
  assert.match(gradientCss({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ color: '#000' }, { color: '#fff' }] }), /^linear-gradient\(180deg/);
  assert.match(gradientCss({ type: 'radial', stops: [{ color: '#000' }, { color: '#fff' }] }), /^radial-gradient\(circle at 50% 50%/);
});
