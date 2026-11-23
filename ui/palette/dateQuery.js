// «@fecha» en el buscador (Ctrl K): @hoy, @ayer, @mañana, @lunes, @20/11,
// @2026-11-20, @20 de noviembre, @semana, @mes pasado… (español + inglés).
//
//   parseDateQuery('@ayer reunión', { now })
//   → { from, to, single: true, key: 'yesterday', rest: 'reunión' }
//
// `from` es el inicio del primer día y `to` el inicio del día siguiente al
// último (exclusivo). Lo que sigue a la fecha (`rest`) filtra los resultados
// por nombre. Las expresiones de varias palabras («pasado mañana», «20 de
// noviembre») se prueban de la más larga a la más corta.
//
// Puro (sin DOM ni store): lo prueba test/palette-date-query.test.mjs.

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Minúsculas y sin tildes («mañana» → «manana»).
export function foldDate(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

const MONTHS = [
  ['enero', 'ene', 'january', 'jan'],
  ['febrero', 'feb', 'february'],
  ['marzo', 'mar', 'march'],
  ['abril', 'abr', 'april', 'apr'],
  ['mayo', 'may'],
  ['junio', 'jun', 'june'],
  ['julio', 'jul', 'july'],
  ['agosto', 'ago', 'august', 'aug'],
  ['septiembre', 'setiembre', 'sept', 'sep', 'september'],
  ['octubre', 'oct', 'october'],
  ['noviembre', 'nov', 'november'],
  ['diciembre', 'dic', 'december', 'dec'],
];
const monthOf = (w) => MONTHS.findIndex(names => names.includes(w));

// Date.getDay(): 0 = domingo.
const WEEKDAYS = [
  ['domingo', 'dom', 'sunday', 'sun'],
  ['lunes', 'lun', 'monday', 'mon'],
  ['martes', 'mar', 'tuesday', 'tue'],
  ['miercoles', 'mie', 'wednesday', 'wed'],
  ['jueves', 'jue', 'thursday', 'thu'],
  ['viernes', 'vie', 'friday', 'fri'],
  ['sabado', 'sab', 'saturday', 'sat'],
];
const weekdayOf = (w) => WEEKDAYS.findIndex(names => names.includes(w));

const day = (d, key) => ({ from: startOfDay(d), to: addDays(startOfDay(d), 1), single: true, key });
const span = (from, to, key) => ({ from, to, single: false, key });

function validDate(y, m, d) {
  if (!(m >= 0 && m < 12 && d >= 1 && d <= 31)) return null;
  const out = new Date(y, m, d);
  return out.getMonth() === m && out.getDate() === d ? out : null;
}
const fullYear = (y) => (y < 100 ? 2000 + y : y);

// Una expresión ya plegada (sin «@» ni texto detrás) → rango, o null.
function parseExpr(w, now, weekStart, lang) {
  const today = startOfDay(now);
  const weekFrom = addDays(today, -((today.getDay() - weekStart + 7) % 7));
  const t = w.replace(/^(el|la|the|on)\s+/, '');

  switch (t) {
    case 'hoy': case 'today': return day(today, 'today');
    case 'ayer': case 'yesterday': return day(addDays(today, -1), 'yesterday');
    case 'anteayer': case 'antier': case 'antes de ayer': return day(addDays(today, -2), 'dayBefore');
    case 'manana': case 'tomorrow': return day(addDays(today, 1), 'tomorrow');
    case 'pasado manana': return day(addDays(today, 2), 'dayAfter');
    case 'semana': case 'esta semana': case 'week': case 'this week':
      return span(weekFrom, addDays(weekFrom, 7), 'week');
    case 'semana pasada': case 'la semana pasada': case 'last week':
      return span(addDays(weekFrom, -7), weekFrom, 'lastWeek');
    case 'semana que viene': case 'proxima semana': case 'la semana que viene': case 'next week':
      return span(addDays(weekFrom, 7), addDays(weekFrom, 14), 'nextWeek');
    case 'mes': case 'este mes': case 'month': case 'this month':
      return span(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1), 'month');
    case 'mes pasado': case 'el mes pasado': case 'last month':
      return span(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1), 'lastMonth');
    case 'mes que viene': case 'proximo mes': case 'el mes que viene': case 'next month':
      return span(new Date(now.getFullYear(), now.getMonth() + 1, 1), new Date(now.getFullYear(), now.getMonth() + 2, 1), 'nextMonth');
    default: break;
  }

  // Día de la semana: «lunes» = el de esta semana; «lunes pasado» / «próximo
  // lunes» / «lunes que viene» = el de la semana anterior / siguiente.
  let m = /^(?:(proximo|next|last)\s+)?([a-z]+)(?:\s+(pasado|que viene))?$/.exec(t);
  if (m) {
    const wd = weekdayOf(m[2]);
    if (wd >= 0 && !(m[1] && m[3])) {
      let d = addDays(weekFrom, (wd - weekStart + 7) % 7);
      if (m[1] === 'last' || m[3] === 'pasado') d = addDays(d, -7);
      if (m[1] === 'proximo' || m[1] === 'next' || m[3] === 'que viene') d = addDays(d, 7);
      return day(d, 'weekday');
    }
  }

  // 2026-11-20
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) { const d = validDate(+m[1], +m[2] - 1, +m[3]); return d ? day(d, 'date') : null; }

  // 20/11, 20/11/26, 20-11-2026, 20.11.2026 (en inglés, mes/día).
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (m) {
    const [a, b] = lang === 'en' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    const d = validDate(m[3] ? fullYear(+m[3]) : now.getFullYear(), b - 1, a);
    return d ? day(d, 'date') : null;
  }

  // «20 de noviembre (de 2026)», «20 nov», «nov 20 2026», «noviembre (2026)».
  m = /^(\d{1,2})(?:\s+de)?\s+([a-z]+)(?:(?:\s+de)?\s+(\d{4}))?$/.exec(t);
  if (m) {
    const mo = monthOf(m[2]);
    if (mo >= 0) { const d = validDate(m[3] ? +m[3] : now.getFullYear(), mo, +m[1]); return d ? day(d, 'date') : null; }
  }
  m = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(t);
  if (m) {
    const mo = monthOf(m[1]);
    if (mo >= 0) { const d = validDate(m[3] ? +m[3] : now.getFullYear(), mo, +m[2]); return d ? day(d, 'date') : null; }
  }
  m = /^([a-z]+)(?:(?:\s+de)?\s+(\d{4}))?$/.exec(t);
  if (m && m[1].length >= 3) {
    const mo = monthOf(m[1]);
    if (mo >= 0) {
      const y = m[2] ? +m[2] : now.getFullYear();
      return span(new Date(y, mo, 1), new Date(y, mo + 1, 1), 'monthName');
    }
  }
  return null;
}

