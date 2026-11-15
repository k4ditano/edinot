// Registro de atajos de teclado de Edinot.
//
// Un atajo es una combinación normalizada «Mod+Shift+Alt+K», donde Mod es
// Ctrl (Windows/Linux) o ⌘ (macOS) — el manejador del App acepta los dos,
// como siempre. Las teclas se guardan por su posición física cuando es una
// letra, un dígito o un signo con `code` conocido (así Ctrl \ funciona en
// teclados con AltGr), y si no por `key`.
//
// Los valores por defecto viven aquí; las personalizaciones del usuario se
// guardan en ySettings.shortcuts = { [id]: combo | '' } ('' = desactivado).
// El keydown global de editor.jsx llama a matchShortcut() con las
// combinaciones efectivas, y los atajos que además son aceleradores del
// menú de Electron (Archivo → Nuevo, Guardar…) se envían a main con
// menuAccelerators() para que el menú use la misma combinación.

export const SHORTCUT_AREAS = ['general', 'view', 'editor', 'format', 'note', 'file', 'fixed'];

// label: clave i18n. menu: id del item del menú de Electron que comparte la
// combinación. electron: sólo existe en la app de escritorio. fixed: no se
// puede cambiar (lo maneja CodeMirror, el buscador o el sistema).
export const SHORTCUT_DEFS = [
  { id: 'palette',      area: 'general', label: 'sc.palette',      combo: 'Mod+K' },
  { id: 'finder',       area: 'general', label: 'sc.finder',       combo: 'Mod+T' },
  { id: 'finderAlt',    area: 'general', label: 'sc.finderAlt',    combo: 'Mod+P' },
  // (1.2) Ctrl/⌘ F busca en la nota o el canvas abierto; todas las notas, con ⇧.
  // Si alguien tenía alguno de los dos cambiado, su combinación se respeta (y si
  // dejó «globalSearch» en Mod+F a mano, gana: va antes en esta lista).
  { id: 'globalSearch', area: 'general', label: 'sc.globalSearch', combo: 'Mod+Shift+F' },
  { id: 'newNote',      area: 'general', label: 'sc.newNote',      combo: 'Mod+N', menu: 'new' },
  { id: 'calendar',     area: 'general', label: 'sc.calendar',     combo: 'F1' },
  { id: 'sidebar',      area: 'view',    label: 'sc.sidebar',      combo: 'Mod+\\' },
  { id: 'panel',        area: 'view',    label: 'sc.panel',        combo: 'Mod+J' },
  { id: 'toggleRender', area: 'editor',  label: 'sc.toggleRender', combo: 'Mod+/', menu: 'toggleRender' },
  { id: 'toggleLive',   area: 'editor',  label: 'sc.toggleLive',   combo: 'Mod+Shift+/' },
  { id: 'surface',      area: 'editor',  label: 'sc.surface',      combo: 'Alt+S' },
  { id: 'localSearch',  area: 'editor',  label: 'sc.localSearch',  combo: 'Mod+F' },
  { id: 'bold',         area: 'format',  label: 'sc.bold',         combo: 'Mod+B' },
  { id: 'italic',       area: 'format',  label: 'sc.italic',       combo: 'Mod+I' },
  { id: 'underline',    area: 'format',  label: 'sc.underline',    combo: 'Mod+U' },
  { id: 'history',      area: 'note',    label: 'sc.history',      combo: 'Mod+Shift+H' },
  { id: 'share',        area: 'note',    label: 'sc.share',        combo: 'Mod+Shift+L' },
  { id: 'tplBuilder',   area: 'note',    label: 'sc.tplBuilder',   combo: 'Mod+Shift+T' },
  { id: 'openDisk',     area: 'file',    label: 'sc.openDisk',     combo: 'Mod+O', menu: 'open', electron: true },
  { id: 'import',       area: 'file',    label: 'sc.import',       combo: 'Mod+Alt+I', menu: 'import', electron: true },
  { id: 'save',         area: 'file',    label: 'sc.save',         combo: 'Mod+S', menu: 'save', electron: true },
  { id: 'saveAs',       area: 'file',    label: 'sc.saveAs',       combo: 'Mod+Shift+S', menu: 'saveAs', electron: true },
  { id: 'exportBundle', area: 'file',    label: 'sc.exportBundle', combo: 'Mod+Alt+Shift+S', menu: 'exportBundle', electron: true },
  { id: 'hideWindow',   area: 'file',    label: 'sc.hideWindow',   combo: 'Mod+W', menu: 'hideTray', electron: true },
  // No reasignables.
  { id: 'linkSel',      area: 'fixed', label: 'sc.linkSel',     combo: null, follows: 'palette', fixed: true },
  { id: 'undo',         area: 'fixed', label: 'sc.undo',        combo: 'Mod+Z', fixed: true },
  { id: 'redo',         area: 'fixed', label: 'sc.redo',        combo: 'Mod+Shift+Z', fixed: true },
  { id: 'redoAlt',      area: 'fixed', label: 'sc.redo',        combo: 'Mod+Y', fixed: true },
  { id: 'escToRender',  area: 'fixed', label: 'sc.escToRender', combo: 'Escape', fixed: true },
  { id: 'iToMarkdown',  area: 'fixed', label: 'sc.iToMarkdown', combo: 'I', fixed: true },
  { id: 'navFinder',    area: 'fixed', label: 'sc.navFinder',   combo: 'ArrowUp ArrowDown', fixed: true, display: true },
  { id: 'openFocused',  area: 'fixed', label: 'sc.openFocused', combo: 'Enter', fixed: true, display: true },
  { id: 'indent',       area: 'fixed', label: 'sc.indent',      combo: 'Tab', fixed: true, display: true },
  { id: 'closeModal',   area: 'fixed', label: 'sc.closeModal',  combo: 'Escape', fixed: true, display: true },
];

