// Cifrado del hub sin dominio: certificado propio con huella fijada.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'edinot-tls-'));
const dir2 = mkdtempSync(path.join(os.tmpdir(), 'edinot-tls2-'));
const { startHub } = await import('./hub.mjs');
const { ensureServerCert, pinFromLink, registerPin, hubFetch, webSocketFor, fingerprintOfPem } = await import('./tls.mjs');

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let hub, port, base;

test.before(async () => {
  port = await freePort();
  base = `https://127.0.0.1:${port}`;
  hub = await startHub({ dir, port, host: '127.0.0.1', tls: true, publicUrl: base, connectionTimeoutMs: 800 });
});
test.after(async () => {
  try { await hub.stop(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true }); } catch {}
});

test('el hub sirve por TLS y el enlace lleva la huella de su certificado', () => {
  assert.equal(hub.info.tls, true);
  assert.equal(hub.info.port, port);
  const p = hub.createPairing();
  assert.ok(p.uri.includes(`&f=${hub.info.fingerprint}`), p.uri);
  assert.equal(p.fingerprint, hub.info.fingerprint);
  assert.match(hub.info.fingerprint, /^[A-Za-z0-9_-]{43}$/);
});

test('sin fijar el certificado, el cliente NO se conecta (es autofirmado)', async () => {
  await assert.rejects(hubFetch(base + '/healthz'));
});

test('una huella equivocada se rechaza; la correcta devuelve el certificado a fijar', async () => {
  await assert.rejects(pinFromLink(base, 'A'.repeat(43)), /NO coincide/);
  const pem = await pinFromLink(base, hub.info.fingerprint);
  assert.equal(fingerprintOfPem(pem), hub.info.fingerprint);
});

test('con el certificado fijado funcionan HTTP y WebSocket', async () => {
  registerPin(base, await pinFromLink(base, hub.info.fingerprint));
  const r = await hubFetch(base + '/healthz');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).hub, true);
  const WS = webSocketFor(base.replace('https:', 'wss:'));
  await new Promise((resolve, reject) => {
    const ws = new WS(base.replace('https:', 'wss:') + '/');
    ws.on('open', () => { ws.close(); resolve(); });
    ws.on('error', reject);
  });
});

test('por TLS se puede canjear un código y la credencial de equipo funciona', async () => {
  const p = hub.createPairing();
  const res = await hubFetch(base + '/pair/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: p.code, name: 'prueba' }) });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(j.token && j.deviceId);
  const dev = await hubFetch(base + '/devices', { headers: { authorization: `Bearer ${j.token}` } });
  assert.equal(dev.status, 200);
});

test('un servidor con OTRO certificado (alguien en medio) se rechaza aunque el nombre coincida', async () => {
  const other = await ensureServerCert(dir2, ['127.0.0.1']);
  assert.notEqual(other.fp, hub.info.fingerprint);
  // el hub real, pero el cliente cree que debe ver el otro certificado
  registerPin(base, other.cert);
  await assert.rejects(hubFetch(base + '/healthz'));
  registerPin(base, await pinFromLink(base, hub.info.fingerprint));   // restaurar
});

test('el certificado se conserva entre arranques (los equipos emparejados siguen valiendo)', async () => {
  const again = await ensureServerCert(dir, ['127.0.0.1']);
  assert.equal(again.fp, hub.info.fingerprint);
});
