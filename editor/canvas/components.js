// Componentes (como en Figma), lógica pura.
//
// Un componente es un conjunto de piezas (fichas y/o dibujos) marcadas como «principal»:
//   cmain: '<id del componente>', cname: 'Botón', grp: '<grupo>'          (en cada pieza del principal)
// Una instancia es una copia enlazada:
//   cinst: '<id del componente>', cref: '<id de la pieza del principal que copia>', grp: '<grupo propio>'
// Al cambiar el principal, `syncInstances` rehace cada instancia con las propiedades del principal, en su sitio, y
// conservando su propio texto (cada botón puede decir algo distinto). «Desvincular» la convierte en piezas normales.
//
// Instancias anidadas: un componente puede llevar dentro instancias de otro (una «Tarjeta» con un «Botón»). Esas
// piezas son a la vez del principal de fuera (`cmain`, `grp` del principal) e instancia del de dentro (`cinst`,
// `cref`), y su grupo de instancia va en `igrp`. Al cambiar el «Botón», se rehace el de dentro de la «Tarjeta» y, en
// la siguiente vuelta, cada instancia de la «Tarjeta»: el cambio llega hasta el final.

const POS_N = ['x', 'y'];
const OWN = new Set(['id', 'grp', 'igrp', 'cmain', 'cname', 'cinst', 'cref', 'clib', 'z', 'locked', 'hidden', 'link']);
/** Grupo de instancia de una pieza (el propio si está anidada dentro de un principal). */
export const instKey = (it) => it.igrp || it.grp;
const KEEP_TEXT = new Set(['text']);

const rnd = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const worldOf = (it, kind) => (kind === 'n' ? { x: it.x || 0, y: it.y || 0 } : { x: (it.bbox ? it.bbox.x : (it.x || 0)) + (it.ox || 0), y: (it.bbox ? it.bbox.y : (it.y || 0)) + (it.oy || 0) });

// Lo que el principal tenía al copiar (para distinguir luego las anulaciones de la instancia).
function baseOf(m, kind) {
  const r = {};
  for (const [k, v] of Object.entries(m)) {
    if (OWN.has(k) || k === 'cbase' || k === 'cprop' || (kind === 'n' ? (k === 'x' || k === 'y') : (k === 'ox' || k === 'oy'))) continue;
    r[k] = v;
  }
  return r;
}

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
  // Las instancias que quedan dentro pasan a ser instancias anidadas: su grupo de instancia se guarda en `igrp`.
  const tag = (it) => { const r = { ...it, cmain: cid, cname: name, grp: g, ...(it.cinst ? { igrp: instKey(it) } : {}) }; if (it.cinst) { delete r.cset; delete r.cvariant; } return r; };
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
  const strip = (it) => { const r = { ...it }; delete r.cmain; delete r.cname; delete r.z; delete r.link; delete r.igrp; return r; };
  // Orden de apilado: la instancia va encima de todo, con sus piezas en el mismo orden que en el principal.
  const effN = (n, i) => (n.z != null ? n.z : i), effA = (x, i) => (typeof x.z === 'number' ? x.z : (x.layer === 'back' ? -1e9 + i : 1e9 + i));
  const allZ = [...(json.nodes || []).map(effN), ...(json.annotations || []).map(effA)];
  const base = Math.ceil(Math.max(0, ...allZ)) + 1;
  const rankOf = new Map([...(json.nodes || []).map((n, i) => ['n' + n.id, effN(n, i)]), ...(json.annotations || []).map((x, i) => ['a' + x.id, effA(x, i)])]);
  const order = [...mainN.map(n => 'n' + n.id), ...mainA.map(x => 'a' + x.id)].sort((p, q) => rankOf.get(p) - rankOf.get(q));
  const zFor = (key) => base + order.indexOf(key);
  const nodes = mainN.map(n => ({ ...strip(n), id: newId('n'), x: (n.x || 0) + dx, y: (n.y || 0) + dy, grp: g, cinst: cid, cref: n.id, z: zFor('n' + n.id), cbase: baseOf(n, 'n') }));
  const annos = mainA.map(a => ({ ...strip(a), id: newId('ann'), ox: (a.ox || 0) + dx, oy: (a.oy || 0) + dy, grp: g, cinst: cid, cref: a.id, z: zFor('a' + a.id), cbase: baseOf(a, 'a') }));
  return {
    json: { ...json, nodes: [...(json.nodes || []), ...nodes], annotations: [...(json.annotations || []), ...annos] },
    ids: { nodes: nodes.map(n => n.id), annos: annos.map(a => a.id), grp: g },
  };
}

