// Reuniones → acta (Edinot 1.4). Parte pura, sin Electron ni red: fusionar las dos pistas de la grabación
// (tu micrófono y el audio del sistema), partir transcripciones largas, pedir el acta a un modelo y montar la nota.
//
// La grabación va en DOS pistas separadas: lo del micrófono es siempre «yo» y lo del sistema son «los demás»,
// así no hace falta adivinar quién habla. Cada pista se transcribe por separado y aquí se entrelazan por tiempo.

const L10N = {
  es: {
    me: 'Yo', others: 'Otros', untitled: 'Reunión', summary: 'Resumen', outline: 'Temas', decisions: 'Decisiones',
    myTasks: 'Mis tareas', otherTasks: 'Tareas de otros', questions: 'Pendiente de aclarar', transcript: 'Transcripción',
    duration: 'Duración', date: 'Fecha', participants: 'Participantes', none: 'Nada destacable.', due: 'para', tag: 'reunión',
  },
  en: {
    me: 'Me', others: 'Others', untitled: 'Meeting', summary: 'Summary', outline: 'Topics', decisions: 'Decisions',
    myTasks: 'My tasks', otherTasks: "Others' tasks", questions: 'Open questions', transcript: 'Transcript',
    duration: 'Duration', date: 'Date', participants: 'Participants', none: 'Nothing notable.', due: 'by', tag: 'meeting',
  },
};
export const meetingLabels = (lang) => L10N[lang === 'en' ? 'en' : 'es'];

const pad = (n) => String(n).padStart(2, '0');

/** 3725 → «1:02:05»; 65 → «01:05». */
export function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

/** «1:02:05» / «01:05» / 65 → segundos (o null). */
export function parseClock(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  const m = String(v == null ? '' : v).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
}

/** Segmentos de una respuesta `verbose_json` de transcripción → [{ start, end, text }] (o uno solo si no hay tiempos). */
export function segmentsFromTranscription(res) {
  if (!res) return [];
  const segs = Array.isArray(res.segments) ? res.segments : [];
  const out = segs
    .map(s => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').replace(/\s+/g, ' ').trim() }))
    .filter(s => s.text);
  if (out.length) return out;
  const text = String(res.text || '').replace(/\s+/g, ' ').trim();
  return text ? [{ start: 0, end: Number(res.duration) || 0, text }] : [];
}

// Frases que Whisper inventa sobre el silencio o la música. Una pista casi muda las genera a menudo.
const HALLUCINATIONS = /^(?:\W*(?:gracias por ver( el vídeo)?|subtítulos (realizados )?por.*|suscríbete.*|thanks for watching\W*|thank you\W*|\.+|♪+|\[música\]|\[music\])\W*)$/i;

/** Quita lo que no es habla: vacíos, alucinaciones típicas y repeticiones idénticas seguidas. */
export function cleanSegments(segs) {
  const out = [];
  for (const s of segs || []) {
    const text = String(s.text || '').trim();
    if (!text || HALLUCINATIONS.test(text)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.text.toLowerCase() === text.toLowerCase()) continue;
    out.push({ ...s, text });
  }
  return out;
}

const words = (t) => new Set(String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9ñ]+/g) || []);

/** Sin cascos, el micrófono recoge a los demás por los altavoces. Un tramo mío que coincide en el tiempo con otro
 *  de «los demás» y dice casi lo mismo es eco, no habla mía: se quita. */
export function dropEcho(mine, others, { minSimilarity = 0.6, slack = 4 } = {}) {
  const o = (others || []).map(s => ({ s, w: words(s.text) }));
  return (mine || []).filter((m) => {
    const mw = words(m.text);
    if (mw.size < 3) return true;
    for (const x of o) {
      if (x.s.end < m.start - slack || x.s.start > m.end + slack) continue;
      let inter = 0;
      for (const w of mw) if (x.w.has(w)) inter++;
      if (inter / Math.min(mw.size, x.w.size) >= minSimilarity) return false;
    }
    return true;
  });
}

/** Reparte a «los demás» entre las voces que detecta un servicio de diarización (`/diarize`):
 *  `turns` = [{ speaker: 'S1', start, end }]. Cada tramo de texto se queda con la voz que más tiempo
 *  coincide con él (si ninguna, la más cercana en el tiempo). Devuelve tramos con `spk` = 1, 2… */
