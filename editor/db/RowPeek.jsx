// «Abrir como página»: panel lateral con la fila como si fuera una página —
// título grande, todas las propiedades editables en el sitio y, si la fila
// enlaza a una nota (columna Enlace), el contenido de esa nota.

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n.js';
import { DbIcon, TYPE_ICON } from './icons.jsx';
import { getPortalRoot } from './ui.jsx';
import { CellView, InlineEditor } from './cells.jsx';

export function RowPeek({ cx, rowIdx, onClose, onNav }) {
  const row = cx.meta.rows[rowIdx];
  const titleName = cx.headers[cx.titleIdx];
  const titleConf = cx.cols[titleName] || null;
  const titleIsText = !titleConf || titleConf.type === 'text';
  const [title, setTitle] = useState(row ? String(row[cx.titleIdx] || '') : '');
  const titleRef = useRef(null);
  const panelRef = useRef(null);
  useEffect(() => { if (row && document.activeElement !== titleRef.current) setTitle(String(row[cx.titleIdx] || '')); }, [row, cx.titleIdx]);
  // Al abrir una fila nueva (título vacío) el foco va al título.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (titleRef.current && !String(row && row[cx.titleIdx] || '').trim()) titleRef.current.focus();
      else if (panelRef.current) panelRef.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIdx]);
  const order = cx.rows.map(x => x.idx);
  // Esc cierra aunque el foco se haya ido a <body> (p. ej. tras un popover).
  const closeRef = useRef(null);
  closeRef.current = () => { commitTitle(); onClose(); };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && !(panelRef.current && panelRef.current.contains(ae))) return;
      if (document.querySelector('.db-pop')) return;
      e.preventDefault();
      closeRef.current && closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pos = order.indexOf(rowIdx);
  const link = useMemo(() => {
    if (!row) return null;
    for (let i = 0; i < cx.headers.length; i++) {
      const conf = cx.cols[cx.headers[i]];
      const v = String(row[i] || '').trim();
      if (conf && conf.type === 'wikilink' && v) return v.split('|')[0].trim();
    }
    // Un [[enlace]] en el título también cuenta.
    const m = /\[\[([^\]|]+)/.exec(String(row[cx.titleIdx] || ''));
    return m ? m[1].trim() : null;
  }, [row, cx.headers, cx.cols, cx.titleIdx]);
  const note = link && cx.getNote ? cx.getNote(link) : null;
  const noteHtml = useMemo(() => {
    if (!note || !cx.renderMarkdown) return null;
    try { return cx.renderMarkdown(note.content || ''); } catch { return null; }
  }, [note && note.id, note && note.content, cx.renderMarkdown]);
  const root = getPortalRoot();
  if (!row || !root) return null;
  const commitTitle = () => {
    const cur = String(row[cx.titleIdx] || '');
    if (title !== cur) cx.commitCell(rowIdx, cx.titleIdx, title);
  };
  const ed = cx.editing;
  return createPortal(
    <div className="db-peek-wrap">
      <div className="db-peek-backdrop" onMouseDown={(e) => { e.preventDefault(); commitTitle(); onClose(); }} />
      <aside ref={panelRef} className="db-peek" role="dialog" aria-modal="false" aria-label={title || t('db.untitled')} tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !cx.editing) { e.preventDefault(); e.stopPropagation(); commitTitle(); onClose(); }
        }}>
        <header className="db-peek-bar">
          <button type="button" className="db-ib" aria-label={t('db.peek.prev')} disabled={pos <= 0} onClick={() => { commitTitle(); onNav(order[pos - 1]); }}><DbIcon name="chevUp" size={15} /></button>
          <button type="button" className="db-ib" aria-label={t('db.peek.next')} disabled={pos < 0 || pos >= order.length - 1} onClick={() => { commitTitle(); onNav(order[pos + 1]); }}><DbIcon name="chevDown" size={15} /></button>
          <span className="db-peek-crumb">{cx.label}</span>
          <span className="db-peek-spacer" />
          {link && (
            <button type="button" className="db-btn-quiet" onClick={() => { commitTitle(); onClose(); cx.openNote(link); }}>
              <DbIcon name="external" size={13} />{t('db.peek.openNote')}
            </button>
          )}
          {!cx.readOnly && (
            <button type="button" className="db-ib" aria-label={t('db.row.menu')} onClick={(e) => cx.rowMenu(rowIdx, e.currentTarget, { fromPeek: true })}>
              <DbIcon name="more" size={15} />
            </button>
          )}
          <button type="button" className="db-ib" aria-label={t('db.close')} onClick={() => { commitTitle(); onClose(); }}><DbIcon name="close" size={15} /></button>
        </header>
        <div className="db-peek-body">
          {titleIsText ? (
            <textarea ref={titleRef} className="db-peek-title" rows={1} value={title} readOnly={cx.readOnly}
              placeholder={t('db.untitled')} aria-label={titleName}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (panelRef.current) panelRef.current.focus({ preventScroll: true }); else e.currentTarget.blur(); } }} />
          ) : (
            <div className="db-peek-title db-peek-title-ro">
              <CellView raw={row[cx.titleIdx]} conf={titleConf} colName={titleName} cx={cx} />
            </div>
          )}
          <div className="db-props" role="list">
            {cx.headers.map((h, ci) => {
              if (ci === cx.titleIdx && titleIsText) return null;
              const conf = cx.cols[h] || null;
              const type = (conf && conf.type) || 'text';
              const editingHere = ed && ed.surface === 'peek' && ed.rowIdx === rowIdx && ed.colIdx === ci;
              const raw = row[ci] == null ? '' : row[ci];
              const hiddenHere = cx.hiddenSet.has(h);
              return (
                <div key={ci} role="listitem" className={`db-prop${hiddenHere ? ' is-hidden' : ''}`}>
                  <span className="db-prop-key" title={hiddenHere ? t('db.col.hiddenHint') : h}>
                    <DbIcon name={TYPE_ICON[type] || 'text'} size={14} />
                    <span>{h}</span>
                  </span>
                  <div className={`db-prop-val t-${type}${editingHere ? ' editing' : ''}`} data-db-prop={ci}
                    role="button" tabIndex={cx.readOnly ? -1 : 0} aria-label={h}
                    onClick={(e) => cx.cellClick(rowIdx, ci, e.currentTarget, e, 'peek')}
                    onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); cx.cellClick(rowIdx, ci, e.currentTarget, e, 'peek'); } }}>
                    {editingHere && ed.kind === 'inline'
                      ? <InlineEditor initial={raw} type={type} onCommit={(v, how) => cx.commitEditing(v, how, ed)} onCancel={() => cx.stopEdit(false)} />
                      : (String(raw).trim() || type === 'checkbox' || type === 'rating' || type === 'progress'
                          ? <CellView raw={raw} conf={conf} colName={h} cx={cx} editable={!cx.readOnly} onCommit={(v) => cx.commitCell(rowIdx, ci, v)} />
                          : <span className="db-empty-val">{t('db.empty.value')}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
          {link && (
            <section className="db-peek-note" aria-label={t('db.peek.linked')}>
              <div className="db-peek-note-head">
                <DbIcon name="note" size={14} /><span>{link}</span>
              </div>
              {note
                ? (noteHtml ? <div className="md-render db-peek-note-body" dangerouslySetInnerHTML={{ __html: noteHtml }} /> : <p className="db-faint">{t('db.peek.noteEmpty')}</p>)
                : <p className="db-faint">{t('db.peek.noteMissing')}</p>}
            </section>
          )}
          {!link && <p className="db-peek-hint">{t('db.peek.hint')}</p>}
        </div>
      </aside>
    </div>,
    root,
  );
}
