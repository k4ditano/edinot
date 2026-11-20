import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionUnits, alignUnits, spaceUnits, tidyUp, currentGap, selectSame, findText, replaceText } from '../editor/canvas/arrange.js';

const base = () => ({
  nodes: [
    { id: 'n1', kind: 'label', text: 'Hola mundo', x: 0, y: 0, w: 100, h: 40, font: 'sans', fontSize: 20 },
    { id: 'n2', kind: 'label', text: 'Adiós mundo', x: 150, y: 13, w: 80, h: 40, font: 'sans', fontSize: 20 },
  ],
  annotations: [
    { id: 'a1', kind: 'shape', shape: 'rect', fill: '#FF0000', bbox: { x: 300, y: 5, w: 60, h: 60 } },
    { id: 'a2', kind: 'shape', shape: 'rect', fill: '#ff0000', bbox: { x: 0, y: 0, w: 10, h: 10 }, ox: 500, oy: 100 },
  ],
});
const all = (j) => selectionUnits(j, new Set(j.nodes.map(n => n.id)), new Set(j.annotations.map(a => a.id)));

test('align and space mix cards and drawings', () => {
  const j = base();
  const u = selectionUnits(j, new Set(['n1', 'n2']), new Set(['a1']));
  const top = alignUnits(j, u, 'top');
  assert.deepEqual([top.nodes[1].y, top.annotations[0].oy], [0, -5]);
  const sp = spaceUnits(j, u, 'h', 20);
  assert.deepEqual([sp.nodes[1].x, sp.annotations[0].ox], [120, -80]);   // 0+100+20 = 120; 120+80+20 = 220 → 300-80
  assert.equal(currentGap(u, 'h'), 60);
});

test('tidy up puts a messy row in line with one equal gap', () => {
  const j = base();
  const u = selectionUnits(j, new Set(['n1', 'n2']), new Set(['a1']));
  const t = tidyUp(j, u);
  const U = selectionUnits(t, new Set(['n1', 'n2']), new Set(['a1']));
  const ys = U.map(x => x.rect.y);
  assert.ok(ys.every(y => y === 0));
  assert.equal(currentGap(U, 'h'), 60);
});

test('select same fill (case-insensitive colours) and same font', () => {
  const j = base();
  const s = selectSame(j, j.annotations[0], 'fill');
  assert.deepEqual([...s.annos].sort(), ['a1', 'a2']);
  assert.deepEqual([...selectSame(j, j.nodes[0], 'font').nodes].sort(), ['n1', 'n2']);
});

test('find and replace text', () => {
  const j = base();
  assert.equal(findText(j, 'MUNDO').length, 2);
  const r = replaceText(j, 'mundo', 'world');
  assert.equal(r.count, 2);
  assert.equal(r.json.nodes[1].text, 'Adiós world');
  assert.equal(replaceText(j, 'mundo', 'x', { only: new Set(['n:n1']) }).count, 1);
  assert.equal(all(j).length, 4);
});
