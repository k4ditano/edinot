// Structured canvas model (co-edición · Fase 1) — SHARED between the renderer
// (store.js) and the CLI/MCP store (cli/lib.mjs). Keeping a single source here
// is what guarantees the deterministic mirror serializes byte-identically on
// every writer; otherwise the app's mirror and the MCP's mirror would rewrite
// the fence in different key orders and thrash each other.
//
// The canvas source of truth is structured Yjs types on the note's per-note
// Y.Doc — one Y.Map per node / edge / annotation — so concurrent moves of
// different nodes merge cleanly (same-field edits are last-writer-wins). The
// ```edinot-canvas fence in the note body is kept as a deterministic derived
// mirror so export / MCP / CLI / git keep reading it.
//
// All functions take a Yjs doc handle so the same code serves both processes.

import * as Y from 'yjs';

export function canvasTypes(ydoc) {
  return {
    ydoc,
    nodes: ydoc.getArray('canvasNodes'),
    edges: ydoc.getArray('canvasEdges'),
    groups: ydoc.getArray('canvasGroups'),
    annotations: ydoc.getArray('canvasAnnotations'),
    meta: ydoc.getMap('canvasMeta'),
  };
}

function ymapToObj(m) {
  const o = {};
  m.forEach((v, k) => { o[k] = v; });
  return o;
}

function objToYMap(o) {
  const m = new Y.Map();
  for (const [k, v] of Object.entries(o || {})) {
    if (v === undefined) continue;
    m.set(k, v);
  }
  return m;
}

// Stable diff key. Nodes carry an id; edges may not, so fall back to endpoints
// + kind. Backlink edges are derived (never stored) and filtered by callers.
export function canvasEdgeKey(e) {
  return e.id || `${e.from}->${e.to}:${e.kind || 'manual'}`;
}

// Id estable de una arista nueva. Las aristas antiguas no lo tienen y siguen
// identificándose por `from->to:kind`; se les asigna uno la primera vez que se editan.
export function canvasEdgeId() {
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function isCanvasMigrated(ydoc) {
  return !!canvasTypes(ydoc).meta.get('migrated');
}

// Plain-JS snapshot. Array order follows the Y.Array (converges across peers).
export function readCanvasSnapshot(ydoc) {
  const t = canvasTypes(ydoc);
  return {
    nodes: t.nodes.map(ymapToObj),
    edges: t.edges.map(ymapToObj),
    groups: t.groups.map(ymapToObj),
    annotations: t.annotations.map(ymapToObj),
    // Estado de sesión compartido (temporizador, votación). Vive en el mapa
    // meta y NO va al espejo Markdown: cambia a menudo y es efímero.
    ...(t.meta.get('session') ? { session: t.meta.get('session') } : {}),
  };
}

// Migration: seed the structured types from a parsed fence JSON, once.
// Idempotent — guarded by the `migrated` flag + an emptiness check so a re-open
// or a concurrent peer can't double-insert.
export function seedCanvasFromJson(ydoc, json) {
  if (!json) return false;
  const t = canvasTypes(ydoc);
  if (t.meta.get('migrated')) return false;
  ydoc.transact(() => {
    if (t.nodes.length === 0 && Array.isArray(json.nodes)) {
      for (const n of json.nodes) t.nodes.push([objToYMap(n)]);
    }
    if (t.edges.length === 0 && Array.isArray(json.edges)) {
      for (const e of json.edges) {
        if ((e.kind || 'manual') === 'backlink') continue;  // derived, never stored
        t.edges.push([objToYMap(e)]);
      }
    }
    if (t.groups.length === 0 && Array.isArray(json.groups)) {
      for (const g of json.groups) t.groups.push([objToYMap(g)]);
    }
    if (t.annotations.length === 0 && Array.isArray(json.annotations)) {
      for (const a of json.annotations) t.annotations.push([objToYMap(a)]);
    }
    t.meta.set('migrated', true);
  });
  return true;
}

// Reconcile a Y.Array of Y.Maps toward a desired plain-object list keyed by
// `keyOf`: delete missing, add new, patch changed fields in place. Granular
// updates are what make concurrent edits to different items merge cleanly.
function reconcileCanvasArray(yarr, desired, keyOf) {
  const desiredKeys = new Set(desired.map(keyOf));
  for (let i = yarr.length - 1; i >= 0; i--) {
    if (!desiredKeys.has(keyOf(ymapToObj(yarr.get(i))))) yarr.delete(i, 1);
  }
  const byKey = new Map();
  for (let i = 0; i < yarr.length; i++) {
    const m = yarr.get(i);
    byKey.set(keyOf(ymapToObj(m)), m);
  }
  for (const obj of desired) {
    const m = byKey.get(keyOf(obj));
    if (!m) { yarr.push([objToYMap(obj)]); continue; }
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      if (m.get(k) !== v) m.set(k, v);
    }
    const stale = [];
    m.forEach((_, k) => { if (!(k in obj)) stale.push(k); });
    for (const k of stale) m.delete(k);
  }
}

