// Reuniones → acta: grabar, transcribir y redactar. Un único estado global (solo hay una reunión a la vez) al
// que se suscribe la píldora flotante. La página no habla con el servidor de IA: lo hace el proceso principal
// (electron/meetings.cjs), que además guarda la grabación en disco según se hace.

import {
  segmentsFromTranscription, assignSpeakers, cleanSegments, mergeTracks, transcriptToText, chunkTranscript,
  dropEcho, actaSystemPrompt, partialPrompt, parseActaJson, normalizeActa, buildMeetingNote, defaultMeetingTitle,
} from '../../shared/meeting-model.mjs';

// Valores por omisión: ningún servidor concreto. Cada paso (transcribir, redactar el acta) tiene su propia
// dirección, clave y modelo, y el segundo puede reutilizar los del primero.
export const MEETING_DEFAULTS = { sttModel: 'whisper-1', llmModel: 'gpt-4o-mini' };

const api = () => (typeof window !== 'undefined' ? window.electronAPI : null);
export const meetingsAvailable = () => !!(api() && api().meetingBegin && typeof MediaRecorder !== 'undefined');

let cfg = { getSettings: () => ({}), createNote: async () => null, getLang: () => 'es' };
export function configureMeetings(next) { cfg = { ...cfg, ...next }; }

export function meetingSettings() {
  const s = cfg.getSettings() || {};
  const g = (k, d = '') => (s[k] !== undefined && s[k] !== null && String(s[k]).trim() !== '' ? String(s[k]).trim() : d);
  const stt = { url: g('meetingsSttUrl').replace(/\/+$/, ''), key: g('meetingsSttKey'), model: g('meetingsSttModel', MEETING_DEFAULTS.sttModel) };
  const same = s.meetingsLlmSame !== false;
  const llm = {
    url: same ? stt.url : g('meetingsLlmUrl').replace(/\/+$/, ''),
    key: same ? stt.key : g('meetingsLlmKey'),
    model: g('meetingsLlmModel', MEETING_DEFAULTS.llmModel),
  };
  return { stt, llm, same, lang: s.meetingsLang === 'en' ? 'en' : 'es', system: s.meetingsSystemAudio !== false, diarize: s.meetingsDiarize === true, speakers: Math.max(0, Math.min(20, Math.round(Number(s.meetingsSpeakers) || 0))), keep: s.meetingsKeepAudio === true };
}

// ── Estado ──────────────────────────────────────────────────────────────
let state = { phase: 'idle', id: null, elapsed: 0, level: 0, step: '', error: '', noteId: null, warn: '', pending: [] };
const listeners = new Set();
const emit = (patch) => { state = { ...state, ...patch }; for (const l of listeners) { try { l(state); } catch {} } };
export const getMeetingState = () => state;
export function onMeetingState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ── Grabación ───────────────────────────────────────────────────────────
let rec = null; // { id, startedAt, tracks: {mic, sys}, ctx, timer, t0, pausedMs, pausedAt, streams }

const newId = () => 'm' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

async function getSystemAudio() {
  // Windows / macOS: la captura de pantalla con audio «loopback» (el proceso principal lo concede).
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audio = s.getAudioTracks();
    s.getVideoTracks().forEach(t => { t.stop(); s.removeTrack(t); });
    if (audio.length) return new MediaStream(audio);
    s.getTracks().forEach(t => t.stop());
  } catch {}
  // Linux (y respaldo): la entrada «Monitor of …» del sonido, que es lo que suena por los altavoces.
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const mon = devs.find(d => /monitor/i.test(d.label));
    if (mon) {
      return await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: mon.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    }
  } catch {}
  return null;
}

// Cada trozo (segmento) es una grabación completa e independiente; se corta cada SEG_SEC segundos de grabación.
const segSecNow = () => Math.max(5, Number(typeof window !== 'undefined' && window.__EDINOT_SEG_SEC) || 600); // el override es solo para pruebas
const SEG_SEC = 600;

function makeRecorder(stream, id, track, seg, mime) {
  const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : null), audioBitsPerSecond: 64000 });
  let chain = Promise.resolve();
  mr.ondataavailable = (ev) => {
    if (!ev.data || !ev.data.size) return;
    chain = chain.then(async () => {
      const bytes = new Uint8Array(await ev.data.arrayBuffer());
      await api().meetingChunk({ id, track, seg, bytes });
    }).catch(() => {});
  };
  const stopped = new Promise((res) => { mr.onstop = () => res(chain); });
  mr.start(5000);
  return { mr, stopped };
}

