// Presencia en el canvas: cursores y selecciones remotas sobre el awareness de Yjs
// que ya usa Edinot (store.js: provider.awareness con `user` = { email, userId, color }).
// Cada cliente publica:
//   canvasCursor: { x, y }   posición del puntero en coordenadas del MUNDO
//   canvasSel:    [ids]      elementos seleccionados
// Lógica pura (sin React ni DOM) para poder probarla en Node.

const nameOf = (u) => ((u && u.email) ? String(u.email).split('@')[0] : '') || 'usuario';

export function createCanvasPresence(awareness, onRemotes, opts = {}) {
  const throttleMs = opts.throttleMs != null ? opts.throttleMs : 40;
  const now = opts.now || (() => Date.now());
  let last = 0, pending = null, timer = null, destroyed = false, lastSig = '[]';

  const compute = () => {
    if (destroyed) return;
    const out = [];
    awareness.getStates().forEach((st, cid) => {
      if (cid === awareness.clientID || !st || !st.canvasCursor) return;
      const u = st.user || {};
      out.push({
        id: cid, name: nameOf(u), color: u.color || '#3b82f6',
        x: st.canvasCursor.x, y: st.canvasCursor.y,
        sel: Array.isArray(st.canvasSel) ? st.canvasSel.slice(0, 200) : [],
      });
    });
    out.sort((a, b) => a.id - b.id);
    const sig = JSON.stringify(out);
    if (sig === lastSig) return;          // sin cambios: no se vuelve a pintar
    lastSig = sig;
    onRemotes(out);
  };
  awareness.on('change', compute);
  compute();

  const flush = () => {
    timer = null;
    if (!pending || destroyed) return;
    last = now();
    awareness.setLocalStateField('canvasCursor', pending);
    pending = null;
  };
  return {
    // Publica el puntero (acotado a ~25 mensajes/s).
    publishCursor(x, y) {
      if (destroyed) return;
      pending = { x: Math.round(x), y: Math.round(y) };
      const wait = throttleMs - (now() - last);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    },
    clearCursor() { pending = null; if (!destroyed) awareness.setLocalStateField('canvasCursor', null); },
    publishSelection(ids) {
      if (destroyed) return;
      const list = Array.from(ids || []).slice(0, 200);
      const cur = (awareness.getLocalState() || {}).canvasSel || [];
      if (list.length === cur.length && list.every((v, i) => v === cur[i])) return;
      awareness.setLocalStateField('canvasSel', list.length ? list : null);
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      awareness.off('change', compute);
      try { awareness.setLocalStateField('canvasCursor', null); awareness.setLocalStateField('canvasSel', null); } catch {}
    },
  };
}
