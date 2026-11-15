// Colecciones: filtros guardados sobre las notas de un vault («Todas las notas»).
//
// Una colección es {id, name, icon?, rules, createdAt, updatedAt} y vive en el
// Y.Map `collections` del documento de cada vault (se sincroniza como el resto
// y el MCP la lee con `list_collections`). Este módulo es puro (sin DOM ni
// Yjs) para que lo compartan la interfaz, el MCP y los tests.
//
// Reglas — todas opcionales; una nota debe cumplir TODAS las que haya:
//   tags      etiquetas (sin «#», sin distinguir mayúsculas)
//   tagMode   'any' (alguna de ellas, por defecto) | 'all' (todas)
//   folders   ids de carpeta; incluye sus subcarpetas
//   noFolder  true: también las notas sueltas en la raíz del vault
//   types     'note' | 'canvas' | 'database'  (alguno)
//   pinned    true: sólo favoritas
//   updated   null | número de días: modificadas en los últimos N
//   text      texto que debe aparecer en el título

export const NOTE_TYPES = ['note', 'canvas', 'database'];
export const UPDATED_CHOICES = [1, 7, 30, 90, 365];

export function emptyRules() {
  return { tags: [], tagMode: 'any', folders: [], noFolder: false, types: [], pinned: false, updated: null, text: '' };
}

const uniqStrings = (a) => [...new Set((Array.isArray(a) ? a : []).map(x => String(x == null ? '' : x).trim()).filter(Boolean))];

export function normalizeRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const upd = Number(r.updated);
  return {
    tags: uniqStrings(r.tags).map(x => x.replace(/^#/, '')),
    tagMode: r.tagMode === 'all' ? 'all' : 'any',
    folders: uniqStrings(r.folders),
    noFolder: !!r.noFolder,
    types: uniqStrings(r.types).filter(x => NOTE_TYPES.includes(x)),
    pinned: !!r.pinned,
    updated: Number.isFinite(upd) && upd > 0 ? Math.round(upd) : null,
    text: String(r.text == null ? '' : r.text).trim(),
  };
}

export function rulesAreEmpty(rules) {
  const r = normalizeRules(rules);
  return !r.tags.length && !r.folders.length && !r.noFolder && !r.types.length && !r.pinned && !r.updated && !r.text;
}

// Número de filtros activos (la insignia del botón «Filtros»).
export function ruleCount(rules) {
  const r = normalizeRules(rules);
  return (r.tags.length ? 1 : 0) + (r.folders.length || r.noFolder ? 1 : 0) + (r.types.length ? 1 : 0)
    + (r.pinned ? 1 : 0) + (r.updated ? 1 : 0) + (r.text ? 1 : 0);
}

const sortedJoin = (a) => [...a].map(x => String(x).toLowerCase()).sort().join('\u0001');
export function sameRules(a, b) {
  const x = normalizeRules(a), y = normalizeRules(b);
  return sortedJoin(x.tags) === sortedJoin(y.tags) && x.tagMode === y.tagMode
    && sortedJoin(x.folders) === sortedJoin(y.folders) && x.noFolder === y.noFolder
    && sortedJoin(x.types) === sortedJoin(y.types) && x.pinned === y.pinned
    && x.updated === y.updated && x.text.toLowerCase() === y.text.toLowerCase();
}

export function normalizeCollection(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: String(raw.id),
    name: String(raw.name || '').trim() || '—',
    icon: raw.icon ? String(raw.icon) : null,
    rules: normalizeRules(raw.rules),
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || 0,
  };
}

export const foldText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Carpetas elegidas + todas sus descendientes. `parentOf`: Map folderId → parentId|null.
export function folderScope(folderIds, parentOf) {
  const wanted = new Set(folderIds || []);
  if (!wanted.size) return wanted;
  const out = new Set();
  for (const id of parentOf.keys()) {
    let cur = id, hops = 0;
    while (cur && hops++ < 64) {
      if (wanted.has(cur)) { out.add(id); break; }
      cur = parentOf.get(cur) || null;
    }
  }
  for (const id of wanted) out.add(id);
  return out;
}

// Prepara las reglas una vez para comprobar muchas notas (O(1) por nota).
//   ctx: { parentOf: Map, now?: ms }
export function compileRules(rules, ctx = {}) {
  const r = normalizeRules(rules);
  const folders = folderScope(r.folders, ctx.parentOf || new Map());
  const tags = r.tags.map(x => x.toLowerCase());
  const types = new Set(r.types);
  const text = foldText(r.text);
  const since = r.updated ? (ctx.now || Date.now()) - r.updated * 86400000 : 0;
  const hasFolder = folders.size > 0 || r.noFolder;
  // note: { name, folderId, type, tags (en minúsculas), pinned, updatedAt }
  return (n) => {
    if (r.pinned && !n.pinned) return false;
    if (types.size && !types.has(n.type)) return false;
    if (hasFolder) {
      const inside = n.folderId ? folders.has(n.folderId) : r.noFolder;
      if (!inside) return false;
    }
    if (tags.length) {
      const have = n.tags || [];
      if (r.tagMode === 'all' ? !tags.every(t => have.includes(t)) : !tags.some(t => have.includes(t))) return false;
    }
    if (since && !((n.updatedAt || 0) >= since)) return false;
    if (text && !foldText(n.name).includes(text)) return false;
    return true;
  };
}

export function matchesRules(note, rules, ctx) {
  return compileRules(rules, ctx)(note);
}

// Marca de creación que lleva el id de una nota (`f` + Date.now() en base 36
// + 3 letras): sirve de fecha cuando no se sabe cuándo se editó por última vez.
export function createdFromId(id) {
  const m = /^f([0-9a-z]{8})/.exec(String(id || ''));
  if (!m) return 0;
  const ts = parseInt(m[1], 36);
  return ts > 1.4e12 && ts < 4.1e12 ? ts : 0;
}
