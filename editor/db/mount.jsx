// Montaje de los bloques de base de datos en el panel Leer y en los widgets
// de Live Preview.
//
// Ambos reconstruyen su DOM en cada cambio del documento (innerHTML del
// render / widget nuevo de CodeMirror). Para no perder el estado (celda en
// edición, popover abierto, scroll, foco) cada bloque vive en un <div
// class="db-host"> con su propia raíz de React que se guarda en `cache` y se
// vuelve a colgar del DOM nuevo: React sólo recibe props nuevas.

import { createRoot } from 'react-dom/client';
import { lazyModule, withLazy, BlockSkeleton } from '../../ui/shared/lazy.jsx';
import { LinkedDatabase } from './linked.jsx';

// El bloque (vistas, celdas, página de fila…) es un chunk aparte: sólo se
// pide cuando una nota tiene una base de datos. editor.jsx lo precarga en
// reposo tras el arranque, así que el primer bloque casi nunca espera.
export const loadDatabaseBlock = lazyModule(() => import('./DatabaseBlock.jsx'));
const DatabaseBlock = withLazy(loadDatabaseBlock, 'DatabaseBlock', { fallback: <BlockSkeleton height={220} /> });

const ISOLATE = ['click', 'dblclick', 'contextmenu', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop', 'input', 'change', 'focusout', 'focusin'];
// Sólo si vienen de un campo de texto del bloque (pegar en una celda no debe
// adjuntar nada a la nota ni llegar a CodeMirror).
const FIELD_ONLY = ['paste', 'copy', 'cut', 'beforeinput', 'keyup'];
// Atajos de la app que deben llegar aunque se esté escribiendo en una celda:
// Ctrl/⌘ F (buscar en la nota), Ctrl/⌘ ⇧ F (en todas) y Ctrl/⌘ K.
export const isAppShortcut = (e) => !!e && (e.ctrlKey || e.metaKey) && !e.altKey && /^[fk]$/i.test(e.key || '');
const isField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
const hasFiles = (e) => { const ty = e.dataTransfer && e.dataTransfer.types; return !!ty && Array.from(ty).some(x => x === 'Files'); };

function createEntry(key) {
  const el = document.createElement('div');
  el.className = 'db-host';
  el.setAttribute('contenteditable', 'false');
  const root = createRoot(el);
  const entry = { key, el, root, lastFocused: null, seen: Date.now() };
  el.addEventListener('focusin', (e) => { entry.lastFocused = e.target; });
  el.addEventListener('focusout', () => {
    // Al descolgar el bloque del DOM no hay que olvidar el foco: se repone al
    // volver a montarlo. Sólo se olvida si de verdad se fue a otro sitio.
    setTimeout(() => { if (entry.el.isConnected && !entry.el.contains(document.activeElement)) entry.lastFocused = null; }, 0);
  });
  // Los manejadores del panel Leer (clic en celda → editor antiguo, arrastre
  // de kanban, renombrar con doble clic…) y de CodeMirror no deben ver los
  // eventos del bloque: React ya los ha atendido en su raíz (este mismo nodo).
  for (const type of ISOLATE) {
    el.addEventListener(type, (e) => {
      if ((type === 'drop' || type === 'dragover' || type === 'dragenter' || type === 'dragleave') && hasFiles(e)) return;
      e.stopPropagation();
    });
  }
  for (const type of FIELD_ONLY) el.addEventListener(type, (e) => { if (isField(e.target)) e.stopPropagation(); });
  el.addEventListener('keydown', (e) => {
    if ((isField(e.target) || e.defaultPrevented) && !isAppShortcut(e)) e.stopPropagation();
  });
  return entry;
}

// props: { meta, idx, ctxRef, ops, surface }
export function mountDbBlock(cache, key, host, props) {
  return mountInto(cache, key, host, <DatabaseBlock key="db" {...props} />);
}

// Vista enlazada (linked.jsx). props: { cfg, env, baseCtxRef, ops, surface, onConfig }
export function mountLinkedDb(cache, key, host, props) {
  return mountInto(cache, key, host, <LinkedDatabase key="linked" {...props} DatabaseBlock={DatabaseBlock} />);
}

function mountInto(cache, key, host, element) {
  let entry = cache.get(key);
  if (!entry) { entry = createEntry(key); cache.set(key, entry); }
  const prevFocus = entry.lastFocused;
  if (entry.el.parentNode !== host) host.appendChild(entry.el);
  entry.seen = Date.now();
  // El descolgado se lleva el foco (el input en edición, la tabla…): se repone
  // en el mismo tick para que el blur diferido no confirme la edición.
  if (prevFocus && prevFocus.isConnected && entry.el.contains(prevFocus)) {
    const ae = document.activeElement;
    if (!ae || ae === document.body || ae === document.documentElement) {
      try { prevFocus.focus({ preventScroll: true }); } catch {}
    }
  }
  entry.root.render(element);
  return entry;
}

// Desmonta las raíces que ya no se usan. Con `alive` (Set de claves) se
// conservan sólo esas; sin él, las que llevan un rato fuera del DOM.
export function sweepDbBlocks(cache, alive, prefix) {
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (prefix && !k.startsWith(prefix)) continue;
    const dead = alive ? !alive.has(k) : (!entry.el.isConnected && now - entry.seen > 4000);
    if (!dead) continue;
    cache.delete(k);
    // Nunca desmontar de forma síncrona dentro del render de otra raíz.
    setTimeout(() => { try { entry.root.unmount(); } catch {} }, 0);
  }
}
