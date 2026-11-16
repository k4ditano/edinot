// Índice de notas, autolayout y utilidades de texto del canvas.

import { useI18n, t, getLang } from '../../i18n.js';
import { useRef, useState, useMemo, useEffect, useLayoutEffect, useDeferredValue, useCallback, memo } from 'react';
import { mountDbBlock, sweepDbBlocks } from '../db/mount.jsx';
import { yMeta, getVaultEvents, isPendingReminder, ydoc, getCanvasUndoManager, getNoteDoc } from '../../store.js';
import { readNoteComments, putComment, patchComments } from '../../shared/comments-model.js';
import { buildCanvasTemplate, canvasTemplateInfo } from '../../shared/canvas-templates.js';
import { CanvasDock, CanvasActions, CanvasZoom, CvIcon } from '../../ui/canvas/CanvasChrome.jsx';
import { CanvasMinimap } from '../../ui/canvas/CanvasMinimap.jsx';
import { buildGrid } from './spatial.js';
import { drawLod, LOD_ZOOM, LOD_MIN_VISIBLE } from './lod.js';
import { sketchShapePaths, sketchPathD, sketchSvg } from './sketch.js';
import { layoutEdge, pathToD, flatten, pointAt, closestT, headGeom, trimPath, endAngles, anchorPoint, nearestSide, sideToward, edgeKeyOf, EDGE_ROUTES } from './edges.js';
import { canvasEdgeId } from '../../shared/canvas-model.js';
import { createCanvasPresence } from './presence.js';
import { nodeZ, annoZ, stepZ } from './zorder.js';
import { treeIndex, descendantsOf, hiddenByCollapse, markedRoot, layoutMindmap, addChild, reparent } from './mindmap.js';
import {
  AnchorCommentPopover,
  DB_OPS,
  VIcon,
  applyTemplate,
  attachmentKind,
  createMdRenderer,
  escapeHtml,
  extractWikilinks,
  firstCanvasBlock,
  gsFold,
  gsFoldedSearchable,
  gsNameFolded,
  humanFileSize,
  normalizeNoteName,
  parseSourceTables,
  resolveDateShortcuts,
  searchableContent,
  stripViewDirectives,
  useCommentsVersion,
  youtubeId,
} from '../../editor.jsx';
import { vimeoId, isDirectVideoUrl, titleFromUrlShort, CANVAS_DEFAULT_NODE_W, CANVAS_DEFAULT_NODE_H, CANVAS_GROUP_DEFAULT_W, CANVAS_GROUP_DEFAULT_H, useStableFn, canvasNodeRect, grpRemapper, canvasPerf, CANVAS_CULL_MIN, CANVAS_EDGE_CULL_MIN, edgeTouches, CANVAS_MM_DIMS, canvasNodeId, canvasGroupId } from './common.jsx';
import { CANVAS_STICKY_SIZE } from './strokes.jsx';
import { stickyFontSize as _stickyFontSize } from '../../shared/sticky-fit.mjs';

// Build a fast lookup table keyed by both note id and lowercased name so
// `noteId` references in canvas survive renames and `noteName` references
// (used by MCP) resolve case-insensitively.
export function buildNoteIndex(notes) {
  const byId = new Map();
  const byName = new Map();
  for (const f of notes) {
    byId.set(f.id, f);
    byName.set((f.name || '').toLowerCase().replace(/\.(md|markdown|txt)$/i, ''), f);
  }
  return { byId, byName };
}
export function resolveCanvasNote(node, idx) {
  if (!node) return null;
  if (node.noteId && idx.byId.has(node.noteId)) return idx.byId.get(node.noteId);
  if (node.noteName) {
    const f = idx.byName.get(String(node.noteName).toLowerCase().replace(/\.(md|markdown|txt)$/i, ''));
    if (f) return f;
  }
  return null;
}