/** Rehace las instancias a partir de su principal (de dentro afuera, para las anidadas). El mismo objeto si ya están al día. */
export function syncInstances(json, library = null) {
  let j = json;
  for (let pass = 0; pass < 6; pass++) {
    const next = syncOnce(j, library);
    if (next === j) break;
    j = next;
  }
  return j;
}

function syncOnce(json, library) {
  const nodes = json.nodes || [], annos = json.annotations || [];
  if (!nodes.some(n => n.cinst) && !annos.some(a => a.cinst)) return json;
  const mainById = new Map([...nodes.filter(n => n.cmain).map(n => [n.id, { it: n, kind: 'n' }]), ...annos.filter(a => a.cmain).map(a => [a.id, { it: a, kind: 'a' }])]);
  // Las instancias de la biblioteca siguen a su entrada publicada (aunque el principal esté en otro canvas).
  if (library) for (const m of libraryMains(library)) if (!mainById.has(m.it.id)) mainById.set(m.it.id, m);
  // Desplazamiento de cada instancia (por grupo): esquina de sus piezas respecto a la de las piezas del principal
  // que copian. Por la caja de todas (no por «la primera»), así no se descoloca si el orden o el número cambian.
  const acc = new Map();
  for (const [kind, arr] of [['n', nodes], ['a', annos]]) {
    for (const it of arr) {
      if (!it.cinst) continue;
      const m = mainById.get(it.cref);
      if (!m) continue;
      const w = worldOf(it, kind), mw = worldOf(m.it, m.kind);
      const a = acc.get(instKey(it)) || { ix: Infinity, iy: Infinity, mx: Infinity, my: Infinity };
      a.ix = Math.min(a.ix, w.x); a.iy = Math.min(a.iy, w.y); a.mx = Math.min(a.mx, mw.x); a.my = Math.min(a.my, mw.y);
      acc.set(instKey(it), a);
    }
  }
  const delta = new Map([...acc].map(([g, a]) => [g, { x: a.ix - a.mx, y: a.iy - a.my }]));
  let changed = false;
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const rebuild = (it, kind) => {
    if (!it.cinst) return it;
    const m = mainById.get(it.cref);
    const d = delta.get(instKey(it));
    if (!m || !d) return it;
    // Anulaciones (como en Figma): lo que la instancia tiene distinto de lo que el principal tenía en la última
    // sincronización (`cbase`) es un cambio propio y se conserva; lo demás sigue al principal. Sin `cbase`
    // (instancias antiguas), lo que difiera del principal.
    // Las anidadas conservan su conjunto/variante (las del principal de fuera), no las del de dentro.
    const skip = (k) => OWN.has(k) || k === 'cbase' || k === 'cprop' || (it.igrp && (k === 'cset' || k === 'cvariant')) || (kind === 'n' ? (k === 'x' || k === 'y') : (k === 'ox' || k === 'oy'));
    const keysAll = new Set([...Object.keys(m.it), ...Object.keys(it), ...Object.keys(it.cbase || {})].filter(k => !skip(k)));
    const next = {};
    const base = {};
    for (const k of keysAll) {
      const mv = m.it[k];
      // Sin cbase (instancias de antes): estaban siempre sincronizadas, así que lo que difiera del principal es propio.
      const overridden = it.cbase ? !same(it[k], it.cbase[k]) : it[k] !== undefined && !same(it[k], mv);
      const v = overridden ? it[k] : mv;
      if (v !== undefined) next[k] = v;
      if (mv !== undefined) base[k] = mv;
    }
    // `cmain`/`cname` solo se quedan en las anidadas (son también piezas de un principal).
    for (const k of OWN) if (it[k] !== undefined && ((k !== 'cmain' && k !== 'cname') || it.igrp)) next[k] = it[k];
    next.cbase = base;
    if (it.igrp) for (const k of ['cset', 'cvariant', 'cprop']) if (it[k] !== undefined) next[k] = it[k];
    if (kind === 'n') { next.x = (m.it.x || 0) + d.x; next.y = (m.it.y || 0) + d.y; }
    else { next.ox = (m.it.ox || 0) + d.x; next.oy = (m.it.oy || 0) + d.y; }
    const round = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));
    const keys = (o) => Object.keys(o).sort();
    if (round(Object.fromEntries(keys(next).map(k => [k, next[k]]))) === round(Object.fromEntries(keys(it).map(k => [k, it[k]])))) return it;
    changed = true;
    return next;
  };
  let n2 = nodes.map(n => rebuild(n, 'n')), a2 = annos.map(a => rebuild(a, 'a'));
  // Orden de apilado: dentro de cada instancia, las piezas se apilan como en su principal (sus mismos valores de z,
  // repartidos en el orden del principal), así «mandar atrás» el fondo del principal llega a todas las copias.
  const mz = (m) => (m.it.z != null ? m.it.z : (m.kind === 'a' ? (m.it.layer === 'back' ? -1e9 : 1e9) : 0));
  const groups = new Map();
  for (const [kind, arr] of [['n', n2], ['a', a2]]) arr.forEach((it, i) => {
    if (!it.cinst || it.z == null) return;
    const m = mainById.get(it.cref);
    if (!m) return;
    const k = instKey(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ kind, i, z: it.z, mz: mz(m) });
  });
  const zfix = { n: new Map(), a: new Map() };
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const zs = list.map(x => x.z).sort((p, q) => p - q);
    const byMain = [...list].sort((p, q) => p.mz - q.mz);
    byMain.forEach((x, r) => { if (x.z !== zs[r]) zfix[x.kind].set(x.i, zs[r]); });
  }
  if (zfix.n.size || zfix.a.size) {
    changed = true;
    n2 = n2.map((it, i) => (zfix.n.has(i) ? { ...it, z: zfix.n.get(i) } : it));
    a2 = a2.map((it, i) => (zfix.a.has(i) ? { ...it, z: zfix.a.get(i) } : it));
  }
  return changed ? { ...json, nodes: n2, annotations: a2 } : json;
}

