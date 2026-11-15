// «Acerca de y actualizaciones»: versión instalada, estado de las
// actualizaciones (buscar, descargar, instalar y reiniciar) y el sitio web.
// `UpdatesRow` es la de siempre (antes vivía en «Avanzado y diagnóstico») sin
// tocar su lógica: en Mac sin firmar tiene un flujo manual delicado.

import { useState, useEffect } from 'react';
import { t, useI18n } from '../../../i18n.js';
import { Icon } from '../../shell/icons.jsx';
import { Row, Button } from '../controls.jsx';
import { rowProps } from '../registry.js';

function UpdatesRow() {
  useI18n();
  const [status, setStatus] = useState({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');
  // Side-channel for the unsigned-Mac manual download flow. electron-updater
  // refuses to operate without an Apple Developer ID, so we run a parallel
  // "fetch the .zip and reveal in Finder" flow when status.state ===
  // 'unsupported'. Kept out of the main `status` object so it doesn't
  // collide with electron-updater's state machine.
  const [macManual, setMacManual] = useState({ phase: 'idle' });

  useEffect(() => {
    let off = null;
    let offProgress = null;
    (async () => {
      if (!window.electronAPI?.updateGetStatus) return;
      try { setStatus(await window.electronAPI.updateGetStatus()); } catch {}
    })();
    if (window.electronAPI?.appGetVersion) {
      window.electronAPI.appGetVersion().then(v => setCurrentVersion(v || '')).catch(() => {});
    }
    if (window.electronAPI?.on) {
      off = window.electronAPI.on('update:status', (s) => setStatus(s || { state: 'idle' }));
      offProgress = window.electronAPI.on('update:macDownloadProgress', (p) => {
        setMacManual(prev => prev.phase === 'downloading' ? { ...prev, transferred: p.transferred, total: p.total, percent: p.percent } : prev);
      });
    }
    return () => { if (off) off(); if (offProgress) offProgress(); };
  }, []);

  // When the updater bails on an unsigned Mac build, kick off the manual
  // check exactly once so the card can tell the user whether a newer
  // version is published. No automatic download — the user clicks.
  useEffect(() => {
    if (status.state !== 'unsupported') return;
    if (!window.electronAPI?.updateMacManualCheck) return;
    if (macManual.phase !== 'idle') return;
    setMacManual({ phase: 'checking' });
    window.electronAPI.updateMacManualCheck().then(r => {
      if (!r || !r.ok) { setMacManual({ phase: 'error', error: (r && r.reason) || 'check-failed' }); return; }
      setMacManual({
        phase: r.isNewer ? 'available' : 'same',
        version: r.version, downloadUrl: r.downloadUrl, filename: r.filename, size: r.size,
      });
    }).catch(err => setMacManual({ phase: 'error', error: String(err && err.message || err) }));
  }, [status.state]);

  const onCheck = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await window.electronAPI.updateCheck();
      if (!res.ok) setMsg(res.reason === 'disabled' ? t('update.checkErrDisabled') : t('update.checkErrLater'));
    } finally { setBusy(false); }
  };
  const onDownload = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await window.electronAPI.updateDownload();
      if (!res.ok) setMsg(t('update.dlErr'));
    } finally { setBusy(false); }
  };
  const onInstall = async () => {
    setBusy(true); setMsg('');
    const res = await window.electronAPI.updateInstall();
    if (!res.ok) { setMsg(t('update.installErr')); setBusy(false); }
  };
  const onMacManualDownload = async () => {
    if (macManual.phase !== 'available') return;
    setMacManual({ ...macManual, phase: 'downloading', transferred: 0, total: macManual.size || 0, percent: 0 });
    const r = await window.electronAPI.updateMacManualDownload({ url: macManual.downloadUrl, filename: macManual.filename });
    if (!r || !r.ok) {
      setMacManual({ ...macManual, phase: 'error', error: (r && r.reason) || 'download-failed' });
    } else {
      setMacManual({ ...macManual, phase: 'done', path: r.path });
    }
  };
  const onMacManualCancel = () => {
    if (window.electronAPI?.updateMacManualCancel) window.electronAPI.updateMacManualCancel();
  };

  const fmtBytes = (n) => {
    if (!n || !Number.isFinite(n)) return '0 B';
    const u = ['B','KB','MB','GB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  };

  const isDownloading = status.state === 'downloading';
  const pct = isDownloading && status.progress ? Math.max(0, Math.min(100, status.progress.percent || 0)) : 0;

  const headline = ({
    idle:        t('update.state.idle'),
    checking:    t('update.state.checkingHead'),
    available:   status.info ? t('update.state.availableV', { v: status.info.version }) : t('update.state.available'),
    none:        t('update.state.none'),
    downloading: t('update.state.downloading'),
    downloaded:  t('update.state.downloadedTitle'),
    error:       t('update.state.errorTitle'),
    disabled:    t('update.state.disabledTitle'),
    unsupported: t('update.state.unsupported'),
  })[status.state] || status.state;

  const subline = ({
    idle:        t('update.sub.idle'),
    checking:    t('update.sub.checking'),
    available:   currentVersion ? t('update.sub.availableV', { v: currentVersion }) : t('update.sub.available'),
    none:        currentVersion ? t('update.sub.installedV', { v: currentVersion }) : t('update.sub.upToDate'),
    downloading: status.progress
      ? t('update.sub.dlProgress', {
          xfer: fmtBytes(status.progress.transferred),
          total: fmtBytes(status.progress.total),
          speed: status.progress.bytesPerSecond ? t('update.sub.speed', { sp: fmtBytes(status.progress.bytesPerSecond) }) : '',
        })
      : t('update.sub.connecting'),
    downloaded:  t('update.sub.downloaded'),
    error:       t('update.sub.error'),
    disabled:    t('update.sub.disabled'),
    unsupported: (() => {
      if (macManual.phase === 'checking') return t('update.mac.checking');
      if (macManual.phase === 'available') return t('update.mac.available', { v: macManual.version });
      if (macManual.phase === 'same') return t('update.mac.same', { v: currentVersion });
      if (macManual.phase === 'downloading') return t('update.mac.downloading', { v: macManual.version });
      if (macManual.phase === 'done') return t('update.mac.done');
      if (macManual.phase === 'error') return t('update.mac.error', { err: macManual.error });
      return t('update.mac.fallback');
    })(),
  })[status.state] || '';

  const icon = ({
    idle: 'download', checking: 'history', available: 'download', none: 'check',
    downloading: 'download', downloaded: 'bolt', error: 'close', disabled: 'clock',
    unsupported: 'bulb',
  })[status.state] || 'download';
  const hasApi = !!window.electronAPI?.updateGetStatus;

  return (
    <Row {...rowProps('about.updates')} stack>
      <div className={`st-update ${status.state || 'idle'}`} aria-live="polite">
        <span className={`st-update-ic${status.state === 'checking' || isDownloading ? ' spin' : ''}`} aria-hidden="true">
          <span className="ic"><Icon name={icon} size={18} /></span>
        </span>
        <div className="st-update-t">
          <div>
            <b>{hasApi ? headline : t('st.desktopOnly')}</b>
            {hasApi && <span style={{ display: 'block' }}>{subline}</span>}
          </div>
          {isDownloading && (
            <div className="st-inline">
              <div className="st-progress" style={{ flex: 1 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${pct}%` }} /></div>
              <span className="st-hint">{Math.round(pct)}%</span>
            </div>
          )}
          {status.state === 'unsupported' && macManual.phase === 'downloading' && (
            <div className="st-inline">
              <div className="st-progress" style={{ flex: 1 }}><i style={{ width: `${Math.max(0, Math.min(100, macManual.percent || 0))}%` }} /></div>
              <span className="st-hint">{macManual.total ? `${fmtBytes(macManual.transferred || 0)} / ${fmtBytes(macManual.total)}` : `${fmtBytes(macManual.transferred || 0)}`}</span>
            </div>
          )}
          {hasApi && (
            <div className="st-inline">
              {status.state === 'available' && (
                <Button variant="primary" onClick={onDownload} disabled={busy}>{t('update.downloadNow')}</Button>
              )}
              {status.state === 'downloaded' && (
                <Button variant="primary" onClick={onInstall} disabled={busy}>{t('update.restartInstall')}</Button>
              )}
              {(status.state === 'idle' || status.state === 'none' || status.state === 'error') && (
                <Button onClick={onCheck} disabled={busy}>
                  {busy || status.state === 'checking' ? t('update.checking') : t('update.recheck')}
                </Button>
              )}
              {status.state === 'unsupported' && macManual.phase === 'available' && (
                <Button variant="primary" onClick={onMacManualDownload}>
                  {t('update.downloadV', { v: macManual.version, size: macManual.size ? ` (${fmtBytes(macManual.size)})` : '' })}
                </Button>
              )}
              {status.state === 'unsupported' && macManual.phase === 'downloading' && (
                <Button onClick={onMacManualCancel}>{t('btn.cancel')}</Button>
              )}
              {status.state === 'unsupported' && macManual.phase === 'error' && (
                <Button onClick={() => setMacManual({ phase: 'idle' })}>{t('update.retry')}</Button>
              )}
              {status.state === 'unsupported' && (
                <a className="ui-btn ui-btn-secondary" href="https://github.com/k4ditano/edinot/releases" target="_blank" rel="noreferrer">
                  {t('update.opens.releases')}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
      {msg && <div className="st-hint">{msg}</div>}
    </Row>
  );
}

export function AboutSection() {
  useI18n();
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    if (window.electronAPI?.appGetVersion) {
      window.electronAPI.appGetVersion().then(v => setAppVersion(v || '')).catch(() => {});
    }
  }, []);
  return (
    <>
      <Row {...rowProps('about.version', { help: t('settings.footer', { version: appVersion ? ` v${appVersion}` : '' }) })}>
        <span className="st-version" data-version={appVersion || undefined}>{appVersion ? `v${appVersion}` : t('st.about.webVersion')}</span>
      </Row>
      <UpdatesRow />
      <Row {...rowProps('about.site')} last>
        <a className="ui-btn ui-btn-secondary" href="https://edinot.app" target="_blank" rel="noreferrer"
          onClick={(e) => { if (window.electronAPI && window.electronAPI.openExternal) { e.preventDefault(); window.electronAPI.openExternal('https://edinot.app'); } }}>
          edinot.app <Icon name="external" size={13} />
        </a>
      </Row>
    </>
  );
}
