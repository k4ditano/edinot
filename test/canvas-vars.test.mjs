import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVars, textStyleFrom } from '../shared/canvas-vars.js';

const vars = {
  colors: [{ id: 'c1', name: 'Primario', value: '#6366f1' }, { id: 'c2', name: 'Texto', value: '#111827' }],
  texts: [{ id: 't1', name: 'Título', style: { font: 'display', fontSize: 28, weight: 700 } }],
};

test('drawings take fill and stroke from colour variables', () => {
  const a = resolveVars({ id: 'a', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, bbox: {}, fill: '#fff', fillVar: 'c1', colorVar: 'c2' }, vars);
  assert.equal(a.fill, '#6366f1');
  assert.equal(a.color, '#111827');
});

test('labels take colour and text style', () => {
  const l = resolveVars({ id: 'l', kind: 'label', text: 'Hola', colorVar: 'c2', textStyle: 't1', fontSize: 12 }, vars);
  assert.deepEqual([l.color, l.font, l.fontSize, l.weight], ['#111827', 'display', 28, 700]);
});

test('text-shape nodes use fillVar as their colour; unknown or no links return the same object', () => {
  assert.equal(resolveVars({ id: 's', kind: 'shape', shape: 'rect', text: 'x', fillVar: 'c1' }, vars).color, '#6366f1');
  const plain = { id: 'p', kind: 'label' };
  assert.equal(resolveVars(plain, vars), plain);
  assert.equal(resolveVars({ id: 'q', kind: 'label', colorVar: 'nope', color: '#abc' }, vars).color, '#abc');
});

test('textStyleFrom copies typography', () => {
  assert.deepEqual(textStyleFrom({ fontSize: 18, bold: true, font: 'serif' }), { font: 'serif', fontSize: 18, weight: 700 });
});
