#!/usr/bin/env node
// Edinot MCP server — exposes notes as tools for AI assistants.
//
// Transport: stdio (Claude Desktop & most MCP clients).
// Auth: reads ~/.config/edinot/cli.json (set up via `edinot login` first),
//       OR env vars EDINOT_SERVER, EDINOT_TOKEN, EDINOT_WORKSPACE_ID,
//       EDINOT_EMAIL (optional).
//
// Each tool call opens a short-lived Yjs session, performs ops, closes.
// CRDT semantics: writes merge with any concurrent edits from app / other peers.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { createHash } from 'node:crypto';

import { ops, loadConfig, saveConfig, defaultServer, api, tokenExpiresAt, fetchRobust } from '../cli/lib.mjs';
import { hubConfig, readHubInfo, hubAlive } from '../hub/client.mjs';
import { DEFAULT_AI_INSTRUCTIONS, defaultAiInstructions } from '../shared/ai-defaults.js';
import { CANVAS_TEMPLATE_KEYS, canvasTemplateInfo, buildCanvasTemplate } from '../shared/canvas-templates.js';
import { canvasEdgeId } from '../shared/canvas-model.js';
import { compileRules } from '../shared/collections.js';
import { SemanticIndex } from './semantic.mjs';
import exportHtml from '../electron/export-html.cjs';
import {
  parseFormBlocks, parseTablesForForms, resolveFormTable,
  insertFormBlock, writeFormBlockConfig, removeFormBlock,
} from '../shared/form_share.js';

// Hub local (hub/). Se arranca solo, sin red, la primera vez que hace falta.
let hubCfgCache = null;
async function prepareHubConfig() {
  const env = process.env;
  if (env.EDINOT_VAULT_DIR || (env.EDINOT_TOKEN && env.EDINOT_WORKSPACE_ID)) return;
  const c = loadConfig();
  if (c && c.mode !== 'hub') return;               // sesión remota o carpeta antigua
  const info = readHubInfo();
  if (hubCfgCache && info && info.url === hubCfgCache.server && await hubAlive(info, 800)) return;
  hubCfgCache = await hubConfig({ workspaceId: c && c.workspaceId });
}

function resolveCfg() {
  const env = process.env;
  // Local file mode — operates against the Edinot app's disk-exported vault
  // tree. The Electron app watches this folder and syncs changes back into
  // its Y.Doc, so writes here show up in the running app within ~1s. Works
  // fully offline; no sync server needed.
  if (env.EDINOT_VAULT_DIR) {
    return { mode: 'local', vaultDir: env.EDINOT_VAULT_DIR };
  }
  if (env.EDINOT_TOKEN && env.EDINOT_WORKSPACE_ID) {
    return {
      server: env.EDINOT_SERVER || defaultServer(),
      token: env.EDINOT_TOKEN,
      workspaceId: Number(env.EDINOT_WORKSPACE_ID),
      email: env.EDINOT_EMAIL || null,
    };
  }
  const c = loadConfig();
  // Sin sesión remota (o `mode: 'hub'`): el hub local de este equipo. Su
  // configuración la deja lista `prepareHubConfig()` antes de abrir sesión.
  if (!c || c.mode === 'hub') {
    if (hubCfgCache) return hubCfgCache;
    throw new Error('El hub local aún no está listo; se arranca solo al usar cualquier herramienta.');
  }
  if (c.mode === 'local') {
    if (!c.vaultDir) throw new Error('Local mode missing `vaultDir` — re-run setup from the app.');
    return c;
  }
  if (!c.token || !c.workspaceId) {
    throw new Error('Edinot session expired or incomplete. Re-run setup from the app (Ajustes → MCP).');
  }
  return c;
}

// The parent process can't change under us, so probe it once. It used to
// run per tool call — and on Windows that meant spawning powershell.exe
// synchronously (blocking the event loop, and the WebSocket sync with it)
// on every single MCP request.
//
// Devuelve los nombres de hasta 5 antecesores separados por «|» (padre
// primero): el padre directo suele ser cmd/node/npx y no la IA. En Windows
// todo va en una sola llamada a PowerShell con margen para su arranque en
// frío; con 1,2 s se agotaba y el agente quedaba como «ai-<equipo>», que la
// app no sabe lanzar.
let parentProcessName;
function detectParentProcessName() {
  if (parentProcessName === undefined) parentProcessName = probeParentProcessName();
  return parentProcessName;
}

function probeParentProcessName() {
  try {
    if (process.platform === 'win32') {
      const script = `$p=${process.ppid};$n=@();for($i=0;$i -lt 5 -and $p;$i++){`
        + `$x=Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue;`
        + `if(-not $x){break};$n+=$x.Name;$p=$x.ParentProcessId};$n -join '|'`;
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 6000, windowsHide: true,
      }).trim();
    }
    const names = [];
    let pid = process.ppid;
    for (let i = 0; i < 5 && pid > 1; i++) {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=,comm='], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1200,
      }).trim();
      const m = out.match(/^(\d+)\s+(.*)$/);
      if (!m) break;
      names.push(m[2].trim());
      pid = Number(m[1]);
    }
    return names.join('|');
  } catch {
    return '';
  }
}

// Tipo de agente por el entorno (Claude Code marca a sus procesos hijos con
// CLAUDECODE=1) o por el primer antecesor que se reconozca.
function kindFromProcess(chain) {
  if (process.env.CLAUDECODE) return 'claude';
  for (const name of String(chain || '').toLowerCase().split('|')) {
    if (name.includes('claude')) return 'claude';
    if (name.includes('codex')) return 'codex';
    if (name.includes('cursor')) return 'cursor';
  }
  return 'ai';
}

function normalizeAlias(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function currentAgentIdentity(cfg = resolveCfg()) {
  const parent = detectParentProcessName();
  const kind = normalizeAlias(process.env.EDINOT_AGENT_KIND || cfg.agentKind || kindFromProcess(parent)) || 'ai';
  const device = normalizeAlias(process.env.EDINOT_AGENT_DEVICE || cfg.agentDevice || os.hostname().split('.')[0]) || 'device';
  const alias = normalizeAlias(process.env.EDINOT_AGENT_ALIAS || cfg.agentAlias || `${kind}-${device}`);
  return {
    alias,
    kind,
    device,
    platform: process.platform,
    ownerEmail: cfg.email || process.env.EDINOT_EMAIL || null,
    pid: process.pid,
    parentProcess: parent ? parent.split('|')[0] : null,
    capabilities: ['comments', 'notes', 'canvas', 'mcp-tools'],
  };
}

// Currently-executing tool name. Set by the server.tool wrapper below
// and read by withSession so every MCP call surfaces a "Claude ran X"
// chip in the renderer without each tool having to remember to call
// publishMcpAction manually. Tools that already publish a richer
// action (write/create/delete/etc.) still do — this is the floor
// signal so even read-only tools (list_*/read_*/get_*) appear in the
// AI-peer chip + history popout.
let currentToolName = null;
let currentToolArgs = null;

// Tools that already broadcast a richer publishMcpAction inside their
// handler (vault_create, write, focus, etc.). Skip the floor signal
// for them to avoid duplicate chip entries.
const TOOLS_WITH_OWN_ACTION = new Set([
  'write_note', 'create_note', 'delete_note', 'rename_note', 'move_note',
  'append_note', 'attach_image', 'attach_file', 'download_attachment',
  'create_vault', 'rename_vault', 'delete_vault',
  'create_folder', 'rename_folder', 'delete_folder', 'move_folder',
  'focus_note', 'present_in_note', 'highlight_in_note', 'reveal_change',
  'spotlight_pulse',
  'create_from_template',
  'add_table_row', 'update_table_row', 'delete_table_row',
  'canvas_from_text', 'create_canvas', 'add_canvas_node',
  'draw_freehand_on_canvas', 'add_canvas_shape',
  'create_form', 'update_form', 'delete_form',
]);

// Map tool name → renderer payload: { target, where }. Renderer reads
// these straight, no per-name switch on its side. Keeps tools language
// localized via i18n keys `tool.<name>` rather than hardcoded strings.
function friendlyToolPayload(name, args) {
  const a = args || {};
  const str = (v) => (v == null ? '' : String(v));
  const de = (v) => (v ? ` de ${v}` : '');
  switch (name) {
    case 'list_notes':           return { target: 'notas' + de(a.vault), where: '' };
    case 'read_note':            return { target: str(a.name), where: '' };
    case 'attach_file':          return { target: str(a.filename || a.path || 'archivo') + (a.note ? ' → ' + a.note : ''), where: '' };
    case 'list_attachments':     return { target: 'adjuntos' + de(a.name), where: '' };
    case 'read_attachment':      return { target: str(a.attachment || a.name), where: '' };
    case 'search_in_note':       return { target: '"' + str(a.query) + '" en ' + str(a.name), where: '' };
    case 'list_vaults':          return { target: 'vaults', where: '' };
    case 'list_workspaces':      return { target: 'workspaces', where: '' };
    case 'switch_workspace':     return { target: 'workspace id=' + str(a.workspaceId), where: '' };
    case 'list_folders':         return { target: 'carpetas' + de(a.vault), where: '' };
    case 'list_templates':       return { target: 'plantillas' + de(a.vault), where: '' };
    case 'list_tables':          return { target: 'tablas' + de(a.name), where: '' };
    case 'read_table':           return { target: str(a.name) + (a.idx != null ? ' #' + a.idx : ''), where: '' };
    case 'find_table_rows':      return { target: str(a.name), where: '' };
    case 'list_canvases':        return { target: 'canvases', where: '' };
    case 'read_canvas':          return { target: str(a.name), where: '' };
    case 'list_canvas_annotations': return { target: 'anotaciones' + de(a.name), where: '' };
    case 'delete_canvas_annotation': return { target: str(a.name), where: '' };
    case 'delete_canvas_node':   return { target: str(a.name), where: '' };
    case 'move_canvas_node':     return { target: str(a.name), where: '' };
    case 'connect_canvas_nodes': return { target: str(a.name), where: '' };
    case 'add_canvas_shape':     return { target: str(a.shape) + ' → ' + str(a.name), where: '' };
    case 'focus_canvas_node':    return { target: str(a.name), where: '' };
    case 'present_in_canvas':    return { target: str(a.name), where: '' };
    case 'canvas_animate':       return { target: str(a.name), where: '' };
    case 'auto_layout_canvas':   return { target: str(a.name), where: '' };
    case 'note_info':            return { target: str(a.name), where: '' };
    case 'is_app_open':          return { target: 'app abierta', where: '' };
    case 'recall':               return { target: '"' + str(a.query) + '"' + de(a.vault), where: '' };
    case 'recall_semantic':      return { target: '"' + str(a.query) + '"', where: '' };
    case 'search_notes':         return { target: '"' + str(a.query) + '"', where: '' };
    case 'get_active_context':   return { target: 'contexto activo', where: '' };
    case 'get_recent_notes':     return { target: 'notas recientes', where: '' };
    case 'get_canvas_selection': return { target: 'selección canvas', where: '' };
    case 'get_editor_selection': return { target: 'selección editor', where: '' };
    case 'wait_for_selection_change': return { target: 'cambio selección', where: '' };
    case 'get_recent_edits':     return { target: 'edits recientes', where: '' };
    case 'pin_to_context':       return { target: str(a.label || a.text).slice(0, 40), where: '' };
    case 'unpin_context':        return { target: str(a.id), where: '' };
    case 'list_pinned_context':  return { target: 'contexto pinned', where: '' };
    case 'clear_pinned_context': return { target: 'contexto pinned', where: '' };
    case 'anchor_note':          return { target: (a.kind === 'question' ? 'pregunta en ' : 'nota en ') + str(a.noteId), where: '' };
    case 'reply_to_comment':     return { target: 'comentario ' + str(a.commentId), where: '' };
    case 'list_comments':        return { target: 'comentarios' + de(a.noteId), where: '' };
    case 'resolve_comment':      return { target: 'comentario ' + str(a.id), where: '' };
    case 'delete_comment':       return { target: 'comentario ' + str(a.id), where: '' };
    case 'ask_inline':           return { target: '"' + str(a.question).slice(0, 60) + '"' + de(a.noteId), where: '' };
    case 'wait_for_inline_reply':return { target: 'respuesta ' + str(a.commentId), where: '' };
    case 'read_replies':         return { target: 'respuestas de ' + str(a.commentId), where: '' };
    case 'screenshot_note':      return { target: str(a.fileId), where: '' };
    case 'presence_pulse':       return { target: str(a.activity || a.kind).slice(0, 60), where: '' };
    case 'get_ai_agent_identity':return { target: 'identidad agente', where: '' };
    case 'list_ai_agents':       return { target: 'agentes IA', where: '' };
    case 'list_agent_tasks':     return { target: 'tareas IA' + de(a.alias), where: '' };
    case 'claim_agent_task':     return { target: str(a.id), where: '' };
    case 'complete_agent_task':  return { target: str(a.id), where: '' };
    case 'get_ai_instructions':  return { target: 'instrucciones de la IA', where: '' };
    case 'list_events':          return { target: 'eventos' + de(a.vault), where: '' };
    case 'list_collections':     return { target: 'colecciones' + de(a.vault), where: '' };
    case 'create_event':         return { target: 'evento "' + str(a.title).slice(0, 40) + '"', where: '' };
    case 'update_event':         return { target: 'evento ' + str(a.id), where: '' };
    case 'delete_event':         return { target: 'evento ' + str(a.id), where: '' };
    default:                     return { target: '·', where: '' };
  }
}

// ── Shared workspace session ───────────────────────────────────────────
// ops.open() syncs the shell doc plus EVERY vault doc — on a real
// workspace that is tens of seconds and ~1 GB of RSS. Doing it per tool
// call, and again per *concurrent* tool call, is what made Codex/ChatGPT
// report `Transport closed`: a turn that fired four attach_file calls in
// parallel meant four full re-syncs racing each other until the process
// was starved and the host gave up on the stdio pipe.
//
// So: exactly one session per process, shared by every tool call and by
// the presence pinger, opened once and kept live (Yjs keeps it current —
// a long-lived session is fresher than a fresh one, not staler). Tool
// calls flush instead of closing, which preserves the write-durability
// guarantee close() used to provide.
let sharedSession = null;   // { key, cfg, session, refs, retired }
let sharedOpening = null;   // in-flight open, so parallel callers await one

function sessionKey(cfg) {
  if (!cfg) return 'none';
  if (cfg.mode === 'local') return `local:${cfg.vaultDir}`;
  return `${cfg.server}#${cfg.workspaceId}`;
}

// Tear a session down once nothing is using it. Destroying providers under
// a call that's mid-write would throw inside that tool, so a retired entry
// lingers until its last in-flight caller releases it.
async function retireSession(entry) {
  if (!entry) return;
  entry.retired = true;
  if (entry.refs > 0) return;
  try { await entry.session.close(); } catch {}
}

async function closeSharedSession() {
  const cur = sharedSession;
  sharedSession = null;
  await retireSession(cur);
}

function releaseSession(entry) {
  if (!entry) return;
  entry.refs--;
  if (entry.retired && entry.refs <= 0) { entry.session.close().catch(() => {}); }
}

// Resolve the live session, opening it if needed. Reopens when the target
// workspace changed (switch_workspace) or the cached token has expired —
// ops.open owns the refresh path, so a reopen is how we pick up a new one.
// Callers that hold the result must releaseSession() when done.
async function acquireSession() {
  await prepareHubConfig();
  const want = resolveCfg();
  const key = sessionKey(want);
  if (sharedSession) {
    const exp = sharedSession.cfg.mode === 'local' ? null : tokenExpiresAt(sharedSession.cfg.token);
    const stale = sharedSession.key !== key || (exp != null && exp <= Date.now());
    if (!stale) { sharedSession.refs++; return sharedSession; }
    await closeSharedSession();
  }
  if (!sharedOpening) {
    sharedOpening = (async () => {
      const session = await ops.open(want);
      sharedSession = { key, cfg: want, session, refs: 0, retired: false };
      return sharedSession;
    })();
    sharedOpening.catch(() => {}).then(() => { sharedOpening = null; });
  }
  const entry = await sharedOpening;
  entry.refs++;
  return entry;
}

async function withSession(fn) {
  const held = await acquireSession();
  const { cfg, session: s } = held;
  // Stamp the agent identity so publishMcpAction can label every action with
  // who did it (Claude / Codex / Cursor / …). mcpAction and the aiAgent
  // presence ping live on different awareness clientIDs, so the renderer
  // can't correlate them — carrying identity inside the action is the fix.
  try { cfg.__agentIdentity = currentAgentIdentity(cfg); } catch {}
  // Floor signal — emit for every read-only tool that doesn't already
  // publish its own richer action. Renderer turns kind: 'mcp_tool' +
  // tool + target + where into a friendly "Listó notas de Personal"
  // chip without each tool needing its own publishMcpAction call.
  if (currentToolName && s.publishMcpAction && !TOOLS_WITH_OWN_ACTION.has(currentToolName)) {
    const { target, where } = friendlyToolPayload(currentToolName, currentToolArgs);
    try { s.publishMcpAction({ kind: 'mcp_tool', tool: currentToolName, target, where }); } catch {}
  }
  // Flush, don't close — the session outlives this call. Without the flush
  // a write queued a millisecond before the tool returns could still be
  // sitting in the provider's outbox when the host kills the process.
  try { return await fn(s, cfg); }
  finally {
    if (typeof s.flush === 'function') { try { await s.flush(); } catch {} }
    releaseSession(held);
  }
}

function text(s) { return { content: [{ type: 'text', text: String(s) }] }; }
function json(o) { return text(JSON.stringify(o, null, 2)); }

// System-level instructions. Compatible MCP clients surface this to the
// model as part of the session context — it is the right place to teach
// the LLM the *workflow* (which tools to chain together) on top of the
// per-tool descriptions. Keep it short and prescriptive.
const SERVER_INSTRUCTIONS = `
Edinot is a live note + canvas workspace. Your job is not just to write
files: it is to **show the user what you did**. The MCP toolset includes
visual instruments (focus_note, highlight_in_note, present_in_note,
focus_canvas_node, present_in_canvas) — use them as the default closing
gesture of every task, not as a rare option.

## Default playbook

1. **After writing or editing a note**
   • Call \`focus_note\` to open it in the user's window.
   • If you produced 1 short answer → call \`highlight_in_note\` on the
     single passage that matters.
   • If you produced multiple distinct claims (≥3) → use
     \`present_in_note\` to walk through them, one per step. Keep each
     message under 200 chars; let durationMs default.

2. **After creating or mutating a canvas**
   • Call \`focus_note\` (the canvas note) so the user sees it.
   • If the canvas now has a single answer-node → \`focus_canvas_node\`.
   • If you built a multi-node plan → \`present_in_canvas\` with one stop
     per node in the logical order ("first the goal, then the blockers,
     finally the ship date").

2b. **Whiteboard playbook (brainstorm → cluster → present).** The canvas
   is a full Miro-style board; work it like one:
   • Seed structure fast: \`apply_canvas_template\` (brainstorm, retro,
     kanban, mindmap, timeline, moodboard, weekly) on a fresh canvas.
   • Brainstorm: \`add_canvas_stickies\` drops N pastel stickies in one
     call. Edit any node later with \`update_canvas_node\` — never
     delete + re-add.
   • Affinity-map: \`read_canvas\` (or \`canvas_screenshot\` to actually
     SEE drawings/colors/positions), group ideas by theme yourself, then
     \`cluster_canvas_nodes\` materializes titled frames around each
     cluster in one call.
   • Voting: the user reacts with emojis on nodes; tally with
     \`get_canvas_reactions\` and act on the winners.
   • Point live: \`laser_trace\` sweeps an ephemeral laser across the
     board (persists nothing); \`draw_freehand_on_canvas\` for marks that
     should stay.
   • Close with \`present_canvas_groups\` — frames become slides, use
     \`update_canvas_group\` order to control the sequence.

3. **Confirm, don't ask permission afterwards.** It is fine to
   immediately focus / highlight / present after a creation — the user
   expects it. Do not chain a question like "Do you want me to show it?".
   Just show it.

4. **Naming.** Use the exact note/canvas name returned by the tool, not
   the slug you guessed. Tools accept \`name\` (current label) and most
   also accept an id — prefer the id on follow-up calls (it survives
   renames).

5. **Don't dump.** Avoid returning huge text blobs to the user when a
   highlight or a present step is enough. The MCP is the eyes and the
   pen — use both.

6. **Persistent memory.** Call \`get_active_context\` at the start of a
   task. Its \`pinnedContext\` array carries fragments the user pinned
   as always-relevant — quote/constraint/decision/etc. Treat them as
   hard context for the whole reply. When the user says "remember this"
   or you produce a decision worth keeping across sessions, call
   \`pin_to_context\` with a short \`label\` and the relevant \`text\`.
   Manage hygiene: \`unpin_context\` when something stops being true.

7. **Lighter visual gestures.** \`spotlight_pulse\` is the right choice
   for ephemeral "look here" cues (a recall hit, a single word) — no
   callout, fades after ~2s. \`ask_inline\` posts a question anchored
   to a passage with an in-app reply box; pair with
   \`wait_for_inline_reply\` to receive the answer without polling. Use
   \`recall\` (ranked keyword search) when query and note vocabulary
   match, \`recall_semantic\` (OpenAI embeddings, paid; requires user
   to set an API key in the app) when they don't ("flujo de alta" →
   "user signup"), and \`screenshot_note\` to verify what the user
   actually sees after a render.

8. **Always reveal what you changed.** Edits without a visible cue
   make the user hunt for the diff. After every \`write_note\` or
   \`create_note\` call \`reveal_change(name, text)\` with a literal
   substring of the new content so the user sees the note scroll +
   pulse on the change. \`append_note\` already auto-fires reveal on
   the appended region, so you don't need to chain reveal there
   unless you want to spotlight a different passage. For
   multi-paragraph rewrites where there isn't a single key passage
   prefer \`present_in_note\` instead so you walk through ≥3 distinct
   changes one by one.

9. **Show your work in real time.** For long multi-step jobs (more
   than ~2s of silence between tool calls), keep the user oriented
   with \`presence_pulse\` between operations: "thinking…",
   "searching across vault…", "drafting outline (3/8)…". Without it
   the user just sees a frozen UI — with it they see the AI peer
   chip update and know something is happening.

10. **ask_inline is BLOCKING by default — let it wait.** Calling
    \`ask_inline(question)\` now auto-focuses the target note (so the
    user actually sees the reply panel) AND blocks the tool call
    until the user submits a reply (or ~120s timeout). You get the
    reply right in the tool response — no need for the user to ping
    you back. After acting on the reply call \`resolve_comment\` so
    the panel clears it. Use \`wait: false\` only when you genuinely
    want fire-and-forget — in that case the user's reply will show
    up next turn in \`get_active_context.pendingReplies\` (always
    check this at the start of every turn to catch any answers from
    previous fire-and-forget asks).

11. **Always load workspace instructions first.** Call
    \`get_ai_instructions\` at the very start of every new
    conversation. The user can author a workspace-specific behavior
    guide in Ajustes → MCP (vault conventions, preferred templates,
    terminology, tone). Treat the returned \`instructions\` text as
    an additional hard system prompt for the entire conversation.
    Clients that auto-fetch MCP resources may also receive it via
    the \`edinot://ai-instructions\` resource — same content, two
    delivery surfaces so no client misses it.

12. **AI mentions are assignments.** If \`get_active_context\`
    returns \`pendingAgentTasks\` for your alias, handle them before
    unrelated work: call \`claim_agent_task\`, perform the requested
    work, then \`complete_agent_task\` with the response that should
    be posted back to the originating comment thread.

13. **Structure data, don't just write prose.** Edinot is a queryable
    knowledge base — use the structured tools:
    • **Note properties** — \`set_note_property(name, key, value)\` /
      \`get_note_properties\` store hidden key:value metadata (status,
      type, priority, due…). Then \`query_notes({ where:{status:'open'} })\`
      filters the whole vault. Prefer properties + query over scanning
      notes by hand. \`list_tags\` / \`notes_by_tag\` cover #hashtags.
    • **Tables** — set rich column types with \`set_column_type\`
      (text/select/number/date/checkbox/tags/multiselect/status/rating/
      progress/person). Whenever you CREATE a table, also decide how it
      should look: call \`set_table_view\` right after writing it —
      \`'kanban'\` (\`{by:'Estado'}\`) for status workflows, \`'cards'\`
      for visual collections, \`'list'\` for simple row-by-row reading,
      or leave \`'table'\` for dense data. Don't ship the default grid
      when another view fits the data better. Add/rename/delete
      columns with \`add_table_column\` / \`rename_table_column\` /
      \`delete_table_column\`. Toggle checklist items with \`toggle_task\`.
    • **Navigation / big notes** — \`get_outline\` then
      \`read_section(name, heading)\` instead of reading a whole long
      note. \`list_backlinks\` / \`get_outgoing_links\` walk the link graph.
    • **Journaling** — \`get_or_create_daily_note\` for date-stamped logs.
    • **Safety** — \`list_snapshots\` / \`restore_snapshot\` are the
      time machine; \`undo_edit\` best-effort reverts your last short
      append. \`export_note\` writes md/html out.
`.trim();

const server = new McpServer(
  { name: 'edinot', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} }, instructions: SERVER_INSTRUCTIONS },
);

// ── Capa común de robustez para TODAS las herramientas ──────────────────
//  · Alias tolerantes: `name` también llega como note/noteName/noteId/id/
//    title, y `taskIndex` como index (los agentes se equivocan a menudo y la
//    validación fallaba con «expected string, received undefined»).
//  · «not found: X» propone notas parecidas (sin acentos, por palabras).
//  · Tope de tamaño de la respuesta: Claude Code desconecta el servidor si un
//    mensaje pasa de 16 MB. Por encima de RESULT_MAX_BYTES se quitan imágenes
//    desde el final y se avisa en texto.
const RESULT_MAX_BYTES = 12 * 1024 * 1024;
const NAME_ALIASES = ['note', 'noteName', 'noteId', 'id', 'title'];
function isZodShape(o) { return o && typeof o === 'object' && !Array.isArray(o) && Object.values(o).every(v => v && v._def); }
function capResult(res) {
  if (!res || !Array.isArray(res.content)) return res;
  const size = (b) => (b.type === 'text' ? Buffer.byteLength(b.text || '') : (b.data ? b.data.length : 0)) + 64;
  let total = res.content.reduce((a, b) => a + size(b), 0);
  if (total <= RESULT_MAX_BYTES) return res;
  const content = res.content.slice();
  let dropped = 0;
  for (let i = content.length - 1; i >= 0 && total > RESULT_MAX_BYTES; i--) {
    if (content[i].type === 'image' || content[i].type === 'resource') { total -= size(content[i]); content.splice(i, 1); dropped++; }
  }
  for (let i = 0; i < content.length && total > RESULT_MAX_BYTES; i++) {
    if (content[i].type === 'text' && content[i].text.length > 200000) {
      const before = size(content[i]);
      const keep = Math.max(200000, content[i].text.length - (total - RESULT_MAX_BYTES));
      content[i] = { ...content[i], text: content[i].text.slice(0, keep) + '\n…[truncated: response too large]' };
      total -= before - size(content[i]);
    }
  }
  content.push({ type: 'text', text: `[edinot] Respuesta recortada para no superar el límite del cliente${dropped ? ` (${dropped} imagen(es) omitidas; pide menos con maxImages/offset)` : ''}.` });
  return { ...res, content };
}
async function suggestNotes(ref) {
  try {
    return await withSession(async (sess) => {
      const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\.md$/, '');
      const q = fold(ref);
      const words = q.split(/[^a-z0-9]+/).filter(w => w.length > 2);
      const scored = sess.listFiles({}).map(f => {
        const n = fold(f.name);
        let sc = n.includes(q) || q.includes(n) ? 10 : 0;
        for (const w of words) if (n.includes(w)) sc++;
        return { f, sc };
      }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 5);
      return scored.map(x => `${x.f.name} (id ${x.f.id})`);
    });
  } catch { return []; }
}
{
  const origTool = server.tool.bind(server);
  server.tool = (...args) => {
    const cbIdx = args.length - 1;
    const cb = args[cbIdx];
    const schIdx = args.findIndex((a, i) => i > 0 && i < cbIdx && isZodShape(a));
    if (typeof cb !== 'function') return origTool(...args);
    const aliases = {};
    let needName = false, needTask = false;
    if (schIdx > 0) {
      const sch = { ...args[schIdx] };
      if (sch.name && !sch.name.isOptional() && sch.name._def.typeName === 'ZodString') {
        needName = true;
        sch.name = sch.name.optional();
        for (const a of NAME_ALIASES) if (!sch[a]) { sch[a] = z.string().optional(); aliases[a] = 'name'; }
      }
      if (sch.taskIndex && !sch.taskIndex.isOptional()) {
        needTask = true;
        sch.taskIndex = sch.taskIndex.optional();
        if (!sch.index) { sch.index = z.number().int().min(0).optional(); aliases.index = 'taskIndex'; }
      }
      args[schIdx] = sch;
    }
    args[cbIdx] = async (input, extra) => {
      const a = { ...(input || {}) };
      for (const [from, to] of Object.entries(aliases)) {
        if ((a[to] == null || a[to] === '') && a[from] != null && a[from] !== '') a[to] = a[from];
        delete a[from];
      }
      if (needName && (a.name == null || String(a.name).trim() === '')) throw new Error('`name` is required: the note name (or its id).');
      if (needTask && a.taskIndex == null) throw new Error('`taskIndex` is required (0-based index of the checklist item).');
      try {
        return capResult(await cb(a, extra));
      } catch (e) {
        const m = /^not found: (.+)$/.exec(e && e.message ? e.message : '');
        if (m) {
          const sug = await suggestNotes(m[1]);
          if (sug.length) e.message += `. Did you mean: ${sug.join('; ')}?`;
        }
        throw e;
      }
    };
    return origTool(...args);
  };
}

// Workspace-instructions resource — clients that auto-fetch MCP
// resources (Claude Desktop, etc.) pull this on session start so the
// user's behavior guide reaches the model even before the first tool
// call. Tool `get_ai_instructions` covers clients without resource
// support — content is identical.
server.registerResource(
  'ai-instructions',
  'edinot://ai-instructions',
  {
    title: 'Edinot — AI behavior guide',
    description: 'Workspace-specific instructions authored by the user in Ajustes → MCP.',
    mimeType: 'text/markdown',
  },
  async (uri) => {
    let text = '';
    let lang = 'es';
    try {
      await withSession(async (s) => {
        text = String(s.getSetting('aiInstructions', '') || '').trim();
        lang = String(s.getSetting('lang', 'es') || 'es');
      });
    } catch { /* fall back to default body */ }
    const body = text || defaultAiInstructions(lang);
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: body }] };
  },
);

// Wrap server.tool() so every handler — read-only or write — runs with
// `currentToolName` set. withSession() reads it and emits a floor
// `mcp_tool` action so the AI-peer chip in the renderer shows ANY MCP
// invocation, not only the ~26 tools that already call publishMcpAction
// manually.
{
  const orig = server.tool.bind(server);
  server.tool = (name, ...rest) => {
    const handler = rest[rest.length - 1];
    rest[rest.length - 1] = async (...args) => {
      const prevName = currentToolName;
      const prevArgs = currentToolArgs;
      currentToolName = name;
      // MCP SDK passes the parsed Zod input as the first arg.
      currentToolArgs = args && args[0] && typeof args[0] === 'object' ? args[0] : null;
      try { await prepareHubConfig(); return await handler(...args); }
      finally { currentToolName = prevName; currentToolArgs = prevArgs; }
    };
    return orig(name, ...rest);
  };
}

// Tag JSON responses with the recommended next visual call(s) so models
// that don't read server.instructions still get nudged at the point of
// use. Hints are advisory — they describe the visual tool and its key
// arguments, not full payloads.
function withHints(payload, hints) {
  if (!hints || !hints.length) return payload;
  return { ...payload, nextActions: hints };
}

// ─── Vault references ──────────────────────────────────────────────────────
// The MCP accepts `vault` as either a vault name OR a vault id. Names are
// looked up case-insensitively. Ids are stable across renames; names are
// not. Whenever a caller (LLM) cares about referring to the same vault
// across sessions or after a rename, they should grab the `vaultId` from
// list_notes / list_vaults / note_info and use that. Passing a name that
// doesn't match any vault throws an error listing the actual vaults so
// the caller can retry — no silent fallback into 'default'.

server.tool(
  'list_notes',
  'List notes in the active workspace. Optionally filter by vault (name or id). '
  + 'Each note exposes both `vaultId` (stable) and `vault` (current name) so '
  + 'callers can keep references intact across vault renames.',
  { vault: z.string().optional() },
  async ({ vault }) => withSession(async (s) => {
    const files = s.listFiles({ vault });
    return json(files.map((f) => ({
      id: f.id,
      name: f.name,
      vaultId: f.vaultId || 'default',
      vault: s.vaultName(f.vaultId),
    })));
  }),
);

// Size guards for read_note. A long note with many full-size images used to
// come back as one multi-megabyte response that killed the MCP connection
// ("Connection closed"); now text is paged and images are capped.
const READ_NOTE_DEFAULT_CHARS = 40000;
const READ_NOTE_MAX_CHARS = 200000;
const READ_NOTE_DEFAULT_IMAGES = 3;

server.tool(
  'read_note',
  'Read the markdown content of a note by name (case-insensitive, .md '
  + 'optional) or by id. Long notes are returned in pages: by default the '
  + `first ${READ_NOTE_DEFAULT_CHARS} characters; when the trailing `
  + '[read_note] block says `truncated`, call again with `offset` = '
  + `\`nextOffset\` (or raise \`maxChars\`, max ${READ_NOTE_MAX_CHARS}). Images `
  + 'referenced in the returned text are attached as vision blocks, up to '
  + `\`maxImages\` (default ${READ_NOTE_DEFAULT_IMAGES}, 0 = none; very large `
  + 'images are skipped). For big notes prefer get_outline + read_section, '
  + 'or search_in_note.',
  {
    name: z.string(),
    offset: z.number().int().min(0).optional(),
    maxChars: z.number().int().min(1).max(READ_NOTE_MAX_CHARS).optional(),
    maxImages: z.number().int().min(0).max(20).optional(),
  },
  async ({ name, offset, maxChars, maxImages }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const body = String((await s.readContent(f.id)) ?? '');
    const start = Math.min(offset || 0, body.length);
    const cap = maxChars || READ_NOTE_DEFAULT_CHARS;
    let end = Math.min(body.length, start + cap);
    // Do not cut in the middle of a line when we can avoid it.
    if (end < body.length) {
      const nl = body.lastIndexOf('\n', end);
      if (nl > start + cap * 0.5) end = nl + 1;
    }
    const text = body.slice(start, end);
    const truncated = start > 0 || end < body.length;
    const { blocks: images, skipped } = await imageBlocksForContent(text, {
      max: maxImages ?? READ_NOTE_DEFAULT_IMAGES,
      withSkipped: true,
    });
    const content = [{ type: 'text', text }];
    if (truncated || skipped) {
      const meta = { note: f.name, id: f.id, totalChars: body.length, offset: start, returnedChars: text.length, truncated };
      if (end < body.length) meta.nextOffset = end;
      if (skipped) meta.imagesSkipped = skipped;
      content.push({ type: 'text', text: '[read_note] ' + JSON.stringify(meta) });
    }
    // Markdown text first, then each referenced image as a vision block so the
    // model can actually read images embedded in the note.
    content.push(...images);
    return { content };
  }),
);

