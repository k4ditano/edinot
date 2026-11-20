// Edinot — yjs-backed shared state.
//
// Single Y.Doc holds: vaults, files (as plain JS objects in Y.Map),
// settings, meta. Per-file markdown content lives in its own Y.Text
// keyed `content:{id}` — that's where collaborative editing happens.
//
// Phase 0: only local persistence via y-indexeddb. Server sync (Hocuspocus)
// connects on demand when user configures it.

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  canvasTypes as _canvasTypes,
  readCanvasSnapshot as _canvasRead,
  applyCanvasSnapshot as _canvasApply,
  seedCanvasFromJson as _canvasSeed,
  isCanvasMigrated as _canvasMigrated,
  serializeCanvasDeterministic as _canvasSerialize,
} from './shared/canvas-model.js';
import { commentTypes as _commentTypes, attachLegacyBridge as _attachCommentsBridge } from './shared/comments-model.js';
import { normalizeCollection } from './shared/collections.js';

const DOC_NAME = 'edinot-v1';
const LS_STATE_KEY = 'markedit.state.v1';
const LS_MIGRATED_KEY = 'edinot.ydoc.migrated.v1';
const LS_SYNC_KEY = 'edinot.sync.config.v1';

export const ydoc = new Y.Doc();
export const yVaults   = ydoc.getMap('vaults');
// Workspace-level Y.Maps. yFolders + yFiles are wrapped in a proxy
// below so that, when per-vault mode is ON, every access (.get/.set/
// .observe/.values/…) routes to the active vault's Y.Map without
// callers needing to know. Proxies re-subscribe their observers when
// the active vault flips OR when the feature flag toggles.
const _yFoldersLegacy = ydoc.getMap('folders');
const _yFilesLegacy   = ydoc.getMap('files');
export const ySettings = ydoc.getMap('settings');
export const yMeta     = ydoc.getMap('meta');
// Comments + agent tasks: one Y.Map entry per record (shared/comments-model.js)
// instead of the legacy whole-object yMeta.noteComments / yMeta.agentTasks,
// so concurrent comments no longer overwrite each other. The bridge imports
// legacy data (IndexedDB load, server sync, writes from older apps) as it
// arrives and keeps dual-writing the legacy keys for older apps.
const _commentsTypes = _commentTypes(ydoc);
export const yCommentsV2       = _commentsTypes.comments;
export const yCommentRepliesV2 = _commentsTypes.replies;
export const yAgentTasksV2     = _commentsTypes.tasks;
_attachCommentsBridge(ydoc);

// ─── Persistencia local blindada ───────────────────────────────────────
// y-indexeddb escribe DENTRO del observador `update` del Y.Doc, y su única
// guarda es que `this.db` no sea null. Cuando Chromium cierra la conexión
// por debajo (renderer en segundo plano, transacción abortada, presión de
// almacenamiento) `this.db` sigue puesto pero `idb.transact` lanza
// InvalidStateError de forma SÍNCRONA desde el observador. La excepción
// emerge en el `yMap.set(...)` inocente que disparó la actualización, se
// escapa de React y se lleva por delante todo el renderer: es la pantalla
// en blanco de un solo color.
//
// Envolvemos toda persistencia que creamos. Si escribir falla —o si la
// conexión anuncia su cierre— la desenganchamos: destroy() quita el
// observador, el documento sigue funcionando en memoria y por red, y lo
// único que se pierde es la caché local de ESE documento.
function makePersistence(name, doc) {
  let p;
  try {
    p = new IndexeddbPersistence(name, doc);
  } catch (err) {
    console.warn('[idb] no se pudo abrir la persistencia de', name, '—', err && err.message);
    return null;
  }
  let detached = false;
  const detach = (why) => {
    if (detached) return;
    detached = true;
    console.warn('[idb] desenganchando persistencia de', name, '—', why);
    try { Promise.resolve(p.destroy()).catch(() => {}); } catch {}
  };
  // Sustituimos el observador por uno que no puede tumbar el renderer.
  // destroy() hace `off` sobre el valor ACTUAL de _storeUpdate, así que
  // reasignarlo antes de re-registrar mantiene el desmontaje correcto.
  const original = p._storeUpdate;
  doc.off('update', original);
  p._storeUpdate = (update, origin) => {
    try { original(update, origin); }
    catch (err) { detach((err && err.message) || String(err)); }
  };
  doc.on('update', p._storeUpdate);
  // Chromium avisa con `close` cuando tira la conexión. Engancharse ahí
  // nos permite desistir antes de la primera escritura fallida.
  p.whenSynced
    .then(() => { try { p.db && p.db.addEventListener('close', () => detach('la conexión se cerró')); } catch {} })
    .catch(() => {});
  return p;
}

export const indexeddb = makePersistence(DOC_NAME, ydoc);

// Sin persistencia (IndexedDB bloqueado o roto) la app sigue siendo usable
// contra el servidor: damos la hidratación local por terminada en vez de
// dejar el velo de arranque colgado para siempre.
let indexeddbReady = !indexeddb;
if (indexeddb) indexeddb.once('synced', () => { indexeddbReady = true; });
export const whenIndexedDbReady = () =>
  indexeddbReady ? Promise.resolve() : new Promise(res => indexeddb.once('synced', res));

// ─── Disk export (one-way Y.Doc → .md) ───────────────────────────────────
// Mirrors every note to disk via Electron IPC. Renderer batches changes and
// sends a debounced snapshot — main does the real fs work.
const exportObserved = new Set();
const exportPending = new Set();
let exportFlushTimer = null;
let exportFullPending = false;

function diskExportAvailable() {
  return typeof window !== 'undefined' && window.electronAPI && window.electronAPI.exportApply;
}

// El espejo a disco no hace falta para el primer frame, y la primera pasada
// serializa TODAS las notas de TODOS los vaults y las manda por IPC justo
// cuando IndexedDB termina de hidratar (y otra vez por cada vault que
// engancha). Durante los primeros segundos de vida se agrupa todo en una
// sola pasada que espera a que el hilo esté libre.
const EXPORT_BOOT_HOLD_MS = 8000;
const exportHoldUntil = Date.now() + EXPORT_BOOT_HOLD_MS;

function scheduleExportFlush() {
  if (!diskExportAvailable()) return;
  if (exportFlushTimer) return;
  const hold = exportHoldUntil - Date.now();
  if (hold > 0) {
    exportFlushTimer = setTimeout(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => flushExport(), { timeout: 4000 });
      else flushExport();
    }, hold);
    return;
  }
  exportFlushTimer = setTimeout(flushExport, 600);
}

// Firma de la última instantánea COMPLETA enviada a main. Los bumps de
// sincronización disparan instantáneas completas aunque nada haya cambiado;
// si la firma coincide no hace falta repetir el IPC ni el trabajo de main
// (sha256 + mkdir + access por nota).
let lastFullExportSig = null;
function fullExportSig(files, vaults, folders) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    const str = String(v);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0xff; h = Math.imul(h, 16777619);
  };
  for (const f of files) { mix(f.id); mix(f.name); mix(f.vaultId); mix(f.folderId || ''); mix(f.content); }
  for (const v of vaults) { mix(v.id); mix(v.name || ''); }
  for (const f of folders) { mix(f.id); mix(f.name || ''); mix(f.vaultId || ''); mix(f.parentId || ''); }
  return `${files.length}:${vaults.length}:${folders.length}:${h >>> 0}`;
}

async function flushExport() {
  exportFlushTimer = null;
  if (!diskExportAvailable()) return;
  // Incremental fast path: pure content edits (the hot typing path) only mark
  // `exportPending`. Structural changes (add/remove/rename/move a note, folder
  // or vault) set `exportFullPending` — those need the full snapshot so main
  // can detect deletions/renames by diffing its index. Serializing + IPC-ing
  // the ENTIRE workspace on every keystroke was the main Windows typing cost.
  const full = exportFullPending;
  const changedIds = full ? null : new Set(exportPending);
  exportPending.clear();
  exportFullPending = false;

  const allMeta = getAllFilesAcrossVaults();
  const metaSource = full
    ? allMeta
    : allMeta.filter(m => changedIds.has(m.id));
  const files = metaSource.map(m => ({
    id: m.id,
    name: m.name || 'untitled',
    vaultId: m.vaultId || 'default',
    folderId: m.folderId || null,
    content: getVaultContent(m.id).toString(),
  }));
  // In incremental mode nothing structural changed, so skip re-sending the
  // (unchanged) vault/folder tree — and if no note content changed, bail.
  if (!full && files.length === 0) return;
  const vaults = Array.from(yVaults.values()).map(v => ({ id: v.id, name: v.name }));
  const folders = getAllFoldersAcrossVaults().map(f => ({
    id: f.id, name: f.name, vaultId: f.vaultId, parentId: f.parentId || null,
  }));
  let sig = null;
  if (full) {
    sig = fullExportSig(files, vaults, folders);
    if (sig === lastFullExportSig) return;
  }
  try {
    await window.electronAPI.exportApply({ files, vaults, folders, full });
    // Un envío incremental cambia el disco: la próxima completa debe ir.
    lastFullExportSig = full ? sig : null;
  } catch (e) {
    lastFullExportSig = null;
    console.warn('[export] failed', e);
  }
}

function observeContentText(fileId) {
  if (exportObserved.has(fileId)) return;
  exportObserved.add(fileId);
  const t = getContent(fileId);
  t.observe(() => { invalidateContentString(fileId); exportPending.add(fileId); scheduleExportFlush(); });
}

// Wire up disk-export observers for a per-vault entry. Idempotent — a
// flag on the entry ensures we only attach once even if getVaultDoc is
// called repeatedly for the same vault.
function registerVaultExportHooks(entry) {
  if (!entry || entry._exportHooksAttached) return;
  entry._exportHooksAttached = true;
  if (typeof window === 'undefined') return;
  // Existing files in this vault — observe their content texts.
  for (const id of entry.yFiles.keys()) observeContentText(id);
  // New/removed files in this vault.
  entry.yFiles.observe((event) => {
    if (event && event.changes && event.changes.keys) {
      for (const [key, change] of event.changes.keys) {
        if (change && change.action === 'delete') {
          exportObserved.delete(key);
        } else {
          observeContentText(key);
        }
        exportPending.add(key);
      }
    }
    exportFullPending = true;
    scheduleExportFlush();
  });
  // Folder mutations also trigger a full re-export (folder rename → disk rename).
  entry.yFolders.observe(() => { exportFullPending = true; scheduleExportFlush(); });
  // After provider sync, files appear in batch — schedule a full export
  // so they all land on disk at once.
  exportFullPending = true;
  scheduleExportFlush();
}

// Disk-export observers registered at the bottom of this module
// (after `yFiles` / `yFolders` proxies are declared) — see
// `registerDiskExportObservers()` below the proxy block.

// Per-vault Y.Doc registry — hoisted above the proxy declarations so
// that proxy._resolve (which calls into getVaultDoc) can reach it
// during module init (yFiles.observe / yFolders.observe register
// observers synchronously and trigger _resolve immediately).
const vaultRegistry = new Map();   // vaultId → { ydoc, provider, persistence, status }

// ACL Fase D — per-note Y.Doc registry. Each note has its own doc
// + provider so the server can gate auth at note granularity, and
// blocked notes never sync their content to unauthorised clients.
// Key: noteId. Value: { ydoc, ytext, vaultId, provider, persistence, status }
const noteRegistry = new Map();

