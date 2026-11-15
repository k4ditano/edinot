// Alta rápida en lenguaje natural para el calendario (español + inglés).
//
//   parseQuickAdd('Café con Marta el jueves a las 11', { now, lang })
//   → { title: 'Café con Marta', date: '2026-10-22', time: '11:00',
//       endDate: '2026-10-22', endTime: '12:00', allDay: false, … }
//
// Sin dependencias (chrono-node no trae español decente y pesa ~250 KB).
// Funciona por extracción: cada patrón reconocido «consume» su tramo del
// texto (se marca en una copia plegada — minúsculas, sin tildes — de la MISMA
// longitud, así los índices valen para el original) y lo que queda sin
// consumir es el título. El orden de los patrones importa: recurrencia →
// tipo → franja horaria → hora → duración → partes del día → fechas.
//
// Puro (sin DOM ni store): lo prueba un script de node.

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (h, m) => `${pad(h)}:${pad(m)}`;

// Minúsculas + sin tildes, carácter a carácter (misma longitud que el
// original: los índices de las coincidencias sirven para recortar el título).
function fold(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = c.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdfff) { o += c; continue; }
    const l = c.toLowerCase();
    o += (l.normalize ? l.normalize('NFD') : l)[0] || c;
  }
  return o;
}

const NUM_WORDS = {
  un: 1, una: 1, uno: 1, a: 1, an: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3,
  cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7,
  ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, once: 11, eleven: 11,
  doce: 12, twelve: 12, otra: 2, other: 2,
};
const HOUR_WORDS = 'una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const COUNT_WORDS = 'un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|a|an|one|two|three|four|five|six|seven|eight|nine|ten|otra|other';
const toNum = (s) => {
  if (s == null) return null;
  const k = String(s).trim();
  if (/^\d+$/.test(k)) return parseInt(k, 10);
  return NUM_WORDS[k] != null ? NUM_WORDS[k] : null;
};

// Meses: plegados (sin tildes). Índice 0..11.
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
const MONTH_RE = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');
const monthIndex = (w) => MONTHS.findIndex(list => list.includes(w));

// Días de la semana: 0 = lunes … 6 = domingo (como recurrence.byWeekday).
// «mar» (martes) y «sun»/«sol» se dejan fuera por ambiguos; «mar.» con punto sí.
const WEEKDAYS = [
  ['lunes', 'lun', 'monday', 'mondays', 'mon'],
  ['martes', 'mar.', 'tuesday', 'tuesdays', 'tues', 'tue'],
  ['miercoles', 'mie', 'wednesday', 'wednesdays', 'wed'],
  ['jueves', 'jue', 'thursday', 'thursdays', 'thurs', 'thu'],
  ['viernes', 'vie', 'friday', 'fridays', 'fri'],
  ['sabados', 'sabado', 'sab', 'saturday', 'saturdays', 'sat'],
  ['domingos', 'domingo', 'dom', 'sunday', 'sundays', 'sun'],
];
const WD_RE = WEEKDAYS.flat().sort((a, b) => b.length - a.length).map(w => w.replace('.', '\\.')).join('|');
const wdIndex = (w) => WEEKDAYS.findIndex(list => list.includes(w));

// Expresión de hora: 9 · 9:30 · 9h30 · 9 y media · 5pm · 5 de la tarde · once.
const T = `(\\d{1,2}|${HOUR_WORDS})(?:(?::|h)(\\d{2}))?(?:\\s*(y media|y cuarto|menos cuarto))?`
  + `(?:\\s*(a\\.m\\.|p\\.m\\.|am|pm|h(?![a-z])|hrs?(?![a-z])|de la manana|de la tarde|de la noche|de la madrugada|del mediodia|in the morning|in the afternoon|in the evening|at night))?`;

