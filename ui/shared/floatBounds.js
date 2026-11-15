// Límites horizontales para menús y tarjetas flotantes de la nota.
// Si el ancla está dentro del área de la nota (.docwrap) y la caja cabe en
// ella, la caja no se sale de la nota (no tapa el panel derecho ni la barra
// lateral). Si no cabe, o el ancla está fuera, se limita a la ventana.
//
// 1.2.1: con la ventana estrecha y el panel derecho abierto a la nota le
// quedan ~300 px. Las cajas se ADAPTAN al hueco (`fitWidth`) en vez de salirse:
// solo si el hueco es menor que el mínimo (MIN_FLOAT_WIDTH) pueden salir de la nota.

export const MIN_FLOAT_WIDTH = 280;

// ── Puro (lo prueban los tests) ──────────────────────────────────────────
// span = { left, right } del hueco libre de la nota (o null si no hay).
// Devuelve el ancho a usar: el natural si cabe; si no, el hueco; nunca menos de `min`.
export function fitWidth(natural, span, { margin = 8, min = MIN_FLOAT_WIDTH } = {}) {
  if (!span) return natural;
  const free = Math.floor(span.right - span.left - 2 * margin);
  if (free >= natural) return natural;
  return Math.max(min, free);
}
// Si la caja de ancho `width` cabe en `span`, la deja dentro; si no, solo la ventana.
export function clampIn(left, width, span, vw, margin = 8) {
  let lo = margin, hi = vw - width - margin;
  if (span && span.right - span.left >= width + 2 * margin) {
    lo = Math.max(lo, span.left + margin);
    hi = Math.min(hi, span.right - width - margin);
  }
  return Math.max(lo, Math.min(left, hi));
}
// Hueco libre de la nota donde está el ancla (`a`): el área de la nota menos el
// panel derecho si flota encima. null si el ancla está fuera del área.
export function spanOf(boxRect, ctxRect, a) {
  if (!boxRect) return null;
  let right = boxRect.right;
  if (ctxRect && ctxRect.width > 0 && ctxRect.left > boxRect.left && ctxRect.left < right) right = ctxRect.left;
  if (a != null && !(a >= boxRect.left && a <= right)) return null;
  return { left: boxRect.left, right };
}

// ── Con DOM ──────────────────────────────────────────────────────────────
export function noteSpan(anchorLeft) {
  if (typeof document === 'undefined') return null;
  const box = document.querySelector('.docwrap');
  if (!box) return null;
  const ctx = document.querySelector('.shell-content > .sh-ctx');
  return spanOf(box.getBoundingClientRect(), ctx && ctx.getBoundingClientRect(), anchorLeft);
}

// Ancho para una caja flotante cuyo ancho natural es `natural`.
export function floatWidth(natural, anchorLeft, margin = 8) {
  return fitWidth(natural, noteSpan(anchorLeft), { margin });
}

export function clampLeft(left, width, anchorLeft, margin = 8) {
  const a = anchorLeft != null ? anchorLeft : left;
  return clampIn(left, width, noteSpan(a), window.innerWidth, margin);
}
