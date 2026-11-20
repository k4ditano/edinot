import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interactionsOf, condOk, withVar, frameInteractions } from '../editor/canvas/interactions.js';

test('legacy links count as click interactions, and group pieces share them', () => {
  const json = { nodes: [{ id: 't', kind: 'label', text: 'Ir', grp: 'g' }], annotations: [{ id: 'r', kind: 'shape', grp: 'g', link: 'F2', linkMode: 'overlay', linkAnim: 'dissolve' }] };
  assert.deepEqual(interactionsOf(json.annotations[0], json), [{ trigger: 'click', action: 'overlay', target: 'F2', anim: 'dissolve' }]);
  assert.equal(interactionsOf(json.nodes[0], json)[0].target, 'F2');
});

test('conditions and temporary variable changes', () => {
  const json = { vars: { bools: [{ id: 'logged', name: 'Sesión', value: false }], nums: [{ id: 'cart', name: 'Carrito', value: 0 }] } };
  const inter = { trigger: 'click', action: 'navigate', target: 'F', if: { var: 'logged', eq: true } };
  assert.equal(condOk(inter, json.vars), false);
  const j2 = withVar(json, 'logged', true);
  assert.equal(condOk(inter, j2.vars), true);
  assert.equal(withVar(json, 'cart', '3').vars.nums[0].value, 3);
});

test('frameInteractions finds delay / key triggers among a screen', () => {
  const items = [{ item: { id: 'a', interactions: [{ trigger: 'delay', delay: 1500, action: 'navigate', target: 'F' }, { trigger: 'key', key: 'Enter', action: 'back' }] } }];
  assert.equal(frameInteractions({}, items, 'delay')[0].inter.delay, 1500);
  assert.equal(frameInteractions({}, items, 'key')[0].inter.key, 'Enter');
});