server.tool(
  'search_in_note',
  'Search the text of ONE note and return only the matching lines (with line '
  + 'numbers + character offsets) instead of dumping the whole note — cheaper '
  + 'than read_note for long notes when you only need the passages that mention '
  + 'something. `query` is a case-insensitive substring by default; set '
  + '`regex:true` to treat it as a JS regular expression, `caseSensitive:true` '
  + 'to match case. `context` includes N lines of surrounding text around each '
  + 'hit. Each match has 1-based `line`/`col`, a content `offset` (handy for '
  + 'reveal_change / highlight_in_note), and the line `text`.',
  {
    name: z.string(),
    query: z.string().min(1),
    regex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    context: z.number().int().min(0).max(10).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  async ({ name, query, regex, caseSensitive, context, limit }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = String(await s.readContent(f.id));
    const lines = content.split('\n');
    const ctx = context || 0;
    const cap = limit || 100;
    let matcher = null;
    if (regex) {
      try { matcher = new RegExp(query, caseSensitive ? 'g' : 'gi'); }
      catch (e) { throw new Error(`invalid regex: ${e.message}`); }
    }
    const needle = caseSensitive ? query : query.toLowerCase();
    // Per-line start offsets into the full content (for `offset`).
    const lineStart = [];
    let acc = 0;
    for (const ln of lines) { lineStart.push(acc); acc += ln.length + 1; }
    const matches = [];
    for (let i = 0; i < lines.length && matches.length < cap; i++) {
      const line = lines[i];
      let col = -1;
      if (regex) {
        matcher.lastIndex = 0;
        const m = matcher.exec(line);
        if (m) col = m.index;
      } else {
        col = (caseSensitive ? line : line.toLowerCase()).indexOf(needle);
      }
      if (col < 0) continue;
      const hit = { line: i + 1, col: col + 1, offset: lineStart[i] + col, text: line };
      if (ctx > 0) {
        hit.before = lines.slice(Math.max(0, i - ctx), i);
        hit.after = lines.slice(i + 1, Math.min(lines.length, i + 1 + ctx));
      }
      matches.push(hit);
    }
    return json({
      name: f.name,
      noteId: f.id,
      query,
      mode: regex ? 'regex' : 'substring',
      matchCount: matches.length,
      truncated: matches.length >= cap,
      matches,
    });
  }),
);

server.tool(
  'write_note',
  'Overwrite a note (creates if missing). `name` is just the filename — NEVER '
  + 'include a folder path. `vault` accepts a name or id; unknown values throw '
  + 'with the list of valid vaults. `folder` (optional) places a new note inside '
  + 'a folder; accepts a folder name or "Parent/Child" path within the target '
  + 'vault. The folder must already exist — create it with create_folder first; '
  + 'an invalid value now throws with the list of available folders so you can '
  + 'self-correct. '
  + 'IMPORTANT — location: if the user said "in this folder", "here", or did not '
  + 'specify a vault, call `get_active_context` FIRST and reuse '
  + '`activeNote.vault` + `activeNote.folderPath`. Omitting `folder` always '
  + 'lands the new note at the vault root, which is rarely what the user wants. '
  + 'When the note already exists this tool ignores `folder` (use move_note to '
  + 'relocate an existing note). '
  + 'AFTER calling this, ALWAYS chain `focus_note` to open it for the user, '
  + 'and add `highlight_in_note` (single key passage) or `present_in_note` '
  + '(walk-through, ≥3 distinct points). See server instructions for the full playbook.',
  {
    name: z.string(),
    content: z.string(),
    vault: z.string().optional(),
    folder: z.string().optional(),
  },
  async ({ name, content, vault, folder }) => withSession(async (s) => {
    let f = s.findFileByName(name);
    const created = !f;
    if (!f) f = await s.createFile(name, vault || 'default', folder || null);
    await s.writeContent(f.id, content);
    s.publishMcpAction({
      kind: created ? 'create' : 'write',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      folderId: f.folderId || null,
      bytes: content.length,
    });
    return json(withHints({
      ok: true, id: f.id, name: f.name,
      vaultId: f.vaultId || 'default',
      vault: s.vaultName(f.vaultId),
      folderId: f.folderId || null,
      bytes: content.length,
    }, [
      { tool: 'reveal_change', args: { name: f.name, text: '<exact substring you want the user to land on>' }, reason: 'open the note + scroll to the change + pulse it so the user sees the diff' },
      { tool: 'highlight_in_note', args: { name: f.name, text: '<one short passage>' }, reason: 'reveal_change PLUS a speech-bubble explaining the change' },
      { tool: 'present_in_note',  args: { name: f.name, steps: [{ text: '<...>', message: '<why it matters>' }] }, reason: 'walk through ≥3 distinct claims instead of one reveal' },
    ]));
  }),
);

server.tool(
  'create_note',
  'Create a new note (fails if name already exists). `name` is just the '
  + 'filename — NEVER include a folder path. Use `folder` (optional) to place '
  + 'the note inside a folder by name or "Parent/Child" path within the vault. '
  + 'Folder must already exist; create it with create_folder if needed. An '
  + 'invalid `folder` now throws with the list of available paths so you can '
  + 'retry without guessing. '
  + 'IMPORTANT — location: if the user said "in this folder", "here", "next to '
  + 'X", or did not specify a vault, call `get_active_context` FIRST and reuse '
  + '`activeNote.vault` + `activeNote.folderPath`. Omitting `folder` always '
  + 'creates the note at the vault root, which is rarely what the user wants. '
  + 'AFTER calling this, chain `focus_note` + `highlight_in_note` / '
  + '`present_in_note` so the user immediately sees what was created.',
  {
    name: z.string(),
    content: z.string().optional(),
    vault: z.string().optional(),
    folder: z.string().optional(),
  },
  async ({ name, content, vault, folder }) => withSession(async (s) => {
    if (s.findFileByName(name)) throw new Error(`already exists: ${name}`);
    const f = await s.createFile(name, vault || 'default', folder || null);
    if (content) await s.writeContent(f.id, content);
    s.publishMcpAction({
      kind: 'create',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      folderId: f.folderId || null,
      bytes: content ? content.length : 0,
    });
    return json(withHints({
      ok: true, id: f.id, name: f.name,
      vaultId: f.vaultId || 'default',
      vault: s.vaultName(f.vaultId),
      folderId: f.folderId || null,
    }, [
      { tool: 'reveal_change', args: { name: f.name, text: '<exact substring of the new content>' }, reason: 'open + scroll + pulse so the user sees what you wrote' },
      { tool: 'highlight_in_note', args: { name: f.name, text: '<one passage>' }, reason: 'reveal PLUS a speech-bubble if there is a single key passage' },
      { tool: 'present_in_note',  args: { name: f.name, steps: [] }, reason: 'narrate ≥3 distinct points instead of one reveal' },
    ]));
  }),
);

server.tool(
  'delete_note',
  'Delete a note by name.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const vaultName = s.vaultName(f.vaultId);
    const vaultId = f.vaultId || 'default';
    await s.deleteFile(f.id);
    s.publishMcpAction({
      kind: 'delete',
      note: f.name, noteId: f.id,
      vault: vaultName, vaultId,
    });
    return text(`deleted ${f.id}`);
  }),
);

server.tool(
  'rename_note',
  'Rename a note. ONLY changes the filename. NEVER pass "Folder/Note" — that is '
  + 'a move, not a rename, and this tool will reject any newName containing "/". '
  + 'To put a note inside a folder use move_note. To put a note inside another '
  + 'vault use move_note with the `vault` argument.',
  { oldName: z.string(), newName: z.string() },
  async ({ oldName, newName }) => withSession(async (s) => {
    const f = s.findFileByName(oldName);
    if (!f) throw new Error(`not found: ${oldName}`);
    s.renameFile(f.id, newName);
    s.publishMcpAction({
      kind: 'rename',
      note: newName, noteId: f.id,
      from: f.name,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
    });
    return text(`renamed ${f.id} → ${newName}`);
  }),
);

// ── Recall (ranked multi-keyword search) ──────────────────────────────
// Lightweight TF-IDF over the vault. Use this — not search_notes — when
// the LLM is trying to find prior context for a topic (e.g. "what did
// we decide about onboarding last week?"). Multi-keyword scoring beats
// substring match because the user's query rarely appears verbatim.

const STOP_WORDS = new Set([
  'a','al','algo','algunas','algunos','ante','antes','como','con','contra',
  'de','del','desde','donde','durante','el','la','las','lo','los','para',
  'pero','por','que','qué','si','sin','sobre','su','sus','un','una','unas',
  'unos','y','o','u','e','en','es','está','este','esto','estos','esa',
  'esos','le','les','me','mi','mis','no','nos','nuestro','nuestra','os',
  'se','te','tu','tus','ya','muy','también','así',
  'a','an','the','and','or','of','in','to','for','on','at','by','from',
  'with','this','that','those','these','it','its','as','be','is','are',
  'was','were','been','have','has','had','do','does','did','not','no',
  'i','you','we','they','he','she','my','your','our','their','if','so',
]);

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

const BLOB_REF_RX = /[a-f0-9]{64}/gi;

// Pull every blob sha referenced in a note body. Recall iterates these to
// stitch attachment text into the scoring corpus. Filter to refs that look
// like a blob URL (edinot://blob/<sha>, /blobs/<sha>, etc.) by capturing the
// raw hash — the upstream batch endpoint silently drops non-existent ids.
function extractBlobShas(content) {
  if (!content) return [];
  const out = new Set();
  for (const m of String(content).matchAll(BLOB_REF_RX)) out.add(m[0].toLowerCase());
  return [...out];
}

// Fetch extracted text for the given blob ids in one request. Cached per
// recall() invocation because a single note may reference the same blob
// in multiple places and the same blob may live in several notes.
async function fetchBlobTexts(cfg, ids) {
  if (!ids || ids.length === 0) return new Map();
  // Local mode has no server — attachments aren't indexed.
  if (cfg.mode === 'local') return new Map();
  if (!cfg.token || !cfg.server) return new Map();
  try {
    const body = await api.blobTextBatch(cfg.server, cfg.token, ids);
    const map = new Map();
    for (const row of (body.blobs || [])) {
      if (row && row.text) map.set(row.id, row.text);
    }
    return map;
  } catch (err) {
    // Server may be older (no /blobs/text route) or offline. Recall still
    // works against note body text — degrade silently.
    return new Map();
  }
}

// Inline every image blob referenced in `content` as an MCP image content
// block so the model actually SEES the picture, not just the
// `edinot://blob/<sha>` reference. Non-image blobs (PDF/DOCX/…) are skipped —
// their extracted text already surfaces via recall. Per product decision this
// is uncapped: a note with N images yields N image blocks. Local-mode (no
// server) has no blob store, so it returns nothing.
// Caps so a note full of photos cannot blow up one MCP response (the client
// drops the connection on multi-megabyte payloads).
const IMAGE_BLOCK_MAX_BYTES = 3_500_000;       // per image (raw; ≈4.7 MB base64, under the 5 MB API image cap)
const IMAGE_BLOCK_MAX_TOTAL_BYTES = 5_500_000; // all images in one response (old crash: 13 screenshots = 28 MB)

async function imageBlocksForContent(content, opts = {}) {
  const {
    max = Infinity,
    maxBytes = IMAGE_BLOCK_MAX_BYTES,
    maxTotalBytes = IMAGE_BLOCK_MAX_TOTAL_BYTES,
    withSkipped = false,
  } = opts;
  const done = (blocks, skipped = 0) => (withSkipped ? { blocks, skipped } : blocks);
  const cfg = resolveCfg();
  if (!cfg || cfg.mode === 'local' || !cfg.token || !cfg.server) return done([]);
  const shas = [...new Set(extractBlobShas(content))];
  if (!shas.length) return done([]);
  const blocks = [];
  let skipped = 0;
  let total = 0;
  for (const sha of shas) {
    if (blocks.length >= max) { skipped++; continue; }
    try {
      const { buffer, mime } = await api.blobFetch(cfg.server, cfg.token, sha);
      if (!mime || !mime.startsWith('image/')) continue;
      if (buffer.length > maxBytes || total + buffer.length > maxTotalBytes) { skipped++; continue; }
      total += buffer.length;
      blocks.push({ type: 'image', data: buffer.toString('base64'), mimeType: mime });
    } catch { /* missing / inaccessible blob — skip */ }
  }
  return done(blocks, skipped);
}

// image/png → .png, image/jpeg → .jpg, … — for a sensible upload filename.
function extForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/png') return '.png';
  if (m === 'image/gif') return '.gif';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/svg+xml') return '.svg';
  if (m === 'image/avif') return '.avif';
  if (m === 'image/bmp' || m === 'image/x-ms-bmp') return '.bmp';
  return '';
}
const IMG_EXT_RX = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

// ── Bytes de una subida (attach_image / attach_file / add_canvas_node) ──
// Un modelo que manda una imagen en base64 puede cortarla (límite de salida)
// y el servidor guardaba media imagen. Por eso se prefiere `path` (el MCP
// corre en el mismo equipo que la IA, así que lee el archivo directamente)
// y toda imagen se comprueba entera antes de subirla.

// Tipo real de imagen por la firma de sus primeros bytes, o null.
function sniffImageMime(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && /^avi[fs]$/.test(buf.toString('ascii', 8, 12))) return 'image/avif';
  if (buf.length >= 14 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 1024)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

// null si la imagen está completa; si no, qué le falta.
function imageTruncation(buf, mime) {
  const endsWith = (bytes) => buf.length >= bytes.length && bytes.every((b, i) => buf[buf.length - bytes.length + i] === b);
  switch (mime) {
    case 'image/png': return endsWith([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]) ? null : 'PNG end chunk (IEND) missing';
    case 'image/jpeg': {
      let i = buf.length - 1;
      while (i > 1 && buf[i] === 0x00) i--; // relleno tras el final
      return buf[i - 1] === 0xff && buf[i] === 0xd9 ? null : 'JPEG end marker (FFD9) missing';
    }
    case 'image/gif': return buf[buf.length - 1] === 0x3b ? null : 'GIF trailer missing';
    case 'image/webp': return buf.readUInt32LE(4) + 8 <= buf.length ? null : 'WebP shorter than its header says';
    case 'image/bmp': return buf.readUInt32LE(2) <= buf.length ? null : 'BMP shorter than its header says';
    case 'image/svg+xml': return /<\/svg>\s*$/i.test(buf.toString('utf8', Math.max(0, buf.length - 512))) ? null : 'SVG does not end with </svg>';
    default: return null;
  }
}

const CUT_HINT = 'The base64 was truncated — save the image to a file and pass its absolute `path` instead of `data`.';

function decodeBase64Strict(data) {
  const m = /^data:([^;,]*)[^,]*,(.*)$/s.exec(String(data).trim());
  const raw = (m ? m[2] : String(data)).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(raw)) throw new Error('`data` is not valid base64. ' + CUT_HINT);
  if (raw.replace(/=+$/, '').length % 4 === 1) throw new Error('`data` (base64) is cut off. ' + CUT_HINT);
  return { buffer: Buffer.from(raw, 'base64'), mime: m && m[1] ? m[1] : null };
}


// Un índice semántico por workspace (servidor + id), reutilizado entre llamadas.
const semanticIndexes = new Map();
function semanticIndexFor(cfg) {
  const k = `${(cfg && cfg.server) || 'local'}|${(cfg && cfg.workspaceId) || 'default'}`;
  if (!semanticIndexes.has(k)) semanticIndexes.set(k, new SemanticIndex(k));
  return semanticIndexes.get(k);
}

// ── Búsqueda tolerante (search_notes) ───────────────────────────────────
// Minúsculas y sin acentos, conservando la LONGITUD (cada carácter → uno),
// para que las posiciones sirvan sobre el texto original.
function foldText(t) {
  const src = String(t || '');
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const f = ch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out += f.length === 1 ? f : (f[0] || ch);
  }
  return out;
}
// "frase exacta" → { phrase }; si no, palabras sueltas (≥1 carácter).
function parseSearchQuery(q) {
  const raw = String(q || '').trim();
  const m = /^"(.+)"$/.exec(raw);
  if (m) return { phrase: foldText(m[1]).replace(/\s+/g, ' ').trim(), terms: [] };
  const terms = foldText(raw).split(/\s+/).filter(Boolean);
  return { phrase: terms.length === 1 ? terms[0] : null, terms };
}

// Bytes de `path` (archivo local absoluto), `data` (base64) o `url`, por ese
// orden de preferencia. null si no viene ninguno.
async function readUploadInput({ path: filePath, data, url, mime }) {
  let buffer; let finalMime = mime || null; let name = null; let via;
  if (filePath) {
    if (!nodePath.isAbsolute(filePath)) throw new Error('`path` must be absolute');
    buffer = readFileSync(filePath);
    name = nodePath.basename(filePath);
    if (!finalMime) { const g = mimeForName(name); if (g !== 'application/octet-stream') finalMime = g; }
    via = 'path';
  } else if (data) {
    const d = decodeBase64Strict(data);
    buffer = d.buffer;
    if (!finalMime) finalMime = d.mime;
    via = 'data';
  } else if (url) {
    // Algunos servidores de imágenes rechazan peticiones sin User-Agent.
    const r = await fetchRobust(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Edinot-MCP)', Accept: '*/*' }, redirect: 'follow' }, { timeoutMs: 45000, retries: 2 });
    if (!r.ok) throw new Error(`could not download ${url}: HTTP ${r.status}`);
    if (!finalMime) finalMime = (r.headers.get('content-type') || '').split(';')[0].trim() || null;
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || null; } catch {}
    buffer = Buffer.from(await r.arrayBuffer());
    via = 'url';
  } else {
    return null;
  }
  if (!buffer || !buffer.length) throw new Error('empty file');
  return { buffer, mime: finalMime, name, via };
}

// Comprueba que una imagen llegue entera y devuelve su mime real. Formatos
// que no se reconocen (ico, tiff, heic…) pasan tal cual salvo si vienen en
// base64 diciendo ser uno de los comunes: eso es una imagen cortada.
function assertWholeImage(input) {
  const sniffed = sniffImageMime(input.buffer);
  if (!sniffed) {
    const claimed = String(input.mime || '');
    if (input.via === 'data' && (!claimed || /png|jpe?g|gif|webp|svg|bmp|avif/i.test(claimed))) {
      throw new Error(`\`data\` does not decode to a complete image (${input.buffer.length} bytes). ${CUT_HINT}`);
    }
    return claimed.startsWith('image/') ? claimed : null;
  }
  const why = imageTruncation(input.buffer, sniffed);
  if (why) {
    throw new Error(`The image arrived incomplete (${input.buffer.length} bytes: ${why}). `
      + (input.via === 'data' ? CUT_HINT : `The source ${input.via} is incomplete.`));
  }
  return sniffed;
}

// ── Attachment helpers (list / read / download) ─────────────────────────
// Attachments are content-addressed blobs referenced in a note body as
// `![filename](edinot://blob/<sha>)` — the alt text carries the filename
// (optionally with an Obsidian-style `|width` size hint). Parse every
// reference into { sha, filename }, deduped by sha (an image embedded twice
// lists once). Bare `edinot://blob/<sha>` refs with no markdown wrapper are
// included with a synthesised name.
function extractAttachmentRefs(content) {
  const src = String(content || '');
  const out = [];
  const seen = new Set();
  for (const mm of src.matchAll(/!?\[([^\]]*)\]\(\s*edinot:\/\/blob\/([a-f0-9]{64})[^)]*\)/gi)) {
    const sha = mm[2].toLowerCase();
    if (seen.has(sha)) continue;
    const alt = String(mm[1] || '').replace(/\|\s*\d{1,5}(?:x\d{1,5})?\s*$/, '').trim();
    out.push({ sha, filename: alt || `attachment-${sha.slice(0, 8)}` });
    seen.add(sha);
  }
  for (const mm of src.matchAll(/edinot:\/\/blob\/([a-f0-9]{64})/gi)) {
    const sha = mm[1].toLowerCase();
    if (seen.has(sha)) continue;
    out.push({ sha, filename: `attachment-${sha.slice(0, 8)}` });
    seen.add(sha);
  }
  return out;
}

// Best-effort mime from a filename extension — used to classify attachments
// before we've fetched their bytes (blobFetch returns the authoritative mime).
function mimeForName(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
  const ext = m ? m[1] : '';
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

// Reverse of mimeForName for common types — gives an uploaded file a sensible
// extension when the caller passed a mime but no filename. Returns '' if
// unknown (the caller then leaves the name extension-less).
function extFromMime(mime) {
  const img = extForMime(mime);
  if (img) return img;
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  const map = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/csv': '.csv', 'text/plain': '.txt', 'text/markdown': '.md',
    'application/json': '.json',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
    'application/zip': '.zip',
  };
  return map[m] || '';
}

// Attachments live in the synced blob store; local mode has none.
function requireSyncedBlobs(cfg) {
  if (!cfg || cfg.mode === 'local' || !cfg.token || !cfg.server) {
    throw new Error('Attachment access needs a synced (non-local) workspace — '
      + 'local mode has no blob store.');
  }
}

// Resolve a user selector ("invoice.pdf", "invoice", or a sha / sha prefix) to
// exactly one attachment. With no selector, only succeeds if the note has one.
function pickAttachment(refs, selector) {
  if (!refs.length) throw new Error('this note has no attachments');
  if (!selector) {
    if (refs.length === 1) return refs[0];
    throw new Error(`note has ${refs.length} attachments — pass \`attachment\` `
      + `(filename or sha). Options: ${refs.map(r => r.filename).join(', ')}`);
  }
  const sel = String(selector).toLowerCase().trim();
  let hit = refs.find(r => r.sha === sel) || refs.find(r => r.filename.toLowerCase() === sel);
  if (hit) return hit;
  const subs = refs.filter(r => r.filename.toLowerCase().includes(sel) || r.sha.startsWith(sel));
  if (subs.length === 1) return subs[0];
  if (subs.length > 1) {
    throw new Error(`"${selector}" matches ${subs.length} attachments: `
      + subs.map(r => r.filename).join(', '));
  }
  throw new Error(`no attachment matches "${selector}". `
    + `Options: ${refs.map(r => r.filename).join(', ')}`);
}

// ── Search over big vaults ─────────────────────────────────────────────
// recall / search_notes used to read every note through readContent →
// readContentLatest, i.e. one Hocuspocus per-note sync per note (LRU of 24
// providers, so big vaults re-synced everything on each call and one
// stalled note could block for 45 s). Now:
//   1. score/match against the bodies already in memory (vault doc
//      `content:<id>` copies, or the per-note doc when it's open) —
//      s.readContentCached, no network;
//   2. re-read only the top hits fresh (s.readContentFresh: bounded
//      concurrency, per-note deadline falling back to the in-memory copy)
//      to confirm them and build snippets from the latest text.
// The data model is untouched.
const SEARCH_REFRESH_CONCURRENCY = 6;
const SEARCH_REFRESH_TIMEOUT_MS = 3000;

function readCachedBody(s, id) {
  return typeof s.readContentCached === 'function' ? s.readContentCached(id) : null;
}
// Cuerpo para RECORRIDOS de todo el vault (etiquetas, enlaces, canvases…):
// la copia en memoria (instantánea) y solo si no hay, la lectura por red.
// Antes cada nota se sincronizaba por separado y list_tags/list_canvases
// tardaban >2 min con ~450 notas (timeout del cliente).
async function scanBody(s, id) {
  const c = readCachedBody(s, id);
  return c != null ? c : await s.readContent(id);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// id → fresh body for a handful of hits.
async function refreshBodies(s, ids) {
  const fresh = new Map();
  const read = typeof s.readContentFresh === 'function'
    ? (id) => s.readContentFresh(id, SEARCH_REFRESH_TIMEOUT_MS)
    : (id) => s.readContent(id);
  await mapLimit(ids, SEARCH_REFRESH_CONCURRENCY, async (id) => {
    try { fresh.set(id, String((await read(id)) ?? '')); } catch { /* keep the cached copy */ }
  });
  return fresh;
}

// TF of a note body, cached per (noteId, content hash): repeated recall
// calls only re-tokenize notes that changed.
const recallTfCache = new Map(); // id → { key, tf }
function contentKey(content) {
  return content.length + ':' + createHash('sha1').update(content).digest('base64');
}
function bodyTf(id, content) {
  const key = contentKey(content);
  const hit = recallTfCache.get(id);
  if (hit && hit.key === key) return hit.tf;
  const tf = new Map();
  for (const tk of tokenize(content)) tf.set(tk, (tf.get(tk) || 0) + 1);
  recallTfCache.set(id, { key, tf });
  if (recallTfCache.size > 50000) recallTfCache.delete(recallTfCache.keys().next().value);
  return tf;
}

server.tool(
  'recall',
  'Ranked multi-keyword search over every note (TF-IDF scoring). Use this '
  + 'instead of `search_notes` when you need to find prior context for a '
  + 'topic — "what did we decide about onboarding last week?", "where did '
  + 'we discuss the billing rewrite?". The query is tokenized (stop-words '
  + 'removed, accents folded) and scored against tokens in note name + '
  + 'body; name matches weight 3x. Returns up to `limit` hits newest-first '
  + 'within a score band, each with a `snippet` window per matched term. '
  + 'Filter by `vault` (name or id) to scope. AFTER calling, chain '
  + '`focus_note` + `spotlight_pulse` or `highlight_in_note` on the top '
  + 'hit so the user sees where the answer lives.',
  {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional(),
    vault: z.string().optional(),
  },
  async ({ query, limit, vault }) => withSession(async (s) => {
    const max = limit || 10;
    const qTerms = Array.from(new Set(tokenize(query)));
    if (!qTerms.length) {
      throw new Error('query has no searchable terms (all stop-words or punctuation).');
    }
    const files = s.listFiles({ vault });
    if (!files.length) return json({ count: 0, terms: qTerms, hits: [] });
    // First pass: every note's in-memory body + the blob attachments it
    // references (one /blobs/text batch, ≤500).
    const rawDocs = [];
    const allShas = new Set();
    for (const f of files) {
      let content = readCachedBody(s, f.id);
      if (content == null) content = await s.readContent(f.id);
      content = String(content || '');
      const refs = extractBlobShas(content);
      for (const id of refs) allShas.add(id);
      rawDocs.push({ f, content, refs });
    }
    const cfg = resolveCfg();
    const blobTextMap = await fetchBlobTexts(cfg, [...allShas].slice(0, 500));
    const attachTokenCache = new Map(); // sha → Map(term → n)
    const attachTfOf = (sha) => {
      let m = attachTokenCache.get(sha);
      if (!m) {
        m = new Map();
        const t = blobTextMap.get(sha);
        if (t) for (const tk of tokenize(t)) m.set(tk, (m.get(tk) || 0) + 1);
        attachTokenCache.set(sha, m);
      }
      return m;
    };
    // Per doc: body TF (cached) + attachment + name (x3) frequencies, only
    // looked up for the query terms.
    const buildDoc = ({ f, content, refs }) => {
      const body = bodyTf(f.id, content);
      const nameTf = new Map();
      for (const tk of tokenize(f.name)) nameTf.set(tk, (nameTf.get(tk) || 0) + 1);
      const attachedSnippets = [];
      const attachTfs = [];
      for (const sha of refs) {
        const t = blobTextMap.get(sha);
        if (!t) continue;
        attachTfs.push(attachTfOf(sha));
        attachedSnippets.push({ sha, text: t });
      }
      const tfOf = (term) => {
        let n = (body.get(term) || 0) + 3 * (nameTf.get(term) || 0);
        for (const m of attachTfs) n += m.get(term) || 0;
        return n;
      };
      return { f, content, tfOf, attachedSnippets };
    };
    const docs = rawDocs.map(buildDoc);
    const N = docs.length;
    const df = new Map();
    for (const term of qTerms) {
      let n = 0;
      for (const d of docs) if (d.tfOf(term) > 0) n++;
      df.set(term, n);
    }
    const scoreDoc = (d) => {
      let score = 0;
      const matched = [];
      for (const term of qTerms) {
        const f = d.tfOf(term);
        if (!f) continue;
        const idf = Math.log(1 + N / (df.get(term) || 1));
        score += f * idf;
        matched.push(term);
      }
      if (score <= 0) return null;
      // Multi-term match bonus: encourages docs that hit more of the query.
      score *= 1 + 0.25 * (matched.length - 1);
      return { d, score, matched };
    };
    let scored = docs.map(scoreDoc).filter(Boolean);
    scored.sort((a, b) => b.score - a.score);
    // Second pass: re-read the leading candidates fresh (bounded, with a
    // deadline) and re-score the ones whose body changed.
    const cand = scored.slice(0, Math.min(scored.length, max + Math.max(5, max)));
    const fresh = await refreshBodies(s, cand.map(c => c.d.f.id));
    scored = cand.map((c) => {
      const body = fresh.get(c.d.f.id);
      if (body == null || body === c.d.content) return c;
      const raw = rawDocs.find(r => r.f.id === c.d.f.id);
      return scoreDoc(buildDoc({ f: c.d.f, content: body, refs: raw ? raw.refs : [] }));
    }).filter(Boolean);
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, max);
    const hits = top.map(({ d, score, matched }) => {
      const { f, content, attachedSnippets } = d;
      // One snippet per matched term, deduped by position so we don't
      // surface 5 windows from the same paragraph. We search the note
      // body first, then fall back to attachment text so the user still
      // sees *where* a hit lives when the match only appears inside a
      // PDF/DOCX/XLSX.
      const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const lower = norm(content);
      const snippets = [];
      const seen = new Set();
      const pushFrom = (source, body, lowerBody, prefix) => {
        for (const term of matched) {
          if (snippets.length >= 3) return;
          const idx = lowerBody.indexOf(term);
          if (idx < 0) continue;
          const key = source + ':' + Math.floor(idx / 80);
          if (seen.has(key)) continue;
          seen.add(key);
          const start = Math.max(0, idx - 50);
          const end = Math.min(body.length, idx + term.length + 60);
          snippets.push({
            term,
            source,
            text: (prefix || '') + (start > 0 ? '…' : '') + body.slice(start, end).replace(/\s+/g, ' ').trim() + (end < body.length ? '…' : ''),
          });
        }
      };
      pushFrom('note', content, lower, '');
      if (snippets.length < 3 && attachedSnippets && attachedSnippets.length) {
        for (const att of attachedSnippets) {
          if (snippets.length >= 3) break;
          pushFrom('attachment', att.text, norm(att.text), `📎 `);
        }
      }
      return {
        id: f.id, name: f.name,
        vaultId: f.vaultId || 'default',
        vault: s.vaultName(f.vaultId),
        score: Math.round(score * 100) / 100,
        matched,
        snippets,
      };
    });
    return json(withHints({
      count: hits.length,
      terms: qTerms,
      hits,
    }, hits.length ? [
      { tool: 'focus_note', args: { name: hits[0].name }, reason: 'open the top hit for the user' },
      { tool: 'spotlight_pulse', args: { name: hits[0].name, text: '<exact phrase from snippet>' }, reason: 'flash the matching passage so the user sees what you found' },
    ] : []));
  }),
);

