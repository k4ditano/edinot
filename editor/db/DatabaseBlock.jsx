// Bloque de base de datos (estilo Notion) para una tabla GFM.
//
// Cabecera: pestañas de vista a la izquierda (Tabla · Tablero · Calendario ·
// Galería, + vistas guardadas) y, a la derecha, chips de filtro/orden que se
// pueden quitar, buscar, ⋯ (propiedades, Excel, formulario…) y «Nueva».
// Debajo, la vista activa. Todo se guarda en la tabla markdown y en la
// directiva `<!-- edinot:view=… -->` mediante `ops` (transformaciones de
// editor.jsx) y `ctxRef.current.mutateSource(fn)` (Y.Text en vivo).
//
// Se usa igual en Leer (panel render) y en Editar (widget de Live Preview):
// mount.jsx conserva la raíz de React entre reconstrucciones del DOM, así
// que el estado (celda en edición, popover abierto, mes del calendario…)
// sobrevive a cada cambio del documento.

import { useState, useRef, useLayoutEffect, useEffect, useMemo, useCallback } from 'react';
import { t, useI18n, getLang } from '../../i18n.js';
import { DbIcon, TYPE_ICON, VIEW_ICON } from './icons.jsx';
import { Popover, DbMenu, Pill, rectOf } from './ui.jsx';
import { CellPopoverEditor, OptionEditor, editKind } from './cells.jsx';
import { TableView, BoardView, CalendarView, GalleryView, ListView, defaultWidth } from './views.jsx';
import { RowPeek } from './RowPeek.jsx';
import {
  COLUMN_TYPES, OPTION_TYPES, MULTI_TYPES, computeRows, getTabs, switchTabPatch, addViewPatch, renameViewPatch,
  deleteViewPatch, duplicateViewPatch, titleColumnIndex, pickGroupColumn, pickDateColumn, splitMulti, joinMulti,
  parseFilterValue, encodeFilterValue, opsForType, defaultOpForType, filterOpNeedsValue, aggsForType,
  isTruthy, parseDateCell, tryNumber, RATING_MAX, VIEW_TYPES, optionColor, displayDate,
  filterRules, rulesToFilter, nextRuleColumn, fitTabs, renameOptionInValue, removeOptionFromValue, optionChangePatch,
} from './model.js';

// Colores de columna (pasteles; los mismos de la paleta antigua de tablas).
const DB_COL_COLORS = [['red', '#fde2e2'], ['orange', '#ffe3c2'], ['yellow', '#fff3bf'], ['green', '#e3f3cd'], ['teal', '#cdeee4'], ['blue', '#cfe5fb'], ['purple', '#e2d6fb'], ['pink', '#f8d7ea'], ['gray', '#e9ecef']];
const viewLabel = (type) => t('db.view.' + (type || 'table'));
const typeLabel = (type) => t('db.type.' + (type || 'text'));

function uniqueName(base, taken) {
  const low = new Set(taken.map(x => String(x || '').toLowerCase()));
  if (!low.has(base.toLowerCase())) return base;
  for (let n = 2; n < 200; n++) { const c = `${base} ${n}`; if (!low.has(c.toLowerCase())) return c; }
  return base;
}

// Texto largo de una regla (título accesible del chip).
function chipText(col, raw) {
  const f = parseFilterValue(raw);
  return t('db.chip.' + f.op, { col, val: f.val });
}
function valueLabel(val, type) {
  if (type === 'date') return displayDate(val, getLang()) || val;
  return val;
}

