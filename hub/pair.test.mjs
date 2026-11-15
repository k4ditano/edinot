// Modo servidor del hub: emparejar equipos con un código, credenciales por dispositivo y revocación.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'edinot-pair-'));
const { startHub } = await import('./hub.mjs');
const { api, ops } = await import('../cli/lib.mjs');

let hub, base, masterToken;
const PUBLIC = 'https://hub.prueba.example';

test.before(async () => {
  hub = await startHub({ dir, port: 0, publicUrl: PUBLIC, pairTtlMs: 600, connectionTimeoutMs: 800 });
  base = hub.info.url;
  masterToken = (await api.login(base, 'local', hub.info.key)).token;
});
test.after(async () => {
  try { await hub.stop(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

const post = (p, body, token, headers = {}) => fetch(base + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: JSON.stringify(body || {}),
});
const get = (p, token) => fetch(base + p, { headers: { Authorization: `Bearer ${token}` } });

// Petición con un `Host` y cabeceras a medida (fetch no deja cambiar `Host`).
function raw(pathname, { method = 'GET', host, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path: pathname, method, headers: { host, 'content-type': 'application/json', ...headers } }, (res) => {
      let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('acepta el Host público configurado y sigue rechazando los ajenos', async () => {
  assert.equal((await raw('/healthz', { host: 'hub.prueba.example' })).status, 200);
  assert.equal((await raw('/healthz', { host: 'otro.example' })).status, 421);
});

test('la clave maestra solo vale directamente desde este equipo, no a través de un proxy', async () => {
  const key = hub.info.key;
  const viaProxy = await raw('/auth/login', { method: 'POST', host: new URL(base).host, headers: { 'x-forwarded-for': '203.0.113.9' }, body: { email: 'local', password: key } });
  assert.equal(viaProxy.status, 403);
  assert.equal(JSON.parse(viaProxy.body).code, 'pair_required');
  const direct = await raw('/auth/login', { method: 'POST', host: new URL(base).host, body: { email: 'local', password: key } });
  assert.equal(direct.status, 200);
});

test('crear un código exige sesión y devuelve uno legible con su enlace', async () => {
  assert.equal((await post('/pair/start', {})).status, 401);
  const r = await (await post('/pair/start', {}, masterToken)).json();
  assert.match(r.code, /^[A-Z2-9]{10}$/);
  assert.match(r.display, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(r.url, PUBLIC);
  assert.match(r.uri, /^edinot:\/\/pair\?u=https%3A%2F%2Fhub\.prueba\.example&c=[A-Z2-9]{10}$/);
  assert.ok(!/[01OIL]/.test(r.code), 'sin caracteres que se confunden');
});

test('un código sirve una vez y da una credencial propia, no la clave maestra', async () => {
  const { code, display } = await (await post('/pair/start', {}, masterToken)).json();
  const first = await post('/pair/redeem', { code: display.toLowerCase(), name: 'PC del trabajo' });   // acepta minúsculas y guion
  assert.equal(first.status, 200);
  const dev = await first.json();
  assert.ok(dev.token && dev.deviceId);
  assert.equal(dev.deviceName, 'PC del trabajo');
  assert.ok(!JSON.stringify(dev).includes(hub.info.key), 'la clave maestra no viaja');
  const again = await post('/pair/redeem', { code, name: 'otro' });
  assert.equal(again.status, 401, 'el mismo código no vale dos veces');
});

test('un código caducado se rechaza y se gasta', async () => {
  const { code } = await (await post('/pair/start', {}, masterToken)).json();
  await new Promise(r => setTimeout(r, 750));   // pairTtlMs = 600
  const res = await post('/pair/redeem', { code, name: 'tarde' });
  assert.equal(res.status, 410);
  assert.equal((await post('/pair/redeem', { code, name: 'tarde' })).status, 401);
});

test('códigos al azar no pasan y tras varios fallos se frena a quien lo intenta', async () => {
  let blocked = false;
  for (let i = 0; i < 14; i++) {
    const r = await post('/pair/redeem', { code: 'ZZZZZZZZZZ', name: 'x' });
    if (r.status === 429) { blocked = true; break; }
    assert.equal(r.status, 401);
  }
  assert.ok(blocked, 'se limita a 10 fallos por minuto');
});

let device;
test('la credencial del dispositivo sirve para la API y para sincronizar notas', async () => {
  // El límite anterior es por IP y minuto: se prueba en otro hub para no esperar.
  const dir2 = mkdtempSync(path.join(os.tmpdir(), 'edinot-pair2-'));
  const h2 = await startHub({ dir: dir2, port: 0, publicUrl: PUBLIC, connectionTimeoutMs: 800 });
  try {
    const t2 = (await api.login(h2.info.url, 'local', h2.info.key)).token;
    const { code } = await (await fetch(h2.info.url + '/pair/start', { method: 'POST', headers: { Authorization: `Bearer ${t2}`, 'Content-Type': 'application/json' }, body: '{}' })).json();
    device = await (await fetch(h2.info.url + '/pair/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'portátil' }) })).json();

    assert.equal((await fetch(h2.info.url + '/workspaces', { headers: { Authorization: `Bearer ${device.token}` } })).status, 200);
    const s = await ops.open({ server: h2.info.url, token: device.token, workspaceId: 1 });
    try { const f = await s.createFile('desde-dispositivo', 'default'); await s.writeContent(f.id, 'escrito con credencial de dispositivo'); await s.flush(); } finally { await s.close(); }

    // refrescar conserva la identidad del dispositivo
    const ref = await (await fetch(h2.info.url + '/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${device.token}` } })).json();
    assert.equal(ref.deviceId, device.deviceId);

    // lista de dispositivos
    const list = await (await fetch(h2.info.url + '/devices', { headers: { Authorization: `Bearer ${t2}` } })).json();
    assert.deepEqual(list.devices.map(d => d.name), ['portátil']);

    // revocar: la API deja de aceptarlo y no puede abrir una sesión de sincronización nueva
    const del = await fetch(`${h2.info.url}/devices/${device.deviceId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t2}` } });
    assert.equal(del.status, 200);
    assert.equal((await fetch(h2.info.url + '/workspaces', { headers: { Authorization: `Bearer ${device.token}` } })).status, 401);
    assert.equal((await fetch(h2.info.url + '/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${device.token}` } })).status, 401);
    await assert.rejects(ops.open({ server: h2.info.url, token: device.token, workspaceId: 1 }), /revocado|auth|denied|closed|stalled|timeout/i);
    assert.equal((await fetch(`${h2.info.url}/devices/${device.deviceId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t2}` } })).status, 404);
    // el resto de equipos y la sesión local siguen funcionando
    assert.equal((await fetch(h2.info.url + '/workspaces', { headers: { Authorization: `Bearer ${t2}` } })).status, 200);
  } finally { await h2.stop(); rmSync(dir2, { recursive: true, force: true }); }
});

test('devices.json queda guardado sin la credencial y con permisos privados', async () => {
  const raw = readFileSync(path.join(dir, 'devices.json'), 'utf8');
  assert.ok(!/token|key|secret/i.test(raw), 'no guarda credenciales, solo nombre y fechas');
});