server.tool(
  'search_notes',
  'Search note names and content, ignoring case AND accents ("tecnicos" finds '
  + '"técnicos"). Several words = every word must appear (any order); wrap the '
  + 'query in double quotes for an exact phrase. Hits are sorted by relevance '
  + '(`score`: name matches and frequency). Each hit '
  + 'has `matchedIn` ("name", "content" or both), `matchCount`, `snippet` (the '
  + 'first content match, or the start of the note when only the name '
  + 'matched) and up to `snippets` passages in `snippets`, plus `vaultId` '
  + '(stable) and `vault`. Narrow results with `vault`, `nameContains` (e.g. '
  + '"Noviembre 2026" to stay inside one month\'s notes) and `in` '
  + '("content" to ignore name-only matches). Use `recall` for ranked '
  + 'multi-keyword search.',
  {
    query: z.string(),
    limit: z.number().int().min(1).max(200).optional(),
    vault: z.string().optional(),
    nameContains: z.string().optional(),
    in: z.enum(['any', 'name', 'content']).optional(),
    snippets: z.number().int().min(1).max(10).optional(),
    snippetChars: z.number().int().min(20).max(400).optional(),
  },
  async ({ query, limit, vault, nameContains, in: where, snippets, snippetChars }) => withSession(async (s) => {
    // Sin distinguir mayúsculas NI acentos («tecnicos» encuentra «técnicos»).
    // Varias palabras = todas deben aparecer (en cualquier orden); entre
    // comillas = frase exacta. Resultados ordenados por relevancia.
    const { phrase, terms } = parseSearchQuery(query);
    const max = limit || 50;
    const scope = where || 'any';
    const nShots = snippets || 3;
    const pad = snippetChars || 80;
    const nameFilter = nameContains ? foldText(nameContains) : null;
    const clean = (t) => t.replace(/!\[[^\]]*\]\([^)]*\)/g, '[img]').replace(/\s+/g, ' ').trim();
    const matchOf = (f, c) => {
      const fn = foldText(f.name || '');
      const fc = foldText(c);
      const needles = phrase ? [phrase] : terms;
      if (!needles.length) return null;
      const inNameAll = needles.every(t => fn.includes(t));
      const contentHits = needles.map(t => { const ps = []; for (let i = fc.indexOf(t); i !== -1 && ps.length < 200; i = fc.indexOf(t, i + t.length)) ps.push(i); return ps; });
      // Cada término en el nombre o en el contenido.
      const allFound = needles.every((t, k) => fn.includes(t) || contentHits[k].length > 0);
      if (!allFound) return null;
      const inName = needles.some(t => fn.includes(t));
      const inContent = contentHits.some(ps => ps.length > 0);
      if (scope === 'name' && !inNameAll) return null;
      if (scope === 'content' && !needles.every((t, k) => contentHits[k].length > 0)) return null;
      // Frase entera (sin comillas) dentro del texto: puntúa extra.
      const whole = !phrase && terms.length > 1 ? foldText(query).replace(/\s+/g, ' ').trim() : null;
      const wholeHits = whole && fc.includes(whole) ? 1 : 0;
      const positions = [].concat(...contentHits).sort((x, y) => x - y);
      const score = (inNameAll ? 50 : inName ? 15 : 0) + wholeHits * 20
        + contentHits.reduce((acc, ps) => acc + Math.min(ps.length, 20), 0);
      const shots = [];
      for (const idx of positions) {
        if (shots.length >= nShots) break;
        if (shots.length && idx - shots[shots.length - 1].at < pad) continue;
        const a = Math.max(0, idx - pad);
        const b = Math.min(c.length, idx + pad + 20);
        shots.push({ at: idx, text: (a > 0 ? '…' : '') + clean(c.slice(a, b)) + (b < c.length ? '…' : '') });
      }
      return {
        id: f.id, name: f.name,
        vaultId: f.vaultId || 'default',
        vault: s.vaultName(f.vaultId),
        matchedIn: inName && inContent ? 'name+content' : inName ? 'name' : 'content',
        matchCount: positions.length,
        score,
        snippet: shots[0] ? shots[0].text : clean(c.slice(0, pad * 2)),
        ...(shots.length > 1 ? { snippets: shots.map(x => x.text) } : {}),
      };
    };
    // 1) Cuerpos en memoria: TODAS las notas (para poder ordenar), con tope
    //    de tiempo para vaults enormes.
    const cand = [];
    const deadline = Date.now() + 12000;
    for (const f of s.listFiles({ vault })) {
      if (nameFilter && !foldText(f.name || '').includes(nameFilter)) continue;
      let c = readCachedBody(s, f.id);
      if (c == null) c = await s.readContent(f.id);
      c = String(c || '');
      const hit = matchOf(f, c);
      if (hit) cand.push({ f, c, score: hit.score });
      if (Date.now() > deadline) break;
    }
    cand.sort((x, y) => y.score - x.score);
    const top = cand.slice(0, Math.min(max * 2, max + 20));
    // 2) Confirmar + extractos con el texto más reciente (acotado).
    const fresh = await refreshBodies(s, top.map(x => x.f.id));
    const out = [];
    for (const { f, c } of top) {
      const hit = matchOf(f, fresh.has(f.id) ? fresh.get(f.id) : c);
      if (hit) out.push(hit);
    }
    out.sort((x, y) => y.score - x.score);
    return json(out.slice(0, max));
  }),
);

// ── Vault management ───────────────────────────────────────────────────────

server.tool(
  'list_vaults',
  'List all vaults with id, name, and number of notes. Always includes "default".',
  {},
  async () => withSession(async (s) => json(s.listVaults())),
);

server.tool(
  'create_vault',
  'Create a new vault. Fails if a vault with that name already exists (case-insensitive).',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const r = await s.createVault(name);
    s.publishMcpAction({ kind: 'vault_create', vault: r.name, vaultId: r.id });
    return json(r);
  }),
);

server.tool(
  'rename_vault',
  'Rename an existing vault. Vault is looked up by current name (case-insensitive). Cannot rename "default".',
  { currentName: z.string(), newName: z.string() },
  async ({ currentName, newName }) => withSession(async (s) => {
    const r = s.renameVault(currentName, newName);
    s.publishMcpAction({ kind: 'vault_rename', vault: r.name, vaultId: r.id, from: currentName });
    return json(r);
  }),
);

server.tool(
  'delete_vault',
  'Delete a vault. Its notes are reassigned to the "default" vault. Cannot delete "default".',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const r = s.deleteVault(name);
    s.publishMcpAction({
      kind: 'vault_delete',
      vault: r.name, vaultId: r.id,
      movedFiles: r.movedFiles,
    });
    return json(r);
  }),
);

// ── Workspaces (cross-workspace navigation) ───────────────────────────────
// MCP binds one workspace at a time via cli.json — but an Edinot user is
// often a member of more than one (their own + every workspace they were
// invited to). `list_workspaces` surfaces the full set; `switch_workspace`
// rewrites cli.json so the NEXT MCP call resolves against the chosen
// workspace. The currently-open session is closed after the switch so the
// new session opens against the new workspace doc set.

server.tool(
  'list_workspaces',
  'List every workspace the authenticated user can access (owned + invited). '
  + 'Returns id, name, role, ownerEmail, isOwn, and current=true on the active '
  + 'workspace. Useful when the user asks about notes that live in a shared '
  + 'workspace — pair with `switch_workspace` to access them.',
  {},
  async () => {
    const cfg = resolveCfg();
    if (cfg.mode === 'local') return json({ mode: 'local', workspaces: [] });
    const data = await api.workspaces(cfg.server, cfg.token);
    const list = (data && data.workspaces) || [];
    return json(list.map(w => ({ ...w, current: Number(w.id) === Number(cfg.workspaceId) })));
  },
);

server.tool(
  'switch_workspace',
  'Switch the active workspace for subsequent MCP calls. Pass a workspaceId from '
  + '`list_workspaces`. Persists to ~/.config/edinot/cli.json so the change '
  + 'survives across MCP calls and tool restarts. Has no effect in local-file '
  + 'mode (EDINOT_VAULT_DIR).',
  { workspaceId: z.number() },
  async ({ workspaceId }) => {
    const cfg = resolveCfg();
    if (cfg.mode === 'local') throw new Error('switch_workspace not available in local mode');
    const data = await api.workspaces(cfg.server, cfg.token);
    const list = (data && data.workspaces) || [];
    const target = list.find(w => Number(w.id) === Number(workspaceId));
    if (!target) {
      const ids = list.map(w => w.id).join(', ');
      throw new Error(`workspaceId ${workspaceId} not accessible. Available: [${ids}]`);
    }
    // env-var sessions can't be persisted (cli.json is the persistent store).
    // For those we error early so the caller knows nothing changed.
    if (process.env.EDINOT_WORKSPACE_ID) {
      throw new Error('MCP is running with EDINOT_WORKSPACE_ID — change the env var instead of switching');
    }
    const current = loadConfig() || {};
    saveConfig({ ...current, workspaceId: target.id });
    return json({ ok: true, workspaceId: target.id, workspaceName: target.name, role: target.role });
  },
);

// ── AI behavior guide (per-workspace) ─────────────────────────────────────
// User-authored instructions stored in `ySettings.aiInstructions`. Edited
// in Ajustes → MCP. The model SHOULD fetch via this tool at the start of
// every conversation so workspace-specific guidance (vault conventions,
// preferred templates, terminology, etc.) shapes the rest of the turn.
// Free tier OK — instructions live on the workspace shell doc which is
// always synced.

server.tool(
  'get_ai_instructions',
  'Fetch behavior guide for this workspace. Returns user-authored '
  + 'instructions (set in Ajustes → MCP → "Instrucciones para la IA") '
  + 'when present, otherwise a sensible default that establishes '
  + 'Edinot as the AI\'s primary persistent-memory / knowledge hub. '
  + 'Call once at the start of every new conversation; treat the '
  + 'returned text as a hard system prompt — it captures vault '
  + 'conventions, naming rules, preferred templates, tone, and '
  + 'anything else the workspace owner wants the AI to honor.',
  {},
  async () => withSession(async (s) => {
    const userText = String(s.getSetting('aiInstructions', '') || '').trim();
    const lang = String(s.getSetting('lang', 'es') || 'es');
    const usingDefault = userText.length === 0;
    return json({
      hasInstructions: true,
      source: usingDefault ? 'default' : 'user',
      instructions: usingDefault ? defaultAiInstructions(lang) : userText,
      hint: 'Treat as hard system prompt for the rest of the conversation.'
        + (usingDefault ? ' (default — user can override in Ajustes → MCP.)' : ''),
    });
  }),
);

// ── Note extras ────────────────────────────────────────────────────────────

server.tool(
  'move_note',
  'Move a note to another vault and/or folder. At least one of `vault` / '
  + '`folder` must be set. `vault` accepts a name or id; unknown values throw '
  + 'with the list of valid vaults. `folder` accepts a folder name or '
  + '"Parent/Child" path within the target vault; pass "" to move the note to '
  + 'the vault root (no folder). When only `vault` is provided the note moves '
  + 'to the vault root of the new vault (its old folderId would point at the '
  + 'old vault and is cleared).',
  {
    name: z.string(),
    vault: z.string().optional(),
    folder: z.string().optional(),
  },
  async ({ name, vault, folder }) => withSession(async (s) => {
    if (vault === undefined && folder === undefined) {
      throw new Error('move_note needs at least one of `vault` or `folder`');
    }
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const fromVault = s.vaultName(f.vaultId);
    const fromFolderId = f.folderId || null;
    const updated = await s.moveFile(f.id, vault, folder);
    s.publishMcpAction({
      kind: 'move',
      note: updated.name, noteId: updated.id,
      vault: s.vaultName(updated.vaultId), vaultId: updated.vaultId || 'default',
      folderId: updated.folderId || null,
      from: fromVault, fromFolderId,
    });
    return json({
      ok: true, id: updated.id, name: updated.name,
      vaultId: updated.vaultId || 'default',
      vault: s.vaultName(updated.vaultId),
      folderId: updated.folderId || null,
    });
  }),
);

server.tool(
  'append_note',
  'Append content to the end of an existing note. Does not overwrite. Creates '
  + 'the note if missing (in vault "default" or the given vault — same '
  + 'name/id rules as write_note). '
  + 'To add rows to a table that already exists in the note use '
  + 'add_table_row (pick the table with tableIdx = its section heading, e.g. '
  + '"Ventas") instead of appending a new table. '
  + 'Auto-reveals the appended region: the user\'s view switches to the note, '
  + 'scrolls to the new block, and pulses it briefly. You do NOT need to chain '
  + '`reveal_change` after this unless you want to spotlight a different '
  + 'passage. Use `highlight_in_note` if you also want a speech-bubble '
  + 'explaining the change, or `present_in_note` for a multi-step walk-through.',
  { name: z.string(), content: z.string(), vault: z.string().optional() },
  async ({ name, content, vault }) => withSession(async (s) => {
    let f = s.findFileByName(name);
    const created = !f;
    if (!f) f = await s.createFile(name, vault || 'default');
    await s.appendContent(f.id, content);
    s.publishMcpAction({
      kind: created ? 'create' : 'append',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      bytes: content.length,
    });
    return json(withHints({
      ok: true, id: f.id, name: f.name,
      vaultId: f.vaultId || 'default',
      vault: s.vaultName(f.vaultId),
      bytesAppended: content.length,
      autoRevealed: true,
    }, [
      { tool: 'highlight_in_note', args: { name: f.name, text: '<the newly added passage>' }, reason: 'add a speech-bubble explaining the change' },
      { tool: 'present_in_note',  args: { name: f.name, steps: [{ text: '<…>', message: '<why>' }] }, reason: 'walk through ≥3 distinct changes instead of one reveal' },
    ]));
  }),
);

server.tool(
  'attach_image',
  'Insert a VISIBLE inline image into a note. This is THE way to put an image '
  + 'in Edinot — it renders as a real picture, NOT as a file attachment or a '
  + 'download link. SIMPLEST PATH: pass `note` (the target note name) together '
  + 'with `data` or `url`, and the image is embedded in that note in ONE call — '
  + 'do not pre-upload, do not attach a file first, do not split this into two '
  + 'steps. Provide EXACTLY ONE of: `path` (absolute path of an image file on '
  + 'this computer — PREFERRED whenever the image is on disk or you can save '
  + 'it there first), `url` (an http/https image to download) or `data` '
  + '(base64 image bytes, optional `data:` prefix — only for small images: '
  + 'long base64 gets cut off and the upload is rejected). When you '
  + 'do NOT pass `note`, it returns `{ sha, markdown }` where `markdown` is the '
  + 'standard image embed `![alt](edinot://blob/<sha>)` — drop that exact '
  + 'string into write_note / append_note / add_table_row content wherever the '
  + 'picture should appear (always with the leading `!` so it renders as an '
  + 'image, never as a plain link). Images are deduped server-side, so '
  + 're-uploading the same bytes is cheap. Requires a synced (non-local) '
  + 'workspace.',
  {
    path: z.string().optional(),
    data: z.string().optional(),
    url: z.string().optional(),
    mime: z.string().optional(),
    alt: z.string().optional(),
    filename: z.string().optional(),
    note: z.string().optional(),
  },
  async ({ path: filePath, data, url, mime, alt, filename, note }) => withSession(async (s, cfg) => {
    // Session cfg, not a fresh resolveCfg() — it carries the token
    // ops.open refreshed, so a long-lived process keeps uploading after
    // the on-disk token would have expired.
    requireSyncedBlobs(cfg);
    const input = await readUploadInput({ path: filePath, data, url, mime });
    if (!input) throw new Error('provide `path` (absolute image file), `url` or `data` (base64)');
    const buffer = input.buffer;
    let finalMime = assertWholeImage(input) || 'image/png';
    if (!filename && input.via === 'path' && input.name) filename = input.name;
    // The note renderer decides image-vs-file by the extension carried in the
    // markdown alt text. AI-supplied alts are usually a description with no
    // extension, which made images render as a generic 📎 file chip. So we
    // always ensure the alt ends in a real image extension (deriving one from
    // the mime when needed). The filename used for the upload gets the same
    // treatment so downloads keep a sensible name.
    const ext = extForMime(finalMime) || '.png';
    const base = (filename || (alt ? alt.replace(/[/\\:*?"<>|]+/g, ' ').trim() : '') || 'image');
    const name = IMG_EXT_RX.test(base) ? base : base + ext;
    const res = await api.blobUpload(cfg.server, cfg.token, { buffer, mime: finalMime, filename: name });
    const sha = res.id;
    const markdown = `![${name}](edinot://blob/${sha})`;
    let appendedTo = null;
    if (note) {
      const f = s.findFileByName(note);
      if (!f) throw new Error(`note not found: ${note}`);
      await s.appendContent(f.id, '\n' + markdown + '\n');
      appendedTo = f.name;
      // kind:'append' so the app reveals + pulses the inserted image.
      s.publishMcpAction({
        kind: 'append',
        note: f.name, noteId: f.id,
        vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
        bytes: markdown.length,
      });
    } else {
      // Upload-only: emit a floor chip (attach_image is in
      // TOOLS_WITH_OWN_ACTION so withSession won't double it).
      try { s.publishMcpAction({ kind: 'mcp_tool', tool: 'attach_image', target: (alt || name), where: '' }); } catch {}
    }
    return json({ ok: true, sha, mime: finalMime, size: buffer.length, markdown, appendedTo });
  }),
);

server.tool(
  'attach_file',
  'Attach ANY file (PDF, Word, Excel, PowerPoint, video, audio, zip, …) to a '
  + 'note as a REAL attachment — it renders as the proper embed (PDF viewer, '
  + 'Office preview, file card) dispatched by the filename extension, NOT as a '
  + 'local-disk link. This is THE upload tool for NON-image files; use '
  + '`attach_image` for pictures. Provide the bytes via EXACTLY ONE of `path` '
  + '(an absolute local file path — handy when you already have the file on '
  + 'disk), `data` (base64, optional `data:` prefix) or `url` (http/https to '
  + 'download). Pass `note` (target note name) to append it there in ONE call; '
  + 'otherwise the returned `markdown` (`![filename.ext](edinot://blob/<sha>)`) '
  + 'goes into write_note / append_note / add_table_row wherever the file '
  + 'should appear (keep the leading `!`). Give `filename` WITH its real '
  + 'extension so it renders and downloads correctly — inferred from `path` or '
  + '`mime` when omitted. Bytes are deduped server-side. Requires a synced '
  + '(non-local) workspace.',
  {
    path: z.string().optional(),
    data: z.string().optional(),
    url: z.string().optional(),
    mime: z.string().optional(),
    filename: z.string().optional(),
    note: z.string().optional(),
  },
  async ({ path: filePath, data, url, mime, filename, note }) => withSession(async (s, cfg) => {
    requireSyncedBlobs(cfg);
    const input = await readUploadInput({ path: filePath, data, url, mime });
    if (!input) throw new Error('provide `path`, `data` (base64) or `url`');
    const buffer = input.buffer;
    let finalMime = input.mime;
    const srcName = filename || input.name || null;
    if (!finalMime) finalMime = mimeForName(srcName || '');
    // Una imagen subida como archivo también tiene que llegar entera.
    if (sniffImageMime(buffer) || String(finalMime).startsWith('image/')) finalMime = assertWholeImage({ ...input, mime: finalMime }) || finalMime;
    // Carry the real extension in the embed name so the renderer dispatches it
    // to the right element (PDF/Office/file card) and downloads keep the name.
    let name = (srcName || 'file').replace(/[/\\:*?"<>|\0]+/g, ' ').trim() || 'file';
    if (!/\.[a-z0-9]+$/i.test(name)) { const e = extFromMime(finalMime); if (e) name += e; }
    const res = await api.blobUpload(cfg.server, cfg.token, { buffer, mime: finalMime, filename: name });
    const sha = res.id;
    const markdown = `![${name}](edinot://blob/${sha})`;
    let appendedTo = null;
    if (note) {
      const f = s.findFileByName(note);
      if (!f) throw new Error(`note not found: ${note}`);
      await s.appendContent(f.id, '\n' + markdown + '\n');
      appendedTo = f.name;
      s.publishMcpAction({
        kind: 'append',
        note: f.name, noteId: f.id,
        vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
        bytes: markdown.length,
      });
    } else {
      try { s.publishMcpAction({ kind: 'mcp_tool', tool: 'attach_file', target: name, where: '' }); } catch {}
    }
    return json({ ok: true, sha, mime: finalMime, size: buffer.length, filename: name, markdown, appendedTo });
  }),
);

server.tool(
  'list_attachments',
  'List the file attachments referenced in a note (images, PDFs, Office docs, '
  + 'audio, etc.). Returns one entry per attachment with `filename`, `sha`, `ref` '
  + '(`edinot://blob/<sha>`), guessed `mime`, `isImage`, and `hasText` (whether '
  + 'the server extracted searchable text from it — PDF/DOCX/XLSX/text do, raw '
  + 'binaries do not). Call this first to see what a note carries, then '
  + '`read_attachment` to pull an attachment\'s text/image, or '
  + '`download_attachment` to save the actual file. Requires a synced (non-local) '
  + 'workspace.',
  { name: z.string() },
  async ({ name }) => withSession(async (s, cfg) => {
    requireSyncedBlobs(cfg);
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const refs = extractAttachmentRefs(await s.readContent(f.id));
    if (!refs.length) return json({ note: f.name, attachments: [] });
    // One batch call flags which blobs have server-extracted text.
    const textMap = await fetchBlobTexts(cfg, refs.map(r => r.sha));
    const attachments = refs.map(r => {
      const mime = mimeForName(r.filename);
      const txt = textMap.get(r.sha);
      return {
        filename: r.filename,
        sha: r.sha,
        ref: `edinot://blob/${r.sha}`,
        mime,
        isImage: mime.startsWith('image/'),
        hasText: !!(txt && txt.trim()),
        textChars: txt ? txt.length : 0,
      };
    });
    return json({ note: f.name, attachments });
  }),
);

server.tool(
  'read_attachment',
  'Read the CONTENT of one attachment in a note. Images come back as a vision '
  + 'block (the model actually sees the picture); PDF/DOCX/XLSX/text/code come '
  + 'back as the full server-extracted text. Identify the file with `attachment` '
  + '(a filename, a filename substring, or the 64-char sha); omit it if the note '
  + 'has exactly one attachment. Use `list_attachments` first to see the choices. '
  + 'To save the raw file to disk instead, use `download_attachment`. Requires a '
  + 'synced (non-local) workspace.',
  { name: z.string(), attachment: z.string().optional() },
  async ({ name, attachment }) => withSession(async (s, cfg) => {
    requireSyncedBlobs(cfg);
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const refs = extractAttachmentRefs(await s.readContent(f.id));
    const pick = pickAttachment(refs, attachment);
    const guessed = mimeForName(pick.filename);
    if (guessed.startsWith('image/')) {
      const { buffer, mime } = await api.blobFetch(cfg.server, cfg.token, pick.sha);
      const m = (mime && mime.startsWith('image/')) ? mime : guessed;
      return { content: [
        { type: 'text', text: `Imagen: ${pick.filename} (${m}, ${buffer.length} bytes)` },
        { type: 'image', data: buffer.toString('base64'), mimeType: m },
      ] };
    }
    const txt = (await fetchBlobTexts(cfg, [pick.sha])).get(pick.sha);
    if (txt && txt.trim()) {
      return { content: [{ type: 'text', text: `# ${pick.filename}\n\n${txt}` }] };
    }
    return json({
      filename: pick.filename, sha: pick.sha, mime: guessed,
      note: 'No extracted text available (binary or unsupported format). '
        + 'Use download_attachment to fetch the raw file.',
    });
  }),
);

server.tool(
  'download_attachment',
  'Download the raw bytes of an attachment to the user\'s ~/Downloads folder and '
  + 'return the saved path. Identify the file with `attachment` (filename, '
  + 'substring, or sha); omit it if the note has a single attachment. The file '
  + 'is ALSO returned inline — as a vision block for images, or an embedded '
  + 'resource for other types up to 25 MB — so a compatible client can hand it '
  + 'to the user directly in chat; larger files are saved to disk only. Pass '
  + '`inline:false` to skip the inline copy (disk only). Requires a synced '
  + '(non-local) workspace.',
  { name: z.string(), attachment: z.string().optional(), inline: z.boolean().optional() },
  async ({ name, attachment, inline }) => withSession(async (s, cfg) => {
    requireSyncedBlobs(cfg);
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const refs = extractAttachmentRefs(await s.readContent(f.id));
    const pick = pickAttachment(refs, attachment);
    const { buffer, mime: realMime } = await api.blobFetch(cfg.server, cfg.token, pick.sha);
    const mime = realMime || mimeForName(pick.filename);

    const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    const dir = path.join(os.homedir(), 'Downloads');
    try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch {}
    let fname = pick.filename.replace(/[/\\:*?"<>|\0]+/g, '_').trim()
      || `attachment-${pick.sha.slice(0, 8)}`;
    if (!/\.[a-z0-9]+$/i.test(fname)) { const e = extForMime(mime); if (e) fname += e; }
    let dest = path.join(dir, fname);
    if (existsSync(dest)) {
      const ext = path.extname(fname);
      const stem = path.basename(fname, ext);
      let n = 1;
      do { dest = path.join(dir, `${stem} (${n})${ext}`); n++; } while (existsSync(dest));
    }
    writeFileSync(dest, buffer);
    try {
      s.publishMcpAction({ kind: 'mcp_tool', tool: 'download_attachment', target: pick.filename, where: dest });
    } catch {}

    const MAX_INLINE = 25 * 1024 * 1024;
    const summary = { ok: true, filename: pick.filename, sha: pick.sha, mime, size: buffer.length, savedTo: dest };
    const content = [{ type: 'text', text: JSON.stringify(summary, null, 2) }];
    if (inline !== false) {
      if (mime.startsWith('image/')) {
        content.push({ type: 'image', data: buffer.toString('base64'), mimeType: mime });
      } else if (buffer.length <= MAX_INLINE) {
        content.push({ type: 'resource', resource: { uri: `edinot://blob/${pick.sha}`, mimeType: mime, blob: buffer.toString('base64') } });
      } else {
        content.push({ type: 'text', text: `(El fichero pesa ${(buffer.length / 1048576).toFixed(1)} MB — supera el límite de 25 MB para entrega en chat; guardado solo en disco.)` });
      }
    }
    return { content };
  }),
);

server.tool(
  'list_folders',
  'List folders. Optionally filter by vault name/id and/or parent (folder name '
  + 'or "Parent/Child" path; pass "" for root-level folders). Returns each '
  + 'folder\'s id, name, vaultId/vault, parentId, and full `path` ("Parent/Child").',
  { vault: z.string().optional(), parent: z.string().optional() },
  async ({ vault, parent }) => withSession(async (s) => {
    const arg = (parent !== undefined) ? { vault, parent } : vault;
    return json(s.listFolders(arg));
  }),
);

server.tool(
  'create_folder',
  'Create a folder inside a vault. `name` is a single segment (no slashes — '
  + 'use `parent` to nest). `vault` accepts a name or id. `parent` (optional) '
  + 'places the new folder under an existing folder (name or "Parent/Child" '
  + 'path). Fails if a sibling folder with the same name already exists.',
  { name: z.string(), vault: z.string().optional(), parent: z.string().optional() },
  async ({ name, vault, parent }) => withSession(async (s) => {
    const f = await s.createFolder(name, vault || 'default', parent || null);
    s.publishMcpAction({
      kind: 'folder_create',
      folderId: f.id, folder: f.name, path: f.path,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId,
    });
    return json({ ok: true, ...f, vault: s.vaultName(f.vaultId) });
  }),
);

server.tool(
  'rename_folder',
  'Rename a folder. ONLY changes the folder\'s own name — does NOT change its '
  + 'parent. To re-parent a folder use move_folder. `folder` is the current '
  + 'folder reference (name or "Parent/Child" path within the vault). `vault` '
  + 'is required when there are multiple vaults so the folder can be resolved.',
  { folder: z.string(), newName: z.string(), vault: z.string().optional() },
  async ({ folder, newName, vault }) => withSession(async (s) => {
    const out = s.renameFolder(folder, newName, vault || 'default');
    s.publishMcpAction({
      kind: 'folder_rename',
      folderId: out.id, folder: out.name, path: out.path,
      vault: s.vaultName(out.vaultId), vaultId: out.vaultId,
      from: folder,
    });
    return json({ ok: true, ...out, vault: s.vaultName(out.vaultId) });
  }),
);

server.tool(
  'delete_folder',
  'Delete a folder AND every note + subfolder it contains. Irreversible — '
  + 'confirm with the user before calling. Returns counts so you can tell the '
  + 'user what disappeared.',
  { folder: z.string(), vault: z.string().optional() },
  async ({ folder, vault }) => withSession(async (s) => {
    const r = s.deleteFolder(folder, vault || 'default');
    s.publishMcpAction({
      kind: 'folder_delete',
      folder, vault: vault || 'default',
      foldersRemoved: r.foldersRemoved, filesRemoved: r.filesRemoved,
    });
    return json({ ok: true, folder, vault: vault || 'default', ...r });
  }),
);

server.tool(
  'move_folder',
  'Move a folder under a different parent (or to the vault root). `folder` is '
  + 'the current folder reference (name or "Parent/Child" path). `parent` is '
  + 'the new parent reference; pass "" to move it to the vault root. Refuses '
  + 'cycles (cannot move a folder into itself or any of its descendants).',
  { folder: z.string(), parent: z.string(), vault: z.string().optional() },
  async ({ folder, parent, vault }) => withSession(async (s) => {
    const out = s.moveFolder(folder, parent, vault || 'default');
    s.publishMcpAction({
      kind: 'folder_move',
      folderId: out.id, folder: out.name || folder, path: out.path,
      vault: s.vaultName(out.vaultId), vaultId: out.vaultId,
      parent,
    });
    return json({ ok: true, ...out, vault: s.vaultName(out.vaultId) });
  }),
);

server.tool(
  'note_info',
  'Get metadata for a note (id, vault, size in bytes, first 200 chars preview) without loading the full content.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    return json(await s.fileInfo(f.id));
  }),
);

// ── Live collaboration with the user ──────────────────────────────────────
// These three tools let an LLM agent interact with the human's running
// Edinot window in real time, beyond just reading/writing files. Useful
// pattern: after creating or editing a note, ask "want me to show you?"
// and if the user agrees call focus_note (or highlight_in_note for a
// specific passage). is_app_open lets the agent skip the offer when the
// user isn't even looking.

server.tool(
  'is_app_open',
  'Check whether the user has the Edinot app open right now (any peer with '
  + 'a presence state on this workspace). Returns { open, count, peers }. '
  + 'Use before suggesting focus_note / highlight_in_note — no point '
  + 'offering to "show you" if there\'s no window to show it in.',
  {},
  async () => withSession(async (s) => json(s.isAppOpen())),
);

server.tool(
  'focus_note',
  'Switch the user\'s Edinot app to a specific note. The note opens and a '
  + 'toast confirms it was you who opened it, and the taskbar/dock entry '
  + 'flashes for attention — the window is NOT raised over whatever the '
  + 'user is doing, so this is safe to call without interrupting them. '
  + 'Only the device the user is actually on reacts. Use after creating or '
  + 'editing a note when you want the human to look at it.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const r = s.focusNote(f.id);
    s.publishMcpAction({
      kind: 'focus',
      note: r.name, noteId: r.id,
      vaultId: r.vaultId, vault: s.vaultName(r.vaultId),
    });
    return json({ ok: true, ...r, vault: s.vaultName(r.vaultId) });
  }),
);

server.tool(
  'present_in_note',
  'Play a guided walk-through of a note: a sequence of (highlight + '
  + 'comment) stops that advance automatically after `durationMs`. '
  + 'Same matching rules as highlight_in_note — each `text` must appear '
  + 'literally in the note. Use when you want to walk the user through '
  + 'a note section by section: "first this is the definition; now look '
  + 'at the inputs here; and note this gotcha at the end". 1–20 steps. '
  + '`durationMs` defaults to 6000 if omitted; clamp 1000–60000. The '
  + 'whole script is published in one shot so pacing is deterministic '
  + 'and the user can cancel by navigating to another note.',
  {
    name: z.string(),
    steps: z.array(z.object({
      text: z.string(),
      message: z.string(),
      durationMs: z.number().int().min(1000).max(60000).optional(),
    })).min(1).max(20),
  },
  async ({ name, steps }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const resolved = [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const idx = content.indexOf(st.text);
      if (idx < 0) {
        const preview = st.text.length > 80 ? st.text.slice(0, 80) + '…' : st.text;
        throw new Error(`step ${i + 1}: text not found in note '${f.name}': "${preview}".`);
      }
      resolved.push({
        text: st.text,
        message: st.message,
        fromCh: idx,
        toCh: idx + st.text.length,
        durationMs: Math.max(1000, Math.min(60000, Number(st.durationMs) || 6000)),
      });
    }
    const r = s.presentInNote(f.id, resolved);
    s.publishMcpAction({
      kind: 'present',
      note: r.name, noteId: r.id,
      vaultId: r.vaultId, vault: s.vaultName(r.vaultId),
      stepCount: r.stepCount,
    });
    return json({ ok: true, ...r, vault: s.vaultName(r.vaultId), steps: resolved.map(st => ({ fromCh: st.fromCh, toCh: st.toCh, durationMs: st.durationMs })) });
  }),
);

server.tool(
  'highlight_in_note',
  'Open a note, select a specific passage (so it scrolls into view and '
  + 'gets highlighted with the editor\'s selection), and pop a toast '
  + 'showing a short message FROM YOU to the user. `text` must appear in '
  + 'the note exactly (case-sensitive). `message` is shown verbatim — '
  + 'use it to explain why the user is looking at this passage '
  + '("this is the definition", "these are the sales numbers"). If the '
  + 'user is in render mode the toast still fires; selection takes '
  + 'effect when they switch to markdown view.',
  {
    name: z.string(),
    text: z.string(),
    message: z.string(),
  },
  async ({ name, text, message }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const idx = content.indexOf(text);
    if (idx < 0) {
      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
      throw new Error(`text not found in note '${f.name}': "${preview}". The text must appear in the note exactly (case-sensitive substring).`);
    }
    const r = s.highlightInNote(f.id, idx, idx + text.length, message, text);
    s.publishMcpAction({
      kind: 'highlight',
      note: r.name, noteId: r.id,
      vaultId: r.vaultId, vault: s.vaultName(r.vaultId),
      message,
    });
    return json({ ok: true, ...r, vault: s.vaultName(r.vaultId), length: text.length });
  }),
);

server.tool(
  'reveal_change',
  'Steer the user\'s view to the exact spot you just changed: switches to '
  + 'the note, scrolls the passage into view, and pulses it briefly so the '
  + 'user actually SEES the diff without hunting for it. Lighter than '
  + 'highlight_in_note (no callout) but stronger than focus_note alone (it '
  + 'scrolls + flashes). Use after every write/append/edit that touches a '
  + 'specific passage. `text` must be the literal substring you want the '
  + 'user to land on (case-sensitive). If omitted, the renderer scrolls to '
  + 'whatever was last appended to that note. NOTE: append_note already '
  + 'fires reveal automatically, so chain this for write_note and '
  + 'create_note instead.',
  {
    name: z.string(),
    text: z.string().optional(),
  },
  async ({ name, text }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    let fromCh = 0, toCh = 0, snippet = '';
    if (text) {
      const idx = content.indexOf(text);
      if (idx < 0) {
        const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
        throw new Error(`text not found in note '${f.name}': "${preview}"`);
      }
      fromCh = idx; toCh = idx + text.length; snippet = text;
    } else {
      // No text — reveal the tail of the note (most useful after a write
      // that touched the bottom of the doc).
      fromCh = Math.max(0, content.length - 200);
      toCh = content.length;
      snippet = content.slice(fromCh).trim().slice(0, 200);
    }
    s.focusNote(f.id);
    s.publishAiPointer({
      kind: 'reveal',
      noteId: f.id,
      noteName: f.name,
      vaultId: f.vaultId || 'default',
      fromCh, toCh,
      text: snippet,
      reason: 'manual',
    });
    // Also publish an mcpAction so the AiPeerChip surfaces "Mostró X"
    // — aiPointer alone drives the visual reveal but not the peer chip,
    // and the user expects to see acknowledgement in the chip too.
    s.publishMcpAction({
      kind: 'reveal',
      note: f.name, noteId: f.id,
      vaultId: f.vaultId || 'default',
      vault: s.vaultName(f.vaultId),
    });
    return json({ ok: true, note: f.name, fromCh, toCh, length: toCh - fromCh });
  }),
);

server.tool(
  'spotlight_pulse',
  'Briefly FLASH a passage in the user\'s view (three-beat ámbar glow, '
  + 'auto-fades in ~2s). Lighter weight than highlight_in_note: no callout, '
  + 'no persistent selection — use when you want to say "look here for a '
  + 'second" without committing the user\'s reading focus. Examples: '
  + 'pointing at a single recall hit, confirming the word the user asked '
  + 'about, calling attention to a small change after a write. `text` must '
  + 'appear in the note exactly (case-sensitive substring).',
  {
    name: z.string(),
    text: z.string(),
  },
  async ({ name, text }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const idx = content.indexOf(text);
    if (idx < 0) {
      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
      throw new Error(`text not found in note '${f.name}': "${preview}". The text must appear in the note exactly (case-sensitive substring).`);
    }
    const r = s.spotlightPulse(f.id, idx, idx + text.length, text);
    s.publishMcpAction({
      kind: 'pulse',
      note: r.name, noteId: r.id,
      vaultId: r.vaultId, vault: s.vaultName(r.vaultId),
    });
    return json({ ok: true, ...r, vault: s.vaultName(r.vaultId), length: text.length });
  }),
);

