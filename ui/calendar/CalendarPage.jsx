// Página Calendario (sustituye al modal F1). Se pinta en el área principal
// del shell cuando routeView === 'calendar'.
//
//   ┌ columna ────────┬ cabecera: rango · ‹ Hoy › · alta rápida · vista ┬ día ──────────┐
//   │ Nuevo evento    │ Día / Semana (rejilla horaria) · Mes · Agenda    │ Nota del día  │
//   │ mini mes        │                                                  │ Vence pronto  │
//   │ Calendarios     │                                                  │ Avisos        │
//   │ Sin fecha       │                                                  │               │
//   └─────────────────┴──────────────────────────────────────────────────┴───────────────┘
//
// Fuentes (store.js getVaultEvents, de TODOS los vaults accesibles):
//   · vault:<id> — eventos manuales (yEvents del vault): editables.
//   · tasks      — tokens 📅/⏰/@due de las notas: se mueven reescribiendo el
//                  token en el texto de la nota (onWriteNote → applyTextDiff).
//   · google     — Google Calendar sincronizado: solo lectura.

import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { t, useI18n, getLang } from '../../i18n.js';
import {
  getVaultEvents, addEvent, updateEvent, deleteEvent, getVaultDoc,
  expandOccurrences, normalizeRecurrence, getContent, getContentString,
} from '../../store.js';
import { findDailyNote } from '../shared/daily.js';
import { CIcon } from './icons.jsx';
import { EventPopover } from './EventPopover.jsx';
import { TimeGrid, MonthView, AgendaView, HOUR_PX } from './Views.jsx';
import { parseQuickAdd } from './nlparse.js';
import {
  ymd, hhmm, localIso, parseWhen, startOfDay, startOfWeek, weekOffset, dowIndex, addDays, sameDay, minutesOf, DAY_MS,
  names, rangeLabel, eventDurationMs, loadPrefs, savePrefs, calKeyOf,
  VAULT_COLORS, TASKS_COLOR, GOOGLE_COLOR, SWATCHES,
  rewriteInlineToken, toggleTaskAt, appendDateToken, undatedTasksIn, notePreview,
} from './model.js';

const VIEWS = ['day', 'week', 'month', 'agenda'];
const VIEW_KEYS = { d: 'day', w: 'week', m: 'month', a: 'agenda' };
const SNAP = 15;
const snap = (min) => Math.round(min / SNAP) * SNAP;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stripExt = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');
const rectOf = (el) => {
  if (!el || !el.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
};
const minToHm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayFromKey = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));

// Destino bajo el puntero (columna horaria, fila «todo el día» o celda de mes).
function hitTest(x, y) {
  const el = document.elementFromPoint(x, y);
  const drop = el && el.closest ? el.closest('[data-cal-drop]') : null;
  if (!drop) return null;
  const kind = drop.getAttribute('data-cal-drop');
  const day = dayFromKey(drop.getAttribute('data-day'));
  if (kind === 'time') {
    const r = drop.getBoundingClientRect();
    return { kind, day, min: clamp((y - r.top) / HOUR_PX * 60, 0, 1440 - SNAP), el: drop };
  }
  return { kind, day, el: drop };
}

const RECUR_DEFAULTS = { rfreq: 'none', rinterval: 1, rend: 'never', runtil: '', rcount: 10, rdays: [] };

function recurFromDraft(d) {
  if (!d.rfreq || d.rfreq === 'none') return null;
  return normalizeRecurrence({
    freq: d.rfreq,
    interval: d.rinterval,
    until: d.rend === 'until' ? (d.runtil || null) : null,
    count: d.rend === 'count' ? Number(d.rcount) : null,
    byWeekday: d.rfreq === 'weekly' && d.rdays && d.rdays.length ? d.rdays : null,
  });
}
function recurLabel(r) {
  if (!r) return '';
  let s = t('cal.repeat.' + r.freq);
  if (r.interval > 1) s = `${t('cal.repeat.every')} ${r.interval} ${t('cal.repeat.unit.' + r.freq)}`;
  if (r.byWeekday && r.byWeekday.length) s += ' · ' + r.byWeekday.map(i => names.dowShort(i)).join(', ');
  return s;
}
const offsetLabel = (n) => {
  if (n === 0) return t('calp.alerts.at');
  if (n >= 1440 && n % 1440 === 0) return t('calp.alerts.before', { n: `${n / 1440} d` });
  if (n >= 60 && n % 60 === 0) return t('calp.alerts.before', { n: `${n / 60} h` });
  return t('calp.alerts.before', { n: `${n} min` });
};

