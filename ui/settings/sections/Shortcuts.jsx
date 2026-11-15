// Atajos de teclado: lista por áreas, búsqueda, reasignación con detección de
// conflictos. Las personalizaciones van a ySettings.shortcuts; el keydown
// de editor.jsx y el menú de Electron leen las combinaciones efectivas del
// registro (ui/shared/shortcuts.js).

import { useState, useMemo, useEffect, useRef } from 'react';
import { t, useI18n } from '../../../i18n.js';
import {
  SHORTCUT_DEFS, SHORTCUT_AREAS, SHORTCUT_BY_ID, effectiveBindings, findConflicts,
  comboFromEvent, comboKeys, isModifierKey, whoUses,
} from '../../shared/shortcuts.js';
import { Icon } from '../../shell/icons.jsx';
import { Row, Group, Button, Kbd } from '../controls.jsx';
import { rowProps } from '../registry.js';
import { isElectron } from '../util.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function Recorder({ def, combo, isMac, conflict, onSet, onClear }) {
  const [rec, setRec] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e) => {
      // Capturamos antes que el manejador global (y que CodeMirror).
      e.preventDefault();
      e.stopPropagation();
      if (isModifierKey(e.key)) return;
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { setRec(false); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) { onClear(); setRec(false); return; }
      const c = comboFromEvent(e);
      if (!c) return;
      onSet(c);
      setRec(false);
    };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setRec(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onDown, true); };
  }, [rec, onSet, onClear]);
  useEffect(() => { if (!rec && ref.current && document.activeElement === document.body) ref.current.focus(); }, [rec]);
  const label = t(def.label);
  if (rec) {
    return (
      <button type="button" ref={ref} className="st-kbd-btn rec" aria-live="polite"
        aria-label={t('st.sc.recordingAria', { name: label })} onClick={() => setRec(false)}>
        {t('st.sc.recording')}
      </button>
    );
  }
  return (
    <button type="button" ref={ref} className={`st-kbd-btn${conflict ? ' conflict' : ''}`}
      aria-label={t('st.sc.changeAria', { name: label, combo: combo ? comboKeys(combo, isMac).join(' ') : t('st.sc.none') })}
      title={t('st.sc.changeTip')}
      onClick={() => setRec(true)}>
      {combo ? <Kbd keys={comboKeys(combo, isMac)} /> : <span className="st-kbd-none">{t('st.sc.none')}</span>}
    </button>
  );
}

