// Primitivas de interfaz de las bases de datos: capa flotante (portal con los
// tokens del tema copiados de .macwin), popover posicionado, menú con
// submenús y teclado, pills y avatares.

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n.js';
import { DbIcon } from './icons.jsx';
import { avatarColor, personName } from './model.js';

// ── Capa flotante ──────────────────────────────────────────────────────
// Un único <div class="db-portal"> en <body>. Los tokens del tema viven en
// .macwin (estilo en línea), así que se copian aquí cada vez que se abre algo:
// así un menú respeta el tema aunque se haya cambiado en caliente.
const THEME_VARS = ['--bg', '--toolbar', '--fg', '--muted', '--accent', '--side', '--panel', '--line',
  '--hover', '--accent-soft', '--faint', '--hl', '--accent-fg', '--shadow-pop', '--font-ui', '--font-mono', '--font-serif'];
let portalEl = null;
export function syncPortalTheme() {
  if (!portalEl || typeof document === 'undefined') return;
  const mac = document.querySelector('.macwin');
  if (!mac) return;
  const cs = getComputedStyle(mac);
  for (const v of THEME_VARS) {
    const val = cs.getPropertyValue(v);
    if (val && val.trim()) portalEl.style.setProperty(v, val.trim());
  }
  portalEl.classList.toggle('dark', mac.classList.contains('dark'));
}
export function getPortalRoot() {
  if (typeof document === 'undefined') return null;
  if (!portalEl || !portalEl.isConnected) {
    portalEl = document.createElement('div');
    portalEl.className = 'db-portal';
    // Las teclas que se escriben en un menú no deben llegar a los atajos
    // globales de la app (Ctrl K, Esc de los modos…).
    portalEl.addEventListener('keydown', (e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); });
    document.body.appendChild(portalEl);
  }
  syncPortalTheme();
  return portalEl;
}

export function rectOf(el) {
  if (!el || !el.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}
function normAnchor(a) {
  if (!a) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  if (typeof a.left === 'number' && typeof a.bottom === 'number') return a;
  const x = a.x || 0, y = a.y || 0;
  return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
}

// placement: 'below' (por defecto) · 'cover' (encima de la celda, para editores)
export function Popover({ anchor, onClose, children, className = '', width, minWidth, align = 'start', placement = 'below', label, autoFocus = true }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const a = normAnchor(anchor);
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, m = 8, gap = 6;
    let left, top;
    if (placement === 'cover') {
      left = a.left; top = a.top;
      if (top + r.height > vh - m) top = Math.max(m, vh - m - r.height);
    } else {
      left = align === 'end' ? a.right - r.width : a.left;
      top = a.bottom + gap;
      if (top + r.height > vh - m) {
        const up = a.top - gap - r.height;
        top = up >= m ? up : Math.max(m, vh - m - r.height);
      }
    }
    left = Math.max(m, Math.min(left, vw - r.width - m));
    setPos(p => (p.left === left && p.top === top ? p : { left, top }));
  }, [anchor, align, placement]);
  useLayoutEffect(() => { place(); }, [place]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);
  useEffect(() => {
    if (!autoFocus) return undefined;
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      const f = el.querySelector('[data-autofocus]') || el.querySelector('input, textarea, select, button:not([disabled])');
      if (f) f.focus({ preventScroll: true }); else el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);
  const root = getPortalRoot();
  if (!root) return null;
  const a = normAnchor(anchor);
  const style = { left: pos.left, top: pos.top };
  if (width) style.width = width;
  if (placement === 'cover') style.minWidth = Math.max(minWidth || 0, Math.round(a.width));
  else if (minWidth) style.minWidth = minWidth;
  return createPortal(
    <>
      <div className="db-pop-backdrop" onMouseDown={(e) => { e.preventDefault(); onClose && onClose('outside'); }}
        onContextMenu={(e) => { e.preventDefault(); onClose && onClose('outside'); }} />
      <div ref={ref} className={`db-pop ${className}`} role="dialog" aria-label={label} tabIndex={-1} style={style}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose && onClose('escape'); }
        }}>
        {children}
      </div>
    </>,
    root,
  );
}