// ─── Flag-aware Y.Map proxy (Fase B C3) ────────────────────────────
// Drop-in shim with the same API as Y.Map (.get/.set/.delete/.has/
// .observe/.values/.entries/.keys/.forEach/.size/.observeDeep), that
// internally delegates to either the legacy workspace map or the
// active vault's map depending on isPerVaultMode(). Observers are
// tracked in a Set so they can be re-bound when the underlying
// target swaps (vault switch / flag toggle).
class YMapProxy {
  constructor(resolveTarget) {
    this._resolve = resolveTarget;
    this._target = null;
    this._observers = new Set();
    this._deepObservers = new Set();
    this._attachedObservers = new Set();
    this._attachedDeepObservers = new Set();
    // Initialise lazily — resolveTarget may depend on ySettings being
    // hydrated before isPerVaultMode() returns a meaningful answer.
  }
  _switchTo(next) {
    if (next === this._target) return;
    if (this._target) {
      for (const cb of this._attachedObservers) { try { this._target.unobserve(cb); } catch {} }
      for (const cb of this._attachedDeepObservers) { try { this._target.unobserveDeep(cb); } catch {} }
      this._attachedObservers.clear();
      this._attachedDeepObservers.clear();
    }
    this._target = next;
    if (next) {
      for (const cb of this._observers) {
        try { next.observe(cb); this._attachedObservers.add(cb); } catch {}
      }
      for (const cb of this._deepObservers) {
        try { next.observeDeep(cb); this._attachedDeepObservers.add(cb); } catch {}
      }
      // Best-effort: synthesise a single "everything changed" fire so
      // listeners snap to the new target's contents on swap. We pass a
      // null-ish event arg — most subscribers only care that something
      // moved + re-read from .values()/.entries().
      for (const cb of this._observers) { try { cb({ changes: { keys: new Map() }, transaction: null }, null); } catch {} }
    }
  }
  _ensure() {
    const t = this._resolve();
    if (t !== this._target) this._switchTo(t);
    return this._target;
  }
  refresh() { this._switchTo(this._resolve()); }
  get size() { const t = this._ensure(); return t ? t.size : 0; }
  get(k) { const t = this._ensure(); return t ? t.get(k) : undefined; }
  set(k, v) { const t = this._ensure(); return t ? t.set(k, v) : undefined; }
  delete(k) { const t = this._ensure(); return t ? t.delete(k) : undefined; }
  has(k) { const t = this._ensure(); return !!(t && t.has(k)); }
  keys() { const t = this._ensure(); return t ? t.keys() : [][Symbol.iterator](); }
  values() { const t = this._ensure(); return t ? t.values() : [][Symbol.iterator](); }
  entries() { const t = this._ensure(); return t ? t.entries() : [][Symbol.iterator](); }
  forEach(fn) { const t = this._ensure(); if (t) t.forEach(fn); }
  observe(cb) {
    this._observers.add(cb);
    const t = this._ensure();
    if (t && !this._attachedObservers.has(cb)) {
      try { t.observe(cb); this._attachedObservers.add(cb); } catch {}
    }
  }
  unobserve(cb) {
    this._observers.delete(cb);
    if (this._target && this._attachedObservers.has(cb)) {
      try { this._target.unobserve(cb); } catch {}
      this._attachedObservers.delete(cb);
    }
  }
  observeDeep(cb) {
    this._deepObservers.add(cb);
    const t = this._ensure();
    if (t && !this._attachedDeepObservers.has(cb)) {
      try { t.observeDeep(cb); this._attachedDeepObservers.add(cb); } catch {}
    }
  }
  unobserveDeep(cb) {
    this._deepObservers.delete(cb);
    if (this._target && this._attachedDeepObservers.has(cb)) {
      try { this._target.unobserveDeep(cb); } catch {}
      this._attachedDeepObservers.delete(cb);
    }
  }
  // Some callers chain `[Symbol.iterator]` on the map — make that work.
  [Symbol.iterator]() { return this.entries(); }
  // Y.Map specific: doc accessor used by some helpers (yCollab etc).
  get doc() { const t = this._ensure(); return t ? t.doc : null; }
}

// `yFolders` / `yFiles` are now proxies. When flag OFF, .target =
// legacy workspace map (so nothing changes). When ON, .target = the
// active vault's corresponding map. Existing callsites work unchanged.
export const yFolders = new YMapProxy(() => {
  if (!isPerVaultMode()) return _yFoldersLegacy;
  const e = getActiveVaultDoc();
  return e ? e.yFolders : _yFoldersLegacy;
});
export const yFiles = new YMapProxy(() => {
  if (!isPerVaultMode()) return _yFilesLegacy;
  const e = getActiveVaultDoc();
  return e ? e.yFiles : _yFilesLegacy;
});

// Refresh proxies whenever the active vault changes (shell yMeta key
// 'activeVault') OR when the per-vault flag is toggled in ySettings.
if (typeof window !== 'undefined') {
  try {
    yMeta.observe((e) => {
      if (e && e.changes && e.changes.keys && e.changes.keys.has('activeVault')) {
        yFiles.refresh();
        yFolders.refresh();
      }
    });
    ySettings.observe((e) => {
      if (e && e.changes && e.changes.keys && e.changes.keys.has('usePerVaultDocs')) {
        yFiles.refresh();
        yFolders.refresh();
      }
    });
  } catch { /* observer registration shouldn't fail; if it does the proxies still work, just no auto-refresh */ }

  // Workspace-shell observers — yVaults only lives on the shell doc.
  yVaults.observe(() => { exportFullPending = true; scheduleExportFlush(); });

  // Disk-export observers fire on EVERY vault, not just the active one.
  // Each vault entry attaches its own yFiles/yFolders/content observers
  // the first time it lands in the registry (registerVaultExportHooks
  // is called from getVaultDoc). At cold start we still need to walk
  // any pre-existing entries — none exist yet at this point, so the
  // first attach happens lazily from getVaultDoc.
  whenIndexedDbReady().then(() => {
    exportFullPending = true;
    scheduleExportFlush();
  });
}

export function getContent(fileId) {
  // ACL Fase D — prefer the per-note Y.Doc when its provider has been
  // connected. Fallback to the vault doc's content:{id} Y.Text covers
  // the loading window before connectNoteProvider's onSynced fires,
  // OR notes whose per-note doc hasn't been seeded yet (server
  // migrates lazily on first connect).
  const note = noteRegistry.get(fileId);
  if (note && note.ytext) return note.ytext;
  if (isPerVaultMode()) {
    // Find which vault doc this file lives in — content access must
    // follow the metadata. Without this, opening a note from another
    // vault while activeVault=X would read an empty Y.Text from X.
    const located = locateFileAcrossVaults(fileId);
    if (located) return located.doc.getText('content:' + fileId);
    const e = getActiveVaultDoc();
    if (e) return e.getContent(fileId);
  }
  return ydoc.getText('content:' + fileId);
}

// ─── Incremental content-string cache (Fase 4) ─────────────────────────
// getContent(fileId).toString() is O(text length). The editor's `files`
// memo used to call it for EVERY note on every keystroke / note-switch
// (O(N) re-serialization), which is what made search + backlinks scale
// badly. Cache the serialized string per note and recompute only when that
// note's content actually changes. Invalidation rides the same Y.Text
// observers that already power disk-export (observeContentText + the
// per-note observer in getNoteDoc), plus an explicit clear when a note's
// content source switches from the vault doc to its per-note doc on open.
const contentStringCache = new Map();   // fileId → string

export function invalidateContentString(fileId) {
  contentStringCache.delete(fileId);
}

export function getContentString(fileId) {
  const hit = contentStringCache.get(fileId);
  if (hit !== undefined) return hit;
  const t = getContent(fileId);
  const s = t ? t.toString() : '';
  contentStringCache.set(fileId, s);
  return s;
}

export function getVaultContent(fileId) {
  if (isPerVaultMode()) {
    const located = locateFileAcrossVaults(fileId);
    if (located) return located.doc.getText('content:' + fileId);
    const e = getActiveVaultDoc();
    if (e) return e.getContent(fileId);
  }
  return ydoc.getText('content:' + fileId);
}

export function mirrorContentToVault(fileId, value) {
  const t = getVaultContent(fileId);
  if (!t) return;
  const text = value == null ? '' : String(value);
  if (t.toString() === text) return;
  t.doc.transact(() => {
    if (t.length > 0) t.delete(0, t.length);
    if (text) t.insert(0, text);
  });
}

export function setContent(fileId, value) {
  const t = getContent(fileId);
  ydoc.transact(() => {
    if (t.length > 0) t.delete(0, t.length);
    if (value) t.insert(0, value);
  });
  mirrorContentToVault(fileId, value);
}

export function deleteContent(fileId) {
  const t = getContent(fileId);
  if (t.length > 0) t.delete(0, t.length);
  mirrorContentToVault(fileId, '');
}

export function migrateFromLocalStorage() {
  if (localStorage.getItem(LS_MIGRATED_KEY)) return false;
  const raw = localStorage.getItem(LS_STATE_KEY);
  if (!raw) {
    localStorage.setItem(LS_MIGRATED_KEY, '1');
    return false;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return false; }

  ydoc.transact(() => {
    for (const v of parsed.vaults || []) {
      // Conserva color/icono y demás campos del vault.
      yVaults.set(v.id, { ...v, id: v.id, name: v.name });
    }
    for (const f of parsed.files || []) {
      yFiles.set(f.id, {
        id: f.id,
        name: f.name,
        vaultId: f.vaultId || 'default',
        size: f.size || '0.0 KB',
        ...(f.__path ? { __path: f.__path } : {}),
      });
      const t = getContent(f.id);
      if (t.length === 0 && f.content) t.insert(0, f.content);
    }
    for (const [k, v] of Object.entries(parsed.settings || {})) ySettings.set(k, v);
    if (parsed.activeId)    yMeta.set('activeId', parsed.activeId);
    if (parsed.activeVault) yMeta.set('activeVault', parsed.activeVault);
    if (parsed.themeKey)    yMeta.set('themeKey', parsed.themeKey);
  });
  localStorage.setItem(LS_MIGRATED_KEY, '1');
  return true;
}

export function seedDefaultsIfEmpty(defaults) {
  if (yVaults.size > 0 || yFiles.size > 0) return;
  // If the user is already signed in to sync, skip seeding. An empty local
  // store after a storage wipe (origin change, IndexedDB cleared, fresh
  // install on a paired device, ...) would otherwise race the incoming
  // server state: the freshly-seeded "Default" vault would clobber a
  // user-renamed vault through Y.Map last-write-wins. We'd rather wait for
  // the server pull and let the user see their real vaults.
  try {
    const cfg = JSON.parse(localStorage.getItem(LS_SYNC_KEY) || 'null');
    if (cfg && cfg.token && cfg.currentWorkspaceId) return;
  } catch {}
  ydoc.transact(() => {
    for (const v of defaults.vaults) yVaults.set(v.id, { ...v, id: v.id, name: v.name });
    for (const f of defaults.files) {
      yFiles.set(f.id, {
        id: f.id, name: f.name,
        vaultId: f.vaultId || 'default',
        size: f.size || '0.0 KB',
      });
      const t = getContent(f.id);
      if (t.length === 0 && f.content) t.insert(0, f.content);
    }
    if (defaults.activeId)    yMeta.set('activeId', defaults.activeId);
    if (defaults.activeVault) yMeta.set('activeVault', defaults.activeVault);
  });
}

// ─── Hocuspocus sync (phase 1) ───────────────────────────────────────────────

