// Canal entre las extensiones de CodeMirror del editor de bloques (DOM puro,
// fuera de React) y la capa de UI en React (menú «/», menú de bloque, barra
// flotante, popovers de propiedades). Solo hay un editor activo a la vez, así
// que basta con un emisor de módulo.

const listeners = new Map(); // evento → Set<fn>

export const blockBus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => { const s = listeners.get(evt); if (s) s.delete(fn); };
  },
  emit(evt, payload) {
    const s = listeners.get(evt);
    if (!s) return false;
    let handled = false;
    for (const fn of [...s]) {
      try { if (fn(payload) === true) handled = true; } catch (err) { console.warn('[blocks]', evt, err); }
    }
    return handled;
  },
  // Estado compartido del menú «/»: lo consulta el keymap de CodeMirror para
  // saber si las flechas/Enter/Esc son para el menú.
  slash: null, // { view, from } mientras está abierto
  menuOpen: false, // algún popover del editor de bloques tiene el teclado
};

// Depuración / tests de humo.
try { if (typeof window !== "undefined") window.__edinotBlockBus = blockBus; } catch {}
