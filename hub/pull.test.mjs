// El puente `pullWorkspace`: un hub (A) hace de «servidor remoto» y otro (B), vacío, recibe la copia.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dirA = mkdtempSync(path.join(os.tmpdir(), 'edinot-pull-A-'));
const dirB = mkdtempSync(path.join(os.tmpdir(), 'edinot-pull-B-'));
const { startHub } = await import('./hub.mjs');
const { pullWorkspace } = await import('./pull.mjs');
const { api, ops } = await import('../cli/lib.mjs');

let A, B, tokA, tokB;
const BYTES = Buffer.from('adjunto de prueba — ñandú 🦜 '.repeat(50));
let blobSha;
let noteIds = [];

test.before(async () => {
  A = await startHub({ dir: dirA, port: 0 });
  B = await startHub({ dir: dirB, port: 0 });
  tokA = (await api.login(A.info.url, 'local', A.info.key)).token;
  tokB = (await api.login(B.info.url, 'local', B.info.key)).token;
});
test.after(async () => {
  try { await A.stop(); } catch {}
  try { await B.stop(); } catch {}
  for (const d of [dirA, dirB]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

const session = (h, token) => ops.open({ server: h.info.url, token, workspaceId: 1 });
const sides = () => ({
  remote: { server: A.info.url, token: tokA, workspaceId: 1 },
  hub: { server: B.info.url, token: tokB, workspaceId: 1 },
});

test('prepara el «remoto»: notas con documento propio y un adjunto', async () => {
  const s = await session(A, tokA);
  try {
    for (const [name, body] of [['uno', '# Uno\n\nPrimera nota.\n'], ['dos', '# Dos\n\nSegunda nota con tildes: canción.\n']]) {
      const f = await s.createFile(name, 'default');
      noteIds.push(f.id);
      await s.writeContent(f.id, body);
    }
    await s.flush();
    // Abrir otra vez para que existan los documentos por nota en A.
    for (const id of noteIds) await s.readContent(id);
  } finally { await s.close(); }
  const up = await api.blobUpload(A.info.url, tokA, { buffer: BYTES, mime: 'text/plain', filename: 'adj.txt' });
  blobSha = up.id;

  // El adjunto debe estar mencionado en algún documento para que el puente lo encuentre.
  const s2 = await session(A, tokA);
  try {
    const f = s2.findFileByName('uno');
    await s2.writeContent(f.id, `# Uno\n\nPrimera nota.\n\n![adj](edinot://blob/${blobSha})\n`);
    await s2.flush();
  } finally { await s2.close(); }

  const list = await (await fetch(A.info.url + '/workspaces/1/docs', { headers: { Authorization: `Bearer ${tokA}` } })).json();
  assert.ok(list.docs.some(d => d.name === 'ws:1'), 'lista el shell');
  assert.ok(list.docs.some(d => /:note:/.test(d.name)), 'lista documentos de nota');
});

test('trae todo al hub vacío, sin fallos y verificado', async () => {
  const events = [];
  const rep = await pullWorkspace({ ...sides(), onProgress: (e) => events.push(e.kind) });
  assert.deepEqual(rep.failed, [], JSON.stringify(rep.failed));
  assert.deepEqual(rep.notVerified, [], JSON.stringify(rep.notVerified));
  assert.ok(rep.docs >= 4, `documentos copiados: ${rep.docs}`);
  assert.equal(rep.verified, rep.docs);
  assert.equal(rep.blobs.copied, 1);
  assert.deepEqual(rep.blobs.missing, []);
  assert.deepEqual(rep.blobs.failed, []);
  assert.ok(events.includes('done'));
});

test('el contenido llega idéntico y sin duplicar texto', async () => {
  const s = await session(B, tokB);
  try {
    const f = s.findFileByName('dos');
    const body = await s.readContent(f.id);
    assert.equal(body, '# Dos\n\nSegunda nota con tildes: canción.\n');
    assert.equal((body.match(/Segunda nota/g) || []).length, 1, 'el texto no se ha duplicado');
    const uno = s.findFileByName('uno');
    assert.match(await s.readContent(uno.id), /edinot:\/\/blob\//);
  } finally { await s.close(); }
  const got = await api.blobFetch(B.info.url, tokB, blobSha);
  assert.deepEqual(got.buffer, BYTES);
});

test('repetirlo es seguro: las notas ya presentes se saltan y no se duplican', async () => {
  const rep = await pullWorkspace(sides());
  assert.deepEqual(rep.failed, []);
  assert.ok(rep.skippedExisting.length >= 2, `omitidas: ${rep.skippedExisting.length}`);
  assert.equal(rep.blobs.copied, 0);
  assert.equal(rep.blobs.already, 1);
  const s = await session(B, tokB);
  try {
    const body = await s.readContent(s.findFileByName('dos').id);
    assert.equal((body.match(/Segunda nota/g) || []).length, 1);
  } finally { await s.close(); }
});

test('«dryRun» no escribe nada en el hub', async () => {
  const dirC = mkdtempSync(path.join(os.tmpdir(), 'edinot-pull-C-'));
  const C = await startHub({ dir: dirC, port: 0 });
  try {
    const tokC = (await api.login(C.info.url, 'local', C.info.key)).token;
    const rep = await pullWorkspace({ remote: sides().remote, hub: { server: C.info.url, token: tokC, workspaceId: 1 }, dryRun: true });
    assert.deepEqual(rep.failed, []);
    assert.ok(rep.docs >= 4);
    const list = await (await fetch(C.info.url + '/workspaces/1/docs', { headers: { Authorization: `Bearer ${tokC}` } })).json();
    assert.equal(list.docs.length, 0, 'el hub sigue vacío');
  } finally { await C.stop(); rmSync(dirC, { recursive: true, force: true }); }
});
