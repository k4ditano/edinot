// Barra lateral del shell (260px) y su modo carril (60px).
//
// Corta y de un vistazo, como AFFiNE: arriba el selector de workspace/vault y
// la navegación fija (Buscar · Inicio · Todas las notas · Hoy · Calendario ·
// Agentes); en medio, lo que se desplaza, en secciones que se pliegan y
// recuerdan su estado por vault: Favoritos, Organizar (carpetas y lo que hay
// dentro), Etiquetas (plegada), Colecciones, Bases de datos (plegada) y, la
// última, «Otros» (Papelera, Plantillas, Importar, plegada). El pie es una sola
// fila: Ajustes a la izquierda y, a la derecha, el aviso «Actualizar» (si hay
// una versión nueva) y el indicador de sincronización. La cuenta y el inicio
// de sesión están en el menú del espacio de arriba.
// Las notas sueltas en la raíz del vault NO se listan aquí: están en «Todas las
// notas» (la fila «Sin carpeta» de Organizar lleva allí con ese filtro).
// Toda la lógica de negocio (crear, mover, renombrar, borrar…) llega por
// `actions` desde EdinotApp — aquí sólo hay presentación, teclado y
// arrastrar-y-soltar.
//
// Rendimiento: el índice del árbol se memoiza por identidad de
// `files`/`folders` (estables en el App) y el árbol se virtualiza a partir de
// VIRTUAL_MIN filas visibles.

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo } from 'react';
import { t, useI18n } from '../../i18n.js';
import { perfCountRender } from '../../perf.js';
import { Icon } from './icons.jsx';
import { Menu } from './Menu.jsx';
import { buildTreeIndex, flattenTree, folderChain } from './tree.js';
import { EMOJI_FILE_SET, EMOJI_FOLDER_SET } from '../shared/emoji.js';
import { kbdHint, withKbd } from '../shared/shortcuts.js';
import { WsGlyph } from './WsGlyph.jsx';
import { useCollections } from '../allnotes/useCollections.js';
import { dailyNoteName } from '../shared/daily.js';

const ROW_H = 31;          // 30px de fila + 1px de separación (como el diseño)
const VIRTUAL_MIN = 300;   // a partir de aquí sólo se pintan las filas visibles
const DRAG_MIME = 'application/x-edinot-item';
const TREE_KEY = 'edinot.shell.tree.v1';
const TPL_KEY = 'edinot.shell.tplOpen.v1';
const SECS_KEY = 'edinot.shell.sideSecs.v2'; // secciones abiertas o plegadas, por vault
// Por defecto: Etiquetas, Bases de datos y Otros plegadas (así las carpetas se llevan el sitio); el resto, abiertas.
const SEC_DEFAULTS = { favs: true, organize: true, tags: false, collections: true, dbs: false, others: false };
const DB_SHOWN = 6;
const TAGS_SHOWN = 10;
const COL_SHOWN = 12;
const FAV_SHOWN = 4;
const NO_LIST = [];
const NO_UPDATE = { state: 'idle' };

const baseName = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');

function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch { return fallback; }
}
function writeJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

function hasDragItem(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  return !!types && Array.from(types).includes(DRAG_MIME);
}
function readDragItem(e) {
  try { return JSON.parse(e.dataTransfer.getData(DRAG_MIME)); } catch { return null; }
}

export function syncLabel(status, loggedIn) {
  switch (status) {
    case 'connected': return t('shell.sync.connected');
    case 'connecting': return t('shell.sync.connecting');
    case 'auth-failed': return t('shell.sync.authFailed');
    case 'error': return t('shell.sync.error');
    default: return loggedIn ? t('shell.sync.offline') : t('shell.sync.local');
  }
}

