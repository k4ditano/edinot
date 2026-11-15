// Registro de comandos de Ctrl K. EdinotApp construye la lista con sus
// handlers (buildCommands(ctx)) cuando se abre la paleta; aquí sólo vive la
// forma de cada comando y el filtrado.
//
// Comando: { id, label, icon, kbd?, hint?, keywords?, suggested?, run }

import { t } from '../../i18n.js';
import { kbdHint } from '../shared/shortcuts.js';

export function buildCommands(c) {
  const list = [];
  const add = (cmd) => { if (cmd && cmd.when !== false) list.push(cmd); };
  const isMac = c.isMac;
  add({ id: 'new-note', label: t('cmd.newNote'), icon: 'note', kbd: kbdHint('newNote', isMac), suggested: true, when: c.canEdit, run: c.newNote, keywords: 'crear nota new note' });
  add({ id: 'new-db', label: t('cmd.newDatabase'), icon: 'database', when: c.canEdit, run: c.newDatabase, keywords: 'tabla table base datos' });
  add({ id: 'new-folder', label: t('cmd.newFolder'), icon: 'folderPlus', when: c.canEdit, run: c.newFolder, keywords: 'carpeta folder' });
  add({ id: 'from-template', label: t('cmd.fromTemplate'), icon: 'template', when: c.canEdit && c.hasTemplates, run: c.fromTemplate, keywords: 'plantilla template' });
  add({ id: 'today', label: t('cmd.today'), icon: 'today', suggested: true, run: c.openToday, keywords: 'hoy diario daily journal' });
  add({ id: 'home', label: t('cmd.home'), icon: 'home', run: c.goHome, keywords: 'inicio home' });
  add({ id: 'calendar', label: t('cmd.calendar'), icon: 'calendar', kbd: kbdHint('calendar', isMac), suggested: true, run: c.openCalendar, keywords: 'calendario recordatorios eventos' });
  add({ id: 'settings', label: t('cmd.settings'), icon: 'settings', run: c.openSettings, keywords: 'ajustes preferencias settings' });
  add({ id: 'theme', label: c.dark ? t('cmd.themeLight') : t('cmd.themeDark'), icon: c.dark ? 'sun' : 'moon', suggested: true, run: c.toggleTheme, keywords: 'tema oscuro claro dark light' });
  add({ id: 'sidebar', label: t('cmd.toggleSidebar'), icon: 'sidebar', kbd: kbdHint('sidebar', isMac), run: c.toggleSidebar, keywords: 'barra lateral sidebar' });
  add({ id: 'panel', label: t('cmd.togglePanel'), icon: 'panel', kbd: kbdHint('panel', isMac), when: c.hasNote, run: c.togglePanel, keywords: 'panel contexto' });
  add({ id: 'import', label: t('cmd.import'), icon: 'import', kbd: kbdHint('import', isMac), when: c.canEdit && c.canImport, run: c.importFiles, keywords: 'importar import' });
  if (c.hasNote) {
    // Página ↔ Canvas (1.2): «Nuevo canvas» ya no es un tipo aparte; cualquier
    // nota se ve como canvas.
    if (c.setSurface) add(c.surface === 'canvas'
      ? { id: 'surface-page', label: t('cmd.surfacePage'), icon: 'note', kbd: kbdHint('surface', isMac), suggested: true, run: () => c.setSurface('page'), keywords: 'pagina documento page doc canvas' }
      : { id: 'surface-canvas', label: t('cmd.surfaceCanvas'), icon: 'canvas', kbd: kbdHint('surface', isMac), suggested: true, run: () => c.setSurface('canvas'), keywords: 'canvas pizarra whiteboard tablero edgeless' });
    add({ id: 'mode-read', label: t('cmd.modeRead'), icon: 'eye', run: () => c.setMode('render'), keywords: 'leer render' });
    add({ id: 'mode-edit', label: t('cmd.modeEdit'), icon: 'edit', when: c.canEditNote, run: () => c.setMode('live'), keywords: 'editar live' });
    add({ id: 'mode-split', label: t('cmd.modeSplit'), icon: 'split', when: c.canEditNote, run: () => c.setMode('dual'), keywords: 'dividido dual' });
    add({ id: 'mode-md', label: t('cmd.modeMarkdown'), icon: 'code', kbd: kbdHint('toggleRender', isMac), when: c.canEditNote, run: () => c.setMode('markdown'), keywords: 'markdown fuente source' });
    add({ id: 'share', label: t('cmd.share'), icon: 'share', kbd: kbdHint('share', isMac), when: c.canShare, run: c.share, keywords: 'compartir share enlace' });
    add({ id: 'history', label: t('cmd.history'), icon: 'history', kbd: kbdHint('history', isMac), when: c.canHistory, run: c.history, keywords: 'historial versiones history' });
    add({ id: 'comments', label: t('cmd.comments'), icon: 'comment', run: c.openComments, keywords: 'comentarios comments' });
    add({ id: 'fav', label: c.isPinned ? t('shell.fav.remove') : t('shell.fav.add'), icon: 'star', run: c.togglePin, keywords: 'favorito fijar pin' });
    add({ id: 'rename', label: t('cmd.rename'), icon: 'edit', when: c.canEditNote, run: c.rename, keywords: 'renombrar rename' });
    if (c.canExport) {
      add({ id: 'exp-pdf', label: t('cmd.export', { fmt: 'PDF' }), icon: 'download', run: () => c.exportNote('pdf'), keywords: 'exportar export pdf' });
      add({ id: 'exp-docx', label: t('cmd.export', { fmt: 'Word' }), icon: 'download', run: () => c.exportNote('docx'), keywords: 'exportar export word docx' });
      add({ id: 'exp-html', label: t('cmd.export', { fmt: 'HTML' }), icon: 'download', run: () => c.exportNote('html'), keywords: 'exportar export html' });
      add({ id: 'exp-md', label: t('cmd.export', { fmt: 'Markdown' }), icon: 'download', run: () => c.exportNote('md'), keywords: 'exportar export markdown md' });
    }
    add({ id: 'present', label: t('tb.present'), icon: 'present', when: c.canFloat && !c.isCanvas, run: () => c.floatOpen('present'), keywords: 'presentar teleprompter' });
  }
  add({ id: 'quicknote', label: t('tb.quicknote'), icon: 'quick', when: c.canFloat, run: () => c.floatOpen('note'), keywords: 'nota rapida flotante' });
  return list;
}

// Filtra por la etiqueta y las palabras clave, plegando acentos. Los que
// empiezan por la consulta van primero.
export function filterCommands(commands, query, fold) {
  const q = fold(String(query || '').trim().toLowerCase());
  if (!q) return commands;
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const c of commands) {
    const label = fold(String(c.label || '').toLowerCase());
    const hay = label + ' ' + fold(String(c.keywords || '').toLowerCase());
    if (!terms.every(term => hay.includes(term))) continue;
    const score = label.startsWith(q) ? 3 : label.includes(q) ? 2 : 1;
    scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.c);
}
