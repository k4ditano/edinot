import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRichLine, parseRich, richPlain } from '../shared/rich-text.js';

test('inline marks become styled runs, nested too', () => {
  const r = parseRichLine('Hola **mundo *bonito*** y {#e11d48|rojo} `x*y`');
  assert.deepEqual(r.map(s => [s.t, !!s.b, !!s.i, s.color || null, !!s.code]), [
    ['Hola ', false, false, null, false],
    ['mundo ', true, false, null, false],
    ['bonito', true, true, null, false],
    [' y ', false, false, null, false],
    ['rojo', false, false, '#e11d48', false],
    [' ', false, false, null, false],
    ['x*y', false, false, null, true],
  ]);
});

test('underline, strike, size and plain text', () => {
  assert.deepEqual(parseRichLine('__a__~~b~~{+30|c}').map(s => [s.t, !!s.u, !!s.s, s.size || null]), [['a', true, false, null], ['b', false, true, null], ['c', false, false, 30]]);
  assert.equal(richPlain('**Precio:** {#16a34a|9,99 €}\n*IVA* incluido'), 'Precio: 9,99 €\nIVA incluido');
  assert.equal(parseRich('a\nb').length, 2);
  assert.deepEqual(parseRichLine('2 * 3 = 6').map(s => s.t), ['2 * 3 = 6']);
});