/** Convierte instancias en piezas normales (siguen agrupadas). */
export function detachInstances(json, nodeIds, annoIds) {
  const N = new Set(nodeIds), A = new Set(annoIds);
  const grps = new Set([...(json.nodes || []).filter(n => N.has(n.id) && n.cinst).map(instKey), ...(json.annotations || []).filter(a => A.has(a.id) && a.cinst).map(instKey)]);
  const strip = (it) => { if (!it.cinst || !grps.has(instKey(it))) return it; const { cinst, cref, igrp, cbase, ...r } = it; return r; };
  return { ...json, nodes: (json.nodes || []).map(strip), annotations: (json.annotations || []).map(strip) };
}

export const POSITION_KEYS = POS_N;

// ── Variantes (como los «component sets» de Figma) ──────────────────────
// Varios componentes principales forman un conjunto con el mismo `cset`; cada uno es una variante (`cvariant`).
// Una instancia puede cambiar de variante: sus piezas pasan a copiar las de la otra variante, por orden, conservando
// su sitio y sus textos.

const mainItemsOf = (json, cid) => [
  ...(json.nodes || []).filter(n => n.cmain === cid).map(it => ({ kind: 'n', it })),
  ...(json.annotations || []).filter(a => a.cmain === cid).map(it => ({ kind: 'a', it })),
];

/** Variantes del conjunto al que pertenece el componente `cid`: [{ id, variant }]. */
export function variantsOf(json, cid) {
  const all = listComponentsFull(json);
  const me = all.find(c => c.id === cid);
  if (!me || !me.set) return me ? [{ id: me.id, variant: me.variant || me.name }] : [];
  return all.filter(c => c.set === me.set).map(c => ({ id: c.id, variant: c.variant || c.name }));
}

export function listComponentsFull(json) {
  const base = listComponents(json);
  return base.map(c => {
    const all = [...(json.nodes || []), ...(json.annotations || [])];
    const it = all.find(x => x.cmain === c.id && !x.igrp) || all.find(x => x.cmain === c.id) || {};
    return { ...c, set: it.cset || null, variant: it.cvariant || null };
  });
}