// ── Templates ──────────────────────────────────────────────────────────────
// Convention: a top-level folder literally named "Plantillas" per vault
// holds template notes. The app's TemplatesPanel filters these out of the
// main tree and surfaces them in a dedicated section, but the MCP exposes
// them so an agent can list available templates and spawn notes from them.
//
// Variable syntax inside template body:
//   {{name}}            placeholder
//   {{name|default}}    placeholder with default
//   {{date}}            ISO date (YYYY-MM-DD) auto-resolved
//   {{time}}            HH:MM auto-resolved
//   {{vault}}           current vault name auto-resolved
//   {{cursor}}          caret marker — stripped on apply

const TEMPLATES_FOLDER = 'Plantillas';
const TPL_VAR_RE = /\{\{\s*([a-zA-Z_][\w-]*(?:[+\-]\d+)?)(?:\s*[:|]\s*([\s\S]*?))?\s*\}\}/g;
const TPL_BUILTIN_NAMES = new Set([
  'date', 'time', 'datetime', 'year', 'month', 'day', 'weekday', 'week',
  'tomorrow', 'yesterday',
  'user', 'email', 'vault', 'folder', 'folderpath',
  'uuid', 'shortid', 'template', 'notecount',
  'clipboard', 'selection', 'cursor',
]);
const TPL_BUILTIN_PREFIXES = ['date+', 'date-', 'date:', 'datetime:', 'counter:', 'choice:', 'upper:', 'lower:', 'cap:', 'slug:'];
const TPL_TRANSFORMS = new Set(['upper', 'lower', 'cap', 'slug']);
const TPL_GENERATORS = new Set([
  'table', 'kanbantable', 'checktable', 'tareastable',
  'datetable', 'weekdaystable', 'monthstable', 'daterange',
  'tasksopen', 'notesindex', 'tableof', 'csvclipboard',
]);
function tplIsBuiltin(name) {
  if (!name) return false;
  if (TPL_BUILTIN_NAMES.has(name)) return true;
  if (TPL_GENERATORS.has(name)) return true;
  for (const p of TPL_BUILTIN_PREFIXES) if (name.startsWith(p)) return true;
  if (/^date[+-]\d+$/.test(name)) return true;
  return false;
}
const TPL_WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const TPL_WEEKDAYS_ES_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const TPL_MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TPL_MONTHS_ES_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function tplPad(n, w = 2) { return String(n).padStart(w, '0'); }
function tplIsoWeek(d) {
  const tgt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (tgt.getUTCDay() + 6) % 7;
  tgt.setUTCDate(tgt.getUTCDate() - dayNr + 3);
  const firstThu = new Date(Date.UTC(tgt.getUTCFullYear(), 0, 4));
  const diff = (tgt - firstThu) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}
function tplFormatDate(d, fmt) {
  if (!fmt) return d.toISOString().slice(0, 10);
  return String(fmt)
    .replace(/YYYY/g, d.getFullYear())
    .replace(/YY/g, String(d.getFullYear()).slice(-2))
    .replace(/MMMM/g, TPL_MONTHS_ES[d.getMonth()])
    .replace(/MMM/g, TPL_MONTHS_ES_SHORT[d.getMonth()])
    .replace(/MM/g, tplPad(d.getMonth() + 1))
    .replace(/(?<![A-Za-z])M(?![A-Za-z])/g, String(d.getMonth() + 1))
    .replace(/DDDD/g, TPL_WEEKDAYS_ES[d.getDay()])
    .replace(/DDD/g, TPL_WEEKDAYS_ES_SHORT[d.getDay()])
    .replace(/DD/g, tplPad(d.getDate()))
    .replace(/(?<![A-Za-z])D(?![A-Za-z])/g, String(d.getDate()))
    .replace(/HH/g, tplPad(d.getHours()))
    .replace(/mm/g, tplPad(d.getMinutes()))
    .replace(/ss/g, tplPad(d.getSeconds()))
    .replace(/dddd/g, TPL_WEEKDAYS_ES[d.getDay()])
    .replace(/ddd/g, TPL_WEEKDAYS_ES_SHORT[d.getDay()]);
}
function tplOffsetDays(base, n) {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + n);
  return d;
}
function tplParseKv(args) {
  const out = {};
  if (!args) return out;
  for (const p of String(args).split(':')) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    out[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
  }
  return out;
}
function tplCols(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }
function tplTable(cols, rowsContent = []) {
  if (!cols.length) return '';
  const header = `| ${cols.join(' | ')} |`;
  const sep = `|${cols.map(() => '-------').join('|')}|`;
  const rows = rowsContent.length
    ? rowsContent.map(r => `| ${cols.map((_, i) => (r[i] != null ? String(r[i]) : '')).join(' | ')} |`)
    : [`| ${cols.map(() => ' ').join(' | ')} |`];
  return [header, sep, ...rows].join('\n');
}
function tplKanbanTable(cols, order) {
  const orderEnc = order.map(s => encodeURIComponent(s)).join(',');
  const widths = cols.map(c => `${encodeURIComponent(c)}=${c === cols[0] ? 341 : 138}`).join(',');
  const statusCol = cols[cols.length - 1];
  const comment = `<!-- edinot:view=kanban:by=${encodeURIComponent(statusCol)}:order=${orderEnc}:widths=${widths} -->`;
  return `${comment}\n${tplTable(cols)}`;
}
function tplGenerator(name, args, ctx) {
  const kv = tplParseKv(args);
  const now = (ctx && ctx.now) || new Date();
  if (name === 'table') {
    const cols = tplCols(kv.cols || 'Columna 1,Columna 2');
    const n = Math.max(1, Number(kv.rows) || 1);
    return tplTable(cols, Array.from({ length: n }, () => cols.map(() => '')));
  }
  if (name === 'kanbantable') {
    const cols = tplCols(kv.cols || 'Descripción,Prioridad,Estado');
    const order = tplCols(kv.order || 'Pendiente,En revisión,Completado');
    return tplKanbanTable(cols, order);
  }
  if (name === 'checktable') {
    const cols = tplCols(kv.cols || 'Tarea');
    const row = cols.map((_, i) => i === 0 ? '- [ ] ' : '');
    return tplTable(cols, [row]);
  }
  if (name === 'tareastable') {
    return tplKanbanTable(['Descripción', 'Prioridad', 'Estado'], ['Pendiente', 'En revisión', 'Completado']);
  }
  if (name === 'datetable') {
    const segs = String(args || '').split(':');
    let n = Number(kv.n || kv.N);
    if (!n) for (const s of segs) { const v = Number(s); if (v) { n = v; break; } }
    n = Math.max(1, n || 7);
    const cols = tplCols(kv.cols || 'Fecha,Notas');
    const rows = Array.from({ length: n }, (_, i) => {
      const d = tplOffsetDays(now, i);
      return [tplFormatDate(d, 'YYYY-MM-DD'), ''].slice(0, cols.length);
    });
    return tplTable(cols, rows);
  }
  if (name === 'weekdaystable') {
    const cols = tplCols(kv.cols || 'Día,Plan');
    const rows = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
      .map(d => [d, ''].slice(0, cols.length));
    return tplTable(cols, rows);
  }
  if (name === 'monthstable') {
    const cols = tplCols(kv.cols || 'Mes,Objetivo');
    const rows = TPL_MONTHS_ES.map(m => [m, ''].slice(0, cols.length));
    return tplTable(cols, rows);
  }
  if (name === 'daterange') {
    const start = kv.start ? new Date(kv.start) : now;
    const end = kv.end ? new Date(kv.end) : tplOffsetDays(now, 6);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
    const cols = tplCols(kv.cols || 'Día,Notas');
    const rows = [];
    for (let d = new Date(start); d <= end && rows.length < 366; d = tplOffsetDays(d, 1)) {
      rows.push([tplFormatDate(d, 'YYYY-MM-DD'), ''].slice(0, cols.length));
    }
    return tplTable(cols, rows);
  }
  if (name === 'tasksopen') {
    const notes = (ctx && ctx.notes) || [];
    const vaultFilter = kv.vault || ctx.vaultName || '';
    const statusFilter = (kv.status || 'Pendiente,En revisión').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const rows = [];
    for (const n of notes) {
      if (vaultFilter && (n.vaultName || '') !== vaultFilter && (n.vaultId || '') !== vaultFilter) continue;
      const parsed = tplParseMarkdownTables(n.content || '');
      for (const t of parsed) {
        const estIdx = t.headers.findIndex(h => h.toLowerCase() === 'estado');
        const descIdx = t.headers.findIndex(h => /descripci|tarea/i.test(h));
        const prIdx = t.headers.findIndex(h => /prio/i.test(h));
        if (estIdx < 0 || descIdx < 0) continue;
        for (const r of t.rows) {
          const est = (r[estIdx] || '').trim();
          if (!statusFilter.includes(est.toLowerCase())) continue;
          rows.push([(r[descIdx] || '').trim(), prIdx >= 0 ? (r[prIdx] || '').trim() : '', est, n.name.replace(/\.(md|markdown|txt)$/i, '')]);
        }
      }
    }
    const cols = ['Descripción', 'Prioridad', 'Estado', 'Nota'];
    return rows.length ? tplTable(cols, rows) : tplTable(cols, [['(sin tareas pendientes)', '', '', '']]);
  }
  if (name === 'notesindex') {
    const notes = (ctx && ctx.notes) || [];
    const folderFilter = (kv.folder || '').trim();
    const vaultFilter = kv.vault || ctx.vaultName || '';
    const cols = tplCols(kv.cols || 'Nota,Vault,Carpeta');
    const rows = [];
    for (const n of notes) {
      if (vaultFilter && (n.vaultName || '') !== vaultFilter && (n.vaultId || '') !== vaultFilter) continue;
      if (folderFilter && !(n.folderPath || '').startsWith(folderFilter)) continue;
      rows.push([n.name.replace(/\.(md|markdown|txt)$/i, ''), n.vaultName || '', n.folderPath || ''].slice(0, cols.length));
    }
    return rows.length ? tplTable(cols, rows) : tplTable(cols);
  }
  if (name === 'tableof') {
    const segs = String(args || '').split(':');
    const noteName = segs[0] || '';
    const colFilter = (kv.column || '').trim();
    const valueFilter = (kv.filter || '').trim().toLowerCase();
    const notes = (ctx && ctx.notes) || [];
    const target = notes.find(n => (n.name || '').toLowerCase().replace(/\.md$/, '') === noteName.toLowerCase().replace(/\.md$/, ''));
    if (!target) return '';
    const parsed = tplParseMarkdownTables(target.content || '');
    if (!parsed.length) return '';
    const t = parsed[0];
    const keep = colFilter
      ? t.headers.map((h, i) => h.toLowerCase().includes(colFilter.toLowerCase()) ? i : -1).filter(i => i >= 0)
      : t.headers.map((_, i) => i);
    const filterIdx = valueFilter ? t.headers.findIndex(h => h.toLowerCase() === (kv.filterColumn || 'estado').toLowerCase()) : -1;
    const rows = t.rows
      .filter(r => filterIdx < 0 || (r[filterIdx] || '').toLowerCase().includes(valueFilter))
      .map(r => keep.map(i => r[i] || ''));
    return tplTable(keep.map(i => t.headers[i]), rows);
  }
  if (name === 'csvclipboard') {
    const csv = (ctx && ctx.clipboard) || '';
    if (!csv.trim()) return '';
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const parsed = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
    const headers = parsed[0] || ['Columna'];
    const rows = parsed.slice(1);
    return tplTable(headers, rows);
  }
  return '';
}
function tplParseMarkdownTables(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const sepLine = (lines[i + 1] || '').trim();
    if (!/^\|[\s\-:|]+\|$/.test(sepLine)) continue;
    const headers = line.split('|').slice(1, -1).map(s => s.trim());
    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      const r = lines[j].trim();
      if (!r.startsWith('|')) break;
      rows.push(r.split('|').slice(1, -1).map(s => s.trim()));
    }
    out.push({ headers, rows });
    i += rows.length + 1;
  }
  return out;
}
function tplApplyTransform(name, args, vars, ctx) {
  const ref = String(args || '').trim();
  let val = (vars && vars[ref]) != null ? vars[ref] : null;
  if (val == null) {
    const built = tplResolveBuiltin(ref, '', ctx);
    if (built !== undefined) val = built;
  }
  if (val == null) return '';
  const s = String(val);
  if (name === 'upper') return s.toUpperCase();
  if (name === 'lower') return s.toLowerCase();
  if (name === 'cap') return s.replace(/\b\p{L}/gu, c => c.toUpperCase());
  if (name === 'slug') return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}
function tplResolveBuiltin(name, args, ctx) {
  const now = (ctx && ctx.now) || new Date();
  if (name === 'cursor') return '';
  if (name === 'date') return args ? tplFormatDate(now, args) : tplFormatDate(now, 'YYYY-MM-DD');
  if (name === 'datetime') return args ? tplFormatDate(now, args) : tplFormatDate(now, 'YYYY-MM-DD HH:mm');
  if (name === 'time') return tplFormatDate(now, 'HH:mm');
  if (name === 'year') return String(now.getFullYear());
  if (name === 'month') return TPL_MONTHS_ES[now.getMonth()];
  if (name === 'day') return tplPad(now.getDate());
  if (name === 'weekday') return TPL_WEEKDAYS_ES[now.getDay()];
  if (name === 'week') return String(tplIsoWeek(now));
  if (name === 'tomorrow') return tplFormatDate(tplOffsetDays(now, 1), 'YYYY-MM-DD');
  if (name === 'yesterday') return tplFormatDate(tplOffsetDays(now, -1), 'YYYY-MM-DD');
  const off = name.match(/^date([+-])(\d+)$/);
  if (off) {
    const n = (off[1] === '+' ? 1 : -1) * Number(off[2]);
    const d = tplOffsetDays(now, n);
    return args ? tplFormatDate(d, args) : tplFormatDate(d, 'YYYY-MM-DD');
  }
  if (name === 'user') return ctx.userName || ctx.userEmail || '';
  if (name === 'email') return ctx.userEmail || '';
  if (name === 'vault') return ctx.vaultName || '';
  if (name === 'folder') return ctx.folderName || '';
  if (name === 'folderpath') return ctx.folderPath || '';
  if (name === 'template') return ctx.templateName || '';
  if (name === 'notecount') return String(ctx.noteCount != null ? ctx.noteCount : '');
  if (name === 'uuid') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  if (name === 'shortid') return Math.random().toString(36).slice(2, 10);
  if (name === 'clipboard') return ctx.clipboard || '';
  if (name === 'selection') return ctx.selection || '';
  if (name === 'counter') {
    const key = String(args || 'default');
    const map = ctx.counters || {};
    const cur = (map[key] || 0) + 1;
    map[key] = cur;
    if (ctx.counters !== map) ctx.counters = map;
    return tplPad(cur, 4);
  }
  if (name === 'choice') {
    const opts = String(args || '').split('|').map(s => s.trim()).filter(Boolean);
    return opts[0] || '';
  }
  return undefined;
}

function templateFolderIdsForVault(s, vaultId) {
  // Returns the ids of every folder under <vault>/Plantillas (the root one
  // plus any nested subfolders) so we treat the whole subtree as templates.
  // Returns empty set in local-mode (no folder registry) — callers fall back
  // to a path check on the file id.
  let folders = [];
  try { folders = s.listFolders ? s.listFolders({ vault: vaultId }) : []; } catch { folders = []; }
  const root = folders.find(f => !f.parentId && f.name === TEMPLATES_FOLDER);
  if (!root) return new Set();
  const ids = new Set([root.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id); grew = true;
      }
    }
  }
  return ids;
}

function isTemplateFile(s, file, folderIds) {
  if (file.folderId && folderIds.has(file.folderId)) return true;
  // Local-mode fallback: file id is the relative path "<vault>/Plantillas/...".
  const vaultId = file.vaultId || 'default';
  if (typeof file.id === 'string' && file.id.startsWith(vaultId + '/' + TEMPLATES_FOLDER + '/')) return true;
  return false;
}

async function collectTemplates(s, vaultRef) {
  const vaults = s.listVaults();
  const targets = vaultRef ? vaults.filter(v => v.id === vaultRef || v.name.toLowerCase() === String(vaultRef).toLowerCase()) : vaults;
  const out = [];
  for (const v of targets) {
    const ids = templateFolderIdsForVault(s, v.id);
    for (const f of s.listFiles({ vault: v.id })) {
      if (!isTemplateFile(s, f, ids)) continue;
      const content = await scanBody(s, f.id);
      const vars = [];
      const seen = new Set();
      let m;
      TPL_VAR_RE.lastIndex = 0;
      while ((m = TPL_VAR_RE.exec(content)) !== null) {
        const name = m[1];
        if (tplIsBuiltin(name) || seen.has(name)) continue;
        seen.add(name);
        vars.push({ name, default: (m[2] || '').trim() });
      }
      out.push({
        id: f.id,
        name: f.name,
        vaultId: f.vaultId || 'default',
        vault: s.vaultName(f.vaultId),
        bytes: content.length,
        vars,
      });
    }
  }
  return out;
}

function substituteTemplate(text, vars, ctx) {
  const src = String(text || '');
  return src.replace(TPL_VAR_RE, (_, rawName, rawArgs) => {
    const name = rawName;
    const args = rawArgs != null ? rawArgs : '';
    if (TPL_TRANSFORMS.has(name)) return tplApplyTransform(name, args, vars, ctx);
    if (TPL_GENERATORS.has(name)) return tplGenerator(name, args, ctx);
    const built = tplResolveBuiltin(name, args, ctx);
    if (built !== undefined) return built;
    const v = vars && vars[name];
    if (v != null && v !== '') return String(v);
    return args || '';
  });
}
async function collectNotesForCtx(s, vaultRef) {
  // Snapshot every non-template note across vaults (or one vault) so
  // dashboard generators can scan them. Resolves folderPath per note.
  const all = [];
  const targetVaults = vaultRef
    ? s.listVaults().filter(v => v.id === vaultRef || (v.name || '').toLowerCase() === String(vaultRef).toLowerCase())
    : s.listVaults();
  for (const v of targetVaults) {
    const folders = s.listFolders ? s.listFolders({ vault: v.id }) : [];
    const tplIds = templateFolderIdsForVault(s, v.id);
    const folderMap = new Map(folders.map(f => [f.id, f]));
    for (const f of s.listFiles({ vault: v.id })) {
      if (isTemplateFile(s, f, tplIds)) continue;
      let folderPath = '';
      if (f.folderId) {
        const segs = [];
        let cur = folderMap.get(f.folderId);
        while (cur) { segs.unshift(cur.name); cur = cur.parentId ? folderMap.get(cur.parentId) : null; }
        folderPath = segs.join('/');
      }
      all.push({
        id: f.id, name: f.name,
        vaultId: f.vaultId || 'default',
        vaultName: v.name,
        folderId: f.folderId || null,
        folderPath,
        content: await s.readContent(f.id),
      });
    }
  }
  return all;
}

server.tool(
  'list_templates',
  'List reusable note templates (files inside the top-level "Plantillas" folder of each vault). '
  + 'Each item exposes its name, vault, byte size, and `vars`: the user-fillable placeholders '
  + '({name, default}) parsed from `{{var}}` / `{{var|default}}` occurrences. Built-ins and table '
  + 'generators are auto-resolved on apply and excluded from `vars`.\n\n'
  + 'Built-in vars (always auto-resolved):\n'
  + '  date, time, datetime, year, month, day, weekday, week, tomorrow, yesterday\n'
  + '  date+N / date-N (days offset), date:FORMAT, datetime:FORMAT, date+N:FORMAT\n'
  + '  user, email, vault, folder, folderpath, template, notecount\n'
  + '  uuid, shortid, clipboard, selection, cursor (caret marker)\n'
  + '  counter:name (auto-increment per name, padded to 4 digits)\n'
  + '  choice:opt1|opt2|opt3 (first opt as fallback)\n\n'
  + 'Date FORMAT tokens: YYYY YY MMMM MMM MM M DDDD DDD DD D HH mm ss dddd ddd. Locale es.\n\n'
  + 'Table generators (expand to markdown blocks):\n'
  + '  table:cols=A,B,C[:rows=N]\n'
  + '  kanbantable:cols=A,B,Estado:order=Pendiente,Hecho (auto-adds edinot kanban view comment)\n'
  + '  checktable:cols=Tarea[,...] (first col gets `- [ ]` prefix)\n'
  + '  tareastable (shortcut to Descripción/Prioridad/Estado kanban)\n'
  + '  datetable:N:cols=Fecha,Notas (N consecutive days from today)\n'
  + '  weekdaystable[:cols=Día,Plan] / monthstable[:cols=Mes,Objetivo]\n'
  + '  daterange:start=YYYY-MM-DD:end=YYYY-MM-DD:cols=Día,Notas\n\n'
  + 'Dashboards (scan existing notes; pass `vault=NAME` to scope):\n'
  + '  tasksopen[:vault=X][:status=Pendiente,En revisión]\n'
  + '    → table of open tasks across kanban notes (cols: Descripción/Prioridad/Estado/Nota)\n'
  + '  notesindex[:vault=X][:folder=Path][:cols=Nota,Vault,Carpeta]\n'
  + '    → list of notes matching the filters\n'
  + '  tableof:NoteName[:column=ColFilter][:filter=ValFilter][:filterColumn=ColName]\n'
  + '    → subset of the first markdown table in NoteName, projected/filtered\n'
  + '  csvclipboard\n'
  + '    → parses CSV text from the clipboard (editor-only; empty in MCP unless ctx supplies it)\n\n'
  + 'Transforms (apply to value of another var or builtin):\n'
  + '  upper:var / lower:var / cap:var / slug:var\n\n'
  + 'User-fillable choice syntax:\n'
  + '  {{estado|Pendiente/En revisión/Hecho}}  → modal renders <select>\n'
  + '  {{prio:choice=Alta|Media|Baja}}         → idem (verbose form)\n\n'
  + 'Optionally filter by vault (name or id).',
  { vault: z.string().optional() },
  async ({ vault }) => withSession(async (s) => json(await collectTemplates(s, vault))),
);

server.tool(
  'create_from_template',
  'Create a new note from a template. `template` is the template note name (case-insensitive, .md optional) '
  + 'as returned by list_templates. `name` is the new note filename. `vault` (optional) accepts a name or id '
  + 'and defaults to the template\'s own vault. `folder` (optional) places the new note inside a folder '
  + '(name or "Parent/Child" path within the target vault); pass "" or omit for vault root. `vars` is an '
  + 'object of placeholder values keyed by var name; missing vars fall back to their default. Built-ins '
  + '(date, time, vault) are auto-resolved; {{cursor}} markers are stripped. Fails if a note with that '
  + 'name already exists.',
  {
    template: z.string(),
    name: z.string(),
    vault: z.string().optional(),
    folder: z.string().optional(),
    vars: z.record(z.string()).optional(),
  },
  async ({ template, name, vault, folder, vars }) => withSession(async (s) => {
    const tpl = s.findFileByName(template);
    if (!tpl) throw new Error(`template not found: ${template}`);
    const tplFolderIds = templateFolderIdsForVault(s, tpl.vaultId || 'default');
    if (!isTemplateFile(s, tpl, tplFolderIds)) {
      throw new Error(`'${template}' is not a template — move it under the 'Plantillas' folder first`);
    }
    if (s.findFileByName(name)) throw new Error(`already exists: ${name}`);
    const targetVault = vault || s.vaultName(tpl.vaultId) || 'default';
    // Resolve folder context so {{folder}} / {{folderpath}} expand. Falls
    // back to empty string when the note lives at the vault root.
    let folderName = '', folderPath = '';
    if (folder) {
      try {
        const fInfo = s.findFolder ? s.findFolder(folder, targetVault) : null;
        if (fInfo) { folderName = fInfo.name || folder; folderPath = fInfo.path || folder; }
        else { folderName = folder.split('/').pop(); folderPath = folder; }
      } catch { folderName = folder.split('/').pop(); folderPath = folder; }
    }
    const ctx = {
      vaultName: targetVault,
      folderName, folderPath,
      templateName: tpl.name.replace(/\.(md|markdown|txt)$/i, ''),
      noteCount: s.listFiles({ vault: targetVault }).length,
      notes: await collectNotesForCtx(s),
    };
    const body = substituteTemplate(await s.readContent(tpl.id), vars || {}, ctx);
    const f = await s.createFile(name, targetVault, folder || null);
    await s.writeContent(f.id, body);
    s.publishMcpAction({
      kind: 'create',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      folderId: f.folderId || null,
      bytes: body.length,
      fromTemplate: tpl.name,
    });
    return json({
      ok: true, id: f.id, name: f.name,
      vaultId: f.vaultId || 'default',
      vault: s.vaultName(f.vaultId),
      folderId: f.folderId || null,
      bytes: body.length,
      fromTemplate: tpl.name,
    });
  }),
);

// ── Table operations ───────────────────────────────────────────────────────
// Structured access to markdown tables inside a note. By taking input
// keyed by column NAME (not positional arrays) we make it impossible for
// an LLM to swap "Estado" with "Prioridad" — wrong column names surface
// as immediate validation errors instead of corrupting the markdown.

// Locate every pipe-table block in `text`. Returns array of:
//   { tableIdx, headers, rows, startLine, sepLine, lastDataLine, position }
// startLine / lastDataLine are 0-based line indices into the original text.
// Split a markdown table row on unescaped `|`, drop the empty leading/trailing
// segments, unescape `\|` back to `|` in each cell. Centralises the parsing
// quirk so every cell-iterator sees clean content.
function splitTableLine(line) {
  // Negative-lookbehind ensures we don't break on `\|` literals inside cells.
  const parts = String(line).split(/(?<!\\)\|/);
  return parts.slice(1, -1).map(s => s.trim().replace(/\\\|/g, '|'));
}
function parseTableBlocks(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let idx = 0;
  // Nearest markdown heading above each table, so agents can pick a table by
  // its section title ("Ventas") instead of counting tables.
  let heading = null;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { heading = h[2]; continue; }
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const sepLine = (lines[i + 1] || '').trim();
    if (!/^\|[\s\-:|]+\|$/.test(sepLine)) continue;
    const headers = splitTableLine(line);
    const rows = [];
    let j = i + 2;
    while (j < lines.length) {
      const r = lines[j].trim();
      if (!r.startsWith('|') || !r.endsWith('|')) break;
      rows.push(splitTableLine(lines[j]));
      j++;
    }
    out.push({
      tableIdx: idx++,
      heading,
      headers,
      rows,
      startLine: i,
      sepLine: i + 1,
      firstDataLine: i + 2,
      lastDataLine: j - 1,
      position: { headerLine: i, lastRowLine: j - 1 },
    });
    i = j - 1;
  }
  return out;
}

// Build a single markdown table row from a values-by-column-name object.
// Missing columns become empty cells; extra keys are dropped (reported).
function buildTableRow(headers, values) {
  const cells = headers.map(h => {
    const v = values && (values[h] != null ? values[h] : values[h.toLowerCase()]);
    return v == null ? '' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  });
  return `| ${cells.join(' | ')} |`;
}

// Re-serialize the modified table block into the original text. `block` is
// the object returned by parseTableBlocks; `newRows` is an array of new
// row strings (already pipe-formatted). Preserves blank lines after the
// block and any kanban view comment immediately above.
function spliceTableRows(text, block, newRows) {
  const lines = String(text || '').split('\n');
  const headerSep = lines.slice(block.startLine, block.firstDataLine);
  const before = lines.slice(0, block.startLine);
  const after = lines.slice(block.lastDataLine + 1);
  return [...before, ...headerSep, ...newRows, ...after].join('\n');
}

// Table selector shared by every table tool: the 0-based index, or the title
// of the section (heading) the table sits under, e.g. "Ventas".
const TABLE_SEL = z.union([z.number().int().min(0), z.string().min(1)]).optional()
  .describe('Which table: 0-based index, or the heading of its section (e.g. "Ventas"; case-insensitive). Optional when the note has one table.');

function pickTable(blocks, tableIdx) {
  if (!blocks.length) throw new Error('note has no markdown tables');
  if (tableIdx == null) {
    if (blocks.length > 1) {
      const list = blocks.map(b => `${b.tableIdx}${b.heading ? ` ("${b.heading}")` : ''}`).join(', ');
      throw new Error(`note has ${blocks.length} tables — pass tableIdx as an index or a section heading: ${list}`);
    }
    return blocks[0];
  }
  if (typeof tableIdx === 'string' && !/^\d+$/.test(tableIdx.trim())) {
    const norm = (t) => String(t || '').replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().toLowerCase();
    const want = norm(tableIdx);
    const hits = blocks.filter(b => norm(b.heading) === want);
    const pool = hits.length ? hits : blocks.filter(b => b.heading && norm(b.heading).includes(want));
    if (pool.length === 1) return pool[0];
    const list = blocks.map(b => `${b.tableIdx}${b.heading ? ` ("${b.heading}")` : ''}`).join(', ');
    if (!pool.length) throw new Error(`no table under a heading matching "${tableIdx}". Tables: ${list}`);
    throw new Error(`${pool.length} tables match "${tableIdx}" — pass the numeric tableIdx. Tables: ${list}`);
  }
  tableIdx = Number(tableIdx);
  const b = blocks[tableIdx];
  if (!b) throw new Error(`tableIdx ${tableIdx} out of range (note has ${blocks.length} tables)`);
  return b;
}

function rowToObject(headers, row) {
  const o = {};
  for (let i = 0; i < headers.length; i++) o[headers[i]] = row[i] || '';
  return o;
}

function matchRow(headers, row, match) {
  // match is { ColName: substring }. Case-insensitive substring on each cell.
  for (const [k, v] of Object.entries(match || {})) {
    const idx = headers.findIndex(h => h.toLowerCase() === String(k).toLowerCase());
    if (idx < 0) return false;
    if (!String(row[idx] || '').toLowerCase().includes(String(v).toLowerCase())) return false;
  }
  return true;
}

function validateColumnNames(headers, values) {
  // Returns { warnings: [...] } reporting keys in `values` that don't match
  // any header. Headers are matched case-insensitively. Doesn't throw —
  // surfaced as part of the tool result so the LLM sees the typo.
  const lowered = new Set(headers.map(h => h.toLowerCase()));
  const warnings = [];
  for (const k of Object.keys(values || {})) {
    if (!lowered.has(k.toLowerCase())) {
      warnings.push(`column not in headers: '${k}' (valid: ${headers.join(', ')})`);
    }
  }
  return warnings;
}