export async function startMeeting() {
  if (!meetingsAvailable()) throw new Error('unavailable');
  if (state.phase === 'recording' || state.phase === 'paused' || state.phase === 'processing') return;
  const s = meetingSettings();
  emit({ phase: 'starting', error: '', warn: '', noteId: null, step: '' });
  let mic = null, sys = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    emit({ phase: 'idle', error: 'mic' });
    throw err;
  }
  let warn = '';
  if (s.system) {
    sys = await getSystemAudio();
    if (!sys) warn = 'nosys';
  }
  const id = newId();
  const startedAt = Date.now();
  await api().meetingBegin({ id, startedAt, segSec: segSecNow(), tracks: { mic: true, sys: !!sys } });
  const mime = pickMime();
  const tracks = { mic: { stream: mic, cur: makeRecorder(mic, id, 'mic', 0, mime) } };
  if (sys) tracks.sys = { stream: sys, cur: makeRecorder(sys, id, 'sys', 0, mime) };
  // Para saber quién habla hace falta la pista entera, sin cortes (los trozos no comparten voces): va aparte.
  if (sys && s.diarize) tracks.sysall = { stream: sys, cur: makeRecorder(sys, id, 'sysall', 0, mime), whole: true };

  // Nivel del micrófono para la píldora.
  let ctx = null, analyser = null, buf = null;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(mic);
    analyser = ctx.createAnalyser(); analyser.fftSize = 512; buf = new Uint8Array(analyser.fftSize);
    src.connect(analyser);
  } catch {}

  rec = { id, startedAt, tracks, mime, seg: 0, segSec: segSecNow(), stops: [], ctx, t0: performance.now(), pausedMs: 0, pausedAt: 0, streams: [mic, sys].filter(Boolean), timer: null };
  rec.timer = setInterval(() => {
    if (!rec) return;
    const paused = state.phase === 'paused';
    const elapsed = ((paused ? rec.pausedAt : performance.now()) - rec.t0 - rec.pausedMs) / 1000;
    let level = 0;
    if (analyser && !paused) {
      analyser.getByteTimeDomainData(buf);
      let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      level = Math.min(1, peak / 64);
    }
    // Corte de trozo: el viejo se cierra solo (queda un .webm válido) y el nuevo empieza al instante.
    if (!paused && elapsed >= (rec.seg + 1) * rec.segSec) {
      rec.seg++;
      for (const [name, tr] of Object.entries(rec.tracks)) {
        if (tr.whole) continue;
        try { tr.cur.mr.stop(); } catch {}
        rec.stops.push(tr.cur.stopped);
        tr.cur = makeRecorder(tr.stream, rec.id, name, rec.seg, rec.mime);
      }
    }
    emit({ elapsed, level });
  }, 250);
  emit({ phase: 'recording', id, elapsed: 0, level: 0, warn });
}

export function pauseMeeting() {
  if (!rec || state.phase !== 'recording') return;
  for (const t of Object.values(rec.tracks)) { try { t.cur.mr.pause(); } catch {} }
  rec.pausedAt = performance.now();
  emit({ phase: 'paused', level: 0 });
}

export function resumeMeeting() {
  if (!rec || state.phase !== 'paused') return;
  for (const t of Object.values(rec.tracks)) { try { t.cur.mr.resume(); } catch {} }
  rec.pausedMs += performance.now() - rec.pausedAt;
  emit({ phase: 'recording' });
}

async function haltRecording() {
  const r = rec; rec = null;
  if (!r) return null;
  clearInterval(r.timer);
  const durationSec = Math.max(0, (((state.phase === 'paused' ? r.pausedAt : performance.now()) - r.t0) - r.pausedMs) / 1000);
  const stops = Object.values(r.tracks).map(t => { try { if (t.cur.mr.state !== 'inactive') t.cur.mr.stop(); } catch {} return t.cur.stopped; });
  await Promise.all([...r.stops, ...stops]);
  r.streams.forEach(s => s.getTracks().forEach(t => t.stop()));
  try { r.ctx && r.ctx.close(); } catch {}
  return { id: r.id, startedAt: r.startedAt, durationSec, hasSys: !!r.tracks.sys };
}

export async function discardMeeting() {
  const h = await haltRecording();
  if (h) await api().meetingDiscard({ id: h.id });
  emit({ phase: 'idle', id: null, elapsed: 0, level: 0, step: '', warn: '' });
}

export async function stopMeeting() {
  if (!rec) return;
  const h = await haltRecording();
  if (!h) return;
  await api().meetingEnd({ id: h.id, durationSec: h.durationSec });
  await processMeeting(h.id, { startedAt: h.startedAt, durationSec: h.durationSec });
}

// ── Del audio a la nota ─────────────────────────────────────────────────
const SINGLE_PASS_CHARS = 28000;

async function chat(s, model, messages, json, maxTokens) {
  const r = await api().meetingChat({ baseUrl: s.llm.url, key: s.llm.key, model, messages, json, maxTokens });
  if (!r || !r.ok) throw new Error('chat: ' + ((r && r.error) || 'sin respuesta'));
  return r.text;
}