/** Crea una variante nueva del componente `cid` (copia de su principal, a la derecha). Devuelve { json, id }. */
export function addVariant(json, cid, variantName, newId = (p) => p + rnd()) {
  const items = mainItemsOf(json, cid);
  if (!items.length) return { json, id: null };
  const first = items[0].it;
  const set = first.cset || first.cname || 'Componente';
  const nid = 'cmp' + rnd(), g = 'lg' + rnd();
  const boxes = items.map(({ kind, it }) => (kind === 'n' ? { x: it.x || 0, w: it.w || 0 } : { x: worldOf(it, 'a').x, w: (it.bbox && it.bbox.w) || 0 }));
  const dx = Math.max(...boxes.map(b => b.x + b.w)) - Math.min(...boxes.map(b => b.x)) + 40;
  const tagSet = (it) => (it.cmain === cid ? { ...it, cset: set, cvariant: it.cvariant || 'Predeterminada' } : it);
  const copy = (it, kind) => {
    const r = { ...it, id: newId(kind === 'n' ? 'n' : 'ann'), cmain: nid, cset: set, cvariant: variantName, grp: g };
    if (kind === 'n') r.x = (it.x || 0) + dx; else r.ox = (it.ox || 0) + dx;
    delete r.link;
    return r;
  };
  const nodes = (json.nodes || []).map(tagSet), annos = (json.annotations || []).map(tagSet);
  return {
    id: nid,
    json: {
      ...json,
      nodes: [...nodes, ...items.filter(x => x.kind === 'n').map(x => copy(x.it, 'n'))],
      annotations: [...annos, ...items.filter(x => x.kind === 'a').map(x => copy(x.it, 'a'))],
    },
  };
}

/** Cambia de variante la instancia cuyo grupo es `grp`. Después hay que llamar a syncInstances. */
export function switchVariant(json, grp, targetCid, newId = (p) => p + rnd()) {
  const inst = [
    ...(json.nodes || []).filter(n => instKey(n) === grp && n.cinst).map(it => ({ kind: 'n', it })),
    ...(json.annotations || []).filter(a => instKey(a) === grp && a.cinst).map(it => ({ kind: 'a', it })),
  ];
  if (!inst.length) return json;
  const cur = inst[0].it.cinst;
  const outer = inst[0].it.igrp ? { grp: inst[0].it.grp, cmain: inst[0].it.cmain, cname: inst[0].it.cname } : null;
  const curMain = mainItemsOf(json, cur), target = mainItemsOf(json, targetCid);
  if (!target.length || cur === targetCid) return json;
  const pos = (ref) => curMain.findIndex(m => m.it.id === ref);
  inst.sort((p, q) => pos(p.it.cref) - pos(q.it.cref));
  // Desplazamiento de la instancia respecto a su principal actual (para dejarla en su sitio).
  // Ancla: la esquina de la instancia y la de la variante destino (por la caja de todas sus piezas).
  const minOf = (arr) => arr.reduce((o, x) => { const p = worldOf(x.it, x.kind); return { x: Math.min(o.x, p.x), y: Math.min(o.y, p.y) }; }, { x: Infinity, y: Infinity });
  const w = minOf(inst);
  const t0 = minOf(target);
  const texts = inst.map(x => x.it.text).filter(v => typeof v === 'string');
  let ti = 0;
  const keepIds = new Map();
  target.forEach((tm, i) => { const old = inst[i] && inst[i].kind === tm.kind ? inst[i] : null; keepIds.set(tm.it.id, old ? old.it.id : newId(tm.kind === 'n' ? 'n' : 'ann')); });
  const z0 = Math.min(...inst.map(x => (x.it.z != null ? x.it.z : 0)));
  // Mismo orden de apilado que en la variante destino (el texto encima del fondo).
  const zKey = (tm, i) => (tm.it.z != null ? tm.it.z : (tm.kind === 'a' ? (tm.it.layer === 'back' ? -1e9 : 1e9) : 0) + i);
  const rank = new Map(target.map((tm, i) => [tm.it.id, zKey(tm, i)]).sort((a, b) => a[1] - b[1]).map(([id], r) => [id, r]));
  const build = (tm, i) => {
    const it = { ...tm.it };
    for (const k of ['cmain', 'cname', 'cset', 'cvariant', 'link']) delete it[k];
    it.id = keepIds.get(tm.it.id); it.cinst = targetCid;
    // Anidada (dentro de un principal): sigue siendo pieza de ese principal; su grupo de instancia va en `igrp`.
    if (outer) { it.grp = outer.grp; it.igrp = grp; it.cmain = outer.cmain; it.cname = outer.cname; } else it.grp = grp; it.cref = tm.it.id; it.z = z0 + rank.get(tm.it.id);
    // Lo propio de la pieza de la instancia (interacciones del prototipo, enlace) se queda con ella.
    const old = inst[i] && inst[i].kind === tm.kind ? inst[i].it : null;
    if (old) for (const k of ['interactions', 'link', 'linkMode', 'linkAnim', 'name']) if (old[k] !== undefined) it[k] = old[k];
    it.cbase = baseOf(tm.it, tm.kind);
    if (typeof it.text === 'string' && ti < texts.length) it.text = texts[ti++];
    // misma posición relativa que en el principal destino, colocada donde estaba la instancia
    if (tm.kind === 'n') { it.x = (tm.it.x || 0) - t0.x + w.x; it.y = (tm.it.y || 0) - t0.y + w.y; }
    else { it.ox = (tm.it.ox || 0) - t0.x + w.x; it.oy = (tm.it.oy || 0) - t0.y + w.y; }
    return { kind: tm.kind, it };
  };
  const built = target.map(build);
  const drop = new Set(inst.map(x => x.it.id));
  return {
    ...json,
    nodes: [...(json.nodes || []).filter(n => !drop.has(n.id)), ...built.filter(b => b.kind === 'n').map(b => b.it)],
    annotations: [...(json.annotations || []).filter(a => !drop.has(a.id)), ...built.filter(b => b.kind === 'a').map(b => b.it)],
  };
}

