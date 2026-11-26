// Propiedades de la nota — el mismo comentario oculto que escribe el MCP
// (set_note_property):
//   <!-- edinot:props estado=En curso; fecha=2026-10-24; responsable=Laura -->
// Parse/serialize idénticos a srvParseProps/srvSerializeProps/srvWriteProps
// de mcp/server.mjs para que la UI y los agentes lean y escriban lo mismo.
// El tipo de cada propiedad se infiere del nombre y del valor; si el usuario
// elige uno que no se deduce (p. ej. «select» con un nombre libre) se guarda
// en la clave reservada `_types` (clave:tipo,…), que la UI no muestra.

import { t } from '../../i18n.js';
import { coverHtml, coverAddHtml } from './cover.js';
import { svg } from './icons.js';

export const PROPS_RE = /^[ \t]*<!--\s*edinot:props\s+(.*?)\s*-->[ \t]*$/;
export const PROP_TYPES = ['text', 'status', 'select', 'date', 'person', 'tags', 'checkbox', 'number', 'url'];
export const TYPES_KEY = '_types';

export function parseProps(content) {
  const lines = String(content || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PROPS_RE);
    if (!m) continue;
    const props = {};
    for (const part of m[1].split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) props[k] = v;
    }
    return { props, lineIdx: i };
  }
  return { props: {}, lineIdx: -1 };
}

export function parsePropsLine(line) {
  const m = String(line || '').match(PROPS_RE);
  if (!m) return {};
  const props = {};
  for (const part of m[1].split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    if (k) props[k] = part.slice(eq + 1).trim();
  }
  return props;
}

const clean = (v) => String(v).replace(/[;\n]/g, ' ').replace(/-->/g, '—>').trim();

export function serializeProps(props) {
  const pairs = Object.entries(props)
    .filter(([k, v]) => k && v != null && String(v) !== '')
    .map(([k, v]) => `${clean(k).replace(/=/g, '-')}=${clean(v)}`);
  return pairs.length ? `<!-- edinot:props ${pairs.join('; ')} -->` : null;
}

export function writeProps(content, props) {
  const lines = String(content || '').split('\n');
  const { lineIdx } = parseProps(content);
  const line = serializeProps(props);
  if (lineIdx >= 0) {
    if (line) lines[lineIdx] = line; else lines.splice(lineIdx, 1);
  } else if (line) {
    const insertAt = (lines[0] && /^#\s/.test(lines[0].trim())) ? 1 : 0;
    lines.splice(insertAt, 0, line);
  }
  return lines.join('\n');
}

// ── Tipos ────────────────────────────────────────────────────────────────
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const KEY_HINTS = [
  [/^(estado|status|state|fase|etapa|stage)$/, 'status'],
  [/^(prioridad|priority|tipo|type|categoria|category|area)$/, 'select'],
  [/^(fecha|date|due|vence|vencimiento|deadline|plazo|inicio|fin|start|end|entrega|creado|created)$/, 'date'],
  [/^(responsable|owner|assignee|asignado|persona|person|autor|author|quien)$/, 'person'],
  [/^(tags?|etiquetas?|labels?)$/, 'tags'],
  [/^(url|link|enlace|web|website)$/, 'url'],
  [/^(hecho|done|completado|completed|archivado|archived)$/, 'checkbox'],
];

export function parseTypes(props) {
  const out = {};
  const raw = props && props[TYPES_KEY];
  if (!raw) return out;
  for (const part of String(raw).split(',')) {
    const i = part.lastIndexOf(':');
    if (i <= 0) continue;
    const k = decodeURIComponent(part.slice(0, i).trim());
    const ty = part.slice(i + 1).trim();
    if (PROP_TYPES.includes(ty)) out[k] = ty;
  }
  return out;
}

export function serializeTypes(types) {
  const parts = Object.entries(types).filter(([, v]) => v).map(([k, v]) => `${encodeURIComponent(k)}:${v}`);
  return parts.join(',');
}

export function inferType(key, value, types) {
  if (types && types[key]) return types[key];
  const k = fold(key);
  for (const [re, ty] of KEY_HINTS) if (re.test(k)) return ty;
  const v = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(v)) return 'date';
  if (/^(true|false|sí|si|no|yes|x|✓)$/i.test(v)) return 'checkbox';
  if (/^-?\d+(?:[.,]\d+)?$/.test(v)) return 'number';
  if (/^https?:\/\//i.test(v)) return 'url';
  return 'text';
}

// ¿El tipo elegido se volvería a deducir solo? Si no, hay que guardarlo.
export function typeNeedsHint(key, value, type) {
  return inferType(key, value, null) !== type;
}

export function isTruthy(v) { return /^(true|sí|si|yes|x|✓|1)$/i.test(String(v || '').trim()); }

export function splitTags(v) {
  return String(v || '').split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
}

export function formatDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return String(v || '');
  try {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return String(v); }
}

