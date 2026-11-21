// Canvas de Edinot (pizarra estilo Miro): CanvasView y sus piezas —
// tarjetas, grupos, selector de notas, modal de nota, dibujo a mano alzada,
// formas, plantillas y vista previa de los embeds.
//
// Vive en su propio chunk (build/build.mjs: ESM + splitting) y editor.jsx lo
// carga con React.lazy la primera vez que se pinta un canvas. Los helpers
// que también usa el editor siguen en editor.jsx y se importan de ahí: el
// ciclo es seguro porque este módulo sólo se evalúa cuando editor.jsx ya
// terminó de cargarse.

import { smartPairs, frameItems, playEnter } from './motion.js';
import { booleanOp, canBoolean } from '../../shared/canvas-boolean.js';
import { normalizePath, transformPath, pathBbox, arcsToCubics } from '../../shared/svg-import.js';
import { interactionsOf, condOk, withVar, frameInteractions } from './interactions.js';
import { listComponents, createComponent, insertInstance, syncInstances, detachInstances, addVariant, switchVariant, variantsOf, libraryEntryFrom, publishToLibrary, insertFromLibrary, resetOverrides, setInstanceProp, instKey } from './components.js';
import { resolveVars, findVar, varValue } from '../../shared/canvas-vars.js';
import { applyAutoLayout, applyConstraints, frameTree, frameRect } from './autolayout.js';
import { itemCssText } from '../../shared/canvas-css.js';
import { snapMove, annoBoxes, measureBetween } from './guides.js';
import { createInk, eventSamples, withPrediction } from './ink.js';
import { BRUSHES, brushOutlineD, brushFilterSvg, brushFill, brushSpec } from './brushes.js';
// Muestra de cada pincel en la barra: una ese con la presión subiendo y bajando.
const BRUSH_SAMPLE = Array.from({ length: 24 }, (_, i) => [3 + i * 1.2, 9 + Math.sin(i / 3.6) * 5, 0.3 + Math.sin(i / 7.6) * 0.6]);
// La caja de un trazo con pincel ancho (espray, acuarela…) es algo mayor que la de sus puntos.
const brushBbox = (b, size, brush) => { const k = brush ? Math.max(0, brushSpec(brush).k * size * (brush === 'spray' ? 1.4 : 0.6) - size / 2) : 0; return k ? { x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k } : b; };
import { markerSvg, outlineStroke } from './outline.js';
import { pagesOf, filterPage, tagNew, addPage, renamePage, removePage, moveToPage } from './pages.js';
import { selectionUnits, alignUnits, spaceUnits, tidyUp, mainAxis, currentGap, selectSame, SAME_KINDS, replaceText } from './arrange.js';
import { clipFor, applyMask, releaseMask, maskGeometry } from '../../shared/canvas-mask.js';
import { labelLines, labelSvgAttrs } from '../../shared/text-style.js';
import { parseRich } from '../../shared/rich-text.js';
import { frameToHtml } from '../../shared/frame-html.js';
import { annoFilterSvg, gradientSvg, hasFilter, cornersRectD, sidesD, imageFillSvg, localBox, paintStack, imageGeom, imageAdjustSvg, hasImageAdjust } from '../../shared/canvas-effects.js';
import { CanvasPropsPanel } from './PropsPanel.jsx';
import { Menu } from '../../ui/shell/Menu.jsx';
import { useI18n, t, getLang } from '../../i18n.js';
import { useRef, useState, useMemo, useEffect, useLayoutEffect, useDeferredValue, useCallback, memo } from 'react';
import { mountDbBlock, sweepDbBlocks } from '../db/mount.jsx';
import { yMeta, getVaultEvents, isPendingReminder, ydoc, getCanvasUndoManager, getNoteDoc, listCanvasVersions, readCanvasVersion, saveCanvasVersion, deleteCanvasVersion, observeCanvasVersions } from '../../store.js';
import { readNoteComments, putComment, patchComments } from '../../shared/comments-model.js';
import { buildCanvasTemplate, canvasTemplateInfo } from '../../shared/canvas-templates.js';
import { CanvasDock, CanvasActions, CanvasZoom, CvIcon } from '../../ui/canvas/CanvasChrome.jsx';
import { CanvasMinimap } from '../../ui/canvas/CanvasMinimap.jsx';
import { buildGrid } from './spatial.js';
import { drawLod, LOD_ZOOM, LOD_MIN_VISIBLE } from './lod.js';
import { sketchShapePaths, sketchPathD, sketchSvg } from './sketch.js';
import { searchCanvas, listLines, gridPositions } from './find.js';
import { eraseAnnotations } from './erase.js';
import { NEW_SHAPES, shapeD, shapeParts, shapeOutline, shapeInsets, shapeTextBox } from './shapes.js';
import { layoutEdge, pathToD, flatten, pointAt, closestT, headGeom, trimPath, endAngles, anchorPoint, nearestSide, sideToward, edgeKeyOf, EDGE_ROUTES } from './edges.js';
import { canvasEdgeId } from '../../shared/canvas-model.js';
import { pageNodeRect, viewportForPageColumn, isEmptyPage, expandedPageNode } from '../../shared/page-canvas.js';
import { createCanvasPresence } from './presence.js';
import { nodeZ, annoZ, stepZ, mergedOrder } from './zorder.js';
import { EditorView } from '@codemirror/view';
import { findRanges, paintRanges, clearPaint, countLabel } from '../../ui/find/dom-find.js';
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
import { buildNoteIndex, resolveCanvasNote, autoLayoutCanvas, layoutCanvasTree, canvasPreviewText, stickyFontSize } from './layout.jsx';
import { CanvasAttachmentPreview, hydrateRenderedAttachments, CanvasNoteModal, CanvasQueryResults, CanvasTileImpl, CanvasTile, CanvasPageTile, CanvasGroup, CANVAS_PICKER_MAX_RESULTS, CanvasNotePicker, CanvasEmbedPreview } from './tiles.jsx';
import { CANVAS_DRAW_TOOLS, CANVAS_SHAPE_TOOLS, CANVAS_CLOSED_SHAPE_SET, canvasFillFromHex, canvasDashArray, CANVAS_PEN_COLORS, CANVAS_STICKY_COLORS, CANVAS_STICKY_SIZE, CANVAS_GRID, cpMid, smoothStrokeD, packStrokePts, strokeD, ptsBbox, strokeOutlineD, arrowHeadPath, canvasAnnoId, snapVal } from './strokes.jsx';

const CANVAS_EDGE_DEFAULT = '#9B9A97'; // gris neutro (antes verde del tema antiguo)
let edgeCullRect = null; // rect del mundo visible durante el pintado de aristas (lo fija el render)

// Rejillas de guía de un marco: `grids` (lista) o la antigua `grid` (columnas).
function frameGrids(g) {
  if (Array.isArray(g.grids)) return g.grids;
  if (g.grid && g.grid.columns > 0) return [{ type: 'columns', count: g.grid.columns, gutter: g.grid.gutter ?? 16, margin: g.grid.margin ?? 16 }];
  return [];
}
// Bandas (columnas o filas) de una rejilla de guía en una longitud dada: [{ start, size }].
function gridBands(q, len) {
  const n = Math.max(1, q.count || 1), gut = q.gutter ?? 16, mar = q.margin ?? 16;
  const size = (len - mar * 2 - gut * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ start: mar + i * (size + gut), size: Math.max(1, size) }));
}

