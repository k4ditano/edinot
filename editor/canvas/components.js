// Componentes (como en Figma), lógica pura.
//
// Un componente es un conjunto de piezas (fichas y/o dibujos) marcadas como «principal»:
//   cmain: '<id del componente>', cname: 'Botón', grp: '<grupo>'          (en cada pieza del principal)
// Una instancia es una copia enlazada:
//   cinst: '<id del componente>', cref: '<id de la pieza del principal que copia>', grp: '<grupo propio>'
// Al cambiar el principal, `syncInstances` rehace cada instancia con las propiedades del principal, en su sitio, y
// conservando su propio texto (cada botón puede decir algo distinto). «Desvincular» la convierte en piezas normales.

const POS_N = ['x', 'y'];
const OWN = new Set(['id', 'grp', 'cmain', 'cname', 'cinst', 'cref', 'z', 'locked', 'hidden', 'link']);
const KEEP_TEXT = new Set(['text']);

const rnd = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const worldOf = (it, kind) => (kind === 'n' ? { x: it.x || 0, y: it.y || 0 } : { x: (it.bbox ? it.bbox.x : (it.x || 0)) + (it.ox || 0), y: (it.bbox ? it.bbox.y : (it.y || 0)) + (it.oy || 0) });

/** Componentes que hay en el canvas: [{ id, name, nodes:[ids], annos:[ids] }]. */
export function listComponents(json) {
  const map = new Map();
  for (const [kind, arr] of [['n', json.nodes || []], ['a', json.annotations || []]]) {
    for (const it of arr) {
      if (!it.cmain) continue;
      let c = map.get(it.cmain);
      if (!c) { c = { id: it.cmain, name: it.cname || 'Componente', nodes: [], annos: [] }; map.set(it.cmain, c); }
      (kind === 'n' ? c.nodes : c.annos).push(it.id);
      if (it.cname) c.name = it.cname;
    }
  }
  return [...map.values()];
}

/** Marca la selección como componente principal. */
export function createComponent(json, nodeIds, annoIds, name) {
  const cid = 'cmp' + rnd(), g = 'lg' + rnd();
  const N = new Set(nodeIds), A = new Set(annoIds);
  if (!N.size && !A.size) return { json, id: null };
  const tag = (it) => ({ ...it, cmain: cid, cname: name, grp: g });
  return {
    id: cid,
    json: { ...json, nodes: (json.nodes || []).map(n => (N.has(n.id) ? tag(n) : n)), annotations: (json.annotations || []).map(a => (A.has(a.id) ? tag(a) : a)) },
  };
}

/** Pone una instancia del componente `cid` con su esquina en (x, y) (o junto al principal). */
export function insertInstance(json, cid, at, newId = (p) => p + rnd()) {
  const c = listComponents(json).find(x => x.id === cid);
  if (!c) return { json, ids: null };
  const mainN = (json.nodes || []).filter(n => n.cmain === cid), mainA = (json.annotations || []).filter(a => a.cmain === cid);
  const pts = [...mainN.map(n => worldOf(n, 'n')), ...mainA.map(a => worldOf(a, 'a'))];
  const ox = Math.min(...pts.map(p => p.x)), oy = Math.min(...pts.map(p => p.y));
  const boxes = [...mainN.map(n => ({ x: n.x || 0, w: n.w || 0 })), ...mainA.map(a => ({ x: worldOf(a, 'a').x, w: (a.bbox && a.bbox.w) || 0 }))];
  const right = Math.max(...boxes.map(b => b.x + b.w));
  const target = at || { x: right + 40, y: oy };
  const dx = target.x - ox, dy = target.y - oy;
  const g = 'lg' + rnd();
  const strip = (it) => { const r = { ...it }; delete r.cmain; delete r.cname; delete r.z; delete r.link; return r; };
  // Orden de apilado: la instancia va encima de todo, con sus piezas en el mismo orden que en el principal.
  const effN = (n, i) => (n.z != null ? n.z : i), effA = (x, i) => (typeof x.z === 'number' ? x.z : (x.layer === 'back' ? -1e9 + i : 1e9 + i));
  const allZ = [...(json.nodes || []).map(effN), ...(json.annotations || []).map(effA)];
  const base = Math.ceil(Math.max(0, ...allZ)) + 1;
  const rankOf = new Map([...(json.nodes || []).map((n, i) => ['n' + n.id, effN(n, i)]), ...(json.annotations || []).map((x, i) => ['a' + x.id, effA(x, i)])]);
  const order = [...mainN.map(n => 'n' + n.id), ...mainA.map(x => 'a' + x.id)].sort((p, q) => rankOf.get(p) - rankOf.get(q));
  const zFor = (key) => base + order.indexOf(key);
  const nodes = mainN.map(n => ({ ...strip(n), id: newId('n'), x: (n.x || 0) + dx, y: (n.y || 0) + dy, grp: g, cinst: cid, cref: n.id, z: zFor('n' + n.id) }));
  const annos = mainA.map(a => ({ ...strip(a), id: newId('ann'), ox: (a.ox || 0) + dx, oy: (a.oy || 0) + dy, grp: g, cinst: cid, cref: a.id, z: zFor('a' + a.id) }));
  return {
    json: { ...json, nodes: [...(json.nodes || []), ...nodes], annotations: [...(json.annotations || []), ...annos] },
    ids: { nodes: nodes.map(n => n.id), annos: annos.map(a => a.id), grp: g },
  };
}