// ── Table column-type + view directive (server-side) ─────────────────────
// The render directive is an HTML comment on the line above the table:
//   <!-- edinot:view=kanban:by=Estado:cols=Estado%3Dstatus%3ATodo%7CDone -->
// These helpers mirror editor.jsx's parseColsClause/serializeColsClause +
// the view directive so MCP can configure column types and views.
const SRV_COLUMN_TYPES = ['text', 'select', 'number', 'date', 'checkbox', 'tags', 'multiselect', 'status', 'rating', 'progress', 'person', 'wikilink', 'archivo'];
// Same order editor.jsx writes. `hide`/`cal`/`ocol`/`views` come from the
// database UI (editor/db/model.js): hidden columns, calendar date column,
// per-option colors (URL-encoded JSON) and saved views (URL-encoded JSON).
const SRV_CLAUSE_ORDER = ['by', 'order', 'agg', 'widths', 'sort', 'filt', 'cols', 'colors', 'hide', 'cal', 'ocol', 'views'];
// Rename / drop a column everywhere the directive references it by name, so
// sorting, filters, widths, groupings and saved views keep pointing at it.
function srvDirectiveColumnEdit(map, oldName, newName) {
  const ren = (x) => (x === oldName ? newName : x);
  const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const enc = encodeURIComponent;
  const keyedList = (str, sep) => str.split(sep).map((pair) => {
    const d = dec(pair); const eq = d.indexOf('=');
    if (eq <= 0) return pair;
    const k = d.slice(0, eq);
    if (k !== oldName) return pair;
    return newName == null ? null : enc(`${newName}${d.slice(eq)}`);
  }).filter(x => x != null).join(sep);
  const keyedComma = (str) => str.split(',').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq <= 0) return pair;
    const k = dec(pair.slice(0, eq));
    if (k !== oldName) return pair;
    return newName == null ? null : `${enc(newName)}${pair.slice(eq)}`;
  }).filter(x => x != null).join(',');
  if (map.by && dec(map.by) === oldName) { if (newName == null) { delete map.by; delete map.order; } else map.by = enc(newName); }
  if (map.cal && dec(map.cal) === oldName) { if (newName == null) delete map.cal; else map.cal = enc(newName); }
  if (map.sort) {
    const i = map.sort.lastIndexOf(',');
    if (i > 0 && dec(map.sort.slice(0, i)) === oldName) { if (newName == null) delete map.sort; else map.sort = `${enc(newName)}${map.sort.slice(i)}`; }
  }
  for (const k of ['filt', 'cols']) if (map[k]) { map[k] = keyedList(map[k], ';'); if (!map[k]) delete map[k]; }
  for (const k of ['agg', 'widths']) if (map[k]) { map[k] = keyedComma(map[k]); if (!map[k]) delete map[k]; }
  if (map.hide) {
    const list = map.hide.split(',').map(dec).map(ren).filter(x => x != null && x !== '');
    if (list.length) map.hide = list.map(enc).join(','); else delete map.hide;
  }
  const json = (v) => { try { return JSON.parse(dec(v)); } catch { return null; } };
  if (map.ocol) {
    const o = json(map.ocol);
    if (o && o[oldName]) { if (newName != null) o[newName] = o[oldName]; delete o[oldName]; }
    if (o && Object.keys(o).length) map.ocol = enc(JSON.stringify(o)); else delete map.ocol;
  }
  if (map.views) {
    const v = json(map.views);
    if (v && Array.isArray(v.list)) {
      for (const e of v.list) {
        if (e.by === oldName) { if (newName == null) delete e.by; else e.by = newName; }
        if (e.cal === oldName) { if (newName == null) delete e.cal; else e.cal = newName; }
        if (e.sort && e.sort.col === oldName) { if (newName == null) delete e.sort; else e.sort.col = newName; }
        if (e.filt && e.filt[oldName] != null) { if (newName != null) e.filt[newName] = e.filt[oldName]; delete e.filt[oldName]; }
        if (Array.isArray(e.hide)) e.hide = e.hide.map(ren).filter(x => x != null);
      }
      map.views = enc(JSON.stringify(v));
    }
  }
  return map;
}
function srvParseCols(encoded) {
  if (!encoded) return {};
  const out = {};
  for (const raw of encoded.split(';')) {
    try {
      const dec = decodeURIComponent(raw);
      const eq = dec.indexOf('=');
      if (eq <= 0) continue;
      const k = dec.slice(0, eq).trim();
      const v = dec.slice(eq + 1).trim();
      if (!k || !v) continue;
      const c = v.indexOf(':');
      let type, options = null;
      if (c > 0) { type = v.slice(0, c); options = v.slice(c + 1).split('|').map(x => x.trim()).filter(Boolean); }
      else type = v;
      if (!SRV_COLUMN_TYPES.includes(type)) continue;
      out[k] = options && options.length ? { type, options } : { type };
    } catch {}
  }
  return out;
}
function srvSerializeCols(cols) {
  const parts = [];
  for (const [k, conf] of Object.entries(cols || {})) {
    if (!conf || !conf.type || conf.type === 'text') continue;
    let v = conf.type;
    if (conf.options && conf.options.length) v += ':' + conf.options.join('|');
    parts.push(encodeURIComponent(`${k}=${v}`));
  }
  return parts.join(';');
}
// Cell/header coloring — mirrors editor.jsx parseColorsClause/serializeColorsClause.
const SRV_COLOR_BUCKET = { h: 'headers', c: 'cols', x: 'cells', ht: 'headersFg', ct: 'colsFg', xt: 'cellsFg' };
function srvParseColors(s) {
  const out = { headers: {}, cols: {}, cells: {}, headersFg: {}, colsFg: {}, cellsFg: {} };
  if (!s) return out;
  for (const raw of s.split(';')) {
    if (!raw) continue;
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    const lhs = raw.slice(0, eq);
    const val = raw.slice(eq + 1).trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(val)) continue;
    const dot = lhs.indexOf('.');
    if (dot <= 0) continue;
    const kind = lhs.slice(0, dot);
    const key = lhs.slice(dot + 1);
    const bucket = SRV_COLOR_BUCKET[kind];
    if (!bucket) continue;
    if (kind === 'x' || kind === 'xt') { if (/^\d+,\d+$/.test(key)) out[bucket][key] = '#' + val; }
    else { try { out[bucket][decodeURIComponent(key)] = '#' + val; } catch {} }
  }
  return out;
}
function srvSerializeColors(c) {
  if (!c) return '';
  const parts = [];
  const hex = (v) => String(v || '').replace('#', '').toLowerCase();
  const push = (kind, key, v, cell) => {
    const h = hex(v);
    if (!/^[0-9a-f]{6}$/.test(h)) return;
    if (cell) { if (/^\d+,\d+$/.test(key)) parts.push(`${kind}.${key}=${h}`); }
    else parts.push(`${kind}.${encodeURIComponent(key)}=${h}`);
  };
  for (const [k, v] of Object.entries(c.headers || {})) push('h', k, v);
  for (const [k, v] of Object.entries(c.cols || {})) push('c', k, v);
  for (const [k, v] of Object.entries(c.cells || {})) push('x', k, v, true);
  for (const [k, v] of Object.entries(c.headersFg || {})) push('ht', k, v);
  for (const [k, v] of Object.entries(c.colsFg || {})) push('ct', k, v);
  for (const [k, v] of Object.entries(c.cellsFg || {})) push('xt', k, v, true);
  return parts.join(';');
}
// Find the directive line for a table (nearest non-blank line above it that
// matches the edinot:view comment). Returns { lineIdx, view, map } or null.
function srvFindDirective(lines, startLine) {
  let i = startLine - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return null;
  const m = lines[i].match(/^[ \t]*<!--\s*edinot:view=([a-z]+)((?::[a-zA-Z]+=[^:\s>]+)*)\s*-->[ \t]*$/);
  if (!m) return null;
  const map = {};
  const re = /:([a-zA-Z]+)=([^:]*)/g;
  let mm;
  while ((mm = re.exec(m[2] || '')) !== null) map[mm[1]] = mm[2];
  return { lineIdx: i, view: m[1], map };
}
function srvSerializeDirective(view, map) {
  let s = `<!-- edinot:view=${view || 'table'}`;
  for (const k of SRV_CLAUSE_ORDER) if (map[k] != null && map[k] !== '') s += `:${k}=${map[k]}`;
  for (const k of Object.keys(map)) if (!SRV_CLAUSE_ORDER.includes(k) && map[k] != null && map[k] !== '') s += `:${k}=${map[k]}`;
  return s + ' -->';
}
// Read the directive state for a parsed table block.
function srvReadDirective(content, block) {
  const lines = String(content || '').split('\n');
  const d = srvFindDirective(lines, block.startLine);
  return d ? { view: d.view, map: { ...d.map }, lineIdx: d.lineIdx } : { view: 'table', map: {}, lineIdx: -1 };
}
function srvRowLine(arr) {
  return `| ${arr.map(c => String(c == null ? '' : c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
}
// Rebuild an entire table block (header + separator + rows) in `content`
// from new headers/rows arrays, then set its directive. Returns new text.
function srvRebuildTable(content, block, headers, rows, view, map) {
  const lines = String(content || '').split('\n');
  const headerLine = srvRowLine(headers);
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map(r => srvRowLine(r));
  const before = lines.slice(0, block.startLine);
  const after = lines.slice(block.lastDataLine + 1);
  let mid = [headerLine, sepLine, ...rowLines];
  // Re-emit / drop the directive line above the table.
  const dir = srvFindDirective(lines, block.startLine);
  const directiveStr = (view || (map && Object.keys(map).length)) ? srvSerializeDirective(view || 'table', map || {}) : null;
  if (dir) {
    before[dir.lineIdx] = directiveStr || '';
    if (!directiveStr) before.splice(dir.lineIdx, 1);
  } else if (directiveStr) {
    before.push(directiveStr);
  }
  return [...before, ...mid, ...after].join('\n');
}
function srvColIndex(headers, column) {
  const i = headers.findIndex(h => h.toLowerCase() === String(column).toLowerCase());
  if (i < 0) throw new Error(`column not found: '${column}' (valid: ${headers.join(', ')})`);
  return i;
}

server.tool(
  'list_tables',
  'List every markdown pipe-table inside a note. Returns each table\'s index, '
  + 'headers, and row count so an agent can pick the right one before reading '
  + 'or mutating it. Use the returned `tableIdx` with the other table_* tools.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const blocks = parseTableBlocks(await s.readContent(f.id));
    return json(blocks.map(b => ({
      tableIdx: b.tableIdx,
      heading: b.heading,
      headers: b.headers,
      rowCount: b.rows.length,
      startLine: b.startLine,
    })));
  }),
);

server.tool(
  'read_table',
  'Read a markdown table from a note as an array of row objects keyed by '
  + 'column name. `tableIdx` is optional when the note has exactly one table. '
  + 'Returned shape: { headers, rows: [ { ColName: value, ... }, ... ] }. '
  + 'Use this instead of read_note when you need to manipulate tabular data '
  + 'so you never have to count columns or guess positions.',
  { name: z.string(), tableIdx: TABLE_SEL },
  async ({ name, tableIdx }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const blocks = parseTableBlocks(content);
    const b = pickTable(blocks, tableIdx);
    const payload = json({
      tableIdx: b.tableIdx,
      headers: b.headers,
      rows: b.rows.map(r => rowToObject(b.headers, r)),
    });
    // Surface any image attachments referenced in the table cells as vision
    // blocks (scoped to the picked table's text, not the whole note).
    const tableText = b.rows.map(r => r.join(' ')).join('\n');
    const images = await imageBlocksForContent(tableText);
    if (images.length) payload.content.push(...images);
    return payload;
  }),
);

server.tool(
  'add_table_row',
  'Append (or insert) a row into a markdown table. `row` MUST be keyed by '
  + 'column name — keys that don\'t match any header come back as warnings. '
  + '`position`: "top" (after header), "bottom" (default), or {after: N} to '
  + 'insert after the Nth data row (0-based). `tableIdx` optional when only '
  + 'one table exists. Returns the rebuilt row + any column-name warnings.',
  {
    name: z.string(),
    tableIdx: TABLE_SEL,
    row: z.record(z.string()),
    position: z.union([z.literal('top'), z.literal('bottom'), z.object({ after: z.number().int().min(0) })]).optional(),
  },
  async ({ name, tableIdx, row, position }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const blocks = parseTableBlocks(content);
    const b = pickTable(blocks, tableIdx);
    const warnings = validateColumnNames(b.headers, row);
    const rowStr = buildTableRow(b.headers, row);
    const existing = b.rows.map(r => `| ${r.map(c => String(c || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
    let newRows;
    if (position === 'top') newRows = [rowStr, ...existing];
    else if (position && typeof position === 'object' && 'after' in position) {
      const at = Math.max(0, Math.min(position.after + 1, existing.length));
      newRows = [...existing.slice(0, at), rowStr, ...existing.slice(at)];
    } else newRows = [...existing, rowStr];
    const next = spliceTableRows(content, b, newRows);
    await s.writeContent(f.id, next);
    s.publishMcpAction({
      kind: 'table_add_row',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      tableIdx: b.tableIdx, row,
    });
    return json({ ok: true, tableIdx: b.tableIdx, rowAdded: row, warnings });
  }),
);

server.tool(
  'update_table_row',
  'Update one or more cells in an existing table row. Identify the row '
  + 'either by `rowIdx` (0-based data-row index) OR by `match` (object of '
  + 'column→substring; first matching row wins). `values` is keyed by '
  + 'column name. Only the columns present in `values` are touched. Returns '
  + 'the resulting row + warnings for any unknown column names.',
  {
    name: z.string(),
    tableIdx: TABLE_SEL,
    rowIdx: z.number().int().min(0).optional(),
    match: z.record(z.string()).optional(),
    values: z.record(z.string()),
  },
  async ({ name, tableIdx, rowIdx, match, values }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const blocks = parseTableBlocks(content);
    const b = pickTable(blocks, tableIdx);
    let targetIdx = -1;
    if (rowIdx != null) targetIdx = rowIdx;
    else if (match) targetIdx = b.rows.findIndex(r => matchRow(b.headers, r, match));
    if (targetIdx < 0 || targetIdx >= b.rows.length) {
      throw new Error('row not found — pass rowIdx or a match object that identifies an existing row');
    }
    const warnings = validateColumnNames(b.headers, values);
    const merged = { ...rowToObject(b.headers, b.rows[targetIdx]), ...values };
    // Re-key merged with case-insensitive header lookup (so user keys
    // matching headers ignoring case still apply).
    const finalValues = {};
    for (const h of b.headers) {
      const k = Object.keys(merged).find(k => k.toLowerCase() === h.toLowerCase());
      finalValues[h] = k != null ? merged[k] : '';
    }
    const newRowStr = buildTableRow(b.headers, finalValues);
    const existing = b.rows.map(r => `| ${r.map(c => String(c || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
    existing[targetIdx] = newRowStr;
    const next = spliceTableRows(content, b, existing);
    await s.writeContent(f.id, next);
    s.publishMcpAction({
      kind: 'table_update_row',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      tableIdx: b.tableIdx, rowIdx: targetIdx, values,
    });
    return json({ ok: true, tableIdx: b.tableIdx, rowIdx: targetIdx, row: finalValues, warnings });
  }),
);

server.tool(
  'delete_table_row',
  'Delete a row from a table. Identify by `rowIdx` (0-based) or `match` '
  + '({Column: substring}); first matching row is removed. Returns the deleted '
  + 'row data so the caller can confirm what disappeared.',
  {
    name: z.string(),
    tableIdx: TABLE_SEL,
    rowIdx: z.number().int().min(0).optional(),
    match: z.record(z.string()).optional(),
  },
  async ({ name, tableIdx, rowIdx, match }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const blocks = parseTableBlocks(content);
    const b = pickTable(blocks, tableIdx);
    let targetIdx = -1;
    if (rowIdx != null) targetIdx = rowIdx;
    else if (match) targetIdx = b.rows.findIndex(r => matchRow(b.headers, r, match));
    if (targetIdx < 0 || targetIdx >= b.rows.length) {
      throw new Error('row not found — pass rowIdx or a match object that identifies an existing row');
    }
    const deleted = rowToObject(b.headers, b.rows[targetIdx]);
    const existing = b.rows.map(r => `| ${r.map(c => String(c || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
    existing.splice(targetIdx, 1);
    const next = spliceTableRows(content, b, existing);
    await s.writeContent(f.id, next);
    s.publishMcpAction({
      kind: 'table_delete_row',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      tableIdx: b.tableIdx, rowIdx: targetIdx,
    });
    return json({ ok: true, tableIdx: b.tableIdx, rowIdx: targetIdx, deleted });
  }),
);

server.tool(
  'find_table_rows',
  'Find rows in a table by case-insensitive substring match across columns. '
  + '`match` keys are column names; values are substrings. Returns matching '
  + 'rows with their indices so you can hand `rowIdx` to update_/delete_.',
  {
    name: z.string(),
    tableIdx: TABLE_SEL,
    match: z.record(z.string()),
  },
  async ({ name, tableIdx, match }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const blocks = parseTableBlocks(await s.readContent(f.id));
    const b = pickTable(blocks, tableIdx);
    const warnings = validateColumnNames(b.headers, match);
    const hits = [];
    b.rows.forEach((r, idx) => {
      if (matchRow(b.headers, r, match)) hits.push({ rowIdx: idx, row: rowToObject(b.headers, r) });
    });
    return json({ tableIdx: b.tableIdx, hits, warnings });
  }),
);

server.tool(
  'set_column_type',
  'Configure the render type of a table column so the app shows it as a '
  + 'rich cell (pill / checkbox / stars / progress bar / person chip …). '
  + '`type` ∈ text|select|number|date|checkbox|tags|multiselect|status|'
  + 'rating|progress|person. `options` (array) is required for select/'
  + 'status (single value) and multiselect (several); ignored otherwise. '
  + 'Pass type="text" to clear a column\'s type. tableIdx optional when the '
  + 'note has one table. The values in the cells are NOT rewritten.',
  {
    name: z.string(),
    column: z.string(),
    type: z.enum(['text', 'select', 'number', 'date', 'checkbox', 'tags', 'multiselect', 'status', 'rating', 'progress', 'person', 'wikilink', 'archivo']),
    options: z.array(z.string()).optional(),
    tableIdx: TABLE_SEL,
  },
  async ({ name, column, type, options, tableIdx }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const b = pickTable(parseTableBlocks(content), tableIdx);
    const colName = b.headers[srvColIndex(b.headers, column)];
    const { view, map } = srvReadDirective(content, b);
    const cols = srvParseCols(map.cols);
    if (type === 'text') delete cols[colName];
    else cols[colName] = (options && options.length) ? { type, options } : { type };
    const colsStr = srvSerializeCols(cols);
    if (colsStr) map.cols = colsStr; else delete map.cols;
    const lines = content.split('\n');
    const d = srvFindDirective(lines, b.startLine);
    const newDir = srvSerializeDirective(view, map);
    if (d) lines[d.lineIdx] = newDir; else lines.splice(b.startLine, 0, newDir);
    await s.writeContent(f.id, lines.join('\n'));
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'set_column_type', target: `columna "${colName}" → ${type}`, where: `en ${f.name}` });
    return json({ ok: true, column: colName, type, options: options || null, tableIdx: b.tableIdx });
  }),
);

server.tool(
  'color_table',
  'Color a rendered table\'s headers and/or cells. Colors persist in the table '
  + 'directive and show in render mode, shared views and exports (PDF/HTML/Word). '
  + 'Provide hex colors ("#fde2e2" or "fde2e2"). `header`/`headerText` map a '
  + 'column name → background/text color for its header cell. `column`/`columnText` '
  + 'color every body cell in that column. `cells` colors individual cells '
  + '(row = 0-based data-row index, column = column name). Pass an empty string '
  + 'as a color to remove that specific coloring, or `clear:true` to wipe ALL '
  + 'colors first. tableIdx optional when the note has one table.',
  {
    name: z.string(),
    tableIdx: TABLE_SEL,
    header: z.record(z.string()).optional(),
    headerText: z.record(z.string()).optional(),
    column: z.record(z.string()).optional(),
    columnText: z.record(z.string()).optional(),
    cells: z.array(z.object({
      row: z.number().int().min(0),
      column: z.string(),
      color: z.string().optional(),
      text: z.string().optional(),
    })).optional(),
    clear: z.boolean().optional(),
  },
  async ({ name, tableIdx, header, headerText, column, columnText, cells, clear }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const b = pickTable(parseTableBlocks(content), tableIdx);
    const { view, map } = srvReadDirective(content, b);
    const colors = clear ? { headers: {}, cols: {}, cells: {}, headersFg: {}, colsFg: {}, cellsFg: {} } : srvParseColors(map.colors);
    const norm = (v) => {
      if (v == null) return undefined;        // not provided → leave as-is
      const h = String(v).replace('#', '').toLowerCase();
      if (v === '') return null;              // explicit clear
      return /^[0-9a-f]{6}$/.test(h) ? '#' + h : undefined;
    };
    const applyRecord = (rec, bucket) => {
      for (const [k, v] of Object.entries(rec || {})) {
        const colName = b.headers[srvColIndex(b.headers, k)];
        const c = norm(v);
        if (c === null) delete colors[bucket][colName];
        else if (c) colors[bucket][colName] = c;
      }
    };
    applyRecord(header, 'headers');
    applyRecord(headerText, 'headersFg');
    applyRecord(column, 'cols');
    applyRecord(columnText, 'colsFg');
    for (const cell of (cells || [])) {
      const ci = srvColIndex(b.headers, cell.column);
      const key = `${cell.row},${ci}`;
      const bg = norm(cell.color);
      const fg = norm(cell.text);
      if (bg === null) delete colors.cells[key]; else if (bg) colors.cells[key] = bg;
      if (fg === null) delete colors.cellsFg[key]; else if (fg) colors.cellsFg[key] = fg;
    }
    const colorsStr = srvSerializeColors(colors);
    if (colorsStr) map.colors = colorsStr; else delete map.colors;
    const lines = content.split('\n');
    const d = srvFindDirective(lines, b.startLine);
    const newDir = srvSerializeDirective(view, map);
    if (d) lines[d.lineIdx] = newDir; else lines.splice(b.startLine, 0, newDir);
    await s.writeContent(f.id, lines.join('\n'));
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'color_table', target: `colores de tabla`, where: `en ${f.name}` });
    return json({ ok: true, tableIdx: b.tableIdx, colors: colorsStr });
  }),
);

server.tool(
  'add_table_column',
  'Add a new column to a markdown table. Appends at the end by default, or '
  + 'pass `afterColumn` (existing column name) to insert right after it. New '
  + 'cells start empty. Optionally set its `type` (+ `options`) in the same '
  + 'call. tableIdx optional when the note has one table.',
  {
    name: z.string(),
    column: z.string(),
    afterColumn: z.string().optional(),
    type: z.enum(['text', 'select', 'number', 'date', 'checkbox', 'tags', 'multiselect', 'status', 'rating', 'progress', 'person', 'wikilink', 'archivo']).optional(),
    options: z.array(z.string()).optional(),
    tableIdx: TABLE_SEL,
  },
  async ({ name, column, afterColumn, type, options, tableIdx }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const b = pickTable(parseTableBlocks(content), tableIdx);
    if (b.headers.some(h => h.toLowerCase() === column.toLowerCase())) throw new Error(`column already exists: '${column}'`);
    const at = afterColumn ? srvColIndex(b.headers, afterColumn) + 1 : b.headers.length;
    const headers = [...b.headers];
    headers.splice(at, 0, column);
    const rows = b.rows.map(r => { const c = [...r]; c.splice(at, 0, ''); return c; });
    const { view, map } = srvReadDirective(content, b);
    if (type && type !== 'text') {
      const cols = srvParseCols(map.cols);
      cols[column] = (options && options.length) ? { type, options } : { type };
      const colsStr = srvSerializeCols(cols);
      if (colsStr) map.cols = colsStr;
    }
    const next = srvRebuildTable(content, b, headers, rows, view, map);
    await s.writeContent(f.id, next);
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'add_table_column', target: `columna "${column}"`, where: `en ${f.name}` });
    return json({ ok: true, column, atIndex: at, headers, tableIdx: b.tableIdx });
  }),
);

server.tool(
  'rename_table_column',
  'Rename a table column. Updates the header and the column-type directive '
  + 'key; cell values are unchanged. tableIdx optional when the note has one '
  + 'table.',
  {
    name: z.string(),
    column: z.string(),
    newName: z.string(),
    tableIdx: TABLE_SEL,
  },
  async ({ name, column, newName, tableIdx }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const b = pickTable(parseTableBlocks(content), tableIdx);
    const idx = srvColIndex(b.headers, column);
    const oldName = b.headers[idx];
    if (b.headers.some((h, i) => i !== idx && h.toLowerCase() === newName.toLowerCase())) throw new Error(`column already exists: '${newName}'`);
    const headers = [...b.headers]; headers[idx] = newName;
    const { view, map } = srvReadDirective(content, b);
    srvDirectiveColumnEdit(map, oldName, newName);
    const next = srvRebuildTable(content, b, headers, b.rows, view, map);
    await s.writeContent(f.id, next);
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'rename_table_column', target: `"${oldName}" → "${newName}"`, where: `en ${f.name}` });
    return json({ ok: true, from: oldName, to: newName, headers, tableIdx: b.tableIdx });
  }),
);

server.tool(
  'delete_table_column',
  'Delete a column from a table — removes the header cell and the matching '
  + 'cell in every row, plus its column-type directive entry. tableIdx '
  + 'optional when the note has one table.',
  {
    name: z.string(),
    column: z.string(),
    tableIdx: TABLE_SEL,
  },
  async ({ name, column, tableIdx }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const b = pickTable(parseTableBlocks(content), tableIdx);
    const idx = srvColIndex(b.headers, column);
    const removed = b.headers[idx];
    if (b.headers.length <= 1) throw new Error('cannot delete the only column');
    const headers = b.headers.filter((_, i) => i !== idx);
    const rows = b.rows.map(r => r.filter((_, i) => i !== idx));
    const { view, map } = srvReadDirective(content, b);
    srvDirectiveColumnEdit(map, removed, null);
    const next = srvRebuildTable(content, b, headers, rows, view, map);
    await s.writeContent(f.id, next);
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'delete_table_column', target: `columna "${removed}"`, where: `en ${f.name}` });
    return json({ ok: true, deleted: removed, headers, tableIdx: b.tableIdx });
  }),
);

server.tool(
  'set_table_view',
  'Set how a table renders in the app. `view` ∈ table|kanban|calendar|cards|list: '
  + 'table = classic grid, kanban = board lanes ("Tablero"), calendar = month '
  + 'grid placing each row on its date, cards = gallery tiles ("Galería", '
  + '"gallery" is accepted as an alias), list = vertical rows. When YOU '
  + 'create a table, follow up with this tool to pick the view that fits the '
  + 'data (status workflow → kanban, dated items → calendar, visual '
  + 'collection → cards) instead of leaving the default grid. For kanban pass '
  + '`by` (the column to group cards by — usually a select/status column) and '
  + 'optionally `order` (array of column values giving the left-to-right lane '
  + 'order). For calendar pass `date` (the date column; defaults to the first '
  + 'date-typed column). Pass view="table" to clear grouping. If the table has '
  + 'saved views (tabs), this changes the type of the active one. tableIdx '
  + 'optional when the note has one table.',
  {
    name: z.string(),
    view: z.enum(['table', 'kanban', 'calendar', 'cards', 'gallery', 'list']),
    by: z.string().optional(),
    order: z.array(z.string()).optional(),
    date: z.string().optional(),
    tableIdx: TABLE_SEL,
  },
  async ({ name, view: viewIn, by, order, date, tableIdx }) => withSession(async (s) => {
    const view = viewIn === 'gallery' ? 'cards' : viewIn;
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const b = pickTable(parseTableBlocks(content), tableIdx);
    if (by) srvColIndex(b.headers, by); // validate grouping column exists
    if (date) srvColIndex(b.headers, date); // validate the date column exists
    const { map } = srvReadDirective(content, b);
    if (view === 'kanban' && by) {
      map.by = encodeURIComponent(by);
      if (order && order.length) map.order = order.map(encodeURIComponent).join(',');
      else delete map.order;
    } else if (view !== 'calendar') {
      delete map.by; delete map.order;
    }
    if (view === 'calendar' && date) map.cal = encodeURIComponent(b.headers[srvColIndex(b.headers, date)]);
    const lines = content.split('\n');
    const d = srvFindDirective(lines, b.startLine);
    const newDir = srvSerializeDirective(view, map);
    if (d) lines[d.lineIdx] = newDir; else lines.splice(b.startLine, 0, newDir);
    await s.writeContent(f.id, lines.join('\n'));
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'set_table_view', target: `vista ${view}${by ? ' por ' + by : ''}${date ? ' por ' + date : ''}`, where: `en ${f.name}` });
    return json({ ok: true, view, by: by || null, order: order || null, date: date || null, tableIdx: b.tableIdx });
  }),
);

// ── Knowledge graph: wikilinks, tags, outline, tasks ─────────────────────
function srvExtractWikilinks(text) {
  const out = [];
  const re = /\[\[([^\]\n|#]+)(?:[#|][^\]\n]*)?\]\]/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push(m[1].trim());
  return out;
}
function srvNormName(name) { return String(name || '').trim().toLowerCase().replace(/\.md$/, ''); }
function srvExtractTags(text) {
  const out = new Set();
  // Inline #hashtags. The tag must START with a letter or '_' (so '# Title'
  // headings, hex colors like #0a0414, and bare numbers #3 never count) and
  // then allows letters/digits/_/-//. Skip fenced code blocks so CSS hex
  // colours / code don't leak in.
  const re = /(?:^|[\s(])#([\p{L}_][\p{L}\p{N}_\/-]{0,59})/gu;
  let fenced = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) out.add(m[1]);
  }
  return [...out];
}
function srvToggleTask(src, n) {
  const re = /^([ \t]*[-*+]\s+)\[([ xX])\](.*)$/gm;
  let i = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (i === n) {
      const nc = m[2] === ' ' ? 'x' : ' ';
      return { text: src.slice(0, m.index) + `${m[1]}[${nc}]${m[3]}` + src.slice(m.index + m[0].length), checked: nc === 'x' };
    }
    i++;
  }
  return null;
}

server.tool(
  'get_outline',
  'Return the heading outline (#, ##, … up to ######) of a note as an array '
  + 'of { level, text, line } so an agent can understand a long note\'s '
  + 'structure or jump to a section without reading the whole body.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const lines = String(await s.readContent(f.id)).split('\n');
    let fenced = false;
    const out = [];
    lines.forEach((ln, idx) => {
      if (/^\s*```/.test(ln)) { fenced = !fenced; return; }
      if (fenced) return;
      const h = ln.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (h) out.push({ level: h[1].length, text: h[2].trim(), line: idx + 1 });
    });
    return json({ note: f.name, headings: out });
  }),
);

server.tool(
  'get_outgoing_links',
  'List the [[wikilinks]] a note points TO. Resolves each target to an '
  + 'existing note when possible (resolved:true) so you can tell live links '
  + 'from dangling ones.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const targets = srvExtractWikilinks(await s.readContent(f.id));
    const all = s.listFiles({});
    const byName = new Set(all.map(x => srvNormName(x.name)));
    const seen = new Set();
    const links = [];
    for (const tgt of targets) {
      const key = srvNormName(tgt);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ target: tgt, resolved: byName.has(key) });
    }
    return json({ note: f.name, outgoing: links });
  }),
);

server.tool(
  'list_backlinks',
  'List notes that link TO the given note via [[wikilinks]]. Scans every '
  + 'note in the vault (or all vaults if `vault` omitted). Returns the '
  + 'linking note names + vault.',
  { name: z.string(), vault: z.string().optional() },
  async ({ name, vault }) => withSession(async (s) => {
    const target = s.findFileByName(name);
    if (!target) throw new Error(`not found: ${name}`);
    const targetKey = srvNormName(target.name);
    const out = [];
    for (const f of s.listFiles(vault ? { vault } : {})) {
      if (f.id === target.id) continue;
      const links = srvExtractWikilinks(await scanBody(s, f.id)).map(srvNormName);
      if (links.includes(targetKey)) out.push({ note: f.name, vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default' });
    }
    return json({ note: target.name, backlinks: out });
  }),
);

server.tool(
  'list_tags',
  'List every #hashtag used across notes (in `vault`, or all vaults if '
  + 'omitted) with how many notes use each. Sorted by frequency. Tags are '
  + 'inline #tokens in note bodies (not markdown headings).',
  { vault: z.string().optional() },
  async ({ vault }) => withSession(async (s) => {
    const counts = new Map();
    for (const f of s.listFiles(vault ? { vault } : {})) {
      const tags = new Set(srvExtractTags(await scanBody(s, f.id)).map(x => x.toLowerCase()));
      for (const tg of tags) counts.set(tg, (counts.get(tg) || 0) + 1);
    }
    const tags = [...counts.entries()].map(([tag, notes]) => ({ tag, notes })).sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag));
    return json({ tags });
  }),
);

server.tool(
  'notes_by_tag',
  'List notes that contain a given #hashtag (in `vault`, or all vaults if '
  + 'omitted). Pass the tag with or without the leading #.',
  { tag: z.string(), vault: z.string().optional() },
  async ({ tag, vault }) => withSession(async (s) => {
    const want = String(tag).replace(/^#/, '').toLowerCase();
    const out = [];
    for (const f of s.listFiles(vault ? { vault } : {})) {
      const tags = srvExtractTags(await scanBody(s, f.id)).map(x => x.toLowerCase());
      if (tags.includes(want)) out.push({ note: f.name, vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default' });
    }
    return json({ tag: want, notes: out });
  }),
);

server.tool(
  'toggle_task',
  'Toggle the Nth markdown checklist item (`- [ ]` / `- [x]`) in a note, '
  + '0-based in document order. Returns the new checked state. Use read_note '
  + 'first to count which task index you want.',
  { name: z.string(), taskIndex: z.number().int().min(0) },
  async ({ name, taskIndex }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const res = srvToggleTask(content, taskIndex);
    if (!res) throw new Error(`no checklist item at index ${taskIndex}`);
    await s.writeContent(f.id, res.text);
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'toggle_task', target: `tarea #${taskIndex} → ${res.checked ? '✓' : '☐'}`, where: `en ${f.name}` });
    return json({ ok: true, taskIndex, checked: res.checked });
  }),
);

// ── Versioning / snapshots ────────────────────────────────────────────────
// Snapshots are taken per-vault Y.Doc on the sync server. These tools are
// remote-only (need a sync server + token); they no-op in local file mode.
function srvResolveVaultId(s, vault) {
  if (!vault) return null;
  for (const f of s.listFiles({})) {
    if (f.vaultId === vault) return f.vaultId;
    if (String(s.vaultName(f.vaultId)).toLowerCase() === String(vault).toLowerCase()) return f.vaultId;
  }
  return vault; // assume the caller already passed a raw vaultId
}

server.tool(
  'list_snapshots',
  'List version snapshots of a vault\'s document (history / time-machine). '
  + 'Pass `vault` (name or id) to list that vault\'s snapshots; omit it to '
  + 'get every snapshot across the workspace grouped by document. Each entry '
  + 'has { id, ts, label, bytes } — feed `id` to restore_snapshot. Remote '
  + '(synced) workspaces only.',
  { vault: z.string().optional() },
  async ({ vault }) => withSession(async (s, cfg) => {
    if (!cfg || cfg.mode === 'local' || !cfg.server || !cfg.token) {
      throw new Error('list_snapshots needs a synced (remote) workspace — not available in local file mode');
    }
    const vaultId = srvResolveVaultId(s, vault);
    const data = await api.snapshots(cfg.server, cfg.token, cfg.workspaceId, vaultId);
    const fmt = (r) => ({ id: r.id, ts: r.ts, when: new Date(r.ts).toISOString(), label: r.label || null, bytes: r.bytes || null, documentName: r.document_name || data.documentName });
    if (Array.isArray(data.snapshots)) return json({ vault: vault || null, snapshots: data.snapshots.map(fmt) });
    return json({ workspaceId: data.workspaceId, snapshots: (data.snapshots || []).map(fmt) });
  }),
);

server.tool(
  'restore_snapshot',
  'Restore a vault to a previous snapshot (from list_snapshots). This merges '
  + 'the snapshot state back into the LIVE vault document, affecting ALL '
  + 'notes/canvases in that vault — not a single note. The server first '
  + 'auto-captures a "pre-restore" snapshot so the action is itself '
  + 'reversible. Remote (synced) workspaces only.',
  { snapshotId: z.number().int() },
  async ({ snapshotId }) => withSession(async (s, cfg) => {
    if (!cfg || cfg.mode === 'local' || !cfg.server || !cfg.token) {
      throw new Error('restore_snapshot needs a synced (remote) workspace — not available in local file mode');
    }
    const res = await api.restoreSnapshot(cfg.server, cfg.token, cfg.workspaceId, snapshotId);
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'restore_snapshot', target: `versión #${snapshotId}`, where: '' });
    return json({ ok: true, snapshotId, result: res });
  }),
);

