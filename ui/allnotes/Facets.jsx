// Los desplegables de los filtros de «Todas las notas» y el formulario de nombre de
// una colección. Se montan dentro de <Menu> (ui/shell/Menu.jsx) como items `custom`:
// el menú pone el portal, la posición y el cierre al hacer clic fuera.

import { useMemo, useState, useRef, useEffect } from 'react';
import { t } from '../../i18n.js';
import { Icon } from '../shell/icons.jsx';
import { UPDATED_CHOICES, foldText } from '../../shared/collections.js';

// El menú captura ↑ ↓ Enter y Espacio para moverse entre sus items; aquí dentro mandan los
// controles de este panel (sólo Escape y Tab siguen subiendo, para cerrarlo).
const keep = (e) => { if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); };

function Check({ checked, onChange, children, count, indent = 0, title, radio }) {
  return (
    <button type="button" className={`an-opt${checked ? ' on' : ''}`} role={radio ? 'radio' : 'checkbox'} aria-checked={checked}
      style={indent ? { paddingLeft: 10 + indent * 14 } : undefined} onClick={onChange} title={title}>
      <span className={`an-box${radio ? ' radio' : ''}`} aria-hidden="true">{checked ? <Icon name="check" size={12} stroke={2.4} /> : null}</span>
      <span className="an-opt-label">{children}</span>
      {count != null && <span className="an-opt-n">{count}</span>}
    </button>
  );
}

const SHOWN = 250;

function SearchBox({ value, onChange, placeholder, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  return (
    <div className="an-pop-search">
      <Icon name="search" size={14} />
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
    </div>
  );
}

// Etiquetas del vault: elegir varias; «cualquiera» o «todas».
export function TagsFacet({ tags, rules, setRules }) {
  const [q, setQ] = useState('');
  const picked = new Set(rules.tags.map(x => x.toLowerCase()));
  const list = useMemo(() => {
    const f = foldText(q);
    return tags.filter(x => !f || foldText(x.tag).includes(f)).slice(0, SHOWN);
  }, [tags, q]);
  const toggle = (tag) => {
    const k = tag.toLowerCase();
    setRules(r => ({ ...r, tags: picked.has(k) ? r.tags.filter(x => x.toLowerCase() !== k) : [...r.tags, tag] }));
  };
  return (
    <div className="an-pop" onKeyDown={keep}>
      <SearchBox value={q} onChange={setQ} placeholder={t('an.f.search')} autoFocus />
      <div className="an-seg" role="radiogroup" aria-label={t('an.f.tags')}>
        {['any', 'all'].map(m => (
          <button key={m} type="button" role="radio" aria-checked={rules.tagMode === m} className={rules.tagMode === m ? 'on' : ''}
            onClick={() => setRules(r => ({ ...r, tagMode: m }))}>{t('an.f.tagMode.' + m)}</button>
        ))}
      </div>
      <div className="an-pop-list">
        {list.map(x => <Check key={x.tag} checked={picked.has(x.tag.toLowerCase())} onChange={() => toggle(x.tag)} count={x.count}>#{x.tag}</Check>)}
        {!list.length && <div className="an-pop-empty">{t('an.f.none')}</div>}
      </div>
    </div>
  );
}

// Carpetas (con sus subcarpetas) y «Sin carpeta».
export function FoldersFacet({ folderRows, rules, setRules, looseCount }) {
  const [q, setQ] = useState('');
  const picked = new Set(rules.folders);
  const list = useMemo(() => {
    const f = foldText(q);
    return folderRows.filter(x => !f || foldText(x.name).includes(f)).slice(0, SHOWN);
  }, [folderRows, q]);
  const toggle = (id) => setRules(r => ({ ...r, folders: picked.has(id) ? r.folders.filter(x => x !== id) : [...r.folders, id] }));
  return (
    <div className="an-pop" onKeyDown={keep}>
      <SearchBox value={q} onChange={setQ} placeholder={t('an.f.search')} autoFocus />
      <div className="an-pop-list">
        {!q && <Check checked={rules.noFolder} onChange={() => setRules(r => ({ ...r, noFolder: !r.noFolder }))} count={looseCount}>{t('an.f.noFolder')}</Check>}
        {list.map(x => (
          <Check key={x.id} checked={picked.has(x.id)} onChange={() => toggle(x.id)} count={x.count} indent={q ? 0 : x.depth} title={x.path}>
            <Icon name="folder" size={13} /> {x.name}
          </Check>
        ))}
        {!list.length && <div className="an-pop-empty">{t('an.f.none')}</div>}
      </div>
    </div>
  );
}

export function TypesFacet({ rules, setRules, counts }) {
  const picked = new Set(rules.types);
  const toggle = (ty) => setRules(r => ({ ...r, types: picked.has(ty) ? r.types.filter(x => x !== ty) : [...r.types, ty] }));
  return (
    <div className="an-pop an-pop-sm" onKeyDown={keep}>
      <div className="an-pop-list">
        {['note', 'canvas', 'database'].map(ty => (
          <Check key={ty} checked={picked.has(ty)} onChange={() => toggle(ty)} count={counts[ty] || 0}>
            <Icon name={ty === 'note' ? 'note' : ty} size={14} /> {t('an.type.' + ty)}
          </Check>
        ))}
      </div>
    </div>
  );
}

export function UpdatedFacet({ rules, setRules, close }) {
  const pick = (n) => { setRules(r => ({ ...r, updated: n })); close(); };
  return (
    <div className="an-pop an-pop-sm" onKeyDown={keep}>
      <div className="an-pop-list" role="radiogroup">
        <Check radio checked={!rules.updated} onChange={() => pick(null)}>{t('an.f.upd.any')}</Check>
        {UPDATED_CHOICES.map(n => <Check radio key={n} checked={rules.updated === n} onChange={() => pick(n)}>{t('an.f.upd.' + n)}</Check>)}
      </div>
    </div>
  );
}

// Pregunta un nombre: para guardar una colección o renombrarla.
export function NameForm({ initial = '', submitLabel, onSubmit, close }) {
  const [name, setName] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) { ref.current.focus(); ref.current.select(); } }, []);
  const go = () => { const v = name.trim(); if (!v) return; close(); onSubmit(v); };
  return (
    <form className="an-pop an-name" onKeyDown={keep} onSubmit={(e) => { e.preventDefault(); go(); }}>
      <label className="an-name-label">{t('an.col.name')}</label>
      <input ref={ref} className="an-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} spellCheck={false}
        placeholder={t('an.col.untitled')} />
      <button type="submit" className="an-btn an-btn-primary" disabled={!name.trim()}>{submitLabel}</button>
    </form>
  );
}

// «Mostrar»: orden, sentido y agrupación.
export function DisplayPanel({ view, setView }) {
  const row = (label, key, values, fmt) => (
    <div className="an-disp-row">
      <div className="an-disp-label">{label}</div>
      <div className="an-seg an-seg-wrap" role="radiogroup" aria-label={label}>
        {values.map(v => (
          <button key={v} type="button" role="radio" aria-checked={view[key] === v} className={view[key] === v ? 'on' : ''}
            onClick={() => setView(p => ({ ...p, [key]: v }))}>{fmt(v)}</button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="an-pop an-disp" onKeyDown={keep}>
      {row(t('an.sort'), 'sort', ['modified', 'created', 'title', 'opened'], v => t('an.sort.' + v))}
      {row(t('an.dir'), 'dir', ['desc', 'asc'], v => t('an.dir.' + v))}
      {row(t('an.group'), 'group', ['date', 'folder', 'type', 'none'], v => t('an.group.' + v))}
    </div>
  );
}