async function writeActa(s, text, lang) {
  const sys = actaSystemPrompt(lang);
  let material = text;
  const models = [s.llm.model];
  let lastErr = null;
  for (const model of models) {
    try {
      if (material.length > SINGLE_PASS_CHARS) {
        const parts = chunkTranscript(material, SINGLE_PASS_CHARS);
        const notes = [];
        for (let i = 0; i < parts.length; i++) {
          emit({ step: 'summarizing', stepDetail: `${i + 1}/${parts.length}` });
          notes.push(await chat(s, model, [{ role: 'system', content: partialPrompt(lang) }, { role: 'user', content: parts[i] }], false, 2500));
        }
        material = notes.join('\n\n');
      }
      emit({ step: 'writing', stepDetail: '' });
      const raw = await chat(s, model, [{ role: 'system', content: sys }, { role: 'user', content: material }], true, 4096);
      const parsed = parseActaJson(raw);
      if (parsed) return normalizeActa(parsed, lang);
      lastErr = new Error('el modelo no devolvió un acta válida');
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('acta');
}

/** Procesa una reunión ya grabada (en disco): transcribe, redacta y crea la nota. Se puede reintentar. */
export async function processMeeting(id, info = {}) {
  const s = meetingSettings();
  const lang = s.lang;
  if (!s.stt.key || !s.stt.url || !s.llm.key || !s.llm.url) { emit({ phase: 'error', id, error: 'nokey', step: '' }); return; }
  emit({ phase: 'processing', id, error: '', step: 'transcribing', stepDetail: '', elapsed: info.durationSec || 0, level: 0 });
  try {
    const meta = (await api().meetingPending()).find(m => m.id === id) || {};
    const startedAt = info.startedAt || meta.startedAt || Date.now();
    const durationSec = info.durationSec || meta.durationSec || 0;
    // Se sube trozo a trozo (de 10 min cada uno), con un reintento por trozo, y los tiempos se desplazan al
    // lugar de cada trozo en la reunión. Los trozos de una pista van uno tras otro; las dos pistas, a la vez.
    const files = await api().meetingSegments({ id });
    const segSec = files.segSec || SEG_SEC;
    const total = files.mic.length + files.sys.length;
    let done = 0;
    const one = (track, n) => api().meetingTranscribe({ id, track, seg: n, baseUrl: s.stt.url, key: s.stt.key, model: s.stt.model, language: lang });
    const transcribeTrack = async (track) => {
      const out = [];
      for (const n of files[track]) {
        emit({ step: 'transcribing', stepDetail: total > 2 ? `${Math.min(++done, total)}/${total}` : '' });
        let r = await one(track, n);
        if (!r || !r.ok) r = await one(track, n);
        if (!r || !r.ok) throw new Error('transcripción: ' + ((r && r.error) || 'sin respuesta'));
        if (r.empty) continue;
        for (const sg of segmentsFromTranscription(r.result)) out.push({ ...sg, start: sg.start + n * segSec, end: sg.end + n * segSec });
      }
      return out;
    };
    const [mineRaw, othersRaw] = await Promise.all([transcribeTrack('mic'), transcribeTrack('sys')]);
    let others = cleanSegments(othersRaw);
    if (s.diarize && files.sysall && files.sysall.length) {
      emit({ step: 'voices', stepDetail: '' });
      try {
        const d = await api().meetingDiarize({ id, baseUrl: s.stt.url, key: s.stt.key, numSpeakers: s.speakers });
        if (d && d.ok && d.result && Array.isArray(d.result.segments)) others = assignSpeakers(others, d.result.segments);
        else if (!d || !d.empty) emit({ warn: 'novoices' });
      } catch { emit({ warn: 'novoices' }); }
    }
    const mine = dropEcho(cleanSegments(mineRaw), others);
    const segs = mergeTracks(mine, others);
    if (!segs.length) { emit({ phase: 'error', id, error: 'silence', step: '' }); return; }
    const transcript = transcriptToText(segs, lang);
    let acta = null;
    try { acta = await writeActa(s, transcript, lang); }
    catch (err) {
      // Sin acta, la transcripción no se pierde: la nota se crea igualmente y avisa.
      emit({ warn: 'noacta' });
    }
    emit({ step: 'saving', stepDetail: '' });
    const body = buildMeetingNote({ acta, transcript, startedAt, durationSec, lang });
    const title = body.split('\n')[0].replace(/^#\s+/, '');
    const noteId = await cfg.createNote({ title, body });
    await api().meetingDone({ id, keepAudio: s.keep });
    emit({ phase: 'done', noteId, step: '', stepDetail: '' });
  } catch (err) {
    emit({ phase: 'error', id, error: String((err && err.message) || err), step: '' });
  }
}

export function dismissMeeting() { emit({ phase: 'idle', id: null, error: '', warn: '', noteId: null, step: '', elapsed: 0 }); }

/** Reuniones grabadas que quedaron sin procesar (para ofrecer recuperarlas al abrir la app). */
export async function refreshPendingMeetings() {
  if (!meetingsAvailable()) return [];
  try {
    const list = await api().meetingPending();
    const active = state.id;
    emit({ pending: list.filter(m => m.id !== active) });
    return list;
  } catch { return []; }
}

export async function discardPending(id) {
  try { await api().meetingDiscard({ id }); } catch {}
  await refreshPendingMeetings();
}
