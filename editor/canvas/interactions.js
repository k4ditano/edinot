// Interacciones del prototipo (como en Figma). Lógica pura.
//
//   item.interactions = [{
//     trigger: 'click' | 'hover' | 'press' | 'delay' | 'key',   (key: 'Enter', 'a'…; delay: ms)
//     action:  'navigate' | 'back' | 'overlay' | 'close' | 'variant' | 'setVar' | 'url',
//     target:  id del marco (navigate/overlay) | nombre o id de la variante (variant) | URL (url),
//     anim:    transición (navigate),  var / value (setVar),  if: { var, eq } (condición)
//   }]
// Los enlaces sencillos de antes (`link`, `linkMode`, `linkAnim`) cuentan como «al pulsar, ir a / superponer».

import { varValue, findVar } from '../../shared/canvas-vars.js';

export const TRIGGERS = ['click', 'hover', 'press', 'delay', 'key'];
export const ACTIONS = ['navigate', 'back', 'overlay', 'close', 'variant', 'setVar', 'url'];

/** Interacciones de una pieza (las suyas, las de su enlace sencillo y, si no tiene, las de su grupo). */
export function interactionsOf(item, json) {
  const own = (it) => {
    const list = Array.isArray(it.interactions) ? [...it.interactions] : [];
    if (it.link) list.push({ trigger: 'click', action: it.linkMode === 'overlay' ? 'overlay' : 'navigate', target: it.link, anim: it.linkAnim });
    return list;
  };
  let list = own(item);
  if (!list.length && item.grp) {
    for (const x of [...(json.nodes || []), ...(json.annotations || [])]) if (x.grp === item.grp && x !== item) list = list.concat(own(x));
  }
  return list;
}

/** ¿Se cumple la condición? (sin condición, sí). Compara como texto para que «true» y true valgan igual. */
export function condOk(inter, vars) {
  const c = inter && inter.if;
  if (!c || !c.var) return true;
  const f = findVar(vars, c.var);
  if (!f) return false;
  return String(varValue(vars, f.kind, c.var)) === String(c.eq);
}

/** La json con una variable cambiada (solo para la presentación: no se guarda). */
export function withVar(json, varId, value) {
  const vars = json.vars || {};
  const f = findVar(vars, varId);
  if (!f) return json;
  const mode = vars.mode;
  const list = vars[f.kind].map(v => {
    if (v.id !== varId) return v;
    const val = f.kind === 'nums' ? Number(value) : f.kind === 'bools' ? (value === true || value === 'true') : value;
    return mode ? { ...v, values: { ...(v.values || {}), [mode]: val }, value: val } : { ...v, value: val };
  });
  return { ...json, vars: { ...vars, [f.kind]: list } };
}

/** Interacciones de un tipo entre las piezas de una pantalla (para «tras un tiempo» y «tecla»). */
export function frameInteractions(json, items, trigger) {
  const out = [];
  for (const { item } of items) for (const it of interactionsOf(item, json)) if (it.trigger === trigger) out.push({ item, inter: it });
  return out;
}
