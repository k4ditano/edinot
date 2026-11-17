// Píldora flotante de «Reuniones y actas»: mientras se graba (tiempo, pausa, terminar), mientras se procesa
// (qué paso va) y al acabar (abrir la nota) o fallar (reintentar). Solo se ve cuando hay algo que contar.

import { useEffect, useState } from 'react';
import { t, useI18n } from '../../i18n.js';
import {
  getMeetingState, onMeetingState, pauseMeeting, resumeMeeting, stopMeeting, discardMeeting,
  processMeeting, dismissMeeting, refreshPendingMeetings, discardPending,
} from './engine.js';
import { formatClock } from '../../shared/meeting-model.mjs';

const Svg = ({ children }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{children}</svg>;

export function MeetingPill({ onOpenNote, onOpenSettings }) {
  useI18n();
  const [st, setSt] = useState(getMeetingState());
  useEffect(() => onMeetingState(setSt), []);
  useEffect(() => { refreshPendingMeetings(); }, []);
  const { phase } = st;

  if (phase === 'idle') {
    const p = st.pending && st.pending[0];
    if (!p) return null;
    const when = new Date(p.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return (
      <div className="meet-pill meet-pending" role="status">
        <span className="meet-msg">{t('meet.pending', { when, dur: formatClock(p.durationSec) })}</span>
        <button type="button" className="meet-btn primary" onClick={() => processMeeting(p.id, { startedAt: p.startedAt, durationSec: p.durationSec })}>{t('meet.pending.process')}</button>
        <button type="button" className="meet-btn" onClick={() => discardPending(p.id)}>{t('meet.pending.discard')}</button>
      </div>
    );
  }

  if (phase === 'starting') {
    return <div className="meet-pill" role="status"><span className="meet-msg">{t('meet.pill.starting')}</span></div>;
  }

  if (phase === 'recording' || phase === 'paused') {
    const paused = phase === 'paused';
    return (
      <div className={`meet-pill rec${paused ? ' paused' : ''}`} role="status" aria-live="off">
        <span className="meet-dot" style={{ '--lvl': paused ? 0 : st.level }} aria-hidden="true" />
        <span className="meet-msg">{paused ? t('meet.pill.paused') : t('meet.pill.recording')}</span>
        <span className="meet-time" aria-label={formatClock(st.elapsed)}>{formatClock(st.elapsed)}</span>
        <button type="button" className="meet-ic" onClick={paused ? resumeMeeting : pauseMeeting}
          aria-label={paused ? t('meet.pill.resume') : t('meet.pill.pause')} title={paused ? t('meet.pill.resume') : t('meet.pill.pause')}>
          {paused ? <Svg><path d="M8 5v14l11-7z" /></Svg> : <Svg><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></Svg>}
        </button>
        <button type="button" className="meet-btn primary" onClick={stopMeeting} title={t('meet.pill.stop')}>
          <Svg><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>{t('meet.pill.stop')}
        </button>
        <button type="button" className="meet-ic" onClick={() => { if (window.confirm(t('meet.pill.discardConfirm'))) discardMeeting(); }}
          aria-label={t('meet.pill.discard')} title={t('meet.pill.discard')}>
          <Svg><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" /></Svg>
        </button>
        {st.warn === 'nosys' && <span className="meet-warn">{t('meet.warn.nosys')}</span>}
      </div>
    );
  }

  if (phase === 'processing') {
    return (
      <div className="meet-pill" role="status" aria-live="polite">
        <span className="meet-spin" aria-hidden="true" />
        <span className="meet-msg">{t('meet.step.' + (st.step || 'transcribing'), { d: st.stepDetail || '' })}</span>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="meet-pill done" role="status">
        <span className="meet-msg">{t('meet.done')}</span>
        {st.noteId && <button type="button" className="meet-btn primary" onClick={() => { onOpenNote && onOpenNote(st.noteId); dismissMeeting(); }}>{t('meet.open')}</button>}
        <button type="button" className="meet-btn" onClick={dismissMeeting}>{t('meet.close')}</button>
        {st.warn === 'noacta' && <span className="meet-warn">{t('meet.warn.noacta')}</span>}
      </div>
    );
  }

  // error
  const e = st.error || '';
  const known = ['mic', 'nokey', 'silence'].includes(e);
  const msg = known ? t('meet.err.' + e) : t('meet.err.generic', { err: e });
  return (
    <div className="meet-pill err" role="alert">
      <span className="meet-msg">{msg}</span>
      {e === 'nokey' && <button type="button" className="meet-btn primary" onClick={() => { onOpenSettings && onOpenSettings('meetings'); }}>{t('meet.settings')}</button>}
      {!known && st.id && <button type="button" className="meet-btn primary" onClick={() => processMeeting(st.id)}>{t('meet.retry')}</button>}
      <button type="button" className="meet-btn" onClick={dismissMeeting}>{t('meet.close')}</button>
    </div>
  );
}