export function assignSpeakers(segs, turns) {
  const t = (turns || []).map(x => ({ n: Number(String(x.speaker).replace(/\D+/g, '')) || 0, start: Number(x.start) || 0, end: Number(x.end) || 0 })).filter(x => x.n && x.end > x.start);
  if (!t.length) return segs;
  return (segs || []).map((s) => {
    const over = new Map();
    let best = null, bestGap = Infinity;
    for (const x of t) {
      const ov = Math.min(s.end, x.end) - Math.max(s.start, x.start);
      if (ov > 0) over.set(x.n, (over.get(x.n) || 0) + ov);
      else { const gap = Math.max(x.start - s.end, s.start - x.end); if (gap < bestGap) { bestGap = gap; best = x.n; } }
    }
    let spk = best;
    if (over.size) spk = [...over.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { ...s, spk };
  });
}

/** Entrelaza lo mío y lo de los demás por tiempo; une tramos consecutivos de la misma voz (hueco ≤ gap s). */
export function mergeTracks(mine, others, { gap = 2.5, offsetOthers = 0, maxChars = 600 } = {}) {
  const all = [
    ...(mine || []).map(s => ({ ...s, who: 'me' })),
    ...(others || []).map(s => ({ ...s, start: s.start + offsetOthers, end: s.end + offsetOthers, who: 'others' })),
  ].sort((a, b) => (a.start - b.start) || (a.end - b.end));
  const out = [];
  for (const s of all) {
    const prev = out[out.length - 1];
    if (prev && prev.who === s.who && prev.spk === s.spk && s.start - prev.end <= gap && prev.text.length < maxChars) {
      prev.text += ' ' + s.text;
      prev.end = Math.max(prev.end, s.end);
    } else out.push({ ...s });
  }
  return out;
}

/** Texto plano con tiempos y quién habla: lo que se le da al modelo y lo que se guarda en la nota. */
export function transcriptToText(segs, lang) {
  const L = meetingLabels(lang);
  return (segs || []).map(s => `[${formatClock(s.start)}] ${s.who === 'me' ? L.me : (s.spk ? `${L.others} ${s.spk}` : L.others)}: ${s.text}`).join('\n');
}

/** Parte la transcripción en trozos de ≤ maxChars sin cortar líneas (para resumirla por partes si es larguísima). */
export function chunkTranscript(text, maxChars = 24000) {
  const lines = String(text || '').split('\n');
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > maxChars) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function actaSystemPrompt(lang) {
  const en = lang === 'en';
  const L = meetingLabels(lang);
  return en
    ? `You write meeting minutes from a transcript. Lines look like "[mm:ss] Me: …" or "[mm:ss] Others: …". "${L.me}" is the person who owns these notes; "${L.others}" are all the other participants together (the audio does not tell them apart, unless a line says "${L.others} 1", "${L.others} 2"…: then those are distinct voices, whose names you may infer only if someone says them).
Reply with ONE JSON object and nothing else, with this shape:
{"title": "short, specific title (max 8 words)",
 "summary": "3-6 sentences: what the meeting was about and where it ended up",
 "participants": ["names that are clearly mentioned, if any"],
 "topics": [{"time": "mm:ss of when it starts", "title": "topic", "points": ["key point", "..."]}],
 "decisions": ["decision taken, stated as a fact"],
 "actions": [{"task": "what has to be done", "owner": "person, or '${L.me}' if it is for the note owner, or '' if unknown", "mine": true|false, "due": "date or deadline if said, else ''"}],
 "questions": ["something left unresolved or to be confirmed"]}
Rules: write in English. Use only what the transcript says; never invent names, dates or numbers. "mine" is true only when the task is for "${L.me}". Skip small talk. If a list has nothing, use [].`
    : `Redactas el acta de una reunión a partir de su transcripción. Las líneas son "[mm:ss] Yo: …" u "[mm:ss] Otros: …". "${L.me}" es la persona dueña de estas notas; "${L.others}" son todos los demás participantes juntos (el audio no los distingue, salvo que la línea diga "${L.others} 1", "${L.others} 2"…: entonces son voces distintas, y solo les pones nombre si alguien lo dice).
Responde con UN objeto JSON y nada más, con esta forma:
{"title": "título corto y concreto (máx. 8 palabras)",
 "summary": "3-6 frases: de qué fue la reunión y en qué quedó",
 "participants": ["nombres que se mencionen con claridad, si los hay"],
 "topics": [{"time": "mm:ss de cuándo empieza", "title": "tema", "points": ["punto clave", "..."]}],
 "decisions": ["decisión tomada, escrita como un hecho"],
 "actions": [{"task": "qué hay que hacer", "owner": "persona, o '${L.me}' si es de la persona dueña de las notas, o '' si no se sabe", "mine": true|false, "due": "fecha o plazo si se dijo, si no ''"}],
 "questions": ["algo que quedó sin resolver o por confirmar"]}
Reglas: escribe en español. Usa solo lo que dice la transcripción; no inventes nombres, fechas ni cifras. "mine" es true solo si la tarea es de "${L.me}". Ignora la charla de cortesía. Si una lista no tiene nada, pon [].`;
}

/** Cuando la transcripción es muy larga: cada parte se resume en notas y luego se redacta el acta con las notas. */
export function partialPrompt(lang) {
  return lang === 'en'
    ? 'Summarise this PART of a longer meeting transcript as dense bullet notes. Keep timestamps [mm:ss], who said what ("Me"/"Others"), decisions, tasks (with owner and deadline) and open questions. No introduction, no conclusion, only the notes.'
    : 'Resume esta PARTE de la transcripción de una reunión más larga en notas densas con viñetas. Conserva los tiempos [mm:ss], quién dijo qué ("Yo"/"Otros"), las decisiones, las tareas (con responsable y plazo) y lo que quedó sin resolver. Sin introducción ni conclusión, solo las notas.';
}

/** Saca el objeto JSON de la respuesta del modelo (con o sin ```json, con texto alrededor) o devuelve null. */
export function parseActaJson(raw) {
  const s = String(raw || '');
  const tryParse = (x) => { try { const v = JSON.parse(x); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
  const direct = tryParse(s.trim());
  if (direct) return direct;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { const v = tryParse(fence[1].trim()); if (v) return v; }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return tryParse(s.slice(a, b + 1));
  return null;
}

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Deja el acta con la forma esperada, venga como venga del modelo. */
export function normalizeActa(a, lang) {
  const L = meetingLabels(lang);
  const o = a && typeof a === 'object' ? a : {};
  const actions = arr(o.actions).map(x => {
    const t = typeof x === 'string' ? { task: x } : (x || {});
    const owner = str(t.owner);
    const mine = t.mine === true || (owner && owner.toLowerCase() === L.me.toLowerCase());
    return { task: str(t.task), owner, mine: !!mine, due: str(t.due) };
  }).filter(x => x.task);
  return {
    title: str(o.title).replace(/[\\/:*?"<>|\n\r#]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80),
    summary: str(o.summary),
    participants: arr(o.participants).map(str).filter(Boolean),
    topics: arr(o.topics).map(x => ({
      time: parseClock(x && x.time), title: str(x && x.title),
      points: arr(x && x.points).map(str).filter(Boolean),
    })).filter(x => x.title),
    decisions: arr(o.decisions).map(str).filter(Boolean),
    actions,
    questions: arr(o.questions).map(str).filter(Boolean),
  };
}

const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Nombre por defecto de la nota: «Reunión 2026-11-17 18:30». */
export function defaultMeetingTitle(startedAt, lang) {
  const d = new Date(startedAt || Date.now());
  return `${meetingLabels(lang).untitled} ${ymd(d)} ${hm(d)}`;
}

/** La nota: título, cabecera, acta con casillas para las tareas y, al final, la transcripción completa. */
export function buildMeetingNote({ acta, transcript, startedAt, durationSec, lang }) {
  const L = meetingLabels(lang);
  const a = normalizeActa(acta, lang);
  const d = new Date(startedAt || Date.now());
  const stamp = defaultMeetingTitle(startedAt, lang);
  const title = a.title ? `${a.title} · ${ymd(d)}` : stamp;
  const out = [`# ${title}`, ''];
  out.push(`#${L.tag} · ${L.date}: ${ymd(d)} ${hm(d)} · ${L.duration}: ${formatClock(durationSec)}`);
  if (a.participants.length) out.push('', `${L.participants}: ${a.participants.join(', ')}`);
  out.push('', `## ${L.summary}`, '', a.summary || L.none);
  if (a.topics.length) {
    out.push('', `## ${L.outline}`, '');
    for (const t of a.topics) {
      out.push(`- ${t.time != null ? `**${formatClock(t.time)}** ` : ''}${t.title}`);
      for (const p of t.points) out.push(`  - ${p}`);
    }
  }
  out.push('', `## ${L.decisions}`, '');
  if (a.decisions.length) for (const x of a.decisions) out.push(`- ${x}`); else out.push(L.none);
  const task = (x, withOwner) => `- [ ] ${x.task}${withOwner && x.owner ? ` — ${x.owner}` : ''}${x.due ? ` (${L.due} ${x.due})` : ''}`;
  const mine = a.actions.filter(x => x.mine), theirs = a.actions.filter(x => !x.mine);
  out.push('', `## ${L.myTasks}`, '');
  if (mine.length) for (const x of mine) out.push(task(x, false)); else out.push(L.none);
  if (theirs.length) { out.push('', `## ${L.otherTasks}`, ''); for (const x of theirs) out.push(task(x, true)); }
  if (a.questions.length) { out.push('', `## ${L.questions}`, ''); for (const x of a.questions) out.push(`- ${x}`); }
  out.push('', `## ${L.transcript}`, '', transcript ? String(transcript).split('\n').join('\n\n') : L.none, '');
  return out.join('\n');
}