server.tool(
  'export_note',
  'Export a note\'s content. `format`: "md" (raw markdown) or "html" '
  + '(rendered, self-contained document). If `path` is an absolute file '
  + 'path the content is written there and the path is returned; otherwise '
  + 'the content is returned inline so the caller can save it. For rich '
  + 'PDF export the user has an Export button in the app titlebar.',
  {
    name: z.string(),
    format: z.enum(['md', 'html']).optional(),
    path: z.string().optional(),
  },
  async ({ name, format, path }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const md = await s.readContent(f.id);
    const fmt = format || 'md';
    let content = md;
    if (fmt === 'html') {
      const { default: MarkdownIt } = await import('markdown-it');
      const mdit = new MarkdownIt({ html: false, linkify: true, breaks: false });
      const title = String(f.name).replace(/\.md$/i, '');
      // Misma hoja que la exportación de la app (avisos, desplegables,
      // propiedades bajo el título; comentarios edinot:* fuera).
      content = exportHtml.buildExportHtml(title, exportHtml.markdownToExportFragment(md, (x) => mdit.render(x)), null);
    }
    if (path) {
      if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) throw new Error('path must be absolute');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, content, 'utf8');
      s.publishMcpAction({ kind: 'mcp_tool', tool: 'export_note', target: `${f.name} → ${fmt}`, where: path });
      return json({ ok: true, note: f.name, format: fmt, path });
    }
    return json({ ok: true, note: f.name, format: fmt, bytes: content.length, content });
  }),
);

// ── Note properties + query + section + journal + undo ───────────────────
// Properties live in a hidden HTML comment so they don't render:
//   <!-- edinot:props status=open; priority=high; due=2026-06-10 -->
// The renderer strips edinot: comments, so this is invisible in the app.
const SRV_PROPS_RE = /^[ \t]*<!--\s*edinot:props\s+(.*?)\s*-->[ \t]*$/;
function srvParseProps(content) {
  const lines = String(content || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SRV_PROPS_RE);
    if (m) {
      const props = {};
      for (const part of m[1].split(';')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k) props[k] = v;
      }
      return { props, lineIdx: i };
    }
  }
  return { props: {}, lineIdx: -1 };
}
function srvSerializeProps(props) {
  const pairs = Object.entries(props)
    .filter(([k, v]) => k && v != null && String(v) !== '')
    .map(([k, v]) => `${k}=${String(v).replace(/[;\n]/g, ' ').trim()}`);
  return pairs.length ? `<!-- edinot:props ${pairs.join('; ')} -->` : null;
}
function srvWriteProps(content, props) {
  const lines = String(content || '').split('\n');
  const { lineIdx } = srvParseProps(content);
  const line = srvSerializeProps(props);
  if (lineIdx >= 0) {
    if (line) lines[lineIdx] = line; else lines.splice(lineIdx, 1);
  } else if (line) {
    const insertAt = (lines[0] && /^#\s/.test(lines[0].trim())) ? 1 : 0;
    lines.splice(insertAt, 0, line);
  }
  return lines.join('\n');
}
function srvReadSection(content, heading) {
  const lines = String(content || '').split('\n');
  const want = String(heading).trim().toLowerCase().replace(/^#+\s*/, '');
  let start = -1, level = 0, fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h && h[2].trim().toLowerCase() === want) { start = i; level = h[1].length; break; }
  }
  if (start < 0) return null;
  let end = lines.length; fenced = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = lines[i].match(/^(#{1,6})\s+/);
    if (h && h[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

server.tool(
  'get_note_properties',
  'Read a note\'s structured properties (hidden key:value metadata stored '
  + 'in an edinot:props comment — status, type, priority, due, etc.).',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const { props } = srvParseProps(await s.readContent(f.id));
    return json({ note: f.name, properties: props });
  }),
);

server.tool(
  'set_note_property',
  'Set (or delete) one structured property on a note. Stored in a hidden '
  + 'edinot:props comment so it never shows in the rendered note but is '
  + 'queryable via query_notes. Omit `value` (or pass "") to delete the key. '
  + 'Use for status/type/priority/due/owner-style metadata.',
  { name: z.string(), key: z.string(), value: z.string().optional() },
  async ({ name, key, value }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = await s.readContent(f.id);
    const { props } = srvParseProps(content);
    if (value == null || value === '') delete props[key];
    else props[key] = value;
    await s.writeContent(f.id, srvWriteProps(content, props));
    s.publishMcpAction({ kind: 'mcp_tool', tool: 'set_note_property', target: `${key}=${value || '∅'}`, where: `en ${f.name}` });
    return json({ ok: true, note: f.name, properties: props });
  }),
);

server.tool(
  'query_notes',
  'Query notes across a vault (or all vaults) by structured properties, '
  + 'tag and/or name. `where` matches edinot:props key=value (case-'
  + 'insensitive equality; use "*" as the value to require the key exists). '
  + '`tag` matches a #hashtag; `nameContains` is a substring on the note '
  + 'name. All filters AND together. Returns matching notes with their '
  + 'properties — the Dataview-style query for the AI.',
  {
    where: z.record(z.string()).optional(),
    tag: z.string().optional(),
    nameContains: z.string().optional(),
    vault: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  async ({ where, tag, nameContains, vault, limit }) => withSession(async (s) => {
    const wantTag = tag ? String(tag).replace(/^#/, '').toLowerCase() : null;
    const nameSub = nameContains ? String(nameContains).toLowerCase() : null;
    const out = [];
    for (const f of s.listFiles(vault ? { vault } : {})) {
      if (nameSub && !f.name.toLowerCase().includes(nameSub)) continue;
      const content = await scanBody(s, f.id);
      const { props } = srvParseProps(content);
      if (where && Object.keys(where).length) {
        let ok = true;
        for (const [k, v] of Object.entries(where)) {
          const pk = Object.keys(props).find(x => x.toLowerCase() === k.toLowerCase());
          if (pk == null) { ok = false; break; }
          if (v !== '*' && String(props[pk]).toLowerCase() !== String(v).toLowerCase()) { ok = false; break; }
        }
        if (!ok) continue;
      }
      if (wantTag) {
        const tags = srvExtractTags(content).map(x => x.toLowerCase());
        if (!tags.includes(wantTag)) continue;
      }
      out.push({ note: f.name, vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default', properties: props });
      if (limit && out.length >= limit) break;
    }
    return json({ count: out.length, notes: out });
  }),
);

server.tool(
  'read_section',
  'Read just one section of a note: the given heading and everything under '
  + 'it up to the next heading of the same or higher level. Pair with '
  + 'get_outline to read a long note cheaply without dumping the whole body. '
  + '`heading` is matched case-insensitively (with or without leading #).',
  { name: z.string(), heading: z.string() },
  async ({ name, heading }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const section = srvReadSection(await s.readContent(f.id), heading);
    if (section == null) throw new Error(`heading not found: '${heading}' — call get_outline to see available headings`);
    return json({ note: f.name, heading, content: section });
  }),
);

server.tool(
  'get_or_create_daily_note',
  'Get (or create) a date-stamped daily note for journaling / logging. '
  + 'Name is the ISO date (YYYY-MM-DD); defaults to today. Pass `vault` '
  + 'and/or `folder` to place it (folder must exist). Returns the note '
  + 'content so you can append the day\'s log.',
  { vault: z.string().optional(), folder: z.string().optional(), date: z.string().optional() },
  async ({ vault, folder, date }) => withSession(async (s) => {
    // Fecha LOCAL (no UTC): la app («Hoy» en la barra lateral) busca la
    // misma nota y entre medianoche y la hora UTC ambas no coincidían.
    const now = new Date();
    const d = date ? String(date).trim() : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('date must be YYYY-MM-DD');
    let f = s.findFileByName(d);
    let created = false;
    if (!f) {
      f = await s.createFile(d, vault || 'default', folder || null);
      await s.writeContent(f.id, `# ${d}\n\n`);
      created = true;
    }
    const content = await s.readContent(f.id);
    s.publishMcpAction({ kind: created ? 'create' : 'mcp_tool', tool: 'get_or_create_daily_note', note: f.name, noteId: f.id, target: `diario ${d}`, where: s.vaultName(f.vaultId), vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default' });
    return json({ ok: true, created, name: f.name, vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default', content });
  }),
);

server.tool(
  'undo_edit',
  'Best-effort revert of YOUR most recent edit to a note. Currently undoes '
  + 'a short append (removes the appended text if it is still at the end). '
  + 'For larger rewrites or anything it cannot reverse it errors and points '
  + 'you at restore_snapshot (the full time machine).',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const edits = s.getRecentEdits({ noteId: f.id, limit: 5 }) || [];
    const last = edits[0];
    if (!last) throw new Error('no recent edit recorded for this note');
    if (last.kind === 'append' && last.appended) {
      const content = await s.readContent(f.id);
      const app = String(last.appended).trimEnd();
      if (app && content.trimEnd().endsWith(app)) {
        const idx = content.lastIndexOf(app);
        const next = content.slice(0, idx).replace(/\n+$/, '\n');
        await s.writeContent(f.id, next);
        s.publishMcpAction({ kind: 'mcp_tool', tool: 'undo_edit', target: 'deshacer append', where: `en ${f.name}` });
        return json({ ok: true, undone: 'append', note: f.name });
      }
      throw new Error('append no longer at end of note (changed since) — use restore_snapshot');
    }
    throw new Error(`cannot auto-undo a '${last.kind}' edit — use list_snapshots + restore_snapshot for a full revert`);
  }),
);

// ── Canvas operations ─────────────────────────────────────────────────────
// Canvas data lives inside a fenced ```edinot-canvas``` block. The block
// contains JSON with `nodes`, `edges` and `groups`. Same storage as the
// app, so MCP edits show up live in any open Edinot window.

const CANVAS_FENCE_RE_LINE = /^[ \t]*```edinot-canvas[ \t]*$/;
const CANVAS_FENCE_END_RE = /^[ \t]*```\s*$/;

function findCanvasBlock(text) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (CANVAS_FENCE_RE_LINE.test(lines[i])) {
      let end = -1;
      const buf = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (CANVAS_FENCE_END_RE.test(lines[j])) { end = j; break; }
        buf.push(lines[j]);
      }
      if (end < 0) continue;
      let json = { nodes: [], edges: [], groups: [] };
      const body = buf.join('\n').trim();
      if (body) {
        try { const p = JSON.parse(body); if (p && typeof p === 'object') {
          // Conservar TODO el bloque (anotaciones = dibujos y formas, y
          // cualquier otra clave): antes solo se leían nodes/edges/groups y
          // cualquier escritura del MCP borraba los dibujos del canvas.
          json = {
            ...p,
            nodes: Array.isArray(p.nodes) ? p.nodes : [],
            edges: Array.isArray(p.edges) ? p.edges : [],
            groups: Array.isArray(p.groups) ? p.groups : [],
            ...(Array.isArray(p.annotations) ? { annotations: p.annotations } : {}),
          };
        } } catch {}
      }
      return { json, startLine: i, endLine: end, lines };
    }
  }
  return null;
}

function newCanvasId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// Sticky-note pastel palette — mirrors CANVAS_STICKY_COLORS in editor.jsx.
const CANVAS_STICKY_COLORS = ['#f3d27a', '#f8b4ab', '#b5dfa4', '#a9cfe8', '#d5bde9', '#f9c98d', '#e8e3c8'];

// Extract a YouTube video id from common URL shapes, so an MCP-added url tile
// becomes an embedded video node (parity with the app's paste/drop behaviour).
function ytId(url) {
  const s = String(url || '');
  let m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function ensureCanvas(s, name) {
  const f = s.findFileByName(name);
  if (!f) throw new Error(`note not found: ${name}`);
  const content = await s.readContent(f.id);
  const block = findCanvasBlock(content);
  if (!block) throw new Error(`'${name}' has no edinot-canvas block — create one first with create_canvas`);
  // Co-edición (Fase 1): once a canvas is migrated to the structured Yjs
  // model, the fence is only a derived mirror (possibly debounced), so compute
  // from the live structure. Writes go back via s.canvasCommit, which mutates
  // the structure when migrated and regenerates the mirror.
  if (s.isCanvasMigrated && (await s.isCanvasMigrated(f.id))) {
    const snap = await s.canvasSnapshot(f.id);
    block.json = {
      nodes: Array.isArray(snap.nodes) ? snap.nodes : [],
      edges: Array.isArray(snap.edges) ? snap.edges : [],
      groups: Array.isArray(snap.groups) ? snap.groups : [],
      annotations: Array.isArray(snap.annotations) ? snap.annotations : [],
    };
  }
  return { f, content, block };
}

server.tool(
  'list_canvases',
  'List every note that contains at least one edinot-canvas fenced block. '
  + 'Returns { name, vault, nodes, edges, groups } counts so an agent can '
  + 'pick the right canvas before mutating it.',
  {},
  async () => withSession(async (s) => {
    const out = [];
    for (const f of s.listFiles({})) {
      const c = await scanBody(s, f.id);
      const b = findCanvasBlock(c);
      if (!b) continue;
      out.push({
        name: f.name,
        vault: s.vaultName(f.vaultId),
        vaultId: f.vaultId || 'default',
        nodes: b.json.nodes.length,
        edges: b.json.edges.length,
        groups: b.json.groups.length,
      });
    }
    return json(out);
  }),
);

// Parse a markdown outline (#/##/### headings + - * + bullets) into a
// hierarchical list of (text, depth, parentIdx) entries. Used by
// canvas_from_text to build a mind-map without the LLM having to compute
// coordinates itself.
function parseOutline(markdown) {
  const lines = String(markdown || '').split('\n');
  const items = [];
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      const depth = h[1].length;
      items.push({ text: h[2].trim(), depth, kind: 'heading' });
      continue;
    }
    const b = line.match(/^(\s*)[-*+]\s+(.+?)\s*$/);
    if (b) {
      const indent = b[1].length;
      // Heading depth tops out at 6; treat the deepest heading we've seen
      // as the "root depth" for bullets so the tree stays connected.
      const lastHeadingDepth = items.reduce((d, it) => it.kind === 'heading' ? it.depth : d, 0);
      const depth = lastHeadingDepth + 1 + Math.floor(indent / 2);
      items.push({ text: b[2].trim(), depth, kind: 'bullet' });
    }
  }
  // Pass 2: resolve each item's parent index by walking the depth stack.
  const stack = []; // [{depth, idx}]
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    while (stack.length && stack[stack.length - 1].depth >= it.depth) stack.pop();
    it.parentIdx = stack.length ? stack[stack.length - 1].idx : -1;
    stack.push({ depth: it.depth, idx: i });
  }
  return items;
}

// Lay out a tree in a left→right radial spread. Root at (0,0). Children
// distributed along an arc whose width grows with subtree size so leaves
// don't overlap. Returns a map of idx → {x, y}.
function layoutTree(items) {
  // Build children lookup.
  const children = items.map(() => []);
  const roots = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].parentIdx < 0) roots.push(i);
    else children[items[i].parentIdx].push(i);
  }
  // Count descendants for sizing.
  const subtree = items.map(() => 1);
  function countDesc(i) {
    let total = 1;
    for (const c of children[i]) total += countDesc(c);
    subtree[i] = total;
    return total;
  }
  for (const r of roots) countDesc(r);

  const COL_W = 280;
  const ROW_H = 110;
  const pos = new Array(items.length);

  // Vertical spread per root, then each child column to the right.
  function layoutSubtree(idx, x, yTop) {
    const childIds = children[idx];
    if (!childIds.length) {
      pos[idx] = { x, y: yTop };
      return ROW_H;
    }
    let used = 0;
    for (const c of childIds) {
      used += layoutSubtree(c, x + COL_W, yTop + used);
    }
    // Center this node vertically across its children.
    const childPositions = childIds.map(c => pos[c].y);
    const center = (Math.min(...childPositions) + Math.max(...childPositions)) / 2;
    pos[idx] = { x, y: center };
    return Math.max(used, ROW_H);
  }
  let rootY = 0;
  for (const r of roots) {
    const h = layoutSubtree(r, 0, rootY);
    rootY += h + ROW_H * 0.5;
  }
  return pos;
}

server.tool(
  'canvas_from_text',
  'Turn a markdown outline into a mind-map canvas in one shot. Parses '
  + 'headings (#, ##, ###…) and bullet lists (- * +) into a parent/child '
  + 'tree, places one text node per item, and connects parents to children '
  + 'with edges labelled by depth. Layout is left→right radial — root at '
  + 'the left, descendants fanning out so leaves don\'t overlap. Use this '
  + 'when the user asks for "a mind-map of X", or after structuring a '
  + 'plan in chat. Fails if a note with `name` already exists. AFTER '
  + 'calling, chain `focus_note` and (optional) `present_in_canvas` to '
  + 'narrate the structure.',
  {
    name: z.string(),
    outline: z.string().min(1),
    vault: z.string().optional(),
    folder: z.string().optional(),
  },
  async ({ name, outline, vault, folder }) => withSession(async (s) => {
    if (s.findFileByName(name)) throw new Error(`already exists: ${name}`);
    const items = parseOutline(outline);
    if (!items.length) throw new Error('outline produced 0 items — pass headings (#) and/or bullets (-).');
    const pos = layoutTree(items);
    const ids = items.map(() => newCanvasId('n'));
    const NODE_W = 220;
    const NODE_H = 80;
    const nodes = items.map((it, i) => ({
      id: ids[i],
      kind: 'text',
      text: it.text,
      x: pos[i].x,
      y: pos[i].y,
      w: NODE_W,
      h: NODE_H,
    }));
    const edges = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].parentIdx >= 0) {
        edges.push({ from: ids[items[i].parentIdx], to: ids[i], kind: 'manual' });
      }
    }
    const payload = { nodes, edges, groups: [] };
    const cleanName = String(name).replace(/\.(md|markdown|txt)$/i, '');
    const body = `# ${cleanName}\n\n\`\`\`edinot-canvas\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
    const f = await s.createFile(name, vault || 'default', folder || null);
    await s.writeContent(f.id, body);
    s.publishMcpAction({
      kind: 'canvas_create',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      nodes: nodes.length, edges: edges.length,
    });
    return json(withHints({
      ok: true, id: f.id, name: f.name,
      vault: s.vaultName(f.vaultId),
      nodes: nodes.length, edges: edges.length,
      rootIds: items.map((it, i) => it.parentIdx < 0 ? ids[i] : null).filter(Boolean),
    }, [
      { tool: 'focus_note', args: { name: f.name }, reason: 'open the new mind-map canvas in the user window' },
      { tool: 'present_in_canvas', args: { name: f.name, steps: [{ nodeId: ids[0], message: '<root summary>' }] }, reason: 'narrate the structure node-by-node' },
    ]));
  }),
);

server.tool(
  'create_canvas',
  'Create a new note whose body is a canvas. Fails if a note with that name '
  + 'already exists. The canvas starts empty unless `nodes` / `edges` / '
  + '`groups` are provided. Place in a folder via `folder` (existing path). '
  + 'AFTER calling this, chain `focus_note` so the user sees the canvas. '
  + 'When the canvas already has nodes, follow with `focus_canvas_node` '
  + '(single key node) or `present_in_canvas` (multi-step walk-through).',
  {
    name: z.string(),
    vault: z.string().optional(),
    folder: z.string().optional(),
    nodes: z.array(z.any()).optional(),
    edges: z.array(z.any()).optional(),
    groups: z.array(z.any()).optional(),
  },
  async ({ name, vault, folder, nodes, edges, groups }) => withSession(async (s) => {
    if (s.findFileByName(name)) throw new Error(`already exists: ${name}`);
    const payload = {
      nodes: Array.isArray(nodes) ? nodes : [],
      edges: Array.isArray(edges) ? edges : [],
      groups: Array.isArray(groups) ? groups : [],
    };
    const cleanName = String(name).replace(/\.(md|markdown|txt)$/i, '');
    const body = `# ${cleanName}\n\n\`\`\`edinot-canvas\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
    const f = await s.createFile(name, vault || 'default', folder || null);
    await s.writeContent(f.id, body);
    s.publishMcpAction({
      kind: 'canvas_create',
      note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
    });
    return json(withHints(
      { ok: true, id: f.id, name: f.name, vault: s.vaultName(f.vaultId) },
      [
        { tool: 'focus_note', args: { name: f.name }, reason: 'open the canvas in the user window' },
        { tool: 'focus_canvas_node', args: { name: f.name, nodeId: '<one node id>' }, reason: 'point at the single key node when there is a clear answer' },
        { tool: 'present_in_canvas', args: { name: f.name, steps: [{ nodeId: '<id>', message: '<why>' }] }, reason: 'narrate ≥2 nodes in logical order' },
      ]
    ));
  }),
);

server.tool(
  'read_canvas',
  'Return the full canvas JSON of a note: { nodes, edges, groups }. Use '
  + 'this to inspect the current layout before mutating it. A node with '
  + "kind 'page' is the note's own page shown as a block on its canvas (Page/Canvas "
  + 'switch): it only holds where it sits and its size; its text is the note body '
  + '(edit it with the note tools). Move it like any node; do not delete it.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const { block } = await ensureCanvas(s, name);
    // Inline image nodes as visible image blocks so the model SEES them, not
    // just their sha/url (mirrors read_note). image + image-attachment nodes.
    const imgRefs = (block.json.nodes || [])
      .filter(n => n && (n.kind === 'image' || n.kind === 'attachment'))
      .map(n => n.sha ? `edinot://blob/${n.sha}` : (n.url || ''))
      .filter(Boolean)
      .join('\n');
    const images = await imageBlocksForContent(imgRefs);
    return { content: [{ type: 'text', text: JSON.stringify(block.json, null, 2) }, ...images] };
  }),
);

server.tool(
  'add_canvas_node',
  'Append a node to the canvas. `kind`: note | text | url | image | video | query | attachment. '
  + 'A YouTube `url` (with kind url or video) becomes an embedded player. '
  + 'For `note` pass `noteName` (and we store both noteName + noteId so the '
  + 'tile survives renames). For `image` pass ONE of: `path` (absolute image '
  + 'file on this computer — preferred), `url` (http/https image), `sha` (an '
  + 'existing blob from attach_image) or `data` (base64 — small images only, '
  + 'long base64 gets cut off). For '
  + '`attachment` (PDF, Office, zip, any file — renders as a preview card) '
  + 'pass `path`, `data` or `url` plus `filename` (the extension drives the '
  + 'preview), or an existing `sha`. x/y/w/h are world coords; sensible '
  + 'defaults used when omitted. Returns the assigned `id` so callers can '
  + 'chain edges. When you have finished placing nodes, call '
  + '`focus_canvas_node` on the most important one, `present_in_canvas` to '
  + 'walk node by node, or `present_canvas_groups` for a group slideshow — '
  + 'do not leave the user staring at a static board.',
  {
    name: z.string(),
    kind: z.enum(['note', 'text', 'url', 'image', 'video', 'query', 'attachment']),
    noteName: z.string().optional(),
    text: z.string().optional(),
    url: z.string().optional(),
    sha: z.string().optional(),
    path: z.string().optional(),
    data: z.string().optional(),
    filename: z.string().optional(),
    mime: z.string().optional(),
    query: z.string().optional(),
    sticky: z.boolean().optional().describe('kind=text only: render as a pastel sticky note (square, centered auto-sized text). Great for brainstorms — see add_canvas_stickies for batches.'),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    color: z.string().optional(),
  },
  async ({ name, kind, noteName, text, url, sha, path: filePath, data, filename, mime, query, sticky, x, y, w, h, color }) => withSession(async (s) => {
    // Resolve data/url into an uploaded blob (same pipeline as attach_image).
    const uploadBlobInput = async (fallbackName) => {
      const cfg = resolveCfg();
      if (!cfg || cfg.mode === 'local' || !cfg.token || !cfg.server) {
        throw new Error('blob upload requires a synced (non-local) workspace — pass `sha` of an existing blob instead');
      }
      const input = await readUploadInput({ path: filePath, data, url, mime });
      if (!input) throw new Error(`kind=${kind} needs sha, path, data (base64) or url`);
      const buffer = input.buffer;
      let finalMime = input.mime;
      if (kind === 'image' || sniffImageMime(buffer)) finalMime = assertWholeImage(input) || finalMime;
      const fname = filename || input.name || fallbackName;
      const res = await api.blobUpload(cfg.server, cfg.token, { buffer, mime: finalMime || 'application/octet-stream', filename: fname });
      return { sha: res.id, mime: finalMime || 'application/octet-stream', size: buffer.length, name: fname };
    };
    const { f, content, block } = await ensureCanvas(s, name);
    const id = newCanvasId('n');
    const node = { id, kind, x: x != null ? x : 80, y: y != null ? y : 80, w: w || 240, h: h || 140 };
    if (color) node.color = color;
    if (kind === 'note') {
      if (!noteName) throw new Error('add_canvas_node kind=note needs noteName');
      const target = s.findFileByName(noteName);
      if (!target) throw new Error(`note not found: ${noteName}`);
      node.noteId = target.id;
      node.noteName = target.name.replace(/\.(md|markdown|txt)$/i, '');
    } else if (kind === 'text') {
      node.text = text || '';
      if (sticky) {
        node.sticky = true;
        if (!color) node.color = CANVAS_STICKY_COLORS[0];
        if (w == null) node.w = 180;
        if (h == null) node.h = 180;
      }
    } else if (kind === 'url' || kind === 'video') {
      node.url = url || '';
      const yt = ytId(url);
      const vm = String(url || '').match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (yt) {
        node.kind = 'video'; node.provider = 'youtube'; node.videoId = yt;
        node.title = node.title || 'YouTube';
        if (w == null) node.w = 360;
        if (h == null) node.h = 220;
      } else if (vm) {
        node.kind = 'video'; node.provider = 'vimeo'; node.videoId = vm[1];
        node.title = node.title || 'Vimeo';
        if (w == null) node.w = 360;
        if (h == null) node.h = 220;
      } else if (/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(String(url || ''))) {
        // Direct media file → native <video> tile in the app.
        node.kind = 'video'; node.provider = 'file';
        node.title = node.title || 'Video';
        if (w == null) node.w = 360;
        if (h == null) node.h = 220;
      } else if (kind === 'video') {
        // A non-embeddable video URL still renders via the video tile's fallback.
        node.title = node.title || 'Video';
      }
    } else if (kind === 'image') {
      if (sha) node.sha = sha;
      else node.sha = (await uploadBlobInput('imagen.png')).sha;
      if (w == null) node.w = 280;
      if (h == null) node.h = 210;
    } else if (kind === 'attachment') {
      // Same node shape the editor's drop handler creates, so the
      // CanvasAttachmentPreview renders it identically.
      const up = sha
        ? { sha, mime: mime || '', size: 0, name: filename || 'adjunto' }
        : await uploadBlobInput('adjunto');
      node.name = up.name;
      node.sha = up.sha;
      node.url = `edinot://blob/${up.sha}`;
      node.mime = up.mime;
      node.size = up.size;
      if (w == null) node.w = 260;
      if (h == null) node.h = 145;
    } else if (kind === 'query') {
      node.query = query || '';
    }
    const next = { ...block.json, nodes: [...block.json.nodes, node] };
    await s.canvasCommit(f.id, next, { content, block });
    s.publishMcpAction({ kind: 'canvas_add_node', note: f.name, noteId: f.id, vault: s.vaultName(f.vaultId), nodeKind: kind, nodeId: id });
    return json(withHints(
      { ok: true, id, node },
      [
        { tool: 'focus_canvas_node', args: { name: f.name, nodeId: id }, reason: 'point at the node you just added so the user notices the change' },
      ]
    ));
  }),
);

server.tool(
  'add_canvas_stickies',
  'Batch-add sticky notes to a canvas — THE tool for brainstorms: one call '
  + 'drops N pastel stickies at once. Each item is { text, color?, x?, y? }. '
  + 'Items without x/y are auto-placed in a grid below the existing content '
  + '(or at originX/originY when given). Colors default to the sticky pastel '
  + 'palette; pass a color per item to theme clusters. Returns the ids in '
  + 'input order so you can connect or group them afterwards. Finish by '
  + 'calling focus_canvas_node or present_in_canvas so the user sees the '
  + 'result.',
  {
    name: z.string(),
    stickies: z.array(z.object({
      text: z.string(),
      color: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    })).min(1).max(100),
    originX: z.number().optional(),
    originY: z.number().optional(),
    columns: z.number().int().min(1).max(20).optional(),
  },
  async ({ name, stickies, originX, originY, columns }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const SIZE = 180, GAP = 20;
    // Default origin: below everything already on the board so nothing overlaps.
    let ox = originX != null ? originX : 80;
    let oy = originY;
    if (oy == null) {
      const nodes = block.json.nodes || [];
      oy = nodes.length
        ? Math.max(...nodes.map(n => (n.y || 0) + (n.h || 140))) + 60
        : 80;
    }
    const cols = columns || Math.max(1, Math.ceil(Math.sqrt(stickies.length)));
    let autoIdx = 0;
    const created = stickies.map((it) => {
      const node = {
        id: newCanvasId('n'),
        kind: 'text', sticky: true,
        text: it.text || '',
        color: it.color || CANVAS_STICKY_COLORS[0],
        w: SIZE, h: SIZE,
      };
      if (it.x != null && it.y != null) {
        node.x = it.x; node.y = it.y;
      } else {
        node.x = ox + (autoIdx % cols) * (SIZE + GAP);
        node.y = oy + Math.floor(autoIdx / cols) * (SIZE + GAP);
        autoIdx++;
      }
      return node;
    });
    const next = { ...block.json, nodes: [...block.json.nodes, ...created] };
    await s.canvasCommit(f.id, next, { content, block });
    s.publishMcpAction({ kind: 'canvas_add_node', note: f.name, noteId: f.id, vault: s.vaultName(f.vaultId), nodeKind: 'sticky', count: created.length });
    return json(withHints(
      { ok: true, ids: created.map(n => n.id), nodes: created },
      [
        { tool: 'focus_canvas_node', args: { name: f.name, nodeId: created[0].id }, reason: 'show the user the fresh stickies' },
        { tool: 'connect_canvas_nodes', reason: 'link related stickies if the brainstorm has structure' },
      ]
    ));
  }),
);

server.tool(
  'move_canvas_node',
  'Move / resize an existing canvas node by id. Pass any subset of x, y, w, h.',
  {
    name: z.string(),
    nodeId: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  },
  async ({ name, nodeId, x, y, w, h }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const nodes = block.json.nodes.map(n => n.id === nodeId
      ? { ...n, ...(x != null ? { x } : {}), ...(y != null ? { y } : {}), ...(w != null ? { w } : {}), ...(h != null ? { h } : {}) }
      : n);
    if (!nodes.find(n => n.id === nodeId)) throw new Error(`node not found: ${nodeId}`);
    await s.canvasCommit(f.id, { ...block.json, nodes }, { content, block });
    return json({ ok: true });
  }),
);

server.tool(
  'connect_canvas_nodes',
  'Add a manual edge (connector) between two canvas elements. `from`/`to` are node ids '
  + 'OR annotation-shape ids (rect/ellipse/diamond drawn on the canvas), so shapes can be '
  + 'connected too. Each edge gets a stable `id`; several edges between the same pair are '
  + 'allowed as long as they are not identical (same endpoints AND same anchors). '
  + 'Optional styling: `label`, `color`, `route` (curved | straight | ortho = right-angle, '
  + 'auto-routed around other nodes), `start_head`/`end_head` (none | arrow | triangle | '
  + 'circle | diamond; default: arrow at the end) and `from_side`/`to_side` (t | r | b | l) to '
  + 'pin the connector to the middle of that side instead of the automatic border point. '
  + 'Backlink edges from `[[wikilink]]`s in note bodies are computed live by the app and '
  + 'never need to be stored.',
  {
    name: z.string(),
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
    color: z.string().optional(),
    route: z.enum(['curved', 'straight', 'ortho']).optional(),
    start_head: z.enum(['none', 'arrow', 'triangle', 'circle', 'diamond']).optional(),
    end_head: z.enum(['none', 'arrow', 'triangle', 'circle', 'diamond']).optional(),
    from_side: z.enum(['t', 'r', 'b', 'l']).optional(),
    to_side: z.enum(['t', 'r', 'b', 'l']).optional(),
  },
  async ({ name, from, to, label, color, route, start_head, end_head, from_side, to_side }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    if (from === to) throw new Error('edge would be a self-loop');
    const known = (id) => block.json.nodes.some(n => n.id === id) || (block.json.annotations || []).some(a => a.id === id);
    if (!known(from)) throw new Error(`from element not found (node or annotation id): ${from}`);
    if (!known(to)) throw new Error(`to element not found (node or annotation id): ${to}`);
    const edges = block.json.edges || [];
    if (edges.some(e => e.from === from && e.to === to && (e.fromSide || '') === (from_side || '') && (e.toSide || '') === (to_side || '')
      && (e.route || '') === (route || '') && (e.label || '') === (label || ''))) {
      throw new Error('an identical edge already exists (same endpoints, anchors, route and label)');
    }
    const edge = { id: canvasEdgeId(), from, to, kind: 'manual' };
    if (label) edge.label = label;
    if (color) edge.color = color;
    if (route) edge.route = route;
    if (start_head) edge.startHead = start_head;
    if (end_head) edge.endHead = end_head;
    if (from_side) edge.fromSide = from_side;
    if (to_side) edge.toSide = to_side;
    await s.canvasCommit(f.id, { ...block.json, edges: [...edges, edge] }, { content, block });
    return json({ ok: true, edge });
  }),
);

server.tool(
  'draw_freehand_on_canvas',
  'Draw an SVG path annotation overlay on the canvas — arrows, circles, '
  + 'underlines, hand-drawn callouts. Persists in the canvas JSON\'s '
  + '`annotations[]` so it survives reloads. `d` is an SVG path data '
  + 'string in canvas world coords ("M 120 80 L 240 80 L 220 60 M 240 80 '
  + 'L 220 100" for an arrow). `color` defaults to ámbar; `strokeWidth` '
  + 'defaults to 2.5 world px; `opacity` 0.85. Optional `label` + '
  + 'labelX/labelY paints text near the path. Use AFTER add_canvas_node + '
  + 'connect_canvas_nodes when you want to add a visual cue the user '
  + 'reads as "look, the AI marked this". For multi-step animated '
  + 'transformations use `canvas_animate` instead.',
  {
    name: z.string(),
    d: z.string().min(1),
    color: z.string().optional(),
    strokeWidth: z.number().min(0.5).max(20).optional(),
    opacity: z.number().min(0).max(1).optional(),
    fill: z.string().optional(),
    label: z.string().max(80).optional(),
    labelX: z.number().optional(),
    labelY: z.number().optional(),
  },
  async ({ name, d, color, strokeWidth, opacity, fill, label, labelX, labelY }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const id = newCanvasId('ann');
    const ann = { id, kind: 'path', d };
    if (color) ann.color = color;
    if (strokeWidth != null) ann.strokeWidth = strokeWidth;
    if (opacity != null) ann.opacity = opacity;
    if (fill) ann.fill = fill;
    if (label) { ann.label = label; if (labelX != null) ann.labelX = labelX; if (labelY != null) ann.labelY = labelY; }
    const annotations = Array.isArray(block.json.annotations) ? block.json.annotations : [];
    const next = { ...block.json, annotations: [...annotations, ann] };
    await s.canvasCommit(f.id, next, { content, block });
    s.publishMcpAction({ kind: 'canvas_annotate', note: f.name, noteId: f.id, vault: s.vaultName(f.vaultId), annotationId: id });
    return json(withHints({ ok: true, id, annotation: ann }, [
      { tool: 'focus_note', args: { name: f.name }, reason: 'open the canvas so the user sees the annotation you just drew' },
    ]));
  }),
);

