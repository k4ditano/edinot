// Fichas del canvas y sus piezas (adjuntos, modal de nota, consultas, grupos, selector de notas, vista previa).

import { shapeD, shapeTextBox } from './shapes.js';
import { labelTextStyle } from '../../shared/text-style.js';
import { parseRich } from '../../shared/rich-text.js';

// Texto con estilos mezclados (**negrita**, *cursiva*, __subrayado__, ~~tachado~~, `código`, {#color|texto}, {+tamaño|texto}).
function RichText({ text }) {
  return parseRich(text).map((line, i) => (
    <span key={i} style={{ display: 'block' }}>
      {line.length ? line.map((r, k) => (
        <span key={k} style={{
          ...(r.b ? { fontWeight: 700 } : null), ...(r.i ? { fontStyle: 'italic' } : null),
          ...((r.u || r.s) ? { textDecoration: [r.u && 'underline', r.s && 'line-through'].filter(Boolean).join(' ') } : null),
          ...(r.color ? { color: r.color } : null), ...(r.size ? { fontSize: r.size } : null),
          ...(r.code ? { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '0.9em', background: 'rgba(127,127,127,.15)', padding: '0 .25em', borderRadius: 4 } : null),
        }}>{r.t}</span>
      )) : '\u00a0'}
    </span>
  ));
}
import { useI18n, t, getLang } from '../../i18n.js';
import { useRef, useState, useMemo, useEffect, useLayoutEffect, useDeferredValue, useCallback, memo } from 'react';
import { mountDbBlock, sweepDbBlocks } from '../db/mount.jsx';
import { yMeta, getVaultEvents, isPendingReminder, ydoc, getCanvasUndoManager, getNoteDoc } from '../../store.js';
import { readNoteComments, putComment, patchComments } from '../../shared/comments-model.js';
import { buildCanvasTemplate, canvasTemplateInfo } from '../../shared/canvas-templates.js';
import { CanvasDock, CanvasActions, CanvasZoom, CvIcon } from '../../ui/canvas/CanvasChrome.jsx';
import { CanvasMinimap } from '../../ui/canvas/CanvasMinimap.jsx';
import { buildGrid } from './spatial.js';
import { drawLod, LOD_ZOOM, LOD_MIN_VISIBLE } from './lod.js';
import { sketchShapePaths, sketchPathD, sketchSvg } from './sketch.js';
import { layoutEdge, pathToD, flatten, pointAt, closestT, headGeom, trimPath, endAngles, anchorPoint, nearestSide, sideToward, edgeKeyOf, EDGE_ROUTES } from './edges.js';
import { canvasEdgeId } from '../../shared/canvas-model.js';
import { createCanvasPresence } from './presence.js';
import { nodeZ, annoZ, stepZ } from './zorder.js';
import { treeIndex, descendantsOf, hiddenByCollapse, markedRoot, layoutMindmap, addChild, reparent } from './mindmap.js';
import {
  AnchorCommentPopover,
  DB_OPS,
  VIcon,
  applyTemplate,
  attachmentKind,
  createMdRenderer,
  escapeHtml,
  extractWikilinks,
  firstCanvasBlock,
  gsFold,
  gsFoldedSearchable,
  gsNameFolded,
  humanFileSize,
  normalizeNoteName,
  parseSourceTables,
  resolveDateShortcuts,
  searchableContent,
  stripViewDirectives,
  useCommentsVersion,
  youtubeId,
} from '../../editor.jsx';
import { vimeoId, isDirectVideoUrl, titleFromUrlShort, CANVAS_DEFAULT_NODE_W, CANVAS_DEFAULT_NODE_H, CANVAS_GROUP_DEFAULT_W, CANVAS_GROUP_DEFAULT_H, useStableFn, canvasNodeRect, grpRemapper, canvasPerf, CANVAS_CULL_MIN, CANVAS_EDGE_CULL_MIN, edgeTouches, CANVAS_MM_DIMS, canvasNodeId, canvasGroupId } from './common.jsx';
import { buildNoteIndex, resolveCanvasNote, autoLayoutCanvas, layoutCanvasTree, canvasPreviewText, stickyFontSize } from './layout.jsx';
import { CANVAS_DRAW_TOOLS, CANVAS_SHAPE_TOOLS, CANVAS_CLOSED_SHAPE_SET, canvasFillFromHex, canvasDashArray, CANVAS_PEN_COLORS, CANVAS_STICKY_COLORS, CANVAS_STICKY_SIZE, CANVAS_GRID, cpMid, smoothStrokeD, packStrokePts, strokeD, ptsBbox, strokeOutlineD, arrowHeadPath, canvasAnnoId, snapVal } from './strokes.jsx';

