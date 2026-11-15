// Constantes y utilidades comunes del canvas (extraídas de CanvasView.jsx).
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



export function vimeoId(url) {
  const m = String(url || '').match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

// Direct media file URLs (.mp4 etc.) play in a native <video> tile.
export function isDirectVideoUrl(url) {
  return /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(String(url || ''));
}

export function titleFromUrlShort(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; }
}

// ── Canvas helpers + components ───────────────────────────────────────────
export const CANVAS_DEFAULT_NODE_W = 240;
export const CANVAS_DEFAULT_NODE_H = 140;
export const CANVAS_GROUP_DEFAULT_W = 400;
export const CANVAS_GROUP_DEFAULT_H = 280;

// Función con identidad estable que siempre llama a la última versión: permite
// pasar manejadores a componentes memoizados sin que se vuelvan a pintar.
export function useStableFn(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a) => ref.current(...a), []);
}
export const canvasNodeRect = (n) => ({ x: n.x || 0, y: n.y || 0, w: n.w || CANVAS_DEFAULT_NODE_W, h: n.h || CANVAS_DEFAULT_NODE_H });
// Al duplicar/pegar, los grupos lógicos de las copias reciben ids nuevos (si no, se unirían al original).
export function grpRemapper() {
  const m = new Map();
  return (x) => {
    if (!x || !x.grp) return x;
    if (!m.has(x.grp)) m.set(x.grp, 'lg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    return { ...x, grp: m.get(x.grp) };
  };
}
export const canvasPerf = { view: 0, tile: 0 };   // contadores de render (depuración/medidas)
export const CANVAS_CULL_MIN = 120;
export const CANVAS_EDGE_CULL_MIN = 300; // a partir de aquí solo se pintan las aristas que tocan el viewport
// ¿La caja de la arista (extremos o puntos libres) toca `r`?
export function edgeTouches(e, rectOf, r) {
  const pts = [];
  const ra = e.from ? rectOf(e.from) : null, rb = e.to ? rectOf(e.to) : null;
  if (ra) pts.push([ra.x, ra.y], [ra.x + ra.w, ra.y + ra.h]);
  if (rb) pts.push([rb.x, rb.y], [rb.x + rb.w, rb.y + rb.h]);
  if (e.fromX != null) pts.push([e.fromX, e.fromY]);
  if (e.toX != null) pts.push([e.toX, e.toY]);
  if (!pts.length) return true;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return !(x1 < r.x || y1 < r.y || x0 > r.x + r.w || y0 > r.y + r.h);
}      // a partir de aquí sólo se pintan las fichas que tocan el viewport
export const CANVAS_MM_DIMS = { nodeW: CANVAS_DEFAULT_NODE_W, nodeH: CANVAS_DEFAULT_NODE_H, groupW: CANVAS_GROUP_DEFAULT_W, groupH: CANVAS_GROUP_DEFAULT_H };
export function canvasNodeId() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
export function canvasGroupId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