// Sync config schema:
//   { httpUrl, wsUrl, email, userId, token, tier, expiresAt,
//     workspaces: [{id, name, role, isOwn, ownerEmail}], currentWorkspaceId }
//
// Old configs (string-array workspaces, currentWorkspace by name) are dropped
// — they're incompatible with the workspace_members migration. User re-logs in.
export function getSyncConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(LS_SYNC_KEY) || 'null');
    if (!cfg) return null;
    const isLegacy = (
      typeof cfg.currentWorkspace === 'string' ||
      (Array.isArray(cfg.workspaces) && cfg.workspaces.length > 0 && typeof cfg.workspaces[0] === 'string') ||
      (cfg.token && cfg.currentWorkspace && !cfg.currentWorkspaceId)
    );
    if (isLegacy) {
      localStorage.removeItem(LS_SYNC_KEY);
      return null;
    }
    return cfg;
  } catch { return null; }
}
export function setSyncConfig(cfg) {
  // Servidor con certificado propio: el proceso principal lo conserva fijado (también al reabrir la app).
  try { if (cfg && cfg.tlsCa && cfg.httpUrl && window.electronAPI && window.electronAPI.tlsSetPin) window.electronAPI.tlsSetPin({ url: cfg.httpUrl, pem: cfg.tlsCa }); } catch {}
  if (cfg) localStorage.setItem(LS_SYNC_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(LS_SYNC_KEY);
}

export function deriveWsUrl(httpUrl) {
  try {
    const u = new URL(httpUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.toString().replace(/\/$/, '');
  } catch { return httpUrl; }
}

async function apiCall(httpUrl, path, opts = {}) {
  const res = await fetch(httpUrl.replace(/\/$/, '') + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

export const apiRegister = (httpUrl, email, password) =>
  apiCall(httpUrl, '/auth/register', { method: 'POST', body: { email, password } });

export const apiLogin = (httpUrl, email, password) =>
  apiCall(httpUrl, '/auth/login', { method: 'POST', body: { email, password } });

export const apiRefresh = (httpUrl, token) =>
  apiCall(httpUrl, '/auth/refresh', { method: 'POST', token });

export const apiMe = (httpUrl, token) =>
  apiCall(httpUrl, '/auth/me', { token });

export const apiListWorkspaces = (httpUrl, token) =>
  apiCall(httpUrl, '/workspaces', { token });

export const apiCreateWorkspace = (httpUrl, token, name) =>
  apiCall(httpUrl, '/workspaces', { method: 'POST', token, body: { name } });

export const apiDeleteWorkspace = (httpUrl, token, workspaceId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}`, { method: 'DELETE', token });

export const apiListMembers = (httpUrl, token, workspaceId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/members`, { token });

export const apiInviteMember = (httpUrl, token, workspaceId, email, role = 'editor') =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/members`, { method: 'POST', token, body: { email, role } });

export const apiRemoveMember = (httpUrl, token, workspaceId, userId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE', token });

export const apiUpdateMemberRole = (httpUrl, token, workspaceId, userId, role) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/members/${userId}`, { method: 'PATCH', token, body: { role } });

// ─── Versioning v2 — document snapshot endpoints ─────────────────────
// `/workspaces/:id/snapshots` returns metadata only (no blobs); fetch
// the blob with apiGetSnapshotState when you need to decode for diff
// or restore. The state is a raw Y.encodeStateAsUpdate output — apply
// it into a fresh Y.Doc to read historical content.
export const apiListSnapshots = (httpUrl, token, workspaceId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/snapshots`, { token });

// ─── ACL grants (user-principal, folder/note granular) ──────────────
export const apiListAclGrants = (httpUrl, token, workspaceId, rtype, rid) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/grants/${rtype}/${encodeURIComponent(rid)}`, { token });

export const apiUpsertAclGrant = (httpUrl, token, workspaceId, rtype, rid, body) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/grants/${rtype}/${encodeURIComponent(rid)}`, {
    method: 'POST', token, body,
  });

export const apiRemoveAclGrant = (httpUrl, token, workspaceId, rtype, rid, aclId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/grants/${rtype}/${encodeURIComponent(rid)}/${aclId}`, {
    method: 'DELETE', token,
  });

export const apiListMyGrants = (httpUrl, token, workspaceId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/grants/me`, { token });

export const apiTakeSnapshot = (httpUrl, token, workspaceId, label, vaultId) => {
  const qs = vaultId ? `?vault=${encodeURIComponent(vaultId)}` : '';
  return apiCall(httpUrl, `/workspaces/${workspaceId}/snapshots${qs}`, {
    method: 'POST', token, body: { label: label || 'manual' },
  });
};

export const apiGetSnapshotState = async (httpUrl, token, workspaceId, snapshotId) => {
  const url = `${httpUrl.replace(/\/$/, '')}/workspaces/${workspaceId}/snapshots/${snapshotId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let body = ''; try { body = await res.text(); } catch {}
    const err = new Error(`HTTP ${res.status}${body ? ': ' + body.slice(0,200) : ''}`);
    err.status = res.status;
    throw err;
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
};

export const apiRestoreSnapshot = (httpUrl, token, workspaceId, snapshotId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/snapshots/${snapshotId}/restore`, { method: 'POST', token });

export const apiDeleteSnapshot = (httpUrl, token, workspaceId, snapshotId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/snapshots/${snapshotId}`, { method: 'DELETE', token });

// ─── ACL Fase B — vault membership endpoints ─────────────────────────
export const apiListVaultMembers = (httpUrl, token, workspaceId, vaultId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/vaults/${encodeURIComponent(vaultId)}/members`, { token });

export const apiInviteVaultMember = (httpUrl, token, workspaceId, vaultId, email, role = 'editor') =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/vaults/${encodeURIComponent(vaultId)}/members`, { method: 'POST', token, body: { email, role } });

export const apiUpdateVaultMemberRole = (httpUrl, token, workspaceId, vaultId, userId, role) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/vaults/${encodeURIComponent(vaultId)}/members/${userId}`, { method: 'PATCH', token, body: { role } });

export const apiRemoveVaultMember = (httpUrl, token, workspaceId, vaultId, userId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/vaults/${encodeURIComponent(vaultId)}/members/${userId}`, { method: 'DELETE', token });

export const apiMigrateWorkspaceToVaults = (httpUrl, token, workspaceId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/migrate-to-vaults`, { method: 'POST', token });

export const apiListAuditEvents = (httpUrl, token, workspaceId, { kind, sinceTs, limit } = {}) => {
  const q = new URLSearchParams();
  if (kind) q.set('kind', kind);
  if (sinceTs) q.set('sinceTs', sinceTs);
  if (limit) q.set('limit', limit);
  const qs = q.toString() ? `?${q}` : '';
  return apiCall(httpUrl, `/workspaces/${workspaceId}/audit${qs}`, { token });
};

// ─── Emparejamiento y equipos del hub ────────────────────────────────
// Canjear un código (único endpoint sin sesión): devuelve la credencial propia de este equipo.
export const apiPairRedeem = (httpUrl, code, name) =>
  apiCall(httpUrl, '/pair/redeem', { method: 'POST', body: { code, name } });
// Crear un código para emparejar otro equipo. `url` es la dirección con la que ese equipo llegará al hub.
// `fallbackUrl` is only used if the hub has no public address of its own configured.
export const apiPairStart = (httpUrl, token, fallbackUrl, scope = null) =>
  apiCall(httpUrl, '/pair/start', { method: 'POST', token, body: { fallbackUrl, ...(scope ? { scope } : {}) } });
export const apiListDevices = (httpUrl, token) => apiCall(httpUrl, '/devices', { token });
export const apiRevokeDevice = (httpUrl, token, id) =>
  apiCall(httpUrl, `/devices/${encodeURIComponent(id)}`, { method: 'DELETE', token });

// ─── Notifications ───────────────────────────────────────────────────
export const apiListNotifications = (httpUrl, token, { onlyUnread = false, limit = 50 } = {}) => {
  const q = new URLSearchParams();
  if (onlyUnread) q.set('unread', '1');
  if (limit) q.set('limit', limit);
  const qs = q.toString() ? `?${q}` : '';
  return apiCall(httpUrl, `/me/notifications${qs}`, { token });
};
export const apiUnreadNotifCount = (httpUrl, token) =>
  apiCall(httpUrl, '/me/notifications/unread-count', { token });
export const apiMarkNotifRead = (httpUrl, token, id) =>
  apiCall(httpUrl, `/me/notifications/${id}/read`, { method: 'POST', token });
export const apiMarkAllNotifsRead = (httpUrl, token) =>
  apiCall(httpUrl, '/me/notifications/read-all', { method: 'POST', token });
export const apiDeleteNotif = (httpUrl, token, id) =>
  apiCall(httpUrl, `/me/notifications/${id}`, { method: 'DELETE', token });
export const apiDispatchNotif = (httpUrl, token, { email, workspaceId, kind, payload }) =>
  apiCall(httpUrl, '/me/notifications/dispatch', { method: 'POST', token, body: { email, workspaceId, kind, payload } });

// ─── ACL Fase C — share links + pending invitations ───────────────────
export const apiListShareLinks = (httpUrl, token, workspaceId, resourceType, resourceId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/shares/${resourceType}/${encodeURIComponent(resourceId)}`, { token });
export const apiCreateShareLink = (httpUrl, token, workspaceId, resourceType, resourceId, { level = 'view', label, expiresAt, allowSubmit = false, includeLinked = false } = {}) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/shares/${resourceType}/${encodeURIComponent(resourceId)}`, { method: 'POST', token, body: { level, label, expiresAt, allowSubmit, includeLinked } });
export const apiSetShareLinkSubmit = (httpUrl, token, workspaceId, resourceType, resourceId, linkId, allowSubmit) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/shares/${resourceType}/${encodeURIComponent(resourceId)}/${linkId}`, { method: 'PATCH', token, body: { allowSubmit } });
export const apiSetShareLinkIncludeLinked = (httpUrl, token, workspaceId, resourceType, resourceId, linkId, includeLinked) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/shares/${resourceType}/${encodeURIComponent(resourceId)}/${linkId}`, { method: 'PATCH', token, body: { includeLinked } });
export const apiRevokeShareLink = (httpUrl, token, workspaceId, resourceType, resourceId, linkId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/shares/${resourceType}/${encodeURIComponent(resourceId)}/${linkId}`, { method: 'DELETE', token });
export const apiListPendingInvitations = (httpUrl, token, workspaceId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/pending-invitations`, { token });
export const apiCancelPendingInvitation = (httpUrl, token, workspaceId, inviteId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/pending-invitations/${inviteId}`, { method: 'DELETE', token });

export const apiResendPendingInvitation = (httpUrl, token, workspaceId, inviteId) =>
  apiCall(httpUrl, `/workspaces/${workspaceId}/pending-invitations/${inviteId}/resend`, { method: 'POST', token });

// ─── Blob storage (file attachments) ──────────────────────────────────────
// Uploads use raw bytes (not multipart) with filename + mime carried in custom
// headers; this avoids the multipart-parser dependency on the server and lets
// the server stream straight to disk.
// We use XHR (not fetch) because it exposes upload progress via
// `xhr.upload.onprogress`, which `fetch` still doesn't natively support.
export function apiUploadBlob(httpUrl, token, file, { onProgress, signal } = {}) {
  return new Promise((resolveP, rejectP) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', httpUrl.replace(/\/$/, '') + '/blobs', true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Edinot-Filename', encodeURIComponent(file.name || 'file'));
    xhr.setRequestHeader('X-Edinot-Mime', file.type || 'application/octet-stream');
    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    if (signal) {
      if (signal.aborted) { xhr.abort(); rejectP(new Error('aborted')); return; }
      signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolveP(data || {});
      const err = new Error((data && data.error) || `HTTP ${xhr.status}`);
      err.status = xhr.status;
      err.code = data && data.code;
      err.maxFileSize = data && data.maxFileSize;
      err.storageBytes = data && data.storageBytes;
      err.used = data && data.used;
      rejectP(err);
    };
    xhr.onerror = () => rejectP(new Error('network error'));
    xhr.onabort = () => rejectP(new Error('aborted'));
    // Pass the File object directly — XHR streams it without buffering.
    xhr.send(file);
  });
}

export const apiGetQuota = (httpUrl, token) =>
  apiCall(httpUrl, '/me/quota', { token });

export const apiGetBlobMeta = (httpUrl, token, sha) =>
  apiCall(httpUrl, `/blobs/${sha}/meta`, { token });

export const apiDeleteBlob = (httpUrl, token, sha) =>
  apiCall(httpUrl, `/blobs/${sha}`, { method: 'DELETE', token });

// Pull extracted plain-text for a batch of blob ids — feeds the global
// search modal so queries also hit attachment contents (PDF/DOCX/XLSX/TXT).
export const apiBlobTextBatch = (httpUrl, token, ids) =>
  apiCall(httpUrl, '/blobs/text', { method: 'POST', token, body: { ids } });

// Bulk existence/metadata probe — returns only the ids the server knows.
// Used by the attachment self-heal to find referenced-but-missing blobs.
export const apiBlobMetaBatch = (httpUrl, token, ids) =>
  apiCall(httpUrl, '/blobs/meta', { method: 'POST', token, body: { ids } });

// Builds the URL used inside markdown (`![alt](edinot://blob/<sha>)`). The
// Electron protocol handler resolves these by fetching from the configured
// sync server (with the user's token) and caching to disk locally.
export const blobMarkdownUrl = (sha) => `edinot://blob/${sha}`;

let provider = null;

// ─── Shared websocket (multiplex) ───────────────────────────────────
// Every Y.Doc (workspace shell, each vault, each note) used to open its
// OWN wss connection. Since per-note docs (ACL Phase D) the client boots
// a provider for EVERY accessible note so search / backlinks / export
// have its Y.Text live — so a workspace with N notes opened 1+V+N
// simultaneous TLS sockets (60+ in practice). That saturated the Electron
// browser-process main thread in native networking code and froze the UI
// when opening a note. Hocuspocus multiplexes many documents over a single
// socket via a shared HocuspocusProviderWebsocket: we keep one per wsUrl
// and hand it to every provider (which must then attach() explicitly —
// the ctor only auto-attaches when it owns the socket). 60 sockets → 1.
let _sharedWs = null;
let _sharedWsUrl = null;
function getSharedWs(wsUrl) {
  if (_sharedWs && _sharedWsUrl === wsUrl) return _sharedWs;
  if (_sharedWs) { try { _sharedWs.destroy(); } catch {} _sharedWs = null; }
  _sharedWs = new HocuspocusProviderWebsocket({ url: wsUrl });
  _sharedWsUrl = wsUrl;
  return _sharedWs;
}

// Force the shared socket to reconnect NOW. After an OS suspend/resume the
// TCP connection is dead but hocuspocus may still believe it's Connected, so
// its checkConnection only notices after `messageReconnectTimeout` (~30s) —
// and because every doc rides this one socket, all sync stalls for that
// window. Call this on resume / `online` to skip the wait: `connect()` alone
// no-ops while status is Connected, so we drop the stale socket first and
// reconnect on the next tick once the close has settled. All attached
// providers re-sync automatically when the socket re-opens.
export function reconnectSync() {
  if (!_sharedWs) return;
  try { _sharedWs.disconnect(); } catch {}
  _sharedWs.shouldConnect = true;
  setTimeout(() => { try { _sharedWs && _sharedWs.connect(); } catch {} }, 50);
}

// Hard reset of the sync transport: destroy the shell, every per-vault and
// per-note provider AND the shared socket — but KEEP the Y.Docs and their
// IndexedDB persistence (so no local data is lost and nothing has to
// re-download from scratch). After this, the caller re-runs connectSync /
// connectVaultProvider / connectNoteProvider with a fresh cfg (e.g. a
// refreshed token) and a brand-new socket is built. Used by the disconnect
// watchdog so a stale or auth-failed session is rebuilt from clean state
// instead of sitting dead — a provider that hit onAuthenticationFailed set
// shouldConnect=false and would otherwise never retry.
export function resetSyncForReconnect() {
  if (provider) { try { provider.destroy(); } catch {} provider = null; }
  disconnectAllVaultProviders();
  disconnectAllNoteProviders();
  if (_sharedWs) { try { _sharedWs.destroy(); } catch {} _sharedWs = null; _sharedWsUrl = null; }
}

const statusListeners = new Set();
let lastStatus = 'disconnected';

export const onSyncStatus = (cb) => {
  statusListeners.add(cb);
  cb(lastStatus);
  return () => statusListeners.delete(cb);
};
const emitStatus = (s) => {
  lastStatus = s;
  for (const cb of statusListeners) cb(s);
};

// ─── Awareness (presence) ───────────────────────────────────────────────────
const presenceListeners = new Set();
let lastPresence = [];
let lastPresenceSig = '[]';

