// «Todas las notas»: la lista que se muestra, calculada aparte de la interfaz (puro: sin React ni DOM).
//
//   buildItems   las notas de un vault, con tipo, etiquetas y fechas ya resueltas
//   sortItems    por modificación, creación, título o última apertura
//   groupItems   en secciones: por fecha, carpeta, tipo, o sin agrupar
//   previewOf    las primeras palabras del cuerpo, para la vista previa
//   toLines      lo anterior como filas de altura fija, listo para virtualizar
//
// Fecha de modificación de una nota = la más reciente de: `updatedAt` de su ficha
// (se escribe al editarla, como mucho cada 10 min), la última edición en este equipo,
// la última edición de una IA (editLog) y, si no hay ninguna, el momento en que se
// creó (va dentro del id: `f` + Date.now() en base 36). Sin nada de eso, «Sin fecha».

import { createdFromId } from '../../shared/collections.js';

// Un solo Collator: comparar con localeCompare(…, opciones) en 20 000 notas tarda segundos.
export const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export const baseName = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');

export function buildItems({ files, vaultId, canvasIds, dbIds, tagsById, editStamps, aiAt, fileStats }) {
  const out = [];
  for (const f of files || []) {
    if (!f || (f.vaultId || 'default') !== vaultId) continue;
    const created = createdFromId(f.id);
    const updatedAt = Math.max(Number(f.updatedAt) || 0, (editStamps && editStamps[f.id]) || 0, (aiAt && aiAt.get(f.id)) || 0) || created;
    out.push({
      id: f.id,
      name: baseName(f.name) || '—',
      icon: f.icon && f.icon !== '🎨' ? f.icon : null,
      folderId: f.folderId || null,
      type: f.kind === 'database' || (dbIds && dbIds.has(f.id)) ? 'database' : (canvasIds && canvasIds.has(f.id) ? 'canvas' : 'note'),
      tags: (tagsById && tagsById.get(f.id)) || [],
      pinned: !!f.pinned,
      updatedAt,
      createdAt: created || 0,
      openedAt: (fileStats && fileStats[f.id] && fileStats[f.id].t) || 0,
    });
  }
  return out;
}

export const SORTS = ['modified', 'created', 'title', 'opened'];
const FIELD = { modified: 'updatedAt', created: 'createdAt', opened: 'openedAt' };

export function sortItems(items, sort = 'modified', dir = 'desc') {
  const k = FIELD[sort];
  const sign = dir === 'asc' ? 1 : -1;
  const cmpName = (a, b) => collator.compare(a.name, b.name);
  const out = items.slice();
  if (!k) return out.sort((a, b) => sign * cmpName(a, b));
  // Sin fecha, siempre al final (en cualquier sentido), y por título entre sí.
  return out.sort((a, b) => {
    const x = a[k], y = b[k];
    if (!x !== !y) return x ? -1 : 1;
    return (x - y) * sign || cmpName(a, b);
  });
}

const DAY = 86400000;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function startOfDay(now) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }

// `d0`: medianoche de hoy (se calcula una vez por lista, no por nota).
export function dateBucket(ts, d0, labels) {
  if (!ts) return { key: 'none', label: labels.none };
  if (ts >= d0) return { key: 'd0', label: labels.today };
  if (ts >= d0 - DAY) return { key: 'd1', label: labels.yesterday };
  const days = Math.ceil((d0 - ts) / DAY);
  if (days <= 7) return { key: 'w', label: labels.week };
  if (days <= 30) return { key: 'm', label: labels.month };
  const dt = new Date(ts);
  return { key: dt.getFullYear() + '-' + dt.getMonth(), month: ts };
}

