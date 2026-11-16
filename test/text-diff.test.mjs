// El cambio mínimo entre dos textos debe tocar solo el tramo que difiere y dar siempre el texto pedido.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { diffRange, applyTextDiff } from '../shared/text-diff.mjs';

const apply = (a, b) => { const { index, del, ins } = diffRange(a, b); return a.slice(0, index) + ins + a.slice(index + del); };

test('diffRange reconstruye el destino en casos típicos', () => {
  const cases = [['', 'hola'], ['hola', ''], ['hola', 'hola'], ['hola mundo', 'hola, mundo'], ['abc', 'xabcx'], ['aaaa', 'aa'], ['aa', 'aaaa'],
    ['uno\ndos\ntres', 'uno\nDOS\ntres'], ['a😀b', 'a😁b'], ['a😀b', 'a😀😀b'], ['😀', '😁']];
  for (const [a, b] of cases) assert.equal(apply(a, b), b, JSON.stringify([a, b]));
});

test('diffRange no parte un emoji por la mitad', () => {
  const { index, del, ins } = diffRange('a😀b', 'a😁b');
  assert.equal(index, 1); assert.equal(del, 2); assert.equal(ins, '😁');
});

test('applyTextDiff deja el texto pedido y solo toca el tramo que cambia', () => {
  const doc = new Y.Doc(); const t = doc.getText('c');
  t.insert(0, 'Título\n\nPrimer párrafo.\n\nSegundo párrafo.\n');
  const ops = [];
  t.observe((e) => { for (const d of e.delta) ops.push(d); });
  const changed = applyTextDiff(t, 'Título\n\nPrimer párrafo corregido.\n\nSegundo párrafo.\n');
  assert.equal(changed, true);
  assert.equal(t.toString(), 'Título\n\nPrimer párrafo corregido.\n\nSegundo párrafo.\n');
  // retain + insert, sin borrar nada: lo que había alrededor ni se toca
  assert.deepEqual(ops.map(o => Object.keys(o)[0]), ['retain', 'insert']);
  assert.equal(applyTextDiff(t, t.toString()), false);
});

test('el cursor de otro cliente se mantiene fuera del tramo editado', () => {
  const a = new Y.Doc(); const ta = a.getText('c'); ta.insert(0, 'inicio\nmedio\nfinal');
  const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const tb = b.getText('c');
  const pos = Y.createRelativePositionFromTypeIndex(tb, tb.toString().indexOf('final'));   // cursor de B antes de «final»
  applyTextDiff(ta, 'inicio\nMEDIO!\nfinal');
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const abs = Y.createAbsolutePositionFromRelativePosition(pos, b);
  assert.equal(tb.toString().slice(abs.index), 'final');
});
