// Cromo del canvas (rediseño, Canvas.dc.html): barra de herramientas
// flotante abajo al centro, acciones arriba a la derecha y control de zoom
// abajo a la derecha. Sólo presentación: el estado y las acciones las pone
// CanvasView (editor.jsx), así que el comportamiento y los datos no cambian.

import { useState } from 'react';
import { t } from '../../i18n.js';
import { Menu } from '../shell/Menu.jsx';

// Iconos 24×24 a 1.7px, como los del shell.
const P = {
  select: <path d="M5 3l14 7-6 2-2 6z" />,
  sticky: <><path d="M4 4h16v10l-6 6H4z" /><path d="M14 20v-6h6" /></>,
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  rect: <rect x="4" y="5" width="16" height="14" rx="2.5" />,
  arrow: <path d="M5 19 19 5M12 5h7v7" />,
  pen: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  frame: <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />,
  note: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></>,
  more: <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  highlighter: <><path d="M6 15 15 6l3 3-9 9H6z" /><path d="M4 21h9" /></>,
  laser: <><circle cx="17" cy="7" r="2.5" /><path d="M14.8 9.2 4 20M4 16v4h4" /></>,
  props: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  vpen: <><path d="M12 19l7-7 3 3-7 7z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z" /><path d="M2 2l7.6 7.6" /><circle cx="11" cy="11" r="2" /></>,
  bucket: <><path d="m5 11 7-7 7 7-7 7z" /><path d="M5 11h14" /><path d="M20 15.5c0 1.2-.8 2-1.5 2s-1.5-.8-1.5-2c0-.9 1.5-3 1.5-3s1.5 2.1 1.5 3z" /></>,
  eraser: <><path d="M9 19 4.5 14.5a2 2 0 0 1 0-2.8l7-7a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L12 19z" /><path d="M9 19h11" /></>,
  line: <path d="M5 19 19 5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  diamond: <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />,
  triangle: <path d="M12 4 21 19H3z" />,
  star: <path d="m12 3.2 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" />,
  hexagon: <path d="M7.5 5h9l4.5 7-4.5 7h-9L3 12z" />,
  cylinder: <><ellipse cx="12" cy="6.5" rx="7.5" ry="2.8" /><path d="M4.5 6.5v11c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-11" /></>,
  cloud: <path d="M7 18.5a4 4 0 0 1-.6-7.9 5.5 5.5 0 0 1 10.6-1A4.6 4.6 0 0 1 17 18.5z" />,
  callout: <path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 16h-8l-5 4.5V16H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5z" />,
  shapes: <><rect x="3.5" y="11" width="9" height="9" rx="1.5" /><circle cx="16.5" cy="8" r="4.5" /></>,
  card: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7 10h10M7 14h6" /></>,
  label: <path d="M4 7V5h16v2M12 5v14M9 19h6M3 21h18" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></>,
  attach: <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />,
  query: <><circle cx="10.5" cy="10.5" r="6" /><path d="m20 20-5-5M8 10.5h5" /></>,
  boxRect: <><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M8 12h8" /></>,
  boxEllipse: <><ellipse cx="12" cy="12" rx="9" ry="6.5" /><path d="M8.5 12h7" /></>,
  undo: <path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 6 6v2" />,
  redo: <path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0-6 6v2" />,
  grid: <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />,
  layout: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  spark: <><path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z" /><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></>,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><rect x="9" y="9" width="6" height="6" rx="1.2" /></>,
  present: <path d="M7 4.5v15L19 12z" />,
  download: <><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  full: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  fullExit: <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" />,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9.5 2.5h5" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6M12 17.2v.1" /></>,
  minus: <path d="M6 12h12" />,
  plus: <path d="M12 6v12M6 12h12" />,
  // Plantillas de canvas (sustituyen a los emoji de shared/canvas-templates.js)
  brainstorm: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />,
  retro: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" /><path d="M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5" /><path d="M4 20v-4.5h4.5" /></>,
  kanban: <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="9.5" y="4" width="5" height="11" rx="1.5" /><rect x="16" y="4" width="5" height="7" rx="1.5" /></>,
  mindmap: <><circle cx="12" cy="12" r="2.5" /><circle cx="4.5" cy="6" r="1.8" /><circle cx="19.5" cy="6" r="1.8" /><circle cx="4.5" cy="18" r="1.8" /><circle cx="19.5" cy="18" r="1.8" /><path d="m6 7.2 4 3M18 7.2l-4 3M6 16.8l4-3M18 16.8l-4-3" /></>,
  timeline: <><path d="M3 12h18M18 9l3 3-3 3" /><circle cx="7" cy="12" r="1.6" /><circle cx="13" cy="12" r="1.6" /><path d="M7 10.4V6M13 13.6V18" /></>,
  moodboard: <><rect x="3" y="3" width="8" height="10" rx="1.5" /><rect x="13" y="3" width="8" height="6" rx="1.5" /><rect x="13" y="11" width="8" height="10" rx="1.5" /><rect x="3" y="15" width="8" height="6" rx="1.5" /></>,
  weekly: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 10v10M15 10v10" /></>,
  dafo: <><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="13" width="7.5" height="7.5" rx="1.5" /></>,
  journey: <><path d="M3 17c3-8 6 2 9-5s6-1 9-6" /><circle cx="3" cy="17" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="21" cy="6" r="1.4" /></>,
  okr: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.8" /><circle cx="12" cy="12" r="1.2" /></>,
  eisenhower: <><path d="M12 3.5v17M3.5 12h17" /><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M6.5 8l1.5 1.5L10.5 6.5" /></>,
  lean: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v11M15 4v11M3 15h18M9 9.5h6" /></>,
  sprint: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v4h-4M12 8v4l2.5 1.5" /></>,
  org: <><rect x="8.5" y="3" width="7" height="5" rx="1.2" /><rect x="2.5" y="16" width="7" height="5" rx="1.2" /><rect x="14.5" y="16" width="7" height="5" rx="1.2" /><path d="M12 8v4M6 16v-4h12v4" /></>,
  flow: <><rect x="8.5" y="3" width="7" height="4.5" rx="2.2" /><path d="M12 7.5v3" /><path d="m12 10.5 4 3.5-4 3.5-4-3.5z" /><path d="M12 17.5V21" /></>,
  impact: <><path d="M4 20V4M4 20h16" /><circle cx="9" cy="9" r="1.6" /><circle cx="15" cy="7" r="1.6" /><circle cx="14" cy="15" r="1.6" /><circle cx="8" cy="15.5" r="1.6" /></>,
  storymap: <><rect x="3" y="3.5" width="18" height="4" rx="1" /><rect x="3" y="10" width="4.5" height="4" rx="1" /><rect x="9.75" y="10" width="4.5" height="4" rx="1" /><rect x="16.5" y="10" width="4.5" height="4" rx="1" /><path d="M3 18h18" /></>,
};

