// Panel de diseño del canvas (estilo Figma), a la derecha: «Diseño» edita con números lo seleccionado
// (posición, tamaño, giro, colores, grosor, opacidad, texto) y «Capas» lista todo en su orden de apilado,
// con ocultar, bloquear y seleccionar. Se abre y se cierra desde las acciones de arriba a la derecha.

import { useState } from 'react';
import { t, useI18n } from '../../i18n.js';
import { mergedOrder } from './zorder.js';
import { FONT_KEYS, FONT_STACKS, weightOf, labelTextStyle } from '../../shared/text-style.js';
import { resolveVars, newVarId, textStyleFrom } from '../../shared/canvas-vars.js';
import { listComponents, insertInstance } from './components.js';
import { ENTER_TYPES, HOVER_TYPES, LOOP_TYPES, LINK_ANIMS, playEnter } from './motion.js';

const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : '');

function Num({ label, value, onChange, step = 1, min, max, suffix }) {
  const [draft, setDraft] = useState(null);
  const shown = draft != null ? draft : r1(value);
  const commit = () => { if (draft == null) return; const v = parseFloat(draft); setDraft(null); if (Number.isFinite(v)) onChange(min != null ? Math.max(min, max != null ? Math.min(max, v) : v) : v); };
  return (
    <label className="cvp-num">
      <span>{label}</span>
      <input type="number" step={step} value={shown} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }} />
      {suffix && <em>{suffix}</em>}
    </label>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;
