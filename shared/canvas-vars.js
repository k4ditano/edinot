// Variables y estilos del diseño (como los «styles» y «variables» de Figma). Lógica pura.
//
// json.vars = {
//   modes:  [{ id, name }]                               // «Claro», «Oscuro» (si no hay, un modo implícito)
//   mode:   '<id del modo activo>'
//   colors: [{ id, name, value, values: { modeId: valor } }]           // «Primario» = #6366f1
//   nums:   [{ id, name, value, values }]                               // «Espacio M» = 16, «Radio» = 12
//   strs:   [{ id, name, value, values }]                               // «CTA» = "Comprar"
//   bools:  [{ id, name, value, values }]                               // «Mostrar banner» = true
//   texts:  [{ id, name, style: { font, fontSize, weight, lineHeight, letterSpacing, italic, transform } }],
// }
// Un elemento enlaza con ellas así:
//   fillVar   → relleno (dibujos) o color de la ficha (formas con texto, notas adhesivas)
//   colorVar  → borde/tinta (dibujos) o color del texto (etiquetas)
//   textStyle → estilo de texto (etiquetas)
//   bind      → { propiedad: idVariable } para cualquier otra: rx, strokeWidth, fontSize, opacity, w, h, text,
//               visible (sí/no)… y en los marcos, gap / pad del auto layout.
// Al pintar se resuelven con el modo activo: cambiar una variable o el modo cambia todo lo que la usa.

export const TEXT_STYLE_KEYS = ['font', 'fontSize', 'weight', 'lineHeight', 'letterSpacing', 'italic', 'transform'];
export const VAR_KINDS = ['colors', 'nums', 'strs', 'bools'];

/** Valor de una variable en el modo activo (o su valor por omisión). */
export function varValue(vars, kind, id) {
  const list = vars && Array.isArray(vars[kind]) ? vars[kind] : [];
  const v = list.find(x => x.id === id);
  if (!v) return null;
  const m = vars.mode;
  if (m && v.values && v.values[m] !== undefined && v.values[m] !== null && v.values[m] !== '') return v.values[m];
  return v.value;
}
/** Busca una variable por id en cualquier tipo: { kind, v }. */
export function findVar(vars, id) {
  for (const k of VAR_KINDS) { const v = (vars && vars[k] || []).find(x => x.id === id); if (v) return { kind: k, v }; }
  return null;
}
export const colorVar = (vars, id) => varValue(vars, 'colors', id);
export function textStyleVar(vars, id) {
  const s = vars && Array.isArray(vars.texts) ? vars.texts.find(x => x.id === id) : null;
  return s ? s.style || {} : null;
}

/** El elemento con sus variables ya aplicadas (el mismo objeto si no enlaza ninguna). */
export function resolveVars(item, vars) {
  if (!item || !vars || !(item.fillVar || item.colorVar || item.textStyle || item.bind)) return item;
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
  if (item.bind && typeof item.bind === 'object') {
    for (const [prop, id] of Object.entries(item.bind)) {
      const f = findVar(vars, id);
      if (!f) continue;
      const val = varValue(vars, f.kind, id);
      if (val === null || val === undefined) continue;
      if (prop === 'visible') { if (val === false || val === 'false') out.hidden = true; else delete out.hidden; continue; }
      out[prop] = f.kind === 'nums' ? Number(val) : val;
      // El tamaño de un dibujo vive también en su caja.
      if ((prop === 'w' || prop === 'h') && out.bbox && out.kind === 'shape') out.bbox = { ...out.bbox, [prop]: Number(val) };
    }
  }
  return out;
}

/** Marcos: el auto layout con sus números enlazados (bind.gap, bind.pad, bind.gapCross, bind.gapY). */
export function resolveFrameVars(g, vars) {
  if (!g || !g.layout || !g.bind || !vars) return g;
  const L = { ...g.layout };
  for (const k of ['gap', 'pad', 'gapCross', 'gapY']) {
    const id = g.bind[k];
    if (!id) continue;
    const v = varValue(vars, 'nums', id);
    if (v !== null && v !== undefined && Number.isFinite(Number(v))) L[k] = Number(v);
  }
  return { ...g, layout: L };
}

/** El canvas entero con las variables aplicadas (para exportar o calcular sin la app). */
export function resolveCanvas(json) {
  const vars = json && json.vars;
  if (!vars) return json;
  return {
    ...json,
    nodes: (json.nodes || []).map(n => resolveVars(n, vars)),
    annotations: (json.annotations || []).map(a => resolveVars(a, vars)),
    groups: (json.groups || []).map(g => resolveFrameVars(g, vars)),
  };
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
