// Animación en el canvas (como los prototipos de Figma). Lógica pura + Web Animations.
//
// Cada elemento puede llevar:
//   anim = { enter: 'fade'|'up'|'down'|'left'|'right'|'scale'|'pop'|'blur', dur: 450, delay: 0,
//            hover: 'lift'|'grow'|'dim'|'glow'|'press', loop: 'pulse'|'spin'|'bounce'|'float'|'blink'|'wiggle' }
//   link + linkAnim: 'instant'|'dissolve'|'move'|'slide'|'smart'   (transición al saltar a otra pantalla)
// Las entradas suenan al llegar a una pantalla en la presentación; hover y bucles, mientras se presenta.

export const ENTER_TYPES = ['fade', 'up', 'down', 'left', 'right', 'scale', 'pop', 'blur'];
export const HOVER_TYPES = ['lift', 'grow', 'dim', 'glow', 'press'];
export const LOOP_TYPES = ['pulse', 'spin', 'bounce', 'float', 'blink', 'wiggle'];
export const LINK_ANIMS = ['move', 'instant', 'dissolve', 'slide', 'smart'];

/** Fotogramas (Web Animations) de una entrada. Usa las propiedades sueltas translate/scale, que se suman a la
 *  posición del elemento en vez de pisarla. */
export function enterKeyframes(type, d = 24) {
  const end = { opacity: 1, translate: '0px 0px', scale: '1', filter: 'blur(0px)' };
  switch (type) {
    case 'up': return [{ opacity: 0, translate: `0px ${d}px` }, end];
    case 'down': return [{ opacity: 0, translate: `0px ${-d}px` }, end];
    case 'left': return [{ opacity: 0, translate: `${d}px 0px` }, end];
    case 'right': return [{ opacity: 0, translate: `${-d}px 0px` }, end];
    case 'scale': return [{ opacity: 0, scale: '0.85' }, end];
    case 'pop': return [{ opacity: 0, scale: '0.6' }, { opacity: 1, scale: '1.06', offset: 0.7 }, end];
    case 'blur': return [{ opacity: 0, filter: 'blur(10px)' }, end];
    default: return [{ opacity: 0 }, { opacity: 1 }];
  }
}

export function playEnter(el, anim) {
  if (!el || !anim || !anim.enter || typeof el.animate !== 'function') return null;
  try {
    return el.animate(enterKeyframes(anim.enter), {
      duration: Math.max(60, Number(anim.dur) || 450), delay: Math.max(0, Number(anim.delay) || 0),
      easing: anim.enter === 'pop' ? 'cubic-bezier(.2,.9,.3,1.2)' : 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards',
    });
  } catch { return null; }
}

// ── Pantallas (marcos) y sus piezas ─────────────────────────────────────
const nodeBox = (n) => ({ x: n.x || 0, y: n.y || 0, w: n.w || 240, h: n.h || 140 });
const annoBox = (a) => (a.bbox ? { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h } : null);
const inside = (b, f) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx >= f.x && cx <= f.x + (f.w || 0) && cy >= f.y && cy <= f.y + (f.h || 0); };

/** Piezas de una pantalla: [{ kind: 'n'|'a', item, box }]. */
export function frameItems(json, frame) {
  const out = [];
  for (const n of json.nodes || []) { const b = nodeBox(n); if (!n.hidden && n.kind !== 'page' && inside(b, frame)) out.push({ kind: 'n', item: n, box: b }); }
  for (const a of json.annotations || []) { const b = annoBox(a); if (b && !a.hidden && inside(b, frame)) out.push({ kind: 'a', item: a, box: b }); }
  return out;
}

const keyOf = (it) => {
  const x = it.item;
  if (x.smart) return 's:' + x.smart;
  if (x.cref) return 'r:' + x.cref + ':' + (x.text || '');
  if (x.cmain) return 'r:' + x.id + ':' + (x.text || '');
  if (typeof x.text === 'string' && x.text.trim()) return 't:' + x.kind + ':' + x.text.trim();
  return null;
};

/**
 * «Smart animate»: piezas de la pantalla de destino que también están en la de origen (misma clave `smart`, mismo
 * texto o la misma pieza de un componente). Para cada una, cuánto hay que desplazarla al empezar (dx, dy) para que
 * salga desde donde estaba en la pantalla de origen, en coordenadas relativas a cada pantalla.
 */
export function smartPairs(json, fromFrame, toFrame) {
  const src = new Map();
  for (const it of frameItems(json, fromFrame)) { const k = keyOf(it); if (k && !src.has(k)) src.set(k, it); }
  const out = [];
  for (const it of frameItems(json, toFrame)) {
    const k = keyOf(it);
    const s = k && src.get(k);
    if (!s) { out.push({ id: it.item.id, kind: it.kind, matched: false }); continue; }
    const dx = (s.box.x - fromFrame.x) - (it.box.x - toFrame.x);
    const dy = (s.box.y - fromFrame.y) - (it.box.y - toFrame.y);
    const sc = it.box.w > 0 ? s.box.w / it.box.w : 1;
    out.push({ id: it.item.id, kind: it.kind, matched: true, dx, dy, scale: Math.abs(sc - 1) > 0.02 ? sc : 1 });
  }
  return out;
}