// Auto-layouts. `mode`: 'grid' (default) places everything on a square grid;
// 'tree' lays out the edge graph left→right (BFS from roots, parents centered
// on their children); 'mindmap' splits the root's branches into right/left
// halves, classic mind-map style. Tree/mindmap only reposition — no library,
// no physics — and fall back to grid when there are no edges.
export function autoLayoutCanvas(json, opts = {}) {
  const mode = opts.mode || 'grid';
  if ((mode === 'tree' || mode === 'mindmap') && (json.edges || []).length) {
    return layoutCanvasTree(json, mode);
  }
  const padX = opts.padX || 40;
  const padY = opts.padY || 32;
  const cellW = (opts.nodeW || CANVAS_DEFAULT_NODE_W) + padX;
  const cellH = (opts.nodeH || CANVAS_DEFAULT_NODE_H) + padY;
  const cols = Math.max(1, Math.ceil(Math.sqrt(json.nodes.length || 1)));
  const nodes = json.nodes.map((n, i) => ({
    ...n,
    x: padX + (i % cols) * cellW,
    y: padY + Math.floor(i / cols) * cellH,
    w: n.w || opts.nodeW || CANVAS_DEFAULT_NODE_W,
    h: n.h || opts.nodeH || CANVAS_DEFAULT_NODE_H,
  }));
  return { ...json, nodes };
}

export function layoutCanvasTree(json, mode) {
  const nodes = json.nodes || [];
  if (!nodes.length) return json;
  const W = (n) => n.w || CANVAS_DEFAULT_NODE_W, H = (n) => n.h || CANVAS_DEFAULT_NODE_H;
  const cellW = Math.max(...nodes.map(W)) + 90;
  const cellH = Math.max(...nodes.map(H)) + 30;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const children = new Map(nodes.map(n => [n.id, []]));
  const hasParent = new Set();
  for (const e of (json.edges || [])) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    children.get(e.from).push(e.to);
    hasParent.add(e.to);
  }
  let roots = nodes.filter(n => !hasParent.has(n.id) && children.get(n.id).length).map(n => n.id);
  if (!roots.length) roots = [nodes[0].id];
  const visited = new Set();
  const pos = new Map();
  const X0 = 80, Y0 = 80;
  let cursorY = Y0;
  // Post-order: children placed first, parent vertically centered over them.
  // `dir` mirrors the x axis for the left half of a mindmap.
  const place = (id, depth, dir) => {
    if (visited.has(id)) return null;
    visited.add(id);
    const kids = (children.get(id) || []).filter(k => !visited.has(k));
    const placedYs = [];
    for (const k of kids) {
      const y = place(k, depth + 1, dir);
      if (y != null) placedYs.push(y);
    }
    let y;
    if (placedYs.length) y = (Math.min(...placedYs) + Math.max(...placedYs)) / 2;
    else { y = cursorY; cursorY += cellH; }
    pos.set(id, { x: X0 + dir * depth * cellW, y });
    return y;
  };
  if (mode === 'mindmap' && roots.length) {
    // Single root; alternate its branches right/left, sub-trees follow suit.
    const root = roots[0];
    visited.add(root);
    const kids = children.get(root) || [];
    const right = kids.filter((_, i) => i % 2 === 0);
    const left = kids.filter((_, i) => i % 2 === 1);
    const ys = [];
    for (const k of right) { const y = place(k, 1, 1); if (y != null) ys.push(y); }
    for (const k of left) { const y = place(k, 1, -1); if (y != null) ys.push(y); }
    const rootY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : Y0;
    pos.set(root, { x: X0, y: rootY });
    for (const r of roots.slice(1)) place(r, 0, 1);
  } else {
    for (const r of roots) place(r, 0, 1);
  }
  // Orphans / cycle leftovers stack below whatever was placed.
  for (const n of nodes) {
    if (!pos.has(n.id)) { pos.set(n.id, { x: X0, y: cursorY }); cursorY += cellH; }
  }
  // Mindmap can go negative on x — shift everything back into view.
  let minX = Infinity;
  for (const p of pos.values()) minX = Math.min(minX, p.x);
  const shift = minX < X0 ? X0 - minX : 0;
  return {
    ...json,
    nodes: nodes.map(n => {
      const p = pos.get(n.id);
      return p ? { ...n, x: p.x + shift, y: p.y } : n;
    }),
  };
}

export function canvasPreviewText(src) {
  let s = stripViewDirectives(String(src || ''));
  s = s.replace(/```edinot-canvas[\s\S]*?```/g, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/^#{1,6}\s+.*$/gm, '');
  s = s.replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g, '$1');
  s = s.replace(/[`*_~>#-]/g, '');
  s = s.replace(/\|/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// Auto font-size de los post-its: vive en shared/ (puro y comprobable); aquí solo se aplica el tamaño por defecto.
export const stickyFontSize = (text, w, h) => _stickyFontSize(text, w, h, CANVAS_STICKY_SIZE);

