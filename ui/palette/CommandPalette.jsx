// Ctrl K — buscador y lanzador de comandos.
//
// Una sola caja con filtros (Todo · Notas · Contenido · Canvas · Bases de
// datos · Comandos · Por significado), resultados agrupados y vista previa
// de la nota enfocada. «#etiqueta» lista las notas que la llevan.
// Reutiliza las búsquedas ya optimizadas del editor (buildViewMenuResults
// para nombres, buildGlobalSearchResults para contenido, cachés de plegado
// de acentos), que llegan inyectadas en `search` para no duplicar lógica.
//
// Coste por tecla: los nombres siguen a `useDeferredValue(query)` y el
// contenido a un debounce de 90 ms dentro de una transición — igual que los
// antiguos ViewMenu / GlobalSearchModal, así escribir nunca espera al escaneo.

import { useState, useEffect, useMemo, useRef, useDeferredValue, useTransition, memo } from 'react';
import { t, useI18n } from '../../i18n.js';
import { perfCountRender } from '../../perf.js';
import { Icon } from '../shell/icons.jsx';
import { filterCommands } from './commands.js';

export const PALETTE_FILTERS = ['all', 'notes', 'content', 'canvas', 'db', 'commands'];
const FILTER_LABEL = {
  all: 'pal.f.all', notes: 'pal.f.notes', content: 'pal.f.content',
  canvas: 'pal.f.canvas', db: 'pal.f.db', commands: 'pal.f.commands',
};
const NO_TABLES = [];
const baseName = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');