export function parseDateQuery(text, { now = new Date(), weekStart = 1, lang = 'es' } = {}) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('@')) return null;
  const words = raw.slice(1).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const folded = words.map(foldDate);
  for (let n = Math.min(5, words.length); n >= 1; n--) {
    const r = parseExpr(folded.slice(0, n).join(' ').replace(/,$/, ''), now, weekStart, lang);
    if (r) return { ...r, rest: words.slice(n).join(' ') };
  }
  return null;
}

// Mientras se escribe «@…»: atajos que empiezan por lo tecleado.
const SUGGESTIONS = {
  es: ['hoy', 'ayer', 'mañana', 'esta semana', 'semana pasada', 'este mes', 'anteayer', 'pasado mañana',
    'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
  en: ['today', 'yesterday', 'tomorrow', 'this week', 'last week', 'this month',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
};
export function suggestDateQueries(text, lang = 'es') {
  const raw = String(text || '').trim();
  if (!raw.startsWith('@')) return [];
  const parsed = parseDateQuery(raw);
  if (parsed && parsed.rest) return []; // ya filtra: «@hoy reunión»
  const want = foldDate(raw.slice(1));
  const list = SUGGESTIONS[lang] || SUGGESTIONS.es;
  return list.filter(s => foldDate(s).startsWith(want) && foldDate(s) !== want);
}

// ¿Cae el instante `ms` dentro del rango?
export const inRange = (ms, r) => !!ms && ms >= r.from.getTime() && ms < r.to.getTime();

// Formas en que se suele escribir ese día dentro de una nota.
export function dateNeedles(d, lang = 'es') {
  const iso = isoDay(d);
  const dd = d.getDate(), mm = d.getMonth() + 1, y = d.getFullYear();
  const out = [iso, `${pad(dd)}/${pad(mm)}/${y}`, `${dd}/${mm}/${y}`];
  if (lang === 'en') out.push(`${pad(mm)}/${pad(dd)}/${y}`, `${mm}/${dd}/${y}`);
  return [...new Set(out)];
}

export { DAY };
