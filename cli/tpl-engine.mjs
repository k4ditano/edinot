// Shared template-substitution engine — used by the CLI's `tpl apply`.
// Editor (browser) and MCP server keep their own copy of the same logic so
// neither has to import this file; we keep them in sync by convention. If
// you change the var grammar here, mirror it in editor.jsx and mcp/server.mjs.

const TPL_VAR_RE = /\{\{\s*([a-zA-Z_][\w-]*(?:[+\-]\d+)?)(?:\s*[:|]\s*([\s\S]*?))?\s*\}\}/g;
const TPL_GENERATORS = new Set([
  'table', 'kanbantable', 'checktable', 'tareastable',
  'datetable', 'weekdaystable', 'monthstable', 'daterange',
]);
const TPL_TRANSFORMS = new Set(['upper', 'lower', 'cap', 'slug']);
function applyTransform(name, args, vars, ctx) {
  const ref = String(args || '').trim();
  let val = (vars && vars[ref]) != null ? vars[ref] : null;
  if (val == null) {
    const built = resolveBuiltin(ref, '', ctx);
    if (built !== undefined) val = built;
  }
  if (val == null) return '';
  const s = String(val);
  if (name === 'upper') return s.toUpperCase();
  if (name === 'lower') return s.toLowerCase();
  if (name === 'cap') return s.replace(/\b\p{L}/gu, c => c.toUpperCase());
  if (name === 'slug') return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_ES_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_ES_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function isoWeek(d) {
  const tgt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (tgt.getUTCDay() + 6) % 7;
  tgt.setUTCDate(tgt.getUTCDate() - dayNr + 3);
  const firstThu = new Date(Date.UTC(tgt.getUTCFullYear(), 0, 4));
  const diff = (tgt - firstThu) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}
function formatDate(d, fmt) {
  if (!fmt) return d.toISOString().slice(0, 10);
  return String(fmt)
    .replace(/YYYY/g, d.getFullYear())
    .replace(/YY/g, String(d.getFullYear()).slice(-2))
    .replace(/MMMM/g, MONTHS_ES[d.getMonth()])
    .replace(/MMM/g, MONTHS_ES_SHORT[d.getMonth()])
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/(?<![A-Za-z])M(?![A-Za-z])/g, String(d.getMonth() + 1))
    .replace(/DDDD/g, WEEKDAYS_ES[d.getDay()])
    .replace(/DDD/g, WEEKDAYS_ES_SHORT[d.getDay()])
    .replace(/DD/g, pad(d.getDate()))
    .replace(/(?<![A-Za-z])D(?![A-Za-z])/g, String(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()))
    .replace(/dddd/g, WEEKDAYS_ES[d.getDay()])
    .replace(/ddd/g, WEEKDAYS_ES_SHORT[d.getDay()]);
}
function offsetDays(b, n) { const d = new Date(b.getTime()); d.setDate(d.getDate() + n); return d; }
function parseKv(args) {
  const out = {};
  if (!args) return out;
  for (const p of String(args).split(':')) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    out[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
  }
  return out;
}
function cols(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }
function table(c, rows = []) {
  if (!c.length) return '';
  const h = `| ${c.join(' | ')} |`;
  const sep = `|${c.map(() => '-------').join('|')}|`;
  const body = rows.length
    ? rows.map(r => `| ${c.map((_, i) => (r[i] != null ? String(r[i]) : '')).join(' | ')} |`)
    : [`| ${c.map(() => ' ').join(' | ')} |`];
  return [h, sep, ...body].join('\n');
}
function kanbanTable(c, order) {
  const oe = order.map(s => encodeURIComponent(s)).join(',');
  const widths = c.map(x => `${encodeURIComponent(x)}=${x === c[0] ? 341 : 138}`).join(',');
  const statusCol = c[c.length - 1];
  const comment = `<!-- edinot:view=kanban:by=${encodeURIComponent(statusCol)}:order=${oe}:widths=${widths} -->`;
  return `${comment}\n${table(c)}`;
}
function generator(name, args, ctx) {
  const kv = parseKv(args);
  const now = (ctx && ctx.now) || new Date();
  if (name === 'table') {
    const c = cols(kv.cols || 'Columna 1,Columna 2');
    const n = Math.max(1, Number(kv.rows) || 1);
    return table(c, Array.from({ length: n }, () => c.map(() => '')));
  }
  if (name === 'kanbantable') return kanbanTable(cols(kv.cols || 'Descripción,Prioridad,Estado'), cols(kv.order || 'Pendiente,En revisión,Completado'));
  if (name === 'checktable') {
    const c = cols(kv.cols || 'Tarea');
    return table(c, [c.map((_, i) => i === 0 ? '- [ ] ' : '')]);
  }
  if (name === 'tareastable') return kanbanTable(['Descripción', 'Prioridad', 'Estado'], ['Pendiente', 'En revisión', 'Completado']);
  if (name === 'datetable') {
    const segs = String(args || '').split(':');
    let n = Number(kv.n || kv.N);
    if (!n) for (const s of segs) { const v = Number(s); if (v) { n = v; break; } }
    n = Math.max(1, n || 7);
    const c = cols(kv.cols || 'Fecha,Notas');
    return table(c, Array.from({ length: n }, (_, i) => [formatDate(offsetDays(now, i), 'YYYY-MM-DD'), ''].slice(0, c.length)));
  }
  if (name === 'weekdaystable') {
    const c = cols(kv.cols || 'Día,Plan');
    return table(c, ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'].map(d => [d, ''].slice(0, c.length)));
  }
  if (name === 'monthstable') {
    const c = cols(kv.cols || 'Mes,Objetivo');
    return table(c, MONTHS_ES.map(m => [m, ''].slice(0, c.length)));
  }
  if (name === 'daterange') {
    const start = kv.start ? new Date(kv.start) : now;
    const end = kv.end ? new Date(kv.end) : offsetDays(now, 6);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
    const c = cols(kv.cols || 'Día,Notas');
    const rows = [];
    for (let d = new Date(start); d <= end && rows.length < 366; d = offsetDays(d, 1)) {
      rows.push([formatDate(d, 'YYYY-MM-DD'), ''].slice(0, c.length));
    }
    return table(c, rows);
  }
  return '';
}
function resolveBuiltin(name, args, ctx) {
  const now = (ctx && ctx.now) || new Date();
  if (name === 'cursor') return '';
  if (name === 'date') return args ? formatDate(now, args) : formatDate(now, 'YYYY-MM-DD');
  if (name === 'datetime') return args ? formatDate(now, args) : formatDate(now, 'YYYY-MM-DD HH:mm');
  if (name === 'time') return formatDate(now, 'HH:mm');
  if (name === 'year') return String(now.getFullYear());
  if (name === 'month') return MONTHS_ES[now.getMonth()];
  if (name === 'day') return pad(now.getDate());
  if (name === 'weekday') return WEEKDAYS_ES[now.getDay()];
  if (name === 'week') return String(isoWeek(now));
  if (name === 'tomorrow') return formatDate(offsetDays(now, 1), 'YYYY-MM-DD');
  if (name === 'yesterday') return formatDate(offsetDays(now, -1), 'YYYY-MM-DD');
  const off = name.match(/^date([+-])(\d+)$/);
  if (off) {
    const n = (off[1] === '+' ? 1 : -1) * Number(off[2]);
    const d = offsetDays(now, n);
    return args ? formatDate(d, args) : formatDate(d, 'YYYY-MM-DD');
  }
  if (name === 'user') return ctx.userName || ctx.userEmail || '';
  if (name === 'email') return ctx.userEmail || '';
  if (name === 'vault') return ctx.vaultName || '';
  if (name === 'folder') return ctx.folderName || '';
  if (name === 'folderpath') return ctx.folderPath || '';
  if (name === 'template') return ctx.templateName || '';
  if (name === 'notecount') return String(ctx.noteCount != null ? ctx.noteCount : '');
  if (name === 'uuid') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  if (name === 'shortid') return Math.random().toString(36).slice(2, 10);
  if (name === 'clipboard') return ctx.clipboard || '';
  if (name === 'selection') return ctx.selection || '';
  if (name === 'counter') {
    const key = String(args || 'default');
    const map = ctx.counters || {};
    const cur = (map[key] || 0) + 1;
    map[key] = cur;
    if (ctx.counters !== map) ctx.counters = map;
    return pad(cur, 4);
  }
  if (name === 'choice') {
    const opts = String(args || '').split('|').map(s => s.trim()).filter(Boolean);
    return opts[0] || '';
  }
  return undefined;
}
export function substituteForCli(text, vars, ctx = {}) {
  const src = String(text || '');
  return src.replace(TPL_VAR_RE, (_, rawName, rawArgs) => {
    const name = rawName;
    const args = rawArgs != null ? rawArgs : '';
    if (TPL_TRANSFORMS.has(name)) return applyTransform(name, args, vars, ctx);
    if (TPL_GENERATORS.has(name)) return generator(name, args, ctx);
    const built = resolveBuiltin(name, args, ctx);
    if (built !== undefined) return built;
    const v = vars && vars[name];
    if (v != null && v !== '') return String(v);
    return args || '';
  });
}
