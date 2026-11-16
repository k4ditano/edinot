// Editar una nota por MCP sin reescribirla entera: replace_in_note, insert_in_note y edit_section tocan solo
// el tramo pedido, fallan con un mensaje útil si no hay una única coincidencia, y lo borrado se puede
// listar y restaurar (list_trash / restore_note).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edinot-edit-note-'));
const { startHub } = await import('../hub/hub.mjs');

let hub, mcp;
const waiters = new Map(); let buf = ''; let id = 0;
const rpc = (method, params) => new Promise((res) => { const i = ++id; waiters.set(i, res); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
// Devuelve { ok, data } para poder comprobar también los errores.
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = (r.result && r.result.content ? r.result.content : []).map(c => c.text || '').join('');
  let data = text; try { data = JSON.parse(text); } catch {}
  return { ok: !(r.error || (r.result && r.result.isError)), data, text: text || JSON.stringify(r.error || '') };
};
const read = async (name) => (await call('read_note', { name })).data.content ?? (await call('read_note', { name })).text;

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
  setTimeout(() => process.exit(process.exitCode || 0), 300).unref();   // Hocuspocus deja un temporizador
});

const BODY = '# Plan\n\nIntro con 😀 y precio 10 €.\n\n## Tareas\n\n- [ ] uno\n- [ ] dos\n\n## Notas\n\nTexto final.\n';

test('replace_in_note cambia solo ese texto y respeta el resto (incluido un emoji)', async () => {
  await call('create_note', { name: 'Edicion', content: BODY });
  const r = await call('replace_in_note', { name: 'Edicion', find: 'precio 10 €', replace: 'precio 12 €' });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.data.replaced, 1);
  assert.equal(await read('Edicion'), BODY.replace('precio 10 €', 'precio 12 €'));
});

test('replace_in_note falla con un mensaje útil si no hay UNA coincidencia, y nunca edita a ciegas', async () => {
  const none = await call('replace_in_note', { name: 'Edicion', find: 'no existe', replace: 'x' });
  assert.equal(none.ok, false); assert.match(none.text, /not found/);
  const many = await call('replace_in_note', { name: 'Edicion', find: '- [ ] ', replace: '- [x] ' });
  assert.equal(many.ok, false); assert.match(many.text, /appears 2 times/);
  assert.match(many.text, /occurrence|replaceAll/);
  const before = await read('Edicion');
  assert.equal(before.includes('- [x]'), false, 'el fallo no tocó la nota');
  const second = await call('replace_in_note', { name: 'Edicion', find: '- [ ] ', replace: '- [x] ', occurrence: 2 });
  assert.equal(second.ok, true, second.text);
  assert.match(await read('Edicion'), /- \[ \] uno\n- \[x\] dos/);
  const all = await call('replace_in_note', { name: 'Edicion', find: '- [', replace: '* [', replaceAll: true });
  assert.equal(all.data.replaced, 2);
});

test('insert_in_note: principio, final, antes/después de un texto y en una sección', async () => {
  await call('create_note', { name: 'Insertar', content: BODY });
  await call('insert_in_note', { name: 'Insertar', text: 'AVISO', position: 'start' });
  await call('insert_in_note', { name: 'Insertar', text: 'FIN', position: 'end' });
  await call('insert_in_note', { name: 'Insertar', text: ' (revisado)', position: 'after', anchor: 'Texto final.' });
  await call('insert_in_note', { name: 'Insertar', text: '- [ ] tres', position: 'after', heading: 'Tareas' });
  const t = await read('Insertar');
  assert.ok(t.startsWith('AVISO\n# Plan'), t);
  assert.ok(t.endsWith('FIN') || t.endsWith('FIN\n'), t);
  assert.match(t, /Texto final\. \(revisado\)/);
  assert.match(t, /## Tareas\n\n- \[ \] uno\n- \[ \] dos\n- \[ \] tres\n\n## Notas/);
  const bad = await call('insert_in_note', { name: 'Insertar', text: 'x', position: 'after' });
  assert.equal(bad.ok, false); assert.match(bad.text, /anchor/);
  const noHead = await call('insert_in_note', { name: 'Insertar', text: 'x', position: 'after', heading: 'Inexistente' });
  assert.equal(noHead.ok, false); assert.match(noHead.text, /heading not found/);
});

test('edit_section sustituye solo el cuerpo de esa sección', async () => {
  await call('create_note', { name: 'Seccion', content: BODY });
  const r = await call('edit_section', { name: 'Seccion', heading: 'Tareas', content: '- [ ] nueva A\n- [ ] nueva B' });
  assert.equal(r.ok, true, r.text);
  assert.equal(await read('Seccion'), '# Plan\n\nIntro con 😀 y precio 10 €.\n\n## Tareas\n- [ ] nueva A\n- [ ] nueva B\n\n## Notas\n\nTexto final.\n');
  const last = await call('edit_section', { name: 'Seccion', heading: '## Notas', content: 'Cierre.' });
  assert.equal(last.ok, true, last.text);
  assert.ok((await read('Seccion')).endsWith('## Notas\nCierre.\n'));
});

test('lo borrado se lista y se restaura con su contenido', async () => {
  await call('create_note', { name: 'Efimera', content: 'contenido importante' });
  await call('delete_note', { name: 'Efimera' });
  const trash = await call('list_trash');
  const item = trash.data.trash.find(t => /Efimera/.test(t.name));
  assert.ok(item, 'aparece en la papelera');
  const r = await call('restore_note', { name: 'Efimera' });
  assert.equal(r.ok, true, r.text);
  assert.equal(await read('Efimera'), 'contenido importante');
  assert.equal((await call('list_trash')).data.trash.some(t => /Efimera/.test(t.name)), false);
  assert.equal((await call('restore_note', { name: 'Efimera' })).ok, false, 'ya no está en la papelera');
});
