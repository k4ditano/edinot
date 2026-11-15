// Apariencia: tema (Claro · Oscuro · Como el sistema + «Más temas»),
// acento, letra de las notas, tamaño, ancho de lectura, interfaz compacta y
// reducir animaciones. Antes: ThemePane + parte de GeneralPane.
// Persistencia sin cambios: themeKey en yMeta; el resto en ySettings
// (accentOverride, editorFont, fontSize, width) + compactUi y reduceMotion.

import { useState, useRef } from 'react';
import { t, useI18n } from '../../../i18n.js';
import { THEMES, ACCENT_PRESETS, NAMED_ACCENTS, SYSTEM_THEME, LIGHT_THEME, DARK_THEME } from '../../shared/themes.js';
import { Icon } from '../../shell/icons.jsx';
import { Row, Segmented, Slider, Switch, Swatches, Popover } from '../controls.jsx';
import { rowProps } from '../registry.js';

function ThemePreview({ th }) {
  const side = th.side || `color-mix(in srgb, ${th.bg} 95%, ${th.fg})`;
  const line = th.line || `color-mix(in srgb, ${th.bg} 87.5%, ${th.fg})`;
  const text = `color-mix(in srgb, ${th.bg} 78%, ${th.fg})`;
  return (
    <span className="st-theme-prev" style={{ background: th.bg }} aria-hidden="true">
      <span className="st-theme-side" style={{ background: side, borderRight: `1px solid ${line}` }} />
      <span className="st-theme-body">
        <i style={{ background: th.fg }} />
        <i style={{ background: text }} />
        <i style={{ background: th.accent, opacity: 0.85 }} />
      </span>
    </span>
  );
}

function ThemeCard({ pressed, onClick, name, children }) {
  return (
    <button type="button" className="st-theme" aria-pressed={pressed} onClick={onClick}>
      {children}
      <span className="st-theme-name">{name}{pressed && <Icon name="check" size={16} stroke={2.4} />}</span>
    </button>
  );
}

