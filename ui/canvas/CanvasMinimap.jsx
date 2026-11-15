// Minimapa del canvas: los nodos se pintan UNA vez en un <canvas> (no un <div>
// por nodo) y sólo el rectángulo del viewport es DOM. Los límites se calculan en
// una pasada (sin Math.min(...spread), que revienta la pila con muchos nodos).

import { memo, useEffect, useMemo, useRef } from 'react';

const MM = 168, MMH = 112, PAD = 6;

function boundsOf(nodes, groups, dims) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (it, dw, dh) => {
    const x = it.x || 0, y = it.y || 0, w = it.w || dw, h = it.h || dh;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  };
  for (const n of nodes) add(n, dims.nodeW, dims.nodeH);
  for (const g of groups) add(g, dims.nodeW, dims.nodeH);
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

function CanvasMinimapImpl({ nodes, groups, viewport, panSize, dims, title, onGoTo }) {
  const canvasRef = useRef(null);
  const b = useMemo(() => boundsOf(nodes, groups, dims), [nodes, groups, dims]);
  const geom = useMemo(() => {
    if (!b) return null;
    const cw = Math.max(1, b.maxX - b.minX), ch = Math.max(1, b.maxY - b.minY);
    return { ...b, scale: Math.min((MM - PAD * 2) / cw, (MMH - PAD * 2) / ch) };
  }, [b]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !geom) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = MM * dpr; cv.height = MMH * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, MM, MMH);
    const accent = (getComputedStyle(cv).getPropertyValue('--accent') || '').trim() || '#5a7a4e';
    const px = (x) => PAD + (x - geom.minX) * geom.scale;
    const py = (y) => PAD + (y - geom.minY) * geom.scale;
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1;
    for (const gr of groups) {
      g.strokeRect(px(gr.x || 0) + 0.5, py(gr.y || 0) + 0.5,
        Math.max(3, (gr.w || dims.groupW) * geom.scale), Math.max(3, (gr.h || dims.groupH) * geom.scale));
    }
    g.globalAlpha = 0.7;
    for (const n of nodes) {
      g.fillStyle = n.color || accent;
      g.fillRect(px(n.x || 0), py(n.y || 0), Math.max(2, (n.w || dims.nodeW) * geom.scale), Math.max(2, (n.h || dims.nodeH) * geom.scale));
    }
    g.globalAlpha = 1;
  }, [geom, nodes, groups, dims]);

  if (!geom) return null;
  const { scale, minX, minY } = geom;
  const vw = (panSize.w || 0) / viewport.zoom, vh = (panSize.h || 0) / viewport.zoom;
  const vx = PAD + (-viewport.x / viewport.zoom - minX) * scale;
  const vy = PAD + (-viewport.y / viewport.zoom - minY) * scale;
  const goTo = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onGoTo((e.clientX - r.left - PAD) / scale + minX, (e.clientY - r.top - PAD) / scale + minY);
  };
  return (
    <div title={title} onMouseDown={(e) => { e.stopPropagation(); goTo(e); }} className="cv-minimap" style={{ width: MM, height: MMH }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: MM, height: MMH, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: vx, top: vy, width: Math.max(4, vw * scale), height: Math.max(4, vh * scale), border: '1.5px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', borderRadius: 2, pointerEvents: 'none' }} />
    </div>
  );
}

export const CanvasMinimap = memo(CanvasMinimapImpl);
