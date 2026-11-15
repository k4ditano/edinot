// Mapa mental del canvas (lógica pura, sin React).
//
// Un mapa mental es un árbol de nodos unidos por aristas manuales padre→hijo. La
// raíz lleva `mindmap: true`; mientras esté marcada, cada cambio estructural (hijo
// nuevo, hermano, plegar, re-padre, reordenar) recoloca SOLO ese árbol alrededor de
// la raíz, que no se mueve. Las ramas del primer nivel se reparten a derecha e
// izquierda (`mmSide` se guarda en el hijo para que no salten al añadir hermanos).
// Los hermanos se ordenan por su posición vertical actual: arrastrar un nodo arriba
// o abajo lo reordena.
//
//   collapsed: true   el nodo oculta todos sus descendientes (y sus aristas)
//   mmSide: 'r'|'l'   lado de la rama (sólo en hijos directos de la raíz)

export const MM_HGAP = 70;     // hueco horizontal entre padre e hijo
export const MM_VGAP = 22;     // hueco vertical entre hermanos

const DEF_W = 240, DEF_H = 140;
const W = (n) => n.w || DEF_W;
const H = (n) => n.h || DEF_H;

// Estructura del árbol a partir de las aristas manuales entre nodos (primer padre gana; sin ciclos).
export function treeIndex(json) {
  const nodes = json.nodes || [];
  const ids = new Set(nodes.map(n => n.id));
  const parentOf = new Map(), childrenOf = new Map();
  for (const n of nodes) childrenOf.set(n.id, []);
  for (const e of (json.edges || [])) {
    if ((e.kind || 'manual') !== 'manual' || !e.from || !e.to || e.from === e.to) continue;
    if (!ids.has(e.from) || !ids.has(e.to) || parentOf.has(e.to)) continue;
    // evitar ciclos: e.from no puede descender de e.to
    let p = e.from, cyc = false;
    for (let i = 0; p && i < 10000; i++) { if (p === e.to) { cyc = true; break; } p = parentOf.get(p); }
    if (cyc) continue;
    parentOf.set(e.to, e.from);
    childrenOf.get(e.from).push(e.to);
  }
  return { parentOf, childrenOf };
}

export function rootOf(id, parentOf) {
  let cur = id;
  for (let i = 0; i < 10000; i++) { const p = parentOf.get(cur); if (!p) return cur; cur = p; }
  return cur;
}

export function descendantsOf(id, childrenOf) {
  const out = [], stack = [...(childrenOf.get(id) || [])];
  while (stack.length) { const c = stack.pop(); out.push(c); for (const k of childrenOf.get(c) || []) stack.push(k); }
  return out;
}

// Nodos ocultos por ramas plegadas.
export function hiddenByCollapse(json) {
  const nodes = json.nodes || [];
  if (!nodes.some(n => n.collapsed)) return new Set();
  const { childrenOf } = treeIndex(json);
  const hidden = new Set();
  for (const n of nodes) if (n.collapsed) for (const d of descendantsOf(n.id, childrenOf)) hidden.add(d);
  return hidden;
}

// ¿Es `id` raíz (o parte) de un mapa mental marcado? Devuelve el id de la raíz marcada o null.
export function markedRoot(json, id) {
  const { parentOf } = treeIndex(json);
  const r = rootOf(id, parentOf);
  const rn = (json.nodes || []).find(n => n.id === r);
  return rn && rn.mindmap ? r : null;
}

