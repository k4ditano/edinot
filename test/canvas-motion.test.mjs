import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterKeyframes, smartPairs, frameItems } from '../editor/canvas/motion.js';

test('enter keyframes end at the resting state', () => {
  for (const t of ['fade', 'up', 'scale', 'pop', 'blur']) {
    const k = enterKeyframes(t);
    assert.equal(k[0].opacity, 0);
    assert.equal(k[k.length - 1].opacity, 1);
  }
});

test('smart animate pairs items by text / component ref and gives their start offset', () => {
  const A = { id: 'A', x: 0, y: 0, w: 400, h: 800 }, B = { id: 'B', x: 1000, y: 0, w: 400, h: 800 };
  const json = {
    groups: [A, B],
    nodes: [
      { id: 't1', kind: 'label', text: 'Curry', x: 20, y: 300, w: 100, h: 30 },
      { id: 't2', kind: 'label', text: 'Curry', x: 1020, y: 100, w: 200, h: 60 },
      { id: 'n2', kind: 'label', text: 'Solo en B', x: 1020, y: 500, w: 100, h: 30 },
    ],
    annotations: [],
  };
  assert.equal(frameItems(json, A).length, 1);
  const p = smartPairs(json, A, B);
  const m = p.find(x => x.id === 't2');
  assert.deepEqual([m.matched, m.dx, m.dy, m.scale], [true, 0, 200, 0.5]);
  assert.equal(p.find(x => x.id === 'n2').matched, false);
});
