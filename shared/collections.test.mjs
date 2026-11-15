// Colecciones (filtros guardados): reglas, normalización y coincidencia. `node --test shared/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './collections.js';

const NOW = Date.UTC(2026, 10, 14, 12);
const DAY = 86400000;
const parentOf = new Map([['a', null], ['a1', 'a'], ['a2', 'a1'], ['b', null]]);
const note = (o) => ({ name: 'Nota', folderId: null, type: 'note', tags: [], pinned: false, updatedAt: NOW, ...o });

test('normalizeRules limpia y descarta lo inválido', () => {
  const r = C.normalizeRules({ tags: ['#Foo', 'foo ', '', 3], tagMode: 'raro', types: ['note', 'x'], updated: '7', text: '  hola ', folders: ['a', 'a'] });
  assert.deepEqual(r.tags, ['Foo', 'foo', '3']);
  assert.equal(r.tagMode, 'any');
  assert.deepEqual(r.types, ['note']);
  assert.equal(r.updated, 7);
  assert.equal(r.text, 'hola');
  assert.deepEqual(r.folders, ['a']);
  assert.deepEqual(C.normalizeRules(null), C.emptyRules());
  assert.equal(C.normalizeRules({ updated: -3 }).updated, null);
});

test('rulesAreEmpty / ruleCount', () => {
  assert.ok(C.rulesAreEmpty({}));
  assert.ok(!C.rulesAreEmpty({ pinned: true }));
  assert.equal(C.ruleCount({ tags: ['a', 'b'], folders: ['x'], pinned: true }), 3);
  assert.equal(C.ruleCount({ noFolder: true }), 1);
});

test('sameRules ignora el orden y las mayúsculas', () => {
  assert.ok(C.sameRules({ tags: ['A', 'b'] }, { tags: ['b', 'a'] }));
  assert.ok(!C.sameRules({ tags: ['a'] }, { tags: ['a'], tagMode: 'all' }));
});

test('normalizeCollection exige id y rellena el resto', () => {
  assert.equal(C.normalizeCollection({ name: 'x' }), null);
  const c = C.normalizeCollection({ id: 'c1', name: '  ', rules: { tags: ['a'] }, createdAt: 5 });
  assert.equal(c.name, '—'); assert.equal(c.updatedAt, 5); assert.deepEqual(c.rules.tags, ['a']);
});

test('folderScope incluye las subcarpetas', () => {
  assert.deepEqual([...C.folderScope(['a'], parentOf)].sort(), ['a', 'a1', 'a2']);
  assert.equal(C.folderScope([], parentOf).size, 0);
  // un ciclo en los datos no cuelga
  const loop = new Map([['x', 'y'], ['y', 'x']]);
  assert.deepEqual([...C.folderScope(['z'], loop)], ['z']);
});

test('compileRules: etiquetas cualquiera / todas', () => {
  const any = C.compileRules({ tags: ['a', 'b'] }, { parentOf });
  const all = C.compileRules({ tags: ['a', 'b'], tagMode: 'all' }, { parentOf });
  assert.ok(any(note({ tags: ['b'] })) && !any(note({ tags: ['c'] })));
  assert.ok(all(note({ tags: ['a', 'b', 'c'] })) && !all(note({ tags: ['a'] })));
});

test('compileRules: carpeta con subcarpetas y «sin carpeta»', () => {
  const inA = C.compileRules({ folders: ['a'] }, { parentOf });
  assert.ok(inA(note({ folderId: 'a2' })) && !inA(note({ folderId: 'b' })) && !inA(note({ folderId: null })));
  const aOrRoot = C.compileRules({ folders: ['a'], noFolder: true }, { parentOf });
  assert.ok(aOrRoot(note({ folderId: null })) && aOrRoot(note({ folderId: 'a1' })) && !aOrRoot(note({ folderId: 'b' })));
  const rootOnly = C.compileRules({ noFolder: true }, { parentOf });
  assert.ok(rootOnly(note({})) && !rootOnly(note({ folderId: 'b' })));
});

test('compileRules: tipo, favoritas, fecha y texto (sin acentos)', () => {
  const f = C.compileRules({ types: ['canvas'], pinned: true, updated: 7, text: 'reunion' }, { parentOf, now: NOW });
  const ok = note({ type: 'canvas', pinned: true, updatedAt: NOW - 2 * DAY, name: 'Reunión semanal' });
  assert.ok(f(ok));
  assert.ok(!f({ ...ok, type: 'note' }));
  assert.ok(!f({ ...ok, pinned: false }));
  assert.ok(!f({ ...ok, updatedAt: NOW - 8 * DAY }));
  assert.ok(!f({ ...ok, updatedAt: 0 }));
  assert.ok(!f({ ...ok, name: 'Otra' }));
});

test('reglas vacías: todo coincide', () => {
  assert.ok(C.matchesRules(note({}), {}, { parentOf }));
});

test('createdFromId lee la marca de creación del id', () => {
  const id = 'f' + NOW.toString(36) + 'abc';
  assert.equal(C.createdFromId(id), NOW);
  assert.equal(C.createdFromId('fld_s0'), 0);
  assert.equal(C.createdFromId(''), 0);
});
