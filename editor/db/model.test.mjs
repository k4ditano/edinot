// Modelo de las bases de datos: filtros con operador, reglas, opciones y pestañas. `node --test editor/db/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from './model.js';

test('filtros: codificación y operadores compatibles con las notas viejas', () => {
  assert.deepEqual(M.parseFilterValue('hola'), { op: 'contains', val: 'hola' });
  assert.deepEqual(M.parseFilterValue('~not~Hecho'), { op: 'not', val: 'Hecho' });
  assert.deepEqual(M.parseFilterValue('~empty~'), { op: 'empty', val: '' });
  assert.equal(M.encodeFilterValue('contains', 'x'), 'x');
  assert.equal(M.encodeFilterValue('is', 'x'), '~is~x');
  assert.equal(M.encodeFilterValue('empty', 'ignorado'), '~empty~');
});

test('matchFilter: es, no es, vacío, mayor, menor, antes, después', () => {
  assert.ok(M.matchFilter('Hecha', '~is~hecha', 'status'));
  assert.ok(M.matchFilter('A, B', '~is~b', 'tags'));
  assert.ok(M.matchFilter('Hecha', '~not~Bloqueada', 'status'));
  assert.ok(M.matchFilter('', '~empty~', 'person'));
  assert.ok(M.matchFilter('x', '~notempty~', 'text'));
  assert.ok(M.matchFilter('90', '~gt~66', 'progress') && !M.matchFilter('10', '~gt~66', 'progress'));
  assert.ok(M.matchFilter('3', '~lt~4', 'rating'));
  assert.ok(M.matchFilter('2023-09-04', '~before~2023-11-01', 'date'));
  assert.ok(M.matchFilter('2023-12-02', '~after~2023-11-01', 'date'));
  assert.ok(!M.matchFilter('', '~after~2023-11-01', 'date'));
  assert.ok(M.matchFilter('abc', 'B', 'text'));
});

test('computeRows: varias reglas se combinan con Y y respetan el orden', () => {
  const meta = {
    headers: ['T', 'E', 'P'], rows: [['a', 'Hecha', '1'], ['b', 'En curso', '5'], ['c', 'En curso', '3'], ['d', '', '4']],
    directive: { cols: { E: { type: 'status' }, P: { type: 'rating' } }, filter: { E: '~not~Hecha', P: '~gt~2' }, sort: { col: 'P', dir: 'desc' } },
  };
  assert.deepEqual(M.computeRows(meta).map(x => x.row[0]), ['b', 'd', 'c']);
});

test('filterRules / rulesToFilter son inversas y omiten reglas incompletas', () => {
  const f = { Owner: '~empty~', Estado: '~not~Hecha', Texto: 'abc' };
  const rules = M.filterRules(f);
  assert.deepEqual(rules.map(r => [r.col, r.op, r.val]), [['Owner', 'empty', ''], ['Estado', 'not', 'Hecha'], ['Texto', 'contains', 'abc']]);
  assert.deepEqual(M.rulesToFilter(rules), f);
  assert.equal(M.rulesToFilter([{ col: 'A', op: 'is', val: '  ' }]), null);
  assert.deepEqual(M.rulesToFilter([{ col: 'A', op: 'checked', val: '' }]), { A: '~checked~' });
  assert.deepEqual(M.filterRules(null), []);
  assert.ok(M.ruleComplete({ col: 'A', op: 'empty' }) && !M.ruleComplete({ col: 'A', op: 'is', val: '' }));
});

test('nextRuleColumn prefiere una columna libre que no sea el título', () => {
  assert.equal(M.nextRuleColumn(['Tarea', 'Estado', 'Fecha'], [{ col: 'Estado' }], 'Tarea'), 'Fecha');
  assert.equal(M.nextRuleColumn(['Tarea', 'Estado'], [{ col: 'Estado' }], 'Tarea'), 'Tarea');
  assert.equal(M.nextRuleColumn(['Tarea'], [{ col: 'tarea' }], 'Tarea'), null);
});

