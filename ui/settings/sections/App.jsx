// Aplicación: «Editor» e «Idioma y región». Antes en GeneralPane.

import { t, useI18n, setLang, supportedLangs } from '../../../i18n.js';
import { Row, Switch, Segmented, Select } from '../controls.jsx';
import { rowProps } from '../registry.js';
import { isElectron } from '../util.js';
import { formatShortDate } from '../../shared/region.js';

export function EditorSection({ ctx }) {
  useI18n();
  const { settings, setSettings } = ctx;
  const set = (k) => (v) => setSettings(prev => ({ ...prev, [k]: v }));
  const desktop = isElectron();
  return (
    <>
      <Row {...rowProps('editor.newMode')}>
        <Segmented label={t('st.row.editor.newMode')} value={settings.newNoteMode === 'render' ? 'render' : 'live'}
          onChange={set('newNoteMode')}
          options={[
            { value: 'live', label: t('shell.mode.edit') },
            { value: 'render', label: t('shell.mode.read') },
          ]} />
      </Row>
      <Row {...rowProps('editor.autosave')}>
        <Switch label={t('st.row.editor.autosave')} checked={!!settings.autosave} onChange={set('autosave')} />
      </Row>
      <Row {...rowProps('editor.ruler')}>
        <Switch label={t('st.row.editor.ruler')} checked={!!settings.ruler} onChange={set('ruler')} />
      </Row>
      <Row {...rowProps('editor.vim')}>
        <Switch label={t('st.row.editor.vim')} checked={!!settings.vim} onChange={set('vim')} />
      </Row>
      <Row {...rowProps('editor.spellcheck', desktop ? null : { help: t('st.row.editor.spellcheck.h') + ' ' + t('st.desktopOnly') })}>
        <Switch label={t('st.row.editor.spellcheck')} checked={settings.spellcheck !== false} onChange={set('spellcheck')} />
      </Row>
      <Row {...rowProps('editor.searchAll')} last>
        <Switch label={t('st.row.editor.searchAll')} checked={settings.searchAllVaults !== false} onChange={set('searchAllVaults')} />
      </Row>
    </>
  );
}

export function LanguageSection({ ctx }) {
  const { lang } = useI18n();
  const { settings, setSettings } = ctx;
  const sample = Date.UTC(2026, 11, 31, 12);
  return (
    <>
      <Row {...rowProps('language.lang')}>
        <Select label={t('st.row.language.lang')} value={lang} onChange={(v) => setLang(v)}
          options={supportedLangs().map(code => ({ value: code, label: t('general.language.' + code) }))} />
      </Row>
      <Row {...rowProps('language.weekStart')}>
        <Segmented label={t('st.row.language.weekStart')} value={settings.weekStart || 'mon'}
          onChange={(v) => setSettings(prev => ({ ...prev, weekStart: v }))}
          options={[
            { value: 'mon', label: t('st.week.mon') },
            { value: 'sun', label: t('st.week.sun') },
            { value: 'sat', label: t('st.week.sat') },
          ]} />
      </Row>
      <Row {...rowProps('language.dateFormat')} last>
        <Select label={t('st.row.language.dateFormat')} value={settings.dateFormat || 'auto'} minWidth={220}
          onChange={(v) => setSettings(prev => ({ ...prev, dateFormat: v }))}
          options={['auto', 'dmy', 'mdy', 'ymd'].map(f => ({ value: f, label: t('st.datefmt.' + f), hint: formatShortDate(sample, f) }))} />
      </Row>
    </>
  );
}
