// Tinta a mano: lo que convierte los eventos del lápiz/ratón en los puntos del trazo. Lógica pura.
//
//   · Todas las muestras: el navegador agrupa los movimientos rápidos; se leen todos (getCoalescedEvents).
//   · Estabilizador: un seguidor con muelle y amortiguación (como el «ink stroke modeler» de Google) que quita el
//     temblor de la mano sin que la tinta se quede atrás; al levantar el lápiz, el trazo llega hasta donde se soltó.
//   · Presión: curva ajustable; con ratón (sin presión real) se simula con la velocidad, más fino cuanto más rápido.
//   · Inclinación: con el lápiz tumbado el trazo engorda, como al sombrear con un lápiz de verdad.
// Cada punto sale como [x, y, presión efectiva] (la presión efectiva ya lleva la curva y la inclinación).

/** Muestras de un evento de puntero: las agrupadas por el navegador y, si se pide, las predichas. */
export function eventSamples(ev, { predicted = false } = {}) {
  const list = (ev && typeof ev.getCoalescedEvents === 'function' && ev.getCoalescedEvents()) || [];
  const out = list.length ? list : [ev];
  if (!predicted) return out;
  const pred = (ev && typeof ev.getPredictedEvents === 'function' && ev.getPredictedEvents()) || [];
  return { samples: out, predicted: pred };
}

/** Curva de presión: gamma < 1 da más grosor con poca fuerza, > 1 pide apretar más. */
export const pressureCurve = (p, gamma = 1) => Math.max(0, Math.min(1, Math.pow(Math.max(0, Math.min(1, p)), gamma)));

/** Multiplicador por inclinación (grados desde la vertical, 0…90): hasta ×1.6 con el lápiz casi tumbado. */
export function tiltFactor(tiltX = 0, tiltY = 0) {
  const t = Math.min(90, Math.hypot(tiltX || 0, tiltY || 0));
  return 1 + Math.max(0, t - 25) / 65 * 0.6;
}

/**
 * Crea un trazo. Opciones:
 *   stabilize  0…10 (0 = sin suavizar, 10 = muy suave)
 *   gamma      curva de presión
 *   simulate   true = la presión sale de la velocidad (ratón)
 * Devuelve { add(sample) → nuevos puntos, finish() → puntos de cierre, points }.
 */
export function createInk({ stabilize = 3, gamma = 1, simulate = false } = {}) {
  const pts = [];
  const tau = Math.max(0, stabilize) * 7;   // ms de «inercia» del seguidor
  let pos = null, vel = [0, 0], lastT = 0, lastRaw = null, speedEma = 0;
  const pressureOf = (s, speed) => {
    if (simulate) {
      // Más rápido, más fino (0.25…0.75), suavizado para que no parpadee el grosor.
      speedEma = speedEma * 0.8 + speed * 0.2;
      return 0.75 - Math.min(0.5, speedEma * 0.35);
    }
    const p = s.pressure > 0 ? s.pressure : 0.5;
    return pressureCurve(p, gamma) * tiltFactor(s.tiltX, s.tiltY);
  };
  const add = (s) => {
    const t = s.t != null ? s.t : (lastT + 8);
    const raw = [s.x, s.y];
    const dt = lastRaw ? Math.max(1, t - lastT) : 8;
    const speed = lastRaw ? Math.hypot(raw[0] - lastRaw[0], raw[1] - lastRaw[1]) / dt : 0;   // px/ms
    const p = pressureOf(s, speed);
    lastT = t; lastRaw = raw;
    if (!pos || tau === 0) { pos = raw.slice(); pts.push([pos[0], pos[1], p]); return [pts[pts.length - 1]]; }
    // Muelle críticamente amortiguado hacia la posición real (no rebota, no se pasa).
    const w = 2 / Math.max(1, tau);
    const x = w * dt, exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const out = [];
    const cx = pos[0] - raw[0], cy = pos[1] - raw[1];
    const tx = (vel[0] + w * cx) * dt, ty = (vel[1] + w * cy) * dt;
    vel = [(vel[0] - w * tx) * exp, (vel[1] - w * ty) * exp];
    pos = [raw[0] + (cx + tx) * exp, raw[1] + (cy + ty) * exp];
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(pos[0] - last[0], pos[1] - last[1]) > 0.25) { pts.push([pos[0], pos[1], p]); out.push(pts[pts.length - 1]); }
    return out;
  };
  // Al levantar el lápiz: el trazo alcanza el último punto real (si no, se quedaría corto con mucho suavizado).
  const finish = () => {
    if (!pos || !lastRaw) return [];
    const out = [];
    const last = pts[pts.length - 1];
    const d = Math.hypot(lastRaw[0] - pos[0], lastRaw[1] - pos[1]);
    const steps = Math.min(8, Math.ceil(d / 2));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const q = [pos[0] + (lastRaw[0] - pos[0]) * f, pos[1] + (lastRaw[1] - pos[1]) * f, last ? last[2] : 0.5];
      pts.push(q); out.push(q);
    }
    pos = lastRaw.slice();
    return out;
  };
  return { add, finish, points: pts };
}

/** Prolonga el trazo con los puntos predichos (solo para pintar mientras se dibuja; no se guardan). */
export function withPrediction(points, predicted) {
  if (!predicted || !predicted.length || !points.length) return points;
  const p = points[points.length - 1][2];
  return [...points, ...predicted.slice(0, 3).map(s => [s.x, s.y, p])];
}
