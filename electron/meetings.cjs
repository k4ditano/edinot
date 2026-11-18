// Reuniones → acta (Edinot 1.4): lo que necesita el proceso principal.
//
//  · Guarda la grabación EN DISCO mientras se hace (un fichero por pista, a trozos), así que si la app o el
//    equipo se caen, la reunión se puede recuperar al volver a abrirla.
//  · Sube cada pista a un servidor de transcripción compatible con OpenAI (`/audio/transcriptions`) y pide el
//    acta a un modelo de chat (`/chat/completions`). Se hace desde aquí y no desde la página para no depender
//    de CORS ni de la caché del navegador, y porque la clave no tiene por qué pasar por el HTML.
//  · Concede el audio del sistema («loopback») a la captura de pantalla de la ventana (Windows y macOS).

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const ID_RE = /^[a-z0-9][a-z0-9-]{3,60}$/;
const TRACKS = new Set(['mic', 'sys', 'sysall']);

function register({ app, ipcMain, session, net, desktopCapturer, logLine }) {
  const root = () => path.join(app.getPath('userData'), 'meetings');
  const dirOf = (id) => {
    if (!ID_RE.test(String(id || ''))) throw new Error('bad meeting id');
    return path.join(root(), id);
  };
  const metaFile = (id) => path.join(dirOf(id), 'meta.json');
  const readMeta = async (id) => { try { return JSON.parse(await fs.readFile(metaFile(id), 'utf8')); } catch { return null; } };
  const writeMeta = async (id, patch) => {
    const cur = (await readMeta(id)) || { id };
    const next = { ...cur, ...patch, id };
    await fs.writeFile(metaFile(id), JSON.stringify(next));
    return next;
  };
  // La grabación va en trozos independientes (cada uno es un .webm completo y se puede subir solo): una reunión
  // de una hora no se sube de golpe, y los servidores con límite de tamaño (25 MB en OpenAI) la aceptan.
  const SEG_SEC = 600;
  const trackFile = (id, track, seg = 0) => {
    if (!TRACKS.has(track)) throw new Error('bad track');
    const n = Number(seg);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error('bad segment');
    return path.join(dirOf(id), `${track}-${String(n).padStart(3, '0')}.webm`);
  };
  const listSegments = async (id) => {
    const out = { mic: [], sys: [], sysall: [] };
    let names = [];
    try { names = await fs.readdir(dirOf(id)); } catch { return out; }
    for (const n of names) {
      const m = /^(mic|sys|sysall)-(\d{3})\.webm$/.exec(n);
      if (m) out[m[1]].push(Number(m[2]));
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
    return out;
  };
  const base = (u) => String(u || '').trim().replace(/\/+$/, '');
  const failText = async (res) => {
    let body = '';
    try { body = (await res.text()).slice(0, 300); } catch {}
    try { const j = JSON.parse(body); if (j && j.error && j.error.message) body = j.error.message; } catch {}
    return `HTTP ${res.status}${body ? ': ' + body : ''}`;
  };

  // El audio del sistema: Windows/macOS lo dan con `audio: 'loopback'` al pedir la pantalla. En Linux no existe;
  // allí la página usa la entrada «Monitor of …» del sonido como si fuera un micrófono.
  try {
    session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((sources) => callback(sources.length ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}));
    }, { useSystemPicker: false });
  } catch (err) { logLine && logLine('warn', 'meeting:display-handler', err && err.message); }

  ipcMain.handle('meeting:begin', async (_e, { id, startedAt, tracks, segSec }) => {
    await fs.mkdir(dirOf(id), { recursive: true });
    await writeMeta(id, { startedAt: startedAt || Date.now(), tracks: tracks || {}, state: 'recording', durationSec: 0, segSec: Math.min(3600, Math.max(5, Math.round(Number(segSec) || SEG_SEC))) });
    return { ok: true };
  });

  ipcMain.handle('meeting:chunk', async (_e, { id, track, seg, bytes }) => {
    if (!bytes) return { ok: false };
    await fs.appendFile(trackFile(id, track, seg), Buffer.from(bytes));
    return { ok: true };
  });

  ipcMain.handle('meeting:end', async (_e, { id, durationSec }) => {
    await writeMeta(id, { state: 'recorded', durationSec: Math.round(durationSec || 0), endedAt: Date.now() });
    return { ok: true };
  });

  // Reuniones grabadas que no llegaron a ser una nota (la app se cerró o falló el servidor).
  ipcMain.handle('meeting:pending', async () => {
    const out = [];
    let names = [];
    try { names = await fs.readdir(root()); } catch { return out; }
    for (const id of names) {
      if (!ID_RE.test(id)) continue;
      const m = await readMeta(id);
      if (!m || m.state === 'done') continue;
      let bytes = 0;
      const segs = await listSegments(id);
      for (const tr of TRACKS) for (const n of segs[tr]) { try { bytes += (await fs.stat(trackFile(id, tr, n))).size; } catch {} }
      if (bytes > 0) out.push({ id, startedAt: m.startedAt, durationSec: m.durationSec || 0, state: m.state, bytes });
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  });

  ipcMain.handle('meeting:discard', async (_e, { id }) => {
    await fs.rm(dirOf(id), { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('meeting:done', async (_e, { id, keepAudio }) => {
    if (!keepAudio) { await fs.rm(dirOf(id), { recursive: true, force: true }); return { ok: true }; }
    await writeMeta(id, { state: 'done' });
    return { ok: true };
  });

  ipcMain.handle('meeting:reveal', async (_e, { id }) => {
    const { shell } = require('electron');
    try { await shell.openPath(dirOf(id)); } catch {}
    return { ok: true };
  });

  ipcMain.handle('meeting:segments', async (_e, { id }) => {
    const meta = await readMeta(id);
    return { segSec: (meta && meta.segSec) || SEG_SEC, ...(await listSegments(id)) };
  });

  ipcMain.handle('meeting:transcribe', async (_e, { id, track, seg, baseUrl, key, model, language, prompt }) => {
    const file = trackFile(id, track, seg);
    let buf;
    try { buf = await fs.readFile(file); } catch { return { ok: true, empty: true }; }
    if (buf.length < 2000) return { ok: true, empty: true };
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/webm' }), `${track}-${seg}.webm`);
    form.append('model', model || 'whisper');
    form.append('response_format', 'verbose_json');
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', String(prompt).slice(0, 600));
    try {
      const res = await net.fetch(`${base(baseUrl)}/audio/transcriptions`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
        signal: AbortSignal.timeout(30 * 60 * 1000),
      });
      if (!res.ok) return { ok: false, error: await failText(res) };
      return { ok: true, result: await res.json() };
    } catch (err) {
      logLine && logLine('warn', 'meeting:transcribe', err && err.message);
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // Quién habla cuándo en la pista del sistema: un servicio opcional con `POST /diarize` (fichero + num_speakers).
  ipcMain.handle('meeting:diarize', async (_e, { id, baseUrl, key, numSpeakers }) => {
    let buf;
    try { buf = await fs.readFile(trackFile(id, 'sysall', 0)); } catch { return { ok: true, empty: true }; }
    if (buf.length < 2000) return { ok: true, empty: true };
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/webm' }), 'sys.webm');
    const n = Math.round(Number(numSpeakers) || 0);
    if (n >= 2 && n <= 20) form.append('num_speakers', String(n));
    try {
      const res = await net.fetch(`${base(baseUrl)}/diarize`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      if (!res.ok) return { ok: false, error: await failText(res) };
      return { ok: true, result: await res.json() };
    } catch (err) {
      logLine && logLine('warn', 'meeting:diarize', err && err.message);
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('meeting:chat', async (_e, { baseUrl, key, model, messages, json, maxTokens }) => {
    const body = { model, messages, max_tokens: maxTokens || 4096, temperature: 0.2, stream: false };
    if (json) body.response_format = { type: 'json_object' };
    try {
      const res = await net.fetch(`${base(baseUrl)}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      if (!res.ok) return { ok: false, error: await failText(res) };
      const j = await res.json();
      const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      return text ? { ok: true, text: String(text) } : { ok: false, error: 'empty answer' };
    } catch (err) {
      logLine && logLine('warn', 'meeting:chat', err && err.message);
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // Comprobación de la conexión desde Ajustes.
  ipcMain.handle('meeting:test', async (_e, { baseUrl, key }) => {
    try {
      const res = await net.fetch(`${base(baseUrl)}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { ok: false, error: await failText(res) };
      const j = await res.json();
      const ids = ((j && j.data) || []).map(m => m && m.id).filter(Boolean);
      return { ok: true, models: ids };
    } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
  });
}

module.exports = { register };