// Convierte los grupos de T en { h, m, strong } o null si no es una hora.
// strong = lleva minutos o meridiano (no es sólo un número suelto).
function readTime(hS, mS, frac, mer) {
  let h = toNum(hS);
  if (h == null) return null;
  let m = mS != null ? parseInt(mS, 10) : 0;
  if (frac === 'y media') m = 30;
  else if (frac === 'y cuarto') m = 15;
  else if (frac === 'menos cuarto') { m = 45; h -= 1; if (h < 0) h = 23; }
  if (m > 59) return null;
  let explicit24 = false;
  if (mer) {
    if (/^(pm|p\.m\.|de la tarde|de la noche|in the afternoon|in the evening|at night)$/.test(mer)) { if (h < 12) h += 12; }
    else if (/^(am|a\.m\.|de la manana|de la madrugada|in the morning)$/.test(mer)) { if (h === 12) h = 0; }
    else if (mer === 'del mediodia') { if (h < 6) h += 12; }
    else explicit24 = true; // h / hrs
  }
  if (h > 23) return null;
  return { h, m, strong: mS != null || !!frac || !!mer, mer: !!mer && !explicit24, explicit24 };
}
// «a las 3» sin meridiano → 15:00 (nadie queda a las 3 de la madrugada).
function pmHeuristic(t) {
  if (!t.mer && !t.explicit24 && t.h >= 1 && t.h <= 7) return { ...t, h: t.h + 12 };
  return t;
}

const DAY_MS = 86400000;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dow0 = (d) => (d.getDay() + 6) % 7; // 0 = lunes

/**
 * @param {string} text
 * @param {{ now?: Date, lang?: string, calendars?: Array<{id:string,name:string}> }} [opts]
 */
