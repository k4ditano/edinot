// Herramientas MCP que faltaban: duplicar nota, etiquetas, borrar adjunto, quitar conexiones del canvas
// y editar comentarios. Todo contra un hub aislado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edinot-gaps-'));
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

test('duplicate_note copia el contenido, no pisa nombres y puede ir a otra bóveda', async () => {
  await call('create_note', { name: 'Original', content: '# Título\n\nTexto con #idea y una tabla.\n' });
  const c1 = await call('duplicate_note', { name: 'Original' });
  assert.equal(c1.ok, true, c1.text);
  assert.equal(c1.data.name, 'Original (copy).md');
  assert.equal(await body('Original (copy)'), '# Título\n\nTexto con #idea y una tabla.\n');
  const c2 = await call('duplicate_note', { name: 'Original' });
  assert.equal(c2.data.name, 'Original (copy) 2.md');
  assert.equal(await body('Original'), '# Título\n\nTexto con #idea y una tabla.\n', 'el original no cambia');
  await call('create_vault', { name: 'Otra' });
  const c3 = await call('duplicate_note', { name: 'Original', newName: 'Copia aparte', vault: 'Otra' });
  assert.equal(c3.ok, true, c3.text);
  assert.equal(c3.data.vault, 'Otra');
  assert.equal((await call('duplicate_note', { name: 'No existe' })).ok, false);
});

test('duplicate_note copia un canvas con sus nodos y conexiones', async () => {
  await call('create_canvas', { name: 'Mapa' });
  const a = await call('add_canvas_node', { name: 'Mapa', kind: 'text', text: 'A' });
  const b = await call('add_canvas_node', { name: 'Mapa', kind: 'text', text: 'B' });
  assert.ok(a.data.id || (a.data.node && a.data.node.id), a.text);
  const ida = a.data.id || a.data.node.id, idb = b.data.id || b.data.node.id;
  await call('connect_canvas_nodes', { name: 'Mapa', from: ida, to: idb });
  const dup = await call('duplicate_note', { name: 'Mapa', newName: 'Mapa copia' });
  assert.equal(dup.ok, true, dup.text);
  const src = (await call('read_canvas', { name: 'Mapa' })).data;
  const cpy = (await call('read_canvas', { name: 'Mapa copia' })).data;
  assert.equal(cpy.nodes.length, src.nodes.length);
  assert.equal(cpy.edges.length, 1);
  assert.deepEqual(cpy.nodes.map(n => n.text).sort(), ['A', 'B']);
});

test('add_tag y remove_tag editan solo las etiquetas', async () => {
  await call('create_note', { name: 'Etiquetas', content: '# Nota\n\nTexto con #uno y #unos.\n\n```\n#uno en código\n```\n' });
  assert.equal((await call('add_tag', { name: 'Etiquetas', tag: '#nuevo' })).data.added, true);
  assert.ok((await body('Etiquetas')).endsWith('```\n\n#nuevo\n'));
  assert.equal((await call('add_tag', { name: 'Etiquetas', tag: 'otro' })).data.added, true);
  assert.ok((await body('Etiquetas')).endsWith('#nuevo #otro\n'), 'se añade en la última línea de etiquetas');
  const dup = await call('add_tag', { name: 'Etiquetas', tag: 'NUEVO' });
  assert.equal(dup.data.added, false);
  const bad = await call('add_tag', { name: 'Etiquetas', tag: '1mal' });
  assert.equal(bad.ok, false); assert.match(bad.text, /invalid tag/);
  // quitar #uno: no toca #unos ni el bloque de código
  const rm = await call('remove_tag', { name: 'Etiquetas', tag: 'uno' });
  assert.equal(rm.data.removed, 1);
  const t = await body('Etiquetas');
  assert.ok(t.includes('Texto con y #unos.'), t);
  assert.ok(t.includes('#unos'), '#unos sigue');
  assert.ok(t.includes('#uno en código'), 'el código no se toca');
  // una línea que era solo esa etiqueta desaparece
  await call('remove_tag', { name: 'Etiquetas', tag: 'otro' });
  await call('remove_tag', { name: 'Etiquetas', tag: 'nuevo' });
  assert.equal((await body('Etiquetas')).includes('#nuevo'), false);
  assert.equal((await call('remove_tag', { name: 'Etiquetas', tag: 'nada' })).data.removed, 0);
});

test('delete_attachment quita las referencias de ese adjunto y deja las demás', async () => {
  const sha1 = 'a'.repeat(64), sha2 = 'b'.repeat(64);
  const content = `# Adjuntos\n\nTexto.\n\n[informe.xlsx](edinot://blob/${sha1})\n\n![foto](edinot://blob/${sha2})\n\nFin.\n`;
  await call('create_note', { name: 'Con adjuntos', content });
  const amb = await call('delete_attachment', { name: 'Con adjuntos' });
  assert.equal(amb.ok, false); assert.match(amb.text, /2 attachments/);
  const r = await call('delete_attachment', { name: 'Con adjuntos', attachment: 'informe' });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.data.referencesRemoved, 1);
  const t = await body('Con adjuntos');
  assert.equal(t.includes(sha1), false);
  assert.ok(t.includes(sha2));
  assert.equal(t, `# Adjuntos\n\nTexto.\n\n![foto](edinot://blob/${sha2})\n\nFin.\n`);
});

