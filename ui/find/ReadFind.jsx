// Buscador de la nota en modo Leer (Ctrl/⌘ F): la misma barra que en Editar,
// resaltando en el texto renderizado sin tocarlo. Enter / Shift+Enter
// recorren, Esc cierra.

import { useState, useEffect, useRef, useCallback } from 'react';
import { t, useI18n } from '../../i18n.js';
import { findRanges, paintRanges, clearPaint, revealRange, countLabel } from './dom-find.js';

const NS = 'edinot-find';

export function ReadFind({ getRoot, initial = '', onClose, focusKey }) {
  useI18n();
  const [q, setQ] = useState(initial);
  const [cur, setCur] = useState(0);       // índice de la actual (0 = primera)
  const [total, setTotal] = useState(0);
  const rangesRef = useRef([]);
  const inputRef = useRef(null);

  const recompute = useCallback((keepIndex) => {
    const root = getRoot && getRoot();
    const ranges = root ? findRanges(root, q, { skip: '.edinot-search' }) : [];
    rangesRef.current = ranges;
    setTotal(ranges.length);
    const i = ranges.length ? Math.min(keepIndex ?? 0, ranges.length - 1) : -1;
    setCur(Math.max(0, i));
    paintRanges(ranges, i, NS);
    return { ranges, i };
  }, [getRoot, q]);

  // Al escribir: a la primera coincidencia.
  useEffect(() => {
    const { ranges, i } = recompute(0);
    if (i >= 0) revealRange(ranges[i]);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si el texto cambia por debajo (sincronización, otra persona), recalcular.
  useEffect(() => {
    const root = getRoot && getRoot();
    if (!root || typeof MutationObserver === 'undefined') return;
    let timer = null;
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => recompute(cur), 150); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(timer); mo.disconnect(); };
  }, [getRoot, recompute, cur]);

  useEffect(() => () => clearPaint(NS), []);
  useEffect(() => { const el = inputRef.current; if (el) { el.focus(); el.select(); } }, [focusKey]);

  const go = (d) => {
    const ranges = rangesRef.current;
    if (!ranges.length) return;
    const i = ((cur + d) % ranges.length + ranges.length) % ranges.length;
    setCur(i);
    paintRanges(ranges, i, NS);
    revealRange(ranges[i]);
  };
  const close = () => { clearPaint(NS); onClose && onClose(); };

  return (
    <div className="edinot-search edinot-search-read" role="search" onMouseDown={(e) => e.stopPropagation()}>
      <div className="es-row es-row-find">
        <span className="es-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </span>
        <input ref={inputRef} type="text" className="es-find" value={q} spellCheck={false}
          placeholder={t('search.placeholderNote')} aria-label={t('search.placeholderNote')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); e.currentTarget.select(); }
          }} />
        <span className={`es-count${q.trim() && !total ? ' zero' : ''}`} aria-live="polite">
          {q.trim() ? countLabel(t, total ? cur + 1 : 0, total) : ''}
        </span>
        <div className="es-nav">
          <button type="button" className="es-icon-btn es-prev" title={t('search.prevHint')} aria-label={t('search.prev')} disabled={!total} onClick={() => go(-1)}>
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
          </button>
          <button type="button" className="es-icon-btn es-next" title={t('search.nextHint')} aria-label={t('search.next')} disabled={!total} onClick={() => go(1)}>
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
          </button>
        </div>
        <button type="button" className="es-icon-btn es-close" title={t('search.closeHint')} aria-label={t('btn.close')} onClick={close}>
          <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