export function CanvasAttachmentPreview({ node, syncConfig }) {
  useI18n();
  const name = node.name || node.filename || node.alt || 'Adjunto';
  const kindRaw = attachmentKind(name);
  const kind = typeof kindRaw === 'string' ? kindRaw : kindRaw.kind;
  const src = node.url || (node.sha ? `edinot://blob/${node.sha}` : '');
  const auth = syncConfig && syncConfig.httpUrl && syncConfig.token
    ? { httpUrl: syncConfig.httpUrl, token: syncConfig.token }
    : null;
  const runBlobAction = (action) => {
    if (node.sha && window.electronAPI) {
      const handler = action === 'open' ? window.electronAPI.openBlobWith : window.electronAPI.saveBlobToFile;
      if (handler) {
        handler(node.sha, name, auth).then((res) => {
          if (res && !res.canceled && !res.ok && res.error) {
            window.alert((action === 'open' ? 'No se pudo abrir: ' : 'No se pudo guardar: ') + res.error);
          }
        }).catch((err) => window.alert(String(err.message || err)));
      }
      return;
    }
    if (action === 'open' && src && /^https?:\/\//i.test(src)) window.open(src, '_blank', 'noopener,noreferrer');
  };
  const label = kind === 'pdf' ? t('attach.kind.pdf')
              : kind === 'video' ? t('attach.kind.video')
              : kind === 'audio' ? t('attach.kind.audio')
              : kind === 'docx' ? t('attach.kind.docx')
              : kind === 'xlsx' ? t('attach.kind.xlsx')
              : kind === 'code' ? t('attach.kind.code')
              : t('attach.kind.file');
  const icon = kind === 'pdf' ? 'PDF'
             : kind === 'video' ? 'VID'
             : kind === 'audio' ? 'AUD'
             : kind === 'docx' ? 'DOC'
             : kind === 'xlsx' ? 'XLS'
             : kind === 'code' ? '{}'
             : 'FILE';
  return (
    <div className="canvas-attach-preview" onMouseDown={(e) => e.stopPropagation()}>
      {kind === 'image' && src && <img className="canvas-attach-media" src={src} alt={name} draggable={false} />}
      {kind === 'video' && src && <video className="canvas-attach-media" controls preload="metadata" src={src} />}
      {kind === 'audio' && src && <audio className="canvas-attach-media" controls preload="metadata" src={src} />}
      {!['image','video','audio'].includes(kind) && (
        <div className="canvas-attach-file">
          <span className="canvas-attach-icon">{icon}</span>
          <span className="canvas-attach-meta">
            <span className="canvas-attach-name" title={name}>{name}</span>
            <span className="canvas-attach-hint">{label}{node.size ? ` · ${humanFileSize(node.size)}` : ''}</span>
          </span>
        </div>
      )}
      <div className="canvas-attach-actions">
        {(node.sha || /^https?:\/\//i.test(src || '')) && <button type="button" onClick={() => runBlobAction('open')}>Abrir</button>}
        {node.sha && <button type="button" onClick={() => runBlobAction('download')}>Guardar</button>}
      </div>
    </div>
  );
}

export function hydrateRenderedAttachments(root, syncConfig) {
  if (!root) return;
  const auth = syncConfig && syncConfig.httpUrl && syncConfig.token
    ? { httpUrl: syncConfig.httpUrl, token: syncConfig.token }
    : null;
  const actionsRow = () =>
    `<span class="md-attach-actions">`
    + `<button type="button" class="md-attach-act" data-attach-action="open" title="${escapeHtml(t('attach.open.tip'))}">${escapeHtml(t('attach.open'))}</button>`
    + `<button type="button" class="md-attach-act" data-attach-action="download" title="${escapeHtml(t('attach.download.tip'))}">${escapeHtml(t('attach.download'))}</button>`
    + `</span>`;
  root.querySelectorAll('.md-attach-office[data-attach-sha]').forEach((nodeEl) => {
    const sha = nodeEl.getAttribute('data-attach-sha');
    const kind = nodeEl.getAttribute('data-attach-kind');
    const name = nodeEl.getAttribute('data-attach-name') || '';
    if (!sha || !window.electronAPI || !window.electronAPI.convertOfficeBlob) return;
    window.electronAPI.convertOfficeBlob(sha, kind, auth).then((res) => {
      if (!nodeEl.isConnected) return;
      nodeEl.classList.remove('md-attach-loading');
      if (res && res.ok) {
        nodeEl.innerHTML = `<span class="md-attach-office-title">📄 ${escapeHtml(name)}${actionsRow()}</span><span class="md-attach-office-body">${res.html}</span>`;
      } else {
        nodeEl.innerHTML = `<span class="md-attach-office-title">${escapeHtml(t('attach.office.fail', { name }))}${actionsRow()}</span><span class="md-attach-office-body md-attach-err">${escapeHtml((res && res.error) || t('attach.error.unknown'))}</span>`;
      }
    }).catch((err) => {
      if (!nodeEl.isConnected) return;
      nodeEl.innerHTML = `<span class="md-attach-office-title">⚠ ${escapeHtml(name)}${actionsRow()}</span><span class="md-attach-office-body md-attach-err">${escapeHtml(err.message || String(err))}</span>`;
    });
  });
  root.querySelectorAll('.md-attach-code[data-attach-sha]').forEach((nodeEl) => {
    const sha = nodeEl.getAttribute('data-attach-sha');
    const name = nodeEl.getAttribute('data-attach-name') || '';
    const lang = nodeEl.getAttribute('data-attach-lang') || '';
    if (!sha) return;
    fetch(`edinot://blob/${sha}`).then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))).then((text) => {
      if (!nodeEl.isConnected) return;
      nodeEl.classList.remove('md-attach-loading');
      const escaped = escapeHtml(text);
      nodeEl.innerHTML = `<span class="md-attach-office-title">📝 ${escapeHtml(name)}${lang ? ` <span class="md-attach-lang">${escapeHtml(lang)}</span>` : ''}${actionsRow()}</span>`
        + `<pre class="md-attach-code-body"><code>${escaped}</code></pre>`;
    }).catch((err) => {
      if (!nodeEl.isConnected) return;
      nodeEl.innerHTML = `<span class="md-attach-office-title">⚠ ${escapeHtml(name)}${actionsRow()}</span><span class="md-attach-office-body md-attach-err">${escapeHtml(err.message || String(err))}</span>`;
    });
  });
}

