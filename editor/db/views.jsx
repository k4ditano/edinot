// Vistas de una base de datos: Tabla, Tablero, Calendario, Galería y Lista.
// Todas reciben `cx` (lo arma DatabaseBlock): datos ya filtrados/ordenados,
// columnas visibles y las acciones (editar celda, abrir fila, mover…).

import { useState, useRef, useLayoutEffect, useEffect, useMemo } from 'react';
import { t, getLang } from '../../i18n.js';
import { DbIcon, TYPE_ICON } from './icons.jsx';
import { Pill } from './ui.jsx';
import { CellView, InlineEditor, editKind, rowCover, monthMatrix, weekdayNames, monthTitle } from './cells.jsx';
import {
  computeAgg, splitMulti, optionColor, parseDateCell, isoDay, formatDateLike, pickGroupColumn, pickDateColumn, MULTI_TYPES,
} from './model.js';

const DEFAULT_W = {
  text: 200, number: 110, date: 130, select: 150, status: 150, multiselect: 190, tags: 190,
  person: 160, checkbox: 90, rating: 130, progress: 170, wikilink: 190, archivo: 160,
};
export function defaultWidth(type, isTitle) {
  if (isTitle) return 260;
  return DEFAULT_W[type || 'text'] || 180;
}

// Default widths are a guess: when they add up to more than the space there
// is, the columns nobody has resized shrink (proportionally, down to a floor)
// so a short table fits without a horizontal scrollbar. Resized columns keep
// their width.
const FIT_MIN_W = 96;
function fitWidths(widths, fixed, avail) {
  const total = widths.reduce((a, b) => a + b, 0);
  if (!(avail > 0) || total <= avail) return widths;
  const flex = widths.reduce((a, w, i) => a + (fixed[i] ? 0 : w - FIT_MIN_W), 0);
  if (flex <= 0) return widths;
  const k = Math.min(1, (total - avail) / flex);
  return widths.map((w, i) => (fixed[i] ? w : Math.floor(w - (w - FIT_MIN_W) * k)));
}

const DRAG_ROW = 'application/x-edinot-db-row';
const DRAG_COL = 'application/x-edinot-db-col';
const DRAG_LANE = 'application/x-edinot-db-lane';
function readDrag(e, type) {
  try { const s = e.dataTransfer.getData(type); return s ? JSON.parse(s) : null; } catch { return null; }
}
function hasDrag(e, type) { const ty = e.dataTransfer && e.dataTransfer.types; return !!ty && Array.from(ty).includes(type); }

// Conserva el scroll de un contenedor aunque el bloque se desmonte del DOM y
// se vuelva a montar (el panel Leer reescribe su HTML en cada cambio).
function useScrollKeeper(ref, key) {
  const pos = useRef({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollLeft !== pos.current.left) el.scrollLeft = pos.current.left;
    if (el.scrollTop !== pos.current.top) el.scrollTop = pos.current.top;
  });
  return (e) => { pos.current = { left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }; };
}

function emptyTitle() { return t('db.untitled'); }

