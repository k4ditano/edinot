// Variables y estilos del diseño (como los «styles»/«variables» de Figma). Lógica pura.
//
// json.vars = {
//   colors: [{ id, name, value }],                       // «Primario» = #6366f1
//   texts:  [{ id, name, style: { font, fontSize, weight, lineHeight, letterSpacing, italic, transform } }],
// }
// Un elemento enlaza con ellas así:
//   fillVar   → relleno (dibujos) o color de la ficha (formas con texto, notas adhesivas)
//   colorVar  → borde/tinta (dibujos) o color del texto (etiquetas)
//   textStyle → estilo de texto (etiquetas)
// Al pintar se resuelven con los valores actuales: cambiar una variable cambia todo lo que la usa.

export const TEXT_STYLE_KEYS = ['font', 'fontSize', 'weight', 'lineHeight', 'letterSpacing', 'italic', 'transform'];

export function colorVar(vars, id) {
  const c = vars && Array.isArray(vars.colors) ? vars.colors.find(x => x.id === id) : null;
  return c ? c.value : null;
}
export function textStyleVar(vars, id) {
  const s = vars && Array.isArray(vars.texts) ? vars.texts.find(x => x.id === id) : null;
  return s ? s.style || {} : null;
}

/** El elemento con sus variables ya aplicadas (el mismo objeto si no enlaza ninguna). */
export function resolveVars(item, vars) {
  if (!item || !vars || !(item.fillVar || item.colorVar || item.textStyle)) return item;
  const out = { ...item };
  const isAnno = item.kind === 'path' || !!item.bbox;   // los dibujos llevan caja (bbox); las fichas, no
  if (item.fillVar) {
    const v = colorVar(vars, item.fillVar);
    if (v) { if (isAnno) out.fill = v; else out.color = v; }
  }
  if (item.colorVar) {
    const v = colorVar(vars, item.colorVar);
    if (v) { out.color = v; if (item.kind === 'path' && item.variant === 'pen') out.fill = v; }
  }
  if (item.textStyle) {
    const st = textStyleVar(vars, item.textStyle);
    if (st) for (const k of TEXT_STYLE_KEYS) if (st[k] !== undefined) out[k] = st[k];
  }
  return out;
}

/** Nuevo id corto para una variable. */
export const newVarId = (p) => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);

/** Estilo de texto a partir de una etiqueta (para «crear estilo desde la selección»). */
export function textStyleFrom(label) {
  const st = {};
  for (const k of TEXT_STYLE_KEYS) if (label[k] !== undefined) st[k] = label[k];
  if (st.weight == null && label.bold) st.weight = 700;
  if (st.fontSize == null) st.fontSize = label.fontSize || 20;
  return st;
}
