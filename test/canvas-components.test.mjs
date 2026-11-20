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

test('variants: add a variant and switch an instance to it (keeps place and text)', async () => {
  const { addVariant, switchVariant, variantsOf } = await import('../editor/canvas/components.js');
  const { json, id: cid } = createComponent(base(), ['lbl'], ['bg'], 'Botón');
  let { json: j, id: v2 } = addVariant(json, cid, 'Peligro', id);
  j = { ...j, annotations: j.annotations.map(a => (a.cmain === v2 ? { ...a, fill: '#ef4444' } : a)) };
  assert.deepEqual(variantsOf(j, cid).map(v => v.variant), ['Predeterminada', 'Peligro']);
  let r = insertInstance(j, cid, { x: 500, y: 300 }, id);
  j = { ...r.json, nodes: r.json.nodes.map(x => (x.id === r.ids.nodes[0] ? { ...x, text: 'Borrar' } : x)) };
  j = syncInstances(switchVariant(j, r.ids.grp, v2, id));
  const bg = j.annotations.find(a => a.grp === r.ids.grp), lbl = j.nodes.find(n => n.grp === r.ids.grp);
  assert.equal(bg.fill, '#ef4444');
  assert.deepEqual([bg.bbox.x + bg.ox, bg.bbox.y + bg.oy], [500, 300]);
  assert.equal(lbl.text, 'Borrar');
  assert.deepEqual([lbl.x, lbl.y], [520, 315]);
});

test('shared library: publish a component and use it in another canvas, updates follow the library', async () => {
  const { libraryEntryFrom, publishToLibrary, insertFromLibrary } = await import('../editor/canvas/components.js');
  const { json, id: cid } = createComponent(base(), ['lbl'], ['bg'], 'Botón');
  let lib = publishToLibrary([], libraryEntryFrom(json, cid));
  assert.equal(lib[0].name, 'Botón');
  let other = { nodes: [], annotations: [] };
  const r = insertFromLibrary(other, lib[0], { x: 50, y: 60 }, id);
  other = r.json;
  const bg = other.annotations[0];
  assert.deepEqual([bg.bbox.x + bg.ox, bg.bbox.y + bg.oy, bg.clib], [50, 60, true]);
  // el principal cambia y se vuelve a publicar
  const changed = { ...json, annotations: json.annotations.map(a => (a.cmain ? { ...a, fill: '#16a34a' } : a)) };
  lib = publishToLibrary(lib, libraryEntryFrom(changed, cid));
  const synced = syncInstances(other, lib);
  assert.equal(synced.annotations[0].fill, '#16a34a');
  assert.deepEqual([synced.annotations[0].bbox.x + synced.annotations[0].ox, synced.annotations[0].bbox.y + synced.annotations[0].oy], [50, 60]);
});
