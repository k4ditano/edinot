// Nivel de detalle (LOD) del canvas con zoom muy alejado — como AFFiNE.
//
// Con miles de fichas visibles a la vez (zoom < LOD_ZOOM), pintar cada una como
// un componente React/DOM bloqueaba la página (5.000 fichas → sin respuesta).
// En ese caso las fichas no seleccionadas se dibujan como rectángulos simples
// en UN <canvas> en coordenadas de pantalla, que se redibuja en cada frame de
// pan/zoom (barato: solo rects y, si caben, el título).

export const LOD_ZOOM = 0.35;
export const LOD_MIN_VISIBLE = 200;

const KIND_FILL = { note: null, text: null, url: '#e8eef7', image: '#e9e7e2', video: '#e9e7e2', query: '#f6ead2', code: '#ececec' };

function firstLine(n) {
  const s = n.title || n.label || n.text || n.name || n.url || '';
  const l = String(s).split('\n').find(x => x.trim()) || '';
  return l.replace(/^#+\s*/, '').slice(0, 80);
}

// nodes: [{x,y,w,h,...}] en coordenadas del mundo; vp: {x,y,zoom}.
export function drawLod(canvas, nodes, vp, rectOf, colors) {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!nodes || !nodes.length) return;
  const z = vp.zoom || 1;
  const showText = z >= 0.12;
  ctx.font = `500 ${Math.max(9, Math.min(12, 40 * z))}px ${colors.font || 'system-ui, sans-serif'}`;
  ctx.textBaseline = 'top';
  for (const n of nodes) {
    const r = rectOf(n);
    const sx = r.x * z + vp.x, sy = r.y * z + vp.y, sw = Math.max(2, r.w * z), sh = Math.max(2, r.h * z);
    if (sx > w || sy > h || sx + sw < 0 || sy + sh < 0) continue;
    const fill = n.color || (n.sticky ? '#f3d27a' : (KIND_FILL[n.kind] || colors.card));
    ctx.fillStyle = fill;
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    const rad = Math.min(6, sw / 6, sh / 6);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sx, sy, sw, sh, rad); else ctx.rect(sx, sy, sw, sh);
    ctx.fill();
    if (!n.color && !n.sticky) ctx.stroke();
    if (showText && sh > 14 && sw > 30) {
      const t = firstLine(n);
      if (t) {
        ctx.fillStyle = n.sticky || n.color ? '#1f1f1e' : colors.fg;
        ctx.save();
        ctx.beginPath(); ctx.rect(sx + 4, sy + 3, sw - 8, sh - 6); ctx.clip();
        ctx.fillText(t, sx + 6, sy + 5);
        ctx.restore();
      }
    }
  }
}