export const onPresence = (cb) => {
  presenceListeners.add(cb);
  cb(lastPresence);
  return () => presenceListeners.delete(cb);
};
const emitPresence = () => {
  for (const cb of presenceListeners) cb(lastPresence);
};
// Content-dedup gate. Awareness 'change' fires on EVERY keystroke (yCollab
// publishes the local cursor position), so refreshPresenceFromAwareness runs
// per character while typing. The roster itself almost never changes though —
// emitting a fresh array identity each time made the App-level setPresence /
// setAiAgents re-render the whole tree once per keystroke. Compare by content
// and keep the old identity (and stay silent) when nothing changed.
const commitPresence = (states) => {
  const sig = JSON.stringify(states);
  if (sig === lastPresenceSig) return;
  lastPresence = states;
  lastPresenceSig = sig;
  emitPresence();
};

// One-shot MCP actions broadcast over the same awareness channel.
// The MCP server side calls `awareness.setLocalStateField('mcpAction', …)`
// after each mutation; we re-emit those as discrete events here, with
// per-action ids so subscribers can dedupe replays (which happen when
// awareness state replicates to a freshly-connected peer).
const mcpActionListeners = new Set();
const mcpSeenActionIds = new Set();
export const onMcpAction = (cb) => {
  mcpActionListeners.add(cb);
  return () => mcpActionListeners.delete(cb);
};
function emitMcpAction(action) {
  for (const cb of mcpActionListeners) {
    try { cb(action); } catch { /* listener errors are isolated */ }
  }
}

// «Seguir al agente»: dónde acaba de cambiar un canvas (campo `mcpCanvas` del canal de presencia).
const mcpCanvasListeners = new Set();
const mcpSeenCanvasIds = new Set();
export const onMcpCanvas = (cb) => { mcpCanvasListeners.add(cb); return () => mcpCanvasListeners.delete(cb); };

// Separate channel for "live" AI pointer requests: focus_note,
// highlight_in_note. These cause the renderer to actively interact with
// the editor surface (window focus, CodeMirror selection, scroll-into-
// view) rather than just popping an info toast. Same dedup model.
const aiPointerListeners = new Set();
const aiSeenPointerIds = new Set();
export const onAiPointer = (cb) => {
  aiPointerListeners.add(cb);
  return () => aiPointerListeners.delete(cb);
};
function emitAiPointer(pointer) {
  for (const cb of aiPointerListeners) {
    try { cb(pointer); } catch { /* listener errors are isolated */ }
  }
}

// AI presence — explicit "what am I doing right now" pings from the MCP
// peer (e.g. "thinking…", "searching across vault…", "summarising note"),
// independent of mcpAction (which fires post-mutation). Same awareness
// channel + dedupe model.
const aiPresenceListeners = new Set();
const aiSeenPresenceIds = new Set();
export const onAiPresence = (cb) => {
  aiPresenceListeners.add(cb);
  return () => aiPresenceListeners.delete(cb);
};
function emitAiPresence(p) {
  for (const cb of aiPresenceListeners) {
    try { cb(p); } catch { /* isolated */ }
  }
}

const aiAgentListeners = new Set();
let lastAiAgents = [];
let lastAiAgentsSig = '[]';
export const onAiAgents = (cb) => {
  aiAgentListeners.add(cb);
  cb(lastAiAgents);
  return () => aiAgentListeners.delete(cb);
};
function emitAiAgents() {
  for (const cb of aiAgentListeners) {
    try { cb(lastAiAgents); } catch { /* isolated */ }
  }
}
// Same content-dedup gate as commitPresence — see that comment.
function commitAiAgents(agents) {
  const sig = JSON.stringify(agents);
  if (sig === lastAiAgentsSig) return;
  lastAiAgents = agents;
  lastAiAgentsSig = sig;
  emitAiAgents();
}

function colorForEmail(email) {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

// Aggregate presence across the shell awareness AND every connected
// per-vault provider's awareness. Each user appears once: dedupe by
// (userId || email || clientId). Per-vault clients spawn separate
// Yjs awareness clientIDs per doc, so without dedupe a single peer
// would show up N times (once per vault they touched). isSelf is
// computed against the shell provider's clientID.
// Attach the same presence + MCP/pointer/aiPresence dispatch logic to
// any awareness instance (shell or per-vault). Calling it for every
// provider is what makes presence + AI events aggregate across vaults.
function attachAwarenessHandler(awareness, selfClientId) {
  if (!awareness) return;
  const handler = ({ added, updated } = {}) => {
    refreshPresenceFromAwareness();
    const touched = [...(added || []), ...(updated || [])];
    for (const cid of touched) {
      if (cid === selfClientId) continue;
      const state = awareness.getStates().get(cid);
      if (!state) continue;
      const action = state.mcpAction;
      if (action && action.id && !mcpSeenActionIds.has(action.id)) {
        mcpSeenActionIds.add(action.id);
        if (mcpSeenActionIds.size > 256) {
          const it = mcpSeenActionIds.values();
          for (let i = 0; i < 64; i++) mcpSeenActionIds.delete(it.next().value);
        }
        emitMcpAction(action);
      }
      const cv = state.mcpCanvas;
      if (cv && cv.id && !mcpSeenCanvasIds.has(cv.id)) {
        mcpSeenCanvasIds.add(cv.id);
        if (mcpSeenCanvasIds.size > 256) { const it = mcpSeenCanvasIds.values(); for (let i = 0; i < 64; i++) mcpSeenCanvasIds.delete(it.next().value); }
        // Solo avisos recientes (al conectarse llega el último estado de cada agente, que puede ser viejo).
        if (!cv.at || Date.now() - cv.at < 15000) for (const cb of mcpCanvasListeners) { try { cb(cv); } catch {} }
      }
      const pointer = state.aiPointer;
      if (pointer && pointer.id && !aiSeenPointerIds.has(pointer.id)) {
        aiSeenPointerIds.add(pointer.id);
        if (aiSeenPointerIds.size > 256) {
          const it = aiSeenPointerIds.values();
          for (let i = 0; i < 64; i++) aiSeenPointerIds.delete(it.next().value);
        }
        emitAiPointer(pointer);
      }
      const presenceMsg = state.aiPresence;
      if (presenceMsg && presenceMsg.id && !aiSeenPresenceIds.has(presenceMsg.id)) {
        aiSeenPresenceIds.add(presenceMsg.id);
        if (aiSeenPresenceIds.size > 256) {
          const it = aiSeenPresenceIds.values();
          for (let i = 0; i < 64; i++) aiSeenPresenceIds.delete(it.next().value);
        }
        emitAiPresence(presenceMsg);
      }
    }
  };
  awareness.on('change', handler);
  handler();
}

function refreshPresenceFromAwareness() {
  const seen = new Map();           // dedupe key → entry
  const agents = new Map();         // alias → agent presence
  const selfClientId = provider && provider.awareness && provider.awareness.clientID;
  const consume = (awareness) => {
    if (!awareness) return;
    awareness.getStates().forEach((state, clientId) => {
      if (!state) return;
      const isSelf = clientId === selfClientId;
      if (state.user) {
        const key = state.user.userId || state.user.email || String(clientId);
        const existing = seen.get(key);
        // Prefer the self entry if duplicates exist, otherwise first-seen.
        if (!existing || isSelf) seen.set(key, { clientId, isSelf, ...state.user });
      }
      if (state.aiAgent && state.aiAgent.alias) {
        const key = String(state.aiAgent.alias).toLowerCase();
        const existing = agents.get(key);
        const at = Number(state.aiAgent.at) || 0;
        if (!existing || at >= (Number(existing.at) || 0)) {
          agents.set(key, { clientId, isSelf, ...state.aiAgent, online: true });
        }
      }
    });
  };
  if (provider && provider.awareness) consume(provider.awareness);
  for (const e of vaultRegistry.values()) {
    if (e.provider && e.provider.awareness) consume(e.provider.awareness);
  }
  const states = Array.from(seen.values());
  states.sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : (a.email || '').localeCompare(b.email || '')));
  commitPresence(states);
  commitAiAgents(Array.from(agents.values())
    .sort((a, b) => String(a.alias || '').localeCompare(String(b.alias || ''))));
}

function pushBlobSyncContext(cfg) {
  if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.setSyncContext) return;
  if (cfg && cfg.httpUrl && cfg.token) {
    window.electronAPI.setSyncContext(cfg.httpUrl, cfg.token);
  } else {
    window.electronAPI.setSyncContext(null, null);
  }
}

export function connectSync(cfg) {
  if (provider) { provider.destroy(); provider = null; }
  commitPresence([]);
  if (!cfg || !cfg.wsUrl || !cfg.token || !cfg.currentWorkspaceId) {
    emitStatus('disconnected');
    pushBlobSyncContext(null);
    return null;
  }
  pushBlobSyncContext(cfg);
  const docName = `ws:${cfg.currentWorkspaceId}`;
  emitStatus('connecting');
  try {
    provider = new HocuspocusProvider({
      websocketProvider: getSharedWs(cfg.wsUrl),
      name: docName,
      token: cfg.token,
      document: ydoc,
      onStatus: ({ status }) => emitStatus(status),
      onAuthenticationFailed: ({ reason } = {}) => {
        if (provider) {
          try { provider.shouldConnect = false; provider.destroy(); } catch {}
          provider = null;
        }
        emitStatus('auth-failed');
        if (reason) console.warn('[sync] auth failed:', reason);
      },
      onDisconnect: () => { emitStatus('disconnected'); commitPresence([]); },
      onStateless: ({ payload } = {}) => {
        let msg = null;
        try { msg = JSON.parse(payload); } catch {}
        if (msg && msg.type === 'stale-shell') resetShellCache();
      },
    });
    // Shared socket: ctor doesn't auto-attach, wire the doc explicitly.
    try { provider.attach(); } catch {}

    if (cfg.email) {
      provider.awareness.setLocalStateField('user', {
        email: cfg.email,
        userId: cfg.userId,
        color: colorForEmail(cfg.email),
      });
    }
    attachAwarenessHandler(provider.awareness, provider.awareness.clientID);
  } catch (err) {
    emitStatus('error');
    console.error('[sync] connect failed:', err);
  }
  return provider;
}
export function disconnectSync() {
  if (provider) { provider.destroy(); provider = null; }
  commitPresence([]);
  emitStatus('disconnected');
  pushBlobSyncContext(null);
}
export const getProvider = () => provider;

// ─── Shell doc compactado en el servidor ─────────────────────────────
// El servidor puede reconstruir `ws:{id}` desde cero para soltar millones
// de tombstones (server/compact.js). Nuestra caché local sigue llevando
// esa historia y el servidor se niega a mezclarla: avisa con un mensaje
// `stale-shell`. Vaciamos la caché del shell y recargamos; al volver, el
// documento llega limpio del servidor. Las demás ventanas comparten la
// misma IndexedDB, así que se enteran por `storage` y recargan también.
const LS_SHELL_RESET_KEY = 'edinot.shell.reset';
const SS_SHELL_RESET_AT = 'edinot.shell.resetAt';
let shellResetting = false;

function clearShellUpdates() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DOC_NAME);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(['updates'], 'readwrite');
        tx.objectStore('updates').clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (err) { db.close(); reject(err); }
    };
  });
}

async function resetShellCache() {
  if (shellResetting) return;
  shellResetting = true;
  if (provider) {
    try { provider.shouldConnect = false; provider.destroy(); } catch {}
    provider = null;
  }
  // Si la anterior limpieza no sirvió, no entramos en un bucle de recargas.
  let last = 0;
  try { last = Number(sessionStorage.getItem(SS_SHELL_RESET_AT)) || 0; } catch {}
  if (Date.now() - last < 60 * 1000) {
    console.warn('[sync] el servidor sigue rechazando la caché del shell; sync del shell en pausa');
    emitStatus('error');
    return;
  }
  console.warn('[sync] shell compactado en el servidor — vaciando la caché local');
  try { localStorage.setItem(LS_SHELL_RESET_KEY, String(Date.now())); } catch {}
  try { if (indexeddb) await indexeddb.destroy(); } catch {}
  try { await clearShellUpdates(); }
  catch (err) { console.warn('[idb] no se pudo vaciar el shell:', err && err.message); }
  try { sessionStorage.setItem(SS_SHELL_RESET_AT, String(Date.now())); } catch {}
  try { window.location.reload(); } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_SHELL_RESET_KEY || shellResetting) return;
    shellResetting = true;
    if (provider) { try { provider.shouldConnect = false; provider.destroy(); } catch {} provider = null; }
    Promise.resolve(indexeddb && indexeddb.destroy()).catch(() => {})
      .then(() => setTimeout(() => { try { window.location.reload(); } catch {} }, 1500));
  });
}

// ─── Fase B Cliente — per-vault Y.Doc registry ───────────────────────
// Multi-commit refactor. C1 (this commit) lays infrastructure without
// touching any existing read path. Flag `usePerVaultDocs` in ySettings
// controls activation; while false, every callsite keeps using the
// legacy singleton `ydoc` exported above. Subsequent commits will
// migrate read/write surfaces (yFiles, yFolders, yMeta, getContent,
// awareness) to consult the registry when the flag is on.
//
// Architecture (when flag ON):
//   - Workspace SHELL doc (`ws:{wid}`) — yVaults + ySettings only.
//   - Per-vault doc (`ws:{wid}:vault:{vid}`) — yFolders + yFiles +
//     yMeta + content:fileId Y.Texts for the notes in that vault.
//   - Active vault: registry serves its yFiles/yFolders/yMeta/etc.
//   - Other accessible vaults: provider initialised on first switch
//     to keep cold-start fast; cached afterwards.

