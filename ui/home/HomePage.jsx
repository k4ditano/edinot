// Inicio: fecha + saludo, creación rápida, la nota de hoy con captura
// rápida, lo próximo (eventos/recordatorios), recientes y tareas pendientes
// con fecha.
//
// Los datos de calendario se leen de store.js (getVaultEvents, que ya
// cachea los eventos inline por contenido) y sólo se recalculan cuando
// cambia `eventsVersion` — nunca por tecla.

import { useState, useMemo, memo, useEffect } from 'react';
import { t, useI18n, getLang } from '../../i18n.js';
import { perfCountRender } from '../../perf.js';
import { getVaultEvents, nextOccurrence } from '../../store.js';
import { Icon } from '../shell/icons.jsx';
import { Menu } from '../shell/Menu.jsx';
import { relTime } from '../shell/ContextPanel.jsx';
import { coverCss } from '../../editor/blocks/cover.js';

const baseName = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');
const DAY = 86400000;

// "2026-10-18" → medianoche local; "2026-10-18T09:30" → local.
function parseLocal(s) {
  if (!s) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return Date.parse(s);
}
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

function dayWord(ts, locale) {
  const today = startOfDay(Date.now());
  const d = startOfDay(ts);
  if (d === today) return t('home.today');
  if (d === today + DAY) return t('home.tomorrow');
  if (d === today - DAY) return t('home.yesterday');
  if (d > today && d < today + 7 * DAY) {
    const w = new Date(ts).toLocaleDateString(locale, { weekday: 'long' });
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}
function timeLabel(ts, locale) {
  return new Date(ts).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function greeting(h) {
  if (h >= 6 && h < 13) return t('home.greet.morning');
  if (h >= 13 && h < 21) return t('home.greet.afternoon');
  return t('home.greet.night');
}

const CARD_TONES = {
  note: { bg: '#EFE0EC', fg: '#6E3F80', icon: 'note' },
  canvas: { bg: '#E2EAD8', fg: '#3F5E34', icon: 'canvas' },
  database: { bg: '#DCE7F3', fg: '#2F527C', icon: 'database' },
  agent: { bg: '#F6DCCB', fg: '#8A3B14', icon: 'agents' },
};

export const HomePage = memo(function HomePage({
  vaultIds, eventsVersion, filesMeta, fileStats, canvasIds, dbIds, editLog, notesById, vaultName, syncServer,
  today, todayName, templates, readOnly, actions: A,
}) {
  perfCountRender('HomePage');
  useI18n();
  const locale = getLang() === 'en' ? 'en-GB' : 'es-ES';
  const now = new Date();
  const dateLabel = (() => {
    const s = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();
  // Pista de sincronización (solo mientras los datos estén únicamente en este equipo): se puede cerrar y no vuelve.
  const SYNC_CARD_KEY = 'edinot.home.syncCard.dismissed';
  const [syncCardOpen, setSyncCardOpen] = useState(() => { try { return !localStorage.getItem(SYNC_CARD_KEY); } catch { return true; } });
  const dismissSyncCard = () => { setSyncCardOpen(false); try { localStorage.setItem(SYNC_CARD_KEY, '1'); } catch {} };
  const [capture, setCapture] = useState('');
  const [busy, setBusy] = useState(false);
  const [tplMenu, setTplMenu] = useState(null);

  // ── Eventos / tareas de todos los vaults accesibles ──────────────────
  const { upcoming, tasks } = useMemo(() => {
    const nowMs = Date.now();
    const sod = startOfDay(nowMs);
    const seen = new Set();
    const up = [];
    const tk = [];
    for (const vid of vaultIds) {
      let evs;
      try { evs = getVaultEvents(vid); } catch { continue; }
      for (const ev of evs) {
        if (!ev || ev.dismissed || seen.has(ev.id)) continue;
        seen.add(ev.id);
        if (ev.status === 'open') {
          const ts = parseLocal(ev.start);
          tk.push({ ev, ts: Number.isFinite(ts) ? ts : Infinity });
        }
        if (ev.status === 'done') continue;
        let ts;
        if (ev.recurrence && ev.recurrence.freq) {
          try { ts = nextOccurrence(ev, sod); } catch { ts = null; }
        } else {
          ts = parseLocal(ev.snoozedUntil || ev.start);
        }
        if (!Number.isFinite(ts) || ts < sod || ts > nowMs + 30 * DAY) continue;
        // Los de hoy con hora ya pasada no son «próximos».
        if (!ev.allDay && ts < nowMs - 30 * 60000 && ev.kind !== 'reminder') continue;
        up.push({ ev, ts });
      }
    }
    up.sort((a, b) => a.ts - b.ts);
    tk.sort((a, b) => a.ts - b.ts);
    return { upcoming: up.slice(0, 4), tasks: tk.slice(0, 6) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultIds, eventsVersion]);

  // ── Recientes (abiertas en este equipo) ───────────────────────────────
  const recents = useMemo(() => {
    const st = fileStats || {};
    return filesMeta
      .filter(f => ((st[f.id] || {}).t || 0) > 0)
      .sort((a, b) => st[b.id].t - st[a.id].t)
      .slice(0, 4);
  }, [filesMeta, fileStats]);
  const aiEditedAt = useMemo(() => {
    const m = new Map();
    for (const e of editLog || []) {
      if (!e || !e.noteId) continue;
      const ts = Date.parse(e.ts);
      if (Number.isFinite(ts) && ts > (m.get(e.noteId) || 0)) m.set(e.noteId, ts);
    }
    return m;
  }, [editLog]);

  const submitCapture = async () => {
    const v = capture.trim();
    if (!v || busy) return;
    setBusy(true);
    try { await A.appendToToday(v); setCapture(''); } finally { setBusy(false); }
  };

  const kindOf = (f) => (dbIds && dbIds.has(f.id)) ? 'database' : (canvasIds.has(f.id) ? 'canvas' : 'note');

  return (
    <div className="hm" role="region" aria-labelledby="hm-greet">
      <div className="hm-inner">
        <header className="hm-head">
          <div>
            <div className="hm-date">{dateLabel}{vaultName ? ` · ${vaultName}` : ''}</div>
            <h1 className="hm-greet" id="hm-greet">{greeting(now.getHours())}</h1>
          </div>
          {!readOnly && (
            <div className="hm-quick" role="group" aria-label={t('home.create')}>
              <button type="button" className="hm-qa" onClick={() => A.newNote()}><Icon name="note" size={15} stroke={1.8} />{t('home.qa.note')}</button>
              <button type="button" className="hm-qa" onClick={() => A.newDatabase()}><Icon name="database" size={15} stroke={1.8} />{t('home.qa.database')}</button>
              <button type="button" className="hm-qa" aria-haspopup="menu"
                onClick={(e) => setTplMenu(e.currentTarget.getBoundingClientRect())}>{t('home.qa.template')}</button>
            </div>
          )}
        </header>

        {!syncServer && syncCardOpen && (
          <aside className="hm-sync" aria-labelledby="hm-sync-h">
            <div className="hm-sync-text">
              <h2 className="hm-h3" id="hm-sync-h">{t('home.sync.title')}</h2>
              <p className="hm-sync-p">{t('home.sync.body')}</p>
            </div>
            <div className="hm-sync-btns">
              <button type="button" className="hm-qa" onClick={() => A.openSettings('sync')}>{t('home.sync.cta')}</button>
              <button type="button" className="hm-link" onClick={dismissSyncCard}>{t('home.sync.later')}</button>
            </div>
          </aside>
        )}

        <div className="hm-grid hm-grid-a">
          <section className="hm-today" aria-labelledby="hm-today-h">
            <div className="hm-row">
              <h2 className="hm-h3" id="hm-today-h">{t('home.todayNote')}</h2>
              <button type="button" className="hm-link" onClick={() => A.openToday()}>{today ? t('home.open') : t('home.createToday')} →</button>
            </div>
            {today && today.preview
              ? <p className="hm-today-text">{today.preview}</p>
              : <p className="hm-today-text muted">{t('home.todayEmpty', { name: todayName })}</p>}
            {!readOnly && (
              <form className="hm-capture" onSubmit={(e) => { e.preventDefault(); submitCapture(); }}>
                <label className="sr-only" htmlFor="hm-capture-in">{t('home.captureLabel')}</label>
                <input id="hm-capture-in" type="text" value={capture} disabled={busy}
                  placeholder={t('home.capturePh')} onChange={(e) => setCapture(e.target.value)} />
                <span className="hm-enter" aria-hidden="true">↵</span>
              </form>
            )}
          </section>

          <section aria-labelledby="hm-next-h">
            <h2 className="hm-h3" id="hm-next-h">{t('home.next')}</h2>
            {upcoming.length === 0
              ? <p className="hm-empty">{t('home.nextEmpty')}</p>
              : (
                <div className="hm-list">
                  {upcoming.map(({ ev, ts }) => {
                    const note = ev.noteId ? notesById.get(ev.noteId) : null;
                    const when = dayWord(ts, locale);
                    const sub = ev.status === 'open'
                      ? `${when} · ${t('home.taskIn', { note: baseName(note && note.name) || '—' })}`
                      : (ev.allDay ? when : `${when} · ${timeLabel(ts, locale)}`);
                    return (
                      <button type="button" key={ev.id} className="hm-event"
                        onClick={() => (ev.noteId ? A.jumpTo(ev.noteId, ev.anchor && ev.anchor.snippet) : A.openCalendar())}>
                        <span className={`hm-bar k-${ev.status === 'open' ? 'task' : ev.kind}`} aria-hidden="true" />
                        <span className="hm-event-text">{ev.title}<span className="hm-sub">{sub}</span></span>
                      </button>
                    );
                  })}
                </div>
              )}
          </section>
        </div>

        <section aria-labelledby="hm-rec-h">
          <h2 className="hm-h3" id="hm-rec-h">{t('home.recent')}</h2>
          {recents.length === 0
            ? <p className="hm-empty">{t('home.recentEmpty')}</p>
            : (
              <div className="hm-cards">
                {recents.map(f => {
                  const kind = kindOf(f);
                  const tone = CARD_TONES[kind];
                  const st = (fileStats || {})[f.id] || {};
                  const aiAt = aiEditedAt.get(f.id) || 0;
                  const sub = aiAt > (st.t || 0)
                    ? t('home.editedByAi', { when: relTime(aiAt) })
                    : `${kind === 'canvas' ? t('view.badge.canvas') + ' · ' : kind === 'database' ? t('home.qa.database') + ' · ' : ''}${relTime(st.t)}`;
                  return (
                    <button type="button" key={f.id} className={`hm-card${f.cover ? ' has-cover' : ''}`} onClick={() => A.openNote(f.id)}>
                      <span className="hm-card-cover" aria-hidden="true" style={f.cover ? { background: coverCss(f.cover) } : undefined} />
                      <span className="hm-card-ic" style={{ background: tone.bg, color: tone.fg }}>
                        {f.icon ? <span className="hm-card-emoji">{f.icon}</span> : <Icon name={tone.icon} size={15} stroke={1.9} />}
                      </span>
                      <span className="hm-card-title">{baseName(f.name)}</span>
                      <span className="hm-sub">{sub}</span>
                    </button>
                  );
                })}
              </div>
            )}
        </section>

        <div className="hm-grid hm-grid-b">
          <section aria-labelledby="hm-tasks-h">
            <h2 className="hm-h3" id="hm-tasks-h">{t('home.tasks')}</h2>
            {tasks.length === 0
              ? <p className="hm-empty">{t('home.tasksEmpty')}</p>
              : (
                <ul className="hm-tasks">
                  {tasks.map(({ ev, ts }) => (
                    <li key={ev.id}>
                      <label className="hm-task">
                        <input type="checkbox" disabled={readOnly} onChange={() => A.completeTask(ev)} />
                        <span className="hm-task-title">{ev.title}</span>
                        <span className="hm-sub">{Number.isFinite(ts) ? dayWord(ts, locale) : t('home.noDate')}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </div>
      </div>
      {tplMenu && (
        <Menu anchor={tplMenu} align="end" minWidth={240} label={t('home.qa.template')} onClose={() => setTplMenu(null)}
          items={templates.length
            ? templates.map(tp => ({ label: baseName(tp.name), icon: 'template', onSelect: () => A.applyTemplate(tp) }))
            : [{ label: t('tpl.empty'), disabled: true }, { label: t('tpl.seed'), icon: 'template', onSelect: () => A.seedTemplates() }]} />
      )}
    </div>
  );
});
