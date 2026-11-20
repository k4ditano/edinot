// Panel de diseño del canvas (estilo Figma), a la derecha: «Diseño» edita con números lo seleccionado
// (posición, tamaño, giro, colores, grosor, opacidad, texto) y «Capas» lista todo en su orden de apilado,
// con ocultar, bloquear y seleccionar. Se abre y se cierra desde las acciones de arriba a la derecha.

import { useState, useRef } from 'react';
import { t, useI18n } from '../../i18n.js';
import { mergedOrder } from './zorder.js';
import { FONT_KEYS, FONT_STACKS, weightOf, labelTextStyle } from '../../shared/text-style.js';
import { resolveVars, newVarId, textStyleFrom } from '../../shared/canvas-vars.js';
import { listComponents, insertInstance, componentProps, variantsOf } from './components.js';
import { ENTER_TYPES, HOVER_TYPES, LOOP_TYPES, LINK_ANIMS, playEnter } from './motion.js';
import { frameTree } from './autolayout.js';
import { layerTree, layerItems, moveLayers, renameLayer } from './layers.js';
import { itemCssText } from '../../shared/canvas-css.js';
import { shadowList, BLEND_MODES } from '../../shared/canvas-effects.js';
import { STROKE_ENDS } from './outline.js';

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
      {/* Tamaño de la caja de texto (como Figma): ancho automático, alto automático o fija. */}
      <div className="cvp-seg" role="group" aria-label={t('cvp.ts')}>
        {[['auto', '↔'], ['height', '↕'], ['fixed', '▢']].map(([k, g]) => (
          <button key={k} type="button" className={`wide${(n.textSize || 'height') === k ? ' on' : ''}`} title={t('cvp.ts.' + k)}
            onClick={() => patch({ textSize: k === 'height' ? undefined : k, wrap: k === 'auto' ? undefined : true, noWrap: undefined })}>{g} {t('cvp.ts.' + k + '.s')}</button>
        ))}
      </div>
      <div className="cvp-grid">
        <Num label={t('cvp.maxLines')} value={n.maxLines || 0} min={0} max={50} onChange={(v) => patch({ maxLines: v > 0 ? v : undefined })} />
        <Num label={t('cvp.paraSp')} value={n.paraSpacing || 0} min={0} max={200} onChange={(v) => patch({ paraSpacing: v > 0 ? v : undefined })} />
      </div>
      <div className="cvp-seg" role="group" aria-label={t('cvp.list')}>
        {[['', '¶'], ['bullet', '•'], ['number', '1.']].map(([k, g]) => (
          <button key={k || 'none'} type="button" className={(n.list || '') === k ? 'on' : ''} title={t('cvp.list.' + (k || 'none'))} onClick={() => patch({ list: k || undefined })}>{g}</button>
        ))}
        <span className="cvp-segsep" />
        {n.textSize === 'fixed' && <button type="button" className={n.truncate ? 'on wide' : 'wide'} title={t('cvp.truncate.h')} onClick={() => patch({ truncate: n.truncate ? undefined : true })}>{t('cvp.truncate')}</button>}
      </div>
    </>
  );
}

// Propiedades del componente: en una instancia, sus valores; en una pieza del principal, exponerla como propiedad.
function CompProps({ json, item, library, patch, onSetProp }) {
  if (item.cinst) {
    const props = componentProps(json, item.cinst, library);
    if (!props.length) return null;
    const pieces = [...(json.nodes || []), ...(json.annotations || [])].filter(x => x.grp === item.grp && x.cinst);
    return (
      <>
        <div className="cvp-h">{t('cvp.cp.title')}</div>
        {props.map(p => {
          const piece = pieces.find(x => x.cref === p.ref);
          if (!piece) return null;
          return p.type === 'bool' ? (
            <label key={p.name} className="cvp-check"><input type="checkbox" checked={!piece.hidden} onChange={(e) => onSetProp && onSetProp(item.grp, p.name, e.target.checked)} /> {p.name}</label>
          ) : (
            <div key={p.name} className="cvp-color"><span>{p.name}</span>
              <input className="cvp-hex cvp-name" defaultValue={piece.text || ''} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
                onBlur={(e) => { if (e.target.value !== (piece.text || '')) onSetProp && onSetProp(item.grp, p.name, e.target.value); }} />
            </div>
          );
        })}
      </>
    );
  }
  if (item.cmain) {
    return item.cprop ? (
      <div className="cvp-color"><span>{t('cvp.cp.prop')}</span><span className="cvp-varname">{item.cprop.name}</span>
        <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => patch(x => { const { cprop, ...r } = x; return r; })}>×</button></div>
    ) : (
      <button type="button" className="cvp-add" onClick={() => {
        const nm = window.prompt(t('cvp.cp.name'), typeof item.text === 'string' ? t('cvp.cp.defText') : t('cvp.cp.defBool'));
        if (nm) patch(x => ({ ...x, cprop: { name: nm, type: typeof x.text === 'string' ? 'text' : 'bool' } }));
      }}>+ {typeof item.text === 'string' ? t('cvp.cp.exposeText') : t('cvp.cp.exposeBool')}</button>
    );
  }
  return null;
}

