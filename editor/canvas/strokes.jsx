import { dashArray } from './outline.js';
// Herramientas de dibujo: trazos, flechas, rellenos y rejilla.

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

import { CLOSED_SHAPES } from './shapes.js';
// ─── Canvas drawing engine ────────────────────────────────────────────────
// Tooling for free drawing + vector shapes. Strokes and shapes are stored in
// `json.annotations` (the SVG overlay), not as nodes — so they're lightweight
// and never carry node chrome. Pen strokes are pressure-aware variable-width
// filled outlines; the highlighter is a flat translucent stroke; shapes are
// drag-drawn rect/ellipse/diamond/line/arrow.
export const CANVAS_CLOSED_SHAPE_SET = new Set(CLOSED_SHAPES);   // rect, ellipse, diamond, triangle, star, hexagon, cylinder, cloud, callout
export const CANVAS_DRAW_TOOLS = new Set(['pen', 'highlighter', 'eraser', 'line', 'arrow', 'laser', ...CLOSED_SHAPES]);
export const CANVAS_SHAPE_TOOLS = new Set(['line', 'arrow', ...CLOSED_SHAPES]);
// Translucent fill derived from a hex stroke color (shapes drawn with the
// fill toggle on, and the sel-bar fill swatches).
export function canvasFillFromHex(hex, alpha = 0.18) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
// Dash presets shared by edges and annotations.
export function canvasDashArray(style) {
  return dashArray(style);
}
export const CANVAS_PEN_COLORS = ['#1f2937', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
// Sticky-note pastel palette. First entry is the default; the sel-bar swaps
// to these swatches when the whole selection is stickies.
export const CANVAS_STICKY_COLORS = ['#E7DFFA', '#D9ECFB', '#D4F1DE', '#FCE8C9', '#FADDE4', '#D9DDFA', '#EFEBE3'];
export const CANVAS_STICKY_SIZE = 180;
export const CANVAS_GRID = 20; // snap-to-grid step (world units)

export const cpMid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Smooth a polyline into a quadratic-bezier `d` (midpoint Catmull-Rom). Used
// for the highlighter and as the centreline for hit-testing.
export function smoothStrokeD(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return pts.map((p, i) => (i ? 'L' : 'M') + ` ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = cpMid(pts[i], pts[i + 1]);
    d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  return d;
}

// Trazos con puntos crudos (`pts` = [[x,y,presión]], `size`): se pueden
// redimensionar y cambiar de grosor regenerando `d`, que se sigue guardando
// para versiones antiguas, el MCP y la exportación.
export const packStrokePts = (pts) => pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round((p[2] != null ? p[2] : 0.5) * 100) / 100]);
export function strokeD(a, pts = a.pts, size = a.size) {
  if (a.variant === 'pen') return strokeOutlineD(pts, size || 4);
  return smoothStrokeD(pts);
}
export const ptsBbox = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// perfect-freehand-style variable-width outline. pts: [[x,y,pressure]]. Returns
// a closed filled path that tapers with pressure/speed for a natural ink feel.
export function strokeOutlineD(pts, size) {
  const n = pts.length;
  if (n === 0) return '';
  const radiusAt = (p) => Math.max(0.5, (size * (0.35 + (p == null ? 0.5 : p) * 0.65)) / 2);
  if (n === 1) {
    const [x, y, p] = pts[0];
    const r = radiusAt(p);
    return `M ${(x - r).toFixed(1)} ${y.toFixed(1)} a ${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(r * 2).toFixed(1)} 0 a ${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-r * 2).toFixed(1)} 0 z`;
  }
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const cur = pts[i], prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
    let nx = next[0] - prev[0], ny = next[1] - prev[1];
    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
    const r = radiusAt(cur[2]);
    const px = -ny, py = nx; // perpendicular
    left.push([cur[0] + px * r, cur[1] + py * r]);
    right.push([cur[0] - px * r, cur[1] - py * r]);
  }
  const fwd = left.map((p, i) => (i ? 'L' : 'M') + ` ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const back = right.reverse().map(p => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `${fwd} ${back} Z`;
}

// Filled arrowhead triangle at (x2,y2), sized to the stroke width and pointing
// along the line — so it takes the stroke colour and scales with thickness
// (the shared SVG marker was fixed-size + always currentColor=black).
export function arrowHeadPath(x1, y1, x2, y2, sw) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(7, (sw || 2) * 3 + 4);
  const w = len * 0.72;
  const bx = x2 - Math.cos(ang) * len, by = y2 - Math.sin(ang) * len;
  const lx = bx + Math.cos(ang + Math.PI / 2) * (w / 2), ly = by + Math.sin(ang + Math.PI / 2) * (w / 2);
  const rx = bx + Math.cos(ang - Math.PI / 2) * (w / 2), ry = by + Math.sin(ang - Math.PI / 2) * (w / 2);
  return `M ${x2.toFixed(1)} ${y2.toFixed(1)} L ${lx.toFixed(1)} ${ly.toFixed(1)} L ${rx.toFixed(1)} ${ry.toFixed(1)} Z`;
}

export const canvasAnnoId = () => 'an-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const snapVal = (v) => Math.round(v / CANVAS_GRID) * CANVAS_GRID;

