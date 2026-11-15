// Modelo de las bases de datos (tablas GFM + directiva `<!-- edinot:view=… -->`).
//
// Funciones puras: colores de opciones, fechas, filtros con operador, orden,
// agregaciones, pestañas/vistas guardadas y los códecs de las cláusulas
// nuevas de la directiva. No tocan el DOM ni React, así que editor.jsx, la
// vista nueva y los tests de node las comparten.
//
// Cláusulas nuevas (todas opcionales; una directiva antigua se lee igual que
// antes y, si no se tocan, se vuelve a escribir byte a byte igual):
//   :hide=Col1,Col2      columnas ocultas en la vista activa (nombres URL-encoded)
//   :cal=Fecha           columna de fecha de la vista Calendario
//   :ocol=<json>         color por opción: {"Estado":{"Hecho":"green"}}
//   :views=<json>        vistas guardadas: {"list":[{"n":"Tabla","v":"table"},…],"act":0}
// Los JSON van con encodeURIComponent, así que nunca contienen `:`, espacios
// ni `>` y pasan por el mismo regex de cláusulas de siempre.
//
// Filtros: el valor de `filt` sigue siendo «contiene» (compatible). Los
// operadores nuevos se codifican como prefijo `~op~valor` (p. ej. `~not~Hecho`).

export const VIEW_TYPES = ['table', 'kanban', 'calendar', 'cards', 'list'];
export const DEFAULT_TABS = ['table', 'kanban', 'calendar', 'cards'];
export const COLUMN_TYPES = ['text', 'select', 'number', 'date', 'checkbox', 'tags', 'multiselect', 'status', 'rating', 'progress', 'person', 'wikilink', 'archivo'];
export const OPTION_TYPES = new Set(['select', 'status', 'multiselect', 'tags']);
export const MULTI_TYPES = new Set(['multiselect', 'tags', 'person']);
export const RATING_MAX = 5;

