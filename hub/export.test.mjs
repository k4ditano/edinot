// Exportación a Markdown (cli/export.mjs) sobre un hub real.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';

const hubDir = mkdtempSync(path.join(os.tmpdir(), 'edinot-exp-hub-'));
const out = mkdtempSync(path.join(os.tmpdir(), 'edinot-exp-out-'));
const { startHub } = await import('./hub.mjs');
const { api, ops } = await import('../cli/lib.mjs');
const { exportMarkdown, safeSegment } = await import('../cli/export.mjs');

let hub, token, s;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let sha;

test.before(async () => {
  hub = await startHub({ dir: hubDir, port: 0 });
  token = (await api.login(hub.info.url, 'local', hub.info.key)).token;
  s = await ops.open({ server: hub.info.url, token, workspaceId: 1 });
});
test.after(async () => {
  try { await s.close(); } catch {}
  try { await hub.stop(); } catch {}
  for (const d of [hubDir, out]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

const fetchBlob = (h) => api.blobFetch(hub.info.url, token, h);

test('nombres seguros: sin separadores, sin puntos al inicio, sin vacíos', () => {
  assert.equal(safeSegment('a/b\\c:d?e'), 'a_b_c_d_e');
  assert.equal(safeSegment('..oculto'), '_oculto');
  assert.equal(safeSegment('   '), 'sin-nombre');
  assert.equal(safeSegment('fin. '), 'fin');
});

test('prepara notas en carpetas, con adjunto y nombres repetidos', async () => {
  await s.createFolder('Proyectos', 'default', null);
  const a = await s.createFile('plan', 'default', 'Proyectos');
  await s.writeContent(a.id, '# Plan\n\nTexto con tildes: canción.\n');
  const b = await s.createFile('suelta', 'default');
  const up = await api.blobUpload(hub.info.url, token, { buffer: PNG, mime: 'image/png', filename: 'p.png' });
  sha = up.id;
  await s.writeContent(b.id, `# Suelta\n\n![punto](edinot://blob/${sha})\n`);
  // Dos notas con el mismo nombre en la misma carpeta.
  const c1 = await s.createFile('igual', 'default', 'Proyectos');
  const c2 = await s.createFile('igual', 'default', 'Proyectos');
  await s.writeContent(c1.id, 'uno'); await s.writeContent(c2.id, 'dos');
  await s.flush();
});

test('exporta con carpetas, contenido idéntico y sin perder notas de nombre repetido', async () => {
  const rep = await exportMarkdown(s, out);
  assert.deepEqual(rep.failed, []);
  assert.equal(rep.notes, 4);
  const plan = path.join(out, 'default', 'Proyectos', 'plan.md');
  assert.equal(readFileSync(plan, 'utf8'), '# Plan\n\nTexto con tildes: canción.\n');
  assert.ok(existsSync(path.join(out, 'default', 'suelta.md')));
  const igual = readdirSync(path.join(out, 'default', 'Proyectos')).filter(f => f.startsWith('igual')).sort();
  assert.equal(igual.length, 2, `las dos notas «igual» existen: ${igual}`);
  const bodies = igual.map(f => readFileSync(path.join(out, 'default', 'Proyectos', f), 'utf8')).sort();
  assert.deepEqual(bodies, ['dos', 'uno']);
});

test('sin adjuntos el enlace queda como está; con adjuntos pasa a un enlace relativo que se ve', async () => {
  assert.match(readFileSync(path.join(out, 'default', 'suelta.md'), 'utf8'), /edinot:\/\/blob\//);
  const rep = await exportMarkdown(s, out, { attachments: true, fetchBlob });
  assert.equal(rep.attachments, 1);
  const txt = readFileSync(path.join(out, 'default', 'suelta.md'), 'utf8');
  assert.match(txt, /\(\.\.\/_attachments\/[a-f0-9]{64}\.png\)/);
  assert.deepEqual(readFileSync(path.join(out, '_attachments', sha + '.png')), PNG);
});

test('volver a exportar no reescribe lo que no cambió', async () => {
  const f = path.join(out, 'default', 'Proyectos', 'plan.md');
  const before = statSync(f).mtimeMs;
  await new Promise(r => setTimeout(r, 30));
  const rep = await exportMarkdown(s, out, { attachments: true, fetchBlob });
  assert.equal(rep.rewritten, 0);
  assert.equal(statSync(f).mtimeMs, before);
});

test('al renombrar una nota se retira solo el archivo viejo; los archivos ajenos no se tocan', async () => {
  writeFileSync(path.join(out, 'default', 'mio-no-tocar.md'), 'ajeno');
  writeFileSync(path.join(out, 'notas-personales.txt'), 'ajeno');
  const plan = s.findFileByName('plan');
  await s.renameFile(plan.id, 'plan-nuevo');
  await s.flush();
  const rep = await exportMarkdown(s, out, { attachments: true, fetchBlob });
  assert.equal(rep.removed, 1);
  assert.ok(!existsSync(path.join(out, 'default', 'Proyectos', 'plan.md')));
  assert.ok(existsSync(path.join(out, 'default', 'Proyectos', 'plan-nuevo.md')));
  assert.equal(readFileSync(path.join(out, 'default', 'mio-no-tocar.md'), 'utf8'), 'ajeno');
  assert.equal(readFileSync(path.join(out, 'notas-personales.txt'), 'utf8'), 'ajeno');
});

test('exportar solo un vault no borra lo exportado de otros', async () => {
  await s.createVault('Otro');
  const o = await s.createFile('en-otro', 'Otro');
  await s.writeContent(o.id, 'otro vault');
  await s.flush();
  await exportMarkdown(s, out, { attachments: true, fetchBlob });
  assert.ok(existsSync(path.join(out, 'Otro', 'en-otro.md')));
  const rep = await exportMarkdown(s, out, { vault: 'Otro', attachments: true, fetchBlob });
  assert.equal(rep.removed, 0);
  assert.ok(existsSync(path.join(out, 'default', 'suelta.md')), 'el otro vault sigue ahí');
  assert.ok(existsSync(path.join(out, 'Otro', 'en-otro.md')));
});