test('disconnect_canvas_nodes quita una conexión por id o por extremos', async () => {
  await call('create_canvas', { name: 'Red' });
  const ids = [];
  for (const x of ['A', 'B', 'C']) { const r = await call('add_canvas_node', { name: 'Red', kind: 'text', text: x }); ids.push(r.data.id || r.data.node.id); }
  const [a, b, c] = ids;
  const e1 = (await call('connect_canvas_nodes', { name: 'Red', from: a, to: b })).data.edge;
  await call('connect_canvas_nodes', { name: 'Red', from: b, to: c });
  await call('connect_canvas_nodes', { name: 'Red', from: c, to: b, label: 'vuelta' });
  const byId = await call('disconnect_canvas_nodes', { name: 'Red', edgeId: e1.id });
  assert.equal(byId.ok, true, byId.text); assert.equal(byId.data.removed.length, 1);
  assert.equal((await call('read_canvas', { name: 'Red' })).data.edges.length, 2);
  const one = await call('disconnect_canvas_nodes', { name: 'Red', from: b, to: c });
  assert.equal(one.data.removed.length, 1);
  assert.equal((await call('read_canvas', { name: 'Red' })).data.edges.length, 1, 'la de vuelta sigue');
  assert.equal((await call('disconnect_canvas_nodes', { name: 'Red', from: b, to: c })).ok, false);
  const both = await call('disconnect_canvas_nodes', { name: 'Red', from: b, to: c, bothDirections: true });
  assert.equal(both.ok, true, both.text);
  assert.equal((await call('read_canvas', { name: 'Red' })).data.edges.length, 0);
  assert.equal((await call('disconnect_canvas_nodes', { name: 'Red' })).ok, false);
});

test('edit_comment cambia el texto de un comentario y de una respuesta', async () => {
  const note = (await call('create_note', { name: 'Comentada', content: 'Algo que comentar.\n' })).data;
  await call('anchor_note', { noteId: note.id, text: 'primer texto', anchorText: 'Algo' });
  let list = (await call('list_comments', { noteId: note.id })).data.comments;
  const c = list[0];
  assert.equal(c.text, 'primer texto');
  const r = await call('edit_comment', { id: c.id, text: 'texto corregido' });
  assert.equal(r.ok, true, r.text);
  assert.ok(r.data.editedAt);
  list = (await call('list_comments', { noteId: note.id })).data.comments;
  assert.equal(list.find(x => x.id === c.id).text, 'texto corregido');
  const reply = (await call('reply_to_comment', { commentId: c.id, text: 'respuesta' })).data;
  const rid = reply.id || (reply.comment && reply.comment.id);
  assert.ok(rid, JSON.stringify(reply));
  assert.equal((await call('edit_comment', { id: rid, text: 'respuesta corregida' })).ok, true);
  assert.equal((await call('edit_comment', { id: 'nope', text: 'x' })).ok, false);
  assert.equal((await call('edit_comment', { id: c.id, text: '   ' })).ok, false);
});

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const anyOverlap = (nodes) => nodes.some((a, i) => nodes.slice(i + 1).some(b => overlap(a, b)));

test('add_canvas_node sin posición no apila los nodos y auto_layout_canvas no los solapa', async () => {
  await call('create_canvas', { name: 'Sin solapes' });
  for (const t of ['Lanzamiento', 'Vídeo', 'Web', 'Anuncio', 'Feedback']) await call('add_canvas_node', { name: 'Sin solapes', kind: 'text', text: t, sticky: true });
  await call('add_canvas_node', { name: 'Sin solapes', kind: 'text', text: 'Nota normal' });
  let nodes = (await call('read_canvas', { name: 'Sin solapes' })).data.nodes;
  assert.equal(nodes.length, 6);
  assert.equal(anyOverlap(nodes), false, 'los nodos creados sin x/y no se pisan');
  // con coordenadas explícitas se respetan tal cual
  const fixed = await call('add_canvas_node', { name: 'Sin solapes', kind: 'text', text: 'Fijo', x: 1000, y: 1000 });
  assert.equal(fixed.ok, true, fixed.text);
  const f = (await call('read_canvas', { name: 'Sin solapes' })).data.nodes.find(n => n.text === 'Fijo');
  assert.deepEqual([f.x, f.y], [1000, 1000]);
  await call('auto_layout_canvas', { name: 'Sin solapes' });
  nodes = (await call('read_canvas', { name: 'Sin solapes' })).data.nodes;
  assert.equal(anyOverlap(nodes), false, 'tras auto_layout_canvas tampoco');
});