export function CvIcon({ name, size = 18, stroke = 1.7 }) {
  const body = P[name];
  if (!body) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}

// Herramientas de dibujo que no caben en la barra principal: van al menú
// «Más herramientas»; si una está activa, se muestra también en la barra.
const DRAW_EXTRA = [
  { tool: 'vpen', icon: 'vpen', label: 'canvas.tool.vpen' },
  { tool: 'highlighter', icon: 'highlighter', label: 'canvas.tool.highlighter' },
  { tool: 'laser', icon: 'laser', label: 'canvas.tool.laser' },
  { tool: 'line', icon: 'line', label: 'canvas.tool.line' },
];

// Formas con texto (desplegable «Formas» de la barra principal): se insertan en el centro de la vista y se
// escribe al momento. Sirven para organigramas y diagramas (se conectan con flechas y con Tab).
const SHAPE_TOOLS = [
  { shape: 'rect', icon: 'rect', label: 'cv.shp.rect' },
  { shape: 'ellipse', icon: 'ellipse', label: 'cv.shp.ellipse' },
  { shape: 'diamond', icon: 'diamond', label: 'cv.shp.diamond' },
  { shape: 'hexagon', icon: 'hexagon', label: 'cv.shp.hexagon' },
  { shape: 'cylinder', icon: 'cylinder', label: 'cv.shp.cylinder' },
  { shape: 'triangle', icon: 'triangle', label: 'cv.shp.triangle' },
  { shape: 'cloud', icon: 'cloud', label: 'cv.shp.cloud' },
  { shape: 'callout', icon: 'callout', label: 'cv.shp.callout' },
  { shape: 'star', icon: 'star', label: 'cv.shp.star' },
];
// Formas dibujadas a mano (sin texto): siguen disponibles en «Más herramientas».
const DRAW_SHAPES = ['rect', 'ellipse', 'diamond', 'line'];

function ToolBtn({ icon, label, on, onClick, className = '', ...rest }) {
  return (
    <button type="button" className={`cv-tool${on ? ' on' : ''} ${className}`} onClick={onClick}
      aria-label={label} title={label} aria-pressed={on == null ? undefined : !!on} {...rest}>
      <CvIcon name={icon} />
    </button>
  );
}