export function CanvasNoteModal({ note, notes, syncConfig, onClose, onGo, onUpdateNoteContent, askPrompt, askConfirm }) {
  useI18n();
  const bodyRef = useRef(null);
  const [source, setSource] = useState('');
  const renderer = useMemo(() => createMdRenderer({
    resolveWikilink: (name) => {
      const norm = normalizeNoteName(name);
      const match = (notes || []).find(f => normalizeNoteName(f.name || '') === norm);
      return match ? match.id : null;
    },
  }), [notes]);
  const html = useMemo(
    () => note ? renderer.render(resolveDateShortcuts(stripViewDirectives(source || ''))) : '',
    [renderer, note && note.id, source]
  );
  const tablesParsed = useMemo(() => parseSourceTables(note ? source || '' : ''), [note && note.id, source]);

  useEffect(() => {
    setSource(note ? note.content || '' : '');
  }, [note && note.id, note && note.content]);

  useEffect(() => {
    if (!note) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [note, onClose]);

  // Bases de datos (editor/db) también en la nota abierta desde un canvas.
  const dbCacheRef = useRef(null);
  if (!dbCacheRef.current) dbCacheRef.current = new Map();
  const sourceRef = useRef('');
  sourceRef.current = source;
  const noteRef = useRef(note);
  noteRef.current = note;
  const dbCtxRef = useRef(null);
  dbCtxRef.current = {
    getSource: () => sourceRef.current || '',
    mutateSource: (fn) => {
      const n = noteRef.current;
      if (!n || !onUpdateNoteContent) return;
      const cur = sourceRef.current || '';
      const next = typeof fn === 'function' ? fn(cur) : fn;
      if (typeof next !== 'string' || next === cur) return;
      sourceRef.current = next;
      setSource(next);
      onUpdateNoteContent(n.id, next);
    },
    readOnly: !onUpdateNoteContent,
    askPrompt, askConfirm,
    navigateTo: (id) => onGo && onGo(id),
    openWikilink: (name) => {
      const norm = normalizeNoteName(name || '');
      const m = (notes || []).find(f => normalizeNoteName(f.name || '') === norm);
      if (m && onGo) onGo(m.id);
    },
    noteNames: (notes || []).map(f => (f.name || '').replace(/\.(md|markdown|txt)$/i, '')).filter(Boolean),
    renderInline: (x) => renderer.renderInline(resolveDateShortcuts(x)),
    renderMarkdown: (x) => renderer.render(resolveDateShortcuts(stripViewDirectives(x || ''))),
    getNote: (name) => {
      const norm = normalizeNoteName(name || '');
      const m = (notes || []).find(f => normalizeNoteName(f.name || '') === norm);
      return m ? { id: m.id, name: m.name, content: m.content || '' } : null;
    },
  };
  useEffect(() => () => {
    for (const e of dbCacheRef.current.values()) setTimeout(() => { try { e.root.unmount(); } catch {} }, 0);
    dbCacheRef.current.clear();
  }, []);

  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!note || !root) return;
    root.innerHTML = html;
    const alive = new Set();
    root.querySelectorAll('table.md-table').forEach((tbl, idx) => {
      const meta = tablesParsed[idx];
      if (!meta) return;
      const key = `${note.id}:${idx}`;
      alive.add(key);
      const host = document.createElement('div');
      host.className = 'db-mount';
      host.dataset.dbIdx = String(idx);
      tbl.parentNode.replaceChild(host, tbl);
      mountDbBlock(dbCacheRef.current, key, host, { meta, idx, ctxRef: dbCtxRef, ops: DB_OPS, surface: 'modal' });
    });
    sweepDbBlocks(dbCacheRef.current, alive);
    hydrateRenderedAttachments(root, syncConfig);
  }, [note, html, source, syncConfig]);

  if (!note) return null;
  const title = (note.name || 'Nota').replace(/\.(md|markdown|txt)$/i, '');
  const handleClick = (e) => {
    const tgt = e.target;
    if (!tgt) return;
    const copyBtn = tgt.closest && tgt.closest('[data-code-copy]');
    if (copyBtn) {
      e.preventDefault();
      const wrap = copyBtn.closest('.md-codewrap');
      const code = wrap && wrap.querySelector('pre > code');
      if (!code) return;
      navigator.clipboard && navigator.clipboard.writeText(code.textContent || '');
      return;
    }
    const wiki = tgt.closest && tgt.closest('[data-wikilink]');
    if (wiki) {
      e.preventDefault();
      const id = wiki.getAttribute('data-wikilink');
      if (id) onGo(id);
      return;
    }
    const actionBtn = tgt.closest && tgt.closest('[data-attach-action]');
    if (actionBtn) {
      const carrier = actionBtn.closest('[data-attach-sha]');
      const sha = carrier && carrier.getAttribute('data-attach-sha');
      const name = carrier && (carrier.getAttribute('data-attach-name') || '');
      if (sha && window.electronAPI) {
        e.preventDefault();
        const auth = syncConfig && syncConfig.httpUrl && syncConfig.token
          ? { httpUrl: syncConfig.httpUrl, token: syncConfig.token }
          : null;
        const action = actionBtn.getAttribute('data-attach-action');
        const handler = action === 'open' ? window.electronAPI.openBlobWith : window.electronAPI.saveBlobToFile;
        if (handler) {
          handler(sha, name, auth).then((res) => {
            if (res && !res.canceled && !res.ok && res.error) {
              window.alert((action === 'open' ? 'No se pudo abrir: ' : 'No se pudo guardar: ') + res.error);
            }
          }).catch((err) => window.alert(String(err.message || err)));
        }
      }
      return;
    }
  };
  return (
    <>
      <div className="view-spotlight-backdrop" style={{ zIndex: 230 }} onClick={onClose} />
      <div className="canvas-note-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="canvas-note-modal-head">
          <div className="canvas-note-modal-title" title={title}>{title}</div>
          <div className="canvas-note-modal-actions">
            <button type="button" className="primary" onClick={() => onGo(note.id)}>{t('canvas.goToNote')}</button>
            <button type="button" onClick={onClose}>{t('btn.close')}</button>
          </div>
        </div>
        <div ref={bodyRef} className="md-render canvas-note-modal-body"
          onClick={handleClick} />
      </div>
    </>
  );
}