// ── Tabla ──────────────────────────────────────────────────────────────
function HeaderCell({ cx, ci, width }) {
  const name = cx.headers[ci] || `Col ${ci + 1}`;
  const conf = cx.cols[name];
  const type = (conf && conf.type) || 'text';
  const sort = cx.directive.sort;
  const sorted = sort && sort.col && sort.col.toLowerCase() === name.toLowerCase() ? sort.dir : null;
  const filtered = cx.directive.filter && Object.keys(cx.directive.filter).some(k => k.toLowerCase() === name.toLowerCase());
  const [drop, setDrop] = useState(null);
  const colors = cx.directive.colors;
  const style = {};
  if (colors && colors.headers && colors.headers[name]) style.background = colors.headers[name];
  if (colors && colors.headersFg && colors.headersFg[name]) style.color = colors.headersFg[name];
  // Los colores de fondo son pasteles claros: texto oscuro también en el tema oscuro.
  else if (style.background) style.color = '#1B1E18';
  const startResize = (e) => {
    if (e.button !== 0 || cx.readOnly) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget;
    const startX = e.clientX;
    try { el.setPointerCapture(e.pointerId); } catch {}
    let w = width;
    const move = (ev) => { w = Math.max(60, Math.min(1200, Math.round(width + ev.clientX - startX))); cx.setLiveWidth(ci, w); };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      cx.commitWidth(ci, w);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  return (
    <div role="columnheader" className={`db-th${drop ? ' drop-' + drop : ''}${ci === cx.stickyCol ? ' db-col-sticky' : ''}`} style={style}
      draggable={!cx.readOnly}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_COL, JSON.stringify({ t: cx.idx, ci })); }}
      onDragOver={(e) => { if (!hasDrag(e, DRAG_COL)) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop(e.clientX - r.left < r.width / 2 ? 'before' : 'after'); }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const d = readDrag(e, DRAG_COL); const side = drop; setDrop(null);
        if (!d || d.t !== cx.idx || d.ci === ci) return;
        e.preventDefault();
        let to = ci + (side === 'after' ? 1 : 0);
        if (d.ci < to) to -= 1;
        if (to !== d.ci) cx.moveCol(d.ci, to);
      }}>
      <button type="button" className="db-th-btn" onClick={(e) => cx.openColMenu(ci, e.currentTarget.parentElement)}
        aria-label={t('db.col.menuFor', { name })} aria-haspopup="menu">
        <DbIcon name={TYPE_ICON[type] || 'text'} size={13} />
        <span className="db-th-name">{name}</span>
        {sorted ? <DbIcon name={sorted === 'asc' ? 'sortAsc' : 'sortDesc'} size={12} className="db-th-flag" /> : null}
        {filtered ? <DbIcon name="filter" size={11} className="db-th-flag" /> : null}
      </button>
      {!cx.readOnly && <span className="db-resize" onPointerDown={startResize} onClick={(e) => e.stopPropagation()} aria-hidden="true" />}
    </div>
  );
}

