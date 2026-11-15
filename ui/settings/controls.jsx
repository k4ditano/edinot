// Controles accesibles compartidos (Ajustes y cualquier otra página):
// interruptor (role=switch), botones segmentados (aria-pressed), selector
// con lista emergente (role=listbox), deslizador, botones, campos de texto y
// la fila «etiqueta + ayuda a la izquierda, control a la derecha».
//
// Estilos en ui/settings/styles.js (clases .ui-*); usan los tokens de
// ui/shell.css (--bg, --side, --line, --accent…).

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../shell/icons.jsx';
import { ensureSettingsStyles } from './styles.js';

ensureSettingsStyles();

export function Switch({ checked, onChange, label, disabled, id, describedBy }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={!!checked} aria-label={label}
      aria-describedby={describedBy}
      className={`ui-switch${checked ? ' on' : ''}`} disabled={disabled}
      onClick={() => onChange && onChange(!checked)}>
      <i aria-hidden="true" />
    </button>
  );
}

export function Segmented({ value, options, onChange, label, disabled, size }) {
  return (
    <div className={`ui-seg${size === 'sm' ? ' sm' : ''}`} role="group" aria-label={label}>
      {options.map(o => (
        <button type="button" key={String(o.value)} aria-pressed={value === o.value}
          disabled={disabled || o.disabled} style={o.style} title={o.title}
          onClick={() => onChange && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Selector con lista emergente. Teclado: ↑↓/Inicio/Fin mueven, Enter o
// Espacio eligen, Esc cierra, escribir salta a la opción que empieza así.
export function Select({ value, options, onChange, label, disabled, minWidth = 180, id }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const typed = useRef({ s: '', t: 0 });
  const uid = useId();
  const listId = `${uid}-list`;
  const idx = options.findIndex(o => o.value === value);
  const cur = idx >= 0 ? options[idx] : null;

  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const h = Math.min(320, options.length * 34 + 10);
    const below = window.innerHeight - r.bottom - 8;
    const top = below >= h || below > r.top ? r.bottom + 4 : Math.max(8, r.top - h - 4);
    const width = Math.max(r.width, minWidth);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPos({ top, left, width });
  }, [options.length, minWidth]);

  const openList = () => {
    if (disabled) return;
    place();
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => btnRef.current && btnRef.current.focus());
  };
  const pick = (i) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== value) onChange && onChange(o.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (listRef.current && listRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      close(false);
    };
    const onScroll = (e) => { if (listRef.current && listRef.current.contains(e.target)) return; close(false); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open || active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-i="${active}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onListKey = (e) => {
    const n = options.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(n - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { close(false); }
    else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : '') + e.key.toLowerCase(), t: now };
      const j = options.findIndex(o => String(o.label).toLowerCase().startsWith(typed.current.s));
      if (j >= 0) setActive(j);
    }
  };

  return (
    <>
      <button type="button" ref={btnRef} id={id} className="ui-select" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={label ? `${label}: ${cur ? cur.label : ''}` : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList(); }
        }}>
        <span className="ui-select-val">{cur ? cur.label : '—'}</span>
        <Icon name="chevSel" size={14} stroke={2} />
      </button>
      {open && pos && createPortal(
        <ul ref={listRef} id={listId} role="listbox" tabIndex={-1} aria-label={label}
          aria-activedescendant={active >= 0 ? `${uid}-o${active}` : undefined}
          className="ui-listbox" style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          onKeyDown={onListKey}>
          {options.map((o, i) => (
            <li key={String(o.value)} id={`${uid}-o${i}`} data-i={i} role="option"
              aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
              className={`ui-option${i === active ? ' active' : ''}${o.disabled ? ' disabled' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}>
              <span className="ui-option-label">{o.label}</span>
              {o.hint && <span className="ui-option-hint">{o.hint}</span>}
              {o.value === value && <Icon name="check" size={14} stroke={2.2} />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

export function Slider({ value: valueProp, min, max, step = 1, onChange, label, minLabel, maxLabel, width = 180, valueText }) {
  // Estado local: el valor guardado llega con unos ms de retraso (Yjs) y un
  // input controlado volvería atrás entre dos pulsaciones de flecha.
  const [value, setValue] = useState(valueProp);
  useEffect(() => { setValue(valueProp); }, [valueProp]);
  const pct = ((Number(value) - min) / (max - min)) * 100;
  return (
    <label className="ui-slider">
      {minLabel != null && <span aria-hidden="true" className="ui-slider-min">{minLabel}</span>}
      <span className="sr-only">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        aria-valuetext={valueText}
        style={{ width, '--pct': `${Math.max(0, Math.min(100, pct))}%` }}
        onChange={(e) => { const n = Number(e.target.value); setValue(n); onChange && onChange(n); }} />
      {maxLabel != null && <span aria-hidden="true" className="ui-slider-max">{maxLabel}</span>}
    </label>
  );
}

export function Button({ variant = 'secondary', size, children, className = '', ...rest }) {
  return (
    <button type="button" className={`ui-btn ui-btn-${variant}${size === 'sm' ? ' sm' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export const TextField = forwardRef(function TextField({ className = '', mono, ...rest }, ref) {
  return <input ref={ref} className={`ui-input${mono ? ' mono' : ''} ${className}`} {...rest} />;
});

export function Kbd({ keys }) {
  if (!keys || !keys.length) return null;
  return (
    <span className="ui-kbds">
      {keys.map((k, i) => <kbd key={i} className="ui-kbd">{k}</kbd>)}
    </span>
  );
}

// Fila de ajuste. `stack` pone el control debajo (listas, textos largos).
export function Row({ id, label, help, children, stack, last, className = '', labelFor }) {
  const helpId = useId();
  return (
    <div className={`st-row${stack ? ' stack' : ''}${last ? ' last' : ''} ${className}`} data-setting-id={id || undefined}>
      <div className="st-lbl">
        {labelFor ? <label htmlFor={labelFor} className="st-lbl-t">{label}</label> : <span className="st-lbl-t">{label}</span>}
        {help && <span className="st-lbl-h" id={helpId}>{help}</span>}
      </div>
      {children != null && <div className="st-ctl">{children}</div>}
    </div>
  );
}

export function Group({ title, children, id }) {
  return (
    <section className="st-group" aria-label={title} data-setting-id={id || undefined}>
      {title && <h3 className="st-group-t">{title}</h3>}
      {children}
    </section>
  );
}

export function Notice({ tone = 'info', children }) {
  return <div className={`st-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

// Muestras de color (radiogroup) con flechas para moverse.
export function Swatches({ label, value, options, onChange }) {
  const refs = useRef([]);
  const idx = options.findIndex(o => o.value === value);
  const onKey = (e, i) => {
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + options.length) % options.length;
    if (j == null) return;
    e.preventDefault();
    onChange(options[j].value);
    refs.current[j] && refs.current[j].focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="ui-swatches">
      {options.map((o, i) => (
        <button type="button" key={String(o.value)} ref={el => { refs.current[i] = el; }}
          role="radio" aria-checked={o.value === value} aria-label={o.label} title={o.label}
          tabIndex={(idx < 0 ? i === 0 : i === idx) ? 0 : -1}
          className={`ui-swatch${o.value === value ? ' on' : ''}`}
          style={{ background: o.color, '--sw': o.color }}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => onChange(o.value)} />
      ))}
    </div>
  );
}

// Popover sencillo anclado a un botón (cierra con Esc / clic fuera).
export function Popover({ anchorRef, open, onClose, children, label, width = 260 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const top = r.bottom + 8 + 260 > window.innerHeight ? Math.max(8, r.top - 268) : r.bottom + 8;
    setPos({ left, top });
  }, [open, width]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open, onClose]);
  useEffect(() => {
    if (open && ref.current) {
      const f = ref.current.querySelector('button, input');
      if (f) f.focus();
    }
  }, [open, pos]);
  if (!open || !pos) return null;
  return createPortal(
    <div ref={ref} className="ui-popover" role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top, width }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchorRef.current && anchorRef.current.focus(); } }}>
      {children}
    </div>,
    document.body,
  );
}
