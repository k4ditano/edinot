// Panel de capas en árbol (como Figma): marcos → marcos anidados → grupos / instancias → piezas. Lógica pura.

import { mergedOrder } from './zorder.js';
import { frameTree, frameRect } from './autolayout.js';

const nodeRect = (n) => ({ x: n.x || 0, y: n.y || 0, w: n.w || 240, h: n.h || 140 });
const annoRect = (a) => (a.bbox ? { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h } : null);

/**
 * Árbol de capas, de arriba (delante) a abajo (detrás):
 *   { kind: 'frame', id, title, children } | { kind: 'group', grp, name, comp, children } | { kind: 'item', type: 'n'|'a', id }
 * Los marcos van primero en su nivel; dentro, lo que tienen encima primero.
 */
export function layerTree(json) {
  const { parent, ownerItem } = frameTree(json);
  const nodes = new Map((json.nodes || []).map(n => [n.id, n]));
  const annos = new Map((json.annotations || []).map(a => [a.id, a]));
  const frames = new Map((json.groups || []).map(g => [g.id, { kind: 'frame', id: g.id, title: g.title || '', section: !!g.section, children: [] }]));
  const root = { children: [] };
  const holder = (fid) => (fid && frames.get(fid)) || root;
  // Grupos: dónde va un grupo lo decide la caja de todas sus piezas.
  const grpRect = new Map();
  for (const it of [...(json.nodes || []), ...(json.annotations || [])]) {
    if (!it.grp) continue;
    const r = it.bbox ? annoRect(it) : nodeRect(it);
    if (!r) continue;
    const u = grpRect.get(it.grp);
    grpRect.set(it.grp, u ? { x: Math.min(u.x, r.x), y: Math.min(u.y, r.y), w: Math.max(u.x + u.w, r.x + r.w) - Math.min(u.x, r.x), h: Math.max(u.y + u.h, r.y + r.h) - Math.min(u.y, r.y) } : r);
  }
  const groupsMade = new Map();
  const order = mergedOrder(json).slice().reverse();
  for (const o of order) {
    const el = o.type === 'n' ? nodes.get(o.id) : annos.get(o.id);
    if (!el || el.kind === 'page') continue;
    const leaf = { kind: 'item', type: o.type, id: o.id };
    if (el.grp) {
      let g = groupsMade.get(el.grp);
      if (!g) {
        g = { kind: 'group', grp: el.grp, name: el.gname || (el.cmain || el.cinst ? el.cname || '' : ''), comp: el.cmain ? 'main' : el.cinst ? 'inst' : null, children: [] };
        groupsMade.set(el.grp, g);
        holder(ownerItem(grpRect.get(el.grp))).children.push(g);
      }
      if (!g.name && el.gname) g.name = el.gname;
      if (el.cinst && !g.cref) g.cref = el.cinst;
      g.children.push(leaf);
      continue;
    }
    const r = o.type === 'n' ? nodeRect(el) : annoRect(el);
    holder(r ? ownerItem(r) : null).children.push(leaf);
  }
  // Marcos dentro de su padre (los más pequeños dentro de los grandes), delante de las piezas.
  const sorted = (json.groups || []).slice().sort((a, b) => { const ra = frameRect(a), rb = frameRect(b); return ra.w * ra.h - rb.w * rb.h; });
  for (const g of sorted.reverse()) {
    const f = frames.get(g.id);
    const p = holder(parent.get(g.id));
    p.children.unshift(f);
  }
  return root.children;
}

/** Ids de las piezas de una capa del árbol (para seleccionar o mover un grupo entero). */
export function layerItems(node) {
  if (node.kind === 'item') return [{ type: node.type, id: node.id }];
  return (node.children || []).flatMap(layerItems);
}

/**
 * Arrastrar en el panel: pone las piezas `moving` ([{type,id}]) justo delante (`above`) o detrás de `target`
 * ({type,id}) en el orden de apilado. Solo reescribe la `z` de las piezas movidas.
 */
export function moveLayers(json, moving, target, above) {
  const key = (it) => it.type + it.id;
  const mv = new Set(moving.map(key));
  if (mv.has(key(target))) return json;
  const order = mergedOrder(json).filter(it => !mv.has(key(it)));
  const ti = order.findIndex(it => key(it) === key(target));
  if (ti < 0) return json;
  // orden de abajo arriba: «encima» = después del destino
  const lo = above ? order[ti] : order[ti - 1] || null;
  const hi = above ? order[ti + 1] || null : order[ti];
  const zl = lo ? lo.z : hi.z - 2, zh = hi ? hi.z : lo.z + 2;
  const movedSorted = mergedOrder(json).filter(it => mv.has(key(it)));
  const m = movedSorted.length;
  const zs = new Map(movedSorted.map((it, k) => [key(it), zl + (zh - zl) * (k + 1) / (m + 1)]));
  return {
    ...json,
    nodes: (json.nodes || []).map(n => (zs.has('n' + n.id) ? { ...n, z: zs.get('n' + n.id) } : n)),
    annotations: (json.annotations || []).map(a => (zs.has('a' + a.id) ? { ...a, z: zs.get('a' + a.id) } : a)),
  };
}

/** Renombrar una capa: pieza → `name`, grupo → `gname` en sus piezas, marco → `title`. */
export function renameLayer(json, node, name) {
  const nm = String(name || '').trim();
  const set = (o, k) => { const r = { ...o }; if (nm) r[k] = nm; else delete r[k]; return r; };
  if (node.kind === 'frame') return { ...json, groups: (json.groups || []).map(g => (g.id === node.id ? { ...g, title: nm } : g)) };
  if (node.kind === 'group') {
    const f = (it) => (it.grp === node.grp ? set(it, 'gname') : it);
    return { ...json, nodes: (json.nodes || []).map(f), annotations: (json.annotations || []).map(f) };
  }
  const f = (it) => (it.id === node.id ? set(it, 'name') : it);
  return node.type === 'n' ? { ...json, nodes: (json.nodes || []).map(f) } : { ...json, annotations: (json.annotations || []).map(f) };
}
