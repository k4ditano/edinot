// Ajustes como página completa (routeView === 'settings'): columna de
// navegación con buscador y grupos, y una columna de contenido de 720px con
// título, descripción y filas. Sustituye al antiguo modal SettingsMenu de
// editor.jsx; cada sección vive en ./sections/*.
//
// Deep links: `initialTab` acepta los ids viejos del modal ('sync', 'ai',
// 'recall'…), un id de sección o «sección:fila» (ver registry.resolveTarget).

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { t, useI18n } from '../../i18n.js';
import { Icon } from '../shell/icons.jsx';
import { ensureSettingsStyles } from './styles.js';
import { GROUPS, SECTIONS, SECTION_IDS, SECTION_ALIASES, sectionTitle, sectionDesc, resolveTarget, searchSettings } from './registry.js';
import { AppearanceSection } from './sections/Appearance.jsx';
import { ShortcutsSection } from './sections/Shortcuts.jsx';
import { VaultsSection } from './sections/Data.jsx';
import { SyncSection } from './sections/Sync.jsx';
import { MeetingsSection } from './sections/Meetings.jsx';
import { GeneralSection, ConnectionsSection, AboutSystemSection } from './sections/Composite.jsx';
import { isElectron, isMacPlatform } from './util.js';
import { usePrefersReducedMotion } from '../shared/themes.js';

ensureSettingsStyles();

const SECTION_COMPONENTS = {
  general: GeneralSection,
  appearance: AppearanceSection,
  shortcuts: ShortcutsSection,
  vaults: VaultsSection,
  sync: SyncSection,
  connections: ConnectionsSection,
  meetings: MeetingsSection,
  about: AboutSystemSection,
};

const LAST_KEY = 'edinot.settings.section.v1';
const readLast = () => { try { const raw = localStorage.getItem(LAST_KEY); const v = SECTION_ALIASES[raw] || raw; return SECTION_IDS.includes(v) ? v : null; } catch { return null; } };

function Highlight({ text, words }) {
  if (!words.length) return text;
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const f = fold(text);
  for (const w of words) {
    const i = f.indexOf(w);
    if (i >= 0) return <>{text.slice(0, i)}<mark>{text.slice(i, i + w.length)}</mark>{text.slice(i + w.length)}</>;
  }
  return text;
}