server.tool(
  'add_canvas_shape',
  'Add a vector shape annotation to a canvas: rect, ellipse, diamond, triangle, '
  + 'star, hexagon, cylinder, cloud, callout (speech bubble), line or arrow. '
  + 'Persists in the canvas JSON `annotations[]`. For every closed shape '
  + '(all but line/arrow) pass x,y,w,h (canvas world coords); for line/arrow pass x1,y1,x2,y2. `text` '
  + 'adds centred text inside closed shapes; `rot` rotates them (degrees). '
  + '`color` default #1f2937, `strokeWidth` 2, `fill` "none", `opacity` 1. '
  + 'Use this for diagram boxes/connectors the user reads as structure; for '
  + 'free-form ink use draw_freehand_on_canvas.',
  {
    name: z.string(),
    shape: z.enum(['rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'cylinder', 'cloud', 'callout', 'line', 'arrow']),
    x: z.number().optional(), y: z.number().optional(),
    w: z.number().optional(), h: z.number().optional(),
    x1: z.number().optional(), y1: z.number().optional(),
    x2: z.number().optional(), y2: z.number().optional(),
    color: z.string().optional(),
    strokeWidth: z.number().min(0.5).max(40).optional(),
    fill: z.string().optional(),
    opacity: z.number().min(0).max(1).optional(),
    text: z.string().max(200).optional(),
    rot: z.number().optional(),
  },
  async ({ name, shape, x, y, w, h, x1, y1, x2, y2, color, strokeWidth, fill, opacity, text, rot }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const id = newCanvasId('ann');
    const ann = { id, kind: 'shape', shape };
    if (shape === 'line' || shape === 'arrow') {
      if ([x1, y1, x2, y2].some(v => v == null)) throw new Error('add_canvas_shape line/arrow needs x1,y1,x2,y2');
      ann.x1 = x1; ann.y1 = y1; ann.x2 = x2; ann.y2 = y2;
      ann.bbox = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    } else {
      if ([x, y, w, h].some(v => v == null)) throw new Error(`add_canvas_shape ${shape} needs x,y,w,h`);
      ann.x = x; ann.y = y; ann.w = w; ann.h = h;
      ann.bbox = { x, y, w, h };
      ann.fill = fill || 'none';
      if (text) ann.text = text;
      if (rot != null) ann.rot = rot;
    }
    ann.color = color || '#1f2937';
    ann.strokeWidth = strokeWidth != null ? strokeWidth : 2;
    if (opacity != null) ann.opacity = opacity;
    const annotations = Array.isArray(block.json.annotations) ? block.json.annotations : [];
    const next = { ...block.json, annotations: [...annotations, ann] };
    await s.canvasCommit(f.id, next, { content, block });
    s.publishMcpAction({ kind: 'canvas_annotate', note: f.name, noteId: f.id, vault: s.vaultName(f.vaultId), annotationId: id });
    return json(withHints({ ok: true, id, annotation: ann }, [
      { tool: 'focus_note', args: { name: f.name }, reason: 'open the canvas so the user sees the shape you just added' },
    ]));
  }),
);

server.tool(
  'list_canvas_annotations',
  'List every SVG annotation overlay currently on a canvas. Returns the '
  + '`id`, `d` and style fields for each — use before `delete_canvas_annotation` '
  + 'so you can pick the right one.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const { block } = await ensureCanvas(s, name);
    const items = Array.isArray(block.json.annotations) ? block.json.annotations : [];
    return json({ count: items.length, annotations: items });
  }),
);

server.tool(
  'delete_canvas_annotation',
  'Remove an SVG annotation from a canvas by id.',
  { name: z.string(), annotationId: z.string() },
  async ({ name, annotationId }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const before = Array.isArray(block.json.annotations) ? block.json.annotations : [];
    const annotations = before.filter(a => a.id !== annotationId);
    if (annotations.length === before.length) throw new Error(`annotation not found: ${annotationId}`);
    await s.canvasCommit(f.id, { ...block.json, annotations }, { content, block });
    return json({ ok: true, removed: annotationId });
  }),
);

server.tool(
  'delete_canvas_node',
  'Delete a node (and any edges that reference it) from the canvas.',
  { name: z.string(), nodeId: z.string() },
  async ({ name, nodeId }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const nodes = block.json.nodes.filter(n => n.id !== nodeId);
    const edges = (block.json.edges || []).filter(e => e.from !== nodeId && e.to !== nodeId);
    await s.canvasCommit(f.id, { ...block.json, nodes, edges }, { content, block });
    return json({ ok: true, removed: nodeId });
  }),
);

server.tool(
  'get_active_context',
  'Snapshot of what the user is currently looking at: active note (with its '
  + 'vault, folder path and whether it\'s a canvas), active vault, and whether '
  + 'the Edinot app is open. Use this before suggesting an action so you can '
  + 'reference what the user already has in front of them ("you\'re on note '
  + 'X — want me to add a row?") instead of guessing. '
  + 'CALL THIS FIRST whenever the user says "here", "in this folder", "next '
  + 'to this note" or otherwise refers to the current location — then pass '
  + '`activeNote.vault` and `activeNote.folderPath` to create_note / write_note '
  + 'so the new note lands where the user expects. '
  + 'Response also includes: `pinnedContext` (fragments the user flagged as '
  + 'always-relevant — treat as hard constraints) AND `pendingReplies` '
  + '(answers the user typed into ask_inline questions you haven\'t acted on '
  + 'yet — MCP can\'t push, so check this every turn). After handling a '
  + 'reply, call resolve_comment or delete_comment so it stops appearing. '
  + 'When `pendingAgentTasks` contains tasks for your alias, claim and complete '
  + 'them before unrelated work.',
  {},
  async () => withSession(async (s, cfg) => {
    const ctx = await s.getActiveContext();
    const identity = currentAgentIdentity(cfg);
    const pendingAgentTasks = (ctx.pendingAgentTasks || [])
      .filter(t => String(t.targetAlias || '').toLowerCase() === identity.alias);
    let pinned = [];
    try { pinned = s.listPinnedContext() || []; } catch {}
    return json({
      ...ctx,
      agent: identity,
      pendingAgentTasks,
      pinnedContext: pinned,
      pinnedCount: pinned.length,
      pendingRepliesCount: (ctx.pendingReplies || []).length,
      pendingAgentTasksCount: pendingAgentTasks.length,
    });
  }),
);

server.tool(
  'get_recent_notes',
  'List notes the user has opened most recently, scored by a composite of '
  + 'open count + recency (30-day window). Same ranking the in-app search '
  + 'uses. `limit` caps the result (default 20, max 100). Useful for '
  + '"what was I working on?" and for prioritising suggestions toward what '
  + 'the user actually touches.',
  { limit: z.number().int().min(1).max(100).optional() },
  async ({ limit }) => withSession(async (s) => json(s.getRecentNotes(limit))),
);

server.tool(
  'get_canvas_selection',
  'Return the canvas node(s) the user currently has selected. Returns '
  + '`{ noteName, nodeIds, nodes }` (with each node\'s full payload — kind, '
  + 'text/url/noteName, x/y/w/h) or null if nothing is selected. Use to "do '
  + 'something with this node" requests inside a canvas ("connect these two", '
  + '"summarise this note tile", "add a child group").',
  {},
  async () => withSession(async (s) => {
    const sel = await s.getCanvasSelection();
    return json(sel || { nodeIds: null, note: 'no canvas selection' });
  }),
);

server.tool(
  'get_editor_selection',
  'Return the text the user currently has selected in the active note\'s '
  + 'editor (broadcast via Y.js awareness). Returns `{ text, fromCh, toCh }` '
  + 'or null if there\'s no selection. Use to "do something with this" type '
  + 'requests ("summarise this", "translate this", "explain this snippet") '
  + 'so the AI operates on the actual selection rather than asking the user '
  + 'to paste it.',
  {},
  async () => withSession(async (s) => {
    const sel = await s.getEditorSelection();
    return json(sel || { text: null, note: 'no active selection' });
  }),
);

server.tool(
  'wait_for_selection_change',
  'Long-poll until the user picks something (or the timeout elapses). Use '
  + 'to build interactive workflows: ask the user a question that requires '
  + 'them to select text or a canvas node, then call this to receive the '
  + 'selection without polling. Returns `{ changed: true, editor, canvas }` '
  + 'on change (with the same shape as get_editor_selection / '
  + 'get_canvas_selection), or `{ changed: false, reason: "timeout" }` if '
  + 'nothing happened. `surface`: editor | canvas | any (default any). '
  + '`timeoutMs` clamps to 1000–60000 (default 25000).',
  {
    timeoutMs: z.number().int().min(1000).max(60000).optional(),
    surface: z.enum(['editor', 'canvas', 'any']).optional(),
  },
  async ({ timeoutMs, surface }) => withSession(async (s) => {
    const r = await s.waitForSelectionChange({ timeoutMs, surface });
    return json(r);
  }),
);

server.tool(
  'focus_canvas_node',
  'Open the canvas note, center its viewport on the given node, and show a '
  + 'callout with an optional message. Use after add_canvas_node / '
  + 'connect_canvas_nodes when you want the human to actually look at what '
  + 'you just placed. `nodeId` must exist in the canvas\'s `nodes` array.',
  {
    name: z.string(),
    nodeId: z.string(),
    message: z.string().optional(),
  },
  async ({ name, nodeId, message }) => withSession(async (s) => {
    const { f, block } = await ensureCanvas(s, name);
    const node = block.json.nodes.find(n => n.id === nodeId);
    if (!node) throw new Error(`node not found in canvas: ${nodeId}`);
    // Tell the running app to switch to this note and focus the node.
    s.focusNote(f.id);
    s.publishAiPointer({
      kind: 'canvas_focus',
      noteId: f.id,
      noteName: f.name,
      nodeId,
      message: message || null,
    });
    return json({ ok: true, note: f.name, nodeId, node });
  }),
);

server.tool(
  'present_in_canvas',
  'Play a guided walk-through over a canvas: a sequence of (nodeId + '
  + 'message) stops that advance automatically after `durationMs`. Use to '
  + 'narrate a visual mind-map: "first this is the goal; now look at this '
  + 'dependency; and this is the deadline". 1–20 steps. `durationMs` '
  + 'defaults to 6000 (clamped 1000–60000). The whole script is published '
  + 'in one shot; pacing is deterministic and the user can cancel by '
  + 'navigating away.',
  {
    name: z.string(),
    steps: z.array(z.object({
      nodeId: z.string(),
      message: z.string(),
      durationMs: z.number().int().min(1000).max(60000).optional(),
    })).min(1).max(20),
  },
  async ({ name, steps }) => withSession(async (s) => {
    const { f, block } = await ensureCanvas(s, name);
    const resolved = steps.map((st, i) => {
      const node = block.json.nodes.find(n => n.id === st.nodeId);
      if (!node) throw new Error(`step ${i + 1}: node not found: ${st.nodeId}`);
      return {
        nodeId: st.nodeId,
        message: st.message,
        durationMs: Math.max(1000, Math.min(60000, Number(st.durationMs) || 6000)),
      };
    });
    s.focusNote(f.id);
    s.publishAiPointer({
      kind: 'canvas_present',
      noteId: f.id,
      noteName: f.name,
      steps: resolved,
    });
    return json({ ok: true, note: f.name, stepCount: resolved.length });
  }),
);

server.tool(
  'present_canvas_groups',
  'PowerPoint-style slideshow over a canvas: each GROUP is one slide — the '
  + 'camera glides to the group and zooms to fit it on screen, the canvas '
  + 'goes fullscreen for the show and restores afterwards. Omit `steps` to '
  + 'play every group in their stored order. In `steps`, reference each '
  + 'group by id OR by title (case-insensitive) and optionally attach a '
  + 'narration `message` shown under the slide. `autoAdvance` (default '
  + 'true) moves on after each step\'s `durationMs` (default 7000, clamp '
  + '1500–60000); the user can always navigate with ←/→/Space and exit '
  + 'with Esc. Prefer this over `present_in_canvas` when the canvas is '
  + 'organized in groups and you want a slide-deck feel; use '
  + '`present_in_canvas` to point at individual nodes.',
  {
    name: z.string(),
    steps: z.array(z.object({
      group: z.string(),
      message: z.string().optional(),
      durationMs: z.number().int().min(1500).max(60000).optional(),
    })).min(1).max(40).optional(),
    autoAdvance: z.boolean().optional(),
  },
  async ({ name, steps, autoAdvance }) => withSession(async (s) => {
    const { f, block } = await ensureCanvas(s, name);
    const groups = block.json.groups || [];
    if (!groups.length) {
      throw new Error('canvas has no groups — groups are the slides. Ask the user to group nodes, or add groups first.');
    }
    let resolved;
    if (steps && steps.length) {
      resolved = steps.map((st, i) => {
        const g = groups.find(x => x.id === st.group
          || String(x.title || '').toLowerCase() === String(st.group).toLowerCase());
        if (!g) throw new Error(`step ${i + 1}: group not found: '${st.group}' (valid: ${groups.map(x => x.title || x.id).join(', ')})`);
        return {
          groupId: g.id,
          title: g.title || '',
          message: st.message || '',
          durationMs: Math.max(1500, Math.min(60000, Number(st.durationMs) || 7000)),
        };
      });
    } else {
      resolved = groups.map(g => ({ groupId: g.id, title: g.title || '', message: '', durationMs: 7000 }));
    }
    s.focusNote(f.id);
    s.publishAiPointer({
      kind: 'canvas_slideshow',
      noteId: f.id,
      noteName: f.name,
      steps: resolved,
      auto: autoAdvance !== false,
    });
    return json({ ok: true, note: f.name, slideCount: resolved.length, slides: resolved.map(r => r.title || r.groupId) });
  }),
);

server.tool(
  'canvas_animate',
  'Run a transient transformation sequence on canvas nodes: move, color, '
  + 'scale, or pulse — without persisting changes (the canvas JSON stays '
  + 'untouched, so the animation only plays for the user watching). Use '
  + 'for storytelling: "first highlight the goal, then walk it to the '
  + 'roadblock, then pulse the deadline". Each step targets one `nodeId` '
  + 'and may set any of: `x` / `y` (target world coords; tweened from '
  + 'current), `color` (CSS color applied to --node-color), `scale` '
  + '(target scale), `pulse` (true → 1.0→1.18→1.0 over duration). '
  + '`durationMs` clamps 100–10000 (default 800), `gapMs` between steps '
  + 'clamps 0–5000 (default 200). 1–40 steps. Animation auto-clears '
  + '~400ms after the last step so the user sees the original layout '
  + 'again. For PERSISTENT moves use move_canvas_node instead.',
  {
    name: z.string(),
    steps: z.array(z.object({
      nodeId: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      color: z.string().optional(),
      scale: z.number().min(0.1).max(5).optional(),
      pulse: z.boolean().optional(),
      durationMs: z.number().int().min(100).max(10000).optional(),
      gapMs: z.number().int().min(0).max(5000).optional(),
    })).min(1).max(40),
  },
  async ({ name, steps }) => withSession(async (s) => {
    const { f, block } = await ensureCanvas(s, name);
    const resolved = steps.map((st, i) => {
      const node = block.json.nodes.find(n => n.id === st.nodeId);
      if (!node) throw new Error(`step ${i + 1}: node not found: ${st.nodeId}`);
      return {
        nodeId: st.nodeId,
        ...(st.x != null ? { x: st.x } : {}),
        ...(st.y != null ? { y: st.y } : {}),
        ...(st.color ? { color: st.color } : {}),
        ...(st.scale != null ? { scale: st.scale } : {}),
        ...(st.pulse ? { pulse: true } : {}),
        durationMs: Math.max(100, Math.min(10000, Number(st.durationMs) || 800)),
        gapMs: Math.max(0, Math.min(5000, Number(st.gapMs) || 200)),
      };
    });
    s.focusNote(f.id);
    s.publishAiPointer({
      kind: 'canvas_animate',
      noteId: f.id,
      noteName: f.name,
      steps: resolved,
    });
    return json({ ok: true, note: f.name, stepCount: resolved.length });
  }),
);

server.tool(
  'auto_layout_canvas',
  'Re-arrange every node into a sensible grid (rough square root layout). '
  + 'Useful right after importing a bunch of nodes from MCP without coords.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const cols = Math.max(1, Math.ceil(Math.sqrt(block.json.nodes.length || 1)));
    const padX = 40, padY = 32, nodeW = 240, nodeH = 140;
    const nodes = block.json.nodes.map((n, i) => ({
      ...n,
      x: padX + (i % cols) * (nodeW + padX),
      y: padY + Math.floor(i / cols) * (nodeH + padY),
      w: n.w || nodeW,
      h: n.h || nodeH,
    }));
    await s.canvasCommit(f.id, { ...block.json, nodes }, { content, block });
    return json({ ok: true, layout: 'grid', cols });
  }),
);

server.tool(
  'update_canvas_node',
  'Patch any editable field of an existing canvas node: text, color, url, '
  + 'query, title, sticky, view (query nodes: list|cards|table), x/y/w/h. '
  + 'Pass null to delete a field (e.g. color: null clears the tint). This is '
  + 'how you EDIT content you or the user placed earlier — prefer it over '
  + 'delete + re-add, which loses edges and reactions.',
  {
    name: z.string(),
    nodeId: z.string(),
    text: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    query: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    sticky: z.boolean().nullable().optional(),
    view: z.enum(['list', 'cards', 'table']).nullable().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  },
  async ({ name, nodeId, ...patch }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    let found = null;
    const nodes = block.json.nodes.map(n => {
      if (n.id !== nodeId) return n;
      const next = { ...n };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === null) delete next[k]; else next[k] = v;
      }
      found = next;
      return next;
    });
    if (!found) throw new Error(`node not found: ${nodeId}`);
    await s.canvasCommit(f.id, { ...block.json, nodes }, { content, block });
    return json({ ok: true, node: found });
  }),
);

server.tool(
  'add_canvas_group',
  'Add a frame/group (titled colored container) to the canvas. Nodes whose '
  + 'centre falls inside move with the frame, and each frame becomes one '
  + 'slide in present_canvas_groups. `order` sets the slideshow position. '
  + 'Pass nodeIds to auto-size the frame around those nodes (with padding).',
  {
    name: z.string(),
    title: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    color: z.string().optional(),
    order: z.number().optional(),
    nodeIds: z.array(z.string()).optional(),
  },
  async ({ name, title, x, y, w, h, color, order, nodeIds }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const palette = ['rgba(125,169,90,0.10)', 'rgba(234,88,12,0.10)', 'rgba(59,130,246,0.10)', 'rgba(168,85,247,0.10)', 'rgba(220,38,38,0.08)', 'rgba(107,114,128,0.10)'];
    const group = {
      id: newCanvasId('g'),
      title,
      color: color || palette[(block.json.groups || []).length % palette.length],
    };
    if (order != null) group.order = order;
    if (nodeIds && nodeIds.length) {
      const members = block.json.nodes.filter(n => nodeIds.includes(n.id));
      if (!members.length) throw new Error('none of the given nodeIds exist in this canvas');
      const PAD = 28, HEAD = 34;
      const minX = Math.min(...members.map(n => n.x || 0));
      const minY = Math.min(...members.map(n => n.y || 0));
      const maxX = Math.max(...members.map(n => (n.x || 0) + (n.w || 240)));
      const maxY = Math.max(...members.map(n => (n.y || 0) + (n.h || 140)));
      group.x = minX - PAD; group.y = minY - PAD - HEAD;
      group.w = (maxX - minX) + PAD * 2; group.h = (maxY - minY) + PAD * 2 + HEAD;
    } else {
      group.x = x != null ? x : 80;
      group.y = y != null ? y : 80;
      group.w = w || 400;
      group.h = h || 280;
    }
    const next = { ...block.json, groups: [...(block.json.groups || []), group] };
    await s.canvasCommit(f.id, next, { content, block });
    return json({ ok: true, group });
  }),
);

server.tool(
  'update_canvas_group',
  'Patch a frame/group: title, color, order (slideshow position), x/y/w/h. '
  + 'Pass null on color/order to clear.',
  {
    name: z.string(),
    groupId: z.string(),
    title: z.string().optional(),
    color: z.string().nullable().optional(),
    order: z.number().nullable().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  },
  async ({ name, groupId, ...patch }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    let found = null;
    const groups = (block.json.groups || []).map(g => {
      if (g.id !== groupId) return g;
      const next = { ...g };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === null) delete next[k]; else next[k] = v;
      }
      found = next;
      return next;
    });
    if (!found) throw new Error(`group not found: ${groupId}`);
    await s.canvasCommit(f.id, { ...block.json, groups }, { content, block });
    return json({ ok: true, group: found });
  }),
);

server.tool(
  'apply_canvas_template',
  'Seed a canvas from a built-in template. Templates: '
  + CANVAS_TEMPLATE_KEYS.join(', ') + '. Adds the template content on top of '
  + 'whatever the canvas already holds (use create_canvas first for a fresh '
  + 'board). `lang` defaults to es.',
  {
    name: z.string(),
    template: z.enum(CANVAS_TEMPLATE_KEYS),
    lang: z.enum(['es', 'en']).optional(),
  },
  async ({ name, template, lang }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const built = buildCanvasTemplate(template, lang || 'es', {
      nodeId: () => newCanvasId('n'),
      groupId: () => newCanvasId('g'),
      annoId: () => newCanvasId('ann'),
      edgeId: () => canvasEdgeId(),
    });
    const next = {
      ...block.json,
      nodes: [...block.json.nodes, ...built.nodes],
      edges: [...(block.json.edges || []), ...built.edges],
      groups: [...(block.json.groups || []), ...built.groups],
      annotations: [...(block.json.annotations || []), ...built.annotations],
    };
    await s.canvasCommit(f.id, next, { content, block });
    s.focusNote(f.id);
    return json(withHints(
      { ok: true, template, added: { nodes: built.nodes.length, groups: built.groups.length, edges: built.edges.length } },
      [{ tool: 'read_canvas', args: { name: f.name }, reason: 'see the ids the template created before filling it in' }]
    ));
  }),
);

server.tool(
  'cluster_canvas_nodes',
  'Materialize a clustering YOU decided: pass clusters of node ids (usually '
  + 'stickies) and this creates one titled frame per cluster, recolors the '
  + 'members, and lays each cluster out in its own column. Read the board '
  + 'first with read_canvas, group ideas by theme yourself (that is what an '
  + 'LLM is good at), then call this to make the structure visible. The '
  + 'classic Miro affinity-mapping move, one call.',
  {
    name: z.string(),
    clusters: z.array(z.object({
      title: z.string(),
      color: z.string().optional(),
      nodeIds: z.array(z.string()).min(1),
    })).min(1).max(20),
  },
  async ({ name, clusters }) => withSession(async (s) => {
    const { f, content, block } = await ensureCanvas(s, name);
    const byId = new Map(block.json.nodes.map(n => [n.id, n]));
    for (const c of clusters) {
      for (const id of c.nodeIds) {
        if (!byId.has(id)) throw new Error(`cluster "${c.title}": node not found: ${id}`);
      }
    }
    const palette = ['rgba(125,169,90,0.10)', 'rgba(234,88,12,0.10)', 'rgba(59,130,246,0.10)', 'rgba(168,85,247,0.10)', 'rgba(220,38,38,0.08)', 'rgba(107,114,128,0.10)'];
    const stickyPalette = CANVAS_STICKY_COLORS;
    const PAD = 28, HEAD = 44, GAP = 20, COLW = 2;
    let frameX = 80;
    const pos = new Map();
    const groups = [...(block.json.groups || [])];
    clusters.forEach((c, ci) => {
      const members = c.nodeIds.map(id => byId.get(id));
      const cellW = Math.max(...members.map(n => n.w || 180)) + GAP;
      const cellH = Math.max(...members.map(n => n.h || 180)) + GAP;
      const cols = Math.min(COLW, members.length);
      const rows = Math.ceil(members.length / cols);
      members.forEach((n, i) => {
        pos.set(n.id, {
          x: frameX + PAD + (i % cols) * cellW,
          y: 80 + HEAD + PAD + Math.floor(i / cols) * cellH,
          color: c.color || stickyPalette[ci % stickyPalette.length],
        });
      });
      const w = PAD * 2 + cols * cellW - GAP + 20;
      const h = HEAD + PAD * 2 + rows * cellH - GAP + 20;
      groups.push({
        id: newCanvasId('g'),
        title: c.title,
        color: palette[ci % palette.length],
        x: frameX, y: 80, w, h,
        order: ci,
      });
      frameX += w + 60;
    });
    const nodes = block.json.nodes.map(n => {
      const p = pos.get(n.id);
      if (!p) return n;
      const next = { ...n, x: p.x, y: p.y };
      if (n.sticky) next.color = p.color;
      return next;
    });
    await s.canvasCommit(f.id, { ...block.json, nodes, groups }, { content, block });
    s.focusNote(f.id);
    return json(withHints(
      { ok: true, clusters: clusters.length, groups: groups.slice(-clusters.length) },
      [{ tool: 'present_canvas_groups', args: { name: f.name }, reason: 'walk the user through the clusters you just built' }]
    ));
  }),
);

server.tool(
  'get_canvas_reactions',
  'Read emoji reactions/votes per node — { nodeId, text?, reactions: '
  + '{emoji: [user…]}, votes } sorted by total votes. Use to tally a sticky '
  + 'voting round ("which ideas won?") before clustering or summarizing.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const { block } = await ensureCanvas(s, name);
    const out = [];
    for (const n of block.json.nodes) {
      if (!n.reactions || !Object.keys(n.reactions).length) continue;
      const votes = Object.values(n.reactions).reduce((acc, arr) => acc + (arr || []).length, 0);
      out.push({
        nodeId: n.id,
        kind: n.kind,
        text: (n.text || n.title || n.noteName || '').slice(0, 120),
        reactions: n.reactions,
        votes,
      });
    }
    out.sort((a, b) => b.votes - a.votes);
    return json({ count: out.length, nodes: out });
  }),
);

server.tool(
  'canvas_screenshot',
  'SEE the whiteboard: focuses the canvas note and captures a PNG of the '
  + 'user\'s current view, returned as an image block. Essential before '
  + 'clustering or commenting on spatial arrangement — read_canvas gives '
  + 'coordinates, this gives the actual picture (drawings, colors, overlaps). '
  + 'App must be running.',
  {
    name: z.string(),
    maxWidth: z.number().int().min(64).max(4096).optional(),
    timeoutMs: z.number().int().min(1000).max(60000).optional(),
  },
  async ({ name, maxWidth, timeoutMs }) => withSession(async (s) => {
    const { f } = await ensureCanvas(s, name);
    s.focusNote(f.id);
    // Give the app a beat to mount the canvas before the capture request.
    await new Promise(r => setTimeout(r, 450));
    const r = await s.screenshotNote({ fileId: f.id, maxWidth: maxWidth || 1400, timeoutMs });
    if (!r.ok) return text(`canvas screenshot failed: ${r.reason || 'unknown'}`);
    return {
      content: [
        { type: 'text', text: `Canvas "${f.name}" (${r.width}×${r.height})` },
        { type: 'image', data: r.base64, mimeType: r.mime || 'image/png' },
      ],
    };
  }),
);

server.tool(
  'laser_trace',
  'Draw an EPHEMERAL laser-pointer trail across the canvas (world coords '
  + 'polyline, fades in under a second, persists nothing). The lightest way '
  + 'to say "look at this path/relation" while talking — e.g. sweep from one '
  + 'node to another. For persistent marks use draw_freehand_on_canvas; for '
  + 'centering on one node use focus_canvas_node.',
  {
    name: z.string(),
    points: z.array(z.object({ x: z.number(), y: z.number() })).min(2).max(200),
    durationMs: z.number().int().min(400).max(10000).optional(),
  },
  async ({ name, points, durationMs }) => withSession(async (s) => {
    const { f } = await ensureCanvas(s, name);
    s.focusNote(f.id);
    s.publishAiPointer({
      kind: 'canvas_laser',
      noteId: f.id,
      noteName: f.name,
      points,
      durationMs: durationMs || 1600,
    });
    return json({ ok: true, note: f.name, points: points.length });
  }),
);

// ─── Pinned context — persistent memory across sessions ───────────────────
// The user (or the AI on the user's instruction) pins fragments that should
// be carried into every future call. SERVER_INSTRUCTIONS already tells the
// model to consult get_active_context first — that response now includes
// the pinned list, so pins effectively become part of the working memory.

server.tool(
  'pin_to_context',
  'Pin a short fragment so it persists across MCP sessions as "always relevant" '
  + 'context. Use when the user says "remember this" or when you want to keep a '
  + 'decision/constraint/quote visible for the rest of the project. Each pin '
  + 'shows up in `get_active_context.pinnedContext` and is read by every '
  + 'subsequent call. Cap each pin to 4000 chars; pin separately for separate '
  + 'concepts. `label` is a 1-line tag the human will see in their pin list. '
  + '`noteId` links the pin to the source note when applicable.',
  {
    text: z.string().min(1).max(4000),
    label: z.string().max(120).optional(),
    noteId: z.string().optional(),
    source: z.enum(['manual', 'selection', 'note', 'reasoning']).optional(),
  },
  async ({ text, label, noteId, source }) => withSession(async (s) => {
    const rec = s.pinContext({ text, label, noteId, source });
    return json({ ok: true, pin: rec, total: s.listPinnedContext().length });
  }),
);

server.tool(
  'unpin_context',
  'Remove a previously pinned fragment by its id. List ids with list_pinned_context.',
  { id: z.string() },
  async ({ id }) => withSession(async (s) => {
    const r = s.unpinContext(id);
    return json({ ok: true, ...r });
  }),
);

server.tool(
  'list_pinned_context',
  'Return every fragment currently pinned to this workspace. Call this when '
  + 'you need to remember what the user has flagged as always-relevant — for '
  + 'example before starting a new line of work on the same project.',
  {},
  async () => withSession(async (s) => {
    const pins = s.listPinnedContext();
    return json({ count: pins.length, pinned: pins });
  }),
);

// ─── Anchored comments — non-destructive AI annotations ──────────────────
// Lets the AI leave margin notes on a passage without touching the
// markdown source. The user sees them as side-panel comments tied to
// the optional anchor text. Pair with focus_note + highlight_in_note
// when you really need to draw attention to one spot.

server.tool(
  'anchor_note',
  'Attach a non-destructive comment to a note. Prefer this over rewriting '
  + 'the markdown when you want to offer feedback, ask a question, or flag '
  + 'something — the user keeps their text intact and can resolve / delete '
  + 'comments later. Pass `anchorText` (a literal substring of the note) to '
  + 'tie the comment to a specific passage; omit it for a note-level note. '
  + 'Set `kind: "question"` to make it a question that awaits a reply (use '
  + '`ask_inline` if you want to block until the user answers). Pass '
  + '`parentId` to thread the comment as a reply to an existing one — '
  + 'parent must live on the same note. Pass `mentions` to ping specific '
  + 'users via the notification stream. The text body is also scanned '
  + 'for @email@host.tld mentions and those are merged with the explicit '
  + 'list. Returns the assigned `id` for later resolve / delete / reply.',
  {
    noteId: z.string(),
    text: z.string().min(1).max(4000),
    anchorText: z.string().max(600).optional(),
    author: z.string().max(60).optional(),
    kind: z.enum(['note', 'question']).optional(),
    parentId: z.string().optional(),
    mentions: z.array(z.string().email()).max(20).optional(),
  },
  async ({ noteId, text, anchorText, author, kind, parentId, mentions }) => withSession(async (s) => {
    // If the caller is an AI agent currently handling an open task on this
    // note and doesn't pass an explicit parentId, thread the comment under
    // the task's source comment automatically. Without this, AIs that
    // forget to call `reply_to_comment` (or `complete_agent_task`) post
    // their answer as a brand-new root comment, breaking the conversation.
    if (!parentId && kind !== 'question') {
      try {
        const identity = currentAgentIdentity();
        const alias = identity && identity.alias;
        if (alias) {
          const me = String(alias).toLowerCase();
          const tasks = s.listAgentTasks({ alias, kind: identity.kind, status: ['running', 'pending', 'pending-offline'] });
          const mine = tasks
            .filter(t => t.noteId === noteId && t.commentId)
            // For shared @kind tasks, only thread under ones THIS device claimed,
            // so two agents of the same kind don't steal each other's threads.
            .filter(t => !t.canonical || String((t.claimedBy && t.claimedBy.alias) || '').toLowerCase() === me)
            .sort((a, b) => String(b.runningAt || b.claimedAt || b.requestedAt || '')
              .localeCompare(String(a.runningAt || a.claimedAt || a.requestedAt || '')));
          if (mine.length) parentId = mine[0].commentId;
        }
      } catch { /* best-effort inference — never break the post */ }
    }
    const rec = s.addAnchoredComment({ noteId, text, anchorText, author, kind, parentId, mentions });
    return json({ ok: true, comment: rec });
  }),
);

