import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerTree, layerItems, moveLayers, renameLayer } from '../editor/canvas/layers.js';
import { mergedOrder } from '../editor/canvas/zorder.js';

const json = () => ({
  groups: [{ id: 'F', title: 'Pantalla', x: 0, y: 0, w: 400, h: 800 }, { id: 'C', title: 'Tarjeta', x: 20, y: 100, w: 300, h: 200 }],
  nodes: [
    { id: 't', kind: 'label', text: 'Hola', x: 40, y: 130, w: 100, h: 30, z: 3 },
    { id: 'b', kind: 'label', text: 'OK', x: 40, y: 500, w: 80, h: 30, z: 5, grp: 'g1' },
    { id: 'out', kind: 'label', text: 'Fuera', x: 900, y: 0, w: 80, h: 30, z: 1 },
  ],
  annotations: [
    { id: 'r', kind: 'shape', shape: 'rect', bbox: { x: 30, y: 490, w: 120, h: 50 }, z: 4, grp: 'g1' },
    { id: 'bg', kind: 'shape', shape: 'rect', bbox: { x: 30, y: 120, w: 200, h: 60 }, z: 2 },
  ],
});

test('layer tree: frames nest, groups collect their pieces, top first', () => {
  const tree = layerTree(json());
  assert.deepEqual(tree.map(n => n.kind + ':' + (n.id || n.grp)), ['frame:F', 'item:out']);
  const F = tree[0];
  assert.deepEqual(F.children.map(n => n.kind + ':' + (n.id || n.grp)), ['frame:C', 'group:g1']);
  assert.deepEqual(F.children[0].children.map(n => n.id), ['t', 'bg']);
  assert.deepEqual(layerItems(F.children[1]).map(i => i.id), ['b', 'r']);
});

test('moveLayers puts a piece above or below another; renameLayer', () => {
  const j = moveLayers(json(), [{ type: 'a', id: 'bg' }], { type: 'n', id: 'b' }, true);
  const ord = mergedOrder(j).map(i => i.id);
  assert.equal(ord[ord.length - 1], 'bg');
  const k = moveLayers(json(), [{ type: 'n', id: 't' }], { type: 'n', id: 'out' }, false);
  assert.equal(mergedOrder(k)[0].id, 't');
  const r = renameLayer(json(), { kind: 'group', grp: 'g1' }, 'Botón OK');
  assert.equal(layerTree(r)[0].children[1].name, 'Botón OK');
  assert.equal(renameLayer(json(), { kind: 'item', type: 'a', id: 'bg' }, 'Fondo').annotations[1].name, 'Fondo');
});
