// Comments + agent tasks store (CRDT-friendly) — SHARED between the renderer
// (editor.jsx / store.js) and the CLI/MCP store (cli/lib.mjs). Both processes
// must read and write exactly the same shape, so it lives here once.
//
// ── Why ──────────────────────────────────────────────────────────────────
// Up to v1.1.76 every comment of every note lived in ONE plain object,
// `yMeta.noteComments = { [noteId]: [comment, …] }`, and every agent task in
// ONE plain array, `yMeta.agentTasks`. Each change rewrote the whole value,
// so two peers commenting at the same time raced on a single Y.Map key and
// Yjs kept only one of the two writes (last-writer-wins): a comment, a reply
// or a task claim silently vanished.
//
// ── New shape (v2) ───────────────────────────────────────────────────────
// Three TOP-LEVEL Y.Maps on the workspace shell doc (top-level types are
// created lazily and merge cleanly; a nested Y.Map created concurrently by
// two peers would itself be a LWW conflict):
//   noteCommentsV2       commentId → comment record (no `replies` field)
//                        tombstone on delete: { id, noteId, deleted: true }
//   noteCommentRepliesV2 replyId   → { id, commentId, noteId, text, author, ts }
//                        (the inline `replies[]` of question comments)
//   agentTasksV2         taskId    → task record
// One key per record: concurrent inserts never collide, and concurrent edits
// only conflict when they touch the SAME record (then LWW per record).
//
// ── Compatibility with older apps (≤ 1.1.76) ─────────────────────────────
//   1. Readers merge: v2 maps ∪ legacy entries whose id is not in v2 (a
//      tombstone counts as "in v2", so a stale legacy copy never resurrects
//      a deleted comment).
//   2. Bridge (`attachLegacyBridge`): on load and on every change of the
//      legacy keys, legacy records are imported into v2 idempotently (only
//      missing ids; `resolved`, `awaitingReply:false`, task-status progress
//      and inline replies are merged monotonically). Deletions made by an
//      old app are honoured when the legacy write provably descended from a
//      snapshot we know (Y.Map item origin) — a concurrent stale rewrite is
//      NOT treated as a deletion.
//   3. Dual-write: every v2 write also rewrites the legacy object/array as a
//      projection of the merged view (DUAL_WRITE_LEGACY), so old apps keep
//      seeing everything. Remove the dual-write once old versions are gone
//      (planned for 1.3.0); readers + bridge stay to absorb old data.

export const COMMENTS_V2 = 'noteCommentsV2';
export const REPLIES_V2 = 'noteCommentRepliesV2';
export const TASKS_V2 = 'agentTasksV2';
export const LEGACY_COMMENTS_KEY = 'noteComments';
export const LEGACY_TASKS_KEY = 'agentTasks';
export const DUAL_WRITE_LEGACY = true;
// Written next to every legacy mirror write so peers can tell a v2 mirror
// (never a deletion signal) from a rewrite made by an older app.
export const LEGACY_MIRROR_MARK = 'noteCommentsMirrorAt';

const ORIGIN = 'edinot:comments-model';