test('renombrar y borrar opciones en los valores', () => {
  assert.equal(M.renameOptionInValue('Hecha', false, 'hecha', 'Cerrada'), 'Cerrada');
  assert.equal(M.renameOptionInValue('Otra', false, 'hecha', 'Cerrada'), 'Otra');
  assert.equal(M.renameOptionInValue('a, Hecha, b', true, 'hecha', 'x'), 'a, x, b');
  assert.equal(M.renameOptionInValue('a, b', true, 'b', 'a'), 'a');
  assert.equal(M.removeOptionFromValue('Hecha', false, 'HECHA'), '');
  assert.equal(M.removeOptionFromValue('a, Hecha', true, 'hecha'), 'a');
  assert.equal(M.removeOptionFromValue('a', true, 'z'), 'a');
});

test('fitTabs: todas caben, «+N más» y la activa siempre visible', () => {
  const w = [100, 100, 100, 100];
  assert.deepEqual(M.fitTabs(w, 1000), { visible: [0, 1, 2, 3], hidden: [] });
  const r = M.fitTabs(w, 330, { gap: 6, moreW: 80, activeIdx: 0 });
  assert.deepEqual(r.visible, [0, 1]); assert.deepEqual(r.hidden, [2, 3]);
  const r2 = M.fitTabs(w, 330, { gap: 6, moreW: 80, activeIdx: 3 });
  assert.ok(r2.visible.includes(3)); assert.equal(r2.visible.length + r2.hidden.length, 4);
  assert.ok(M.fitTabs([200], 50).visible.length === 1);
});

test('vistas guardadas: añadir, cambiar y borrar conserva el estado', () => {
  const d = { view: 'table', cols: {}, filter: { A: '~empty~' } };
  const p = M.addViewPatch(d, 'kanban', 'Kanban', (t) => t);
  assert.equal(p.views.list.length, 5); assert.equal(p.view, 'kanban');
  const back = M.switchTabPatch({ ...d, ...p, view: 'kanban', views: p.views }, { saved: true, index: 0 });
  assert.equal(back.view, 'table');
});

// ── Renombrar / borrar una opción en todas las vistas guardadas (1.2.1) ──
const dirWithViews = () => ({
  view: 'table', by: 'Estado', order: ['Por hacer', 'En curso', 'Hecha'],
  filter: { Estado: '~not~Hecha', Prioridad: '~gt~2' },
  optColors: { Estado: { Hecha: 'purple', 'En curso': 'green' }, Otra: { Hecha: 'red' } },
  views: {
    act: 0,
    list: [
      { n: 'Tabla', v: 'table', filt: { Estado: '~not~Hecha', Prioridad: '~gt~2' } },
      { n: 'Hechas', v: 'table', filt: { Estado: '~is~hecha' }, sort: { col: 'Estado', dir: 'asc' } },
      { n: 'Kanban', v: 'kanban', by: 'Estado', filt: { Estado: '~is~Hecha', Texto: 'hecha' } },
      { n: 'Sin filtro', v: 'cards' },
    ],
  },
});

test('renombrar una opción actualiza filtro activo, vistas inactivas, orden de carriles y color', () => {
  const p = M.optionChangePatch(dirWithViews(), 'Estado', 'Hecha', 'Cerrada');
  assert.deepEqual(p.filter, { Estado: '~not~Cerrada', Prioridad: '~gt~2' });
  assert.deepEqual(p.order, ['Por hacer', 'En curso', 'Cerrada']);
  assert.equal(p.views.act, 0);
  assert.deepEqual(p.views.list[0].filt, { Estado: '~not~Cerrada', Prioridad: '~gt~2' });
  assert.deepEqual(p.views.list[1].filt, { Estado: '~is~Cerrada' });        // coincide sin distinguir mayúsculas
  assert.deepEqual(p.views.list[1].sort, { col: 'Estado', dir: 'asc' });    // el orden por columna no cambia
  assert.deepEqual(p.views.list[2].filt, { Estado: '~is~Cerrada', Texto: 'hecha' }); // «contiene» de otra columna: intacto
  assert.equal(p.views.list[3].filt, undefined);
  assert.deepEqual(p.optColors.Estado, { 'En curso': 'green', Cerrada: 'purple' });
  assert.deepEqual(p.optColors.Otra, { Hecha: 'red' });                      // otra columna: intacta
});

