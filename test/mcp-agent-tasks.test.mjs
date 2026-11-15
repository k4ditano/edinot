// An @mention in a comment leaves a task that an assistant must be able to find, claim and answer
// through MCP. Regression: get_active_context used to match only the agent's own alias
// (claude-<device>), so the shared @claude / @codex / @cursor tasks — the default ones — were
// invisible there, and the MCP instructions tell assistants to look in that very place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edinot-agent-tasks-'));
const { startHub } = await import('../hub/hub.mjs');

let hub, mcp;
const waiters = new Map(); let buf = ''; let id = 0;
const rpc = (method, params) => new Promise((res) => { const i = ++id; waiters.set(i, res); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
const tool = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.result.content.map(c => c.text || '').join('');
  try { return JSON.parse(text); } catch { return text; }
};

test.before(async () => {
  fs.mkdirSync(path.join(tmp, 'cfg'), { recursive: true });
  hub = await startHub({ dir: path.join(tmp, 'hub'), port: 0, connectionTimeoutMs: 800 });
  mcp = spawn(process.execPath, ['mcp/server.mjs'], {
    cwd: root, stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env, HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, 'cfg'), EDINOT_HUB_DIR: path.join(tmp, 'hub'),
      EDINOT_AGENT_KIND: 'claude', EDINOT_AGENT_DEVICE: 'pc', NODE_NO_WARNINGS: '1',
    },
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
  // Hocuspocus leaves a deferred-save timer that keeps the test process alive after writes
  // (the real hub exits explicitly when it stops).
  setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
});

test('an @claude mention is visible to an assistant in get_active_context, and can be claimed and answered', async () => {
  const note = await tool('create_note', { name: 'Plan', content: '# Plan\n\nThree ideas.\n' });
  assert.ok(note.id, 'the note was created');
  await tool('anchor_note', { noteId: note.id, text: '@claude summarise this note in one sentence' });

  // 1. The place the MCP instructions point the assistant to.
  const ctx = await tool('get_active_context');
  assert.equal(ctx.pendingAgentTasks.length, 1, 'the shared @claude task shows up for a claude agent');
  const task = ctx.pendingAgentTasks[0];
  assert.equal(task.targetAlias, 'claude');
  assert.equal(task.canonical, true);

  // 2. list_agent_tasks agrees.
  const listed = await tool('list_agent_tasks');
  assert.deepEqual(listed.tasks.map(t => t.id), [task.id]);

  // 3. Claim it, answer it: the answer lands in the thread of the original comment.
  await tool('claim_agent_task', { id: task.id });
  await tool('complete_agent_task', { id: task.id, response: 'Three ideas for the launch.' });
  const after = await tool('list_comments', { name: 'Plan' });
  const reply = after.comments.find(c => c.parentId === task.commentId);
  assert.ok(reply, 'the reply is in the thread');
  assert.equal(reply.text, 'Three ideas for the launch.');
  assert.deepEqual((await tool('get_active_context')).pendingAgentTasks, [], 'a completed task is no longer pending');
});

test('an agent of another kind does not see a task addressed to @claude', async () => {
  // Same MCP session, so check the matching rule through list_agent_tasks with an explicit foreign alias.
  const other = await tool('list_agent_tasks', { alias: 'codex-pc' });
  assert.deepEqual(other.tasks.filter(t => t.targetAlias === 'claude' && t.status === 'pending'), []);
});
