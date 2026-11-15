// Which address ends up in a pairing link: an admin's explicit one, else the hub's configured public
// address, else (only if it has none) the one the asking client used. The configured address must beat
// the client's: a client that came in through a tunnel or a LAN address would hand out a link that
// no other computer can use.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dirA = mkdtempSync(path.join(os.tmpdir(), 'edinot-purl-a-'));
const dirB = mkdtempSync(path.join(os.tmpdir(), 'edinot-purl-b-'));
const { startHub } = await import('./hub.mjs');
const { api } = await import('../cli/lib.mjs');

let withPublic, withoutPublic, tokA, tokB;
test.before(async () => {
  withPublic = await startHub({ dir: dirA, port: 0, publicUrl: 'https://hub.example.test', connectionTimeoutMs: 800 });
  withoutPublic = await startHub({ dir: dirB, port: 0, connectionTimeoutMs: 800 });
  tokA = (await api.login(withPublic.info.url, 'local', withPublic.info.key)).token;
  tokB = (await api.login(withoutPublic.info.url, 'local', withoutPublic.info.key)).token;
});
test.after(async () => {
  try { await withPublic.stop(); await withoutPublic.stop(); } catch {}
  try { rmSync(dirA, { recursive: true, force: true }); rmSync(dirB, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
});

const start = async (hub, token, body) => {
  const r = await fetch(hub.info.url + '/pair/start', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  assert.equal(r.status, 200);
  return r.json();
};
const baseOf = (p) => (p.uri ? decodeURIComponent(new URL(p.uri).searchParams.get('u')) : null);

test('the configured public address beats the one the client used', async () => {
  const p = await start(withPublic, tokA, { fallbackUrl: 'http://127.0.0.1:55555' });
  assert.equal(baseOf(p), 'https://hub.example.test');
});

test('an admin can still force an address explicitly', async () => {
  const p = await start(withPublic, tokA, { url: 'https://other.example.test' });
  assert.equal(baseOf(p), 'https://other.example.test');
});

test('without a configured address the client\'s one is the fallback', async () => {
  const p = await start(withoutPublic, tokB, { fallbackUrl: 'https://client.example.test:17870' });
  assert.equal(baseOf(p), 'https://client.example.test:17870');
});

test('garbage addresses are ignored instead of ending up in a link', async () => {
  const p = await start(withoutPublic, tokB, { fallbackUrl: 'javascript:alert(1)', url: 'not a url' });
  assert.equal(p.uri, null);
  const q = await start(withPublic, tokA, { fallbackUrl: 'file:///etc/passwd' });
  assert.equal(baseOf(q), 'https://hub.example.test');
});
