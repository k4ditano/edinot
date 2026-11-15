// «Avanzado y diagnóstico»: registro de la app, logo de exportación y
// restablecer. (Las actualizaciones y «acerca de» están en «Acerca de y
// actualizaciones», sections/About.jsx.)

import { useState } from 'react';
import { t, useI18n } from '../../../i18n.js';
import { Icon } from '../../shell/icons.jsx';
import { Row, Group, Button, Segmented, Notice } from '../controls.jsx';
import { rowProps } from '../registry.js';
import { isElectron } from '../util.js';

const UI_LAYOUT_KEYS = ['edinot.shell.sidebar.v1', 'edinot.shell.panel.v1', 'edinot.shell.tree.v1', 'edinot.shell.tplOpen.v1'];

export function AdvancedSection({ ctx }) {
  useI18n();
  const { settings, setSettings } = ctx;
  const [note, setNote] = useState(null);
  const desktop = isElectron();

  // Company logo for export letterheads — stored inline as a data URL in
  // settings so it syncs across devices and embeds in the exported file.
  const onLogoPick = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { window.alert(t('general.exportLogo.tooBig')); return; }
    const reader = new FileReader();
    reader.onload = () => setSettings(prev => ({ ...prev, exportLogo: String(reader.result || '') }));
    reader.onerror = () => window.alert(t('general.exportLogo.readFail'));
    reader.readAsDataURL(file);
  };

  const openLog = async () => {
    if (!window.electronAPI || !window.electronAPI.logReveal) return;
    try { await window.electronAPI.logReveal(); } catch {}
  };
  const copyLog = async () => {
    if (!window.electronAPI || !window.electronAPI.logTail) return;
    try {
      const r = await window.electronAPI.logTail(200_000);
      if (r && r.text) {
        await navigator.clipboard.writeText(r.text);
        setNote({ tone: 'ok', text: t('st.adv.logCopied') });
      }
    } catch {}
  };
  const purgeCache = async () => {
    if (!window.electronAPI || !window.electronAPI.blobPurgeCache) return;
    const ok = await (window.__edinotConfirm ? window.__edinotConfirm(t('st.adv.purgeConfirm'), { title: t('st.adv.purge') }) : Promise.resolve(true));
    if (!ok) return;
    await window.electronAPI.blobPurgeCache();
    setNote({ tone: 'ok', text: t('st.adv.purged') });
  };
  const resetLayout = async () => {
    const ok = await (window.__edinotConfirm ? window.__edinotConfirm(t('st.adv.resetLayoutConfirm'), { title: t('st.adv.resetLayout') }) : Promise.resolve(true));
    if (!ok) return;
    try { for (const k of UI_LAYOUT_KEYS) localStorage.removeItem(k); } catch {}
    window.location.reload();
  };

  return (
    <>
      <Row {...rowProps('advanced.logs')}>
        <Button onClick={openLog} disabled={!desktop}>{t('st.adv.openLog')}</Button>
        <Button onClick={copyLog} disabled={!desktop}><Icon name="copy" size={14} />{t('st.adv.copyLog')}</Button>
      </Row>
      <Row {...rowProps('advanced.exportLogo', { help: t('general.exportLogo.tip') })}>
        {settings.exportLogo
          ? <img src={settings.exportLogo} alt={t('general.exportLogo')} className="st-logo" />
          : <span className="st-hint">{t('general.exportLogo.none')}</span>}
        <label className="ui-btn ui-btn-secondary" style={{ cursor: 'pointer' }}>
          {settings.exportLogo ? t('general.exportLogo.change') : t('general.exportLogo.add')}
          <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={onLogoPick} />
        </label>
        {settings.exportLogo && (
          <Button variant="danger" onClick={() => setSettings(prev => ({ ...prev, exportLogo: '' }))}>{t('general.exportLogo.remove')}</Button>
        )}
      </Row>
      {settings.exportLogo && (
        <Row id="advanced.exportLogo.align" label={t('general.exportLogo.align')} help={t('st.adv.alignHelp')}>
          <Segmented label={t('general.exportLogo.align')} value={settings.exportLogoAlign || 'left'}
            onChange={(v) => setSettings(prev => ({ ...prev, exportLogoAlign: v }))}
            options={[
              { value: 'left', label: t('general.exportLogo.left') },
              { value: 'center', label: t('general.exportLogo.center') },
              { value: 'right', label: t('general.exportLogo.right') },
            ]} />
        </Row>
      )}
      <Row {...rowProps('advanced.reset')} last>
        <Button onClick={resetLayout}>{t('st.adv.resetLayout')}</Button>
        <Button variant="danger" onClick={purgeCache} disabled={!desktop}>{t('st.adv.purge')}</Button>
      </Row>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
    </>
  );
}
