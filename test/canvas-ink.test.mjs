import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInk, pressureCurve, tiltFactor, eventSamples } from '../editor/canvas/ink.js';

test('coalesced samples are used when the browser grouped them', () => {
  const ev = { getCoalescedEvents: () => [{ clientX: 1 }, { clientX: 2 }, { clientX: 3 }] };
  assert.equal(eventSamples(ev).length, 3);
  assert.equal(eventSamples({ clientX: 9 }).length, 1);
});

test('the stabilizer removes jitter but the stroke still ends where the pen was lifted', () => {
  const ink = createInk({ stabilize: 6 });
  let t = 0;
  for (let i = 0; i <= 50; i++) ink.add({ x: i * 4, y: (i % 2 ? 3 : -3), pressure: 0.5, t: (t += 8) });
  const ys = ink.points.slice(10).map(p => Math.abs(p[1]));
  assert.ok(Math.max(...ys) < 2, 'jitter of ±3 px is smoothed to under 2 px');
  ink.finish();
  const end = ink.points[ink.points.length - 1];
  assert.ok(Math.abs(end[0] - 200) < 0.01 && Math.abs(end[1] + 3) < 0.01);
});

test('no stabilizing follows the pen exactly', () => {
  const ink = createInk({ stabilize: 0 });
  ink.add({ x: 0, y: 0, pressure: 0.5, t: 0 });
  ink.add({ x: 10, y: 5, pressure: 0.5, t: 8 });
  assert.deepEqual(ink.points[1].slice(0, 2), [10, 5]);
});

test('pressure curve, tilt and simulated pressure for a mouse', () => {
  assert.equal(pressureCurve(0.25, 0.5), 0.5);
  assert.equal(tiltFactor(0, 0), 1);
  assert.ok(tiltFactor(60, 30) > 1.3);
  const slow = createInk({ stabilize: 0, simulate: true }), fast = createInk({ stabilize: 0, simulate: true });
  for (let i = 0; i < 20; i++) { slow.add({ x: i, y: 0, t: i * 16 }); fast.add({ x: i * 40, y: 0, t: i * 16 }); }
  assert.ok(slow.points.at(-1)[2] > fast.points.at(-1)[2]);
});