// → [{ key, label, items }] en el orden de `items` (ya ordenados).
export function groupItems(items, mode, sort, labels, now = Date.now()) {
  if (mode === 'none') return [{ key: 'all', label: '', items }];
  const groups = []; const by = new Map();
  const d0 = startOfDay(now);
  // `label` puede ser una función: sólo se llama al crear el grupo (toLocaleDateString es lento).
  const push = (key, label, it) => {
    let g = by.get(key);
    if (!g) { g = { key, label: typeof label === 'function' ? label() : label, items: [] }; by.set(key, g); groups.push(g); }
    g.items.push(it);
  };
  for (const it of items) {
    if (mode === 'folder') {
      const label = it.folderId ? labels.folderLabel(it.folderId) : labels.noFolder;
      push(it.folderId || '', label, it);
    } else if (mode === 'type') {
      push(it.type, labels.type[it.type] || it.type, it);
    } else {
      const field = FIELD[sort] || 'updatedAt';
      const b = dateBucket(it[field], d0, labels);
      // El nombre del mes sólo se calcula al abrir el grupo (toLocaleDateString es lento).
      push(b.key, b.label !== undefined ? b.label : () => cap(new Date(b.month).toLocaleDateString(labels.locale, { month: 'long', year: 'numeric' })), it);
    }
  }
  if (mode === 'folder') groups.sort((a, b) => (a.key === '') - (b.key === '') || collator.compare(a.label, b.label));
  if (mode === 'date') { const i = groups.findIndex(g => g.key === 'none'); if (i > 0) groups.push(groups.splice(i, 1)[0]); }
  return groups;
}

// Vista previa: sin título, ni propiedades, ni bloques de código, ni marcas de Markdown.
export function previewOf(text, max = 160) {
  let s = String(text || '');
  if (s.length > 4000) s = s.slice(0, 4000);
  s = s.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const lines = [];
  let skippedTitle = false;
  for (const raw of s.split('\n')) {
    let l = raw.trim();
    if (!l) continue;
    if (!skippedTitle && /^#{1,6}\s/.test(l)) { skippedTitle = true; continue; }
    skippedTitle = true;
    if (/^\|?[\s:|-]+\|?$/.test(l)) continue;                // separador de tabla
    l = l.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '').replace(/^>\s?/, '').replace(/^\d+\.\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a)
      .replace(/[*_~`]+/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (!l || /^(#[\p{L}_][\p{L}\p{N}_/-]*\s*)+$/u.test(l)) continue;   // sólo etiquetas
    lines.push(l);
    if (lines.join(' ').length >= max) break;
  }
  const out = lines.join(' ');
  return out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out;
}

// Filas de altura fija para virtualizar. `perRow`: tarjetas por fila en la rejilla (1 = lista).
export const LIST_ROW = 60, LIST_HEAD = 40, GRID_ROW = 158, GRID_HEAD = 44;
export function toLines(groups, view, perRow = 1) {
  const lines = [];
  const grid = view === 'grid';
  let n = 0;
  for (const g of groups) {
    if (g.label) lines.push({ kind: 'head', key: 'h:' + g.key, h: grid ? GRID_HEAD : LIST_HEAD, label: g.label, count: g.items.length });
    if (grid) {
      for (let i = 0; i < g.items.length; i += perRow) lines.push({ kind: 'cards', key: 'c:' + g.key + ':' + i, h: GRID_ROW, items: g.items.slice(i, i + perRow), first: n + i });
    } else {
      g.items.forEach((it, i) => lines.push({ kind: 'row', key: 'r:' + it.id, h: LIST_ROW, item: it, index: n + i }));
    }
    n += g.items.length;
  }
  let y = 0;
  for (const l of lines) { l.top = y; y += l.h; }
  return { lines, total: y, count: n };
}

// Índice de la primera fila visible (búsqueda binaria sobre `top`).
export function firstVisible(lines, scrollTop) {
  let lo = 0, hi = lines.length - 1, ans = Math.max(0, hi);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].top + lines[mid].h <= scrollTop) lo = mid + 1; else { ans = mid; hi = mid - 1; }
  }
  return ans;
}
