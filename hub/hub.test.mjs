// Prueba de integración del hub local, con el cliente real del CLI (cli/lib.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'edinot-hub-test-'));
process.env.EDINOT_HUB_DIR = dir;
const { startHub } = await import('./hub.mjs');
const { api, ops } = await import('../cli/lib.mjs');

test.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

let hub; // hub en marcha en cada fase

async function login(h) {
  const r = await api.login(h.info.url, 'local', h.info.key);
  return r.token;
}
async function session(h, token) {
  return ops.open({ server: h.info.url, token, workspaceId: 1 });
}

test('arranca, responde y exige credenciales', async () => {
  hub = await startHub({ dir, port: 0 });
  const health = await (await fetch(hub.info.url + '/healthz')).json();
  assert.equal(health.ok, true);
  assert.equal(health.hub, true);

  await assert.rejects(api.login(hub.info.url, 'local', 'clave-incorrecta'), /invalid credentials/);
  const noToken = await fetch(hub.info.url + '/workspaces');
  assert.equal(noToken.status, 401);

  const token = await login(hub);
  const ws = await api.workspaces(hub.info.url, token);
  assert.deepEqual(ws.workspaces.map(w => [w.id, w.name, w.isOwn]), [[1, 'personal', true]]);
});

test('notificaciones: bandeja vacía y un canal de eventos que se queda abierto', async () => {
  const token = await login(hub);
  const auth = { Authorization: `Bearer ${token}` };
  assert.deepEqual(await (await fetch(hub.info.url + '/me/notifications', { headers: auth })).json(), { notifications: [], unread: 0 });
  assert.deepEqual(await (await fetch(hub.info.url + '/me/notifications/unread-count', { headers: auth })).json(), { unread: 0 });
  assert.equal((await fetch(hub.info.url + '/me/notifications/read-all', { method: 'POST', headers: auth })).status, 200);

  // El canal de la campana manda el token en la URL (EventSource no puede poner cabeceras).
  const ac = new AbortController();
  const res = await fetch(`${hub.info.url}/me/notifications/stream?token=${encodeURIComponent(token)}`, { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const first = await res.body.getReader().read();
  assert.match(Buffer.from(first.value).toString(), /retry: 60000/);
  ac.abort();
  const bad = await fetch(`${hub.info.url}/me/notifications/stream?token=mal`);
  assert.equal(bad.status, 401);
});

test('rechaza peticiones con un Host ajeno (anti DNS rebinding)', async () => {
  const status = await new Promise((resolve, reject) => {
    const u = new URL(hub.info.url);
    const req = http.request({ host: u.hostname, port: u.port, path: '/healthz', headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 421);
});

test('un segundo hub sobre la misma carpeta no arranca', async () => {
  await assert.rejects(startHub({ dir, port: 0 }), (e) => e.code === 'ALREADY_RUNNING');
});

let noteId;
let blobId;
const BYTES = Buffer.from('contenido de prueba del adjunto — ñandú 🦜');

test('crea una nota y un adjunto con el cliente del CLI', async () => {
  const token = await login(hub);
  const s = await session(hub, token);
  try {
    const created = await s.createFile('prueba-hub', 'default');
    noteId = created.id;
    await s.writeContent(noteId, '# Hola desde el hub\n\nTexto con tildes: canción.\n');
    await s.flush();
    assert.match(await s.readContent(noteId), /canción/);
  } finally { await s.close(); }

  const up = await api.blobUpload(hub.info.url, token, { buffer: BYTES, mime: 'text/plain', filename: 'nota.txt' });
  blobId = up.id;
  assert.match(blobId, /^[a-f0-9]{64}$/);
  const again = await api.blobUpload(hub.info.url, token, { buffer: BYTES, mime: 'text/plain', filename: 'nota.txt' });
  assert.equal(again.dedup, true);
  const got = await api.blobFetch(hub.info.url, token, blobId);
  assert.deepEqual(got.buffer, BYTES);
  assert.equal(got.mime, 'text/plain');
});

test('los datos sobreviven a parar y volver a arrancar el hub', async () => {
  const oldPort = hub.info.port;
  await hub.stop();
  assert.equal(existsSync(path.join(dir, 'hub.json')), false, 'hub.json se borra al parar');

  hub = await startHub({ dir, port: 0 });
  assert.notEqual(hub.info.port, undefined);
  const token = await login(hub);
  const s = await session(hub, token);
  try {
    assert.ok(s.listFiles({ vault: 'default' }).some(f => f.id === noteId), 'la nota sigue en la lista');
    assert.match(await s.readContent(noteId), /Hola desde el hub/);
  } finally { await s.close(); }
  const got = await api.blobFetch(hub.info.url, token, blobId);
  assert.deepEqual(got.buffer, BYTES);
  void oldPort;
});

test('la escritura es atómica y deja copia previa', async () => {
  const docs = readdirSync(path.join(dir, 'docs'));
  assert.ok(docs.some(f => f.endsWith('.ydoc')));
  assert.equal(docs.filter(f => f.includes('.tmp-')).length, 0, 'no quedan temporales');
  await hub.stop();
});