function Color({ label, value, onChange, allowNone, vars, linked, onLink }) {
  const none = !value || value === 'none';
  const colors = (vars && vars.colors) || [];
  const linkName = linked ? (colors.find(c => c.id === linked) || {}).name : null;
  return (
    <div className="cvp-color">
      <span>{label}</span>
      {onLink && colors.length > 0 && (
        <label className={`cvp-var${linked ? ' on' : ''}`} title={t('cvp.var.link')}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6z" fill={linked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" /></svg>
          <select value={linked || ''} onChange={(e) => onLink(e.target.value || null)} aria-label={t('cvp.var.link')}>
            <option value="">{t('cvp.var.none')}</option>
            {colors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {linkName ? <span className="cvp-varname" style={{ '--sw': value }}>{linkName}</span> : <>
      <label className={`cvp-swatch${none ? ' none' : ''}`} style={none ? null : { background: value }}>
        <input type="color" value={HEX.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      </label>
      <input className="cvp-hex" value={none ? '' : value} placeholder={allowNone ? t('cvp.none') : ''} spellCheck={false}
        onChange={(e) => { const v = e.target.value.trim(); if (!v && allowNone) onChange('none'); else if (/^#[0-9a-f]{3,8}$/i.test(v) || /^[a-z]+$/i.test(v)) onChange(v); }}
        onKeyDown={(e) => e.stopPropagation()} />
      {allowNone && !none && <button type="button" className="cvp-x" title={t('cvp.none')} onClick={() => onChange('none')}>×</button>}
      </>}
    </div>
  );
}

// Texto (etiquetas): como el panel «Texto» de Figma.
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];
function TextProps({ n, patch }) {
  const w = weightOf(n) ?? (n.plain ? 400 : 600);
  const tog = (k) => patch({ [k]: n[k] ? undefined : true });
  const custom = n.font && !FONT_KEYS.includes(n.font);
  return (
    <>
      <label className="cvp-row"><span>{t('cvp.font')}</span>
        <select value={custom ? '__custom' : (n.font || 'sans')} onChange={(e) => patch({ font: e.target.value === '__custom' ? (n.font || 'Inter') : e.target.value })}>
          {FONT_KEYS.map(k => <option key={k} value={k} style={{ fontFamily: FONT_STACKS[k] }}>{t('cvp.font.' + k)}</option>)}
          {custom && <option value="__custom">{n.font}</option>}
        </select>
      </label>
      <div className="cvp-grid">
        <Num label={t('cvp.size')} value={n.fontSize || 20} min={6} max={400} onChange={(v) => patch({ fontSize: v })} />
        <label className="cvp-num"><span>{t('cvp.weight.t')}</span>
          <select value={w} onChange={(e) => patch({ weight: Number(e.target.value), bold: undefined })}>
            {WEIGHTS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <Num label={t('cvp.lh')} value={n.lineHeight || 1.25} step={0.05} min={0.5} max={4} onChange={(v) => patch({ lineHeight: v })} />
        <Num label={t('cvp.ls')} value={n.letterSpacing || 0} step={0.1} min={-10} max={50} suffix="px" onChange={(v) => patch({ letterSpacing: v || undefined })} />
      </div>
      <div className="cvp-seg" role="group" aria-label={t('cvp.style')}>
        <button type="button" className={n.italic ? 'on' : ''} title={t('cvp.italic')} onClick={() => tog('italic')}><i>I</i></button>
        <button type="button" className={n.underline ? 'on' : ''} title={t('cvp.underline')} onClick={() => tog('underline')}><u>U</u></button>
        <button type="button" className={n.strike ? 'on' : ''} title={t('cvp.strike')} onClick={() => tog('strike')}><s>S</s></button>
        <span className="cvp-segsep" />
        {['left', 'center', 'right', 'justify'].map(al => (
          <button key={al} type="button" className={(n.align || 'left') === al ? 'on' : ''} title={t('cvp.align.' + al)} onClick={() => patch({ align: al === 'left' ? undefined : al })}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {al === 'left' && <path d="M2 3h10M2 6h6M2 9h10M2 12h6" />}
              {al === 'center' && <path d="M2 3h10M4 6h6M2 9h10M4 12h6" />}
              {al === 'right' && <path d="M2 3h10M6 6h6M2 9h10M6 12h6" />}
              {al === 'justify' && <path d="M2 3h10M2 6h10M2 9h10M2 12h10" />}
            </svg>
          </button>
        ))}
      </div>
      <div className="cvp-seg" role="group">
        {[['', 'Aa'], ['upper', 'AA'], ['lower', 'aa'], ['title', 'Ab']].map(([k, lab]) => (
          <button key={k || 'none'} type="button" className={(n.transform || '') === k ? 'on' : ''} title={t('cvp.case.' + (k || 'none'))} onClick={() => patch({ transform: k || undefined })}>{lab}</button>
        ))}
        <span className="cvp-segsep" />
        <button type="button" className={n.wrap ? 'on wide' : 'wide'} title={t('cvp.wrap.h')} onClick={() => patch({ wrap: n.wrap ? undefined : true, noWrap: n.wrap ? true : undefined })}>{t('cvp.wrap')}</button>
        <button type="button" className={n.rich ? 'on wide' : 'wide'} title={t('cvp.rich.h')} onClick={() => patch({ rich: n.rich ? undefined : true })}>{t('cvp.rich')}</button>
      </div>
    </>
  );
}

// Animación (entrada, al pasar el ratón, bucle) y transición del enlace del prototipo.
function AnimProps({ item, kind, patch }) {
  const an = item.anim || {};
  const set = (k, v) => patch(x => { const a = { ...(x.anim || {}) }; if (v == null || v === '') delete a[k]; else a[k] = v; const r = { ...x }; if (Object.keys(a).length) r.anim = a; else delete r.anim; return r; });
  const preview = () => {
    const el = document.querySelector(kind === 'n' ? `[data-node-id="${item.id}"]` : `[data-annotation-id="${item.id}"]`);
    if (an.enter) playEnter(el, an);
  };
  const Sel = ({ label, k, opts, prefix }) => (
    <label className="cvp-row"><span>{label}</span>
      <select value={an[k] || ''} onChange={(e) => set(k, e.target.value || null)}>
        <option value="">—</option>
        {opts.map(o => <option key={o} value={o}>{t(prefix + o)}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <div className="cvp-h">{t('cvp.anim')}</div>
      <Sel label={t('cvp.anim.enter')} k="enter" opts={ENTER_TYPES} prefix="cvp.anim.e." />
      {an.enter && (
        <div className="cvp-grid">
          <Num label="ms" value={an.dur || 450} min={60} max={5000} step={50} onChange={(v) => set('dur', v)} />
          <Num label={t('cvp.anim.delay')} value={an.delay || 0} min={0} max={10000} step={50} onChange={(v) => set('delay', v || null)} />
        </div>
      )}
      <Sel label={t('cvp.anim.hover')} k="hover" opts={HOVER_TYPES} prefix="cvp.anim.h." />
      <Sel label={t('cvp.anim.loop')} k="loop" opts={LOOP_TYPES} prefix="cvp.anim.l." />
      {item.link && (
        <label className="cvp-row"><span>{t('cvp.anim.mode')}</span>
          <select value={item.linkMode || 'screen'} onChange={(e) => patch(x => { const r = { ...x }; if (e.target.value === 'overlay') r.linkMode = 'overlay'; else delete r.linkMode; return r; })}>
            <option value="screen">{t('cvp.anim.mode.screen')}</option><option value="overlay">{t('cvp.anim.mode.overlay')}</option>
          </select>
        </label>
      )}
      {item.link && (
        <label className="cvp-row"><span>{t('cvp.anim.link')}</span>
          <select value={item.linkAnim || 'move'} onChange={(e) => patch(x => ({ ...x, linkAnim: e.target.value }))}>
            {LINK_ANIMS.map(o => <option key={o} value={o}>{t('cvp.anim.t.' + o)}</option>)}
          </select>
        </label>
      )}
      {an.enter && <button type="button" className="cvp-add" onClick={preview}>▶ {t('cvp.anim.try')}</button>}
      <p className="cvp-empty">{t('cvp.anim.hint')}</p>
    </>
  );
}

const nameOf = (it, el) => {
  if (!el) return '?';
  const pre = el.cmain ? '◆ ' + (el.cname || '') + ' · ' : el.cinst ? '◇ ' : '';
  return pre + nameOf0(it, el);
};
const nameOf0 = (it, el) => {
  const txt = String(el.text || el.title || el.label || el.name || el.noteName || '').split('\n')[0].trim();
  if (it.type === 'n') {
    const k = el.kind === 'shape' ? t('cvp.k.shape') : el.kind === 'label' ? t('cvp.k.label') : el.sticky ? t('cvp.k.sticky') : el.kind === 'page' ? t('cvp.k.page') : el.kind === 'image' ? t('cvp.k.image') : el.kind === 'note' ? t('cvp.k.note') : t('cvp.k.card');
    return txt ? `${k} · ${txt.slice(0, 28)}` : k;
  }
  const k = el.kind === 'path' ? (el.variant ? t('cvp.k.ink') : t('cvp.k.vector')) : el.shape === 'line' || el.shape === 'arrow' ? t('cvp.k.line') : t('cvp.k.drawn');
  return txt ? `${k} · ${txt.slice(0, 28)}` : k;
};

export function CanvasPropsPanel({ json, selected, selAnno, onChange, select, onClose, uploadImage, library = [], onInsertLib, onRemoveLib }) {
  useI18n();
  const [tab, setTab] = useState('design');
  const nodes = json.nodes || [], annos = json.annotations || [];
  const vars = json.vars || {};
  const selN = nodes.filter(n => selected.has(n.id)).map(n => resolveVars(n, json.vars));
  const selA = annos.filter(a => selAnno.has(a.id)).map(a => resolveVars(a, json.vars));
  const setVars = (fn) => onChange(j => ({ ...j, vars: fn({ colors: [], texts: [], ...(j.vars || {}) }) }));
  const linkKey = (key, v) => (x) => { const r = { ...x }; if (v) r[key] = v; else delete r[key]; return r; };
  const unlink = (...keys) => (x) => { const r = { ...x }; for (const k of keys) delete r[k]; return r; };
  const patchNode = (id, p) => onChange(j => ({ ...j, nodes: (j.nodes || []).map(n => {
    if (n.id !== id) return n;
    const next = { ...n, ...p };
    for (const k of Object.keys(p)) if (p[k] === undefined) delete next[k];   // undefined = quitar la propiedad
    return next;
  }) }));
  const patchAnno = (id, fn) => onChange(j => ({ ...j, annotations: (j.annotations || []).map(a => a.id === id ? fn(a) : a) }));

  let design = null;
  if (selN.length + selA.length === 0) design = <p className="cvp-empty">{t('cvp.nothing')}</p>;
  else if (selN.length + selA.length > 1) design = <p className="cvp-empty">{t('cvp.many', { n: selN.length + selA.length })}</p>;
  else if (selN.length === 1) {
    const n = selN[0];
    const set = (k) => (v) => patchNode(n.id, { [k]: v });
    design = (
      <>
        <div className="cvp-grid">
          <Num label="X" value={n.x} onChange={set('x')} /><Num label="Y" value={n.y} onChange={set('y')} />
          <Num label={t('cvp.w')} value={n.w} min={8} onChange={set('w')} /><Num label={t('cvp.h')} value={n.h} min={8} onChange={set('h')} />
        </div>
        {n.kind !== 'page' && <Color label={n.kind === 'label' ? t('cvp.text') : t('cvp.fill')} value={n.color || ''} allowNone
          vars={vars} linked={n.kind === 'label' ? n.colorVar : n.fillVar}
          onLink={(id) => patchNode(n.id, { [n.kind === 'label' ? 'colorVar' : 'fillVar']: id || undefined })}
          onChange={(v) => patchNode(n.id, { color: v === 'none' ? undefined : v, fillVar: undefined, colorVar: undefined })} />}
        {n.kind === 'label' && (vars.texts || []).length > 0 && (
          <label className="cvp-row"><span>{t('cvp.var.textStyle')}</span>
            <select value={n.textStyle || ''} onChange={(e) => patchNode(n.id, { textStyle: e.target.value || undefined })}>
              <option value="">—</option>
              {vars.texts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        {n.kind === 'label' && <TextProps n={n} patch={(p) => patchNode(n.id, p)} />}
        {n.kind === 'shape' && (
          <label className="cvp-row"><span>{t('cvp.shape')}</span>
            <select value={n.shape || 'rect'} onChange={(e) => patchNode(n.id, { shape: e.target.value })}>
              {['rect', 'ellipse', 'diamond', 'hexagon', 'cylinder', 'triangle', 'cloud', 'callout', 'star'].map(k => <option key={k} value={k}>{t('cv.shp.' + k)}</option>)}
            </select>
          </label>
        )}
      </>
    );
  } else {
    const a = selA[0];
    const isLine = a.kind === 'shape' && (a.shape === 'line' || a.shape === 'arrow');
    const isBox = a.kind === 'shape' && !isLine && a.w != null;
    const box = isBox ? { x: a.x, y: a.y, w: a.w, h: a.h } : (a.bbox ? { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h } : null);
    const setBox = (k) => (v) => patchAnno(a.id, (x) => {
      if (isBox) { const nx = { ...x, [k]: v }; nx.bbox = { x: nx.x, y: nx.y, w: nx.w, h: nx.h }; return nx; }
      if (k === 'x' && x.bbox) return { ...x, ox: v - x.bbox.x };
      if (k === 'y' && x.bbox) return { ...x, oy: v - x.bbox.y };
      return x;
    });
    const pen = a.kind === 'path' && a.variant === 'pen';
    design = (
      <>
        {box && (
          <div className="cvp-grid">
            <Num label="X" value={box.x} onChange={setBox('x')} /><Num label="Y" value={box.y} onChange={setBox('y')} />
            {isBox && <><Num label={t('cvp.w')} value={box.w} min={2} onChange={setBox('w')} /><Num label={t('cvp.h')} value={box.h} min={2} onChange={setBox('h')} /></>}
            {isBox && <Num label={t('cvp.rot')} value={a.rot || 0} suffix="°" onChange={(v) => patchAnno(a.id, x => ({ ...x, rot: v }))} />}
            {isBox && a.shape === 'rect' && !Array.isArray(a.corners) && <Num label={t('cvp.radius')} value={a.rx != null ? a.rx : 6} min={0} onChange={(v) => patchAnno(a.id, x => ({ ...x, rx: v }))} />}
          </div>
        )}
        {isBox && a.shape === 'rect' && (
          Array.isArray(a.corners) ? (
            <>
              <div className="cvp-grid">
                {['↖', '↗', '↘', '↙'].map((lab, k) => <Num key={k} label={lab} value={a.corners[k]} min={0} onChange={(v) => patchAnno(a.id, x => ({ ...x, corners: x.corners.map((c, i) => (i === k ? v : c)) }))} />)}
              </div>
              <button type="button" className="cvp-add" onClick={() => patchAnno(a.id, x => { const { corners, ...r } = x; return { ...r, rx: corners[0] }; })}>{t('cvp.cornersSame')}</button>
            </>
          ) : <button type="button" className="cvp-add" onClick={() => patchAnno(a.id, x => { const r0 = x.rx != null ? x.rx : 6; return { ...x, corners: [r0, r0, r0, r0] }; })}>⌗ {t('cvp.cornersEach')}</button>
        )}
        {isLine && (
          <div className="cvp-grid">
            {['x1', 'y1', 'x2', 'y2'].map(k => <Num key={k} label={k.toUpperCase()} value={a[k]} onChange={(v) => patchAnno(a.id, x => { const nx = { ...x, [k]: v }; nx.bbox = { x: Math.min(nx.x1, nx.x2), y: Math.min(nx.y1, nx.y2), w: Math.abs(nx.x2 - nx.x1), h: Math.abs(nx.y2 - nx.y1) }; return nx; })} />)}
          </div>
        )}
        {(isBox || (a.kind === 'path' && !a.variant)) && <Color label={t('cvp.fill')} value={a.fill || 'none'} allowNone
          vars={vars} linked={a.fillVar} onLink={(id) => patchAnno(a.id, linkKey('fillVar', id))}
          onChange={(v) => patchAnno(a.id, x => ({ ...unlink('fillVar')(x), fill: v }))} />}
        <Color label={pen ? t('cvp.ink') : t('cvp.stroke')} value={pen ? (a.fill || a.color) : (a.color || '')} allowNone={!pen}
          vars={vars} linked={a.colorVar} onLink={(id) => patchAnno(a.id, linkKey('colorVar', id))}
          onChange={(v) => patchAnno(a.id, x => (pen ? { ...unlink('colorVar')(x), color: v, fill: v } : { ...unlink('colorVar')(x), color: v }))} />
        {(isBox || (a.kind === 'path' && !a.variant)) && (a.imageFill && a.imageFill.src ? (
          <div className="cvp-color">
            <span>{t('cvp.img')}</span>
            <span className="cvp-imgthumb" style={{ backgroundImage: `url("${a.imageFill.src}")` }} />
            <select className="cvp-fit" value={a.imageFill.fit || 'cover'} onChange={(e) => patchAnno(a.id, x => ({ ...x, imageFill: { ...x.imageFill, fit: e.target.value } }))}>
              <option value="cover">{t('cvp.img.cover')}</option><option value="contain">{t('cvp.img.contain')}</option><option value="fill">{t('cvp.img.fill')}</option>
            </select>
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => patchAnno(a.id, x => { const { imageFill, ...r } = x; return r; })}>×</button>
          </div>
        ) : uploadImage ? (
          <label className="cvp-add">+ {t('cvp.img')}
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
              const file = e.target.files && e.target.files[0]; e.target.value = '';
              if (!file) return;
              const src = await uploadImage(file);
              if (src) patchAnno(a.id, x => ({ ...x, imageFill: { src, fit: 'cover' } }));
            }} />
          </label>
        ) : null)}
        {(isBox || (a.kind === 'path' && !a.variant)) && (a.gradient ? (
          <div className="cvp-color">
            <span>{t('cvp.gradient')}</span>
            {[0, a.gradient.stops.length - 1].map(k => (
              <label key={k} className="cvp-swatch" style={{ background: a.gradient.stops[k].color }}>
                <input type="color" value={HEX.test(a.gradient.stops[k].color) ? a.gradient.stops[k].color : '#000000'}
                  onChange={(e) => patchAnno(a.id, x => ({ ...x, gradient: { ...x.gradient, stops: x.gradient.stops.map((st, i) => (i === k ? { ...st, color: e.target.value } : st)) } }))} />
              </label>
            ))}
            <button type="button" className="cvp-chip" onClick={() => patchAnno(a.id, x => ({ ...x, gradient: { ...x.gradient, type: x.gradient.type === 'radial' ? 'linear' : 'radial' } }))}>
              {a.gradient.type === 'radial' ? t('cvp.radial') : t('cvp.linear')}
            </button>
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => patchAnno(a.id, x => { const { gradient, ...r } = x; return r; })}>×</button>
          </div>
        ) : (
          <button type="button" className="cvp-add" onClick={() => patchAnno(a.id, x => ({ ...x, gradient: { type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: HEX.test(x.fill || '') ? x.fill : '#2383e2' }, { offset: 1, color: '#ffffff' }] } }))}>+ {t('cvp.gradient')}</button>
        ))}
        {isBox && a.shape === 'rect' && !pen && (
          <>
            <label className="cvp-row"><span>{t('cvp.align.stroke')}</span>
              <select value={a.strokeAlign || 'center'} onChange={(e) => patchAnno(a.id, x => { const v = e.target.value; const { strokeAlign, ...r } = x; return v === 'center' ? r : { ...r, strokeAlign: v }; })}>
                <option value="center">{t('cvp.sa.center')}</option><option value="inside">{t('cvp.sa.inside')}</option><option value="outside">{t('cvp.sa.outside')}</option>
              </select>
            </label>
            <div className="cvp-seg" role="group" aria-label={t('cvp.sides')}>
              <button type="button" className={!a.sides ? 'on wide' : 'wide'} onClick={() => patchAnno(a.id, x => { const { sides, ...r } = x; return r; })}>{t('cvp.sides.all')}</button>
              {[['t', '▔'], ['r', '▕'], ['b', '▁'], ['l', '▏']].map(([k, g]) => (
                <button key={k} type="button" className={a.sides && a.sides[k] ? 'on' : ''} title={t('cvp.sides.' + k)}
                  onClick={() => patchAnno(a.id, x => { const sd = { ...(x.sides || {}) }; if (sd[k]) delete sd[k]; else sd[k] = true; const r = { ...x, sides: sd }; if (!Object.keys(sd).length) delete r.sides; return r; })}>{g}</button>
              ))}
            </div>
          </>
        )}
        {a.innerShadow ? (
          <div className="cvp-color">
            <span>{t('cvp.inner')}</span>
            <Num label="Y" value={a.innerShadow.dy ?? 2} onChange={(v) => patchAnno(a.id, x => ({ ...x, innerShadow: { ...x.innerShadow, dy: v } }))} />
            <Num label={t('cvp.blur')} value={a.innerShadow.blur ?? 4} min={0} onChange={(v) => patchAnno(a.id, x => ({ ...x, innerShadow: { ...x.innerShadow, blur: v } }))} />
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => patchAnno(a.id, x => { const { innerShadow, ...r } = x; return r; })}>×</button>
          </div>
        ) : <button type="button" className="cvp-add" onClick={() => patchAnno(a.id, x => ({ ...x, innerShadow: { dx: 0, dy: 2, blur: 4, color: '#000000', opacity: 0.25 } }))}>+ {t('cvp.inner')}</button>}
        {a.blur > 0 ? (
          <div className="cvp-color"><span>{t('cvp.layerBlur')}</span>
            <Num label="px" value={a.blur} min={0} max={200} onChange={(v) => patchAnno(a.id, x => ({ ...x, blur: v }))} />
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => patchAnno(a.id, x => { const { blur, ...r } = x; return r; })}>×</button>
          </div>
        ) : <button type="button" className="cvp-add" onClick={() => patchAnno(a.id, x => ({ ...x, blur: 4 }))}>+ {t('cvp.layerBlur')}</button>}
        {isBox && a.shape === 'rect' && (a.bgBlur > 0 ? (
          <div className="cvp-color"><span>{t('cvp.bgBlur')}</span>
            <Num label="px" value={a.bgBlur} min={0} max={200} onChange={(v) => patchAnno(a.id, x => ({ ...x, bgBlur: v }))} />
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => patchAnno(a.id, x => { const { bgBlur, ...r } = x; return r; })}>×</button>
          </div>
        ) : <button type="button" className="cvp-add" onClick={() => patchAnno(a.id, x => ({ ...x, bgBlur: 16 }))}>+ {t('cvp.bgBlur')}</button>)}
        {a.shadow ? (
          <div className="cvp-color">
            <span>{t('cvp.shadow')}</span>
            <Num label="Y" value={a.shadow.dy ?? 4} onChange={(v) => patchAnno(a.id, x => ({ ...x, shadow: { ...x.shadow, dy: v } }))} />
            <Num label={t('cvp.blur')} value={a.shadow.blur ?? 6} min={0} onChange={(v) => patchAnno(a.id, x => ({ ...x, shadow: { ...x.shadow, blur: v } }))} />
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => patchAnno(a.id, x => { const { shadow, ...r } = x; return r; })}>×</button>
          </div>
        ) : (
          <button type="button" className="cvp-add" onClick={() => patchAnno(a.id, x => ({ ...x, shadow: { dx: 0, dy: 6, blur: 10, color: '#000000', opacity: 0.2 } }))}>+ {t('cvp.shadow')}</button>
        )}
        <div className="cvp-grid">
          {!pen && <Num label={t('cvp.weight')} value={a.strokeWidth || 2} min={0} max={60} step={0.5} onChange={(v) => patchAnno(a.id, x => ({ ...x, strokeWidth: v }))} />}
          <Num label={t('cvp.opacity')} value={Math.round((a.opacity != null ? a.opacity : 1) * 100)} min={0} max={100} suffix="%" onChange={(v) => patchAnno(a.id, x => ({ ...x, opacity: v / 100 }))} />
        </div>
      </>
    );
  }

  if (selN.length + selA.length === 1) {
    const one = selN[0] || selA[0], kind = selN[0] ? 'n' : 'a';
    const raw = kind === 'n' ? nodes.find(x => x.id === one.id) : annos.find(x => x.id === one.id);
    const patchOne = (fn) => (kind === 'n'
      ? onChange(j => ({ ...j, nodes: (j.nodes || []).map(x => x.id === one.id ? fn(x) : x) }))
      : patchAnno(one.id, fn));
    design = <>{design}<AnimProps item={raw || one} kind={kind} patch={patchOne} /></>;
  }
  const order = mergedOrder(json).slice().reverse();
  const byId = new Map([...nodes.map(n => ['n' + n.id, n]), ...annos.map(a => ['a' + a.id, a])]);
  const toggle = (it, key) => {
    if (it.type === 'n') onChange(j => ({ ...j, nodes: (j.nodes || []).map(n => n.id === it.id ? (n[key] ? (({ [key]: _, ...r }) => r)(n) : { ...n, [key]: true }) : n) }));
    else onChange(j => ({ ...j, annotations: (j.annotations || []).map(a => a.id === it.id ? (a[key] ? (({ [key]: _, ...r }) => r)(a) : { ...a, [key]: true }) : a) }));
  };

  return (
    <aside className="cvp" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} aria-label={t('cvp.title')}>
      <div className="cvp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'design'} className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>{t('cvp.design')}</button>
        <button type="button" role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>{t('cvp.layers')}</button>
        <button type="button" role="tab" aria-selected={tab === 'styles'} className={tab === 'styles' ? 'on' : ''} onClick={() => setTab('styles')}>{t('cvp.styles')}</button>
        <button type="button" className="cvp-close" onClick={onClose} aria-label={t('btn.close')}>×</button>
      </div>
      {tab === 'styles' ? (
        <div className="cvp-body">
          <div className="cvp-h">{t('cvp.var.colors')}</div>
          {(vars.colors || []).map(c => (
            <div key={c.id} className="cvp-color">
              <label className="cvp-swatch" style={{ background: c.value }}>
                <input type="color" value={HEX.test(c.value) ? c.value : '#000000'} onChange={(e) => setVars(v => ({ ...v, colors: v.colors.map(x => x.id === c.id ? { ...x, value: e.target.value } : x) }))} />
              </label>
              <input className="cvp-hex cvp-name" value={c.name} spellCheck={false} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => setVars(v => ({ ...v, colors: v.colors.map(x => x.id === c.id ? { ...x, name: e.target.value } : x) }))} />
              <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => setVars(v => ({ ...v, colors: v.colors.filter(x => x.id !== c.id) }))}>×</button>
            </div>
          ))}
          <button type="button" className="cvp-add" onClick={() => {
            const from = selA[0] ? (selA[0].fill && selA[0].fill !== 'none' ? selA[0].fill : selA[0].color) : selN[0] ? selN[0].color : null;
            setVars(v => ({ ...v, colors: [...v.colors, { id: newVarId('c'), name: t('cvp.var.colorN', { n: v.colors.length + 1 }), value: HEX.test(from || '') ? from : '#6366f1' }] }));
          }}>+ {t('cvp.var.addColor')}</button>
          {listComponents(json).length > 0 && (<>
            <div className="cvp-h">{t('canvas.cmp.list')}</div>
            {listComponents(json).map(c => (
              <div key={c.id} className="cvp-color">
                <span className="cvp-tsample">◆</span>
                <span className="cvp-cname">{c.name}</span>
                <button type="button" className="cvp-chip" onClick={() => onChange(j => insertInstance(j, c.id, null).json)}>{t('canvas.cmp.insert')}</button>
              </div>
            ))}
          </>)}
          {library.length > 0 && (<>
            <div className="cvp-h">{t('canvas.lib.title')}</div>
            {library.map(e => (
              <div key={e.id} className="cvp-color">
                <span className="cvp-tsample">❖</span>
                <span className="cvp-cname">{e.name}</span>
                <button type="button" className="cvp-chip" onClick={() => onInsertLib && onInsertLib(e)}>{t('canvas.cmp.insert')}</button>
                <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => onRemoveLib && onRemoveLib(e.id)}>×</button>
              </div>
            ))}
          </>)}
          <div className="cvp-h">{t('cvp.var.texts')}</div>
          {(vars.texts || []).map(x => (
            <div key={x.id} className="cvp-color">
              <span className="cvp-tsample" style={labelTextStyle({ ...x.style, fontSize: Math.min(22, x.style.fontSize || 20), plain: true })}>Aa</span>
              <input className="cvp-hex cvp-name" value={x.name} spellCheck={false} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => setVars(v => ({ ...v, texts: v.texts.map(y => y.id === x.id ? { ...y, name: e.target.value } : y) }))} />
              {selN.some(n => n.kind === 'label') && <button type="button" className="cvp-chip" onClick={() => onChange(j => ({ ...j, nodes: (j.nodes || []).map(n => (selected.has(n.id) && n.kind === 'label') ? { ...n, textStyle: x.id } : n) }))}>{t('cvp.var.apply')}</button>}
              <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => setVars(v => ({ ...v, texts: v.texts.filter(y => y.id !== x.id) }))}>×</button>
            </div>
          ))}
          {selN.find(n => n.kind === 'label') ? (
            <button type="button" className="cvp-add" onClick={() => {
              const l = selN.find(n => n.kind === 'label');
              const id = newVarId('t');
              setVars(v => ({ ...v, texts: [...v.texts, { id, name: t('cvp.var.textN', { n: v.texts.length + 1 }), style: textStyleFrom(l) }] }));
              onChange(j => ({ ...j, nodes: (j.nodes || []).map(n => n.id === l.id ? { ...n, textStyle: id } : n) }));
            }}>+ {t('cvp.var.textFromSel')}</button>
          ) : <p className="cvp-empty">{t('cvp.var.textHint')}</p>}
        </div>
      ) : tab === 'design' ? <div className="cvp-body">{design}</div> : (
        <ul className="cvp-layers">
          {order.map(it => {
            const el = byId.get(it.type + it.id);
            if (!el) return null;
            const on = it.type === 'n' ? selected.has(it.id) : selAnno.has(it.id);
            return (
              <li key={it.type + it.id} className={`${on ? 'on' : ''}${el.hidden ? ' off' : ''}`}>
                <button type="button" className="cvp-lname" onClick={(e) => select(it, e.shiftKey)}>{nameOf(it, el)}</button>
                <button type="button" className={`cvp-ic${el.hidden ? ' act' : ''}`} title={t(el.hidden ? 'cvp.show' : 'cvp.hide')} onClick={() => toggle(it, 'hidden')}>{el.hidden ? '◌' : '◉'}</button>
                <button type="button" className={`cvp-ic${el.locked ? ' act' : ''}`} title={t(el.locked ? 'cvp.unlock' : 'cvp.lock')} onClick={() => toggle(it, 'locked')}>{el.locked ? '🔒' : '🔓'}</button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