// ── Reglas de filtro ───────────────────────────────────────────────────
// Un único desplegable para el chip de una regla (`onlyCol`) y para «N reglas»
// (todas, con «Añadir regla»). Trabaja sobre un borrador local: las reglas
// incompletas (sin valor) se ven aquí pero no se escriben en la directiva.
let ruleSeq = 1;
function optionsOf(cx, col, type, conf) {
  const seen = new Set(); const out = [];
  const add = (x) => { const s = String(x || '').trim(); if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); } };
  ((conf && conf.options) || []).forEach(add);
  for (const r of cx.meta.rows) (MULTI_TYPES.has(type) ? splitMulti(r[col]) : [r[col]]).forEach(add);
  return out;
}
function RuleRow({ cx, rule, usedByOthers, onChange, onRemove, autoFocus }) {
  const col = cx.headers.findIndex(h => h.toLowerCase() === rule.col.toLowerCase());
  const conf = col >= 0 ? (cx.cols[cx.headers[col]] || null) : null;
  const type = (conf && conf.type) || 'text';
  const ops = opsForType(type).slice();
  if (!ops.includes(rule.op)) ops.unshift(rule.op);
  const choices = rule.op === 'is' || rule.op === 'not' || rule.op === 'contains' || rule.op === 'ncontains';
  const options = useMemo(() => (OPTION_TYPES.has(type) || type === 'person') && col >= 0 ? optionsOf(cx, col, type, conf) : null, [cx.meta, col, type]);
  const val = String(rule.val == null ? '' : rule.val);
  return (
    <div className="db-rule" role="group" aria-label={rule.col}>
      <div className="db-rule-head">
        <span className="db-rule-ic"><DbIcon name={TYPE_ICON[type] || 'text'} size={14} /></span>
        <select className="db-select db-rule-col" value={rule.col} aria-label={t('db.filter.field')} data-autofocus={autoFocus ? true : undefined}
          onChange={(e) => {
            const name = e.target.value;
            const ty = (cx.cols[name] && cx.cols[name].type) || 'text';
            onChange({ ...rule, col: name, op: defaultOpForType(ty), val: '' });
          }}>
          {cx.headers.filter(h => h === rule.col || !usedByOthers.has(h.toLowerCase())).map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <select className="db-select db-rule-op" value={rule.op} aria-label={t('db.filter.op')}
          onChange={(e) => onChange({ ...rule, op: e.target.value })}>
          {ops.map(o => <option key={o} value={o}>{t('db.op.' + o)}</option>)}
        </select>
        <button type="button" className="db-ib sm" aria-label={t('db.filter.removeOf', { name: rule.col })} title={t('db.filter.remove')} onClick={onRemove}>
          <DbIcon name="trash" size={13} />
        </button>
      </div>
      {filterOpNeedsValue(rule.op) && (
        options && choices && options.length ? (
          <div className="db-filter-opts" role="listbox" aria-label={t('db.filter.value')}>
            {options.map(o => (
              <button key={o} type="button" role="option" aria-selected={val.toLowerCase() === o.toLowerCase()}
                className={`db-filter-opt${val.toLowerCase() === o.toLowerCase() ? ' on' : ''}`}
                onClick={() => onChange({ ...rule, val: o }, true)}>
                {cx.renderPill(rule.col, o, type)}
                {val.toLowerCase() === o.toLowerCase() ? <DbIcon name="check" size={13} /> : null}
              </button>
            ))}
          </div>
        ) : (
          <input className="db-picker-search db-rule-val" value={val}
            type={type === 'date' ? 'date' : 'text'} inputMode={type === 'number' || type === 'rating' || type === 'progress' ? 'decimal' : undefined}
            placeholder={t('db.filter.valuePh')} aria-label={t('db.filter.value')}
            onChange={(e) => onChange({ ...rule, val: e.target.value })} />
        )
      )}
    </div>
  );
}
function RulesPanel({ anchor, cx, onlyCol, fresh, onClose }) {
  const [rules, setRules] = useState(() => {
    const cur = filterRules(cx.directive.filter).map(r => ({ ...r, id: ruleSeq++ }));
    if (!fresh) return cur;
    const col = nextRuleColumn(cx.headers, cur, cx.headers[cx.titleIdx]);
    if (!col) return cur;
    const ty = (cx.cols[col] && cx.cols[col].type) || 'text';
    return [...cur, { id: ruleSeq++, col, op: defaultOpForType(ty), val: '' }];
  });
  const only = onlyCol ? rules.find(r => r.col.toLowerCase() === onlyCol.toLowerCase()) : null;
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = (next, now) => {
    setRules(next);
    clearTimeout(timer.current);
    const go = () => cx.setFilterMap(rulesToFilter(next));
    if (now) go(); else timer.current = setTimeout(go, 260);
  };
  const shown = onlyCol ? (only ? [only] : []) : rules;
  const canAdd = !onlyCol && !!nextRuleColumn(cx.headers, rules, cx.headers[cx.titleIdx]);
  const addRule = () => {
    const col = nextRuleColumn(cx.headers, rules, cx.headers[cx.titleIdx]);
    if (!col) return;
    const ty = (cx.cols[col] && cx.cols[col].type) || 'text';
    setRules(rules.concat({ id: ruleSeq++, col, op: defaultOpForType(ty), val: '' }));
  };
  return (
    <Popover anchor={anchor} onClose={onClose} className="db-filter db-rules" width={onlyCol ? 340 : 380} label={t('db.filter.title')}>
      <div className="db-rules-head">{onlyCol ? t('db.filter.title') : t('db.filter.rulesTitle')}</div>
      {shown.length === 0 && <div className="db-picker-empty">{t('db.filter.none')}</div>}
      {shown.map((r, i) => (
        <RuleRow key={r.id} cx={cx} rule={r} autoFocus={i === shown.length - 1 && !!fresh}
          usedByOthers={new Set(rules.filter(x => x.id !== r.id).map(x => x.col.toLowerCase()))}
          onChange={(nr, now) => apply(rules.map(x => (x.id === r.id ? nr : x)), now || nr.col !== r.col || nr.op !== r.op)}
          onRemove={() => { const next = rules.filter(x => x.id !== r.id); apply(next, true); if (onlyCol && !next.length) onClose(); }} />
      ))}
      <div className="db-pop-foot db-rules-foot">
        {canAdd ? <button type="button" className="db-btn-quiet" onClick={addRule}><DbIcon name="plus" size={13} stroke={2} />{t('db.filter.addRule')}</button> : <span />}
        {!onlyCol && rules.length > 0 && (
          <button type="button" className="db-btn-quiet danger" onClick={() => { apply([], true); onClose(); }}>
            <DbIcon name="trash" size={13} />{t('db.filter.clearAll')}
          </button>
        )}
      </div>
    </Popover>
  );
}

// ── Orden ──────────────────────────────────────────────────────────────
function SortEditor({ anchor, cx, onClose }) {
  const sort = cx.directive.sort;
  return (
    <Popover anchor={anchor} onClose={onClose} className="db-sortpop" width={280} label={t('db.sort.title')}>
      <div className="db-filter-head">
        <select className="db-select grow" value={sort ? sort.col : ''} aria-label={t('db.sort.col')}
          onChange={(e) => cx.setSort(e.target.value ? { col: e.target.value, dir: sort ? sort.dir : 'asc' } : null)}>
          {cx.headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <select className="db-select" value={sort ? sort.dir : 'asc'} aria-label={t('db.sort.dir')}
          onChange={(e) => sort && cx.setSort({ col: sort.col, dir: e.target.value })}>
          <option value="asc">{t('db.sort.asc')}</option>
          <option value="desc">{t('db.sort.desc')}</option>
        </select>
      </div>
      <div className="db-pop-foot">
        <button type="button" className="db-btn-quiet danger" onClick={() => { cx.setSort(null); onClose(); }}>
          <DbIcon name="trash" size={13} />{t('db.sort.remove')}
        </button>
      </div>
    </Popover>
  );
}

// ── Nueva columna ──────────────────────────────────────────────────────
// Al elegir un tipo se crea la columna (con el nombre escrito arriba, si hay;
// si no, con el nombre del tipo).
function AddColumn({ anchor, cx, onClose }) {
  const [name, setName] = useState('');
  const createWith = (ty) => {
    const base = name.trim() || (ty === 'text' ? t('db.col.defaultName') : typeLabel(ty));
    cx.addColumn(uniqueName(base, cx.headers), ty);
    onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} className="db-addcol" width={300} align="end" label={t('db.col.add')}>
      <input className="db-picker-search" value={name} placeholder={t('db.col.namePh')} aria-label={t('db.col.name')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createWith('text'); } }} />
      <div className="db-mi-head">{t('db.col.pickType')}</div>
      <div className="db-typelist" role="menu" aria-label={t('db.col.type')}>
        {COLUMN_TYPES.map(ty => (
          <button key={ty} type="button" role="menuitem" className="db-typerow" data-type={ty} onClick={() => createWith(ty)}>
            <span className="db-typerow-ic"><DbIcon name={TYPE_ICON[ty]} size={15} /></span><span>{typeLabel(ty)}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

// ── Opciones de una columna (color, borrar, añadir) ────────────────────
function OptionsPanel({ anchor, cx, col, onClose }) {
  const name = cx.headers[col];
  const conf = cx.cols[name] || { type: 'select' };
  const [add, setAdd] = useState('');
  const list = conf.options || [];
  return (
    <Popover anchor={anchor} onClose={onClose} className="db-optpanel" width={300} label={t('db.col.editOptions')}>
      <div className="db-mi-head">{t('db.col.optionsOf', { name })}</div>
      <div className="db-optlist">
        {list.map((o, i) => (
          <div key={o + i} className="db-optrow">
            <span className="db-optrow-pill">{cx.renderPill(name, o, conf.type)}</span>
            <span className="db-optrow-tools">
              <button type="button" className="db-ib sm" aria-label={t('db.opt.up')} disabled={i === 0} onClick={() => cx.reorderOption(name, i, i - 1)}><DbIcon name="chevUp" size={13} /></button>
              <button type="button" className="db-ib sm" aria-label={t('db.opt.down')} disabled={i === list.length - 1} onClick={() => cx.reorderOption(name, i, i + 1)}><DbIcon name="chevDown" size={13} /></button>
              <button type="button" className="db-ib sm" aria-label={t('db.opt.edit', { name: o })}
                onClick={(e) => cx.openOptionEditor(name, o, e.currentTarget)}><DbIcon name="palette" size={13} /></button>
            </span>
          </div>
        ))}
        {!list.length && <div className="db-picker-empty">{t('db.opt.none')}</div>}
      </div>
      <input className="db-picker-search" data-autofocus value={add} placeholder={t('db.opt.addPh')} aria-label={t('db.opt.addPh')}
        onChange={(e) => setAdd(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && add.trim()) {
            e.preventDefault();
            if (!list.some(o => o.toLowerCase() === add.trim().toLowerCase())) cx.addOptions(name, [...list, add.trim()]);
            setAdd('');
          }
        }} />
    </Popover>
  );
}

// ── Pestañas de vista (con «+N más» cuando no caben) ──────────────────
function ViewTabs({ tabs, readOnly, onSwitch, onMenu, onAdd, onMore }) {
  const wrapRef = useRef(null);
  const measRef = useRef(null);
  const [fit, setFit] = useState(null);
  const sig = tabs.map(tb => `${tb.key}:${tb.name || tb.type}:${tb.active ? 1 : 0}`).join('|');
  useLayoutEffect(() => {
    const wrap = wrapRef.current, meas = measRef.current;
    if (!wrap || !meas) return undefined;
    const calc = () => {
      const ws = Array.from(meas.children).map(el => Math.ceil(el.getBoundingClientRect().width));
      if (!ws.length || ws.some(w => !w)) return;
      const addW = readOnly ? 0 : 38;
      const activeIdx = Math.max(0, tabs.findIndex(tb => tb.active));
      const r = fitTabs(ws, wrap.clientWidth - addW, { gap: 6, moreW: 92, activeIdx });
      setFit(prev => (prev && prev.visible.join() === r.visible.join() ? prev : r));
    };
    calc();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(calc);
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, readOnly]);
  const visible = fit ? fit.visible.filter(i => tabs[i]) : tabs.map((_, i) => i);
  const hidden = fit ? fit.hidden.filter(i => tabs[i]) : [];
  const label = (tab) => tab.name || t('db.view.' + (tab.type || 'table'));
  return (
    <div className="db-tabs-wrap" ref={wrapRef}>
      <div className="db-tabs db-tabs-meas" ref={measRef} aria-hidden="true">
        {tabs.map(tab => <span key={tab.key} className="db-tab"><DbIcon name={VIEW_ICON[tab.type] || 'table'} size={14} /><span>{label(tab)}</span></span>)}
      </div>
      <div className="db-tabs" role="tablist" aria-label={t('db.views')}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          const list = Array.from(e.currentTarget.querySelectorAll('[role="tab"]'));
          const i = list.indexOf(document.activeElement);
          if (i < 0) return;
          e.preventDefault();
          const n = list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
          if (n) n.focus();
        }}>
        {visible.map(i => {
          const tab = tabs[i];
          return (
            <button key={tab.key} type="button" role="tab" aria-selected={tab.active}
              className={`db-tab${tab.active ? ' on' : ''}`}
              onClick={(e) => (tab.active && tab.saved && !readOnly ? onMenu(tab, e.currentTarget) : onSwitch(tab))}
              onContextMenu={(e) => { if (readOnly) return; e.preventDefault(); onMenu(tab, e.currentTarget); }}
              title={tab.active && tab.saved ? t('db.view.editHint') : undefined}>
              <DbIcon name={VIEW_ICON[tab.type] || 'table'} size={14} />
              <span>{label(tab)}</span>
            </button>
          );
        })}
        {hidden.length > 0 && (
          <button type="button" className="db-tab db-tab-more" aria-haspopup="menu" onClick={(e) => onMore(hidden.map(i => tabs[i]), e.currentTarget)}>
            <span>{t('db.views.more', { n: hidden.length })}</span>
          </button>
        )}
        {!readOnly && (
          <button type="button" className="db-tab db-tab-add" aria-label={t('db.view.add')} title={t('db.view.add')} onClick={(e) => onAdd(e.currentTarget)}>
            <DbIcon name="plus" size={14} stroke={2} />
          </button>
        )}
      </div>
    </div>
  );
}

export function DatabaseBlock({ meta: propMeta, idx, ctxRef, ops, surface }) {
  useI18n();
  // Copia optimista: tras escribir, la vista se actualiza al instante con el
  // resultado sin esperar al debounce del panel; la siguiente prop la retira.
  const [prevProp, setPrevProp] = useState(propMeta);
  const [over, setOver] = useState(null);
  if (prevProp !== propMeta) {
    setPrevProp(propMeta);
    // La prop puede llegar con un cambio nuestro todavía sin incluir (dos
    // escrituras dentro del mismo debounce): si el texto vivo ya es otro, se
    // sigue mostrando el vivo.
    let next = null;
    if (over) {
      try {
        const live = ops.parseSourceTables((ctxRef.current && ctxRef.current.getSource) ? ctxRef.current.getSource() : '')[idx];
        const sig = (m) => JSON.stringify([m.headers, m.rows, m.directive]);
        if (live && sig(live) !== sig(propMeta)) next = live;
      } catch {}
    }
    if (next || over) setOver(next);
  }
  const meta = over || propMeta;
  const d = meta.directive || {};
  const headers = meta.headers;
  const cols = d.cols || {};
  const C = () => ctxRef.current || {};
  const readOnly = !!C().readOnly;

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [editing, setEditingState] = useState(null);
  const editingRef = useRef(null);
  const setEditing = (v) => { editingRef.current = typeof v === 'function' ? v(editingRef.current) : v; setEditingState(editingRef.current); };
  const [sel, setSel] = useState(null);
  const [peek, setPeek] = useState(null);
  const [pop, setPop] = useState(null);
  const [liveW, setLiveW] = useState(null);
  // «Ampliar» se guarda en la directiva de la tabla (`:wide=1`); en una vista de solo lectura vale solo en esta sesión.
  const [localWide, setLocalWide] = useState(null);
  const expanded = readOnly && localWide != null ? localWide : !!d.wide;
  const toggleExpanded = () => { if (readOnly) setLocalWide(!expanded); else patch({ wide: expanded ? null : true }); };
  const now = new Date();
  const calMonth = useState({ y: now.getFullYear(), m: now.getMonth() });
  const gridRef = useRef(null);
  const rootRef = useRef(null);

  // ── Escritura ────────────────────────────────────────────────────────
  const mutate = useCallback((fn) => {
    const c = ctxRef.current;
    if (!c || c.readOnly || !c.mutateSource) return;
    let out = null;
    c.mutateSource((live) => {
      const r = fn(live);
      if (typeof r === 'string' && r !== live) { out = r; return r; }
      return null;
    });
    if (out != null) {
      const m = ops.parseSourceTables(out)[idx];
      if (m) setOver(m);
    }
  }, [ctxRef, ops, idx]);
  // Parche de directiva calculado sobre la directiva EN VIVO.
  const mutateDir = useCallback((fn) => mutate((src) => {
    const tt = ops.parseSourceTables(src)[idx];
    if (!tt) return null;
    const p = fn(tt.directive || {}, tt);
    return p ? ops.patchTableDirective(src, idx, p) : null;
  }), [mutate, ops, idx]);
  const patch = useCallback((p) => mutateDir(() => p), [mutateDir]);

  // ── Derivados ────────────────────────────────────────────────────────
  const rows = useMemo(() => computeRows(meta, { search }), [meta, search]);
  const hiddenSet = useMemo(() => new Set(d.hidden || []), [d.hidden]);
  const titleIdx = titleColumnIndex(meta);
  const visibleCols = useMemo(() => {
    const v = headers.map((_, i) => i).filter(i => !hiddenSet.has(headers[i]));
    return v.length ? v : [titleIdx];
  }, [headers, hiddenSet, titleIdx]);
  const widthOf = (ci) => {
    if (liveW && liveW.ci === ci) return liveW.w;
    const name = headers[ci] || `Col ${ci + 1}`;
    const w = d.widths && d.widths[name];
    return Number.isFinite(w) && w > 0 ? w : defaultWidth(cols[name] && cols[name].type, ci === titleIdx);
  };
  // Width set by hand (resized), as opposed to the type's default.
  const hasWidth = (ci) => {
    if (liveW && liveW.ci === ci) return true;
    const w = d.widths && d.widths[headers[ci] || `Col ${ci + 1}`];
    return Number.isFinite(w) && w > 0;
  };
  const tabs = getTabs(d);
  const view = VIEW_TYPES.includes(d.view) ? d.view : 'table';
  const filterEntries = d.filter ? Object.entries(d.filter) : [];
  const rules = filterRules(d.filter);
  const colIndex = (name) => headers.findIndex(h => h.toLowerCase() === String(name || '').toLowerCase());

  // Si el bloque sale del DOM de verdad (cambio de modo o de nota), cierra lo
  // que tenga abierto en la capa flotante. Los descolgados de cada render son
  // síncronos y nunca se ven desde un intervalo.
  useEffect(() => {
    if (peek == null && !pop && !editing) return undefined;
    const id = setInterval(() => {
      if (rootRef.current && !rootRef.current.isConnected) { setPeek(null); setPop(null); setEditing(null); }
    }, 600);
    return () => clearInterval(id);
  }, [peek, pop, editing]);

  // ── Foco ─────────────────────────────────────────────────────────────
  const focusGrid = () => requestAnimationFrame(() => {
    const g = gridRef.current;
    if (g && g.isConnected && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('.db-pop, .db-peek'))) g.focus({ preventScroll: true });
  });
  useLayoutEffect(() => {
    if (!sel || !rootRef.current) return;
    const el = rootRef.current.querySelector(`[data-db-cell="${sel.r}:${sel.c}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel && sel.r, sel && sel.c]);

  // ── Celdas ───────────────────────────────────────────────────────────
  const normalize = (v, type) => {
    let s = String(v == null ? '' : v).replace(/\n+/g, ' ');
    if (type !== 'text') s = s.trim();
    if (type === 'progress' && s) { const n = tryNumber(s); if (Number.isFinite(n)) s = String(Math.max(0, Math.min(100, Math.round(n)))); }
    if (type === 'rating' && s) { const n = tryNumber(s); if (Number.isFinite(n)) s = String(Math.max(0, Math.min(RATING_MAX, Math.round(n)))); }
    return s;
  };
  const commitCell = (r, c, v, extra) => {
    const name = headers[c];
    const conf = cols[name] || null;
    const val = normalize(v, conf ? conf.type : 'text');
    mutate((src) => {
      let s = ops.setTableCellInSource(src, idx, r, c, val);
      if (extra && extra.addOption) {
        const tt = ops.parseSourceTables(s)[idx];
        const cc = tt && tt.directive && tt.directive.cols && tt.directive.cols[name];
        if (cc && !(cc.options || []).some(o => o.toLowerCase() === extra.addOption.toLowerCase())) {
          s = ops.setTableColumnTypeInSource(s, idx, name, { type: cc.type, options: [...(cc.options || []), extra.addOption] });
        }
      }
      return s;
    });
  };
  const cellEl = (r, c, surface) => rootRef.current && (surface === 'peek'
    ? document.querySelector(`.db-peek [data-db-prop="${c}"]`)
    : rootRef.current.querySelector(`[data-db-cell="${r}:${c}"]`));
  const startEdit = (r, c, el, opts = {}) => {
    if (readOnly) return;
    const name = headers[c];
    const conf = cols[name] || null;
    const kind = editKind(conf && conf.type);
    const surf = opts.surface || 'table';
    if (surf === 'table') setSel({ r, c });
    if (kind === 'direct') return;
    if (kind === 'inline') { setEditing({ rowIdx: r, colIdx: c, kind, surface: surf, initial: opts.initial }); return; }
    const target = el || cellEl(r, c, surf);
    setEditing({ rowIdx: r, colIdx: c, kind: 'popover', surface: surf, anchor: rectOf(target) || { x: 200, y: 200 } });
  };
  const stopEdit = (refocus) => {
    const ed = editingRef.current;
    setEditing(null);
    if (refocus && (!ed || ed.surface === 'table')) focusGrid();
  };
  const moveFrom = (ed, how) => {
    if (ed.surface === 'peek') {
      const order = headers.map((_, i) => i).filter(i => i !== titleIdx || !(cols[headers[titleIdx]] && cols[headers[titleIdx]].type !== 'text'));
      const k = order.indexOf(ed.colIdx);
      const next = order[k + (how === 'prev' || how === 'up' ? -1 : 1)];
      if (next == null) return;
      requestAnimationFrame(() => startEdit(ed.rowIdx, next, cellEl(ed.rowIdx, next, 'peek'), { surface: 'peek' }));
      return;
    }
    const rIdx = rows.map(x => x.idx);
    let ri = rIdx.indexOf(ed.rowIdx), ci = visibleCols.indexOf(ed.colIdx);
    if (ri < 0 || ci < 0) return;
    if (how === 'next') { ci++; if (ci >= visibleCols.length) { ci = 0; ri++; } }
    else if (how === 'prev') { ci--; if (ci < 0) { ci = visibleCols.length - 1; ri--; } }
    else if (how === 'down') ri++;
    else if (how === 'up') ri--;
    if (ri < 0 || ri >= rIdx.length) { setSel({ r: ed.rowIdx, c: ed.colIdx }); focusGrid(); return; }
    const r = rIdx[ri], c = visibleCols[ci];
    if (how === 'down' || how === 'up') { setSel({ r, c }); focusGrid(); return; }
    const kind = editKind(cols[headers[c]] && cols[headers[c]].type);
    if (kind === 'direct') { setSel({ r, c }); focusGrid(); return; }
    requestAnimationFrame(() => startEdit(r, c, cellEl(r, c, 'table')));
  };
  // `edArg` = la edición a la que pertenece el valor (el blur llega diferido:
  // para entonces puede haber empezado otra edición en otra celda).
  const commitEditing = (v, how, edArg) => {
    const ed = edArg || editingRef.current;
    if (!ed) return;
    const cur = meta.rows[ed.rowIdx] ? (meta.rows[ed.rowIdx][ed.colIdx] == null ? '' : meta.rows[ed.rowIdx][ed.colIdx]) : '';
    if (String(v) !== String(cur)) commitCell(ed.rowIdx, ed.colIdx, v);
    const stillMine = !editingRef.current || editingRef.current === ed;
    if (!stillMine) return;
    setEditing(null);
    if (how === 'next' || how === 'prev' || how === 'down' || how === 'up') moveFrom(ed, how);
    else if (how !== 'blur' && ed.surface === 'table') focusGrid();
  };
  const openLink = (a) => {
    const c = C();
    const wl = a.getAttribute('data-wikilink');
    if (wl) { c.navigateTo && c.navigateTo(wl); return; }
    const wn = a.getAttribute('data-wikiname');
    if (wn) { c.openWikilink && c.openWikilink(wn); return; }
    const href = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) {
      if (window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal(href);
      else window.open(href, '_blank', 'noopener');
    }
  };
  const cellClick = (r, c, el, e, surf = 'table') => {
    const a = e && e.target && e.target.closest && e.target.closest('a[href]');
    if (a) { e.preventDefault(); e.stopPropagation(); openLink(a); return; }
    if (readOnly) { if (surf === 'table') setSel({ r, c }); return; }
    const ed = editingRef.current;
    if (ed && ed.rowIdx === r && ed.colIdx === c && ed.surface === surf) return;
    startEdit(r, c, el, { surface: surf });
  };

  // ── Filas ────────────────────────────────────────────────────────────
  const newRow = ({ init, peek: wantPeek, edit } = {}) => {
    if (readOnly) return;
    const values = headers.map((_, i) => (init && init[i] != null ? String(init[i]) : ''));
    // Rellena con los filtros «es …» activos para que la fila nueva se vea.
    for (const [k, raw] of filterEntries) {
      const i = colIndex(k);
      if (i < 0 || values[i]) continue;
      const f = parseFilterValue(raw);
      const type = cols[headers[i]] && cols[headers[i]].type;
      if (f.op === 'is' || (f.op === 'contains' && (OPTION_TYPES.has(type) || type === 'person'))) values[i] = f.val;
      else if (f.op === 'checked') values[i] = 'x';
    }
    let at = null;
    mutate((src) => {
      const tt = ops.parseSourceTables(src)[idx];
      if (!tt) return null;
      at = tt.rows.length;
      return ops.appendTableRow(src, idx, values);
    });
    if (at == null) return;
    const hasOtherFilter = filterEntries.some(([k, raw]) => { const f = parseFilterValue(raw); return !(f.op === 'is' || f.op === 'checked' || f.op === 'notempty' || f.op === 'contains'); });
    if (edit && !hasOtherFilter && !search) setEditing({ rowIdx: at, colIdx: titleIdx, kind: 'inline', surface: 'table' });
    else if (wantPeek || edit) { setEditing(null); setPeek(at); }
  };
  const deleteRow = (r) => {
    const c = C();
    const go = () => { mutate(src => ops.removeTableRow(src, idx, r)); if (peek === r) setPeek(null); setSel(null); };
    if (c.askConfirm) c.askConfirm(t('db.row.deleteConfirm'), { title: t('db.row.delete'), confirmLabel: t('db.delete') }).then(ok => { if (ok) go(); });
    else go();
  };
  const rowMenu = (r, anchorEl, opts = {}) => {
    const anchor = anchorEl && anchorEl.getBoundingClientRect ? rectOf(anchorEl) : anchorEl;
    setPop({
      kind: 'menu', anchor, align: opts.fromPeek ? 'end' : 'start', items: [
        ...(opts.fromPeek ? [] : [{ label: t('db.row.open'), icon: 'peek', onSelect: () => setPeek(r) }]),
        { label: t('db.row.duplicate'), icon: 'copy', onSelect: () => mutate(src => ops.duplicateTableRow(src, idx, r)) },
        { label: t('db.row.insertBelow'), icon: 'plus', onSelect: () => mutate(src => { const tt = ops.parseSourceTables(src)[idx]; if (!tt) return null; const s = ops.appendTableRow(src, idx, tt.headers.map(() => '')); return ops.moveTableRow(s, idx, tt.rows.length, r + 1); }) },
        ...(d.sort && d.sort.col ? [] : [
          { label: t('db.row.moveUp'), icon: 'chevUp', disabled: r <= 0, onSelect: () => mutate(src => ops.moveTableRow(src, idx, r, r - 1)) },
          { label: t('db.row.moveDown'), icon: 'chevDown', disabled: r >= meta.rows.length - 1, onSelect: () => mutate(src => ops.moveTableRow(src, idx, r, r + 2)) },
        ]),
        { type: 'sep' },
        { label: t('db.row.delete'), icon: 'trash', danger: true, onSelect: () => deleteRow(r) },
      ],
    });
  };
  // Tablero: cambia la calle (y la posición si no hay orden activo).
  const moveCard = (r, gi, laneValue, before, fromValue) => {
    const name = headers[gi];
    const conf = cols[name] || null;
    const multi = conf && MULTI_TYPES.has(conf.type);
    mutate((src) => {
      const tt = ops.parseSourceTables(src)[idx];
      if (!tt || !tt.rows[r]) return null;
      const cur = String(tt.rows[r][gi] || '').trim();
      let next = laneValue;
      if (multi) {
        const parts = splitMulti(cur).filter(x => x.toLowerCase() !== String(fromValue || '').toLowerCase());
        if (laneValue && !parts.some(x => x.toLowerCase() === laneValue.toLowerCase())) parts.push(laneValue);
        next = joinMulti(parts);
      }
      let s = cur === next ? src : ops.setTableCellInSource(src, idx, r, gi, next);
      if (before != null) s = ops.moveTableRow(s, idx, r, before);
      return s;
    });
  };
  const moveLane = (gi, from, to, laneValues) => {
    const list = laneValues.slice();
    const a = list.indexOf(from), b = list.indexOf(to);
    if (a < 0 || b < 0) return;
    list.splice(a, 1);
    list.splice(b, 0, from);
    patch({ order: list, view: 'kanban', by: headers[gi] });
  };

  // ── Columnas ─────────────────────────────────────────────────────────
  const addColumn = (name, type) => {
    let conf = type === 'text' ? null : { type };
    if (type === 'status') conf.options = [t('db.status.todo'), t('db.status.doing'), t('db.status.done')];
    mutate((src) => {
      let s = ops.appendTableColumn(src, idx, name);
      if (conf) s = ops.setTableColumnTypeInSource(s, idx, name, conf);
      return s;
    });
  };
  const setColumnType = async (ci, newType) => {
    const name = headers[ci];
    const prev = cols[name] || null;
    if ((prev ? prev.type : 'text') === newType) return;
    let conf = newType === 'text' ? null : { type: newType };
    if (conf && OPTION_TYPES.has(newType)) {
      // Las opciones salen de las que ya había y de los valores de la columna.
      const seen = new Set(); const opts = [];
      const add = (x) => { const s = String(x || '').trim(); if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); opts.push(s); } };
      ((prev && prev.options) || []).forEach(add);
      for (const r of meta.rows) (MULTI_TYPES.has(newType) ? splitMulti(r[ci]) : [r[ci]]).forEach(add);
      if (!opts.length && newType === 'status') [t('db.status.todo'), t('db.status.doing'), t('db.status.done')].forEach(add);
      if (opts.length && newType !== 'tags') conf.options = opts;
    }
    if (conf) {
      const bad = [];
      meta.rows.forEach((row, ri) => {
        const raw = String(row[ci] || '').trim();
        if (!raw) return;
        let ok = true;
        if (conf.type === 'number') ok = Number.isFinite(Number(raw.replace(',', '.')));
        else if (conf.type === 'date') ok = !!parseDateCell(raw);
        else if (conf.type === 'rating') { const n = Number(raw); ok = Number.isFinite(n) && n >= 0 && n <= RATING_MAX; }
        else if (conf.type === 'progress') { const n = Number(raw.replace('%', '')); ok = Number.isFinite(n) && n >= 0 && n <= 100; }
        else if (conf.type === 'checkbox') ok = /^(x|✓|✔|true|1|sí|si|yes|no|false|0)$/i.test(raw);
        if (!ok) bad.push(ri + 1);
      });
      if (bad.length) {
        const c = C();
        const preview = bad.slice(0, 5).join(', ') + (bad.length > 5 ? '…' : '');
        const msg = t('db.type.mismatch', { n: bad.length, type: typeLabel(newType), rows: preview });
        const ok = c.askConfirm ? await c.askConfirm(msg, { title: t('db.type.change'), confirmLabel: t('db.continue'), cancelLabel: t('db.cancel') }) : window.confirm(msg);
        if (!ok) return;
      }
    }
    mutate(src => ops.setTableColumnTypeInSource(src, idx, name, conf));
  };
  const renameColumn = (ci, next) => {
    const v = String(next || '').trim();
    if (!v || v === headers[ci]) return;
    if (headers.some((h, i) => i !== ci && h.toLowerCase() === v.toLowerCase())) { window.alert(t('db.col.exists', { name: v })); return; }
    mutate(src => ops.renameTableColumn(src, idx, ci, v));
  };
  const deleteColumn = (ci) => {
    const name = headers[ci];
    if (headers.length <= 1) return;
    const go = () => mutate((src) => {
      let s = ops.removeTableColumn(src, idx, ci);
      const tt = ops.parseSourceTables(s)[idx];
      const dd = (tt && tt.directive) || {};
      const drop = (o) => { if (!o) return null; const r = { ...o }; delete r[name]; return Object.keys(r).length ? r : null; };
      const p = { cols: drop(dd.cols), widths: drop(dd.widths), agg: drop(dd.agg), filter: drop(dd.filter), optColors: drop(dd.optColors), hidden: (dd.hidden || []).filter(x => x !== name) };
      if (dd.sort && dd.sort.col === name) p.sort = null;
      if (dd.by === name) p.by = '';
      if (dd.cal === name) p.cal = null;
      return ops.patchTableDirective(s, idx, p);
    });
    const c = C();
    if (c.askConfirm) c.askConfirm(t('db.col.deleteConfirm', { name }), { title: t('db.col.delete'), confirmLabel: t('db.delete') }).then(ok => { if (ok) go(); });
    else go();
  };
  const setHidden = (name, hide) => mutateDir((dd) => {
    const h = new Set(dd.hidden || []);
    if (hide) h.add(name); else h.delete(name);
    return { hidden: [...h] };
  });
  const setFilter = (name, raw) => mutateDir((dd) => {
    const f = { ...(dd.filter || {}) };
    for (const k of Object.keys(f)) if (k.toLowerCase() === name.toLowerCase()) delete f[k];
    if (raw != null && raw !== '') f[name] = raw;
    return { filter: f };
  });
  const setSort = (s) => patch({ sort: s && s.col ? s : null });
  const setFilterMap = (map) => patch({ filter: map && Object.keys(map).length ? map : null });
  // Renombrar / borrar una opción: actualiza la lista de opciones, el valor de
  // las celdas de la columna, el color guardado y los filtros que la usan.
  const editOption = (name, opt, to) => {
    const ci = headers.indexOf(name);
    if (ci < 0) return;
    const multi = !!(cols[name] && MULTI_TYPES.has(cols[name].type));
    const remove = to == null;
    mutate((src) => {
      let out = src;
      const t0 = ops.parseSourceTables(out)[idx];
      if (!t0) return null;
      t0.rows.forEach((row, r) => {
        const cur = row[ci] == null ? '' : row[ci];
        const nv = remove ? removeOptionFromValue(cur, multi, opt) : renameOptionInValue(cur, multi, opt, to);
        if (nv !== cur) out = ops.setTableCellInSource(out, idx, r, ci, nv);
      });
      const t1 = ops.parseSourceTables(out)[idx];
      const dd = (t1 && t1.directive) || {};
      const lo = opt.toLowerCase();
      const cc = dd.cols && dd.cols[name];
      if (cc && cc.options && cc.options.some(o => o.toLowerCase() === lo)) {
        const seen = new Set();
        const opts = cc.options.map(o => (o.toLowerCase() === lo ? (remove ? null : to) : o)).filter(o => {
          if (!o) return false; const k = o.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
        });
        out = ops.setTableColumnTypeInSource(out, idx, name, { type: cc.type, options: opts });
      }
      const p = optionChangePatch(dd, name, opt, to);
      return Object.keys(p).length ? ops.patchTableDirective(out, idx, p) : out;
    });
  };
  const renameOption = (name, opt, to) => { const v = String(to || '').trim(); if (v && v !== opt) editOption(name, opt, v); };
  const deleteOption = (name, opt) => editOption(name, opt, null);
  const commitWidth = (ci, w) => {
    setLiveW(null);
    const name = headers[ci] || `Col ${ci + 1}`;
    mutateDir((dd) => ({ widths: { ...(dd.widths || {}), [name]: w } }));
  };
  const moveCol = (from, to) => mutate(src => ops.moveTableColumn(src, idx, from, to));
  const setOptionColor = (name, opt, color) => mutateDir((dd) => {
    const oc = { ...(dd.optColors || {}) };
    oc[name] = { ...(oc[name] || {}), [opt]: color };
    return { optColors: oc };
  });
  const setColOptions = (name, options) => mutate((src) => {
    const tt = ops.parseSourceTables(src)[idx];
    const cc = tt && tt.directive && tt.directive.cols && tt.directive.cols[name];
    return ops.setTableColumnTypeInSource(src, idx, name, { type: cc ? cc.type : 'select', options });
  });
  const removeOption = (name, opt) => {
    const cc = cols[name];
    if (!cc) return;
    setColOptions(name, (cc.options || []).filter(o => o.toLowerCase() !== opt.toLowerCase()));
  };
  const reorderOption = (name, from, to) => {
    const cc = cols[name];
    if (!cc || !cc.options) return;
    const list = cc.options.slice();
    const [x] = list.splice(from, 1);
    list.splice(to, 0, x);
    setColOptions(name, list);
  };

  // ── Vistas ───────────────────────────────────────────────────────────
  const switchTab = (tab) => {
    if (tab.active) return;
    setEditing(null); setSel(null);
    if (!tab.saved) {
      const p = { view: tab.type };
      if (tab.type === 'kanban' && !(d.by && headers.includes(d.by))) { const g = pickGroupColumn(meta); if (g) p.by = g; }
      patch(p);
      return;
    }
    mutateDir((dd) => switchTabPatch(dd, tab));
  };
  const addView = (type) => {
    const names = tabs.map(tb => tb.name || viewLabel(tb.type));
    const name = uniqueName(viewLabel(type), names);
    mutateDir((dd) => {
      const p = addViewPatch(dd, type, name, viewLabel);
      if (type === 'kanban' && !p.by) { const g = pickGroupColumn(meta); if (g) p.by = g; }
      return p;
    });
  };
  const tabMenu = (tab, el) => {
    if (!tab.saved) {
      setPop({ kind: 'menu', anchor: rectOf(el), items: [
        { type: 'head', label: viewLabel(tab.type) },
        { label: t('db.view.saveAs'), icon: 'layers', onSelect: () => addView(tab.type) },
      ] });
      return;
    }
    setPop({ kind: 'menu', anchor: rectOf(el), items: [
      { type: 'custom', render: (close) => (
        <input className="db-picker-search" defaultValue={tab.name} aria-label={t('db.view.rename')} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.currentTarget.value.trim(); if (v) mutateDir(dd => renameViewPatch(dd, tab.index, v)); close(); } }} />
      ) },
      { label: t('db.view.type'), icon: VIEW_ICON[tab.type], submenu: () => VIEW_TYPES.map(ty => ({
        label: viewLabel(ty), icon: VIEW_ICON[ty], checked: ty === tab.type,
        onSelect: () => { if (tab.active) patch({ view: ty }); else mutateDir(dd => { const v = { ...dd.views, list: dd.views.list.slice() }; v.list[tab.index] = { ...v.list[tab.index], v: ty }; return { views: v }; }); },
      })) },
      { label: t('db.view.duplicate'), icon: 'copy', onSelect: () => mutateDir(dd => duplicateViewPatch(dd, tab.index, t('db.view.copySuffix'))) },
      { type: 'sep' },
      { label: t('db.view.delete'), icon: 'trash', danger: true, disabled: tabs.length <= 1, onSelect: () => mutateDir(dd => deleteViewPatch(dd, tab.index)) },
    ] });
  };
  const openAddView = (el) => setPop({ kind: 'menu', anchor: rectOf(el), items: [
    { type: 'head', label: t('db.view.new') },
    ...VIEW_TYPES.map(ty => ({ label: viewLabel(ty), icon: VIEW_ICON[ty], onSelect: () => addView(ty) })),
  ] });

  // ── Menús ────────────────────────────────────────────────────────────
  // Color de columna (cabecera + celdas): la misma directiva `colors` que
  // escribe la herramienta MCP color_table.
  const colColor = (name) => {
    const c = d.colors;
    return (c && ((c.cols && c.cols[name]) || (c.headers && c.headers[name]))) || null;
  };
  const setColColor = (name, hex) => mutateDir((dd) => {
    const c = { ...(dd.colors || {}) };
    const colsC = { ...(c.cols || {}) }, heads = { ...(c.headers || {}) };
    if (hex) { colsC[name] = hex; heads[name] = hex; } else { delete colsC[name]; delete heads[name]; }
    c.cols = colsC; c.headers = heads;
    return { colors: c };
  });
  const openColMenu = (ci, el) => {
    const name = headers[ci];
    const conf = cols[name] || null;
    const type = (conf && conf.type) || 'text';
    if (readOnly) return;
    const anchor = rectOf(el);
    setPop({ kind: 'menu', anchor, minWidth: 240, items: [
      { type: 'custom', render: (close) => (
        <input className="db-picker-search" defaultValue={name} aria-label={t('db.col.rename')} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renameColumn(ci, e.currentTarget.value); close(); } }}
          onBlur={(e) => renameColumn(ci, e.currentTarget.value)} />
      ) },
      { label: t('db.col.type'), hint: typeLabel(type), icon: TYPE_ICON[type], submenu: () => COLUMN_TYPES.map(ty => ({
        label: typeLabel(ty), icon: TYPE_ICON[ty], checked: ty === type, onSelect: () => setColumnType(ci, ty),
      })) },
      ...(OPTION_TYPES.has(type) ? [{ label: t('db.col.editOptions'), icon: 'palette', onSelect: () => setPop({ kind: 'options', col: ci, anchor }) }] : []),
      { type: 'sep' },
      { label: t('db.sort.asc'), icon: 'sortAsc', onSelect: () => setSort({ col: name, dir: 'asc' }) },
      { label: t('db.sort.desc'), icon: 'sortDesc', onSelect: () => setSort({ col: name, dir: 'desc' }) },
      { label: t('db.filter.byCol'), icon: 'filter', onSelect: () => setPop({ kind: 'rules', onlyCol: name, anchor, fresh: !(d.filter && Object.keys(d.filter).some(k => k.toLowerCase() === name.toLowerCase())) }) },
      { type: 'sep' },
      { label: t('db.col.hide'), icon: 'eyeOff', disabled: visibleCols.length <= 1, onSelect: () => setHidden(name, true) },
      { label: t('db.col.moveLeft'), icon: 'arrowLeft', disabled: ci === 0, onSelect: () => moveCol(ci, ci - 1) },
      { label: t('db.col.moveRight'), icon: 'arrowRight', disabled: ci >= headers.length - 1, onSelect: () => moveCol(ci, ci + 1) },
      { label: t('db.col.color'), icon: 'palette', submenu: () => [
        ...DB_COL_COLORS.map(([id, hex]) => ({
          label: t('db.color.' + id), checked: colColor(name) === hex ? true : undefined,
          icon: <span className="db-colsw" style={{ background: hex }} aria-hidden="true" />,
          onSelect: () => setColColor(name, hex),
        })),
        { type: 'sep' },
        { label: t('db.color.none'), disabled: !colColor(name), onSelect: () => setColColor(name, null) },
      ] },
      { label: t('db.col.width'), icon: 'widen', submenu: () => [
        { label: t('db.col.width.narrow'), onSelect: () => commitWidth(ci, 120) },
        { label: t('db.col.width.normal'), onSelect: () => commitWidth(ci, 180) },
        { label: t('db.col.width.wide'), onSelect: () => commitWidth(ci, 300) },
        { label: t('db.col.width.wider'), onSelect: () => commitWidth(ci, Math.min(1200, widthOf(ci) + 80)) },
        { type: 'sep' },
        { label: t('db.col.width.reset'), onSelect: () => mutateDir(dd => { const w = { ...(dd.widths || {}) }; delete w[name]; return { widths: w }; }) },
      ] },
      { type: 'sep' },
      { label: t('db.col.delete'), icon: 'trash', danger: true, disabled: headers.length <= 1, onSelect: () => deleteColumn(ci) },
    ] });
  };
  const openAggMenu = (ci, el) => {
    const name = headers[ci];
    const conf = cols[name] || null;
    const cur = d.agg && d.agg[name];
    setPop({ kind: 'menu', anchor: rectOf(el), items: [
      { type: 'head', label: t('db.agg.for', { name }) },
      { label: t('db.agg.none'), checked: !cur, onSelect: () => mutate(src => ops.setTableAggInSource(src, idx, name, 'none')) },
      ...aggsForType(conf && conf.type).map(fn => ({ label: t('db.agg.' + fn), checked: cur === fn, onSelect: () => mutate(src => ops.setTableAggInSource(src, idx, name, fn)) })),
    ] });
  };
  const openDateColMenu = (el) => setPop({ kind: 'menu', anchor: rectOf(el), items: [
    { type: 'head', label: t('db.cal.dateCol') },
    ...headers.map(h => ({ label: h, icon: TYPE_ICON[(cols[h] && cols[h].type) || 'text'], checked: pickDateColumn(meta) === h, onSelect: () => patch({ cal: h }) })),
  ] });
  const moreMenu = (el) => {
    const c = C();
    const anyState = filterEntries.length || (d.sort && d.sort.col);
    const active = tabs.find(tb => tb.active);
    setPop({ kind: 'menu', anchor: rectOf(el), align: 'end', minWidth: 240, items: [
      { label: t('db.more.props'), icon: 'eye', submenu: () => headers.map((h) => ({
        label: h, icon: TYPE_ICON[(cols[h] && cols[h].type) || 'text'], checked: !hiddenSet.has(h), keepOpen: true,
        onSelect: () => setHidden(h, !hiddenSet.has(h)),
      })) },
      ...(view === 'kanban' ? [{ label: t('db.more.groupBy'), icon: 'board', hint: pickGroupColumn(meta) || '', submenu: () => headers.map(h => ({ label: h, icon: TYPE_ICON[(cols[h] && cols[h].type) || 'text'], checked: pickGroupColumn(meta) === h, onSelect: () => patch({ by: h }) })) }] : []),
      ...(view === 'calendar' ? [{ label: t('db.cal.dateCol'), icon: 'date', hint: pickDateColumn(meta) || '', submenu: () => headers.map(h => ({ label: h, checked: pickDateColumn(meta) === h, onSelect: () => patch({ cal: h }) })) }] : []),
      { type: 'sep' },
      { label: t('db.more.excel'), icon: 'download', disabled: !c.exportXlsx, onSelect: () => c.exportXlsx && c.exportXlsx(idx, { headers: meta.headers, rows: meta.rows }) },
      ...(!readOnly && c.openFormBuilder ? [{ label: t('db.more.form'), icon: 'form', onSelect: () => c.openFormBuilder(idx) }] : []),
      ...(anyState && !readOnly ? [{ type: 'sep' }, { label: t('db.more.clear'), icon: 'broom', onSelect: () => patch({ filter: null, sort: null }) }] : []),
      ...(active && active.saved && !readOnly ? [
        { type: 'sep' },
        { label: t('db.view.rename'), icon: 'edit', onSelect: () => setTimeout(() => { const tabEl = rootRef.current && rootRef.current.querySelector('[role="tab"][aria-selected="true"]'); if (tabEl) tabMenu(active, tabEl); }, 0) },
        { label: t('db.view.duplicate'), icon: 'copy', onSelect: () => mutateDir(dd => duplicateViewPatch(dd, active.index, t('db.view.copySuffix'))) },
        { label: t('db.view.delete'), icon: 'trash', danger: true, disabled: tabs.length <= 1, onSelect: () => mutateDir(dd => deleteViewPatch(dd, active.index)) },
      ] : []),
    ] });
  };
  const openFilterPick = (el) => setPop({ kind: 'rules', anchor: rectOf(el), fresh: true });
  const openRules = (el, onlyCol) => setPop({ kind: 'rules', anchor: rectOf(el), onlyCol: onlyCol || null, fresh: false });
  const openSortPick = (el) => setPop({ kind: 'menu', anchor: rectOf(el), align: 'end', items: [
    { type: 'head', label: t('db.sort.pickCol') },
    ...headers.map(h => ({ label: h, icon: TYPE_ICON[(cols[h] && cols[h].type) || 'text'], onSelect: () => setSort({ col: h, dir: 'asc' }) })),
  ] });

  // ── Teclado de la tabla ──────────────────────────────────────────────
  const gridKeyDown = (e) => {
    if (e.target !== gridRef.current) return;
    if (editingRef.current) return;
    const rIdx = rows.map(x => x.idx);
    const cur = sel && rIdx.includes(sel.r) && visibleCols.includes(sel.c) ? sel : null;
    const go = (r, c) => { e.preventDefault(); setSel({ r, c }); };
    if (!cur) {
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key) && rIdx.length) go(rIdx[0], visibleCols[0]);
      return;
    }
    const ri = rIdx.indexOf(cur.r), ci = visibleCols.indexOf(cur.c);
    const name = headers[cur.c];
    const type = cols[name] && cols[name].type;
    if (e.key === 'ArrowDown') { if (ri < rIdx.length - 1) go(rIdx[ri + 1], cur.c); else e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { if (ri > 0) go(rIdx[ri - 1], cur.c); else e.preventDefault(); return; }
    if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) { if (ci < visibleCols.length - 1) go(cur.r, visibleCols[ci + 1]); else if (e.key === 'Tab' && ri < rIdx.length - 1) go(rIdx[ri + 1], visibleCols[0]); else if (e.key !== 'Tab') e.preventDefault(); return; }
    if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) { if (ci > 0) go(cur.r, visibleCols[ci - 1]); else if (e.key === 'Tab' && ri > 0) go(rIdx[ri - 1], visibleCols[visibleCols.length - 1]); else if (e.key !== 'Tab') e.preventDefault(); return; }
    if (e.key === 'Escape') { e.preventDefault(); setSel(null); return; }
    if (readOnly) { if (e.key === 'Enter') { e.preventDefault(); setPeek(cur.r); } return; }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      if (type === 'checkbox') { commitCell(cur.r, cur.c, isTruthy(meta.rows[cur.r][cur.c]) ? '' : 'x'); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { setPeek(cur.r); return; }
      startEdit(cur.r, cur.c, cellEl(cur.r, cur.c, 'table'));
      return;
    }
    if (e.key === ' ') { e.preventDefault(); if (type === 'checkbox') commitCell(cur.r, cur.c, isTruthy(meta.rows[cur.r][cur.c]) ? '' : 'x'); else setPeek(cur.r); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commitCell(cur.r, cur.c, ''); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && editKind(type) === 'inline' && type !== 'progress') {
      e.preventDefault();
      startEdit(cur.r, cur.c, null, { initial: e.key });
    }
  };

  // ── Contexto para las vistas ─────────────────────────────────────────
  const c0 = C();
  // Una tabla Markdown no dice de qué tipo es cada columna: las que no tienen tipo y solo contienen números se muestran
  // como números (alineadas a la derecha). Solo es presentación: no cambia el tipo guardado ni el texto de las celdas.
  const numericCols = headers.map((h, ci) => {
    if (ci === titleIdx) return false;
    const conf = cols[h];
    if (conf && conf.type && conf.type !== 'text') return false;
    const vals = meta.rows.map(r => String(r[ci] == null ? '' : r[ci]).trim()).filter(Boolean);
    return vals.length > 0 && vals.every(v => /^[-+]?(0|[1-9]\d*)([.,]\d+)?$/.test(v));
  });
  const cx = {
    meta, idx, headers, cols, numericCols, directive: d, rows, visibleCols, titleIdx, hiddenSet, readOnly,
    // La columna título sólo se fija a la izquierda si es la primera visible.
    stickyCol: visibleCols[0] === titleIdx ? titleIdx : -1,
    optColors: d.optColors || null, label: t('db.label'),
    hasFilter: filterEntries.length > 0 || !!search,
    members: c0.members || [], noteNames: c0.noteNames || [], onAttach: c0.onAttach || null,
    renderInline: c0.renderInline || null, renderMarkdown: c0.renderMarkdown || null, getNote: c0.getNote || null,
    openNote: (name) => { const c = C(); if (c.openWikilink) c.openWikilink(name); },
    sel, editing, gridRef, gridKeyDown, widthOf, hasWidth,
    // La selección de celda se quita al salir del bloque (no al abrir un popover).
    gridBlur: (e) => {
      const to = e.relatedTarget;
      if (to && (e.currentTarget.contains(to) || (to.closest && to.closest('.db-portal')))) return;
      setTimeout(() => {
        const ae = document.activeElement;
        if (editingRef.current || (ae && ae.closest && (ae.closest('.db-portal') || (rootRef.current && rootRef.current.contains(ae))))) return;
        if (rootRef.current && rootRef.current.isConnected) setSel(null);
      }, 0);
    },
    setLiveWidth: (ci, w) => setLiveW({ ci, w }), commitWidth, moveCol,
    cellClick, startEdit, stopEdit, commitEditing, commitCell,
    openPeek: (r) => { setEditing(null); setPeek(r); },
    rowMenu, openColMenu, openAggMenu, openDateColMenu,
    openAddCol: (el) => setPop({ kind: 'addcol', anchor: rectOf(el) }),
    newRow, moveCard, moveLane, patch, setFilter, setFilterMap, setSort, addColumn, renameOption, deleteOption,
    setOptionColor, removeOption, reorderOption, addOptions: setColOptions,
    openOptionEditor: (name, o, el) => setPop(p => ({ ...p, sub: { name, o, anchor: rectOf(el) } })),
    useDateColumn: (h) => patch({ cal: h }),
    addDateColumn: () => { const name = uniqueName(t('db.type.date'), headers); addColumn(name, 'date'); patch({ cal: name }); },
    calMonth,
    renderList: (more, close, renderEvent) => (
      <Popover anchor={more.anchor} onClose={close} className="db-cal-list" width={260} label={more.key}>
        <div className="db-mi-head">{more.key === 'undated' ? t('db.cal.undatedTitle') : more.key}</div>
        <div className="db-cal-list-body">{more.items.map(renderEvent)}</div>
      </Popover>
    ),
  };
  cx.renderPill = (name, o, type) => <Pill dot={type === 'status'} color={optionColor(d.optColors, name, o)}>{o}</Pill>;

  // Valor vivo de la celda en edición por popover.
  const ed = editing;
  const popEditor = ed && ed.kind === 'popover' && meta.rows[ed.rowIdx] ? {
    anchor: ed.anchor, colName: headers[ed.colIdx], conf: cols[headers[ed.colIdx]] || null,
    value: meta.rows[ed.rowIdx][ed.colIdx] == null ? '' : meta.rows[ed.rowIdx][ed.colIdx],
    commit: (v, extra) => commitCell(ed.rowIdx, ed.colIdx, v, extra),
  } : null;

  let body;
  if (view === 'kanban') body = <BoardView cx={cx} />;
  else if (view === 'calendar') body = <CalendarView cx={cx} />;
  else if (view === 'cards') body = <GalleryView cx={cx} />;
  else if (view === 'list') body = <ListView cx={cx} />;
  else body = <TableView cx={cx} />;

  const sort = d.sort && d.sort.col ? d.sort : null;
  // Ancho: la tabla (y el tablero, el calendario…) tiene el mismo ancho que la
  // columna de la nota —texto, títulos, listas—, con scroll horizontal dentro si
  // hace falta. Solo «Ampliar» la saca de la columna, a todo el panel
  // (ui/db.css, .db-wide, --db-extra).
  const natural = expanded ? 4000 : 0;
  return (
    <div className={`db-block db-surface-${surface || 'render'}${readOnly ? ' db-ro' : ''}${natural ? ' db-wide' : ''}`} ref={rootRef} data-db-idx={idx}
      style={natural ? { '--db-natural': `${natural}px`, '--db-extra': '100vw' } : undefined}>
      <div className="db-bar db-chrome">
        <ViewTabs tabs={tabs} readOnly={readOnly} onSwitch={switchTab} onMenu={tabMenu} onAdd={openAddView}
          onMore={(list, el) => setPop({ kind: 'menu', anchor: rectOf(el), items: list.map(tab => ({ label: tab.name || viewLabel(tab.type), icon: VIEW_ICON[tab.type], onSelect: () => switchTab(tab) })) })} />
        <div className="db-tools">
          {!readOnly && (
            <button type="button" className={`db-tool${rules.length ? ' on' : ''}`} aria-label={t('db.filter.add')} title={t('db.filter.add')} aria-haspopup="dialog"
              onClick={(e) => (rules.length ? openRules(e.currentTarget) : openFilterPick(e.currentTarget))}>
              <DbIcon name="filter" size={14} /><span>{t('db.filter.btn')}</span>
            </button>
          )}
          {!readOnly && (
            <button type="button" className={`db-tool${sort ? ' on' : ''}`} onClick={(e) => (sort ? setPop({ kind: 'sort', anchor: rectOf(e.currentTarget) }) : openSortPick(e.currentTarget))}>
              <DbIcon name="sort" size={14} /><span>{t('db.sort.btn')}</span>
            </button>
          )}
          <button type="button" className={`db-ib${expanded ? ' on' : ''}`} aria-label={expanded ? t('db.collapse') : t('db.expand')} title={expanded ? t('db.collapse') : t('db.expand')}
            aria-pressed={expanded} onClick={toggleExpanded}>
            <DbIcon name="expand" size={15} />
          </button>
          {searchOpen || search ? (
            <span className="db-search">
              <DbIcon name="search" size={14} />
              <input autoFocus value={search} placeholder={t('db.search.ph')} aria-label={t('db.search.label')}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); setSearch(''); setSearchOpen(false); } }}
                onBlur={() => { if (!search) setSearchOpen(false); }} />
              {search ? <button type="button" className="db-ib sm" aria-label={t('db.clear')} onClick={() => { setSearch(''); setSearchOpen(false); }}><DbIcon name="close" size={12} /></button> : null}
            </span>
          ) : (
            <button type="button" className="db-ib" aria-label={t('db.search.label')} title={t('db.search.label')} onClick={() => setSearchOpen(true)}>
              <DbIcon name="search" size={15} />
            </button>
          )}
          <button type="button" className="db-ib" aria-label={t('db.more.label')} title={t('db.more.label')} aria-haspopup="menu" onClick={(e) => moreMenu(e.currentTarget)}>
            <DbIcon name="more" size={15} />
          </button>
          {!readOnly && (
            <button type="button" className="db-new" onClick={() => newRow({ edit: view === 'table', peek: view !== 'table' })}>
              <DbIcon name="plus" size={14} stroke={2.2} /><span>{t('db.row.new')}</span>
            </button>
          )}
        </div>
      </div>
      {(rules.length > 0 || sort) && (
        <div className="db-chips" role="group" aria-label={t('db.filter.title')}>
          {rules.length === 1 && rules.map((r) => {
            const ci = colIndex(r.col);
            const type = (ci >= 0 && cols[headers[ci]] && cols[headers[ci]].type) || 'text';
            return (
              <span key={r.col} className="db-chip" data-rule={r.col} title={chipText(r.col, d.filter[r.col])}>
                <button type="button" className="db-chip-main" disabled={readOnly || ci < 0}
                  onClick={(e) => openRules(e.currentTarget.parentElement, r.col)}>
                  <DbIcon name={TYPE_ICON[type] || 'text'} size={13} />
                  <span className="db-chip-col">{r.col}</span>
                  <span className="db-chip-op">{t('db.op.' + r.op)}</span>
                  {filterOpNeedsValue(r.op) ? <span className="db-chip-val">{valueLabel(r.val, type)}</span> : null}
                </button>
                {!readOnly && (
                  <button type="button" className="db-chip-x" aria-label={t('db.filter.removeOf', { name: r.col })} onClick={() => setFilter(r.col, null)}>
                    <DbIcon name="close" size={11} stroke={2.2} />
                  </button>
                )}
              </span>
            );
          })}
          {rules.length > 1 && (
            <span className="db-chip" data-rule="*">
              <button type="button" className="db-chip-main" disabled={readOnly} onClick={(e) => openRules(e.currentTarget.parentElement)}>
                <DbIcon name="filter" size={13} />
                <span className="db-chip-val">{t('db.filter.rules', { n: rules.length })}</span>
              </button>
              {!readOnly && (
                <button type="button" className="db-chip-x" aria-label={t('db.filter.clearAll')} onClick={() => setFilterMap(null)}>
                  <DbIcon name="close" size={11} stroke={2.2} />
                </button>
              )}
            </span>
          )}
          {sort && (
            <span className="db-chip" data-rule="sort">
              <button type="button" className="db-chip-main" disabled={readOnly} onClick={(e) => setPop({ kind: 'sort', anchor: rectOf(e.currentTarget.parentElement) })}>
                <DbIcon name={sort.dir === 'desc' ? 'sortDesc' : 'sortAsc'} size={13} />
                <span className="db-chip-col">{sort.col}</span>
                <span className="db-chip-op">{t(sort.dir === 'desc' ? 'db.sort.desc' : 'db.sort.asc').toLowerCase()}</span>
              </button>
              {!readOnly && (
                <button type="button" className="db-chip-x" aria-label={t('db.sort.remove')} onClick={() => setSort(null)}>
                  <DbIcon name="close" size={11} stroke={2.2} />
                </button>
              )}
            </span>
          )}
        </div>
      )}
      <div className="db-view">{body}</div>
      {pop && pop.kind === 'menu' && <DbMenu anchor={pop.anchor} items={pop.items} align={pop.align} minWidth={pop.minWidth} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'rules' && <RulesPanel anchor={pop.anchor} cx={cx} onlyCol={pop.onlyCol} fresh={pop.fresh} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'sort' && <SortEditor anchor={pop.anchor} cx={cx} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'addcol' && <AddColumn anchor={pop.anchor} cx={cx} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'options' && <OptionsPanel anchor={pop.anchor} cx={cx} col={pop.col} onClose={() => setPop(null)} />}
      {pop && pop.sub && <OptionEditor anchor={pop.sub.anchor} cx={cx} colName={pop.sub.name} option={pop.sub.o} conf={cols[pop.sub.name] || null} onClose={() => setPop(p => (p ? { ...p, sub: null } : p))} />}
      {popEditor && <CellPopoverEditor editing={popEditor} cx={cx} onClose={() => stopEdit(true)} onTab={(how) => moveFrom(ed, how)} />}
      {peek != null && meta.rows[peek] && (
        <RowPeek cx={cx} rowIdx={peek} onClose={() => { setPeek(null); setEditing(null); }} onNav={(r) => { setEditing(null); setPeek(r); }} />
      )}
    </div>
  );
}