// Una arista antigua (sin id) que recibe id al editarse cambiaría de clave y
// el reconciliador la borraría y la añadiría AL FINAL (cambiando su orden de
// pintado). Se le pone el id en su sitio antes de reconciliar.
function adoptEdgeIds(yarr, desired) {
  const legacy = (e) => `${e.from}->${e.to}:${e.kind || 'manual'}`;
  const present = new Set();
  const noId = new Map();
  for (let i = 0; i < yarr.length; i++) {
    const m = yarr.get(i);
    const id = m.get('id');
    if (id) present.add(id);
    else { const o = ymapToObj(m); if (!noId.has(legacy(o))) noId.set(legacy(o), m); }
  }
  if (!noId.size) return;
  for (const e of desired) {
    if (!e.id || present.has(e.id)) continue;
    const m = noId.get(legacy(e));
    if (m) { m.set('id', e.id); noId.delete(legacy(e)); present.add(e.id); }
  }
}

// Apply a desired full snapshot (CanvasView's onChange shape / an MCP tool's
// computed next-JSON) to the structured types, granular, in one transaction.
export function applyCanvasSnapshot(ydoc, next) {
  if (!next) return;
  const t = canvasTypes(ydoc);
  ydoc.transact(() => {
    reconcileCanvasArray(t.nodes, Array.isArray(next.nodes) ? next.nodes : [], n => n.id);
    const edges = (Array.isArray(next.edges) ? next.edges : []).filter(e => (e.kind || 'manual') !== 'backlink');
    adoptEdgeIds(t.edges, edges);
    reconcileCanvasArray(t.edges, edges, canvasEdgeKey);
    reconcileCanvasArray(t.groups, Array.isArray(next.groups) ? next.groups : [], g => g.id);
    reconcileCanvasArray(t.annotations, Array.isArray(next.annotations) ? next.annotations : [], a => a.id);
    if ('session' in next) {
      const cur = t.meta.get('session') || null;
      const nv = next.session || null;
      if (JSON.stringify(cur) !== JSON.stringify(nv)) { if (nv) t.meta.set('session', nv); else t.meta.delete('session'); }
    }
  });
}

// Deterministic JSON for the derived fence mirror: stable key order within each
// object + Y.Array order (converges across peers) → every writer regenerates
// byte-identical text from a converged structure, so the mirror never thrashes.
function sortedObj(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}
export function serializeCanvasDeterministic(ydoc) {
  const snap = readCanvasSnapshot(ydoc);
  // Always include nodes/edges/groups to match the legacy fence shape (which
  // parseCanvasBlocks defaults to). annotations only when present.
  const norm = {
    nodes: snap.nodes.map(sortedObj),
    edges: snap.edges.map(sortedObj),
    groups: snap.groups.map(sortedObj),
  };
  if (snap.annotations.length) norm.annotations = snap.annotations.map(sortedObj);
  return JSON.stringify(norm, null, 2);
}