export const SHORTCUT_BY_ID = Object.fromEntries(SHORTCUT_DEFS.map(d => [d.id, d]));

const MOD_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'];

// Normaliza «shift+mod+k» → «Mod+Shift+K». Devuelve '' si no es válido.
export function normalizeCombo(combo) {
  if (!combo || typeof combo !== 'string') return '';
  const parts = combo.split('+');
  // «Mod++» (la tecla +) — el último trozo vacío es la tecla.
  let key = parts.pop();
  if (key === '' && parts.length && parts[parts.length - 1] === '') { parts.pop(); key = '+'; }
  const mods = new Set(parts.map(p => {
    const l = p.trim().toLowerCase();
    if (l === 'mod' || l === 'cmd' || l === 'cmdorctrl' || l === 'meta') return 'Mod';
    if (l === 'ctrl' || l === 'control') return 'Mod';
    if (l === 'alt' || l === 'option') return 'Alt';
    if (l === 'shift') return 'Shift';
    return null;
  }).filter(Boolean));
  if (!key) return '';
  const k = key.length === 1 ? key.toUpperCase() : key;
  return [...MOD_ORDER.filter(m => mods.has(m)), k].join('+');
}

const CODE_KEYS = {
  Backslash: '\\', Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', IntlBackslash: '<',
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
};

function keyFromCode(code) {
  if (!code) return null;
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^(F\d{1,2})$/.exec(code); if (m) return m[1];
  return CODE_KEYS[code] || null;
}

function keyFromKey(key) {
  if (!key) return null;
  if (key === ' ') return 'Space';
  if (key === 'Esc') return 'Escape';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export const isModifierKey = (key) => key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta' || key === 'AltGraph' || key === 'OS';

function modsOf(e, { shift = true, alt = true } = {}) {
  const out = [];
  if (e.metaKey || e.ctrlKey) out.push('Mod');
  if (alt && e.altKey) out.push('Alt');
  if (shift && e.shiftKey) out.push('Shift');
  return out;
}

// Combinación «canónica» de un evento (la que se graba al reasignar).
export function comboFromEvent(e) {
  if (!e || isModifierKey(e.key)) return '';
  const k = keyFromCode(e.code) || keyFromKey(e.key);
  if (!k) return '';
  return [...modsOf(e), k].join('+');
}

// Candidatas, de más a menos estricta: posición física, carácter producido,
// y el carácter sin Shift/AltGr (en teclado español «/» es Shift+7 y «\» es
// AltGr+º: el atajo por defecto Ctrl / sigue funcionando).
function candidates(e) {
  const out = [];
  const push = (c) => { if (c && !out.includes(c)) out.push(c); };
  const byCode = keyFromCode(e.code);
  const byKey = keyFromKey(e.key);
  if (byCode) push([...modsOf(e), byCode].join('+'));
  if (byKey) push([...modsOf(e), byKey].join('+'));
  if (byKey && byKey.length === 1 && !/[A-Z0-9]/.test(byKey)) {
    const altGr = e.ctrlKey && e.altKey && !e.metaKey;
    push([...modsOf(e, { shift: false, alt: !altGr }), byKey].join('+'));
    push([...modsOf(e, { shift: false }), byKey].join('+'));
  }
  return out;
}

// Mapa id → combinación efectiva ('' = sin atajo) a partir de los overrides.
export function effectiveBindings(overrides) {
  const ov = (overrides && typeof overrides === 'object') ? overrides : {};
  const out = {};
  for (const d of SHORTCUT_DEFS) {
    if (d.fixed) { out[d.id] = d.follows ? null : d.combo; continue; }
    if (Object.prototype.hasOwnProperty.call(ov, d.id)) out[d.id] = normalizeCombo(ov[d.id]);
    else out[d.id] = d.combo;
  }
  for (const d of SHORTCUT_DEFS) if (d.follows) out[d.id] = out[d.follows];
  return out;
}

// Índice combo → [ids] de los atajos reasignables (y los fijos que se
// disparan de verdad), para detectar conflictos y para el manejador.
function reverseIndex(bindings, { includeFixed = true } = {}) {
  const idx = new Map();
  for (const d of SHORTCUT_DEFS) {
    if (d.follows || d.display) continue;
    if (d.fixed && !includeFixed) continue;
    const c = bindings[d.id];
    if (!c) continue;
    if (!idx.has(c)) idx.set(c, []);
    idx.get(c).push(d.id);
  }
  return idx;
}

// Devuelve el id del atajo reasignable que corresponde al evento, o null.
// Los «electron» sólo se resuelven aquí si no los atiende el menú (web).
export function matchShortcut(e, bindings) {
  if (!e || isModifierKey(e.key)) return null;
  const idx = reverseIndex(bindings, { includeFixed: false });
  for (const c of candidates(e)) {
    const ids = idx.get(c);
    if (ids && ids.length) return ids[0];
  }
  return null;
}

// Conflictos: { [id]: [otros ids con la misma combinación] }.
export function findConflicts(bindings) {
  const idx = reverseIndex(bindings);
  const out = {};
  for (const ids of idx.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) out[id] = ids.filter(x => x !== id);
  }
  return out;
}