export function parseQuickAdd(text, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const orig = String(text || '');
  let low = fold(orig);
  const used = new Array(orig.length).fill(false);
  const spans = [];

  // Busca `re` en las zonas aún libres; `fn(match)` devuelve false para
  // rechazar la coincidencia (sigue buscando), o un objeto/true para aceptarla
  // y consumir el tramo.
  const take = (src, fn, kind) => {
    const re = new RegExp(src, 'g');
    let m;
    let any = false;
    while ((m = re.exec(low))) {
      if (!m[0]) { re.lastIndex++; continue; }
      let s = m.index, e = m.index + m[0].length;
      // Recorta espacios del borde (los prefijos opcionales los arrastran).
      while (s < e && /\s/.test(low[s])) s++;
      while (e > s && /\s/.test(low[e - 1])) e--;
      let blocked = false;
      for (let i = s; i < e; i++) if (used[i]) { blocked = true; break; }
      if (blocked) continue;
      const ok = fn(m);
      if (ok === false) { re.lastIndex = m.index + 1; continue; }
      for (let i = s; i < e; i++) used[i] = true;
      low = low.slice(0, s) + '\u0001'.repeat(e - s) + low.slice(e);
      spans.push({ kind, text: orig.slice(s, e) });
      any = true;
      if (ok !== 'multi') return true;
    }
    return any;
  };

  let date = null;          // Date (día)
  let time = null;          // { h, m }
  let endTime = null;       // { h, m }
  let durMin = null;
  let part = null;          // hora por defecto de «por la tarde», etc.
  let recurrence = null;
  let kind = 'event';
  let calendarHint = null;
  let location = null;

  // ── Calendario (#trabajo) ─────────────────────────────────────────────
  const cals = Array.isArray(opts.calendars) ? opts.calendars : [];
  if (cals.length) {
    take('(?:^|\\s)#([a-z0-9_\\-]+)', (m) => {
      const hit = cals.find(c => fold(String(c.name || '')).replace(/\s+/g, '') === m[1]
        || fold(String(c.name || '')).replace(/\s+/g, '').startsWith(m[1]));
      if (!hit) return false;
      calendarHint = hit.id;
      return true;
    }, 'calendar');
  }

  // ── Tipo: recordatorio ────────────────────────────────────────────────
  take('^\\s*(?:⏰\\s*|recordarme(?: que)?\\s+|recuerdame(?: que)?\\s+|recordar(?: que)?\\s+|recordatorio:?\\s+|remind me(?: to)?\\s+|reminder:?\\s+)', () => { kind = 'reminder'; return true; }, 'kind');

  // ── Recurrencia ───────────────────────────────────────────────────────
  // «cada lunes y miércoles», «todos los viernes», «every monday and friday»,
  // «los martes» (en español el plural ya es «cada»).
  const WD_LIST = `((?:${WD_RE})(?:\\s*(?:,|y|e|and|&)\\s*(?:${WD_RE}))*)`;
  take(`\\b(?:cada|todos los|todas las|every|los|on)\\s+${WD_LIST}(?![a-z])`, (m) => {
    // «los»/«on» sólo cuentan con plural («los lunes» sí, «on monday» no).
    const lead = m[0].trim().split(/\s+/)[0];
    const words = m[1].split(/\s*(?:,|\by\b|\be\b|\band\b|&)\s*/).filter(Boolean);
    if (lead === 'on' && !words.every(w => /s$/.test(w) && !/^(lunes|martes|miercoles|jueves|viernes)$/.test(w))) return false;
    const days = [...new Set(words.map(wdIndex).filter(i => i >= 0))].sort((a, b) => a - b);
    if (!days.length) return false;
    recurrence = { freq: 'weekly', interval: 1, byWeekday: days };
    return true;
  }, 'recurrence');
  if (!recurrence) {
    take('\\b(?:de lunes a viernes|entre semana|dias laborables|laborables|every weekday|weekdays)\\b', () => {
      recurrence = { freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] };
      return true;
    }, 'recurrence');
  }
  if (!recurrence) {
    take(`\\b(?:cada|todos los|todas las|every)\\s+(?:(\\d+|${COUNT_WORDS})\\s+)?(dias?|semanas?|mes(?:es)?|anos?|days?|weeks?|months?|years?)\\b`, (m) => {
      const unit = m[2];
      const n = m[1] != null ? toNum(m[1]) : 1;
      if (!n) return false;
      const freq = /^(dia|day)/.test(unit) ? 'daily' : /^(semana|week)/.test(unit) ? 'weekly' : /^(mes|month)/.test(unit) ? 'monthly' : 'yearly';
      recurrence = { freq, interval: n, byWeekday: null };
      return true;
    }, 'recurrence');
  }
  if (!recurrence) {
    take('\\b(diariamente|a diario|semanalmente|mensualmente|anualmente)\\b', (m) => {
      const w = m[1];
      recurrence = { freq: /diari/.test(w) ? 'daily' : /seman/.test(w) ? 'weekly' : /mensu/.test(w) ? 'monthly' : 'yearly', interval: 1, byWeekday: null };
      return true;
    }, 'recurrence');
  }

  // ── Franja horaria: 9:30-10:15 · de 10 a 12 · from 3pm to 4pm ─────────
  const RANGE_PRE = '(?:\\b(?:de|desde|from|entre|between)\\s+(?:las?\\s+)?|\\ba las?\\s+|\\bat\\s+)?';
  take(`${RANGE_PRE}${T}\\s*(?:-|–|—|\\ba\\b|\\bhasta\\b|\\bto\\b|\\buntil\\b|\\btill\\b|\\by\\b|\\band\\b)\\s*(?:las?\\s+)?${T}(?![\\d:])`, (m) => {
    const prefixed = /^(de|desde|from|entre|between|a las?|at)\b/.test(m[0].trim());
    let a = readTime(m[1], m[2], m[3], m[4]);
    let b = readTime(m[5], m[6], m[7], m[8]);
    if (!a || !b) return false;
    if (!prefixed && !a.strong && !b.strong) return false;
    // «y»/«and» sólo valen como separador tras «entre»/«between».
    if (/\s(y|and)\s/.test(m[0]) && !/^(entre|between)\b/.test(m[0].trim())) return false;
    // «1h a las 17h»: con «a» de separador hace falta «de/desde» delante.
    if (/\sa\s/.test(m[0]) && !/^(de|desde|entre|from|between)\b/.test(m[0].trim())) return false;
    // «de 3 a 5pm» → el meridiano del final vale para el principio.
    if (!a.mer && b.mer && b.h >= 12 && a.h < 12 && a.h + 12 <= b.h) a = { ...a, h: a.h + 12 };
    if (!a.mer && !a.explicit24) a = pmHeuristic(a);
    if (!b.mer && !b.explicit24 && b.h < a.h) b = { ...b, h: b.h + 12 > 23 ? b.h : b.h + 12 };
    time = { h: a.h, m: a.m };
    endTime = { h: b.h, m: b.m };
    return true;
  }, 'time');

  // ── Duración explícita ────────────────────────────────────────────────
  take(`\\b(?:durante|por|for)\\s+(\\d+(?:[.,]\\d+)?|${COUNT_WORDS}|media)\\s*(minutos?|mins?|min|m|horas?|hours?|hrs?|h)\\b`, (m) => {
    const n = m[1] === 'media' ? 0.5 : (toNum(m[1]) != null ? toNum(m[1]) : parseFloat(m[1].replace(',', '.')));
    if (!Number.isFinite(n) || n <= 0) return false;
    durMin = /^m/.test(m[2]) ? Math.round(n) : Math.round(n * 60);
    return true;
  }, 'duration');
  take('\\b(\\d+(?:[.,]\\d+)?)\\s*(minutos|minutes|mins?|min|horas|hours|hrs)\\b', (m) => {
    const n = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return false;
    durMin = /^m/.test(m[2]) ? Math.round(n) : Math.round(n * 60);
    return true;
  }, 'duration');
  take('\\b(media hora|half an hour|una hora y media|an hour and a half|una hora|an hour)\\b', (m) => {
    durMin = /y media|and a half/.test(m[1]) ? 90 : /media|half/.test(m[1]) ? 30 : 60;
    return true;
  }, 'duration');

  // ── Hora suelta ───────────────────────────────────────────────────────
  if (!time) {
    take('\\b(mediodia|noon|medianoche|midnight)\\b', (m) => {
      time = /^(mediodia|noon)$/.test(m[1]) ? { h: 12, m: 0 } : { h: 0, m: 0 };
      return true;
    }, 'time');
  }
  if (!time) {
    take(`(?:\\ba las?|\\bsobre las?|\\bhacia las?|\\bat|\\baround|@)\\s*${T}(?![\\d:])`, (m) => {
      let a = readTime(m[1], m[2], m[3], m[4]);
      if (!a) return false;
      a = pmHeuristic(a);
      time = { h: a.h, m: a.m };
      return true;
    }, 'time');
  }
  if (!time) {
    take(`\\b${T}(?![\\d:a-z])`, (m) => {
      const a = readTime(m[1], m[2], m[3], m[4]);
      if (!a || !a.strong) return false;
      if (!/^\d/.test(m[1])) return false; // «once» suelto no es una hora
      // «2h» suelto = duración; «17h» = hora.
      if (a.explicit24 && m[2] == null) {
        const n = parseInt(m[1], 10);
        if (n <= 4) { if (durMin == null) durMin = n * 60; return true; }
      }
      const b = a.mer || a.explicit24 ? a : pmHeuristic(a);
      time = { h: b.h, m: b.m };
      return true;
    }, 'time');
  }
  // «1h» / «2 h» sueltos tras una hora ya leída → duración.
  if (durMin == null) {
    take('\\b(\\d+(?:[.,]\\d+)?)\\s*h\\b', (m) => {
      const n = parseFloat(m[1].replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0 || n > 12) return false;
      durMin = Math.round(n * 60);
      return true;
    }, 'duration');
  }

  // ── Partes del día ────────────────────────────────────────────────────
  // Antes que «mañana» (= día siguiente) para no confundir «por la mañana».
  take('\\b(?:(esta|this)\\s+)?(?:por la|en la|de la|in the)?\\s*(manana|tarde|noche|morning|afternoon|evening)\\b|\\b(tonight)\\b', (m) => {
    const w = m[2] || m[3];
    const lead = m[0].trim();
    // «mañana» sola (sin «por la/esta/de la») es el día de mañana.
    if (w === 'manana' && !/^(esta|por la|en la|de la)\b/.test(lead)) return false;
    if ((w === 'tarde' || w === 'noche') && !/^(esta|por la|en la|de la)\b/.test(lead)) return false;
    if (/^(morning|afternoon|evening)$/.test(w) && !/^(this|in the)\b/.test(lead)) return false;
    const h = /manana|morning/.test(w) ? 9 : /tarde|afternoon/.test(w) ? 16 : 20;
    part = h;
    if (m[1] || w === 'tonight') date = today;
    if (time && time.h < 12 && h >= 12) time = { ...time, h: time.h + 12 };
    return true;
  }, 'time');

  // ── Fechas ────────────────────────────────────────────────────────────
  const setDate = (d) => { if (date) return false; date = d; return true; };
  const validDay = (y, mo, d) => {
    const x = new Date(y, mo, d);
    return x.getFullYear() === y && x.getMonth() === mo && x.getDate() === d ? x : null;
  };
  const rollYear = (mo, d, yS) => {
    if (yS != null) {
      let y = parseInt(yS, 10);
      if (y < 100) y += 2000;
      return validDay(y, mo, d);
    }
    let x = validDay(today.getFullYear(), mo, d);
    if (x && x < today) x = validDay(today.getFullYear() + 1, mo, d);
    return x;
  };
  // ISO
  take('\\b(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b', (m) => {
    const x = validDay(+m[1], +m[2] - 1, +m[3]);
    return x ? setDate(x) : false;
  }, 'date');
  // 24/10 · 24/10/2026 · 24-10
  take('\\b(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?\\b', (m) => {
    let d = +m[1], mo = +m[2];
    if (d <= 12 && mo > 12 && opts.lang === 'en') { const k = d; d = mo; mo = k; }
    if (mo < 1 || mo > 12) return false;
    const x = rollYear(mo - 1, d, m[3]);
    return x ? setDate(x) : false;
  }, 'date');
  // 24 oct · 24 de octubre (de 2026) · 24th of October
  take(`\\b(?:el\\s+|the\\s+|on\\s+(?:the\\s+)?)?(?:dia\\s+)?(\\d{1,2})(?:º|°|st|nd|rd|th)?(?:\\s+de|\\s+of)?\\s+(${MONTH_RE})\\.?(?:,?\\s+(?:de\\s+|del\\s+)?(\\d{4}))?(?![a-z])`, (m) => {
    const mo = monthIndex(m[2]);
    if (mo < 0) return false;
    const x = rollYear(mo, +m[1], m[3]);
    return x ? setDate(x) : false;
  }, 'date');
  // oct 24 · October 24th, 2027
  take(`\\b(?:on\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, (m) => {
    const mo = monthIndex(m[1]);
    if (mo < 0) return false;
    const x = rollYear(mo, +m[2], m[3]);
    return x ? setDate(x) : false;
  }, 'date');
  // relativos
  take('\\b(pasado manana|day after tomorrow|manana|tomorrow|hoy|today|ayer|yesterday)\\b', (m) => {
    const w = m[1];
    const n = /pasado|after/.test(w) ? 2 : /manana|tomorrow/.test(w) ? 1 : /ayer|yesterday/.test(w) ? -1 : 0;
    return setDate(addDays(today, n));
  }, 'date');
  // en 3 días · dentro de 2 semanas · in a week
  take(`\\b(?:en|dentro de|in)\\s+(\\d+|${COUNT_WORDS})\\s+(dias?|semanas?|mes(?:es)?|days?|weeks?|months?)\\b`, (m) => {
    const n = toNum(m[1]);
    if (!n) return false;
    const u = m[2];
    if (/^(dia|day)/.test(u)) return setDate(addDays(today, n));
    if (/^(semana|week)/.test(u)) return setDate(addDays(today, 7 * n));
    return setDate(new Date(today.getFullYear(), today.getMonth() + n, today.getDate()));
  }, 'date');
  // la semana que viene · next week → lunes de la semana siguiente
  take('\\b(?:la semana que viene|la proxima semana|la semana proxima|next week)\\b', () => setDate(addDays(today, 7 - dow0(today))), 'date');
  take('\\b(?:este fin de semana|el fin de semana|fin de semana|this weekend|the weekend|weekend)\\b', () => {
    const d = dow0(today);
    return setDate(d >= 5 ? today : addDays(today, 5 - d));
  }, 'date');
  // el jueves · el próximo lunes · next friday · el lunes que viene
  take(`\\b(?:(?:el|este|esta|on|this)\\s+)?(?:(proximo|next)\\s+)?(${WD_RE})(?![a-z])(?:\\s+(que viene|proximo))?`, (m) => {
    const i = wdIndex(m[2]);
    if (i < 0) return false;
    let delta = (i - dow0(today) + 7) % 7;
    if ((m[1] || m[3]) && delta === 0) delta = 7;
    return setDate(addDays(today, delta));
  }, 'date');
  // el 24 · the 24th
  take('\\b(?:el(?:\\s+dia)?|the|on the)\\s+(\\d{1,2})(?:º|°|st|nd|rd|th)?(?![\\d:a-z])', (m) => {
    const d = +m[1];
    if (d < 1 || d > 31) return false;
    let x = validDay(today.getFullYear(), today.getMonth(), d);
    if (!x || x < today) x = validDay(today.getFullYear(), today.getMonth() + 1, d) || new Date(today.getFullYear(), today.getMonth() + 1, d);
    return setDate(x);
  }, 'date');

  // ── Recurrencia en inglés suelta (daily standup) ──────────────────────
  // Sólo si aún no hay una y no es la primera palabra ni dejaría el título
  // vacío: «Weekly review» es un título; «cada lunes a las 9 daily», también.
  if (!recurrence) {
    const re = /\b(daily|weekly|monthly|yearly|annually)\b/g;
    let m;
    while ((m = re.exec(low))) {
      const before = low.slice(0, m.index).replace(/[\u0001\s]/g, '');
      const rest = (low.slice(0, m.index) + low.slice(m.index + m[0].length)).replace(/[\u0001\s]|\b(el|la|a|de|on|at|the)\b/g, '');
      if (!before || !rest) continue;
      const w = m[1];
      recurrence = { freq: w === 'daily' ? 'daily' : w === 'weekly' ? 'weekly' : w === 'monthly' ? 'monthly' : 'yearly', interval: 1, byWeekday: null };
      for (let i = m.index; i < m.index + m[0].length; i++) used[i] = true;
      low = low.slice(0, m.index) + '\u0001'.repeat(m[0].length) + low.slice(m.index + m[0].length);
      spans.push({ kind: 'recurrence', text: orig.slice(m.index, m.index + m[0].length) });
      break;
    }
  }

  // ── Título (lo no consumido) ──────────────────────────────────────────
  let title = '';
  for (let i = 0; i < orig.length; i++) title += used[i] ? ' ' : orig[i];
  // Lugar: «… en Café Central» / «… at Blue Bottle» al final, con mayúscula.
  const locM = title.match(/\s(?:en|at|in|@)\s+((?:[A-ZÁÉÍÓÚÑ0-9][^\s,]*)(?:\s+(?:de|del|la|el|of|the|[A-ZÁÉÍÓÚÑ0-9][^\s,]*))*)\s*$/);
  if (locM && locM[1] && !/^\d+$/.test(locM[1])) {
    location = locM[1].replace(/\s+(de|del|la|el|of|the)$/i, '').trim();
    title = title.slice(0, locM.index);
    spans.push({ kind: 'location', text: location });
  }
  const DANGLE = /^(?:el|la|los|las|a|al|de|del|en|y|on|at|the|in|for|para|por|and|from|desde|hasta|to|-|–|,|:|;|\.)$/i;
  let words = title.split(/\s+/).filter(Boolean);
  // Conectores sueltos que se quedaron colgando al quitar fechas/horas.
  const cleanEdges = () => {
    while (words.length && DANGLE.test(words[words.length - 1])) words.pop();
    while (words.length && /^(?:-|–|,|:|;)$/.test(words[0])) words.shift();
  };
  cleanEdges();
  // Conectores huérfanos en medio («Café el · a las») — se quitan sólo los
  // que eran prefijo de un tramo consumido: aproximación por posición.
  title = words.join(' ').replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  title = title.replace(/^(?:el|on|the)\s+/i, (s) => (words.length > 1 ? '' : s));
  title = title.replace(/[,;:\-–]+$/, '').trim();

  // ── Componer el resultado ─────────────────────────────────────────────
  if (!date && recurrence && recurrence.byWeekday && recurrence.byWeekday.length) {
    const cur = dow0(today);
    let best = 7;
    for (const d of recurrence.byWeekday) best = Math.min(best, (d - cur + 7) % 7);
    date = addDays(today, best);
  }
  if (!time && part != null) time = { h: part, m: 0 };
  if (!date) {
    date = today;
    // «a las 9» cuando ya son las 10 → mañana.
    if (time && !recurrence && (time.h * 60 + time.m) < (now.getHours() * 60 + now.getMinutes())) date = addDays(today, 1);
  }
  let endDate = null;
  let end = null;
  if (time) {
    const s = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.h, time.m);
    let e;
    if (endTime) {
      e = new Date(date.getFullYear(), date.getMonth(), date.getDate(), endTime.h, endTime.m);
      if (e <= s) e = new Date(e.getTime() + DAY_MS);
    } else {
      e = new Date(s.getTime() + (durMin != null ? durMin : (kind === 'reminder' ? 0 : 60)) * 60000);
    }
    endDate = ymd(e);
    end = hm(e.getHours(), e.getMinutes());
    if (e.getTime() === s.getTime()) { end = null; endDate = null; }
  } else if (durMin != null && durMin >= 1440) {
    endDate = ymd(addDays(date, Math.round(durMin / 1440) - 1));
  }
  return {
    title,
    date: ymd(date),
    time: time ? hm(time.h, time.m) : null,
    endDate,
    endTime: end,
    allDay: !time,
    recurrence,
    kind,
    location,
    calendarHint,
    spans,
    matched: spans.length > 0,
  };
}