// ── Paleta de opciones (pills) ─────────────────────────────────────────
// Los colores reales viven en ui/db.css (.db-c-<nombre>, claro y oscuro).
export const PILL_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const HASH_COLORS = ['blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'red'];
const KEYWORD_COLORS = [
  [/^(hech[oa]s?|done|complet(ad[oa]|o|ed)|terminad[oa]|list[oa]|cerrad[oa]|resuelt[oa]|aprobad[oa]|finalizad[oa]|entregad[oa])$/i, 'purple'],
  [/^(en curso|en progreso|haciendo|in progress|doing|activ[oa]|abierto|en marcha|started)$/i, 'green'],
  [/^(en revisi[oó]n|revisi[oó]n|review|in review|qa|validando|pendiente de revisi[oó]n)$/i, 'blue'],
  [/^(bloquead[oa]s?|blocked|parad[oa]|en pausa|on hold|retrasad[oa]|esperando)$/i, 'orange'],
  [/^(por hacer|pendiente|to ?do|sin empezar|not started|backlog|nuev[oa]|idea)$/i, 'gray'],
  [/^(urgente|cr[ií]tic[ao]|critical|urgent|p0)$/i, 'red'],
  [/^(alta|high|p1)$/i, 'orange'],
  [/^(media|medium|normal|p2)$/i, 'yellow'],
  [/^(baja|low|p3|menor)$/i, 'gray'],
  [/^(s[ií]|yes|ok|true)$/i, 'green'],
  [/^(no|false|cancelad[oa]|descartad[oa]|cancelled|canceled)$/i, 'red'],
];
export function hashStr(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
export function defaultOptionColor(name) {
  const s = String(name || '').trim();
  for (const [re, c] of KEYWORD_COLORS) if (re.test(s)) return c;
  return HASH_COLORS[hashStr(s.toLowerCase()) % HASH_COLORS.length];
}
// Color de una opción: el guardado en `ocol` gana; si no, el automático.
export function optionColor(optColors, colName, value) {
  const m = optColors && optColors[colName];
  if (m) {
    const v = String(value || '').trim();
    if (m[v] && PILL_COLORS.includes(m[v])) return m[v];
    const lk = Object.keys(m).find(k => k.toLowerCase() === v.toLowerCase());
    if (lk && PILL_COLORS.includes(m[lk])) return m[lk];
  }
  return defaultOptionColor(value);
}
const AVATAR_COLORS = ['#3F6FA8', '#4C6C40', '#8A4F9E', '#C9653F', '#2F7F7A', '#A8456B', '#7A6A2E', '#5B5FC7'];
export function avatarColor(token) { return AVATAR_COLORS[hashStr(String(token || '').toLowerCase()) % AVATAR_COLORS.length]; }

// ── Valores ────────────────────────────────────────────────────────────
export function splitMulti(v) {
  return String(v == null ? '' : v).split(/[,;]/).map(x => x.trim()).filter(Boolean);
}
export function joinMulti(arr) { return (arr || []).map(x => String(x).trim()).filter(Boolean).join(', '); }
export function personName(token) {
  const s = String(token || '').trim();
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}
export function isTruthy(v) { return /^(x|✓|✔|true|1|sí|si|yes)$/i.test(String(v == null ? '' : v).trim()); }
export function parseRating(v) {
  const n = Math.round(Number(String(v == null ? '' : v).replace(',', '.')));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(RATING_MAX, n);
}
export function parseProgress(v) {
  const s = String(v == null ? '' : v).replace('%', '').replace(',', '.').trim();
  if (!s) return null;
  const n = Math.round(Number(s));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}
export function tryNumber(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  let c = s.replace(/[^\d.,\-]/g, '');
  if (c.indexOf('.') >= 0 && c.indexOf(',') >= 0) c = c.replace(/,/g, '');
  else c = c.replace(',', '.');
  if (!c || c === '-' || c === '.') return NaN;
  const n = Number(c);
  return Number.isFinite(n) ? n : NaN;
}
export function fmtNum(n) {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

// Fechas: ISO (2026-10-22, opcional hora) y día/mes/año. Se interpretan en
// hora LOCAL (Date.parse('2026-10-22') es UTC y en América cae el día antes).
export function parseDateCell(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    return { y, m: mo, d, time: m[4] != null ? `${m[4].padStart(2, '0')}:${m[5]}` : null, fmt: 'iso', sep: '-' };
  }
  m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) {
    let y = +m[4]; if (y < 100) y += 2000;
    const d = +m[1], mo = +m[3] - 1;
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    return { y, m: mo, d, time: m[5] != null ? `${m[5].padStart(2, '0')}:${m[6]}` : null, fmt: 'dmy', sep: m[2] };
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const dt = new Date(t);
  return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate(), time: null, fmt: 'iso', sep: '-' };
}
const pad2 = (n) => String(n).padStart(2, '0');
export function isoDay(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
// Reescribe una fecha conservando el formato y la hora de la original.
export function formatDateLike(orig, y, m, d) {
  const p = parseDateCell(orig);
  if (p && p.fmt === 'dmy') return `${pad2(d)}${p.sep}${pad2(m + 1)}${p.sep}${y}${p.time ? ' ' + p.time : ''}`;
  return isoDay(y, m, d) + (p && p.time ? ' ' + p.time : '');
}
export function dayNumber(p) { return p ? Math.floor(Date.UTC(p.y, p.m, p.d) / 86400000) : null; }
export function displayDate(v, lang) {
  const p = parseDateCell(v);
  if (!p) return null;
  const dt = new Date(p.y, p.m, p.d);
  const now = new Date();
  const opts = { day: 'numeric', month: 'short' };
  if (p.y !== now.getFullYear()) opts.year = 'numeric';
  let s;
  try { s = dt.toLocaleDateString(lang || 'es', opts); } catch { s = isoDay(p.y, p.m, p.d); }
  s = s.replace(/\.$/, '').replace(/ de /g, ' ');
  return p.time ? `${s} ${p.time}` : s;
}

// ── Filtros con operador ───────────────────────────────────────────────
export const FILTER_OPS = ['contains', 'ncontains', 'is', 'not', 'gt', 'lt', 'before', 'after', 'empty', 'notempty', 'checked', 'unchecked'];
const NO_VALUE_OPS = new Set(['empty', 'notempty', 'checked', 'unchecked']);
export function filterOpNeedsValue(op) { return !NO_VALUE_OPS.has(op); }
export function parseFilterValue(raw) {
  const s = String(raw == null ? '' : raw);
  const m = /^~([a-z]+)~([\s\S]*)$/.exec(s);
  if (m && FILTER_OPS.includes(m[1])) return { op: m[1], val: m[2] };
  return { op: 'contains', val: s };
}
export function encodeFilterValue(op, val) {
  const v = String(val == null ? '' : val);
  if (!op || op === 'contains') return v;
  return `~${op}~${filterOpNeedsValue(op) ? v : ''}`;
}
export function opsForType(type) {
  switch (type) {
    case 'checkbox': return ['checked', 'unchecked'];
    case 'number': case 'rating': case 'progress': return ['is', 'not', 'gt', 'lt', 'empty', 'notempty'];
    case 'date': return ['is', 'before', 'after', 'empty', 'notempty'];
    case 'select': case 'status': return ['is', 'not', 'contains', 'empty', 'notempty'];
    case 'multiselect': case 'tags': case 'person': return ['contains', 'ncontains', 'empty', 'notempty'];
    default: return ['contains', 'ncontains', 'is', 'not', 'empty', 'notempty'];
  }
}
export function defaultOpForType(type) { return opsForType(type)[0]; }
export function matchFilter(raw, rawFilter, type) {
  const f = typeof rawFilter === 'string' ? parseFilterValue(rawFilter) : rawFilter;
  const s = String(raw == null ? '' : raw).trim();
  const low = s.toLowerCase();
  const val = String(f.val == null ? '' : f.val).trim().toLowerCase();
  const isEq = () => {
    if (type === 'number' || type === 'rating' || type === 'progress') {
      const a = tryNumber(s), b = tryNumber(val);
      return Number.isFinite(a) && Number.isFinite(b) ? a === b : low === val;
    }
    if (type === 'date') {
      const a = parseDateCell(s), b = parseDateCell(val);
      return a && b ? dayNumber(a) === dayNumber(b) : low === val;
    }
    if (MULTI_TYPES.has(type)) return splitMulti(s).some(x => x.toLowerCase() === val);
    return low === val;
  };
  switch (f.op) {
    case 'contains': return low.includes(val);
    case 'ncontains': return !low.includes(val);
    case 'is': return isEq();
    case 'not': return !isEq();
    case 'empty': return !s;
    case 'notempty': return !!s;
    case 'checked': return isTruthy(s);
    case 'unchecked': return !isTruthy(s);
    case 'gt': case 'lt': {
      const a = tryNumber(s), b = tryNumber(val);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return f.op === 'gt' ? a > b : a < b;
    }
    case 'before': case 'after': {
      const a = parseDateCell(s), b = parseDateCell(val);
      if (!a || !b) return false;
      return f.op === 'before' ? dayNumber(a) < dayNumber(b) : dayNumber(a) > dayNumber(b);
    }
    default: return low.includes(val);
  }
}

// ── Reglas de filtro (chips, panel de reglas) ──────────────────────────
// El filtro se guarda como mapa columna → valor (`filt` de la directiva), así
// que hay a lo sumo una regla por columna. Una regla es { col, op, val }.
export function filterRules(filter) {
  const out = [];
  for (const [col, raw] of Object.entries(filter || {})) {
    if (!col || raw == null || raw === '') continue;
    const f = parseFilterValue(raw);
    out.push({ col, op: f.op, val: f.val });
  }
  return out;
}
// Una regla está completa si no necesita valor o ya lo tiene.
export function ruleComplete(rule) {
  return !!rule && !!rule.col && (!filterOpNeedsValue(rule.op) || String(rule.val == null ? '' : rule.val).trim() !== '');
}
// Mapa para la directiva a partir de las reglas (las incompletas se omiten).
// Si dos reglas son de la misma columna gana la última.
export function rulesToFilter(rules) {
  const out = {};
  for (const r of rules || []) if (ruleComplete(r)) out[r.col] = encodeFilterValue(r.op, r.val);
  return Object.keys(out).length ? out : null;
}
// Primera columna sin regla (prefiere las que no son la de título) para «Añadir regla».
export function nextRuleColumn(headers, rules, titleName) {
  const used = new Set((rules || []).map(r => String(r.col).toLowerCase()));
  const free = headers.filter(h => !used.has(String(h).toLowerCase()));
  return free.find(h => h !== titleName) || free[0] || null;
}

// ── Opciones: renombrar y borrar dentro de los valores de las celdas ───
export function renameOptionInValue(v, multi, from, to) {
  const lf = String(from).trim().toLowerCase();
  if (multi) {
    const parts = splitMulti(v);
    let hit = false;
    const next = parts.map(x => { if (x.toLowerCase() === lf) { hit = true; return to; } return x; });
    if (!hit) return v;
    const seen = new Set();
    return joinMulti(next.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }));
  }
  return String(v == null ? '' : v).trim().toLowerCase() === lf ? to : v;
}
export function removeOptionFromValue(v, multi, opt) {
  const lo = String(opt).trim().toLowerCase();
  if (multi) {
    const parts = splitMulti(v);
    const next = parts.filter(x => x.toLowerCase() !== lo);
    return next.length === parts.length ? v : joinMulti(next);
  }
  return String(v == null ? '' : v).trim().toLowerCase() === lo ? '' : v;
}