// Per-vault Y.Doc mode is now the default and only mode. The legacy
// single-workspace doc remains on the server as a backup / migration
// source but the running app always reads/writes through the
// VaultDocRegistry. Kept as a function so existing callsites compile.
export function isPerVaultMode() { return true; }

function makeVaultEntry(vaultId) {
  const vDoc = new Y.Doc();
  return {
    vaultId,
    ydoc: vDoc,
    provider: null,
    persistence: null,
    status: 'idle',
    yVaults:   vDoc.getMap('vaults'),    // mirrors workspace shell entry for this vault
    yFolders:  vDoc.getMap('folders'),
    yFiles:    vDoc.getMap('files'),
    yMeta:     vDoc.getMap('meta'),
    ySettings: vDoc.getMap('settings'),  // per-vault overrides (rare); workspace shell is canonical
    yEvents:   vDoc.getMap('events'),    // Calendar/reminders source of truth (F1+)
    yCollections: vDoc.getMap('collections'), // Colecciones: filtros guardados de «Todas las notas» (shared/collections.js)
    getContent: (fileId) => vDoc.getText('content:' + fileId),
  };
}

export function getVaultDoc(vaultId) {
  if (!vaultId) return null;
  let e = vaultRegistry.get(vaultId);
  if (!e) {
    e = makeVaultEntry(vaultId);
    vaultRegistry.set(vaultId, e);
    // Local IndexedDB persistence keyed by ws+vault. Hocuspocus sync
    // attaches lazily via connectVaultProvider when called.
    try {
      e.persistence = makePersistence('edinot-vault:' + vaultId, e.ydoc);
    } catch (err) {
      console.warn('[per-vault] idb persistence failed for', vaultId, err.message);
    }
    // Attach disk-export observers. yFiles.observe fires for each
    // file that lands from IDB hydration or Hocuspocus sync, so we
    // don't need a separate post-sync pass.
    registerVaultExportHooks(e);
  }
  return e;
}

export function listVaultRegistryEntries() {
  return Array.from(vaultRegistry.values());
}

// ─── Colecciones (filtros guardados, por vault) ─────────────────────────────
// Viven en el Y.Map `collections` del vault; ver shared/collections.js.
export function getCollections(vaultId) {
  const e = getVaultDoc(vaultId || 'default');
  if (!e || !e.yCollections) return [];
  const out = [];
  for (const raw of e.yCollections.values()) { const c = normalizeCollection(raw); if (c) out.push(c); }
  return out.sort((a, b) => (a.createdAt - b.createdAt) || a.name.localeCompare(b.name));
}
export function saveCollection(vaultId, col) {
  const e = getVaultDoc(vaultId || 'default');
  if (!e || !e.yCollections) return null;
  const now = Date.now();
  const prev = col && col.id ? normalizeCollection(e.yCollections.get(col.id)) : null;
  const id = (col && col.id) || ('col' + now.toString(36) + Math.random().toString(36).slice(2, 5));
  const next = normalizeCollection({ ...prev, ...col, id, createdAt: prev ? prev.createdAt : now, updatedAt: now });
  e.ydoc.transact(() => e.yCollections.set(id, next));
  return next;
}
export function deleteCollection(vaultId, id) {
  const e = getVaultDoc(vaultId || 'default');
  if (e && e.yCollections) e.ydoc.transact(() => e.yCollections.delete(id));
}
// fn() cada vez que cambian; devuelve la función que deja de escuchar.
export function observeCollections(vaultId, fn) {
  const e = getVaultDoc(vaultId || 'default');
  if (!e || !e.yCollections) return () => {};
  e.yCollections.observe(fn);
  return () => { try { e.yCollections.unobserve(fn); } catch {} };
}

// ─── Initial-sync progress ──────────────────────────────────────────────
// How many vault documents have finished their first sync with the server. The first time a device joins,
// the vaults download for a while and notes created elsewhere only show up once that finishes; the UI uses
// this to say so (Settings → Sync and a toast) instead of leaving the user wondering.
let _syncProgress = { loading: false, done: 0, total: 0 };
const _syncProgressListeners = new Set();
function recomputeSyncProgress() {
  const entries = Array.from(vaultRegistry.values()).filter(e => e.provider);
  const total = entries.length;
  const done = entries.filter(e => e.synced).length;
  const loading = total > 0 && done < total;
  if (loading === _syncProgress.loading && done === _syncProgress.done && total === _syncProgress.total) return;
  _syncProgress = { loading, done, total };
  for (const fn of _syncProgressListeners) { try { fn(_syncProgress); } catch {} }
}
export function getSyncProgress() { return _syncProgress; }
export function onSyncProgress(fn) {
  _syncProgressListeners.add(fn);
  return () => { _syncProgressListeners.delete(fn); };
}

// Open (or reuse) a Hocuspocus provider for the per-vault doc. Mirrors
// the shape of connectSync but per-vault. Reuses the workspace's wsUrl
// + token from cfg.
export function connectVaultProvider(vaultId, cfg) {
  if (!cfg || !cfg.wsUrl || !cfg.token || !cfg.currentWorkspaceId) return null;
  const e = getVaultDoc(vaultId);
  if (e.provider) return e.provider;
  const docName = `ws:${cfg.currentWorkspaceId}:vault:${vaultId}`;
  e.synced = false;
  try {
    e.provider = new HocuspocusProvider({
      websocketProvider: getSharedWs(cfg.wsUrl),
      name: docName,
      token: cfg.token,
      document: e.ydoc,
      onStatus: ({ status }) => { e.status = status; },
      onSynced: () => { e.synced = true; recomputeSyncProgress(); },
      onAuthenticationFailed: ({ reason } = {}) => {
        if (e.provider) {
          try { e.provider.shouldConnect = false; e.provider.destroy(); } catch {}
          e.provider = null;
        }
        e.status = 'auth-failed';
        e.synced = false;
        recomputeSyncProgress();
        console.warn('[vault] auth failed for', vaultId, reason || '(no reason)');
      },
      onDisconnect: () => { e.status = 'disconnected'; },
    });
    // Shared socket: ctor doesn't auto-attach, wire the doc explicitly.
    try { e.provider.attach(); } catch {}
    if (cfg.email) {
      e.provider.awareness.setLocalStateField('user', {
        email: cfg.email,
        userId: cfg.userId,
        color: colorForEmail(cfg.email),
      });
    }
    // C5 — wire per-vault awareness into the same dispatch so presence
    // lists, AI peer chips and MCP-broadcast actions surface regardless
    // of which document the peer is connected through.
    attachAwarenessHandler(e.provider.awareness, e.provider.awareness.clientID);
    e.provider.on('disconnect', () => refreshPresenceFromAwareness());
  } catch (err) {
    console.warn('[per-vault] provider init failed:', err.message);
  }
  recomputeSyncProgress();
  return e.provider;
}

export function disconnectAllVaultProviders() {
  for (const e of vaultRegistry.values()) {
    if (e.provider) {
      try { e.provider.destroy(); } catch {}
      e.provider = null;
    }
    e.synced = false;
  }
  recomputeSyncProgress();
}

// ─── ACL Fase D — per-note doc registry ─────────────────────────────
export function getNoteDoc(noteId) {
  if (!noteId) return null;
  let e = noteRegistry.get(noteId);
  if (e) return e;
  const nDoc = new Y.Doc();
  e = {
    noteId,
    ydoc: nDoc,
    ytext: nDoc.getText('content'),
    provider: null,
    persistence: null,
    status: 'idle',
    synced: false,
  };
  noteRegistry.set(noteId, e);
  try {
    e.persistence = makePersistence('edinot-note:' + noteId, e.ydoc);
  } catch (err) {
    console.warn('[per-note] idb persistence failed for', noteId, err.message);
  }
  // Wire disk export so edits to this note's Y.Text fire a debounced
  // mirror to disk. Idempotent — exportObserved guards against dup.
  if (typeof window !== 'undefined') {
    exportObserved.add(noteId);
    e.ytext.observe(() => {
      invalidateContentString(noteId);
      exportPending.add(noteId);
      scheduleExportFlush();
    });
  }
  // Source switched from the vault doc to this per-note doc — drop any
  // string cached from the vault-doc read so the next getContentString
  // recomputes from the per-note Y.Text.
  invalidateContentString(noteId);
  return e;
}

export function listNoteRegistryEntries() {
  return Array.from(noteRegistry.values());
}

// ─── Local (IndexedDB) hydration signals — boot splash ─────────────────
// Resolve when a vault / note doc has finished loading its LOCAL persisted
// state. Purely local: no provider/network involved, so these settle in
// tens of ms on a warm profile. Used by the boot veil so the first frame
// the user sees is the hydrated UI, not the empty-then-pop layout.
export function whenVaultLocalReady(vaultId) {
  try {
    const e = getVaultDoc(vaultId || 'default');
    if (!e || !e.persistence) return Promise.resolve();
    return Promise.resolve(e.persistence.whenSynced).catch(() => {});
  } catch { return Promise.resolve(); }
}
export function whenNoteLocalReady(noteId) {
  try {
    if (!noteId) return Promise.resolve();
    const e = getNoteDoc(noteId);
    if (!e || !e.persistence) return Promise.resolve();
    return Promise.resolve(e.persistence.whenSynced).catch(() => {});
  } catch { return Promise.resolve(); }
}

// True only when a note's per-note doc is connected AND has completed its
// initial sync — i.e. getContent(noteId) returns authoritative, current
// content. Used by the blob GC to avoid deleting blobs based on a stale
// vault-doc read of a note whose per-note doc isn't live (lazy loading).
export function isNoteSynced(noteId) {
  const e = noteRegistry.get(noteId);
  return !!(e && e.provider && e.synced);
}

// ─── Structured canvas model (co-edición · Fase 1) ──────────────────────
// Thin noteId-keyed wrappers over the shared ydoc-based model in
// shared/canvas-model.js (same code drives the MCP/CLI store, so the derived
// fence mirror serializes identically on every writer). See that module for
// the rationale. Additive — only used once CanvasView + MCP are rewired.
export function readCanvasSnapshot(noteId) {
  const e = noteId && getNoteDoc(noteId);
  return e ? _canvasRead(e.ydoc) : { nodes: [], edges: [], annotations: [] };
}
export function isCanvasMigrated(noteId) {
  const e = noteId && getNoteDoc(noteId);
  return e ? _canvasMigrated(e.ydoc) : false;
}
export function seedCanvasFromJson(noteId, json) {
  const e = noteId && getNoteDoc(noteId);
  return e ? _canvasSeed(e.ydoc, json) : false;
}
export function applyCanvasSnapshot(noteId, next) {
  const e = noteId && getNoteDoc(noteId);
  if (e) _canvasApply(e.ydoc, next);
}
export function serializeCanvasDeterministic(noteId) {
  const e = noteId && getNoteDoc(noteId);
  return e ? _canvasSerialize(e.ydoc) : JSON.stringify({ nodes: [], edges: [] }, null, 2);
}

// Per-canvas Y.UndoManager scoped to the structured types, so Ctrl+Z on a
// canvas undoes node/edge ops (not the text doc). Created lazily on first use
// — i.e. after seed-on-open — so the migration itself is never on the undo
// stack. Only local edits (origin null) are tracked; remote peers' changes
// arrive with the provider origin and are left alone.
const canvasUndoManagers = new Map();
export function getCanvasUndoManager(noteId) {
  const e = noteId && getNoteDoc(noteId);
  if (!e) return null;
  let um = canvasUndoManagers.get(noteId);
  if (um) return um;
  try {
    const t = _canvasTypes(e.ydoc);
    um = new Y.UndoManager([t.nodes, t.edges, t.groups, t.annotations], { captureTimeout: 400 });
  } catch { return null; }
  canvasUndoManagers.set(noteId, um);
  return um;
}

// Open or reuse the Hocuspocus provider for a single note's doc.
// vaultId is required because the server-side doc name is
// `ws:{wid}:vault:{vid}:note:{nid}` — the vault gate is layered with
// the note ACL.
export function connectNoteProvider(noteId, vaultId, cfg) {
  if (!cfg || !cfg.wsUrl || !cfg.token || !cfg.currentWorkspaceId) return null;
  if (!noteId || !vaultId) return null;
  const e = getNoteDoc(noteId);
  const docName = `ws:${cfg.currentWorkspaceId}:vault:${vaultId}:note:${noteId}`;
  if (e.provider) {
    if (e.docName === docName) return e.provider;
    // The note now lives in ANOTHER vault (another device moved it): its server document is a different
    // one, so the provider we hold points at a document that no longer has the text. Reusing it left the
    // body blank until the app was restarted. Drop it and start clean: the text we hold belongs to the old
    // document, and the destination one arrives from the server (merging both would duplicate the body).
    try { e.provider.destroy(); } catch {}
    e.provider = null;
    e.status = 'idle';
    e.synced = false;
    if (e.ytext && e.ytext.length > 0) {
      try { e.ydoc.transact(() => { e.ytext.delete(0, e.ytext.length); }); } catch {}
    }
  }
  e.docName = docName;
  try {
    e.provider = new HocuspocusProvider({
      websocketProvider: getSharedWs(cfg.wsUrl),
      name: docName,
      token: cfg.token,
      document: e.ydoc,
      onStatus: ({ status }) => { e.status = status; },
      onSynced: () => { e.synced = true; },
      onAuthenticationFailed: ({ reason } = {}) => {
        if (e.provider) {
          try { e.provider.shouldConnect = false; e.provider.destroy(); } catch {}
          e.provider = null;
        }
        e.status = 'auth-failed';
        e.synced = false;
        console.warn('[per-note] auth failed for', noteId, reason || '(no reason)');
      },
      onDisconnect: () => { e.status = 'disconnected'; e.synced = false; },
    });
    // Shared socket: ctor doesn't auto-attach, wire the doc explicitly.
    try { e.provider.attach(); } catch {}
    if (cfg.email) {
      e.provider.awareness.setLocalStateField('user', {
        email: cfg.email,
        userId: cfg.userId,
        color: colorForEmail(cfg.email),
      });
    }
    attachAwarenessHandler(e.provider.awareness, e.provider.awareness.clientID);
    e.provider.on('disconnect', () => refreshPresenceFromAwareness());
  } catch (err) {
    console.warn('[per-note] provider init failed:', err.message);
  }
  return e.provider;
}

