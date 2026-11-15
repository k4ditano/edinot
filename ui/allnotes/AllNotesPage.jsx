// «Todas las notas»: las notas del vault como una lista agrupada por fecha o una rejilla,
// con filtros (etiqueta, carpeta, tipo, fecha, favoritas, título), orden, y las colecciones
// (filtros guardados) y las etiquetas en sus propias pestañas.
//
// Fluida con miles de notas: el modelo (model.js) calcula filas de altura fija y aquí sólo
// se pintan las que se ven (más unas pocas de margen). Ver model.js para cómo se ordena,
// se agrupa y de dónde sale la fecha de modificación.

import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { t, useI18n, getLang } from '../../i18n.js';
import { perfCountRender } from '../../perf.js';
import { Icon } from '../shell/icons.jsx';
import { Menu } from '../shell/Menu.jsx';
import { buildItems, sortItems, groupItems, toLines, firstVisible, previewOf, startOfDay, collator } from './model.js';
import { useCollections } from './useCollections.js';
import { TagsFacet, FoldersFacet, TypesFacet, UpdatedFacet, NameForm, DisplayPanel } from './Facets.jsx';
import { compileRules, normalizeRules, emptyRules, ruleCount, rulesAreEmpty, sameRules, foldText } from '../../shared/collections.js';

// «1 nota» / «N notas»
const cnt = (key, n) => (n === 1 ? t(key + '.one') : t(key, { n }));

const VIEW_KEY = 'edinot.allnotes.view.v1';
const DEFAULT_VIEW = { mode: 'list', sort: 'modified', dir: 'desc', group: 'date' };
const OVERSCAN = 6;
const NO_LIST = [];

function readView() {
  try { return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(VIEW_KEY) || 'null') || {}) }; } catch { return DEFAULT_VIEW; }
}

const TYPE_ICON = { note: 'note', canvas: 'canvas', database: 'database' };