const STATUS_TONES = [
  [/^(hecho|done|completad[oa]|terminad[oa]|cerrad[oa]|closed|resuelt[oa]|ok|listo)$/, 'ok'],
  [/^(en curso|en progreso|in progress|doing|activo|active|abierto|open|wip)$/, 'go'],
  [/^(bloquead[oa]|blocked|cancelad[oa]|cancelled|canceled|riesgo|urgente|alta|high)$/, 'bad'],
  [/^(en pausa|paused|pausad[oa]|esperando|waiting|revisión|review|media|medium)$/, 'warn'],
];
export function statusTone(v) {
  const f = fold(v).trim();
  for (const [re, tone] of STATUS_TONES) if (re.test(f)) return tone;
  return 'neutral';
}

export function personColor(name) {
  const palette = ['#3F6FA8', '#4C6C40', '#9A5B2E', '#7A5FA8', '#2F8A68', '#A8453F', '#5E6A7A'];
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return palette[h % palette.length];
}

export const TYPE_ICON = {
  text: 'textProp', status: 'status', select: 'select', date: 'date', person: 'person',
  tags: 'tag', checkbox: 'check', number: 'number', url: 'url',
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function visibleEntries(props) {
  return Object.entries(props || {}).filter(([k]) => k !== TYPES_KEY);
}

function valueHtml(type, v) {
  if (v === '' || v == null) return `<span class="blk-prop-empty">${esc(t('blk.props.empty'))}</span>`;
  switch (type) {
    case 'status': case 'select':
      return `<span class="blk-pill tone-${type === 'status' ? statusTone(v) : 'neutral'}">${esc(v)}</span>`;
    case 'date': return `<span class="blk-prop-date">${esc(formatDate(v))}</span>`;
    case 'person':
      return String(v).split(',').map(s => s.trim()).filter(Boolean).map(p =>
        `<span class="blk-person"><span class="blk-avatar" style="background:${personColor(p)}">${esc(p.replace(/^@/, '').slice(0, 1).toUpperCase())}</span>${esc(p.replace(/^@/, ''))}</span>`).join('');
    case 'tags': return splitTags(v).map(tg => `<span class="blk-tag">#${esc(tg)}</span>`).join('');
    case 'checkbox': return `<span class="blk-check${isTruthy(v) ? ' on' : ''}" role="checkbox" aria-checked="${isTruthy(v)}"></span>`;
    case 'url': return `<a class="blk-prop-url" href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(String(v).replace(/^https?:\/\//, ''))}</a>`;
    default: return esc(v);
  }
}

// Propiedad que guarda las etiquetas de la nota (la primera de tipo «tags»).
export function tagsKey(props) {
  const types = parseTypes(props);
  for (const [k, v] of visibleEntries(props)) if (inferType(k, v, types) === 'tags') return k;
  return null;
}

// Etiquetas como chips bajo el título (× para quitar, «+ Etiqueta»). Clics
// delegados con data-blk-tag / data-blk-tag-rm / data-blk-tag-add.
function tagsHtml(props, editable) {
  const key = tagsKey(props);
  const tags = key ? splitTags(props[key]) : [];
  if (!tags.length && !editable) return '';
  const chips = tags.map(tg => `<span class="blk-tagchip" data-blk-tag="${esc(tg)}"${editable ? ' role="button" tabindex="0"' : ''}>#${esc(tg)}`
    + (editable ? `<button type="button" class="blk-tagchip-x blk-noexport" data-blk-tag-rm="${esc(tg)}" aria-label="${esc(t('blk.tags.remove', { tag: tg }))}">×</button>` : '')
    + `</span>`).join('');
  const add = editable
    ? `<button type="button" class="blk-tag-add blk-noexport" data-blk-tag-add="1">${svg('plus', 14, 2)}${esc(t('blk.tags.add'))}</button>`
    : '';
  return `<div class="blk-tags${tags.length ? '' : ' empty'}" data-blk-tags="1">${chips}${add}</div>`;
}

// HTML estático de la lista de propiedades (lo comparten Leer y Editar; los
// clics se delegan con data-blk-prop / data-blk-prop-add).
export function propsHtml(props, { editable = true } = {}) {
  const types = parseTypes(props);
  const tk = tagsKey(props);
  const entries = visibleEntries(props).filter(([k]) => k !== tk);
  let rows = '';
  for (const [k, v] of entries) {
    const ty = inferType(k, v, types);
    rows += `<div class="blk-prop" data-blk-prop="${esc(k)}" data-type="${ty}"${editable ? ' tabindex="0" role="button"' : ''}>`
      + `<dt>${svg(TYPE_ICON[ty] || 'textProp', 14)}<span>${esc(k)}</span></dt>`
      + `<dd>${valueHtml(ty, v)}</dd></div>`;
  }
  const add = editable
    ? `<button type="button" class="blk-prop-add blk-noexport" data-blk-prop-add="1">${svg('plus', 14, 2)}${esc(t('blk.props.add'))}</button>`
    : '';
  return `<div class="blk-props${entries.length ? '' : ' empty'}" data-blk-props="1">`
    + tagsHtml(props, editable)
    + (entries.length ? `<dl class="blk-props-list">${rows}</dl>` : '')
    + add
    + (entries.length ? '<div class="blk-props-rule"></div>' : '')
    + `</div>`;
}

// Icono de página (emoji guardado en el meta del fichero, el mismo del árbol).
export function pageIconHtml(icon, { editable = true } = {}) {
  if (icon) {
    return `<div class="blk-page-icon has" data-blk-icon="1"${editable ? ' role="button" tabindex="0"' : ''} title="${esc(t('blk.icon.change'))}"><span>${esc(icon)}</span></div>`;
  }
  if (!editable) return '';
  return `<div class="blk-page-icon none blk-noexport" data-blk-icon="1" role="button" tabindex="0"><span class="blk-page-icon-add">${svg('emoji', 14)}${esc(t('blk.icon.add'))}</span></div>`;
}

// Leer: inserta icono + propiedades en el DOM ya renderizado de .md-render
// (en el mismo orden que Editar: icono, título H1, propiedades, cuerpo).
export function injectPageHeader(root, { content, icon, cover, title, editable, onIcon, onCover, onProp, onAdd, onTag }) {
  if (!root) return;
  root.querySelectorAll(':scope > .blk-page-head, :scope > .blk-props, :scope > .blk-page-title, :scope > .blk-cover').forEach(el => el.remove());
  const { props } = parseProps(content);
  const first = root.firstElementChild;
  const hasH1 = !!(first && first.tagName === 'H1');
  const head = document.createElement('div');
  head.className = 'blk-page-head';
  head.innerHTML = pageIconHtml(icon, { editable }) + coverAddHtml(cover, { editable });
  root.insertBefore(head, root.firstChild);
  if (cover) {
    const c = document.createElement('div');
    c.innerHTML = coverHtml(cover, { editable });
    const coverEl = c.firstElementChild;
    root.insertBefore(coverEl, head);
    coverEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-blk-cover]');
      if (b && onCover) onCover(b.getAttribute('data-blk-cover'), b.getBoundingClientRect());
    });
  }
  let anchor = head;
  if (!hasH1 && title) {
    const h = document.createElement('h1');
    h.className = 'md-h md-h1 blk-page-title';
    h.textContent = title;
    head.after(h);
    anchor = h;
  } else if (hasH1) anchor = first;
  const tmp = document.createElement('div');
  tmp.innerHTML = propsHtml(props, { editable });
  const propsEl = tmp.firstElementChild;
  anchor.after(propsEl);
  if (!editable) return;
  head.addEventListener('click', (e) => {
    const cv = e.target.closest('[data-blk-cover]');
    if (cv && onCover) { onCover(cv.getAttribute('data-blk-cover'), cv.getBoundingClientRect()); return; }
    const el = e.target.closest('[data-blk-icon]');
    if (el && onIcon) onIcon(el.getBoundingClientRect());
  });
  propsEl.addEventListener('click', (e) => {
    if (e.target.closest('a.blk-prop-url')) return;
    if (onTag && tagClick(e.target, onTag)) return;
    const add = e.target.closest('[data-blk-prop-add]');
    if (add) { onAdd && onAdd(add.getBoundingClientRect()); return; }
    const row = e.target.closest('[data-blk-prop]');
    if (row && onProp) onProp(row.getAttribute('data-blk-prop'), row.querySelector('dd').getBoundingClientRect());
  });
}

// Clic en la fila de etiquetas (Leer y Editar). `emit(acción, datos)` con
// acción 'add' | 'remove' | 'open'. Devuelve true si lo ha atendido.
export function tagClick(target, emit) {
  const rm = target.closest('[data-blk-tag-rm]');
  if (rm) { emit('remove', { tag: rm.getAttribute('data-blk-tag-rm') }); return true; }
  const add = target.closest('[data-blk-tag-add]');
  if (add) { emit('add', { rect: add.getBoundingClientRect() }); return true; }
  const chip = target.closest('[data-blk-tag]');
  if (chip) { emit('open', { tag: chip.getAttribute('data-blk-tag') }); return true; }
  return false;
}