export function SettingsPage(props) {
  useI18n();
  const { initialTab, onClose } = props;
  const first = resolveTarget(initialTab);
  const [section, setSection] = useState(() => (first && first.section) || readLast() || 'general');
  const [pendingRow, setPendingRow] = useState(() => (first && first.row) || null);
  const [query, setQuery] = useState('');
  const [kfocus, setKfocus] = useState(0);
  const mainRef = useRef(null);
  const searchRef = useRef(null);
  const osReducedMotion = usePrefersReducedMotion();
  const isMac = isMacPlatform();

  const goTo = useCallback((sec, row = null) => {
    if (!SECTION_IDS.includes(sec)) return;
    setSection(sec);
    setPendingRow(row || '__top__');
    try { localStorage.setItem(LAST_KEY, sec); } catch {}
  }, []);

  // Deep link mientras la página ya está abierta (p. ej. el punto de sync).
  const lastTab = useRef(initialTab);
  useEffect(() => {
    if (initialTab === lastTab.current) return;
    lastTab.current = initialTab;
    const r = resolveTarget(initialTab);
    if (r) goTo(r.section, r.row);
  }, [initialTab, goTo]);

  // Desplazar a la fila pedida y resaltarla.
  useLayoutEffect(() => {
    if (!pendingRow) return;
    const main = mainRef.current;
    if (!main) return;
    if (pendingRow === '__top__') { main.scrollTop = 0; setPendingRow(null); return; }
    const el = main.querySelector(`[data-setting-id="${CSS.escape(pendingRow)}"]`);
    setPendingRow(null);
    if (!el) { main.scrollTop = 0; return; }
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('st-flash');
    void el.offsetWidth;
    el.classList.add('st-flash');
    setTimeout(() => el.classList.remove('st-flash'), 1700);
    const f = el.querySelector('button:not([disabled]), input:not([disabled]), textarea, [tabindex="0"]');
    if (f) f.focus({ preventScroll: true });
  }, [pendingRow, section]);

  const results = useMemo(() => searchSettings(query, { isElectron: isElectron() }).slice(0, 40), [query]);
  const words = useMemo(() => query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean), [query]);
  useEffect(() => { setKfocus(0); }, [query]);

  const pickResult = (r) => { goTo(r.section, r.id); };

  // Esc vuelve a la vista anterior (salvo con un modal encima o texto en
  // el buscador, que se borra primero).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.dropdown-backdrop, .ui-listbox, .ui-popover')) return;
      if (query && document.activeElement === searchRef.current) { e.preventDefault(); setQuery(''); return; }
      e.preventDefault();
      onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, onClose]);

  // Ctrl/⌘ F dentro de Ajustes enfoca el buscador de ajustes.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !document.querySelector('.st-kbd-btn.rec')) {
        e.preventDefault(); e.stopPropagation();
        searchRef.current && searchRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const ctx = {
    ...props,
    goTo,
    target: pendingRow,   // fila a la que se va (enlace o buscador): lo usan las secciones con partes plegadas
    isMac,
    osReducedMotion,
  };
  const Section = SECTION_COMPONENTS[section] || GeneralSection;

  const navItem = (s) => (
    <button type="button" key={s.id}
      className={`st-sn${s.group === 'footer' ? ' st-sn-adv' : ''}`}
      aria-current={section === s.id ? 'page' : undefined}
      onClick={() => goTo(s.id)}>
      {sectionTitle(s.id)}
    </button>
  );

  return (
    <div className="st-page">
      <nav className="st-nav" aria-label={t('settings.title')}>
        <div className="st-nav-head">
          <button type="button" className="sh-iconbtn st-back" onClick={onClose} aria-label={t('st.back')} title={t('st.back') + ' (Esc)'}>
            <Icon name="back" size={16} />
          </button>
          <h1 style={{ marginLeft: 2 }}>{t('settings.title')}</h1>
        </div>
        <label className="st-search">
          <Icon name="search" size={14} stroke={1.8} />
          <span className="sr-only">{t('st.search.ph')}</span>
          <input ref={searchRef} type="text" placeholder={t('st.search.ph')} value={query}
            role="combobox" aria-expanded={!!query} aria-controls="st-search-results" aria-autocomplete="list"
            aria-activedescendant={query && results[kfocus] ? `st-sr-${kfocus}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (!query) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setKfocus(k => Math.min(results.length - 1, k + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setKfocus(k => Math.max(0, k - 1)); }
              else if (e.key === 'Enter' && results[kfocus]) { e.preventDefault(); pickResult(results[kfocus]); }
            }} />
          {query && (
            <button type="button" className="st-search-clear" aria-label={t('st.search.clear')} onClick={() => { setQuery(''); searchRef.current && searchRef.current.focus(); }}>
              <Icon name="close" size={12} stroke={2} />
            </button>
          )}
        </label>
        <div className="st-nav-scroll">
          {query ? (
            <div id="st-search-results" role="listbox" aria-label={t('st.search.results')}>
              <h2 className="st-grp" aria-live="polite">{results.length === 1 ? t('st.search.one') : results.length ? t('st.search.n', { n: results.length }) : t('st.search.none')}</h2>
              {results.map((r, i) => (
                <button type="button" key={r.id} id={`st-sr-${i}`} role="option" aria-selected={i === kfocus}
                  className={`st-sn st-sr${i === kfocus ? ' kfocus' : ''}`}
                  onMouseEnter={() => setKfocus(i)}
                  onClick={() => pickResult(r)}>
                  <span><Highlight text={r.label} words={words} /></span>
                  <span className="st-sr-sec">{sectionTitle(r.section)}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {GROUPS.map(g => {
                const items = SECTIONS.filter(s => s.group === g.id);
                if (g.id === 'footer') return <div key={g.id} className="st-nav-spacer" />;
                return (
                  <div key={g.id} role="group" aria-labelledby={`st-g-${g.id}`}>
                    <h2 className="st-grp" id={`st-g-${g.id}`}>{t(g.title)}</h2>
                    {items.map(navItem)}
                  </div>
                );
              })}
              {SECTIONS.filter(s => s.group === 'footer').map(navItem)}
            </>
          )}
        </div>
      </nav>
      <main className="st-main" ref={mainRef} aria-labelledby="st-title">
        <div className="st-col" key={section}>
          <h2 className="st-title" id="st-title">{sectionTitle(section)}</h2>
          <p className="st-desc">{sectionDesc(section)}</p>
          <Section ctx={ctx} />
        </div>
      </main>
    </div>
  );
}
