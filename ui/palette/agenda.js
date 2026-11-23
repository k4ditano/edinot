// Agenda de un rango de días para «@fecha» en el buscador: eventos manuales,
// recordatorios y tareas con fecha de las notas (📅 / ⏰ / @due), con sus
// repeticiones, igual que los junta el Calendario.

import { getVaultEvents, expandOccurrences } from '../../store.js';
import { parseWhen, eventDurationMs } from '../calendar/model.js';

export function agendaInRange(vaultIds, from, to, max = 60) {
  const out = [];
  const fromMs = from.getTime(), toMs = to.getTime();
  const seen = new Set();
  for (const vid of vaultIds || []) {
    let evs;
    try { evs = getVaultEvents(vid); } catch { continue; }
    for (const ev of evs || []) {
      if (!ev || !ev.start) continue;
      if (ev.kind === 'reminder' && ev.dismissed) continue;
      const base = parseWhen(ev.start);
      if (!base) continue;
      const dur = eventDurationMs(ev);
      let starts;
      if (ev.recurrence && ev.recurrence.freq) {
        try { starts = expandOccurrences(ev, fromMs - Math.max(dur, 1), toMs); } catch { starts = []; }
      } else starts = [base];
      for (const s of starts) {
        const e = s.getTime() + dur;
        if (!(s.getTime() < toMs && e > fromMs)) continue;
        const key = `${vid}|${ev.id}@${s.getTime()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          key, start: s, allDay: !!ev.allDay, title: ev.title || '',
          kind: ev.source === 'inline' ? 'task' : (ev.kind || 'event'),
          noteId: ev.noteId || null, snippet: (ev.anchor && ev.anchor.snippet) || '', vaultId: vid,
        });
      }
    }
  }
  out.sort((a, b) => (a.start - b.start) || (Number(b.allDay) - Number(a.allDay)) || a.title.localeCompare(b.title));
  return out.slice(0, max);
}