// ── Menú ───────────────────────────────────────────────────────────────
// items: { label, icon, onSelect, danger, checked, disabled, hint, kbd, submenu: () => items, keepOpen }
//        { type: 'sep' } · { type: 'head', label } · { type: 'custom', render: (close) => node }
export function DbMenu({ anchor, items, onClose, align = 'start', minWidth = 220, label, className = '' }) {
  const [stack, setStack] = useState([]);
  const [focus, setFocus] = useState(-1);
  const listRef = useRef(null);
  const list = stack.length ? stack[stack.length - 1].items : items;
  const actionable = list.map((it, i) => ({ it, i })).filter(({ it }) => !it.type && !it.disabled);
  const close = useCallback(() => { onClose && onClose(); }, [onClose]);
  useEffect(() => {
    const hasCustomInput = list.some(it => it.type === 'custom');
    setFocus(hasCustomInput ? -1 : (actionable.length ? actionable[0].i : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack.length]);
  useEffect(() => {
    if (focus < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-mi="${focus}"]`);
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
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
    if (it.onSelect) setTimeout(() => it.onSelect(), 0);
  };
  const onKeyDown = (e) => {
    const tgt = e.target;
    const inField = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA');
    const idx = actionable.findIndex(a => a.i === focus);
    if (e.key === 'ArrowDown') { e.preventDefault(); if (actionable.length) setFocus(actionable[(idx + 1) % actionable.length].i); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (actionable.length) setFocus(actionable[(idx - 1 + actionable.length) % actionable.length].i); return; }
    if (inField) return;
    if (e.key === 'ArrowLeft' && stack.length) { e.preventDefault(); setStack(s => s.slice(0, -1)); return; }
    if (e.key === 'ArrowRight') { const it = list[focus]; if (it && it.submenu) { e.preventDefault(); activate(it); } return; }
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); e.stopPropagation(); setStack(s => s.slice(0, -1)); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(list[focus]); }
  };
  return (
    <Popover anchor={anchor} onClose={close} align={align} minWidth={minWidth} label={label} className={`db-menu ${className}`} autoFocus={false}>
      <div ref={listRef} role="menu" className="db-menu-list" onKeyDown={onKeyDown} tabIndex={-1}>
        {stack.length > 0 && (
          <>
            <button type="button" className="db-mi db-mi-back" onClick={() => setStack(s => s.slice(0, -1))}>
              <span className="db-mi-ic"><DbIcon name="chevLeft" /></span>
              <span className="db-mi-label">{stack[stack.length - 1].label}</span>
            </button>
            <div className="db-mi-sep" role="separator" />
          </>
        )}
        {list.map((it, i) => {
          if (it.type === 'sep') return <div key={'s' + i} className="db-mi-sep" role="separator" />;
          if (it.type === 'head') return <div key={'h' + i} className="db-mi-head">{it.label}</div>;
          if (it.type === 'custom') return <div key={'c' + i} className="db-mi-custom">{it.render(close)}</div>;
          return (
            <button key={i} type="button" data-mi={i}
              role={it.checked != null ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={it.checked != null ? !!it.checked : undefined}
              aria-haspopup={it.submenu ? 'menu' : undefined}
              disabled={it.disabled}
              className={`db-mi${it.danger ? ' danger' : ''}${focus === i ? ' focused' : ''}`}
              onMouseEnter={() => !it.disabled && setFocus(i)}
              onClick={() => activate(it)}
              title={it.title}>
              <span className="db-mi-ic">{typeof it.icon === 'string' ? <DbIcon name={it.icon} size={15} /> : (it.icon || null)}</span>
              <span className="db-mi-label">{it.label}{it.hint ? <span className="db-mi-hint">{it.hint}</span> : null}</span>
              {it.checked ? <span className="db-mi-check"><DbIcon name="check" size={14} /></span> : null}
              {it.kbd ? <span className="db-mi-kbd">{it.kbd}</span> : null}
              {it.submenu ? <span className="db-mi-chev"><DbIcon name="chevRight" size={13} /></span> : null}
            </button>
          );
        })}
        {list.length === 0 && <div className="db-mi-empty">{t('db.menu.empty')}</div>}
      </div>
    </Popover>
  );
}

// ── Piezas ─────────────────────────────────────────────────────────────
export function Pill({ color = 'gray', dot = false, children, onRemove, title }) {
  return (
    <span className={`db-pill db-c-${color}${dot ? ' db-pill-dot' : ''}`} title={title}>
      {dot ? <span className="db-dot" aria-hidden="true" /> : null}
      <span className="db-pill-text">{children}</span>
      {onRemove ? (
        <button type="button" className="db-pill-x" aria-label={t('db.remove')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <DbIcon name="close" size={11} stroke={2.2} />
        </button>
      ) : null}
    </span>
  );
}
export function Avatar({ token, size = 22 }) {
  const name = personName(token);
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <span className="db-av" style={{ background: avatarColor(token), width: size, height: size, fontSize: Math.round(size / 2) }} title={token} aria-hidden="true">
      {initial}
    </span>
  );
}
export function IconButton({ icon, label, onClick, className = '', active = false, size = 15, disabled, children, title }) {
  return (
    <button type="button" className={`db-ib${active ? ' on' : ''} ${className}`} aria-label={label} title={title || label}
      onClick={onClick} disabled={disabled}>
      <DbIcon name={icon} size={size} />
      {children}
    </button>
  );
}