function DataCell({ cx, r, ci, row }) {
  const name = cx.headers[ci] || `Col ${ci + 1}`;
  const conf = cx.cols[name] || null;
  const declared = (conf && conf.type) || 'text';
  const type = declared === 'text' && cx.numericCols && cx.numericCols[ci] ? 'number' : declared;
  const raw = row[ci] == null ? '' : row[ci];
  const isSel = cx.sel && cx.sel.r === r && cx.sel.c === ci;
  const ed = cx.editing;
  const isEditing = ed && ed.surface === 'table' && ed.rowIdx === r && ed.colIdx === ci;
  const isTitle = ci === cx.titleIdx;
  const colors = cx.directive.colors;
  const style = {};
  if (colors) {
    const bg = (colors.cells && colors.cells[`${r},${ci}`]) || (colors.cols && colors.cols[name]);
    const fg = (colors.cellsFg && colors.cellsFg[`${r},${ci}`]) || (colors.colsFg && colors.colsFg[name]);
    if (bg) style.background = bg;
    if (fg) style.color = fg;
    else if (bg) style.color = '#1B1E18';
  }
  return (
    <div role="gridcell" className={`db-td t-${type}${isSel ? ' sel' : ''}${isEditing ? ' editing' : ''}${isTitle ? ' db-col-title' : ''}${ci === cx.stickyCol ? ' db-col-sticky' : ''}`}
      data-db-cell={`${r}:${ci}`} style={style} aria-selected={isSel || undefined}
      onClick={(e) => cx.cellClick(r, ci, e.currentTarget, e)}>
      {isTitle && !isEditing ? <DbIcon name="note" size={15} stroke={1.7} className="db-title-ic" /> : null}
      {isEditing && ed.kind === 'inline'
        ? <InlineEditor initial={ed.initial != null ? ed.initial : raw} type={type} onCommit={(v, how) => cx.commitEditing(v, how, ed)} onCancel={() => cx.stopEdit(true)} />
        : <CellView raw={raw} conf={conf} colName={name} cx={cx} editable={!cx.readOnly}
            onCommit={(v) => cx.commitCell(r, ci, v)} />}
      {isTitle && !isEditing && (
        <span className="db-row-acts">
          <button type="button" className="db-row-open" onClick={(e) => { e.stopPropagation(); cx.openPeek(r); }} aria-label={t('db.row.open')}>
            <DbIcon name="peek" size={13} />{t('db.row.openShort')}
          </button>
          {!cx.readOnly && (
            <button type="button" className="db-ib sm" aria-label={t('db.row.menu')} onClick={(e) => { e.stopPropagation(); cx.rowMenu(r, e.currentTarget); }}>
              <DbIcon name="more" size={14} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function AggCell({ cx, ci, rows }) {
  const name = cx.headers[ci] || `Col ${ci + 1}`;
  const conf = cx.cols[name] || null;
  const fn = cx.directive.agg && cx.directive.agg[name];
  let body;
  if (fn) {
    const val = computeAgg(fn, rows.map(x => x.row[ci]), conf);
    body = <><span className="db-agg-label">{t('db.agg.' + fn)}</span><span className="db-agg-val">{val}</span></>;
  } else if (ci === cx.titleIdx) {
    body = <span className="db-agg-count">{rows.length === 1 ? t('db.rows.one') : t('db.rows.other', { n: rows.length })}</span>;
  } else {
    body = <span className="db-agg-add">{t('db.agg.calc')}<DbIcon name="chevDown" size={11} /></span>;
  }
  return (
    <div className={`db-tf${fn ? ' has' : ''}${ci === cx.stickyCol ? ' db-col-sticky' : ''}`}>
      {cx.readOnly ? body : (
        <button type="button" className="db-tf-btn" onClick={(e) => cx.openAggMenu(ci, e.currentTarget)} aria-label={t('db.agg.for', { name })}>{body}</button>
      )}
    </div>
  );
}

export function TableView({ cx }) {
  const scrollRef = useRef(null);
  const onScroll = useScrollKeeper(scrollRef);
  const cols = cx.visibleCols;
  const [availW, setAvailW] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setAvailW(el.clientWidth));
    ro.observe(el);
    setAvailW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const widths = fitWidths(cols.map(ci => cx.widthOf(ci)), cols.map(ci => !!(cx.hasWidth && cx.hasWidth(ci))), availW - 44);
  const template = widths.map(w => `${w}px`).join(' ') + ' minmax(44px, 1fr)';
  const total = widths.reduce((a, b) => a + b, 0) + 44;
  const rows = cx.rows;
  return (
    <div className="db-grid-wrap" ref={scrollRef} onScroll={onScroll}>
      <div className="db-grid" role="grid" aria-label={cx.label} aria-rowcount={rows.length + 1}
        style={{ minWidth: total, '--db-cols': template }}
        tabIndex={0} ref={cx.gridRef} onKeyDown={cx.gridKeyDown} onBlur={cx.gridBlur}>
        <div className="db-row db-head-row" role="row">
          {cols.map((ci, k) => <HeaderCell key={ci} cx={cx} ci={ci} width={widths[k]} />)}
          <div className="db-th db-th-add" role="columnheader">
            {!cx.readOnly && (
              <button type="button" className="db-ib" aria-label={t('db.col.add')} title={t('db.col.add')} onClick={(e) => cx.openAddCol(e.currentTarget)}>
                <DbIcon name="plus" size={14} />
              </button>
            )}
          </div>
        </div>
        {rows.map(({ row, idx: r }) => (
          <div className="db-row" role="row" key={r} data-db-row={r}
            onContextMenu={cx.readOnly ? undefined : (e) => { e.preventDefault(); cx.rowMenu(r, { x: e.clientX, y: e.clientY }); }}>
            {cols.map(ci => <DataCell key={ci} cx={cx} r={r} ci={ci} row={row} />)}
            <div className="db-td db-td-end" role="presentation" />
          </div>
        ))}
        {!rows.length && (
          <div className="db-line"><div className="db-empty-row">{cx.hasFilter ? t('db.empty.filtered') : t('db.empty.rows')}</div></div>
        )}
        {!cx.readOnly && (
          <div className="db-line">
            <button type="button" className="db-newrow" onClick={() => cx.newRow({ edit: true })}>
              <DbIcon name="plus" size={14} stroke={2} />{t('db.row.new')}
            </button>
          </div>
        )}
        <div className="db-row db-foot-row" role="row">
          {cols.map(ci => <AggCell key={ci} cx={cx} ci={ci} rows={rows} />)}
          <div className="db-tf" />
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta (tablero, galería) ─────────────────────────────────────────
function cardProps(cx, row, skip) {
  const out = [];
  for (const ci of cx.visibleCols) {
    if (ci === cx.titleIdx || (skip && skip.has(ci))) continue;
    const v = String(row[ci] || '').trim();
    const conf = cx.cols[cx.headers[ci]];
    if (!v && !(conf && conf.type === 'checkbox')) continue;
    if (!v) continue;
    out.push(ci);
    if (out.length >= 5) break;
  }
  return out;
}
function CardBody({ cx, row, r, skip, cover }) {
  const titleName = cx.headers[cx.titleIdx];
  const titleRaw = String(row[cx.titleIdx] || '').trim();
  const props = cardProps(cx, row, skip);
  return (
    <>
      {cover ? <div className="db-card-cover"><img src={cover} alt="" loading="lazy" /></div> : null}
      <div className="db-card-title">
        {titleRaw ? <CellView raw={titleRaw} conf={cx.cols[titleName]} colName={titleName} cx={cx} /> : <span className="db-faint">{emptyTitle()}</span>}
      </div>
      {props.length > 0 && (
        <div className="db-card-props">
          {props.map(ci => {
            const name = cx.headers[ci];
            const conf = cx.cols[name] || null;
            const type = conf && conf.type;
            const isText = !type || type === 'text' || type === 'number';
            return (
              <div key={ci} className={`db-card-prop${isText ? ' text' : ''}`} title={name}>
                {isText ? <span className="db-card-key">{name}</span> : null}
                <CellView raw={row[ci]} conf={conf} colName={name} cx={cx} compact
                  editable={!cx.readOnly && (type === 'checkbox')} onCommit={(v) => cx.commitCell(r, ci, v)} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Tablero ────────────────────────────────────────────────────────────
function lanesFor(cx, gi) {
  const name = cx.headers[gi];
  const conf = cx.cols[name] || null;
  const multi = conf && MULTI_TYPES.has(conf.type);
  const values = [];
  const seen = new Set();
  const add = (v) => { const s = String(v || '').trim(); if (!s) return; const k = s.toLowerCase(); if (seen.has(k)) return; seen.add(k); values.push(s); };
  (cx.directive.order || []).forEach(add);
  ((conf && conf.options) || []).forEach(add);
  for (const r of cx.meta.rows) (multi ? splitMulti(r[gi]) : [r[gi]]).forEach(add);
  const lanes = [{ value: '', items: [] }, ...values.map(v => ({ value: v, items: [] }))];
  const byKey = new Map(lanes.map(l => [l.value.toLowerCase(), l]));
  for (const it of cx.rows) {
    const raw = String(it.row[gi] || '').trim();
    const keys = multi ? splitMulti(raw) : [raw];
    if (!keys.length) keys.push('');
    for (const k of keys) { const l = byKey.get(k.toLowerCase()); if (l) l.items.push(it); }
  }
  // La calle «sin valor» sólo si tiene algo o no hay más calles.
  return lanes.filter(l => l.value || l.items.length || lanes.length === 1);
}

export function BoardView({ cx }) {
  const gname = pickGroupColumn(cx.meta);
  const gi = gname ? cx.headers.indexOf(gname) : -1;
  const scrollRef = useRef(null);
  const onScroll = useScrollKeeper(scrollRef);
  const [drop, setDrop] = useState(null); // { lane, before }
  const [laneDrop, setLaneDrop] = useState(null);
  if (gi < 0) {
    return (
      <div className="db-pickcol">
        <DbIcon name="board" size={18} />
        <p>{t('db.board.pick')}</p>
        <div className="db-pickcol-list">
          {cx.headers.map((h, i) => (
            <button key={i} type="button" className="db-btn-quiet" disabled={cx.readOnly} onClick={() => cx.patch({ view: 'kanban', by: h })}>
              <DbIcon name={TYPE_ICON[(cx.cols[h] && cx.cols[h].type) || 'text']} size={13} />{h}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const conf = cx.cols[gname] || null;
  const isStatus = conf && conf.type === 'status';
  const lanes = lanesFor(cx, gi);
  const noSort = !(cx.directive.sort && cx.directive.sort.col);
  const onCardDrop = (e, lane) => {
    const d = readDrag(e, DRAG_ROW);
    const target = drop;
    setDrop(null);
    if (!d || d.t !== cx.idx) return;
    e.preventDefault();
    let before = target && target.lane === lane.value ? target.before : null;
    // «Al final de la calle» = justo detrás de su última tarjeta (en el markdown).
    if (before === 'end') {
      const last = lane.items.filter(it => it.idx !== d.r).map(it => it.idx);
      before = last.length ? Math.max(...last) + 1 : null;
    }
    cx.moveCard(d.r, gi, lane.value, noSort ? before : null, d.from);
  };
  return (
    <div className="db-board-wrap" ref={scrollRef} onScroll={onScroll}>
      <div className="db-board" role="list" aria-label={t('db.board.label', { col: gname })}>
        {lanes.map((lane) => {
          const label = lane.value || t('db.board.noValue', { col: gname });
          return (
            <section key={lane.value || '∅'} className={`db-lane${laneDrop === lane.value ? ' lane-drop' : ''}`} role="listitem" aria-label={label}
              onDragOver={(e) => {
                if (hasDrag(e, DRAG_LANE) && lane.value) { e.preventDefault(); setLaneDrop(lane.value); return; }
                if (!hasDrag(e, DRAG_ROW)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const card = e.target.closest && e.target.closest('[data-db-card]');
                let before = null;
                if (card) {
                  const rr = card.getBoundingClientRect();
                  const ri = Number(card.getAttribute('data-db-card'));
                  if (e.clientY < rr.top + rr.height / 2) before = ri;
                  else { const next = card.nextElementSibling && card.nextElementSibling.getAttribute('data-db-card'); before = next != null ? Number(next) : 'end'; }
                } else if (e.target.closest && e.target.closest('.db-lane-body')) before = 'end';
                if (!drop || drop.lane !== lane.value || drop.before !== before) setDrop({ lane: lane.value, before });
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setDrop(d => (d && d.lane === lane.value ? null : d)); setLaneDrop(null); } }}
              onDrop={(e) => {
                if (hasDrag(e, DRAG_LANE)) {
                  setLaneDrop(null);
                  const d = readDrag(e, DRAG_LANE);
                  if (d && d.t === cx.idx && lane.value && d.v !== lane.value) { e.preventDefault(); cx.moveLane(gi, d.v, lane.value, lanes.map(l => l.value).filter(Boolean)); }
                  return;
                }
                onCardDrop(e, lane);
              }}>
              <header className="db-lane-head" draggable={!cx.readOnly && !!lane.value}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_LANE, JSON.stringify({ t: cx.idx, v: lane.value })); }}>
                {lane.value
                  ? <Pill dot={isStatus} color={optionColor(cx.optColors, gname, lane.value)}>{lane.value}</Pill>
                  : <span className="db-lane-none">{label}</span>}
                <span className="db-lane-count" aria-label={t('db.board.count', { n: lane.items.length })}>{lane.items.length}</span>
                {!cx.readOnly && (
                  <button type="button" className="db-ib sm db-lane-plus" aria-label={t('db.board.addIn', { name: label })}
                    onClick={() => cx.newRow({ init: { [gi]: lane.value }, peek: true })}>
                    <DbIcon name="plus" size={14} />
                  </button>
                )}
              </header>
              <div className="db-lane-body">
                {lane.items.map(({ row, idx: r }) => (
                  <article key={r} className={`db-card${drop && drop.lane === lane.value && drop.before === r ? ' drop-before' : ''}`}
                    data-db-card={r} draggable={!cx.readOnly} tabIndex={0}
                    aria-label={String(row[cx.titleIdx] || emptyTitle())}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_ROW, JSON.stringify({ t: cx.idx, r, from: lane.value })); e.currentTarget.classList.add('dragging'); }}
                    onDragEnd={(e) => { e.currentTarget.classList.remove('dragging'); setDrop(null); }}
                    onClick={() => cx.openPeek(r)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); cx.openPeek(r); } }}>
                    <CardBody cx={cx} row={row} r={r} skip={new Set([gi])} />
                  </article>
                ))}
                {drop && drop.lane === lane.value && drop.before === 'end' ? <div className="db-drop-line" /> : null}
                {!cx.readOnly && (
                  <button type="button" className="db-lane-add" onClick={() => cx.newRow({ init: { [gi]: lane.value }, peek: true })}>
                    <DbIcon name="plus" size={13} stroke={2} />{t('db.new')}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── Calendario ─────────────────────────────────────────────────────────
export function CalendarView({ cx }) {
  const lang = getLang();
  const dname = pickDateColumn(cx.meta);
  const di = dname ? cx.headers.indexOf(dname) : -1;
  const now = new Date();
  const [ym, setYm] = cx.calMonth;
  const [overDay, setOverDay] = useState(null);
  const [more, setMore] = useState(null);
  const statusCol = useMemo(() => cx.headers.find(h => cx.cols[h] && cx.cols[h].type === 'status') || null, [cx.headers, cx.cols]);
  if (di < 0) {
    return (
      <div className="db-pickcol">
        <DbIcon name="calendar" size={18} />
        <p>{t('db.cal.pick')}</p>
        <div className="db-pickcol-list">
          {cx.headers.map((h, i) => (
            <button key={i} type="button" className="db-btn-quiet" disabled={cx.readOnly} onClick={() => cx.useDateColumn(h)}>
              <DbIcon name={TYPE_ICON[(cx.cols[h] && cx.cols[h].type) || 'text']} size={13} />{h}
            </button>
          ))}
          {!cx.readOnly && (
            <button type="button" className="db-btn-quiet" onClick={() => cx.addDateColumn()}>
              <DbIcon name="plus" size={13} />{t('db.cal.addCol')}
            </button>
          )}
        </div>
      </div>
    );
  }
  const byDay = new Map();
  const undated = [];
  for (const it of cx.rows) {
    const p = parseDateCell(it.row[di]);
    if (!p) { undated.push(it); continue; }
    const k = isoDay(p.y, p.m, p.d);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(it);
  }
  // Sólo las semanas que tocan el mes (5 casi siempre, 6 si hace falta).
  const cells = (() => { const all = monthMatrix(ym.y, ym.m); return all[35].inMonth ? all : all.slice(0, 35); })();
  const todayKey = isoDay(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (n) => { const d = new Date(ym.y, ym.m + n, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }); };
  const MAX = 3;
  const evtColor = (row) => (statusCol ? optionColor(cx.optColors, statusCol, row[cx.headers.indexOf(statusCol)]) : null);
  const renderEvent = ({ row, idx: r }) => {
    const c = evtColor(row);
    const p = parseDateCell(row[di]);
    return (
      <button key={r} type="button" className={`db-evt${c ? ' db-c-' + c : ''}`} draggable={!cx.readOnly} data-db-evt={r}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_ROW, JSON.stringify({ t: cx.idx, r })); }}
        onClick={(e) => { e.stopPropagation(); setMore(null); cx.openPeek(r); }}
        title={String(row[cx.titleIdx] || '')}>
        {p && p.time ? <span className="db-evt-time">{p.time}</span> : null}
        <span className="db-evt-title">{String(row[cx.titleIdx] || '').replace(/[*_`[\]]/g, '') || emptyTitle()}</span>
      </button>
    );
  };
  return (
    <div className="db-cal">
      <div className="db-cal-bar">
        <span className="db-cal-title">{monthTitle(ym.y, ym.m, lang)}</span>
        <button type="button" className="db-ib" aria-label={t('db.cal.prev')} onClick={() => shift(-1)}><DbIcon name="chevLeft" size={15} /></button>
        <button type="button" className="db-btn-quiet" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>{t('db.cal.today')}</button>
        <button type="button" className="db-ib" aria-label={t('db.cal.next')} onClick={() => shift(1)}><DbIcon name="chevRight" size={15} /></button>
        <span className="db-cal-spacer" />
        {undated.length > 0 && (
          <button type="button" className="db-btn-quiet" onClick={(e) => setMore({ key: 'undated', items: undated, anchor: e.currentTarget.getBoundingClientRect() })}>
            {t('db.cal.undated', { n: undated.length })}
          </button>
        )}
        <button type="button" className="db-btn-quiet" onClick={(e) => cx.openDateColMenu(e.currentTarget)}>
          <DbIcon name="date" size={13} />{dname}<DbIcon name="chevDown" size={11} />
        </button>
      </div>
      <div className="db-cal-grid" role="grid" aria-label={monthTitle(ym.y, ym.m, lang)}>
        {weekdayNames(lang).map((w, i) => <div key={'w' + i} className="db-cal-wd" role="columnheader">{w}</div>)}
        {cells.map((c) => {
          const k = isoDay(c.y, c.m, c.d);
          const items = byDay.get(k) || [];
          return (
            <div key={k} role="gridcell" aria-label={k}
              className={`db-cal-day${c.inMonth ? '' : ' out'}${k === todayKey ? ' today' : ''}${overDay === k ? ' drop' : ''}`}
              data-db-day={k}
              onDragOver={(e) => { if (!hasDrag(e, DRAG_ROW)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overDay !== k) setOverDay(k); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverDay(o => (o === k ? null : o)); }}
              onDrop={(e) => {
                setOverDay(null);
                const d = readDrag(e, DRAG_ROW);
                if (!d || d.t !== cx.idx) return;
                e.preventDefault();
                setMore(null);
                const cur = cx.meta.rows[d.r] ? cx.meta.rows[d.r][di] : '';
                cx.commitCell(d.r, di, formatDateLike(cur, c.y, c.m, c.d));
              }}
              onDoubleClick={() => { if (!cx.readOnly) cx.newRow({ init: { [di]: k }, peek: true }); }}>
              <div className="db-cal-dayhead">
                <span className="db-cal-num">{c.d}</span>
                {!cx.readOnly && (
                  <button type="button" className="db-ib sm db-cal-add" aria-label={t('db.cal.addOn', { date: k })}
                    onClick={() => cx.newRow({ init: { [di]: k }, peek: true })}>
                    <DbIcon name="plus" size={13} />
                  </button>
                )}
              </div>
              <div className="db-cal-evts">
                {items.slice(0, items.length > MAX + 1 ? MAX : MAX + 1).map(renderEvent)}
                {items.length > MAX + 1 && (
                  <button type="button" className="db-cal-more" onClick={(e) => setMore({ key: k, items, anchor: e.currentTarget.getBoundingClientRect() })}>
                    {t('db.cal.more', { n: items.length - MAX })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {more && cx.renderList(more, () => setMore(null), renderEvent)}
    </div>
  );
}

// ── Galería ────────────────────────────────────────────────────────────
export function GalleryView({ cx }) {
  return (
    <div className="db-gallery" role="list">
      {cx.rows.map(({ row, idx: r }) => (
        <article key={r} role="listitem" className="db-card db-gcard" tabIndex={0}
          aria-label={String(row[cx.titleIdx] || emptyTitle())}
          onClick={() => cx.openPeek(r)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); cx.openPeek(r); } }}>
          <CardBody cx={cx} row={row} r={r} cover={rowCover(row, cx.headers, cx.cols)} />
        </article>
      ))}
      {!cx.readOnly && (
        <button type="button" className="db-gcard-new" onClick={() => cx.newRow({ peek: true })}>
          <DbIcon name="plus" size={16} stroke={2} />{t('db.new')}
        </button>
      )}
      {!cx.rows.length && cx.readOnly && <div className="db-empty-row">{t('db.empty.rows')}</div>}
    </div>
  );
}

// ── Lista ──────────────────────────────────────────────────────────────
export function ListView({ cx }) {
  return (
    <div className="db-list" role="list">
      {cx.rows.map(({ row, idx: r }) => {
        const props = cardProps(cx, row);
        const titleName = cx.headers[cx.titleIdx];
        return (
          <div key={r} role="listitem" className="db-list-row" tabIndex={0}
            onClick={() => cx.openPeek(r)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); cx.openPeek(r); } }}>
            <DbIcon name="note" size={15} stroke={1.7} className="db-title-ic" />
            <span className="db-list-title">
              {String(row[cx.titleIdx] || '').trim()
                ? <CellView raw={row[cx.titleIdx]} conf={cx.cols[titleName]} colName={titleName} cx={cx} />
                : <span className="db-faint">{emptyTitle()}</span>}
            </span>
            <span className="db-list-props">
              {props.map(ci => (
                <span key={ci} className="db-list-prop" title={cx.headers[ci]}>
                  <CellView raw={row[ci]} conf={cx.cols[cx.headers[ci]] || null} colName={cx.headers[ci]} cx={cx} compact />
                </span>
              ))}
            </span>
          </div>
        );
      })}
      {!cx.rows.length && <div className="db-empty-row">{cx.hasFilter ? t('db.empty.filtered') : t('db.empty.rows')}</div>}
      {!cx.readOnly && (
        <button type="button" className="db-newrow" onClick={() => cx.newRow({ peek: true })}>
          <DbIcon name="plus" size={14} stroke={2} />{t('db.row.new')}
        </button>
      )}
    </div>
  );
}

export { editKind };