// Texto plano aproximado de una línea de markdown para la vista previa.
function plainLine(l) {
  return String(l)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function previewOf(file) {
  const text = (file && file.content) || '';
  const lines = text.split(/\r?\n/);
  const paras = [];
  const tags = new Set();
  let fence = false, title = null;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    for (const m of raw.matchAll(/(^|\s)#([\p{L}\d][\p{L}\d_-]{1,30})/gu)) { if (tags.size < 4) tags.add(m[2]); }
    if (/^\s*#{1,6}\s/.test(raw)) { if (!title && /^\s*#\s/.test(raw)) title = plainLine(raw.replace(/^\s*#+\s*/, '')); continue; }
    if (/^\s*\|/.test(raw)) continue;
    const p = plainLine(raw);
    if (p && paras.length < 4) paras.push(p.length > 260 ? p.slice(0, 260) + '…' : p);
  }
  return { title, paras, tags: [...tags] };
}

const Row = memo(function Row({ item, focused, onHover, onPick, idx }) {
  perfCountRender('PaletteRow');
  return (
    <div role="option" aria-selected={focused} id={'pal-opt-' + idx} data-idx={idx}
      className={`pal-row${focused ? ' focused' : ''}${item.kind === 'content' ? ' pal-row-col' : ''}`}
      onMouseMove={() => onHover(idx)} onClick={() => onPick(idx)}>
      {item.render()}
    </div>
  );
});

// Cerrada no cuesta nada: EdinotApp re-renderiza en cada bump de contenido
// mientras se escribe y la paleta recibe `files`; el cuerpo (y sus memos
// sobre todas las notas) sólo existe mientras está abierta. Al abrirse se
// monta de cero, igual que antes reiniciaba consulta y filtro.
export function CommandPalette(props) {
  if (!props.open) return null;
  return <PaletteBody {...props} />;
}

function PaletteBody({
  open, onClose, initialFilter = 'all', files, folders, vaults, fileStats, scopeVaultId, showVault,
  search, commands, onOpenNote, onJump, onCreateNote, canCreate, warmup, allVaults,
  initialQuery = '', openedAt, tables = NO_TABLES, tagIndex, onOpenTable,
}) {
  perfCountRender('CommandPalette');
  useI18n();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [attachTick, setAttachTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery || '');
    setFilter(initialFilter || 'all');
    setFocusIdx(0);
    const id = setTimeout(() => inputRef.current && inputRef.current.focus(), 20);
    return () => clearTimeout(id);
  }, [open, initialFilter, initialQuery, openedAt]);

  // Precalienta la caché de plegado y el texto de adjuntos (como hacía el
  // buscador global) mientras la paleta está abierta.
  useEffect(() => {
    if (!open || !warmup) return;
    return warmup(() => setAttachTick(x => x + 1));
  }, [open, warmup, files]);

  const deferredQuery = useDeferredValue(query);
  const rawQ = query.trim();
  const [q, setQ] = useState('');
  const [, startTransition] = useTransition();
  useEffect(() => {
    const id = setTimeout(() => startTransition(() => setQ(rawQ)), 90);
    return () => clearTimeout(id);
  }, [rawQ]);

  const nameQ = deferredQuery.trim();
  const wantNames = filter === 'all' || filter === 'notes' || filter === 'canvas';
  const wantContent = filter === 'all' || filter === 'content';

  const nameHits = useMemo(() => {
    if (!open || !wantNames || !nameQ) return [];
    return search.buildViewMenuResults(files, folders, vaults, nameQ, fileStats, { scopeVaultId, showVault, namesOnly: true });
  }, [open, wantNames, nameQ, files, folders, vaults, fileStats, scopeVaultId, showVault, search]);

  // Contenido: asíncrono (índice en worker; si no está, escaneo síncrono de
  // respaldo dentro de la misma promesa). Mientras llega la respuesta se
  // mantienen los resultados anteriores para no parpadear «sin resultados».
  const [contentHits, setContentHits] = useState([]);
  useEffect(() => {
    if (!open || !wantContent || !q) { setContentHits(prev => (prev.length ? [] : prev)); return; }
    let cancelled = false;
    const run = search.buildGlobalSearchResultsAsync
      ? search.buildGlobalSearchResultsAsync(files, q, fileStats)
      : Promise.resolve(search.buildGlobalSearchResults(files, q, fileStats));
    run.then((hits) => { if (!cancelled) startTransition(() => setContentHits(hits || [])); })
      .catch((err) => { console.warn('[search] contenido', err); if (!cancelled) setContentHits([]); });
    return () => { cancelled = true; };
    // attachTick: refresca cuando llega texto de adjuntos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wantContent, q, files, fileStats, search, attachTick]);

  const filesById = useMemo(() => new Map(files.map(f => [f.id, f])), [files]);

  const recents = useMemo(() => {
    if (!open || nameQ) return [];
    const st = fileStats || {};
    return files
      .filter(f => ((st[f.id] || {}).t || 0) > 0 && !search.isTemplateFile(f, folders))
      .sort((a, b) => st[b.id].t - st[a.id].t)
      .slice(0, 40);
  }, [open, nameQ, files, fileStats, folders, search]);

  const exactExists = useMemo(() => {
    if (!nameQ) return true;
    const qf = search.gsFold(nameQ.toLowerCase());
    return files.some(f => search.vmNameInfo(f).folded === qf);
  }, [nameQ, files, search]);

  // ── Filas agrupadas ───────────────────────────────────────────────────
  const groups = useMemo(() => {
    if (!open) return [];
    const out = [];
    const crumbOf = (f) => search.vmBreadcrumb(f, folders, vaults, showVault);
    const noteItem = (f, extra = {}) => {
      const isCanvas = search.vmIsCanvasNote(f);
      const rel = search.vmRelTime((fileStats[f.id] || {}).t);
      const sub = [isCanvas ? t('view.badge.canvas') : null, crumbOf(f), rel].filter(Boolean).join(' · ');
      return {
        kind: 'note', id: 'n:' + f.id, fileId: f.id,
        run: () => onOpenNote(f.id),
        render: () => (
          <>
            <span className="pal-ic">{f.icon ? <span className="pal-emoji">{f.icon}</span> : <Icon name={isCanvas ? 'canvas' : 'note'} size={16} />}</span>
            <span className="pal-text">
              <span className="pal-title">{extra.nameNode || baseName(f.name)}</span>
              {sub && <span className="pal-sub">{sub}</span>}
            </span>
          </>
        ),
      };
    };
    const nameNodeOf = (h) => h.nameMatch && h.nameMatch.positions
      ? search.vmFuzzyFrag(h.base, h.nameMatch.positions)
      : search.highlightSubstring(h.base, nameQ);
    const contentItem = (r) => {
      const f = filesById.get(r.fileId);
      if (r.snippet && !r.snippet.truncatedLeft && !r.snippet._clean) {
        r.snippet = { ...r.snippet, _clean: true, before: r.snippet.before.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s?)/, '') };
      }
      return {
        kind: 'content', id: 'c:' + r.fileId, fileId: r.fileId, snippet: r.snippet,
        run: () => onJump(r.fileId, r.snippet ? r.snippet.pos : 0),
        render: () => (
          <>
            <span className="pal-title pal-title-sm">{baseName(r.fileName)}{r.contentMatches > 1 && <span className="pal-count">{r.contentMatches}</span>}</span>
            {r.snippet && (
              <span className="pal-snippet">
                {r.snippet.truncatedLeft && '…'}{r.snippet.before}<mark>{r.snippet.match}</mark>{r.snippet.after}{r.snippet.truncatedRight && '…'}
              </span>
            )}
            {!r.snippet && r.attachmentHit && (
              <span className="pal-snippet">📎 {r.attachmentHit.before}<mark>{r.attachmentHit.match}</mark>{r.attachmentHit.after}</span>
            )}
            {!r.snippet && !r.attachmentHit && f && <span className="pal-snippet">{crumbOf(f)}</span>}
          </>
        ),
      };
    };
    const cmdItem = (c) => ({
      kind: 'command', id: 'k:' + c.id, command: c,
      run: () => c.run(),
      render: () => (
        <>
          <span className="pal-ic"><Icon name={c.icon || 'bolt'} size={16} /></span>
          <span className="pal-text"><span className="pal-title pal-title-cmd">{c.label}</span></span>
          {c.kbd && <kbd className="pal-kbd">{c.kbd}</kbd>}
        </>
      ),
    });
    const createItem = () => ({
      kind: 'create', id: 'create',
      run: () => onCreateNote(nameQ),
      render: () => (
        <>
          <span className="pal-ic"><Icon name="plus" size={16} stroke={1.8} /></span>
          <span className="pal-text"><span className="pal-title pal-title-cmd">{t('pal.create', { q: nameQ })}</span></span>
          <kbd className="pal-kbd">Ctrl ↵</kbd>
        </>
      ),
    });

    // Bases de datos: cada tabla de cada nota (ui/shared/workspaceIndex.js).
    const dbItem = (d) => ({
      kind: 'db', id: 'd:' + d.key, fileId: d.noteId,
      run: () => onOpenTable && onOpenTable(d),
      render: () => (
        <>
          <span className="pal-ic">{d.dbNote && d.icon ? <span className="pal-emoji">{d.icon}</span> : <Icon name="database" size={16} />}</span>
          <span className="pal-text">
            <span className="pal-title">{nameQ && filter !== 'db' ? search.highlightSubstring(d.title, nameQ) : d.title}</span>
            <span className="pal-sub">{[d.sub, t('pal.db.rows', { n: d.rows })].filter(Boolean).join(' · ')}</span>
          </span>
        </>
      ),
    });
    const dbMatches = (qq) => {
      const f = search.gsFold(String(qq).toLowerCase());
      return tables.filter(d => search.gsFold((d.title + ' ' + d.note).toLowerCase()).includes(f));
    };
    if (filter === 'db') {
      const st = fileStats || {};
      const list = nameQ ? dbMatches(nameQ)
        : tables.slice().sort((a, b) => ((st[b.noteId] || {}).t || 0) - ((st[a.noteId] || {}).t || 0));
      out.push({ id: 'db', label: t('pal.f.db'), items: list.slice(0, 80).map(dbItem) });
      return out.filter(g => g.items.length);
    }
    // «#etiqueta»: notas con esa etiqueta (o las que empiezan así).
    if (filter === 'all' && tagIndex && /^#[^\s#]+$/.test(nameQ)) {
      const tq = search.gsFold(nameQ.slice(1).toLowerCase());
      const exact = tagIndex.get(nameQ.slice(1).toLowerCase());
      const tags = exact ? [exact] : [...tagIndex.entries()].filter(([k]) => search.gsFold(k).startsWith(tq)).map(([, e]) => e);
      const ids = new Set();
      for (const e of tags) for (const id of e.ids) ids.add(id);
      const items = [...ids].map(id => filesById.get(id)).filter(Boolean).slice(0, 50).map(f => noteItem(f));
      if (items.length) out.push({ id: 'tag', label: exact ? '#' + exact.tag : t('pal.g.tags'), items });
    }

    if (filter === 'commands') {
      out.push({ id: 'cmd', label: t('pal.g.commands'), items: filterCommands(commands, nameQ, search.gsFold).map(cmdItem) });
      return out;
    }
    if (!nameQ) {
      const rec = (filter === 'canvas' ? (() => {
        const all = files.filter(f => search.vmIsCanvasNote(f));
        const st = fileStats || {};
        return all.sort((a, b) => ((st[b.id] || {}).t || 0) - ((st[a.id] || {}).t || 0)).slice(0, 40);
      })() : recents.slice(0, filter === 'all' ? 7 : 40));
      if (filter !== 'content') out.push({ id: 'rec', label: filter === 'canvas' ? t('pal.f.canvas') : t('tree.recents'), items: rec.map(f => noteItem(f)) });
      if (filter === 'all') out.push({ id: 'cmd', label: t('pal.g.commands'), items: commands.filter(c => c.suggested).slice(0, 6).map(cmdItem) });
      return out;
    }
    const nameIds = new Set();
    if (filter === 'all' || filter === 'notes' || filter === 'canvas') {
      let hits = nameHits;
      if (filter === 'canvas') hits = hits.filter(h => search.vmIsCanvasNote(h.file));
      const cap = filter === 'all' ? 6 : 50;
      const items = hits.slice(0, cap).map(h => { nameIds.add(h.file.id); return noteItem(h.file, { nameNode: nameNodeOf(h) }); });
      out.push({ id: 'names', label: filter === 'canvas' ? t('pal.f.canvas') : t('pal.g.notes'), items });
    }
    if (filter === 'all') out.push({ id: 'dbs', label: t('pal.f.db'), items: dbMatches(nameQ).slice(0, 4).map(dbItem) });
    if (filter === 'all' || filter === 'content') {
      const hits = contentHits.filter(r => (r.snippet || r.attachmentHit) && !(filter === 'all' && nameIds.has(r.fileId)));
      out.push({ id: 'content', label: t('pal.g.content'), items: hits.slice(0, filter === 'all' ? 5 : 60).map(contentItem) });
    }
    if (filter === 'all' || filter === 'notes') {
      const cmds = filter === 'all' ? filterCommands(commands, nameQ, search.gsFold).slice(0, 4).map(cmdItem) : [];
      const extra = [];
      if (canCreate && !exactExists) extra.push(createItem());
      // Si un comando coincide va primero (Enter lo ejecuta); si no, «Crear nota».
      out.push({ id: 'cmd', label: t('pal.g.commands'), items: [...cmds, ...extra] });
    }
    return out.filter(g => g.items.length);
  }, [open, filter, nameQ, nameHits, contentHits, commands, recents, files, folders, vaults, fileStats, showVault, filesById, exactExists, canCreate, onOpenNote, onJump, onCreateNote, search, tables, tagIndex, onOpenTable]);

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const safeIdx = flat.length ? Math.max(0, Math.min(focusIdx, flat.length - 1)) : -1;
  const focused = safeIdx >= 0 ? flat[safeIdx] : null;

  useEffect(() => { setFocusIdx(0); }, [filter, nameQ]);
  useEffect(() => {
    if (!listRef.current || safeIdx < 0) return;
    const el = listRef.current.querySelector(`[data-idx="${safeIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [safeIdx]);

  if (!open) return null;

  const activate = (idx) => {
    const it = flat[idx];
    if (!it) return;
    onClose();
    setTimeout(() => it.run(), 0);
  };
  const cycleFilter = (dir) => {
    const i = PALETTE_FILTERS.indexOf(filter);
    setFilter(PALETTE_FILTERS[(i + dir + PALETTE_FILTERS.length) % PALETTE_FILTERS.length]);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab') { e.preventDefault(); cycleFilter(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) setFocusIdx((safeIdx + 1) % flat.length); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) setFocusIdx((safeIdx - 1 + flat.length) % flat.length); return; }
    if (e.key === 'PageDown') { e.preventDefault(); if (flat.length) setFocusIdx(Math.min(flat.length - 1, safeIdx + 8)); return; }
    if (e.key === 'PageUp') { e.preventDefault(); if (flat.length) setFocusIdx(Math.max(0, safeIdx - 8)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && canCreate && nameQ) { onClose(); setTimeout(() => onCreateNote(nameQ), 0); return; }
      activate(safeIdx);
    }
  };

  // ── Vista previa ──────────────────────────────────────────────────────
  const previewFile = focused && focused.fileId ? filesById.get(focused.fileId) : null;
  const pv = previewFile ? previewOf(previewFile) : null;
  const hl = (s) => (nameQ ? search.highlightSubstring(s, nameQ) : s);
  let groupStart = 0;

  return (
    <div className="pal-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pal" role="dialog" aria-modal="true" aria-label={t('pal.label')} onKeyDown={onKeyDown}>
        <div className="pal-input-row">
          <Icon name="search" size={18} stroke={1.8} className="pal-search-ic" />
          <label className="sr-only" htmlFor="pal-input">{t('pal.label')}</label>
          <input id="pal-input" ref={inputRef} className="pal-input" type="text" autoComplete="off" spellCheck={false} autoFocus
            role="combobox" aria-expanded="true" aria-controls="pal-list"
            aria-activedescendant={safeIdx >= 0 ? 'pal-opt-' + safeIdx : undefined}
            placeholder={t('pal.placeholder')}
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <kbd className="pal-kbd">Esc</kbd>
        </div>
        <div role="tablist" aria-label={t('pal.filters')} className="pal-filters">
          {PALETTE_FILTERS.map(f => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} tabIndex={-1}
              className={`pal-chip${filter === f ? ' on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setFilter(f); inputRef.current && inputRef.current.focus(); }}>
              {t(FILTER_LABEL[f])}
            </button>
          ))}
        </div>
        <div className="pal-main">
          <div className="pal-list" role="listbox" id="pal-list" aria-label={t('pal.results')} ref={listRef}>
            {flat.length === 0 && (
              <div className="pal-empty">{nameQ ? t('search.noHits', { q: nameQ }) : (filter === 'content' ? t('search.empty') : t('pal.empty'))}</div>
            )}
            {groups.map(g => {
              const startAt = groupStart;
              groupStart += g.items.length;
              return (
                <div key={g.id} role="group" aria-label={g.label}>
                  <div className="pal-group">{g.label}</div>
                  {g.items.map((it, k) => (
                    <Row key={it.id} item={it} idx={startAt + k} focused={startAt + k === safeIdx}
                      onHover={setFocusIdx} onPick={activate} />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="pal-preview" aria-live="polite">
            {pv ? (
              <>
                <div className="pal-pv-label">{t('pal.preview')}</div>
                <h2 className="pal-pv-title">{hl(baseName(previewFile.name))}</h2>
                <div className="pal-pv-chips">
                  {search.vmIsCanvasNote(previewFile) && <span className="pal-pchip accent">{t('view.badge.canvas')}</span>}
                  {pv.tags.map(tg => <span key={tg} className="pal-pchip">#{tg}</span>)}
                  {(() => { const c = search.vmBreadcrumb(previewFile, folders, vaults, vaults.length > 1); return c ? <span className="pal-pchip">{c}</span> : null; })()}
                </div>
                {focused && focused.snippet && (
                  <p className="pal-pv-p">{focused.snippet.truncatedLeft && '…'}{focused.snippet.before}<mark>{focused.snippet.match}</mark>{focused.snippet.after}{focused.snippet.truncatedRight && '…'}</p>
                )}
                {focused && focused.semSnippet && <p className="pal-pv-p">{focused.semSnippet}</p>}
                {pv.paras.map((p, i) => <p key={i} className={`pal-pv-p${i > 0 || (focused && (focused.snippet || focused.semSnippet)) ? ' muted' : ''}`}>{hl(p)}</p>)}
                {!pv.paras.length && <p className="pal-pv-p muted">{t('pal.previewEmpty')}</p>}
              </>
            ) : focused && focused.command ? (
              <>
                <div className="pal-pv-label">{t('pal.g.commands')}</div>
                <div className="pal-pv-cmd"><Icon name={focused.command.icon || 'bolt'} size={22} /></div>
                <h2 className="pal-pv-title pal-pv-title-sm">{focused.command.label}</h2>
                {focused.command.hint && <p className="pal-pv-p muted">{focused.command.hint}</p>}
                {focused.command.kbd && <p className="pal-pv-p"><kbd className="pal-kbd">{focused.command.kbd}</kbd></p>}
              </>
            ) : (
              <div className="pal-pv-empty">{t('pal.previewHint')}</div>
            )}
          </div>
        </div>
        <div className="pal-foot">
          <span><kbd className="pal-kbd">↑↓</kbd>{t('pal.k.nav')}</span>
          <span><kbd className="pal-kbd">↵</kbd>{t('pal.k.open')}</span>
          {canCreate && <span><kbd className="pal-kbd">Ctrl ↵</kbd>{t('pal.k.create')}</span>}
          <span><kbd className="pal-kbd">Tab</kbd>{t('pal.k.filter')}</span>
          <span className="pal-foot-right">{allVaults ? t('view.allSearch') : t('view.currentVault')}</span>
        </div>
      </div>
    </div>
  );
}