export function disconnectAllNoteProviders() {
  for (const e of noteRegistry.values()) {
    if (e.provider) {
      try { e.provider.destroy(); } catch {}
      e.provider = null;
    }
  }
}

// Get the per-note provider's awareness, used by yCollab so cursor
// presence syncs between peers editing the same note.
export function getNoteAwareness(noteId) {
  const e = noteRegistry.get(noteId);
  return e && e.provider ? e.provider.awareness : null;
}

export function destroyVaultRegistry() {
  disconnectAllVaultProviders();
  for (const e of vaultRegistry.values()) {
    try { e.persistence && e.persistence.destroy(); } catch {}
    try { e.ydoc && e.ydoc.destroy(); } catch {}
  }
  vaultRegistry.clear();
}

// ─── Active-vault accessors (C2) ────────────────────────────────────
// Helpers that route reads/writes to the legacy singleton when
// per-vault mode is OFF, or to the registry entry for the active
// vault when it's ON. Callsites can opt in to these gradually
// (yFiles → activeFiles()) without a one-shot rewrite that risks
// breaking everything at once.

// Resolves the currently-active vault id by reading yMeta from the
// shell doc — shell doc is the legacy `ydoc` in both modes (yVaults
// + yMeta + ySettings stay on the workspace doc per the C1 plan).
export function getActiveVaultId() {
  try { return yMeta.get('activeVault') || 'default'; }
  catch { return 'default'; }
}

export function getActiveVaultDoc() {
  const vid = getActiveVaultId();
  return getVaultDoc(vid);
}

// `e.yFiles` / `e.yFolders` etc. are Y.Maps with the same API as the
// legacy singletons. When flag is OFF, return the singletons; when ON,
// return the active vault's map. Either way the consumer gets a Y.Map
// with the standard methods (get/set/delete/observe/values/...).
export function activeFiles()    { return isPerVaultMode() ? getActiveVaultDoc().yFiles    : yFiles; }
export function activeFolders()  { return isPerVaultMode() ? getActiveVaultDoc().yFolders  : yFolders; }

// Cross-vault read helpers. In per-vault mode the file list / folder
// tree needs to see ALL loaded vaults' content (sidebar, Ctrl+P,
// search). Iterates registry entries — limited to vaults the client
// has connected to (which on boot are all accessible vaults thanks
// to the pre-boot in ensureActiveVaultProvider).
export function getAllFilesAcrossVaults() {
  if (!isPerVaultMode()) return Array.from(yFiles.values());
  const out = [];
  for (const e of vaultRegistry.values()) {
    for (const v of e.yFiles.values()) out.push(v);
  }
  return out;
}
export function getAllFoldersAcrossVaults() {
  if (!isPerVaultMode()) return Array.from(yFolders.values());
  const out = [];
  for (const e of vaultRegistry.values()) {
    for (const v of e.yFolders.values()) out.push(v);
  }
  return out;
}
// Lookup a file id across every loaded vault. Returns { meta, vaultId, doc } or null.
export function locateFileAcrossVaults(fileId) {
  if (!isPerVaultMode()) {
    const meta = yFiles.get(fileId);
    return meta ? { meta, vaultId: meta.vaultId || 'default', doc: ydoc } : null;
  }
  for (const e of vaultRegistry.values()) {
    const meta = e.yFiles.get(fileId);
    if (meta) return { meta, vaultId: e.vaultId, doc: e.ydoc };
  }
  return null;
}

// ─── Calendar / reminders (F1) ──────────────────────────────────────
// Manual events + reminders live in each vault's `events` Y.Map (the
// source of truth). On top of that we derive read-only events by
// scanning note bodies for inline date tokens, so dates the user types
// straight into a note also surface on the calendar. `getVaultEvents`
// merges both into one normalised feed.
//
// Inline tokens recognised in note bodies:
//   📅 2026-05-25            → all-day event/due on that date
//   ⏰ 2026-05-25 09:00      → timed reminder
//   @due(2026-05-25 09:00)   → timed reminder (typed alternative)
// A line may carry several tokens — e.g. `- [ ] Informe 📅 2026-05-25
// ⏰ 2026-05-24 09:00` is an event on the 25th plus a reminder the day
// before. Each token becomes its own row; they share the line's title.
// Checked tasks (`- [x] …`) keep status 'done': the calendar still shows
// them, but reminders/badges/pending skip them (see isPendingReminder).
const INLINE_DATE_RE = /(📅|⏰|@due\()\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\)?/;
const INLINE_DATE_RE_G = new RegExp(INLINE_DATE_RE.source, 'g');

