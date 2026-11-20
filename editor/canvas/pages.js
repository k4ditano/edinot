// Páginas de un canvas (como las de Figma): varias hojas dentro de la misma nota. Lógica pura.
//
//   json.vars.pages = [{ id, name }]     (sin páginas: hay una sola, implícita)
//   cada pieza (ficha, dibujo, marco) lleva `page` = id de su página; sin `page`, es de la primera.
// La app pinta solo la página actual; lo nuevo que se crea en ella se queda en ella.

export const pagesOf = (json) => (json && json.vars && Array.isArray(json.vars.pages) ? json.vars.pages : []);

/** Página de una pieza (la primera si no tiene o si la suya ya no existe). */
export function pageOf(it, pages) {
  if (!pages.length) return null;
  return it.page && pages.some(p => p.id === it.page) ? it.page : pages[0].id;
}

/** El canvas con solo lo de la página `pageId` (las flechas, si sus dos extremos se ven). */
export function filterPage(json, pageId) {
  const pages = pagesOf(json);
  if (pages.length < 2 || !pageId) return json;
  const on = (it) => pageOf(it, pages) === pageId;
  const nodes = (json.nodes || []).filter(on);
  const ids = new Set(nodes.map(n => n.id));
  return {
    ...json,
    nodes,
    annotations: (json.annotations || []).filter(on),
    groups: (json.groups || []).filter(on),
    edges: (json.edges || []).filter(e => ids.has(e.from) && ids.has(e.to)),
  };
}

/** Lo que aparece en `next` y no estaba en `prev` (y no dice su página) va a `pageId`. */
export function tagNew(prev, next, pageId) {
  const pages = pagesOf(next);
  if (pages.length < 2 || !pageId || pageId === pages[0].id || next === prev) return next;
  const had = (list) => new Set((list || []).map(x => x.id));
  const hn = had(prev.nodes), ha = had(prev.annotations), hg = had(prev.groups);
  let changed = false;
  const tag = (seen) => (it) => { if (seen.has(it.id) || it.page) return it; changed = true; return { ...it, page: pageId }; };
  const out = { ...next, nodes: (next.nodes || []).map(tag(hn)), annotations: (next.annotations || []).map(tag(ha)), groups: (next.groups || []).map(tag(hg)) };
  return changed ? out : next;
}

/** Añade una página (y crea la primera, con todo lo que ya había, si aún no hay ninguna). */
export function addPage(json, name, newId = () => 'pg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), firstName = 'Página 1') {
  let pages = pagesOf(json).slice();
  if (!pages.length) pages = [{ id: newId(), name: firstName }];
  const id = newId();
  pages.push({ id, name });
  return { json: { ...json, vars: { ...(json.vars || {}), pages } }, id };
}

export function renamePage(json, id, name) {
  return { ...json, vars: { ...(json.vars || {}), pages: pagesOf(json).map(p => (p.id === id ? { ...p, name } : p)) } };
}

/** Borra una página y lo que hay en ella (la primera no se puede borrar si es la única). */
export function removePage(json, id) {
  const pages = pagesOf(json);
  if (pages.length < 2) return json;
  const first = pages[0].id;
  const gone = (it) => pageOf(it, pages) === id;
  const left = pages.filter(p => p.id !== id);
  const nodes = (json.nodes || []).filter(n => !gone(n));
  const ids = new Set(nodes.map(n => n.id));
  // Si se borra la primera, la siguiente pasa a ser la primera: sus piezas ya no necesitan `page`.
  const promote = (it) => (id === first && it.page === left[0].id ? (({ page, ...r }) => r)(it) : it);
  return {
    ...json,
    vars: { ...(json.vars || {}), pages: left },
    nodes: nodes.map(promote),
    annotations: (json.annotations || []).filter(a => !gone(a)).map(promote),
    groups: (json.groups || []).filter(g => !gone(g)).map(promote),
    edges: (json.edges || []).filter(e => ids.has(e.from) && ids.has(e.to)),
  };
}

/** Mueve piezas a otra página (las de su grupo van con ellas). */
export function moveToPage(json, { nodes = [], annos = [], groups = [] }, pageId) {
  const pages = pagesOf(json);
  if (!pages.some(p => p.id === pageId)) return json;
  const first = pages[0].id;
  const grps = new Set([...(json.nodes || []).filter(n => nodes.includes(n.id)), ...(json.annotations || []).filter(a => annos.includes(a.id))].map(x => x.grp).filter(Boolean));
  const set = (it) => { const r = { ...it }; if (pageId === first) delete r.page; else r.page = pageId; return r; };
  const pick = (ids) => (it) => (ids.includes(it.id) || (it.grp && grps.has(it.grp)) ? set(it) : it);
  return { ...json, nodes: (json.nodes || []).map(pick(nodes)), annotations: (json.annotations || []).map(pick(annos)), groups: (json.groups || []).map(pick(groups)) };
}