export function commentTypes(ydoc) {
  return {
    meta: ydoc.getMap('meta'),
    comments: ydoc.getMap(COMMENTS_V2),
    replies: ydoc.getMap(REPLIES_V2),
    tasks: ydoc.getMap(TASKS_V2),
  };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const byTsThenId = (a, b) => {
  const ta = String((a && (a.ts || a.requestedAt)) || '');
  const tb = String((b && (b.ts || b.requestedAt)) || '');
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ia = String((a && a.id) || ''); const ib = String((b && b.id) || '');
  return ia < ib ? -1 : ia > ib ? 1 : 0;
};
function stripReplies(c) {
  const { replies, ...rest } = c || {};
  return rest;
}
function legacyCommentsOf(meta) {
  const v = meta.get(LEGACY_COMMENTS_KEY);
  return isObj(v) ? v : {};
}
function legacyTasksOf(meta) {
  const v = meta.get(LEGACY_TASKS_KEY);
  return Array.isArray(v) ? v : [];
}

// ── Read cache ───────────────────────────────────────────────────────────
// Readers run on every render tick; rebuilding the merged view is O(n) so we
// cache it per doc and invalidate on any change to the involved types.
const caches = new WeakMap();
function cacheFor(ydoc) {
  let c = caches.get(ydoc);
  if (c) return c;
  const ty = commentTypes(ydoc);
  c = { comments: null, tasks: null };
  const dropComments = () => { c.comments = null; };
  const dropTasks = () => { c.tasks = null; };
  ty.comments.observe(dropComments);
  ty.replies.observe(dropComments);
  ty.tasks.observe(dropTasks);
  ty.meta.observe((ev) => {
    if (ev.keysChanged.has(LEGACY_COMMENTS_KEY)) dropComments();
    if (ev.keysChanged.has(LEGACY_TASKS_KEY)) dropTasks();
  });
  caches.set(ydoc, c);
  return c;
}
function invalidate(ydoc) {
  const c = caches.get(ydoc);
  if (c) { c.comments = null; c.tasks = null; }
}

function buildCommentsView(ydoc) {
  const { meta, comments, replies } = commentTypes(ydoc);
  const legacy = legacyCommentsOf(meta);
  const legacyById = new Map();
  for (const nid of Object.keys(legacy)) {
    const arr = Array.isArray(legacy[nid]) ? legacy[nid] : [];
    for (const c of arr) if (c && c.id) legacyById.set(c.id, { c, nid });
  }
  const byId = new Map();
  comments.forEach((v, id) => {
    if (!isObj(v)) return;
    byId.set(id, v.deleted ? null : { ...v, id, replies: [] });
  });
  for (const [id, { c, nid }] of legacyById) {
    if (byId.has(id)) continue;
    byId.set(id, { ...c, noteId: c.noteId || nid, replies: [] });
  }
  // Inline replies: v2 entries + any legacy reply not yet imported.
  const replyIds = new Set();
  replies.forEach((r, rid) => {
    if (!isObj(r) || r.deleted) return;
    const target = byId.get(r.commentId);
    if (!target) return;
    replyIds.add(rid);
    const { commentId, noteId, ...rest } = r;
    target.replies.push({ ...rest, id: rid });
  });
  for (const [id, { c }] of legacyById) {
    const target = byId.get(id);
    if (!target || !Array.isArray(c.replies)) continue;
    for (const r of c.replies) {
      if (!r || !r.id || replyIds.has(r.id)) continue;
      replyIds.add(r.id);
      target.replies.push({ ...r });
    }
  }
  const out = {};
  for (const c of byId.values()) {
    if (!c) continue;
    if (c.replies.length > 1) c.replies.sort(byTsThenId);
    const nid = c.noteId || '';
    (out[nid] || (out[nid] = [])).push(c);
  }
  for (const nid of Object.keys(out)) out[nid].sort(byTsThenId);
  return out;
}

function buildTasksView(ydoc) {
  const { meta, tasks } = commentTypes(ydoc);
  const byId = new Map();
  tasks.forEach((v, id) => { if (isObj(v)) byId.set(id, { ...v, id }); });
  for (const t of legacyTasksOf(meta)) {
    if (t && t.id && !byId.has(t.id)) byId.set(t.id, { ...t });
  }
  return Array.from(byId.values()).sort(byTsThenId);
}

/** Merged `{ [noteId]: Comment[] }` (legacy shape, replies nested). Treat as read-only. */
export function readCommentsMap(ydoc) {
  const c = cacheFor(ydoc);
  if (!c.comments) c.comments = buildCommentsView(ydoc);
  return c.comments;
}
/** Comments of one note (fresh array; records are shared, don't mutate). */
export function readNoteComments(ydoc, noteId) {
  const list = readCommentsMap(ydoc)[noteId];
  return Array.isArray(list) ? list.slice() : [];
}
export function readAllComments(ydoc) {
  return Object.values(readCommentsMap(ydoc)).flat();
}
export function findComment(ydoc, id) {
  if (!id) return null;
  for (const c of readAllComments(ydoc)) if (c.id === id) return c;
  return null;
}
/** Merged agent tasks, oldest first. Treat as read-only. */
export function readAgentTasks(ydoc) {
  const c = cacheFor(ydoc);
  if (!c.tasks) c.tasks = buildTasksView(ydoc);
  return c.tasks.slice();
}

// ── Legacy mirror (dual-write) ───────────────────────────────────────────
function writeLegacyMirror(ydoc, { comments = true, tasks = true } = {}) {
  if (!DUAL_WRITE_LEGACY) return;
  const { meta } = commentTypes(ydoc);
  invalidate(ydoc);
  if (comments) {
    const view = readCommentsMap(ydoc);
    const proj = {};
    for (const nid of Object.keys(view)) {
      if (!nid) continue;
      proj[nid] = view[nid].map(c => ({ ...c, replies: c.replies.slice() }));
    }
    if (JSON.stringify(proj) !== JSON.stringify(legacyCommentsOf(meta))) {
      meta.set(LEGACY_COMMENTS_KEY, proj);
      meta.set(LEGACY_MIRROR_MARK, Date.now());
    }
  }
  if (tasks) {
    const list = readAgentTasks(ydoc);
    if (JSON.stringify(list) !== JSON.stringify(legacyTasksOf(meta))) meta.set(LEGACY_TASKS_KEY, list);
  }
}

function tx(ydoc, fn) {
  let result;
  ydoc.transact(() => { result = fn(); }, ORIGIN);
  invalidate(ydoc);
  return result;
}

// ── Comment writers ──────────────────────────────────────────────────────
/** Insert/replace a whole comment record. Its `replies[]` (if any) are stored as separate entries. */
export function putComment(ydoc, rec) {
  if (!rec || !rec.id) throw new Error('putComment: id required');
  if (!rec.noteId) throw new Error('putComment: noteId required');
  const { comments, replies } = commentTypes(ydoc);
  return tx(ydoc, () => {
    comments.set(rec.id, stripReplies(rec));
    if (Array.isArray(rec.replies)) {
      for (const r of rec.replies) {
        if (r && r.id && !replies.has(r.id)) replies.set(r.id, { ...r, commentId: rec.id, noteId: rec.noteId });
      }
    }
    writeLegacyMirror(ydoc, { tasks: false });
    return rec;
  });
}
/** Shallow-merge `patch` (object or fn(current) → object) into one comment. Returns the new record or null. */
export function patchComment(ydoc, id, patch) {
  const cur = findComment(ydoc, id);
  if (!cur) return null;
  const delta = typeof patch === 'function' ? patch(cur) : patch;
  if (!delta) return cur;
  const { comments } = commentTypes(ydoc);
  return tx(ydoc, () => {
    const base = isObj(comments.get(id)) && !comments.get(id).deleted ? comments.get(id) : stripReplies(cur);
    const next = { ...stripReplies(base), ...stripReplies(delta), id, noteId: cur.noteId };
    comments.set(id, next);
    writeLegacyMirror(ydoc, { tasks: false });
    return { ...next, replies: cur.replies };
  });
}
/** Patch many comments of a note matching `pred` in one transaction. */
export function patchComments(ydoc, noteId, pred, patch) {
  const list = readNoteComments(ydoc, noteId).filter(pred);
  if (!list.length) return 0;
  const { comments } = commentTypes(ydoc);
  tx(ydoc, () => {
    for (const cur of list) {
      const delta = typeof patch === 'function' ? patch(cur) : patch;
      comments.set(cur.id, { ...stripReplies(cur), ...stripReplies(delta), id: cur.id, noteId: cur.noteId });
    }
    writeLegacyMirror(ydoc, { tasks: false });
  });
  return list.length;
}
/** Tombstone comments by id. Returns how many existed. */
export function deleteComments(ydoc, ids) {
  const want = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
  const found = readAllComments(ydoc).filter(c => want.has(c.id));
  if (!found.length) return 0;
  const { comments } = commentTypes(ydoc);
  const now = new Date().toISOString();
  tx(ydoc, () => {
    for (const c of found) comments.set(c.id, { id: c.id, noteId: c.noteId, deleted: true, deletedAt: now });
    writeLegacyMirror(ydoc, { tasks: false });
  });
  return found.length;
}
/** Append an inline reply (legacy `replies[]` model) to a comment. */
export function addCommentReply(ydoc, commentId, reply) {
  const cur = findComment(ydoc, commentId);
  if (!cur) return null;
  const rec = {
    id: reply.id || ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
    text: String(reply.text || ''),
    author: reply.author || 'user',
    ts: reply.ts || new Date().toISOString(),
  };
  const { comments, replies } = commentTypes(ydoc);
  return tx(ydoc, () => {
    replies.set(rec.id, { ...rec, commentId, noteId: cur.noteId });
    if (cur.awaitingReply !== false) comments.set(commentId, { ...stripReplies(cur), awaitingReply: false });
    writeLegacyMirror(ydoc, { tasks: false });
    return { comment: { ...cur, awaitingReply: false, replies: [...cur.replies, rec] }, reply: rec };
  });
}

// ── Agent task writers ───────────────────────────────────────────────────
export function putAgentTasks(ydoc, list) {
  const arr = (Array.isArray(list) ? list : [list]).filter(t => t && t.id);
  if (!arr.length) return [];
  const { tasks } = commentTypes(ydoc);
  return tx(ydoc, () => {
    for (const t of arr) tasks.set(t.id, { ...t });
    writeLegacyMirror(ydoc, { comments: false });
    return arr;
  });
}
/** Merge `patch` (object or fn(current) → object|null) into one task. Returns the new task or null. */
export function patchAgentTask(ydoc, id, patch) {
  const cur = readAgentTasks(ydoc).find(t => t.id === id);
  if (!cur) return null;
  const delta = typeof patch === 'function' ? patch(cur) : patch;
  if (!delta) return cur;
  const next = { ...cur, ...delta, id };
  putAgentTasks(ydoc, [next]);
  return next;
}

// ── Legacy → v2 migration / bridge ───────────────────────────────────────
const TASK_RANK = { 'pending-offline': 0, pending: 0, running: 1, done: 2, failed: 2 };
const rankOf = (t) => TASK_RANK[String((t && t.status) || 'pending')] ?? 0;

/**
 * Idempotent import of the legacy shape into the v2 maps. Safe to call any
 * number of times from any number of peers concurrently (identical writes).
 * Returns counts of what was written.
 */
export function migrateLegacy(ydoc) {
  const { meta, comments, replies, tasks } = commentTypes(ydoc);
  const legacy = legacyCommentsOf(meta);
  const legacyTasks = legacyTasksOf(meta);
  const stats = { comments: 0, replies: 0, tasks: 0, updated: 0 };
  const writes = [];
  for (const nid of Object.keys(legacy)) {
    const arr = Array.isArray(legacy[nid]) ? legacy[nid] : [];
    for (const c of arr) {
      if (!c || !c.id) continue;
      const noteId = c.noteId || nid;
      const cur = comments.get(c.id);
      if (!isObj(cur)) {
        writes.push(() => comments.set(c.id, { ...stripReplies(c), noteId }));
        stats.comments++;
      } else if (!cur.deleted) {
        // Monotonic fields an old app may have changed on a migrated comment.
        const patch = {};
        if (c.resolved === true && cur.resolved !== true) { patch.resolved = true; if (c.resolvedAt) patch.resolvedAt = c.resolvedAt; }
        if (c.awaitingReply === false && cur.awaitingReply === true) patch.awaitingReply = false;
        if (Object.keys(patch).length) {
          writes.push(() => comments.set(c.id, { ...cur, ...patch }));
          stats.updated++;
        }
      }
      if (Array.isArray(c.replies)) {
        for (const r of c.replies) {
          if (!r || !r.id || replies.has(r.id)) continue;
          writes.push(() => replies.set(r.id, { ...r, commentId: c.id, noteId }));
          stats.replies++;
        }
      }
    }
  }
  for (const t of legacyTasks) {
    if (!t || !t.id) continue;
    const cur = tasks.get(t.id);
    if (!isObj(cur)) {
      writes.push(() => tasks.set(t.id, { ...t }));
      stats.tasks++;
    } else if (rankOf(t) > rankOf(cur)) {
      writes.push(() => tasks.set(t.id, { ...cur, ...t }));
      stats.updated++;
    }
  }
  if (writes.length) {
    ydoc.transact(() => { for (const w of writes) w(); }, ORIGIN);
    invalidate(ydoc);
  }
  return stats;
}

function legacyItem(meta, key) {
  try {
    const it = meta._map && meta._map.get(key);
    return it && !it.deleted ? it : null;
  } catch { return null; }
}
const itemLastKey = (it) => it ? `${it.id.client}:${it.id.clock + it.length - 1}` : null;
const itemOriginKey = (it) => (it && it.origin) ? `${it.origin.client}:${it.origin.clock}` : null;
function legacyIdSet(meta) {
  const s = new Set();
  const legacy = legacyCommentsOf(meta);
  for (const nid of Object.keys(legacy)) {
    const arr = Array.isArray(legacy[nid]) ? legacy[nid] : [];
    for (const c of arr) if (c && c.id) s.add(c.id);
  }
  return s;
}

/**
 * Run the migration now and keep absorbing legacy writes made by older apps.
 * Returns a detach function. Attach once per doc.
 */
const bridges = new WeakMap();
export function attachLegacyBridge(ydoc) {
  if (bridges.has(ydoc)) return bridges.get(ydoc);
  const { meta, comments, replies, tasks: tasksMap } = commentTypes(ydoc);
  // Snapshot cache: legacy Y.Map item (last id) → comment ids it contained.
  // Lets us tell "an old app deleted X from the copy it had seen" apart from
  // "an old app rewrote a stale copy that never contained X".
  const snapshots = new Map();
  const remember = () => {
    const key = itemLastKey(legacyItem(meta, LEGACY_COMMENTS_KEY));
    if (!key) return;
    snapshots.set(key, legacyIdSet(meta));
    while (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value);
  };
  const onMeta = (ev, tr) => {
    const kc = ev.keysChanged;
    if (!kc.has(LEGACY_COMMENTS_KEY) && !kc.has(LEGACY_TASKS_KEY)) return;
    if (kc.has(LEGACY_COMMENTS_KEY) && !tr.local && !kc.has(LEGACY_MIRROR_MARK)
        && !tr.changed.has(comments) && !tr.changed.has(replies)) {
      // Pure legacy write from an older app (v2 apps always touch the v2
      // maps in the same transaction as their mirror write).
      const it = legacyItem(meta, LEGACY_COMMENTS_KEY);
      const base = snapshots.get(itemOriginKey(it));
      if (base) {
        const now = legacyIdSet(meta);
        const gone = [...base].filter(id => !now.has(id));
        const kill = gone.filter(id => { const c = comments.get(id); return isObj(c) && !c.deleted; });
        if (kill.length) {
          ydoc.transact(() => {
            for (const id of kill) {
              const c = comments.get(id);
              comments.set(id, { id, noteId: c.noteId, deleted: true, deletedAt: new Date().toISOString() });
            }
          }, ORIGIN);
          invalidate(ydoc);
        }
      }
    }
    if (kc.has(LEGACY_COMMENTS_KEY)) remember();
    migrateLegacy(ydoc);
  };
  // Mirror repair: two v2 peers writing concurrently both rewrite the legacy
  // key and only one rewrite survives, so the legacy copy older apps read can
  // miss a record that v2 has. After any remote change, one jittered check
  // re-projects it if it drifted (the first repair to land makes the rest
  // no-ops: they then see an up-to-date copy).
  let repairTimer = null;
  const scheduleRepair = () => {
    if (!DUAL_WRITE_LEGACY || repairTimer) return;
    repairTimer = setTimeout(() => {
      repairTimer = null;
      try { ydoc.transact(() => writeLegacyMirror(ydoc), ORIGIN); }
      catch (err) { console.warn('[comments] mirror repair failed:', err && err.message); }
    }, 400 + Math.floor(Math.random() * 1200));
    if (repairTimer && typeof repairTimer.unref === 'function') repairTimer.unref();
  };
  const onRemote = (tr) => {
    if (tr.local) return;
    if (tr.changed.has(comments) || tr.changed.has(replies) || tr.changed.has(tasksMap)) scheduleRepair();
    else if (tr.changed.has(meta)) {
      const keys = tr.changed.get(meta);
      if (keys && (keys.has(LEGACY_COMMENTS_KEY) || keys.has(LEGACY_TASKS_KEY))) scheduleRepair();
    }
  };
  ydoc.on('afterTransaction', onRemote);
  remember();
  try { migrateLegacy(ydoc); } catch (err) { console.warn('[comments] migration failed:', err && err.message); }
  const safeOnMeta = (ev, tr) => {
    try { onMeta(ev, tr); } catch (err) { console.warn('[comments] bridge failed:', err && err.message); }
  };
  meta.observe(safeOnMeta);
  const detach = () => {
    meta.unobserve(safeOnMeta);
    ydoc.off('afterTransaction', onRemote);
    if (repairTimer) clearTimeout(repairTimer);
    bridges.delete(ydoc);
  };
  bridges.set(ydoc, detach);
  return detach;
}

/** Root of the thread `comment` belongs to (walks parentId). */
export function threadRootIdOf(comment, list) {
  if (!comment) return null;
  const byId = new Map((list || []).map(c => [c.id, c]));
  let root = comment;
  const seen = new Set();
  while (root && root.parentId && !seen.has(root.id)) {
    seen.add(root.id);
    root = byId.get(root.parentId) || null;
  }
  return (root && root.id) || comment.id;
}