// Fecha corta de una fila: la hora si es de hoy, «ayer», el día de la semana o «14 nov».
function shortDate(ts, locale, now) {
  if (!ts) return '';
  const d0 = startOfDay(now);
  if (ts >= d0) return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (ts >= d0 - 86400000) return t('home.yesterday');
  const days = Math.ceil((d0 - ts) / 86400000);
  if (days < 7) return new Date(ts).toLocaleDateString(locale, { weekday: 'short' });
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Date(ts).toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Una nota, en la lista y en la rejilla ───────────────────────────────────
const NoteGlyph = ({ item, size = 18 }) => (
  <span className={`an-ic t-${item.type}`}>
    {item.icon ? <span className="an-emoji">{item.icon}</span> : <Icon name={TYPE_ICON[item.type]} size={size} />}
  </span>
);

const TagChips = ({ tags, max = 2 }) => {
  // Siempre pinta su hueco (aunque no haya etiquetas): así las columnas de la lista quedan alineadas.
  return (
    <span className="an-tags">
      {tags.slice(0, max).map(tg => <span key={tg} className="an-chip">#{tg}</span>)}
      {tags.length > max && <span className="an-chip an-chip-more">+{tags.length - max}</span>}
    </span>
  );
};

const NoteRow = memo(function NoteRow({ item, top, h, cur, active, preview, folderLabel, dateText, dateTitle, readOnly, onOpen, onStar, onMore }) {
  perfCountRender('AllNotesRow');
  return (
    <div role="option" id={'an-opt-' + item.id} aria-selected={cur} data-id={item.id}
      className={`an-row${cur ? ' cur' : ''}${active ? ' active' : ''}`} style={{ top, height: h }}
      onClick={() => onOpen(item.id)} onContextMenu={(e) => { e.preventDefault(); onMore(item, { x: e.clientX, y: e.clientY }); }}>
      <NoteGlyph item={item} />
      <span className="an-main">
        <span className="an-title">{item.name}</span>
        {preview ? <span className="an-prev">{preview}</span> : null}
      </span>
      <span className="an-folder" title={folderLabel}>{folderLabel}</span>
      <TagChips tags={item.tags} />
      <span className="an-date" title={dateTitle}>{dateText}</span>
      <button type="button" className={`an-star${item.pinned ? ' on' : ''}`} tabIndex={-1} disabled={readOnly}
        aria-label={item.pinned ? t('shell.fav.remove') : t('shell.fav.add')} title={item.pinned ? t('shell.fav.remove') : t('shell.fav.add')}
        onClick={(e) => { e.stopPropagation(); onStar(item.id); }}>
        <Icon name="star" size={16} />
      </button>
      <button type="button" className="an-more" tabIndex={-1} aria-label={t('btn.actions')}
        onClick={(e) => { e.stopPropagation(); onMore(item, e.currentTarget.getBoundingClientRect()); }}>
        <Icon name="more" size={16} />
      </button>
    </div>
  );
});

const NoteCard = memo(function NoteCard({ item, cur, active, preview, folderLabel, dateText, readOnly, onOpen, onStar, onMore }) {
  return (
    <div role="option" id={'an-opt-' + item.id} aria-selected={cur} data-id={item.id}
      className={`an-card${cur ? ' cur' : ''}${active ? ' active' : ''}`}
      onClick={() => onOpen(item.id)} onContextMenu={(e) => { e.preventDefault(); onMore(item, { x: e.clientX, y: e.clientY }); }}>
      <div className="an-card-top">
        <NoteGlyph item={item} />
        <span className="an-card-title">{item.name}</span>
        <button type="button" className={`an-star${item.pinned ? ' on' : ''}`} tabIndex={-1} disabled={readOnly}
          aria-label={item.pinned ? t('shell.fav.remove') : t('shell.fav.add')}
          onClick={(e) => { e.stopPropagation(); onStar(item.id); }}>
          <Icon name="star" size={15} />
        </button>
      </div>
      <div className="an-card-prev">{preview}</div>
      <div className="an-card-foot">
        <TagChips tags={item.tags} max={2} />
        <span className="an-card-meta">{folderLabel ? folderLabel + ' · ' : ''}{dateText}</span>
      </div>
    </div>
  );
});

// ── La página ──────────────────────────────────────────────────────────────
export const AllNotesPage = memo(function AllNotesPage({
  vaultId, vaultName, notes, folders, templateFolderIds, tags, canvasIds, dbIds, fileStats, editLog, editStamps,
  getText, activeId, readOnly, request, actions: A,
}) {
  perfCountRender('AllNotesPage');
  useI18n();
  const lang = getLang();
  const locale = lang === 'en' ? 'en-GB' : 'es-ES';
  const { collections, saveCollection, deleteCollection } = useCollections(vaultId);

  const [tab, setTab] = useState('notes');
  const [rules, setRulesRaw] = useState(emptyRules);
  const [colId, setColId] = useState(null);
  const [view, setViewRaw] = useState(readView);
  const [pop, setPop] = useState(null);       // { kind, anchor, … } → <Menu>
  const [cursor, setCursor] = useState(-1);
  const [tagQ, setTagQ] = useState('');
  const setView = useCallback((u) => setViewRaw(prev => {
    const n = typeof u === 'function' ? u(prev) : u;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(n)); } catch {}
    return n;
  }), []);
  const setRules = useCallback((u) => setRulesRaw(prev => normalizeRules(typeof u === 'function' ? u(prev) : u)), []);

  // Lo que pide la barra lateral (una etiqueta, una carpeta, una colección, otra pestaña).
  const colsRef = useRef(collections);
  colsRef.current = collections;
  useEffect(() => {
    if (!request) return;
    setTab(request.tab || 'notes');
    const col = request.collectionId ? colsRef.current.find(c => c.id === request.collectionId) : null;
    if (col) { setRulesRaw(normalizeRules(col.rules)); setColId(col.id); }
    else { setRulesRaw(normalizeRules(request.rules)); setColId(null); }
    setCursor(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request && request.seq]);
  // Otro vault: otra lista (y otras colecciones).
  const vaultRef = useRef(vaultId);
  useEffect(() => {
    if (vaultRef.current === vaultId) return;
    vaultRef.current = vaultId;
    setRulesRaw(emptyRules()); setColId(null); setCursor(-1);
  }, [vaultId]);

  // ── Datos ────────────────────────────────────────────────────────────────
  const tplIds = templateFolderIds;
  const vaultNotes = useMemo(() => notes.filter(f => (f.vaultId || 'default') === vaultId && !(f.folderId && tplIds && tplIds.has(f.folderId))), [notes, vaultId, tplIds]);
  const { tagsById, vaultTags } = useMemo(() => {
    const ids = new Set(vaultNotes.map(f => f.id));
    const byId = new Map(); const out = [];
    for (const e of tags || NO_LIST) {
      const k = e.tag.toLowerCase();
      let n = 0;
      for (const id of e.ids) {
        if (!ids.has(id)) continue;
        n++;
        let l = byId.get(id);
        if (!l) { l = []; byId.set(id, l); }
        l.push(k);
      }
      if (n) out.push({ tag: e.tag, count: n });
    }
    out.sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
    return { tagsById: byId, vaultTags: out };
  }, [tags, vaultNotes]);
  const aiAt = useMemo(() => {
    const m = new Map();
    for (const e of editLog || NO_LIST) {
      const ts = e && Date.parse(e.ts);
      if (e && e.noteId && Number.isFinite(ts) && ts > (m.get(e.noteId) || 0)) m.set(e.noteId, ts);
    }
    return m;
  }, [editLog]);
  const all = useMemo(
    () => buildItems({ files: vaultNotes, vaultId, canvasIds, dbIds, tagsById, editStamps, aiAt, fileStats }),
    [vaultNotes, vaultId, canvasIds, dbIds, tagsById, editStamps, aiAt, fileStats],
  );
  // Carpetas del vault en orden de árbol, con su profundidad y cuántas notas llevan dentro.
  const { parentOf, folderRows, folderPath, looseCount } = useMemo(() => {
    const mine = (folders || NO_LIST).filter(f => (f.vaultId || 'default') === vaultId && !(tplIds && tplIds.has(f.id)));
    const byId = new Map(mine.map(f => [f.id, f]));
    const parentOf = new Map(mine.map(f => [f.id, f.parentId && byId.has(f.parentId) ? f.parentId : null]));
    const kids = new Map();
    for (const f of mine) { const p = parentOf.get(f.id) || ''; (kids.get(p) || kids.set(p, []).get(p)).push(f); }
    for (const l of kids.values()) l.sort((a, b) => collator.compare(a.name, b.name));
    const direct = new Map(); let loose = 0;
    for (const it of all) { if (it.folderId && byId.has(it.folderId)) direct.set(it.folderId, (direct.get(it.folderId) || 0) + 1); else loose++; }
    const pathOf = (id) => { const out = []; let cur = id, hops = 0; while (cur && byId.has(cur) && hops++ < 64) { out.unshift(byId.get(cur).name); cur = parentOf.get(cur); } return out.join(' / '); };
    const rows = [];
    const walk = (p, depth, seen) => {
      let sum = 0;
      for (const f of kids.get(p) || []) {
        if (seen.has(f.id)) continue;
        const row = { id: f.id, name: f.name, depth, path: pathOf(f.id), count: 0 };
        rows.push(row);
        const s2 = new Set(seen); s2.add(f.id);
        row.count = (direct.get(f.id) || 0) + walk(f.id, depth + 1, s2);
        sum += row.count;
      }
      return sum;
    };
    walk('', 0, new Set());
    return { parentOf, folderRows: rows, folderPath: pathOf, looseCount: loose };
  }, [folders, vaultId, tplIds, all]);
  const folderLabel = useCallback((id) => { const p = folderPath(id).split(' / '); return p.slice(-2).join(' / '); }, [folderPath]);

  const now = useMemo(() => Date.now(), [all, view.group]); // eslint-disable-line react-hooks/exhaustive-deps
  const test = useMemo(() => compileRules(rules, { parentOf, now }), [rules, parentOf, now]);
  const filtered = useMemo(() => all.filter(test), [all, test]);
  const labels = useMemo(() => ({
    today: t('an.g.today'), yesterday: t('an.g.yesterday'), week: t('an.g.week'), month: t('an.g.month'), none: t('an.g.none'),
    locale, noFolder: t('shell.org.loose'), folderLabel,
    type: { note: t('an.type.note'), canvas: t('an.type.canvas'), database: t('an.type.database') },
  }), [lang, locale, folderLabel]);
  const groups = useMemo(() => {
    const sorted = sortItems(filtered, view.sort, view.dir);
    return groupItems(sorted, view.group, view.sort, labels, now);
  }, [filtered, view.sort, view.dir, view.group, labels, now]);
  const typeCounts = useMemo(() => { const c = {}; for (const it of all) c[it.type] = (c[it.type] || 0) + 1; return c; }, [all]);
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  // ── Ventana visible ─────────────────────────────────────────────────────
  const scrollRef = useRef(null);
  const [box, setBox] = useState({ top: 0, h: 700, w: 900 });
  const grid = view.mode === 'grid';
  const perRow = grid ? Math.max(1, Math.floor((box.w - 56 + 14) / (230 + 14))) : 1;
  const model = useMemo(() => toLines(groups, view.mode, perRow), [groups, view.mode, perRow]);
  const lineOfItem = useMemo(() => {
    const m = new Array(model.count);
    model.lines.forEach((l, i) => { if (l.kind === 'row') m[l.index] = i; else if (l.kind === 'cards') l.items.forEach((_, k) => { m[l.first + k] = i; }); });
    return m;
  }, [model]);
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    let raf = 0;
    const read = () => { raf = 0; setBox(b => (b.top === sc.scrollTop && b.h === sc.clientHeight && b.w === sc.clientWidth) ? b : { top: sc.scrollTop, h: sc.clientHeight, w: sc.clientWidth }); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(sc);
    return () => { sc.removeEventListener('scroll', onScroll); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [tab, flat.length === 0]);
  // Volver arriba al cambiar lo que se muestra (otro filtro, otra vista).
  useEffect(() => { const sc = scrollRef.current; if (sc) sc.scrollTop = 0; }, [rules, view.mode, view.sort, view.dir, view.group, tab]);

  const first = Math.max(0, firstVisible(model.lines, box.top) - OVERSCAN);
  let last = first;
  while (last < model.lines.length && model.lines[last].top < box.top + box.h + OVERSCAN * 60) last++;
  const visible = model.lines.slice(first, last);

  // ── Acciones ─────────────────────────────────────────────────────────────
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }), [locale]);
  const openNote = useCallback((id) => A.openNote(id), [A]);
  const star = useCallback((id) => A.togglePin(id), [A]);
  const noteMenu = useCallback((item, anchor) => {
    const folders = [];
    for (const r of folderRows) folders.push({ label: ' '.repeat(r.depth) + r.name, icon: 'folder', disabled: r.id === item.folderId, onSelect: () => A.moveToFolder(item.id, r.id) });
    const items = [{ label: t('shell.tree.open'), icon: 'note', onSelect: () => A.openNote(item.id) }];
    if (!readOnly) items.push(
      { label: t('btn.rename'), icon: 'edit', onSelect: () => A.renameFile(item.id) },
      { label: t('btn.duplicate'), icon: 'copy', onSelect: () => A.duplicateFile(item.id) },
    );
    items.push({ label: item.pinned ? t('shell.fav.remove') : t('shell.fav.add'), icon: 'star', onSelect: () => A.togglePin(item.id) });
    if (!readOnly) {
      items.push({ type: 'sep' });
      items.push({ label: t('row.moveToFolder'), icon: 'move', submenu: () => [
        ...(item.folderId ? [{ label: t('shell.tree.moveRoot'), icon: 'vault', onSelect: () => A.moveToFolder(item.id, null) }] : []),
        ...(folders.length ? folders : [{ label: t('folder.noChildren'), disabled: true }]),
      ] });
      items.push({ type: 'sep' });
      items.push({ label: t('btn.delete'), icon: 'trash', danger: true, onSelect: () => A.deleteFile(item.id) });
    }
    setPop({ kind: 'menu', anchor, items, label: item.name });
  }, [A, folderRows, readOnly]);

  const oneFolder = rules.folders.length === 1 && !rules.noFolder ? rules.folders[0] : null;
  const newNote = () => { if (oneFolder) A.newNoteIn(vaultId, oneFolder); else A.newNote(); };
  const colById = useMemo(() => new Map(collections.map(c => [c.id, c])), [collections]);
  const activeCol = colId ? colById.get(colId) || null : null;
  useEffect(() => { if (colId && !colById.has(colId)) setColId(null); }, [colId, colById]);
  const dirty = activeCol && !sameRules(activeCol.rules, rules);
  const nFilters = ruleCount(rules);
  const clearAll = () => { setRulesRaw(emptyRules()); setColId(null); };
  const chipNames = (ids, f) => ids.map(f).join(', ');

  // ── Teclado de la lista ─────────────────────────────────────────────────
  const reveal = useCallback((i) => {
    const sc = scrollRef.current, l = model.lines[lineOfItem[i]];
    if (!sc || !l) return;
    if (l.top < sc.scrollTop) sc.scrollTop = l.top - 8;
    else if (l.top + l.h > sc.scrollTop + sc.clientHeight) sc.scrollTop = l.top + l.h - sc.clientHeight + 8;
  }, [model, lineOfItem]);
  const onKeyDown = (e) => {
    if (!flat.length) return;
    const n = flat.length;
    const step = grid ? perRow : 1;
    let c = cursor;
    switch (e.key) {
      case 'ArrowDown': c = Math.min(n - 1, (c < 0 ? -step : c) + step); break;
      case 'ArrowUp': c = Math.max(0, (c < 0 ? 0 : c) - step); break;
      case 'ArrowRight': if (!grid) return; c = Math.min(n - 1, c + 1); break;
      case 'ArrowLeft': if (!grid) return; c = Math.max(0, c - 1); break;
      case 'PageDown': c = Math.min(n - 1, Math.max(0, c) + Math.max(1, Math.floor(box.h / (grid ? 158 : 60))) * step); break;
      case 'PageUp': c = Math.max(0, Math.max(0, c) - Math.max(1, Math.floor(box.h / (grid ? 158 : 60))) * step); break;
      case 'Home': c = 0; break;
      case 'End': c = n - 1; break;
      case 'Enter': if (c >= 0) { e.preventDefault(); A.openNote(flat[c].id); } return;
      default: return;
    }
    e.preventDefault();
    setCursor(c);
    reveal(c);
  };

  // ── Desplegables ────────────────────────────────────────────────────────
  const anchorOf = (e) => e.currentTarget.getBoundingClientRect();
  const openPop = (kind, e, extra) => setPop({ kind, anchor: anchorOf(e), ...extra });
  const facetItems = () => {
    const close = () => setPop(null);
    const custom = (render) => [{ type: 'custom', render }];
    switch (pop.kind) {
      case 'menu': return pop.items;
      case 'add': return [
        { type: 'head', label: t('an.filter.add') },
        { label: t('an.f.tags'), icon: 'tag', onSelect: () => setPop({ kind: 'tags', anchor: pop.anchor }) },
        { label: t('an.f.folders'), icon: 'folder', onSelect: () => setPop({ kind: 'folders', anchor: pop.anchor }) },
        { label: t('an.f.types'), icon: 'note', onSelect: () => setPop({ kind: 'types', anchor: pop.anchor }) },
        { label: t('an.f.updated'), icon: 'clock', onSelect: () => setPop({ kind: 'updated', anchor: pop.anchor }) },
        { label: t('an.f.pinned'), icon: 'star', checked: rules.pinned, onSelect: () => setRules(r => ({ ...r, pinned: !r.pinned })) },
      ];
      case 'tags': return custom(() => <TagsFacet tags={vaultTags} rules={rules} setRules={setRules} />);
      case 'folders': return custom(() => <FoldersFacet folderRows={folderRows} looseCount={looseCount} rules={rules} setRules={setRules} />);
      case 'types': return custom(() => <TypesFacet rules={rules} setRules={setRules} counts={typeCounts} />);
      case 'updated': return custom(() => <UpdatedFacet rules={rules} setRules={setRules} close={close} />);
      case 'display': return custom(() => <DisplayPanel view={view} setView={setView} />);
      case 'save': return custom((c) => <NameForm submitLabel={t('an.col.create')} close={c}
        onSubmit={(name) => { const col = saveCollection({ name, rules }); if (col) setColId(col.id); }} />);
      case 'rename': return custom((c) => <NameForm initial={pop.name} submitLabel={t('btn.rename')} close={c}
        onSubmit={(name) => saveCollection({ id: pop.id, name })} />);
      case 'new': return [
        { label: t('tree.newFile'), icon: 'note', onSelect: newNote },
        { label: t('tree.newCanvas'), icon: 'canvas', onSelect: () => A.newCanvas() },
        { label: t('cmd.newDatabase'), icon: 'database', onSelect: () => A.newDatabase() },
      ];
      default: return [];
    }
  };

  // ── Piezas de la cabecera ───────────────────────────────────────────────
  const tabBtn = (k, label) => (
    <button type="button" role="tab" aria-selected={tab === k} className={`an-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{label}</button>
  );
  const chip = (key, icon, text, onOpen, onClear) => (
    <span key={key} className="an-fchip">
      <button type="button" className="an-fchip-main" onClick={onOpen}><Icon name={icon} size={13} /><span>{text}</span></button>
      <button type="button" className="an-fchip-x" aria-label={t('an.f.remove')} onClick={onClear}><Icon name="close" size={12} stroke={2} /></button>
    </span>
  );

  // Colecciones: cuántas notas cumple cada una.
  const colCounts = useMemo(() => {
    const m = {};
    for (const c of collections) { const f = compileRules(c.rules, { parentOf, now }); let n = 0; for (const it of all) if (f(it)) n++; m[c.id] = n; }
    return m;
  }, [collections, all, parentOf, now]);
  const ruleBits = (r) => {
    const bits = [];
    if (r.tags.length) bits.push('#' + r.tags.slice(0, 3).join(' #') + (r.tags.length > 3 ? ' …' : ''));
    if (r.folders.length) bits.push(t('an.f.folders') + ': ' + chipNames(r.folders.slice(0, 2), id => (folderPath(id).split(' / ').pop() || '—')) + (r.folders.length > 2 ? ' …' : ''));
    if (r.noFolder) bits.push(t('shell.org.loose'));
    if (r.types.length) bits.push(r.types.map(x => t('an.type.' + x)).join(', '));
    if (r.pinned) bits.push(t('an.f.pinned'));
    if (r.updated) bits.push(t('an.f.upd.' + r.updated));
    if (r.text) bits.push('“' + r.text + '”');
    return bits;
  };

  // ── Pestañas ────────────────────────────────────────────────────────────
  const previews = useRef(new Map());
  const previewFor = (id) => {
    const text = getText(id) || '';
    const hit = previews.current.get(id);
    if (hit && hit.text === text) return hit.p;
    const p = previewOf(text);
    if (previews.current.size > 3000) previews.current.clear();
    previews.current.set(id, { text, p });
    return p;
  };

  const notesPane = (
    <>
      <div className="an-bar">
        <div className="an-fchips">
          {rules.pinned && chip('pinned', 'star', t('an.f.pinned'), () => setRules(r => ({ ...r, pinned: false })), () => setRules(r => ({ ...r, pinned: false })))}
          {rules.tags.length > 0 && chip('tags', 'tag', (rules.tags.length > 1 ? t('an.f.tagMode.' + rules.tagMode) + ': ' : '') + rules.tags.map(x => '#' + x).join(' '), (e) => openPop('tags', e), () => setRules(r => ({ ...r, tags: [] })))}
          {(rules.folders.length > 0 || rules.noFolder) && chip('folders', 'folder',
            [rules.noFolder ? t('shell.org.loose') : null, ...rules.folders.map(id => folderPath(id).split(' / ').pop() || '—')].filter(Boolean).join(', '),
            (e) => openPop('folders', e), () => setRules(r => ({ ...r, folders: [], noFolder: false })))}
          {rules.types.length > 0 && chip('types', 'note', rules.types.map(x => t('an.type.' + x)).join(', '), (e) => openPop('types', e), () => setRules(r => ({ ...r, types: [] })))}
          {rules.updated && chip('updated', 'clock', t('an.f.upd.' + rules.updated), (e) => openPop('updated', e), () => setRules(r => ({ ...r, updated: null })))}
          <button type="button" className="an-btn an-btn-ghost" onClick={(e) => openPop('add', e)}>
            <Icon name="plus" size={14} stroke={1.9} />{t('an.filter')}
          </button>
          <label className="an-find">
            <Icon name="search" size={14} />
            <input value={rules.text} onChange={(e) => setRules(r => ({ ...r, text: e.target.value }))} placeholder={t('an.f.text')} spellCheck={false}
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); const l = document.getElementById('an-list'); if (l) l.focus(); setCursor(c => (c < 0 && flat.length ? 0 : c)); } }} />
          </label>
        </div>
        <div className="an-bar-right">
          {nFilters > 0 && <button type="button" className="an-btn an-btn-ghost" onClick={clearAll}>{t('an.f.clear')}</button>}
          {!readOnly && nFilters > 0 && !activeCol && (
            <button type="button" className="an-btn" onClick={(e) => openPop('save', e)}><Icon name="collection" size={14} />{t('an.col.save')}</button>
          )}
        </div>
      </div>
      {activeCol && (
        <div className="an-colbar">
          <Icon name="collection" size={15} />
          <span className="an-colbar-name">{activeCol.name}</span>
          <span className="an-colbar-n">{cnt('an.col.count', colCounts[activeCol.id] != null ? colCounts[activeCol.id] : 0)}</span>
          {!readOnly && dirty && (
            <>
              <button type="button" className="an-btn an-btn-primary an-btn-sm" onClick={() => saveCollection({ id: activeCol.id, rules })}>{t('an.col.update')}</button>
              <button type="button" className="an-btn an-btn-sm" onClick={(e) => openPop('save', e)}>{t('an.col.saveNew')}</button>
            </>
          )}
          <button type="button" className="an-btn an-btn-ghost an-btn-sm" onClick={() => setColId(null)}>{t('an.col.leave')}</button>
        </div>
      )}
      {flat.length === 0 ? (
        <div className="an-empty">
          <Icon name={all.length ? 'filter' : 'allnotes'} size={30} stroke={1.4} />
          <div className="an-empty-title">{all.length ? t('an.empty.title') : t('an.empty.none')}</div>
          {all.length > 0 && <div className="an-empty-sub">{t('an.empty.sub')}</div>}
          {all.length > 0 && nFilters > 0 && <button type="button" className="an-btn" onClick={clearAll}>{t('an.f.clear')}</button>}
          {!all.length && !readOnly && <button type="button" className="an-btn an-btn-primary" onClick={() => A.newNote()}>{t('tree.newFile')}</button>}
        </div>
      ) : (
        <div className="an-scroll" ref={scrollRef}>
          <div id="an-list" className={`an-list${grid ? ' grid' : ''}`} role="listbox" tabIndex={0} aria-label={t('shell.nav.all')}
            aria-activedescendant={cursor >= 0 && flat[cursor] ? 'an-opt-' + flat[cursor].id : undefined}
            onKeyDown={onKeyDown} style={{ height: model.total }}>
            {visible.map((l) => {
              if (l.kind === 'head') {
                return <div key={l.key} className="an-head" role="presentation" style={{ top: l.top, height: l.h }}><span>{l.label}</span><span className="an-head-n">{l.count}</span></div>;
              }
              if (l.kind === 'row') {
                const it = l.item;
                return <NoteRow key={l.key} item={it} top={l.top} h={l.h} cur={l.index === cursor} active={it.id === activeId}
                  preview={previewFor(it.id)} folderLabel={it.folderId ? folderLabel(it.folderId) : ''}
                  dateText={shortDate(view.sort === 'created' ? it.createdAt : view.sort === 'opened' ? it.openedAt : it.updatedAt, locale, now)}
                  dateTitle={it.updatedAt ? dayFmt.format(it.updatedAt) : ''}
                  readOnly={readOnly} onOpen={openNote} onStar={star} onMore={noteMenu} />;
              }
              return (
                <div key={l.key} className="an-cards" role="presentation" style={{ top: l.top, height: l.h, gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
                  {l.items.map((it, k) => (
                    <NoteCard key={it.id} item={it} cur={l.first + k === cursor} active={it.id === activeId} preview={previewFor(it.id)}
                      folderLabel={it.folderId ? folderLabel(it.folderId) : ''} dateText={shortDate(it.updatedAt, locale, now)}
                      readOnly={readOnly} onOpen={openNote} onStar={star} onMore={noteMenu} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  const collectionsPane = (
    <div className="an-scroll an-pad" ref={scrollRef}>
      {collections.length === 0 ? (
        <div className="an-empty">
          <Icon name="collection" size={30} stroke={1.4} />
          <div className="an-empty-title">{t('an.col.empty.title')}</div>
          <div className="an-empty-sub">{t('an.col.empty.sub')}</div>
          <button type="button" className="an-btn" onClick={() => setTab('notes')}>{t('an.col.go')}</button>
        </div>
      ) : (
        <div className="an-colgrid">
          {collections.map(c => (
            <div key={c.id} className="an-col" role="button" tabIndex={0}
              onClick={() => { setRulesRaw(normalizeRules(c.rules)); setColId(c.id); setTab('notes'); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { setRulesRaw(normalizeRules(c.rules)); setColId(c.id); setTab('notes'); } }}>
              <div className="an-col-top">
                <span className="an-ic t-col">{c.icon ? <span className="an-emoji">{c.icon}</span> : <Icon name="collection" size={18} />}</span>
                <span className="an-col-name">{c.name}</span>
                {!readOnly && (
                  <button type="button" className="an-more on" aria-label={t('btn.actions')} onClick={(e) => {
                    e.stopPropagation();
                    setPop({ kind: 'menu', anchor: e.currentTarget.getBoundingClientRect(), label: c.name, items: [
                      { label: t('shell.tree.open'), icon: 'collection', onSelect: () => { setRulesRaw(normalizeRules(c.rules)); setColId(c.id); setTab('notes'); } },
                      { label: t('btn.rename'), icon: 'edit', onSelect: () => setPop({ kind: 'rename', id: c.id, name: c.name, anchor: { x: window.innerWidth / 2 - 150, y: 160 } }) },
                      { type: 'sep' },
                      { label: t('an.col.delete'), icon: 'trash', danger: true, onSelect: () => { deleteCollection(c.id); } },
                    ] });
                  }}><Icon name="more" size={16} /></button>
                )}
              </div>
              <div className="an-col-bits">{ruleBits(c.rules).map((b, i) => <span key={i} className="an-chip">{b}</span>)}{rulesAreEmpty(c.rules) && <span className="an-chip">{t('an.col.all')}</span>}</div>
              <div className="an-col-n">{cnt('an.col.count', colCounts[c.id] != null ? colCounts[c.id] : 0)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const tagRows = useMemo(() => { const f = foldText(tagQ); return vaultTags.filter(x => !f || foldText(x.tag).includes(f)); }, [vaultTags, tagQ]);
  const tagsPane = (
    <div className="an-scroll an-pad" ref={scrollRef}>
      <label className="an-find an-find-wide">
        <Icon name="search" size={14} />
        <input value={tagQ} onChange={(e) => setTagQ(e.target.value)} placeholder={t('an.tags.search')} spellCheck={false} />
      </label>
      {vaultTags.length === 0 ? (
        <div className="an-empty"><Icon name="tag" size={30} stroke={1.4} /><div className="an-empty-title">{t('an.tags.empty')}</div></div>
      ) : (
        <div className="an-taglist">
          {tagRows.slice(0, 600).map(x => (
            <button type="button" key={x.tag} className="an-tagrow" onClick={() => { setRulesRaw({ ...emptyRules(), tags: [x.tag] }); setColId(null); setTab('notes'); }}>
              <Icon name="tag" size={15} /><span className="an-tagrow-name">{x.tag}</span><span className="an-tagrow-n">{cnt('an.tags.notes', x.count)}</span>
            </button>
          ))}
          {tagRows.length > 600 && <div className="an-pop-empty">{t('an.tags.more', { n: tagRows.length - 600 })}</div>}
        </div>
      )}
    </div>
  );

  const countLabel = flat.length === all.length ? cnt('an.count', all.length) : t('an.count.of', { n: flat.length, total: all.length });
  return (
    <section className="an" aria-label={t('shell.nav.all')}>
      <header className="an-top">
        <div className="an-tabs" role="tablist">
          {tabBtn('notes', t('an.tab.notes'))}
          {tabBtn('collections', t('an.tab.collections'))}
          {tabBtn('tags', t('an.tab.tags'))}
          {tab === 'notes' && <span className="an-count">{countLabel}</span>}
        </div>
        <div className="an-controls">
          {tab === 'notes' && (
            <>
              <div className="an-seg an-seg-ic" role="radiogroup" aria-label={t('an.view')}>
                <button type="button" role="radio" aria-checked={!grid} className={!grid ? 'on' : ''} title={t('an.view.list')} aria-label={t('an.view.list')} onClick={() => setView(v => ({ ...v, mode: 'list' }))}><Icon name="listview" size={16} /></button>
                <button type="button" role="radio" aria-checked={grid} className={grid ? 'on' : ''} title={t('an.view.grid')} aria-label={t('an.view.grid')} onClick={() => setView(v => ({ ...v, mode: 'grid' }))}><Icon name="gridview" size={16} /></button>
              </div>
              <button type="button" className="an-btn" onClick={(e) => openPop('display', e)}><Icon name="sort" size={14} />{t('an.display')}</button>
            </>
          )}
          {!readOnly && (
            <button type="button" className="an-btn an-btn-primary" onClick={(e) => openPop('new', e)}><Icon name="plus" size={14} stroke={1.9} />{t('an.new')}</button>
          )}
        </div>
      </header>
      {tab === 'notes' ? notesPane : tab === 'collections' ? collectionsPane : tagsPane}
      {pop && <Menu anchor={pop.anchor} items={facetItems()} label={pop.label} align={pop.kind === 'new' ? 'end' : 'start'}
        minWidth={pop.kind === 'tags' || pop.kind === 'folders' ? 300 : pop.kind === 'display' ? 330 : pop.kind === 'save' || pop.kind === 'rename' ? 280 : 220}
        className={'an-menu' + (['tags', 'folders', 'types', 'updated', 'display', 'save', 'rename'].includes(pop.kind) ? ' an-menu-panel' : '')}
        onClose={() => setPop(null)} />}
    </section>
  );
});