// ── Biblioteca compartida (componentes que se usan en cualquier canvas) ─
// Vive en los datos comunes del espacio de trabajo: [{ id, name, nodes: [...], annos: [...], updatedAt }], con las
// piezas del principal llevadas al origen (0, 0). Una instancia de la biblioteca lleva `clib: true`, `cinst` = id de
// la entrada y `cref` = id de la pieza; se rehace igual que las demás (syncInstances recibe la biblioteca).

export function libraryEntryFrom(json, cid) {
  const items = mainItemsOf(json, cid);
  if (!items.length) return null;
  const pts = items.map(({ kind, it }) => worldOf(it, kind));
  const ox = Math.min(...pts.map(p => p.x)), oy = Math.min(...pts.map(p => p.y));
  const clean = (it) => { const r = { ...it }; for (const k of ['grp', 'z', 'link', 'locked', 'hidden', 'cset', 'cvariant']) delete r[k]; return r; };
  return {
    id: cid,
    name: items[0].it.cname || 'Componente',
    nodes: items.filter(x => x.kind === 'n').map(x => ({ ...clean(x.it), x: (x.it.x || 0) - ox, y: (x.it.y || 0) - oy })),
    annos: items.filter(x => x.kind === 'a').map(x => ({ ...clean(x.it), ox: (x.it.ox || 0) - ox, oy: (x.it.oy || 0) - oy })),
    updatedAt: Date.now(),
  };
}

export function publishToLibrary(library, entry) {
  const list = Array.isArray(library) ? library.filter(e => e.id !== entry.id) : [];
  return [...list, entry];
}