function EmojiGrid({ choices, onPick, onClear }) {
  return (
    <div className="sh-emoji-grid" role="group" aria-label={t('btn.changeIcon')}>
      {choices.map((e, i) => (
        <button key={i} type="button" className="sh-emoji" onClick={() => onPick(e)}>{e}</button>
      ))}
      {onClear && (
        <button type="button" className="sh-emoji sh-emoji-clear" onClick={onClear} title={t('shell.icon.clear')}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

// ── Fila del árbol ────────────────────────────────────────────────────────
const TreeRow = memo(function TreeRow({
  row, active, focused, isCanvas, dropTarget, style,
  onActivate, onToggle, onContext, onFocusRow, onDragStartRow, onDragOverRow, onDragLeaveRow, onDropRow,
}) {
  perfCountRender('TreeRow');
  const isFolder = row.kind === 'folder';
  const item = isFolder ? row.folder : row.file;
  // El 🎨 que reciben los canvas nuevos se pinta con el icono del shell.
  const icon = (!isFolder && isCanvas && item.icon === '🎨') ? null : item.icon;
  // Cuadrícula única de la barra (ver design.css, «una sola cuadrícula»): el
  // icono empieza a 12px (+16 por nivel) y la etiqueta a 38px, igual que en
  // la navegación. Una nota sin icono alinea su nombre con el de las carpetas.
  // El chevron de una carpeta va a la derecha, como en las cabeceras.
  const pad = 12 + row.depth * 16 + (!isFolder && !(icon || isCanvas) ? 26 : 0);
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={isFolder ? row.open : undefined}
      aria-selected={active || undefined}
      aria-current={active ? 'page' : undefined}
      tabIndex={focused ? 0 : -1}
      data-row-id={row.id}
      className={`sh-tree-row${isFolder ? ' is-folder' : ''}${active ? ' on' : ''}${focused ? ' kfocus' : ''}${dropTarget ? ' drop' : ''}`}
      style={{ ...style, paddingLeft: pad }}
      draggable
      onDragStart={(e) => onDragStartRow(e, row)}
      onDragOver={(e) => onDragOverRow(e, row)}
      onDragLeave={(e) => onDragLeaveRow(e, row)}
      onDrop={(e) => onDropRow(e, row)}
      onFocus={() => onFocusRow(row.id)}
      onClick={(e) => { onFocusRow(row.id); if (isFolder) onToggle(row.id); else onActivate(row.id, e); }}
      onContextMenu={(e) => { e.preventDefault(); onFocusRow(row.id); onContext({ x: e.clientX, y: e.clientY }, row); }}
      title={isFolder ? item.name : baseName(item.name)}>
      {isFolder
        ? <span className="sh-tree-ic">{icon && icon !== '📁' ? <span className="sh-emoji-ic">{icon}</span> : <Icon name="folder" size={15} />}</span>
        : (icon ? <span className="sh-tree-ic"><span className="sh-emoji-ic">{icon}</span></span>
          : isCanvas ? <span className="sh-tree-ic"><Icon name="canvas" size={15} /></span> : null)}
      <span className="sh-tree-label">{isFolder ? item.name : baseName(item.name)}</span>
      {isFolder && <span className="sh-tree-count">{row.count || ''}</span>}
      <button type="button" className="sh-tree-more" tabIndex={-1}
        aria-label={t('btn.actions')}
        onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onContext({ x: r.left, y: r.bottom + 4 }, row); }}>
        <Icon name="more" size={15} />
      </button>
      {isFolder && (
        <span className="sh-tree-chev" aria-hidden="true">
          <Icon name={row.open ? 'chevDown' : 'chevRight'} size={12} stroke={2.2} />
        </span>
      )}
    </div>
  );
});

// ── Barra lateral ─────────────────────────────────────────────────────────
export const Sidebar = memo(function Sidebar(props) {
  perfCountRender('Sidebar');
  useI18n();
  const {
    collapsed, onToggleCollapsed, routeView, isMac, compact,
    workspace, vaults, activeVault, activeId,
    filesMeta, folders, templateFolderIds, canvasIds,
    favorites, externalFiles, todayLabel, dueCount,
    databases = NO_LIST, tags = NO_LIST,
    syncStatus, loggedIn, defaultNoteId, readOnly, isWorkspaceOwner, actions: A,
    updateState = NO_UPDATE,
  } = props;
  // Ajustes → Apariencia → Interfaz compacta: filas de 26px (+1 de hueco).
  const rowH = compact ? 27 : ROW_H;

  const activeVaultObj = vaults.find(v => v.id === activeVault) || vaults[0] || { id: activeVault, name: activeVault };
  const index = useMemo(
    () => buildTreeIndex(filesMeta, folders, activeVault, templateFolderIds),
    [filesMeta, folders, activeVault, templateFolderIds],
  );

  // Secciones plegables: abiertas o cerradas por vault (estado en este equipo).
  const [secAll, setSecAll] = useState(() => readJson(SECS_KEY, {}));
  const secOpen = (k) => { const v = (secAll[activeVault] || {})[k]; return v == null ? SEC_DEFAULTS[k] : !!v; };
  const toggleSec = (k) => setSecAll(prev => {
    const cur = prev[activeVault] || {};
    const now = cur[k] == null ? SEC_DEFAULTS[k] : !!cur[k];
    const n = { ...prev, [activeVault]: { ...cur, [k]: !now } };
    writeJson(SECS_KEY, n);
    return n;
  });
  const { collections, deleteCollection } = useCollections(activeVault);
  // Primero las notas que son una base de datos entera; luego por nombre.
  const dbList = useMemo(() => databases.slice().sort((a, b) => (b.dbNote - a.dbNote) || a.title.localeCompare(b.title)), [databases]);

  // Carpetas desplegadas, por vault, persistidas en este equipo.
  const [expandedAll, setExpandedAll] = useState(() => readJson(TREE_KEY, {}));
  const expanded = expandedAll[activeVault] || {};
  const setExpanded = useCallback((updater) => {
    setExpandedAll(prev => {
      const cur = prev[activeVault] || {};
      const nextV = typeof updater === 'function' ? updater(cur) : updater;
      const next = { ...prev, [activeVault]: nextV };
      writeJson(TREE_KEY, next);
      return next;
    });
  }, [activeVault]);
  const toggleFolder = useCallback((id) => setExpanded(e => {
    const n = { ...e };
    if (n[id]) delete n[id]; else n[id] = true;
    return n;
  }), [setExpanded]);

  // Al abrir una nota (también desde Ctrl K o un enlace) se despliegan sus
  // carpetas para que se vea resaltada.
  const lastRevealRef = useRef(null);
  useEffect(() => {
    if (!activeId || lastRevealRef.current === activeId) return;
    const file = filesMeta.find(f => f.id === activeId);
    if (!file || (file.vaultId || 'default') !== activeVault || !file.folderId) { lastRevealRef.current = activeId; return; }
    const chain = folderChain(file, index.folderById);
    if (!chain.length) return;
    lastRevealRef.current = activeId;
    if (chain.every(fd => expanded[fd.id])) return;
    setExpanded(e => { const n = { ...e }; for (const fd of chain) n[fd.id] = true; return n; });
  }, [activeId, activeVault, filesMeta, index, expanded, setExpanded]);

  const rows = useMemo(() => flattenTree(index, expanded, { rootFiles: false }), [index, expanded]);
  const looseCount = index.filesIn('').length;
  const [tplOpen, setTplOpen] = useState(() => !!readJson(TPL_KEY, false));
  const toggleTpl = () => setTplOpen(v => { writeJson(TPL_KEY, !v); return !v; });

  // ── Foco de teclado (roving tabindex) ──────────────────────────────────
  const [focusId, setFocusId] = useState(null);
  const effectiveFocus = rows.some(r => r.id === focusId) ? focusId : (rows.find(r => r.id === activeId) || rows[0] || {}).id;
  const scrollRef = useRef(null);
  const treeRef = useRef(null);

  const focusRowEl = useCallback((id) => {
    const tree = treeRef.current;
    if (!tree) return;
    const idx = rows.findIndex(r => r.id === id);
    const sc = scrollRef.current;
    if (idx >= 0 && sc && rows.length >= VIRTUAL_MIN) {
      // Fila fuera de la ventana virtual: desplaza primero.
      const top = tree.offsetTop + idx * rowH;
      if (top < sc.scrollTop) sc.scrollTop = top;
      else if (top + rowH > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + rowH - sc.clientHeight;
    }
    requestAnimationFrame(() => {
      const el = tree.querySelector(`[data-row-id="${CSS.escape(String(id))}"]`);
      if (el) { el.focus({ preventScroll: rows.length >= VIRTUAL_MIN }); el.scrollIntoView({ block: 'nearest' }); }
    });
  }, [rows, rowH]);

  const [menu, setMenu] = useState(null); // { anchor, items, label }

  const onTreeKeyDown = (e) => {
    const idx = rows.findIndex(r => r.id === effectiveFocus);
    const row = rows[idx];
    if (!row) return;
    const go = (i) => { const r = rows[Math.max(0, Math.min(rows.length - 1, i))]; if (r) { setFocusId(r.id); focusRowEl(r.id); } };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(idx + 1); break;
      case 'ArrowUp': e.preventDefault(); go(idx - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(rows.length - 1); break;
      case 'ArrowRight':
        if (row.kind === 'folder') { e.preventDefault(); if (!row.open) toggleFolder(row.id); else go(idx + 1); }
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (row.kind === 'folder' && row.open) { toggleFolder(row.id); break; }
        for (let i = idx - 1; i >= 0; i--) {
          if (rows[i].kind === 'folder' && rows[i].depth < row.depth) { go(i); break; }
        }
        break;
      }
      case 'Enter': case ' ':
        e.preventDefault();
        if (row.kind === 'folder') toggleFolder(row.id); else A.openNote(row.id);
        break;
      case 'F2':
        e.preventDefault();
        if (readOnly) break;
        if (row.kind === 'folder') A.renameFolder(row.id); else A.renameFile(row.id);
        break;
      case 'Delete':
        e.preventDefault();
        if (readOnly) break;
        if (row.kind === 'folder') A.deleteFolder(row.id); else A.deleteFile(row.id);
        break;
      case 'ContextMenu':
        e.preventDefault(); openRowMenuAtFocus(row); break;
      case 'F10':
        if (e.shiftKey) { e.preventDefault(); openRowMenuAtFocus(row); }
        break;
      default:
    }
  };
  const openRowMenuAtFocus = (row) => {
    const el = treeRef.current && treeRef.current.querySelector(`[data-row-id="${CSS.escape(String(row.id))}"]`);
    const r = el ? el.getBoundingClientRect() : { left: 80, bottom: 120 };
    openRowMenu({ x: r.left + 24, y: r.bottom }, row);
  };

  // ── Menús contextuales ────────────────────────────────────────────────
  const folderPickItems = (file) => {
    const out = [];
    if (file.folderId) out.push({ label: t('shell.tree.moveRoot'), icon: 'vault', onSelect: () => A.moveToFolder(file.id, null) });
    const walk = (parent, depth) => {
      for (const fd of index.foldersIn(parent)) {
        out.push({
          label: ' '.repeat(depth) + fd.name, icon: 'folder',
          disabled: fd.id === file.folderId,
          onSelect: () => A.moveToFolder(file.id, fd.id),
        });
        walk(fd.id, depth + 1);
      }
    };
    walk('', 0);
    if (!out.length) out.push({ label: t('folder.noChildren'), disabled: true });
    return out;
  };

  const fileMenuItems = (file) => {
    const otherVaults = vaults.filter(v => v.id !== (file.vaultId || 'default'));
    const pinned = !!file.pinned;
    const items = [
      { label: t('shell.tree.open'), icon: 'note', onSelect: () => A.openNote(file.id) },
    ];
    if (!readOnly) {
      items.push(
        { label: t('btn.rename'), icon: 'edit', kbd: 'F2', onSelect: () => A.renameFile(file.id) },
        { label: t('btn.duplicate'), icon: 'copy', onSelect: () => A.duplicateFile(file.id) },
        { label: t('btn.changeIcon'), icon: 'palette', submenu: () => [{ type: 'custom', render: (close) => (
          <EmojiGrid choices={EMOJI_FILE_SET}
            onPick={(em) => { A.setFileIcon(file.id, em); close(); }}
            onClear={file.icon ? () => { A.setFileIcon(file.id, null); close(); } : null} />
        ) }] },
      );
    }
    items.push({ label: pinned ? t('shell.fav.remove') : t('shell.fav.add'), icon: 'star', onSelect: () => A.togglePin(file.id) });
    if (!String(file.id).startsWith('ext:')) items.push({ label: t('tb.share') + '…', icon: 'share', onSelect: () => A.shareNote(file.id) });
    if (!readOnly) {
      items.push({ type: 'sep' });
      items.push({ label: t('row.moveToFolder'), icon: 'move', submenu: () => folderPickItems(file) });
      if (otherVaults.length) {
        items.push({ label: t('row.moveToVault'), icon: 'vault', submenu: () => otherVaults.map(v => ({ label: v.name, icon: 'vault', onSelect: () => A.moveToVault(file.id, v.id) })) });
      }
      items.push({ label: t('tree.saveAsTemplate'), icon: 'template', onSelect: () => A.saveAsTemplate(file.id) });
      items.push({ label: file.id === defaultNoteId ? t('row.unsetDefault') : t('row.setDefault'), icon: 'home', onSelect: () => A.setDefault(file.id) });
      items.push({ type: 'sep' });
      items.push({ label: t('btn.delete'), icon: 'trash', kbd: 'Supr', danger: true, onSelect: () => A.deleteFile(file.id) });
    }
    return items;
  };

  const folderMenuItems = (fd) => {
    if (readOnly) return [{ label: t('shell.readonly'), disabled: true }];
    return [
      { label: t('tree.newNoteHere'), icon: 'note', onSelect: () => A.newNoteIn(fd.vaultId || activeVault, fd.id) },
      { label: t('shell.tree.newCanvasHere'), icon: 'canvas', onSelect: () => A.newCanvasIn(fd.vaultId || activeVault, fd.id) },
      { label: t('tree.newSubfolder'), icon: 'folderPlus', onSelect: () => A.newFolder(fd.vaultId || activeVault, fd.id) },
      { type: 'sep' },
      { label: t('btn.rename'), icon: 'edit', kbd: 'F2', onSelect: () => A.renameFolder(fd.id) },
      { label: t('btn.changeIcon'), icon: 'palette', submenu: () => [{ type: 'custom', render: (close) => (
        <EmojiGrid choices={EMOJI_FOLDER_SET} onPick={(em) => { A.setFolderIcon(fd.id, em); close(); }} />
      ) }] },
      { label: t('shell.tree.shareFolder'), icon: 'share', onSelect: () => A.shareFolder(fd) },
      { type: 'sep' },
      { label: t('row.deleteFolder'), icon: 'trash', kbd: 'Supr', danger: true, onSelect: () => A.deleteFolder(fd.id) },
    ];
  };

  const vaultMenuItems = () => {
    if (readOnly) return [{ label: t('shell.readonly'), disabled: true }];
    const items = [
      { label: t('tree.newFile'), icon: 'note', kbd: kbdHint('newNote', isMac), onSelect: () => A.newNoteIn(activeVault, null) },
      { label: t('tree.newCanvas'), icon: 'canvas', onSelect: () => A.newCanvasIn(activeVault, null) },
      { label: t('tree.newFolder'), icon: 'folderPlus', onSelect: () => A.newFolder(activeVault, null) },
      { type: 'sep' },
      { label: t('tree.importFiles'), icon: 'import', kbd: kbdHint('import', isMac), onSelect: () => A.importFiles() },
    ];
    if (isWorkspaceOwner) items.push({ label: t('shell.tree.shareVault'), icon: 'share', onSelect: () => A.shareVault(activeVaultObj) });
    return items;
  };

  const openRowMenu = (anchor, row) => {
    if (row.kind === 'folder') setMenu({ anchor, items: folderMenuItems(row.folder), label: row.folder.name });
    else setMenu({ anchor, items: fileMenuItems(row.file), label: baseName(row.file.name) });
  };

  const templateMenuItems = (tpl) => [
    { label: t('tpl.applyTip'), icon: 'plus', onSelect: () => A.applyTemplate(tpl) },
    ...(readOnly ? [] : [
      { label: t('tpl.editRow'), icon: 'edit', onSelect: () => A.openNote(tpl.id) },
      { label: t('tpl.convertNote'), icon: 'note', onSelect: () => A.unmarkTemplate(tpl.id) },
      { type: 'sep' },
      { label: t('tpl.deleteRow'), icon: 'trash', danger: true, onSelect: () => A.deleteFile(tpl.id) },
    ]),
  ];

  const workspaceMenu = (anchor) => {
    const items = [];
    // El workspace es uno solo para casi todo el mundo: solo se lista si hay más de uno.
    if (workspace && workspace.list && workspace.list.length > 1) {
      items.push({ type: 'head', label: t('shell.ws.workspaces') });
      for (const w of workspace.list) {
        items.push({ label: w.name || w.id, checked: w.id === workspace.currentId, onSelect: () => A.switchWorkspace(w.id) });
      }
      items.push({ type: 'sep' });
    }
    items.push({ type: 'head', label: t('shell.ws.vaults') });
    for (const v of vaults) {
      items.push({ label: (v.icon ? v.icon + ' ' : '') + v.name, checked: v.id === activeVault, onSelect: () => A.switchVault(v.id) });
    }
    items.push({ type: 'sep' });
    items.push({ label: t('shell.ws.manageVaults'), icon: 'vault', onSelect: () => A.openSettings('vaults') });
    items.push({ label: loggedIn ? t('shell.ws.account') : t('shell.ws.signIn'), icon: 'user', onSelect: () => A.openSettings('profile') });
    setMenu({ anchor, items, label: t('shell.ws.switch') });
  };

  // «+» de la barra encogida: nota, nota canvas, base de datos o desde plantilla.
  const templateItems = () => {
    const out = index.templates.map(tpl => ({ label: baseName(tpl.name), icon: 'template', onSelect: () => A.applyTemplate(tpl) }));
    if (!out.length) out.push({ label: t('tpl.empty'), disabled: true });
    if (!readOnly && A.missingTemplateSeeds && A.missingTemplateSeeds() > 0) {
      out.push({ type: 'sep' }, { label: index.templates.length ? t('tpl.seedMissing', { n: A.missingTemplateSeeds() }) : t('tpl.seed'), icon: 'plus', onSelect: () => A.seedTemplates() });
    }
    return out;
  };
  const newMenu = (anchor) => setMenu({
    anchor, label: t('tree.newFile'),
    items: [
      { label: t('home.qa.note'), icon: 'note', kbd: kbdHint('newNote', isMac), onSelect: () => A.newNote() },
      { label: t('shell.new.canvas'), icon: 'canvas', onSelect: () => A.newCanvas() },
      { label: t('home.qa.database'), icon: 'database', onSelect: () => A.newDatabase() },
      { label: t('home.qa.template'), icon: 'template', submenu: templateItems },
    ],
  });
  // «Más» de la barra encogida: lo que en la barra completa son secciones.
  const MORE_N = 12;
  const moreMenu = (anchor) => {
    const items = [];
    const listOf = (all, mk, seeAll) => () => [
      ...all.slice(0, MORE_N).map(mk),
      ...(all.length > MORE_N ? [{ type: 'sep' }, seeAll] : []),
    ];
    if (favorites.length) {
      items.push({ label: t('shell.fav.title'), icon: 'star',
        submenu: listOf(favorites, f => ({ label: baseName(f.name), icon: canvasIds.has(f.id) ? 'canvas' : 'note', onSelect: () => A.openNote(f.id) }),
          { label: t('shell.fav.all', { n: favorites.length }), onSelect: () => A.openAllNotes({ tab: 'notes', rules: { pinned: true } }) }) });
    }
    if (tags.length) {
      items.push({ label: t('shell.tags.title'), icon: 'tag',
        submenu: listOf(tags, tg => ({ label: tg.tag, icon: 'tag', onSelect: () => A.openAllNotes({ tab: 'notes', rules: { tags: [tg.tag] } }) }),
          { label: t('shell.tags.all', { n: tags.length }), onSelect: () => A.openAllNotes({ tab: 'tags' }) }) });
    }
    if (collections.length) {
      items.push({ label: t('shell.sec.collections'), icon: 'collection',
        submenu: listOf(collections, c => ({ label: c.name, icon: 'collection', onSelect: () => A.openAllNotes({ tab: 'notes', collectionId: c.id }) }),
          { label: t('shell.col.all', { n: collections.length }), onSelect: () => A.openAllNotes({ tab: 'collections' }) }) });
    }
    if (dbList.length) {
      items.push({ label: t('shell.db.title'), icon: 'database',
        submenu: listOf(dbList, d => ({ label: d.title, icon: 'database', hint: d.sub || '', onSelect: () => A.openTable(d) }),
          { label: t('shell.db.all', { n: dbList.length }), onSelect: () => A.openDatabases() }) });
    }
    if (items.length) items.push({ type: 'sep' });
    items.push({ label: t('trash.title'), icon: 'trash', onSelect: () => A.openTrash && A.openTrash() });
    items.push({ label: t('tpl.title'), icon: 'template',
      submenu: () => [
        ...index.templates.map(tpl => ({ label: baseName(tpl.name), icon: 'template', onSelect: () => A.applyTemplate(tpl) })),
        ...(index.templates.length ? [] : [{ label: t('tpl.empty'), disabled: true }]),
        ...(!readOnly ? [{ type: 'sep' },
          ...(A.missingTemplateSeeds && A.missingTemplateSeeds() > 0 ? [{ label: index.templates.length ? t('tpl.seedMissing', { n: A.missingTemplateSeeds() }) : t('tpl.seed'), icon: 'plus', onSelect: () => A.seedTemplates() }] : []),
          { label: '+ ' + t('tpl.blank'), onSelect: () => A.newBlankTemplate() }] : []),
      ] });
    if (!readOnly) items.push({ label: t('shell.sec.import'), icon: 'import', kbd: kbdHint('import', isMac), onSelect: () => A.importFiles() });
    setMenu({ anchor, items, label: t('shell.rail.more') });
  };

  // ── Arrastrar y soltar ────────────────────────────────────────────────
  const [dropId, setDropId] = useState(null);
  const hoverTimer = useRef(null);
  const onDragStartRow = useCallback((e, row) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: row.kind === 'folder' ? 'folder' : 'file', id: row.id }));
    e.dataTransfer.effectAllowed = 'move';
  }, []);
  const onDragOverRow = useCallback((e, row) => {
    if (!hasDragItem(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    // Soltar sobre una nota = a su carpeta; sobre una carpeta = dentro.
    const target = row.kind === 'folder' ? row.id : ('f:' + (row.file.folderId || ''));
    setDropId(prev => prev === target ? prev : target);
    if (row.kind === 'folder' && !row.open) {
      if (!hoverTimer.current || hoverTimer.current.id !== row.id) {
        if (hoverTimer.current) clearTimeout(hoverTimer.current.t);
        hoverTimer.current = { id: row.id, t: setTimeout(() => { toggleFolder(row.id); hoverTimer.current = null; }, 700) };
      }
    }
  }, [toggleFolder]);
  const onDragLeaveRow = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (hoverTimer.current) { clearTimeout(hoverTimer.current.t); hoverTimer.current = null; }
  }, []);
  const onDropRow = useCallback((e, row) => {
    if (!hasDragItem(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    if (hoverTimer.current) { clearTimeout(hoverTimer.current.t); hoverTimer.current = null; }
    const item = readDragItem(e);
    if (!item || item.id === row.id) return;
    const folderId = row.kind === 'folder' ? row.id : (row.file.folderId || null);
    if (folderId) A.dropOnFolder(folderId, item);
    else A.dropOnVault(activeVault, item);
  }, [A, activeVault]);
  useEffect(() => {
    const clear = () => setDropId(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); };
  }, []);
  const rootDropHandlers = {
    onDragOver: (e) => { if (!hasDragItem(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropId('__root__'); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropId(d => d === '__root__' ? null : d); },
    onDrop: (e) => { if (!hasDragItem(e)) return; e.preventDefault(); setDropId(null); const it = readDragItem(e); if (it) A.dropOnVault(activeVault, it); },
  };

  // ── Virtualización ────────────────────────────────────────────────────
  const virtual = rows.length >= VIRTUAL_MIN;
  const [win, setWin] = useState({ top: 0, h: 900 });
  useLayoutEffect(() => {
    if (!virtual) return;
    const sc = scrollRef.current;
    if (!sc) return;
    let raf = 0;
    const update = () => { raf = 0; setWin({ top: sc.scrollTop, h: sc.clientHeight }); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(sc);
    return () => { sc.removeEventListener('scroll', onScroll); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [virtual]);
  let start = 0, end = rows.length;
  if (virtual && treeRef.current) {
    const rel = win.top - treeRef.current.offsetTop;
    start = Math.max(0, Math.floor(rel / rowH) - 12);
    end = Math.min(rows.length, Math.ceil((rel + win.h) / rowH) + 12);
  } else if (virtual) {
    end = Math.min(rows.length, 60);
  }

  const showActive = routeView === 'note';
  // Aviso de actualización: hay una versión nueva (disponible, bajando o ya bajada).
  const updState = updateState && updateState.state;
  const updPending = updState === 'available' || updState === 'downloading' || updState === 'downloaded';
  const updTip = updState === 'downloaded' ? t('shell.upd.ready')
    : updState === 'downloading' ? t('shell.upd.downloading')
    : (updateState && updateState.info && updateState.info.version ? t('shell.upd.availV', { v: updateState.info.version }) : t('shell.upd.avail'));
  // «Hoy» está activo cuando la nota abierta es la nota diaria de hoy.
  const todayActive = useMemo(() => {
    if (routeView !== 'note' || !activeId) return false;
    const f = filesMeta.find(x => x.id === activeId);
    return !!f && baseName(f.name).toLowerCase() === dailyNoteName();
  }, [routeView, activeId, filesMeta]);
  const openNoteClick = useCallback((id) => A.openNote(id), [A]);
  const navItem = (key, icon, label, onClick, extra, opts = {}) => (
    <button type="button" key={key}
      className={`sh-nav${opts.on ? ' on' : ''}`}
      aria-current={opts.on ? 'page' : undefined}
      onClick={onClick}>
      <Icon name={icon} size={16} />
      <span className="sh-nav-label">{label}</span>
      {extra}
    </button>
  );

  // La cabecera muestra el VAULT en el que estás (el workspace es siempre uno):
  // su nombre y, si hay varios, cuántos hay. Al cambiar de vault cambia todo lo de abajo.
  const wsName = activeVaultObj.name || t('shell.ws.local');
  const vaultSub = vaults.length > 1 ? t('shell.ws.vaultsCount', { n: vaults.length }) : '';

  // Cabecera de una sección que se pliega (chevron + nombre + cuántos hay).
  const secHead = (key, id, label, count) => (
    <div className="sh-sec-head sh-sec-head-row">
      <h2 id={id}>
        <button type="button" className="sh-sec-toggle" aria-expanded={secOpen(key)} onClick={() => toggleSec(key)}>
          <Icon name="chevRight" size={11} className={`sh-sec-chev${secOpen(key) ? ' open' : ''}`} />{label}
        </button>
      </h2>
      <span className="sh-tree-count">{count}</span>
    </div>
  );
  const collectionMenuItems = (c) => [
    { label: t('shell.tree.open'), icon: 'collection', onSelect: () => A.openAllNotes({ tab: 'notes', collectionId: c.id }) },
    ...(readOnly ? [] : [
      { type: 'sep' },
      { label: t('an.col.delete'), icon: 'trash', danger: true, onSelect: () => deleteCollection(c.id) },
    ]),
  ];

  // ── Carril (56px) ─────────────────────────────────────────────────────
  // Arriba, fijos: espacio y «+». En medio (con scroll si no cabe): navegación,
  // «desplegar» y «Más». Abajo, fijos: sincronización y Ajustes.
  if (collapsed) {
    const railBtn = (key, icon, label, onClick, opts = {}) => (
      <button type="button" key={key} className={`sh-rail-btn${opts.on ? ' on' : ''}`}
        aria-label={label} title={opts.title || label} aria-current={opts.on ? 'page' : undefined}
        aria-haspopup={opts.popup ? 'menu' : undefined} disabled={opts.disabled}
        onClick={onClick}>
        <Icon name={icon} size={18} />
        {opts.badge ? <span className="sh-rail-badge" aria-hidden="true">{opts.badge > 9 ? '9+' : opts.badge}</span> : null}
        {opts.dot ? <span className="sh-rail-dot" aria-hidden="true" /> : null}
      </button>
    );
    const pt = (el) => { const r = el.getBoundingClientRect(); return { x: r.right + 8, y: r.top }; };
    const syncTip = syncLabel(syncStatus, loggedIn);
    return (
      <nav className={`sh-side sh-rail${isMac ? ' is-mac' : ''}`} aria-label={t('shell.nav.main')}>
        {isMac && <div className="sh-mac-spacer" />}
        <button type="button" className="sh-ws-avatar sh-rail-ws" aria-label={t('shell.ws.switch') + ': ' + wsName}
          title={wsName} onClick={(e) => workspaceMenu(e.currentTarget.getBoundingClientRect())}><WsGlyph name={wsName} size={28} radius={7} /></button>
        {railBtn('new', 'plus', t('tree.newFile'), (e) => newMenu(pt(e.currentTarget)),
          { title: withKbd(t('tree.newFile'), 'newNote', isMac), disabled: readOnly, popup: true })}
        <div className="sh-rail-scroll">
          {railBtn('search', 'search', t('shell.search'), () => A.openPalette(), { title: withKbd(t('shell.search'), 'palette', isMac) })}
          {railBtn('home', 'home', t('shell.nav.home'), () => A.goHome(), { on: routeView === 'home' })}
          {railBtn('all', 'allnotes', t('shell.nav.all'), () => A.openAllNotes(), { on: routeView === 'all' })}
          {railBtn('today', 'today', t('shell.nav.today'), () => A.openToday(), { on: todayActive, title: t('shell.nav.today') + ' · ' + todayLabel })}
          {railBtn('cal', 'calendar', t('shell.nav.calendar'), () => A.openCalendar(), { on: routeView === 'calendar', badge: dueCount, title: withKbd(t('shell.nav.calendar'), 'calendar', isMac) })}
          <span className="sh-rail-sep" aria-hidden="true" />
          {railBtn('notes', 'folder', t('shell.sec.organize'), () => onToggleCollapsed(), { title: withKbd(t('shell.sidebar.expand'), 'sidebar', isMac) })}
          {railBtn('more', 'more', t('shell.rail.more'), (e) => moreMenu(pt(e.currentTarget)), { popup: true })}
        </div>
        <div className="sh-rail-foot">
          {updPending && railBtn('upd', 'download', t('shell.upd.pill'), () => A.openSettings('about'), { title: updTip, dot: true })}
          <button type="button" className="sh-sync-btn" onClick={() => A.openSettings('sync')} title={syncTip} aria-label={syncTip}>
            <span className={`sh-sync-dot sync-${syncStatus}`} aria-hidden="true" />
          </button>
          {railBtn('settings', 'settings', t('settings.title'), () => A.openSettings(), { on: routeView === 'settings' })}
        </div>
        {menu && <Menu anchor={menu.anchor} items={menu.items} label={menu.label} onClose={() => setMenu(null)} />}
      </nav>
    );
  }

  // ── Barra completa ────────────────────────────────────────────────────
  return (
    <aside className={`sh-side${isMac ? ' is-mac' : ''}`} aria-label={t('shell.sidebar')}>
      {isMac && <div className="sh-mac-spacer" />}
      <div className="sh-side-head">
        <button type="button" className="sh-ws" aria-haspopup="menu"
          aria-label={t('shell.ws.switch') + ': ' + wsName}
          onClick={(e) => workspaceMenu(e.currentTarget.getBoundingClientRect())}>
          <span className="sh-ws-avatar" aria-hidden="true"><WsGlyph name={wsName} size={22} radius={6} /></span>
          <span className="sh-ws-text">
            <span className="sh-ws-name">{wsName}</span>
            {vaultSub && <span className="sh-ws-sub">{vaultSub}</span>}
          </span>
          <Icon name="chevSel" size={14} className="sh-ws-chev" />
        </button>
        <button type="button" className="sh-iconbtn sh-new" aria-label={t('tree.newFile')} title={withKbd(t('tree.newFile'), 'newNote', isMac)}
          disabled={readOnly} onClick={() => A.newNote()}>
          <Icon name="plus" size={16} />
        </button>
      </div>

      <nav aria-label={t('shell.nav.main')} className="sh-navs sh-navs-top">
        <button type="button" className="sh-nav sh-nav-search" onClick={() => A.openPalette()}>
          <Icon name="search" size={16} />
          <span className="sh-nav-label">{t('shell.search')}</span>
          {kbdHint('palette', isMac) && <kbd className="sh-kbd">{kbdHint('palette', isMac)}</kbd>}
        </button>
        {navItem('home', 'home', t('shell.nav.home'), () => A.goHome(), null, { on: routeView === 'home' })}
        {navItem('all', 'allnotes', t('shell.nav.all'), () => A.openAllNotes(), null, { on: routeView === 'all' })}
        {navItem('today', 'today', t('shell.nav.today'), () => A.openToday(), <span className="sh-nav-meta">{todayLabel}</span>, { on: todayActive })}
        {navItem('cal', 'calendar', t('shell.nav.calendar'), () => A.openCalendar(),
          dueCount > 0 ? <span className="sh-badge" aria-label={t('cal.pill.due').replace('{n}', dueCount)}>{dueCount > 99 ? '99+' : dueCount}</span> : null,
          { on: routeView === 'calendar' })}
      </nav>

      <div className="sh-side-scroll" ref={scrollRef}>
        {externalFiles && externalFiles.length > 0 && (
          <section className="sh-sec">
            <h2 className="sh-sec-head">{t('tree.openFromDisk')}</h2>
            {externalFiles.map(ef => (
              <div key={ef.id} className={`sh-tree-row sh-ext${showActive && ef.id === activeId ? ' on' : ''}`} style={{ paddingLeft: 10 }}>
                <button type="button" className="sh-row-main" onClick={() => A.openNote(ef.id)} title={ef.path}>
                  <span className="sh-tree-ic"><Icon name="external" size={15} /></span>
                  <span className="sh-tree-label">{baseName(ef.name)}</span>
                </button>
                <button type="button" className="sh-mini-btn" onClick={() => A.importExternal(ef.id)} title={t('tree.importToActive')}>{t('btn.import')}</button>
                <button type="button" className="sh-iconbtn sh-iconbtn-sm" aria-label={t('tree.closeExternal')} onClick={() => A.closeExternal(ef.id)}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </section>
        )}

        {favorites.length > 0 && (
          <section className="sh-sec" aria-labelledby="sh-fav-h">
            {secHead('favs', 'sh-fav-h', t('shell.fav.title'), favorites.length)}
            {secOpen('favs') && favorites.slice(0, FAV_SHOWN).map(f => (
              <button type="button" key={f.id}
                className={`sh-fav${showActive && f.id === activeId ? ' on' : ''}`}
                aria-current={showActive && f.id === activeId ? 'page' : undefined}
                onClick={() => A.openNote(f.id)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: fileMenuItems(f), label: baseName(f.name) }); }}>
                <span className="sh-tree-ic">
                  {f.icon ? <span className="sh-emoji-ic">{f.icon}</span> : <Icon name={canvasIds.has(f.id) ? 'canvas' : 'note'} size={15} />}
                </span>
                <span className="sh-tree-label">{baseName(f.name)}</span>
                {(f.vaultId || 'default') !== activeVault && vaults.length > 1 && (
                  <span className="sh-tree-count">{(vaults.find(v => v.id === (f.vaultId || 'default')) || {}).name || ''}</span>
                )}
              </button>
            ))}
            {secOpen('favs') && favorites.length > FAV_SHOWN && (
              <button type="button" className="sh-fav sh-more" onClick={() => A.openAllNotes({ tab: 'notes', rules: { pinned: true } })}>
                {t('shell.fav.all', { n: favorites.length })}
              </button>
            )}
          </section>
        )}

        <section className="sh-sec sh-notes" aria-labelledby="sh-notes-h">
          <div className={`sh-sec-head sh-sec-head-row${dropId === '__root__' ? ' drop' : ''}`} {...rootDropHandlers}>
            <h2 id="sh-notes-h">
              <button type="button" className="sh-sec-toggle" aria-expanded={secOpen('organize')} onClick={() => toggleSec('organize')}>
                <Icon name="chevRight" size={11} className={`sh-sec-chev${secOpen('organize') ? ' open' : ''}`} />{t('shell.sec.organize')}
              </button>
            </h2>
            <button type="button" className="sh-iconbtn sh-iconbtn-sm" aria-label={t('shell.tree.add')} title={t('shell.tree.add')}
              onClick={(e) => setMenu({ anchor: e.currentTarget.getBoundingClientRect(), items: vaultMenuItems(), label: activeVaultObj.name })}>
              <Icon name="plus" size={14} stroke={1.8} />
            </button>
          </div>
          {secOpen('organize') && (
            <>
              {looseCount > 0 && (
                <button type="button" className={`sh-tree-row sh-loose${dropId === '__root__' ? ' drop' : ''}`}
                  title={t('shell.org.looseTip')} {...rootDropHandlers}
                  onClick={() => A.openAllNotes({ tab: 'notes', rules: { noFolder: true } })}>
                  <span className="sh-tree-ic"><Icon name="note" size={15} /></span>
                  <span className="sh-tree-label">{t('shell.org.loose')}</span>
                  <span className="sh-tree-count">{looseCount}</span>
                </button>
              )}
              <div className="sh-tree" role="tree" aria-labelledby="sh-notes-h" ref={treeRef}
                onKeyDown={onTreeKeyDown}
                onContextMenu={(e) => {
                  if (e.target !== e.currentTarget) return;
                  e.preventDefault();
                  setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: vaultMenuItems(), label: activeVaultObj.name });
                }}
                style={virtual ? { height: rows.length * rowH, position: 'relative' } : undefined}>
                {rows.length === 0 && looseCount === 0 && (
                  <div className="sh-empty" {...rootDropHandlers}>
                    <span>{t('shell.tree.empty')}</span>
                    {!readOnly && (
                      <button type="button" className="sh-tree-row sh-addrow" onClick={() => A.newNote()}>
                        <span className="sh-tree-ic"><Icon name="plus" size={15} /></span>
                        <span className="sh-tree-label">{t('tree.newFile')}</span>
                      </button>
                    )}
                  </div>
                )}
                {rows.length === 0 && looseCount > 0 && (
                  !readOnly && (
                    <button type="button" className="sh-tree-row sh-addrow" title={t('shell.org.noFolders')} {...rootDropHandlers}
                      onClick={() => A.newFolder(activeVault, null)}>
                      <span className="sh-tree-ic"><Icon name="folderPlus" size={15} /></span>
                      <span className="sh-tree-label">{t('tree.newFolder')}</span>
                    </button>
                  )
                )}
                {rows.slice(start, end).map((row, k) => {
                  const i = start + k;
                  const dropTarget = row.kind === 'folder' ? dropId === row.id : false;
                  return (
                    <TreeRow key={row.kind + ':' + row.id}
                      row={row}
                      active={showActive && row.kind === 'file' && row.id === activeId}
                      focused={row.id === effectiveFocus}
                      isCanvas={row.kind === 'file' && canvasIds.has(row.id)}
                      dropTarget={dropTarget}
                      style={virtual ? { position: 'absolute', top: i * rowH, left: 0, right: 0 } : undefined}
                      onActivate={openNoteClick}
                      onToggle={toggleFolder}
                      onContext={openRowMenu}
                      onFocusRow={setFocusId}
                      onDragStartRow={onDragStartRow}
                      onDragOverRow={onDragOverRow}
                      onDragLeaveRow={onDragLeaveRow}
                      onDropRow={onDropRow} />
                  );
                })}
              </div>
              {/* Zona de soltado al final del árbol → raíz del vault */}
              <div className={`sh-root-drop${dropId === '__root__' ? ' drop' : ''}`} {...rootDropHandlers} aria-hidden="true" />
            </>
          )}
        </section>

        {tags.length > 0 && (
          <section className="sh-sec" aria-labelledby="sh-tags-h">
            {secHead('tags', 'sh-tags-h', t('shell.tags.title'), tags.length)}
            {secOpen('tags') && (
              <>
                {tags.slice(0, TAGS_SHOWN).map(tg => (
                  <button type="button" key={tg.tag} className="sh-tree-row sh-tagrow"
                    onClick={() => A.openAllNotes({ tab: 'notes', rules: { tags: [tg.tag] } })}
                    title={t('shell.tags.open', { tag: tg.tag })}>
                    <span className="sh-tree-ic"><Icon name="tag" size={14} /></span>
                    <span className="sh-tree-label">{tg.tag}</span>
                    <span className="sh-tree-count">{tg.ids.length}</span>
                  </button>
                ))}
                {tags.length > TAGS_SHOWN && (
                  <button type="button" className="sh-fav sh-more" onClick={() => A.openAllNotes({ tab: 'tags' })}>
                    {t('shell.tags.all', { n: tags.length })}
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {collections.length > 0 && (
          <section className="sh-sec" aria-labelledby="sh-col-h">
            {secHead('collections', 'sh-col-h', t('shell.sec.collections'), collections.length)}
            {secOpen('collections') && (
              <>
                {collections.slice(0, COL_SHOWN).map(c => (
                  <button type="button" key={c.id} className="sh-tree-row sh-colrow"
                    onClick={() => A.openAllNotes({ tab: 'notes', collectionId: c.id })}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: collectionMenuItems(c), label: c.name }); }}>
                    <span className="sh-tree-ic">{c.icon ? <span className="sh-emoji-ic">{c.icon}</span> : <Icon name="collection" size={15} />}</span>
                    <span className="sh-tree-label">{c.name}</span>
                  </button>
                ))}
                {collections.length > COL_SHOWN && (
                  <button type="button" className="sh-fav sh-more" onClick={() => A.openAllNotes({ tab: 'collections' })}>
                    {t('shell.col.all', { n: collections.length })}
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {dbList.length > 0 && (
          <section className="sh-sec" aria-labelledby="sh-db-h">
            {secHead('dbs', 'sh-db-h', t('shell.db.title'), dbList.length)}
            {secOpen('dbs') && dbList.slice(0, DB_SHOWN).map(d => (
              <button type="button" key={d.key} className="sh-fav" onClick={() => A.openTable(d)}
                title={d.sub ? `${d.title} · ${d.sub}` : d.title}>
                <span className="sh-tree-ic">{d.dbNote && d.icon ? <span className="sh-emoji-ic">{d.icon}</span> : <Icon name="database" size={15} />}</span>
                <span className="sh-tree-label">{d.title}{d.sub ? <span className="sh-tree-sub"> · {d.sub}</span> : null}</span>
                <span className="sh-tree-count">{d.rows}</span>
              </button>
            ))}
            {secOpen('dbs') && dbList.length > DB_SHOWN && (
              <button type="button" className="sh-fav sh-more" onClick={() => A.openDatabases()}>{t('shell.db.all', { n: dbList.length })}</button>
            )}
          </section>
        )}
        <section className="sh-sec" aria-labelledby="sh-others-h">
          {secHead('others', 'sh-others-h', t('shell.sec.others'), '')}
          {secOpen('others') && (
            <div className="sh-others">
              <button type="button" className="sh-tree-row sh-otherrow" onClick={() => A.openTrash && A.openTrash()}>
                <span className="sh-tree-ic"><Icon name="trash" size={15} /></span>
                <span className="sh-tree-label">{t('trash.title')}</span>
              </button>
              <button type="button" className={`sh-tree-row sh-otherrow${tplOpen ? ' open' : ''}`} aria-expanded={tplOpen} onClick={toggleTpl}>
                <span className="sh-tree-ic"><Icon name="template" size={15} /></span>
                <span className="sh-tree-label">{t('tpl.title')}</span>
                <span className="sh-tree-count">{index.templates.length || ''}</span>
                <Icon name={tplOpen ? 'chevDown' : 'chevRight'} size={12} stroke={2.2} className="sh-nav-chev" />
              </button>
              {tplOpen && (
                <div className="sh-tpl-list">
                  {index.templates.map(tpl => (
                    <button type="button" key={tpl.id}
                      className={`sh-tree-row${showActive && tpl.id === activeId ? ' on' : ''}`} style={{ paddingLeft: 38 }}
                      title={t('tpl.applyTip')}
                      onClick={() => A.applyTemplate(tpl)}
                      onContextMenu={(e) => { e.preventDefault(); setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: templateMenuItems(tpl), label: baseName(tpl.name) }); }}>
                      <span className="sh-tree-label">{baseName(tpl.name)}</span>
                      <span className="sh-tree-more" role="presentation"
                        onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ anchor: { x: r.left, y: r.bottom + 4 }, items: templateMenuItems(tpl), label: baseName(tpl.name) }); }}>
                        <Icon name="more" size={15} />
                      </span>
                    </button>
                  ))}
                  {!readOnly && (() => {
                    const missing = A.missingTemplateSeeds ? A.missingTemplateSeeds() : (index.templates.length === 0 ? 1 : 0);
                    if (!missing) return null;
                    return (
                      <button type="button" className="sh-tree-row sh-subtle" style={{ paddingLeft: 38 }} onClick={() => A.seedTemplates()}>
                        <span className="sh-tree-label">{index.templates.length === 0 ? t('tpl.seed') : t('tpl.seedMissing', { n: missing })}</span>
                      </button>
                    );
                  })()}
                  {!readOnly && (
                    <button type="button" className="sh-tree-row sh-subtle" style={{ paddingLeft: 38 }} onClick={() => A.newBlankTemplate()}>
                      <span className="sh-tree-label">+ {t('tpl.blank')}</span>
                    </button>
                  )}
                </div>
              )}
              {!readOnly && (
                <button type="button" className="sh-tree-row sh-otherrow" onClick={() => A.importFiles()}>
                  <span className="sh-tree-ic"><Icon name="import" size={15} /></span>
                  <span className="sh-tree-label">{t('shell.sec.import')}</span>
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="sh-side-foot">
        <button type="button" className={`sh-nav sh-nav-settings${routeView === 'settings' ? ' on' : ''}`} aria-current={routeView === 'settings' ? 'page' : undefined}
          title={t('settings.title')} onClick={() => A.openSettings()}>
          <Icon name="settings" size={16} />
          <span className="sh-nav-label">{t('settings.title')}</span>
        </button>
        {updPending && (
          <button type="button" className="sh-upd-pill" title={updTip} onClick={() => A.openSettings('about')}>
            <Icon name="download" size={13} stroke={2} />{t('shell.upd.pill')}
          </button>
        )}
        <button type="button" className="sh-sync-btn" onClick={() => A.openSettings('sync')}
          title={syncLabel(syncStatus, loggedIn)} aria-label={syncLabel(syncStatus, loggedIn)}>
          <span className={`sh-sync-dot sync-${syncStatus}`} aria-hidden="true" />
        </button>
      </div>
      {menu && <Menu anchor={menu.anchor} items={menu.items} label={menu.label} onClose={() => setMenu(null)} />}
    </aside>
  );
});