// ── Cambiar una opción en todo lo que la nombra ───────────────────────
// Renombrar (`to` = texto) o borrar (`to` = null) la opción `from` de la
// columna `col` afecta, además de a las celdas y a la lista de opciones, a:
//   · filter / views[].filt  reglas de filtro que comparan con ese valor
//   · order                  orden de carriles del kanban (si agrupa por `col`)
//   · optColors              su color
// Devuelve un parche { filter?, order?, optColors?, views? } con SOLO lo que
// cambia (vacío si nada la usaba); sirve para patchTableDirective.
// Borrar quita las reglas que la usaban: no quedan filtros rotos.
function sameName(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function filterAfterOptionChange(filter, col, from, to) {
  if (!filter) return { out: filter, hit: false };
  const out = { ...filter };
  let hit = false;
  for (const k of Object.keys(out)) {
    if (!sameName(k, col)) continue;
    const f = parseFilterValue(out[k]);
    if (!filterOpNeedsValue(f.op) || !sameName(String(f.val).trim(), from)) continue;
    hit = true;
    if (to == null) delete out[k]; else out[k] = encodeFilterValue(f.op, to);
  }
  return { out: Object.keys(out).length ? out : null, hit };
}
export function optionChangePatch(directive, col, from, to) {
  const d = directive || {};
  const p = {};
  const remove = to == null;
  const f = filterAfterOptionChange(d.filter, col, from, to);
  if (f.hit) p.filter = f.out;
  if (d.order && d.by && sameName(d.by, col)) {
    const seen = new Set();
    const next = d.order.map(x => (sameName(x, from) ? (remove ? null : to) : x)).filter(x => {
      if (!x) return false; const k = String(x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
    });
    if (next.length !== d.order.length || next.some((x, i) => x !== d.order[i])) p.order = next;
  }
  if (d.views && d.views.list) {
    let hit = false;
    const list = d.views.list.map((v) => {
      const r = filterAfterOptionChange(v.filt, col, from, to);
      if (!r.hit) return v;
      hit = true;
      const nv = { ...v };
      if (r.out) nv.filt = r.out; else delete nv.filt;
      return nv;
    });
    if (hit) p.views = { list, act: d.views.act };
  }
  const oc = d.optColors && Object.keys(d.optColors).find(k => sameName(k, col));
  if (oc) {
    const m = { ...d.optColors[oc] };
    const key = Object.keys(m).find(k => sameName(k, from));
    if (key) {
      const color = m[key]; delete m[key];
      if (!remove) m[to] = color;
      p.optColors = { ...d.optColors, [oc]: m };
    }
  }
  return p;
}

// ── Pestañas que caben («+N más») ──────────────────────────────────────
// widths: ancho de cada pestaña; avail: ancho disponible. Devuelve los índices
// visibles y los que van al menú «+N más». La activa siempre se ve.
export function fitTabs(widths, avail, { gap = 6, moreW = 84, activeIdx = 0 } = {}) {
  const n = widths.length;
  const all = widths.map((_, i) => i);
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, n - 1);
  if (total <= avail || n <= 1) return { visible: all, hidden: [] };
  const room = avail - moreW - gap;
  const vis = []; let used = 0;
  for (let i = 0; i < n; i++) {
    const w = widths[i] + (vis.length ? gap : 0);
    if (used + w > room) break;
    vis.push(i); used += w;
  }
  if (!vis.includes(activeIdx)) {
    while (vis.length && used + widths[activeIdx] + gap > room) {
      const last = vis.pop();
      used -= widths[last] + (vis.length ? gap : 0);
    }
    vis.push(activeIdx);
  }
  vis.sort((a, b) => a - b);
  return { visible: vis, hidden: all.filter(i => !vis.includes(i)) };
}

// ── Orden ──────────────────────────────────────────────────────────────
export function compareCells(av, bv, conf) {
  const type = conf && conf.type;
  const a = String(av == null ? '' : av).trim(), b = String(bv == null ? '' : bv).trim();
  // Vacíos siempre al final, sea cual sea la dirección (lo resuelve el llamador).
  if (type === 'date') {
    const pa = parseDateCell(a), pb = parseDateCell(b);
    if (pa && pb) return dayNumber(pa) - dayNumber(pb) || String(pa.time || '').localeCompare(String(pb.time || ''));
    if (pa) return -1; if (pb) return 1;
  }
  if ((type === 'select' || type === 'status') && conf.options && conf.options.length) {
    const ia = conf.options.findIndex(o => o.toLowerCase() === a.toLowerCase());
    const ib = conf.options.findIndex(o => o.toLowerCase() === b.toLowerCase());
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1; if (ib >= 0) return 1;
  }
  if (type === 'checkbox') return (isTruthy(a) ? 1 : 0) - (isTruthy(b) ? 1 : 0);
  if (!type || type === 'number' || type === 'rating' || type === 'progress') {
    const na = Number(a.replace('%', '').replace(',', '.')), nb = Number(b.replace('%', '').replace(',', '.'));
    if (a && b && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// Filas visibles de una tabla parseada: [{ row, idx }] tras filtro + orden +
// búsqueda local. `idx` es el índice de la fila en el markdown.
export function computeRows(meta, { search } = {}) {
  const d = (meta && meta.directive) || {};
  const headers = meta ? meta.headers : [];
  const cols = d.cols || {};
  let out = (meta ? meta.rows : []).map((row, idx) => ({ row, idx }));
  const filter = d.filter || null;
  if (filter && Object.keys(filter).length) {
    const colIdx = new Map(headers.map((h, i) => [h.toLowerCase(), i]));
    out = out.filter(({ row }) => {
      for (const [k, v] of Object.entries(filter)) {
        const i = colIdx.get(k.toLowerCase());
        if (i == null) continue;
        const conf = cols[headers[i]];
        if (!matchFilter(row[i], v, conf && conf.type)) return false;
      }
      return true;
    });
  }
  const q = String(search || '').trim().toLowerCase();
  if (q) out = out.filter(({ row }) => row.some(c => String(c || '').toLowerCase().includes(q)));
  const sort = d.sort;
  if (sort && sort.col) {
    const i = headers.findIndex(h => h.toLowerCase() === sort.col.toLowerCase());
    if (i >= 0) {
      const dir = sort.dir === 'desc' ? -1 : 1;
      const conf = cols[headers[i]] || null;
      out = out.slice().sort((x, y) => {
        const a = String(x.row[i] || '').trim(), b = String(y.row[i] || '').trim();
        if (!a && !b) return x.idx - y.idx;
        if (!a) return 1;
        if (!b) return -1;
        return (compareCells(a, b, conf) * dir) || (x.idx - y.idx);
      });
    }
  }
  return out;
}

// ── Agregaciones ───────────────────────────────────────────────────────
export const AGG_LIST = ['count', 'count_all', 'count_unique', 'count_empty', 'pct_filled', 'sum', 'avg', 'min', 'max'];
const nums = (col) => col.map(tryNumber).filter(n => !isNaN(n));
const filled = (col) => col.filter(v => String(v || '').trim().length > 0).length;
export function computeAgg(fn, col, conf) {
  const type = conf && conf.type;
  switch (fn) {
    case 'count': return type === 'checkbox' ? String(col.filter(isTruthy).length) : String(filled(col));
    case 'count_all': return String(col.length);
    case 'count_empty': return String(col.filter(v => type === 'checkbox' ? !isTruthy(v) : !String(v || '').trim()).length);
    case 'count_unique': return String(new Set(col.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)).size);
    case 'pct_filled': return col.length ? `${Math.round(((type === 'checkbox' ? col.filter(isTruthy).length : filled(col)) / col.length) * 100)}%` : '0%';
    case 'sum': { const n = nums(col); return n.length ? fmtNum(n.reduce((a, b) => a + b, 0)) : '—'; }
    case 'avg': {
      const n = nums(col); if (!n.length) return '—';
      const avg = n.reduce((a, b) => a + b, 0) / n.length;
      if (type === 'progress') return `${Math.round(avg)}%`;
      return fmtNum(Math.round(avg * (type === 'rating' ? 10 : 100)) / (type === 'rating' ? 10 : 100));
    }
    case 'min': { const n = nums(col); return n.length ? fmtNum(Math.min(...n)) : '—'; }
    case 'max': { const n = nums(col); return n.length ? fmtNum(Math.max(...n)) : '—'; }
    default: return null;
  }
}
export function aggsForType(type) {
  if (type === 'number' || type === 'rating' || type === 'progress') return AGG_LIST;
  return AGG_LIST.filter(f => !['sum', 'avg', 'min', 'max'].includes(f));
}

// ── Códecs de cláusulas nuevas ─────────────────────────────────────────
export function parseNameList(s) {
  if (!s) return null;
  const out = [];
  for (const part of String(s).split(',')) {
    if (!part) continue;
    try { const v = decodeURIComponent(part); if (v) out.push(v); } catch {}
  }
  return out.length ? out : null;
}
export function serializeNameList(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.filter(Boolean).map(x => encodeURIComponent(x)).join(',');
}
export function parseNameClause(s) {
  if (!s) return null;
  try { return decodeURIComponent(s).trim() || null; } catch { return null; }
}
export function parseJsonClause(s) {
  if (!s) return null;
  try { const v = JSON.parse(decodeURIComponent(s)); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
export function serializeJsonClause(o) {
  if (o == null) return '';
  try { return encodeURIComponent(JSON.stringify(o)); } catch { return ''; }
}
// `:wide=1` — la tabla ocupa todo el panel de la nota («Ampliar»). Solo se
// escribe cuando está activo: quien no la usa no ve ningún cambio en su nota.
export function parseWideClause(s) { return String(s == null ? '' : s) === '1'; }
export function serializeWideClause(on) { return on ? '1' : ''; }
export function sanitizeOptColors(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  for (const [col, map] of Object.entries(o)) {
    if (!map || typeof map !== 'object') continue;
    const m = {};
    for (const [opt, c] of Object.entries(map)) if (PILL_COLORS.includes(c)) m[opt] = c;
    if (Object.keys(m).length) out[col] = m;
  }
  return Object.keys(out).length ? out : null;
}
// Una vista guardada: { n: nombre, v: tipo, by?, cal?, sort?: {col,dir}, filt?: {col: valor}, hide?: [cols] }
function sanitizeView(v) {
  if (!v || typeof v !== 'object') return null;
  const type = VIEW_TYPES.includes(v.v) ? v.v : 'table';
  const out = { n: String(v.n || '').slice(0, 80) || type, v: type };
  if (v.by) out.by = String(v.by);
  if (v.cal) out.cal = String(v.cal);
  if (v.sort && v.sort.col && (v.sort.dir === 'asc' || v.sort.dir === 'desc')) out.sort = { col: String(v.sort.col), dir: v.sort.dir };
  if (v.filt && typeof v.filt === 'object') {
    const f = {};
    for (const [k, val] of Object.entries(v.filt)) if (k && val != null && String(val) !== '') f[k] = String(val);
    if (Object.keys(f).length) out.filt = f;
  }
  if (Array.isArray(v.hide)) { const h = v.hide.filter(Boolean).map(String); if (h.length) out.hide = h; }
  return out;
}
export function sanitizeViews(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.list)) return null;
  const list = o.list.map(sanitizeView).filter(Boolean);
  if (!list.length) return null;
  let act = Number.isInteger(o.act) ? o.act : 0;
  if (act < 0 || act >= list.length) act = 0;
  return { list, act };
}

// ── Pestañas / vistas ─────────────────────────────────────────────────
// Sin `views`: pestañas implícitas por tipo (Tabla, Tablero, Calendario,
// Galería y Lista si está activa) que comparten filtro/orden — lo de siempre.
// Con `views`: cada pestaña es una vista guardada con su filtro/orden/
// agrupación/columnas ocultas; la activa vive en las cláusulas de arriba
// (así el MCP y las versiones antiguas leen la vista que se está viendo).
export function getTabs(directive) {
  const d = directive || {};
  const cur = d.view || 'table';
  if (d.views && d.views.list && d.views.list.length) {
    return d.views.list.map((v, i) => ({ key: 's' + i, saved: true, index: i, name: v.n, type: i === d.views.act ? cur : v.v, active: i === d.views.act }));
  }
  const types = DEFAULT_TABS.slice();
  if (cur === 'list') types.push('list');
  return types.map(type => ({ key: type, saved: false, type, name: null, active: cur === type }));
}
// Estado «de vista» que vive en las cláusulas de arriba.
export function currentViewState(d) {
  const out = { v: (d && d.view) || 'table' };
  if (d && d.by) out.by = d.by;
  if (d && d.cal) out.cal = d.cal;
  if (d && d.sort) out.sort = d.sort;
  if (d && d.filter) out.filt = d.filter;
  if (d && d.hidden && d.hidden.length) out.hide = d.hidden;
  return out;
}
// Copia el estado de las cláusulas de arriba en la vista guardada activa.
function saveActive(d, list, act) {
  if (!list[act]) return list;
  const st = currentViewState(d);
  const entry = { n: list[act].n, v: st.v };
  for (const k of ['by', 'cal', 'sort', 'filt', 'hide']) if (st[k] != null) entry[k] = st[k];
  list[act] = entry;
  return list;
}
// Parche (para patchTableDirective) que activa la vista `v` (guardada).
export function patchForView(v, views) {
  return {
    view: v.v || 'table',
    by: v.by || '',
    cal: v.cal || null,
    sort: v.sort || null,
    filter: v.filt || null,
    hidden: v.hide || null,
    views,
  };
}
// Cambia a la pestaña `tab`. Devuelve el parche de directiva.
export function switchTabPatch(directive, tab) {
  const d = directive || {};
  if (!tab.saved) return { view: tab.type };
  const views = d.views;
  if (!views || tab.index === views.act) return null;
  const list = saveActive(d, views.list.slice(), views.act);
  const next = { list, act: tab.index };
  return patchForView(list[tab.index], next);
}
// Añade una vista guardada (materializa las implícitas si hace falta).
// Añade una vista guardada. Si aún no las hay, las pestañas implícitas
// (Tabla, Tablero, Calendario, Galería…) se convierten en vistas guardadas con
// el estado actual, para que no desaparezca ninguna. `labelOf(type)` da su nombre.
export function addViewPatch(directive, type, name, labelOf) {
  const d = directive || {};
  let list, act;
  if (d.views && d.views.list && d.views.list.length) {
    list = saveActive(d, d.views.list.slice(), d.views.act);
  } else {
    const st = currentViewState(d);
    const shared = {};
    for (const k of ['by', 'cal', 'sort', 'filt', 'hide']) if (st[k] != null) shared[k] = st[k];
    const tabs = getTabs(d);
    list = tabs.map(tb => ({ n: labelOf ? labelOf(tb.type) : tb.type, v: tb.type, ...shared }));
    act = tabs.findIndex(tb => tb.active);
    if (act < 0) act = 0;
  }
  const fresh = { n: name || '', v: type };
  if (d.by) fresh.by = d.by;
  if (d.cal) fresh.cal = d.cal;
  list.push(fresh);
  return patchForView(fresh, { list, act: list.length - 1 });
}
export function renameViewPatch(directive, index, name) {
  const d = directive || {};
  if (!d.views) return null;
  const list = d.views.list.slice();
  if (!list[index]) return null;
  list[index] = { ...list[index], n: String(name || '').slice(0, 80) };
  return { views: { list, act: d.views.act } };
}
export function deleteViewPatch(directive, index) {
  const d = directive || {};
  if (!d.views || d.views.list.length <= 1) return null;
  const list = d.views.list.slice();
  if (index === d.views.act) {
    // Activa la vecina y borra esta.
    const nextIdx = index > 0 ? index - 1 : 1;
    const target = list[nextIdx];
    list.splice(index, 1);
    const act = nextIdx > index ? nextIdx - 1 : nextIdx;
    return patchForView(target, { list, act });
  }
  list.splice(index, 1);
  const act = d.views.act > index ? d.views.act - 1 : d.views.act;
  return { views: { list, act } };
}
export function duplicateViewPatch(directive, index, suffix) {
  const d = directive || {};
  if (!d.views) return null;
  const list = saveActive(d, d.views.list.slice(), d.views.act);
  const copy = { ...list[index], n: `${list[index].n || ''} ${suffix || ''}`.trim() };
  list.push(copy);
  return patchForView(copy, { list, act: list.length - 1 });
}

// Renombra una columna dentro de todo lo que la referencia por nombre en
// las cláusulas nuevas (las antiguas las cubre renameTableColumn).
export function renameInExt(ext, oldName, newName) {
  const ren = (x) => (x === oldName ? newName : x);
  const renKeys = (o) => { if (!o) return o; const r = {}; for (const [k, v] of Object.entries(o)) r[ren(k)] = v; return r; };
  const out = { ...ext };
  if (ext.hidden) out.hidden = ext.hidden.map(ren);
  if (ext.cal) out.cal = ren(ext.cal);
  if (ext.optColors) out.optColors = renKeys(ext.optColors);
  if (ext.views) {
    out.views = {
      act: ext.views.act,
      list: ext.views.list.map(v => {
        const n = { ...v };
        if (n.by) n.by = ren(n.by);
        if (n.cal) n.cal = ren(n.cal);
        if (n.sort) n.sort = { ...n.sort, col: ren(n.sort.col) };
        if (n.filt) n.filt = renKeys(n.filt);
        if (n.hide) n.hide = n.hide.map(ren);
        return n;
      }),
    };
  }
  return out;
}

// Columna de fecha por defecto para el calendario.
export function pickDateColumn(meta) {
  const d = (meta && meta.directive) || {};
  const headers = meta ? meta.headers : [];
  if (d.cal && headers.includes(d.cal)) return d.cal;
  const cols = d.cols || {};
  const typed = headers.find(h => cols[h] && cols[h].type === 'date');
  if (typed) return typed;
  // Sin tipo: la primera columna cuyos valores parezcan fechas.
  for (let i = 0; i < headers.length; i++) {
    const vals = meta.rows.map(r => r[i]).filter(v => String(v || '').trim());
    if (vals.length && vals.every(v => /\d/.test(v) && parseDateCell(v))) return headers[i];
  }
  return null;
}
// Columna para agrupar el tablero por defecto.
export function pickGroupColumn(meta) {
  const d = (meta && meta.directive) || {};
  const headers = meta ? meta.headers : [];
  if (d.by && headers.includes(d.by)) return d.by;
  const cols = d.cols || {};
  return headers.find(h => cols[h] && cols[h].type === 'status')
    || headers.find(h => cols[h] && cols[h].type === 'select')
    || null;
}
// Índice de la columna «título»: la primera de texto (o la primera).
export function titleColumnIndex(meta) {
  const headers = meta ? meta.headers : [];
  const cols = (meta && meta.directive && meta.directive.cols) || {};
  const i = headers.findIndex(h => !cols[h] || cols[h].type === 'text' || cols[h].type === 'wikilink');
  return i >= 0 ? i : 0;
}
