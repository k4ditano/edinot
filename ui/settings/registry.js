// Estructura de Ajustes: grupos, secciones y el índice de filas que usa el
// buscador. Cada fila de una sección se pinta con rowProps(id), así que la
// etiqueta y la ayuda que se buscan son exactamente las que se ven.

import { t } from '../../i18n.js';
import { SHORTCUT_DEFS } from '../shared/shortcuts.js';

export const GROUPS = [
  { id: 'app', title: 'st.grp.app' },
  { id: 'data', title: 'st.grp.data' },
  { id: 'footer', title: null },
];

// Ocho secciones (antes trece). General reúne editor e idioma; Conexiones reúne
// MCP, Web Clipper y Google Calendar; Acerca de incluye el diagnóstico.
export const SECTIONS = [
  { id: 'general', group: 'app' },
  { id: 'appearance', group: 'app' },
  { id: 'shortcuts', group: 'app' },
  { id: 'vaults', group: 'data' },
  { id: 'sync', group: 'data' },
  { id: 'connections', group: 'data' },
  { id: 'meetings', group: 'data' },
  { id: 'about', group: 'footer' },
];
export const SECTION_IDS = SECTIONS.map(s => s.id);
export const sectionTitle = (id) => t(`st.sec.${id}`);
export const sectionDesc = (id) => t(`st.sec.${id}.d`);

// [id, sección, palabras clave extra (es + en)]. Etiqueta = st.row.<id>,
// ayuda = st.row.<id>.h.
const ROW_LIST = [
  ['about.version', 'about', 'versión version instalada installed acerca about edinot número number build'],
  ['about.updates', 'about', 'actualizar actualizaciones actualización update updates upgrade versión version nueva new buscar check comprobar descargar download instalar install reiniciar restart'],
  ['about.site', 'about', 'web sitio website github releases descargas downloads página page'],
  ['appearance.theme', 'appearance', 'tema theme claro light oscuro dark sistema system modo noche night'],
  ['appearance.moreThemes', 'appearance', 'más temas more themes sage cream paper sky rose lavender mint terra graphite midnight mocha plum colores'],
  ['appearance.accent', 'appearance', 'acento accent color colour personalizado custom'],
  ['appearance.font', 'appearance', 'fuente font letra tipografía typeface sans serif mono monospace'],
  ['appearance.size', 'appearance', 'tamaño size texto text fuente font zoom px'],
  ['appearance.width', 'appearance', 'ancho width lectura reading columna column estrecho narrow medio medium completo wide'],
  ['appearance.compact', 'appearance', 'compacta compact densidad density espacio spacing'],
  ['appearance.motion', 'appearance', 'animaciones animations movimiento motion transiciones transitions reducir reduce accesibilidad accessibility'],
  ['editor.newMode', 'general', 'modo mode nueva nota new note editar edit leer read render'],
  ['editor.autosave', 'general', 'autoguardar autosave guardar save disco disk'],
  ['editor.ruler', 'general', 'regla ruler línea line margen margin'],
  ['editor.vim', 'general', 'vim teclado keyboard modal'],
  ['editor.spellcheck', 'general', 'ortografía spelling corrector spellcheck diccionario dictionary'],
  ['editor.searchAll', 'general', 'buscar search todos all vaults'],
  ['language.lang', 'general', 'idioma language español spanish inglés english'],
  ['language.weekStart', 'general', 'semana week lunes monday domingo sunday sábado saturday calendario'],
  ['language.dateFormat', 'general', 'fecha date formato format dd/mm mm/dd iso'],
  ['shortcuts.list', 'shortcuts', 'atajos shortcuts teclas keys combinación keybinding'],
  ['shortcuts.reset', 'shortcuts', 'restablecer reset atajos shortcuts por defecto default'],
  ['vaults.list', 'vaults', 'vault crear create renombrar rename borrar delete activar activate color icono icon'],
  ['sync.devices', 'sync', 'equipos dispositivos devices emparejados paired revocar revoke quitar remove'],
  ['sync.addDevice', 'sync', 'añadir otro equipo add device código code qr emparejar pair enlace link'],
  ['sync.join', 'sync', 'unirme join código code emparejar pair hub servidor server otro equipo'],
  ['sync.status', 'sync', 'sincronización sync estado status servidor server conexión connection conectado connected'],
  ['sync.offlineFull', 'sync', 'sin conexión offline completo full adjuntos attachments descargar download'],
  ['sync.cacheMax', 'sync', 'caché cache tamaño size máximo max gb disco disk'],
  ['sync.cacheStats', 'sync', 'caché cache compactar compact borrar clear vaciar purge'],
  ['meetings.sttServer', 'meetings', 'reuniones meetings acta minutes servidor server transcribir transcribe transcripción transcription whisper url openai api'],
  ['meetings.sttKey', 'meetings', 'reuniones meetings clave key token api transcripción transcription'],
  ['meetings.sttModel', 'meetings', 'reuniones meetings modelo model whisper transcripción transcription voz audio'],
  ['meetings.llmSame', 'meetings', 'reuniones meetings mismo same servidor server clave key acta minutes'],
  ['meetings.llmServer', 'meetings', 'reuniones meetings acta minutes servidor server chat url openai api'],
  ['meetings.llmKey', 'meetings', 'reuniones meetings acta minutes clave key token api'],
  ['meetings.llmModel', 'meetings', 'reuniones meetings acta minutes modelo model gpt llm redactar write'],
  ['meetings.lang', 'meetings', 'reuniones meetings idioma language español english acta'],
  ['meetings.system', 'meetings', 'reuniones meetings audio sistema system altavoces speakers llamada call teams meet zoom micrófono microphone'],
  ['meetings.keep', 'meetings', 'reuniones meetings conservar keep audio grabación recording guardar borrar delete'],
  ['calendar.client', 'connections', 'google oauth client id secret cliente credenciales credentials'],
  ['calendar.account', 'connections', 'google conectar connect desconectar disconnect cuenta account'],
  ['calendar.calendar', 'connections', 'calendario calendar google principal primary'],
  ['calendar.targetVault', 'connections', 'vault destino target eventos events'],
  ['calendar.direction', 'connections', 'dirección direction importar import exportar export ambos both'],
  ['calendar.auto', 'connections', 'automática automatic auto sincronizar sync 10 minutos'],
  ['calendar.syncNow', 'connections', 'sincronizar ahora sync now'],
  ['agents.policy', 'connections', 'permisos permissions política policy vault permitir allow denegar deny'],
  ['agents.instructions', 'connections', 'instrucciones instructions ia ai guía guide prompt exportar importar'],
  ['agents.recallKey', 'connections', 'semántica semantic búsqueda search openai api key clave embeddings recall'],
  ['integrations.mcp', 'connections', 'mcp claude desktop codex claude code cursor configurar configure automático'],
  ['integrations.creds', 'connections', 'mcp credenciales credentials sesión session'],
  ['integrations.manual', 'connections', 'mcp manual json toml config snippet'],
  ['integrations.cli', 'connections', 'terminal cli comando command línea edinot instalar install consola shell'],
  ['integrations.clipper', 'connections', 'web clipper navegador browser extensión extension chrome firefox'],
  ['integrations.clipperToken', 'connections', 'web clipper token emparejar pair generar generate revocar revoke'],
  ['advanced.logs', 'about', 'log registro diagnóstico diagnostics errores errors copiar copy abrir open'],
  ['advanced.exportLogo', 'about', 'logo exportar export pdf html membrete letterhead imagen'],
  ['advanced.reset', 'about', 'restablecer reset interfaz layout caché cache limpiar clear'],
];

