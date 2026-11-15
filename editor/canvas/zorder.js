// Orden de apilado combinado de fichas y dibujos (anotaciones).
//
// Fichas = HTML y dibujos = SVG: para poder intercalar un dibujo ENTRE dos fichas, los
// dibujos con `z` numérico se pintan en tramos <svg> entre las fichas, ordenados por z.
// Por defecto no cambia nada: una ficha vale su posición en el array, un dibujo sin z
// va debajo de todas las fichas (layer 'back') o encima (cualquier otro).

export const nodeZ = (n, i) => (n.z != null ? n.z : i);
export const annoZ = (a, i) => (a.z != null ? a.z : (a.layer === 'back' ? -1e9 + i : 1e9 + i));

export function mergedOrder(json) {
  const items = [];
  (json.nodes || []).forEach((n, i) => items.push({ type: 'n', id: n.id, z: nodeZ(n, i), i }));
  (json.annotations || []).forEach((a, i) => items.push({ type: 'a', id: a.id, z: annoZ(a, i), i: i + 1e6 }));
  return items.sort((p, q) => p.z - q.z || p.i - q.i);
}

// Mueve la selección un puesto hacia delante (dir=1) o hacia atrás (dir=-1) en el orden combinado.
// Sólo reescribe `z` de los elementos movidos (fraccionario, entre sus nuevos vecinos).
export function stepZ(json, nodeIds, annoIds, dir) {
  const order = mergedOrder(json);
  const sel = (it) => (it.type === 'n' ? nodeIds.has(it.id) : annoIds.has(it.id));
  const idxs = order.map((it, k) => (sel(it) ? k : -1)).filter(k => k >= 0);
  if (!idxs.length) return json;
  const first = idxs[0], last = idxs[idxs.length - 1];
  let prev, next;
  if (dir > 0) {
    let k = last + 1; while (k < order.length && sel(order[k])) k++;
    if (k >= order.length) return json;                 // ya está arriba del todo
    prev = order[k]; next = order[k + 1] || null;
  } else {
    let k = first - 1; while (k >= 0 && sel(order[k])) k--;
    if (k < 0) return json;                             // ya está abajo del todo
    next = order[k]; prev = order[k - 1] || null;
  }
  const lo = prev ? prev.z : (next.z - 2), hi = next ? next.z : (prev.z + 2);
  const moved = order.filter(sel), m = moved.length;
  const zs = new Map(moved.map((it, k) => [it.type + it.id, lo + (hi - lo) * (k + 1) / (m + 1)]));
  return {
    ...json,
    nodes: (json.nodes || []).map(n => zs.has('n' + n.id) ? { ...n, z: zs.get('n' + n.id) } : n),
    annotations: (json.annotations || []).map(a => zs.has('a' + a.id) ? { ...a, z: zs.get('a' + a.id) } : a),
  };
}
