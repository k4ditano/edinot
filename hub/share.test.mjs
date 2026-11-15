// Acceso compartido por vault: credenciales con alcance, solo lectura y revocación.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

const dir = mkdtempSync(path.join(os.tmpdir(), 'edinot-share-'));
const { startHub } = await import('./hub.mjs');
const { api } = await import('../cli/lib.mjs');

let hub, base, master, wsUrl;
test.before(async () => {
  hub = await startHub({ dir, port: 0, connectionTimeoutMs: 800 });
  base = hub.info.url;
  wsUrl = base.replace('http:', 'ws:');
  master = (await api.login(base, 'local', hub.info.key)).token;
});
test.after(async () => {
  try { await hub.stop(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  // Tras escribir documentos, Hocuspocus deja un temporizador de guardado diferido que mantiene vivo el
  // proceso de prueba (el hub real sale con process.exit al pararse). Se sale a mano, ya con todo cerrado.
  setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
});

const call = (p, { method = 'GET', token, body } = {}) => fetch(base + p, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
async function pairGuest(scope, name = 'invitado') {
  const start = await (await call('/pair/start', { method: 'POST', token: master, body: { url: base, scope } })).json();
  const res = await call('/pair/redeem', { method: 'POST', body: { code: start.code, name } });
  assert.equal(res.status, 200);
  return res.json();
}
// Cierra el proveedor Y su socket (si no, los temporizadores de reconexión dejan el proceso colgado).
function close(prov) {
  try { const ws = prov.configuration && prov.configuration.websocketProvider; prov.destroy(); if (ws) ws.destroy(); } catch {}
}
// Abre un documento y dice si el servidor lo aceptó, y si lo dejó en solo lectura.
function open(name, token, doc = new Y.Doc()) {
  return new Promise((resolve) => {
    const prov = new HocuspocusProvider({ url: wsUrl, name, token, document: doc, WebSocketPolyfill: WebSocket, awareness: null });
    const done = (r) => { clearTimeout(timer); resolve({ ...r, prov, doc }); };
    const timer = setTimeout(() => done({ ok: false, why: 'timeout' }), 4000);
    prov.on('authenticated', ({ scope }) => done({ ok: true, readOnly: scope === 'readonly' }));
    prov.on('authenticationFailed', ({ reason }) => done({ ok: false, why: reason }));
  });
}

test('un invitado con alcance entra solo a su vault; el shell va en solo lectura', async () => {
  const g = await pairGuest({ vaults: ['alfa'], readOnly: false });
  assert.deepEqual(g.scope, { vaults: ['alfa'], readOnly: false });
  const a = await open('ws:1:vault:alfa', g.token);
  assert.equal(a.ok, true); assert.equal(a.readOnly, false); close(a.prov);
  const n = await open('ws:1:vault:alfa:note:n1', g.token);
  assert.equal(n.ok, true); close(n.prov);
  const b = await open('ws:1:vault:beta', g.token);
  close(b.prov);
  assert.equal(b.ok, false);                       // el motivo concreto no se revela al cliente (permission-denied)
  const sh = await open('ws:1', g.token);
  assert.equal(sh.ok, true); assert.equal(sh.readOnly, true); close(sh.prov);
});

test('solo lectura: el invitado ve el vault pero no puede escribir en él', async () => {
  // El anfitrión (credencial completa) escribe una nota.
  const host = await open('ws:1:vault:alfa', master);
  host.doc.getText('content:x').insert(0, 'del anfitrión');
  await new Promise(r => setTimeout(r, 400));
  const g = await pairGuest({ vaults: ['alfa'], readOnly: true }, 'lector');
  const guest = await open('ws:1:vault:alfa', g.token);
  assert.equal(guest.ok, true); assert.equal(guest.readOnly, true);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(guest.doc.getText('content:x').toString(), 'del anfitrión');         // lo ve
  guest.doc.getText('content:x').insert(0, 'INTRUSO ');                               // intenta escribir
  await new Promise(r => setTimeout(r, 600));
  assert.equal(host.doc.getText('content:x').toString(), 'del anfitrión');          // no llega
  close(host.prov); close(guest.prov);
});

test('un invitado no administra el hub, pero puede leer lo básico', async () => {
  const g = await pairGuest({ vaults: ['alfa'], readOnly: false }, 'otro');
  for (const [m, p] of [['POST', '/pair/start'], ['GET', '/devices'], ['GET', '/hub/docs?name=ws:1'], ['GET', '/workspaces/1/docs']]) {
    const r = await call(p, { method: m, token: g.token, body: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal((await r.json()).code, 'scoped');
  }
  assert.equal((await call('/workspaces', { token: g.token })).status, 200);
});

test('el alcance se valida y /devices lo muestra', async () => {
  for (const bad of [{ vaults: [] }, { vaults: ['a b'] }, { vaults: 'alfa' }]) {
    const r = await call('/pair/start', { method: 'POST', token: master, body: { url: base, scope: bad } });
    assert.equal(r.status, 400);
  }
  const list = (await (await call('/devices', { token: master })).json()).devices;
  assert.ok(list.some(d => d.scope && d.scope.vaults.includes('alfa')));
});

test('quitar al invitado corta su acceso al instante', async () => {
  const g = await pairGuest({ vaults: ['alfa'], readOnly: false }, 'efimero');
  assert.equal((await call('/workspaces', { token: g.token })).status, 200);
  const live = await open('ws:1:vault:alfa', g.token);
  assert.equal(live.ok, true);
  const dev = (await (await call('/devices', { token: master })).json()).devices.find(d => d.name === 'efimero');
  assert.equal((await call(`/devices/${dev.id}`, { method: 'DELETE', token: master })).status, 200);
  assert.equal((await call('/workspaces', { token: g.token })).status, 401);
  const again = await open('ws:1:vault:alfa', g.token);
  assert.equal(again.ok, false);
  close(live.prov); close(again.prov);
});
