// Modelo de «Todas las notas»: orden, grupos por fecha, líneas virtuales, vista previa. `node --test ui/allnotes/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from './model.js';

const NOW = new Date(2026, 10, 14, 15, 0).getTime(), DAY = 86400000;
const labels = { today: 'Hoy', yesterday: 'Ayer', week: '7d', month: '30d', none: 'Sin fecha', locale: 'es-ES', noFolder: 'Sin carpeta', type: { note: 'Nota', canvas: 'Canvas', database: 'Tabla' }, folderLabel: (id) => 'F' + id };
const files = [
  { id: 'a', name: 'Beta.md', vaultId: 'v', updatedAt: NOW - 3600000 },
  { id: 'b', name: 'alfa.md', vaultId: 'v', updatedAt: NOW - DAY - 1000, folderId: 'x', pinned: true },
  { id: 'c', name: 'Gamma 2.md', vaultId: 'v', updatedAt: NOW - 20 * DAY },
  { id: 'd', name: 'Gamma 10.md', vaultId: 'v' },
  { id: 'e', name: 'Otra.md', vaultId: 'other', updatedAt: NOW },
  { id: 'f', name: 'Vieja.md', vaultId: 'v', updatedAt: NOW - 100 * DAY, kind: 'database' },
];
const build = () => M.buildItems({ files, vaultId: 'v', canvasIds: new Set(['c']), dbIds: new Set(), tagsById: new Map([['a', ['x']]]), editStamps: { d: NOW - 5000 }, aiAt: new Map(), fileStats: { a: { t: 77 } } });
const ids = (arr) => arr.map(i => i.id).join('');

test('buildItems: solo el vault, tipos y fecha de edición local', () => {
  const items = build();
  assert.equal(items.length, 5);
  const by = (id) => items.find(i => i.id === id);
  assert.equal(by('c').type, 'canvas'); assert.equal(by('f').type, 'database'); assert.equal(by('a').type, 'note');
  assert.equal(by('d').updatedAt, NOW - 5000);
});

test('sortItems: modificación, ascendente y título natural', () => {
  const items = build();
  assert.equal(ids(M.sortItems(items, 'modified', 'desc')), 'dabcf');
  assert.equal(ids(M.sortItems(items, 'modified', 'asc')), 'fcbad');
  assert.equal(M.sortItems(items, 'title', 'asc').map(i => i.name).join('|'), 'alfa|Beta|Gamma 2|Gamma 10|Vieja');
});

test('groupItems: por fecha, sin fecha al final, por carpeta', () => {
  const items = build(); const s = M.sortItems(items, 'modified', 'desc');
  const g = M.groupItems(s, 'date', 'modified', labels, NOW);
  assert.deepEqual(g.slice(0, 3).map(x => x.label), ['Hoy', 'Ayer', '30d']);
  assert.equal(ids(g[0].items), 'da');
  const g2 = M.groupItems(M.sortItems(items, 'created', 'desc'), 'date', 'created', labels, NOW);
  assert.equal(g2[g2.length - 1].label, 'Sin fecha');
  const g3 = M.groupItems(s, 'folder', 'modified', labels, NOW);
  assert.ok(g3.some(x => x.label === 'Sin carpeta'));
});

test('toLines: alturas, rejilla por filas y firstVisible', () => {
  const s = M.sortItems(build(), 'modified', 'desc'); const g = M.groupItems(s, 'date', 'modified', labels, NOW);
  const L = M.toLines(g, 'list');
  assert.equal(L.count, 5); assert.equal(L.lines.length, 5 + g.length);
  assert.equal(L.total, 5 * M.LIST_ROW + g.length * M.LIST_HEAD);
  const G = M.toLines(M.groupItems(s, 'none', 'modified', labels), 'grid', 3);
  assert.equal(G.lines.length, 2); assert.equal(G.lines[0].items.length, 3); assert.equal(G.lines[1].items.length, 2);
  assert.equal(M.firstVisible(L.lines, 0), 0);
  assert.equal(M.firstVisible(L.lines, L.lines[3].top), 3);
  assert.equal(M.firstVisible(L.lines, L.lines[3].top - 1), 2);
  assert.equal(M.firstVisible(L.lines, 1e9), L.lines.length - 1);
});

test('previewOf: quita título, markdown, enlaces y etiquetas', () => {
  assert.equal(M.previewOf('# Título\n\nHola **mundo** con [enlace](x) y [[nota|alias]].\n\n- [ ] tarea\n\n#a #b\n'), 'Hola mundo con enlace y alias. tarea');
  assert.ok(M.previewOf('x '.repeat(500)).length <= 160);
  assert.equal(M.previewOf('# C\n\n```edinot-canvas\n{}\n```\n'), '');
});

test('rendimiento: 20 000 notas en menos de 600 ms', () => {
  const big = Array.from({ length: 20000 }, (_, i) => ({ id: 'n' + i, name: 'Nota ' + (i * 7919 % 20000) + '.md', vaultId: 'v', updatedAt: NOW - (i * 997 % 400) * DAY }));
  const t0 = performance.now();
  const L = M.toLines(M.groupItems(M.sortItems(M.buildItems({ files: big, vaultId: 'v' }), 'modified', 'desc'), 'date', 'modified', labels, NOW), 'list');
  const dt = performance.now() - t0;
  assert.equal(L.count, 20000);
  assert.ok(dt < 600, `tardó ${dt.toFixed(0)} ms`);
});
