import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesOf, filterPage, tagNew, addPage, removePage, moveToPage, renamePage } from '../editor/canvas/pages.js';

let k = 0;
const nid = () => 'p' + (++k);

test('pages: the first page holds what had none; filter and new items', () => {
  const j0 = { nodes: [{ id: 'a' }, { id: 'b' }], annotations: [{ id: 'x' }], groups: [], edges: [{ from: 'a', to: 'b' }] };
  const { json: j1, id: p2 } = addPage(j0, 'Diseño', nid);
  assert.equal(pagesOf(j1).length, 2);
  const p1 = pagesOf(j1)[0].id;
  assert.equal(filterPage(j1, p1).nodes.length, 2);
  assert.equal(filterPage(j1, p2).nodes.length, 0);
  const next = { ...j1, nodes: [...j1.nodes, { id: 'c' }] };
  const tagged = tagNew(j1, next, p2);
  assert.equal(tagged.nodes[2].page, p2);
  assert.deepEqual(filterPage(tagged, p2).nodes.map(n => n.id), ['c']);
  assert.equal(tagNew(j1, next, p1), next);   // en la primera página no hace falta etiquetar
});

test('move items between pages (with their group), rename and remove a page', () => {
  const j0 = { nodes: [{ id: 'a', grp: 'g' }, { id: 'b' }], annotations: [{ id: 'x', grp: 'g' }], groups: [], edges: [{ from: 'a', to: 'b' }] };
  const { json: j1, id: p2 } = addPage(j0, 'Otra', nid);
  const m = moveToPage(j1, { nodes: ['a'] }, p2);
  assert.deepEqual([m.nodes[0].page, m.annotations[0].page, m.nodes[1].page], [p2, p2, undefined]);
  assert.equal(filterPage(m, p2).edges.length, 0);
  assert.equal(pagesOf(renamePage(m, p2, 'B'))[1].name, 'B');
  const r = removePage(m, p2);
  assert.deepEqual(r.nodes.map(n => n.id), ['b']);
  assert.equal(pagesOf(r).length, 1);
});