export function insertFromLibrary(json, entry, at, newId = (p) => p + rnd()) {
  if (!entry) return { json, ids: null };
  const target = at || { x: 0, y: 0 };
  const g = 'lg' + rnd();
  const effN = (n, i) => (n.z != null ? n.z : i), effA = (x, i) => (typeof x.z === 'number' ? x.z : (x.layer === 'back' ? -1e9 + i : 1e9 + i));
  let z = Math.ceil(Math.max(0, ...(json.nodes || []).map(effN), ...(json.annotations || []).map(effA))) + 1;
  const strip = (it) => { const r = { ...it }; delete r.cmain; delete r.cname; return r; };
  const annos = (entry.annos || []).map(a => ({ ...strip(a), id: newId('ann'), ox: (a.ox || 0) + target.x, oy: (a.oy || 0) + target.y, grp: g, cinst: entry.id, cref: a.id, clib: true, z: z++, cbase: baseOf({ ...a, cmain: entry.id }, 'a') }));
  const nodes = (entry.nodes || []).map(n => ({ ...strip(n), id: newId('n'), x: (n.x || 0) + target.x, y: (n.y || 0) + target.y, grp: g, cinst: entry.id, cref: n.id, clib: true, z: z++, cbase: baseOf({ ...n, cmain: entry.id }, 'n') }));
  return { json: { ...json, nodes: [...(json.nodes || []), ...nodes], annotations: [...(json.annotations || []), ...annos] }, ids: { nodes: nodes.map(n => n.id), annos: annos.map(a => a.id), grp: g } };
}

/** Piezas de la biblioteca con la forma de un principal, para syncInstances. */
export function libraryMains(library) {
  const out = [];
  for (const e of Array.isArray(library) ? library : []) {
    for (const n of e.nodes || []) out.push({ it: { ...n, cmain: e.id }, kind: 'n' });
    for (const a of e.annos || []) out.push({ it: { ...a, cmain: e.id }, kind: 'a' });
  }
  return out;
}


/** «Restablecer anulaciones»: la instancia (grupo `grp`) vuelve a ser idéntica a su principal (salvo su sitio). */
export function resetOverrides(json, grp, library = null) {
  const strip = (it) => (instKey(it) === grp && it.cinst ? (({ cbase, text, ...r }) => ({ ...r, cbase: {} }))(it) : it);
  const j = { ...json, nodes: (json.nodes || []).map(strip), annotations: (json.annotations || []).map(strip) };
  // Con cbase vacío, todo lo que la instancia tenga distinto contaría como anulación: se vacía también eso.
  const mains = new Map([...(json.nodes || []), ...(json.annotations || [])].filter(x => x.cmain).map(x => [x.id, x]));
  if (library) for (const m of libraryMains(library)) if (!mains.has(m.it.id)) mains.set(m.it.id, m.it);
  const clear = (it) => {
    if (instKey(it) !== grp || !it.cinst) return it;
    const m = mains.get(it.cref);
    if (!m) return it;
    const r = { ...it };
    for (const k of Object.keys(r)) if (!OWN.has(k) && !['x', 'y', 'ox', 'oy', 'cbase'].includes(k)) delete r[k];
    r.cbase = {};
    for (const [k, v] of Object.entries(m)) if (!OWN.has(k) && !['x', 'y', 'ox', 'oy', 'cprop'].includes(k)) { r[k] = v; r.cbase[k] = v; }
    return r;
  };
  return syncInstances({ ...j, nodes: j.nodes.map(clear), annotations: j.annotations.map(clear) }, library);
}

/** Propiedades declaradas del componente `cid`: piezas del principal con `cprop = { name, type: 'text'|'bool' }`. */
export function componentProps(json, cid, library = null) {
  const out = [];
  const add = (it) => { if (it.cmain === cid && it.cprop && it.cprop.name) out.push({ name: it.cprop.name, type: it.cprop.type || 'text', ref: it.id }); };
  for (const it of [...(json.nodes || []), ...(json.annotations || [])]) add(it);
  if (!out.length && library) for (const m of libraryMains(library)) add(m.it);
  return out;
}

/** Da a la instancia (grupo `grp`) el valor `value` en la propiedad `name` (texto o mostrar/ocultar). */
export function setInstanceProp(json, grp, name, value, library = null) {
  const inst = [...(json.nodes || []), ...(json.annotations || [])].find(x => instKey(x) === grp && x.cinst);
  if (!inst) return json;
  const prop = componentProps(json, inst.cinst, library).find(p => p.name.toLowerCase() === String(name).toLowerCase());
  if (!prop) return json;
  const apply = (it) => {
    if (instKey(it) !== grp || it.cref !== prop.ref) return it;
    if (prop.type === 'bool') { const r = { ...it }; if (value === false || value === 'false') r.hidden = true; else delete r.hidden; return r; }
    return { ...it, text: String(value) };
  };
  return { ...json, nodes: (json.nodes || []).map(apply), annotations: (json.annotations || []).map(apply) };
}