// ── Columna izquierda: mini mes ─────────────────────────────────────────
const MiniMonth = memo(function MiniMonth({ month, setMonth, today, selected, rangeStart, rangeEnd, busyDays, onPick }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -weekOffset(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const label = `${names.month(month.getMonth())} ${month.getFullYear()}`;
  return (
    <section className="cp-mini" aria-label={label}>
      <div className="cp-mini-head">
        <span>{label}</span>
        <span className="cp-mini-nav">
          <button type="button" className="cp-icon-btn sm" aria-label={t('calp.mini.prev')}
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><CIcon name="chevLeft" size={15} stroke={2} /></button>
          <button type="button" className="cp-icon-btn sm" aria-label={t('calp.mini.next')}
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><CIcon name="chevRight" size={15} stroke={2} /></button>
        </span>
      </div>
      <div className="cp-mini-grid cp-mini-dows" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => <span key={i}>{names.dowNarrow(dowIndex(i))}</span>)}
      </div>
      <div className="cp-mini-grid" role="grid">
        {cells.map((d) => {
          const out = d.getMonth() !== month.getMonth();
          const inRange = rangeStart && d >= rangeStart && d < rangeEnd;
          const isToday = sameDay(d, today);
          const isSel = selected && sameDay(d, selected);
          return (
            <button type="button" key={ymd(d)} role="gridcell"
              className={`cp-mm${out ? ' out' : ''}${inRange ? ' range' : ''}${isToday ? ' today' : ''}${isSel ? ' sel' : ''}${busyDays.has(ymd(d)) ? ' busy' : ''}`}
              aria-label={names.full(d)} aria-selected={!!isSel} onClick={() => onPick(d)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
});

export const CalendarPage = memo(function CalendarPage({
  vaults, vaultIds, activeVault, version, notes, readOnly,
  initialDraft, onDraftConsumed,
  onJump, onOpenDaily, onWriteNote, onOpenSettings, onOpenExternal,
}) {
  useI18n();
  const [prefs, setPrefsRaw] = useState(loadPrefs);
  const setPrefs = useCallback((fn) => setPrefsRaw(p => { const n = typeof fn === 'function' ? fn(p) : fn; savePrefs(n); return n; }), []);
  const view = VIEWS.includes(prefs.view) ? prefs.view : 'week';
  const setView = useCallback((v) => setPrefs(p => ({ ...p, view: v })), [setPrefs]);
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [miniMonth, setMiniMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [now, setNow] = useState(() => new Date());
  const [agendaDays, setAgendaDays] = useState(42);
  const [pop, setPop] = useState(null);           // { anchor }
  const [draft, setDraft] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [floatChip, setFloatChip] = useState(null); // tarea «Sin fecha» arrastrándose
  const [quick, setQuick] = useState('');
  const [quickFocus, setQuickFocus] = useState(false);
  const [toast, setToast] = useState(null);
  const [trayAll, setTrayAll] = useState(false);
  const [colorFor, setColorFor] = useState(null);
  const [optsOpen, setOptsOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);   // columnas como capa en anchos estrechos
  const [dayOpen, setDayOpen] = useState(false);
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const quickRef = useRef(null);
  const dragRef = useRef(null);
  const moreAtRef = useRef(0);
  const today = startOfDay(now);
  const loadMoreAgenda = useCallback(() => {
    const ts = Date.now();
    if (ts - moreAtRef.current < 400) return;
    moreAtRef.current = ts;
    setAgendaDays(n => Math.min(3650, n + 42));
  }, []);

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { const id = setTimeout(() => { try { rootRef.current && rootRef.current.focus({ preventScroll: true }); } catch {} }, 30); return () => clearTimeout(id); }, []);
  useEffect(() => { setMiniMonth(new Date(cursor.getFullYear(), cursor.getMonth(), 1)); }, [cursor.getFullYear(), cursor.getMonth()]);
  const flash = useCallback((text, undo) => {
    setToast({ text, undo, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.undo ? 6000 : 3200);
    return () => clearTimeout(id);
  }, [toast]);

  // ── Calendarios ───────────────────────────────────────────────────────
  const vaultCals = useMemo(() => {
    const ids = [];
    const seen = new Set();
    for (const v of vaults || []) if (v && v.id && !seen.has(v.id)) { seen.add(v.id); ids.push(v.id); }
    for (const id of vaultIds || []) if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    return ids.map((id, i) => {
      const v = (vaults || []).find(x => x.id === id);
      return { key: `vault:${id}`, vid: id, name: (v && v.name) || id, color: prefs.colors[`vault:${id}`] || VAULT_COLORS[i % VAULT_COLORS.length] };
    });
  }, [vaults, vaultIds, prefs.colors]);
  const calColor = useCallback((key) => {
    if (prefs.colors[key]) return prefs.colors[key];
    if (key === 'tasks') return TASKS_COLOR;
    if (key === 'google') return GOOGLE_COLOR;
    const c = vaultCals.find(x => x.key === key);
    return c ? c.color : VAULT_COLORS[0];
  }, [prefs.colors, vaultCals]);
  const calName = useCallback((key) => {
    if (key === 'tasks') return t('calp.cal.tasks');
    if (key === 'google') return t('calp.cal.google');
    const c = vaultCals.find(x => x.key === key);
    return c ? c.name : key;
  }, [vaultCals]);
  const defaultCal = vaultCals.some(c => c.vid === activeVault) ? `vault:${activeVault}` : (vaultCals[0] ? vaultCals[0].key : `vault:${activeVault}`);

  // ── Eventos de todos los vaults ───────────────────────────────────────
  const allEvents = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const vid of vaultIds || []) {
      let evs;
      try { evs = getVaultEvents(vid); } catch { continue; }
      for (const ev of evs) {
        if (!ev || !ev.start) continue;
        // Recordatorios descartados: fuera (como el calendario anterior). Un
        // EVENTO con aviso descartado sigue en su sitio.
        if (ev.kind === 'reminder' && ev.dismissed) continue;
        const k = `${vid}|${ev.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const e2 = { ...ev, _vid: vid, _key: k };
        e2._cal = calKeyOf(e2);
        out.push(e2);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultIds, version]);
  const hasGoogle = useMemo(() => allEvents.some(e => e._cal === 'google'), [allEvents]);
  const visibleEvents = useMemo(() => allEvents.filter(e => !prefs.hidden[e._cal]), [allEvents, prefs.hidden]);

  const instancesIn = useCallback((from, to) => {
    const out = [];
    const fromMs = from.getTime(), toMs = to.getTime();
    for (const ev of visibleEvents) {
      const base = parseWhen(ev.start);
      if (!base) continue;
      const dur = eventDurationMs(ev);
      let starts;
      if (ev.recurrence && ev.recurrence.freq) {
        try { starts = expandOccurrences(ev, fromMs - Math.max(dur, 1), toMs); } catch { starts = []; }
      } else starts = [base];
      const manual = ev.source === 'manual';
      for (const s of starts) {
        const e = new Date(s.getTime() + dur);
        if (!(s.getTime() < toMs && e.getTime() > fromMs)) continue;
        out.push({
          key: `${ev._key}@${s.getTime()}`, ev, s, e, allDay: !!ev.allDay, cal: ev._cal,
          color: ev.color || calColor(ev._cal),
          movable: !readOnly && (manual || ev.source === 'inline'),
          resizable: !readOnly && manual && !ev.allDay,
        });
      }
    }
    return out;
  }, [visibleEvents, calColor, readOnly]);

  // Rango visible
  const range = useMemo(() => {
    if (view === 'day') return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 1) };
    if (view === 'week') { const s = startOfWeek(cursor); return { from: s, to: addDays(s, 7) }; }
    if (view === 'month') {
      const f = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const s = addDays(f, -weekOffset(f));
      return { from: s, to: addDays(s, 42) };
    }
    return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), agendaDays) };
  }, [view, cursor, agendaDays]);
  const insts = useMemo(() => instancesIn(range.from, range.to), [instancesIn, range]);
  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(cursor)];
    if (view === 'week') { const s = startOfWeek(cursor); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
    return [];
  }, [view, cursor]);

  // Días con algo en el mini mes (puntito)
  const busyDays = useMemo(() => {
    const f = new Date(miniMonth.getFullYear(), miniMonth.getMonth(), 1);
    const s = addDays(f, -weekOffset(f));
    const set = new Set();
    for (const inst of instancesIn(s, addDays(s, 42))) set.add(ymd(inst.s));
    return set;
  }, [instancesIn, miniMonth]);

  // Desplaza la rejilla a la hora de inicio (o a «ahora» si queda fuera).
  const startHour = clamp(Number(prefs.startHour) || 0, 0, 20);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || (view !== 'week' && view !== 'day')) return;
    const visH = el.clientHeight / HOUR_PX;
    let h = startHour;
    const nowH = now.getHours() + now.getMinutes() / 60;
    const showsToday = days.some(d => sameDay(d, now));
    if (showsToday && (nowH < startHour || nowH > startHour + visH - 1)) h = Math.max(0, nowH - 2);
    el.scrollTop = h * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, startHour]);

  // ── Navegación ───────────────────────────────────────────────────────
  const go = useCallback((dir) => {
    setCursor(c => {
      if (view === 'day') return addDays(c, dir);
      if (view === 'week') return addDays(c, 7 * dir);
      if (view === 'month') return new Date(c.getFullYear(), c.getMonth() + dir, 1);
      return addDays(c, 7 * dir);
    });
  }, [view]);
  const goToday = useCallback(() => { const d = startOfDay(new Date()); setCursor(d); setSelected(d); }, []);
  const selectDay = useCallback((d) => { setSelected(startOfDay(d)); }, []);
  const openDay = useCallback((d) => { setCursor(startOfDay(d)); setSelected(startOfDay(d)); setView('day'); }, [setView]);
  const pickMini = useCallback((d) => {
    const s = startOfDay(d);
    setSelected(s);
    setCursor(s);
  }, []);

  // ── Borradores del popover ───────────────────────────────────────────
  const newDraft = useCallback((over) => ({
    mode: 'new', source: 'manual', id: null, calKey: defaultCal, origCalKey: null,
    kind: 'event', title: '', date: ymd(selected), time: '', endDate: '', endTime: '', allDay: true,
    ...RECUR_DEFAULTS, location: '', description: '', color: '', reminderOffset: '',
    noteId: null, anchor: null, status: null, htmlLink: null,
    ...over,
  }), [defaultCal, selected]);

  const draftFromInst = useCallback((inst) => {
    const ev = inst.ev;
    const base = ev.source === 'inline' ? parseWhen(ev.start) : (parseWhen(ev.start) || inst.s);
    const dur = eventDurationMs(ev);
    const endD = new Date(base.getTime() + dur);
    const r = normalizeRecurrence(ev.recurrence);
    let off = ev.reminderOffset;
    if (off == null && ev.kind === 'reminder' && ev.remindAt && ev.source === 'manual') {
      const ra = parseWhen(ev.remindAt);
      const d = ra ? Math.round((base - ra) / 60000) : 0;
      if (d > 0) off = d;
    }
    return {
      mode: 'edit', source: ev.source, id: ev.id, vid: ev._vid,
      calKey: ev.source === 'manual' ? `vault:${ev._vid}` : ev._cal, origCalKey: ev.source === 'manual' ? `vault:${ev._vid}` : ev._cal,
      kind: ev.kind || 'event', title: ev.title || '',
      date: ymd(base), time: ev.allDay ? '' : hhmm(base),
      endDate: ev.allDay ? ymd(addDays(startOfDay(endD), -1)) : ymd(endD),
      endTime: ev.allDay || ev.source === 'inline' ? '' : hhmm(endD),
      allDay: !!ev.allDay,
      rfreq: r ? r.freq : 'none', rinterval: r ? r.interval : 1,
      rend: r ? (r.until ? 'until' : (r.count ? 'count' : 'never')) : 'never',
      runtil: r && r.until ? r.until : '', rcount: r && r.count ? r.count : 10, rdays: r && r.byWeekday ? r.byWeekday : [],
      location: ev.location || '', description: ev.description || '', color: ev.color || '',
      reminderOffset: off == null ? '' : String(off),
      noteId: ev.noteId || null, anchor: ev.anchor || null, status: ev.status || null, htmlLink: ev.htmlLink || null,
      instKey: inst.key, inlineEv: ev.source === 'inline' ? ev : null,
    };
  }, []);

  const openPopover = useCallback((d, anchor) => {
    setDraft(d);
    setPop({ anchor: anchor || null });
  }, []);
  const closePopover = useCallback(() => { setPop(null); setDraft(null); setGhost(null); }, []);

  // Borrador entrante (p. ej. «recordatorio con la selección» del editor).
  useEffect(() => {
    if (!initialDraft) return;
    const d0 = initialDraft;
    const time = d0.time || '';
    let endTime = '';
    if (time && d0.kind !== 'reminder') { const [h, m] = time.split(':').map(Number); endTime = minToHm(Math.min(23 * 60 + 45, h * 60 + m + 60)); }
    const dd = newDraft({
      title: d0.title || '', date: d0.date || ymd(new Date()), time, endTime, endDate: d0.date || '',
      allDay: !time, kind: d0.kind || 'event', noteId: d0.noteId || null, anchor: d0.anchor || null,
      calKey: d0.vaultId ? `vault:${d0.vaultId}` : defaultCal,
    });
    const day = parseWhen(dd.date);
    if (day) { setCursor(startOfDay(day)); setSelected(startOfDay(day)); }
    openPopover(dd, null);
    onDraftConsumed && onDraftConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);

  // ── Escritura ────────────────────────────────────────────────────────
  const writeNote = useCallback((noteId, fn) => {
    if (!noteId) return false;
    let src;
    try { src = getContent(noteId).toString(); } catch { src = getContentString(noteId) || ''; }
    const next = fn(src);
    if (typeof next !== 'string') { flash(t('calp.toast.noteFail')); return false; }
    onWriteNote(noteId, next);
    return true;
  }, [onWriteNote, flash]);

  const remindAtFor = (kind, start, offset) => {
    if (kind !== 'reminder') return null;
    if (offset == null || !Number.isFinite(offset) || offset <= 0) return start;
    const s = parseWhen(start);
    return s ? localIso(new Date(s.getTime() - offset * 60000)) : start;
  };

  const saveDraft = useCallback(() => {
    const d = draft;
    if (!d || readOnly) return;
    if (d.source === 'google') { closePopover(); return; }
    if (d.source === 'inline') {
      const ns = d.allDay ? d.date : `${d.date}T${d.time || '09:00'}`;
      if (ns !== d.inlineEv.start) writeNote(d.noteId, (src) => rewriteInlineToken(src, d.inlineEv, ns));
      closePopover();
      return;
    }
    const start = d.allDay ? d.date : `${d.date}T${d.time || '09:00'}`;
    let end = null;
    if (d.allDay) {
      if (d.endDate && d.endDate > d.date) end = ymd(addDays(parseWhen(d.endDate), 1));
    } else if (d.endTime) {
      let ed = parseWhen(`${d.date}T${d.endTime}`);
      if (ed <= parseWhen(start)) ed = addDays(ed, 1);
      end = localIso(ed);
    }
    const offset = d.reminderOffset === '' || d.reminderOffset == null ? null : Number(d.reminderOffset);
    const rec = {
      kind: d.kind || 'event',
      title: (d.title || '').trim() || t('calp.untitled'),
      start, end, allDay: !!d.allDay,
      remindAt: remindAtFor(d.kind, start, offset),
      recurrence: recurFromDraft(d),
      noteId: d.noteId || null,
      anchor: d.noteId ? (d.anchor || null) : null,
      location: (d.location || '').trim() || null,
      description: (d.description || '').trim() || null,
      color: d.color || null,
      reminderOffset: offset,
      calendarId: d.calKey,
    };
    const vid = String(d.calKey || defaultCal).replace(/^vault:/, '');
    if (d.mode === 'edit' && d.id) {
      const oldVid = d.vid;
      const map = getVaultDoc(oldVid) && getVaultDoc(oldVid).yEvents;
      const raw = map ? map.get(d.id) : null;
      const moved = raw && raw.start !== start;
      const patch = moved ? { ...rec, dismissed: false, snoozedUntil: null } : rec;
      if (oldVid && vid !== oldVid) {
        // Cambio de calendario = cambio de vault: el registro se muda de mapa.
        addEvent(vid, { ...(raw || {}), ...patch, id: d.id });
        deleteEvent(oldVid, d.id);
      } else updateEvent(vid, d.id, patch);
    } else {
      addEvent(vid, rec);
      const day = parseWhen(start);
      if (day && !(day >= range.from && day < range.to)) setCursor(startOfDay(day));
    }
    closePopover();
  }, [draft, readOnly, closePopover, writeNote, defaultCal, range]);

  const deleteDraft = useCallback(() => {
    const d = draft;
    if (!d || !d.id || readOnly || d.source !== 'manual') return;
    const map = getVaultDoc(d.vid) && getVaultDoc(d.vid).yEvents;
    const raw = map ? map.get(d.id) : null;
    deleteEvent(d.vid, d.id);
    closePopover();
    if (raw) flash(t('calp.toast.deleted'), () => addEvent(d.vid, raw));
  }, [draft, readOnly, closePopover, flash]);

  const toggleTask = useCallback((ev, done) => {
    if (readOnly || !ev || !ev.noteId) return;
    writeNote(ev.noteId, (src) => toggleTaskAt(src, ev.anchor, done));
  }, [readOnly, writeNote]);

  // Mover / redimensionar (instancia → serie: se desplaza el ancla).
  const commitMove = useCallback((inst, newS, newAllDay) => {
    const ev = inst.ev;
    if (ev.source === 'google' || readOnly) return;
    let start;
    if (newAllDay) start = ymd(newS);
    else start = localIso(newS);
    if (ev.source === 'inline') {
      const ok = writeNote(ev.noteId, (src) => rewriteInlineToken(src, ev, start));
      if (ok) flash(t('calp.toast.moved', { when: newAllDay ? names.fullShort(newS) : `${names.fullShort(newS)} ${hhmm(newS)}` }));
      return;
    }
    const base = parseWhen(ev.start);
    const dur = eventDurationMs(ev);
    const delta = newS.getTime() - inst.s.getTime();
    let end = null;
    if (newAllDay) {
      const dd = Math.round((startOfDay(newS) - startOfDay(inst.s)) / DAY_MS);
      const nb = addDays(startOfDay(base), dd);
      start = ymd(nb);
      const nDays = ev.allDay ? Math.max(1, Math.round(dur / DAY_MS)) : 1;
      end = nDays > 1 ? ymd(addDays(nb, nDays)) : null;
    } else {
      let nb;
      let d2 = dur;
      if (ev.allDay) {
        const dd = Math.round((startOfDay(newS) - startOfDay(inst.s)) / DAY_MS);
        const day = addDays(startOfDay(base), dd);
        nb = new Date(day.getFullYear(), day.getMonth(), day.getDate(), newS.getHours(), newS.getMinutes());
        d2 = 60 * 60000;
      } else nb = new Date(base.getTime() + delta);
      start = localIso(nb);
      end = localIso(new Date(nb.getTime() + d2));
    }
    const off = Number.isFinite(ev.reminderOffset) ? ev.reminderOffset : null;
    const patch = { start, end, allDay: !!newAllDay, dismissed: false, snoozedUntil: null };
    if (ev.kind === 'reminder') patch.remindAt = remindAtFor('reminder', start, off);
    updateEvent(ev._vid, ev.id, patch);
  }, [readOnly, writeNote, flash]);

  const commitResize = useCallback((inst, newEnd) => {
    const ev = inst.ev;
    if (ev.source !== 'manual' || readOnly) return;
    const base = parseWhen(ev.start);
    const dur = Math.max(SNAP * 60000, newEnd.getTime() - inst.s.getTime());
    updateEvent(ev._vid, ev.id, { end: localIso(new Date(base.getTime() + dur)) });
  }, [readOnly]);

  // ── Gestos de puntero ────────────────────────────────────────────────
  const scrollNear = (y) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (y < r.top + 28 && y > r.top - 40) el.scrollTop -= 14;
    else if (y > r.bottom - 28 && y < r.bottom + 40) el.scrollTop += 14;
  };

  const ghostFor = (dr, hit) => {
    if (!hit) return null;
    if (dr.type === 'task') {
      const label = dr.task.title;
      if (hit.kind === 'time') { const s = snap(hit.min); return { kind: 'time', day: ymd(hit.day), s, e: Math.min(1440, s + 60), label, time: `${minToHm(s)}`, color: TASKS_COLOR, target: { day: hit.day, min: s, allDay: false } }; }
      return { kind: hit.kind, day: ymd(hit.day), label, color: TASKS_COLOR, target: { day: hit.day, allDay: true } };
    }
    const inst = dr.inst;
    const label = inst.ev.title || t('calp.untitled');
    const durMin = Math.round((inst.e - inst.s) / 60000);
    if (dr.type === 'resize') {
      if (hit.kind !== 'time' || !sameDay(hit.day, inst.s)) {
        const eMin = dr.lastEnd != null ? dr.lastEnd : minutesOf(inst.e);
        return { kind: 'time', day: ymd(inst.s), s: minutesOf(inst.s), e: eMin, label, time: `${hhmm(inst.s)} – ${minToHm(eMin)}`, color: inst.color, target: { end: dr.lastEndDate || inst.e } };
      }
      const sMin = minutesOf(inst.s);
      const eMin = Math.max(sMin + SNAP, snap(hit.min + SNAP / 2));
      dr.lastEnd = eMin;
      const endD = new Date(inst.s.getFullYear(), inst.s.getMonth(), inst.s.getDate(), 0, eMin);
      dr.lastEndDate = endD;
      return { kind: 'time', day: ymd(inst.s), s: sMin, e: eMin, label, time: `${hhmm(inst.s)} – ${minToHm(eMin)}`, color: inst.color, target: { end: endD } };
    }
    // move
    const o = dr.origin;
    if (hit.kind === 'time') {
      let newS;
      if (o && o.kind === 'time') {
        const t0 = o.day.getTime() + o.min * 60000;
        const t1 = hit.day.getTime() + hit.min * 60000;
        newS = new Date(inst.s.getTime() + snap((t1 - t0) / 60000) * 60000);
      } else {
        const m = snap(hit.min);
        newS = new Date(hit.day.getFullYear(), hit.day.getMonth(), hit.day.getDate(), 0, m);
      }
      const dm = inst.allDay ? 60 : (inst.ev.source === 'inline' ? 30 : durMin);
      const s = minutesOf(newS);
      return { kind: 'time', day: ymd(newS), s, e: Math.min(1440, s + dm), label, time: `${hhmm(newS)} – ${minToHm(Math.min(1439, s + dm))}`, color: inst.color, target: { start: newS, allDay: false } };
    }
    // allday / month
    const oDay = o ? o.day : startOfDay(inst.s);
    const dd = Math.round((startOfDay(hit.day) - startOfDay(oDay)) / DAY_MS);
    const newS = hit.kind === 'allday'
      ? (o && o.kind === 'time' ? startOfDay(hit.day) : addDays(inst.s, dd))
      : addDays(inst.s, dd);
    const allDay = hit.kind === 'allday' ? true : inst.allDay;
    return { kind: hit.kind, day: ymd(newS), label, color: inst.color, target: { start: allDay ? startOfDay(newS) : newS, allDay } };
  };

  const endDrag = useCallback(() => {
    const dr = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('pointermove', dr && dr.onMove);
    window.removeEventListener('pointerup', dr && dr.onUp);
    window.removeEventListener('pointercancel', dr && dr.onCancel);
    document.body.classList.remove('cp-dragging');
    setDragKey(null);
    setFloatChip(null);
  }, []);

  const beginDrag = useCallback((dr, e) => {
    if (dragRef.current) endDrag();
    dr.x0 = e.clientX; dr.y0 = e.clientY; dr.started = false;
    dr.onMove = (ev) => {
      if (!dr.started) {
        if (Math.abs(ev.clientX - dr.x0) + Math.abs(ev.clientY - dr.y0) < 5) return;
        dr.started = true;
        document.body.classList.add('cp-dragging');
        if (dr.inst) setDragKey(dr.inst.key);
      }
      if (dr.type === 'noop') return;
      if (dr.type === 'task') setFloatChip({ x: ev.clientX, y: ev.clientY, title: dr.task.title });
      scrollNear(ev.clientY);
      if (dr.type === 'create') {
        const r = dr.col.getBoundingClientRect();
        const m1 = snap(clamp((ev.clientY - r.top) / HOUR_PX * 60, 0, 1440));
        const s = Math.min(dr.m0, m1), en = Math.max(dr.m0 + SNAP, m1);
        dr.range = { s, e: Math.max(en, s + SNAP) };
        setGhost({ kind: 'time', day: ymd(dr.day), s: dr.range.s, e: dr.range.e, label: t('calp.pop.new'), time: `${minToHm(dr.range.s)} – ${minToHm(dr.range.e % 1440)}`, color: calColor(defaultCal) });
        return;
      }
      const hit = hitTest(ev.clientX, ev.clientY);
      const g = ghostFor(dr, hit);
      dr.ghost = g;
      setGhost(g);
    };
    dr.onUp = (ev) => {
      const started = dr.started;
      endDrag();
      if (!started) { setGhost(null); dr.onClick && dr.onClick(ev); return; }
      if (dr.type === 'noop') return;
      if (dr.type === 'create') {
        const { s, e: en } = dr.range;
        const d = newDraft({ date: ymd(dr.day), time: minToHm(s), endTime: minToHm(en % 1440), endDate: ymd(dr.day), allDay: false });
        setGhost({ kind: 'time', day: ymd(dr.day), s, e: en, label: t('calp.pop.new'), time: `${minToHm(s)} – ${minToHm(en % 1440)}`, color: calColor(defaultCal), sticky: true });
        requestAnimationFrame(() => {
          const el = rootRef.current && rootRef.current.querySelector('.cp-ev.ghost');
          openPopover(d, rectOf(el));
          setGhost(null);
        });
        return;
      }
      const g = dr.ghost;
      setGhost(null);
      if (!g || !g.target) return;
      if (dr.type === 'task') {
        const tg = g.target;
        const start = tg.allDay ? ymd(tg.day) : `${ymd(tg.day)}T${minToHm(tg.min)}`;
        const ok = writeNote(dr.task.noteId, (src) => appendDateToken(src, dr.task.anchor, start));
        if (ok) flash(t('calp.toast.dated', { title: dr.task.title }));
        return;
      }
      if (dr.type === 'resize') { if (g.target.end) commitResize(dr.inst, g.target.end); return; }
      const tg = g.target;
      if (!tg.start) return;
      if (tg.start.getTime() === dr.inst.s.getTime() && !!tg.allDay === !!dr.inst.allDay) return;
      commitMove(dr.inst, tg.start, tg.allDay);
    };
    dr.onCancel = () => { endDrag(); setGhost(null); };
    dragRef.current = dr;
    window.addEventListener('pointermove', dr.onMove);
    window.addEventListener('pointerup', dr.onUp);
    window.addEventListener('pointercancel', dr.onCancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endDrag, newDraft, openPopover, calColor, defaultCal, writeNote, commitMove, commitResize, flash]);

  const onPointerDownEvent = useCallback((e, inst, mode) => {
    e.stopPropagation();
    const el = e.currentTarget.closest ? (e.currentTarget.closest('[data-ev-key]') || e.currentTarget) : e.currentTarget;
    const open = () => {
      if (pop && draft && draft.instKey === inst.key) { closePopover(); return; }
      setGhost(null);
      openPopover(draftFromInst(inst), rectOf(el));
    };
    if (mode === 'open' || e.type === 'keydown') { open(); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    if (!inst.movable || (mode === 'resize' && !inst.resizable)) {
      beginDrag({ type: 'noop', onClick: open }, e);
      return;
    }
    if (pop) { setPop(null); setDraft(null); }
    const origin = hitTest(e.clientX, e.clientY);
    beginDrag({ type: mode === 'resize' ? 'resize' : 'move', inst, origin, onClick: open }, e);
  }, [pop, draft, beginDrag, openPopover, closePopover, draftFromInst]);

  const onPointerDownGrid = useCallback((e, day, kind) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    if (pop) { closePopover(); return; }
    if (readOnly) { selectDay(day); return; }
    if (kind === 'allday') {
      const el = e.currentTarget;
      beginDrag({ type: 'noop', onClick: () => { selectDay(day); openPopover(newDraft({ date: ymd(day), endDate: ymd(day), allDay: true }), rectOf(el)); } }, e);
      return;
    }
    e.preventDefault();
    const col = e.currentTarget;
    const r = col.getBoundingClientRect();
    const m0 = Math.floor(clamp((e.clientY - r.top) / HOUR_PX * 60, 0, 1440 - SNAP) / SNAP) * SNAP;
    beginDrag({
      type: 'create', col, day, m0, range: { s: m0, e: m0 + 60 },
      onClick: () => {
        selectDay(day);
        const en = Math.min(1440, m0 + 60);
        setGhost({ kind: 'time', day: ymd(day), s: m0, e: en, label: t('calp.pop.new'), time: `${minToHm(m0)} – ${minToHm(en % 1440)}`, color: calColor(defaultCal), sticky: true });
        requestAnimationFrame(() => {
          const el = rootRef.current && rootRef.current.querySelector('.cp-ev.ghost');
          openPopover(newDraft({ date: ymd(day), time: minToHm(m0), endTime: minToHm(en % 1440), endDate: ymd(day), allDay: false }), rectOf(el));
          setGhost(null);
        });
      },
    }, e);
  }, [pop, readOnly, closePopover, beginDrag, selectDay, openPopover, newDraft, calColor, defaultCal]);

  const onCreateDay = useCallback((d, el) => {
    if (readOnly) return;
    selectDay(d);
    openPopover(newDraft({ date: ymd(d), endDate: ymd(d), allDay: true }), rectOf(el));
  }, [readOnly, selectDay, openPopover, newDraft]);

  useEffect(() => () => { if (dragRef.current) endDrag(); }, [endDrag]);

  // Clic fuera del popover → se cierra (las vistas cierran por su cuenta).
  useEffect(() => {
    if (!pop) return;
    const onDown = (e) => {
      const tg = e.target;
      if (!tg || !tg.closest) return;
      if (tg.closest('.cp-pop') || tg.closest('[data-ev-key]') || tg.closest('[data-cal-drop]') || tg.closest('.cp-quick')) return;
      closePopover();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [pop, closePopover]);

  // ── Alta rápida ──────────────────────────────────────────────────────
  const parsed = useMemo(() => {
    const q = quick.trim();
    if (!q) return null;
    return parseQuickAdd(q, { now: new Date(), lang: getLang(), calendars: vaultCals.map(c => ({ id: c.key, name: c.name })) });
  }, [quick, vaultCals]);
  const draftFromParsed = useCallback((p) => newDraft({
    title: p.title, date: p.date, time: p.time || '', endTime: p.endTime || '', endDate: p.endDate || p.date,
    allDay: p.allDay, kind: p.kind, location: p.location || '',
    calKey: p.calendarHint || defaultCal,
    ...(p.recurrence ? { rfreq: p.recurrence.freq, rinterval: p.recurrence.interval || 1, rdays: p.recurrence.byWeekday || [] } : {}),
  }), [newDraft, defaultCal]);
  const submitQuick = useCallback((edit) => {
    if (!parsed || readOnly) return;
    const d = draftFromParsed(parsed);
    if (edit) {
      openPopover(d, rectOf(quickRef.current));
      setQuick('');
      return;
    }
    const start = d.allDay ? d.date : `${d.date}T${d.time}`;
    let end = null;
    if (!d.allDay && d.endTime) end = `${d.endDate || d.date}T${d.endTime}`;
    else if (d.allDay && d.endDate && d.endDate > d.date) end = ymd(addDays(parseWhen(d.endDate), 1));
    const vid = String(d.calKey).replace(/^vault:/, '');
    addEvent(vid, {
      kind: d.kind, title: d.title || t('calp.untitled'), start, end, allDay: d.allDay,
      remindAt: d.kind === 'reminder' ? start : null, recurrence: recurFromDraft(d),
      noteId: null, anchor: null, location: d.location || null, calendarId: d.calKey,
    });
    const day = parseWhen(d.date);
    if (day) {
      if (!(day >= range.from && day < range.to)) setCursor(startOfDay(day));
      setSelected(startOfDay(day));
    }
    flash(t('calp.quick.created', { title: d.title || t('calp.untitled') }));
    setQuick('');
    // Plegado (anchos estrechos) se despliega encima de la cabecera: al crear,
    // se vuelve a plegar para no tapar la navegación.
    try {
      const wrap = quickRef.current && quickRef.current.parentElement;
      if (wrap && getComputedStyle(wrap).position === 'absolute') document.activeElement && document.activeElement.blur();
    } catch {}
  }, [parsed, readOnly, draftFromParsed, openPopover, range, flash]);

  // ── Teclado ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (pop) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          closePopover();
          return;
        }
        if (optsOpen || colorFor || sideOpen || dayOpen) {
          e.preventDefault(); e.stopImmediatePropagation();
          setOptsOpen(false); setColorFor(null); setSideOpen(false); setDayOpen(false);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target;
      const tag = (tg && tg.tagName) || '';
      if (/^(input|textarea|select)$/i.test(tag) || (tg && tg.isContentEditable)) return;
      if (pop || document.querySelector('.pal, [role="dialog"][aria-modal="true"]')) return;
      const k = e.key.toLowerCase();
      if (k === 't') { e.preventDefault(); goToday(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (VIEW_KEYS[k]) { e.preventDefault(); setView(VIEW_KEYS[k]); }
      else if (k === 'n' && !readOnly) {
        e.preventDefault();
        const nh = Math.min(23, new Date().getHours() + 1);
        openPopover(newDraft({ date: ymd(selected), endDate: ymd(selected), time: minToHm(nh * 60), endTime: minToHm(Math.min(23 * 60 + 45, nh * 60 + 60)), allDay: false }), null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pop, optsOpen, colorFor, sideOpen, dayOpen, closePopover, goToday, go, setView, readOnly, openPopover, newDraft, selected]);

  // ── «Sin fecha» ──────────────────────────────────────────────────────
  const undated = useMemo(() => {
    const out = [];
    for (const n of notes || []) {
      if (!n || !n.id || n.kind === 'database') continue;
      let txt;
      try { txt = getContentString(n.id); } catch { continue; }
      if (!txt || txt.indexOf('[ ]') < 0) continue;
      for (const row of undatedTasksIn(n.id, txt)) out.push({ ...row, noteName: stripExt(n.name) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, version]);
  const TRAY_CAP = 4;

  // ── Panel del día ────────────────────────────────────────────────────
  const noteName = useCallback((id) => { const n = (notes || []).find(x => x.id === id); return n ? stripExt(n.name) : ''; }, [notes]);
  const dailyFile = useMemo(() => findDailyNote(notes, selected), [notes, selected]);
  const dailyText = useMemo(() => {
    if (!dailyFile) return null;
    try { return notePreview(getContentString(dailyFile.id), 4); } catch { return ''; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyFile, version]);
  const dueSoon = useMemo(() => {
    const base = startOfDay(selected);
    const isToday = sameDay(base, today);
    const rows = [];
    const seen = new Set();
    for (const ev of allEvents) {
      if (ev.source !== 'inline' || ev.status !== 'open') continue;
      const s = parseWhen(ev.start);
      if (!s) continue;
      const dedupe = `${ev.noteId}|${ev.anchor && ev.anchor.line}`;
      if (seen.has(dedupe)) continue;
      if (s < base && !(isToday && s < today)) continue;
      seen.add(dedupe);
      rows.push({ ev, s, overdue: s < today });
    }
    rows.sort((a, b) => a.s - b.s);
    return rows.slice(0, 6);
  }, [allEvents, selected, today]);
  const alerts = useMemo(() => {
    const d0 = startOfDay(selected), d1 = addDays(d0, 1);
    return instancesIn(d0, d1)
      .filter(i => i.ev.kind === 'reminder' || i.ev.reminderOffset != null)
      .filter(i => i.s >= d0)
      .sort((a, b) => a.s - b.s);
  }, [instancesIn, selected]);

  // ── Render ───────────────────────────────────────────────────────────
  const navLabel = (dir) => t(`calp.${dir}.${view}`);
  const activeKey = pop && draft ? draft.instKey : null;
  // Mientras el popover de «nuevo» está abierto con hora, el hueco se ve.
  const shownGhost = ghost || (pop && draft && draft.mode === 'new' && !draft.allDay && draft.time ? (() => {
    const [h, m] = draft.time.split(':').map(Number);
    const s = h * 60 + m;
    let e = s + 60;
    if (draft.endTime) { const [h2, m2] = draft.endTime.split(':').map(Number); e = h2 * 60 + m2; if (e <= s) e = 1440; }
    return { kind: 'time', day: draft.date, s, e, label: draft.title || t('calp.pop.new'), time: `${draft.time} – ${draft.endTime || minToHm(e % 1440)}`, color: draft.color || calColor(draft.calKey) };
  })() : null);

  const sideCls = `cp-side${sideOpen ? ' open' : ''}`;
  const dayCls = `cp-day${dayOpen ? ' open' : ''}`;

  return (
    <div className="cp-wrap">
      <div className="cp" ref={rootRef} tabIndex={-1} aria-label={t('calp.title')} lang={getLang()}>
        {(sideOpen || dayOpen) && <div className="cp-scrim" onClick={() => { setSideOpen(false); setDayOpen(false); }} />}
        <aside className={sideCls} aria-label={t('calp.side.toggle')}>
          {!readOnly && (
            <button type="button" className="cp-newbtn" onClick={(e) => {
              const nh = Math.min(23, new Date().getHours() + 1);
              openPopover(newDraft({ date: ymd(selected), endDate: ymd(selected), time: minToHm(nh * 60), endTime: minToHm(Math.min(23 * 60 + 45, nh * 60 + 60)), allDay: false }), rectOf(e.currentTarget));
            }} title={t('calp.new') + ' (N)'}>
              <CIcon name="plus" size={15} stroke={2} />{t('calp.new')}
            </button>
          )}
          <MiniMonth month={miniMonth} setMonth={setMiniMonth} today={today} selected={selected}
            rangeStart={view === 'week' ? range.from : null} rangeEnd={view === 'week' ? range.to : null}
            busyDays={busyDays} onPick={pickMini} />

          <section className="cp-cals">
            <h3 className="cp-h3">{t('calp.calendars')}</h3>
            {[...vaultCals.map(c => ({ key: c.key, name: c.name })),
              { key: 'tasks', name: t('calp.cal.tasks'), meta: t('calp.cal.tasksMeta') },
              { key: 'google', name: t('calp.cal.google'), meta: hasGoogle ? null : t('calp.cal.googleOff'), off: !hasGoogle }]
              .map(c => (
                <div key={c.key} className="cp-cal">
                  <label className="cp-cal-label">
                    <input type="checkbox" checked={!prefs.hidden[c.key]} style={{ accentColor: calColor(c.key) }}
                      onChange={() => setPrefs(p => ({ ...p, hidden: { ...p.hidden, [c.key]: !p.hidden[c.key] } }))} />
                    <span className="cp-cal-name">{c.name}</span>
                  </label>
                  {c.meta && (c.off
                    ? <button type="button" className="cp-cal-meta cp-link" title={t('calp.cal.googleOffTip')} onClick={() => onOpenSettings && onOpenSettings('calendar')}>{c.meta}</button>
                    : <span className="cp-cal-meta">{c.meta}</span>)}
                  <button type="button" className="cp-cal-color" style={{ '--sw': calColor(c.key) }}
                    aria-label={t('calp.cal.color', { name: c.name })} aria-expanded={colorFor === c.key}
                    onClick={() => setColorFor(v => (v === c.key ? null : c.key))} />
                  {colorFor === c.key && (
                    <div className="cp-cal-swatches" role="radiogroup" aria-label={t('calp.cal.color', { name: c.name })}>
                      {SWATCHES.map(sw => (
                        <button key={sw} type="button" role="radio" aria-checked={calColor(c.key) === sw}
                          className={`cp-swatch${calColor(c.key) === sw ? ' on' : ''}`} style={{ '--sw': sw }} aria-label={sw}
                          onClick={() => { setPrefs(p => ({ ...p, colors: { ...p.colors, [c.key]: sw } })); setColorFor(null); }} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </section>

          <section className="cp-tray" aria-label={t('calp.undated')}>
            <h3 className="cp-h3">{t('calp.undated')}{undated.length > 0 && <span className="cp-count">{undated.length}</span>}</h3>
            {undated.length === 0 && <p className="cp-tray-empty">{t('calp.undated.empty')}</p>}
            <div className={`cp-tray-list${trayAll ? ' all' : ''}`}>
              {(trayAll ? undated : undated.slice(0, TRAY_CAP)).map(task => (
                <div key={task.id} className="cp-tray-item" role="button" tabIndex={0}
                  title={`${task.noteName} — ${t('calp.undated.dragTip')}`}
                  onKeyDown={(e) => { if (e.key === 'Enter') onJump(task.noteId, task.anchor.snippet); }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    if (readOnly) { beginDrag({ type: 'noop', onClick: () => onJump(task.noteId, task.anchor.snippet) }, e); return; }
                    beginDrag({ type: 'task', task, onClick: () => onJump(task.noteId, task.anchor.snippet) }, e);
                  }}>
                  <span className="cp-tray-title">{task.title}</span>
                  <span className="cp-tray-note">{task.noteName}</span>
                </div>
              ))}
            </div>
            {undated.length > TRAY_CAP && (
              <button type="button" className="cp-link cp-tray-more" onClick={() => setTrayAll(v => !v)}>
                {trayAll ? t('calp.undated.less') : t('calp.undated.all', { n: undated.length })}
              </button>
            )}
          </section>
        </aside>

        <main className="cp-main">
          <header className="cp-head">
            <button type="button" className="cp-icon-btn cp-narrow-only cp-side-toggle" onClick={() => setSideOpen(v => !v)}
              aria-label={t('calp.side.toggle')} aria-expanded={sideOpen}><CIcon name="sidebar" size={16} /></button>
            <h1 className="cp-range" aria-live="polite">{rangeLabel(view, cursor)}</h1>
            <div className="cp-nav">
              <button type="button" className="cp-nbtn sq" onClick={() => go(-1)} aria-label={navLabel('prev')} title={navLabel('prev') + ' (←)'}>
                <CIcon name="chevLeft" size={14} stroke={2} /></button>
              <button type="button" className="cp-nbtn" onClick={goToday} title={t('calp.today') + ' (T)'}>{t('calp.today')}</button>
              <button type="button" className="cp-nbtn sq" onClick={() => go(1)} aria-label={navLabel('next')} title={navLabel('next') + ' (→)'}>
                <CIcon name="chevRight" size={14} stroke={2} /></button>
            </div>
            {!readOnly && (
              <div className="cp-quick">
                <label className="cp-quick-box" ref={quickRef}>
                  <CIcon name="plus" size={14} stroke={2} />
                  <span className="sr-only">{t('calp.quick.label')}</span>
                  <input type="text" value={quick} placeholder={t('calp.quick.ph')}
                    onChange={(e) => setQuick(e.target.value)}
                    onFocus={() => setQuickFocus(true)} onBlur={() => setTimeout(() => setQuickFocus(false), 120)}
                    aria-describedby="cp-quick-preview"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); submitQuick(e.shiftKey); }
                      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (quick) setQuick(''); else e.currentTarget.blur(); }
                    }} />
                </label>
                {quickFocus && parsed && (
                  <div className="cp-quick-pop" id="cp-quick-preview" role="status">
                    <div className="cp-qp-title" style={{ '--ev': calColor(parsed.calendarHint || defaultCal) }}>
                      <span className="cp-qp-sw" aria-hidden="true" />
                      {parsed.kind === 'reminder' && <CIcon name="bell" size={13} />}
                      <span>{parsed.title || <em>{t('calp.untitled')}</em>}</span>
                    </div>
                    <div className="cp-qp-chips">
                      <span className="cp-qp-chip"><CIcon name="calendar" size={12} /> {names.fullShort(parseWhen(parsed.date))}</span>
                      <span className="cp-qp-chip"><CIcon name="clock" size={12} /> {parsed.allDay ? t('calp.allDayToggle') : `${parsed.time}${parsed.endTime ? ' – ' + parsed.endTime : ''}`}</span>
                      {parsed.recurrence && <span className="cp-qp-chip"><CIcon name="repeat" size={12} /> {recurLabel(parsed.recurrence)}</span>}
                      {parsed.location && <span className="cp-qp-chip"><CIcon name="mapPin" size={12} /> {parsed.location}</span>}
                      <span className="cp-qp-chip"><CIcon name="vault" size={12} /> {calName(parsed.calendarHint || defaultCal)}</span>
                    </div>
                    <div className="cp-qp-foot">
                      <span>{t('calp.quick.hint')}</span>
                      <button type="button" className="cp-link" onMouseDown={(e) => { e.preventDefault(); submitQuick(true); }}>{t('calp.quick.details')}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <span className="cp-flex" />
            <div className="cp-seg" role="group" aria-label={t('calp.view')}>
              {VIEWS.map(v => (
                <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v}
                  title={`${t('calp.view.' + v)} (${({ day: 'D', week: 'W', month: 'M', agenda: 'A' })[v]})`}
                  onClick={() => setView(v)}>{t('calp.view.' + v)}</button>
              ))}
            </div>
            <div className="cp-opts">
              <button type="button" className="cp-icon-btn" aria-label={t('calp.settings')} aria-expanded={optsOpen}
                title={t('calp.settings')} onClick={() => setOptsOpen(v => !v)}><CIcon name="settings" size={16} /></button>
              {optsOpen && (
                <div className="cp-opts-pop" role="dialog" aria-label={t('calp.settings')}>
                  <label className="cp-opts-row">
                    <span>{t('calp.startHour')}</span>
                    <select className="cp-inp" value={startHour} onChange={(e) => setPrefs(p => ({ ...p, startHour: Number(e.target.value) }))}>
                      {Array.from({ length: 13 }, (_, h) => <option key={h} value={h}>{`${h}:00`}</option>)}
                    </select>
                  </label>
                  <p className="cp-opts-kbd">{t('calp.kbd')}</p>
                </div>
              )}
            </div>
            <button type="button" className="cp-icon-btn cp-narrow-only cp-day-toggle" onClick={() => setDayOpen(v => !v)}
              aria-label={t('calp.panel.toggle')} aria-expanded={dayOpen}><CIcon name="panel" size={16} /></button>
          </header>

          <div className="cp-view">
            {(view === 'week' || view === 'day') && (
              <TimeGrid days={days} insts={insts} today={today} nowMin={minutesOf(now)} selected={selected}
                ghost={shownGhost} dragKey={dragKey} activeKey={activeKey} scrollRef={scrollRef}
                onSelectDay={selectDay} onOpenDay={openDay}
                onPointerDownEvent={onPointerDownEvent} onPointerDownGrid={onPointerDownGrid} />
            )}
            {view === 'month' && (
              <MonthView cursor={cursor} insts={insts} today={today} selected={selected} ghost={ghost}
                dragKey={dragKey} activeKey={activeKey}
                onSelectDay={selectDay} onOpenDay={openDay} onCreateDay={onCreateDay}
                onPointerDownEvent={onPointerDownEvent} />
            )}
            {view === 'agenda' && (
              <AgendaView from={range.from} days={agendaDays} insts={insts} today={today} activeKey={activeKey}
                calName={calName} onPointerDownEvent={onPointerDownEvent} onSelectDay={selectDay}
                onMore={loadMoreAgenda} />
            )}
          </div>
        </main>

        <aside className={dayCls} aria-label={names.full(selected)}>
          <section className="cp-day-head">
            <div className="cp-day-dow">{names.dowLong(selected)}</div>
            <div className="cp-day-date">{names.dayMonth(selected)}</div>
          </section>
          <button type="button" className="cp-daily" onClick={() => onOpenDaily(selected)}>
            <span className="cp-daily-label"><CIcon name="note" size={14} stroke={1.8} />{t('calp.daily')}</span>
            <span className="cp-daily-text">{dailyFile ? (dailyText || t('calp.daily.blank')) : t('calp.daily.empty')}</span>
            <span className="cp-daily-cta">{dailyFile ? t('calp.daily.open') : t('calp.daily.create')}</span>
          </button>
          <section>
            <h3 className="cp-h3">{t('calp.dueSoon')}</h3>
            {dueSoon.length === 0 && <p className="cp-muted">{t('calp.dueSoon.empty')}</p>}
            <div className="cp-due">
              {dueSoon.map(({ ev, s, overdue }) => (
                <label key={ev._key} className="cp-due-row">
                  <input type="checkbox" checked={ev.status === 'done'} disabled={readOnly}
                    onChange={(e) => toggleTask(ev, e.target.checked)} />
                  <span>
                    <button type="button" className="cp-due-title" onClick={(e) => { e.preventDefault(); onJump(ev.noteId, ev.anchor && ev.anchor.snippet); }}>{ev.title}</button>
                    <span className={`cp-due-meta${overdue ? ' overdue' : ''}`}>
                      {names.dayMonthShort(s)}{ev.allDay ? '' : ` ${hhmm(s)}`}{overdue ? ` · ${t('calp.overdue')}` : ''} · {noteName(ev.noteId)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
          <section>
            <h3 className="cp-h3">{t('calp.alerts')}</h3>
            {alerts.length === 0 && <p className="cp-muted">{t('calp.alerts.empty')}</p>}
            <div className="cp-alerts">
              {alerts.map(inst => {
                const off = inst.ev.kind === 'reminder' ? (inst.ev.reminderOffset || 0) : inst.ev.reminderOffset;
                return (
                  <button key={inst.key} type="button" data-ev-key={inst.key} className="cp-alert"
                    onClick={(e) => openPopover(draftFromInst(inst), rectOf(e.currentTarget))}>
                    <CIcon name="bell" size={16} stroke={1.8} style={{ color: inst.color }} />
                    <span>
                      <span className="cp-alert-title">{inst.ev.title}</span>
                      <span className="cp-alert-meta">
                        {sameDay(inst.s, today) ? t('cal.when.today').toLowerCase() : names.dayMonthShort(inst.s)}{inst.allDay ? '' : `, ${hhmm(inst.s)}`} · {offsetLabel(off || 0)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        {pop && draft && (
          <EventPopover draft={draft} setDraft={setDraft} anchor={pop.anchor}
            calendars={vaultCals} calColor={calColor} notes={notes} readOnly={readOnly}
            onSave={saveDraft} onDelete={deleteDraft} onClose={closePopover}
            onOpenNote={(id, snip) => { closePopover(); onJump(id, snip); }}
            onOpenExternal={(url) => onOpenExternal && onOpenExternal(url)}
            onToggleTask={(done) => draft.inlineEv && toggleTask(draft.inlineEv, done)} />
        )}
        {floatChip && (
          <div className="cp-float" style={{ left: floatChip.x + 12, top: floatChip.y + 8 }} aria-hidden="true">{floatChip.title}</div>
        )}
        {toast && (
          <div className="cp-toast" role="status" key={toast.id}>
            <span>{toast.text}</span>
            {toast.undo && <button type="button" className="cp-link" onClick={() => { toast.undo(); setToast(null); }}>{t('calp.toast.undo')}</button>}
          </div>
        )}
      </div>
    </div>
  );
});
