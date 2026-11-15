// Vistas del calendario: rejilla horaria (Día / Semana), Mes y Agenda.
// Son «tontas»: reciben las instancias ya expandidas (recurrencias incluidas)
// y delegan los gestos (crear arrastrando, mover, redimensionar) al padre
// mediante onPointerDown*. Los destinos de arrastre se marcan con
// data-cal-drop="time|allday|month" + data-day="YYYY-MM-DD"; el padre los
// localiza con elementFromPoint, así el mismo código sirve para eventos,
// tareas de la bandeja «Sin fecha» y cualquier vista.

import { memo, useMemo, useState } from 'react';
import { t } from '../../i18n.js';
import { CIcon } from './icons.jsx';
import { ymd, hhmm, names, sameDay, startOfDay, addDays, DAY_MS, layoutDay, weekOffset, dowIndex } from './model.js';

export const HOUR_PX = 58;

const timeLabel = (inst) => (inst.allDay ? '' : `${hhmm(inst.s)} – ${hhmm(inst.e)}`);
const evTitle = (inst) => inst.ev.title || t('calp.untitled');

function EvIcons({ inst }) {
  const ev = inst.ev;
  return (
    <>
      {ev.source === 'google' && <CIcon name="lock" size={11} className="cp-ev-ico" />}
      {ev.source === 'inline' && ev.status && <CIcon name="task" size={11} className="cp-ev-ico" />}
      {(ev.kind === 'reminder' || ev.reminderOffset != null) && <CIcon name="bell" size={11} className="cp-ev-ico" />}
      {ev.recurrence && ev.recurrence.freq && <CIcon name="repeat" size={11} className="cp-ev-ico" />}
    </>
  );
}

function Chip({ inst, onPointerDown, dim, active, showTime = true, cls = '' }) {
  return (
    <button type="button" data-ev-key={inst.key}
      className={`cp-chip${inst.ev.status === 'done' ? ' done' : ''}${dim ? ' dim' : ''}${active ? ' active' : ''}${inst.allDay ? ' allday' : ''} ${cls}`}
      style={{ '--ev': inst.color }}
      title={`${timeLabel(inst) ? timeLabel(inst) + ' · ' : ''}${evTitle(inst)}${inst.ev.location ? ' · ' + inst.ev.location : ''}`}
      onPointerDown={(e) => onPointerDown(e, inst, 'move')}
      onClick={(e) => { if (e.detail === 0) onPointerDown(e, inst, 'open'); }}>
      <EvIcons inst={inst} />
      {showTime && !inst.allDay && <span className="cp-chip-time">{hhmm(inst.s)}</span>}
      <span className="cp-chip-title">{evTitle(inst)}</span>
    </button>
  );
}

