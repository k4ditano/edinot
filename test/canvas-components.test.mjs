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

test('switching to a variant with different pieces keeps the instance in place (regression)', async () => {
  const { addVariant, switchVariant } = await import('../editor/canvas/components.js');
  const { json, id: cid } = createComponent(base(), ['lbl'], ['bg'], 'Botón');
  let { json: j, id: v2 } = addVariant(json, cid, 'Con icono', id);
  // la variante gana una pieza (un icono) a la izquierda y su texto se mueve
  const vbg = j.annotations.find(a => a.cmain === v2);
  const vx = vbg.bbox.x + (vbg.ox || 0), vy = vbg.bbox.y + (vbg.oy || 0);
  j = { ...j, nodes: [...j.nodes.map(n => (n.cmain === v2 ? { ...n, x: n.x + 20 } : n)), { id: 'ico', kind: 'label', text: '★', x: vx + 6, y: vy + 15, w: 14, h: 20, cmain: v2, cname: 'Botón', cset: 'Botón', cvariant: 'Con icono', grp: vbg.grp }] };
  const r = insertInstance(j, cid, { x: 500, y: 300 }, id);
  let k = syncInstances(switchVariant(r.json, r.ids.grp, v2, id));
  k = syncInstances(k);
  const bg = k.annotations.find(a => a.grp === r.ids.grp);
  assert.deepEqual([bg.bbox.x + bg.ox, bg.bbox.y + bg.oy], [500, 300]);
  const texts = k.nodes.filter(n => n.grp === r.ids.grp).map(n => [n.text, n.x, n.y]).sort();
  assert.equal(texts.length, 2);
  for (const [, x, y] of texts) assert.ok(x >= 500 && x < 660 && y >= 300 && y < 350, 'texto dentro del botón');
});

test('overrides: a changed colour stays when the main changes; unchanged props and text follow; reset', async () => {
  const { resetOverrides } = await import('../editor/canvas/components.js');
  const { json, id: cid } = createComponent(base(), ['lbl'], ['bg'], 'Botón');
  let { json: j, ids } = insertInstance(json, cid, { x: 300, y: 0 }, id);
  j = syncInstances(j);   // primera sincronización: guarda cbase
  // la instancia cambia su color (anulación)
  j = { ...j, annotations: j.annotations.map(a => (a.id === ids.annos[0] ? { ...a, fill: '#000000' } : a)) };
  // el principal cambia color, radio y texto
  j = { ...j, annotations: j.annotations.map(a => (a.id === 'bg' ? { ...a, fill: '#ef4444', rx: 30 } : a)), nodes: j.nodes.map(n => (n.id === 'lbl' ? { ...n, text: 'Pagar' } : n)) };
  j = syncInstances(j);
  const ib = j.annotations.find(a => a.id === ids.annos[0]), il = j.nodes.find(n => n.id === ids.nodes[0]);
  assert.equal(ib.fill, '#000000');   // anulación conservada
  assert.equal(ib.rx, 30);            // lo no tocado sigue al principal
  assert.equal(il.text, 'Pagar');     // el texto también, si no se cambió
  const r = resetOverrides(j, ids.grp);
  assert.equal(r.annotations.find(a => a.id === ids.annos[0]).fill, '#ef4444');
});

test('component properties: text and show/hide per instance', async () => {
  const { componentProps, setInstanceProp } = await import('../editor/canvas/components.js');
  const b = base();
  b.nodes[0].cprop = { name: 'Etiqueta', type: 'text' };
  b.annotations[0].cprop = { name: 'Con fondo', type: 'bool' };
  const { json, id: cid } = createComponent(b, ['lbl'], ['bg'], 'Botón');
  assert.deepEqual(componentProps(json, cid).map(p => [p.name, p.type]).sort(), [['Con fondo', 'bool'], ['Etiqueta', 'text']]);
  let { json: j, ids } = insertInstance(json, cid, { x: 300, y: 0 }, id);
  j = syncInstances(j);
  j = syncInstances(setInstanceProp(setInstanceProp(j, ids.grp, 'etiqueta', 'Cancelar'), ids.grp, 'Con fondo', false));
  assert.equal(j.nodes.find(n => n.id === ids.nodes[0]).text, 'Cancelar');
  assert.equal(j.annotations.find(a => a.id === ids.annos[0]).hidden, true);
});

test('switchVariant keeps the stacking of the target variant and the instance interactions', async () => {
  const { addVariant, switchVariant } = await import('../editor/canvas/components.js');
  const b = base();
  b.annotations[0].z = 1; b.nodes[0].z = 2;
  const { json, id: cid } = createComponent(b, ['lbl'], ['bg'], 'Botón');
  const r = addVariant(json, cid, 'Hover', id);
  let { json: j, ids } = insertInstance(r.json, cid, { x: 300, y: 300 }, id);
  j = { ...j, annotations: j.annotations.map(a => (a.id === ids.annos[0] ? { ...a, interactions: [{ trigger: 'click', action: 'back' }] } : a)) };
  const s2 = switchVariant(j, ids.grp, r.id, id);
  const bg = s2.annotations.find(a => a.id === ids.annos[0]), tx = s2.nodes.find(n => n.id === ids.nodes[0]);
  assert.ok(tx.z > bg.z);
  assert.deepEqual(bg.interactions, [{ trigger: 'click', action: 'back' }]);
});

test('instance swap: an instance becomes another component, in place, keeping its text', async () => {
  const { switchVariant } = await import('../editor/canvas/components.js');
  const b = base();
  b.nodes.push({ id: 'l2', kind: 'label', text: 'Icono', x: 600, y: 0, w: 80, h: 30 });
  b.annotations.push({ id: 'c2', kind: 'shape', shape: 'ellipse', x: 600, y: 0, w: 60, h: 60, bbox: { x: 600, y: 0, w: 60, h: 60 } });
  const { json: j1, id: cA } = createComponent(b, ['lbl'], ['bg'], 'Botón');
  const { json: j2, id: cB } = createComponent(j1, ['l2'], ['c2'], 'Chip');
  let { json: j, ids } = insertInstance(j2, cA, { x: 300, y: 300 }, id);
  j = { ...j, nodes: j.nodes.map(n => (n.id === ids.nodes[0] ? { ...n, text: 'Comprar' } : n)) };
  const s = syncInstances(switchVariant(j, ids.grp, cB, id));
  const pieces = [...s.nodes, ...s.annotations].filter(x => x.grp === ids.grp);
  assert.ok(pieces.every(x => x.cinst === cB));
  assert.equal(s.nodes.find(n => n.grp === ids.grp).text, 'Comprar');
  assert.equal(s.annotations.find(a => a.grp === ids.grp).shape, 'ellipse');
});