// Live search results displayed inside a `query` canvas tile. Matches
// note names + content (case-insensitive substring); click a hit → opens
// the note. Caps at 8 results to keep the tile readable.
export function CanvasQueryResults({ node, notes, onOpen, onPatchNode }) {
  useI18n();
  const q = String(node.query || '').trim().toLowerCase();
  const LIMIT = Math.max(1, Math.min(100, node.limit || 20));
  const view = node.view === 'cards' || node.view === 'table' ? node.view : 'list';
  const { hits, total } = useMemo(() => {
    if (!q) return { hits: [], total: 0 };
    // `#tag` matches a whole hashtag token in the body; otherwise substring
    // over name + content. A dashboard-y count + scrollable list, not just 8.
    const tag = q.startsWith('#') ? q.slice(1) : null;
    const tagRe = tag ? new RegExp('#' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b') : null;
    const out = [];
    let count = 0;
    for (const f of notes) {
      const name = (f.name || '').toLowerCase();
      const body = searchableContent(f.content || '').toLowerCase();
      const match = tagRe ? tagRe.test(body) : (name.includes(q) || body.includes(q));
      if (match) { count++; if (out.length < LIMIT) out.push(f); }
    }
    out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return { hits: out, total: count };
  }, [q, notes, LIMIT]);
  if (!q) {
    return <div className="canvas-node-text" style={{ opacity: 0.65 }}><em>{t('canvas.queryEmpty')}</em></div>;
  }
  if (!total) {
    return <div className="canvas-node-text" style={{ opacity: 0.65 }}><em>{t('canvas.noMatch', { q: node.query })}</em></div>;
  }
  const baseName = (f) => f.name.replace(/\.(md|markdown|txt)$/i, '');
  const viewBtn = (key, glyph, tip) => (
    <button key={key} className={`canvas-query-viewbtn${view === key ? ' on' : ''}`} title={tip}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => onPatchNode && onPatchNode(node.id, { view: key === 'list' ? null : key })}>{glyph}</button>
  );
  return (
    <div className="canvas-query-list" style={{ maxHeight: '100%', overflowY: 'auto' }} onMouseDown={(e) => e.stopPropagation()}>
      <div style={{ fontSize: 11, opacity: 0.75, padding: '1px 4px 3px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, opacity: 0.8 }}>{t('canvas.queryCount', { n: total })}{total > hits.length ? ` · ${t('canvas.queryShowing', { n: hits.length })}` : ''}</span>
        {onPatchNode && viewBtn('list', '≣', t('canvas.queryViewList'))}
        {onPatchNode && viewBtn('cards', '▦', t('canvas.queryViewCards'))}
        {onPatchNode && viewBtn('table', '𝄜', t('canvas.queryViewTable'))}
      </div>
      {view === 'list' && hits.map(f => (
        <button key={f.id} className="canvas-query-hit" title={f.name}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onOpen(f)}>
          <span className="canvas-query-hit-icon">{f.icon || '📄'}</span>
          <span className="canvas-query-hit-name">{baseName(f)}</span>
        </button>
      ))}
      {view === 'cards' && (
        <div className="canvas-query-cards">
          {hits.map(f => (
            <button key={f.id} className="canvas-query-card" title={f.name}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onOpen(f)}>
              <span className="canvas-query-card-name">{f.icon || '📄'} {baseName(f)}</span>
              <span className="canvas-query-card-preview">{canvasPreviewText(f.content || '').slice(0, 110)}</span>
            </button>
          ))}
        </div>
      )}
      {view === 'table' && (
        <table className="canvas-query-table">
          <thead>
            <tr><th>{t('canvas.queryColNote')}</th><th>{t('canvas.queryColUpdated')}</th></tr>
          </thead>
          <tbody>
            {hits.map(f => (
              <tr key={f.id} onMouseDown={(e) => e.stopPropagation()} onClick={() => onOpen(f)}>
                <td>{f.icon || '📄'} {baseName(f)}</td>
                <td>{f.updatedAt ? new Date(f.updatedAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function CanvasTileImpl({ node, note, syncConfig, onMouseDown, onOpen, onSelect, onDelete, onEditText, onCreateReminder, onEdgeStart, onEdgeFinish, onStickySibling, onPatchNode, onToggleReaction, commentCount, onOpenComments, isSelected, openTasks, reminder, notes, transientStyle, autoEdit }) {
  useI18n();
  canvasPerf.tile++;
  const [editingText, setEditingText] = useState(null);   // string while inline-editing a text/label node
  // Free-text tool: a freshly placed label opens straight into edit mode so the
  // user can type immediately (no dialog, no box).
  useEffect(() => { if (autoEdit) setEditingText(node.text || ''); }, []);
  // Compute apparent badge for note tiles: open task count from kanban-style
  // `Estado` columns (Pendiente / En revisión) so the user sees "3 open" at a
  // glance without opening the note.
  const isNote = node.kind === 'note';
  const isText = node.kind === 'text' || !node.kind;
  const isSticky = isText && !!node.sticky;
  const isUrl = node.kind === 'url';
  const isImage = node.kind === 'image';
  const isVideo = node.kind === 'video';
  const isQuery = node.kind === 'query';
  const isAttachment = node.kind === 'attachment';
  const isLabel = node.kind === 'label';
  const isDraw = node.kind === 'draw';
  const isShape = node.kind === 'shape';
  const title = isNote
    ? (note ? note.name.replace(/\.(md|markdown|txt)$/i, '') : `(falta: ${node.noteId || node.noteName || '?'})`)
    : isUrl ? (node.title || node.url || 'URL')
    : isImage ? (node.title || node.alt || 'Imagen')
    : isVideo ? (node.title || (node.provider === 'youtube' ? 'YouTube' : 'Video'))
    : isQuery ? (`🔎 ${node.query || ''}`)
    : isAttachment ? (node.name || node.filename || 'Adjunto')
    : (node.text || '').split('\n')[0].slice(0, 40) || 'Texto';
  const w = node.w || CANVAS_DEFAULT_NODE_W;
  const h = node.h || CANVAS_DEFAULT_NODE_H;
  const preview = isNote && note ? canvasPreviewText(note.content || '').slice(0, 240) : '';
  const animStyle = transientStyle ? {
    transform: `translate(${transientStyle.dx || 0}px, ${transientStyle.dy || 0}px) scale(${transientStyle.scale != null ? transientStyle.scale : 1})`,
    transformOrigin: 'center center',
    transition: 'transform 80ms linear, background-color 200ms ease',
    ...(transientStyle.color ? { '--node-color': transientStyle.color } : {}),
    willChange: 'transform',
  } : null;
  const commitEdit = () => { if (editingText !== null) { onEditText && onEditText(node.id, editingText); setEditingText(null); } };
  const textEditor = (
    <textarea className="canvas-node-textedit" autoFocus value={editingText || ''}
      onChange={(e) => setEditingText(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); setEditingText(null); }
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
      }}
      style={{ width: '100%', height: '100%', boxSizing: 'border-box', resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'inherit', font: 'inherit', padding: 0 }} />
  );
  return (
    <div className={`canvas-node canvas-node-${node.kind || 'text'}${isSticky ? ' canvas-node-sticky' : ''}${isSelected ? ' selected' : ''}${animStyle ? ' canvas-node-animating' : ''}`}
      style={{ left: node.x, top: node.y, width: w, ...(isLabel ? { minHeight: h } : { height: h }), '--node-color': node.color || '', ...(animStyle || {}) }}
      data-node-id={node.id}
      data-hover={(node.anim && node.anim.hover) || undefined} data-loop={(node.anim && node.anim.loop) || undefined}
      onDoubleClick={(e) => {
        if (e.target.closest && e.target.closest('.canvas-node-del, .canvas-node-edge-anchor, .canvas-node-resize, a, button')) return;
        if ((isText || isLabel || isShape) && onEditText) { e.stopPropagation(); setEditingText(node.text || ''); return; }
        if (isNote && note) {
          onOpen(note, node);
        }
      }}
      onMouseDown={(e) => {
        if (e.target.closest && e.target.closest('.canvas-node-del, .canvas-node-edge-anchor, .canvas-node-resize, a, button, textarea')) return;
        // The whole tile is the drag handle. startNodeDrag is modifier-aware
        // (Shift/Ctrl/Cmd toggles multi-selection) and multi-move-aware
        // (dragging a node that's part of a selection moves the whole group).
        onMouseDown(e, node, 'drag');
      }}>
      {isShape && (
        <>
          {(() => {
            const sh = node.shape || 'rect';
            const col = node.color || 'var(--accent, #2383E2)';
            const fill = node.color ? node.color : 'color-mix(in srgb, var(--accent, #2383E2) 12%, transparent)';
            const body = editingText !== null ? textEditor : <div style={{ whiteSpace: 'pre-wrap', width: '100%', overflowWrap: 'anywhere' }}>{node.rich && node.text ? <RichText text={node.text} /> : (node.text || '')}</div>;
            if (sh === 'rect' || sh === 'ellipse') {
              return (
                <div style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', background: fill, border: '1.5px solid ' + col,
                  borderRadius: sh === 'ellipse' ? '50%' : 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', padding: 10, overflow: 'hidden' }}>{body}</div>
              );
            }
            const tb = shapeTextBox(sh, 0, 0, w, h);
            return (
              <>
                <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }} aria-hidden="true">
                  <path d={shapeD(sh, 1, 1, Math.max(2, w - 2), Math.max(2, h - 2))} fill={fill} stroke={col} strokeWidth="1.5" strokeLinejoin="round" fillRule="evenodd" />
                </svg>
                <div style={{ position: 'absolute', left: tb.x, top: tb.y, width: tb.w, height: tb.h, boxSizing: 'border-box', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 4, overflow: 'hidden' }}>{body}</div>
              </>
            );
          })()}
          <button className="canvas-node-del" title={t('canvas.removeNode')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
            style={{ position: 'absolute', top: 2, right: 2, zIndex: 2 }}>×</button>
        </>
      )}
      {isSticky && (() => {
        const fs = stickyFontSize(editingText !== null ? editingText : node.text, w, h);
        return (
          <>
            <div className="canvas-node-sticky-body" style={{ fontSize: fs }}>
              {editingText !== null ? (
                <textarea className="canvas-node-sticky-textedit" autoFocus value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') { e.preventDefault(); setEditingText(null); }
                    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); onStickySibling && onStickySibling(node, 'down'); }
                    else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); onStickySibling && onStickySibling(node, e.shiftKey ? 'left' : 'right'); }
                  }} />
              ) : (
                <div className="canvas-node-sticky-text">{node.text || ''}</div>
              )}
            </div>
            <button className="canvas-node-del" title={t('canvas.removeNode')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
              style={{ position: 'absolute', top: 2, right: 2, zIndex: 2 }}>×</button>
          </>
        );
      })()}
      {!isShape && !isSticky && (<>
      <div className="canvas-node-head"
        onMouseDown={(e) => onMouseDown(e, node, 'drag')}>
        <span className="canvas-node-title" title={title}>{title}</span>
        {isNote && openTasks > 0 && (
          <span className="canvas-node-badge" title={t('canvas.openTasks', { n: openTasks })}>{openTasks}</span>
        )}
        {isNote && reminder && (
          <span
            title={reminder.overdue
              ? t('canvas.reminderOverdue')
              : (reminder.nextAt ? t('canvas.reminderAt', { when: new Date(reminder.nextAt).toLocaleString() }) : t('canvas.reminder'))}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              marginLeft: 4, padding: '0 5px', height: 16, lineHeight: '16px', borderRadius: 8,
              fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
              background: reminder.overdue ? '#d9534f' : 'rgba(160,122,44,0.2)',
              color: reminder.overdue ? '#fff' : '#a07a2c',
            }}>⏰{reminder.count > 1 ? ` ${reminder.count}` : ''}</span>
        )}
        {isNote && note && onCreateReminder && (
          <button className="canvas-node-del" title={t('canvas.reminderCreate')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onCreateReminder(note); }}
            style={{ fontSize: 11 }}>⏰</button>
        )}
        <button className="canvas-node-del" title={t('canvas.removeNode')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}>×</button>
      </div>
      <div className="canvas-node-body">
        {isText && (editingText !== null ? textEditor : <div className="canvas-node-text">{node.text || ''}</div>)}
        {isNote && note && (
          <div className="canvas-node-preview" title={t('canvas.previewDoubleClick')}>
            {preview || <em>{t('canvas.emptyNote')}</em>}
          </div>
        )}
        {isNote && !note && (
          <div className="canvas-node-missing">{t('canvas.noteMissing')}</div>
        )}
        {isUrl && (node.desc || node.imageUrl || node.favicon ? (
          <a className="canvas-link-card" href={node.url} target="_blank" rel="noopener noreferrer"
            onMouseDown={(e) => e.stopPropagation()} draggable={false}>
            {node.imageUrl && <div className="canvas-link-img" style={{ backgroundImage: `url("${node.imageUrl}")` }} />}
            <div className="canvas-link-meta">
              {node.desc && <div className="canvas-link-desc">{node.desc}</div>}
              <div className="canvas-link-host">
                {node.favicon && <img className="canvas-link-favicon" src={node.favicon} alt="" draggable={false} />}
                <span>{node.siteName || titleFromUrlShort(node.url)}</span>
              </div>
            </div>
          </a>
        ) : (
          <a className="canvas-node-url" href={node.url} target="_blank" rel="noopener noreferrer"
            onMouseDown={(e) => e.stopPropagation()}>{node.url}</a>
        ))}
        {isImage && (node.sha || node.url) && (
          <img className="canvas-node-img" src={node.url || `edinot://blob/${node.sha}`} alt={node.alt || ''} draggable={false} />
        )}
        {isVideo && node.provider === 'youtube' && node.videoId && (
          <iframe className="canvas-node-iframe"
            src={`https://www.youtube-nocookie.com/embed/${node.videoId}?rel=0&playsinline=1`}
            title={node.title || 'YouTube'}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            onMouseDown={(e) => e.stopPropagation()} />
        )}
        {isVideo && node.provider === 'vimeo' && node.videoId && (
          <iframe className="canvas-node-iframe"
            src={`https://player.vimeo.com/video/${node.videoId}`}
            title={node.title || 'Vimeo'}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            onMouseDown={(e) => e.stopPropagation()} />
        )}
        {isVideo && node.provider === 'file' && node.url && (
          <video className="canvas-node-videofile" src={node.url} controls preload="metadata"
            onMouseDown={(e) => e.stopPropagation()} />
        )}
        {isVideo && !node.videoId && node.provider !== 'file' && node.url && (
          <a className="canvas-node-url" href={node.url} target="_blank" rel="noopener noreferrer"
            onMouseDown={(e) => e.stopPropagation()}>{node.url}</a>
        )}
        {isQuery && <CanvasQueryResults node={node} notes={notes} onOpen={(f) => onOpen(f, node)} onPatchNode={onPatchNode} />}
        {isAttachment && <CanvasAttachmentPreview node={node} syncConfig={syncConfig} />}
        {isLabel && (editingText !== null
          ? <div className="canvas-label-grow" data-value={(editingText || '') + ' '} style={labelTextStyle(node)}>{textEditor}</div>
          : <div className="canvas-node-labeltext" style={labelTextStyle(node)}>{node.rich && node.text ? <RichText text={node.text} /> : (node.text || t('canvas.labelDefault'))}</div>)}
        {isDraw && (
          <svg className="canvas-node-drawsvg" viewBox={`0 0 ${node.w || 100} ${node.h || 100}`} preserveAspectRatio="none">
            <path d={node.path || ''} fill="none" stroke={node.color || '#ea580c'}
              strokeWidth={node.strokeWidth || 3} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      </>)}
      {(node.reactions && Object.keys(node.reactions).length > 0) || commentCount > 0 ? (
        <div className="canvas-node-reactions" onMouseDown={(e) => e.stopPropagation()}>
          {Object.entries(node.reactions || {}).map(([emoji, who]) => (
            <button key={emoji} className="canvas-node-reaction"
              title={(who || []).join(', ')}
              onClick={(e) => { e.stopPropagation(); onToggleReaction && onToggleReaction(node.id, emoji); }}>
              {emoji}{(who || []).length > 1 ? ` ${(who || []).length}` : ''}
            </button>
          ))}
          {commentCount > 0 && (
            <button className="canvas-node-reaction canvas-node-commentbadge"
              title={t('canvas.nodeComments', { n: commentCount })}
              onClick={(e) => { e.stopPropagation(); onOpenComments && onOpenComments(node); }}>
              💬 {commentCount}
            </button>
          )}
        </div>
      ) : null}
      {node.locked && <div className="canvas-lock-badge" title="🔒" style={{ position: 'absolute', top: -9, right: -9, width: 20, height: 20, borderRadius: '50%', background: '#fff', border: '1px solid rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, pointerEvents: 'none', zIndex: 5 }}>🔒</div>}
      {!isSelected && <div className="canvas-node-edge-anchor"
        title={t('canvas.edgeDrag')}
        onMouseDown={(e) => { e.stopPropagation(); onEdgeStart(e, node); }}
        onMouseUp={(e) => { e.stopPropagation(); onEdgeFinish(e, node); }}>+</div>}
      <div className="canvas-node-resize"
        title={t(isLabel ? 'canvas.resizeLabel' : 'canvas.resize')}
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, node, 'resize'); }} />
    </div>
  );
}