server.tool(
  'reply_to_comment',
  'Post a reply to an existing anchored comment thread. Equivalent to '
  + '`anchor_note` with `parentId` set, but takes the comment id directly '
  + 'and infers `noteId` + `anchorText` from the parent. Use after '
  + '`list_comments` returns a thread you want to extend (e.g. resolving '
  + 'a teammate\'s question by replying with a decision). Optional '
  + '`mentions` pings additional users on top of any @email in `text`.',
  {
    commentId: z.string(),
    text: z.string().min(1).max(4000),
    author: z.string().max(60).optional(),
    mentions: z.array(z.string().email()).max(20).optional(),
  },
  async ({ commentId, text, author, mentions }) => withSession(async (s) => {
    // Locate the parent across all notes — listAnchoredComments without
    // noteId returns the full flat list. cheap enough.
    const all = s.listAnchoredComments({ includeResolved: true });
    const parent = all.find(c => c.id === commentId);
    if (!parent) throw new Error(`comment not found: ${commentId}`);
    const rec = s.addAnchoredComment({
      noteId: parent.noteId,
      text,
      anchorText: parent.anchorText || null,
      author,
      kind: 'note',
      parentId: parent.id,
      mentions,
    });
    return json({ ok: true, parentId: parent.id, comment: rec });
  }),
);

server.tool(
  'list_comments',
  'Return anchored comments on a note (or all notes if `noteId` omitted). '
  + 'By default skips resolved ones; pass includeResolved=true to see the '
  + 'history.',
  {
    noteId: z.string().optional(),
    includeResolved: z.boolean().optional(),
  },
  async ({ noteId, includeResolved }) => withSession(async (s) => {
    const items = s.listAnchoredComments({ noteId, includeResolved });
    return json({ count: items.length, comments: items });
  }),
);

server.tool(
  'resolve_comment',
  'Mark a comment as resolved (the user dealt with it). Keeps the record in '
  + 'history for audit; use delete_comment to drop it entirely.',
  { id: z.string() },
  async ({ id }) => withSession(async (s) => {
    const rec = s.resolveAnchoredComment(id);
    return json({ ok: true, comment: rec });
  }),
);

server.tool(
  'delete_comment',
  'Permanently remove an anchored comment.',
  { id: z.string() },
  async ({ id }) => withSession(async (s) => {
    const r = s.deleteAnchoredComment(id);
    return json({ ok: true, ...r });
  }),
);

server.tool(
  'ask_inline',
  'Ask the user a QUESTION anchored to a passage of a note. Auto-focuses '
  + 'the note (so the reply panel becomes visible) and BLOCKS the tool '
  + 'call until the user replies (or `timeoutMs` elapses, default 120s) — '
  + 'so you can react in the same conversation turn instead of forcing '
  + 'the user to ping you back. Use for micro-interactions: "should I '
  + 'split this into two paragraphs?", "is this date right?". Returns '
  + '`{ comment, reply }` when the user answers, or `{ comment, reply: '
  + 'null, reason: "timeout" }` if they don\'t. Set `wait: false` if you '
  + 'want fire-and-forget (you\'ll see the answer next turn via '
  + 'get_active_context.pendingReplies). After acting on a reply, call '
  + '`resolve_comment` so the panel clears it.',
  {
    noteId: z.string(),
    question: z.string().min(1).max(2000),
    anchorText: z.string().max(600).optional(),
    author: z.string().max(60).optional(),
    wait: z.boolean().optional(),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
  },
  async ({ noteId, question, anchorText, author, wait, timeoutMs }) => withSession(async (s) => {
    // Focus the note so the side panel (which only renders for the
    // active note) is actually visible to the user. Without this, the
    // question silently lands on a note the user isn't looking at.
    try { s.focusNote(noteId); } catch { /* note may not exist as a file — that's checked next */ }
    const rec = s.addAnchoredComment({ noteId, text: question, anchorText, author, kind: 'question' });
    const shouldWait = wait !== false; // default true
    if (!shouldWait) {
      return json(withHints({ ok: true, comment: rec, waited: false }, [
        { tool: 'wait_for_inline_reply', args: { commentId: rec.id }, reason: 'block until the user replies in the side panel' },
        { tool: 'get_active_context', args: {}, reason: 'check next turn — pendingReplies will surface the answer' },
      ]));
    }
    const r = await s.waitForInlineReply(rec.id, timeoutMs);
    return json(withHints({ ok: true, comment: rec, waited: true, ...r }, r.reply ? [
      { tool: 'resolve_comment', args: { id: rec.id }, reason: 'mark the question handled now that you have the answer' },
    ] : [
      { tool: 'get_active_context', args: {}, reason: 'timeout — pick up the reply next turn if user answers later' },
    ]));
  }),
);

server.tool(
  'wait_for_inline_reply',
  'Long-poll for the user\'s reply to an `ask_inline` question. Resolves '
  + 'as soon as the user submits a reply, or returns `{ reply: null, '
  + 'reason: "timeout" }` if the wait expires. `timeoutMs` clamps to '
  + '1000–120000 (default 60000).',
  {
    commentId: z.string(),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
  },
  async ({ commentId, timeoutMs }) => withSession(async (s) => {
    const r = await s.waitForInlineReply(commentId, timeoutMs);
    return json(r);
  }),
);

server.tool(
  'read_replies',
  'Read all replies on an anchored comment (no waiting). Use to inspect '
  + 'history after the user has responded.',
  { commentId: z.string() },
  async ({ commentId }) => withSession(async (s) => {
    const items = s.listAnchoredComments({ includeResolved: true });
    const c = items.find(x => x.id === commentId);
    if (!c) throw new Error(`comment not found: ${commentId}`);
    return json({ comment: c, replies: c.replies || [], awaitingReply: c.awaitingReply !== false });
  }),
);

server.tool(
  'get_recent_edits',
  'Return the most recent mutations performed on this workspace (write, '
  + 'append, create, delete, rename — by you or the user) newest first. Use '
  + 'this when you resume a task instead of re-reading entire notes: ask '
  + '"what changed since the last time?" with `since`. Each entry exposes '
  + '`ts` (ISO), `kind`, `noteName`, optional `snippetBefore` / `snippetAfter` '
  + '/ `appended` (first ~180 chars of the relevant text), and byte counts. '
  + 'Filter by `noteId` to focus on one note.',
  {
    since: z.union([z.string(), z.number()]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    noteId: z.string().optional(),
  },
  async ({ since, limit, noteId }) => withSession(async (s) => {
    const edits = s.getRecentEdits({ since, limit, noteId });
    return json({ count: edits.length, edits });
  }),
);

server.tool(
  'recall_semantic',
  'Semantic search across the user\'s notes using OpenAI embeddings '
  + '(text-embedding-3-small, ~$0.02/M tokens), ranked by cosine similarity. '
  + 'Use when keyword search would miss the answer — query and note '
  + 'vocabulary differ ("flujo de alta" → "user signup"). Each hit returns '
  + 'a `score` (0..1, cosine), the strongest matching `snippets`, and the '
  + 'note `name` + `vaultId`. Works WITHOUT the app open: the MCP keeps its '
  + 'own vector index on disk (first call indexes changed notes, then it is '
  + 'incremental) using the OpenAI key from Ajustes. Without a key it falls '
  + 'back to keyword `recall` and says so in `mode`. AFTER calling, chain `focus_note` + `spotlight_pulse` '
  + 'on the top hit so the user sees where the answer lives.',
  {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional(),
    threshold: z.number().min(0).max(1).optional(),
    timeoutMs: z.number().int().min(2000).max(120000).optional(),
    vault: z.string().optional(),
  },
  async ({ query, limit, threshold, timeoutMs, vault }) => withSession(async (s, cfg) => {
    const max = limit || 10;
    const thr = typeof threshold === 'number' ? threshold : 0.3;
    const finish = (hits, mode, extra = {}) => json(withHints({
      count: hits.length, query, mode, ...extra,
      hits: hits.map(h => ({ ...h, vault: s.vaultName(h.vaultId), score: Math.round(h.score * 1000) / 1000 })),
    }, hits.length ? [
      { tool: 'focus_note', args: { name: hits[0].name }, reason: 'open the top hit for the user' },
      { tool: 'spotlight_pulse', args: { name: hits[0].name, text: '<exact phrase from snippet>' }, reason: 'flash the matching passage so the user sees what you found' },
    ] : []));
    const vaultId = vault ? (s.listFiles({ vault })[0] || {}).vaultId || null : null;
    let why = '';
    // 1) Índice propio del MCP (no necesita la app abierta).
    const key = String(s.getSetting('openaiKey', '') || process.env.OPENAI_API_KEY || '').trim();
    if (key) {
      try {
        const idx = semanticIndexFor(cfg);
        const notes = [];
        for (const f of s.listFiles({})) {
          let c = readCachedBody(s, f.id);
          if (c == null) c = await s.readContent(f.id);
          notes.push({ id: f.id, name: f.name, vaultId: f.vaultId || 'default', content: String(c || '') });
        }
        const st = await idx.sync(key, notes, Math.min(90000, Math.max(5000, (timeoutMs || 60000) - 5000)));
        const hits = await idx.search(key, query, { limit: max, threshold: thr, vaultId });
        return finish(hits, 'semantic', st.pending ? { note: `${st.pending} notas aún sin indexar (se completan en la próxima búsqueda)` } : {});
      } catch (e) { why = e && e.message ? e.message : String(e); }
    } else why = 'sin clave de OpenAI (Ajustes → IA)';
    // 2) Último recurso: búsqueda por palabras (recall), avisando.
    const rec = server._registeredTools && server._registeredTools.recall;
    if (rec && rec.handler) {
      const out = await rec.handler({ query, limit: max, vault }, {});
      let data = null;
      try { data = JSON.parse(out.content[0].text); } catch {}
      if (data) return json({ ...data, mode: 'keyword-fallback', reason: `semantic unavailable: ${why}` });
    }
    return text(`recall_semantic unavailable: ${why}`);
  }),
);

server.tool(
  'screenshot_note',
  'Capture a PNG of the user\'s current view of a note (rendered, with '
  + 'their theme + scroll position) and return it as an image content '
  + 'block. Use to "see" what the user sees — handy after a write to '
  + 'verify the rendered output, when asked "how does this look?", or '
  + 'when debugging a layout question. Optionally pass a `rect` (client '
  + 'coords) to crop. `maxWidth` downscales to keep the payload sane '
  + '(default 1200px). Returns `{type: "image"}` content; the app must '
  + 'be running for this to work (otherwise times out).',
  {
    name: z.string(),
    rect: z.object({
      x: z.number(), y: z.number(),
      width: z.number(), height: z.number(),
    }).optional(),
    maxWidth: z.number().int().min(64).max(4096).optional(),
    timeoutMs: z.number().int().min(1000).max(60000).optional(),
  },
  async ({ name, rect, maxWidth, timeoutMs }) => withSession(async (s) => {
    const f = s.findFileByName(name);
    if (!f) throw new Error(`not found: ${name}`);
    const r = await s.screenshotNote({ fileId: f.id, rect, maxWidth, timeoutMs });
    if (!r.ok) {
      return text(`screenshot failed: ${r.reason || 'unknown'}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: `Screenshot of "${f.name}" (${r.width}×${r.height}, ${r.bytes} bytes)`,
        },
        {
          type: 'image',
          data: r.base64,
          mimeType: r.mime || 'image/png',
        },
      ],
    };
  }),
);

server.tool(
  'presence_pulse',
  'Tell the user what you\'re doing right now — even between mutations. '
  + 'Renders into the live AI-peer chip in the user\'s window (animated '
  + 'avatar + activity line). Use for long multi-step actions where the '
  + 'user would otherwise see silence: "thinking…", "searching across '
  + 'vault…", "drafting outline (3/8)…". `kind` styles the icon: '
  + 'think | search | read | write | draw | plan | wait (default think). '
  + '`target` (optional) is the note/canvas you\'re acting on. The chip '
  + 'auto-fades after ~12s of silence, so call it again to extend.',
  {
    activity: z.string().min(1).max(160),
    kind: z.enum(['think', 'search', 'read', 'write', 'draw', 'plan', 'wait']).optional(),
    target: z.string().max(120).optional(),
  },
  async ({ activity, kind, target }) => withSession(async (s) => {
    s.publishAiPresence({
      activity,
      kind: kind || 'think',
      target: target || null,
    });
    return json({ ok: true, activity, kind: kind || 'think', target: target || null });
  }),
);

server.tool(
  'get_ai_agent_identity',
  'Return this MCP server process AI-agent identity: alias, kind, owner, device and platform. '
  + 'Use this to know which @alias can be mentioned in Edinot.',
  {},
  async () => withSession(async (_s, cfg) => json(currentAgentIdentity(cfg))),
);

server.tool(
  'list_ai_agents',
  'List AI agents currently advertising presence in this workspace. '
  + 'Agents publish aliases such as @codex-laptop or @claude-mac while their MCP process is online.',
  {},
  async () => withSession(async (s) => json({ agents: s.listAiAgents() })),
);

server.tool(
  'list_agent_tasks',
  'List pending/running/done tasks created by @mentioning an AI agent. '
  + 'Filter by alias to see tasks addressed to a specific agent. Tasks also '
  + 'include canonical @kind tasks (e.g. @Claude) claimable by any agent of '
  + 'that kind — these surface to every agent whose kind matches.',
  {
    alias: z.string().max(80).optional(),
    status: z.array(z.enum(['pending', 'pending-offline', 'running', 'done', 'failed'])).max(5).optional(),
  },
  async ({ alias, status }) => withSession(async (s, cfg) => {
    const identity = currentAgentIdentity(cfg);
    const target = alias || identity.alias;
    return json({ agent: identity, tasks: s.listAgentTasks({ alias: target, kind: identity.kind, status: status || ['pending', 'pending-offline', 'running'] }) });
  }),
);

server.tool(
  'claim_agent_task',
  'Mark an @AI mention task as running for this agent before doing the work.',
  { id: z.string() },
  async ({ id }) => withSession(async (s, cfg) => {
    const identity = currentAgentIdentity(cfg);
    return json({ ok: true, task: s.claimAgentTask(id, identity) });
  }),
);

server.tool(
  'complete_agent_task',
  'Complete an @AI mention task. By default posts `response` as a reply to the '
  + 'originating comment thread. Set autoReply:false to close the task without '
  + 'auto-posting — use this when you will reply yourself via reply_to_comment '
  + '(e.g. to format the answer, attach files, or split it across replies).',
  {
    id: z.string(),
    response: z.string().max(4000).optional(),
    status: z.enum(['done', 'failed']).optional(),
    error: z.string().max(1000).optional(),
    autoReply: z.boolean().optional(),
  },
  async ({ id, response, status, error, autoReply }) => withSession(async (s, cfg) => {
    const identity = currentAgentIdentity(cfg);
    return json({ ok: true, task: s.completeAgentTask(id, { response, status: status || 'done', error, agent: identity, autoReply: autoReply !== false }) });
  }),
);

server.tool(
  'get_agent_policy',
  'Read the per-vault agent access policy (Fase 3 admin control). Pass a '
  + 'vaultId for that vault\'s rules, or omit for the whole map. No rule for a '
  + 'vault means every agent is allowed (back-compat).',
  { vaultId: z.string().optional() },
  async ({ vaultId }) => withSession(async (s) => json({ policy: s.getAgentPolicy(vaultId) })),
);

server.tool(
  'set_agent_policy',
  'Set which agents may act in a vault (Fase 3 admin control). Deny lists win; '
  + 'if any allow list is non-empty the vault is whitelist-mode (only listed '
  + 'kinds/aliases may act). Pass clear:true to remove the vault\'s policy. '
  + 'Only change when the user asks.',
  {
    vaultId: z.string(),
    allowKinds: z.array(z.string()).max(50).optional(),
    denyKinds: z.array(z.string()).max(50).optional(),
    allowAliases: z.array(z.string()).max(50).optional(),
    denyAliases: z.array(z.string()).max(50).optional(),
    clear: z.boolean().optional(),
  },
  async ({ vaultId, ...patch }) => withSession(async (s) => json({ ok: true, policy: s.setAgentPolicy(vaultId, patch) })),
);

server.tool(
  'clear_pinned_context',
  'Drop every pinned fragment. Irreversible — only call when the user '
  + 'explicitly asks to start fresh.',
  {},
  async () => withSession(async (s) => {
    const r = s.clearPinnedContext();
    return json({ ok: true, ...r });
  }),
);

let agentPresenceTimer = null;
async function startAgentPresence() {
  const tick = async () => {
    // resolveCfg throws when the app hasn't been set up yet — that's a
    // "nothing to announce", not an error worth retrying loudly.
    try { if (resolveCfg().mode === 'local') return; } catch { return; }
    // Rides the shared session rather than opening a second one. It also
    // doubles as the warm-up: this fires right after the transport
    // connects, so the expensive first sync happens in the background
    // while the model is still reading the tool list, instead of inside
    // the user's first tool call.
    let held;
    try { held = await acquireSession(); }
    catch { await closeSharedSession(); return; }
    try { held.session.publishAiAgentPresence(currentAgentIdentity(held.cfg)); }
    catch {}
    finally { releaseSession(held); }
  };
  await tick();
  if (!agentPresenceTimer) agentPresenceTimer = setInterval(() => { tick().catch(() => {}); }, 10000);
}

async function stopAgentPresence() {
  if (agentPresenceTimer) clearInterval(agentPresenceTimer);
  agentPresenceTimer = null;
  await closeSharedSession();
}

// ── Events / reminders (F4) ────────────────────────────────────────────
server.tool(
  'list_events',
  'List manual events stored in `yEvents` for the given vault (default if omitted). '
  + 'Does NOT include inline (note-text) events — use search_notes / read_note for those. '
  + 'Each event: id, kind, title, start, end, allDay, remindAt, noteId, recurrence and, when set, '
  + 'location, description, color, reminderOffset (minutes before start) and calendarId.',
  { vault: z.string().optional() },
  async ({ vault } = {}) => withSession(async (s) => json(await s.listEvents(vault || 'default'))),
);

server.tool(
  'list_collections',
  'List the collections of a vault (default if omitted): saved filters of the app\'s «Todas las notas» page. '
  + 'Each one: id, name, icon, createdAt, updatedAt and `rules` — tags (+ tagMode any|all), folders (ids; '
  + 'subfolders included), noFolder (also notes loose at the vault root), types (note|canvas|database), pinned, '
  + 'updated (modified in the last N days) and text (in the title). Set `include_notes: true` to also get the '
  + 'notes that match each one (`notes`: id + name, at most `limit` per collection, default 50; `count` is the total).',
  { vault: z.string().optional(), include_notes: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() },
  async ({ vault, include_notes, limit } = {}) => withSession(async (s) => {
    const vid = vault || 'default';
    const cols = s.listCollections(vid);
    if (!include_notes || !cols.length) return json(cols);
    const files = s.listFiles({ vault: vid });
    const folders = s.listFolders ? s.listFolders(vid) : [];
    const parentOf = new Map(folders.map(f => [f.id, f.parentId || null]));
    // Tags and type come from the text, so read it only if some collection needs it.
    const needsText = cols.some(c => c.rules.tags.length || c.rules.types.length);
    const infos = [];
    for (const f of files) {
      const body = needsText ? await scanBody(s, f.id) : '';
      infos.push({
        id: f.id, name: String(f.name || '').replace(/\.(md|markdown|txt)$/i, ''), folderId: f.folderId || null,
        type: f.kind === 'database' ? 'database' : (/^[ \t]*```edinot-canvas[ \t]*$/m.test(body) ? 'canvas' : 'note'),
        tags: needsText ? srvExtractTags(body).map(x => x.toLowerCase()) : [],
        pinned: !!f.pinned, updatedAt: f.updatedAt || 0,
      });
    }
    const cap = limit || 50;
    return json(cols.map((c) => {
      const test = compileRules(c.rules, { parentOf });
      const hit = infos.filter(test);
      return { ...c, count: hit.length, notes: hit.slice(0, cap).map(n => ({ id: n.id, name: n.name })) };
    }));
  }),
);

// Recurrence rule for create/update. Whole-series semantics: editing or
// deleting the event affects every occurrence. byWeekday is weekly-only,
// 0=Mon … 6=Sun. Provide `until` (YYYY-MM-DD) OR `count`, not both.
// NOTE: this is a FACTORY (fresh schema per tool) on purpose — sharing one
// zod object across two tools makes the SDK emit a $ref that some clients
// flatten to an empty `{}` schema, so they send the value as a string and
// validation rejects it. Inlining keeps the full object shape on the wire.
const recurrenceSchema = () => z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().positive().optional(),
  until: z.string().nullable().optional(),
  count: z.number().int().positive().nullable().optional(),
  byWeekday: z.array(z.number().int().min(0).max(6)).nullable().optional(),
}).nullable().optional();

server.tool(
  'create_event',
  'Create a calendar event in a vault. `start` accepts YYYY-MM-DD (all-day) '
  + 'or YYYY-MM-DDTHH:mm. `end` is YYYY-MM-DDTHH:mm for timed events; for all-day events it is the '
  + 'EXCLUSIVE end date (YYYY-MM-DD, like Google Calendar: a 24–26 Oct event has end 2026-10-27). '
  + 'Set `kind="reminder"` to also schedule an OS notification on the user device. '
  + 'Optional: `location`, `description`, `color` (#RRGGBB), `reminderOffset` (minutes before start to '
  + 'notify — works for events too, e.g. 15), `calendarId` (defaults to "vault:<vaultId>"). '
  + 'Pass `recurrence` to repeat it, e.g. {freq:"weekly",interval:1,byWeekday:[0,2,4]} for Mon/Wed/Fri, '
  + 'optionally ending with `until` (YYYY-MM-DD) or `count`. '
  + 'IMPORTANT — location: events live INSIDE a vault. If the user did not name '
  + 'a vault, do NOT silently dump it in the literal "default" vault — pass the '
  + 'vault the user is working in. When `vault` is omitted it now falls back to '
  + 'the currently-active vault (from get_active_context), not "default". If you '
  + 'genuinely cannot tell which vault is intended, ask before creating.',
  {
    title: z.string(),
    start: z.string(),
    end: z.string().optional(),
    allDay: z.boolean().optional(),
    kind: z.enum(['event', 'reminder']).optional(),
    remindAt: z.string().optional(),
    noteId: z.string().optional(),
    recurrence: recurrenceSchema(),
    vault: z.string().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    reminderOffset: z.number().int().min(0).max(40320).optional(),
    calendarId: z.string().optional(),
  },
  async (a) => withSession(async (s) => {
    // No vault given → fall back to the vault the user is actually in, not the
    // literal 'default'. Mirrors create_note's "use the active context" rule.
    let vault = a.vault;
    if (!vault) { try { vault = (await s.getActiveContext()).activeVaultId; } catch {} }
    return json(await s.createEvent({ ...a, vault: vault || 'default' }));
  }),
);

server.tool(
  'update_event',
  'Patch an existing event by id. `patch` accepts title / start / end / allDay / kind / remindAt / noteId / recurrence '
  + '/ location / description / color / reminderOffset / calendarId (null clears an optional field). '
  + 'Set `recurrence` to null to make a repeating event one-off. Changes affect the whole series.',
  {
    id: z.string(),
    patch: z.object({
      title: z.string().optional(),
      start: z.string().optional(),
      end: z.string().nullable().optional(),
      allDay: z.boolean().optional(),
      kind: z.enum(['event', 'reminder']).optional(),
      remindAt: z.string().nullable().optional(),
      noteId: z.string().nullable().optional(),
      recurrence: recurrenceSchema(),
      location: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      reminderOffset: z.number().int().min(0).max(40320).nullable().optional(),
      calendarId: z.string().nullable().optional(),
    }),
    vault: z.string().optional(),
  },
  async ({ id, patch, vault } = {}) => withSession(async (s) => json(await s.updateEvent({ id, patch, vault: vault || 'default' }))),
);

server.tool(
  'delete_event',
  'Delete a manual event by id.',
  { id: z.string(), vault: z.string().optional() },
  async ({ id, vault } = {}) => withSession(async (s) => json(await s.deleteEvent({ id, vault: vault || 'default' }))),
);

// ─── Forms (Notion-style) ───────────────────────────────────────────────
// A note can carry a ```edinot-form``` block whose fields are auto-derived
// from a target table's columns. On a share link with submit enabled the
// block becomes a public HTML form that appends a row to that table. These
// tools let the AI author forms exactly like the visual builder does.

// Resolve a note by name (case-insensitive, .md optional) OR by id.
function resolveNoteRef(s, ref) {
  if (!ref) return null;
  let f = s.findFileByName(ref);
  if (!f) f = s.listFiles({}).find((x) => x.id === ref) || null;
  return f;
}

// Copy the optional form-config fields off a tool-args object onto `cfg`,
// keeping only meaningful values (the builder stores no empty defaults).
function applyFormFields(cfg, src) {
  for (const k of ['title', 'description', 'submit', 'success', 'redirect', 'stamp']) {
    if (typeof src[k] === 'string' && src[k].trim()) cfg[k] = src[k].trim();
  }
  for (const k of ['required', 'email', 'hidden', 'order']) {
    if (Array.isArray(src[k])) cfg[k] = src[k].filter(Boolean);
  }
  for (const k of ['labels', 'help']) {
    if (src[k] && typeof src[k] === 'object') cfg[k] = src[k];
  }
  if (Number.isFinite(src.maxResponses)) cfg.maxResponses = src.maxResponses;
  if (typeof src.closesAt === 'string' && src.closesAt.trim()) cfg.closesAt = src.closesAt.trim();
}

const FORM_FIELD_SCHEMA = {
  title: z.string().optional(),
  description: z.string().optional(),
  submit: z.string().optional(),
  success: z.string().optional(),
  redirect: z.string().optional(),
  required: z.array(z.string()).optional(),
  email: z.array(z.string()).optional(),
  hidden: z.array(z.string()).optional(),
  order: z.array(z.string()).optional(),
  labels: z.record(z.string()).optional(),
  help: z.record(z.string()).optional(),
  stamp: z.string().optional(),
  closesAt: z.string().optional(),
  maxResponses: z.number().int().positive().optional(),
};

server.tool(
  'create_form',
  'Create a Notion-style form in a note. The form fields are auto-derived from '
  + 'a target table\'s columns, so the note (or `responsesNote`) MUST already '
  + 'contain a markdown table — create one first if needed. By default responses '
  + 'land in the same note; pass `responsesNote` (name or id) to collect them in '
  + 'ANOTHER note instead (cross-note form: share only the form note, keep '
  + 'responses private). `table` is the 0-based table index within the responses '
  + 'note (default 0). Options mirror the visual builder: required[] (must fill), '
  + 'email[] (validate as email), hidden[] (don\'t show), order[] (field order), '
  + 'labels{col:label} / help{col:text} overrides, stamp (column auto-filled with '
  + 'the submit timestamp), closesAt (ISO date) and maxResponses (close after N). '
  + 'A note can hold several forms. Chain focus_note to show the result.',
  {
    name: z.string(),
    table: z.number().int().min(0).optional(),
    responsesNote: z.string().optional(),
    ...FORM_FIELD_SCHEMA,
  },
  async (args) => withSession(async (s) => {
    const { name, table, responsesNote } = args;
    const f = resolveNoteRef(s, name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = String(await s.readContent(f.id));
    const cfg = {};
    let anchorIdx;
    let headers = [];
    if (responsesNote) {
      const tgt = resolveNoteRef(s, responsesNote);
      if (!tgt) throw new Error(`responsesNote not found: ${responsesNote}`);
      const tgtTables = parseTablesForForms(String(await s.readContent(tgt.id)));
      if (!tgtTables.length) throw new Error(`responsesNote "${tgt.name}" has no table to collect responses — add one first`);
      const ti = Number.isFinite(table) ? table : 0;
      if (!tgtTables[ti]) throw new Error(`table index ${ti} out of range — "${tgt.name}" has ${tgtTables.length} table(s)`);
      cfg.note = tgt.id;
      cfg.table = ti;
      headers = tgtTables[ti].headers;
      anchorIdx = -1; // no local table to anchor above → append the block
    } else {
      const tables = parseTablesForForms(content);
      if (!tables.length) throw new Error(`note "${f.name}" has no table — add a markdown table first, or pass responsesNote pointing at a note that has one`);
      const ti = Number.isFinite(table) ? table : 0;
      if (!tables[ti]) throw new Error(`table index ${ti} out of range — "${f.name}" has ${tables.length} table(s)`);
      cfg.table = ti;
      headers = tables[ti].headers;
      anchorIdx = ti;
    }
    applyFormFields(cfg, args);
    const newSrc = insertFormBlock(content, anchorIdx, cfg);
    await s.writeContent(f.id, newSrc);
    const formIndex = parseFormBlocks(newSrc).length - 1;
    s.publishMcpAction({
      kind: 'write', note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      bytes: newSrc.length,
    });
    return json(withHints({
      ok: true, note: f.name, noteId: f.id, formIndex,
      crossNote: !!cfg.note, config: cfg, fields: headers,
    }, [
      { tool: 'focus_note', args: { name: f.name }, reason: 'open the note so the user sees the new form' },
    ]));
  }),
);

server.tool(
  'update_form',
  'Edit an existing form\'s configuration in place. `formIndex` selects which '
  + 'form (0-based, default 0; use list_forms to see them). Provide only the '
  + 'fields you want to change — they are merged over the current config. Use '
  + '`clear` to remove keys entirely (e.g. ["closesAt","maxResponses"] to reopen '
  + 'a closed form). Pass `table` and/or `responsesNote` to retarget where '
  + 'responses are written.',
  {
    name: z.string(),
    formIndex: z.number().int().min(0).optional(),
    table: z.number().int().min(0).optional(),
    responsesNote: z.string().optional(),
    clear: z.array(z.string()).optional(),
    ...FORM_FIELD_SCHEMA,
  },
  async (args) => withSession(async (s) => {
    const { name, formIndex, table, responsesNote, clear } = args;
    const f = resolveNoteRef(s, name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = String(await s.readContent(f.id));
    const blocks = parseFormBlocks(content);
    const idx = Number.isFinite(formIndex) ? formIndex : 0;
    if (!blocks[idx]) throw new Error(`form index ${idx} out of range — note has ${blocks.length} form(s)`);
    const cfg = { ...blocks[idx].json };
    if (responsesNote) {
      const tgt = resolveNoteRef(s, responsesNote);
      if (!tgt) throw new Error(`responsesNote not found: ${responsesNote}`);
      cfg.note = tgt.id;
    }
    if (Number.isFinite(table)) cfg.table = table;
    applyFormFields(cfg, args);
    if (Array.isArray(clear)) for (const k of clear) delete cfg[k];
    const newSrc = writeFormBlockConfig(content, idx, cfg);
    await s.writeContent(f.id, newSrc);
    s.publishMcpAction({
      kind: 'write', note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      bytes: newSrc.length,
    });
    return json(withHints({ ok: true, note: f.name, noteId: f.id, formIndex: idx, config: cfg }, [
      { tool: 'focus_note', args: { name: f.name }, reason: 'show the updated form' },
    ]));
  }),
);

server.tool(
  'list_forms',
  'List the forms defined in a note, with each form\'s config, target table '
  + '(may live in another note for cross-note forms), the derived field names, '
  + 'and how many responses have been collected so far.',
  { name: z.string() },
  async ({ name }) => withSession(async (s) => {
    const f = resolveNoteRef(s, name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = String(await s.readContent(f.id));
    const blocks = parseFormBlocks(content);
    const localTables = parseTablesForForms(content);
    const forms = [];
    for (let i = 0; i < blocks.length; i++) {
      const cfg = blocks[i].json || {};
      let target = null;
      if (cfg.note) {
        const tgt = resolveNoteRef(s, String(cfg.note));
        if (tgt) {
          const tt = parseTablesForForms(String(await s.readContent(tgt.id)));
          const ti = Number.isFinite(cfg.table) && tt[cfg.table] ? cfg.table : 0;
          if (tt[ti]) target = { noteId: tgt.id, note: tgt.name, crossNote: true, tableIndex: ti, fields: tt[ti].headers, responseCount: tt[ti].rows.length };
        }
        if (!target) target = { noteId: String(cfg.note), crossNote: true, note: null, unresolved: true };
      } else {
        const r = resolveFormTable(localTables, blocks[i], cfg);
        if (r) target = { noteId: f.id, note: f.name, crossNote: false, tableIndex: r.tableIdx, fields: r.table.headers, responseCount: r.table.rows.length };
      }
      forms.push({ index: i, config: cfg, target });
    }
    return json({ note: f.name, noteId: f.id, formCount: forms.length, forms });
  }),
);

server.tool(
  'delete_form',
  'Remove a form block from a note. `formIndex` is 0-based (default 0). This '
  + 'deletes only the form definition; the underlying table and any collected '
  + 'responses are left untouched.',
  { name: z.string(), formIndex: z.number().int().min(0).optional() },
  async ({ name, formIndex }) => withSession(async (s) => {
    const f = resolveNoteRef(s, name);
    if (!f) throw new Error(`not found: ${name}`);
    const content = String(await s.readContent(f.id));
    const blocks = parseFormBlocks(content);
    const idx = Number.isFinite(formIndex) ? formIndex : 0;
    if (!blocks[idx]) throw new Error(`form index ${idx} out of range — note has ${blocks.length} form(s)`);
    const newSrc = removeFormBlock(content, idx);
    await s.writeContent(f.id, newSrc);
    s.publishMcpAction({
      kind: 'write', note: f.name, noteId: f.id,
      vault: s.vaultName(f.vaultId), vaultId: f.vaultId || 'default',
      bytes: newSrc.length,
    });
    return json({ ok: true, note: f.name, noteId: f.id, removedFormIndex: idx, remainingForms: blocks.length - 1 });
  }),
);

// Salida garantizada: el cliente manda SIGINT/SIGTERM o cierra stdin; si
// stopAgentPresence (red) se cuelga, se sale igual a los 1,5 s (antes el
// cliente acababa matando el proceso con SIGKILL).
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  setTimeout(() => process.exit(0), 1500);
  Promise.resolve().then(() => stopAgentPresence()).catch(() => {}).finally(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGHUP', shutdown);
process.stdin.once('close', shutdown);
process.stdin.once('end', shutdown);
// Cliente desaparecido → EPIPE al escribir: salir en vez de quedar zombi.
process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') shutdown(); });

// Keep the process alive across unhandled errors so a single bad call
// doesn't take the MCP transport down. The host sees the tool error and
// users can keep working. Errors are logged to stderr (captured by the
// host's MCP log viewer) for postmortem.
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EPIPE') { shutdown(); return; }
  try { process.stderr.write(`[edinot-mcp] uncaughtException: ${err && err.stack || err}\n`); } catch {}
});
process.on('unhandledRejection', (reason) => {
  try { process.stderr.write(`[edinot-mcp] unhandledRejection: ${reason && reason.stack || reason}\n`); } catch {}
});

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  startAgentPresence().catch(() => {});
})().catch((e) => {
  process.stderr.write(`[edinot-mcp] fatal: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
});