test('borrar una opción quita las reglas que la usaban (no quedan filtros rotos)', () => {
  const p = M.optionChangePatch(dirWithViews(), 'Estado', 'Hecha', null);
  assert.deepEqual(p.filter, { Prioridad: '~gt~2' });
  assert.deepEqual(p.order, ['Por hacer', 'En curso']);
  assert.deepEqual(p.views.list[0].filt, { Prioridad: '~gt~2' });
  assert.equal(p.views.list[1].filt, undefined);                             // la vista se queda sin filtro
  assert.equal(p.views.list[1].n, 'Hechas');                                 // pero no se borra la vista
  assert.deepEqual(p.views.list[2].filt, { Texto: 'hecha' });
  assert.deepEqual(p.optColors.Estado, { 'En curso': 'green' });
  // ninguna regla de ninguna vista menciona ya la opción borrada
  const all = [p.filter, ...p.views.list.map(v => v.filt)].filter(Boolean);
  for (const f of all) for (const [k, raw] of Object.entries(f)) if (k === 'Estado') assert.notEqual(M.parseFilterValue(raw).val.toLowerCase(), 'hecha');
});

test('si nada usaba la opción el parche está vacío; otra columna no se toca', () => {
  assert.deepEqual(M.optionChangePatch(dirWithViews(), 'Estado', 'Inexistente', 'X'), {});
  assert.deepEqual(M.optionChangePatch({}, 'Estado', 'A', 'B'), {});
  const p = M.optionChangePatch(dirWithViews(), 'Prioridad', 'Hecha', 'X');
  assert.equal(p.filter, undefined); assert.equal(p.views, undefined); assert.equal(p.order, undefined);
});

test('renombrar a un nombre que ya existe no duplica carriles; el kanban solo cambia si agrupa por esa columna', () => {
  const d = { by: 'Estado', order: ['A', 'B', 'C'] };
  assert.deepEqual(M.optionChangePatch(d, 'Estado', 'C', 'A').order, ['A', 'B']);
  assert.equal(M.optionChangePatch({ by: 'Otra', order: ['A', 'B'] }, 'Estado', 'A', 'Z').order, undefined);
});

test('el parche sirve para borrar y renombrar en cadena (filtros vacíos → null)', () => {
  const d = { filter: { Estado: '~is~Hecha' }, views: { act: 0, list: [{ n: 'T', v: 'table', filt: { Estado: '~is~Hecha' } }] } };
  const p = M.optionChangePatch(d, 'Estado', 'Hecha', null);
  assert.equal(p.filter, null);
  assert.equal(p.views.list[0].filt, undefined);
});

// ── «Ampliar» se guarda en la tabla (`:wide=1`) ──
test('cláusula wide: solo se escribe cuando está activa y se lee como booleano', () => {
  assert.equal(M.serializeWideClause(true), '1');
  assert.equal(M.serializeWideClause(false), '');
  assert.equal(M.serializeWideClause(null), '');
  assert.equal(M.parseWideClause('1'), true);
  for (const v of [undefined, null, '', '0', 'true', 'x']) assert.equal(M.parseWideClause(v), false);
});

test('la directiva con wide cumple la expresión de editor.jsx y no cambia las demás cláusulas', () => {
  const RE = /^[ \t]*<!--\s*edinot:view=([a-z]+)((?::[a-zA-Z]+=[^\s>:]+)*)\s*-->[ \t]*$/;
  assert.ok(RE.test('<!-- edinot:view=table:wide=1 -->'));
  assert.ok(RE.test('<!-- edinot:view=kanban:by=Estado:widths=Tarea=300:wide=1 -->'));
});