function CanvasView({ json: jsonProp, notes, vaults, activeNoteId, syncConfig, onChange: onChangeRaw, onOpenNote, onUploadAttachment, onUpdateNoteContent, onCreateReminder, askPrompt, askConfirm, renderPage, pageTitle, intro, transitionRef, pageSource }) {
  useI18n();
  canvasPerf.view++;
  // Gestos (arrastrar, redimensionar, rotar): cada movimiento pinta un
  // borrador local y sólo el soltar escribe en el doc. Escribir en Yjs en cada
  // mousemove sincronizaba, guardaba en IndexedDB y re-renderizaba el editor
  // entero 60+ veces por segundo, y dejaba un tombstone por movimiento.
  // Páginas: se pinta solo la actual (guardada por nota en este equipo) y lo nuevo se queda en ella.
  const pageKey = activeNoteId ? `edinotCanvasPage:${activeNoteId}` : null;
  const [pageSel, setPageSel] = useState(() => { try { return pageKey ? localStorage.getItem(pageKey) : null; } catch { return null; } });
  useEffect(() => { try { setPageSel(pageKey ? localStorage.getItem(pageKey) : null); } catch { setPageSel(null); } }, [pageKey]);
  const pageList = pagesOf(jsonProp);
  const curPage = pageList.length > 1 ? (pageList.some(p => p.id === pageSel) ? pageSel : pageList[0].id) : null;
  const curPageRef = useRef(curPage);
  curPageRef.current = curPage;
  const setPage = (id) => { setPageSel(id); try { if (pageKey) localStorage.setItem(pageKey, id); } catch {} };
  const onChange = useCallback((fn) => onChangeRaw(j => tagNew(j, typeof fn === 'function' ? fn(j) : fn, curPageRef.current)), [onChangeRaw]);
  const [draft, setDraft] = useState(null);   // updater (json → json) aún sin guardar
  const draftRef = useRef(null);
  const jsonRef = useRef(jsonProp);
  const draftRafRef = useRef(0);
  // Estado del prototipo mientras se presenta (variantes y variables cambiadas por interacciones): no se guarda.
  const [proto, setProto] = useState(null);
  const json = useMemo(() => { const j0 = draft ? draft(jsonProp) : jsonProp; const j = proto ? proto(j0) : j0; return curPage ? filterPage(j, curPage) : j; }, [draft, jsonProp, proto, curPage]);
  const protoJsonRef = useRef(json);
  protoJsonRef.current = json;
  const previewChange = (updater) => {
    draftRef.current = updater;
    if (draftRafRef.current) return;
    draftRafRef.current = requestAnimationFrame(() => {
      draftRafRef.current = 0;
      const u = draftRef.current;
      if (u) setDraft(() => u);
    });
  };
  const commitPreview = () => {
    if (draftRafRef.current) { cancelAnimationFrame(draftRafRef.current); draftRafRef.current = 0; }
    const u = draftRef.current;
    draftRef.current = null;
    if (!u) { setDraft(null); return; }
    // Sigue pintando el borrador hasta que el json confirmado vuelva por props.
    setDraft(() => u);
    onChange(u);
  };
  useEffect(() => { jsonRef.current = jsonProp; if (!draftRef.current) setDraft(null); }, [jsonProp]);
  // Viewport (pan + zoom) lives in component state, persisted per-note in
  // localStorage so re-opening the same canvas restores the view.
  const storageKey = activeNoteId ? `edinotCanvasView:${activeNoteId}` : null;
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState(null); // clave estable de la arista (id, o from->to:kind en las antiguas)
  const [edgeLabelEdit, setEdgeLabelEdit] = useState(null); // clave de la arista cuya etiqueta se edita en el lienzo
  const [anchorHover, setAnchorHover] = useState(null);     // { rect, near } anclas visibles al conectar
  const [edgePicker, setEdgePicker] = useState(null);         // { srcId, side, world, left, top } selector al soltar un conector en vacío
  const [framesOpen, setFramesOpen] = useState(false);          // panel de marcos (orden de la presentación)
  const [frameDrag, setFrameDrag] = useState(null);                // { id, over } mientras se reordena arrastrando
  const [remotes, setRemotes] = useState([]);                 // cursores/selecciones de otros usuarios en este canvas
  const presenceRef = useRef(null);
  const spaceRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);          // Espacio mantenido = mover el lienzo
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    const off = () => { spaceRef.current = false; setSpaceHeld(false); };
    window.addEventListener('blur', off);
    return () => window.removeEventListener('blur', off);
  }, []);
  useEffect(() => {
    if (!activeNoteId) return;
    let pr = null, timer = 0;
    const bind = () => {
      const e = getNoteDoc(activeNoteId);
      const aw = e && e.provider && e.provider.awareness;
      if (!aw) return false;
      pr = createCanvasPresence(aw, setRemotes);
      presenceRef.current = pr;
      return true;
    };
    if (!bind()) timer = setInterval(() => { if (bind()) clearInterval(timer); }, 2000);   // aún sin conexión de sync: reintenta
    return () => { clearInterval(timer); if (pr) pr.destroy(); presenceRef.current = null; setRemotes([]); };
  }, [activeNoteId]);
  const pendingConnectRef = useRef(null);                      // conexión a completar cuando se elija una nota existente
  const [canvasCallout, setCanvasCallout] = useState(null); // { nodeId, message, stepIdx?, stepCount? }
  const presentTimerRef = useRef(null);
  // Per-node transient style overlay driven by `canvas_animate`. Map of
  // nodeId → { dx, dy, scale, color }. Empty when no animation runs.
  const [animMap, setAnimMap] = useState(() => new Map());
  const animMapRef = useRef(animMap);
  useEffect(() => { animMapRef.current = animMap; }, [animMap]);
  const animRafRef = useRef(null);
  const animTimerRef = useRef(null);
  // Active canvas tool. 'select' = pan/select/drag; the rest draw into the
  // annotation layer (see CANVAS_DRAW_TOOLS).
  const [tool, setTool] = useState('select');
  const [drawStyle, setDrawStyle] = useState({ color: '#1f2937', size: 4, opacity: 1, fill: false, eraser: 18 });
  // Ajustes de la tinta a mano (en este equipo): suavizado 0…10, curva de presión y predicción.
  const [inkPrefs, setInkPrefs0] = useState(() => { try { return { stabilize: 3, gamma: 1, predict: true, brush: 'pen', ...JSON.parse(localStorage.getItem('edinotInk') || '{}') }; } catch { return { stabilize: 3, gamma: 1, predict: true, brush: 'pen' }; } });
  const [brushMenu, setBrushMenu] = useState(false);
  const setInkPrefs = (fn) => setInkPrefs0(p => { const n = typeof fn === 'function' ? fn(p) : { ...p, ...fn }; try { localStorage.setItem('edinotInk', JSON.stringify(n)); } catch {} return n; });
  const [snapGrid, setSnapGrid] = useState(false);
  const [selAnno, setSelAnno] = useState(() => new Set()); // selected annotation ids
  const [annoTextEdit, setAnnoTextEdit] = useState(null);  // annotation id whose text is being edited
  const [selMenu, setSelMenu] = useState(null);
  const [rulersOn, setRulersOn] = useState(() => { try { return localStorage.getItem('edinot.canvas.rulers') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('edinot.canvas.rulers', rulersOn ? '1' : '0'); } catch {} }, [rulersOn]);
  const [guideDrag, setGuideDrag] = useState(null);         // { axis: 'v'|'h', pos, index? } guía que se está arrastrando
  const [presScroll, setPresScroll] = useState(0);          // desplazamiento dentro de la pantalla que se presenta
  const presScrollRef = useRef(0);
  const [overlay, setOverlay] = useState(null);             // { src, w, h }: pantalla abierta como superposición
  const [followAgent, setFollowAgent] = useState(() => { try { return localStorage.getItem('edinot.followAgent') === '1'; } catch { return false; } });
  useEffect(() => { const f = () => { try { setFollowAgent(localStorage.getItem('edinot.followAgent') === '1'); } catch {} }; window.addEventListener('edinot:follow-changed', f); return () => window.removeEventListener('edinot:follow-changed', f); }, []);
  const [followChip, setFollowChip] = useState(null);       // { agent, at }: «Siguiendo a Claude» mientras dibuja
  useEffect(() => { if (!followChip) return; const tm = setTimeout(() => setFollowChip(null), 6000); return () => clearTimeout(tm); }, [followChip]);
  const [vecEdit, setVecEdit] = useState(null);             // id del trazo vectorial cuyos puntos se editan
  useEffect(() => { if (vecEdit && !selAnno.has(vecEdit)) setVecEdit(null); }, [selAnno]);
  const [layoutMenu, setLayoutMenu] = useState(null);       // menú de auto layout de un marco { id, anchor }
  const [propsOpen, setPropsOpen] = useState(() => { try { return localStorage.getItem('edinot.canvas.props') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('edinot.canvas.props', propsOpen ? '1' : '0'); } catch {} }, [propsOpen]);
  const [eraserAt, setEraserAt] = useState(null);
  const prevPaintToolRef = useRef('pen');                 // a qué herramienta vuelve el cuentagotas         // cursor de la goma (círculo del tamaño real)           // menú «⋯» de la barra de selección
  const [autoEditId, setAutoEditId] = useState(null);      // freshly-placed label to open in edit mode
  const drawingRef = useRef(null); // in-flight stroke/shape state
  const [livePreview, setLivePreview] = useState(null); // { kind, ... } rendered while drawing
  // Laser pointer: ephemeral trail (world coords + timestamps), never
  // persisted. A rAF loop prunes points older than ~900ms so the tail fades.
  const [laserPts, setLaserPts] = useState([]);
  const laserRafRef = useRef(null);
  const laserPrune = useCallback(() => {
    const cutoff = performance.now() - 900;
    setLaserPts(prev => {
      const next = prev.filter(p => p.t > cutoff);
      laserRafRef.current = next.length ? requestAnimationFrame(laserPrune) : null;
      return next;
    });
  }, []);
  const laserPush = useCallback((x, y) => {
    setLaserPts(prev => [...prev, { x, y, t: performance.now() }]);
    if (!laserRafRef.current) laserRafRef.current = requestAnimationFrame(laserPrune);
  }, [laserPrune]);
  useEffect(() => () => { if (laserRafRef.current) cancelAnimationFrame(laserRafRef.current); }, []);
  const isDrawTool = CANVAS_DRAW_TOOLS.has(tool) || tool === 'fill' || tool === 'picker' || tool === 'vpen';
  const drawStyleRef = useRef(drawStyle);
  useEffect(() => { drawStyleRef.current = drawStyle; }, [drawStyle]);
  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { if (!autoEditId) return; const tm = setTimeout(() => setAutoEditId(null), 600); return () => clearTimeout(tm); }, [autoEditId]);
  useEffect(() => {
    if (!fullscreen) return;
    const onEsc = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [fullscreen]);
  // Viewport (pan + zoom): la REF es la única fuente de verdad y el transform del
  // mundo se escribe directo en el DOM con rAF — un gesto de pan/zoom no vuelve a
  // pintar React por cada evento. `viewport` (estado) es sólo un espejo con ~90 ms
  // de retraso para lo que SÍ se calcula al pintar (recorte, minimapa, avisos,
  // persistencia). Los manejadores de eventos leen siempre viewportRef.current.
  const initialViewport = useMemo(() => {
    try {
      if (storageKey) {
        const raw = localStorage.getItem(storageKey);
        if (raw) return JSON.parse(raw);
      }
    } catch {}
    return { x: 0, y: 0, zoom: 1 };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const viewportRef = useRef(initialViewport);
  const worldRef = useRef(null);
  const vpRafRef = useRef(0);
  const vpTimerRef = useRef(0);
  const [viewport, setViewportState] = useState(initialViewport);
  // LOD (zoom muy alejado): fichas como rects en un <canvas> (editor/canvas/lod.js).
  const lodCanvasRef = useRef(null);
  const lodOnRef = useRef(false);
  const lodExcludeRef = useRef(new Set());
  const lodRedrawRef = useRef(null);
  const applyWorldTransform = useCallback(() => {
    vpRafRef.current = 0;
    const v = viewportRef.current, el = worldRef.current;
    if (el) el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    if (lodRedrawRef.current) lodRedrawRef.current();
  }, []);
  const setViewport = useCallback((next) => {
    const v = typeof next === 'function' ? next(viewportRef.current) : next;
    viewportRef.current = v;
    if (!vpRafRef.current) vpRafRef.current = requestAnimationFrame(applyWorldTransform);
    clearTimeout(vpTimerRef.current);
    vpTimerRef.current = setTimeout(() => setViewportState(viewportRef.current), 90);
  }, [applyWorldTransform]);
  // Tras cada render el DOM vuelve a la posición real (nunca a la del espejo atrasado).
  useLayoutEffect(() => { applyWorldTransform(); });
  useEffect(() => () => { cancelAnimationFrame(vpRafRef.current); clearTimeout(vpTimerRef.current); }, []);
  // Gancho de pruebas: sólo existe si se activa a mano (localStorage.edinotCanvasDebug = '1').
  const debugApiRef = useRef({});
  debugApiRef.current = { json: jsonProp, onChange, setViewport, selectedSet: null };
  useEffect(() => {
    let on = false;
    try { on = localStorage.getItem('edinotCanvasDebug') === '1'; } catch {}
    if (!on) return;
    window.__edinotCanvasDebug = {
      getJson: () => debugApiRef.current.json,
      setJson: (j) => debugApiRef.current.onChange(() => j),
      getViewport: () => ({ ...viewportRef.current }),
      setViewport: (v) => debugApiRef.current.setViewport(v),
      setRemotes: (arr) => setRemotes(arr),
      perf: () => ({ ...canvasPerf }),
      resetPerf: () => { canvasPerf.view = 0; canvasPerf.tile = 0; },
    };
    return () => { delete window.__edinotCanvasDebug; };
  }, []);
  useEffect(() => {
    if (!storageKey) return;
    const tm = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(viewport)); } catch {} }, 300);
    return () => clearTimeout(tm);
  }, [viewport, storageKey]);
  const rootRef = useRef(null);
  const containerRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const dragRef = useRef(null);
  const edgeDrawRef = useRef(null);
  const [edgeDraw, setEdgeDraw] = useState(null); // { fromId, fromCenter, mouseWorld }
  const [selected, setSelected] = useState(new Set());
  const [marquee, setMarquee] = useState(null);   // { x, y, w, h } world rect while shift-dragging empty canvas
  const [exporting, setExporting] = useState(false);   // hide chrome (toolbar/help) during PNG capture
  const [guides, setGuides] = useState(null);   // { v: [worldX...], h: [worldY...] } alignment guides while dragging
  const [cropEdit, setCropEdit] = useState(null);
  const [respPrev, setRespPrev] = useState(null);
  // Historial de versiones con nombre (en el documento de la nota).
  const [verOpen, setVerOpen] = useState(false);
  const [verList, setVerList] = useState([]);
  const [verView, setVerView] = useState(null);   // { id, name } versión que se está viendo
  useEffect(() => {
    if (!verOpen || !activeNoteId) return undefined;
    const load = () => setVerList(listCanvasVersions(activeNoteId));
    load();
    return observeCanvasVersions(activeNoteId, load);
  }, [verOpen, activeNoteId]);
  const viewVersion = (v) => {
    const data = readCanvasVersion(activeNoteId, v.id);
    if (!data) return;
    const u = () => data;
    draftRef.current = u; setDraft(() => u); setVerView({ id: v.id, name: v.name });
  };
  const leaveVersion = () => { draftRef.current = null; setDraft(null); setVerView(null); };
  const restoreVersion = (id) => {
    const data = readCanvasVersion(activeNoteId, id);
    if (!data) return;
    saveCanvasVersion(activeNoteId, { name: t('canvas.ver.before', { d: new Date().toLocaleString() }), data: jsonProp });
    draftRef.current = null; setDraft(null); setVerView(null);
    onChangeRaw(() => data);
  };   // vista previa adaptable: { id, rect, w }   // dibujo cuya imagen de relleno se está recolocando
  const [measure, setMeasure] = useState(null); // modo desarrollador: medidas (Alt sobre otro elemento) [{x1,y1,x2,y2,label}]
  const [panSize, setPanSize] = useState({ w: 0, h: 0 });   // pan-area pixel size, for the minimap viewport rect
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setPanSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen]);
  // Broadcast canvas-node selection upward so the AI's `get_canvas_selection`
  // tool can see which tiles the user is pointing at. Cleared on empty set.
  useEffect(() => {
    if (!activeNoteId) return;
    if (selected.size === 0) {
      const cur = yMeta.get('canvasSelection');
      if (cur && cur.noteId === activeNoteId) yMeta.delete('canvasSelection');
      return;
    }
    yMeta.set('canvasSelection', {
      noteId: activeNoteId,
      nodeIds: Array.from(selected),
      at: Date.now(),
    });
  }, [selected, activeNoteId]);
  useEffect(() => { if (presenceRef.current) presenceRef.current.publishSelection([...selected, ...selAnno]); }, [selected, selAnno, remotes.length]);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [noteModalId, setNoteModalId] = useState(null);
  const [dragHover, setDragHover] = useState(false);
  const noteIdx = useMemo(() => buildNoteIndex(notes), [notes]);
  const noteModal = noteModalId ? (notes || []).find(f => f.id === noteModalId) : null;
  const existingNoteIds = useMemo(() => {
    const ids = new Set();
    for (const n of jsonProp.nodes || []) {
      if (n.kind !== 'note') continue;
      const f = resolveCanvasNote(n, noteIdx);
      if (f) ids.add(f.id);
    }
    return ids;
  }, [jsonProp.nodes, noteIdx]);

  // Persisted edges (manual) plus auto-computed backlinks. Backlinks aren't
  // serialized; they're derived from the actual wikilinks in source so the
  // canvas always reflects the truth.
  // Los backlinks (wikilinks de cada nota) son caros de extraer: se calculan sólo
  // cuando cambian los nodos CONFIRMADOS o las notas, nunca por frame de un gesto.
  const backlinkEdges = useMemo(() => {
    const out = [];
    const presentNotes = new Map();
    const nodes = jsonProp.nodes || [];
    for (const n of nodes) {
      if (n.kind !== 'note') continue;
      const f = resolveCanvasNote(n, noteIdx);
      if (f) presentNotes.set(f.name.toLowerCase().replace(/\.(md|markdown|txt)$/i, ''), n.id);
    }
    for (const n of nodes) {
      if (n.kind !== 'note') continue;
      const f = resolveCanvasNote(n, noteIdx);
      if (!f) continue;
      for (const target of extractWikilinks(f.content || '')) {
        const targetNodeId = presentNotes.get(target);
        if (!targetNodeId || targetNodeId === n.id) continue;
        out.push({ from: n.id, to: targetNodeId, kind: 'backlink' });
      }
    }
    return out;
  }, [jsonProp.nodes, noteIdx]);
  const allEdges = useMemo(() => {
    const manual = (json.edges || []).map(e => ({ ...e, kind: e.kind || 'manual' }));
    const have = new Set(manual.map(e => e.from + '>' + e.to));
    const out = manual.slice();
    for (const b of backlinkEdges) {
      const k = b.from + '>' + b.to;
      if (have.has(k)) continue;   // no duplicar una arista manual
      have.add(k);
      out.push(b);
    }
    return out;
  }, [json.edges, backlinkEdges]);

  // Count open tasks per resolved note tile for the badge.
  const openTaskCounts = useMemo(() => {
    const m = new Map();
    for (const n of jsonProp.nodes || []) {
      if (n.kind !== 'note') continue;
      const f = resolveCanvasNote(n, noteIdx);
      if (!f) continue;
      const tables = parseSourceTables(f.content || '');
      let count = 0;
      for (const t of tables) {
        const estIdx = t.headers.findIndex(h => h.toLowerCase() === 'estado');
        if (estIdx < 0) continue;
        for (const r of t.rows) {
          const v = (r[estIdx] || '').toLowerCase();
          if (v.includes('pendiente') || v.includes('revisión') || v.includes('revision')) count++;
        }
      }
      m.set(n.id, count);
    }
    return m;
  }, [jsonProp.nodes, noteIdx]);

  // Fase 3 synergy: surface reminders on note tiles. For each note-node whose
  // resolved note has reminder events, show a ⏰ badge (overdue ones stand
  // out). Connects the calendar/reminders feature with the canvas.
  const reminderByNode = useMemo(() => {
    const map = new Map();
    const vaultIds = new Set();
    for (const n of jsonProp.nodes || []) {
      if (n.kind !== 'note') continue;
      const f = resolveCanvasNote(n, noteIdx);
      if (f) vaultIds.add(f.vaultId || 'default');
    }
    if (!vaultIds.size) return map;
    let now = 0;
    try { now = Date.now(); } catch {}
    const byNote = new Map();
    for (const vid of vaultIds) {
      let evs;
      try { evs = getVaultEvents(vid); } catch { continue; }
      for (const ev of evs) {
        if (!isPendingReminder(ev) || !ev.noteId) continue;
        const ts = Date.parse(ev.snoozedUntil || ev.remindAt || ev.start);
        if (!Number.isFinite(ts)) continue;
        const c = byNote.get(ev.noteId) || { count: 0, overdue: false, nextAt: null };
        c.count++;
        if (ts <= now) c.overdue = true;
        if (c.nextAt == null || ts < c.nextAt) c.nextAt = ts;
        byNote.set(ev.noteId, c);
      }
    }
    for (const n of jsonProp.nodes || []) {
      if (n.kind !== 'note') continue;
      const f = resolveCanvasNote(n, noteIdx);
      if (f && byNote.has(f.id)) map.set(n.id, byNote.get(f.id));
    }
    return map;
  }, [jsonProp.nodes, noteIdx]);

  // Mapa mental: árbol de aristas manuales y nodos ocultos por ramas plegadas (json confirmado).
  const lockedIds = useMemo(() => {
    const s2 = new Set();
    for (const n of jsonProp.nodes || []) if (n.locked) s2.add(n.id);
    for (const a of jsonProp.annotations || []) if (a.locked) s2.add(a.id);
    return s2;
  }, [jsonProp.nodes, jsonProp.annotations]);
  const mmIndex = useMemo(() => treeIndex(jsonProp), [jsonProp.nodes, jsonProp.edges]);
  const hiddenIds = useMemo(() => {
    const h = hiddenByCollapse(jsonProp);
    // Ocultas desde el panel de capas.
    const out = new Set(h);
    for (const n of jsonProp.nodes || []) if (n.hidden) out.add(n.id);
    return out;
  }, [jsonProp.nodes, jsonProp.edges]);
  // Índice espacial de los nodos confirmados: recorte por viewport, lazo y snap.
  const nodeGrid = useMemo(() => buildGrid(jsonProp.nodes || [], canvasNodeRect), [jsonProp.nodes]);
  const nodeGridRef = useRef(nodeGrid);
  lodRedrawRef.current = () => {
    const cv = lodCanvasRef.current;
    if (!cv) return;
    if (!lodOnRef.current) { if (cv.width) { cv.width = 0; cv.height = 0; } return; }
    const v = viewportRef.current, z = v.zoom || 1, box = containerRef.current;
    if (!box) return;
    const W = box.clientWidth, H = box.clientHeight;
    const ex = lodExcludeRef.current;
    const ns = nodeGridRef.current.query(-v.x / z, -v.y / z, W / z, H / z).filter(n => !ex.has(n.id));
    const cs = getComputedStyle(box);
    drawLod(cv, ns, v, canvasNodeRect, {
      card: (cs.getPropertyValue('--bg') || '#fff').trim(), line: (cs.getPropertyValue('--line') || '#ddd').trim(),
      fg: (cs.getPropertyValue('--fg') || '#222').trim(), font: cs.fontFamily,
    });
  };
  useLayoutEffect(() => { if (lodRedrawRef.current) lodRedrawRef.current(); });
  nodeGridRef.current = nodeGrid;

  const screenToWorld = useCallback((sx, sy) => {
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return { x: sx, y: sy };
    const v = viewportRef.current;
    return {
      x: (sx - rect.left - v.x) / v.zoom,
      y: (sy - rect.top - v.y) / v.zoom,
    };
  }, []);
  const focusCanvas = () => {
    try { if (rootRef.current) rootRef.current.focus({ preventScroll: true }); } catch {}
  };
  const selectNode = (id) => {
    focusCanvas();
    setSelected(new Set([id]));
  };
  const deleteNode = (id) => {
    onChange(j => ({
      ...j,
      nodes: (j.nodes || []).filter(n => n.id !== id),
      edges: (j.edges || []).filter(ed => ed.from !== id && ed.to !== id),
    }));
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedEdge(null);
  };
  const editNodeText = (id, text) => {
    onChange(j => ({ ...j, nodes: (j.nodes || []).map(n => n.id === id ? { ...n, text } : n) }));
  };
  // Aristas: id estable al crear (las antiguas, sin id, se identifican por from->to:kind y
  // reciben uno la primera vez que se editan). Se permiten varias aristas por par siempre
  // que no sean idénticas (mismos extremos y mismas anclas).
  const applyPatch = (o, patch) => {
    const r = { ...o, ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete r[k];   // quitar la clave de verdad (si no, Yjs la conserva)
    return r;
  };
  const addEdge = (from, to, opts = {}) => {
    if (!from || !to || from === to) return;
    const id = canvasEdgeId();
    let created = false;
    onChange(j => {
      const dup = (j.edges || []).some(ed => ed.from === from && ed.to === to && (ed.fromSide || '') === (opts.fromSide || '') && (ed.toSide || '') === (opts.toSide || ''));
      if (dup) return j;
      created = true;
      return { ...j, edges: [...(j.edges || []), { id, from, to, kind: 'manual', ...opts }] };
    });
    // Abre el editor de la arista recién creada (etiquetar/colorear al momento).
    setTimeout(() => { if (created) setSelectedEdge(id); }, 0);
  };
  // Edita una arista por clave; si era antigua (sin id) le asigna uno y reapunta la selección.
  const commitEdgePatch = (key, patch) => {
    const cur = (jsonRef.current.edges || []).find(ed => edgeKeyOf(ed) === key);
    if (!cur) return;
    const id = cur.id || canvasEdgeId();
    onChange(j => ({ ...j, edges: (j.edges || []).map(ed => edgeKeyOf(ed) === key ? applyPatch({ ...ed, id }, patch) : ed) }));
    if (!cur.id) setSelectedEdge(id);
  };
  const dropEdgesTouching = (j, ids) => (j.edges || []).filter(ed => !ids.has(ed.from) && !ids.has(ed.to));

  // Select + move a drawn annotation (stroke / shape). Movement is applied as
  // an (ox,oy) offset so we never have to reparse path data.
  const startAnnoDrag = (e, a) => {
    if (toolRef.current !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    focusCanvas();
    if (a.locked && !(e.shiftKey || e.metaKey || e.ctrlKey)) { setSelected(new Set()); setSelAnno(new Set([a.id])); return; }   // bloqueada: sólo se selecciona
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelAnno(prev => { const n = new Set(prev); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; });
      return;
    }
    // Si el dibujo está en un grupo (Ctrl+G o un <g> de un SVG importado), se mueve el grupo entero.
    const grp = expandGroups(new Set(), new Set([a.id]));
    const gNodes = [...grp.nodes].filter(id => !lockedIds.has(id)), gAnnos = [...grp.annos].filter(id => id === a.id || !lockedIds.has(id));
    setSelected(new Set(gNodes));
    setSelAnno(new Set(gAnnos));
    const startX = e.clientX, startY = e.clientY;
    const ox0 = a.ox || 0, oy0 = a.oy || 0;
    const nOrig = new Map((json.nodes || []).filter(n => gNodes.includes(n.id)).map(n => [n.id, { x: n.x || 0, y: n.y || 0 }]));
    const aOrig = new Map((json.annotations || []).filter(x => gAnnos.includes(x.id)).map(x => [x.id, { ox: x.ox || 0, oy: x.oy || 0 }]));
    // Guías inteligentes también para los dibujos: contra fichas y otros dibujos (salvo con la rejilla activa).
    const boxes = [
      ...(json.nodes || []).filter(n => nOrig.has(n.id)).map(canvasNodeRect),
      ...annoBoxes((json.annotations || []).filter(x => aOrig.has(x.id))),
    ];
    const b0 = boxes.length ? (() => { const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y)); return { x: x0, y: y0, w: Math.max(...boxes.map(b => b.x + b.w)) - x0, h: Math.max(...boxes.map(b => b.y + b.h)) - y0 }; })() : null;
    const others = b0 ? [...(json.nodes || []).filter(n => !n.hidden && !nOrig.has(n.id)).map(canvasNodeRect), ...annoBoxes(json.annotations, new Set(aOrig.keys()))]
      .filter(o => Math.abs(o.x - b0.x) < 1600 && Math.abs(o.y - b0.y) < 1600).concat(guideBoxes(json)) : [];
    const SNAP = 6 / (viewportRef.current.zoom || 1);
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(); return; }
      let dx = (ev.clientX - startX) / viewportRef.current.zoom, dy = (ev.clientY - startY) / viewportRef.current.zoom;
      if (snapGrid) { dx = snapVal(ox0 + dx) - ox0; dy = snapVal(oy0 + dy) - oy0; setGuides(null); }
      else if (b0 && others.length) {
        const r = snapMove({ x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h }, others, SNAP);
        dx += r.dx; dy += r.dy;
        setGuides((r.v.length || r.h.length || r.gaps.length) ? { v: r.v, h: r.h, gaps: r.gaps } : null);
      }
      previewChange(j => ({ ...j,
        annotations: (j.annotations || []).map(x => aOrig.has(x.id) ? { ...x, ox: aOrig.get(x.id).ox + dx, oy: aOrig.get(x.id).oy + dy } : x),
        ...(nOrig.size ? { nodes: (j.nodes || []).map(n => nOrig.has(n.id) ? { ...n, x: nOrig.get(n.id).x + dx, y: nOrig.get(n.id).y + dy } : n) } : {}) }));
    };
    const onUp = () => { setGuides(null); commitPreview(); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const lineBbox = (x1, y1, x2, y2) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });

  // Resize a shape annotation by dragging a handle (corners/edges for boxes,
  // endpoints for line/arrow).
  const startAnnoResize = (e, a, handle) => {
    e.stopPropagation(); e.preventDefault(); focusCanvas();
    if (a.locked) return;
    const startX = e.clientX, startY = e.clientY;
    const isStroke = a.kind === 'path' && Array.isArray(a.pts) && a.pts.length > 1;
    const sb = isStroke ? (a.bbox || ptsBbox(a.pts)) : null;
    const o = isStroke ? { x: sb.x, y: sb.y, w: Math.max(1, sb.w), h: Math.max(1, sb.h) } : { x: a.x, y: a.y, w: a.w, h: a.h, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 };
    const rot = a.rot || 0;
    const rad = -rot * Math.PI / 180, rc = Math.cos(rad), rs = Math.sin(rad);
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(); return; }
      let dx = (ev.clientX - startX) / viewportRef.current.zoom, dy = (ev.clientY - startY) / viewportRef.current.zoom;
      if (rot) { const ndx = dx * rc - dy * rs, ndy = dx * rs + dy * rc; dx = ndx; dy = ndy; } // world delta → shape-local frame
      previewChange(j => ({ ...j, annotations: (j.annotations || []).map(x => {
        if (x.id !== a.id) return x;
        if (handle === 'p1') { let nx = o.x1 + dx, ny = o.y1 + dy; if (snapGrid) { nx = snapVal(nx); ny = snapVal(ny); } return { ...x, x1: nx, y1: ny, bbox: lineBbox(nx, ny, o.x2, o.y2) }; }
        if (handle === 'p2') { let nx = o.x2 + dx, ny = o.y2 + dy; if (snapGrid) { nx = snapVal(nx); ny = snapVal(ny); } return { ...x, x2: nx, y2: ny, bbox: lineBbox(o.x1, o.y1, nx, ny) }; }
        let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
        if (handle.includes('w')) { nx = o.x + dx; nw = o.w - dx; }
        if (handle.includes('e')) { nw = o.w + dx; }
        if (handle.includes('n')) { ny = o.y + dy; nh = o.h - dy; }
        if (handle.includes('s')) { nh = o.h + dy; }
        if (nw < 8) { if (handle.includes('w')) nx = o.x + o.w - 8; nw = 8; }
        if (nh < 8) { if (handle.includes('n')) ny = o.y + o.h - 8; nh = 8; }
        if (snapGrid) { nx = snapVal(nx); ny = snapVal(ny); nw = Math.max(CANVAS_GRID, snapVal(nw)); nh = Math.max(CANVAS_GRID, snapVal(nh)); }
        if (isStroke) {
          // Escalar los puntos del trazo a la caja nueva y regenerar el contorno.
          const sx = nw / o.w, sy = nh / o.h;
          const pts = a.pts.map(p => [nx + (p[0] - o.x) * sx, ny + (p[1] - o.y) * sy, p[2]]);
          return { ...x, pts: packStrokePts(pts), d: strokeD(x, pts), bbox: { x: nx, y: ny, w: nw, h: nh } };
        }
        return { ...x, x: nx, y: ny, w: nw, h: nh, bbox: { x: nx, y: ny, w: nw, h: nh } };
      }) }));
    };
    const onUp = () => { commitPreview(); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Rotate a closed shape around its centre. Hold Shift to snap to 15°.
  const startAnnoRotate = (e, a) => {
    e.stopPropagation(); e.preventDefault(); focusCanvas();
    if (a.locked) return;
    const cx = (a.ox || 0) + a.x + a.w / 2, cy = (a.oy || 0) + a.y + a.h / 2;
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(); return; }
      const w = screenToWorld(ev.clientX, ev.clientY);
      let deg = Math.atan2(w.y - cy, w.x - cx) * 180 / Math.PI + 90; // handle points up at 0°
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(deg);
      previewChange(j => ({ ...j, annotations: (j.annotations || []).map(x => x.id === a.id ? { ...x, rot: deg } : x) }));
    };
    const onUp = () => { commitPreview(); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const annoPaintDefs = (a) => (
    <defs dangerouslySetInnerHTML={{ __html: gradientSvg(a, `cvg-${a.id}`) + annoFilterSvg(a, undefined, `cvs-${a.id}`) }} />
  );
  const renderAnnoShape = (a, interactive) => {
    const stroke = a.color || '#1f2937';
    const sw = a.strokeWidth || 2;
    const op = a.opacity != null ? a.opacity : 1;
    const fill = (a.imageFill && a.imageFill.src) ? 'none' : a.gradient ? `url(#cvg-${a.id})` : (a.fill && a.fill !== 'none' ? a.fill : 'none');
    const dash = canvasDashArray(a.dash) || undefined;
    const common = { stroke, strokeWidth: sw, fill, opacity: op, strokeLinejoin: a.strokeJoin || 'round', strokeDasharray: dash };
    const mk = (a.startCap || a.endCap) ? { markerStart: a.startCap && a.startCap !== 'none' ? `url(#${a.id}-ms)` : undefined, markerEnd: a.endCap && a.endCap !== 'none' ? `url(#${a.id}-me)` : undefined } : {};
    if (a.sketch) {
      // Estilo a mano alzada (rough.js). La flecha conserva su punta normal.
      const ps = sketchShapePaths(a);
      const hit = (a.shape === 'line' || a.shape === 'arrow') && interactive
        ? <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={Math.max(14, sw + 10)} style={{ pointerEvents: 'stroke' }} /> : null;
      return <g opacity={op}>
        {hit}
        {CANVAS_CLOSED_SHAPES.has(a.shape) && <rect x={a.x} y={a.y} width={a.w} height={a.h} fill="transparent" stroke="none" />}
        {ps.map((p, i) => <path key={i} d={p.d} fill={p.fill || 'none'} stroke={p.stroke || 'none'} strokeWidth={p.strokeWidth || 0} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.stroke && p.stroke !== 'none' ? dash : undefined} />)}
        {a.shape === 'arrow' && <path d={arrowHeadPath(a.x1, a.y1, a.x2, a.y2, sw)} fill={stroke} />}
      </g>;
    }
    switch (a.shape) {
      case 'rect': {
        const rr = a.rx != null ? Math.min(a.rx, a.w / 2, a.h / 2) : Math.min(8, Math.min(a.w, a.h) * 0.12);
        const cd = Array.isArray(a.corners) ? cornersRectD(a.x, a.y, a.w, a.h, a.corners) : null;
        const el = (extra) => (cd ? <path d={cd} {...common} {...extra} /> : <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={rr} {...common} {...extra} />);
        const hasStroke = stroke !== 'none' && sw > 0.05;
        // Desenfoque de fondo («cristal»): un div con backdrop-filter recortado a la forma, debajo del relleno.
        const glass = a.bgBlur > 0 ? (
          <foreignObject x={a.x} y={a.y} width={a.w} height={a.h} style={{ overflow: 'visible', pointerEvents: 'none' }}>
            <div style={{ width: '100%', height: '100%', backdropFilter: `blur(${a.bgBlur}px)`, WebkitBackdropFilter: `blur(${a.bgBlur}px)`, borderRadius: cd ? undefined : rr, clipPath: cd ? `path('${cornersRectD(0, 0, a.w, a.h, a.corners)}')` : undefined }} />
          </foreignObject>
        ) : null;
        let main;
        if (a.sides && hasStroke) main = <>{el({ stroke: 'none' })}<path d={sidesD(a.x, a.y, a.w, a.h, a.sides)} fill="none" stroke={stroke} strokeWidth={sw} opacity={op} strokeDasharray={dash} strokeLinecap="square" /></>;
        else if (a.strokeAlign === 'outside' && hasStroke) main = el({ strokeWidth: sw * 2, paintOrder: 'stroke' });
        else if (a.strokeAlign === 'inside' && hasStroke) main = <><clipPath id={`cvin-${a.id}`}>{cd ? <path d={cd} /> : <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={rr} />}</clipPath>{el({ strokeWidth: sw * 2, clipPath: `url(#cvin-${a.id})` })}</>;
        else main = el({});
        return glass ? <g>{glass}{main}</g> : main;
      }
      case 'ellipse': return <ellipse cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} {...common} />;
      case 'diamond': { const cx = a.x + a.w / 2, cy = a.y + a.h / 2; return <path d={`M ${cx} ${a.y} L ${a.x + a.w} ${cy} L ${cx} ${a.y + a.h} L ${a.x} ${cy} Z`} {...common} />; }
      case 'triangle': case 'star': case 'hexagon': case 'cylinder': case 'cloud': case 'callout':
        return <g>{shapeParts(a.shape, a.x, a.y, a.w, a.h).map((part, i) => <path key={i} d={part.d} {...common} fill={part.fill ? fill : 'none'} />)}</g>;
      case 'line':
        return <>
          {interactive && <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={Math.max(14, sw + 10)} style={{ pointerEvents: 'stroke' }} />}
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={stroke} strokeWidth={sw} opacity={op} strokeLinecap={a.strokeCap || 'round'} strokeDasharray={dash} {...mk} />
        </>;
      case 'arrow': {
        // Shorten the shaft so it ends at the base of the head (no poke-through).
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        const hlen = Math.max(7, sw * 3 + 4);
        const ex = a.x2 - Math.cos(ang) * hlen * 0.9, ey = a.y2 - Math.sin(ang) * hlen * 0.9;
        return <g>
          {interactive && <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={Math.max(14, sw + 10)} style={{ pointerEvents: 'stroke' }} />}
          <line x1={a.x1} y1={a.y1} x2={ex} y2={ey} stroke={stroke} strokeWidth={sw} opacity={op} strokeLinecap="round" strokeDasharray={dash} />
          <path d={arrowHeadPath(a.x1, a.y1, a.x2, a.y2, sw)} fill={stroke} opacity={op} />
        </g>;
      }
      default: return null;
    }
  };

  const CANVAS_CLOSED_SHAPES = CANVAS_CLOSED_SHAPE_SET;
  // Auto layout: al confirmarse un cambio, los marcos con `layout` recolocan a sus hijos (función pura y estable).
  // Y las instancias de componentes se rehacen desde su principal.
  // Biblioteca compartida de componentes (datos comunes del espacio de trabajo, sincronizados).
  const [library, setLibrary] = useState(() => { const v = yMeta.get('componentLibrary'); return Array.isArray(v) ? v : []; });
  useEffect(() => {
    const f = (ev) => { if (ev.keysChanged && ev.keysChanged.has('componentLibrary')) { const v = yMeta.get('componentLibrary'); setLibrary(Array.isArray(v) ? v : []); } };
    yMeta.observe(f);
    return () => yMeta.unobserve(f);
  }, []);
  useEffect(() => {
    if (draftRef.current) return;
    const fix = (j) => applyAutoLayout(syncInstances(j, library));
    if (fix(jsonProp) !== jsonProp) onChange(j => fix(j));
  }, [jsonProp, library]);
  const annoById = useMemo(() => new Map((json.annotations || []).map(a => [a.id, a])), [json.annotations]);
  // ── Reglas y guías (como en Figma) ──
  // Las guías viven con el canvas (json.vars.guides = { v: [x…], h: [y…] }) y atraen al mover, como cualquier borde.
  const guideBoxes = (j) => {
    const g = (j.vars && j.vars.guides) || {};
    const out = [...(g.v || []).map(x => ({ x, y: -1e6, w: 0, h: 2e6 })), ...(g.h || []).map(y => ({ x: -1e6, y, w: 2e6, h: 0 }))];
    // Los bordes de las columnas y filas de las rejillas de guía también atraen (solo dentro de su marco).
    for (const fr of j.groups || []) {
      const gx = fr.x || 0, gy = (fr.y || 0) + 26, gw = fr.w || CANVAS_GROUP_DEFAULT_W, gh = (fr.h || CANVAS_GROUP_DEFAULT_H) - 26;
      for (const q of frameGrids(fr)) {
        if (q.type === 'grid') continue;
        for (const b of gridBands(q, q.type === 'rows' ? gh : gw)) {
          if (q.type === 'rows') out.push({ x: gx, y: gy + b.start, w: gw, h: 0 }, { x: gx, y: gy + b.start + b.size, w: gw, h: 0 });
          else out.push({ x: gx + b.start, y: gy, w: 0, h: gh }, { x: gx + b.start + b.size, y: gy, w: 0, h: gh });
        }
      }
    }
    return out;
  };
  const setGuides2 = (fn) => onChange(j => { const vars = { colors: [], texts: [], ...(j.vars || {}) }; const g = fn({ v: [], h: [], ...(vars.guides || {}) }); return { ...j, vars: { ...vars, guides: g } }; });
  const startGuideDrag = (e, axis, index) => {
    e.preventDefault(); e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    const onMove = (ev) => {
      const w = screenToWorld(ev.clientX, ev.clientY);
      setGuideDrag({ axis, pos: axis === 'v' ? w.x : w.y, index, out: axis === 'v' ? ev.clientX - rect.left < 20 : ev.clientY - rect.top < 20 });
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      const w = screenToWorld(ev.clientX, ev.clientY);
      const pos = Math.round(axis === 'v' ? w.x : w.y);
      const out = axis === 'v' ? ev.clientX - rect.left < 20 : ev.clientY - rect.top < 20;   // soltada sobre la regla: se quita
      setGuideDrag(null);
      setGuides2(g => {
        const list = [...(g[axis] || [])];
        if (index != null) list.splice(index, 1);
        if (!out) list.push(pos);
        return { ...g, [axis]: list };
      });
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    onMove(e);
  };
  const renderRulers = () => {
    if (!rulersOn || slideshow) return null;
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return null;
    const z = viewport.zoom || 1;
    const nice = [1, 2, 5].flatMap(m => [1, 10, 100, 1000].map(p => m * p)).sort((a, b) => a - b);
    const step = nice.find(v => v * z >= 70) || 5000;
    const ticks = (len, off) => {
      const out = []; const start = Math.floor((-off / z) / step) * step;
      for (let v = start; v * z + off < len; v += step) out.push(v);
      return out;
    };
    const tx = ticks(rect.width, viewport.x), ty = ticks(rect.height, viewport.y);
    return (
      <>
        <div className="cv-ruler cv-ruler-h" onPointerDown={(e) => startGuideDrag(e, 'h')} title={t('canvas.rulers.drag')}>
          {tx.map(v => <span key={v} style={{ left: v * z + viewport.x }}>{v}</span>)}
        </div>
        <div className="cv-ruler cv-ruler-v" onPointerDown={(e) => startGuideDrag(e, 'v')} title={t('canvas.rulers.drag')}>
          {ty.map(v => <span key={v} style={{ top: v * z + viewport.y }}>{v}</span>)}
        </div>
        <div className="cv-ruler-corner" />
      </>
    );
  };
  // ── Edición de puntos de un trazo vectorial (como el modo «editar» de Figma) ──
  // Anclas (cuadrados) y puntos de control de las curvas (círculos). Arrastrar un ancla arrastra también sus
  // controles. Coordenadas locales del trazo (el <g> ya lleva su desplazamiento).
  const renderVecHandles = (a) => {
    const cmds = normalizePath(a.d);
    const z = viewport.zoom || 1, r = 4.5 / z, lw = 1 / z;
    const out = [];
    let prev = null;
    cmds.forEach((c, i) => {
      if (c.c === 'Z') return;
      const v = c.v, ax = c.c === 'A' ? 5 : v.length - 2;
      if (c.c === 'C') {
        if (prev) out.push(<line key={'l1' + i} x1={prev[0]} y1={prev[1]} x2={v[0]} y2={v[1]} stroke="#e0457b" strokeWidth={lw} />);
        out.push(<line key={'l2' + i} x1={v[4]} y1={v[5]} x2={v[2]} y2={v[3]} stroke="#e0457b" strokeWidth={lw} />);
        out.push(<circle key={'c1' + i} cx={v[0]} cy={v[1]} r={r * 0.8} fill="#fff" stroke="#e0457b" strokeWidth={lw * 1.5} style={{ cursor: 'move', pointerEvents: 'all' }} onPointerDown={(e) => startVecDrag(e, a, i, 0)} />);
        out.push(<circle key={'c2' + i} cx={v[2]} cy={v[3]} r={r * 0.8} fill="#fff" stroke="#e0457b" strokeWidth={lw * 1.5} style={{ cursor: 'move', pointerEvents: 'all' }} onPointerDown={(e) => startVecDrag(e, a, i, 2)} />);
      } else if (c.c === 'Q') {
        if (prev) out.push(<line key={'lq' + i} x1={prev[0]} y1={prev[1]} x2={v[0]} y2={v[1]} stroke="#e0457b" strokeWidth={lw} />);
        out.push(<line key={'lq2' + i} x1={v[2]} y1={v[3]} x2={v[0]} y2={v[1]} stroke="#e0457b" strokeWidth={lw} />);
        out.push(<circle key={'cq' + i} cx={v[0]} cy={v[1]} r={r * 0.8} fill="#fff" stroke="#e0457b" strokeWidth={lw * 1.5} style={{ cursor: 'move', pointerEvents: 'all' }} onPointerDown={(e) => startVecDrag(e, a, i, 0)} />);
      }
      out.push(<rect key={'a' + i} x={v[ax] - r} y={v[ax + 1] - r} width={r * 2} height={r * 2} fill="#fff" stroke="var(--accent,#2383E2)" strokeWidth={lw * 1.5} style={{ cursor: 'move', pointerEvents: 'all' }} onPointerDown={(e) => startVecDrag(e, a, i, ax)} />);
      prev = [v[ax], v[ax + 1]];
    });
    return <g className="canvas-vec-handles">{out}</g>;
  };
  const startVecDrag = (e, a, ci, k) => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const base = normalizePath(a.d);
    const isAnchor = (base[ci].c === 'A' ? 5 : base[ci].v.length - 2) === k;
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(); return; }
      const dx = (ev.clientX - sx) / viewportRef.current.zoom, dy = (ev.clientY - sy) / viewportRef.current.zoom;
      const cm = base.map(c => ({ c: c.c, v: c.v.slice() }));
      const mv = (i, j) => { if (cm[i] && cm[i].v.length > j + 1) { cm[i].v[j] += dx; cm[i].v[j + 1] += dy; } };
      mv(ci, k);
      if (isAnchor) {
        if (cm[ci].c === 'C') mv(ci, 2);                               // su control de llegada
        if (cm[ci + 1] && cm[ci + 1].c === 'C') mv(ci + 1, 0);         // y el de salida del siguiente tramo
      }
      const d = transformPath(cm, [1, 0, 0, 1, 0, 0]);
      const bb = pathBbox(cm);
      previewChange(j => ({ ...j, annotations: (j.annotations || []).map(x => x.id === a.id ? { ...x, d, ...(bb ? { bbox: bb } : {}) } : x) }));
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); commitPreview(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  // Forma → trazo vectorial (para poder editar sus puntos), conservando estilo, efectos y posición.
  const toVector = (a) => {
    if (a.kind !== 'shape' || !CANVAS_CLOSED_SHAPE_SET.has(a.shape) || a.w == null) return a;
    let d = a.shape === 'rect' ? cornersRectD(a.x, a.y, a.w, a.h, Array.isArray(a.corners) ? a.corners : (a.rx != null ? a.rx : Math.min(8, Math.min(a.w, a.h) * 0.12)))
      : a.shape === 'ellipse' ? `M ${a.x} ${a.y + a.h / 2} A ${a.w / 2} ${a.h / 2} 0 1 0 ${a.x + a.w} ${a.y + a.h / 2} A ${a.w / 2} ${a.h / 2} 0 1 0 ${a.x} ${a.y + a.h / 2} Z`
      : shapeD(a.shape, a.x, a.y, a.w, a.h);
    if (a.rot) {
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2, r = a.rot * Math.PI / 180, c = Math.cos(r), s2 = Math.sin(r);
      d = transformPath(normalizePath(d), [c, s2, -s2, c, cx - c * cx + s2 * cy, cy - s2 * cx - c * cy]);
    }
    const cm = arcsToCubics(normalizePath(d));   // curvas con tiradores, como en Figma
    const { shape, x, y, w, h, rx, corners, rot, sides, strokeAlign, text, ...rest } = a;
    return { ...rest, kind: 'path', d: transformPath(cm, [1, 0, 0, 1, 0, 0]), bbox: pathBbox(cm) || a.bbox, fill: a.fill || 'none', color: a.color || '#1f2937', strokeWidth: a.strokeWidth || 2 };
  };
  // Recortar la imagen de relleno: arrastrar la mueve dentro de la forma; la rueda la acerca o aleja.
  const startImageCropDrag = (e, a) => {
    e.stopPropagation(); e.preventDefault();
    const z = viewportRef.current.zoom || 1;
    const sx = e.clientX, sy = e.clientY;
    const f0 = a.imageFill || {};
    const ox0 = f0.ox || 0, oy0 = f0.oy || 0;
    const onMove = (ev) => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      previewChange(j => ({ ...j, annotations: (j.annotations || []).map(x => (x.id === a.id ? { ...x, imageFill: { ...x.imageFill, ox: Math.round(ox0 + dx), oy: Math.round(oy0 + dy) } } : x)) }));
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); commitPreview(); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  useEffect(() => {
    if (!cropEdit) return undefined;
    if (!selAnno.has(cropEdit)) { setCropEdit(null); return undefined; }
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setCropEdit(null); } };
    const root = containerRef.current;
    const onWheel = (e) => {
      const el = e.target.closest && e.target.closest('[data-annotation-id]');
      if (!el || el.getAttribute('data-annotation-id') !== cropEdit) return;
      e.preventDefault(); e.stopPropagation();
      onChange(j => ({ ...j, annotations: (j.annotations || []).map(x => (x.id === cropEdit ? { ...x, imageFill: { ...x.imageFill, scale: Math.max(1, Math.min(8, +((x.imageFill.scale || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08)).toFixed(3))) } } : x)) }));
    };
    window.addEventListener('keydown', onKey, true);
    if (root) root.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => { window.removeEventListener('keydown', onKey, true); if (root) root.removeEventListener('wheel', onWheel, { capture: true }); };
  }, [cropEdit, selAnno]);
  const renderAnnotation = (a0) => {
    if (!a0 || !a0.id) return null;
    const a = resolveVars(a0, json.vars);   // variables del diseño (modo activo)
    if (a.hidden) return null;              // oculto por una variable sí/no
    // Una forma usada como máscara de luminancia / alfa no se pinta: solo da forma a lo que recorta (como en Figma).
    if ((a.maskType === 'luminance' || a.maskType === 'alpha') && (json.annotations || []).some(x => x.clipTo === a.id)) return null;
    const sel = selAnno.has(a.id);
    const interactive = tool === 'select' || tool === 'eraser' || tool === 'fill' || tool === 'picker';
    const closed = a.kind === 'shape' && CANVAS_CLOSED_SHAPES.has(a.shape);
    const editing = annoTextEdit === a.id;
    let body = null;
    // Un trazo a mano sin `d` (p. ej. un agente le cambió el grosor) se rehace aquí desde sus puntos.
    const pd = a.kind === 'path' ? (a.d || (Array.isArray(a.pts) && a.pts.length ? strokeD(a) : null)) : null;
    // Varios rellenos / bordes: el dibujo base y, encima, una capa por relleno y por borde.
    const ps = paintStack(a);
    const pathBody = (b) => <path d={pd} fill={(b.imageFill && b.imageFill.src) ? 'none' : b.gradient ? `url(#cvg-${b.id})` : (b.fill || 'none')} fillRule={b.fillRule || undefined} stroke={b.color || '#ea580c'} strokeWidth={b.strokeWidth || 2.5} strokeLinecap={b.strokeCap || 'round'} strokeLinejoin={b.strokeJoin || 'round'} opacity={b.opacity != null ? b.opacity : 0.85} strokeDasharray={canvasDashArray(b.dash) || undefined}
      markerStart={b.startCap && b.startCap !== 'none' ? `url(#${b.id}-ms)` : undefined} markerEnd={b.endCap && b.endCap !== 'none' ? `url(#${b.id}-me)` : undefined} />;
    if (a.kind === 'path' && pd) {
      if (a.variant === 'pen') {
        // Pincel: textura / halo con un filtro SVG propio del trazo; el trazo sigue siendo un vector relleno.
        const ink = a.fill || a.color || '#1f2937';
        const bf = a.brush && a.brush !== 'pen' ? brushFilterSvg(a.brush, `cvb-${a.id}`, ink) : '';
        const blend = brushSpec(a.brush).blend;
        body = <>
          {bf && <defs dangerouslySetInnerHTML={{ __html: bf }} />}
          <path d={pd} fill={brushFill(a.brush, ink)} stroke="none" opacity={a.opacity != null ? a.opacity : 1} filter={bf ? `url(#cvb-${a.id})` : undefined} style={blend ? { mixBlendMode: blend } : undefined} />
        </>;
      }
      else if (a.variant === 'highlighter') body = <path d={pd} fill="none" stroke={a.color || '#f59e0b'} strokeWidth={a.strokeWidth || 12} strokeLinecap="round" strokeLinejoin="round" opacity={a.opacity != null ? a.opacity : 0.35} style={{ mixBlendMode: 'multiply' }} />;
      else body = pathBody(ps ? ps.base : a);
    } else if (a.kind === 'shape') {
      body = renderAnnoShape(ps ? ps.base : a, interactive);
    } else return null;
    // Degradado y sombra (sobre todo de SVG importados o de agentes): definiciones propias de este dibujo.
    // Imagen como relleno: en pantalla, una <image> recortada con la forma (un <pattern> no se pinta bien en las
    // capas SVG del canvas, que se desbordan de su caja); el borde va encima.
    if (a.imageFill && a.imageFill.src) {
      const ig = imageGeom(a), geom = maskGeometry({ ...a, ox: 0, oy: 0, rot: 0 });
      if (ig && geom) {
        const adj = hasImageAdjust(a.imageFill) ? imageAdjustSvg(a.imageFill, `cvia-${a.id}`) : '';
        const cropping = cropEdit === a.id;
        body = <>
          <clipPath id={`cvic-${a.id}`}><path d={geom.d} /></clipPath>
          {adj && <defs dangerouslySetInnerHTML={{ __html: adj }} />}
          {/* Recortando: la imagen entera se ve tenue alrededor, para saber dónde queda. */}
          {cropping && <image href={a.imageFill.src} x={ig.x} y={ig.y} width={ig.w} height={ig.h} preserveAspectRatio={ig.par} opacity={0.3} filter={adj ? `url(#cvia-${a.id})` : undefined} />}
          <g clipPath={`url(#cvic-${a.id})`}><image href={a.imageFill.src} x={ig.x} y={ig.y} width={ig.w} height={ig.h} preserveAspectRatio={ig.par} opacity={a.opacity != null ? a.opacity : 1} filter={adj ? `url(#cvia-${a.id})` : undefined} /></g>
          {body}
          {cropping && <rect x={ig.x} y={ig.y} width={ig.w} height={ig.h} fill="none" stroke="var(--accent,#2383E2)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        </>;
      }
    }
    if (ps) {
      body = <>{body}{ps.layers.map(l => (
        <g key={l.id} style={l.blend && l.blend !== 'normal' ? { mixBlendMode: l.blend } : undefined}>
          {l.gradient ? annoPaintDefs(l) : null}
          {a.kind === 'path' ? pathBody(l) : renderAnnoShape(l, false)}
        </g>
      ))}</>;
    }
    if (a.startCap || a.endCap) { const m = markerSvg(a, a.id); if (m.defs) body = <><defs dangerouslySetInnerHTML={{ __html: m.defs }} />{body}</>; }
    const paintDefs = (a.gradient || hasFilter(a)) ? annoPaintDefs(a) : null;
    if (hasFilter(a)) body = <g filter={`url(#cvs-${a.id})`}>{body}</g>;
    if (paintDefs) body = <>{paintDefs}{body}</>;
    // Resize handles (only for the single selected shape, in select mode).
    const hr = 4.5 / (viewport.zoom || 1);
    const handle = (key, hx, hy, cursor) => (
      <circle key={key} cx={hx} cy={hy} r={hr} className="canvas-anno-handle"
        onPointerDown={(e) => startAnnoResize(e, a, key)}
        style={{ cursor, pointerEvents: 'all' }} />
    );
    let handles = null;
    if (sel && tool === 'select' && a.kind === 'path' && Array.isArray(a.pts) && a.pts.length > 1 && selAnno.size === 1) {
      // Trazo con puntos crudos: 8 asas sobre su caja (sin rotación).
      const b = a.bbox || ptsBbox(a.pts);
      const { x, y } = b, w = Math.max(1, b.w), h = Math.max(1, b.h);
      handles = <>
        <rect x={x} y={y} width={w} height={h} fill="none" stroke="var(--accent,#2383E2)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
        {handle('nw', x, y, 'nwse-resize')}{handle('n', x + w / 2, y, 'ns-resize')}{handle('ne', x + w, y, 'nesw-resize')}
        {handle('e', x + w, y + h / 2, 'ew-resize')}{handle('se', x + w, y + h, 'nwse-resize')}{handle('s', x + w / 2, y + h, 'ns-resize')}
        {handle('sw', x, y + h, 'nesw-resize')}{handle('w', x, y + h / 2, 'ew-resize')}
      </>;
    } else if (sel && tool === 'select' && a.kind === 'shape') {
      if (a.shape === 'line' || a.shape === 'arrow') {
        handles = <>{handle('p1', a.x1, a.y1, 'move')}{handle('p2', a.x2, a.y2, 'move')}</>;
      } else {
        const { x, y, w, h } = a;
        const rotY = y - 22 / (viewport.zoom || 1);
        handles = <>
          {handle('nw', x, y, 'nwse-resize')}{handle('n', x + w / 2, y, 'ns-resize')}{handle('ne', x + w, y, 'nesw-resize')}
          {handle('e', x + w, y + h / 2, 'ew-resize')}{handle('se', x + w, y + h, 'nwse-resize')}{handle('s', x + w / 2, y + h, 'ns-resize')}
          {handle('sw', x, y + h, 'nesw-resize')}{handle('w', x, y + h / 2, 'ew-resize')}
          <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={rotY} stroke="var(--accent,#5a7a4e)" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
          <circle cx={x + w / 2} cy={rotY} r={hr} className="canvas-anno-handle canvas-anno-rotate"
            onPointerDown={(e) => startAnnoRotate(e, a)} style={{ cursor: 'grab', pointerEvents: 'all' }} />
        </>;
      }
    }
    const shapeRot = (a.kind === 'shape' && a.rot && CANVAS_CLOSED_SHAPES.has(a.shape))
      ? ` rotate(${a.rot} ${a.x + a.w / 2} ${a.y + a.h / 2})` : '';
    // Recorte (máscara): lo de fuera de la forma que recorta no se ve. Va en un <g> exterior para que el
    // contorno esté en coordenadas del mundo y no se mueva con el desplazamiento propio del dibujo.
    const clip = (a.clipTo || a.clip) ? clipFor(a, annoById) : null;
    const el = (
      <g key={a.id}
        className={`canvas-annotation${sel ? ' selected' : ''}`}
        data-annotation-id={a.id}
        data-hover={(a.anim && a.anim.hover) || undefined} data-loop={(a.anim && a.anim.loop) || undefined}
        transform={`translate(${a.ox || 0} ${a.oy || 0})${shapeRot}`}
        onPointerDown={tool === 'select' && !editing ? (e) => (cropEdit === a.id ? startImageCropDrag(e, a) : startAnnoDrag(e, a)) : undefined}
        onDoubleClick={tool === 'select' && closed ? (e) => { e.stopPropagation(); setSelAnno(new Set([a.id])); setAnnoTextEdit(a.id); } : (tool === 'select' && a.kind === 'path' && !a.variant && a.d) ? (e) => { e.stopPropagation(); setSelAnno(new Set([a.id])); setVecEdit(a.id); } : undefined}
        style={{ cursor: tool === 'select' ? 'move' : tool === 'eraser' ? 'crosshair' : 'default', pointerEvents: interactive ? 'visiblePainted' : 'none', mixBlendMode: a.blend && a.blend !== 'normal' ? a.blend : undefined }}>
        {body}
        {closed && (a.text || editing) && (
          <foreignObject {...(() => { const tb = shapeTextBox(a.shape, a.x, a.y, Math.max(8, a.w), Math.max(8, a.h)); return { x: tb.x, y: tb.y, width: Math.max(8, tb.w), height: Math.max(8, tb.h) }; })()} style={{ overflow: 'visible' }}>
            {editing ? (
              <textarea autoFocus className="canvas-anno-textedit"
                defaultValue={a.text || ''}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={(e) => { const v = e.target.value; setAnnoTextEdit(null); onChange(j => ({ ...j, annotations: (j.annotations || []).map(x => x.id === a.id ? { ...x, text: v } : x) })); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setAnnoTextEdit(null); } else { e.stopPropagation(); } }}
                style={{ color: a.color || '#1f2937' }} />
            ) : (
              <div className="canvas-anno-text" style={{ color: a.color || '#1f2937', pointerEvents: 'none' }}>{a.text}</div>
            )}
          </foreignObject>
        )}
        {a.label && a.labelX != null && a.labelY != null && (
          <text x={a.labelX} y={a.labelY} className="canvas-annotation-label" fill={a.color || '#ea580c'} textAnchor="middle" style={{ pointerEvents: 'none', fontSize: 11, fontWeight: 600 }}>{a.label}</text>
        )}
        {sel && a.bbox && !handles && (
          <rect x={a.bbox.x - 4} y={a.bbox.y - 4} width={a.bbox.w + 8} height={a.bbox.h + 8} fill="none" stroke="var(--accent,#5a7a4e)" strokeWidth={1.2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
        )}
        {handles}
        {vecEdit === a.id && a.kind === 'path' && a.d && renderVecHandles(a)}
      </g>
    );
    if (!clip) return el;
    // Máscara de luminancia o alfa (como el tipo de máscara de Figma): la forma que recorta se pinta tal cual
    // (con su degradado) dentro de un <mask>; lo claro (o lo opaco) deja ver, lo oscuro (o transparente) oculta.
    const mShape = a.clipTo ? annoById.get(a.clipTo) : null;
    if (mShape && (mShape.maskType === 'luminance' || mShape.maskType === 'alpha')) {
      const ms = resolveVars(mShape, json.vars);
      return (
        <g key={'mask-' + a.id} mask={`url(#cvmask-${a.id})`}>
          <defs>
            <mask id={`cvmask-${a.id}`} maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" style={{ maskType: mShape.maskType }}>
              {ms.gradient ? <defs dangerouslySetInnerHTML={{ __html: gradientSvg(ms, `cvg-${ms.id}`) }} /> : null}
              <g transform={`translate(${ms.ox || 0} ${ms.oy || 0})${ms.rot && ms.w != null ? ` rotate(${ms.rot} ${ms.x + ms.w / 2} ${ms.y + ms.h / 2})` : ''}`}>
                {ms.kind === 'path' ? <path d={ms.d} fill={ms.gradient ? `url(#cvg-${ms.id})` : (ms.fill && ms.fill !== 'none' ? ms.fill : '#ffffff')} opacity={ms.opacity != null ? ms.opacity : 1} /> : renderAnnoShape({ ...ms, color: 'none', fill: ms.fill && ms.fill !== 'none' ? ms.fill : '#ffffff' }, false)}
              </g>
            </mask>
          </defs>
          {el}
        </g>
      );
    }
    return (
      <g key={'clip-' + a.id} clipPath={`url(#cvclip-${a.id})`}>
        <defs><clipPath id={`cvclip-${a.id}`} clipPathUnits="userSpaceOnUse"><path d={clip.d} transform={clip.transform || undefined} /></clipPath></defs>
        {el}
      </g>
    );
  };

  // Pointer handling: pan when grabbing the bare canvas; drag/resize for
  // nodes/groups; edge-draw from the `+` anchor.
  // Free drawing + shapes run through a dedicated pointer handler (for stylus
  // pressure); the mouse handler only drives pan/select when a drawing tool
  // isn't active.
  // Cubo de relleno y cuentagotas (Paint): actúan sobre lo que hay bajo el ratón, sea un trazo, una forma
  // dibujada o una ficha (nota adhesiva, forma con texto…).
  const paintAt = (e) => {
    const color = drawStyleRef.current.color;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const g = el && el.closest && el.closest('[data-annotation-id]');
    const w = screenToWorld(e.clientX, e.clientY);
    const nodeHit = !g && [...(jsonRef.current.nodes || [])].reverse().find(n => {
      if (n.kind === 'page') return false;
      const r = canvasNodeRect(n); return w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h;
    });
    if (tool === 'picker') {
      let c = null;
      if (g) { const a = (jsonRef.current.annotations || []).find(x => x.id === g.getAttribute('data-annotation-id')); c = a && (a.color || a.fill); }
      else if (nodeHit) c = nodeHit.color || null;
      if (c && /^#[0-9a-f]{3,8}$/i.test(c)) setDrawStyle(st => ({ ...st, color: c }));
      setTool(prevPaintToolRef.current || 'pen');
      return;
    }
    if (g) {
      const id = g.getAttribute('data-annotation-id');
      onChange(j => ({ ...j, annotations: (j.annotations || []).map(a => {
        if (a.id !== id) return a;
        if (a.kind === 'shape' && CANVAS_CLOSED_SHAPE_SET.has(a.shape)) { const { fillVar, gradient, ...r } = a; return { ...r, fill: color }; }
        if (a.kind === 'path' && a.variant === 'pen') { const { colorVar, ...r } = a; return { ...r, color, fill: color }; }
        if (a.kind === 'path' && !a.variant && a.fill && a.fill !== 'none') { const { fillVar, gradient, ...r } = a; return { ...r, fill: color }; }   // trazo vectorial relleno (SVG)
        { const { colorVar, ...r } = a; return { ...r, color }; }
      }) }));
    } else if (nodeHit) {
      onChange(j => ({ ...j, nodes: (j.nodes || []).map(n => n.id === nodeHit.id ? (({ fillVar, colorVar, ...r }) => ({ ...r, color }))(n) : n) }));
    }
  };
  // ── Pluma (como en Figma): clic = punto; clic y arrastrar = punto con curva (tiradores simétricos); clic en el
  // primer punto = cerrar; Intro, Esc o doble clic = terminar. El resultado es un trazo vectorial editable.
  const penRef = useRef(null);
  const penD = (pts, closed) => {
    if (!pts.length) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    const seg = (a, b) => (a.hout || b.hin)
      ? ` C ${(a.hout || [a.x, a.y]).join(' ')} ${(b.hin || [b.x, b.y]).join(' ')} ${b.x} ${b.y}` : ` L ${b.x} ${b.y}`;
    for (let i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
    if (closed && pts.length > 2) d += seg(pts[pts.length - 1], pts[0]) + ' Z';
    return d;
  };
  const penPreview = (cursor) => {
    const st = penRef.current; if (!st) return;
    const last = st.pts[st.pts.length - 1];
    const style = drawStyleRef.current;
    setLivePreview({ kind: 'vpen', pts: st.pts, d: penD(st.pts, false), color: style.color, size: style.size,
      rubber: cursor && last ? `M ${last.x} ${last.y} L ${cursor.x} ${cursor.y}` : null });
  };
  const penFinish = (closed) => {
    const st = penRef.current; penRef.current = null; setLivePreview(null);
    if (!st || st.pts.length < 2) return;
    const style = drawStyleRef.current;
    const d = penD(st.pts, closed);
    const cm = normalizePath(d);
    const bb = pathBbox(cm);
    const anno = { id: canvasAnnoId(), kind: 'path', d: transformPath(cm, [1, 0, 0, 1, 0, 0]), fill: closed && style.fill ? canvasFillFromHex(style.color, 0.25) : 'none', color: style.color, strokeWidth: style.size, opacity: style.opacity != null ? style.opacity : 1, bbox: bb };
    onChange(j => ({ ...j, annotations: [...(j.annotations || []), anno] }));
    setSelAnno(new Set([anno.id]));
  };
  const penDown = (e) => {
    const w = screenToWorld(e.clientX, e.clientY);
    if (!penRef.current) penRef.current = { pts: [] };
    const st = penRef.current;
    const z = viewportRef.current.zoom || 1;
    if (st.pts.length > 2 && Math.hypot(w.x - st.pts[0].x, w.y - st.pts[0].y) < 8 / z) { penFinish(true); return; }   // cerrar
    if (e.detail >= 2) { penFinish(false); return; }                                                                // doble clic: terminar
    const p = { x: w.x, y: w.y, hin: null, hout: null };
    st.pts.push(p);
    penPreview(null);
    const onMove = (ev) => {
      const m = screenToWorld(ev.clientX, ev.clientY);
      if (ev.buttons === 0) { penPreview(m); return; }
      if (Math.hypot(m.x - p.x, m.y - p.y) > 3 / z) { p.hout = [m.x, m.y]; p.hin = [2 * p.x - m.x, 2 * p.y - m.y]; }
      penPreview(null);
    };
    const onUp = () => { window.removeEventListener('pointerup', onUp); penPreview(null); };
    if (!st.hover) { st.hover = onMove; window.addEventListener('pointermove', onMove); }
    else { window.removeEventListener('pointermove', st.hover); st.hover = onMove; window.addEventListener('pointermove', onMove); }
    window.addEventListener('pointerup', onUp);
  };
  useEffect(() => {
    if (tool === 'vpen') return undefined;
    if (penRef.current) { if (penRef.current.hover) window.removeEventListener('pointermove', penRef.current.hover); penFinish(false); }
    return undefined;
  }, [tool]);
  const onCanvasPointerDown = (e) => {
    if (!isDrawTool || e.button !== 0) return;
    // Pen / shapes start from empty canvas; the eraser works anywhere.
    if (tool === 'fill' || tool === 'picker') { e.preventDefault(); e.stopPropagation(); paintAt(e); return; }
    if (tool === 'vpen') { e.preventDefault(); e.stopPropagation(); focusCanvas(); penDown(e); return; }
    if (tool !== 'eraser') {
      if (e.target !== containerRef.current && !e.target.classList.contains('canvas-world')) return;
    }
    e.preventDefault();
    e.stopPropagation();
    focusCanvas();
    const style = drawStyleRef.current;

    if (tool === 'eraser') {
      // Goma tipo Paint: corta los trazos por donde pasa (lo demás —formas, líneas— se borra entero al tocarlo).
      // Se ve en vivo (borrador) y se guarda de una vez al soltar, así que deshacer la recupera entera.
      const zoom = viewportRef.current.zoom || 1;
      const r = Math.max(1, (style.eraser || 18) / 2 / zoom);
      const whole = new Set();
      let annos = (jsonRef.current && jsonRef.current.annotations) || [];
      const start = screenToWorld(e.clientX, e.clientY);
      let last = start, any = false;
      const removed = new Set();
      const step = (cx, cy, w) => {
        const el = document.elementFromPoint(cx, cy);
        const g = el && el.closest && el.closest('[data-annotation-id]');
        if (g) { const id = g.getAttribute('data-annotation-id'); const a = annos.find(x => x.id === id); if (a && a.kind !== 'path') whole.add(id); }
        const res = eraseAnnotations(annos, [[last.x, last.y], [w.x, w.y]], r, { newId: canvasAnnoId, rebuild: strokeD, hitWhole: (a) => whole.has(a.id) });
        last = w;
        if (!res) return;
        any = true; annos = res.annotations;
        for (const id of res.removedIds) removed.add(id);
        const snap = annos;
        previewChange(j => ({ ...j, annotations: snap, edges: dropEdgesTouching(j, removed) }));
      };
      step(e.clientX, e.clientY, start);
      const onMove = (ev) => {
        if (ev.buttons === 0) { onUp(); return; }
        setEraserAt({ x: ev.clientX, y: ev.clientY });
        step(ev.clientX, ev.clientY, screenToWorld(ev.clientX, ev.clientY));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (any) commitPreview();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    const start = screenToWorld(e.clientX, e.clientY);

    // Laser pointer: pure presentation — feed the fading trail, persist nothing.
    if (tool === 'laser') {
      laserPush(start.x, start.y);
      const onMove = (ev) => {
        if (ev.buttons === 0) { onUp(); return; }
        const p = screenToWorld(ev.clientX, ev.clientY);
        laserPush(p.x, p.y);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    if (CANVAS_SHAPE_TOOLS.has(tool)) {
      drawingRef.current = { shape: tool, x0: start.x, y0: start.y, x1: start.x, y1: start.y, shift: e.shiftKey };
      setLivePreview({ kind: 'shape', shape: tool, x0: start.x, y0: start.y, x1: start.x, y1: start.y, color: style.color, size: style.size, opacity: style.opacity });
      const onMove = (ev) => {
        if (ev.buttons === 0) { onUp(ev); return; }
        const p = screenToWorld(ev.clientX, ev.clientY);
        let x1 = p.x, y1 = p.y;
        if (ev.shiftKey) { // constrain: square / circle / 45° lines
          const dx = x1 - start.x, dy = y1 - start.y;
          if (tool === 'line' || tool === 'arrow') {
            if (Math.abs(dx) > Math.abs(dy) * 2) y1 = start.y;
            else if (Math.abs(dy) > Math.abs(dx) * 2) x1 = start.x;
            else { const s = (Math.abs(dx) + Math.abs(dy)) / 2; x1 = start.x + Math.sign(dx) * s; y1 = start.y + Math.sign(dy) * s; }
          } else { const s = Math.max(Math.abs(dx), Math.abs(dy)); x1 = start.x + Math.sign(dx || 1) * s; y1 = start.y + Math.sign(dy || 1) * s; }
        }
        drawingRef.current.x1 = x1; drawingRef.current.y1 = y1;
        setLivePreview({ kind: 'shape', shape: tool, x0: start.x, y0: start.y, x1, y1, color: style.color, size: style.size, opacity: style.opacity });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const d = drawingRef.current; drawingRef.current = null; setLivePreview(null);
        if (!d) return;
        const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
        const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
        if ((tool === 'line' || tool === 'arrow')) {
          if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return;
          const bbox = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
          onChange(j => ({ ...j, annotations: [...(j.annotations || []), { id: canvasAnnoId(), kind: 'shape', shape: tool, x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, color: style.color, strokeWidth: style.size, opacity: style.opacity, bbox }] }));
        } else {
          if (w < 4 && h < 4) return;
          const fill = style.fill ? canvasFillFromHex(style.color) : 'none';
          onChange(j => ({ ...j, annotations: [...(j.annotations || []), { id: canvasAnnoId(), kind: 'shape', shape: tool, x, y, w, h, color: style.color, strokeWidth: style.size, opacity: style.opacity, fill, bbox: { x, y, w, h } }] }));
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // Lápiz / rotulador a mano: todas las muestras del puntero, estabilizador, curva de presión, inclinación
    // (o presión simulada con el ratón) y la predicción del navegador para que la tinta vaya pegada a la punta.
    const ink = createInk({ stabilize: inkPrefs.stabilize, gamma: inkPrefs.gamma, simulate: e.pointerType === 'mouse' });
    const sampleOf = (s) => { const w = screenToWorld(s.clientX, s.clientY); return { x: w.x, y: w.y, pressure: s.pressure, tiltX: s.tiltX, tiltY: s.tiltY, t: s.timeStamp }; };
    ink.add(sampleOf(e));
    drawingRef.current = { points: ink.points, predicted: [] };
    const renderPreview = () => {
      const pts = withPrediction(drawingRef.current.points, drawingRef.current.predicted);
      const d = tool === 'pen' ? brushOutlineD(pts, style.size, inkPrefs.brush) : smoothStrokeD(pts);
      setLivePreview({ kind: 'path', tool, d, color: style.color, size: style.size, opacity: style.opacity * brushSpec(inkPrefs.brush).opacity, brush: tool === 'pen' ? inkPrefs.brush : null });
    };
    renderPreview();
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(ev); return; }
      if (!drawingRef.current) return;
      const { samples, predicted } = eventSamples(ev, { predicted: true });
      const minD = 0.8 / (viewportRef.current.zoom || 1);
      for (const s of samples) {
        const q = sampleOf(s);
        const last = ink.points[ink.points.length - 1];
        if (last && Math.hypot(q.x - last[0], q.y - last[1]) < minD && ink.points.length > 1) continue;
        ink.add(q);
      }
      drawingRef.current.predicted = inkPrefs.predict ? predicted.map(sampleOf) : [];
      renderPreview();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (drawingRef.current) ink.finish();
      const pts = drawingRef.current ? ink.points : [];
      drawingRef.current = null; setLivePreview(null);
      if (pts.length < 2) return;
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const raw = packStrokePts(pts);
      const anno = tool === 'pen'
        ? { id: canvasAnnoId(), kind: 'path', variant: 'pen', d: brushOutlineD(pts, style.size, inkPrefs.brush), pts: raw, size: style.size, fill: style.color, color: style.color, opacity: Math.round(style.opacity * brushSpec(inkPrefs.brush).opacity * 100) / 100, bbox: brushBbox(bbox, style.size, inkPrefs.brush), ...(inkPrefs.brush && inkPrefs.brush !== 'pen' ? { brush: inkPrefs.brush } : {}) }
        : { id: canvasAnnoId(), kind: 'path', variant: 'highlighter', d: smoothStrokeD(pts), pts: raw, size: style.size, color: style.color, strokeWidth: style.size * 4, opacity: 0.35, bbox };
      onChange(j => ({ ...j, annotations: [...(j.annotations || []), anno] }));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onCanvasMouseDown = (e) => {
    if (isDrawTool) return; // drawing handled by onCanvasPointerDown
    if (e.target !== containerRef.current && !e.target.classList.contains('canvas-world')) return;
    e.preventDefault();
    focusCanvas();
    // Free-text tool: place a borderless label here and open it for typing.
    if (tool === 'text') {
      const p = screenToWorld(e.clientX, e.clientY);
      const id = canvasNodeId();
      const node = { id, kind: 'label', text: '', x: p.x, y: p.y - 14, w: 240, h: 40, fontSize: 22 };
      onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
      setSelected(new Set([id]));
      setAutoEditId(id);
      setTool('select');
      return;
    }
    // Shift + drag on empty canvas → marquee select (intersection test).
    if (e.shiftKey) {
      const start = screenToWorld(e.clientX, e.clientY);
      setMarquee({ x: start.x, y: start.y, w: 0, h: 0 });
      const rectOf = (ev) => {
        const cur = screenToWorld(ev.clientX, ev.clientY);
        return { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
      };
      const onMove = (ev) => {
        if (ev.buttons === 0) { onUp(ev); return; } // mouseup lost off-window
        setMarquee(rectOf(ev));
      };
      const onUp = (ev) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const r = rectOf(ev);
        setMarquee(null);
        if (r.w < 4 && r.h < 4) { setSelected(new Set()); setSelAnno(new Set()); return; }
        const hit = new Set();
        for (const n of nodeGridRef.current.query(r.x, r.y, r.w, r.h)) hit.add(n.id);
        const hitA = new Set();
        for (const a of (json.annotations || [])) {
          const bb = a.bbox; if (!bb) continue;
          const ax = bb.x + (a.ox || 0), ay = bb.y + (a.oy || 0);
          if (ax < r.x + r.w && ax + bb.w > r.x && ay < r.y + r.h && ay + bb.h > r.y) hitA.add(a.id);
        }
        setSelected(hit);
        setSelAnno(hitA);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }
    setSelected(new Set());
    setSelAnno(new Set());
    const startX = e.clientX, startY = e.clientY;
    const startVx = viewportRef.current.x, startVy = viewportRef.current.y;
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(ev); return; } // mouseup lost off-window
      setViewport(v => ({ ...v, x: startVx + (ev.clientX - startX), y: startVy + (ev.clientY - startY) }));
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // La rueda va por un listener NATIVO no pasivo: el onWheel de React es pasivo y
  // preventDefault() fallaba (el navegador podía hacer zoom/scroll de página).
  const wheelRef = useRef(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = (e) => wheelRef.current && wheelRef.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);
  const onWheel = (e) => {
    // Bare wheel/trackpad = pan (Shift = horizontal), Ctrl/Cmd + wheel = zoom.
    // This matches Miro/Figma and removes the biggest trackpad friction.
    if (!e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      setViewport(v => ({ ...v, x: v.x - dx, y: v.y - dy }));
      return;
    }
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setViewport(v => {
      const next = Math.max(0.2, Math.min(3, v.zoom * factor));
      const rect = containerRef.current && containerRef.current.getBoundingClientRect();
      if (!rect) return { ...v, zoom: next };
      // Zoom toward cursor: keep the world point under cursor stationary.
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const worldX = (cx - v.x) / v.zoom;
      const worldY = (cy - v.y) / v.zoom;
      return { x: cx - worldX * next, y: cy - worldY * next, zoom: next };
    });
  };

  wheelRef.current = onWheel;

  const startNodeDrag = (e, node, mode) => {
    e.preventDefault();
    e.stopPropagation();
    focusCanvas();
    // Modifier-click toggles membership and does NOT start a drag.
    if (mode === 'drag' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      setSelected(prev => {
        const n = new Set(prev);
        if (n.has(node.id)) n.delete(node.id); else n.add(node.id);
        return n;
      });
      return;
    }
    // Resize is always single-node. Drag moves the whole selection if this node
    // is part of a multi-selection; otherwise it selects + moves just this one.
    let moveIds = (mode === 'drag' && selected.has(node.id) && selected.size > 1)
      ? new Set(selected)
      : new Set([node.id]);
    let annoMoveIds = new Set();
    if (mode === 'drag') {
      const g = expandGroups(moveIds, selected.has(node.id) ? selAnno : new Set());
      moveIds = g.nodes; annoMoveIds = g.annos;
      if (annoMoveIds.size) setSelAnno(new Set(annoMoveIds));
    }
    setSelected(new Set(moveIds));
    if (node.locked) return;                       // bloqueada: se selecciona, no se mueve ni se redimensiona
    if (mode === 'drag') {
      moveIds = new Set([...moveIds].filter(id => !lockedIds.has(id)));
      annoMoveIds = new Set([...annoMoveIds].filter(id => !lockedIds.has(id)));
    }
    const startX = e.clientX, startY = e.clientY;
    const origPos = new Map(), annoOrig = new Map();
    if (mode === 'drag') {
      for (const n of (json.nodes || [])) if (moveIds.has(n.id)) origPos.set(n.id, { x: n.x || 0, y: n.y || 0 });
      for (const a of (json.annotations || [])) if (annoMoveIds.has(a.id)) annoOrig.set(a.id, { ox: a.ox || 0, oy: a.oy || 0 });
    }
    const orig = { w: node.w || CANVAS_DEFAULT_NODE_W, h: node.h || CANVAS_DEFAULT_NODE_H };
    const scaleFont = mode === 'resize' && e.shiftKey;
    if (mode === 'resize' && node.kind === 'label') {
      // El texto libre puede ser más alto que su h guardado (crece con el
      // contenido): parte del tamaño que se ve para que la esquina no salte.
      const el = e.target.closest && e.target.closest('.canvas-node');
      if (el && !scaleFont) orig.h = Math.round(el.offsetHeight);
    }
    // Snap y guías de alineación para uno o varios elementos que se arrastran (se ajusta la CAJA de la
    // selección: izquierda/centro/derecha y arriba/medio/abajo contra los de los vecinos, a ~6 px) y
    // para el borde derecho/inferior al redimensionar. Además, espaciado igual: si la caja queda entre
    // dos vecinos, se ajusta al punto medio y se muestran los dos huecos.
    const single = mode === 'drag' && moveIds.size === 1 && annoOrig.size === 0;
    const box0 = (() => {
      if (mode !== 'drag') { const o = { x: node.x || 0, y: node.y || 0 }; return { x: o.x, y: o.y, w: orig.w, h: orig.h }; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of (json.nodes || [])) {
        if (!origPos.has(n.id)) continue;
        const o = origPos.get(n.id), w = n.w || CANVAS_DEFAULT_NODE_W, h = n.h || CANVAS_DEFAULT_NODE_H;
        x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + w); y1 = Math.max(y1, o.y + h);
      }
      return x0 === Infinity ? { x: node.x || 0, y: node.y || 0, w: orig.w, h: orig.h } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    })();
    const others = (() => {
      const R = 1200;   // sólo los vecinos que puedan quedar a ~6 px tras arrastrar un trecho razonable
      return nodeGridRef.current.query(box0.x - R, box0.y - R, box0.w + 2 * R, box0.h + 2 * R)
        .filter(n => !moveIds.has(n.id) && n.id !== node.id).map(canvasNodeRect)
        .concat(annoBoxes(json.annotations, annoMoveIds).filter(b => Math.abs(b.x - box0.x) < R + box0.w && Math.abs(b.y - box0.y) < R + box0.h))   // también los dibujos
        .concat(guideBoxes(json));   // y las guías
    })();
    const SNAP = 6 / (viewportRef.current.zoom || 1);
    const snapAxis = (lines, candidates) => {
      let best = null, bestAbs = SNAP, at = null;
      for (const ln of lines) for (const cand of candidates) {
        const d = cand - ln;
        if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = d; at = cand; }
      }
      return best == null ? null : { delta: best, at };
    };
    const edgeCands = () => {
      const xc = [], yc = [];
      for (const o of others) { xc.push(o.x, o.x + o.w / 2, o.x + o.w); yc.push(o.y, o.y + o.h / 2, o.y + o.h); }
      return { xc, yc };
    };
    // Espaciado igual: la caja (bx,by,bw,bh) centrada entre el vecino más cercano de cada lado.
    const equalGap = (bx, by, bw, bh) => {
      const res = { dx: null, dy: null, gaps: [] };
      const ov = (a0, a1, b0, b1) => a0 < b1 && a1 > b0;
      let L = null, Rr = null, T = null, B = null;
      for (const o of others) {
        if (ov(by, by + bh, o.y, o.y + o.h)) {
          if (o.x + o.w <= bx + SNAP && (!L || o.x + o.w > L.x + L.w)) L = o;
          if (o.x >= bx + bw - SNAP && (!Rr || o.x < Rr.x)) Rr = o;
        }
        if (ov(bx, bx + bw, o.x, o.x + o.w)) {
          if (o.y + o.h <= by + SNAP && (!T || o.y + o.h > T.y + T.h)) T = o;
          if (o.y >= by + bh - SNAP && (!B || o.y < B.y)) B = o;
        }
      }
      if (L && Rr) { const xt = (L.x + L.w + Rr.x - bw) / 2; if (Math.abs(bx - xt) < SNAP) { res.dx = xt - bx; res.hz = { lx: L.x + L.w, rx: Rr.x, bw, xt }; } }
      if (T && B) { const yt = (T.y + T.h + B.y - bh) / 2; if (Math.abs(by - yt) < SNAP) { res.dy = yt - by; res.vt = { ty: T.y + T.h, by2: B.y, bh, yt }; } }
      return res;
    };
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(); return; } // mouseup lost off-window
      const dx = (ev.clientX - startX) / viewportRef.current.zoom;
      const dy = (ev.clientY - startY) / viewportRef.current.zoom;
      if (mode === 'drag') {
        const o0 = origPos.get(node.id) || { x: node.x || 0, y: node.y || 0 };
        let ddx = dx, ddy = dy;
        const gv = [], gh = [], gaps = [];
        if (snapGrid) { ddx = snapVal(o0.x + dx) - o0.x; ddy = snapVal(o0.y + dy) - o0.y; }
        else if (others.length) {
          const r = snapMove({ x: box0.x + dx, y: box0.y + dy, w: box0.w, h: box0.h }, others, SNAP);
          ddx = dx + r.dx; ddy = dy + r.dy;
          gv.push(...r.v); gh.push(...r.h); gaps.push(...r.gaps);
        }
        setGuides((gv.length || gh.length || gaps.length) ? { v: gv, h: gh, gaps } : null);
        previewChange(j => ({ ...j,
          nodes: j.nodes.map(n => origPos.has(n.id) ? { ...n, x: origPos.get(n.id).x + ddx, y: origPos.get(n.id).y + ddy } : n),
          ...(annoOrig.size ? { annotations: (j.annotations || []).map(a => annoOrig.has(a.id) ? { ...a, ox: annoOrig.get(a.id).ox + ddx, oy: annoOrig.get(a.id).oy + ddy } : a) } : {}) }));
      } else if (node.kind === 'label' && scaleFont) {
        // Texto libre + Shift: la esquina escala la FUENTE (y la caja con ella).
        const f0 = node.fontSize || 20;
        const nf = Math.max(10, Math.min(240, f0 + dx * 0.35));
        const ratio = nf / f0;
        previewChange(j => ({ ...j, nodes: j.nodes.map(n => n.id === node.id ? { ...n, fontSize: nf, w: Math.max(40, Math.round(orig.w * ratio)), h: Math.max(24, Math.round(orig.h * ratio)) } : n) }));
      } else if (node.kind === 'label') {
        // Texto libre: la esquina cambia el ancho (el texto se reparte en
        // líneas) y el alto mínimo; el alto real crece con el contenido.
        previewChange(j => ({ ...j, nodes: j.nodes.map(n => n.id === node.id ? { ...n, w: Math.max(60, Math.round(orig.w + dx)), h: Math.max(24, Math.round(orig.h + dy)) } : n) }));
      } else {
        let nw = Math.max(120, orig.w + dx), nh = Math.max(60, orig.h + dy);
        const gv = [], gh = [];
        if (others.length && !snapGrid) {
          const { xc, yc } = edgeCands();
          const sxr = snapAxis([box0.x + nw], xc), syr = snapAxis([box0.y + nh], yc);
          if (sxr && nw + sxr.delta >= 120) { nw += sxr.delta; gv.push(sxr.at); }
          if (syr && nh + syr.delta >= 60) { nh += syr.delta; gh.push(syr.at); }
        }
        setGuides((gv.length || gh.length) ? { v: gv, h: gh } : null);
        previewChange(j => ({ ...j, nodes: j.nodes.map(n => n.id === node.id ? { ...n, w: nw, h: nh } : n) }));
      }
    };
    const treeEdgeId = canvasEdgeId();
    const onUp = (ev) => {
      setGuides(null);
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      const moved = ev && ev.clientX != null && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4;
      if (mode === 'drag' && single && moved && markedRoot(jsonRef.current, node.id)) {
        // Mapa mental: soltar sobre otro nodo = re-padre; en otro sitio = reordena por altura / mueve la raíz con todo su árbol.
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).map(el => el.closest && el.closest('.canvas-node')).find(el => el && el.dataset.nodeId !== node.id);
        const targetId = under ? under.dataset.nodeId : null;
        const prevUpdater = draftRef.current;
        if (draftRafRef.current) { cancelAnimationFrame(draftRafRef.current); draftRafRef.current = 0; }
        draftRef.current = (j) => {
          const x = prevUpdater ? prevUpdater(j) : j;
          if (targetId && targetId !== node.id) { const r = reparent(x, node.id, targetId, treeEdgeId); if (r) return r; }
          const root = markedRoot(x, node.id);
          return root ? layoutMindmap(x, root) : x;
        };
      }
      commitPreview();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const startGroupDrag = (e, group, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const orig = mode === 'drag'
      ? { x: group.x, y: group.y }
      : { w: group.w || CANVAS_GROUP_DEFAULT_W, h: group.h || CANVAS_GROUP_DEFAULT_H };
    // Group containment: when dragging, carry along every node whose centre
    // sits inside the group's rect at drag start (snapshot so resizing the
    // group mid-drag doesn't change membership).
    const contained = new Map();
    if (mode === 'drag') {
      const gx = group.x || 0, gy = group.y || 0;
      const gw = group.w || CANVAS_GROUP_DEFAULT_W, gh = group.h || CANVAS_GROUP_DEFAULT_H;
      for (const n of (json.nodes || [])) {
        const cx = (n.x || 0) + (n.w || CANVAS_DEFAULT_NODE_W) / 2;
        const cy = (n.y || 0) + (n.h || CANVAS_DEFAULT_NODE_H) / 2;
        if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) contained.set(n.id, { x: n.x || 0, y: n.y || 0 });
      }
    }
    // Y también los dibujos y los marcos que tiene dentro (antes se quedaban atrás).
    const containedA = new Map(), containedG = new Map();
    if (mode === 'drag') {
      const gx = group.x || 0, gy = group.y || 0;
      const gw = group.w || CANVAS_GROUP_DEFAULT_W, gh = group.h || CANVAS_GROUP_DEFAULT_H;
      const isIn = (b) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh; };
      for (const a of (json.annotations || [])) if (a.bbox && !lockedIds.has(a.id) && isIn({ x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h })) containedA.set(a.id, { ox: a.ox || 0, oy: a.oy || 0 });
      for (const g2 of (json.groups || [])) {
        if (g2.id === group.id) continue;
        const r = { x: g2.x || 0, y: g2.y || 0, w: g2.w || CANVAS_GROUP_DEFAULT_W, h: g2.h || CANVAS_GROUP_DEFAULT_H };
        if (r.w * r.h < gw * gh && isIn(r)) containedG.set(g2.id, { x: r.x, y: r.y });
      }
    }
    const origRect = { x: group.x || 0, y: group.y || 0, w: group.w || CANVAS_GROUP_DEFAULT_W, h: group.h || CANVAS_GROUP_DEFAULT_H };
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(); return; } // mouseup lost off-window
      const dx = (ev.clientX - startX) / viewportRef.current.zoom;
      const dy = (ev.clientY - startY) / viewportRef.current.zoom;
      if (mode === 'drag') {
        previewChange(j => ({
          ...j,
          groups: j.groups.map(g => g.id === group.id ? { ...g, x: orig.x + dx, y: orig.y + dy } : containedG.has(g.id) ? { ...g, x: containedG.get(g.id).x + dx, y: containedG.get(g.id).y + dy } : g),
          nodes: (j.nodes || []).map(n => contained.has(n.id) ? { ...n, x: contained.get(n.id).x + dx, y: contained.get(n.id).y + dy } : n),
          ...(containedA.size ? { annotations: (j.annotations || []).map(a => containedA.has(a.id) ? { ...a, ox: containedA.get(a.id).ox + dx, oy: containedA.get(a.id).oy + dy } : a) } : {}),
        }));
      } else {
        // Redimensionar: los hijos con restricciones siguen a sus bordes (marcos sin auto layout); con auto layout,
        // el marco recoloca su contenido al soltar.
        const nw = Math.max(200, orig.w + dx), nh = Math.max(120, orig.h + dy);
        previewChange(j => applyConstraints({ ...j, groups: j.groups.map(g => g.id === group.id ? { ...g, w: nw, h: nh } : g) }, group.id, origRect, { ...origRect, w: nw, h: nh }));
      }
    };
    const onUp = () => { commitPreview(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Destino bajo el puntero: ficha o anotación-forma (ambas son conectables). Las fichas se
  // detectan por DOM; las formas por GEOMETRÍA (una forma sin relleno no recibe el puntero
  // en su interior), con tolerancia de unos píxeles y respetando su rotación. Gana la de encima.
  const dropTargetAt = (cx, cy) => {
    const el = document.elementFromPoint(cx, cy);
    const tn = el && el.closest ? el.closest('.canvas-node') : null;
    if (tn && tn.dataset && tn.dataset.nodeId) return tn.dataset.nodeId;
    const w = screenToWorld(cx, cy), tol = 8 / viewportRef.current.zoom;
    let hit = null;
    for (const [id, r] of annoRects.shapes) {
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, a = -(r.rot || 0) * Math.PI / 180;
      const dx = w.x - c.x, dy = w.y - c.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= r.w / 2 + tol && Math.abs(ly) <= r.h / 2 + tol) hit = id;
    }
    return hit;
  };
  // Ancla (lado) a la que "pega" un punto si está cerca de una de las 4; si no, borde automático.
  const anchorNear = (id, w) => {
    const r = rectOf(id);
    if (!r) return { rect: null, side: undefined };
    const side = nearestSide(r, w), ap = anchorPoint(r, side);
    return { rect: r, side: Math.hypot(ap.x - w.x, ap.y - w.y) < 30 / viewportRef.current.zoom ? side : undefined };
  };
  const hoverAnchors = (cx, cy, exceptId) => {
    const id = dropTargetAt(cx, cy);
    if (!id || id === exceptId) { setAnchorHover(null); return; }
    const w = screenToWorld(cx, cy), an = anchorNear(id, w);
    setAnchorHover(an.rect ? { rect: an.rect, near: an.side } : null);
  };
  // Conectar arrastrando desde un origen (ficha o forma): `src` = { id, x, y, w, h, rot? }.
  const startEdgeDraw = (e, src, opts = {}) => {
    e.preventDefault();
    focusCanvas();
    const w = screenToWorld(e.clientX, e.clientY);
    const sx0 = e.clientX, sy0 = e.clientY;
    let moved = 0;
    edgeDrawRef.current = { fromId: src.id, ts: Date.now() };
    setEdgeDraw({ fromId: src.id, mouseWorld: w, fromCenter: nodeCenter(src), fromSide: opts.fromSide });
    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(ev); return; } // mouseup lost off-window
      moved = Math.max(moved, Math.hypot(ev.clientX - sx0, ev.clientY - sy0));
      setEdgeDraw(prev => prev ? { ...prev, mouseWorld: screenToWorld(ev.clientX, ev.clientY) } : null);
      hoverAnchors(ev.clientX, ev.clientY, src.id);
    };
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setAnchorHover(null);
      const to = dropTargetAt(ev.clientX, ev.clientY);
      if (to && to !== src.id) {
        const an = anchorNear(to, screenToWorld(ev.clientX, ev.clientY));
        addEdge(src.id, to, { ...(opts.fromSide ? { fromSide: opts.fromSide } : {}), ...(an.side ? { toSide: an.side } : {}) });
      } else if (!to) {
        const rootBox = rootRef.current ? rootRef.current.getBoundingClientRect() : { left: 0, top: 0 };
        const side = opts.fromSide || sideToward(src, screenToWorld(ev.clientX, ev.clientY));
        if (moved < 5) { if (opts.fromSide) createConnected('sticky', src, side, null); }   // clic en una asa: siguiente elemento ya conectado
        else setEdgePicker({ srcId: src.id, side, world: screenToWorld(ev.clientX, ev.clientY), left: ev.clientX - rootBox.left, top: ev.clientY - rootBox.top });
      }
      edgeDrawRef.current = null;
      setEdgeDraw(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // Crea el siguiente elemento ya conectado al origen. Con `world` = punto de suelta (centro del
  // nuevo); sin él, adyacente al origen por el lado `side`. Tipos: sticky | shape | label | note.
  const OPP = { t: 'b', b: 't', l: 'r', r: 'l' };
  const createConnected = (kind, src, side, world, extra = {}) => {
    const dims = { sticky: [CANVAS_STICKY_SIZE, CANVAS_STICKY_SIZE], shape: [160, 120], label: [240, 40], note: [CANVAS_DEFAULT_NODE_W, CANVAS_DEFAULT_NODE_H] }[kind] || [CANVAS_STICKY_SIZE, CANVAS_STICKY_SIZE];
    const [w, h] = dims, GAP = 70;
    let x, y;
    if (world) { x = world.x - w / 2; y = world.y - h / 2; }
    else if (side === 'r') { x = src.x + src.w + GAP; y = src.y + src.h / 2 - h / 2; }
    else if (side === 'l') { x = src.x - GAP - w; y = src.y + src.h / 2 - h / 2; }
    else if (side === 'b') { x = src.x + src.w / 2 - w / 2; y = src.y + src.h + GAP; }
    else { x = src.x + src.w / 2 - w / 2; y = src.y - GAP - h; }
    const id = canvasNodeId();
    const srcNode = nodeById.get(src.id);
    let node;
    if (kind === 'shape') node = { id, kind: 'shape', shape: (srcNode && srcNode.kind === 'shape' && srcNode.shape) || 'rect', text: '', ...(srcNode && srcNode.kind === 'shape' && srcNode.color ? { color: srcNode.color } : {}), x, y, w, h };
    else if (kind === 'label') node = { id, kind: 'label', text: '', x, y, w, h, fontSize: 22 };
    else if (kind === 'note') node = { id, kind: 'note', x, y, w, h, ...extra };
    else node = { id, kind: 'text', sticky: true, text: '', color: (srcNode && srcNode.sticky && srcNode.color) || CANVAS_STICKY_COLORS[0], x, y, w, h };
    const newRect = { x, y, w, h };
    const toSide = world ? sideToward(newRect, { x: src.x + src.w / 2, y: src.y + src.h / 2 }) : OPP[side];
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node], edges: [...(j.edges || []), { id: canvasEdgeId(), from: src.id, to: id, kind: 'manual', fromSide: side, toSide }] }));
    setSelected(new Set([id])); setSelAnno(new Set());
    if (kind === 'sticky' || kind === 'label' || kind === 'shape') setAutoEditId(id);
    return id;
  };
  const pickConnected = (kind) => {
    const pk = edgePicker; setEdgePicker(null);
    if (!pk) return;
    const src = rectOf(pk.srcId);
    if (!src) return;
    if (kind === 'note') { pendingConnectRef.current = { src: { id: pk.srcId, ...src }, side: pk.side, world: pk.world }; setNotePickerOpen(true); return; }
    createConnected(kind, { id: pk.srcId, ...src }, pk.side, pk.world);
  };
  const finishEdgeDraw = (e, node) => {
    e.preventDefault();
    const from = edgeDrawRef.current && edgeDrawRef.current.fromId;
    addEdge(from, node.id);
  };
  // Mover un extremo de una arista seleccionada: soltar sobre una ficha/forma lo ancla (al lado
  // más cercano si está a menos de ~30 px de un ancla), soltar en vacío lo deja libre.
  const startEdgeEndDrag = (ev, edge, end) => {
    ev.preventDefault(); ev.stopPropagation(); focusCanvas();
    const key = edgeKeyOf(edge), id0 = edge.id || canvasEdgeId();
    const other = end === 'from' ? edge.to : edge.from;
    const match = (x) => x.id === id0 || edgeKeyOf(x) === key;
    const freePatch = (w) => end === 'from' ? { from: '', fromSide: undefined, fromX: w.x, fromY: w.y } : { to: '', toSide: undefined, toX: w.x, toY: w.y };
    const onMove = (e2) => {
      if (e2.buttons === 0) { onUp(e2); return; }
      const w = screenToWorld(e2.clientX, e2.clientY);
      previewChange(j => ({ ...j, edges: (j.edges || []).map(x => match(x) ? applyPatch({ ...x, id: id0 }, freePatch(w)) : x) }));
      hoverAnchors(e2.clientX, e2.clientY, other);
    };
    const onUp = (e2) => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      setAnchorHover(null);
      const w = screenToWorld(e2.clientX, e2.clientY), target = dropTargetAt(e2.clientX, e2.clientY);
      let patch;
      if (target && target !== other) {
        const an = anchorNear(target, w);
        patch = end === 'from' ? { from: target, fromSide: an.side, fromX: undefined, fromY: undefined } : { to: target, toSide: an.side, toX: undefined, toY: undefined };
      } else patch = freePatch(w);
      previewChange(j => ({ ...j, edges: (j.edges || []).map(x => match(x) ? applyPatch({ ...x, id: id0 }, patch) : x) }));
      commitPreview();
      setSelectedEdge(id0);
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };
  // Arrastrar la etiqueta a lo largo del trazo (guarda labelT, 0..1).
  const startEdgeLabelDrag = (ev, edge, flatPts) => {
    ev.preventDefault(); ev.stopPropagation(); focusCanvas();
    const key = edgeKeyOf(edge), id0 = edge.id || canvasEdgeId();
    let moved = false;
    const match = (x) => x.id === id0 || edgeKeyOf(x) === key;
    const onMove = (e2) => {
      if (e2.buttons === 0) { onUp(); return; }
      moved = true;
      const labelT = Math.round(closestT(flatPts, screenToWorld(e2.clientX, e2.clientY)) * 1000) / 1000;
      previewChange(j => ({ ...j, edges: (j.edges || []).map(x => match(x) ? { ...x, id: id0, labelT } : x) }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      if (moved) { commitPreview(); setSelectedEdge(id0); }
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };
  const nodeCenter = (n) => ({ x: (n.x || 0) + (n.w || CANVAS_DEFAULT_NODE_W) / 2, y: (n.y || 0) + (n.h || CANVAS_DEFAULT_NODE_H) / 2 });

  // Duplicate the selection (offset copies + internal edges; selects the copies).
  const duplicateSelected = () => {
    if (!selected.size) return;
    onChange(j => {
      const idMap = new Map();
      const dups = [];
      const rg = grpRemapper();
      for (const n of (j.nodes || [])) {
        if (!selected.has(n.id)) continue;
        const nid = canvasNodeId();
        idMap.set(n.id, nid);
        dups.push({ ...rg(n), id: nid, x: (n.x || 0) + 24, y: (n.y || 0) + 24 });
      }
      if (!dups.length) return j;
      const dupEdges = (j.edges || [])
        .filter(ed => idMap.has(ed.from) && idMap.has(ed.to))
        .map(ed => ({ ...ed, id: canvasEdgeId(), from: idMap.get(ed.from), to: idMap.get(ed.to) }));
      setTimeout(() => setSelected(new Set(idMap.values())), 0);
      return { ...j, nodes: [...(j.nodes || []), ...dups], edges: [...(j.edges || []), ...dupEdges] };
    });
  };
  // Z-order: render order == stacking, so move selected to the end (front) or
  // start (back) of the nodes array.
  const reorderSelected = (toFront) => {
    if (!selected.size && !selAnno.size) return;
    onChange(j => {
      let nodes = j.nodes || [];
      if (selected.size) {
        const sel = nodes.filter(n => selected.has(n.id));
        const rest = nodes.filter(n => !selected.has(n.id));
        nodes = (toFront ? [...rest, ...sel] : [...sel, ...rest]).map(n => (selected.has(n.id) && n.z != null) ? (({ z, ...r }) => r)(n) : n);
      }
      let annotations = j.annotations || [];
      if (selAnno.size) {
        // Front = paint above nodes; Back = under them. Also restack within the
        // annotation array so order among drawings is meaningful.
        const sel = annotations.filter(a => selAnno.has(a.id)).map(a => { const { z, ...r } = a; return { ...r, layer: toFront ? 'front' : 'back' }; });
        const rest = annotations.filter(a => !selAnno.has(a.id));
        annotations = toFront ? [...rest, ...sel] : [...sel, ...rest];
      }
      return { ...j, nodes, annotations };
    });
  };
  // Un puesto adelante/atrás en el orden combinado de fichas y dibujos (permite meter un dibujo ENTRE fichas).
  const stepSelected = (dir) => {
    if (!selected.size && !selAnno.size) return;
    onChange(j => stepZ(j, new Set(selected), new Set(selAnno), dir));
  };
  // Alinear / repartir / ordenar: fichas, dibujos y grupos a la vez (un grupo se mueve entero).
  const selUnits = (j) => selectionUnits(j, new Set(selected), new Set(selAnno));
  const alignSelected = (how) => {
    if (selected.size + selAnno.size < 2) return;
    onChange(j => alignUnits(j, selUnits(j), how));
  };
  const tidySelected = () => onChange(j => tidyUp(j, selUnits(j)));
  const spaceSelected = () => {
    const u = selUnits(jsonRef.current || {});
    if (u.length < 2) return;
    const axis = mainAxis(u);
    const v = window.prompt(t('canvas.sel.spacing.ask'), String(currentGap(u, axis)));
    if (v == null || !Number.isFinite(Number(v))) return;
    onChange(j => spaceUnits(j, selUnits(j), axis, Number(v)));
  };
  const selectSameAs = (prop) => {
    const j = jsonRef.current || {};
    const ref = selected.size ? (j.nodes || []).find(n => selected.has(n.id)) : (j.annotations || []).find(a => selAnno.has(a.id));
    if (!ref) return;
    const r = selectSame(j, ref, prop);
    setSelected(r.nodes); setSelAnno(r.annos);
  };
  // Bloquear / desbloquear la selección (fichas y anotaciones): lo bloqueado se selecciona pero no se
  // mueve, redimensiona, rota ni borra.
  const toggleLockSelected = () => {
    if (!selected.size && !selAnno.size) return;
    onChange(j => {
      const items = [...(j.nodes || []).filter(n => selected.has(n.id)), ...(j.annotations || []).filter(a => selAnno.has(a.id))];
      const lock = items.some(x => !x.locked);
      const set = (x) => lock ? { ...x, locked: true } : (({ locked, ...r }) => r)(x);
      return { ...j, nodes: (j.nodes || []).map(n => selected.has(n.id) ? set(n) : n), annotations: (j.annotations || []).map(a => selAnno.has(a.id) ? set(a) : a) };
    });
  };
  // Grupo lógico (Ctrl+G / Ctrl+Shift+G): los miembros comparten `grp`; seleccionar uno selecciona
  // todos y se mueven juntos. No es un marco visual (eso son los «grupos» del contenedor).
  const groupSelected = (ungroup) => {
    if (ungroup) {
      onChange(j => {
        const strip = (x) => { if (!x.grp) return x; const { grp, ...r } = x; return r; };
        const gs = new Set([...(j.nodes || []).filter(n => selected.has(n.id)).map(n => n.grp), ...(j.annotations || []).filter(a => selAnno.has(a.id)).map(a => a.grp)].filter(Boolean));
        return { ...j, nodes: (j.nodes || []).map(n => gs.has(n.grp) ? strip(n) : n), annotations: (j.annotations || []).map(a => gs.has(a.grp) ? strip(a) : a) };
      });
      return;
    }
    if (selected.size + selAnno.size < 2) return;
    const g = 'lg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    onChange(j => ({ ...j, nodes: (j.nodes || []).map(n => selected.has(n.id) ? { ...n, grp: g } : n), annotations: (j.annotations || []).map(a => selAnno.has(a.id) ? { ...a, grp: g } : a) }));
  };
  const expandGroups = (nodeIds, annoIds) => {
    const gs = new Set();
    for (const n of jsonRef.current.nodes || []) if (n.grp && nodeIds.has(n.id)) gs.add(n.grp);
    for (const a of jsonRef.current.annotations || []) if (a.grp && annoIds.has(a.id)) gs.add(a.grp);
    if (!gs.size) return { nodes: nodeIds, annos: annoIds };
    const N = new Set(nodeIds), A = new Set(annoIds);
    for (const n of jsonRef.current.nodes || []) if (gs.has(n.grp)) N.add(n.id);
    for (const a of jsonRef.current.annotations || []) if (gs.has(a.grp)) A.add(a.id);
    return { nodes: N, annos: A };
  };
  // Distribuye dejando HUECOS IGUALES entre elementos (cuenta los anchos/altos reales, no sólo la
  // posición de la esquina). Los extremos no se mueven; un elemento bloqueado ocupa su sitio pero no se mueve.
  const distributeSelected = (axis) => {
    if (selected.size + selAnno.size < 3) return;
    onChange(j => spaceUnits(j, selUnits(j), axis));
  };

  // Generic patch over the selected annotations. `null`/`undefined` values
  // delete the key so the structured reconciler drops it cleanly.
  const patchSelectedAnnotations = (patch) => {
    if (!selAnno.size) return;
    onChange(j => ({
      ...j,
      annotations: (j.annotations || []).map(a => {
        if (!selAnno.has(a.id)) return a;
        const next = { ...a };
        for (const [k, v] of Object.entries(patch)) {
          if (v == null) delete next[k]; else next[k] = v;
        }
        // Grosor de un trazo con puntos crudos: regenerar su contorno.
        if (a.kind === 'path' && Array.isArray(a.pts) && a.pts.length > 1 && patch.strokeWidth != null) {
          if (a.variant === 'pen') { next.size = patch.strokeWidth; delete next.strokeWidth; next.d = strokeD(next); }
          else { next.size = patch.strokeWidth / 4; }
        }
        return next;
      }),
    }));
  };
  // Fill only makes sense on closed shapes; leave paths (pen ink IS its fill)
  // and lines/arrows untouched.
  const fillSelectedAnnotations = (color) => {
    if (!selAnno.size) return;
    onChange(j => ({
      ...j,
      annotations: (j.annotations || []).map(a => {
        if (!selAnno.has(a.id) || a.kind !== 'shape' || !CANVAS_CLOSED_SHAPE_SET.has(a.shape)) return a;
        const { fillVar: _f, gradient: _g, ...next } = a;   // relleno a mano: sin variable ni degradado
        if (color) next.fill = color; else next.fill = 'none';
        return next;
      }),
    }));
  };
  // Generic node patch — null values delete the key (clean fence + CRDT).
  const patchNode = (id, patch) => {
    onChange(j => ({
      ...j,
      nodes: (j.nodes || []).map(n => {
        if (n.id !== id) return n;
        const next = { ...n };
        for (const [k, v] of Object.entries(patch)) {
          if (v == null) delete next[k]; else next[k] = v;
        }
        return next;
      }),
    }));
  };
  // Emoji reactions/voting: node.reactions = { '👍': [email, …] }. Toggling
  // adds/removes the current user; empty lists drop the key.
  const myIdentity = (syncConfig && syncConfig.email) || 'me';
  const toggleReaction = (nodeId, emoji) => {
    onChange(j => ({
      ...j,
      nodes: (j.nodes || []).map(n => {
        if (n.id !== nodeId) return n;
        const r = { ...(n.reactions || {}) };
        const set = new Set(r[emoji] || []);
        if (set.has(myIdentity)) set.delete(myIdentity); else set.add(myIdentity);
        if (set.size) r[emoji] = Array.from(set); else delete r[emoji];
        const next = { ...n };
        if (Object.keys(r).length) next.reactions = r; else delete next.reactions;
        return next;
      }),
    }));
  };
  const reactSelected = (emoji) => {
    for (const id of selected) toggleReaction(id, emoji);
  };

  // ── Sesión compartida: temporizador y votación (json.session, mapa meta) ─
  // timer: { endsAt (ms), durationMs, pausedLeft? } — todos cuentan hacia la
  // misma hora de fin, así no hace falta emitir cada segundo.
  // vote: { open, perUser, startedAt } — los votos van en node.votes = [quién…]
  // (uno por ficha y persona); mientras está abierta cada uno ve solo los suyos.
  const session = json.session || null;
  const setSession = (fn) => onChange(j => {
    const cur = j.session || {};
    const next = fn(cur);
    const clean = {};
    for (const k of Object.keys(next || {})) if (next[k] != null) clean[k] = next[k];
    return { ...j, session: Object.keys(clean).length ? clean : null };
  });
  const startTimer = (min) => setSession(s => ({ ...s, timer: { endsAt: Date.now() + min * 60000, durationMs: min * 60000 } }));
  const stopTimer = () => setSession(s => ({ ...s, timer: null }));
  const pauseTimer = () => setSession(s => {
    const tm = s.timer; if (!tm) return s;
    if (tm.pausedLeft != null) return { ...s, timer: { ...tm, endsAt: Date.now() + tm.pausedLeft, pausedLeft: null } };
    return { ...s, timer: { ...tm, pausedLeft: Math.max(0, tm.endsAt - Date.now()) } };
  });
  const addMinute = () => setSession(s => {
    const tm = s.timer; if (!tm) return s;
    return { ...s, timer: tm.pausedLeft != null ? { ...tm, pausedLeft: tm.pausedLeft + 60000 } : { ...tm, endsAt: Math.max(Date.now(), tm.endsAt) + 60000 } };
  });
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!session || !session.timer || session.timer.pausedLeft != null) return undefined;
    const id = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(id);
  }, [session && session.timer && session.timer.endsAt, session && session.timer && session.timer.pausedLeft]);
  const startVote = (perUser) => onChange(j => ({
    ...j,
    nodes: (j.nodes || []).map(n => { if (!n.votes) return n; const c = { ...n }; delete c.votes; return c; }),
    session: { ...(j.session || {}), vote: { open: true, perUser, startedAt: Date.now() } },
  }));
  const endVote = () => setSession(s => ({ ...s, vote: s.vote ? { ...s.vote, open: false } : null }));
  const closeVote = () => onChange(j => ({
    ...j,
    nodes: (j.nodes || []).map(n => { if (!n.votes) return n; const c = { ...n }; delete c.votes; return c; }),
    session: (() => { const s = { ...(j.session || {}) }; delete s.vote; return Object.keys(s).length ? s : null; })(),
  }));
  const myVotes = useMemo(() => (json.nodes || []).filter(n => (n.votes || []).includes(myIdentity)).length, [json.nodes, myIdentity]);
  const toggleVote = (nodeId) => {
    const v = session && session.vote;
    if (!v || !v.open) return;
    onChange(j => ({
      ...j,
      nodes: (j.nodes || []).map(n => {
        if (n.id !== nodeId) return n;
        const set = new Set(n.votes || []);
        if (set.has(myIdentity)) set.delete(myIdentity);
        else {
          const used = (j.nodes || []).filter(x => (x.votes || []).includes(myIdentity)).length;
          if (used >= (v.perUser || 3)) return n;
          set.add(myIdentity);
        }
        const c = { ...n };
        if (set.size) c.votes = Array.from(set); else delete c.votes;
        return c;
      }),
    }));
  };

  // ── Comments anchored to canvas nodes ────────────────────────────────
  // Reuses the note-comment store (shared/comments-model.js) adding an
  // additive `anchorNodeId`, so threads show up in the note's comment panel too.
  const yv = useCommentsVersion();
  const nodeComments = useMemo(() => {
    if (!activeNoteId) return new Map();
    const list = readNoteComments(ydoc, activeNoteId);
    const byNode = new Map();
    for (const c of list) {
      if (!c || !c.anchorNodeId || c.resolved) continue;
      if (!byNode.has(c.anchorNodeId)) byNode.set(c.anchorNodeId, []);
      byNode.get(c.anchorNodeId).push(c);
    }
    for (const arr of byNode.values()) arr.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
    return byNode;
  }, [yv, activeNoteId]);
  const [nodeCommentFor, setNodeCommentFor] = useState(null); // nodeId | null
  const addNodeComment = (nodeId, text) => {
    const v = String(text || '').trim();
    if (!v || !activeNoteId) return;
    const list = readNoteComments(ydoc, activeNoteId);
    const roots = list.filter(c => c && c.anchorNodeId === nodeId && !c.parentId && !c.resolved);
    const rec = {
      id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      noteId: activeNoteId,
      kind: 'note',
      parentId: roots.length ? roots[roots.length - 1].id : null,
      author: myIdentity,
      ts: new Date().toISOString(),
      text: v,
      anchorText: null,
      anchorNodeId: nodeId,
      resolved: false,
      replies: [],
      awaitingReply: false,
      mentions: (v.match(/@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(s => s.slice(1).toLowerCase()),
    };
    putComment(ydoc, rec);
  };
  const resolveNodeComments = (nodeId) => {
    if (!activeNoteId) return;
    patchComments(ydoc, activeNoteId, c => c && c.anchorNodeId === nodeId && !c.resolved,
      { resolved: true, resolvedAt: new Date().toISOString() });
    setNodeCommentFor(null);
  };

  // Tint the selected nodes. Falsy color clears the tint (drops the key so the
  // structured reconciler removes it cleanly).
  const colorSelected = (color) => {
    if (!selected.size && !selAnno.size) return;
    onChange(j => ({
      ...j,
      nodes: (j.nodes || []).map(n => {
        if (!selected.has(n.id)) return n;
        const { color: _drop, fillVar: _f, colorVar: _c, ...rest } = n;   // un color a mano rompe el enlace con la variable
        return color ? { ...rest, color } : rest;
      }),
      annotations: (j.annotations || []).map(a => {
        if (!selAnno.has(a.id) || !color) return a;
        const { colorVar: _c, ...a1 } = a;
        const next = { ...a1, color };
        if (a.variant === 'pen') next.fill = color;
        return next;
      }),
    }));
  };

  // Buscar en el canvas (Ctrl+F): coincidencias en fichas, formas y marcos.
  const [find, setFind] = useState(null); // { q, i }
  // (1.2) También dentro del bloque de página: una coincidencia por aparición.
  const findHits = useMemo(() => (find && find.q ? searchCanvas(json, find.q, canvasNodeRect, pageSource || null) : []), [find && find.q, json, pageSource]);
  const findInputRef = useRef(null);
  // La coincidencia actual dentro de la página: seleccionada en su editor y
  // desplazada a la vista; las que se ven, resaltadas.
  const showPageHit = (h) => {
    const body = rootRef.current && rootRef.current.querySelector('.canvas-node-page .canvas-page-body');
    const cm = body && body.querySelector('.cm-editor');
    const view = cm && EditorView.findFromDOM(cm);
    if (view && h && h.at && h.at[1] <= view.state.doc.length) {
      view.dispatch({ selection: { anchor: h.at[0], head: h.at[1] }, effects: EditorView.scrollIntoView(h.at[0], { y: 'center' }), userEvent: 'select.search' });
    }
    requestAnimationFrame(() => paintPageHits());
  };
  const paintPageHits = () => {
    const body = rootRef.current && rootRef.current.querySelector('.canvas-node-page .canvas-page-body');
    if (!body || !find || !find.q) { clearPaint('edinot-cfind'); return; }
    const ranges = findRanges(body, find.q);
    // La actual (si es de la página): la que empieza en su posición del texto.
    let current = -1;
    const h = findHits[find.i || 0];
    const cm = body.querySelector('.cm-editor');
    const view = h && h.kind === 'page' && h.at && cm ? EditorView.findFromDOM(cm) : null;
    if (view) current = ranges.findIndex(r => { try { return view.posAtDOM(r.startContainer, r.startOffset) === h.at[0]; } catch { return false; } });
    paintRanges(ranges, current, 'edinot-cfind');
  };
  useEffect(() => {
    if (!find || !find.q) { clearPaint('edinot-cfind'); return undefined; }
    const id = requestAnimationFrame(paintPageHits);
    return () => cancelAnimationFrame(id);
  }, [find && find.q, find && find.i, json]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearPaint('edinot-cfind'), []);
  const goFind = (i) => {
    if (!findHits.length) return;
    const k = ((i % findHits.length) + findHits.length) % findHits.length;
    setFind(f => ({ ...(f || {}), i: k }));
    const h = findHits[k];
    centerOnNode({ x: h.rect.x, y: h.rect.y, w: h.rect.w, h: h.rect.h });
    if (h.kind === 'page') showPageHit(h);
  };
  // Ctrl/⌘ F desde fuera del lienzo (la barra superior, el bloque de página):
  // sólo el canvas principal de la nota, no los tableros incrustados.
  useEffect(() => {
    if (!renderPage) return undefined;
    const open = () => {
      setFind(f => f || { q: '', i: 0 });
      requestAnimationFrame(() => { const el = findInputRef.current; if (el) { el.focus(); el.select(); } });
    };
    window.addEventListener('edinot:canvas-find', open);
    return () => window.removeEventListener('edinot:canvas-find', open);
  }, [renderPage]);
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && vecEdit) { e.preventDefault(); setVecEdit(null); return; }
    if ((e.key === 'Enter' || e.key === 'Escape') && penRef.current) { e.preventDefault(); if (penRef.current.hover) window.removeEventListener('pointermove', penRef.current.hover); penFinish(false); return; }
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F') && !typing) {
      e.preventDefault();
      setFind(f => f || { q: '', i: 0 });
      requestAnimationFrame(() => { const el = findInputRef.current; if (el) { el.focus(); el.select(); } });
      return;
    }
    if (e.code === 'Space' && !typing && !(ae && ae.tagName === 'BUTTON') && !e.metaKey && !e.ctrlKey) {   // Espacio mantenido = mover el lienzo
      e.preventDefault();
      if (!spaceRef.current) { spaceRef.current = true; setSpaceHeld(true); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G') && !typing) { e.preventDefault(); groupSelected(e.shiftKey); return; }
    if (e.altKey && (e.key === 'l' || e.key === 'L' || e.code === 'KeyL') && !typing) { e.preventDefault(); toggleLockSelected(); return; }
    if (selectedEdge && !typing && !selected.size && !selAnno.size) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onChange(j => ({ ...j, edges: (j.edges || []).filter(ed => edgeKeyOf(ed) !== selectedEdge) }));
        setSelectedEdge(null);
        return;
      }
      if (e.key === 'Escape') { setSelectedEdge(null); return; }
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {   // C cicla el modo del conector
        e.preventDefault();
        const cur = (json.edges || []).find(ed => edgeKeyOf(ed) === selectedEdge);
        if (cur) commitEdgePatch(selectedEdge, { route: EDGE_ROUTES[(EDGE_ROUTES.indexOf(cur.route || 'curved') + 1) % EDGE_ROUTES.length] });
        return;
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!selected.size && !selAnno.size) return;
      e.preventDefault();
      const delN = new Set([...selected].filter(id => !lockedIds.has(id))), delA = new Set([...selAnno].filter(id => !lockedIds.has(id)));
      if (!delN.size && !delA.size) return;                       // todo bloqueado: no se borra nada
      onChange(j => ({
        ...j,
        nodes: (j.nodes || []).filter(n => !delN.has(n.id)),
        edges: (j.edges || []).filter(ed => !delN.has(ed.from) && !delN.has(ed.to) && !delA.has(ed.from) && !delA.has(ed.to)),
        annotations: (j.annotations || []).filter(a => !delA.has(a.id)),
      }));
      setSelected(new Set([...selected].filter(id => lockedIds.has(id))));
      setSelAnno(new Set([...selAnno].filter(id => lockedIds.has(id))));
      setSelectedEdge(null);
      return;
    }
    if (!typing && selected.size === 1 && !selAnno.size && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const sid = [...selected][0];
      if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) { const pp = mmIndex.parentOf.get(sid); if (pp) setSelected(new Set([pp])); } else createMapChild(sid); return; }
      if (e.key === 'Enter' && mmIndex.parentOf.has(sid)) { e.preventDefault(); createMapChild(mmIndex.parentOf.get(sid), nodeById.get(sid)); return; }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSelected(); return; }
    if (mod && e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); stepSelected(e.code === 'BracketRight' ? 1 : -1); return; }
    if (mod && e.key === ']') { e.preventDefault(); reorderSelected(true); return; }
    if (mod && e.key === '[') { e.preventDefault(); reorderSelected(false); return; }
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      setSelected(new Set((json.nodes || []).map(n => n.id)));
      setSelAnno(new Set((json.annotations || []).map(a => a.id)));
      return;
    }
    // Internal copy / cut: the selection travels through the OS clipboard as
    // tagged JSON, so it can be pasted into this or any other canvas.
    if (mod && !typing && (e.key === 'c' || e.key === 'C' || e.key === 'x' || e.key === 'X') && (selected.size || selAnno.size)) {
      e.preventDefault();
      const payload = {
        __edinotCanvas: 1,
        nodes: (json.nodes || []).filter(n => selected.has(n.id)),
        edges: (json.edges || []).filter(ed => selected.has(ed.from) && selected.has(ed.to)),
        annotations: (json.annotations || []).filter(a => selAnno.has(a.id)),
      };
      try { navigator.clipboard.writeText(JSON.stringify(payload)); } catch {}
      if (e.key === 'x' || e.key === 'X') {
        onChange(j => ({
          ...j,
          nodes: (j.nodes || []).filter(n => !selected.has(n.id)),
          edges: (j.edges || []).filter(ed => !selected.has(ed.from) && !selected.has(ed.to) && !selAnno.has(ed.from) && !selAnno.has(ed.to)),
          annotations: (j.annotations || []).filter(a => !selAnno.has(a.id)),
        }));
        setSelected(new Set());
        setSelAnno(new Set());
      }
      return;
    }
    // Arrow-key nudge: 1px, Shift = 16px. Applies to nodes and annotations.
    if (!mod && !typing && (selected.size || selAnno.size)
        && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const step = e.shiftKey ? 16 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      onChange(j => ({
        ...j,
        nodes: (j.nodes || []).map(n => selected.has(n.id) && !n.locked ? { ...n, x: (n.x || 0) + dx, y: (n.y || 0) + dy } : n),
        annotations: (j.annotations || []).map(a => selAnno.has(a.id) && !a.locked ? { ...a, ox: (a.ox || 0) + dx, oy: (a.oy || 0) + dy } : a),
      }));
      return;
    }
    if (mod && e.key === '0') { e.preventDefault(); resetZoom(); return; }
    // Single-key tool shortcuts (Figma/Excalidraw-style).
    if (!mod && !e.altKey && !typing) {
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitToContent(); return; }
      if (e.shiftKey && e.code === 'Digit2') { e.preventDefault(); zoomToSelection(); return; }
      if (e.key === 'n' || e.key === 's') {
        e.preventDefault();
        const pos = canvasCenter(CANVAS_STICKY_SIZE, CANVAS_STICKY_SIZE);
        createStickyAt(pos.x, pos.y);
        return;
      }
      if (e.key === 'f') { e.preventDefault(); addFrameQuick(); return; }
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(o => !o); return; }
      const map = { v: 'select', 1: 'select', p: 'pen', b: 'pen', h: 'highlighter', e: 'eraser', t: 'text', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', k: 'laser', g: 'fill', i: 'picker', u: 'vpen' };
      const next = map[e.key.toLowerCase()];
      if (next) { e.preventDefault(); setTool(next); return; }
      if (e.key === 'Escape' && tool !== 'select') { e.preventDefault(); setTool('select'); return; }
    }
  };

  // Toolbar actions
  const canvasCenter = (w = 220, h = 120) => {
    const center = screenToWorld(
      (containerRef.current ? containerRef.current.clientWidth / 2 : 200),
      (containerRef.current ? containerRef.current.clientHeight / 2 : 200),
    );
    return { x: center.x - w / 2, y: center.y - h / 2 };
  };
  const normalizeCanvasUrl = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\/$/i.test(s)) return '';
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  };
  const titleFromUrl = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, '') || url; }
    catch { return url; }
  };
  // Label = floating text without a container. Useful for headings / section
  // titles drawn above clusters of nodes. Rendered transparent + bigger font.
  const addLabelNode = async () => {
    const text = await askPrompt(t('canvas.labelPrompt'), '');
    if (text == null || !text.trim()) return;
    const pos = canvasCenter(280, 36);
    const node = { id: canvasNodeId(), kind: 'label', text: text.trim(), x: pos.x, y: pos.y, w: 280, h: 44 };
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
  };
  const addTextNode = async () => {
    const text = await askPrompt(t('canvas.textPrompt'), '');
    if (text == null) return;
    const pos = canvasCenter(220, 120);
    const node = { id: canvasNodeId(), kind: 'text', text, x: pos.x, y: pos.y, w: 220, h: 120 };
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
  };
  const addPickedNoteNode = (f) => {
    if (!f) return;
    const pc = pendingConnectRef.current;
    if (pc) {   // viene de soltar un conector en vacío → ficha de nota ya conectada
      pendingConnectRef.current = null;
      createConnected('note', pc.src, pc.side, pc.world, { noteId: f.id, noteName: f.name.replace(/\.(md|markdown|txt)$/i, '') });
      return;
    }
    const pos = canvasCenter(CANVAS_DEFAULT_NODE_W, CANVAS_DEFAULT_NODE_H);
    const node = { id: canvasNodeId(), kind: 'note', noteId: f.id, noteName: f.name.replace(/\.(md|markdown|txt)$/i, ''), x: pos.x, y: pos.y, w: CANVAS_DEFAULT_NODE_W, h: CANVAS_DEFAULT_NODE_H };
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
  };
  const addNoteNode = () => setNotePickerOpen(true);
  const addUrlNode = async () => {
    const url = normalizeCanvasUrl(await askPrompt(t('canvas.urlPrompt'), 'https://'));
    if (!url) return;
    insertUrlAsNode(url);
  };
  // After dropping a URL tile, enrich it with OpenGraph metadata fetched by
  // the Electron main process (no CORS). The node appears instantly; the
  // card fills in when (if) the unfurl resolves. Web build: hostname only.
  const unfurlUrlNode = (id, url) => {
    if (!window.electronAPI || !window.electronAPI.urlUnfurl) return;
    window.electronAPI.urlUnfurl(url).then((res) => {
      if (!res || !res.ok) return;
      onChange(j => ({
        ...j,
        nodes: (j.nodes || []).map(n => {
          if (n.id !== id) return n;
          const next = { ...n };
          if (res.title) next.title = res.title;
          if (res.desc) next.desc = res.desc;
          if (res.imageUrl) next.imageUrl = res.imageUrl;
          if (res.favicon) next.favicon = res.favicon;
          if (res.siteName) next.siteName = res.siteName;
          // Untouched default-size tile grows to fit the image header.
          if (res.imageUrl && (n.h || 0) <= 120) next.h = 230;
          return next;
        }),
      }));
    }).catch(() => {});
  };
  // Drop a URL onto the canvas → YouTube/Vimeo embed, native <video> for
  // direct media files, otherwise a link card (unfurled async). Reused by
  // paste / drop handlers so behaviour is uniform across input methods.
  const insertUrlAsNode = (url) => {
    const ytId = youtubeId(url);
    if (ytId) {
      const pos = canvasCenter(360, 220);
      const node = { id: canvasNodeId(), kind: 'video', provider: 'youtube', videoId: ytId, url, title: 'YouTube', x: pos.x, y: pos.y, w: 360, h: 220 };
      onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
      return;
    }
    const vmId = vimeoId(url);
    if (vmId) {
      const pos = canvasCenter(360, 220);
      const node = { id: canvasNodeId(), kind: 'video', provider: 'vimeo', videoId: vmId, url, title: 'Vimeo', x: pos.x, y: pos.y, w: 360, h: 220 };
      onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
      return;
    }
    if (isDirectVideoUrl(url)) {
      const pos = canvasCenter(360, 220);
      const node = { id: canvasNodeId(), kind: 'video', provider: 'file', url, title: titleFromUrl(url), x: pos.x, y: pos.y, w: 360, h: 220 };
      onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
      return;
    }
    const pos = canvasCenter(260, 110);
    const id = canvasNodeId();
    const node = { id, kind: 'url', url, title: titleFromUrl(url), x: pos.x, y: pos.y, w: 260, h: 110 };
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
    unfurlUrlNode(id, url);
  };
  const addImageNode = async () => {
    const url = normalizeCanvasUrl(await askPrompt(t('canvas.imageUrlPrompt'), 'https://'));
    if (!url) return;
    const pos = canvasCenter(260, 180);
    const node = { id: canvasNodeId(), kind: 'image', url, title: titleFromUrl(url), x: pos.x, y: pos.y, w: 260, h: 180 };
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
  };
  const addAttachmentNode = () => {
    if (!onUploadAttachment) {
      window.alert(t('canvas.attachPickerFail'));
      return;
    }
    if (attachmentInputRef.current) attachmentInputRef.current.click();
  };
  const addAttachmentFiles = async (files, worldPoint = null) => {
    if (!files.length || !onUploadAttachment) return;
    const created = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const info = await onUploadAttachment(file);
        if (!info) continue;
        const kindRaw = attachmentKind(info.name || file.name || '');
        const kind = typeof kindRaw === 'string' ? kindRaw : kindRaw.kind;
        let w = kind === 'image' || kind === 'video' ? 280 : 260;
        let h = kind === 'image' || kind === 'video' ? 210 : 145;
        // Images keep their natural aspect ratio (capped so a photo doesn't
        // swallow the viewport).
        if (kind === 'image' && typeof createImageBitmap === 'function') {
          try {
            const bmp = await createImageBitmap(file);
            if (bmp.width > 0 && bmp.height > 0) {
              const scale = Math.min(1, 480 / bmp.width, 400 / bmp.height);
              w = Math.max(80, Math.round(bmp.width * scale));
              h = Math.max(60, Math.round(bmp.height * scale));
            }
            if (bmp.close) bmp.close();
          } catch {}
        }
        const pos = worldPoint
          ? { x: worldPoint.x - w / 2, y: worldPoint.y - h / 2 }
          : canvasCenter(w, h);
        created.push({
          id: canvasNodeId(),
          kind: 'attachment',
          name: info.name || file.name || 'Adjunto',
          sha: info.sha || null,
          url: info.url || (info.sha ? `edinot://blob/${info.sha}` : ''),
          mime: info.mime || file.type || '',
          size: info.size || file.size || 0,
          x: pos.x + i * 22,
          y: pos.y + i * 22,
          w,
          h,
        });
      } catch (err) {
        window.alert(t('attach.addFailed', { name: file.name || t('attach.kind.file'), err: err.message || err }));
      }
    }
    if (created.length) onChange(j => ({ ...j, nodes: [...(j.nodes || []), ...created] }));
  };
  const handleAttachmentFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await addAttachmentFiles(files);
  };
  const canvasDragHasFiles = (dt) => {
    if (!dt) return false;
    if (dt.files && dt.files.length) return true;
    try { return Array.from(dt.types || []).includes('Files'); } catch { return false; }
  };
  const onCanvasDragEnter = (e) => {
    if (!canvasDragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragHover(true);
  };
  const onCanvasDragOver = (e) => {
    if (!canvasDragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragHover(true);
  };
  const onCanvasDragLeave = (e) => {
    if (!canvasDragHasFiles(e.dataTransfer)) return;
    if (e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragHover(false);
  };
  const onCanvasDrop = async (e) => {
    const files = Array.from(e.dataTransfer && e.dataTransfer.files || []);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    setDragHover(false);
    focusCanvas();
    await addAttachmentFiles(files, screenToWorld(e.clientX, e.clientY));
  };
  // Paste a canvas-selection payload (see the Ctrl+C handler): remap every id,
  // offset the copies, keep internal edges, select the result.
  const pasteCanvasPayload = (p) => {
    onChange(j => {
      const idMap = new Map();
      const rg = grpRemapper();
      const nodes = (p.nodes || []).map(n => {
        const nid = canvasNodeId();
        idMap.set(n.id, nid);
        return { ...rg(n), id: nid, x: (n.x || 0) + 24, y: (n.y || 0) + 24 };
      });
      const edges = (p.edges || [])
        .filter(ed => idMap.has(ed.from) && idMap.has(ed.to))
        .map(ed => ({ ...ed, id: canvasEdgeId(), from: idMap.get(ed.from), to: idMap.get(ed.to) }));
      const annotations = (p.annotations || []).map(a => ({ ...rg(a), id: canvasAnnoId(), ox: (a.ox || 0) + 24, oy: (a.oy || 0) + 24 }));
      if (!nodes.length && !annotations.length) return j;
      setTimeout(() => {
        setSelected(new Set(nodes.map(n => n.id)));
        setSelAnno(new Set(annotations.map(a => a.id)));
      }, 0);
      return {
        ...j,
        nodes: [...(j.nodes || []), ...nodes],
        edges: [...(j.edges || []), ...edges],
        annotations: [...(j.annotations || []), ...annotations],
      };
    });
  };
  // Single paste entry point for the canvas root: canvas-selection JSON,
  // clipboard images (screenshots), then bare URLs — first match wins.
  const onCanvasPaste = (e) => {
    const tg = e.target;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
    const cd = e.clipboardData;
    const txt = cd && cd.getData('text/plain');
    if (txt && txt.trimStart().startsWith('{')) {
      let payload = null;
      try { const p = JSON.parse(txt); if (p && p.__edinotCanvas) payload = p; } catch {}
      if (payload) { e.preventDefault(); pasteCanvasPayload(payload); return; }
    }
    let imgFile = Array.from((cd && cd.files) || []).find(f => f.type && f.type.startsWith('image/'));
    if (!imgFile && cd && cd.items) {
      const it = Array.from(cd.items).find(i => i.kind === 'file' && i.type && i.type.startsWith('image/'));
      if (it) imgFile = it.getAsFile();
    }
    if (imgFile && onUploadAttachment) {
      e.preventDefault();
      focusCanvas();
      addAttachmentFiles([imgFile]);
      return;
    }
    if (!txt) return;
    const trimmed = txt.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed)) { e.preventDefault(); insertUrlAsNode(trimmed); return; }
    // Una lista (o texto suelto) → una nota adhesiva por línea, en rejilla.
    const lines = listLines(txt);
    if (!lines) return;
    e.preventDefault();
    const c = canvasCenter(CANVAS_STICKY_SIZE, CANVAS_STICKY_SIZE);
    const pos = gridPositions(lines.length, CANVAS_STICKY_SIZE, 24, c.x + CANVAS_STICKY_SIZE / 2, c.y + CANVAS_STICKY_SIZE / 2);
    const color = CANVAS_STICKY_COLORS[0];
    const nodes = lines.map((text, i) => ({ id: canvasNodeId(), kind: 'text', sticky: true, text, color, x: pos[i].x, y: pos[i].y, w: CANVAS_STICKY_SIZE, h: CANVAS_STICKY_SIZE }));
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), ...nodes] }));
    setSelected(new Set(nodes.map(n => n.id)));
  };
  const addQueryNode = async () => {
    const query = await askPrompt(t('canvas.queryPrompt'), '');
    if (!query) return;
    const pos = canvasCenter(280, 180);
    const node = { id: canvasNodeId(), kind: 'query', query, x: pos.x, y: pos.y, w: 280, h: 180, title: `🔎 ${query}` };
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
  };
  // Insert a frame/group: wraps the current selection's bounding box (with
  // padding + room for the title bar) or drops a default-size frame.
  const insertGroup = (title) => {
    // Pick a color from the rotation so consecutive groups stand out.
    const palette = ['rgba(125,169,90,0.10)', 'rgba(234,88,12,0.10)', 'rgba(59,130,246,0.10)', 'rgba(168,85,247,0.10)', 'rgba(220,38,38,0.08)', 'rgba(107,114,128,0.10)'];
    const color = palette[((json.groups || []).length) % palette.length];
    const selNodes = (json.nodes || []).filter(n => selected.has(n.id));
    let x, y, w, h;
    if (selNodes.length) {
      const PAD = 28, HEAD = 34;
      const minX = Math.min(...selNodes.map(n => n.x || 0));
      const minY = Math.min(...selNodes.map(n => n.y || 0));
      const maxX = Math.max(...selNodes.map(n => (n.x || 0) + (n.w || CANVAS_DEFAULT_NODE_W)));
      const maxY = Math.max(...selNodes.map(n => (n.y || 0) + (n.h || CANVAS_DEFAULT_NODE_H)));
      x = minX - PAD; y = minY - PAD - HEAD;
      w = (maxX - minX) + PAD * 2; h = (maxY - minY) + PAD * 2 + HEAD;
    } else {
      const center = screenToWorld(100, 100);
      x = center.x; y = center.y; w = CANVAS_GROUP_DEFAULT_W; h = CANVAS_GROUP_DEFAULT_H;
    }
    const group = { id: canvasGroupId(), title, x, y, w, h, color };
    onChange(j => ({ ...j, groups: [...(j.groups || []), group] }));
  };
  const addGroup = async () => {
    const title = await askPrompt(t('canvas.groupNamePrompt'), t('canvas.groupDefault'));
    if (!title) return;
    insertGroup(title);
  };
  // `f` shortcut: frame the selection without a prompt (rename later with a
  // double-click on the frame title).
  const addFrameQuick = () => {
    insertGroup(`${t('canvas.groupDefault')} ${(json.groups || []).length + 1}`);
  };
  // Duplicate a frame WITH its content (nodes whose centre falls inside) and
  // the edges internal to that set. The copy lands to the right of the source.
  const duplicateGroup = (group) => {
    onChange(j => {
      const gx = group.x || 0, gy = group.y || 0;
      const gw = group.w || CANVAS_GROUP_DEFAULT_W, gh = group.h || CANVAS_GROUP_DEFAULT_H;
      const off = gw + 48;
      const idMap = new Map();
      const copies = []; const rgc = grpRemapper();
      for (const n of (j.nodes || [])) {
        const cx = (n.x || 0) + (n.w || CANVAS_DEFAULT_NODE_W) / 2;
        const cy = (n.y || 0) + (n.h || CANVAS_DEFAULT_NODE_H) / 2;
        if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
          const nid = canvasNodeId();
          idMap.set(n.id, nid);
          copies.push({ ...rgc(n), id: nid, x: (n.x || 0) + off });
        }
      }
      const dupEdges = (j.edges || [])
        .filter(ed => idMap.has(ed.from) && idMap.has(ed.to))
        .map(ed => ({ ...ed, id: canvasEdgeId(), from: idMap.get(ed.from), to: idMap.get(ed.to) }));
      const ng = { ...group, id: canvasGroupId(), x: gx + off, title: `${group.title || ''} ${t('canvas.groupCopySuffix')}`.trim() };
      return {
        ...j,
        groups: [...(j.groups || []), ng],
        nodes: [...(j.nodes || []), ...copies],
        edges: [...(j.edges || []), ...dupEdges],
      };
    });
  };
  // Seed the canvas from a shared template (see shared/canvas-templates.js).
  const applyTemplate = (key) => {
    const built = buildCanvasTemplate(key, getLang(), {
      nodeId: canvasNodeId,
      groupId: canvasGroupId,
      annoId: canvasAnnoId,
      edgeId: canvasEdgeId,
    });
    onChange(j => ({
      ...j,
      nodes: [...(j.nodes || []), ...built.nodes],
      edges: [...(j.edges || []), ...built.edges],
      groups: [...(j.groups || []), ...built.groups],
      annotations: [...(j.annotations || []), ...built.annotations],
    }));
    setTimeout(fitToContent, 60);
  };
  // La tarjeta de una nota solo con título se abre como página (doble clic, o cuando la nota ya tiene texto).
  const expandPageNode = () => {
    const src = typeof pageSource === 'function' ? pageSource() : '';
    onChange(j => ({ ...j, nodes: (j.nodes || []).map(n => (n.kind === 'page' && n.compact) ? expandedPageNode(n, src) : n) }));
  };
  useEffect(() => {
    const pg = (json.nodes || []).find(n => n.kind === 'page' && n.compact);
    if (!pg || typeof pageSource !== 'function') return;
    if (!isEmptyPage(pageSource())) expandPageNode();
  }, [json]);
  const addShape = (shape) => {
    let pos = canvasCenter(160, 120);
    // Si ya hay algo justo ahí (otra forma recién puesta), se escalona para no taparla.
    const nodes0 = json.nodes || [];
    for (let k = 0; k < 12 && nodes0.some(n => Math.abs((n.x || 0) - pos.x) < 20 && Math.abs((n.y || 0) - pos.y) < 20); k++) pos = { x: pos.x + 40, y: pos.y + 40 };
    const node = { id: canvasNodeId(), kind: 'shape', shape, text: '', x: pos.x, y: pos.y, w: 160, h: 120 };
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
    setSelected(new Set([node.id])); setSelAnno(new Set()); setAutoEditId(node.id);   // se escribe nada más soltarla
  };
  // Sticky notes are the quick-capture primitive: created already in edit
  // mode (autoEditId) so the user can type immediately, Miro-style.
  const createStickyAt = (x, y, opts = {}) => {
    const id = canvasNodeId();
    const node = {
      id, kind: 'text', sticky: true, text: '',
      color: opts.color || CANVAS_STICKY_COLORS[0],
      x, y,
      w: opts.w || CANVAS_STICKY_SIZE, h: opts.h || CANVAS_STICKY_SIZE,
    };
    onChange(j => ({ ...j, nodes: [...(j.nodes || []), node] }));
    setSelected(new Set([id]));
    setSelAnno(new Set());
    setAutoEditId(id);
    return node;
  };
  // Tab / Enter inside a sticky's editor commits and spawns an adjacent
  // sibling (same color + size), keeping a brainstorm flowing keyboard-only.
  // Mapa mental real: Tab = hijo ya conectado, Enter = hermano (hijo del mismo padre),
  // Shift+Tab = subir al padre. El árbol se recoloca solo; sin padre, Enter conserva el
  // comportamiento clásico (nota adhesiva debajo, sin arista).
  const createMapChild = (parentId, like) => {
    const parent = nodeById.get(parentId);
    if (!parent) return;
    const ref = like || parent;
    const id = canvasNodeId();
    const w = ref.w || CANVAS_STICKY_SIZE, h = ref.h || CANVAS_STICKY_SIZE;
    const at = { x: (parent.x || 0) + (parent.w || CANVAS_DEFAULT_NODE_W) + 70, y: parent.y || 0 };
    // Un hijo de una forma es otra forma igual (organigramas, diagramas); de una nota adhesiva, otra nota.
    const node = ref.kind === 'shape'
      ? { id, kind: 'shape', shape: ref.shape || 'rect', text: '', ...(ref.color ? { color: ref.color } : {}), ...at, w: ref.w || 160, h: ref.h || 120 }
      : { id, kind: 'text', sticky: true, text: '', color: ref.color || CANVAS_STICKY_COLORS[0], ...at, w, h };
    const edge = { id: canvasEdgeId(), from: parentId, to: id, kind: 'manual' };
    onChange(j => addChild(j, parentId, node, edge));
    setSelected(new Set([id])); setSelAnno(new Set()); setAutoEditId(id);
  };
  const createStickySibling = (node, dir) => {
    const parentId = mmIndex.parentOf.get(node.id);
    if (dir === 'left') { if (parentId) { setSelected(new Set([parentId])); focusCanvas(); } return; }
    if (dir === 'right') { createMapChild(node.id); return; }
    if (parentId) { createMapChild(parentId, node); return; }
    const w = node.w || CANVAS_STICKY_SIZE, h = node.h || CANVAS_STICKY_SIZE;
    createStickyAt(node.x || 0, (node.y || 0) + h + 16, { color: node.color, w, h });
  };
  // Marcos (grupos contenedor) en el orden de la presentación: `order` explícito, o su posición.
  const orderedFrames = (j) => (j.groups || []).map((g, i) => ({ g, o: g.order != null ? Number(g.order) : i })).sort((a, b) => a.o - b.o).map(x => x.g);
  // Mueve el marco `id` a la posición de `toId` (antes, o después si after) y renumera 0..n-1.
  const moveFrame = (id, toId, after) => {
    if (!id || id === toId) return;
    onChange(j => {
      const ids = orderedFrames(j).map(g => g.id).filter(x => x !== id);
      const at = ids.indexOf(toId);
      if (at < 0) return j;
      ids.splice(after ? at + 1 : at, 0, id);
      const pos = new Map(ids.map((x, i) => [x, i]));
      return { ...j, groups: (j.groups || []).map(g => (g.order === pos.get(g.id) ? g : { ...g, order: pos.get(g.id) })) };
    });
  };
  const stepFrame = (id, dir) => {
    const ids = orderedFrames(jsonRef.current).map(g => g.id), i = ids.indexOf(id), k = i + dir;
    if (i < 0 || k < 0 || k >= ids.length) return;
    moveFrame(id, ids[k], dir > 0);
  };
  const toggleCollapse = (id) => {
    onChange(j => {
      const x = { ...j, nodes: (j.nodes || []).map(n => n.id === id ? (n.collapsed ? (({ collapsed, ...r }) => r)(n) : { ...n, collapsed: true }) : n) };
      const r = markedRoot(x, id);
      return r ? layoutMindmap(x, r) : x;
    });
  };
  const addSticky = () => {
    const pos = canvasCenter(CANVAS_STICKY_SIZE, CANVAS_STICKY_SIZE);
    createStickyAt(pos.x, pos.y);
  };
  // Double-click on empty canvas → sticky right there, ready to type.
  const onCanvasDoubleClick = (e) => {
    if (isDrawTool) return;
    if (e.target !== containerRef.current && !e.target.classList.contains('canvas-world')) return;
    e.preventDefault();
    focusCanvas();
    const p = screenToWorld(e.clientX, e.clientY);
    createStickyAt(p.x - CANVAS_STICKY_SIZE / 2, p.y - CANVAS_STICKY_SIZE / 2);
  };
  const fitToContent = () => {
    // Fichas, marcos y también dibujos (antes se quedaban fuera: un dibujo suelto no entraba en «Encajar todo»).
    const annoBoxes = (json.annotations || []).filter(a => a.bbox && !a.hidden).map(a => ({ x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: Math.max(1, a.bbox.w), h: Math.max(1, a.bbox.h) }));
    const all = [...(json.nodes || []), ...(json.groups || []), ...annoBoxes];
    if (!all.length) return;
    const minX = Math.min(...all.map(n => n.x || 0));
    const minY = Math.min(...all.map(n => n.y || 0));
    const maxX = Math.max(...all.map(n => (n.x || 0) + (n.w || CANVAS_DEFAULT_NODE_W)));
    const maxY = Math.max(...all.map(n => (n.y || 0) + (n.h || CANVAS_DEFAULT_NODE_H)));
    const w = maxX - minX + 80;
    const h = maxY - minY + 80;
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return;
    const zoom = Math.min(rect.width / w, rect.height / h, 1);
    setViewport({ zoom, x: -minX * zoom + 40, y: -minY * zoom + 40 });
  };
  // Zoom the viewport to the selected nodes/annotations (Shift+2). Falls back
  // to fit-all when nothing is selected.
  const zoomToSelection = () => {
    const selNodes = (json.nodes || []).filter(n => selected.has(n.id));
    const selAnnos = (json.annotations || []).filter(a => selAnno.has(a.id) && a.bbox);
    if (!selNodes.length && !selAnnos.length) { fitToContent(); return; }
    const xs = [], ys = [], x2s = [], y2s = [];
    for (const n of selNodes) {
      xs.push(n.x || 0); ys.push(n.y || 0);
      x2s.push((n.x || 0) + (n.w || CANVAS_DEFAULT_NODE_W)); y2s.push((n.y || 0) + (n.h || CANVAS_DEFAULT_NODE_H));
    }
    for (const a of selAnnos) {
      xs.push(a.bbox.x + (a.ox || 0)); ys.push(a.bbox.y + (a.oy || 0));
      x2s.push(a.bbox.x + (a.ox || 0) + a.bbox.w); y2s.push(a.bbox.y + (a.oy || 0) + a.bbox.h);
    }
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const w = Math.max(...x2s) - minX + 120, h = Math.max(...y2s) - minY + 120;
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return;
    const zoom = Math.max(0.2, Math.min(rect.width / w, rect.height / h, 1.6));
    const cx = minX + (Math.max(...x2s) - minX) / 2, cy = minY + (Math.max(...y2s) - minY) / 2;
    setViewport({ zoom, x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom });
  };
  // PNG a RESOLUCIÓN REAL: se renderiza el bounding box de todo el contenido fuera de pantalla
  // (SVG del canvas → <canvas>), sin capturar la ventana: no depende del zoom, del tamaño de la
  // ventana ni de Electron. Hasta 4× (lado máximo 8192 px). Las imágenes edinot:// no se pueden
  // resolver fuera de la app (igual que en el SVG): sólo se incrustan las http(s).
  // Exportar una capa o la selección (modo desarrollador): PNG a 1x/2x/3x con fondo transparente, o SVG.
  const exportSelection = async (fmt = 'png', scale = 2) => {
    const only = { nodes: new Set(selected), annos: new Set(selAnno) };
    if (!only.nodes.size && !only.annos.size) return;
    const first = [...(json.nodes || []), ...(json.annotations || [])].find(x => only.nodes.has(x.id) || only.annos.has(x.id));
    const base = String((first && (first.name || (typeof first.text === 'string' && first.text.split('\n')[0]))) || 'capa').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 40) || 'capa';
    if (fmt === 'svg') {
      const r = buildCanvasSvg(await inlineExportImages(), false, only);
      if (!r) return;
      const url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
      const aEl = document.createElement('a'); aEl.href = url; aEl.download = base + '.svg';
      document.body.appendChild(aEl); aEl.click(); aEl.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }
    return exportCanvasPng({ only, scale, transparent: true, name: `${base}@${scale}x.png` });
  };
  const exportCanvasPng = async (opts = {}) => {
    const r = buildCanvasSvg(await inlineExportImages(), true, opts.only || null);
    if (!r) { window.alert(t('canvas.exportEmpty')); return; }
    try {
      const scale = opts.scale || Math.max(1, Math.min(4, 8192 / Math.max(r.w, r.h)));
      const W = Math.max(1, Math.round(r.w * scale)), H = Math.max(1, Math.round(r.h * scale));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('No se pudo renderizar el lienzo')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg); });
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      let bg = '#ffffff';
      try { const c = getComputedStyle(containerRef.current).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') bg = c; } catch {}
      if (!opts.transparent) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
      g.drawImage(img, 0, 0, W, H);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      if (!blob) throw new Error('No se pudo generar el PNG');
      const url = URL.createObjectURL(blob);
      const a2 = document.createElement('a');
      a2.href = url; a2.download = opts.name || 'canvas.png';
      document.body.appendChild(a2); a2.click(); a2.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { w: W, h: H };
    } catch (err) {
      window.alert(t('canvas.exportError', { err: (err && err.message ? err.message : err) }));
    }
  };
  const doAutoLayout = (mode = 'grid') => {
    onChange(j => autoLayoutCanvas(j, { mode }));
  };
  // Visible undo/redo — the Y.UndoManager wiring already exists (Ctrl+Z at
  // app level routes here); these buttons make it discoverable.
  const canvasUndo = () => { const um = activeNoteId && getCanvasUndoManager(activeNoteId); if (um) um.undo(); };
  const canvasRedo = () => { const um = activeNoteId && getCanvasUndoManager(activeNoteId); if (um) um.redo(); };
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Standalone SVG export — no Electron needed. Nodes render as styled
  // foreignObject blocks (text wraps like on screen); annotations are
  // already vector data. Blob refs (edinot://) can't resolve outside the
  // app, so images embed only when they point at http(s).
  // Imágenes de las fichas como data: URL para exportar (las edinot://blob/…
  // no existen fuera de la app y las http contaminarían el PNG). Las que no se
  // pueden leer (CORS, >8 MB) se omiten en el PNG y quedan como enlace en el SVG.
  const inlineExportImages = async () => {
    const out = new Map();
    const imgs = (jsonRef.current.nodes || []).filter(n => n.kind === 'image' && (n.url || n.sha));
    await Promise.all(imgs.map(async (n) => {
      const src = n.url || `edinot://blob/${n.sha}`;
      try {
        const r = await fetch(src);
        if (!r.ok) return;
        const b = await r.blob();
        if (!b || b.size > 8 * 1024 * 1024) return;
        const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
        out.set(n.id, data);
      } catch {}
    }));
    return out;
  };
  const buildCanvasSvg = (imgData = null, forPng = false, only = null) => {
    // `only` = { nodes: Set, annos: Set }: solo esa selección (Copiar como SVG).
    const nodes = only ? (json.nodes || []).filter(n => only.nodes.has(n.id)) : (json.nodes || []);
    const groups = only ? [] : (json.groups || []);
    const annos = only ? (json.annotations || []).filter(a => only.annos.has(a.id)) : (json.annotations || []);
    if (!nodes.length && !groups.length && !annos.length) return null;
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const boxes = [
      ...nodes.map(n => ({ x: n.x || 0, y: n.y || 0, w: n.w || CANVAS_DEFAULT_NODE_W, h: n.h || CANVAS_DEFAULT_NODE_H })),
      ...groups.map(g => ({ x: g.x || 0, y: g.y || 0, w: g.w || CANVAS_GROUP_DEFAULT_W, h: g.h || CANVAS_GROUP_DEFAULT_H })),
      ...annos.filter(a => a.bbox).map(a => ({ x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h })),
    ];
    const PAD = 40;
    const minX = Math.min(...boxes.map(b => b.x)) - PAD;
    const minY = Math.min(...boxes.map(b => b.y)) - PAD;
    const maxX = Math.max(...boxes.map(b => b.x + b.w)) + PAD;
    const maxY = Math.max(...boxes.map(b => b.y + b.h)) + PAD;
    const parts = [];
    for (const g of groups) {
      const gw = g.w || CANVAS_GROUP_DEFAULT_W, gh = g.h || CANVAS_GROUP_DEFAULT_H;
      parts.push(`<rect x="${g.x || 0}" y="${g.y || 0}" width="${gw}" height="${gh}" rx="10" fill="${esc(g.color || 'rgba(125,169,90,0.08)')}" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>`);
      parts.push(`<text x="${(g.x || 0) + 12}" y="${(g.y || 0) + 22}" font-size="13" font-weight="600" fill="#3a3f33" font-family="sans-serif">${esc(g.title || '')}</text>`);
    }
    const dashOf = (style) => style === 'dashed' ? ' stroke-dasharray="8 4"' : style === 'dotted' ? ' stroke-dasharray="2 4"' : '';
    for (const e of (json.edges || [])) {
      if (only && !((only.nodes.has(e.from) || only.annos.has(e.from)) && (only.nodes.has(e.to) || only.annos.has(e.to)))) continue;
      const L = layoutEdge(e, rectOf, obstaclesFor(e));
      if (!L) continue;
      const col = e.color || CANVAS_EDGE_DEFAULT, sw = 1.6;
      const ang = endAngles(L.path);
      const hs = headGeom(L.heads.start, L.a, ang.start + Math.PI, sw), he = headGeom(L.heads.end, L.b, ang.end, sw);
      { const ed = pathToD(trimPath(L.path, hs ? hs.inset : 0, he ? he.inset : 0));
        if (e.sketch) parts.push(sketchSvg(sketchPathD(edgeKeyOf(e), ed, col, sw).map(p => ({ ...p, stroke: col })), dashOf(e.style)));
        else parts.push(`<path d="${ed}" fill="none" stroke="${esc(col)}" stroke-width="${sw}" stroke-linejoin="round"${dashOf(e.style)}/>`); }
      for (const h of [hs, he]) {
        if (!h) continue;
        parts.push(h.circle
          ? `<circle cx="${h.circle.cx}" cy="${h.circle.cy}" r="${h.circle.r}" fill="${esc(col)}"/>`
          : `<path d="${h.d}" fill="${h.filled ? esc(col) : 'none'}" stroke="${esc(col)}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`);
      }
      if (e.label) { const lp = pointAt(flatten(L.path), e.labelT != null ? e.labelT : 0.5); parts.push(`<text x="${lp.x}" y="${lp.y - 5}" font-size="11" text-anchor="middle" fill="#4a5240" font-family="sans-serif">${esc(e.label)}</text>`); }
    }
    const nodeToSvg = (n) => {
      const w = n.w || CANVAS_DEFAULT_NODE_W, h = n.h || CANVAS_DEFAULT_NODE_H;
      if (n.kind === 'label' && !n.wrap) {
        // Texto de diseño como <text> de verdad, con su fuente, peso, alineación e interlineado.
        const fs = n.fontSize || 20, lh = n.lineHeight || (n.plain ? 1.25 : 1.25);
        const padX = n.plain ? 0 : 8, padY = n.plain ? 0 : 4;
        const lines = labelLines(n);
        const al = n.align || 'left';
        const tx = al === 'center' ? (n.x || 0) + w / 2 : al === 'right' ? (n.x || 0) + w - padX : (n.x || 0) + padX;
        const anchor = al === 'center' ? 'middle' : al === 'right' ? 'end' : 'start';
        const base = (n.y || 0) + padY + (lh * fs - 1.21 * fs) / 2 + 0.97 * fs;
        const at = Object.entries(labelSvgAttrs(n)).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
        const runSvg = (r) => `<tspan${r.b ? ' font-weight="700"' : ''}${r.i ? ' font-style="italic"' : ''}${(r.u || r.s) ? ` text-decoration="${[r.u && 'underline', r.s && 'line-through'].filter(Boolean).join(' ')}"` : ''}${r.color ? ` fill="${esc(r.color)}"` : ''}${r.size ? ` font-size="${r.size}"` : ''}${r.code ? ` font-family="'JetBrains Mono', monospace"` : ''}>${esc(r.t)}</tspan>`;
        const rich = n.rich ? parseRich(lines.join('\n')) : null;
        parts.push(`<text x="${tx}" y="${base}" text-anchor="${anchor}" fill="${esc(n.color || '#2a2f23')}" ${at}>${lines.map((ln, i) => `<tspan x="${tx}"${i ? ` dy="${lh * fs}"` : ''}>${rich ? (rich[i] || []).map(runSvg).join('') || ' ' : (esc(ln) || ' ')}</tspan>`).join('')}</text>`);
        return;
      }
      const isStickyN = (n.kind === 'text' || !n.kind) && n.sticky;
      const bg = isStickyN ? (n.color || '#f3d27a') : '#ffffff';
      const isLbl = n.kind === 'label';
      if (!isLbl) parts.push(`<rect x="${n.x || 0}" y="${n.y || 0}" width="${w}" height="${h}" rx="${isStickyN ? 2 : 8}" fill="${esc(bg)}" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>`);
      const textContent = n.text || n.title || n.noteName || n.url || n.query || '';
      const fs = isStickyN ? stickyFontSize(n.text, w, h) : isLbl ? (n.fontSize || 20) : 12;
      const align = isStickyN ? 'center' : 'left';
      const flex = isStickyN ? 'display:flex;align-items:center;justify-content:center;text-align:center;' : '';
      parts.push(`<foreignObject x="${(n.x || 0) + 6}" y="${(n.y || 0) + 4}" width="${w - 12}" height="${h - 8}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;overflow:hidden;font-family:sans-serif;font-size:${fs}px;line-height:1.3;color:#2a2f23;text-align:${align};white-space:pre-wrap;word-break:break-word;${flex}">${esc(textContent)}</div></foreignObject>`);
      if (n.kind === 'image') {
        const href = imgData && imgData.get(n.id) ? imgData.get(n.id) : (!forPng && n.url && /^https?:\/\//i.test(n.url) ? n.url : null);
        if (href) parts.push(`<image x="${n.x || 0}" y="${n.y || 0}" width="${w}" height="${h}" href="${esc(href)}" preserveAspectRatio="xMidYMid meet"/>`);
      }
    };
    // En el mismo orden de apilado que en pantalla (fichas y dibujos intercalados), sin lo oculto.
    const nById = new Map(nodes.map(n => [n.id, n])), aById = new Map(annos.map(a => [a.id, a]));
    for (const it of mergedOrder(json)) {
      if (only && !(it.type === 'n' ? only.nodes.has(it.id) : only.annos.has(it.id))) continue;
      if (it.type === 'n') { const n = nById.get(it.id); if (n && !n.hidden && !hiddenIds.has(n.id)) nodeToSvg(resolveVars(n, json.vars)); }
      else { const a = aById.get(it.id); if (a && !a.hidden && !((a.maskType === 'luminance' || a.maskType === 'alpha') && (json.annotations || []).some(x => x.clipTo === a.id))) parts.push(annoToSvg(resolveVars(a, json.vars), esc, aById)); }
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${maxX - minX}" height="${maxY - minY}" font-family="sans-serif"><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#f7f5ee"/>${parts.join('\n')}</svg>`;
    return { svg, w: maxX - minX, h: maxY - minY };
  };
  if (typeof window !== 'undefined' && window.__EDINOT_TEST) { window.__edinotCanvasSvg = () => buildCanvasSvg(null, false); window.__edinotFrameHtml = (title) => { const g = (json.groups || []).find(x => x.title === title); return g ? frameToHtml(json, g) : null; }; }   // solo pruebas
  const exportCanvasSvg = async () => {
    const r = buildCanvasSvg(await inlineExportImages(), false);
    if (!r) { window.alert(t('canvas.exportEmpty')); return; }
    const blob = new Blob([r.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement('a');
    aEl.href = url;
    aEl.download = 'canvas.svg';
    document.body.appendChild(aEl);
    aEl.click();
    aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  // Un dibujo exportado con su degradado, sombra (y sombra interior, desenfoque) y recorte, como se ve.
  const annoToSvg = (a, esc, aById) => {
    const defs = [];
    let a2 = a;
    if (a.gradient && Array.isArray(a.gradient.stops) && a.gradient.stops.length) {
      defs.push(gradientSvg(a, `eg-${a.id}`, esc));
      a2 = { ...a, fill: `url(#eg-${a.id})` };
    }
    if (a.imageFill && a.imageFill.src) {
      const pat = imageFillSvg(a, `ei-${a.id}`, esc);
      if (pat) { defs.push(pat); a2 = { ...a2, fill: `url(#ei-${a.id})` }; }
    }
    const ps = paintStack(a);
    let body = annoToSvgBody(ps ? { ...a2, color: ps.base.color } : a2, esc);
    if (!body) return '';
    if (a.startCap || a.endCap) {
      const m = markerSvg(a, 'em-' + a.id, esc);
      if (m.defs) { defs.push(m.defs); body = body.replace(/<(path|line)\b/, `<$1${m.start ? ` marker-start="${m.start}"` : ''}${m.end ? ` marker-end="${m.end}"` : ''}`); }
    }
    if (ps) body += ps.layers.map(l => { const inner = annoToSvg(l, esc, null); return l.blend && l.blend !== 'normal' ? `<g style="mix-blend-mode:${l.blend}">${inner}</g>` : inner; }).join('');
    const fx = annoFilterSvg(a, esc, 'ef-' + a.id);
    if (fx) { defs.push(fx); body = `<g filter="url(#ef-${a.id})">${body}</g>`; }
    const clip = (a.clipTo || a.clip) && aById ? clipFor(a, aById) : null;
    const mShape = clip && a.clipTo && aById ? aById.get(a.clipTo) : null;
    if (mShape && (mShape.maskType === 'luminance' || mShape.maskType === 'alpha')) {
      // Máscara de luminancia / alfa: la forma con su pintura (degradado incluido) dentro de un <mask>.
      let ms = { ...mShape, color: 'none', fill: mShape.fill && mShape.fill !== 'none' ? mShape.fill : '#ffffff' };
      let gdef = '';
      if (ms.gradient && Array.isArray(ms.gradient.stops)) { gdef = gradientSvg(ms, `emg-${a.id}`, esc); ms = { ...ms, fill: `url(#emg-${a.id})` }; }
      defs.push(`<mask id="emk-${a.id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" style="mask-type:${mShape.maskType}">${gdef}${annoToSvgBody(ms, esc)}</mask>`);
      body = `<g mask="url(#emk-${a.id})">${body}</g>`;
    } else if (clip) { defs.push(`<clipPath id="ec-${a.id}" clipPathUnits="userSpaceOnUse"><path d="${esc(clip.d)}"${clip.transform ? ` transform="${clip.transform}"` : ''}/></clipPath>`); body = `<g clip-path="url(#ec-${a.id})">${body}</g>`; }
    const out = (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body;
    return a.blend && a.blend !== 'normal' ? `<g style="mix-blend-mode:${a.blend}">${out}</g>` : out;
  };
  const annoToSvgBody = (a, esc) => {
    const tr = (a.ox || a.oy) ? ` transform="translate(${a.ox || 0} ${a.oy || 0})"` : '';
    const dash = canvasDashArray(a.dash) ? ` stroke-dasharray="${canvasDashArray(a.dash)}"` : '';
    const op = a.opacity != null ? a.opacity : 1;
    if (a.kind === 'path' && !a.d && Array.isArray(a.pts) && a.pts.length) a = { ...a, d: strokeD(a) };   // grosor cambiado por un agente
    if (a.kind === 'path' && a.d) {
      if (a.variant === 'pen') {
        const ink = a.fill || a.color || '#1f2937';
        const bf = a.brush && a.brush !== 'pen' ? brushFilterSvg(a.brush, `eb-${a.id}`, ink) : '';
        const blend = brushSpec(a.brush).blend;
        return `${bf ? `<defs>${bf}</defs>` : ''}<path d="${esc(a.d)}" fill="${esc(brushFill(a.brush, ink))}" stroke="none" opacity="${op}"${bf ? ` filter="url(#eb-${a.id})"` : ''}${blend ? ` style="mix-blend-mode:${blend}"` : ''}${tr}/>`;
      }
      if (a.variant === 'highlighter') return `<path d="${esc(a.d)}" fill="none" stroke="${esc(a.color || '#f59e0b')}" stroke-width="${a.strokeWidth || 12}" stroke-linecap="round" opacity="${a.opacity != null ? a.opacity : 0.35}"${tr}/>`;
      return `<path d="${esc(a.d)}" fill="${esc(a.fill || 'none')}"${a.fillRule ? ` fill-rule="${a.fillRule}"` : ''} stroke="${esc(a.color || '#ea580c')}" stroke-width="${a.strokeWidth || 2.5}" stroke-linecap="${a.strokeCap || 'round'}" stroke-linejoin="${a.strokeJoin || 'round'}" opacity="${a.opacity != null ? a.opacity : 0.85}"${dash}${tr}/>`;
    }
    if (a.kind !== 'shape') return '';
    const stroke = a.color || '#1f2937', sw = a.strokeWidth || 2, fill = a.fill && a.fill !== 'none' ? a.fill : 'none';
    const rot = (a.rot && CANVAS_CLOSED_SHAPE_SET.has(a.shape)) ? ` transform="translate(${a.ox || 0} ${a.oy || 0}) rotate(${a.rot} ${a.x + a.w / 2} ${a.y + a.h / 2})"` : tr;
    const common = `fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${sw}" opacity="${op}"${a.strokeJoin ? ` stroke-linejoin="${a.strokeJoin}"` : ''}${dash}${rot}`;
    let body = '';
    if (a.sketch) {
      const g = `<g opacity="${op}"${rot}>${sketchSvg(sketchShapePaths(a), dash)}${a.shape === 'arrow' ? `<path d="${arrowHeadPath(a.x1, a.y1, a.x2, a.y2, sw)}" fill="${esc(stroke)}"/>` : ''}</g>`;
      body = g;
    } else if (a.shape === 'rect') {
      const rr = a.rx != null ? Math.min(a.rx, a.w / 2, a.h / 2) : 6;
      const cd = Array.isArray(a.corners) ? cornersRectD(a.x, a.y, a.w, a.h, a.corners) : null;
      const shp = (c) => (cd ? `<path d="${cd}" ${c}/>` : `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${rr}" ${c}/>`);
      const hasStroke = stroke !== 'none' && sw > 0.05;
      if (a.sides && hasStroke) body = shp(common.replace(/stroke="[^"]*"/, 'stroke="none"')) + `<path d="${sidesD(a.x, a.y, a.w, a.h, a.sides)}" fill="none" stroke="${esc(stroke)}" stroke-width="${sw}" opacity="${op}"${dash}${rot}/>`;
      else if (a.strokeAlign === 'outside' && hasStroke) body = shp(common.replace(/stroke-width="[^"]*"/, `stroke-width="${sw * 2}"`) + ' paint-order="stroke"');
      else if (a.strokeAlign === 'inside' && hasStroke) body = `<clipPath id="ein-${a.id}">${cd ? `<path d="${cd}"/>` : `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${rr}"/>`}</clipPath>` + shp(common.replace(/stroke-width="[^"]*"/, `stroke-width="${sw * 2}"`) + ` clip-path="url(#ein-${a.id})"`);
      else body = shp(common);
    }
    else if (a.shape === 'ellipse') body = `<ellipse cx="${a.x + a.w / 2}" cy="${a.y + a.h / 2}" rx="${a.w / 2}" ry="${a.h / 2}" ${common}/>`;
    else if (a.shape === 'diamond') { const cx = a.x + a.w / 2, cy = a.y + a.h / 2; body = `<path d="M ${cx} ${a.y} L ${a.x + a.w} ${cy} L ${cx} ${a.y + a.h} L ${a.x} ${cy} Z" ${common}/>`; }
    else if (NEW_SHAPES.includes(a.shape)) body = `<g${rot}>${shapeParts(a.shape, a.x, a.y, a.w, a.h).map(part => `<path d="${part.d}" fill="${part.fill ? esc(fill) : 'none'}" stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linejoin="round" opacity="${op}"${dash}/>`).join('')}</g>`;
    else if (a.shape === 'line') body = `<line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linecap="${a.strokeCap || 'round'}" opacity="${op}"${dash}${tr}/>`;
    else if (a.shape === 'arrow') body = `<g${tr}><line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linecap="round" opacity="${op}"${dash}/><path d="${arrowHeadPath(a.x1, a.y1, a.x2, a.y2, sw)}" fill="${esc(stroke)}" opacity="${op}"/></g>`;
    if (a.text && CANVAS_CLOSED_SHAPE_SET.has(a.shape)) {
      const tb = shapeTextBox(a.shape, a.x, a.y, a.w, a.h);
      const lines = String(a.text).split('\n');
      const ty = tb.y + tb.h / 2 + 4 - (lines.length - 1) * 8;
      body += `<text x="${tb.x + tb.w / 2}" y="${ty}" font-size="14" text-anchor="middle" fill="${esc(stroke)}" font-family="sans-serif"${rot}>${lines.map((ln, i) => `<tspan x="${tb.x + tb.w / 2}"${i ? ' dy="16"' : ''}>${esc(ln)}</tspan>`).join('')}</text>`;
    }
    return body;
  };
  const resetZoom = () => setViewport({ x: 0, y: 0, zoom: 1 });
  // Toolbar zoom — keeps the current viewport center fixed while changing
  // zoom so the user doesn't lose their place.
  // Move the viewport so `node` ends up at the visible center, at zoom 1.
  // Animates by setting the next state; CSS transition on the canvas-world
  // transform gives a smooth glide.
  const centerOnNode = useCallback((node, opts = {}) => {
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return;
    const zoom = opts.zoom != null ? opts.zoom : Math.max(0.6, Math.min(1.4, viewportRef.current.zoom));
    const nx = (node.x || 0) + (node.w || CANVAS_DEFAULT_NODE_W) / 2;
    const ny = (node.y || 0) + (node.h || CANVAS_DEFAULT_NODE_H) / 2;
    setViewport({ zoom, x: rect.width / 2 - nx * zoom, y: rect.height / 2 - ny * zoom });
  }, []);

  // ── Canvas slideshow — PowerPoint-style, one GROUP per slide ───────────
  // The camera glides to each group and zooms to fit it. Manual nav
  // (arrows / Space / Esc, bottom bar) or auto-advance when steps carry
  // durations (AI-driven via the present_canvas_groups MCP tool). Slides
  // follow json.groups array order unless explicit steps are passed.
  const [slideshow, setSlideshow] = useState(null); // { slides:[{groupId,title,message,durationMs}], idx, auto }
  const slideshowRef = useRef(null);
  useEffect(() => { slideshowRef.current = slideshow; }, [slideshow]);
  const jsonGroupsRef = useRef(json.groups);
  useEffect(() => { jsonGroupsRef.current = json.groups; }, [json.groups]);
  const slideTimerRef = useRef(null);
  const vpAnimRef = useRef(null);
  const slideshowWasFullscreenRef = useRef(false);

  const animateViewportTo = useCallback((target, ms = 650) => {
    if (vpAnimRef.current) cancelAnimationFrame(vpAnimRef.current);
    const from = { ...viewportRef.current };
    const begin = performance.now();
    const ease = (tt) => tt < 0.5 ? 4 * tt * tt * tt : 1 - Math.pow(-2 * tt + 2, 3) / 2;
    const tick = () => {
      const tn = Math.min(1, (performance.now() - begin) / ms);
      const e = ease(tn);
      setViewport({
        zoom: from.zoom + (target.zoom - from.zoom) * e,
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
      });
      vpAnimRef.current = tn < 1 ? requestAnimationFrame(tick) : null;
    };
    vpAnimRef.current = requestAnimationFrame(tick);
  }, []);

  const groupFitTarget = useCallback((g) => {
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return null;
    const PAD = 70;
    const gw = Math.max(60, g.w || CANVAS_GROUP_DEFAULT_W);
    const gh = Math.max(60, g.h || CANVAS_GROUP_DEFAULT_H);
    const zoom = Math.max(0.2, Math.min(1.6, Math.min((rect.width - PAD * 2) / gw, (rect.height - PAD * 2) / gh)));
    const cx = (g.x || 0) + gw / 2;
    const cy = (g.y || 0) + gh / 2;
    return { zoom, x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom };
  }, []);

  // ── Página ↔ Canvas: transición ─────────────────────────────────────────
  // Entrar: el canvas aparece con el bloque de página exactamente donde estaba
  // la columna de texto (mismo tamaño), y la cámara se aleja hasta ver lo que
  // hay alrededor mientras lo demás aparece. Salir: lo contrario, y al acabar
  // la nota vuelve a Página. Cada fotograma se mide (`window.__edinotSurfaceAnim`).
  const [surfacePhase, setSurfacePhase] = useState(intro ? 'in' : null); // 'in' | 'out' | null
  const surfaceAnim = useCallback((fromV, toV, ms, done) => {
    if (vpAnimRef.current) cancelAnimationFrame(vpAnimRef.current);
    // Sin fotogramas (ventana oculta o minimizada) no se anima: se llega al final.
    // Y pase lo que pase, el cambio no se queda a medias: un temporizador lo remata.
    let finished = false;
    const finish = (stats) => { if (finished) return; finished = true; clearTimeout(guard); setViewport(toV); done && done(stats); };
    const guard = setTimeout(() => { if (vpAnimRef.current) cancelAnimationFrame(vpAnimRef.current); vpAnimRef.current = null; finish(null); }, ms + 400);
    if (typeof document !== 'undefined' && document.hidden) { finish(null); return; }
    const begin = performance.now();
    const frames = [];
    let last = begin;
    const ease = (tt) => 1 - Math.pow(1 - tt, 3);
    setViewport(fromV);
    const tick = (now) => {
      frames.push(now - last); last = now;
      const tn = Math.min(1, (now - begin) / ms);
      const e = ease(tn);
      setViewport({ zoom: fromV.zoom + (toV.zoom - fromV.zoom) * e, x: fromV.x + (toV.x - fromV.x) * e, y: fromV.y + (toV.y - fromV.y) * e });
      if (tn < 1) { vpAnimRef.current = requestAnimationFrame(tick); return; }
      vpAnimRef.current = null;
      const f = frames.slice(1);
      const stats = { frames: f.length, avgMs: f.length ? +(f.reduce((a, b) => a + b, 0) / f.length).toFixed(2) : 0, maxMs: f.length ? +Math.max(...f).toFixed(2) : 0, totalMs: +(now - begin).toFixed(1) };
      try { (window.__edinotSurfaceAnim = window.__edinotSurfaceAnim || []).push(stats); } catch {}
      finish(stats);
    };
    vpAnimRef.current = requestAnimationFrame(tick);
  }, [setViewport]);
  // Donde la cámara deja ver todo (como «encajar», con tope de zoom).
  const surfaceOverview = useCallback(() => {
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    const all = [...(jsonRef.current.nodes || []), ...(jsonRef.current.groups || [])];
    if (!rect || !all.length) return null;
    const minX = Math.min(...all.map(n => n.x || 0)), minY = Math.min(...all.map(n => n.y || 0));
    const maxX = Math.max(...all.map(n => (n.x || 0) + (n.w || CANVAS_DEFAULT_NODE_W)));
    const maxY = Math.max(...all.map(n => (n.y || 0) + (n.h || CANVAS_DEFAULT_NODE_H)));
    const PAD = 72;
    const zoom = Math.max(0.2, Math.min(0.85, (rect.width - PAD * 2) / (maxX - minX), (rect.height - PAD * 2) / (maxY - minY)));
    return { zoom, x: rect.width / 2 - ((minX + maxX) / 2) * zoom, y: Math.max(PAD, rect.height / 2 - ((minY + maxY) / 2) * zoom) };
  }, []);
  // La columna de lectura (en píxeles de pantalla) pasada a coordenadas del contenedor.
  const columnInContainer = useCallback((col) => {
    const box = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!box || !col) return null;
    return { left: col.left - box.left, top: col.top - box.top, width: col.width };
  }, []);
  useLayoutEffect(() => {
    if (!intro) return;
    intro.used = true;
    const rect = pageNodeRect(jsonRef.current);
    const fromV = rect && viewportForPageColumn(rect, columnInContainer(intro.column));
    const toV = surfaceOverview();
    if (!fromV || !toV) { setSurfacePhase(null); return; }
    // La cámara se coloca ya sobre la columna (sin parpadeo) y arranca dos
    // fotogramas después, cuando el editor de la página ya ha pintado su texto.
    setViewport(fromV);
    applyWorldTransform(); // ya en este fotograma, no en el siguiente
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => surfaceAnim(fromV, toV, intro.ms || 460, () => setSurfacePhase(null))); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (transitionRef) {
    transitionRef.current = {
      // A Página: la cámara vuelve a poner el bloque de página en la columna.
      outro: (column, done, ms = 380) => {
        const rect = pageNodeRect(jsonRef.current);
        const toV = rect && viewportForPageColumn(rect, columnInContainer(column));
        if (!toV) { done && done(); return; }
        setSurfacePhase('out');
        surfaceAnim({ ...viewportRef.current }, toV, ms, () => done && done());
      },
    };
  }

  const endSlideshow = useCallback(() => {
    if (!slideshowRef.current) return;
    if (slideTimerRef.current) { clearTimeout(slideTimerRef.current); slideTimerRef.current = null; }
    if (vpAnimRef.current) { cancelAnimationFrame(vpAnimRef.current); vpAnimRef.current = null; }
    slideshowRef.current = null;
    setSlideshow(null);
    setProto(null); protoStackRef.current = []; navHistRef.current = [];
    for (const tm of protoTimersRef.current) clearTimeout(tm); protoTimersRef.current = [];
    if (!slideshowWasFullscreenRef.current) setFullscreen(false);
  }, []);
  const endSlideshowRef = useRef(endSlideshow);
  useEffect(() => { endSlideshowRef.current = endSlideshow; }, [endSlideshow]);

  // Medidas del modo desarrollador: con un elemento seleccionado, mantener Alt y pasar por encima de otro muestra la
  // distancia entre ambos (sin otro debajo, hasta los bordes de su marco), como en Figma.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;
    let last = null;
    const rectOf = (kind, id) => {
      const j = jsonRef.current || {};
      if (kind === 'n') { const n = (j.nodes || []).find(x => x.id === id); return n ? canvasNodeRect(n) : null; }
      if (kind === 'a') { const a = (j.annotations || []).find(x => x.id === id); return a && a.bbox ? { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h } : null; }
      const g = (j.groups || []).find(x => x.id === id);
      return g ? { x: g.x || 0, y: g.y || 0, w: g.w || CANVAS_GROUP_DEFAULT_W, h: g.h || CANVAS_GROUP_DEFAULT_H } : null;
    };
    const selRect = () => {
      const rs = [...selected].map(id => rectOf('n', id)).concat([...selAnno].map(id => rectOf('a', id))).filter(Boolean);
      if (!rs.length) return null;
      const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
      return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y };
    };
    const update = (e) => {
      if (!e || !e.altKey || slideshowRef.current) { if (last) { last = null; setMeasure(null); } return; }
      const a = selRect();
      if (!a) return;
      let b = null;
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (!root.contains(el)) continue;
        const nEl = el.closest('[data-node-id]'), aEl = el.closest('[data-annotation-id]'), gEl = el.closest('[data-group-id]');
        if (aEl && !selAnno.has(aEl.getAttribute('data-annotation-id'))) { b = rectOf('a', aEl.getAttribute('data-annotation-id')); break; }
        if (nEl && !selected.has(nEl.getAttribute('data-node-id'))) { b = rectOf('n', nEl.getAttribute('data-node-id')); break; }
        if (gEl) { b = rectOf('g', gEl.getAttribute('data-group-id')); break; }
      }
      const m = b ? measureBetween(a, b) : null;
      const key = JSON.stringify(m);
      if (key !== last) { last = key; setMeasure(m && m.length ? m : null); }
    };
    let lastEv = null;
    const onMove = (e) => { lastEv = e; update(e); };
    const onKey = (e) => { if (e.key === 'Alt') { if (e.type === 'keydown') e.preventDefault(); update(lastEv && { clientX: lastEv.clientX, clientY: lastEv.clientY, altKey: e.type === 'keydown' }); } };
    root.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => { root.removeEventListener('pointermove', onMove); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  }, [selected, selAnno]);

  const goToSlideRef = useRef(null);
  const protoStackRef = useRef([]);    // cambios del prototipo (funciones json → json), en orden
  const navHistRef = useRef([]);       // pantallas visitadas, para «Atrás»
  const protoTimersRef = useRef([]);   // «tras un tiempo» de la pantalla actual
  const pushProto = (fn) => { protoStackRef.current = [...protoStackRef.current, fn]; const st = protoStackRef.current; setProto(() => (j) => st.reduce((acc, f) => f(acc), j)); return st.length - 1; };
  const dropProto = (i) => { const st = protoStackRef.current.filter((_, k) => k !== i); protoStackRef.current = st; setProto(st.length ? () => (j) => st.reduce((acc, f) => f(acc), j) : null); };
  const goToSlide = useCallback((idx, how = 'move') => {
    const ss = slideshowRef.current;
    if (!ss) return;
    if (idx < 0) idx = 0;
    if (idx >= ss.slides.length) { endSlideshow(); return; }
    if (slideTimerRef.current) { clearTimeout(slideTimerRef.current); slideTimerRef.current = null; }
    const slide = ss.slides[idx];
    const groups = jsonGroupsRef.current || [];
    const g = groups.find(x => x.id === slide.groupId);
    const prevG = ss.slides[ss.idx] && ss.idx !== idx ? groups.find(x => x.id === ss.slides[ss.idx].groupId) : null;
    presScrollRef.current = 0; setPresScroll(0); setOverlay(null);
    let settle = 650;
    if (g) {
      const tgt = groupFitTarget(g);
      const root = containerRef.current;
      if (tgt) {
        // Transiciones del prototipo: al instante, fundido, desplazamiento rápido, mover (por defecto) o smart animate.
        if (how === 'instant') { setViewport(tgt); settle = 0; }
        else if (how === 'dissolve' && root && root.animate) {
          settle = 420;
          const out = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
          out.onfinish = () => { setViewport(tgt); requestAnimationFrame(() => { out.cancel(); root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 }); }); };
        } else if (how === 'smart' && prevG && root) {
          settle = 520;
          setViewport(tgt);
          const pairs = smartPairs(jsonRef.current || {}, prevG, g);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            for (const pr of pairs) {
              const el = root.querySelector(pr.kind === 'n' ? `[data-node-id="${pr.id}"]` : `[data-annotation-id="${pr.id}"]`);
              if (!el || !el.animate) continue;
              if (pr.matched) el.animate([{ translate: `${pr.dx}px ${pr.dy}px`, scale: String(pr.scale || 1) }, { translate: '0px 0px', scale: '1' }], { duration: 520, easing: 'cubic-bezier(.3,.7,.2,1)' });
              else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 120, fill: 'backwards' });
            }
          }));
        } else { settle = how === 'slide' ? 380 : 650; animateViewportTo(tgt, settle); }
      }
      // Animaciones de entrada de las piezas de la pantalla, cuando la cámara llega.
      setTimeout(() => {
        const root2 = containerRef.current;
        if (!root2) return;
        for (const it of frameItems(jsonRef.current || {}, g)) {
          if (!it.item.anim || !it.item.anim.enter) continue;
          playEnter(root2.querySelector(it.kind === 'n' ? `[data-node-id="${it.item.id}"]` : `[data-annotation-id="${it.item.id}"]`), it.item.anim);
        }
      }, how === 'smart' ? 0 : Math.max(0, settle - 120));
    }
    const next = { ...ss, idx };
    slideshowRef.current = next;
    setSlideshow(next);
    for (const tm of protoTimersRef.current) clearTimeout(tm);
    protoTimersRef.current = [];
    if (g) {
      for (const { item, inter } of frameInteractions(protoJsonRef.current || {}, frameItems(protoJsonRef.current || {}, g), 'delay')) {
        protoTimersRef.current.push(setTimeout(() => { if (slideshowRef.current && slideshowRef.current.idx === idx) runInteractionRef.current && runInteractionRef.current(inter, item); }, Math.max(0, Number(inter.delay) || 800)));
      }
    }
    if (ss.auto) {
      const dur = Math.max(1500, Math.min(60000, Number(slide.durationMs) || 7000));
      slideTimerRef.current = setTimeout(() => goToSlideRef.current && goToSlideRef.current(idx + 1), dur);
    }
  }, [animateViewportTo, groupFitTarget, endSlideshow]);
  useEffect(() => { goToSlideRef.current = goToSlide; }, [goToSlide]);

  const startSlideshow = useCallback((steps, opts = {}) => {
    const groups = jsonGroupsRef.current || [];
    let slides;
    if (steps && steps.length) {
      slides = steps.map((st) => {
        const wanted = st.groupId || st.group;
        const g = groups.find(x => x.id === wanted
          || String(x.title || '').toLowerCase() === String(wanted || '').toLowerCase());
        return g ? { groupId: g.id, title: g.title || '', message: st.message || '', durationMs: st.durationMs } : null;
      }).filter(Boolean);
    } else {
      // Explicit `order` field wins over array order (set via MCP or future UI).
      const ordered = groups.filter(g => !g.section)
        .map((g, i) => ({ g, o: g.order != null ? Number(g.order) : i }))
        .sort((a, b) => a.o - b.o)
        .map(x => x.g);
      slides = ordered.map(g => ({ groupId: g.id, title: g.title || '', message: '' }));
    }
    if (!slides.length) { window.alert(t('canvas.present.noGroups')); return; }
    slideshowWasFullscreenRef.current = fullscreen;
    if (!fullscreen) setFullscreen(true);
    const ss = { slides, idx: 0, auto: !!opts.auto };
    slideshowRef.current = ss;
    setSlideshow(ss);
    // Give the fullscreen relayout a beat before computing the first fit.
    setTimeout(() => goToSlideRef.current && goToSlideRef.current(0), 150);
  }, [fullscreen]);
  const startSlideshowRef = useRef(startSlideshow);
  useEffect(() => { startSlideshowRef.current = startSlideshow; }, [startSlideshow]);

  // Superposición (modal): la pantalla de destino, dibujada como imagen (con su fondo) encima de la actual.
  const overlayRef = useRef(null);
  useEffect(() => { overlayRef.current = overlay; }, [overlay]);
  const openOverlay = async (frameId) => {
    const j = jsonRef.current || {};
    const g = (j.groups || []).find(x => x.id === frameId);
    if (!g) return;
    const items = frameItems(j, g);
    const only = { nodes: new Set(items.filter(i => i.kind === 'n').map(i => i.item.id)), annos: new Set(items.filter(i => i.kind === 'a').map(i => i.item.id)) };
    const r = buildCanvasSvg(await inlineExportImages(), false, only);
    if (!r) return;
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
    const z = viewportRef.current.zoom || 1;
    setOverlay({ src, w: r.w * z, h: r.h * z });
  };
  // Ejecuta una interacción del prototipo. Devuelve el índice del cambio temporal (para deshacerlo al soltar / salir).
  const runInteractionRef = useRef(null);
  runInteractionRef.current = (inter, item) => {
    const ss = slideshowRef.current;
    if (!ss) return null;
    const j = protoJsonRef.current || {};
    const go = (link, anim) => {
      let idx = ss.slides.findIndex(sl => sl.groupId === link);
      if (idx < 0) {
        // La pantalla de destino no está en la presentación: se añade al final y se va a ella.
        const g = (j.groups || []).find(x => x.id === link || String(x.title || '').toLowerCase() === String(link).toLowerCase());
        if (!g) return;
        idx = ss.slides.findIndex(sl => sl.groupId === g.id);
        if (idx < 0) {
          const next = { ...ss, slides: [...ss.slides, { groupId: g.id, title: g.title || '', message: '' }] };
          slideshowRef.current = next; setSlideshow(next); idx = next.slides.length - 1;
        }
      }
      navHistRef.current.push(ss.idx);
      goToSlideRef.current && goToSlideRef.current(idx, anim || 'move');
    };
    switch (inter.action) {
      case 'navigate': go(inter.target, inter.anim); return null;
      case 'overlay': openOverlay(inter.target); return null;
      case 'close': setOverlay(null); return null;
      case 'back': { const prev = navHistRef.current.pop(); if (prev != null) goToSlideRef.current && goToSlideRef.current(prev, inter.anim || 'move'); return null; }
      case 'url': if (inter.target) window.open(String(inter.target), '_blank', 'noopener'); return null;
      case 'scrollTo': {
        const g = (j.groups || []).find(x => x.id === (ss.slides[ss.idx] || {}).groupId);
        const tgt = [...(j.nodes || []), ...(j.annotations || [])].find(x => x.id === inter.target);
        if (!g || !tgt) return null;
        const ty = tgt.bbox ? tgt.bbox.y + (tgt.oy || 0) : canvasNodeRect(tgt).y;
        const want = Math.max(0, ty - (g.y || 0) - 40);
        const d = want - presScrollRef.current;
        const z = viewportRef.current.zoom || 1;
        presScrollRef.current = want; setPresScroll(want);
        setViewport(v => ({ ...v, y: v.y - d * z }));
        return null;
      }
      case 'variant': {
        // La pieza puede ser de una instancia anidada (botón dentro de una tarjeta): manda la instancia más cercana.
        const holder = item && item.cinst ? item : item && item.grp ? [...(j.nodes || []), ...(j.annotations || [])].find(x => x.grp === item.grp && x.cinst) : null;
        if (!holder) return null;
        const inst = holder;
        if (!inst) return null;
        const v = variantsOf(j, inst.cinst).find(x => x.id === inter.target || String(x.variant).toLowerCase() === String(inter.target).toLowerCase());
        if (!v || v.id === inst.cinst) return null;
        const grp = instKey(inst);
        return pushProto((jj) => switchVariant(jj, grp, v.id, (p) => p + 'proto' + grp));
      }
      case 'setVar': {
        const f = findVar(j.vars || {}, inter.var);
        if (!f) return null;
        let val = inter.value;
        if (val === 'toggle' && f.kind === 'bools') { const cur = varValue(j.vars, 'bools', inter.var); val = !(cur === true || cur === 'true'); }
        else if (f.kind === 'nums' && /^[+-]\d/.test(String(val))) val = Number(varValue(j.vars, 'nums', inter.var) || 0) + Number(val);
        return pushProto((jj) => withVar(jj, inter.var, val));
      }
      default: return null;
    }
  };
  // Prototipo: presentando, pulsar un elemento con `link` (el id de un marco) lleva a esa pantalla. Vale con
  // pulsar cualquier pieza de su grupo (un botón y su texto).
  useEffect(() => {
    if (!slideshow) return undefined;
    const root = containerRef.current;
    if (!root) return undefined;
    const itemOf = (el) => {
      const nEl = el.closest && el.closest('[data-node-id]'), aEl = el.closest && el.closest('[data-annotation-id]');
      const j = protoJsonRef.current || {};
      if (aEl) return (j.annotations || []).find(a => a.id === aEl.getAttribute('data-annotation-id')) || null;
      if (nEl) return (j.nodes || []).find(n => n.id === nEl.getAttribute('data-node-id')) || null;
      return null;
    };
    // Lo que hay bajo el puntero, de arriba abajo: un texto encima de un botón no tapa la interacción del botón.
    const hitAt = (e, trigger) => {
      const j = protoJsonRef.current || {};
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (!root.contains(el)) continue;
        const item = itemOf(el);
        if (!item) continue;
        const list = interactionsOf(item, j).filter(x => (trigger ? x.trigger === trigger : true) && condOk(x, j.vars));
        if (list.length) return { item, list };
      }
      return null;
    };
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('.canvas-present-bar, .canvas-present-msg')) return;
      const ss = slideshowRef.current;
      if (!ss) return;
      // Presentando, los clics no editan (como el modo prototipo de Figma): solo siguen interacciones.
      e.preventDefault(); e.stopPropagation();
      if (overlayRef.current) { if (!(e.target.closest && e.target.closest('.canvas-overlay-img'))) setOverlay(null); return; }
      const press = hitAt(e, 'press');
      if (press) {
        const ids = press.list.map(x => runInteractionRef.current(x, press.item)).filter(i => i != null);
        const up = () => { window.removeEventListener('pointerup', up, true); ids.reverse().forEach(i => dropProto(i)); };
        window.addEventListener('pointerup', up, true);
      }
      const hit = hitAt(e, 'click');
      if (!hit) return;
      for (const x of hit.list) runInteractionRef.current(x, hit.item);
    };
    // «Al pasar por encima»: se aplica al entrar y se deshace al salir.
    let hoverOn = null;
    const onHover = (e) => {
      const h = hitAt(e, 'hover');
      const key = h ? (h.item.grp || h.item.id) : null;
      if (hoverOn && hoverOn.key === key) return;
      if (hoverOn) { hoverOn.ids.slice().reverse().forEach(i => dropProto(i)); hoverOn = null; }
      if (h) hoverOn = { key, ids: h.list.map(x => runInteractionRef.current(x, h.item)).filter(i => i != null) };
    };
    const onMove = (e) => { root.style.cursor = hitAt(e, 'click') ? 'pointer' : ''; onHover(e); };
    // Pantalla desplazable (marco con `scroll`): la rueda recorre el contenido que sigue por debajo del marco.
    const onWheel = (e) => {
      const ss = slideshowRef.current; if (!ss) return;
      const g = (jsonGroupsRef.current || []).find(x => x.id === (ss.slides[ss.idx] || {}).groupId);
      if (!g || !g.scroll) return;
      e.preventDefault(); e.stopPropagation();
      const j = jsonRef.current || {};
      const gx = g.x || 0, gw = g.w || CANVAS_GROUP_DEFAULT_W, gy = g.y || 0, gh = g.h || CANVAS_GROUP_DEFAULT_H;
      let bottom = gy + gh;
      for (const n of j.nodes || []) { const r = canvasNodeRect(n); const cx = r.x + r.w / 2; if (cx >= gx && cx <= gx + gw && r.y >= gy) bottom = Math.max(bottom, r.y + r.h); }
      for (const a of j.annotations || []) { if (!a.bbox) continue; const x = a.bbox.x + (a.ox || 0), y = a.bbox.y + (a.oy || 0); const cx = x + a.bbox.w / 2; if (cx >= gx && cx <= gx + gw && y >= gy) bottom = Math.max(bottom, y + a.bbox.h); }
      const max = Math.max(0, bottom - (gy + gh) + 24);
      const z = viewportRef.current.zoom || 1;
      const next = Math.max(0, Math.min(max, presScrollRef.current + e.deltaY / z));
      const d = next - presScrollRef.current;
      if (!d) return;
      presScrollRef.current = next; setPresScroll(next);
      setViewport(v => ({ ...v, y: v.y - d * z }));
    };
    root.addEventListener('wheel', onWheel, { capture: true, passive: false });
    root.addEventListener('pointerdown', onDown, true);
    root.addEventListener('mousedown', (e) => { if (!(e.target.closest && e.target.closest('.canvas-present-bar'))) { e.stopPropagation(); } }, true);
    setSelected(new Set()); setSelAnno(new Set());
    root.addEventListener('pointermove', onMove, true);
    return () => { root.removeEventListener('pointerdown', onDown, true); root.removeEventListener('pointermove', onMove, true); root.removeEventListener('wheel', onWheel, { capture: true }); root.style.cursor = ''; };
  }, [!!slideshow]);

  // Keyboard navigation while presenting (capture phase so the canvas's own
  // shortcuts — Supr, etc. — don't race us).
  useEffect(() => {
    if (!slideshow) return;
    const onKey = (e) => {
      const ss = slideshowRef.current;
      if (!ss) return;
      // Don't hijack typing inside an input/textarea/contenteditable
      // (e.g. editing a node text mid-presentation) — except Esc.
      const tag = e.target && e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
      if (typing && e.key !== 'Escape') return;
      // Interacciones «al pulsar una tecla» de la pantalla actual, antes que la navegación normal.
      if (e.key !== 'Escape') {
        const jj = protoJsonRef.current || {};
        const g = (jj.groups || []).find(x => x.id === (ss.slides[ss.idx] || {}).groupId);
        const hits = g ? frameInteractions(jj, frameItems(jj, g), 'key').filter(h => String(h.inter.key || '').toLowerCase() === e.key.toLowerCase() && condOk(h.inter, jj.vars)) : [];
        if (hits.length) { e.preventDefault(); e.stopPropagation(); for (const h of hits) runInteractionRef.current(h.inter, h.item); return; }
        if (e.key === 'Backspace' && navHistRef.current.length) { e.preventDefault(); e.stopPropagation(); runInteractionRef.current({ action: 'back' }); return; }
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endSlideshow(); }
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation(); goToSlideRef.current(ss.idx + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault(); e.stopPropagation(); goToSlideRef.current(ss.idx - 1);
      } else if (e.key === 'Home') { e.preventDefault(); goToSlideRef.current(0); }
      else if (e.key === 'End') { e.preventDefault(); goToSlideRef.current(ss.slides.length - 1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [!!slideshow]);

  // Expose imperative API for the AI pointer handler. Keyed by note id so
  // multiple canvases in different notes don't collide.
  //
  // Critical: the API is registered once per note id. Refs feed the
  // latest centerOnNode / json.nodes into the closure so the effect does
  // NOT re-run on every viewport tweak — otherwise the first step of a
  // presentation calls setViewport, that rebuilds centerOnNode, that
  // re-triggers the effect, whose cleanup kills the timer scheduled for
  // step 2. (Symptom: AI presentation stuck on step 1.)
  const centerOnNodeRef = useRef(centerOnNode);
  const jsonNodesRef    = useRef(json.nodes);
  useEffect(() => { centerOnNodeRef.current = centerOnNode; }, [centerOnNode]);
  useEffect(() => { jsonNodesRef.current    = json.nodes;   }, [json.nodes]);

  useEffect(() => {
    if (!activeNoteId) return;
    const key = activeNoteId;
    const cancelPresent = () => {
      if (presentTimerRef.current) { clearTimeout(presentTimerRef.current); presentTimerRef.current = null; }
      // A new pointer also cancels a group slideshow in progress (no-op when
      // none is running — endSlideshow guards on its own state).
      if (endSlideshowRef.current) endSlideshowRef.current();
    };
    const api = {
      noteId: activeNoteId,
      // «Seguir al agente»: lleva la vista a la zona que el agente acaba de cambiar (sin acercar más de lo que
      // estaba; solo aleja si no cabe) y muestra quién está trabajando.
      followTo: (bbox, agent) => {
        const rect = containerRef.current && containerRef.current.getBoundingClientRect();
        if (!rect || !bbox) return;
        const v = viewportRef.current, PAD = 80;
        const inView = bbox.x * v.zoom + v.x >= PAD / 2 && bbox.y * v.zoom + v.y >= PAD / 2
          && (bbox.x + bbox.w) * v.zoom + v.x <= rect.width - PAD / 2 && (bbox.y + bbox.h) * v.zoom + v.y <= rect.height - PAD / 2;
        setFollowChip({ agent, at: Date.now() });
        if (inView) return;
        const zoom = Math.max(0.2, Math.min(v.zoom, (rect.width - PAD * 2) / Math.max(1, bbox.w), (rect.height - PAD * 2) / Math.max(1, bbox.h)));
        const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
        animateViewportTo({ zoom, x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom }, 450);
      },
      focusNode: (nodeId, message) => {
        cancelPresent();
        const node = (jsonNodesRef.current || []).find(n => n.id === nodeId);
        if (!node) return;
        centerOnNodeRef.current && centerOnNodeRef.current(node);
        setCanvasCallout({ nodeId, message: message || '', stepIdx: null, stepCount: null });
        setTimeout(() => setCanvasCallout(c => (c && c.nodeId === nodeId) ? null : c), 9000);
      },
      animate: (steps) => {
        cancelPresent();
        if (animRafRef.current) { cancelAnimationFrame(animRafRef.current); animRafRef.current = null; }
        if (animTimerRef.current) { clearTimeout(animTimerRef.current); animTimerRef.current = null; }
        setAnimMap(new Map());
        const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        let stepIdx = 0;
        const playStep = () => {
          if (stepIdx >= steps.length) {
            // Hold final frame briefly, then clear so original styles return.
            animTimerRef.current = setTimeout(() => setAnimMap(new Map()), 400);
            return;
          }
          const s = steps[stepIdx];
          const node = (jsonNodesRef.current || []).find(n => n.id === s.nodeId);
          if (!node) { stepIdx++; playStep(); return; }
          const duration = Math.max(100, Math.min(10000, Number(s.durationMs) || 800));
          const baseDx = (animMapRef.current.get(s.nodeId) || {}).dx || 0;
          const baseDy = (animMapRef.current.get(s.nodeId) || {}).dy || 0;
          const baseScale = (animMapRef.current.get(s.nodeId) || {}).scale || 1;
          const targetDx = s.x != null ? (s.x - node.x) : baseDx;
          const targetDy = s.y != null ? (s.y - node.y) : baseDy;
          const targetScale = s.scale != null ? s.scale : (s.pulse ? 1.18 : baseScale);
          const begin = performance.now();
          const tick = () => {
            const elapsed = performance.now() - begin;
            const tn = Math.min(1, elapsed / duration);
            const e = easeInOutCubic(tn);
            let scaleNow;
            if (s.pulse) {
              scaleNow = tn < 0.5
                ? 1 + (targetScale - 1) * (tn / 0.5)
                : 1 + (targetScale - 1) * ((1 - tn) / 0.5);
            } else {
              scaleNow = baseScale + (targetScale - baseScale) * e;
            }
            const dx = baseDx + (targetDx - baseDx) * e;
            const dy = baseDy + (targetDy - baseDy) * e;
            const cur = animMapRef.current.get(s.nodeId) || {};
            const next = new Map(animMapRef.current);
            next.set(s.nodeId, {
              dx, dy, scale: scaleNow,
              color: s.color != null ? s.color : cur.color,
            });
            animMapRef.current = next;
            setAnimMap(next);
            if (tn < 1) {
              animRafRef.current = requestAnimationFrame(tick);
            } else {
              if (s.pulse) {
                // Pulse settles back to 1 — leave dx/dy/color as-is.
                const cur2 = animMapRef.current.get(s.nodeId) || {};
                const next2 = new Map(animMapRef.current);
                next2.set(s.nodeId, { ...cur2, scale: 1 });
                animMapRef.current = next2;
                setAnimMap(next2);
              }
              stepIdx++;
              animTimerRef.current = setTimeout(playStep, Math.max(0, Math.min(5000, Number(s.gapMs) || 200)));
            }
          };
          animRafRef.current = requestAnimationFrame(tick);
        };
        playStep();
      },
      presentSteps: (steps) => {
        cancelPresent();
        // Lock a single zoom level for the whole walk-through. Otherwise
        // step 1 may clamp the initial zoom into [0.6, 1.4] (causing a
        // visible jump from the user's current scale), while subsequent
        // steps would stay at that clamped value — making only the very
        // first transition feel different. With one fixed zoom every
        // glide is a pure pan.
        const presentZoom = 1;
        let i = 0;
        const play = () => {
          if (i >= steps.length) { setCanvasCallout(null); return; }
          const s = steps[i];
          const node = (jsonNodesRef.current || []).find(n => n.id === s.nodeId);
          if (node) {
            centerOnNodeRef.current && centerOnNodeRef.current(node, { zoom: presentZoom });
            setCanvasCallout({ nodeId: s.nodeId, message: s.message || '', stepIdx: i + 1, stepCount: steps.length });
          }
          i++;
          presentTimerRef.current = setTimeout(play, Math.max(1000, Math.min(60000, Number(s.durationMs) || 6000)));
        };
        play();
      },
      // PowerPoint-style group slideshow (see startSlideshow above). steps
      // may reference groups by id or title; empty steps → all groups in
      // order. opts.auto → advance using each step's durationMs.
      presentGroups: (steps, opts) => {
        cancelPresent();
        if (startSlideshowRef.current) startSlideshowRef.current(steps, opts || {});
      },
      // Ephemeral laser trace along a world-coords polyline — lets the AI
      // point at things without persisting ink. Same fading trail as the
      // user's laser tool.
      laserTrace: (points, opts = {}) => {
        if (!Array.isArray(points) || points.length < 2) return;
        const pts = points.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
        const lens = [];
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
          const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
          lens.push(L); total += L;
        }
        if (!total) return;
        const at = (dist) => {
          let acc = 0;
          for (let i = 0; i < lens.length; i++) {
            if (dist <= acc + lens[i]) {
              const f = lens[i] ? (dist - acc) / lens[i] : 0;
              return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
            }
            acc += lens[i];
          }
          return pts[pts.length - 1];
        };
        const dur = Math.max(400, Math.min(10000, Number(opts.durationMs) || 1600));
        const begin = performance.now();
        const step = () => {
          const tn = Math.min(1, (performance.now() - begin) / dur);
          const p = at(total * tn);
          laserPush(p.x, p.y);
          if (tn < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
    };
    window.__edinotCanvasViews = window.__edinotCanvasViews || {};
    window.__edinotCanvasViews[key] = api;
    return () => {
      cancelPresent();
      if (animRafRef.current) cancelAnimationFrame(animRafRef.current);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      if (window.__edinotCanvasViews) delete window.__edinotCanvasViews[key];
    };
  }, [activeNoteId]);

  const zoomBy = (factor) => setViewport(v => {
    const next = Math.max(0.2, Math.min(3, v.zoom * factor));
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return { ...v, zoom: next };
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const worldX = (cx - v.x) / v.zoom;
    const worldY = (cy - v.y) / v.zoom;
    return { x: cx - worldX * next, y: cy - worldY * next, zoom: next };
  });

  // Annotation virtualization: mirror of the node virtualization below —
  // above ~300 drawings only those whose bbox intersects the viewport render.
  // Selected ones always render so dragging off-screen keeps working.
  const annoFilter = (arr0) => {
    const arr = arr0.some(a => a.hidden) ? arr0.filter(a => !a.hidden) : arr0;   // ocultas desde Capas
    if (arr.length <= 300 || !panSize.w || !panSize.h) return arr;
    const M = 400;
    const vx = -viewport.x / viewport.zoom - M, vy = -viewport.y / viewport.zoom - M;
    const vw = panSize.w / viewport.zoom + M * 2, vh = panSize.h / viewport.zoom + M * 2;
    return arr.filter(a => {
      if (selAnno.has(a.id)) return true;
      const bb = a.bbox;
      if (!bb) return true;
      const ax = bb.x + (a.ox || 0), ay = bb.y + (a.oy || 0);
      return ax < vx + vw && ax + bb.w > vx && ay < vy + vh && ay + bb.h > vy;
    });
  };

  // Render edges as a single SVG layer underneath the nodes. Use simple
  // cubic-bezier control points so backlinks don't visually crash through
  // each other when many tiles cluster in one corner.
  const nodeById = useMemo(() => {
    const m = new Map();
    for (const n of json.nodes || []) m.set(n.id, n);
    return m;
  }, [json]);
  // Las anotaciones-forma y los trazos también son extremos válidos de una arista:
  // un solo conjunto de elementos conectables (fichas + formas), sin migrar datos.
  const annoRects = useMemo(() => {
    const all = new Map(), shapes = new Map();
    for (const a of json.annotations || []) {
      if (!a || !a.id) continue;
      if (a.kind === 'shape' && CANVAS_CLOSED_SHAPE_SET.has(a.shape) && a.w != null) {
        const r = { x: (a.x || 0) + (a.ox || 0), y: (a.y || 0) + (a.oy || 0), w: Math.max(1, a.w), h: Math.max(1, a.h), rot: a.rot || 0 };
        if (a.shape !== 'rect') {   // anclas y corte del conector sobre el contorno real de la forma
          r.insets = shapeInsets(a.shape);
          r.outline = shapeOutline(a.shape, r.x, r.y, r.w, r.h);
        }
        all.set(a.id, r); shapes.set(a.id, r);
      } else if (a.bbox) {
        all.set(a.id, { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: Math.max(1, a.bbox.w), h: Math.max(1, a.bbox.h), rot: 0 });
      }
    }
    return { all, shapes };
  }, [json.annotations]);
  const rectOf = (id) => { const n = nodeById.get(id); return n ? canvasNodeRect(n) : (annoRects.all.get(id) || null); };
  // Obstáculos para el ángulo recto: fichas vecinas (cuadrícula espacial) y formas, sin los extremos.
  const obstaclesFor = (e) => (lo, hi) => {
    const out = nodeGrid.query(lo.x, lo.y, hi.x - lo.x, hi.y - lo.y).filter(n => n.id !== e.from && n.id !== e.to).map(canvasNodeRect);
    for (const [id, r] of annoRects.shapes) {
      if (id === e.from || id === e.to) continue;
      if (r.x < hi.x && r.x + r.w > lo.x && r.y < hi.y && r.y + r.h > lo.y) out.push(r);
    }
    return out;
  };
  // Point where the segment from a node's centre toward `toward` crosses the
  // node's rectangle border — so edges/arrowheads touch the tile instead of
  // diving underneath it toward the centre.
  const rectBorderPoint = (node, toward) => {
    const c = nodeCenter(node);
    const hw = (node.w || CANVAS_DEFAULT_NODE_W) / 2, hh = (node.h || CANVAS_DEFAULT_NODE_H) / 2;
    const dx = toward.x - c.x, dy = toward.y - c.y;
    if (!dx && !dy) return c;
    const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return { x: c.x + dx * s, y: c.y + dy * s };
  };
  const edgePath = (a, b, route) => {
    if (route === 'straight') return `M ${a.x},${a.y} L ${b.x},${b.y}`;
    if (route === 'ortho') {
      if (Math.abs(b.x - a.x) < 8 || Math.abs(b.y - a.y) < 8) return `M ${a.x},${a.y} L ${b.x},${b.y}`;
      const mx = (a.x + b.x) / 2;
      return `M ${a.x},${a.y} L ${mx},${a.y} L ${mx},${b.y} L ${b.x},${b.y}`;
    }
    const dx = (b.x - a.x) * 0.45;
    return `M ${a.x},${a.y} C ${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };

  // Identidad estable para los manejadores que reciben las fichas memoizadas.
  const sStartNodeDrag = useStableFn(startNodeDrag);
  const sSelectNode = useStableFn(selectNode);
  const sDeleteNode = useStableFn(deleteNode);
  const sEditNodeText = useStableFn(editNodeText);
  const sCreateReminder = useStableFn((...a) => onCreateReminder && onCreateReminder(...a));
  const sOpenTile = useStableFn((noteObj, node) => { if (node && node.kind === 'query') onOpenNote(noteObj.id); else setNoteModalId(noteObj.id); });
  const sStartEdgeDraw = useStableFn(startEdgeDraw);
  const sFinishEdgeDraw = useStableFn(finishEdgeDraw);
  const sCreateStickySibling = useStableFn(createStickySibling);
  const sPatchNode = useStableFn(patchNode);
  const sToggleReaction = useStableFn(toggleReaction);
  const sOpenComments = useStableFn((node) => setNodeCommentFor(node.id));

  return (
    <div ref={rootRef} className={`canvas-root${slideshow ? ' canvas-presenting' : ''}${fullscreen ? ' canvas-root-fullscreen' : ''}${surfacePhase ? ' canvas-surface-' + surfacePhase : ''}`} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.code === 'Space') { spaceRef.current = false; setSpaceHeld(false); } }} onPaste={onCanvasPaste}>
      <CanvasNotePicker
        open={notePickerOpen}
        notes={notes}
        vaults={vaults}
        activeNoteId={activeNoteId}
        existingNoteIds={existingNoteIds}
        onPick={addPickedNoteNode}
        onClose={() => { pendingConnectRef.current = null; setNotePickerOpen(false); }} />
      <CanvasNoteModal
        note={noteModal}
        notes={notes}
        syncConfig={syncConfig}
        onClose={() => setNoteModalId(null)}
        onGo={(id) => { setNoteModalId(null); onOpenNote(id); }}
        onUpdateNoteContent={onUpdateNoteContent}
        askPrompt={askPrompt}
        askConfirm={askConfirm} />
      <input ref={attachmentInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleAttachmentFiles} />
      {!exporting && !slideshow && (
        <>
          <CanvasDock tool={tool} setTool={setTool} a={{
            addSticky, addGroup, addNoteNode, addTextNode, addLabelNode, addUrlNode,
            addImageNode, addAttachmentNode, addQueryNode, addShape,
          }} />
          <CanvasActions snapGrid={snapGrid} fullscreen={fullscreen} a={{
            canvasUndo, canvasRedo, doAutoLayout, fitToContent,
            exportCanvasPng: () => exportCanvasPng(), exportCanvasSvg,
            openVersions: activeNoteId ? () => setVerOpen(true) : null,
            startTimer, stopTimer, startVote, endVote, closeVote,
            sessionTimer: !!(session && session.timer), sessionVote: (session && session.vote) || null,
            toggleSnap: () => setSnapGrid(v => !v),
            startSlideshow: () => startSlideshow(null),
            toggleFullscreen: () => setFullscreen(f => !f),
            openShortcuts: () => setShortcutsOpen(true),
            toggleProps: () => setPropsOpen(o => !o), propsOpen,
            rulersOn, toggleRulers: () => setRulersOn(o => !o),
            followAgent, toggleFollow: () => { const nv = !followAgent; try { localStorage.setItem('edinot.followAgent', nv ? '1' : '0'); } catch {} setFollowAgent(nv); window.dispatchEvent(new Event('edinot:follow-changed')); },
          }} />
          <CanvasZoom zoom={viewport.zoom} onIn={() => zoomBy(1.2)} onOut={() => zoomBy(0.83)} onReset={resetZoom} />
        </>
      )}
      {tool === 'eraser' && (
        <div className="canvas-style-bar" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <span className="canvas-style-label">{t('canvas.eraserSize')}</span>
          <input type="range" min="4" max="120" step="2" value={drawStyle.eraser || 18}
            onChange={(e) => setDrawStyle(s => ({ ...s, eraser: Number(e.target.value) }))} style={{ width: 120 }} />
          <span className="canvas-style-num">{drawStyle.eraser || 18}</span>
        </div>
      )}
      {tool === 'eraser' && eraserAt && (
        <div className="canvas-eraser-cursor" aria-hidden="true"
          style={{ position: 'fixed', left: eraserAt.x - (drawStyle.eraser || 18) / 2, top: eraserAt.y - (drawStyle.eraser || 18) / 2, width: drawStyle.eraser || 18, height: drawStyle.eraser || 18 }} />
      )}
      {isDrawTool && tool !== 'eraser' && tool !== 'laser' && (
        <div className="canvas-style-bar" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {CANVAS_PEN_COLORS.map(c => (
            <button key={c} className={`canvas-style-swatch${drawStyle.color === c ? ' on' : ''}`}
              title={t('canvas.penColor')} onClick={() => setDrawStyle(s => ({ ...s, color: c }))}
              style={{ background: c }} />
          ))}
          <label className="canvas-style-custom" title={t('canvas.customColor')} style={{ background: drawStyle.color }}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(drawStyle.color) ? drawStyle.color : '#000000'}
              onChange={(e) => setDrawStyle(s => ({ ...s, color: e.target.value }))} aria-label={t('canvas.customColor')} />
          </label>
          <button className={`fmt-btn${tool === 'picker' ? ' on' : ''}`} title={t('canvas.tool.picker')} aria-label={t('canvas.tool.picker')}
            onClick={() => { if (tool !== 'picker') prevPaintToolRef.current = tool; setTool('picker'); }}>
            <span className="fmt-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 7 3 3M4 20l1.5-4.5L15 6a2.1 2.1 0 0 1 3 3l-9.5 9.5z" /><path d="M16.5 4.5 19.5 7.5" /></svg></span>
          </button>
          {(tool === 'fill' || tool === 'picker') ? null : <span className="fmt-sep" />}
          {tool === 'pen' && (<>
            {(() => {
              const sample = (b, w = 34, h = 18) => (
                <svg width={w} height={h} viewBox="0 0 34 18" aria-hidden="true">
                  <defs dangerouslySetInnerHTML={{ __html: brushFilterSvg(b, 'bp-' + b + w, drawStyle.color) }} />
                  <path d={brushOutlineD(BRUSH_SAMPLE, b === 'spray' ? 1.4 : 2.2, b)} fill={brushFill(b, drawStyle.color)} opacity={brushSpec(b).opacity} filter={brushFilterSvg(b, 'x', '') ? `url(#bp-${b}${w})` : undefined} />
                </svg>
              );
              const cur = inkPrefs.brush || 'pen';
              return (
                <span className="canvas-brushpick">
                  <button type="button" className={`canvas-brush on`} title={t('canvas.brush') + ': ' + t('canvas.brush.' + cur)} aria-haspopup="menu" aria-expanded={brushMenu}
                    onClick={() => setBrushMenu(v => !v)}>{sample(cur)} ▾</button>
                  {brushMenu && (
                    <div className="canvas-brushgrid" role="menu" onMouseLeave={() => setBrushMenu(false)}>
                      {BRUSHES.map(b => (
                        <button key={b} type="button" role="menuitemradio" aria-checked={cur === b} className={`canvas-brush${cur === b ? ' on' : ''}`}
                          onClick={() => { setInkPrefs({ brush: b }); setBrushMenu(false); }}>
                          {sample(b, 56, 30)}<span>{t('canvas.brush.' + b)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              );
            })()}
            <span className="fmt-sep" />
          </>)}
          {!(tool === 'fill' || tool === 'picker') && (<>
          <span className="canvas-style-label">{t('canvas.stroke')}</span>
          <input type="range" min="1" max="24" step="1" value={drawStyle.size}
            onChange={(e) => setDrawStyle(s => ({ ...s, size: Number(e.target.value) }))}
            title={t('canvas.strokeTip')} style={{ width: 90 }} />
          <span className="canvas-style-num">{drawStyle.size}</span>
          {(tool === 'pen' || tool === 'highlighter') && (
            <>
              <span className="fmt-sep" />
              <span className="canvas-style-label">{t('canvas.ink.smooth')}</span>
              <input type="range" min="0" max="10" step="1" value={inkPrefs.stabilize}
                onChange={(e) => setInkPrefs({ stabilize: Number(e.target.value) })} title={t('canvas.ink.smoothTip')} style={{ width: 70 }} />
              {tool === 'pen' && (
                <select className="canvas-style-select" value={String(inkPrefs.gamma)} title={t('canvas.ink.pressureTip')} onChange={(e) => setInkPrefs({ gamma: Number(e.target.value) })}>
                  <option value="0.6">{t('canvas.ink.soft')}</option><option value="1">{t('canvas.ink.normal')}</option><option value="1.6">{t('canvas.ink.firm')}</option>
                </select>
              )}
            </>
          )}
          {tool !== 'highlighter' && (
            <>
              <span className="fmt-sep" />
              <span className="canvas-style-label">{t('canvas.opacity')}</span>
              <input type="range" min="0.1" max="1" step="0.05" value={drawStyle.opacity}
                onChange={(e) => setDrawStyle(s => ({ ...s, opacity: Number(e.target.value) }))}
                title={t('canvas.opacity')} style={{ width: 70 }} />
            </>
          )}
          </>)}
          {CANVAS_CLOSED_SHAPE_SET.has(tool) && (
            <>
              <span className="fmt-sep" />
              <button className={`fmt-btn${drawStyle.fill ? ' on' : ''}`} title={t('canvas.fillToggle')}
                onClick={() => setDrawStyle(s => ({ ...s, fill: !s.fill }))}>
                <span className="fmt-ic"><svg width="14" height="14" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="currentColor" opacity="0.35"/><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg></span>
              </button>
            </>
          )}
        </div>
      )}
      {slideshow && slideshow.slides[slideshow.idx] && (
        <>
          {slideshow.slides[slideshow.idx].message ? (
            <div className="canvas-present-msg" onMouseDown={(e) => e.stopPropagation()}>
              {slideshow.slides[slideshow.idx].message}
            </div>
          ) : null}
          <div className="canvas-present-bar" onMouseDown={(e) => e.stopPropagation()}>
            <button className="canvas-present-btn" onClick={() => goToSlide(slideshow.idx - 1)}
              disabled={slideshow.idx === 0} title={t('canvas.present.prev')}>‹</button>
            <span className="canvas-present-title" title={slideshow.slides[slideshow.idx].title}>
              {slideshow.slides[slideshow.idx].title || t('canvas.present.untitled')}
              <span className="canvas-present-count">{slideshow.idx + 1} / {slideshow.slides.length}</span>
            </span>
            <button className="canvas-present-btn" onClick={() => goToSlide(slideshow.idx + 1)}
              title={t('canvas.present.next')}>›</button>
            <button className="canvas-present-btn canvas-present-close" onClick={endSlideshow}
              title={t('canvas.present.exit')}>✕</button>
          </div>
        </>
      )}
      {renderRulers()}
      {slideshow && overlay && (
        <div className="canvas-overlay" onMouseDown={(e) => { e.stopPropagation(); if (!(e.target.closest && e.target.closest('.canvas-overlay-img'))) setOverlay(null); }}>
          <img className="canvas-overlay-img" src={overlay.src} alt="" style={{ width: overlay.w, height: overlay.h }} />
        </div>
      )}
      {followChip && (
        <div className="canvas-follow-chip" role="status" onMouseDown={(e) => e.stopPropagation()}>
          <span className="canvas-follow-dot" aria-hidden="true" />
          {t('canvas.follow.chip', { who: (followChip.agent && (followChip.agent.alias || followChip.agent.kind)) || t('canvas.follow.agent') })}
          <button type="button" onClick={() => { try { localStorage.setItem('edinot.followAgent', '0'); } catch {} setFollowChip(null); window.dispatchEvent(new Event('edinot:follow-changed')); }}>{t('canvas.follow.stop')}</button>
        </div>
      )}
      {layoutMenu && (() => {
        const g = (json.groups || []).find(x => x.id === layoutMenu.id);
        if (!g) return null;
        const L = g.layout || null;
        const set = (patch) => onChange(j => ({ ...j, groups: (j.groups || []).map(x => {
          if (x.id !== g.id) return x;
          if (patch === null) { const { layout, ...r } = x; return r; }
          return { ...x, layout: { dir: 'column', gap: 16, pad: 16, align: 'start', ...(x.layout || {}), ...patch } };
        }) }));
        const chk = (cond) => (cond ? true : undefined);
        const items = [
          { label: t('canvas.al.none'), checked: chk(!L), onSelect: () => set(null) },
          { label: t('canvas.al.column'), checked: chk(L && L.dir !== 'row'), onSelect: () => set({ dir: 'column' }) },
          { label: t('canvas.al.row'), checked: chk(L && L.dir === 'row'), onSelect: () => set({ dir: 'row' }) },
          { label: t('canvas.al.grid'), checked: chk(L && L.dir === 'grid'), onSelect: () => set({ dir: 'grid', columns: (L && L.columns) || 2 }) },
          ...(L ? [
            { type: 'sep' },
            ...(L.dir === 'grid' ? [
              { label: t('canvas.al.columns'), submenu: () => [1, 2, 3, 4, 5, 6, 8, 12].map(v => ({ label: String(v), checked: chk((L.columns || 2) === v), onSelect: () => set({ columns: v }) })) },
              { label: t('canvas.al.gapY'), submenu: () => [0, 8, 12, 16, 24, 32].map(v => ({ label: `${v} px`, checked: chk((L.gapY ?? L.gap ?? 16) === v), onSelect: () => set({ gapY: v }) })) },
            ] : [
              { label: t('canvas.al.wrap'), checked: chk(L.wrap), onSelect: () => set({ wrap: !L.wrap }) },
              ...(L.wrap ? [{ label: t('canvas.al.gapCross'), submenu: () => [0, 8, 12, 16, 24, 32].map(v => ({ label: `${v} px`, checked: chk((L.gapCross ?? L.gap ?? 16) === v), onSelect: () => set({ gapCross: v }) })) }] : []),
            ]),
            { label: t('canvas.al.gap'), submenu: () => [0, 4, 8, 12, 16, 24, 32, 48].map(v => ({ label: `${v} px`, checked: chk((L.gap ?? 16) === v), onSelect: () => set({ gap: v }) })) },
            { label: t('canvas.al.pad'), submenu: () => [0, 8, 12, 16, 24, 32, 48].map(v => ({ label: `${v} px`, checked: chk((L.pad ?? 16) === v), onSelect: () => set({ pad: v }) })) },
            { label: t('canvas.al.align'), submenu: () => ['start', 'center', 'end'].map(v => ({ label: t('canvas.al.align.' + v), checked: chk((L.align || 'start') === v), onSelect: () => set({ align: v }) })) },
            { label: t('canvas.al.hug'), checked: chk(L.hug), onSelect: () => set({ hug: !L.hug }) },
          ] : []),
          { type: 'sep' },
          ...(() => {
            // Rejillas de guía (como las «layout grids» de Figma): columnas, filas y cuadrícula, combinables.
            const grids = frameGrids(g);
            const setGrids = (fn) => onChange(j => ({ ...j, groups: (j.groups || []).map(x => {
              if (x.id !== g.id) return x;
              const { grid, ...r } = x;
              const next = fn(frameGrids(x));
              return next.length ? { ...r, grids: next } : (({ grids: _g, ...r2 }) => r2)(r);
            }) }));
            const has = (type, v) => grids.some(q => q.type === type && (type === 'grid' ? q.size === v : q.count === v));
            const toggle = (type, v) => setGrids(list => {
              const rest = list.filter(q => q.type !== type);
              return has(type, v) ? rest : [...rest, type === 'grid' ? { type, size: v } : { type, count: v, gutter: 16, margin: 16 }];
            });
            return [{ label: t('canvas.grid.guides'), submenu: () => [
              { type: 'head', label: t('canvas.grid.cols') },
              ...[2, 4, 6, 8, 12].map(c => ({ label: t('canvas.grid.n', { n: c }), checked: chk(has('columns', c)), onSelect: () => toggle('columns', c) })),
              { type: 'head', label: t('canvas.grid.rows') },
              ...[4, 6, 8, 12].map(c => ({ label: t('canvas.grid.nr', { n: c }), checked: chk(has('rows', c)), onSelect: () => toggle('rows', c) })),
              { type: 'head', label: t('canvas.grid.square') },
              ...[8, 16, 24].map(v => ({ label: `${v} px`, checked: chk(has('grid', v)), onSelect: () => toggle('grid', v) })),
              { type: 'sep' },
              { label: t('canvas.grid.none'), onSelect: () => setGrids(() => []) },
            ] }];
          })(),
          { label: t('canvas.exportHtml'), onSelect: () => {
            const html = frameToHtml(json, g);
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            const aEl = document.createElement('a'); aEl.href = url; aEl.download = `${(g.title || 'pantalla').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, '').trim() || 'pantalla'}.html`;
            document.body.appendChild(aEl); aEl.click(); aEl.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
          } },
          { label: t('canvas.al.scroll'), checked: chk(g.scroll), onSelect: () => onChange(j => ({ ...j, groups: (j.groups || []).map(x => x.id === g.id ? (x.scroll ? (({ scroll, ...r }) => r)(x) : { ...x, scroll: true }) : x) })) },
          { label: t('canvas.resp.open'), onSelect: () => setRespPrev({ id: g.id, rect: frameRect(g), w: frameRect(g).w }) },
          { label: t('canvas.section'), checked: chk(g.section), onSelect: () => onChange(j => ({ ...j, groups: (j.groups || []).map(x => x.id === g.id ? (x.section ? (({ section, ...r }) => r)(x) : { ...x, section: true }) : x) })) },
        ];
        return <Menu anchor={layoutMenu.anchor} items={items} onClose={() => setLayoutMenu(null)} minWidth={230} label={t('canvas.autolayout')} className="cv-menu" />;
      })()}
      {propsOpen && (
        <CanvasPropsPanel json={json} selected={selected} selAnno={selAnno} onChange={onChange} onClose={() => setPropsOpen(false)}
          library={library}
          onExport={exportSelection}
          pages={pageList} curPage={curPage || (pageList[0] && pageList[0].id) || null} onSetPage={(id) => { setPage(id); setSelected(new Set()); setSelAnno(new Set()); }}
          onAddPage={() => { const nm = window.prompt(t('canvas.page.name'), t('canvas.page.n', { n: Math.max(2, pageList.length + 1) })); if (!nm) return; let nid = null; onChangeRaw(j => { const r = addPage(j, nm, undefined, t('canvas.page.n', { n: 1 })); nid = r.id; return r.json; }); setTimeout(() => nid && setPage(nid), 0); }}
          onRenamePage={(id, nm) => onChangeRaw(j => renamePage(j, id, nm))}
          onRemovePage={async (id) => { const ok = askConfirm ? await askConfirm(t('canvas.page.delAsk')) : window.confirm(t('canvas.page.delAsk')); if (ok) onChangeRaw(j => removePage(j, id)); }}
          cropEdit={cropEdit} onCropEdit={setCropEdit}
          onSetInstanceProp={(grp, name, value) => onChange(j => syncInstances(setInstanceProp(j, grp, name, value, library), library))}
          onInsertLib={(entry) => { const c = canvasCenter(200, 80); const r = insertFromLibrary(json, entry, c, (p) => (p === 'n' ? canvasNodeId() : canvasAnnoId())); if (r.ids) { onChange(() => r.json); setSelected(new Set(r.ids.nodes)); setSelAnno(new Set(r.ids.annos)); } }}
          onRemoveLib={(id) => yMeta.set('componentLibrary', library.filter(e => e.id !== id))}
          uploadImage={onUploadAttachment ? async (file) => { const info = await onUploadAttachment(file); return info ? (info.url || (info.sha ? `edinot://blob/${info.sha}` : '')) : ''; } : null}
          select={(it, add) => {
            if (it.type === 'n') { setSelected(s => { const n = new Set(add ? s : []); n.add(it.id); return n; }); if (!add) setSelAnno(new Set()); }
            else { setSelAnno(s => { const n = new Set(add ? s : []); n.add(it.id); return n; }); if (!add) setSelected(new Set()); }
          }} />
      )}
      {!slideshow && (selected.size >= 1 || selAnno.size >= 1) && (
        <div className="canvas-sel-bar" onMouseDown={(e) => e.stopPropagation()}>
          {/* Node color swatches — sticky pastels when the whole selection is stickies */}
          {(() => {
            const selNodes = (json.nodes || []).filter(n => selected.has(n.id));
            const allSticky = selNodes.length > 0 && selNodes.every(n => n.sticky) && selAnno.size === 0;
            // La misma paleta que el lápiz (y «otro color»), para que los colores coincidan en todo el canvas.
            const palette = allSticky ? CANVAS_STICKY_COLORS : CANVAS_PEN_COLORS;
            return (<>
              {palette.map(c => (
                <button key={c} className="canvas-sel-swatch" title={t('canvas.sel.color')}
                  onClick={() => colorSelected(c)} style={{ background: c }} />
              ))}
              {!allSticky && (
                <label className="canvas-style-custom" title={t('canvas.customColor')}>
                  <input type="color" defaultValue="#2383e2" onChange={(e) => colorSelected(e.target.value)} aria-label={t('canvas.customColor')} />
                </label>
              )}
            </>);
          })()}
          <button className="fmt-btn" title={t('canvas.sel.noColor')} onClick={() => colorSelected(null)}><span className="fmt-ic"><VIcon name="noColor" /></span></button>
          {/* Annotation style controls (fill / dash / width / opacity) */}
          {selAnno.size >= 1 && (() => {
            const annos = (json.annotations || []).filter(a => selAnno.has(a.id));
            const first = annos[0] || {};
            const anyClosed = annos.some(a => a.kind === 'shape' && CANVAS_CLOSED_SHAPE_SET.has(a.shape));
            const dashOf = first.dash || 'solid';
            return (
              <>
                {anyClosed && (
                  <>
                    <span className="fmt-sep" />
                    <span className="canvas-style-label">{t('canvas.fill')}</span>
                    {CANVAS_PEN_COLORS.map(c => (
                      <button key={'f' + c} className="canvas-sel-swatch canvas-sel-fillswatch" title={t('canvas.fill')}
                        onClick={() => fillSelectedAnnotations(canvasFillFromHex(c))}
                        style={{ background: canvasFillFromHex(c, 0.45), borderColor: c }} />
                    ))}
                    <button className="fmt-btn" title={t('canvas.fillNone')} onClick={() => fillSelectedAnnotations(null)}><span className="fmt-ic"><VIcon name="noColor" /></span></button>
                  </>
                )}
                <span className="fmt-sep" />
                <button title={t('canvas.edgeSolid')} className={`canvas-edge-opt ${dashOf === 'solid' ? 'on' : ''}`} onClick={() => patchSelectedAnnotations({ dash: null })}>━</button>
                <button title={t('canvas.edgeDashed')} className={`canvas-edge-opt ${dashOf === 'dashed' ? 'on' : ''}`} onClick={() => patchSelectedAnnotations({ dash: 'dashed' })}>╌</button>
                <button title={t('canvas.edgeDotted')} className={`canvas-edge-opt ${dashOf === 'dotted' ? 'on' : ''}`} onClick={() => patchSelectedAnnotations({ dash: 'dotted' })}>┄</button>
                {(json.annotations || []).some(a => selAnno.has(a.id) && a.kind === 'shape') && (
                  <button title={t('canvas.sketch')} className={`canvas-edge-opt ${first.sketch ? 'on' : ''}`} onClick={() => patchSelectedAnnotations({ sketch: first.sketch ? null : true })}>✎</button>
                )}
                <span className="fmt-sep" />
                <span className="canvas-style-label">{t('canvas.stroke')}</span>
                <input type="range" min="1" max="24" step="1" value={first.strokeWidth || 2}
                  onChange={(e) => patchSelectedAnnotations({ strokeWidth: Number(e.target.value) })}
                  title={t('canvas.strokeTip')} style={{ width: 70 }} />
                <span className="canvas-style-label">{t('canvas.opacity')}</span>
                <input type="range" min="0.1" max="1" step="0.05" value={first.opacity != null ? first.opacity : 1}
                  onChange={(e) => patchSelectedAnnotations({ opacity: Number(e.target.value) })}
                  title={t('canvas.opacity')} style={{ width: 60 }} />
              </>
            );
          })()}
          <span className="fmt-sep" />
          <button className="fmt-btn" title={t('canvas.sel.duplicate')} onClick={duplicateSelected}><span className="fmt-ic"><VIcon name="duplicate" /></span></button>
          <button className="fmt-btn" title={t('cv.more')} aria-haspopup="menu" aria-expanded={!!selMenu}
            onClick={(e) => setSelMenu(e.currentTarget.getBoundingClientRect())}><span className="fmt-ic">⋯</span></button>
          {selMenu && (() => {
            const n = selected.size;
            const units = selected.size + selAnno.size;
            const items = [
              ...(units >= 2 ? [
                { label: t('canvas.sel.alignLeft'), onSelect: () => alignSelected('left') },
                { label: t('canvas.sel.alignHCenter'), onSelect: () => alignSelected('hcenter') },
                { label: t('canvas.sel.alignRight'), onSelect: () => alignSelected('right') },
                { label: t('canvas.sel.alignTop'), onSelect: () => alignSelected('top') },
                { label: t('canvas.sel.alignVCenter'), onSelect: () => alignSelected('vcenter') },
                { label: t('canvas.sel.alignBottom'), onSelect: () => alignSelected('bottom') },
                ...(units >= 3 ? [{ label: t('canvas.sel.distH'), onSelect: () => distributeSelected('h') }, { label: t('canvas.sel.distV'), onSelect: () => distributeSelected('v') }] : []),
                { label: t('canvas.sel.tidy'), onSelect: tidySelected },
                { label: t('canvas.sel.spacing'), onSelect: spaceSelected },
                { type: 'sep' },
              ] : []),
              ...(units === 1 ? [{ label: t('canvas.sel.same'), submenu: () => SAME_KINDS.map(k => ({ label: t('canvas.same.' + k), onSelect: () => selectSameAs(k) })) }, { type: 'sep' }] : []),
              // «Recortar»: la de más abajo (en el orden de apilado) recorta a las demás. Solo si esa es una forma cerrada.
              ...(() => {
                if (selAnno.size < 2) return [];
                const ord = mergedOrder(json).filter(it => it.type === 'a' && selAnno.has(it.id)).map(it => it.id);
                if (!applyMask(json, ord)) return [];
                return [{ label: t('canvas.sel.mask'), onSelect: () => onChange(j => applyMask(j, ord) || j) }];
              })(),
              ...([...selAnno].some(id => { const x = annoById.get(id); return x && (x.clipTo || x.clip); }) ? [{ label: t('canvas.sel.unmask'), onSelect: () => onChange(j => releaseMask(j, [...selAnno])) }] : []),
              { type: 'sep' },
              ...(() => {
                // Combinar formas (booleanas): la de más abajo es la base (restar le quita las demás).
                if (selected.size || selAnno.size < 2) return [];
                const ord = mergedOrder(json).filter(it => it.type === 'a' && selAnno.has(it.id)).map(it => annoById.get(it.id)).filter(Boolean);
                if (ord.length < 2 || !ord.every(canBoolean)) return [];
                const run = (op) => {
                  const res = booleanOp(op, ord);
                  const ids = new Set(ord.map(x => x.id));
                  if (!res) { onChange(j => ({ ...j, annotations: (j.annotations || []).filter(x => !ids.has(x.id)) })); setSelAnno(new Set()); return; }
                  const nid = canvasAnnoId();
                  onChange(j => {
                    const list = j.annotations || [];
                    const at = list.findIndex(x => x.id === ord[0].id);
                    const next = list.filter(x => !ids.has(x.id));
                    next.splice(Math.max(0, Math.min(at, next.length)), 0, { ...res, id: nid });
                    return { ...j, annotations: next };
                  });
                  setSelAnno(new Set([nid]));
                };
                return [{ label: t('canvas.bool.menu'), submenu: () => [
                  { label: t('canvas.bool.union'), onSelect: () => run('union') },
                  { label: t('canvas.bool.subtract'), onSelect: () => run('subtract') },
                  { label: t('canvas.bool.intersect'), onSelect: () => run('intersect') },
                  { label: t('canvas.bool.exclude'), onSelect: () => run('exclude') },
                ] }];
              })(),
              ...(() => {
                // Vectores: editar puntos, convertir una forma en trazo editable, voltear.
                if (selected.size || selAnno.size !== 1) return [];
                const a1 = (json.annotations || []).find(x => selAnno.has(x.id));
                if (!a1) return [];
                const out = [];
                if (a1.kind === 'path' && !a1.variant && a1.d) out.push({ label: t('canvas.vec.edit'), onSelect: () => setVecEdit(a1.id) });
                if (a1.kind === 'shape' && CANVAS_CLOSED_SHAPE_SET.has(a1.shape)) out.push({ label: t('canvas.vec.convert'), onSelect: () => { onChange(j => ({ ...j, annotations: (j.annotations || []).map(x => x.id === a1.id ? toVector(x) : x) })); setVecEdit(a1.id); } });
                if (a1.kind === 'path' && a1.d) {
                  const flip = (sx, sy) => onChange(j => ({ ...j, annotations: (j.annotations || []).map(x => {
                    if (x.id !== a1.id) return x;
                    const b = x.bbox || pathBbox(normalizePath(x.d)); if (!b) return x;
                    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
                    const cm = normalizePath(x.d);
                    const m = [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
                    return { ...x, d: transformPath(cm, m), ...(x.pts ? { pts: x.pts.map(p => [m[0] * p[0] + m[4], m[3] * p[1] + m[5], p[2]]) } : {}) };
                  }) }));
                  out.push({ label: t('canvas.vec.flipH'), onSelect: () => flip(-1, 1) }, { label: t('canvas.vec.flipV'), onSelect: () => flip(1, -1) });
                }
                return out;
              })(),
              ...(() => {
                // Componentes: crear desde la selección, poner otra instancia, desvincular.
                const items = [...(json.nodes || []).filter(x => selected.has(x.id)), ...(json.annotations || []).filter(x => selAnno.has(x.id))];
                const cid = (items.find(x => x.cmain) || {}).cmain || (items.find(x => x.cinst) || {}).cinst;
                const out = [];
                if (!cid) out.push({ label: t('canvas.cmp.create'), onSelect: async () => {
                  const nm = await askPrompt(t('canvas.cmp.name'), t('canvas.cmp.default'));
                  if (nm == null) return;
                  const r = createComponent(json, [...selected], [...selAnno], nm.trim() || t('canvas.cmp.default'));
                  if (r.id) onChange(() => r.json);
                } });
                else {
                  out.push({ label: t('canvas.cmp.instance'), onSelect: () => {
                    const r = insertInstance(json, cid, null, (p) => (p === 'n' ? canvasNodeId() : canvasAnnoId()));
                    if (r.ids) { onChange(() => r.json); setSelected(new Set(r.ids.nodes)); setSelAnno(new Set(r.ids.annos)); }
                  } });
                  if (items.some(x => x.cinst)) out.push({ label: t('canvas.cmp.detach'), onSelect: () => onChange(j => detachInstances(j, [...selected], [...selAnno])) });
                  if (items.some(x => x.cinst)) out.push({ label: t('canvas.cmp.reset'), onSelect: () => { const g = instKey(items.find(x => x.cinst)); onChange(j => resetOverrides(j, g, library)); } });
                  if (items.some(x => x.cmain)) out.push({ label: library.some(e => e.id === cid) ? t('canvas.lib.update') : t('canvas.lib.publish'), onSelect: () => {
                    const entry = libraryEntryFrom(json, cid);
                    if (entry) yMeta.set('componentLibrary', publishToLibrary(library, entry));
                  } });
                  if (items.some(x => x.cmain)) out.push({ label: t('canvas.cmp.addVariant'), onSelect: async () => {
                    const nm = await askPrompt(t('canvas.cmp.variantName'), '');
                    if (!nm) return;
                    const r = addVariant(json, cid, nm.trim(), (p) => (p === 'n' ? canvasNodeId() : canvasAnnoId()));
                    if (r.id) onChange(() => r.json);
                  } });
                  const inst = items.find(x => x.cinst);
                  const vars2 = inst ? variantsOf(json, inst.cinst) : [];
                  if (inst && vars2.length > 1) out.push({ label: t('canvas.cmp.variant'), submenu: () => vars2.map(v => ({ label: v.variant, checked: v.id === inst.cinst ? true : undefined,
                    onSelect: () => onChange(j => syncInstances(switchVariant(j, instKey(inst), v.id, (p) => (p === 'n' ? canvasNodeId() : canvasAnnoId())))) })) });
                  // Cambiar la instancia por otro componente (instance swap): se queda en su sitio con sus textos.
                  const others = inst ? listComponents(json).filter(c => c.id !== inst.cinst && !vars2.some(v => v.id === c.id)) : [];
                  if (inst && others.length) out.push({ label: t('canvas.cmp.swap'), submenu: () => others.map(c => ({ label: c.name,
                    onSelect: () => onChange(j => syncInstances(switchVariant(j, instKey(inst), c.id, (p) => (p === 'n' ? canvasNodeId() : canvasAnnoId())), library)) })) });
                }
                return out;
              })(),
              ...((json.groups || []).length ? [{ label: t('canvas.sel.link'), submenu: () => [
                ...orderedFrames(json).map(g => ({ label: g.title || t('canvas.present.untitled'), onSelect: () => onChange(j => ({ ...j,
                  nodes: (j.nodes || []).map(x => selected.has(x.id) ? { ...x, link: g.id } : x),
                  annotations: (j.annotations || []).map(x => selAnno.has(x.id) ? { ...x, link: g.id } : x) })) })),
                { type: 'sep' },
                { label: t('canvas.sel.unlink'), onSelect: () => onChange(j => ({ ...j,
                  nodes: (j.nodes || []).map(x => (selected.has(x.id) && x.link) ? (({ link, ...r }) => r)(x) : x),
                  annotations: (j.annotations || []).map(x => (selAnno.has(x.id) && x.link) ? (({ link, ...r }) => r)(x) : x) })) },
              ] }] : []),
              ...(pageList.length > 1 ? [{ label: t('canvas.page.moveTo'), submenu: () => pageList.filter(p => p.id !== curPage).map(p => ({ label: p.name, onSelect: () => { onChangeRaw(j => moveToPage(j, { nodes: [...selected], annos: [...selAnno] }, p.id)); setSelected(new Set()); setSelAnno(new Set()); } })) }] : []),
              ...(!n && selAnno.size >= 1 && [...selAnno].some(id => { const x = (json.annotations || []).find(y => y.id === id); return x && outlineStroke(x); }) ? [{ label: t('canvas.sel.outline'), onSelect: () => onChange(j => {
                // Contorno del trazo: el borde pasa a ser una figura rellena; la pieza original se queda solo con su relleno.
                const added = [], keep = [];
                for (const x of j.annotations || []) {
                  if (!selAnno.has(x.id)) { keep.push(x); continue; }
                  const o = outlineStroke(x);
                  if (!o) { keep.push(x); continue; }
                  const hasFill = (x.fill && x.fill !== 'none') || x.gradient || (x.imageFill && x.imageFill.src);
                  if (hasFill && x.kind === 'shape' && x.shape !== 'line' && x.shape !== 'arrow') keep.push({ ...x, color: 'none' });
                  added.push({ ...o, id: canvasAnnoId(), grp: x.grp, z: (x.z != null ? x.z : 0) + 0.001 });
                }
                return { ...j, annotations: [...keep, ...added] };
              }) }] : []),
              ...(n + selAnno.size === 1 ? [{ label: t('canvas.sel.copyCss'), onSelect: () => {
                const el = n ? (json.nodes || []).find(x => selected.has(x.id)) : (json.annotations || []).find(x => selAnno.has(x.id));
                try { navigator.clipboard.writeText(itemCssText(el)); } catch {}
              } }] : []),
              { label: t('canvas.sel.copySvg'), onSelect: async () => {
                const r = buildCanvasSvg(await inlineExportImages(), false, { nodes: new Set(selected), annos: new Set(selAnno) });
                if (r) { try { await navigator.clipboard.writeText(r.svg); } catch {} }
              } },
              { type: 'sep' },
              { label: t('canvas.sel.front'), onSelect: () => reorderSelected(true) },
              { label: t('canvas.sel.back'), onSelect: () => reorderSelected(false) },
              { label: '🔒 Alt+L', onSelect: toggleLockSelected },
              { label: 'Ctrl+G', onSelect: () => groupSelected(false) },
              ...(n >= 1 ? [
                { type: 'sep' },
                ...['👍', '❤️', '⭐', '❓'].map(em => ({ label: t('canvas.sel.react', { emoji: em }), onSelect: () => reactSelected(em) })),
                ...(n === 1 ? [{ label: '💬 ' + t('canvas.sel.comment'), onSelect: () => setNodeCommentFor(Array.from(selected)[0]) }] : []),
              ] : []),
            ];
            return <Menu anchor={selMenu} items={items} onClose={() => setSelMenu(null)} minWidth={210} label={t('cv.more')} className="cv-menu" />;
          })()}
        </div>
      )}
      <div className={`canvas-pan-area${dragHover ? ' drag-over' : ''}${isDrawTool ? ' draw-mode' : ''}${isDrawTool && tool !== 'eraser' ? ' canvas-drawing' : ''}${tool === 'eraser' ? ' canvas-erasing' : ''} canvas-tool-${tool}`}
        ref={containerRef}
        onPointerDown={onCanvasPointerDown}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={(e) => { if (tool === 'eraser') setEraserAt({ x: e.clientX, y: e.clientY }); const pr = presenceRef.current; if (pr) { const w = screenToWorld(e.clientX, e.clientY); pr.publishCursor(w.x, w.y); } }}
        onMouseLeave={() => { if (presenceRef.current) presenceRef.current.clearCursor(); }}
        onDoubleClick={onCanvasDoubleClick}
        onDragEnter={onCanvasDragEnter}
        onDragOver={onCanvasDragOver}
        onDragLeave={onCanvasDragLeave}
        onDrop={onCanvasDrop}>
        {spaceHeld && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 90, cursor: panning ? 'grabbing' : 'grab' }}
            onMouseDown={(e) => {
              e.preventDefault(); e.stopPropagation(); setPanning(true);
              const sx = e.clientX, sy = e.clientY, v0 = { ...viewportRef.current };
              const mv = (ev) => { if (ev.buttons === 0) { up(); return; } setViewport(v => ({ ...v, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy })); };
              const up = () => { setPanning(false); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
              window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
            }} />
        )}
        <canvas ref={lodCanvasRef} className="canvas-lod" aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        {session && (session.timer || session.vote) && (
          <div className="canvas-session" onMouseDown={(e) => e.stopPropagation()}>
            {session.timer && (() => {
              const tm = session.timer;
              const left = tm.pausedLeft != null ? tm.pausedLeft : Math.max(0, tm.endsAt - nowTick);
              const done = left <= 0;
              const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
              return (
                <div className={`cs-timer${done ? ' done' : ''}${tm.pausedLeft != null ? ' paused' : ''}`}>
                  <span className="cs-time">{done ? t('canvas.timer.done') : `${mm}:${String(ss).padStart(2, '0')}`}</span>
                  {!done && <button type="button" onClick={pauseTimer}>{tm.pausedLeft != null ? '▶' : '❚❚'}</button>}
                  <button type="button" onClick={addMinute} title={t('canvas.timer.plus')}>+1</button>
                  <button type="button" onClick={stopTimer} aria-label={t('btn.close')}>×</button>
                </div>
              );
            })()}
            {session.vote && (
              <div className="cs-vote">
                {session.vote.open
                  ? <>🗳 <span>{t('canvas.vote.left', { n: Math.max(0, (session.vote.perUser || 3) - myVotes), of: session.vote.perUser || 3 })}</span>
                      <button type="button" onClick={endVote}>{t('canvas.vote.end')}</button></>
                  : <>🏁 <span>{t('canvas.vote.results', { n: (json.nodes || []).reduce((a, n) => a + (n.votes || []).length, 0) })}</span>
                      <button type="button" onClick={closeVote}>{t('canvas.vote.close')}</button></>}
              </div>
            )}
          </div>
        )}
        {verOpen && (
          <div className="canvas-ver" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <div className="canvas-ver-h">
              <b>{t('canvas.ver.title')}</b>
              <button type="button" className="cvp-x" title={t('btn.close')} onClick={() => { leaveVersion(); setVerOpen(false); }}>×</button>
            </div>
            <button type="button" className="cvp-add" onClick={() => {
              const nm = window.prompt(t('canvas.ver.name'), '');
              if (nm == null) return;
              saveCanvasVersion(activeNoteId, { name: nm, author: myIdentity || null, data: jsonProp });
            }}>+ {t('canvas.ver.save')}</button>
            {verView && (
              <div className="canvas-ver-viewing">
                {t('canvas.ver.viewing', { name: verView.name })}
                <div className="cvp-modes">
                  <button type="button" className="cvp-chip on" onClick={() => restoreVersion(verView.id)}>{t('canvas.ver.restore')}</button>
                  <button type="button" className="cvp-chip" onClick={leaveVersion}>{t('canvas.ver.back')}</button>
                </div>
              </div>
            )}
            <ul className="canvas-ver-list">
              {verList.length === 0 && <li className="cvp-empty">{t('canvas.ver.empty')}</li>}
              {verList.map(v => (
                <li key={v.id} className={verView && verView.id === v.id ? 'on' : ''}>
                  <button type="button" className="canvas-ver-item" onClick={() => viewVersion(v)}>
                    <span className="canvas-ver-name">{v.name}</span>
                    <span className="canvas-ver-meta">{new Date(v.ts).toLocaleString()}{v.author ? ' · ' + v.author : ''}</span>
                  </button>
                  <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => { if (verView && verView.id === v.id) leaveVersion(); deleteCanvasVersion(activeNoteId, v.id); }}>×</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {respPrev && (() => {
          // Vista previa adaptable: el marco cambia de ancho en vivo (restricciones y auto layout), sin guardar.
          const setW = (w) => {
            const W = Math.max(120, Math.round(w));
            setRespPrev(r => ({ ...r, w: W }));
            const r0 = respPrev.rect;
            previewChange(j => applyAutoLayout(applyConstraints({ ...j, groups: (j.groups || []).map(g => (g.id === respPrev.id ? { ...g, w: W } : g)) }, respPrev.id, r0, { ...r0, w: W })));
          };
          const close = () => { if (draftRafRef.current) { cancelAnimationFrame(draftRafRef.current); draftRafRef.current = 0; } draftRef.current = null; setDraft(null); setRespPrev(null); };
          return (
            <div className="canvas-resp" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
              <span className="canvas-resp-t">{t('canvas.resp.title')}</span>
              {[['375', t('canvas.resp.mobile')], ['768', t('canvas.resp.tablet')], ['1280', t('canvas.resp.desktop')]].map(([w, l]) => (
                <button key={w} type="button" className={`cvp-chip${respPrev.w === Number(w) ? ' on' : ''}`} onClick={() => setW(Number(w))}>{l}</button>
              ))}
              <input type="range" min="240" max="1600" step="1" value={respPrev.w} onChange={(e) => setW(Number(e.target.value))} />
              <span className="canvas-resp-w">{respPrev.w}px</span>
              <button type="button" className="cvp-chip" onClick={() => setW(respPrev.rect.w)}>{t('canvas.resp.reset')}</button>
              <button type="button" className="cvp-chip on" onClick={() => { commitPreview(); setRespPrev(null); }}>{t('canvas.resp.apply')}</button>
              <button type="button" className="cvp-x" title={t('btn.close')} onClick={close}>×</button>
            </div>
          );
        })()}
        {find && (
          <div className="canvas-find edinot-search" role="search" onMouseDown={(e) => e.stopPropagation()}>
            <div className="es-row es-row-find">
              <span className="es-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </span>
              <input ref={findInputRef} autoFocus type="text" className="es-find" value={find.q} placeholder={t('canvas.find.ph')} aria-label={t('canvas.find.ph')} spellCheck={false}
                onChange={(e) => setFind({ q: e.target.value, i: 0 })}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') { e.preventDefault(); goFind((find.i || 0) + (e.shiftKey ? -1 : (findHits.length && find.started ? 1 : 0))); setFind(f => ({ ...f, started: true })); }
                  else if (e.key === 'Escape') { e.preventDefault(); setFind(null); focusCanvas(); }
                  else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); e.currentTarget.select(); }
                }} />
              <span className={`es-count${find.q.trim() && !findHits.length ? ' zero' : ''}`} aria-live="polite">
                {find.q.trim() ? (findHits.length ? countLabel(t, (find.i || 0) + 1, findHits.length) : t('canvas.find.none')) : ''}
              </span>
              <div className="es-nav">
                <button type="button" className="es-icon-btn es-prev" title={t('search.prevHint')} aria-label={t('search.prev')} disabled={!findHits.length} onClick={() => goFind((find.i || 0) - 1)}>
                  <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
                </button>
                <button type="button" className="es-icon-btn es-next" title={t('search.nextHint')} aria-label={t('search.next')} disabled={!findHits.length} onClick={() => goFind((find.i || 0) + 1)}>
                  <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
                </button>
              </div>
              <button type="button" className={`es-icon-btn${find.rep ? ' on' : ''}`} title={t('canvas.find.replace')} aria-label={t('canvas.find.replace')} onClick={() => setFind(f => ({ ...f, rep: !f.rep }))}>⇄</button>
              <button type="button" className="es-icon-btn es-close" title={t('search.closeHint')} aria-label={t('btn.close')} onClick={() => { setFind(null); focusCanvas(); }}>
                <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </div>
            {find.rep && (
              <div className="es-row es-row-find">
                <input type="text" className="es-find" value={find.r || ''} placeholder={t('canvas.find.with')} spellCheck={false}
                  onChange={(e) => { const v = e.target.value; setFind(f => ({ ...f, r: v })); }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); setFind(null); focusCanvas(); } }} />
                <button type="button" className="es-btn" disabled={!findHits.length} onClick={() => {
                  const h = findHits[find.i || 0];
                  if (!h || h.kind === 'page') return;
                  const key = (h.kind === 'node' ? 'n:' : h.kind === 'anno' ? 'a:' : 'g:') + h.id;
                  onChange(j => replaceText(j, find.q, find.r || '', { only: new Set([key]) }).json);
                }}>{t('canvas.find.one')}</button>
                <button type="button" className="es-btn" disabled={!findHits.length} onClick={() => onChange(j => replaceText(j, find.q, find.r || '').json)}>{t('canvas.find.all')}</button>
              </div>
            )}
          </div>
        )}
        <div className="canvas-world" ref={worldRef}
          style={{ transformOrigin: '0 0' }}>
          {session && session.vote && (json.nodes || []).filter(n => !hiddenIds.has(n.id) && n.kind !== 'label').map(n => {
            const r = canvasNodeRect(n);
            const votes = n.votes || [];
            const mine = votes.includes(myIdentity);
            const open = session.vote.open;
            const count = open ? (mine ? 1 : 0) : votes.length;
            if (!open && !votes.length) return null;
            return (
              <button key={'v' + n.id} type="button" className={`canvas-vote${mine ? ' mine' : ''}${open ? '' : ' result'}`}
                style={{ left: r.x - 14, top: r.y - 14 }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); if (open) toggleVote(n.id); }}
                title={open ? t('canvas.vote.tip') : ''}>
                {open ? (mine ? '✓' : '+') : votes.length}
              </button>
            );
          })}
          {find && findHits.map((h, k) => (
            <div key={h.kind + h.id + ':' + k} className={`canvas-find-hit${k === (find.i || 0) ? ' on' : ''}`}
              style={{ left: h.rect.x - 6, top: h.rect.y - 6, width: h.rect.w + 12, height: h.rect.h + 12 }} />
          ))}
          {marquee && (
            <div style={{
              position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h,
              border: '1px solid var(--accent, #2383E2)', background: 'color-mix(in srgb, var(--accent, #2383E2) 10%, transparent)',
              pointerEvents: 'none', zIndex: 50, borderRadius: 2,
            }} />
          )}
          {!slideshow && (json.groups || []).flatMap(g => frameGrids(g).map((q, qi) => {
            // Rejillas de guía del marco: solo al editar.
            const gx = g.x || 0, gy = (g.y || 0) + 26, gw = g.w || CANVAS_GROUP_DEFAULT_W, gh = (g.h || CANVAS_GROUP_DEFAULT_H) - 26;
            const tint = 'rgba(224, 69, 123, 0.08)';
            if (q.type === 'grid') {
              const sz = Math.max(2, q.size || 8);
              return <div key={g.id + 'sq' + qi} style={{ position: 'absolute', left: gx, top: gy, width: gw, height: gh, pointerEvents: 'none', zIndex: 2,
                backgroundImage: `linear-gradient(to right, rgba(224,69,123,.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(224,69,123,.18) 1px, transparent 1px)`, backgroundSize: `${sz}px ${sz}px` }} />;
            }
            return gridBands(q, q.type === 'rows' ? gh : gw).map((b, bi) => (
              <div key={g.id + q.type + qi + '-' + bi} style={q.type === 'rows'
                ? { position: 'absolute', left: gx, top: gy + b.start, width: gw, height: b.size, background: tint, pointerEvents: 'none', zIndex: 2 }
                : { position: 'absolute', left: gx + b.start, top: gy, width: b.size, height: gh, background: tint, pointerEvents: 'none', zIndex: 2 }} />
            ));
          }))}
          {!slideshow && ['v', 'h'].flatMap(axis => (((json.vars && json.vars.guides) || {})[axis] || []).map((pos, i) => (
            guideDrag && guideDrag.axis === axis && guideDrag.index === i ? null : (
              <div key={'guide' + axis + i} className={`cv-guide cv-guide-${axis}`} onPointerDown={(e) => startGuideDrag(e, axis, i)}
                style={axis === 'v' ? { left: pos } : { top: pos }} title={t('canvas.rulers.guide')} />
            ))))}
          {guideDrag && !guideDrag.out && <div className={`cv-guide cv-guide-${guideDrag.axis} dragging`} style={guideDrag.axis === 'v' ? { left: guideDrag.pos } : { top: guideDrag.pos }} />}
          {slideshow && slideshow.slides[slideshow.idx] && (() => {
            // Presentando: solo se ve la pantalla (marco) actual; lo demás queda tapado por un fondo oscuro.
            const g = (json.groups || []).find(x => x.id === slideshow.slides[slideshow.idx].groupId);
            if (!g) return null;
            const gx = g.x || 0, gy = (g.y || 0) + (g.scroll ? presScroll : 0), gw = g.w || CANVAS_GROUP_DEFAULT_W, gh = g.h || CANVAS_GROUP_DEFAULT_H, B = 100000;
            const st = { position: 'absolute', background: 'rgb(24, 24, 27)', zIndex: 70, pointerEvents: 'none' };
            return <>
              <div style={{ ...st, left: -B, top: -B, width: 2 * B, height: gy + B }} />
              <div style={{ ...st, left: -B, top: gy + gh, width: 2 * B, height: B }} />
              <div style={{ ...st, left: -B, top: gy, width: gx + B, height: gh }} />
              <div style={{ ...st, left: gx + gw, top: gy, width: B, height: gh }} />
            </>;
          })()}
          {guides && guides.v.map((x, i) => (
            <div key={'gv' + i} style={{ position: 'absolute', left: x, top: -10000, width: 1, height: 20000, background: '#e0457b', pointerEvents: 'none', zIndex: 55 }} />
          ))}
          {guides && guides.h.map((y, i) => (
            <div key={'gh' + i} style={{ position: 'absolute', top: y, left: -10000, height: 1, width: 20000, background: '#e0457b', pointerEvents: 'none', zIndex: 55 }} />
          ))}
          {(measure || (guides && guides.gaps)) && [...((guides && guides.gaps) || []), ...(measure || [])].filter(g => g.label != null).map((g, i) => {
            // Distancia en píxeles del mundo, en una pastilla (tamaño fijo en pantalla), como en Figma.
            const z = viewport.zoom || 1;
            return (
              <div key={'gl' + i} style={{ position: 'absolute', left: (g.x1 + g.x2) / 2, top: (g.y1 + g.y2) / 2, transform: `translate(-50%, -50%) scale(${1 / z})`, pointerEvents: 'none', zIndex: 57,
                background: '#e0457b', color: '#fff', font: '600 11px/1 Inter, system-ui, sans-serif', padding: '3px 5px', borderRadius: 4, whiteSpace: 'nowrap' }}>{g.label}</div>
            );
          })}
          {(measure || (guides && guides.gaps)) && [...((guides && guides.gaps) || []), ...(measure || [])].map((g, i) => {
            const horiz = g.y1 === g.y2, z = viewport.zoom || 1, tick = 8 / z, lw = 1.5 / z;
            return horiz ? (
              <div key={'gg' + i} style={{ position: 'absolute', left: g.x1, top: g.y1 - tick / 2, width: g.x2 - g.x1, height: tick, pointerEvents: 'none', zIndex: 56,
                borderLeft: `${lw}px solid #e0457b`, borderRight: `${lw}px solid #e0457b`, background: `linear-gradient(#e0457b, #e0457b) center / 100% ${lw}px no-repeat` }} />
            ) : (
              <div key={'gg' + i} style={{ position: 'absolute', left: g.x1 - tick / 2, top: g.y1, height: g.y2 - g.y1, width: tick, pointerEvents: 'none', zIndex: 56,
                borderTop: `${lw}px solid #e0457b`, borderBottom: `${lw}px solid #e0457b`, background: `linear-gradient(#e0457b, #e0457b) center / ${lw}px 100% no-repeat` }} />
            );
          })}
          <svg className="canvas-edges" style={{ overflow: 'visible' }}>
            <defs>
              <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
              <marker id="canvas-arrow-soft" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.4" />
              </marker>
            </defs>
            {(() => {
              // Recorte de aristas: con muchas, solo las que tocan el viewport (+ margen).
              const cull = !exporting && allEdges.length > CANVAS_EDGE_CULL_MIN && panSize.w && panSize.h;
              edgeCullRect = cull ? (() => { const z = viewport.zoom || 1, M = 300 / z; return { x: -viewport.x / z - M, y: -viewport.y / z - M, w: panSize.w / z + 2 * M, h: panSize.h / z + 2 * M }; })() : null;
              return null;
            })()}
            {allEdges.map((e, i) => {
              const isBack = e.kind === 'backlink';
              if (hiddenIds.size && (hiddenIds.has(e.from) || hiddenIds.has(e.to))) return null;
              const key = edgeKeyOf(e);
              if (edgeCullRect && selectedEdge !== key && !edgeTouches(e, rectOf, edgeCullRect)) return null;
              const L = layoutEdge(e, rectOf, isBack ? [] : obstaclesFor(e));
              if (!L) return null;
              const isSel = !isBack && selectedEdge === key;
              const color = isBack ? 'rgba(140,140,135,0.45)' : (e.color || (isSel ? 'var(--accent, #2383E2)' : CANVAS_EDGE_DEFAULT));
              const sw = isBack ? 1.2 : (isSel ? 2.4 : 1.6);
              // Dash pattern by `style`: dashed / dotted / solid (default).
              const dash = isBack ? '4 4' : (e.style === 'dashed' ? '8 4' : e.style === 'dotted' ? '2 4' : '');
              const ang = endAngles(L.path);
              const hs = headGeom(L.heads.start, L.a, ang.start + Math.PI, sw);
              const he = headGeom(L.heads.end, L.b, ang.end, sw);
              const line = trimPath(L.path, hs ? hs.inset : 0, he ? he.inset : 0);
              const d = pathToD(line);
              const flat = flatten(L.path);
              const lp = pointAt(flat, e.labelT != null ? e.labelT : 0.5);
              const editingLabel = !isBack && edgeLabelEdit === key;
              const z = viewport.zoom || 1;
              return (
                <g key={key + (isBack ? '#b' : '')} data-edge-key={key} className={`canvas-edge ${isBack ? 'backlink' : 'manual'}${isSel ? ' selected' : ''}`}
                  onClick={(ev) => { if (!isBack) { ev.stopPropagation(); setSelectedEdge(key); } }}
                  onDoubleClick={(ev) => { if (!isBack) { ev.stopPropagation(); setSelectedEdge(key); setEdgeLabelEdit(key); } }}>
                  {/* invisible wider hit-box so the edge is clickable without millimeter precision */}
                  {!isBack && <path d={d} fill="none" stroke="transparent" strokeWidth="14" style={{ cursor: 'pointer', pointerEvents: 'stroke' }} />}
                  {e.sketch && !isBack
                    ? sketchPathD(key, d, color, sw).map((p, pi) => <path key={'sk' + pi} d={p.d} fill="none" stroke={color} strokeWidth={p.strokeWidth || sw} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" />)
                    : <path d={d} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={dash} strokeLinejoin="round" />}
                  {[hs, he].map((h, hi) => h && (h.circle
                    ? <circle key={hi} cx={h.circle.cx} cy={h.circle.cy} r={h.circle.r} fill={color} stroke={color} strokeWidth={sw * 0.5} />
                    : <path key={hi} d={h.d} fill={h.filled ? color : 'none'} stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />))}
                  {e.label && !isBack && !editingLabel && (
                    <g className="canvas-edge-labelg" transform={`translate(${lp.x} ${lp.y})`} style={{ cursor: 'grab', pointerEvents: 'all' }}
                      onMouseDown={(ev) => startEdgeLabelDrag(ev, e, flat)}>
                      <rect x={-(String(e.label).length * 3.3 + 6)} y={-9} width={String(e.label).length * 6.6 + 12} height={18} rx={5}
                        fill="var(--canvas-edge-label-bg, rgba(250,250,247,0.92))" stroke="rgba(0,0,0,0.12)" strokeWidth={0.8} />
                      <text className="canvas-edge-label" textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: 'none' }}>{e.label}</text>
                    </g>
                  )}
                  {editingLabel && (
                    <foreignObject x={lp.x - 80} y={lp.y - 13} width={160} height={26} style={{ overflow: 'visible', pointerEvents: 'all' }}>
                      <input autoFocus className="canvas-edge-inline" defaultValue={e.label || ''}
                        style={{ width: '100%', height: 24, textAlign: 'center', font: 'inherit', fontSize: 12, padding: '0 6px', border: '1px solid var(--accent,#5a7a4e)', borderRadius: 5, outline: 'none', background: 'var(--canvas-edge-label-bg, #fff)', color: 'inherit', boxSizing: 'border-box' }}
                        onPointerDown={(ev) => ev.stopPropagation()} onMouseDown={(ev) => ev.stopPropagation()}
                        onBlur={(ev) => { const v = ev.target.value.trim(); setEdgeLabelEdit(null); commitEdgePatch(key, { label: v || undefined }); }}
                        onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') ev.target.blur(); else if (ev.key === 'Escape') { ev.target.value = e.label || ''; ev.target.blur(); } }} />
                    </foreignObject>
                  )}
                  {isSel && [['from', L.a], ['to', L.b]].map(([end, pt]) => (
                    <circle key={end} cx={pt.x} cy={pt.y} r={6 / z} className="canvas-edge-end" fill="#fff" stroke="var(--accent,#5a7a4e)" strokeWidth={2 / z}
                      style={{ cursor: 'grab', pointerEvents: 'all' }} onMouseDown={(ev) => startEdgeEndDrag(ev, e, end)} />
                  ))}
                </g>
              );
            })}
            {anchorHover && ['t', 'r', 'b', 'l'].map(sd => {
              const ap = anchorPoint(anchorHover.rect, sd), near = anchorHover.near === sd, z = viewport.zoom || 1;
              return <circle key={'ah' + sd} cx={ap.x} cy={ap.y} r={(near ? 7 : 5) / z} fill={near ? 'var(--accent,#5a7a4e)' : '#fff'} stroke="var(--accent,#5a7a4e)" strokeWidth={2 / z} style={{ pointerEvents: 'none' }} />;
            })}
            {/* Only back-layer drawings live under the nodes; the rest render
                in the front SVG above the nodes. */}
            {annoFilter((json.annotations || []).filter(a => a.layer === 'back' && a.z == null)).map(a => renderAnnotation(a))}
            {edgeDraw && (() => {
              const from = rectOf(edgeDraw.fromId);
              if (!from) return null;
              const b = edgeDraw.mouseWorld;
              const a = edgeDraw.fromSide ? anchorPoint(from, edgeDraw.fromSide) : rectBorderPoint(from, b);
              return <path d={edgePath(a, b)} fill="none" stroke="var(--accent, #2383E2)" strokeDasharray="2 4" strokeWidth="1.4" />;
            })()}
          </svg>
          {(json.groups || []).map(g => (
            <CanvasGroup key={g.id} group={g}
              onMouseDown={startGroupDrag}
              onLayoutMenu={(gr, rect) => setLayoutMenu({ id: gr.id, anchor: rect })}
              onDuplicate={duplicateGroup}
              onRename={async (gr) => {
                const next = await askPrompt(t('dlg.renameGroup'), gr.title || '');
                if (next == null) return;
                onChange(j => ({ ...j, groups: j.groups.map(x => x.id === gr.id ? { ...x, title: next } : x) }));
              }}
              onDelete={async (gr) => {
                const ok = await askConfirm(t('dlg.deleteGroup', { name: gr.title || '' }), { title: t('dlg.deleteGroupTitle') });
                if (!ok) return;
                onChange(j => ({ ...j, groups: j.groups.filter(x => x.id !== gr.id) }));
              }} />
          ))}
          {(() => {
            // Recorte: por encima de CANVAS_CULL_MIN nodos sólo se pintan las fichas
            // que tocan el viewport (+ margen), vía la cuadrícula espacial. Las
            // seleccionadas, animadas o recién creadas se pintan siempre.
            const allNodes = hiddenIds.size ? (json.nodes || []).filter(n => !hiddenIds.has(n.id)) : (json.nodes || []);
            let list = allNodes;
            if (allNodes.length > CANVAS_CULL_MIN && panSize.w && panSize.h) {
              const M = 400, z = viewport.zoom;
              const vis = new Set(nodeGrid.query(-viewport.x / z - M, -viewport.y / z - M, panSize.w / z + M * 2, panSize.h / z + M * 2).map(n => n.id));
              list = allNodes.filter(n => vis.has(n.id) || selected.has(n.id) || animMap.has(n.id) || autoEditId === n.id);
            }
            // Zoom muy alejado con muchas fichas a la vista: solo las seleccionadas,
            // animadas o en edición van al DOM; el resto lo dibuja el <canvas> LOD.
            const lodOn = !exporting && viewport.zoom < LOD_ZOOM && list.length > LOD_MIN_VISIBLE;
            lodOnRef.current = lodOn;
            if (lodOn) {
              list = list.filter(n => selected.has(n.id) || animMap.has(n.id) || autoEditId === n.id);
              lodExcludeRef.current = new Set(list.map(n => n.id));
            }
            // Con algún orden explícito, TODOS los dibujos de delante entran en el orden común (los que no tienen
            // `z` cuentan como «encima de todo»): así una ficha llevada al frente sí queda sobre ellos.
            const explicitZ = (json.annotations || []).some(a => a.z != null) || (json.nodes || []).some(n => n.z != null);
            const zAnnos = explicitZ
              ? (json.annotations || []).map((a, i) => ({ a, z: annoZ(a, i) })).filter(x => x.a.z != null || x.a.layer !== 'back').sort((p, q) => p.z - q.z).map(x => x.a)
              : [];
            const zOf = new Map(explicitZ ? (json.annotations || []).map((a, i) => [a.id, annoZ(a, i)]) : []);
            const hasZ = explicitZ;
            const nIdx = hasZ ? new Map((json.nodes || []).map((n, i) => [n.id, i])) : null;
            if (hasZ) list = list.slice().sort((p, q) => nodeZ(p, nIdx.get(p.id)) - nodeZ(q, nIdx.get(q.id)));
            let ai = 0;
            const out = [];
            const flushAnnos = (limit) => {
              const run = [];
              while (ai < zAnnos.length && (limit == null || zOf.get(zAnnos[ai].id) < limit)) run.push(zAnnos[ai++]);
              if (run.length) out.push(
                <svg key={'zrun' + run[0].id} className="canvas-edges canvas-edges-front" style={{ overflow: 'visible', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                  {annoFilter(run).map(a => renderAnnotation(a))}
                </svg>
              );
            };
            for (const n of list) { if (n.bind && resolveVars(n, json.vars).hidden) continue; if (hasZ) flushAnnos(nodeZ(n, nIdx.get(n.id))); if (n.kind === 'page') { out.push(
            <CanvasPageTile key={n.id} node={n} title={pageTitle} renderPage={renderPage}
              isSelected={selected.has(n.id)} onMouseDown={sStartNodeDrag} onExpand={expandPageNode} />
            ); continue; } out.push(
            <CanvasTile key={n.id} node={resolveVars(n, json.vars)}
              autoEdit={autoEditId === n.id}
              note={n.kind === 'note' ? resolveCanvasNote(n, noteIdx) : null}
              notes={n.kind === 'query' ? notes : null}
              syncConfig={syncConfig}
              isSelected={selected.has(n.id)}
              openTasks={openTaskCounts.get(n.id) || 0}
              reminder={reminderByNode.get(n.id) || null}
              transientStyle={animMap.get(n.id) || null}
              onMouseDown={sStartNodeDrag}
              onSelect={sSelectNode}
              onDelete={sDeleteNode}
              onEditText={sEditNodeText}
              onCreateReminder={onCreateReminder ? sCreateReminder : undefined}
              onOpen={sOpenTile}
              onEdgeStart={sStartEdgeDraw}
              onEdgeFinish={sFinishEdgeDraw}
              onStickySibling={sCreateStickySibling}
              onPatchNode={sPatchNode}
              onToggleReaction={sToggleReaction}
              commentCount={(nodeComments.get(n.id) || []).length}
              onOpenComments={sOpenComments} />
            ); }
            if (hasZ) flushAnnos(null);
            return out;
          })()}
          {(() => {
            // 4 asas «+» alrededor del elemento seleccionado (ficha o forma): clic = siguiente
            // elemento conectado; arrastrar = conectar o, soltando en vacío, elegir qué crear.
            if (tool !== 'select' || exporting || draft) return null;
            let tgt = null;
            if (selected.size === 1 && !selAnno.size) { const id = [...selected][0], n = nodeById.get(id); if (n) tgt = { id, ...canvasNodeRect(n) }; }
            else if (selAnno.size === 1 && !selected.size) { const id = [...selAnno][0], r = annoRects.shapes.get(id); if (r) tgt = { id, ...r }; }
            if (!tgt) return null;
            const z = viewport.zoom || 1, off = 24 / z;
            return ['t', 'r', 'b', 'l'].map(sd => {
              const ap = anchorPoint(tgt, sd);
              return (
                <div key={'plus' + sd} className="canvas-plus-handle" data-plus-side={sd} title={t('canvas.edgeDrag')}
                  onMouseDown={(e) => { e.stopPropagation(); startEdgeDraw(e, tgt, { fromSide: sd }); }}
                  style={{ position: 'absolute', left: ap.x + ap.nx * off, top: ap.y + ap.ny * off, width: 18, height: 18, marginLeft: -9, marginTop: -9,
                    transform: `scale(${1 / z})`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', zIndex: 60,
                    background: 'var(--surface,#fff)', color: 'var(--accent,#5a7a4e)', border: '1px solid color-mix(in srgb, var(--accent,#5a7a4e) 60%, transparent)', font: '600 13px/1 sans-serif',
                    cursor: 'crosshair', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', userSelect: 'none' }}>+</div>
              );
            });
          })()}
          {remotes.length > 0 && (() => {
            // Cursores y selecciones de otros usuarios: tamaño constante con el zoom.
            const z = viewport.zoom || 1, out = [];
            for (const r of remotes) {
              for (const id of r.sel) {
                const rc = rectOf(id);
                if (rc) out.push(<div key={'rs' + r.id + id} style={{ position: 'absolute', left: rc.x - 3, top: rc.y - 3, width: rc.w + 6, height: rc.h + 6, border: `${2 / z}px solid ${r.color}`, borderRadius: 6 / z, pointerEvents: 'none', zIndex: 4 }} />);
              }
              out.push(
                <div key={'rc' + r.id} className="canvas-remote-cursor" style={{ position: 'absolute', left: r.x, top: r.y, transform: `scale(${1 / z})`, transformOrigin: '0 0', pointerEvents: 'none', zIndex: 70, transition: 'left 70ms linear, top 70ms linear' }}>
                  <svg width="16" height="20" viewBox="0 0 16 20" style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}><path d="M1 1 L1 15 L5 11 L8 18 L10.5 17 L7.5 10 L13 10 Z" fill={r.color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                  <span style={{ position: 'absolute', left: 14, top: 16, background: r.color, color: '#fff', font: '600 11px/1 sans-serif', padding: '3px 7px', borderRadius: 8, whiteSpace: 'nowrap' }}>{r.name}</span>
                </div>
              );
            }
            return out;
          })()}
          {(() => {
            // Plegado de ramas del mapa mental: píldora con el nº de nodos ocultos (siempre visible
            // si está plegada; con el nodo seleccionado se muestra para plegar).
            if (exporting || draft) return null;
            const z = viewport.zoom || 1, out = [];
            for (const n of json.nodes || []) {
              const kids = mmIndex.childrenOf.get(n.id) || [];
              if (!kids.length || hiddenIds.has(n.id)) continue;
              if (!n.collapsed && !selected.has(n.id)) continue;
              const first = (json.edges || []).find(e => e.from === n.id && e.to === kids[0]);
              const sd = (first && first.fromSide) || 'r';
              const ap = anchorPoint(canvasNodeRect(n), sd), off = 14 / z;
              const hiddenCount = n.collapsed ? descendantsOf(n.id, mmIndex.childrenOf).length : 0;
              out.push(
                <div key={'fold' + n.id} className="canvas-fold-pill" title={n.collapsed ? t('canvas.edgeDrag') : ''}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); toggleCollapse(n.id); }}
                  style={{ position: 'absolute', left: ap.x + ap.nx * off, top: ap.y + ap.ny * off, minWidth: 20, height: 20, padding: '0 6px', transform: `translate(-50%,-50%) scale(${1 / z})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, zIndex: 61, cursor: 'pointer', userSelect: 'none',
                    background: n.collapsed ? 'var(--accent,#5a7a4e)' : '#fff', color: n.collapsed ? '#fff' : 'var(--accent,#5a7a4e)', border: '1.5px solid var(--accent,#5a7a4e)', font: '600 11px/1 sans-serif' }}>
                  {n.collapsed ? '+' + hiddenCount : '−'}
                </div>
              );
            }
            return out;
          })()}
          {/* Front drawing layer — painted strokes/shapes sit ABOVE the nodes
              by default (layer !== 'back'); the live drawing preview too. The
              SVG itself ignores pointer events so empty areas click through to
              nodes; each annotation re-enables events when interactive. */}
          <svg className="canvas-edges canvas-edges-front" style={{ overflow: 'visible', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            {!((json.annotations || []).some(a => a.z != null) || (json.nodes || []).some(n => n.z != null)) && annoFilter((json.annotations || []).filter(a => a.layer !== 'back' && a.z == null)).map(a => renderAnnotation(a))}
            {livePreview && livePreview.kind === 'vpen' && (
              <g className="canvas-vpen-preview" style={{ pointerEvents: 'none' }}>
                <path d={livePreview.d} fill="none" stroke={livePreview.color} strokeWidth={livePreview.size} strokeLinecap="round" strokeLinejoin="round" />
                {livePreview.rubber && <path d={livePreview.rubber} fill="none" stroke={livePreview.color} strokeWidth={1 / (viewport.zoom || 1)} strokeDasharray={`${4 / (viewport.zoom || 1)} ${3 / (viewport.zoom || 1)}`} />}
                {livePreview.pts.map((p, i) => (
                  <g key={i}>
                    {p.hout && <><line x1={p.x} y1={p.y} x2={p.hout[0]} y2={p.hout[1]} stroke="#e0457b" strokeWidth={1 / (viewport.zoom || 1)} /><circle cx={p.hout[0]} cy={p.hout[1]} r={3 / (viewport.zoom || 1)} fill="#fff" stroke="#e0457b" strokeWidth={1 / (viewport.zoom || 1)} /></>}
                    {p.hin && <><line x1={p.x} y1={p.y} x2={p.hin[0]} y2={p.hin[1]} stroke="#e0457b" strokeWidth={1 / (viewport.zoom || 1)} /><circle cx={p.hin[0]} cy={p.hin[1]} r={3 / (viewport.zoom || 1)} fill="#fff" stroke="#e0457b" strokeWidth={1 / (viewport.zoom || 1)} /></>}
                    <rect x={p.x - 4 / (viewport.zoom || 1)} y={p.y - 4 / (viewport.zoom || 1)} width={8 / (viewport.zoom || 1)} height={8 / (viewport.zoom || 1)} fill={i === 0 ? 'var(--accent,#2383E2)' : '#fff'} stroke="var(--accent,#2383E2)" strokeWidth={1.5 / (viewport.zoom || 1)} />
                  </g>
                ))}
              </g>
            )}
            {livePreview && livePreview.kind === 'path' && (
              livePreview.tool === 'pen'
                ? (() => {
                  const bf = livePreview.brush && livePreview.brush !== 'pen' ? brushFilterSvg(livePreview.brush, 'cvb-live', livePreview.color) : '';
                  const blend = brushSpec(livePreview.brush).blend;
                  return <>{bf && <defs dangerouslySetInnerHTML={{ __html: bf }} />}<path d={livePreview.d} fill={brushFill(livePreview.brush, livePreview.color)} stroke="none" opacity={livePreview.opacity != null ? livePreview.opacity : 1} filter={bf ? 'url(#cvb-live)' : undefined} style={blend ? { mixBlendMode: blend } : undefined} /></>;
                })()
                : <path d={livePreview.d} fill="none" stroke={livePreview.color} strokeWidth={(livePreview.size || 4) * 4} strokeLinecap="round" strokeLinejoin="round" opacity={0.35} style={{ mixBlendMode: 'multiply' }} />
            )}
            {livePreview && livePreview.kind === 'shape' && (() => {
              const x = Math.min(livePreview.x0, livePreview.x1), y = Math.min(livePreview.y0, livePreview.y1);
              const w = Math.abs(livePreview.x1 - livePreview.x0), h = Math.abs(livePreview.y1 - livePreview.y0);
              const c = livePreview.color, sw = livePreview.size || 2;
              if (livePreview.shape === 'rect') return <rect x={x} y={y} width={w} height={h} rx={4} fill="none" stroke={c} strokeWidth={sw} opacity={0.9} />;
              if (livePreview.shape === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={c} strokeWidth={sw} opacity={0.9} />;
              if (livePreview.shape === 'diamond') { const cx = x + w / 2, cy = y + h / 2; return <path d={`M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`} fill="none" stroke={c} strokeWidth={sw} opacity={0.9} />; }
              if (NEW_SHAPES.includes(livePreview.shape)) return <g>{shapeParts(livePreview.shape, x, y, w, h).map((part, i) => <path key={i} d={part.d} fill="none" stroke={c} strokeWidth={sw} strokeLinejoin="round" opacity={0.9} />)}</g>;
              if (livePreview.shape === 'line') return <line x1={livePreview.x0} y1={livePreview.y0} x2={livePreview.x1} y2={livePreview.y1} stroke={c} strokeWidth={sw} strokeLinecap="round" opacity={0.9} />;
              if (livePreview.shape === 'arrow') { const ang = Math.atan2(livePreview.y1 - livePreview.y0, livePreview.x1 - livePreview.x0); const hlen = Math.max(7, sw * 3 + 4); const ex = livePreview.x1 - Math.cos(ang) * hlen * 0.9, ey = livePreview.y1 - Math.sin(ang) * hlen * 0.9; return <g><line x1={livePreview.x0} y1={livePreview.y0} x2={ex} y2={ey} stroke={c} strokeWidth={sw} strokeLinecap="round" opacity={0.9} /><path d={arrowHeadPath(livePreview.x0, livePreview.y0, livePreview.x1, livePreview.y1, sw)} fill={c} opacity={0.9} /></g>; }
              return null;
            })()}
            {laserPts.length >= 1 && (() => {
              const z = viewport.zoom || 1;
              const head = laserPts[laserPts.length - 1];
              const d = laserPts.length > 1 ? 'M ' + laserPts.map(p => `${p.x},${p.y}`).join(' L ') : '';
              return (
                <g style={{ pointerEvents: 'none' }}>
                  {d && <path d={d} fill="none" stroke="#ff2d55" strokeWidth={6 / z} strokeLinecap="round" strokeLinejoin="round" opacity={0.3} />}
                  {d && <path d={d} fill="none" stroke="#ff2d55" strokeWidth={2.6 / z} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />}
                  <circle cx={head.x} cy={head.y} r={5 / z} fill="#ff2d55" opacity={0.95} />
                </g>
              );
            })()}
          </svg>
        </div>
      </div>
      {!(json.nodes || []).length && !(json.groups || []).length && !(json.annotations || []).length && !exporting && !slideshow && (
        <div className="canvas-tpl-gallery" onMouseDown={(e) => e.stopPropagation()}>
          <div className="canvas-tpl-title">{t('canvas.tpl.title')}</div>
          <div className="canvas-tpl-hint">{t('canvas.tpl.hint')}</div>
          <div className="canvas-tpl-grid">
            {canvasTemplateInfo(getLang()).map(tp => (
              <button key={tp.key} className="canvas-tpl-card" onClick={() => applyTemplate(tp.key)}>
                <span className="canvas-tpl-icon"><CvIcon name={tp.key} size={20} /></span>
                <span className="canvas-tpl-name">{tp.name}</span>
                <span className="canvas-tpl-desc">{tp.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!exporting && !slideshow && (json.groups || []).length > 0 && (
        <div className="canvas-frames" onMouseDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 40, display: 'flex', flexDirection: 'column-reverse', alignItems: 'flex-start', gap: 6 }}>
          <button className="fmt-btn" title={getLang() === 'en' ? 'Frames / presentation order' : 'Marcos / orden de la presentación'} onClick={() => setFramesOpen(v => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', width: 'auto', minWidth: 0, gap: 0, height: 32, padding: '0 10px', background: 'var(--surface,#fff)', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            <CvIcon name="frame" size={14} /> <span style={{ marginLeft: 6 }}>{t('cv.frames', { n: (json.groups || []).length })}</span>
          </button>
          {framesOpen && (
            <div style={{ width: 250, maxHeight: 320, overflow: 'auto', background: 'var(--surface,#fff)', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.22)', padding: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 6px', font: '600 12px/1.2 sans-serif' }}>
                <span>{getLang() === 'en' ? 'Presentation order' : 'Orden de la presentación'}</span>
                <button className="fmt-btn" title={t('canvas.present.title') || '▶'} onClick={() => { setFramesOpen(false); startSlideshow(null); }} style={{ height: 24, padding: '0 8px' }}>▶</button>
              </div>
              {orderedFrames(json).map((g, i, arr) => (
                <div key={g.id} className="canvas-frame-row" draggable
                  onDragStart={(e) => { setFrameDrag({ id: g.id, over: null }); try { e.dataTransfer.setData('text/plain', g.id); e.dataTransfer.effectAllowed = 'move'; } catch {} }}
                  onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setFrameDrag(d => d ? { ...d, over: g.id, after: e.clientY > r.top + r.height / 2 } : d); }}
                  onDrop={(e) => { e.preventDefault(); const d = frameDrag; setFrameDrag(null); if (d) moveFrame(d.id, g.id, !!d.after); }}
                  onDragEnd={() => setFrameDrag(null)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, cursor: 'grab', background: frameDrag && frameDrag.over === g.id ? 'color-mix(in srgb, var(--accent,#5a7a4e) 14%, transparent)' : 'transparent',
                    borderTop: frameDrag && frameDrag.over === g.id && !frameDrag.after ? '2px solid var(--accent,#5a7a4e)' : '2px solid transparent', borderBottom: frameDrag && frameDrag.over === g.id && frameDrag.after ? '2px solid var(--accent,#5a7a4e)' : '2px solid transparent' }}>
                  <span style={{ opacity: 0.5, font: '600 11px/1 sans-serif', minWidth: 14 }}>{i + 1}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: '13px/1.2 sans-serif', cursor: 'pointer' }}
                    onClick={() => animateViewportTo(groupFitTarget(g))}>{g.title || (getLang() === 'en' ? 'Untitled' : 'Sin título')}</span>
                  <button className="fmt-btn" data-frame-up disabled={i === 0} onClick={() => stepFrame(g.id, -1)} style={{ height: 22, padding: '0 5px' }}>▲</button>
                  <button className="fmt-btn" data-frame-down disabled={i === arr.length - 1} onClick={() => stepFrame(g.id, 1)} style={{ height: 22, padding: '0 5px' }}>▼</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!exporting && (json.nodes || []).length >= 6 && (
        <CanvasMinimap nodes={json.nodes || []} groups={json.groups || []} viewport={viewport} panSize={panSize}
          dims={CANVAS_MM_DIMS} title={t('canvas.minimap')}
          onGoTo={(wx, wy) => setViewport(v => ({ ...v, x: (panSize.w || 0) / 2 - wx * v.zoom, y: (panSize.h || 0) / 2 - wy * v.zoom }))} />
      )}
      {shortcutsOpen && (
        <>
          <div className="view-spotlight-backdrop" onClick={() => setShortcutsOpen(false)} style={{ zIndex: 90 }} />
          <div className="canvas-shortcuts" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="canvas-shortcuts-head">
              <span>{t('canvas.shortcuts')}</span>
              <button className="history-close" onClick={() => setShortcutsOpen(false)} title={t('btn.closeEsc')}>×</button>
            </div>
            <div className="canvas-shortcuts-grid">
              {[
                ['V / 1', t('canvas.tool.select')], ['N / S', t('canvas.addSticky')], ['T', t('canvas.tool.text')],
                ['P', t('canvas.tool.pen')], ['H', t('canvas.tool.highlighter')], ['K', t('canvas.tool.laser')],
                ['E', t('canvas.tool.eraser')], ['R / O / D', t('canvas.sc.shapes')], ['L / A', t('canvas.sc.lines')],
                ['F', t('canvas.sc.frame')], ['?', t('canvas.shortcuts')], ['Esc', t('canvas.sc.escape')],
                ['Ctrl+Z / Ctrl+Shift+Z', t('canvas.sc.undo')], ['Ctrl+C / X / V', t('canvas.sc.copy')], ['Ctrl+D', t('canvas.sel.duplicate')],
                ['Ctrl+A', t('canvas.sc.selectAll')], ['Ctrl+] / Ctrl+[', t('canvas.sc.zorder')], [t('canvas.sc.arrowsKey'), t('canvas.sc.arrows')],
                ['Shift+1', t('canvas.fitContent')], ['Shift+2', t('canvas.sc.zoomSel')], ['Ctrl+0', t('canvas.zoomReset')],
                [t('canvas.sc.wheelKey'), t('canvas.sc.wheel')], [t('canvas.sc.ctrlWheelKey'), t('canvas.sc.ctrlWheel')], [t('canvas.sc.dblKey'), t('canvas.sc.dbl')],
                ['Space', getLang() === 'en' ? 'Hold + drag: pan the canvas' : 'Mantener + arrastrar: mover el lienzo'],
                ['Tab / Enter', getLang() === 'en' ? 'Mind map: child / sibling' : 'Mapa mental: hijo / hermano'],
                ['C', getLang() === 'en' ? 'Connector selected: cycle route' : 'Conector seleccionado: cambiar modo'],
                ['Ctrl+G / Ctrl+Shift+G', getLang() === 'en' ? 'Group / ungroup' : 'Agrupar / desagrupar'],
                ['Alt+L', getLang() === 'en' ? 'Lock / unlock' : 'Bloquear / desbloquear'],
                ['Ctrl+Alt+] / [', getLang() === 'en' ? 'Forward / back one step (between cards)' : 'Un puesto adelante / atrás (entre fichas)'],
              ].map(([k, v], i) => (
                <div key={i} className="canvas-shortcuts-row">
                  <kbd>{k}</kbd><span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {canvasCallout && (() => {
        const node = (json.nodes || []).find(n => n.id === canvasCallout.nodeId);
        if (!node) return null;
        const nx = (node.x || 0) + (node.w || CANVAS_DEFAULT_NODE_W) / 2;
        const ny = (node.y || 0);
        const left = viewport.x + nx * viewport.zoom;
        const top = viewport.y + ny * viewport.zoom - 8;
        return (
          <div className="canvas-ai-callout" style={{ left, top }}
            onClick={() => setCanvasCallout(null)}>
            {canvasCallout.stepCount && (
              <div className="canvas-ai-step">{t('canvas.step', { i: canvasCallout.stepIdx, n: canvasCallout.stepCount })}</div>
            )}
            <div className="canvas-ai-msg">{canvasCallout.message || '👈'}</div>
          </div>
        );
      })()}
      {nodeCommentFor && (() => {
        const node = (json.nodes || []).find(n => n.id === nodeCommentFor);
        const rect = containerRef.current && containerRef.current.getBoundingClientRect();
        if (!node || !rect) return null;
        const x = rect.left + viewport.x + ((node.x || 0) + (node.w || CANVAS_DEFAULT_NODE_W)) * viewport.zoom + 10;
        const y = Math.max(60, rect.top + viewport.y + (node.y || 0) * viewport.zoom);
        return (
          <AnchorCommentPopover x={x} y={y}
            thread={nodeComments.get(nodeCommentFor) || []}
            memberEmails={[]}
            aiAgents={[]}
            onReply={(text) => addNodeComment(nodeCommentFor, text)}
            onResolve={() => resolveNodeComments(nodeCommentFor)}
            onClose={() => setNodeCommentFor(null)} />
        );
      })()}
      {edgePicker && (
        <>
          <div style={{ position: 'absolute', inset: 0, zIndex: 80 }} onMouseDown={() => setEdgePicker(null)} />
          <div className="canvas-edge-picker" onMouseDown={(e) => e.stopPropagation()}
            style={{ position: 'absolute', left: edgePicker.left, top: edgePicker.top, zIndex: 81, display: 'flex', gap: 4, padding: 6, background: 'var(--surface,#fff)', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.22)' }}>
            {[['sticky', '🗒', t('canvas.addSticky')], ['shape', '▭', t('canvas.sc.shapes')], ['label', 'T', t('canvas.tool.text')], ['note', '📄', t('canvas.addNote')]].map(([k, ic, title]) => (
              <button key={k} className="fmt-btn" title={title} data-pick={k} onClick={() => pickConnected(k)} style={{ minWidth: 34, height: 34, fontSize: 16 }}>{ic}</button>
            ))}
          </div>
        </>
      )}
      {selectedEdge != null && (() => {
        const edge = (json.edges || []).find(ed => edgeKeyOf(ed) === selectedEdge);
        if (!edge) return null;
        const L = layoutEdge(edge, rectOf, obstaclesFor(edge));
        if (!L) return null;
        const mid = pointAt(flatten(L.path), edge.labelT != null ? edge.labelT : 0.5);
        const screen = { left: viewport.x + mid.x * viewport.zoom, top: viewport.y + mid.y * viewport.zoom };
        const update = (patch) => commitEdgePatch(selectedEdge, patch);
        const remove = () => {
          onChange(j => ({ ...j, edges: (j.edges || []).filter(ed => edgeKeyOf(ed) !== selectedEdge) }));
          setSelectedEdge(null);
        };
        const route = edge.route || 'curved';
        const heads = L.heads;
        const HEAD_OPTS = [['none', '─'], ['arrow', '➤'], ['triangle', '▲'], ['circle', '●'], ['diamond', '◆']];
        const headSel = (which, cur) => (
          <select className="canvas-edge-head" value={cur} title={which === 'startHead' ? '⟵' : '⟶'}
            onChange={(ev) => update({ [which]: ev.target.value, arrow: undefined })}>
            {HEAD_OPTS.map(([v, g]) => <option key={v} value={v}>{g}</option>)}
          </select>
        );
        return (
          <div className="canvas-edge-popover" style={{ left: screen.left, top: screen.top }}
            onMouseDown={(e) => e.stopPropagation()}>
            <input type="text" className="canvas-edge-input" placeholder={t('canvas.edgeLabelPh')} value={edge.label || ''}
              onChange={(ev) => update({ label: ev.target.value || undefined })} />
            <div className="canvas-edge-row">
              <button title={t('canvas.edgeSolid')} className={`canvas-edge-opt ${(edge.style || 'solid') === 'solid' ? 'on' : ''}`} onClick={() => update({ style: 'solid' })}>━</button>
              <button title={t('canvas.edgeDashed')} className={`canvas-edge-opt ${edge.style === 'dashed' ? 'on' : ''}`} onClick={() => update({ style: 'dashed' })}>╌</button>
              <button title={t('canvas.edgeDotted')} className={`canvas-edge-opt ${edge.style === 'dotted' ? 'on' : ''}`} onClick={() => update({ style: 'dotted' })}>┄</button>
              <button title={t('canvas.sketch')} className={`canvas-edge-opt ${edge.sketch ? 'on' : ''}`} onClick={() => update({ sketch: edge.sketch ? undefined : true })}>✎</button>
              <span className="canvas-edge-sep" />
              {headSel('startHead', heads.start)}
              {headSel('endHead', heads.end)}
              <span className="canvas-edge-sep" />
              <button title={t('canvas.edgeCurved')} className={`canvas-edge-opt ${route === 'curved' ? 'on' : ''}`} onClick={() => update({ route: 'curved' })}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 12.5C6 12.5 10 3.5 13.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </button>
              <button title={t('canvas.edgeStraight')} className={`canvas-edge-opt ${route === 'straight' ? 'on' : ''}`} onClick={() => update({ route: 'straight' })}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 12.5L13.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </button>
              <button title={t('canvas.edgeOrtho')} className={`canvas-edge-opt ${route === 'ortho' ? 'on' : ''}`} onClick={() => update({ route: 'ortho' })}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 12.5H8V3.5h5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
            <div className="canvas-edge-row">
              {[CANVAS_EDGE_DEFAULT, '#7da95a', '#ea580c', '#3b82f6', '#a855f7', '#dc2626'].map(c => (
                <button key={c} className={`canvas-edge-color ${edge.color === c ? 'on' : ''}`}
                  style={{ background: c }} onClick={() => update({ color: c })} />
              ))}
              <span className="canvas-edge-sep" />
              <button className="canvas-edge-del" title={t('canvas.edgeDelete')} onClick={remove}>🗑</button>
              <button className="canvas-edge-close" title={t('canvas.edgeClose')} onClick={() => setSelectedEdge(null)}>×</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export { CanvasView, CanvasEmbedPreview };
