// Modelo del calendario: fechas, calendarios (uno por vault + «Tareas con
// fecha» + Google), colocación de eventos solapados y las mutaciones de texto
// sobre las notas (mover un token 📅/⏰, marcar una tarea, fechar una tarea
// sin fecha). Las funciones de texto son puras (string → string) para que
// el mismo camino sirva a la vista y a los tests; quien llama escribe el
// resultado en el Y.Text vivo de la nota con applyTextDiff.

import { getLang } from '../../i18n.js';
import { getWeekStartDay } from '../shared/region.js';

// ── Fechas ──────────────────────────────────────────────────────────────
export const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export const localIso = (d) => `${ymd(d)}T${hhmm(d)}`;
export const DAY_MS = 86400000;
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
// Posición de `d` en su semana (0 = primer día según Ajustes → Idioma y
// región; lunes por defecto) y el día con que empieza esa semana.
export const weekOffset = (d) => (d.getDay() - getWeekStartDay() + 7) % 7;
export const startOfWeek = (d) => { const s = startOfDay(d); return addDays(s, -weekOffset(s)); };
// Columna i de una cabecera de semana → índice de names.dow* (0 = lunes).
export const dowIndex = (i) => (i + getWeekStartDay() + 6) % 7;
export const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();
export const hasTime = (s) => /[ T]\d{1,2}:\d{2}/.test(String(s || ''));

// 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm' (hora local) o ISO con zona (Google).
export function parseWhen(s) {
  if (!s) return null;
  const str = String(s);
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/.test(str)) {
    const d = new Date(str);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

const LOCALES = { es: 'es-ES', en: 'en-GB' };
export const calLocale = () => LOCALES[getLang()] || 'es-ES';
const cap = (s) => { const v = String(s).replace(/\.$/, ''); return v.charAt(0).toLocaleUpperCase() + v.slice(1); };
const fmtCache = new Map();
function fmt(opts) {
  const loc = calLocale();
  const key = loc + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat(loc, opts); } catch { f = new Intl.DateTimeFormat('es-ES', opts); }
    fmtCache.set(key, f);
  }
  return f;
}
export const names = {
  month: (m) => cap(fmt({ month: 'long' }).format(new Date(2024, m, 1))),
  monthShort: (m) => fmt({ month: 'short' }).format(new Date(2024, m, 1)).replace(/\.$/, ''),
  // 0 = lunes. 2024-01-01 fue lunes.
  dowShort: (i) => fmt({ weekday: 'short' }).format(new Date(2024, 0, 1 + i)).replace(/\.$/, ''),
  dowNarrow: (i) => cap(fmt({ weekday: 'narrow' }).format(new Date(2024, 0, 1 + i))),
  dowLong: (d) => cap(fmt({ weekday: 'long' }).format(d)),
  dayMonth: (d) => fmt({ day: 'numeric', month: 'long' }).format(d),
  dayMonthShort: (d) => fmt({ day: 'numeric', month: 'short' }).format(d).replace(/\.(?=\s|$)/g, ''),
  full: (d) => cap(fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d)),
  fullShort: (d) => cap(fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(d)).replace(/\.(?=\s|$)/g, ''),
};
// «12 – 18 oct 2026» · «28 sept – 4 oct 2026» · «octubre 2026»
export function rangeLabel(view, cursor) {
  if (view === 'month') return `${names.month(cursor.getMonth())} ${cursor.getFullYear()}`;
  if (view === 'day') return `${names.full(cursor)} ${cursor.getFullYear() !== new Date().getFullYear() ? cursor.getFullYear() : ''}`.trim();
  if (view === 'agenda') return `${names.dayMonth(cursor)} ${cursor.getFullYear()}`;
  const s = startOfWeek(cursor), e = addDays(s, 6);
  const ms = names.monthShort(s.getMonth()), me = names.monthShort(e.getMonth());
  if (s.getFullYear() !== e.getFullYear()) return `${s.getDate()} ${ms} ${s.getFullYear()} – ${e.getDate()} ${me} ${e.getFullYear()}`;
  if (s.getMonth() !== e.getMonth()) return `${s.getDate()} ${ms} – ${e.getDate()} ${me} ${e.getFullYear()}`;
  return `${s.getDate()} – ${e.getDate()} ${me} ${e.getFullYear()}`;
}

// ── Calendarios ─────────────────────────────────────────────────────────
export const VAULT_COLORS = ['#4C6C40', '#3F6FA8', '#2E8A86', '#A3842B', '#B04A6F', '#6B5FB5', '#5E7D2E', '#9C5B2E'];
export const TASKS_COLOR = '#C9653F';
export const GOOGLE_COLOR = '#8A4F9E';
export const SWATCHES = ['#4C6C40', '#3F6FA8', '#2E8A86', '#C9653F', '#B04A6F', '#8A4F9E', '#A3842B', '#6B7280'];

export const calKeyOf = (ev) => (ev.source === 'google' ? 'google' : ev.source === 'inline' ? 'tasks' : `vault:${ev._vid || ev.vaultId}`);

const PREFS_KEY = 'edinot.calendar.prefs.v1';
export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (p && typeof p === 'object') return { hidden: {}, colors: {}, startHour: 8, view: 'week', ...p };
  } catch {}
  return { hidden: {}, colors: {}, startHour: 8, view: 'week' };
}
export function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

// ── Duración y tramos ───────────────────────────────────────────────────
// Los eventos de día completo guardan `end` EXCLUSIVO (como Google): un
// evento del 24 al 26 tiene end = '2026-10-27'. Los de hora, `end` local.
export function eventDurationMs(ev) {
  const s = parseWhen(ev.start);
  if (!s) return 0;
  const e = parseWhen(ev.end);
  if (ev.allDay) {
    if (e && e > s) return Math.max(DAY_MS, Math.round((startOfDay(e) - startOfDay(s)) / DAY_MS) * DAY_MS);
    return DAY_MS;
  }
  if (e && e > s) return e - s;
  return (ev.kind === 'reminder' || ev.source === 'inline') ? 30 * 60000 : 60 * 60000;
}

// ── Solapes (vista Día/Semana) ──────────────────────────────────────────
// Agrupa los tramos que se pisan (transitivamente) y reparte columnas por
// orden de inicio; cada uno ocupa del todo su columna salvo que la de su
// derecha esté libre en su intervalo, que se ensancha (como Google).
export function layoutDay(items) {
  const sorted = items.slice().sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const cols = [];
    for (const it of cluster) {
      let c = 0;
      while (cols[c] && cols[c].some(o => o.s < it.e && it.s < o.e)) c++;
      (cols[c] || (cols[c] = [])).push(it);
      it._col = c;
    }
    const n = cols.length;
    for (const it of cluster) {
      let span = 1;
      for (let c = it._col + 1; c < n; c++) {
        if (cols[c].some(o => o.s < it.e && it.s < o.e)) break;
        span++;
      }
      out.push({ ...it, col: it._col, cols: n, span });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const it of sorted) {
    if (it.s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return out;
}

export { INLINE_TOKEN_RE_G, findAnchorLine, rewriteInlineToken, toggleTaskAt, appendDateToken, undatedTasksIn, notePreview } from './notetext.js';