// Barra principal (abajo, centrada). `a` = acciones de CanvasView.
export function CanvasDock({ tool, setTool, a }) {
  const [menu, setMenu] = useState(null);
  const [shapeMenu, setShapeMenu] = useState(null);
  const extra = DRAW_EXTRA.find(d => d.tool === tool);
  const drawn = DRAW_SHAPES.includes(tool) ? tool : null;
  const shapeItems = SHAPE_TOOLS.map(d => ({ label: t(d.label), icon: <CvIcon name={d.icon} size={15} />, onSelect: () => setTimeout(() => a.addShape(d.shape), 150) }));   // tras cerrar el menú, para que el foco no vuelva al botón y cierre el texto
  const items = [
    { type: 'head', label: t('cv.sec.draw') },
    ...DRAW_SHAPES.filter(k => k !== 'line').map(k => ({
      label: t('cv.draw.' + k), icon: <CvIcon name={k} size={15} />, checked: tool === k ? true : undefined, onSelect: () => setTool(k),
    })),
    ...DRAW_EXTRA.map(d => ({
      label: t(d.label), icon: <CvIcon name={d.icon} size={15} />, checked: tool === d.tool ? true : undefined,
      onSelect: () => setTool(d.tool),
    })),
    { type: 'sep' },
    { type: 'head', label: t('cv.sec.insert') },
    { label: t('cv.ins.card'), icon: <CvIcon name="card" size={15} />, onSelect: a.addTextNode },
    { label: t('cv.ins.label'), icon: <CvIcon name="label" size={15} />, onSelect: a.addLabelNode },
    { label: t('cv.ins.url'), icon: <CvIcon name="link" size={15} />, onSelect: a.addUrlNode },
    { label: t('cv.ins.image'), icon: <CvIcon name="image" size={15} />, onSelect: a.addImageNode },
    { label: t('cv.ins.attach'), icon: <CvIcon name="attach" size={15} />, onSelect: a.addAttachmentNode },
    { label: t('cv.ins.query'), icon: <CvIcon name="query" size={15} />, title: t('canvas.addQuery'), onSelect: a.addQueryNode },
  ];
  return (
    <div className="cv-dock" role="toolbar" aria-label={t('cv.tools')}>
      <ToolBtn icon="select" label={t('canvas.tool.select')} on={tool === 'select'} onClick={() => setTool('select')} />
      <ToolBtn icon="sticky" label={t('canvas.addSticky')} onClick={a.addSticky} />
      <ToolBtn icon="text" label={t('canvas.tool.text')} on={tool === 'text'} onClick={() => setTool('text')} />
      <ToolBtn icon="shapes" label={t('cv.shapes')} aria-haspopup="menu" aria-expanded={!!shapeMenu}
        onClick={(e) => setShapeMenu(e.currentTarget.getBoundingClientRect())} />
      <ToolBtn icon="arrow" label={t('canvas.tool.arrow')} on={tool === 'arrow'} onClick={() => setTool('arrow')} />
      <ToolBtn icon="pen" label={t('canvas.tool.pen')} on={tool === 'pen'} onClick={() => setTool('pen')} />
      <ToolBtn icon="eraser" label={t('canvas.tool.eraser')} on={tool === 'eraser'} onClick={() => setTool('eraser')} />
      <ToolBtn icon="bucket" label={t('canvas.tool.fill')} on={tool === 'fill'} onClick={() => setTool('fill')} />
      <ToolBtn icon="frame" label={t('canvas.addGroup')} onClick={a.addGroup} />
      {(extra || drawn) && <ToolBtn icon={(extra || { icon: drawn }).icon} label={extra ? t(extra.label) : t('cv.draw.' + drawn)} on onClick={() => setTool(extra ? extra.tool : drawn)} />}
      <span className="cv-sep" aria-hidden="true" />
      <ToolBtn icon="note" label={t('canvas.addNote')} onClick={a.addNoteNode} />
      <ToolBtn icon="more" label={t('cv.more')} aria-haspopup="menu" aria-expanded={!!menu}
        on={menu ? true : undefined} onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())} />
      {menu && <Menu anchor={menu} items={items} onClose={() => setMenu(null)} minWidth={240} label={t('cv.more')} className="cv-menu" />}
      {shapeMenu && <Menu anchor={shapeMenu} items={shapeItems} onClose={() => setShapeMenu(null)} minWidth={200} label={t('cv.shapes')} className="cv-menu" />}
    </div>
  );
}