export const CanvasTile = memo(CanvasTileImpl);

export function CanvasGroup({ group, onMouseDown, onRename, onDelete, onDuplicate, onLayoutMenu }) {
  useI18n();
  return (
    <div className="canvas-group"
      style={{ left: group.x, top: group.y, width: group.w || CANVAS_GROUP_DEFAULT_W, height: group.h || CANVAS_GROUP_DEFAULT_H, '--group-color': group.color || '' }}
      data-group-id={group.id}>
      <div className="canvas-group-head"
        onMouseDown={(e) => onMouseDown(e, group, 'drag')}
        onDoubleClick={() => onRename(group)}>
        <span>{group.title || t('canvas.groupDefault')}</span>
        {onLayoutMenu && (
          <button className={`canvas-group-del canvas-group-layout${group.layout ? ' on' : ''}`} title={t('canvas.autolayout')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onLayoutMenu(group, e.currentTarget.getBoundingClientRect()); }}>
            {group.layout && group.layout.dir === 'row' ? '⇉' : '⇊'}
          </button>
        )}
        {onDuplicate && (
          <button className="canvas-group-del" title={t('canvas.groupDuplicate')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDuplicate(group); }}>⧉</button>
        )}
        <button className="canvas-group-del" title={t('canvas.deleteGroup')} onClick={() => onDelete(group)}>×</button>
      </div>
      <div className="canvas-group-resize"
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, group, 'resize'); }} />
    </div>
  );
}