export function ShortcutsSection({ ctx }) {
  useI18n();
  const { settings, setSettings, isMac } = ctx;
  const desktop = isElectron();
  const overrides = (settings.shortcuts && typeof settings.shortcuts === 'object') ? settings.shortcuts : {};
  const bindings = useMemo(() => effectiveBindings(overrides), [overrides]);
  const conflicts = useMemo(() => findConflicts(bindings), [bindings]);
  const [q, setQ] = useState('');
  const [lastMsg, setLastMsg] = useState(null);

  const write = (next) => setSettings(prev => ({ ...prev, shortcuts: next }));
  const setCombo = (id, combo) => {
    const def = SHORTCUT_BY_ID[id];
    const next = { ...overrides };
    if (combo === def.combo) delete next[id]; else next[id] = combo;
    write(next);
    const others = whoUses(combo, effectiveBindings(next), id);
    setLastMsg(others.length ? { tone: 'error', text: t('st.sc.conflictSet', { combo: comboKeys(combo, isMac).join(isMac ? '' : '+'), others: others.map(o => t(SHORTCUT_BY_ID[o].label)).join(', ') }) } : null);
  };
  const clearCombo = (id) => { write({ ...overrides, [id]: '' }); setLastMsg(null); };
  const resetOne = (id) => { const next = { ...overrides }; delete next[id]; write(next); setLastMsg(null); };
  const resetAll = () => { write({}); setLastMsg(null); };
  const modifiedCount = Object.keys(overrides).filter(k => SHORTCUT_BY_ID[k] && !SHORTCUT_BY_ID[k].fixed).length;

  const words = fold(q).split(/\s+/).filter(Boolean);
  const visible = SHORTCUT_DEFS.filter(d => {
    if (d.electron && !desktop) return false;
    if (!words.length) return true;
    const combo = d.follows ? bindings[d.follows] : bindings[d.id];
    const hay = fold(`${t(d.label)} ${t('st.sc.area.' + d.area)} ${combo ? comboKeys(combo, isMac).join(' ') : ''} ${d.id}`);
    return words.every(w => hay.includes(w));
  });
  const nConflicts = Object.keys(conflicts).length;

  return (
    <>
      <div data-setting-id="shortcuts.list" className="st-sc-top">
        <label className="st-search" style={{ margin: 0 }}>
          <Icon name="search" size={14} stroke={1.8} />
          <span className="sr-only">{t('st.sc.searchPh')}</span>
          <input type="search" placeholder={t('st.sc.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {nConflicts > 0 && <div className="st-notice error" role="alert">{t('st.sc.conflictsN', { n: nConflicts })}</div>}
        {lastMsg && <div className={`st-notice ${lastMsg.tone}`} role="status">{lastMsg.text}</div>}
      </div>
      {SHORTCUT_AREAS.map(area => {
        const defs = visible.filter(d => d.area === area);
        if (!defs.length) return null;
        return (
          <Group key={area} title={t('st.sc.area.' + area)}>
            {area === 'fixed' && <p className="st-hint" style={{ margin: '0 0 6px' }}>{t('st.sc.fixedHint')}</p>}
            {area === 'file' && <p className="st-hint" style={{ margin: '0 0 6px' }}>{t('st.sc.menuHint')}</p>}
            {defs.map(d => {
              const combo = d.follows ? bindings[d.follows] : bindings[d.id];
              const modified = !d.fixed && Object.prototype.hasOwnProperty.call(overrides, d.id);
              const conf = conflicts[d.id];
              const help = d.follows ? t('st.sc.follows', { name: t(SHORTCUT_BY_ID[d.follows].label) }) : null;
              return (
                <div key={d.id} className="st-row st-shortcut-row" data-setting-id={'sc:' + d.id}>
                  <div className="st-lbl">
                    <span className="st-lbl-t">{t(d.label)}{modified && <span className="st-modified">{t('st.sc.modified')}</span>}</span>
                    {help && <span className="st-lbl-h">{help}</span>}
                    {conf && <span className="st-conflict">{t('st.sc.conflictWith', { others: conf.map(o => t(SHORTCUT_BY_ID[o].label)).join(', ') })}</span>}
                  </div>
                  <div className="st-ctl">
                    {d.fixed
                      ? (combo ? <Kbd keys={comboKeys(combo, isMac)} /> : null)
                      : <Recorder def={d} combo={combo} isMac={isMac} conflict={!!conf}
                          onSet={(c) => setCombo(d.id, c)} onClear={() => clearCombo(d.id)} />}
                    {modified && (
                      <button type="button" className="st-li-ic" aria-label={t('st.sc.resetOne', { name: t(d.label) })} title={t('st.sc.resetOneTip')}
                        onClick={() => resetOne(d.id)}>
                        <Icon name="history" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </Group>
        );
      })}
      {!visible.length && <p className="st-hint">{t('st.search.none')}</p>}
      <div style={{ marginTop: 32 }}>
        <Row {...rowProps('shortcuts.reset', { help: modifiedCount ? t('st.sc.modifiedN', { n: modifiedCount }) : t('st.row.shortcuts.reset.h') })} last>
          <Button onClick={resetAll} disabled={!Object.keys(overrides).length}>{t('st.sc.resetAll')}</Button>
        </Row>
      </div>
    </>
  );
}
