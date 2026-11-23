import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateQuery, suggestDateQueries, isoDay, dateNeedles } from '../ui/palette/dateQuery.js';

// Lunes 23 de noviembre de 2026, a media tarde.
const now = new Date(2026, 10, 23, 17, 30);
const q = (s, o = {}) => parseDateQuery(s, { now, ...o });
const one = (s, o) => { const r = q(s, o); assert.ok(r, s); assert.equal(r.single, true, s); return isoDay(r.from); };

test('días relativos', () => {
  assert.equal(one('@hoy'), '2026-11-23');
  assert.equal(one('@today'), '2026-11-23');
  assert.equal(one('@ayer'), '2026-11-22');
  assert.equal(one('@anteayer'), '2026-11-21');
  assert.equal(one('@mañana'), '2026-11-24');
  assert.equal(one('@Mañana'), '2026-11-24');
  assert.equal(one('@pasado mañana'), '2026-11-25');
  const r = q('@hoy');
  assert.equal(r.to - r.from, 86400000);
});

test('días de la semana (semana desde el lunes)', () => {
  assert.equal(one('@lunes'), '2026-11-23');
  assert.equal(one('@viernes'), '2026-11-27');
  assert.equal(one('@el miércoles'), '2026-11-25');
  assert.equal(one('@domingo'), '2026-11-29');
  assert.equal(one('@lunes pasado'), '2026-11-16');
  assert.equal(one('@próximo lunes'), '2026-11-30');
  assert.equal(one('@viernes que viene'), '2026-12-04');
  assert.equal(one('@last friday'), '2026-11-20');
  // Semana que empieza en domingo: «domingo» es el 22.
  assert.equal(one('@domingo', { weekStart: 0 }), '2026-11-22');
});

test('fechas escritas', () => {
  assert.equal(one('@2026-11-20'), '2026-11-20');
  assert.equal(one('@20/11'), '2026-11-20');
  assert.equal(one('@5/1/27'), '2027-01-05');
  assert.equal(one('@20-11-2025'), '2025-11-20');
  assert.equal(one('@11/20', { lang: 'en' }), '2026-11-20');
  assert.equal(one('@20 de noviembre'), '2026-11-20');
  assert.equal(one('@3 dic 2025'), '2025-12-03');
  assert.equal(one('@nov 20'), '2026-11-20');
  assert.equal(q('@31/02'), null);
  assert.equal(q('@2026-13-01'), null);
});

test('rangos', () => {
  const w = q('@esta semana');
  assert.equal(isoDay(w.from), '2026-11-23');
  assert.equal(isoDay(w.to), '2026-11-30');
  assert.equal(w.single, false);
  assert.equal(isoDay(q('@semana pasada').from), '2026-11-16');
  const m = q('@mes');
  assert.equal(isoDay(m.from), '2026-11-01');
  assert.equal(isoDay(m.to), '2026-12-01');
  assert.equal(isoDay(q('@mes pasado').from), '2026-10-01');
  const o = q('@octubre 2025');
  assert.equal(isoDay(o.from), '2025-10-01');
  assert.equal(isoDay(o.to), '2025-11-01');
});

test('texto detrás de la fecha = filtro', () => {
  assert.deepEqual([one('@ayer reunión'), q('@ayer reunión').rest], ['2026-11-22', 'reunión']);
  assert.equal(q('@20 de noviembre acta cliente').rest, 'acta cliente');
  assert.equal(q('@pasado mañana').rest, '');
});

test('lo que no es fecha', () => {
  assert.equal(q('hoy'), null);
  assert.equal(q('@'), null);
  assert.equal(q('@reunión'), null);
  assert.equal(q('@ho'), null);
});

test('sugerencias mientras se escribe', () => {
  assert.ok(suggestDateQueries('@').includes('hoy'));
  assert.deepEqual(suggestDateQueries('@ho'), ['hoy']);
  assert.deepEqual(suggestDateQueries('@ma'), ['mañana', 'martes']);
  assert.deepEqual(suggestDateQueries('@mie'), ['miércoles']);
  assert.deepEqual(suggestDateQueries('@hoy'), []);
  assert.deepEqual(suggestDateQueries('@hoy acta'), []);
  assert.deepEqual(suggestDateQueries('hoy'), []);
});

test('formas de escribir el día en una nota', () => {
  assert.deepEqual(dateNeedles(new Date(2026, 0, 5)), ['2026-01-05', '05/01/2026', '5/1/2026']);
});