export const ROWS = ROW_LIST.map(([id, section, kw]) => ({ id, section, kw }));
export const ROW_BY_ID = Object.fromEntries(ROWS.map(r => [r.id, r]));

export function rowProps(id, extra) {
  return { id, label: t(`st.row.${id}`), help: t(`st.row.${id}.h`), ...(extra || {}) };
}

// Pestañas del antiguo modal → sección (y fila) nueva. setSettingsInitialTab()
// sigue aceptando los ids viejos; también «sección» o «sección:fila».
export const LEGACY_TABS = {
  general: ['general'],
  theme: ['appearance'],
  vaults: ['vaults'],
  sync: ['sync'],
  account: ['sync'],
  calendar: ['connections', 'calendar.client'],
  mcp: ['connections', 'integrations.mcp'],
  ai: ['connections', 'agents.policy'],
  recall: ['connections', 'agents.recallKey'],
  clipper: ['connections', 'integrations.clipper'],
  updates: ['about', 'about.updates'],
  about: ['about'],
  keys: ['shortcuts'],
};

// Secciones que existían antes de ordenar Ajustes → dónde viven ahora.
export const SECTION_ALIASES = {
  profile: 'sync', workspaces: 'sync', account: 'sync',
  editor: 'general', language: 'general',
  calendar: 'connections', agents: 'connections', integrations: 'connections',
  advanced: 'about',
};

const MOVED_ROWS = { 'advanced.updates': 'about.updates', 'advanced.about': 'about.site' };

export function resolveTarget(tab) {
  if (MOVED_ROWS[tab]) return { section: 'about', row: MOVED_ROWS[tab] };
  if (!tab || typeof tab !== 'string') return null;
  if (LEGACY_TABS[tab]) { const [section, row] = LEGACY_TABS[tab]; return { section, row: row || null }; }
  const [rawSection, row] = tab.split(':');
  // Lo que vivía en «Avanzado» (actualizaciones, acerca de) ahora está en «about».
  if (MOVED_ROWS[row]) return { section: 'about', row: MOVED_ROWS[row] };
  const section = SECTION_ALIASES[rawSection] || rawSection;
  if (SECTION_IDS.includes(section)) return { section, row: row || null };
  if (ROW_BY_ID[tab]) return { section: ROW_BY_ID[tab].section, row: tab };
  return null;
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Búsqueda: todas las palabras de la consulta deben aparecer en etiqueta,
// ayuda, palabras clave o título de la sección. Los atajos de teclado
// entran como filas de «Atajos».
export function searchSettings(query, { isElectron = true } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const entries = [
    ...ROWS.map(r => ({ id: r.id, section: r.section, label: t(`st.row.${r.id}`), help: t(`st.row.${r.id}.h`), kw: r.kw })),
    ...SHORTCUT_DEFS.filter(d => (isElectron || !d.electron) && !d.display).map(d => ({
      id: 'sc:' + d.id, section: 'shortcuts', label: t(d.label), help: t('st.sc.area.' + d.area), kw: 'atajo shortcut tecla key',
    })),
  ];
  const out = [];
  for (const e of entries) {
    const lab = fold(e.label);
    const hay = `${lab} ${fold(e.help)} ${fold(e.kw)} ${fold(sectionTitle(e.section))}`;
    if (!words.every(w => hay.includes(w))) continue;
    // Puntuación: coincidencia en la etiqueta > en el resto.
    const score = words.reduce((s, w) => s + (lab.startsWith(w) ? 4 : lab.includes(w) ? 2 : 0), 0);
    out.push({ ...e, score });
  }
  out.sort((a, b) => b.score - a.score || SECTION_IDS.indexOf(a.section) - SECTION_IDS.indexOf(b.section));
  return out;
}