// Variables enlazadas a propiedades (números, textos, sí/no) — como «aplicar variable» en Figma.
const BIND_PROPS = { nums: ['rx', 'strokeWidth', 'opacity', 'fontSize', 'w', 'h', 'letterSpacing', 'lineHeight'], strs: ['text'], bools: ['visible'], colors: [] };
function BindProps({ vars, item, kind, patch }) {
  const [prop, setProp] = useState('');
  const all = ['nums', 'strs', 'bools'].flatMap(k => (vars[k] || []).map(v => ({ ...v, k })));
  if (!all.length) return null;
  const binds = item.bind || {};
  const props = [...BIND_PROPS.nums, ...BIND_PROPS.strs, ...BIND_PROPS.bools].filter(p => (p !== 'text' || typeof item.text === 'string') && (p !== 'fontSize' || item.kind === 'label') && (p !== 'rx' || item.shape === 'rect'));
  const kindOf = (p) => (BIND_PROPS.strs.includes(p) ? 'strs' : BIND_PROPS.bools.includes(p) ? 'bools' : 'nums');
  const setBind = (p, id) => patch(x => { const b = { ...(x.bind || {}) }; if (id) b[p] = id; else delete b[p]; const r = { ...x }; if (Object.keys(b).length) r.bind = b; else delete r.bind; return r; });
  return (
    <>
      <div className="cvp-h">{t('cvp.var.bound')}</div>
      {Object.entries(binds).map(([p, id]) => (
        <div key={p} className="cvp-color"><span>{t('cvp.bp.' + p)}</span><span className="cvp-varname">{(all.find(v => v.id === id) || {}).name || '?'}</span>
          <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => setBind(p, null)}>×</button></div>
      ))}
      <div className="cvp-color">
        <select className="cvp-fit" value={prop} onChange={(e) => setProp(e.target.value)}>
          <option value="">{t('cvp.var.bindProp')}</option>
          {props.filter(p => !binds[p]).map(p => <option key={p} value={p}>{t('cvp.bp.' + p)}</option>)}
        </select>
        {prop && (
          <select className="cvp-fit" value="" onChange={(e) => { setBind(prop, e.target.value); setProp(''); }}>
            <option value="">{t('cvp.var.pick')}</option>
            {all.filter(v => v.k === kindOf(prop)).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </div>
    </>
  );
}

// En el marco: tamaño dentro de un auto layout (fijo / rellenar, mín/máx, absoluta, columnas) o restricciones.
function FrameProps({ json, item, rect, patch }) {
  if (!rect) return null;
  const fid = frameTree(json).ownerItem(rect);
  const fr = fid && (json.groups || []).find(g => g.id === fid);
  if (!fr) return null;
  const set = (k, v) => patch(x => { const r = { ...x }; if (v == null || v === '' || v === false) delete r[k]; else r[k] = v; return r; });
  if (fr.layout) {
    const fillW = item.sizeW === 'fill', fillH = item.sizeH === 'fill';
    return (
      <>
        <div className="cvp-h">{t('cvp.fr.title', { f: fr.title || t('canvas.groupDefault') })}</div>
        <div className="cvp-seg" role="group" aria-label={t('cvp.fr.w')}>
          <span className="cvp-seglab">{t('cvp.w')}</span>
          <button type="button" className={!fillW ? 'on' : ''} onClick={() => set('sizeW', null)}>{t('cvp.fr.fixed')}</button>
          <button type="button" className={fillW ? 'on' : ''} onClick={() => set('sizeW', 'fill')}>{t('cvp.fr.fill')}</button>
        </div>
        {fillW && <div className="cvp-grid"><Num label="mín" value={item.minW ?? 0} min={0} onChange={(v) => set('minW', v || null)} /><Num label="máx" value={item.maxW ?? 0} min={0} onChange={(v) => set('maxW', v || null)} /></div>}
        <div className="cvp-seg" role="group" aria-label={t('cvp.fr.h')}>
          <span className="cvp-seglab">{t('cvp.h')}</span>
          <button type="button" className={!fillH ? 'on' : ''} onClick={() => set('sizeH', null)}>{t('cvp.fr.fixed')}</button>
          <button type="button" className={fillH ? 'on' : ''} onClick={() => set('sizeH', 'fill')}>{t('cvp.fr.fill')}</button>
        </div>
        {fillH && <div className="cvp-grid"><Num label="mín" value={item.minH ?? 0} min={0} onChange={(v) => set('minH', v || null)} /><Num label="máx" value={item.maxH ?? 0} min={0} onChange={(v) => set('maxH', v || null)} /></div>}
        {fr.layout.dir === 'grid' && <div className="cvp-grid"><Num label={t('cvp.fr.span')} value={item.span || 1} min={1} max={fr.layout.columns || 12} onChange={(v) => set('span', v > 1 ? Math.round(v) : null)} /></div>}
        <label className="cvp-check"><input type="checkbox" checked={!!item.layoutAbsolute} onChange={(e) => set('layoutAbsolute', e.target.checked || null)} /> {t('cvp.fr.abs')}</label>
      </>
    );
  }
  const c = item.constraints || {};
  const setC = (k, v) => patch(x => { const cc = { ...(x.constraints || {}) }; if (!v || v === (k === 'h' ? 'left' : 'top')) delete cc[k]; else cc[k] = v; const r = { ...x }; if (Object.keys(cc).length) r.constraints = cc; else delete r.constraints; return r; });
  return (
    <>
      <div className="cvp-h">{t('cvp.fr.cons', { f: fr.title || t('canvas.groupDefault') })}</div>
      <label className="cvp-row"><span>{t('cvp.fr.ch')}</span>
        <select value={c.h || 'left'} onChange={(e) => setC('h', e.target.value)}>
          {['left', 'right', 'center', 'stretch', 'scale'].map(v => <option key={v} value={v}>{t('cvp.fr.c.' + v)}</option>)}
        </select>
      </label>
      <label className="cvp-row"><span>{t('cvp.fr.cv')}</span>
        <select value={c.v || 'top'} onChange={(e) => setC('v', e.target.value)}>
          {['top', 'bottom', 'center', 'stretch', 'scale'].map(v => <option key={v} value={v}>{t('cvp.fr.c.' + v)}</option>)}
        </select>
      </label>
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

// Varios rellenos y bordes, sombras (varias, con extensión, interiores) y modo de fusión — como en Figma.
function PaintLists({ a, patch, pen }) {
  const shadows = shadowList(a);
  const setShadows = (fn) => patch(x => { const list = fn(shadowList(x)); const { shadow, innerShadow, ...r } = x; if (list.length) r.shadows = list; else delete r.shadows; return r; });
  const setList = (key, fn) => patch(x => { const l = fn([...(x[key] || [])]); const r = { ...x }; if (l.length) r[key] = l; else delete r[key]; return r; });
  const col = (v, on) => (
    <label className="cvp-swatch" style={{ background: v }}><input type="color" value={HEX.test(v || '') ? v : '#000000'} onChange={(e) => on(e.target.value)} /></label>
  );
  const open = (a.kind === 'path' && !a.variant) || (a.kind === 'shape' && (a.shape === 'line' || a.shape === 'arrow'));
  const hasStroke = a.color && a.color !== 'none';
  const setK = (k, v) => patch(x => { const r = { ...x }; if (v == null || v === '') delete r[k]; else r[k] = v; return r; });
  return (
    <>
      {!pen && hasStroke && (<>
        <div className="cvp-h">{t('cvp.strokeOpts')}</div>
        <div className="cvp-seg" role="group" aria-label={t('cvp.cap')}>
          {[['butt', '⎯'], ['round', '◖'], ['square', '▮']].map(([k, g]) => (
            <button key={k} type="button" className={(a.strokeCap || (a.kind === 'path' ? 'round' : 'round')) === k ? 'on' : ''} title={t('cvp.cap.' + k)} onClick={() => setK('strokeCap', k)}>{g}</button>
          ))}
          <span className="cvp-segsep" />
          {[['miter', '⌐'], ['round', '◜'], ['bevel', '⌙']].map(([k, g]) => (
            <button key={k} type="button" className={(a.strokeJoin || 'round') === k ? 'on' : ''} title={t('cvp.join.' + k)} onClick={() => setK('strokeJoin', k)}>{g}</button>
          ))}
        </div>
        {open && a.shape !== 'arrow' && (
          <div className="cvp-color">
            <span>{t('cvp.ends')}</span>
            {['startCap', 'endCap'].map(k => (
              <select key={k} className="cvp-fit" value={a[k] || 'none'} title={t('cvp.' + k)} onChange={(e) => setK(k, e.target.value === 'none' ? null : e.target.value)}>
                {STROKE_ENDS.map(m => <option key={m} value={m}>{t('cvp.end.' + m)}</option>)}
              </select>
            ))}
          </div>
        )}
        <label className="cvp-row"><span>{t('cvp.dash')}</span>
          <input className="cvp-hex" placeholder="8 4" value={a.dash && a.dash !== 'solid' ? (a.dash === 'dashed' ? '8 4' : a.dash === 'dotted' ? '2 4' : a.dash) : ''} onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => setK('dash', e.target.value.trim() || null)} />
        </label>
      </>)}
      {!pen && (<>
        <div className="cvp-h">{t('cvp.fills')}</div>
        {(a.fills || []).map((f, i) => (
          <div key={i} className="cvp-color">
            {col(f.color, (v) => setList('fills', l => { l[i] = { ...l[i], color: v }; return l; }))}
            <Num label="%" value={Math.round((f.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => setList('fills', l => { l[i] = { ...l[i], opacity: v / 100 }; return l; })} />
            <select className="cvp-fit" value={f.blend || 'normal'} title={t('cvp.blend')} onChange={(e) => setList('fills', l => { l[i] = { ...l[i], blend: e.target.value === 'normal' ? undefined : e.target.value }; return l; })}>
              {BLEND_MODES.map(m => <option key={m} value={m}>{t('cvp.bl.' + m)}</option>)}
            </select>
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => setList('fills', l => l.filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="cvp-add" onClick={() => setList('fills', l => [...l, { color: '#000000', opacity: 0.2 }])}>+ {t('cvp.fill.add')}</button>
        <div className="cvp-h">{t('cvp.strokes')}</div>
        {(a.strokes || []).map((st, i) => (
          <div key={i} className="cvp-color">
            {col(st.color, (v) => setList('strokes', l => { l[i] = { ...l[i], color: v }; return l; }))}
            <Num label="px" value={st.width ?? 1} min={0} max={60} step={0.5} onChange={(v) => setList('strokes', l => { l[i] = { ...l[i], width: v }; return l; })} />
            <Num label="%" value={Math.round((st.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => setList('strokes', l => { l[i] = { ...l[i], opacity: v / 100 }; return l; })} />
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => setList('strokes', l => l.filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="cvp-add" onClick={() => setList('strokes', l => [...l, { color: '#ffffff', width: 2 }])}>+ {t('cvp.stroke.add')}</button>
      </>)}
      <div className="cvp-h">{t('cvp.effects')}</div>
      {shadows.map((sh, i) => (
        <div key={i} className="cvp-inter">
          <div className="cvp-color">
            <select className="cvp-fit" value={sh.inner ? 'inner' : 'drop'} onChange={(e) => setShadows(l => { l[i] = { ...l[i], inner: e.target.value === 'inner' }; return l; })}>
              <option value="drop">{t('cvp.shadow')}</option><option value="inner">{t('cvp.inner')}</option>
            </select>
            {col(sh.color || '#000000', (v) => setShadows(l => { l[i] = { ...l[i], color: v }; return l; }))}
            <Num label="%" value={Math.round((sh.opacity ?? 0.25) * 100)} min={0} max={100} onChange={(v) => setShadows(l => { l[i] = { ...l[i], opacity: v / 100 }; return l; })} />
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => setShadows(l => l.filter((_, k) => k !== i))}>×</button>
          </div>
          <div className="cvp-grid">
            <Num label="X" value={sh.dx ?? 0} onChange={(v) => setShadows(l => { l[i] = { ...l[i], dx: v }; return l; })} />
            <Num label="Y" value={sh.dy ?? 4} onChange={(v) => setShadows(l => { l[i] = { ...l[i], dy: v }; return l; })} />
            <Num label={t('cvp.blur')} value={sh.blur ?? 6} min={0} onChange={(v) => setShadows(l => { l[i] = { ...l[i], blur: v }; return l; })} />
            <Num label={t('cvp.spread')} value={sh.spread ?? 0} onChange={(v) => setShadows(l => { l[i] = { ...l[i], spread: v || undefined }; return l; })} />
          </div>
        </div>
      ))}
      <button type="button" className="cvp-add" onClick={() => setShadows(l => [...l, { dx: 0, dy: 6, blur: 10, color: '#000000', opacity: 0.2 }])}>+ {t('cvp.shadow')}</button>
      <label className="cvp-row"><span>{t('cvp.blend')}</span>
        <select value={a.blend || 'normal'} onChange={(e) => patch(x => { const r = { ...x }; if (e.target.value === 'normal') delete r.blend; else r.blend = e.target.value; return r; })}>
          {BLEND_MODES.map(m => <option key={m} value={m}>{t('cvp.bl.' + m)}</option>)}
        </select>
      </label>
    </>
  );
}

// Capas en árbol: marcos → grupos/instancias → piezas; plegar, renombrar (doble clic) y arrastrar para reordenar.
function LayerTree({ json, byId, selected, selAnno, select, toggle, onChange }) {
  const [closed, setClosed] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [drop, setDrop] = useState(null);   // { key, above }
  const dragRef = useRef(null);
  const tree = layerTree(json);
  const keyOf = (n) => (n.kind === 'frame' ? 'f' + n.id : n.kind === 'group' ? 'g' + n.grp : n.type + n.id);
  const isOn = (n) => { const its = layerItems(n); return its.length > 0 && its.every(i => (i.type === 'n' ? selected.has(i.id) : selAnno.has(i.id))); };
  const selectNode = (n, add) => { const its = layerItems(n); its.forEach((i, k) => select(i, add || k > 0)); };
  const anchor = (n) => { const its = layerItems(n); return its[0] || null; };
  const label = (n) => {
    if (n.kind === 'frame') return (n.section ? '▭ ' : '# ') + (n.title || t('canvas.present.untitled'));
    if (n.kind === 'group') {
      let nm = n.name;
      if (!nm && n.cref) { const m = [...(json.nodes || []), ...(json.annotations || [])].find(x => x.cmain === n.cref); nm = m && m.cname; }
      return (n.comp === 'main' ? '◆ ' : n.comp === 'inst' ? '◇ ' : '▣ ') + (nm || t('cvp.lay.group'));
    }
    const el = byId.get(n.type + n.id);
    return el ? (el.grp ? nameOf0({ type: n.type, id: n.id }, el) : nameOf({ type: n.type, id: n.id }, el)) : '?';
  };
  const rename = (n, v) => { setEditing(null); onChange(j => renameLayer(j, n, v)); };
  const row = (n, depth) => {
    const k = keyOf(n);
    const kids = n.children && n.children.length ? n.children : null;
    const el = n.kind === 'item' ? byId.get(n.type + n.id) : null;
    if (n.kind === 'item' && !el) return null;
    const on = isOn(n);
    const cur = n.kind === 'frame' ? n.title : n.kind === 'group' ? n.name : (el && el.name) || '';
    return (
      <li key={k}>
        <div className={`cvp-lrow${on ? ' on' : ''}${el && el.hidden ? ' off' : ''}${drop && drop.key === k ? (drop.above ? ' drop-above' : ' drop-below') : ''}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable={n.kind !== 'frame' && editing !== k}
          onDragStart={(e) => { dragRef.current = n; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', k); } catch {} }}
          onDragOver={(e) => { if (!dragRef.current || n.kind === 'frame') return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop({ key: k, above: e.clientY < r.top + r.height / 2 }); }}
          onDragLeave={() => setDrop(d => (d && d.key === k ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            const from = dragRef.current; dragRef.current = null; setDrop(null);
            if (!from || n.kind === 'frame') return;
            const r = e.currentTarget.getBoundingClientRect();
            const above = e.clientY < r.top + r.height / 2;
            // Encima de la primera pieza de la fila (o debajo de la última), en el orden de apilado.
            const its = layerItems(n);
            const target = above ? its[0] : its[its.length - 1];
            if (target) onChange(j => moveLayers(j, layerItems(from), target, above));
          }}
          onDragEnd={() => { dragRef.current = null; setDrop(null); }}>
          {kids ? <button type="button" className="cvp-ltog" onClick={() => setClosed(c => { const x = new Set(c); if (x.has(k)) x.delete(k); else x.add(k); return x; })}>{closed.has(k) ? '▸' : '▾'}</button> : <span className="cvp-ltog" />}
          {editing === k ? (
            <input className="cvp-lrename" autoFocus defaultValue={cur} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') rename(n, e.currentTarget.value); if (e.key === 'Escape') setEditing(null); }} onBlur={(e) => rename(n, e.target.value)} />
          ) : (
            <button type="button" className="cvp-lname" onClick={(e) => (n.kind === 'frame' ? selectNode(n, e.shiftKey) : selectNode(n, e.shiftKey))} onDoubleClick={() => setEditing(k)}>{label(n)}</button>
          )}
          {el && <button type="button" className={`cvp-ic${el.hidden ? ' act' : ''}`} title={t(el.hidden ? 'cvp.show' : 'cvp.hide')} onClick={() => toggle({ type: n.type, id: n.id }, 'hidden')}>{el.hidden ? '◌' : '◉'}</button>}
          {el && <button type="button" className={`cvp-ic${el.locked ? ' act' : ''}`} title={t(el.locked ? 'cvp.unlock' : 'cvp.lock')} onClick={() => toggle({ type: n.type, id: n.id }, 'locked')}>{el.locked ? '🔒' : '🔓'}</button>}
        </div>
        {kids && !closed.has(k) && <ul>{kids.map(c => row(c, depth + 1))}</ul>}
      </li>
    );
  };
  if (!tree.length) return <div className="cvp-body"><p className="cvp-empty">{t('cvp.lay.empty')}</p></div>;
  return <ul className="cvp-layers cvp-ltree">{tree.map(n => row(n, 0))}</ul>;
}

// Modo desarrollador: CSS de la capa, medidas y exportar (PNG 1x/2x/3x, SVG). Alt sobre otro elemento mide distancias.
function CodeTab({ item, count, onExport }) {
  const [copied, setCopied] = useState(false);
  if (!count) return <div className="cvp-body"><p className="cvp-empty">{t('cvp.code.empty')}</p></div>;
  const r = item ? (item.bbox ? { x: item.bbox.x + (item.ox || 0), y: item.bbox.y + (item.oy || 0), w: item.bbox.w, h: item.bbox.h } : { x: item.x || 0, y: item.y || 0, w: item.w || 0, h: item.h || 0 }) : null;
  const css = item ? itemCssText(item) : '';
  return (
    <div className="cvp-body">
      {r && (<>
        <div className="cvp-h">{t('cvp.code.box')}</div>
        <div className="cvp-code-box">{Math.round(r.w)} × {Math.round(r.h)} <span>· x {Math.round(r.x)} · y {Math.round(r.y)}</span></div>
      </>)}
      {item && (<>
        <div className="cvp-h">CSS <button type="button" className="cvp-chip" style={{ float: 'right' }} onClick={() => { try { navigator.clipboard.writeText(css); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} }}>{copied ? '✓' : t('cvp.code.copy')}</button></div>
        <pre className="cvp-code">{css}</pre>
      </>)}
      <div className="cvp-h">{t('cvp.code.export')}</div>
      <div className="cvp-modes">
        {[1, 2, 3].map(sc => <button key={sc} type="button" className="cvp-chip" onClick={() => onExport && onExport('png', sc)}>PNG {sc}x</button>)}
        <button type="button" className="cvp-chip" onClick={() => onExport && onExport('svg')}>SVG</button>
      </div>
      <p className="cvp-empty">{t('cvp.code.hint')}</p>
    </div>
  );
}

// Interacciones del prototipo: disparador → acción (como el panel «Prototype» de Figma).
const I_TRIGGERS = ['click', 'hover', 'press', 'delay', 'key'];
const I_ACTIONS = ['navigate', 'back', 'overlay', 'close', 'scrollTo', 'variant', 'setVar', 'url'];
function InterProps({ json, item, patch }) {
  const list = Array.isArray(item.interactions) ? item.interactions : [];
  const frames = json.groups || [];
  const vars = json.vars || {};
  const allVars = ['nums', 'strs', 'bools'].flatMap(k => (vars[k] || []).map(v => ({ ...v, k })));
  const variants = item.cinst ? variantsOf(json, item.cinst) : [];
  const setAt = (i, ch) => patch(x => { const l = [...(x.interactions || [])]; l[i] = { ...l[i], ...ch }; for (const k of Object.keys(l[i])) if (l[i][k] == null || l[i][k] === '') delete l[i][k]; return { ...x, interactions: l }; });
  const delAt = (i) => patch(x => { const l = (x.interactions || []).filter((_, k) => k !== i); const r = { ...x }; if (l.length) r.interactions = l; else delete r.interactions; return r; });
  const sel = (value, opts, on, ph) => (
    <select className="cvp-fit" value={value ?? ''} onChange={(e) => on(e.target.value || null)}>
      {ph && <option value="">{ph}</option>}
      {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
  return (
    <>
      <div className="cvp-h">{t('cvp.int.title')}</div>
      {list.map((it, i) => (
        <div key={i} className="cvp-inter">
          <div className="cvp-color">
            {sel(it.trigger, I_TRIGGERS.map(v => ({ v, l: t('cvp.int.tr.' + v) })), (v) => setAt(i, { trigger: v }))}
            {it.trigger === 'delay' && <input className="cvp-hex cvp-val" type="number" value={it.delay ?? 800} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setAt(i, { delay: Number(e.target.value) })} />}
            {it.trigger === 'key' && <input className="cvp-hex cvp-val" placeholder="Enter" value={it.key || ''} onKeyDown={(e) => { e.stopPropagation(); if (e.key.length > 1 && e.key !== 'Backspace') { e.preventDefault(); setAt(i, { key: e.key }); } }} onChange={(e) => setAt(i, { key: e.target.value.slice(-1) })} />}
            <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => delAt(i)}>×</button>
          </div>
          <div className="cvp-color">
            {sel(it.action, I_ACTIONS.map(v => ({ v, l: t('cvp.int.ac.' + v) })), (v) => setAt(i, { action: v }))}
            {(it.action === 'navigate' || it.action === 'overlay') && sel(it.target, frames.map(g => ({ v: g.id, l: g.title || g.id })), (v) => setAt(i, { target: v }), t('cvp.int.frame'))}
            {it.action === 'variant' && sel(it.target, variants.map(v => ({ v: v.id, l: v.variant })), (v) => setAt(i, { target: v }), t('cvp.int.variant'))}
            {it.action === 'scrollTo' && sel(it.target, [...(json.nodes || []), ...(json.annotations || [])].filter(x => x.name || x.text).slice(0, 200).map(x => ({ v: x.id, l: String(x.name || x.text).slice(0, 30) })), (v) => setAt(i, { target: v }), t('cvp.int.item'))}
            {it.action === 'url' && <input className="cvp-hex cvp-name" placeholder="https://" value={it.target || ''} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setAt(i, { target: e.target.value })} />}
          </div>
          {it.action === 'navigate' && <div className="cvp-color">{sel(it.anim || 'move', LINK_ANIMS.map(v => ({ v, l: t('cvp.anim.t.' + v) })), (v) => setAt(i, { anim: v }))}</div>}
          {it.action === 'setVar' && (
            <div className="cvp-color">
              {sel(it.var, allVars.map(v => ({ v: v.id, l: v.name })), (v) => setAt(i, { var: v }), t('cvp.var.pick'))}
              <input className="cvp-hex cvp-val" placeholder={t('cvp.int.value')} title={t('cvp.int.valueHint')} value={it.value ?? ''} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setAt(i, { value: e.target.value })} />
            </div>
          )}
          {allVars.length > 0 && (
            <div className="cvp-color"><span>{t('cvp.int.if')}</span>
              {sel(it.if && it.if.var, allVars.map(v => ({ v: v.id, l: v.name })), (v) => setAt(i, { if: v ? { var: v, eq: (it.if && it.if.eq) ?? 'true' } : null }), t('cvp.int.always'))}
              {it.if && <input className="cvp-hex cvp-val" value={it.if.eq ?? ''} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setAt(i, { if: { ...it.if, eq: e.target.value } })} />}
            </div>
          )}
        </div>
      ))}
      <button type="button" className="cvp-add" onClick={() => patch(x => ({ ...x, interactions: [...(x.interactions || []), { trigger: 'click', action: 'navigate' }] }))}>+ {t('cvp.int.add')}</button>
    </>
  );
}

const nameOf = (it, el) => {
  if (!el) return '?';
  const pre = el.cmain ? '◆ ' + (el.cname || '') + ' · ' : el.cinst ? '◇ ' : '';
  return pre + nameOf0(it, el);
};
const nameOf0 = (it, el) => {
  const txt = String(el.name || el.text || el.title || el.label || el.noteName || '').split('\n')[0].trim();
  if (it.type === 'n') {
    const k = el.kind === 'shape' ? t('cvp.k.shape') : el.kind === 'label' ? t('cvp.k.label') : el.sticky ? t('cvp.k.sticky') : el.kind === 'page' ? t('cvp.k.page') : el.kind === 'image' ? t('cvp.k.image') : el.kind === 'note' ? t('cvp.k.note') : t('cvp.k.card');
    return txt ? `${k} · ${txt.slice(0, 28)}` : k;
  }
  const k = el.kind === 'path' ? (el.variant ? t('cvp.k.ink') : t('cvp.k.vector')) : el.shape === 'line' || el.shape === 'arrow' ? t('cvp.k.line') : t('cvp.k.drawn');
  return txt ? `${k} · ${txt.slice(0, 28)}` : k;
};

export function CanvasPropsPanel({ json, selected, selAnno, onChange, select, onClose, uploadImage, library = [], onInsertLib, onRemoveLib, onSetInstanceProp, onExport, cropEdit, onCropEdit, pages = [], curPage, onSetPage, onAddPage, onRenamePage, onRemovePage }) {
  useI18n();
  const [tab, setTab] = useState('design');
  const nodes = json.nodes || [], annos = json.annotations || [];
  const vars = json.vars || {};
  const selN = nodes.filter(n => selected.has(n.id)).map(n => resolveVars(n, json.vars));
  const selA = annos.filter(a => selAnno.has(a.id)).map(a => resolveVars(a, json.vars));
  const setVars = (fn) => onChange(j => ({ ...j, vars: fn({ colors: [], texts: [], nums: [], strs: [], bools: [], modes: [], ...(j.vars || {}) }) }));
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
        {a.imageFill && a.imageFill.src && (() => {
          const f = a.imageFill;
          const setF = (k, v) => patchAnno(a.id, x => { const nf = { ...x.imageFill }; if (v === 0 || v == null) delete nf[k]; else nf[k] = v; return { ...x, imageFill: nf }; });
          return (<>
            <div className="cvp-modes">
              <button type="button" className={`cvp-chip${cropEdit === a.id ? ' on' : ''}`} title={t('cvp.img.crop.h')} onClick={() => onCropEdit && onCropEdit(cropEdit === a.id ? null : a.id)}>✥ {t('cvp.img.crop')}</button>
              {(f.scale || f.ox || f.oy) ? <button type="button" className="cvp-chip" onClick={() => patchAnno(a.id, x => { const { scale, ox, oy, ...nf } = x.imageFill; return { ...x, imageFill: nf }; })}>{t('cvp.img.reset')}</button> : null}
            </div>
            <div className="cvp-grid">
              <Num label={t('cvp.img.zoom')} value={Math.round((f.scale || 1) * 100)} min={100} max={800} suffix="%" onChange={(v) => setF('scale', v > 100 ? v / 100 : 0)} />
              <Num label={t('cvp.img.exp')} value={Math.round((f.exposure || 0) * 100)} min={-100} max={100} onChange={(v) => setF('exposure', v / 100)} />
              <Num label={t('cvp.img.con')} value={Math.round((f.contrast || 0) * 100)} min={-100} max={100} onChange={(v) => setF('contrast', v / 100)} />
              <Num label={t('cvp.img.sat')} value={Math.round((f.saturation || 0) * 100)} min={-100} max={100} onChange={(v) => setF('saturation', v / 100)} />
            </div>
          </>);
        })()}
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
        <PaintLists a={a} patch={(fn) => patchAnno(a.id, fn)} pen={pen} />
        {annos.some(x => x.clipTo === a.id) && (
          <label className="cvp-row"><span>{t('cvp.maskType')}</span>
            <select value={a.maskType || 'vector'} onChange={(e) => patchAnno(a.id, x => { const r = { ...x }; if (e.target.value === 'vector') delete r.maskType; else r.maskType = e.target.value; return r; })}>
              <option value="vector">{t('cvp.mask.vector')}</option><option value="alpha">{t('cvp.mask.alpha')}</option><option value="luminance">{t('cvp.mask.luminance')}</option>
            </select>
          </label>
        )}
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
    const it1 = raw || one;
    const rect1 = kind === 'n' ? { x: it1.x || 0, y: it1.y || 0, w: it1.w || 240, h: it1.h || 140 } : (it1.bbox ? { x: it1.bbox.x + (it1.ox || 0), y: it1.bbox.y + (it1.oy || 0), w: it1.bbox.w, h: it1.bbox.h } : null);
    design = <>{design}<CompProps json={json} item={it1} library={library} patch={patchOne} onSetProp={onSetInstanceProp} /><BindProps vars={vars} item={it1} kind={kind} patch={patchOne} /><FrameProps json={json} item={it1} rect={rect1} patch={patchOne} /><AnimProps item={it1} kind={kind} patch={patchOne} /><InterProps json={json} item={it1} patch={patchOne} /></>;
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
        <button type="button" role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>{t('cvp.code')}</button>
        <button type="button" className="cvp-close" onClick={onClose} aria-label={t('btn.close')}>×</button>
      </div>
      {tab === 'code' ? (
        <CodeTab item={selN.length + selA.length === 1 ? resolveVars((selN[0] ? nodes.find(x => x.id === selN[0].id) : annos.find(x => x.id === selA[0].id)) || selN[0] || selA[0], vars) : null} count={selN.length + selA.length} onExport={onExport} />
      ) : tab === 'styles' ? (
        <div className="cvp-body">
          {/* Modos (Claro / Oscuro…): cambiar de modo cambia todo lo enlazado a variables. */}
          <div className="cvp-h">{t('cvp.var.modes')}</div>
          {(vars.modes || []).length ? (
            <div className="cvp-modes">
              {vars.modes.map(m => (
                <button key={m.id} type="button" className={`cvp-chip${(vars.mode || vars.modes[0].id) === m.id ? ' on' : ''}`}
                  onClick={() => setVars(v => ({ ...v, mode: m.id }))}
                  onDoubleClick={() => { const nm = window.prompt(t('cvp.var.modeName'), m.name); if (nm) setVars(v => ({ ...v, modes: v.modes.map(x => x.id === m.id ? { ...x, name: nm } : x) })); }}>{m.name}</button>
              ))}
              <button type="button" className="cvp-chip" title={t('cvp.var.addMode')} onClick={() => setVars(v => { const id = newVarId('m'); return { ...v, modes: [...v.modes, { id, name: t('cvp.var.modeN', { n: v.modes.length + 1 }) }] }; })}>+</button>
            </div>
          ) : (
            <button type="button" className="cvp-add" onClick={() => setVars(v => {
              const l = newVarId('m'), d = newVarId('m');
              const seed = (list) => (list || []).map(x => ({ ...x, values: { [l]: x.value, [d]: x.value, ...(x.values || {}) } }));
              return { ...v, modes: [{ id: l, name: t('cvp.var.light') }, { id: d, name: t('cvp.var.dark') }], mode: l, colors: seed(v.colors), nums: seed(v.nums), strs: seed(v.strs), bools: seed(v.bools) };
            })}>+ {t('cvp.var.addModes')}</button>
          )}
          {[
            { kind: 'colors', title: t('cvp.var.colors'), add: t('cvp.var.addColor'), def: '#6366f1' },
            { kind: 'nums', title: t('cvp.var.nums'), add: t('cvp.var.addNum'), def: 16 },
            { kind: 'strs', title: t('cvp.var.strs'), add: t('cvp.var.addStr'), def: 'Texto' },
            { kind: 'bools', title: t('cvp.var.bools'), add: t('cvp.var.addBool'), def: true },
          ].map(({ kind, title, add, def }) => (
            <div key={kind} className="cvp-varblock">
              <div className="cvp-h">{title}</div>
              {(vars[kind] || []).map(c => {
                const mode = (vars.modes || []).length ? (vars.mode || vars.modes[0].id) : null;
                const cur = mode && c.values && c.values[mode] !== undefined ? c.values[mode] : c.value;
                const setVal = (val) => setVars(v => ({ ...v, [kind]: v[kind].map(x => {
                  if (x.id !== c.id) return x;
                  if (!mode) return { ...x, value: val };
                  const r = { ...x, values: { ...(x.values || {}), [mode]: val } };
                  if (mode === v.modes[0].id) r.value = val;   // el primer modo es también el valor por omisión
                  return r;
                }) }));
                return (
                  <div key={c.id} className="cvp-color">
                    {kind === 'colors' && <label className="cvp-swatch" style={{ background: cur }}><input type="color" value={HEX.test(cur) ? cur : '#000000'} onChange={(e) => setVal(e.target.value)} /></label>}
                    <input className="cvp-hex cvp-name" value={c.name} spellCheck={false} onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => setVars(v => ({ ...v, [kind]: v[kind].map(x => x.id === c.id ? { ...x, name: e.target.value } : x) }))} />
                    {kind === 'nums' && <input className="cvp-hex cvp-val" type="number" value={cur ?? ''} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setVal(Number(e.target.value))} />}
                    {kind === 'strs' && <input className="cvp-hex cvp-val" value={cur ?? ''} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setVal(e.target.value)} />}
                    {kind === 'bools' && <input type="checkbox" checked={cur !== false && cur !== 'false'} onChange={(e) => setVal(e.target.checked)} />}
                    <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => setVars(v => ({ ...v, [kind]: v[kind].filter(x => x.id !== c.id) }))}>×</button>
                  </div>
                );
              })}
              <button type="button" className="cvp-add" onClick={() => {
                let val = def;
                if (kind === 'colors') { const from = selA[0] ? (selA[0].fill && selA[0].fill !== 'none' ? selA[0].fill : selA[0].color) : selN[0] ? selN[0].color : null; if (HEX.test(from || '')) val = from; }
                setVars(v => ({ ...v, [kind]: [...(v[kind] || []), { id: newVarId(kind[0]), name: `${title} ${(v[kind] || []).length + 1}`, value: val }] }));
              }}>+ {add}</button>
            </div>
          ))}
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
        <div className="cvp-layerwrap">
          {/* Páginas (como en Figma): varias hojas en el mismo canvas. */}
          <div className="cvp-h">{t('canvas.pages')} <button type="button" className="cvp-chip" style={{ float: 'right' }} title={t('canvas.page.add')} onClick={onAddPage}>+</button></div>
          {pages.length > 1 && (
            <ul className="cvp-pages">
              {pages.map(p => (
                <li key={p.id} className={p.id === curPage ? 'on' : ''}>
                  <button type="button" className="cvp-lname" onClick={() => onSetPage && onSetPage(p.id)}
                    onDoubleClick={() => { const nm = window.prompt(t('canvas.page.name'), p.name); if (nm) onRenamePage && onRenamePage(p.id, nm); }}>{p.name}</button>
                  <button type="button" className="cvp-x" title={t('cvp.remove')} onClick={() => onRemovePage && onRemovePage(p.id)}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="cvp-h">{t('cvp.layers')}</div>
          <LayerTree json={json} byId={byId} selected={selected} selAnno={selAnno} select={select} toggle={toggle} onChange={onChange} />
        </div>
      )}
    </aside>
  );
}
