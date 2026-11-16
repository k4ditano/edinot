// Cambio mínimo entre dos textos: se aplica solo el tramo que difiere, no se borra y reescribe todo.
//
// Escribir una nota entera con «borrar todo + insertar todo» rompía lo que otra persona tuviera abierto en
// ella (el cursor saltaba y lo que escribía a la vez se perdía) y hacía que el historial de la nota fuera
// «todo cambió». Con un prefijo y un sufijo comunes basta un único borrado + inserción alrededor del cambio.

const isHigh = (c) => c >= 0xD800 && c <= 0xDBFF;
const isLow = (c) => c >= 0xDC00 && c <= 0xDFFF;

/** { index, del, ins } tal que a.slice(0,index) + ins + a.slice(index+del) === b. */
export function diffRange(a, b) {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  if (p > 0 && isHigh(a.charCodeAt(p - 1))) p--;            // no partir un par sustituto (emoji)
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  if (s > 0 && isLow(a.charCodeAt(a.length - s))) s--;
  return { index: p, del: a.length - p - s, ins: b.slice(p, b.length - s) };
}

/** Deja `ytext` con el contenido `next` tocando solo el tramo que cambia. Devuelve false si ya era igual.
 *  Debe llamarse dentro de una transacción del documento. */
export function applyTextDiff(ytext, next) {
  const target = next == null ? '' : String(next);
  const cur = ytext.toString();
  if (cur === target) return false;
  // Un texto con incrustaciones (no es el caso de una nota Markdown) no cuadra con sus índices: reescribir.
  if (cur.length !== ytext.length) {
    if (ytext.length > 0) ytext.delete(0, ytext.length);
    if (target) ytext.insert(0, target);
    return true;
  }
  const { index, del, ins } = diffRange(cur, target);
  if (del) ytext.delete(index, del);
  if (ins) ytext.insert(index, ins);
  return true;
}
