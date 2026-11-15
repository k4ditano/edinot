// Celdas de las bases de datos: cómo se ven según su tipo y cómo se editan
// en el sitio (texto/número en la propia celda; opciones, personas, fechas,
// enlaces y archivos en un popover; checkbox/valoración/progreso directos).

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { t, getLang } from '../../i18n.js';
import { DbIcon } from './icons.jsx';
import { Popover, Pill, Avatar } from './ui.jsx';
import {
  splitMulti, joinMulti, personName, isTruthy, parseRating, parseProgress, RATING_MAX,
  parseDateCell, formatDateLike, isoDay, displayDate, optionColor, PILL_COLORS, MULTI_TYPES,
} from './model.js';

// Cómo se edita cada tipo.
export function editKind(type) {
  if (!type || type === 'text' || type === 'number') return 'inline';
  if (type === 'checkbox' || type === 'rating') return 'direct';
  if (type === 'progress') return 'inline';
  return 'popover';
}

const MD_HINT = /[*_`[\]!<>~]|https?:\/\/|\[\[/;

// Parse an "archivo" cell: `![name](src)`, `[name](src)` o una URL suelta.
export function parseArchivo(v) {
  const s = String(v == null ? '' : v).trim();
  let name = '', src = '', isImage = false;
  let m = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(s);
  if (m) { name = m[1].trim(); src = m[2].trim(); isImage = true; }
  else {
    m = /^\[([^\]]*)\]\(([^)]+)\)/.exec(s);
    if (m) { name = m[1].trim(); src = m[2].trim(); } else src = s;
  }
  if (!isImage) isImage = /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|#|$)/i.test(name || src) || /^data:image\//i.test(src);
  return { name, src, isImage };
}
// Primera imagen que aparezca en una fila (portada de la galería).
export function rowCover(row, headers, cols) {
  for (let i = 0; i < headers.length; i++) {
    const conf = cols[headers[i]];
    const v = String(row[i] || '');
    if (!v) continue;
    if (conf && conf.type === 'archivo') { const p = parseArchivo(v); if (p.isImage && p.src) return p.src; }
    const m = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(v);
    if (m && !/\.(pdf|docx?|xlsx?|zip|mp3|mp4)(\?|#|$)/i.test(m[1])) return m[1];
  }
  return null;
}

// Texto con markdown en línea (enlaces, negrita, [[wikilinks]]). Los
// adjuntos `![nombre](src)` se muestran como miniatura o chip, no como el
// bloque grande del render.
const ATTACH_RE = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
function TextValue({ raw, cx }) {
  const v = String(raw == null ? '' : raw);
  const parts = useMemo(() => {
    const out = [];
    let last = 0, m;
    ATTACH_RE.lastIndex = 0;
    while ((m = ATTACH_RE.exec(v))) {
      if (m.index > last) out.push({ md: v.slice(last, m.index) });
      out.push({ att: { name: m[1], src: m[2] } });
      last = m.index + m[0].length;
    }
    if (last < v.length) out.push({ md: v.slice(last) });
    return out.map((p) => {
      if (!p.md) return p;
      if (!MD_HINT.test(p.md) || !cx.renderInline) return { text: p.md };
      try { return { html: cx.renderInline(p.md) }; } catch { return { text: p.md }; }
    });
  }, [v, cx.renderInline]);
  if (parts.length === 1 && parts[0].text != null) return <span className="db-text">{parts[0].text}</span>;
  return (
    <span className="db-text db-md">
      {parts.map((p, i) => {
        if (p.text != null) return <span key={i}>{p.text}</span>;
        if (p.html != null) return <span key={i} dangerouslySetInnerHTML={{ __html: p.html }} />;
        const nm = p.att.name || '';
        const img = /\.[a-z0-9]{2,5}$/i.test(nm) ? /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(nm) : true;
        return img
          ? <img key={i} className="db-thumb db-inline-thumb" src={p.att.src} alt={p.att.name} loading="lazy" />
          : <span key={i} className="db-file"><DbIcon name="file" size={13} /><span>{p.att.name || p.att.src}</span></span>;
      })}
    </span>
  );
}

function ProgressValue({ raw, editable, onCommit }) {
  const base = parseProgress(raw);
  const [drag, setDrag] = useState(null);
  const trackRef = useRef(null);
  const v = drag != null ? drag : base;
  const fromEvent = (e) => {
    const r = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    return Math.round((pct * 100) / 5) * 5;
  };
  const onDown = (e) => {
    if (!editable || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = trackRef.current;
    try { el.setPointerCapture(e.pointerId); } catch {}
    let cur = fromEvent(e);
    setDrag(cur);
    const move = (ev) => { cur = fromEvent(ev); setDrag(cur); };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (cur !== base) onCommit(String(cur));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  if (v == null && !editable) return null;
  return (
    <span className={`db-prog${editable ? ' editable' : ''}${v == null ? ' empty' : ''}`}>
      <span ref={trackRef} className="db-prog-track" onPointerDown={onDown} onClick={(e) => e.stopPropagation()}
        role={editable ? 'slider' : undefined} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v == null ? 0 : v}
        aria-label={t('db.type.progress')}>
        <span className="db-prog-bar" style={{ width: `${v || 0}%` }} />
      </span>
      <span className="db-prog-num">{v == null ? '' : `${v}%`}</span>
    </span>
  );
}

// Valor de una celda, según el tipo de su columna. `onCommit` sólo lo usan
// los tipos que se editan directamente (checkbox, valoración, progreso).
export function CellView({ raw, conf, colName, cx, editable = false, onCommit, compact = false }) {
  const type = conf && conf.type;
  const v = String(raw == null ? '' : raw).trim();
  const oc = cx.optColors;
  switch (type) {
    case 'number':
      return v ? <span className="db-num">{v}</span> : null;
    case 'date': {
      if (!v) return null;
      const d = displayDate(v, getLang());
      return <span className={`db-date${d ? '' : ' db-invalid'}`} title={v}>{d || v}</span>;
    }
    case 'select':
      return v ? <Pill color={optionColor(oc, colName, v)}>{v}</Pill> : null;
    case 'status':
      return v ? <Pill dot color={optionColor(oc, colName, v)}>{v}</Pill> : null;
    case 'multiselect':
    case 'tags': {
      const vals = splitMulti(v);
      if (!vals.length) return null;
      return <span className="db-pills">{vals.map((x, i) => <Pill key={x + i} color={optionColor(oc, colName, x)}>{x}</Pill>)}</span>;
    }
    case 'person': {
      const ppl = splitMulti(v);
      if (!ppl.length) return null;
      if (ppl.length === 1) return <span className="db-person"><Avatar token={ppl[0]} /><span className="db-person-name">{personName(ppl[0])}</span></span>;
      return (
        <span className="db-person db-person-multi" title={ppl.join(', ')}>
          <span className="db-av-stack">{ppl.slice(0, 4).map((p, i) => <Avatar key={p + i} token={p} />)}</span>
          {!compact && <span className="db-person-name">{ppl.map(personName).join(', ')}</span>}
        </span>
      );
    }
    case 'checkbox': {
      const on = isTruthy(v);
      if (!editable) return <span className={`db-check${on ? ' on' : ''}`} aria-label={on ? t('db.yes') : t('db.no')} role="img">{on ? <DbIcon name="check" size={12} stroke={2.6} /> : null}</span>;
      return (
        <button type="button" className={`db-check${on ? ' on' : ''}`} role="checkbox" aria-checked={on}
          aria-label={colName}
          onClick={(e) => { e.stopPropagation(); onCommit && onCommit(on ? '' : 'x'); }}>
          {on ? <DbIcon name="check" size={12} stroke={2.6} /> : null}
        </button>
      );
    }
    case 'rating': {
      const n = parseRating(v);
      if (!n && !editable) return null;
      return (
        <span className={`db-rating${editable ? ' editable' : ''}`} role={editable ? 'radiogroup' : 'img'} aria-label={`${n}/${RATING_MAX}`}>
          {Array.from({ length: RATING_MAX }, (_, k) => k + 1).map(i => (
            editable
              ? <button key={i} type="button" className={`db-star${i <= n ? ' on' : ''}`} role="radio" aria-checked={i === n}
                  aria-label={String(i)} onClick={(e) => { e.stopPropagation(); onCommit && onCommit(i === n ? '' : String(i)); }}>
                  <DbIcon name="rating" size={13} stroke={1.6} />
                </button>
              : <span key={i} className={`db-star${i <= n ? ' on' : ''}`}><DbIcon name="rating" size={13} stroke={1.6} /></span>
          ))}
        </span>
      );
    }
    case 'progress':
      return <ProgressValue raw={v} editable={editable} onCommit={onCommit} />;
    case 'wikilink': {
      if (!v) return null;
      const pipe = v.indexOf('|');
      const target = (pipe >= 0 ? v.slice(0, pipe) : v).trim();
      const label = (pipe >= 0 ? v.slice(pipe + 1) : v).trim() || target;
      return (
        <span className="db-wiki">
          <DbIcon name="note" size={13} />
          <a href="#" className="db-wiki-link" onClick={(e) => { e.preventDefault(); e.stopPropagation(); cx.openNote && cx.openNote(target); }}>{label}</a>
        </span>
      );
    }
    case 'archivo': {
      if (!v) return null;
      const p = parseArchivo(v);
      if (p.isImage && p.src) return <img className="db-thumb" src={p.src} alt={p.name || ''} loading="lazy" />;
      return <span className="db-file"><DbIcon name="file" size={13} /><span>{p.name || p.src}</span></span>;
    }
    default:
      return v ? <TextValue raw={v} cx={cx} /> : null;
  }
}

// ── Editor en la celda (texto, número, progreso) ───────────────────────
export function InlineEditor({ initial, type, onCommit, onCancel, placeholder }) {
  const [val, setVal] = useState(type === 'progress' ? String(initial || '').replace('%', '').trim() : (initial || ''));
  const ref = useRef(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    try { el.select(); } catch {}
  }, []);
  const finish = (how) => {
    if (done.current) return;
    done.current = true;
    onCommit(val, how);
  };
  return (
    <input ref={ref} className={`db-inline-input${type === 'number' || type === 'progress' ? ' num' : ''}`}
      type="text" inputMode={type === 'number' || type === 'progress' ? 'decimal' : undefined}
      value={val} placeholder={placeholder} spellCheck={type === 'text' || !type}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Ctrl/⌘ F, ⇧F y K siguen siendo de la app (buscar), no de la celda.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[fk]$/i.test(e.key)) return;
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish('enter'); }
        else if (e.key === 'Tab') { e.preventDefault(); finish(e.shiftKey ? 'prev' : 'next'); }
        else if (e.key === 'Escape') { e.preventDefault(); done.current = true; onCancel(); }
        else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) { e.preventDefault(); finish(e.key === 'ArrowDown' ? 'down' : 'up'); }
      }}
      onBlur={() => {
        // Diferido: si el bloque se descuelga y se vuelve a colgar del DOM
        // (otro cambio en la nota), mount.jsx le devuelve el foco en el mismo
        // tick y no hay que confirmar nada.
        setTimeout(() => {
          if (done.current) return;
          if (ref.current && ref.current.isConnected && document.activeElement === ref.current) return;
          finish('blur');
        }, 0);
      }} />
  );
}

// ── Selector de opciones (select, status, multiselect, tags, persona) ──
export function OptionPicker({ anchor, colName, conf, value, cx, onChange, onClose, onTab }) {
  const type = (conf && conf.type) || 'select';
  const multi = MULTI_TYPES.has(type);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [edit, setEdit] = useState(null); // opción cuyo color se está editando
  const [cur, setCur] = useState(() => (multi ? splitMulti(value) : (String(value || '').trim() ? [String(value).trim()] : [])));
  useEffect(() => { setCur(multi ? splitMulti(value) : (String(value || '').trim() ? [String(value).trim()] : [])); }, [value, multi]);
  const fixed = (conf && conf.options) || [];
  const universe = useMemo(() => {
    const seen = new Set();
    const out = [];
    const add = (x) => { const s = String(x || '').trim(); if (!s) return; const k = s.toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push(s); };
    fixed.forEach(add);
    if (type === 'person') (cx.members || []).forEach(m => add(m && (m.email || m)));
    const ci = cx.headers.indexOf(colName);
    if (ci >= 0) for (const r of cx.meta.rows) (multi ? splitMulti(r[ci]) : [r[ci]]).forEach(add);
    return out;
  }, [fixed, type, cx.members, cx.meta, colName, multi]);
  const ql = q.trim().toLowerCase();
  const shown = ql ? universe.filter(o => o.toLowerCase().includes(ql) || (type === 'person' && personName(o).toLowerCase().includes(ql))) : universe;
  const canCreate = !!ql && !universe.some(o => o.toLowerCase() === ql);
  // «Crear» va arriba y está resaltado: escribir y pulsar Intro crea la opción;
  // si se mueve la selección con las flechas, Intro elige la resaltada.
  const items = [...(canCreate ? [{ kind: 'create', o: q.trim() }] : []), ...shown.map(o => ({ kind: 'opt', o }))];
  useEffect(() => { setHi(0); }, [q]);
  const isSel = (o) => cur.some(x => x.toLowerCase() === o.toLowerCase());
  const apply = (next, extra) => { setCur(next); onChange(multi ? joinMulti(next) : (next[0] || ''), extra); };
  const choose = (o, created) => {
    const extra = created && fixed.length && type !== 'person' ? { addOption: o } : null;
    if (multi) {
      const next = isSel(o) ? cur.filter(x => x.toLowerCase() !== o.toLowerCase()) : [...cur, o];
      apply(next, extra);
      setQ('');
    } else {
      const next = isSel(o) && !created ? [] : [o];
      apply(next, extra);
      onClose();
    }
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(items.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[hi]; if (it) choose(it.o, it.kind === 'create'); else if (!q) onClose(); }
    else if (e.key === 'Backspace' && !q && multi && cur.length) { apply(cur.slice(0, -1)); }
    else if (e.key === 'Tab') { e.preventDefault(); onClose(); onTab && onTab(e.shiftKey ? 'prev' : 'next'); }
  };
  const optLabel = (o) => (type === 'person'
    ? <span className="db-opt-person"><Avatar token={o} size={20} /><span>{personName(o)}</span>{o.includes('@') ? <span className="db-faint">{o}</span> : null}</span>
    : <Pill dot={type === 'status'} color={optionColor(cx.optColors, colName, o)}>{o}</Pill>);
  return (
    <Popover anchor={anchor} onClose={onClose} className="db-picker" width={300} label={colName}>
      <div className="db-picker-top">
        {cur.length > 0 && (
          <div className="db-picker-chips">
            {cur.map((o, i) => (type === 'person'
              ? <span key={o + i} className="db-chip-person"><Avatar token={o} size={18} />{personName(o)}<button type="button" className="db-pill-x" aria-label={t('db.remove')} onClick={() => apply(cur.filter((_, k) => k !== i))}><DbIcon name="close" size={11} stroke={2.2} /></button></span>
              : <Pill key={o + i} dot={type === 'status'} color={optionColor(cx.optColors, colName, o)} onRemove={() => apply(cur.filter((_, k) => k !== i))}>{o}</Pill>))}
          </div>
        )}
        <input className="db-picker-search" data-autofocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder={type === 'person' ? t('db.picker.searchPeople') : t('db.picker.typeHere')} aria-label={t('db.picker.search')} />
      </div>
      <div className="db-picker-head">{type === 'person' ? t('db.picker.people') : (type === 'tags' ? t('db.picker.pickTag') : t('db.picker.options'))}</div>
      <div className="db-picker-list" role="listbox" aria-multiselectable={multi || undefined}>
        {items.map((it, i) => (
          <div key={it.kind + it.o} role="option" aria-selected={it.kind === 'opt' && isSel(it.o)}
            className={`db-picker-row${i === hi ? ' hi' : ''}`} onMouseEnter={() => setHi(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(it.o, it.kind === 'create')}>
            {it.kind === 'create'
              ? <span className="db-picker-create"><span className="db-faint">{t('db.picker.create')}</span> {optLabel(it.o)}</span>
              : <>
                  <span className="db-picker-opt">{optLabel(it.o)}</span>
                  {isSel(it.o) ? <span className="db-picker-check"><DbIcon name="check" size={14} /></span> : null}
                  {type !== 'person' && !cx.readOnly ? (
                    <button type="button" className="db-picker-more" aria-label={t('db.opt.edit', { name: it.o })}
                      onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setEdit({ o: it.o, anchor: { left: r.right + 4, top: r.top, right: r.right + 4, bottom: r.top, width: 0, height: 0 } }); }}>
                      <DbIcon name="more" size={14} />
                    </button>
                  ) : null}
                </>}
          </div>
        ))}
        {!items.length && <div className="db-picker-empty">{type === 'person' ? t('db.picker.noPeople') : t('db.picker.typeToCreate')}</div>}
      </div>
      {edit && (
        <OptionEditor anchor={edit.anchor} colName={colName} option={edit.o} conf={conf} cx={cx}
          onClose={() => setEdit(null)} />
      )}
    </Popover>
  );
}

// Menú «⋯» de una opción: renombrar, cambiar el color o borrarla.
export function OptionEditor({ anchor, colName, option, conf, cx, onClose }) {
  const curColor = optionColor(cx.optColors, colName, option);
  const [name, setName] = useState(option);
  const commitName = () => { const v = name.trim(); if (v && v !== option) { cx.renameOption(colName, option, v); return true; } return false; };
  return (
    <Popover anchor={anchor} onClose={() => { commitName(); onClose(); }} className="db-opt-editor" width={230} label={option}>
      <input className="db-picker-search" data-autofocus value={name} aria-label={t('db.opt.rename')} placeholder={t('db.opt.rename')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitName(); onClose(); } }} />
      <div className="db-mi-head">{t('db.opt.color')}</div>
      <div className="db-swatches" role="radiogroup" aria-label={t('db.opt.color')}>
        {PILL_COLORS.map(c => (
          <button key={c} type="button" role="radio" aria-checked={c === curColor}
            className={`db-swatch db-c-${c}${c === curColor ? ' on' : ''}`} title={t('db.color.' + c)} aria-label={t('db.color.' + c)}
            onClick={() => { cx.setOptionColor(colName, option, c); }}>
            {c === curColor ? <DbIcon name="check" size={12} stroke={2.4} /> : null}
          </button>
        ))}
      </div>
      <div className="db-mi-sep" />
      <button type="button" className="db-mi danger" onClick={() => { cx.deleteOption(colName, option); onClose(); }}>
        <span className="db-mi-ic"><DbIcon name="trash" size={15} /></span><span className="db-mi-label">{t('db.opt.delete')}</span>
      </button>
    </Popover>
  );
}

// ── Mini calendario para elegir fecha ─────────────────────────────────
export function monthMatrix(y, m) {
  // Semanas que empiezan en lunes; 6 filas para que no salte la altura.
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const out = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - offset + i);
    out.push({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), inMonth: d.getMonth() === m });
  }
  return out;
}
export function weekdayNames(lang) {
  const base = new Date(2024, 0, 1); // lunes
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getFullYear(), 0, 1 + i);
    try { return d.toLocaleDateString(lang || 'es', { weekday: 'short' }).replace(/\.$/, ''); } catch { return ['L', 'M', 'X', 'J', 'V', 'S', 'D'][i]; }
  });
}
export function monthTitle(y, m, lang) {
  try { return new Date(y, m, 1).toLocaleDateString(lang || 'es', { month: 'long', year: 'numeric' }).replace(/ de /, ' '); } catch { return `${m + 1}/${y}`; }
}

export function DatePicker({ anchor, value, onCommit, onClose, onTab }) {
  const lang = getLang();
  const p = parseDateCell(value);
  const now = new Date();
  const [ym, setYm] = useState({ y: p ? p.y : now.getFullYear(), m: p ? p.m : now.getMonth() });
  const [text, setText] = useState(String(value || ''));
  const todayKey = isoDay(now.getFullYear(), now.getMonth(), now.getDate());
  const selKey = p ? isoDay(p.y, p.m, p.d) : null;
  const pick = (y, m, d) => { onCommit(formatDateLike(value, y, m, d)); onClose(); };
  const shift = (n) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const commitText = () => {
    const s = text.trim();
    if (!s) { onCommit(''); return true; }
    const pp = parseDateCell(s);
    if (!pp) return false;
    onCommit(/^\d{4}-\d{1,2}-\d{1,2}/.test(s) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(s) ? s : isoDay(pp.y, pp.m, pp.d));
    return true;
  };
  return (
    <Popover anchor={anchor} onClose={onClose} className="db-datepick" width={268} label={t('db.type.date')}>
      <input className="db-picker-search" data-autofocus value={text} placeholder="2026-10-22"
        aria-label={t('db.type.date')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (commitText()) onClose(); }
          else if (e.key === 'Tab') { e.preventDefault(); commitText(); onClose(); onTab && onTab(e.shiftKey ? 'prev' : 'next'); }
        }} />
      <div className="db-dp-head">
        <span className="db-dp-title">{monthTitle(ym.y, ym.m, lang)}</span>
        <button type="button" className="db-ib sm" aria-label={t('db.cal.prev')} onClick={() => shift(-1)}><DbIcon name="chevLeft" size={14} /></button>
        <button type="button" className="db-ib sm" aria-label={t('db.cal.next')} onClick={() => shift(1)}><DbIcon name="chevRight" size={14} /></button>
      </div>
      <div className="db-dp-grid" role="grid">
        {weekdayNames(lang).map((w, i) => <span key={'w' + i} className="db-dp-wd">{w.slice(0, 2)}</span>)}
        {monthMatrix(ym.y, ym.m).map((c) => {
          const k = isoDay(c.y, c.m, c.d);
          return (
            <button key={k} type="button" className={`db-dp-day${c.inMonth ? '' : ' out'}${k === todayKey ? ' today' : ''}${k === selKey ? ' sel' : ''}`}
              aria-label={k} aria-pressed={k === selKey} onClick={() => pick(c.y, c.m, c.d)}>{c.d}</button>
          );
        })}
      </div>
      <div className="db-dp-foot">
        <button type="button" className="db-btn-quiet" onClick={() => pick(now.getFullYear(), now.getMonth(), now.getDate())}>{t('db.cal.today')}</button>
        <button type="button" className="db-btn-quiet" onClick={() => { onCommit(''); onClose(); }}>{t('db.clear')}</button>
      </div>
    </Popover>
  );
}

// ── Enlace a nota ──────────────────────────────────────────────────────
export function NotePicker({ anchor, value, cx, onCommit, onClose, onTab }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const names = cx.noteNames || [];
  const ql = q.trim().toLowerCase();
  const shown = (ql ? names.filter(n => n.toLowerCase().includes(ql)) : names).slice(0, 60);
  const exact = names.some(n => n.toLowerCase() === ql);
  const items = [...shown.map(n => ({ n })), ...(ql && !exact ? [{ n: q.trim(), free: true }] : [])];
  const target = String(value || '').split('|')[0].trim();
  const pick = (n) => { onCommit(n); onClose(); };
  return (
    <Popover anchor={anchor} onClose={onClose} className="db-picker" width={300} label={t('db.type.wikilink')}>
      {target && (
        <div className="db-picker-cur">
          <span className="db-wiki"><DbIcon name="note" size={13} /><span>{target}</span></span>
          <button type="button" className="db-btn-quiet" onClick={() => { onClose(); cx.openNote && cx.openNote(target); }}>{t('db.peek.openNote')}</button>
          <button type="button" className="db-ib sm" aria-label={t('db.clear')} onClick={() => pick('')}><DbIcon name="close" size={13} /></button>
        </div>
      )}
      <input className="db-picker-search" data-autofocus value={q} placeholder={t('db.picker.searchNotes')} aria-label={t('db.picker.searchNotes')}
        onChange={(e) => { setQ(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(items.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (items[hi]) pick(items[hi].n); }
          else if (e.key === 'Tab') { e.preventDefault(); onClose(); onTab && onTab(e.shiftKey ? 'prev' : 'next'); }
        }} />
      <div className="db-picker-list" role="listbox">
        {items.map((it, i) => (
          <div key={(it.free ? '+' : '') + it.n} role="option" aria-selected={it.n === target}
            className={`db-picker-row${i === hi ? ' hi' : ''}`} onMouseEnter={() => setHi(i)}
            onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it.n)}>
            <span className="db-wiki"><DbIcon name={it.free ? 'plus' : 'note'} size={13} /><span>{it.free ? t('db.picker.linkTo', { name: it.n }) : it.n}</span></span>
          </div>
        ))}
        {!items.length && <div className="db-picker-empty">{t('db.picker.noNotes')}</div>}
      </div>
    </Popover>
  );
}

// ── Archivo ────────────────────────────────────────────────────────────
export function FilePicker({ anchor, value, cx, onCommit, onClose }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const p = parseArchivo(value || '');
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !cx.onAttach) return;
    setBusy(true);
    try {
      const info = await cx.onAttach(file);
      if (info && (info.url || info.sha)) {
        const src = info.url || `edinot://blob/${info.sha}`;
        const nm = (info.name || file.name || 'archivo').replace(/[\]\[\n\r]/g, '');
        const isImg = (file.type || '').startsWith('image/');
        onCommit(`${isImg ? '!' : ''}[${nm}](${src})`);
        onClose();
      }
    } catch (err) { window.alert(String((err && err.message) || err)); }
    finally { setBusy(false); }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} className="db-picker db-filepick" width={300} label={t('db.type.archivo')}>
      {value ? (
        <div className="db-picker-cur">
          {p.isImage && p.src ? <img className="db-thumb" src={p.src} alt="" /> : <DbIcon name="file" size={14} />}
          <span className="db-file-name">{p.name || p.src}</span>
          <button type="button" className="db-ib sm" aria-label={t('db.clear')} onClick={() => { onCommit(''); onClose(); }}><DbIcon name="close" size={13} /></button>
        </div>
      ) : null}
      <button type="button" className="db-btn-wide" disabled={busy || !cx.onAttach} data-autofocus
        onClick={() => fileRef.current && fileRef.current.click()}>
        <DbIcon name="upload" size={14} />{busy ? t('db.file.uploading') : (value ? t('db.file.replace') : t('db.file.attach'))}
      </button>
      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onFile} />
      <div className="db-file-url">
        <input className="db-picker-search" value={url} placeholder={t('db.file.urlPh')} aria-label={t('db.file.urlPh')}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) { e.preventDefault(); onCommit(url.trim()); onClose(); } }} />
      </div>
    </Popover>
  );
}

// Abre el editor de popover que corresponde al tipo.
export function CellPopoverEditor({ editing, cx, onClose, onTab }) {
  const { anchor, colName, conf, value, commit } = editing;
  const type = conf && conf.type;
  if (type === 'date') return <DatePicker anchor={anchor} value={value} onCommit={(v) => commit(v)} onClose={onClose} onTab={onTab} />;
  if (type === 'wikilink') return <NotePicker anchor={anchor} value={value} cx={cx} onCommit={(v) => commit(v)} onClose={onClose} onTab={onTab} />;
  if (type === 'archivo') return <FilePicker anchor={anchor} value={value} cx={cx} onCommit={(v) => commit(v)} onClose={onClose} />;
  return <OptionPicker anchor={anchor} colName={colName} conf={conf} value={value} cx={cx}
    onChange={(v, extra) => commit(v, extra)} onClose={onClose} onTab={onTab} />;
}
