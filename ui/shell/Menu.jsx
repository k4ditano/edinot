// Menú emergente genérico del shell: lo usan el ⋯ de la barra superior, el
// selector de modos, el clic derecho del árbol, el selector de workspace…
//
//   <Menu anchor={{ x, y } | DOMRect} onClose={fn} items={[…]} align="start|end" />
//
// Cada item: { label, icon, kbd, onSelect, danger, disabled, checked, hint }
//            { type: 'sep' } · { type: 'head', label }
//            { label, submenu: () => items }  → abre un nivel con «← Atrás»
//            { type: 'custom', render: (close) => node }
//
// Teclado: ↑↓ (Inicio/Fin), Enter/Espacio, → entra al submenú, ← vuelve,
// Esc cierra. Se monta en un portal sobre <body> y se recoloca para no
// salirse de la ventana.

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n.js';
import { Icon } from './icons.jsx';

function anchorPoint(anchor, align) {
  if (!anchor) return { x: 0, y: 0, below: 0 };
  if (typeof anchor.left === 'number' && typeof anchor.bottom === 'number') {
    return { x: align === 'end' ? anchor.right : anchor.left, y: anchor.bottom + 6, top: anchor.top };
  }
  return { x: anchor.x || 0, y: anchor.y || 0, top: anchor.y || 0 };
}

export function Menu({ anchor, items, onClose, align = 'start', minWidth = 220, className = '', label }) {
  const [stack, setStack] = useState([]); // submenus abiertos (listas de items)
  const [focus, setFocus] = useState(-1);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const ref = useRef(null);
  const list = stack.length ? stack[stack.length - 1].items : items;
  const actionable = list.map((it, i) => ({ it, i })).filter(({ it }) => !it.type && !it.disabled);

  const close = useCallback(() => { onClose && onClose(); }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const p = anchorPoint(anchor, align);
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, m = 8;
    let left = align === 'end' ? p.x - r.width : p.x;
    let top = p.y;
    if (top + r.height > vh - m) {
      const flipped = (p.top != null ? p.top : p.y) - r.height - 6;
      top = flipped >= m ? flipped : Math.max(m, vh - r.height - m);
    }
    left = Math.max(m, Math.min(left, vw - r.width - m));
    setPos({ left, top });
  }, [anchor, align, stack.length]);

  useEffect(() => {
    // Foco al primer item activable al abrir (y al entrar/salir de un nivel).
    setFocus(actionable.length ? actionable[0].i : -1);
    const id = requestAnimationFrame(() => { if (ref.current) ref.current.focus(); });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack.length]);

  useEffect(() => {
    if (focus < 0 || !ref.current) return;
    const el = ref.current.querySelector(`[data-mi="${focus}"]`);
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); }
  }, [focus, stack.length]);

  const activate = (it) => {
    if (!it || it.disabled || it.type) return;
    if (it.submenu) {
      const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
      setStack(s => [...s, { label: it.label, items: sub }]);
      return;
    }
    if (it.keepOpen) { it.onSelect && it.onSelect(); return; }
    close();
    // Tras cerrar: las acciones que abren otro modal/prompt no deben pelear
    // con el foco que devuelve el menú.
    if (it.onSelect) setTimeout(() => it.onSelect(), 0);
  };

  const onKeyDown = (e) => {
    const idxInAct = actionable.findIndex(a => a.i === focus);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (stack.length) setStack(s => s.slice(0, -1)); else close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (actionable.length) setFocus(actionable[(idxInAct + 1) % actionable.length].i); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (actionable.length) setFocus(actionable[(idxInAct - 1 + actionable.length) % actionable.length].i); return; }
    if (e.key === 'Home') { e.preventDefault(); if (actionable.length) setFocus(actionable[0].i); return; }
    if (e.key === 'End') { e.preventDefault(); if (actionable.length) setFocus(actionable[actionable.length - 1].i); return; }
    if (e.key === 'ArrowLeft' && stack.length) { e.preventDefault(); setStack(s => s.slice(0, -1)); return; }
    if (e.key === 'ArrowRight') { const it = list[focus]; if (it && it.submenu) { e.preventDefault(); activate(it); } return; }
    if (e.key === 'Tab') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      e.preventDefault(); activate(list[focus]);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="sh-menu-backdrop" onMouseDown={(e) => { e.preventDefault(); close(); }}
        onContextMenu={(e) => { e.preventDefault(); close(); }} />
      <div ref={ref} className={`sh-menu ${className}`} role="menu" aria-label={label}
        tabIndex={-1} style={{ left: pos.left, top: pos.top, minWidth }}
        onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
        {stack.length > 0 && (
          <>
            <button type="button" className="sh-mi sh-mi-back" onClick={() => setStack(s => s.slice(0, -1))}>
              <span className="sh-mi-ic"><Icon name="back" size={15} /></span>
              <span className="sh-mi-label">{t('shell.menu.back')}</span>
            </button>
            <div className="sh-mi-head">{stack[stack.length - 1].label}</div>
          </>
        )}
        {list.map((it, i) => {
          if (it.type === 'sep') return <div key={'s' + i} className="sh-mi-sep" role="separator" />;
          if (it.type === 'head') return <div key={'h' + i} className="sh-mi-head">{it.label}</div>;
          if (it.type === 'custom') return <div key={'c' + i} className="sh-mi-custom">{it.render(close)}</div>;
          return (
            <button key={i} type="button" data-mi={i}
              role={it.checked != null ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={it.checked != null ? !!it.checked : undefined}
              aria-haspopup={it.submenu ? 'menu' : undefined}
              disabled={it.disabled}
              className={`sh-mi${it.danger ? ' danger' : ''}${focus === i ? ' focused' : ''}`}
              onMouseEnter={() => !it.disabled && setFocus(i)}
              onClick={() => activate(it)}
              title={it.title}>
              <span className="sh-mi-ic">
                {it.checked ? <Icon name="check" size={15} /> : (typeof it.icon === 'string' ? <Icon name={it.icon} size={15} /> : (it.icon || null))}
              </span>
              <span className="sh-mi-label">
                {it.label}
                {it.hint && <span className="sh-mi-hint">{it.hint}</span>}
              </span>
              {it.kbd && <span className="sh-mi-kbd">{it.kbd}</span>}
              {it.submenu && <span className="sh-mi-chev"><Icon name="chevRight" size={13} /></span>}
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
}

// Hook de conveniencia: estado { anchor } + open/close para un menú.
export function useMenu() {
  const [state, setState] = useState(null);
  const openAt = useCallback((anchor, payload) => setState({ anchor, payload }), []);
  const openFromEvent = useCallback((e, payload) => {
    const r = e.currentTarget.getBoundingClientRect();
    setState({ anchor: r, payload });
  }, []);
  const close = useCallback(() => setState(null), []);
  return { state, openAt, openFromEvent, close };
}
