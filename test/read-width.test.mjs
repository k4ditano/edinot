// Ancho de la columna de la nota (texto y tablas comparten borde). `node --test test/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMaxWidth, READ_WIDTHS } from '../ui/shared/readWidth.js';

test('tres anchos distintos y ordenados: estrecho < medio < completo', () => {
  assert.ok(READ_WIDTHS.narrow < READ_WIDTHS.medium && READ_WIDTHS.medium < READ_WIDTHS.wide);
});
test('el valor por defecto (medio) deja 992 px de contenido: lo que antes ocupaban las tablas (752 + 240)', () => {
  assert.equal(readMaxWidth(undefined) - 96, 752 + 240);
  assert.equal(readMaxWidth('medium'), readMaxWidth(undefined));
  assert.equal(readMaxWidth('anything-else'), READ_WIDTHS.medium);
});
test('estrecho se respeta: sigue siendo la columna de 680 px', () => {
  assert.equal(readMaxWidth('narrow') - 96, 680);
});
test('completo sube respecto al medio', () => {
  assert.equal(readMaxWidth('wide'), 1320);
});