/** Rehace las instancias a partir de su principal. Devuelve el mismo objeto si ya están al día. */
export function syncInstances(json) {
  const nodes = json.nodes || [], annos = json.annotations || [];
  if (!nodes.some(n => n.cinst) && !annos.some(a => a.cinst)) return json;
  const mainById = new Map([...nodes.filter(n => n.cmain).map(n => [n.id, { it: n, kind: 'n' }]), ...annos.filter(a => a.cmain).map(a => [a.id, { it: a, kind: 'a' }])]);
  // Desplazamiento de cada instancia (por grupo): el de su primera pieza respecto a la del principal.
  const delta = new Map();
  for (const [kind, arr] of [['n', nodes], ['a', annos]]) {
    for (const it of arr) {
      if (!it.cinst || delta.has(it.grp)) continue;
      const m = mainById.get(it.cref);
      if (!m) continue;
      const w = worldOf(it, kind), mw = worldOf(m.it, m.kind);
      delta.set(it.grp, { x: w.x - mw.x, y: w.y - mw.y });
    }
  }
  let changed = false;
  const rebuild = (it, kind) => {
    if (!it.cinst) return it;
    const m = mainById.get(it.cref);
    const d = delta.get(it.grp);
    if (!m || !d) return it;
    const next = {};
    for (const [k, v] of Object.entries(m.it)) if (!OWN.has(k)) next[k] = v;
    for (const k of OWN) if (it[k] !== undefined && k !== 'cmain' && k !== 'cname') next[k] = it[k];
    for (const k of KEEP_TEXT) if (it[k] !== undefined) next[k] = it[k];
    if (kind === 'n') { next.x = (m.it.x || 0) + d.x; next.y = (m.it.y || 0) + d.y; }
    else { next.ox = (m.it.ox || 0) + d.x; next.oy = (m.it.oy || 0) + d.y; }
    const round = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));
    const keys = (o) => Object.keys(o).sort();
    if (round(Object.fromEntries(keys(next).map(k => [k, next[k]]))) === round(Object.fromEntries(keys(it).map(k => [k, it[k]])))) return it;
    changed = true;
    return next;
  };
  const n2 = nodes.map(n => rebuild(n, 'n')), a2 = annos.map(a => rebuild(a, 'a'));
  return changed ? { ...json, nodes: n2, annotations: a2 } : json;
}

/** Convierte instancias en piezas normales (siguen agrupadas). */
export function detachInstances(json, nodeIds, annoIds) {
  const N = new Set(nodeIds), A = new Set(annoIds);
  const grps = new Set([...(json.nodes || []).filter(n => N.has(n.id) && n.cinst).map(n => n.grp), ...(json.annotations || []).filter(a => A.has(a.id) && a.cinst).map(a => a.grp)]);
  const strip = (it) => { if (!it.cinst || !grps.has(it.grp)) return it; const { cinst, cref, ...r } = it; return r; };
  return { ...json, nodes: (json.nodes || []).map(strip), annotations: (json.annotations || []).map(strip) };
}

export const POSITION_KEYS = POS_N;
