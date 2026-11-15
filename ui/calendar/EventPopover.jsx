// Popover de evento (no modal): se ancla al evento / hueco / botón que lo
// abrió. Edita título, fecha, inicio–fin, todo el día, repetición,
// calendario (vault), color, lugar, descripción, nota vinculada y aviso.
// Los eventos inline (token 📅/⏰ en una nota) sólo cambian fecha/hora —
// se reescribe el token — y los de Google son de solo lectura.

import { useState, useRef, useLayoutEffect, useEffect, useMemo } from 'react';
import { t, useI18n } from '../../i18n.js';
import { CIcon } from './icons.jsx';
import { names, SWATCHES, parseWhen } from './model.js';

const REM_OPTS = ['', '0', '5', '10', '15', '30', '60', '120', '1440'];
const stripExt = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');

function usePlacement(anchor, ref, deps) {
  const [style, setStyle] = useState({ visibility: 'hidden', top: 0, left: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const M = 12;
    let left, top;
    if (anchor && anchor.width != null) {
      if (anchor.right + 10 + w <= vw - M) left = anchor.right + 10;
      else if (anchor.left - 10 - w >= M) left = anchor.left - 10 - w;
      else left = Math.min(vw - w - M, Math.max(M, anchor.left + anchor.width / 2 - w / 2));
      top = anchor.top;
      if (left > anchor.left - w && left < anchor.right && anchor.bottom + 8 + h <= vh - M) top = anchor.bottom + 8;
    } else {
      left = vw / 2 - w / 2;
      top = vh / 2 - h / 2;
    }
    top = Math.min(vh - h - M, Math.max(M, top));
    left = Math.min(vw - w - M, Math.max(M, left));
    setStyle({ top: Math.round(top), left: Math.round(left) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return style;
}

export function EventPopover({
  draft, setDraft, anchor, calendars, calColor, notes, readOnly,
  onSave, onDelete, onClose, onOpenNote, onOpenExternal, onToggleTask,
}) {
  useI18n();
  const ref = useRef(null);
  const titleRef = useRef(null);
  const [noteQ, setNoteQ] = useState('');
  const [notePick, setNotePick] = useState(false);
  const [more, setMore] = useState(!!(draft.description || draft.location || (draft.rfreq && draft.rfreq !== 'none')));
  const style = usePlacement(anchor, ref, [anchor, draft.source, draft.rfreq, more, draft.allDay, notePick]);
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));
  const isGoogle = draft.source === 'google';
  const isInline = draft.source === 'inline';
  const locked = readOnly || isGoogle;

  // Foco: el título en uno nuevo; el propio popover al editar (Tab recorre
  // los campos y Esc lo cierra).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (draft.mode === 'new' && titleRef.current) titleRef.current.focus();
        else if (ref.current) ref.current.focus({ preventScroll: true });
      } catch {}
    }, 20);
    return () => clearTimeout(id);
  }, [draft.mode, draft.id]);

  const color = draft.color || calColor(draft.calKey) || 'var(--accent)';
  const note = draft.noteId ? (notes || []).find(n => n.id === draft.noteId) : null;
  const endBad = !draft.allDay && draft.time && draft.endTime
    && (draft.endDate || draft.date) === draft.date && draft.endTime <= draft.time;

  const onKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!locked) onSave(); }
  };
  const noteList = useMemo(() => {
    if (!notePick) return [];
    const q = noteQ.trim().toLowerCase();
    return (notes || []).filter(n => !q || String(n.name || '').toLowerCase().includes(q)).slice(0, 8);
  }, [notePick, noteQ, notes]);

  const dateLabel = (() => {
    const d = parseWhen(draft.date);
    return d ? names.full(d) : '';
  })();

  return (
    <div ref={ref} className="cp-pop" role="dialog" tabIndex={-1} aria-label={draft.mode === 'new' ? t('calp.pop.new') : t('calp.pop.edit')}
      style={{ ...style, '--ev': color }} onKeyDown={onKey} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cp-pop-head">
        <span className="cp-pop-sw" aria-hidden="true" />
        {isGoogle && <span className="cp-pop-badge"><CIcon name="lock" size={12} /> {t('calp.pop.google')}</span>}
        {isInline && <span className="cp-pop-badge" title={t('calp.pop.fromNoteTip')}><CIcon name="note" size={12} /> {t('calp.pop.fromNote', { name: note ? stripExt(note.name) : '…' })}</span>}
        {!isGoogle && !isInline && (
          <div className="cp-seg cp-seg-sm" role="group" aria-label={t('cal.fieldKind')}>
            <button type="button" className={draft.kind !== 'reminder' ? 'on' : ''} disabled={locked}
              aria-pressed={draft.kind !== 'reminder'} onClick={() => set({ kind: 'event' })}>{t('cal.kindEvent')}</button>
            <button type="button" className={draft.kind === 'reminder' ? 'on' : ''} disabled={locked}
              aria-pressed={draft.kind === 'reminder'} onClick={() => set({ kind: 'reminder' })}>{t('cal.kindReminder')}</button>
          </div>
        )}
        <span className="cp-flex" />
        <button type="button" className="cp-icon-btn" onClick={onClose} aria-label={t('calp.pop.close')} title={t('calp.pop.close') + ' (Esc)'}>
          <CIcon name="close" size={15} />
        </button>
      </div>

      {isInline || isGoogle ? (
        <div className="cp-pop-titleline">{draft.title || t('calp.untitled')}</div>
      ) : (
        <input ref={titleRef} className="cp-pop-title" value={draft.title} placeholder={t('calp.pop.title')}
          aria-label={t('cal.fieldTitle')} disabled={locked}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(); } }} />
      )}

      <div className="cp-pop-row cp-pop-when">
        <CIcon name="clock" size={15} className="cp-pop-ico" />
        <div className="cp-pop-whenbody">
          <div className="cp-pop-fields">
            <input type="date" className="cp-inp cp-inp-date" value={draft.date} disabled={locked}
              aria-label={t('calp.pop.date')} title={dateLabel}
              onChange={(e) => e.target.value && set({ date: e.target.value, endDate: draft.endDate && draft.endDate < e.target.value ? e.target.value : draft.endDate })} />
            {!draft.allDay && (
              <>
                <input type="time" className="cp-inp cp-inp-time" value={draft.time} step="900" disabled={locked}
                  aria-label={t('calp.pop.start')}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Mover el inicio arrastra el fin (misma duración).
                    if (draft.time && draft.endTime && v) {
                      const [h0, m0] = draft.time.split(':').map(Number);
                      const [h1, m1] = draft.endTime.split(':').map(Number);
                      const [h2, m2] = v.split(':').map(Number);
                      const dur = (h1 * 60 + m1) - (h0 * 60 + m0);
                      const e2 = Math.min(23 * 60 + 59, h2 * 60 + m2 + Math.max(15, dur));
                      set({ time: v, endTime: `${String(Math.floor(e2 / 60)).padStart(2, '0')}:${String(e2 % 60).padStart(2, '0')}` });
                    } else set({ time: v });
                  }} />
                {!isInline && (
                  <>
                    <span className="cp-pop-dash">–</span>
                    <input type="time" className="cp-inp cp-inp-time" value={draft.endTime || ''} step="900" disabled={locked}
                      aria-label={t('calp.pop.end')} aria-invalid={endBad || undefined}
                      onChange={(e) => set({ endTime: e.target.value })} />
                  </>
                )}
              </>
            )}
            {draft.allDay && !isInline && (
              <>
                <span className="cp-pop-dash">–</span>
                <input type="date" className="cp-inp cp-inp-date" value={draft.endDate || draft.date} min={draft.date} disabled={locked}
                  aria-label={t('calp.pop.endDate')}
                  onChange={(e) => set({ endDate: e.target.value })} />
              </>
            )}
          </div>
          <label className="cp-check">
            <input type="checkbox" checked={!!draft.allDay} disabled={locked}
              onChange={(e) => set(e.target.checked ? { allDay: true } : { allDay: false, time: draft.time || '09:00', endTime: draft.endTime || (isInline ? '' : '10:00') })} />
            {t('calp.allDayToggle')}
          </label>
          {endBad && <div className="cp-pop-err" role="alert">{t('calp.pop.endBeforeStart')}</div>}
        </div>
      </div>

      {!isInline && !isGoogle && (
        <div className="cp-pop-row">
          <CIcon name="repeat" size={15} className="cp-pop-ico" />
          <div className="cp-pop-grow">
            <select className="cp-inp" value={draft.rfreq || 'none'} disabled={locked} aria-label={t('cal.repeat')}
              onChange={(e) => set({ rfreq: e.target.value })}>
              <option value="none">{t('cal.repeat.none')}</option>
              <option value="daily">{t('cal.repeat.daily')}</option>
              <option value="weekly">{t('cal.repeat.weekly')}</option>
              <option value="monthly">{t('cal.repeat.monthly')}</option>
              <option value="yearly">{t('cal.repeat.yearly')}</option>
            </select>
            {draft.rfreq && draft.rfreq !== 'none' && (
              <div className="cp-pop-recur">
                <span className="cp-pop-inline">
                  {t('cal.repeat.every')}
                  <input type="number" min="1" max="366" className="cp-inp cp-inp-num" value={draft.rinterval} disabled={locked}
                    aria-label={t('cal.repeat.every')}
                    onChange={(e) => set({ rinterval: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                  {t('cal.repeat.unit.' + draft.rfreq)}
                </span>
                {draft.rfreq === 'weekly' && (
                  <span className="cp-pop-days">
                    {[0, 1, 2, 3, 4, 5, 6].map(dw => (
                      <button key={dw} type="button" disabled={locked}
                        className={(draft.rdays || []).includes(dw) ? 'on' : ''}
                        aria-pressed={(draft.rdays || []).includes(dw)}
                        onClick={() => setDraft(s => { const st = new Set(s.rdays || []); st.has(dw) ? st.delete(dw) : st.add(dw); return { ...s, rdays: [...st].sort((a, b) => a - b) }; })}>
                        {names.dowNarrow(dw)}
                      </button>
                    ))}
                  </span>
                )}
                <span className="cp-pop-inline">
                  <select className="cp-inp" value={draft.rend} disabled={locked} aria-label={t('cal.repeat.end.never')}
                    onChange={(e) => set({ rend: e.target.value })}>
                    <option value="never">{t('cal.repeat.end.never')}</option>
                    <option value="until">{t('cal.repeat.end.until')}</option>
                    <option value="count">{t('cal.repeat.end.count')}</option>
                  </select>
                  {draft.rend === 'until' && (
                    <input type="date" className="cp-inp cp-inp-date" value={draft.runtil} disabled={locked}
                      onChange={(e) => set({ runtil: e.target.value })} />
                  )}
                  {draft.rend === 'count' && (
                    <input type="number" min="1" max="1500" className="cp-inp cp-inp-num" value={draft.rcount} disabled={locked}
                      onChange={(e) => set({ rcount: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                  )}
                </span>
                {draft.mode === 'edit' && <span className="cp-pop-hint">{t('calp.pop.seriesHint')}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {!isInline && !isGoogle && (
        <div className="cp-pop-row">
          <CIcon name="palette2" size={15} className="cp-pop-ico" style={{ color }} />
          <div className="cp-pop-grow cp-pop-calrow">
            <select className="cp-inp" value={draft.calKey} disabled={locked} aria-label={t('calp.pop.calendar')}
              onChange={(e) => set({ calKey: e.target.value })}>
              {calendars.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
            <span className="cp-swatches" role="radiogroup" aria-label={t('calp.pop.color')}>
              <button type="button" role="radio" aria-checked={!draft.color} disabled={locked}
                className={`cp-swatch auto${!draft.color ? ' on' : ''}`} style={{ '--sw': calColor(draft.calKey) }}
                title={t('calp.pop.colorAuto')} aria-label={t('calp.pop.colorAuto')}
                onClick={() => set({ color: '' })} />
              {SWATCHES.map(c => (
                <button key={c} type="button" role="radio" aria-checked={draft.color === c} disabled={locked}
                  className={`cp-swatch${draft.color === c ? ' on' : ''}`} style={{ '--sw': c }}
                  aria-label={c} onClick={() => set({ color: c })} />
              ))}
            </span>
          </div>
        </div>
      )}

      {!isInline && (
        <div className="cp-pop-row">
          <CIcon name="bell" size={15} className="cp-pop-ico" />
          <select className="cp-inp cp-pop-grow" value={draft.reminderOffset == null ? '' : String(draft.reminderOffset)}
            disabled={locked} aria-label={t('calp.pop.reminder')}
            onChange={(e) => set({ reminderOffset: e.target.value })}>
            {REM_OPTS.map(o => <option key={o} value={o}>{t(o === '' ? 'calp.pop.rem.none' : 'calp.pop.rem.' + o)}</option>)}
          </select>
        </div>
      )}

      {!isInline && (more || isGoogle) ? (
        <>
          {(!isGoogle || draft.location) && (
            <div className="cp-pop-row">
              <CIcon name="mapPin" size={15} className="cp-pop-ico" />
              <input className="cp-inp cp-pop-grow" value={draft.location || ''} placeholder={t('calp.pop.location')} disabled={locked}
                aria-label={t('calp.pop.location')} onChange={(e) => set({ location: e.target.value })} />
            </div>
          )}
          {(!isGoogle || draft.description) && (
            <div className="cp-pop-row">
              <CIcon name="text" size={15} className="cp-pop-ico" />
              <textarea className="cp-inp cp-pop-grow cp-pop-desc" rows={2} value={draft.description || ''} disabled={locked}
                placeholder={t('calp.pop.description')} aria-label={t('calp.pop.description')}
                onChange={(e) => set({ description: e.target.value })} />
            </div>
          )}
        </>
      ) : !isInline && (
        <button type="button" className="cp-pop-more" onClick={() => setMore(true)}>
          <CIcon name="mapPin" size={14} /> {t('calp.pop.location')} · {t('calp.pop.description')}
        </button>
      )}

      {!isGoogle && !isInline && (
        <div className="cp-pop-row">
          <CIcon name="note" size={15} className="cp-pop-ico" />
          {draft.noteId ? (
            <div className="cp-pop-grow cp-pop-note">
              <button type="button" className="cp-link" onClick={() => onOpenNote(draft.noteId, draft.anchor && draft.anchor.snippet)}>
                {(note && note.icon) || ''} {note ? stripExt(note.name) : t('cal.linkedNote')} ↗
              </button>
              {!locked && <button type="button" className="cp-btn-ghost" onClick={() => set({ noteId: null, anchor: null })}>{t('cal.unlink')}</button>}
            </div>
          ) : (
            <div className="cp-pop-grow cp-notepick">
              <input className="cp-inp" placeholder={t('calp.pop.note')} value={noteQ} disabled={locked}
                aria-label={t('calp.pop.note')}
                onFocus={() => setNotePick(true)}
                onBlur={() => setTimeout(() => setNotePick(false), 150)}
                onChange={(e) => { setNoteQ(e.target.value); setNotePick(true); }} />
              {notePick && noteList.length > 0 && (
                <div className="cp-notepick-list" role="listbox">
                  {noteList.map(n => (
                    <button key={n.id} type="button" role="option" aria-selected="false"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        set({ noteId: n.id, ...(draft.mode === 'new' && n.vaultId ? { calKey: `vault:${n.vaultId}` } : {}) });
                        setNotePick(false); setNoteQ('');
                      }}>
                      <span>{n.icon || '📄'}</span> {stripExt(n.name)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isInline && draft.status && (
        <div className="cp-pop-row">
          <CIcon name="task" size={15} className="cp-pop-ico" />
          <label className="cp-check">
            <input type="checkbox" checked={draft.status === 'done'} disabled={readOnly}
              onChange={(e) => { onToggleTask(e.target.checked); set({ status: e.target.checked ? 'done' : 'open' }); }} />
            {t('calp.pop.taskDone')}
          </label>
        </div>
      )}

      <div className="cp-pop-foot">
        {draft.mode === 'edit' && !locked && !isInline && (
          <button type="button" className="cp-btn-ghost cp-danger" onClick={onDelete}>
            <CIcon name="trash" size={14} /> {t('calp.pop.delete')}
          </button>
        )}
        {isInline && (
          <button type="button" className="cp-btn-ghost" onClick={() => onOpenNote(draft.noteId, draft.anchor && draft.anchor.snippet)}>
            <CIcon name="note" size={14} /> {t('calp.pop.openNote')}
          </button>
        )}
        {isGoogle && draft.htmlLink && (
          <button type="button" className="cp-btn-ghost" onClick={() => onOpenExternal(draft.htmlLink)}>
            <CIcon name="external" size={14} /> {t('calp.pop.openGoogle')}
          </button>
        )}
        <span className="cp-flex" />
        {!locked ? (
          <>
            <button type="button" className="cp-btn" onClick={onClose}>{t('calp.pop.cancel')}</button>
            <button type="button" className="cp-btn cp-btn-primary" onClick={onSave} disabled={endBad}>{t('calp.pop.save')}</button>
          </>
        ) : (
          <button type="button" className="cp-btn" onClick={onClose}>{t('calp.pop.close')}</button>
        )}
      </div>
    </div>
  );
}
