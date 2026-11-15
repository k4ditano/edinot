// Límites de los menús flotantes dentro de la nota (1.2.1). `node --test test/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWidth, clampIn, spanOf, MIN_FLOAT_WIDTH } from '../ui/shared/floatBounds.js';

const rect = (left, right) => ({ left, right, width: right - left });

test('fitWidth: si cabe, el ancho natural; si no, el hueco; nunca menos del mínimo', () => {
  assert.equal(fitWidth(520, { left: 300, right: 1100 }), 520);                 // 1440 px sin panel
  assert.equal(fitWidth(520, { left: 280, right: 580 }), 284);                   // ~300 px de nota: 300 - 16
  assert.equal(fitWidth(380, { left: 280, right: 580 }), 284);
  assert.equal(fitWidth(520, { left: 280, right: 500 }), MIN_FLOAT_WIDTH);       // hueco < mínimo → 280
  assert.equal(fitWidth(520, null), 520);                                        // sin nota (canvas, ancla fuera): natural
  assert.equal(fitWidth(520, { left: 0, right: 400 }, { margin: 0, min: 100 }), 400);
});

test('spanOf: el hueco de la nota excluye el panel derecho que flota encima', () => {
  const box = rect(280, 900);
  assert.deepEqual(spanOf(box, null, 400), { left: 280, right: 900 });
  assert.deepEqual(spanOf(box, rect(600, 900), 400), { left: 280, right: 600 });  // panel flotante desde x=600
  assert.deepEqual(spanOf(box, rect(0, 0), 400), { left: 280, right: 900 });      // panel sin ancho: se ignora
  assert.deepEqual(spanOf(box, rect(1000, 1200), 400), { left: 280, right: 900 }); // panel fuera de la nota
  assert.equal(spanOf(box, null, 100), null);                                      // ancla en la barra lateral
  assert.equal(spanOf(box, rect(600, 900), 700), null);                            // ancla bajo el panel
  assert.equal(spanOf(null, null, 400), null);
});

test('clampIn: dentro de la nota si cabe; si no, solo dentro de la ventana', () => {
  const span = { left: 280, right: 600 };
  assert.equal(clampIn(100, 284, span, 900), 288);        // no invade la barra lateral
  assert.equal(clampIn(500, 284, span, 900), 308);        // ni el panel (600 - 284 - 8)
  assert.equal(clampIn(300, 284, span, 900), 300);        // ya está dentro
  assert.equal(clampIn(100, 600, span, 900), 100);        // no cabe en la nota: ventana
  assert.equal(clampIn(-50, 300, null, 900), 8);
  assert.equal(clampIn(2000, 300, null, 900), 592);
});

test('combinado: a 900 px con el panel abierto, la tarjeta de IA queda entre barra lateral y panel', () => {
  const span = spanOf(rect(280, 900), rect(600, 900), 320);
  const w = fitWidth(520, span);
  const left = clampIn(300, w, span, 900);
  assert.ok(w >= MIN_FLOAT_WIDTH);
  assert.ok(left >= 280 && left + w <= 600, `caja ${left}..${left + w} debe caer en 280..600`);
});