// Recoloca el árbol de `rootId`. Devuelve un json nuevo (las aristas del árbol también
// se anclan: derecha→izquierda según el lado de cada rama).
export function layoutMindmap(json, rootId) {
  const nodes = json.nodes || [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const root = byId.get(rootId);
  if (!root) return json;
  const { childrenOf } = treeIndex(json);
  const collapsedSet = new Set(nodes.filter(n => n.collapsed).map(n => n.id));
  const pos = new Map();               // id -> {x,y}
  const sideOf = new Map();            // id -> 1 | -1
  const patch = new Map();             // id -> campos extra (mmSide)

  const kidsOf = (id) => {
    if (collapsedSet.has(id)) return [];
    // hermanos ordenados por su y actual (estable): arrastrar arriba/abajo reordena
    return (childrenOf.get(id) || []).map((k, i) => ({ k, i, y: (byId.get(k).y || 0) })).sort((a, b) => a.y - b.y || a.i - b.i).map(o => o.k);
  };
  const memo = new Map();
  const heightOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    const n = byId.get(id), ks = kidsOf(id);
    const h = ks.length ? Math.max(H(n), ks.reduce((s, k) => s + heightOf(k), 0) + MM_VGAP * (ks.length - 1)) : H(n);
    memo.set(id, h); return h;
  };
  // Coloca `id` con su bloque de altura heightOf(id) empezando en yTop; devuelve el centro y del nodo.
  const place = (id, x, yTop, dir) => {
    const n = byId.get(id), ks = kidsOf(id);
    let cy;
    if (!ks.length) cy = yTop + heightOf(id) / 2;
    else {
      let cur = yTop + (heightOf(id) - (ks.reduce((s, k) => s + heightOf(k), 0) + MM_VGAP * (ks.length - 1))) / 2;
      const centers = [];
      for (const k of ks) {
        const kn = byId.get(k);
        const kx = dir === 1 ? x + W(n) + MM_HGAP : x - MM_HGAP - W(kn);
        centers.push(place(k, kx, cur, dir));
        cur += heightOf(k) + MM_VGAP;
      }
      cy = (centers[0] + centers[centers.length - 1]) / 2;
    }
    pos.set(id, { x, y: cy - H(n) / 2 });
    sideOf.set(id, dir);
    return cy;
  };

  // Raíz fija; ramas del primer nivel a derecha/izquierda (se respeta mmSide, el resto se reparte).
  const first = kidsOf(rootId);
  const rightIds = [], leftIds = [];
  for (const k of first) {
    const s = byId.get(k).mmSide;
    if (s === 'l') leftIds.push(k); else if (s === 'r') rightIds.push(k);
    else if (rightIds.length <= leftIds.length) { rightIds.push(k); patch.set(k, { mmSide: 'r' }); }
    else { leftIds.push(k); patch.set(k, { mmSide: 'l' }); }
  }
  const rcx = (root.x || 0), rcy = (root.y || 0) + H(root) / 2;
  pos.set(rootId, { x: root.x || 0, y: root.y || 0 });
  sideOf.set(rootId, 1);
  const block = (ids) => ids.reduce((s, k) => s + heightOf(k), 0) + MM_VGAP * Math.max(0, ids.length - 1);
  for (const [ids, dir] of [[rightIds, 1], [leftIds, -1]]) {
    if (!ids.length) continue;
    let cur = rcy - block(ids) / 2;
    for (const k of ids) {
      const kn = byId.get(k);
      const kx = dir === 1 ? rcx + W(root) + MM_HGAP : rcx - MM_HGAP - W(kn);
      place(k, kx, cur, dir);
      cur += heightOf(k) + MM_VGAP;
    }
  }
  const inTree = new Set(pos.keys());
  const outNodes = nodes.map(n => {
    if (!inTree.has(n.id)) return n;
    const p = pos.get(n.id), extra = patch.get(n.id);
    const nx = Math.round(p.x), ny = Math.round(p.y);
    if (nx === (n.x || 0) && ny === (n.y || 0) && !extra) return n;
    return { ...n, x: nx, y: ny, ...(extra || {}) };
  });
  const outEdges = (json.edges || []).map(e => {
    if ((e.kind || 'manual') !== 'manual' || !inTree.has(e.from) || !inTree.has(e.to)) return e;
    if (!(childrenOf.get(e.from) || []).includes(e.to)) return e;
    const d = sideOf.get(e.to) || 1;
    const fromSide = d === 1 ? 'r' : 'l', toSide = d === 1 ? 'l' : 'r';
    return e.fromSide === fromSide && e.toSide === toSide ? e : { ...e, fromSide, toSide };
  });
  return { ...json, nodes: outNodes, edges: outEdges };
}

// Añade un hijo al nodo `parentId` (ya creado en json.nodes por el llamador) o, mejor, lo inserta:
// marca la raíz como mapa mental y recoloca. `newNode` y `edge` se añaden aquí.
export function addChild(json, parentId, newNode, edge) {
  const nodes = [...(json.nodes || []), newNode];
  const edges = [...(json.edges || []), edge];
  let j = { ...json, nodes, edges };
  const { parentOf, childrenOf } = treeIndex(j);
  const r = rootOf(parentId, parentOf);
  // el hijo nuevo va el último entre sus hermanos
  const sibs = (childrenOf.get(parentId) || []).filter(k => k !== newNode.id).map(k => (j.nodes.find(n => n.id === k) || {}).y || 0);
  if (sibs.length) j = { ...j, nodes: j.nodes.map(n => n.id === newNode.id ? { ...n, y: Math.max(...sibs) + 1 } : n) };
  j = { ...j, nodes: j.nodes.map(n => n.id === r && !n.mindmap ? { ...n, mindmap: true } : n) };
  return layoutMindmap(j, r);
}

// Cambia el padre de `nodeId` a `newParentId` (rechaza ciclos). Devuelve el json nuevo o null.
export function reparent(json, nodeId, newParentId, newEdgeId) {
  if (nodeId === newParentId) return null;
  const { parentOf, childrenOf } = treeIndex(json);
  if (descendantsOf(nodeId, childrenOf).includes(newParentId)) return null;     // no sobre un descendiente
  const rootBefore = rootOf(nodeId, parentOf);
  const edges = (json.edges || []).filter(e => !((e.kind || 'manual') === 'manual' && e.to === nodeId && e.from === parentOf.get(nodeId) && parentOf.has(nodeId)));
  edges.push({ id: newEdgeId || ('e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)), from: newParentId, to: nodeId, kind: 'manual' });
  let j = { ...json, edges, nodes: (json.nodes || []).map(n => n.id === nodeId ? { ...n, mmSide: undefined } : n) };
  j.nodes = j.nodes.map(n => { if (n.id === nodeId) { const { mmSide, ...rest } = n; return rest; } return n; });
  const t = treeIndex(j);
  const r = rootOf(newParentId, t.parentOf);
  j = { ...j, nodes: j.nodes.map(n => n.id === r && !n.mindmap ? { ...n, mindmap: true } : n) };
  let out = layoutMindmap(j, r);
  if (rootBefore !== r && rootBefore !== nodeId) {   // el árbol de origen también se recoloca
    const rn = out.nodes.find(n => n.id === rootBefore);
    if (rn && rn.mindmap) out = layoutMindmap(out, rootBefore);
  }
  return out;
}