// ── Día / Semana ────────────────────────────────────────────────────────
export const TimeGrid = memo(function TimeGrid({
  days, insts, today, nowMin, selected, ghost, dragKey, activeKey, scrollRef,
  onSelectDay, onPointerDownEvent, onPointerDownGrid, onOpenDay,
}) {
  const [allDayOpen, setAllDayOpen] = useState(false);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;

  const { timed, allDay } = useMemo(() => {
    const timedBy = days.map(() => []);
    const allBy = days.map(() => []);
    for (const inst of insts) {
      const long = inst.allDay || (inst.e - inst.s) >= DAY_MS;
      for (let i = 0; i < days.length; i++) {
        const d0 = startOfDay(days[i]).getTime();
        const d1 = d0 + DAY_MS;
        const s = inst.s.getTime(), e = Math.max(inst.e.getTime(), s + 1);
        if (!(s < d1 && e > d0)) continue;
        if (long) { allBy[i].push(inst); continue; }
        const ss = Math.max(s, d0), ee = Math.min(e, d1);
        timedBy[i].push({ inst, s: (ss - d0) / 60000, e: Math.max((ee - d0) / 60000, (ss - d0) / 60000 + 15), cut: ee < e, cutTop: ss > s });
      }
    }
    return { timed: timedBy.map(list => layoutDay(list)), allDay: allBy };
  }, [days, insts]);

  const maxAll = Math.max(0, ...allDay.map(l => l.length));
  const CAP = 3;

  return (
    <div className="cp-tg">
      <div className="cp-tg-heads" style={{ gridTemplateColumns: cols }}>
        <div className="cp-tg-gut" />
        {days.map((d) => {
          const isToday = sameDay(d, today);
          const isSel = selected && sameDay(d, selected);
          return (
            <button type="button" key={ymd(d)} className={`cp-tg-head${isToday ? ' today' : ''}${isSel ? ' sel' : ''}`}
              onClick={() => onSelectDay(d)} onDoubleClick={() => onOpenDay(d)}
              aria-pressed={!!isSel} aria-label={names.full(d)}>
              <span className="cp-tg-dow">{names.dowShort((d.getDay() + 6) % 7)}</span>
              <span className="cp-tg-num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      <div className="cp-tg-allday" style={{ gridTemplateColumns: cols }}>
        <div className="cp-tg-gut cp-tg-alllabel">
          {t('calp.allDay')}
          {maxAll > CAP && (
            <button type="button" className="cp-tg-allmore" onClick={() => setAllDayOpen(v => !v)}
              aria-expanded={allDayOpen} aria-label={t('calp.moreTip', { n: maxAll })}>
              <CIcon name={allDayOpen ? 'chevDown' : 'chevRight'} size={12} />
            </button>
          )}
        </div>
        {days.map((d, i) => {
          const list = allDay[i];
          const shown = allDayOpen ? list : list.slice(0, CAP);
          const g = ghost && ghost.kind === 'allday' && ghost.day === ymd(d) ? ghost : null;
          return (
            <div key={ymd(d)} className="cp-tg-allcell" data-cal-drop="allday" data-day={ymd(d)}
              onPointerDown={(e) => onPointerDownGrid(e, d, 'allday')}>
              {shown.map(inst => (
                <Chip key={inst.key} inst={inst} showTime={false} dim={dragKey === inst.key} active={activeKey === inst.key}
                  onPointerDown={onPointerDownEvent} />
              ))}
              {!allDayOpen && list.length > CAP && (
                <button type="button" className="cp-more" onClick={() => setAllDayOpen(true)}
                  onPointerDown={(e) => e.stopPropagation()}>{t('calp.more', { n: list.length - CAP })}</button>
              )}
              {g && <div className="cp-chip ghost" style={{ '--ev': g.color }}>{g.label}</div>}
            </div>
          );
        })}
      </div>
      <div className="cp-tg-scroll" ref={scrollRef}>
        <div className="cp-tg-body" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="cp-tg-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cp-tg-hour" style={{ top: h * HOUR_PX }}>{h === 0 ? '' : `${h}:00`}</div>
            ))}
          </div>
          {days.map((d, i) => {
            const key = ymd(d);
            const isToday = sameDay(d, today);
            const g = ghost && ghost.kind === 'time' && ghost.day === key ? ghost : null;
            return (
              <div key={key} className={`cp-tg-col${isToday ? ' today' : ''}`} data-cal-drop="time" data-day={key}
                onPointerDown={(e) => onPointerDownGrid(e, d, 'time')}>
                {timed[i].map(it => {
                  const inst = it.inst;
                  const top = it.s / 60 * HOUR_PX + 1;
                  const h = Math.max(18, (it.e - it.s) / 60 * HOUR_PX - 3);
                  const left = `calc(${(it.col / it.cols) * 100}% + 2px)`;
                  const width = `calc(${(it.span / it.cols) * 100}% - 6px)`;
                  const compact = h < 34;
                  const ev = inst.ev;
                  return (
                    <div key={inst.key + ':' + key} data-ev-key={inst.key} role="button" tabIndex={0}
                      aria-label={`${evTitle(inst)}, ${timeLabel(inst)}`}
                      className={`cp-ev${compact ? ' compact' : ''}${ev.status === 'done' ? ' done' : ''}${dragKey === inst.key ? ' dim' : ''}${activeKey === inst.key ? ' active' : ''}${inst.movable ? '' : ' fixed'}`}
                      style={{ top, height: h, left, width, '--ev': inst.color }}
                      onPointerDown={(e) => onPointerDownEvent(e, inst, 'move')}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPointerDownEvent(e, inst, 'open'); } }}>
                      <div className="cp-ev-title"><EvIcons inst={inst} />{evTitle(inst)}</div>
                      {!compact && <div className="cp-ev-time">{timeLabel(inst)}</div>}
                      {!compact && ev.location && h > 54 && <div className="cp-ev-loc">{ev.location}</div>}
                      {inst.resizable && !it.cut && (
                        <span className="cp-ev-resize" aria-hidden="true"
                          onPointerDown={(e) => { e.stopPropagation(); onPointerDownEvent(e, inst, 'resize'); }} />
                      )}
                    </div>
                  );
                })}
                {g && (
                  <div className="cp-ev ghost" style={{ top: g.s / 60 * HOUR_PX + 1, height: Math.max(18, (g.e - g.s) / 60 * HOUR_PX - 3), left: 2, width: 'calc(100% - 6px)', '--ev': g.color }}>
                    <div className="cp-ev-title">{g.label}</div>
                    <div className="cp-ev-time">{g.time}</div>
                  </div>
                )}
                {isToday && nowMin != null && (
                  <div className="cp-now" style={{ top: nowMin / 60 * HOUR_PX }} aria-hidden="true"><span data-time={`${Math.floor(nowMin / 60)}:${String(Math.floor(nowMin % 60)).padStart(2, '0')}`} /></div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// ── Mes ─────────────────────────────────────────────────────────────────
export const MonthView = memo(function MonthView({
  cursor, insts, today, selected, ghost, dragKey, activeKey,
  onSelectDay, onOpenDay, onCreateDay, onPointerDownEvent,
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(first, -weekOffset(first));
  const nWeeks = Math.ceil((weekOffset(first) + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
  const days = Array.from({ length: nWeeks * 7 }, (_, i) => addDays(gridStart, i));
  const byDay = useMemo(() => {
    const m = new Map();
    for (const inst of insts) {
      let d = startOfDay(inst.s);
      const endMs = Math.max(inst.e.getTime() - 1, inst.s.getTime());
      for (let k = 0; k < 42 && d.getTime() <= endMs; k++, d = addDays(d, 1)) {
        const key = ymd(d);
        const a = m.get(key);
        if (a) a.push(inst); else m.set(key, [inst]);
      }
    }
    for (const a of m.values()) a.sort((x, y) => (y.allDay - x.allDay) || (x.s - y.s));
    return m;
  }, [insts]);
  const CAP = nWeeks > 5 ? 3 : 4;
  return (
    <div className="cp-month">
      <div className="cp-month-dows">
        {Array.from({ length: 7 }, (_, i) => <div key={i}>{names.dowShort(dowIndex(i))}</div>)}
      </div>
      <div className="cp-month-grid" style={{ gridTemplateRows: `repeat(${nWeeks}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const key = ymd(d);
          const list = byDay.get(key) || [];
          const out = d.getMonth() !== cursor.getMonth();
          const isToday = sameDay(d, today);
          const isSel = selected && sameDay(d, selected);
          const we = d.getDay() === 0 || d.getDay() === 6;
          const g = ghost && ghost.kind === 'month' && ghost.day === key ? ghost : null;
          return (
            <div key={key} className={`cp-mcell${out ? ' out' : ''}${isToday ? ' today' : ''}${isSel ? ' sel' : ''}${we ? ' we' : ''}`}
              data-cal-drop="month" data-day={key}
              onClick={(e) => { if (e.target === e.currentTarget) onSelectDay(d); }}
              onDoubleClick={(e) => { if (!e.target.closest('.cp-chip')) onCreateDay(d, e.currentTarget); }}>
              <button type="button" className="cp-mnum" onClick={() => onSelectDay(d)} aria-label={names.full(d)}>{d.getDate()}</button>
              <div className="cp-mlist">
                {list.slice(0, CAP).map(inst => (
                  <Chip key={inst.key} inst={inst} dim={dragKey === inst.key} active={activeKey === inst.key} onPointerDown={onPointerDownEvent} />
                ))}
                {list.length > CAP && (
                  <button type="button" className="cp-more" title={t('calp.moreTip', { n: list.length })}
                    onClick={() => onOpenDay(d)} onDoubleClick={(e) => e.stopPropagation()}>{t('calp.more', { n: list.length - CAP })}</button>
                )}
                {g && <div className="cp-chip ghost" style={{ '--ev': g.color }}>{g.label}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── Agenda ──────────────────────────────────────────────────────────────
export const AgendaView = memo(function AgendaView({ from, days, insts, today, activeKey, calName, onPointerDownEvent, onMore, onSelectDay }) {
  const groups = useMemo(() => {
    const m = new Map();
    const endMs = addDays(from, days).getTime();
    for (const inst of insts) {
      // Un evento de varios días aparece el primer día visible que ocupa.
      const d = inst.s < from ? startOfDay(from) : startOfDay(inst.s);
      if (d.getTime() >= endMs) continue;
      const key = ymd(d);
      const a = m.get(key);
      if (a) a.push(inst); else m.set(key, [inst]);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, list]) => ({ key, day: new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)), list: list.sort((x, y) => (y.allDay - x.allDay) || (x.s - y.s)) }));
  }, [from, days, insts]);
  // Carga más al acercarse al final (además del botón).
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 160) onMore();
  };
  return (
    <div className="cp-agenda" onScroll={onScroll}>
      {groups.length === 0 && <div className="cp-empty">{t('calp.agenda.empty')}</div>}
      {groups.map(g => (
        <section key={g.key} className={`cp-ag-day${sameDay(g.day, today) ? ' today' : ''}`}>
          <button type="button" className="cp-ag-date" onClick={() => onSelectDay(g.day)}>
            <span className="cp-ag-num">{g.day.getDate()}</span>
            <span className="cp-ag-dow">{names.dowShort((g.day.getDay() + 6) % 7)} · {names.monthShort(g.day.getMonth())}{g.day.getFullYear() !== today.getFullYear() ? ' ' + g.day.getFullYear() : ''}</span>
          </button>
          <div className="cp-ag-list">
            {g.list.map(inst => (
              <button key={inst.key} type="button" data-ev-key={inst.key}
                className={`cp-ag-row${inst.ev.status === 'done' ? ' done' : ''}${activeKey === inst.key ? ' active' : ''}`}
                style={{ '--ev': inst.color }} onPointerDown={(e) => onPointerDownEvent(e, inst, 'open')}
                onClick={(e) => { if (e.detail === 0) onPointerDownEvent(e, inst, 'open'); }}>
                <span className="cp-ag-dot" aria-hidden="true" />
                <span className="cp-ag-time">{inst.allDay ? t('calp.allDay') : timeLabel(inst)}</span>
                <span className="cp-ag-title"><EvIcons inst={inst} />{evTitle(inst)}</span>
                {inst.ev.location && <span className="cp-ag-loc"><CIcon name="mapPin" size={12} /> {inst.ev.location}</span>}
                <span className="cp-ag-cal">{calName(inst.cal)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="cp-ag-foot">
        <span>{t('calp.agenda.until', { date: names.dayMonth(addDays(from, days - 1)) })}</span>
        <button type="button" className="cp-btn" onClick={onMore}>{t('calp.agenda.more')}</button>
      </div>
    </div>
  );
});

