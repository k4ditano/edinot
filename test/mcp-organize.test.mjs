// Iconos, fijado y organización desde el MCP: set_icon, pin_note, get_workspace_tree, organize,
// y los iconos en create_note / create_folder / list_*. Todo contra un hub aislado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edinot-organize-'));
const { startHub } = await import('../hub/hub.mjs');

let hub, mcp;
const waiters = new Map(); let buf = ''; let id = 0;
const rpc = (method, params) => new Promise((res) => { const i = ++id; waiters.set(i, res); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = (r.result && r.result.content ? r.result.content : []).map(c => c.text || '').join('');
  let data = text; try { data = JSON.parse(text); } catch {}
  return { ok: !(r.error || (r.result && r.result.isError)), data, text: text || JSON.stringify(r.error || '') };
};
const body = async (name) => { const r = await call('read_note', { name }); return typeof r.data === 'object' ? r.data.content : r.text; };

test.before(async () => {
  fs.mkdirSync(path.join(tmp, 'cfg'), { recursive: true });
  hub = await startHub({ dir: path.join(tmp, 'hub'), port: 0, connectionTimeoutMs: 800 });
  mcp = spawn(process.execPath, ['mcp/server.mjs'], {
    cwd: root, stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, 'cfg'), EDINOT_HUB_DIR: path.join(tmp, 'hub'), NODE_NO_WARNINGS: '1' },
  });
  mcp.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } catch {}
    }
  });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
});
test.after(async () => {
  try { mcp.kill(); } catch {}
  try { await hub.stop(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
});


test('set_icon cambia el icono de nota, carpeta y vault, y list_* lo devuelven', async () => {
  await call('create_vault', { name: 'Trabajo' });
  assert.equal((await call('create_folder', { name: 'Clientes', vault: 'Trabajo', icon: '💼' })).ok, true);
  await call('create_note', { name: 'Acta lunes', vault: 'Trabajo', folder: 'Clientes', content: 'x' });

  const n = await call('set_icon', { note: 'Acta lunes', icon: '📝' });
  assert.equal(n.ok, true, n.text);
  assert.equal(n.data.icon, '📝');
  const fo = await call('set_icon', { folder: 'Clientes', vault: 'Trabajo', icon: '🤝' });
  assert.equal(fo.ok, true, fo.text);
  const v = await call('set_icon', { vault: 'Trabajo', icon: '🏢' });
  assert.equal(v.ok, true, v.text);

  const notes = (await call('list_notes', { vault: 'Trabajo' })).data;
  const acta = notes.find(x => x.name === 'Acta lunes.md');
  assert.equal(acta.icon, '📝');
  assert.equal(acta.folder, 'Clientes');
  assert.equal((await call('list_folders', { vault: 'Trabajo' })).data[0].icon, '🤝');
  assert.equal((await call('list_vaults')).data.find(x => x.name === 'Trabajo').icon, '🏢');

  const cleared = await call('set_icon', { note: 'Acta lunes', icon: '' });
  assert.equal(cleared.ok, true, cleared.text);
  assert.equal((await call('list_notes', { vault: 'Trabajo' })).data.find(x => x.name === 'Acta lunes.md').icon, undefined);
});

test('set_icon rechaza palabras y destinos inexistentes', async () => {
  const bad = await call('set_icon', { note: 'Acta lunes', icon: 'folder' });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /single emoji/);
  assert.equal((await call('set_icon', { note: 'No existe', icon: '📄' })).ok, false);
  assert.equal((await call('set_icon', { icon: '📄' })).ok, false);
  assert.equal((await call('set_icon', { note: 'Acta lunes', icon: '🇪🇸' })).ok, true, 'banderas');
  assert.equal((await call('set_icon', { note: 'Acta lunes', icon: '👩‍💻' })).ok, true, 'secuencias ZWJ');
});

test('create_note con icono y pin_note', async () => {
  const c = await call('create_note', { name: 'Ideas', icon: '💡', content: 'hola' });
  assert.equal(c.ok, true, c.text);
  assert.equal((await call('pin_note', { note: 'Ideas' })).data.pinned, true);
  let ideas = (await call('list_notes')).data.find(x => x.name === 'Ideas.md');
  assert.equal(ideas.icon, '💡');
  assert.equal(ideas.pinned, true);
  await call('pin_note', { note: 'Ideas', pinned: false });
  ideas = (await call('list_notes')).data.find(x => x.name === 'Ideas.md');
  assert.equal(ideas.pinned, undefined);
  assert.equal(await body('Ideas'), 'hola', 'el contenido no cambia');
});

test('organize crea, mueve, renombra, pone iconos y sigue tras un fallo', async () => {
  await call('create_note', { name: 'Factura 1', vault: 'Trabajo', content: 'f1' });
  await call('create_note', { name: 'Factura 2', vault: 'Trabajo', content: 'f2' });
  const r = await call('organize', { operations: [
    { op: 'create_folder', name: 'Facturas', vault: 'Trabajo', icon: '🧾' },
    { op: 'create_folder', name: '2026', vault: 'Trabajo', parent: 'Facturas' },
    { op: 'move_note', note: 'Factura 1', vault: 'Trabajo', folder: 'Facturas/2026' },
    { op: 'move_note', note: 'Factura 2', vault: 'Trabajo', folder: 'Facturas/2026' },
    { op: 'move_note', note: 'No existe', folder: 'Facturas' },
    { op: 'rename_note', note: 'Factura 2', newName: 'Factura 2 (pagada)' },
    { op: 'set_icon', note: 'Factura 2 (pagada)', icon: '✅' },
    { op: 'rename_folder', folder: 'Clientes', vault: 'Trabajo', newName: 'Clientes activos' },
    { op: 'move_folder', folder: 'Clientes activos', vault: 'Trabajo', parent: 'Facturas' },
    { op: 'pin_note', note: 'Factura 1' },
  ] });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.data.done, 9, r.text);
  assert.equal(r.data.failed, 1);
  assert.equal(r.data.results[4].ok, false);
  assert.match(r.data.results[4].error, /not found/);

  const notes = (await call('list_notes', { vault: 'Trabajo' })).data;
  const f1 = notes.find(x => x.name === 'Factura 1.md');
  assert.equal(f1.folder, 'Facturas/2026');
  assert.equal(f1.pinned, true);
  const f2 = notes.find(x => x.name === 'Factura 2 (pagada).md');
  assert.equal(f2.icon, '✅');
  assert.equal(f2.folder, 'Facturas/2026');
  const folders = (await call('list_folders', { vault: 'Trabajo' })).data;
  assert.equal(folders.find(x => x.name === 'Facturas').icon, '🧾');
  assert.equal(folders.find(x => x.name === 'Clientes activos').path, 'Facturas/Clientes activos');
  assert.equal(await body('Factura 1'), 'f1');
});

