// Página ↔ Canvas (1.2): el MCP (modo local, ficheros en disco) sigue leyendo y
// escribiendo el canvas de una nota que lleva su página dentro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addOwnCanvas } from '../shared/page-canvas.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('read_canvas, add_canvas_node and read_note on a note with its page on its canvas', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edinot-mcp-'));
  fs.mkdirSync(path.join(tmp, 'cfg', 'edinot'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'vault', 'Default'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'cfg', 'edinot', 'cli.json'), JSON.stringify({ mode: 'local', vaultDir: path.join(tmp, 'vault') }));
  fs.writeFileSync(path.join(tmp, 'vault', 'Default', 'Plan.md'), addOwnCanvas('# Plan\n\nTexto de la página.\n'));
  const p = spawn(process.execPath, ['mcp/server.mjs'], { cwd: root, env: { ...process.env, XDG_CONFIG_HOME: path.join(tmp, 'cfg') }, stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = ''; const waiters = new Map(); let id = 0;
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } catch {} } });
  const call = (method, params) => new Promise((res) => { const i = ++id; waiters.set(i, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const tool = async (name, args) => { const r = await call('tools/call', { name, arguments: args }); return r.result.content.map(c => c.text || '').join('\n'); };
  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    assert.deepEqual(JSON.parse(await tool('read_canvas', { name: 'Plan' })).nodes.map(n => n.kind), ['page']);
    await tool('add_canvas_node', { name: 'Plan', kind: 'text', text: 'Idea', x: 900, y: 0 });
    const after = JSON.parse(await tool('read_canvas', { name: 'Plan' }));
    assert.deepEqual(after.nodes.map(n => n.kind), ['page', 'text']);
    const note = await tool('read_note', { name: 'Plan' });
    assert.ok(note.includes('Texto de la página.'));
    const disk = fs.readFileSync(path.join(tmp, 'vault', 'Default', 'Plan.md'), 'utf8');
    assert.ok(disk.startsWith('# Plan\n\nTexto de la página.\n'), 'the page text is untouched');
  } finally {
    p.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