// ¿Qué atajo (además de `exceptId`) usa ya esta combinación?
export function whoUses(combo, bindings, exceptId) {
  const c = normalizeCombo(combo);
  if (!c) return [];
  return SHORTCUT_DEFS.filter(d => !d.follows && !d.display && d.id !== exceptId && bindings[d.id] === c).map(d => d.id);
}

// Un atajo sin Mod/Alt de una sola tecla imprimible no debe dispararse
// mientras se escribe.
export function isBareTypingCombo(combo) {
  if (!combo) return false;
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const hasMod = parts.includes('Mod') || parts.includes('Alt');
  return !hasMod && key.length === 1;
}

// Combinación → acelerador de Electron («Mod+Shift+S» → «CmdOrCtrl+Shift+S»).
export function toAccelerator(combo) {
  const c = normalizeCombo(combo);
  if (!c) return null;
  const parts = c.split('+');
  const key = parts.pop();
  const map = { Mod: 'CmdOrCtrl', Alt: 'Alt', Shift: 'Shift' };
  const keyMap = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Enter: 'Return', '+': 'Plus' };
  return [...parts.map(p => map[p]).filter(Boolean), keyMap[key] || key].join('+');
}

// { menuItemId: accelerator|null } para los atajos ligados al menú.
export function menuAccelerators(bindings) {
  const out = {};
  for (const d of SHORTCUT_DEFS) if (d.menu) out[d.menu] = bindings[d.id] ? toAccelerator(bindings[d.id]) : null;
  return out;
}

const MAC_GLYPH = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const KEY_LABEL = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↵', Escape: 'Esc', Space: 'Espacio', Backspace: '⌫', Delete: 'Supr' };

// Combinación → lista de teclas para pintar (<kbd> por tecla).
export function comboKeys(combo, isMac) {
  if (!combo) return [];
  if (combo.includes(' ')) return combo.split(' ').map(k => KEY_LABEL[k] || k);
  const parts = combo.split('+');
  const key = parts.pop();
  const mods = parts.map(p => (isMac ? MAC_GLYPH[p] : (p === 'Mod' ? 'Ctrl' : p)) || p);
  return [...mods, KEY_LABEL[key] || key];
}

export function formatCombo(combo, isMac) {
  const keys = comboKeys(combo, isMac);
  return isMac ? keys.join('') : keys.join('+');
}

// Estado de módulo para que otras vistas (títulos de botones, menús) puedan
// mostrar la combinación vigente sin recibir props.
let currentBindings = effectiveBindings({});
export function setActiveBindings(b) { currentBindings = b || effectiveBindings({}); }
export function getBinding(id) { return currentBindings[id] || ''; }
export function shortcutLabel(id, isMac) { return formatCombo(getBinding(id), isMac); }
// «Ctrl K» / «⌘ K» para pistas de botones y menús ('' si no hay atajo).
export function kbdHint(id, isMac) { return comboKeys(getBinding(id), isMac).join(' '); }
export function withKbd(label, id, isMac) { const k = kbdHint(id, isMac); return k ? `${label} (${k})` : label; }