test('get_workspace_tree dibuja vaults, carpetas anidadas y notas con iconos', async () => {
  const r = await call('get_workspace_tree', { vault: 'Trabajo' });
  assert.equal(r.ok, true, r.text);
  const t = r.text;
  assert.match(t, /^🏢 Trabajo {2}\[vault /m);
  assert.match(t, /^ {2}🧾 Facturas\/ {2}\[folder [^\]]+\] \(0\)$/m);
  assert.match(t, /^ {4}📁 2026\/ {2}\[folder [^\]]+\] \(2\)$/m);
  assert.match(t, /^ {6}📄 Factura 1 📌 {2}\[/m);
  assert.match(t, /^ {6}✅ Factura 2 \(pagada\) {2}\[/m);
  assert.match(t, /^ {4}🤝 Clientes activos\/ {2}\[folder [^\]]+\] \(1\)$/m);
  assert.match(t, /^ {6}👩‍💻 Acta lunes {2}\[/m);
  const lines = t.split('\n');
  assert.ok(lines.findIndex(l => l.includes('2026/')) < lines.findIndex(l => l.includes('Factura 1')), '2026 antes que sus notas');
  const foldersOnly = await call('get_workspace_tree', { vault: 'Trabajo', notes: false });
  assert.doesNotMatch(foldersOnly.text, /Factura 1/);
  assert.match(foldersOnly.text, /\(2 notes\)/);
  assert.equal((await call('get_workspace_tree', { vault: 'Nada' })).ok, false);
});
