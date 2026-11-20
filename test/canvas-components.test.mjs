import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComponent, insertInstance, syncInstances, detachInstances, listComponents } from '../editor/canvas/components.js';

let n = 0;
const id = (p) => p + (++n);
const base = () => ({
  nodes: [{ id: 'lbl', kind: 'label', text: 'Comprar', x: 20, y: 15, w: 80, h: 20, color: '#fff' }],
  annotations: [{ id: 'bg', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 120, h: 50, rx: 12, fill: '#6366f1', bbox: { x: 0, y: 0, w: 120, h: 50 } }],
});

test('create a component and insert an instance next to it', () => {
  const { json, id: cid } = createComponent(base(), ['lbl'], ['bg'], 'Botón');
  assert.deepEqual(listComponents(json).map(c => [c.name, c.nodes.length, c.annos.length]), [['Botón', 1, 1]]);
  const { json: j2, ids } = insertInstance(json, cid, { x: 300, y: 100 }, id);
  const instBg = j2.annotations.find(a => a.id === ids.annos[0]);
  const instLbl = j2.nodes.find(x => x.id === ids.nodes[0]);
  assert.deepEqual([instBg.bbox.x + instBg.ox, instBg.bbox.y + instBg.oy], [300, 100]);
  assert.deepEqual([instLbl.x, instLbl.y], [320, 115]);
  assert.equal(instBg.cref, 'bg');
  assert.equal(syncInstances(j2), j2);   // recién puesta: ya está al día
});

test('changing the main updates instances (style and size), keeping their position and own text', () => {
  const { json, id: cid } = createComponent(base(), ['lbl'], ['bg'], 'Botón');
  let { json: j, ids } = insertInstance(json, cid, { x: 300, y: 100 }, id);
  // la instancia tiene su propio texto
  j = { ...j, nodes: j.nodes.map(x => (x.id === ids.nodes[0] ? { ...x, text: 'Cancelar' } : x)) };
  // el principal cambia de color y de radio, y crece
  j = { ...j, annotations: j.annotations.map(a => (a.id === 'bg' ? { ...a, fill: '#ef4444', rx: 24, w: 160, bbox: { ...a.bbox, w: 160 } } : a)) };
  const s = syncInstances(j);
  const ib = s.annotations.find(a => a.id === ids.annos[0]), il = s.nodes.find(x => x.id === ids.nodes[0]);
  assert.deepEqual([ib.fill, ib.rx, ib.w], ['#ef4444', 24, 160]);
  assert.deepEqual([ib.bbox.x + ib.ox, ib.bbox.y + ib.oy], [300, 100]);
  assert.equal(il.text, 'Cancelar');
  assert.equal(syncInstances(s), s);
});

test('detach turns an instance into plain items', () => {
  const { json, id: cid } = createComponent(base(), ['lbl'], ['bg'], 'Botón');
  const { json: j, ids } = insertInstance(json, cid, null, id);
  const d = detachInstances(j, ids.nodes, []);
  assert.ok(d.annotations.filter(a => ids.annos.includes(a.id)).every(a => !a.cinst));
  assert.ok(d.nodes.filter(x => ids.nodes.includes(x.id)).every(x => !x.cinst && x.grp));
});

test('an instance is stacked on top, keeping the main order (label above its rect)', () => {
  const { json, id: cid } = createComponent({ ...base(), nodes: [{ ...base().nodes[0], z: 5 }], annotations: [{ ...base().annotations[0], z: 4 }] }, ['lbl'], ['bg'], 'B');
  const { json: j, ids } = insertInstance(json, cid, { x: 300, y: 0 }, id);
  const zl = j.nodes.find(x => x.id === ids.nodes[0]).z, zr = j.annotations.find(a => a.id === ids.annos[0]).z;
  assert.ok(zl > zr && zr > 5);
});