export const CANVAS_PICKER_MAX_RESULTS = 100;
export function CanvasNotePicker({ open, notes, vaults, activeNoteId, existingNoteIds, onPick, onClose }) {
  useI18n();
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setFocusIdx(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const deferredQ = useDeferredValue(q);
  const rows = useMemo(() => {
    // Cerrado no pinta nada: no hace falta ordenar todas las notas en cada
    // cambio de `notes` mientras el selector no está abierto.
    if (!open) return [];
    const existing = existingNoteIds || new Set();
    // Mismo plegado cacheado que la búsqueda global (sin acentos, sin
    // comentarios/código): antes eran 3 regex sobre cada nota por tecla.
    const qFolded = gsFold(deferredQ);
    const base = (notes || [])
      .filter(f => f && f.id !== activeNoteId)
      .filter(f => {
        if (!qFolded) return true;
        return gsNameFolded(f).includes(qFolded)
          || (qFolded.length >= 2 && gsFoldedSearchable(f).folded.includes(qFolded));
      })
      .sort((a, b) => {
        const av = a.vaultId || 'default';
        const bv = b.vaultId || 'default';
        if (av !== bv) return av.localeCompare(bv);
        return (a.name || '').localeCompare(b.name || '');
      });
    const capped = qFolded ? base.slice(0, CANVAS_PICKER_MAX_RESULTS) : base;
    return capped.map(f => ({ file: f, disabled: existing.has(f.id) }));
  }, [open, notes, activeNoteId, existingNoteIds, deferredQ]);

  const pickable = rows.map((r, idx) => r.disabled ? -1 : idx).filter(idx => idx >= 0);
  const safeFocus = rows.length ? Math.max(0, Math.min(focusIdx, rows.length - 1)) : 0;
  const firstPickable = pickable.length ? pickable[0] : -1;

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${safeFocus}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [open, safeFocus]);

  if (!open) return null;

  const moveFocus = (dir) => {
    if (!rows.length) return;
    let next = safeFocus;
    for (let i = 0; i < rows.length; i++) {
      next = (next + dir + rows.length) % rows.length;
      if (!rows[next].disabled) break;
    }
    setFocusIdx(next);
  };
  const activate = (idx) => {
    const row = rows[idx];
    if (!row || row.disabled) return;
    onPick(row.file);
    onClose();
  };
  const displayFocus = rows[safeFocus] && rows[safeFocus].disabled && firstPickable >= 0 ? firstPickable : safeFocus;

  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onClose} />
      <div className="view-menu canvas-note-picker" role="dialog">
        <div className="view-search">
          <svg viewBox="0 0 13 13"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          <input ref={inputRef}
            placeholder={t('canvas.pickerPh')}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocusIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); if (query) setQuery(''); else onClose(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
              else if (e.key === 'Home') { e.preventDefault(); setFocusIdx(firstPickable >= 0 ? firstPickable : 0); }
              else if (e.key === 'End') { e.preventDefault(); setFocusIdx(pickable.length ? pickable[pickable.length - 1] : Math.max(0, rows.length - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); activate(displayFocus); }
            }} />
          {query && <button className="view-clear" onClick={() => setQuery('')} title={t('tree.clear')}>×</button>}
        </div>
        <div className="view-menu-body" ref={listRef}>
          {rows.length === 0 && (
            <div className="view-empty">
              {q ? t('canvas.pickerNoMatch', { q: query }) : t('canvas.pickerEmpty')}
            </div>
          )}
          {rows.map(({ file, disabled }, idx) => {
            const vault = vaults.find(v => v.id === (file.vaultId || 'default'));
            const isCanvas = !!firstCanvasBlock(file.content || '');
            return (
              <div key={file.id}
                data-idx={idx}
                className={`view-item ${idx === displayFocus ? 'focused' : ''} ${disabled ? 'disabled' : ''}`}
                onMouseEnter={() => setFocusIdx(idx)}
                onClick={() => activate(idx)}>
                <div className="view-item-main">
                  <span className="view-doticon">{file.icon || (isCanvas ? '🎨' : '📄')}</span>
                  <span className="view-name">{file.name.replace(/\.(md|markdown|txt)$/i, '')}</span>
                  {vault && <span className="view-meta">{vault.name}</span>}
                  {disabled && <span className="canvas-picker-badge">{t('canvas.pickerAdded')}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="view-menu-footer">
          <span><kbd>↑↓</kbd>{t('view.foot.nav')}</span>
          <span><kbd>↵</kbd>{t('canvas.pickerImport')}</span>
          <span><kbd>esc</kbd>{t('view.foot.close')}</span>
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{t('canvas.pickerAvail', { n: rows.filter(r => !r.disabled).length })}</span>
        </div>
      </div>
    </>
  );
}

// Static, non-interactive preview shown when a note embeds another canvas
// via the `edinot-canvas-embed` fenced block. Renders a scaled-down SVG of
// the target's nodes + edges plus an "Open" button to jump into it.
export function CanvasEmbedPreview({ targetId, targetName, found, json, onOpen }) {
  useI18n();
  const stats = useMemo(() => {
    if (!json) return null;
    const nodes = Array.isArray(json.nodes) ? json.nodes : [];
    const edges = Array.isArray(json.edges) ? json.edges : [];
    if (!nodes.length) return { nodes: [], edges: [], box: null };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const w = n.w || 200, h = n.h || 100;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
    }
    const pad = 40;
    return { nodes, edges, box: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 } };
  }, [json]);

  if (!found) {
    return (
      <div className="canvas-embed-card canvas-embed-missing">
        <div className="canvas-embed-glyph">🎨</div>
        <div className="canvas-embed-body">
          <div className="canvas-embed-title">{t('canvas.embed.missing')}</div>
          <div className="canvas-embed-sub">id: <code>{targetId || '—'}</code></div>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-embed-card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <div className="canvas-embed-head">
        <span className="canvas-embed-glyph">🎨</span>
        <span className="canvas-embed-title">{targetName || t('canvas.embed.untitled')}</span>
        <span className="canvas-embed-meta">{stats ? `${stats.nodes.length} ${t('canvas.embed.nodes')}` : '—'}</span>
        <button className="canvas-embed-open" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          {t('canvas.embed.open')} ↗
        </button>
      </div>
      <div className="canvas-embed-thumb">
        {stats && stats.box ? (
          <svg viewBox={`${stats.box.x} ${stats.box.y} ${stats.box.w} ${stats.box.h}`}
            preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
            {stats.edges.map((ed, i) => {
              const a = stats.nodes.find(n => n.id === ed.from);
              const b = stats.nodes.find(n => n.id === ed.to);
              if (!a || !b) return null;
              const ax = a.x + (a.w || 200) / 2;
              const ay = a.y + (a.h || 100) / 2;
              const bx = b.x + (b.w || 200) / 2;
              const by = b.y + (b.h || 100) / 2;
              return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke="rgba(90,122,78,0.55)" strokeWidth={3} strokeLinecap="round" />;
            })}
            {stats.nodes.map((n) => {
              const color = n.kind === 'blocker' ? '#dc2626'
                          : n.kind === 'ship'    ? '#1f8e72'
                          : n.kind === 'label'   ? '#a07a2c'
                          : '#5a7a4e';
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                  <rect width={n.w || 200} height={n.h || 100} rx={10}
                        fill="rgba(255,255,255,0.92)" stroke={color} strokeWidth={2} />
                  {n.title && (
                    <text x={14} y={28} fontSize={18} fontWeight={700} fill="#29261b"
                          fontFamily="ui-sans-serif, system-ui, sans-serif">{String(n.title).slice(0, 22)}</text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="canvas-embed-empty">{t('canvas.embed.emptyPreview')}</div>
        )}
      </div>
    </div>
  );
}


// Página ↔ Canvas: la propia página de la nota como bloque del canvas. El
// cuerpo es el editor vivo de la nota (`renderPage`, el mismo Y.Text que el
// modo Página): se escribe aquí y cambia la nota. Se arrastra por la cabecera
// y se redimensiona por la esquina; dentro del cuerpo el ratón, la rueda y el
// teclado son del texto, no del canvas.
function CanvasPageTileImpl({ node, title, renderPage, isSelected, onMouseDown, onExpand }) {
  useI18n();
  const bodyRef = useRef(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    // La rueda (sin Ctrl) desplaza el texto: el canvas escucha la rueda en su
    // contenedor con un listener nativo, así que se para aquí, en el burbujeo.
    const onWheel = (e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const w = node.w || 760;
  const h = node.h || 600;
  if (node.compact) {
    // Nota solo con título: tarjeta pequeña; con doble clic (o al empezar a escribir) se abre como página.
    return (
      <div className={`canvas-node canvas-node-page canvas-node-page-compact${isSelected ? ' selected' : ''}`}
        style={{ left: node.x, top: node.y, width: w, height: h }} data-node-id={node.id}
        onMouseDown={(e) => onMouseDown(e, node, 'drag')}
        onDoubleClick={(e) => { e.stopPropagation(); onExpand && onExpand(node); }}>
        <div className="canvas-page-compact-title">{title || t('canvas.page')}</div>
        <div className="canvas-page-compact-hint">{t('canvas.pageCompactHint')}</div>
      </div>
    );
  }
  return (
    <div className={`canvas-node canvas-node-page${isSelected ? ' selected' : ''}`}
      style={{ left: node.x, top: node.y, width: w, height: h }}
      data-node-id={node.id}>
      <div className="canvas-page-head" onMouseDown={(e) => onMouseDown(e, node, 'drag')}>
        <span className="canvas-page-grip" aria-hidden="true">⋮⋮</span>
        <span className="canvas-page-title">{title || t('canvas.page')}</span>
        <span className="canvas-page-tag">{t('canvas.pageTag')}</span>
      </div>
      <div ref={bodyRef} className="canvas-page-body"
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => {
          // Ctrl/⌘ F dentro de la página → el buscador del canvas (que
          // también busca en la página), no el panel del editor de la página.
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault(); e.stopPropagation();
            window.dispatchEvent(new CustomEvent('edinot:canvas-find'));
          }
        }}
        onKeyDown={(e) => e.stopPropagation()}>
        {renderPage ? renderPage(node) : null}
      </div>
      <div className="canvas-node-resize" title={t('canvas.resize')}
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, node, 'resize'); }} />
    </div>
  );
}
export const CanvasPageTile = memo(CanvasPageTileImpl);
