// Idioma y región (Ajustes → Idioma y región): primer día de la semana y
// formato de fecha. Se guardan en ySettings (weekStart, dateFormat) y se
// leen aquí para que cualquier vista (calendario, Inicio, panel) los use sin
// recibir props.

import { ySettings } from '../../store.js';
import { getLang } from '../../i18n.js';

export const WEEK_STARTS = ['mon', 'sun', 'sat'];
export const DATE_FORMATS = ['auto', 'dmy', 'mdy', 'ymd'];

// 0 = domingo … 6 = sábado (como Date.getDay()).
export function getWeekStartDay() {
  let v = 'mon';
  try { v = ySettings.get('weekStart') || 'mon'; } catch {}
  return v === 'sun' ? 0 : v === 'sat' ? 6 : 1;
}

export function getDateFormat() {
  try { const v = ySettings.get('dateFormat'); return DATE_FORMATS.includes(v) ? v : 'auto'; } catch { return 'auto'; }
}

const pad = (n) => String(n).padStart(2, '0');

// Fecha numérica corta según el formato elegido («auto» = la del idioma).
export function formatShortDate(ts, fmt = getDateFormat()) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const D = pad(d.getDate()), M = pad(d.getMonth() + 1), Y = d.getFullYear();
  if (fmt === 'dmy') return `${D}/${M}/${Y}`;
  if (fmt === 'mdy') return `${M}/${D}/${Y}`;
  if (fmt === 'ymd') return `${Y}-${M}-${D}`;
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'es-ES');
}