export function AppearanceSection({ ctx }) {
  useI18n();
  const { settings, setSettings, themeKey, setThemeKey, osReducedMotion, effectiveThemeKey } = ctx;
  // Acento «del tema»: el del tema que se está pintando (con «Como el
  // sistema», el claro o el oscuro según el SO).
  const themeAccent = (THEMES[effectiveThemeKey] || THEMES[themeKey] || THEMES.edinot).accent;
  const override = (settings && settings.accentOverride) || null;
  const setOverride = (v) => setSettings(prev => ({ ...prev, accentOverride: v }));
  const named = NAMED_ACCENTS.map(a => a.color.toLowerCase());
  const isCustom = !!override && !named.includes(override.toLowerCase());
  const [popOpen, setPopOpen] = useState(false);
  const plusRef = useRef(null);
  const moreKeys = Object.keys(THEMES).filter(k => k !== LIGHT_THEME && k !== DARK_THEME);
  const reduceMotion = typeof settings.reduceMotion === 'boolean' ? settings.reduceMotion : !!osReducedMotion;

  const swatchOptions = [
    { value: '__theme', color: themeAccent, label: t('st.accent.theme') },
    ...NAMED_ACCENTS.map(a => ({ value: a.color, color: a.color, label: t('st.accent.' + a.id) })),
  ];
  const swValue = !override ? '__theme' : (named.includes(override.toLowerCase()) ? NAMED_ACCENTS[named.indexOf(override.toLowerCase())].color : null);

  return (
    <>
      <div className="st-themes" role="group" aria-label={t('st.row.appearance.theme')} data-setting-id="appearance.theme">
        <ThemeCard pressed={themeKey === LIGHT_THEME || (!THEMES[themeKey] && themeKey !== SYSTEM_THEME)} onClick={() => setThemeKey(LIGHT_THEME)} name={t('st.theme.light')}>
          <ThemePreview th={THEMES.edinot} />
        </ThemeCard>
        <ThemeCard pressed={themeKey === DARK_THEME} onClick={() => setThemeKey(DARK_THEME)} name={t('st.theme.dark')}>
          <ThemePreview th={THEMES.edinotDark} />
        </ThemeCard>
        <ThemeCard pressed={themeKey === SYSTEM_THEME} onClick={() => setThemeKey(SYSTEM_THEME)} name={t('st.theme.system')}>
          <span className="st-theme-prev st-theme-sys" aria-hidden="true" />
        </ThemeCard>
      </div>

      <Row {...rowProps('appearance.accent')}>
        <Swatches label={t('st.row.appearance.accent')} value={swValue}
          options={swatchOptions}
          onChange={(v) => setOverride(v === '__theme' ? null : v)} />
        <button type="button" ref={plusRef}
          className={`st-custom-sw${isCustom ? ' on' : ''}`}
          style={isCustom ? { background: override, '--sw': override } : undefined}
          aria-label={t('theme.accent.custom')} title={t('theme.accent.custom')}
          aria-haspopup="dialog" aria-expanded={popOpen}
          onClick={() => setPopOpen(o => !o)}>
          {isCustom ? <Icon name="check" size={13} stroke={2.4} /> : <Icon name="plus" size={12} stroke={2.2} />}
        </button>
        <Popover anchorRef={plusRef} open={popOpen} onClose={() => setPopOpen(false)} label={t('theme.accent.custom')} width={236}>
          <div className="st-pop-t">{t('st.accent.presets')}</div>
          <div className="st-pop-grid">
            {ACCENT_PRESETS.map(c => (
              <button type="button" key={c} className={`ui-swatch${override === c ? ' on' : ''}`}
                style={{ background: c, '--sw': c }} aria-label={c} aria-pressed={override === c}
                onClick={() => setOverride(c)} />
            ))}
          </div>
          <label className="st-pop-row">
            <input type="color" value={override || themeAccent} onChange={(e) => setOverride(e.target.value)} />
            <span>{t('st.accent.pick')}</span>
          </label>
        </Popover>
      </Row>

      <Row {...rowProps('appearance.font')}>
        <Segmented label={t('st.row.appearance.font')} value={settings.editorFont || 'sans'}
          onChange={(v) => setSettings(prev => ({ ...prev, editorFont: v }))}
          options={[
            { value: 'sans', label: t('st.font.sans') },
            { value: 'serif', label: t('st.font.serif'), style: { fontFamily: 'var(--font-serif)', fontSize: 14 } },
            { value: 'mono', label: t('st.font.mono'), style: { fontFamily: 'var(--font-mono)', fontSize: 12 } },
          ]} />
      </Row>

      <Row {...rowProps('appearance.size', { help: `${settings.fontSize} px` })}>
        <Slider label={t('st.row.appearance.size')} min={13} max={20} step={1}
          value={Number(settings.fontSize) || 16} minLabel="A" maxLabel="A"
          valueText={`${settings.fontSize} px`}
          onChange={(v) => setSettings(prev => ({ ...prev, fontSize: v }))} />
      </Row>

      <Row {...rowProps('appearance.width')}>
        <Segmented label={t('st.row.appearance.width')} value={settings.width || 'medium'}
          onChange={(v) => setSettings(prev => ({ ...prev, width: v }))}
          options={[
            { value: 'narrow', label: t('general.width.narrow') },
            { value: 'medium', label: t('general.width.medium') },
            { value: 'wide', label: t('st.width.full') },
          ]} />
      </Row>

      <Row {...rowProps('appearance.compact')}>
        <Switch label={t('st.row.appearance.compact')} checked={!!settings.compactUi}
          onChange={(v) => setSettings(prev => ({ ...prev, compactUi: v }))} />
      </Row>

      <Row {...rowProps('appearance.motion', { help: t('st.row.appearance.motion.h') + (typeof settings.reduceMotion !== 'boolean' ? ' ' + t('st.motion.followsOs') : '') })}>
        <Switch label={t('st.row.appearance.motion')} checked={reduceMotion}
          onChange={(v) => setSettings(prev => ({ ...prev, reduceMotion: v }))} />
      </Row>

      <Row {...rowProps('appearance.moreThemes')} stack last>
        <div className="st-themes more">
          {moreKeys.map(k => {
            const th = THEMES[k];
            return (
              <ThemeCard key={k} pressed={themeKey === k} onClick={() => setThemeKey(k)} name={th.name}>
                <ThemePreview th={th} />
              </ThemeCard>
            );
          })}
        </div>
      </Row>
    </>
  );
}