// Stable inline-event ids. They used to be `inline:<fileId>:<lineIndex>`, so
// inserting a line above a reminder moved its id and detached the snooze /
// dismiss override stored under the old id (dismissed reminders fired again).
// Now: `inline:<fileId>:h<hash>` over the normalised line text (sans
// checkbox state, so ticking a task keeps its id) + the token + its date,
// with `~n` appended for identical lines in the same note.
function inlineHash(str) {
  // FNV-1a 32-bit, base36 — short, deterministic, no deps.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
function inlineNormTitle(title) {
  return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
const LEGACY_INLINE_ID_RE = /^inline:(.+):(\d+)$/;
// A pending reminder = not dismissed and not a checked-off task.
export function isPendingReminder(ev) {
  return !!ev && ev.kind === 'reminder' && !ev.dismissed && ev.status !== 'done';
}

// Aviso de un EVENTO (kind 'event') con `reminderOffset`: instante (ms) en
// que debe sonar, o null si no hay aviso pendiente. Los recordatorios
// (kind 'reminder') siguen su camino de siempre (remindAt / isPendingReminder):
// un evento no «queda pendiente» ni suma en la insignia si se pasó su hora.
export function eventAlarmAt(ev, nowMs = Date.now()) {
  if (!ev || ev.kind === 'reminder' || ev.dismissed || ev.status === 'done') return null;
  const off = Number(ev.reminderOffset);
  if (!Number.isFinite(off) || off < 0) return null;
  const offMs = off * 60000;
  const sn = ev.snoozedUntil ? Date.parse(ev.snoozedUntil) : NaN;
  if (Number.isFinite(sn) && sn > nowMs) return sn;
  let startMs;
  if (ev.recurrence && ev.recurrence.freq) {
    startMs = nextOccurrence(ev, nowMs + offMs - 60000);
  } else {
    const p = recurParts(ev.start);
    startMs = p ? new Date(p.y, p.mo, p.d, p.timed ? p.h : 9, p.mi).getTime() : NaN;
  }
  if (!Number.isFinite(startMs)) return null;
  const at = startMs - offMs;
  return at >= nowMs - 60000 ? at : null;
}

// Blank out inline-code spans (backticks) so a date token shown as an
// example inside `…` in prose/documentation isn't read as a real reminder.
function stripInlineCode(s) { return String(s).replace(/`+[^`]*`+/g, ' '); }

function eventHasTime(s) { return /[ T]\d{1,2}:\d{2}/.test(String(s || '')); }

function vaultEventsMap(vaultId) {
  const e = getVaultDoc(vaultId);
  return e ? e.yEvents : null;
}

function normalizeManualEvent(vaultId, raw) {
  if (!raw || !raw.id) return null;
  const start = raw.start || null;
  return {
    id: raw.id,
    source: raw.source === 'google' ? 'google' : 'manual',
    kind: raw.kind || 'event',
    title: raw.title || '(sin título)',
    start,
    end: raw.end || null,
    allDay: typeof raw.allDay === 'boolean' ? raw.allDay : !eventHasTime(start),
    remindAt: raw.remindAt || null,
    noteId: raw.noteId || null,
    anchor: raw.anchor || null,
    status: raw.status || null,
    recurrence: raw.recurrence || null,
    snoozedUntil: raw.snoozedUntil || null,
    dismissed: !!raw.dismissed,
    createdAt: raw.createdAt || null,
    // Calendario v2 (todos opcionales; los registros viejos no los traen).
    // `end` de un evento de día completo es EXCLUSIVO, como en Google.
    location: raw.location || null,
    description: raw.description || null,
    color: raw.color || null,
    reminderOffset: Number.isFinite(raw.reminderOffset) ? raw.reminderOffset : null, // minutos antes de `start`
    calendarId: raw.calendarId || null,
    // Google Calendar linkage (source === 'google', or a pushed manual event)
    gcalId: raw.gcalId || null,
    gcalCalendarId: raw.gcalCalendarId || null,
    etag: raw.etag || null,
    htmlLink: raw.htmlLink || null,
    vaultId,
  };
}

// Reconcile a vault's Google-sourced events for one calendar against a freshly
// pulled list. Upserts by `gcal:<calendarId>:<gcalId>` id, preserves local-only
// flags (snooze/dismiss), and removes Google events no longer present remotely.
export function syncGoogleEvents(vaultId, calendarId, events) {
  const e = getVaultDoc(vaultId);
  const map = e && e.yEvents;
  if (!map) return { added: 0, updated: 0, removed: 0 };
  const prefix = `gcal:${calendarId}:`;
  const incoming = new Map();
  for (const ev of (events || [])) if (ev && ev.gcalId) incoming.set(prefix + ev.gcalId, ev);
  let added = 0, updated = 0, removed = 0;
  e.ydoc.transact(() => {
    for (const [id, ev] of incoming) {
      const cur = map.get(id);
      const rec = {
        id, source: 'google', kind: 'event',
        title: ev.title || '(sin título)', start: ev.start, end: ev.end || null, allDay: !!ev.allDay,
        gcalId: ev.gcalId, gcalCalendarId: calendarId, etag: ev.etag || null, htmlLink: ev.htmlLink || null,
        snoozedUntil: cur ? (cur.snoozedUntil || null) : null,
        dismissed: cur ? !!cur.dismissed : false,
        remindAt: cur ? (cur.remindAt || null) : null,
        createdAt: cur ? (cur.createdAt || Date.now()) : Date.now(),
      };
      if (!cur) added++;
      else if (cur.etag !== rec.etag || cur.title !== rec.title || cur.start !== rec.start || cur.end !== rec.end) updated++;
      map.set(id, rec);
    }
    for (const id of Array.from(map.keys())) {
      if (id.startsWith(prefix) && !incoming.has(id)) { map.delete(id); removed++; }
    }
  });
  return { added, updated, removed };
}

// Manual (non-Google) events in a vault that should be pushed to Google.
export function listPushableEvents(vaultId) {
  const map = vaultEventsMap(vaultId);
  if (!map) return [];
  const out = [];
  for (const raw of map.values()) {
    if (!raw || !raw.id) continue;
    if (raw.source === 'google') continue;
    if (raw._shadow) continue;
    out.push(normalizeManualEvent(vaultId, raw));
  }
  return out;
}

// ── Recurrence (calendar + reminders) ─────────────────────────────────
// A recurring manual event stores `recurrence = { freq, interval, until,
// count, byWeekday }`. Occurrences are derived on the fly — nothing is
// materialized: the calendar expands them across the visible window and the
// reminder scheduler asks for the next one >= now. v1 is whole-series:
// editing/deleting the event affects every occurrence.
//
//   freq:      'daily' | 'weekly' | 'monthly' | 'yearly'
//   interval:  >= 1 (every N days/weeks/months/years)
//   until:     'YYYY-MM-DD' inclusive end date, or null
//   count:     max number of occurrences, or null
//   byWeekday: weekly only — array of 0..6 (0=Mon … 6=Sun). Empty/absent ⇒
//              repeat on the start date's own weekday.
const RECUR_MAX = 1500; // safety cap on generated occurrences

export function normalizeRecurrence(r) {
  if (!r || typeof r !== 'object') return null;
  const freq = ['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? r.freq : null;
  if (!freq) return null;
  const interval = Math.max(1, Math.min(366, Math.round(Number(r.interval) || 1)));
  const until = (typeof r.until === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.until)) ? r.until.slice(0, 10) : null;
  const count = (Number.isFinite(r.count) && r.count > 0) ? Math.min(RECUR_MAX, Math.round(r.count)) : null;
  let byWeekday = null;
  if (freq === 'weekly' && Array.isArray(r.byWeekday) && r.byWeekday.length) {
    byWeekday = [...new Set(r.byWeekday.map(n => ((Math.round(Number(n)) % 7) + 7) % 7))].sort((a, b) => a - b);
  }
  return { freq, interval, until, count, byWeekday };
}

function recurParts(start) {
  const m = String(start || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, timed: !!m[4] };
}

// Yield occurrence Date objects in ascending order. `fromMs` is a soft lower
// bound used to fast-forward regular frequencies so we don't iterate from a
// years-old start date (skipped only when `count` is set, since count caps
// total occurrences from the very first).
function* recurIter(ev, fromMs) {
  const p = recurParts(ev && ev.start);
  if (!p) return;
  const base = new Date(p.y, p.mo, p.d, p.h, p.mi);
  const baseMs = base.getTime();
  const rec = normalizeRecurrence(ev && ev.recurrence);
  if (!rec) { yield base; return; }
  const until = rec.until
    ? new Date(+rec.until.slice(0, 4), +rec.until.slice(5, 7) - 1, +rec.until.slice(8, 10), 23, 59, 59, 999).getTime()
    : null;
  const lower = Number.isFinite(fromMs) ? fromMs : baseMs;
  const canSkip = rec.count == null; // count needs every occurrence counted
  let emitted = 0;

  if (rec.freq === 'weekly' && rec.byWeekday) {
    const set = new Set(rec.byWeekday);
    const dow0 = (base.getDay() + 6) % 7;                 // base weekday, 0=Mon
    const weekStart0 = new Date(p.y, p.mo, p.d - dow0); weekStart0.setHours(0, 0, 0, 0);
    const wk0 = weekStart0.getTime();
    let i0 = 0;
    if (canSkip && lower > baseMs) i0 = Math.max(0, Math.floor((lower - baseMs) / 86400000) - 7);
    for (let i = i0; i < i0 + RECUR_MAX * 7; i++) {
      const cur = new Date(p.y, p.mo, p.d + i, p.h, p.mi);
      if (cur.getTime() < baseMs) continue;
      const dow = (cur.getDay() + 6) % 7;
      if (!set.has(dow)) continue;
      const ws = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - dow); ws.setHours(0, 0, 0, 0);
      const weeks = Math.round((ws.getTime() - wk0) / (7 * 86400000));
      if (weeks % rec.interval !== 0) continue;
      emitted++;
      if (rec.count != null && emitted > rec.count) return;
      if (until != null && cur.getTime() > until) return;
      yield cur;
      if (emitted >= RECUR_MAX) return;
    }
    return;
  }

  let k0 = 0;
  if (canSkip && lower > baseMs) {
    if (rec.freq === 'daily')        k0 = Math.max(0, Math.floor((lower - baseMs) / 86400000 / rec.interval) - 1);
    else if (rec.freq === 'weekly')  k0 = Math.max(0, Math.floor((lower - baseMs) / (7 * 86400000) / rec.interval) - 1);
    else if (rec.freq === 'monthly') { const lo = new Date(lower); k0 = Math.max(0, Math.floor(((lo.getFullYear() - p.y) * 12 + (lo.getMonth() - p.mo)) / rec.interval) - 1); }
    else if (rec.freq === 'yearly')  { const lo = new Date(lower); k0 = Math.max(0, Math.floor((lo.getFullYear() - p.y) / rec.interval) - 1); }
  }
  for (let k = k0; k < k0 + RECUR_MAX; k++) {
    let occ;
    if (rec.freq === 'daily')        occ = new Date(p.y, p.mo, p.d + rec.interval * k, p.h, p.mi);
    else if (rec.freq === 'weekly')  occ = new Date(p.y, p.mo, p.d + 7 * rec.interval * k, p.h, p.mi);
    else if (rec.freq === 'monthly') { occ = new Date(p.y, p.mo + rec.interval * k, p.d, p.h, p.mi); if (occ.getDate() !== p.d) continue; }
    else                             { occ = new Date(p.y + rec.interval * k, p.mo, p.d, p.h, p.mi); if (occ.getDate() !== p.d || occ.getMonth() !== p.mo) continue; }
    emitted++;
    if (rec.count != null && emitted > rec.count) return;
    if (until != null && occ.getTime() > until) return;
    yield occ;
  }
}

// Occurrences of `ev` whose start falls within [rangeStart, rangeEnd] (Date
// or ms). Non-recurring events yield their single start when in range.
export function expandOccurrences(ev, rangeStart, rangeEnd) {
  const sMs = rangeStart instanceof Date ? rangeStart.getTime() : Number(rangeStart);
  const eMs = rangeEnd instanceof Date ? rangeEnd.getTime() : Number(rangeEnd);
  const out = [];
  for (const occ of recurIter(ev, sMs)) {
    const tMs = occ.getTime();
    if (tMs > eMs) break;       // ascending → safe to stop
    if (tMs >= sMs) out.push(occ);
  }
  return out;
}

// Timestamp (ms) of the first occurrence at or after `fromMs`, or null if the
// series has ended. Used by the reminder scheduler to arm the next fire.
export function nextOccurrence(ev, fromMs) {
  const from = Number.isFinite(fromMs) ? fromMs : Date.now();
  for (const occ of recurIter(ev, from)) {
    if (occ.getTime() >= from) return occ.getTime();
  }
  return null;
}

// Pull derived (read-only) events out of one note body. Pushes onto `out`.
// Skips fenced code blocks so a date inside a snippet isn't a reminder.
function scanNoteInlineEvents(vaultId, fileId, text, out) {
  if (!text) return;
  const lines = String(text).split(/\r?\n/);
  const seenKeys = new Map(); // id base → occurrences so far (duplicate lines)
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    // Match against a copy with inline-code spans removed, so example
    // tokens wrapped in backticks don't fire phantom reminders.
    const clean = stripInlineCode(raw);
    const matches = Array.from(clean.matchAll(INLINE_DATE_RE_G));
    if (!matches.length) continue;
    // Task state, if the line is a checkbox item.
    const task = raw.match(/^\s*[-*]\s+\[( |x|X)\]\s+/);
    const status = task ? (task[1].toLowerCase() === 'x' ? 'done' : 'open') : null;
    // Clean a human title: strip list/checkbox markers, headings and every
    // date token.
    const title = raw
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*[-*]\s+\[( |x|X)\]\s+/, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(INLINE_DATE_RE_G, '')
      .replace(/\s+/g, ' ')
      .trim() || '(sin título)';
    const norm = inlineNormTitle(title);
    for (const m of matches) {
      const token = m[1];
      const date = m[2];
      const time = m[3] || null;
      const start = time ? `${date}T${time.padStart(5, '0')}` : date;
      const base = `inline:${fileId}:h${inlineHash(`${norm}|${token}|${start}`)}`;
      const n = (seenKeys.get(base) || 0) + 1;
      seenKeys.set(base, n);
      out.push({
        id: n === 1 ? base : `${base}~${n}`,
        source: 'inline',
        kind: token === '⏰' || token === '@due(' || time ? 'reminder' : 'event',
        title,
        start,
        end: null,
        allDay: !time,
        remindAt: token === '⏰' || token === '@due(' ? start : null,
        noteId: fileId,
        anchor: { line: i, snippet: raw.trim().slice(0, 160) },
        status,
        recurrence: null,
        snoozedUntil: null,
        dismissed: false,
        createdAt: null,
        vaultId,
      });
    }
  }
}

// Overrides (snooze/dismiss shadow rows) saved before stable ids were keyed
// `inline:<fileId>:<lineIndex>`. Re-attach each to the inline event it was
// made for — same note, and same source line snippet (or same title+start),
// preferring the event still on that line — then re-key the row in yEvents
// (deferred: getVaultEvents is called from render paths).
function matchLegacyInlineOverride(rec, legacyLine, candidates) {
  const snip = rec && rec.anchor && rec.anchor.snippet ? String(rec.anchor.snippet) : null;
  const sameStart = (ev) => !rec.start || ev.start === rec.start || ev.remindAt === rec.remindAt;
  const pool = candidates.filter(ev => (snip && ev.anchor && ev.anchor.snippet === snip && sameStart(ev))
    || (!snip && rec.title && ev.title === rec.title && sameStart(ev)));
  if (!pool.length) return null;
  return pool.find(ev => ev.anchor && ev.anchor.line === legacyLine) || pool[0];
}
const pendingInlineRekeys = new Map(); // `${vaultId}|${oldId}` → newId
function scheduleInlineRekey(vaultId, oldId, newId) {
  const key = `${vaultId}|${oldId}`;
  if (pendingInlineRekeys.has(key)) return;
  pendingInlineRekeys.set(key, newId);
  setTimeout(() => {
    pendingInlineRekeys.delete(key);
    try {
      const map = vaultEventsMap(vaultId);
      if (!map) return;
      const rec = map.get(oldId);
      if (!rec || map.has(newId)) { if (rec && map.has(newId)) map.delete(oldId); return; }
      const doc = map.doc;
      const run = () => { map.set(newId, { ...rec, id: newId }); map.delete(oldId); };
      if (doc) doc.transact(run); else run();
    } catch {}
  }, 0);
}

// Eventos inline por nota, cacheados por el string de contenido (el de
// getContentString, que ya se invalida con los observers de Y.Text). Los
// recordatorios recorren TODAS las notas de TODOS los vaults en varios memos
// y efectos; sin caché cada pasada era toString() + regex línea a línea.
const inlineEventsCache = new Map();   // fileId → { vaultId, text, events }
function inlineEventsFor(vaultId, fileId) {
  const text = getContentString(fileId);
  const hit = inlineEventsCache.get(fileId);
  if (hit && hit.text === text && hit.vaultId === vaultId) return hit.events;
  const events = [];
  if (text) scanNoteInlineEvents(vaultId, fileId, text, events);
  inlineEventsCache.set(fileId, { vaultId, text, events });
  return events;
}

// Merged, normalised event feed for one vault: manual events + inline
// derived events. `getNoteDoc`-aware content read so per-note edits count.
export function getVaultEvents(vaultId) {
  const manual = new Map();
  const map = vaultEventsMap(vaultId);
  if (map) {
    for (const raw of map.values()) {
      const n = normalizeManualEvent(vaultId, raw);
      if (n) manual.set(n.id, { rec: n, shadow: !!(raw && raw._shadow) });
    }
  }
  const out = [];
  const e = getVaultDoc(vaultId);
  if (e && e.yFiles) {
    for (const meta of e.yFiles.values()) {
      const fid = meta && meta.id;
      if (!fid) continue;
      for (const ev of inlineEventsFor(vaultId, fid)) out.push(ev);
    }
  }
  // Apply manual override flags onto inline rows that share an id
  // (snoozedUntil/dismissed live on the manual shadow row).
  const byId = new Map();
  for (let i = 0; i < out.length; i++) byId.set(out[i].id, i);
  for (const [id, m] of Array.from(manual.entries())) {
    let idx = byId.get(id);
    if (idx == null && m.shadow) {
      // Legacy line-index id → find the event it belonged to.
      const lm = LEGACY_INLINE_ID_RE.exec(id);
      if (lm) {
        const cands = out.filter(ev => ev.source === 'inline' && ev.noteId === lm[1] && !manual.has(ev.id));
        const hit = matchLegacyInlineOverride(m.rec, Number(lm[2]), cands);
        if (hit) { idx = byId.get(hit.id); scheduleInlineRekey(vaultId, id, hit.id); }
      }
    }
    if (idx == null) continue;
    out[idx] = { ...out[idx], snoozedUntil: m.rec.snoozedUntil, dismissed: m.rec.dismissed };
    manual.delete(id);
  }
  // Real manual rows (non-shadow) get pushed as their own events.
  for (const { rec, shadow } of manual.values()) {
    if (!shadow) out.push(rec);
  }
  return out;
}

export function addEvent(vaultId, evt) {
  const map = vaultEventsMap(vaultId);
  if (!map) return null;
  const id = (evt && evt.id) || ('ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  map.set(id, { ...evt, id, createdAt: (evt && evt.createdAt) || Date.now() });
  return id;
}

export function updateEvent(vaultId, id, patch) {
  const map = vaultEventsMap(vaultId);
  if (!map) return false;
  const cur = map.get(id);
  if (!cur) return false;
  map.set(id, { ...cur, ...patch });
  return true;
}

export function deleteEvent(vaultId, id) {
  const map = vaultEventsMap(vaultId);
  if (!map || !map.has(id)) return false;
  map.delete(id);
  return true;
}

// F2 — snooze/dismiss for reminders. Inline (derived) reminders cannot
// be mutated directly because they live in note text, so the caller
// promotes them to a manual override row in `yEvents` keyed by the
// original inline id. This lets the scheduler hide/reschedule them
// without rewriting the source note.
function ensureManualForInline(vaultId, inlineId, fallback) {
  const map = vaultEventsMap(vaultId);
  if (!map) return null;
  let rec = map.get(inlineId);
  if (!rec) {
    rec = {
      id: inlineId,
      kind: (fallback && fallback.kind) || 'reminder',
      title: (fallback && fallback.title) || '(sin título)',
      start: (fallback && fallback.start) || null,
      allDay: !!(fallback && fallback.allDay),
      remindAt: (fallback && fallback.remindAt) || (fallback && fallback.start) || null,
      noteId: (fallback && fallback.noteId) || null,
      anchor: (fallback && fallback.anchor) || null,
      createdAt: Date.now(),
      _shadow: true, // marks this row as override-only for an inline event
    };
    map.set(inlineId, rec);
  }
  return rec;
}

export function snoozeEvent(vaultId, id, untilIso, fallback) {
  const map = vaultEventsMap(vaultId);
  if (!map) return false;
  if (!map.has(id) && fallback) ensureManualForInline(vaultId, id, fallback);
  const cur = map.get(id);
  if (!cur) return false;
  map.set(id, { ...cur, snoozedUntil: untilIso, dismissed: false });
  return true;
}

export function dismissEvent(vaultId, id, fallback) {
  const map = vaultEventsMap(vaultId);
  if (!map) return false;
  if (!map.has(id) && fallback) ensureManualForInline(vaultId, id, fallback);
  const cur = map.get(id);
  if (!cur) return false;
  map.set(id, { ...cur, dismissed: true, snoozedUntil: null });
  return true;
}


export function activeMeta()     { return isPerVaultMode() ? getActiveVaultDoc().yMeta     : yMeta; }
export function activeContent(fileId) {
  return isPerVaultMode() ? getActiveVaultDoc().getContent(fileId) : getContent(fileId);
}

// Ensures the Hocuspocus provider for the current active vault is up
// when in per-vault mode. Idempotent — repeat calls reuse existing
// provider. Caller should also pass the workspace-level sync config
// so we have wsUrl + token + currentWorkspaceId.
export function ensureActiveVaultProvider(cfg) {
  if (!cfg || !cfg.token || !cfg.currentWorkspaceId) return null;
  const vid = getActiveVaultId();
  // Pre-boot providers for every vault listed in the workspace shell —
  // ViewMenu / file pickers iterate across all vaults' yFiles for
  // organisational display, so we need each vault's Y.Doc populated
  // even if it's not the currently active surface. Cheap: typical
  // workspaces have 1–5 vaults, providers are lazy after first
  // connect.
  try {
    for (const vmeta of yVaults.values()) {
      if (vmeta && vmeta.id) connectVaultProvider(vmeta.id, cfg);
    }
    // Also include the active vault (may be 'default' which isn't in
    // yVaults explicitly until materialised by the app).
    if (vid) connectVaultProvider(vid, cfg);
  } catch (err) {
    console.warn('[per-vault] pre-boot failed:', err.message);
  }
  return null;
}

// Switch helper — disconnects the old vault provider (optional) and
// brings up the new one. Memory grows linearly with vaults the user
// touches; cheap and acceptable for typical sizes.
export function switchActiveVault(nextVid, cfg) {
  if (!nextVid) return;
  try { yMeta.set('activeVault', nextVid); } catch {}
  if (isPerVaultMode()) connectVaultProvider(nextVid, cfg);
}

// Seed body of a newly-created note. Materialises the per-note Y.Doc
// FIRST so that getContent (which prefers noteRegistry.ytext once an
// entry exists) returns the same Y.Text we're writing into. Without
// this, writes land in the vault-doc fallback and are then masked by
// an empty per-note ytext the next render — making the new note look
// blank, which the user perceives as "the editor jumped to another
// note". Idempotent if the per-note ytext already has content.
export function seedNoteContent(fileId, content) {
  if (!fileId) return;
  const e = getNoteDoc(fileId);
  if (!e || !e.ytext) return;
  if (e.ytext.length > 0) return;
  if (!content) return;
  e.ydoc.transact(() => { e.ytext.insert(0, content); });
}

// Physically move a note between vault docs. Same-vault calls just
// rewrite the meta entry. Cross-vault calls copy meta + content into
// the destination vault and delete from the source so the file stops
// appearing in the source vault's sidebar / Ctrl+P. The per-note doc
// (Fase D) — if one is loaded — gets its ytext repointed and any
// active provider torn down so the next connectNoteProvider call
// rebuilds with the destination vault id in the URL.
export function moveNoteAcrossVaults(noteId, destVaultId, destFolderId) {
  if (!noteId || !destVaultId) return false;
  const located = locateFileAcrossVaults(noteId);
  if (!located) return false;
  const srcDoc = located.doc;
  const srcVaultId = located.vaultId;
  const srcMeta = located.meta;
  const folderId = destFolderId || null;

  if (srcVaultId === destVaultId) {
    srcDoc.transact(() => {
      const sf = srcDoc.getMap('files');
      const cur = sf.get(noteId);
      if (cur) sf.set(noteId, { ...cur, folderId, vaultId: destVaultId });
    });
    return true;
  }

  // Read content from the canonical source — per-note doc takes priority
  // over vault-level content via getContent, so a note that was already
  // edited in its per-note doc carries the latest body across.
  const srcText = getContent(noteId);
  const content = srcText ? srcText.toString() : '';

  const destEntry = getVaultDoc(destVaultId);
  if (!destEntry) return false;
  destEntry.ydoc.transact(() => {
    destEntry.yFiles.set(noteId, {
      ...srcMeta,
      vaultId: destVaultId,
      folderId,
    });
    const dText = destEntry.ydoc.getText('content:' + noteId);
    if (dText.length > 0) dText.delete(0, dText.length);
    if (content) dText.insert(0, content);
  });

  srcDoc.transact(() => {
    const sf = srcDoc.getMap('files');
    sf.delete(noteId);
    const sText = srcDoc.getText('content:' + noteId);
    if (sText.length > 0) sText.delete(0, sText.length);
  });

  const noteEntry = noteRegistry.get(noteId);
  if (noteEntry) {
    if (noteEntry.provider) {
      try { noteEntry.provider.destroy(); } catch {}
      noteEntry.provider = null;
      noteEntry.status = 'idle';
    }
    if (noteEntry.ytext) {
      noteEntry.ydoc.transact(() => {
        if (noteEntry.ytext.length > 0) noteEntry.ytext.delete(0, noteEntry.ytext.length);
        if (content) noteEntry.ytext.insert(0, content);
      });
    }
  }
  return true;
}

// Cross-vault folder move. Walks descendant folders and every file
// that lives under them (in the source vault's yFiles), then re-homes
// each into the destination vault doc. Same-vault moves stay cheap —
// just a metadata flip on the folder itself.
export function moveFolderAcrossVaults(folderId, destVaultId, destParentId) {
  if (!folderId || !destVaultId) return false;
  // Locate folder + its source vault.
  let srcEntry = null;
  let folderMeta = null;
  for (const e of vaultRegistry.values()) {
    const m = e.yFolders.get(folderId);
    if (m) { srcEntry = e; folderMeta = m; break; }
  }
  if (!srcEntry || !folderMeta) return false;

  const collectDescendants = (root) => {
    const set = new Set();
    const walk = (parent) => {
      for (const ch of srcEntry.yFolders.values()) {
        if (ch.parentId === parent && !set.has(ch.id)) {
          set.add(ch.id); walk(ch.id);
        }
      }
    };
    walk(root);
    return set;
  };
  const descendants = collectDescendants(folderId);

  if (destParentId && (destParentId === folderId || descendants.has(destParentId))) {
    console.warn('[move] cannot move folder into itself or its descendants');
    return false;
  }

  if (srcEntry.vaultId === destVaultId) {
    srcEntry.ydoc.transact(() => {
      srcEntry.yFolders.set(folderId, { ...folderMeta, parentId: destParentId || null, vaultId: destVaultId });
    });
    return true;
  }

  const destEntry = getVaultDoc(destVaultId);
  if (!destEntry) return false;

  // Snapshot every folder + file we need to copy BEFORE mutating, so we
  // don't iterate a map that's being deleted from.
  const folderIds = [folderId, ...descendants];
  const foldersToMove = folderIds.map(fid => srcEntry.yFolders.get(fid)).filter(Boolean);
  const filesToMove = [];
  for (const file of srcEntry.yFiles.values()) {
    if (file.folderId && folderIds.includes(file.folderId)) {
      const yt = srcEntry.ydoc.getText('content:' + file.id);
      filesToMove.push({ meta: file, content: yt ? yt.toString() : '' });
    }
  }

  destEntry.ydoc.transact(() => {
    for (const fm of foldersToMove) {
      const isRoot = fm.id === folderId;
      destEntry.yFolders.set(fm.id, {
        ...fm,
        vaultId: destVaultId,
        parentId: isRoot ? (destParentId || null) : fm.parentId,
      });
    }
    for (const { meta, content } of filesToMove) {
      destEntry.yFiles.set(meta.id, { ...meta, vaultId: destVaultId });
      const dText = destEntry.ydoc.getText('content:' + meta.id);
      if (dText.length > 0) dText.delete(0, dText.length);
      if (content) dText.insert(0, content);
    }
  });

  srcEntry.ydoc.transact(() => {
    for (const fm of foldersToMove) srcEntry.yFolders.delete(fm.id);
    for (const { meta } of filesToMove) {
      srcEntry.yFiles.delete(meta.id);
      const sText = srcEntry.ydoc.getText('content:' + meta.id);
      if (sText.length > 0) sText.delete(0, sText.length);
    }
  });

  // Repoint any loaded per-note docs for the files we just moved, same
  // rationale as moveNoteAcrossVaults — vault id is in the per-note URL.
  for (const { meta, content } of filesToMove) {
    const noteEntry = noteRegistry.get(meta.id);
    if (!noteEntry) continue;
    if (noteEntry.provider) {
      try { noteEntry.provider.destroy(); } catch {}
      noteEntry.provider = null;
      noteEntry.status = 'idle';
    }
    if (noteEntry.ytext) {
      noteEntry.ydoc.transact(() => {
        if (noteEntry.ytext.length > 0) noteEntry.ytext.delete(0, noteEntry.ytext.length);
        if (content) noteEntry.ytext.insert(0, content);
      });
    }
  }
  return true;
}

// ─── Papelera ────────────────────────────────────────────────────────
// Borrar una nota la mueve al mapa `trash` de SU vault (metadatos + texto +
// fecha) y la quita de `files`: para versiones antiguas, el MCP y la CLI la
// nota sencillamente ya no existe; desde aquí se puede restaurar. Los
// adjuntos huérfanos se borran del servidor solo al eliminarla de verdad.
export const TRASH_DAYS = 30;
function trashVaultDocs() {
  return Array.from(vaultRegistry.values()).map(e => ({ vaultId: e.vaultId, doc: e.ydoc }));
}
export function trashFile(fileId) {
  const loc = locateFileAcrossVaults(fileId);
  if (!loc) return false;
  const { doc, meta } = loc;
  // El texto vigente (documento propio de la nota si está conectado; si no, la copia del vault).
  let body = '';
  try { const live = getContent(fileId); body = live ? live.toString() : ''; } catch {}
  doc.transact(() => {
    const text = doc.getText('content:' + fileId);
    if (!body) body = text.toString();
    doc.getMap('trash').set(fileId, { meta: { ...meta }, content: body, deletedAt: new Date().toISOString() });
    doc.getMap('files').delete(fileId);
    if (text.length > 0) text.delete(0, text.length);
  });
  return true;
}
export function listTrash() {
  const out = [];
  for (const { vaultId, doc } of trashVaultDocs()) {
    doc.getMap('trash').forEach((v, id) => {
      if (!v || !v.meta) return;
      out.push({ id, vaultId, name: v.meta.name || id, icon: v.meta.icon || null, deletedAt: v.deletedAt || null, size: (v.content || '').length });
    });
  }
  return out.sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
}
function findTrashed(fileId) {
  for (const { vaultId, doc } of trashVaultDocs()) {
    const v = doc.getMap('trash').get(fileId);
    if (v) return { vaultId, doc, v };
  }
  return null;
}
// Restaura la nota. Si su carpeta ya no existe, vuelve a la raíz del vault.
export function restoreTrashed(fileId) {
  const f = findTrashed(fileId);
  if (!f) return null;
  const { doc, v } = f;
  doc.transact(() => {
    const meta = { ...v.meta };
    if (meta.folderId && !doc.getMap('folders').has(meta.folderId)) delete meta.folderId;
    doc.getMap('files').set(fileId, meta);
    const text = doc.getText('content:' + fileId);
    if (text.length > 0) text.delete(0, text.length);
    if (v.content) text.insert(0, v.content);
    doc.getMap('trash').delete(fileId);
  });
  // Si el documento propio de la nota está conectado y difiere, también.
  try {
    const live = noteRegistry.get(fileId);
    if (live && live.ytext && live.ytext.toString() !== (v.content || '')) {
      live.ydoc.transact(() => { live.ytext.delete(0, live.ytext.length); if (v.content) live.ytext.insert(0, v.content); });
    }
  } catch {}
  return fileId;
}
// Elimina definitivamente; devuelve el texto (para calcular adjuntos huérfanos).
export function purgeTrashed(fileId) {
  const f = findTrashed(fileId);
  if (!f) return null;
  f.doc.getMap('trash').delete(fileId);
  return f.v.content || '';
}
// Purga lo que lleve más de TRASH_DAYS días; devuelve los textos purgados.
export function purgeOldTrash(days = TRASH_DAYS) {
  const limit = Date.now() - days * 86400e3;
  const bodies = [];
  for (const it of listTrash()) {
    const at = Date.parse(it.deletedAt || '');
    if (Number.isFinite(at) && at < limit) { const b = purgeTrashed(it.id); if (b != null) bodies.push(b); }
  }
  return bodies;
}
// Textos de todo lo que hay en la papelera (para no borrar adjuntos que usa
// otra nota borrada que aún se puede restaurar).
export function trashContents() {
  const out = [];
  for (const { doc } of trashVaultDocs()) doc.getMap('trash').forEach(v => { if (v && v.content) out.push(v.content); });
  return out;
}