// Acciones (arriba a la derecha): deshacer/rehacer, cuadrícula, orden,
// encajar, presentar, exportar, pantalla completa, atajos.
export function CanvasActions({ a, snapGrid, fullscreen }) {
  const [menu, setMenu] = useState(null);
  const open = (kind) => (e) => setMenu({ kind, anchor: e.currentTarget.getBoundingClientRect() });
  const layoutItems = [
    { label: t('canvas.layoutGrid'), icon: <CvIcon name="layout" size={15} />, onSelect: () => a.doAutoLayout('grid') },
    { label: t('canvas.layoutTree'), icon: <CvIcon name="mindmap" size={15} />, onSelect: () => a.doAutoLayout('tree') },
    { label: t('canvas.layoutMindmap'), icon: <CvIcon name="brainstorm" size={15} />, onSelect: () => a.doAutoLayout('mindmap') },
  ];
  const sessionItems = [
    ...[1, 3, 5, 10].map(m => ({ label: t('canvas.timer.start', { m }), icon: <CvIcon name="timer" size={15} />, onSelect: () => a.startTimer(m) })),
    ...(a.sessionTimer ? [{ label: t('canvas.timer.stop'), onSelect: a.stopTimer }] : []),
    { type: 'sep' },
    ...(a.sessionVote
      ? [{ label: a.sessionVote.open ? t('canvas.vote.end') : t('canvas.vote.close'), onSelect: a.sessionVote.open ? a.endVote : a.closeVote }]
      : [3, 5].map(n => ({ label: t('canvas.vote.start', { n }), icon: <span style={{ fontSize: 13 }}>🗳</span>, onSelect: () => a.startVote(n) }))),
  ];
  const exportItems = [
    { label: 'PNG', icon: <CvIcon name="image" size={15} />, title: t('canvas.exportPng'), onSelect: a.exportCanvasPng },
    { label: 'SVG', icon: <CvIcon name="download" size={15} />, title: t('canvas.exportSvg'), onSelect: a.exportCanvasSvg },
  ];
  // Arriba a la derecha solo lo de uso constante; el resto cuelga de «⋯».
  const moreItems = [
    { label: t('canvas.snapGrid'), icon: <CvIcon name="grid" size={15} />, checked: snapGrid ? true : undefined, onSelect: a.toggleSnap },
    { label: t('canvas.rulers.toggle'), icon: <CvIcon name="grid" size={15} />, checked: a.rulersOn ? true : undefined, onSelect: a.toggleRulers },
    { label: t('canvas.follow.toggle'), icon: <CvIcon name="present" size={15} />, checked: a.followAgent ? true : undefined, onSelect: a.toggleFollow },
    { label: t('canvas.autoLayout'), icon: <CvIcon name="layout" size={15} />, submenu: () => layoutItems },
    { label: t('canvas.session'), icon: <CvIcon name="timer" size={15} />, submenu: () => sessionItems },
    { type: 'sep' },
    { label: t('canvas.present.start'), icon: <CvIcon name="present" size={15} />, onSelect: a.startSlideshow },
    ...(a.openVersions ? [{ label: t('canvas.ver.open'), icon: <CvIcon name="timer" size={15} />, onSelect: a.openVersions }] : []),
    ...exportItems.map(x => ({ ...x, label: t('cv.export') + ' ' + x.label })),
    { label: fullscreen ? t('canvas.fullExit') : t('canvas.full'), icon: <CvIcon name={fullscreen ? 'fullExit' : 'full'} size={15} />, onSelect: a.toggleFullscreen },
    { label: t('canvas.shortcuts'), icon: <CvIcon name="help" size={15} />, onSelect: a.openShortcuts },
  ];
  return (
    <div className="cv-actions" role="toolbar" aria-label={t('cv.actions')}>
      <ToolBtn className="sm" icon="undo" label={t('canvas.undo')} onClick={a.canvasUndo} />
      <ToolBtn className="sm" icon="redo" label={t('canvas.redo')} onClick={a.canvasRedo} />
      <ToolBtn className="sm" icon="fit" label={t('canvas.fitContent')} onClick={a.fitToContent} />
      <ToolBtn className="sm" icon="props" label={t('cvp.title')} on={a.propsOpen ? true : undefined} onClick={a.toggleProps} />
      <ToolBtn className="sm" icon="more" label={t('cv.more')} aria-haspopup="menu"
        on={menu ? true : undefined} onClick={open('more')} />
      {menu && (
        <Menu anchor={menu.anchor} align="end" items={moreItems} onClose={() => setMenu(null)} minWidth={230} className="cv-menu" label={t('cv.more')} />
      )}
    </div>
  );
}

export function CanvasZoom({ zoom, onIn, onOut, onReset }) {
  return (
    <div className="cv-zoom" role="group" aria-label={t('cv.zoom')}>
      <button type="button" className="cv-zbtn" onClick={onOut} aria-label={t('canvas.zoomOut')} title={t('canvas.zoomOut')}><CvIcon name="minus" size={16} /></button>
      <button type="button" className="cv-zval" onClick={onReset} aria-label={t('canvas.zoomReset')} title={t('canvas.zoomReset')}>{Math.round(zoom * 100)}%</button>
      <button type="button" className="cv-zbtn" onClick={onIn} aria-label={t('canvas.zoomIn')} title={t('canvas.zoomIn')}><CvIcon name="plus" size={16} /></button>
    </div>
  );
}
