// Sincronización: dónde viven tus notas y con qué equipos se sincronizan.
//
//  · Hub local (por defecto): los datos se guardan en este equipo y el CLI y los asistentes MCP los
//    leen sin conexión. Solo es accesible desde este equipo.
//  · Hub de un servidor: este equipo se ha emparejado con un código y sincroniza con él; desde aquí
//    se pueden añadir más equipos (código + QR) y quitar los que ya no se usen.
//
// Unirse a un hub nuevo: se canjea el código, se COPIAN antes los datos de este equipo a ese hub
// (`edinot hub push`; sincronizar directamente duplicaría el texto de las notas) y solo entonces se
// cambia la sincronización.

import { useState, useEffect, useCallback, useRef } from 'react';
import { t, useI18n } from '../../../i18n.js';
import {
  deriveWsUrl, apiPairRedeem, apiPairStart, apiListDevices, apiRevokeDevice,
} from '../../../store.js';
import { Row, Group, Switch, Button, TextField, Notice } from '../controls.jsx';
import { rowProps } from '../registry.js';
import { formatBytes, isElectron } from '../util.js';

const STATUS_KEY = {
  connected: 'st.sync.s.connected', connecting: 'st.sync.s.connecting', disconnected: 'st.sync.s.disconnected',
  'auth-failed': 'st.sync.s.authFailed', error: 'st.sync.s.error',
};

function relTime(ts) {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 60e3) return t('time.now');
  if (d < 3600e3) return t('time.min', { n: Math.floor(d / 60e3) });
  if (d < 86400e3) return t('time.h', { n: Math.floor(d / 3600e3) });
  if (d < 2 * 86400e3) return t('time.yesterday');
  return t('time.d', { n: Math.floor(d / 86400e3) });
}

// Acepta «ABCDE-FGHJK» o un enlace edinot://pair?u=…&c=…
export function parsePairInput(input, serverField) {
  const raw = String(input || '').trim();
  if (/^edinot:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return { server: u.searchParams.get('u') || '', code: u.searchParams.get('c') || '', fp: u.searchParams.get('f') || '', fromLink: true };
    } catch { return { server: '', code: '', fp: '', fromLink: true }; }
  }
  return { server: String(serverField || '').trim(), code: raw, fp: '', fromLink: false };
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || ''); } };

// Panel con el código, su enlace y el QR. Caduca a los 5 minutos.
function PairingPanel({ pairing, onClose }) {
  useI18n();
  const [qr, setQr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState('');
  useEffect(() => {
    let off = false;
    if (!pairing.uri) { setQr(null); return undefined; }
    import('qrcode').then(m => (m.default || m).toDataURL(pairing.uri, { margin: 1, width: 200 }))
      .then(url => { if (!off) setQr(url); }).catch(() => {});
    return () => { off = true; };
  }, [pairing.uri]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const left = Math.max(0, pairing.expiresAt - now);
  const expired = left === 0;
  const m = Math.floor(left / 60000), s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  const copy = (what, text) => {
    try { navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1400); } catch {}
  };
  return (
    <div className="st-pair" role="group" aria-label={t('st.row.sync.addDevice')}>
      {qr && <img className="st-pair-qr" src={qr} alt={t('st.sync.qrAlt')} width="160" height="160" style={expired ? { opacity: .25 } : undefined} />}
      <div className="st-pair-main">
        <div className="st-hint">{t('st.sync.code')}</div>
        <div className="st-pair-code" aria-live="polite">{pairing.display}</div>
        <div className="st-hint">{expired ? t('st.sync.expired') : t('st.sync.expiresIn', { m, s })}</div>
        <div className="st-inline" style={{ marginTop: 10 }}>
          <Button onClick={() => copy('code', pairing.display)} disabled={expired}>{copied === 'code' ? t('st.sync.copied') : t('st.sync.copy')}</Button>
          {pairing.uri && <Button onClick={() => copy('link', pairing.uri)} disabled={expired}>{copied === 'link' ? t('st.sync.copied') : t('st.sync.copyLink')}</Button>}
          <Button variant="ghost" onClick={onClose}>{t('st.sync.close')}</Button>
        </div>
      </div>
    </div>
  );
}

export function SyncSection({ ctx }) {
  useI18n();
  const { settings, setSettings, syncConfig: config, setSyncConfig: setConfig, syncStatus: status, vaults = [] } = ctx;
  const desktop = isElectron();
  const loggedIn = !!(config && config.token);
  const mode = !loggedIn ? 'none' : config.hub ? 'hub' : 'server';

  // ── Equipos del hub ──────────────────────────────────────────────────────
  const [devices, setDevices] = useState(null);       // null = cargando; [] = ninguno
  const [devErr, setDevErr] = useState(false);
  // Old sync servers (the pre-1.3 cloud server) have no pairing at all: say so instead of failing.
  const [pairUnsupported, setPairUnsupported] = useState(false);
  const loadDevices = useCallback(async () => {
    if (!loggedIn) { setDevices([]); return; }
    try { setDevices((await apiListDevices(config.httpUrl, config.token)).devices || []); setDevErr(false); }
    catch (err) { setDevices([]); if (err && err.status === 404) setPairUnsupported(true); else setDevErr(true); }
  }, [loggedIn, config && config.httpUrl, config && config.token]);
  useEffect(() => { loadDevices(); }, [loadDevices]);
  const revoke = async (d) => {
    if (!window.confirm(t('st.sync.revokeConfirm', { name: d.name }))) return;
    try { await apiRevokeDevice(config.httpUrl, config.token, d.id); } catch {}
    loadDevices();
  };

  // ── Añadir otro equipo (solo si este hub es accesible desde fuera) ───────────
  const [pairing, setPairing] = useState(null);
  const [pairErr, setPairErr] = useState(null);
  // Acceso: todo (otro equipo tuyo) o solo algunos vaults (otra persona), en lectura o escritura.
  const [shareMode, setShareMode] = useState('all');
  const [shareSel, setShareSel] = useState(() => new Set());
  const [shareRO, setShareRO] = useState(true);
  const toggleVault = (id) => setShareSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const showCode = async () => {
    setPairErr(null);
    const scope = shareMode === 'some' ? { vaults: [...shareSel], readOnly: shareRO } : null;
    try { setPairing(await apiPairStart(config.httpUrl, config.token, config.httpUrl, scope)); }
    catch (err) { if (err && err.status === 404) setPairUnsupported(true); else setPairErr(err.message); }
  };
  const vaultName = (id) => (vaults.find(v => v.id === id) || {}).name || id;

  // ── Unirme a otro hub ────────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [serverField, setServerField] = useState('');
  const [devName, setDevName] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinErr, setJoinErr] = useState(null);
  const [joinOk, setJoinOk] = useState(null);
  const [progress, setProgress] = useState('');
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.appHostName) window.electronAPI.appHostName().then(n => setDevName(n || '')).catch(() => {});
  }, []);
  const parsed = parsePairInput(input, serverField);
  const needsServer = !!input.trim() && !parsed.fromLink;
  const canJoin = mode === 'hub' && !busy && !!parsed.code && /^https?:\/\//i.test(parsed.server);
  const offProgress = useRef(null);
  useEffect(() => () => { if (offProgress.current) offProgress.current(); }, []);

  const join = async () => {
    setBusy(true); setJoinErr(null); setJoinOk(null); setProgress('');
    try {
      const server = parsed.server.replace(/\/$/, '');
      const name = (devName || '').trim() || t('st.sync.defaultName');
      // Servidor cifrado con certificado propio: se fija el certificado cuya huella coincide con la del enlace.
      let tlsCa = null;
      if (parsed.fp) {
        if (!desktop || !window.electronAPI.tlsPinFromLink) throw new Error(t('st.sync.tlsDesktopOnly'));
        const pin = await window.electronAPI.tlsPinFromLink({ url: server, fp: parsed.fp });
        if (!pin || !pin.ok) throw Object.assign(new Error((pin && pin.error) || t('st.sync.tlsFail')), { tlsFailed: true });
        tlsCa = pin.pem;
      }
      let r;
      try { r = await apiPairRedeem(server, parsed.code, name); }
      catch (err) {
        if (/^https:/i.test(server) && !tlsCa && /fetch|network|failed/i.test(String(err && err.message))) throw Object.assign(new Error(t('st.sync.needLink')), { tlsFailed: true });
        throw err;
      }
      // 1) copiar los datos de este equipo al hub nuevo, ANTES de sincronizar (así no se duplican las notas).
      //    Con un acceso compartido (solo algunos vaults) no se copia nada: no es tu servidor.
      if (desktop && window.electronAPI.hubPush && !r.scope) {
        setProgress(t('st.sync.copying'));
        if (window.electronAPI.onHubPushProgress) offProgress.current = window.electronAPI.onHubPushProgress(line => setProgress(line.slice(0, 140)));
        const res = await window.electronAPI.hubPush({ target: server, token: r.token, ca: tlsCa });
        if (offProgress.current) { offProgress.current(); offProgress.current = null; }
        if (!res || !res.ok) {
          const tail = (res && (res.error || (res.output || []).slice(-2).join(' · '))) || '';
          throw Object.assign(new Error(t('st.sync.pushFail', { err: tail })), { pushFailed: true });
        }
      }
      // 2) cambiar la sincronización a ese hub
      const list = r.workspaces || [];
      setConfig({
        httpUrl: server, wsUrl: deriveWsUrl(server), email: r.email, userId: r.userId, token: r.token,
        tier: r.tier, tierLabel: r.tierLabel, expiresAt: r.expiresAt, workspaces: list, limits: r.limits,
        currentWorkspaceId: list[0] ? list[0].id : 1, deviceId: r.deviceId, deviceName: r.deviceName,
        ...(tlsCa ? { tlsCa } : {}),
        ...(r.scope ? { scope: r.scope } : {}),
      });
      setJoinOk(r.scope ? t('st.sync.joinShared', { host: hostOf(server) }) : t('st.sync.joinDone', { host: hostOf(server) }));
      setInput('');
    } catch (err) {
      setJoinErr(err && (err.pushFailed || err.tlsFailed) ? err.message : t('st.sync.joinFail', { err: (err && err.message) || String(err) }));
    } finally { setBusy(false); setProgress(''); }
  };

  const leave = () => {
    if (!window.confirm(t('st.sync.leaveConfirm', { host: hostOf(config.httpUrl) }))) return;
    if (config.tlsCa && window.electronAPI && window.electronAPI.tlsSetPin) window.electronAPI.tlsSetPin({ url: config.httpUrl, pem: null });
    setConfig(null);   // la app vuelve sola al hub de este equipo
  };

  // ── Caché sin conexión ──────────────────────────────────────────────────────
  const [cacheStats, setCacheStats] = useState(null);
  const refreshCacheStats = useCallback(async () => {
    if (!window.electronAPI || !window.electronAPI.blobCacheStats) return;
    try { setCacheStats(await window.electronAPI.blobCacheStats()); } catch {}
  }, []);
  useEffect(() => { refreshCacheStats(); }, [refreshCacheStats]);
  const cacheGB = Math.max(0, Number(settings.offlineCacheMax) || 0) / (1024 * 1024 * 1024);
  const onCacheChange = (gb) => setSettings(prev => ({ ...prev, offlineCacheMax: Math.max(0, Math.round(Number(gb) * 1024 * 1024 * 1024)) }));
  const purge = async () => { if (window.electronAPI && window.electronAPI.blobPurgeCache) { await window.electronAPI.blobPurgeCache(); refreshCacheStats(); } };
  const enforceNow = async () => { if (window.electronAPI && window.electronAPI.blobEnforceQuota) { await window.electronAPI.blobEnforceQuota(Number(settings.offlineCacheMax) || 0); refreshCacheStats(); } };

  const dot = mode !== 'server' ? '' : status === 'connected' ? 'on' : status === 'connecting' ? 'warn' : (status === 'auth-failed' || status === 'error') ? 'bad' : '';
  const statusText = t(STATUS_KEY[status] || STATUS_KEY.disconnected);
  const statusHelp = mode === 'hub' ? t('st.sync.hubHelp')
    : mode === 'server' && config.scope ? t('st.sync.sharedHelp', { host: hostOf(config.httpUrl), mode: config.scope.readOnly ? t('st.sync.readOnly') : t('st.sync.readWrite') })
    : mode === 'server' ? t('st.sync.serverHelp', { host: hostOf(config.httpUrl) })
      : t('st.sync.none');

  return (
    <>
      <Group title={t('st.grp.syncState')}>
        <Row {...rowProps('sync.status', { help: statusHelp })} last>
          <span className="st-pill"><span className={`st-dot ${dot}`} aria-hidden="true" />{mode === 'server' ? statusText : t('st.sync.local')}</span>
        </Row>
      </Group>

      {mode === 'server' && !config.scope && (
        <Group title={t('st.grp.devices')}>
          <Row {...rowProps('sync.devices')} stack>
            {devices === null && <div className="st-hint">…</div>}
            {devices && devices.length === 0 && !pairUnsupported && <div className="st-hint">{devErr ? t('st.sync.devicesError') : t('st.sync.noDevices')}</div>}
            {devices && devices.length > 0 && (
              <ul className="st-devices">
                {devices.map(d => (
                  <li key={d.id}>
                    <span className="st-dev-name">{d.name}{config.deviceId === d.id && <span className="st-pill ok" style={{ marginLeft: 8 }}>{t('st.sync.thisDevice')}</span>}
                      {d.scope && <span className="st-hint" style={{ marginLeft: 8, fontWeight: 400 }}>{t('st.sync.sharedWith', { vaults: d.scope.vaults.map(vaultName).join(', '), mode: d.scope.readOnly ? t('st.sync.readOnly') : t('st.sync.readWrite') })}</span>}</span>
                    <span className="st-hint">{t('st.sync.lastSeen', { when: relTime(d.lastSeenAt) })}</span>
                    <Button size="sm" variant="danger" onClick={() => revoke(d)}>{t('st.sync.revoke')}</Button>
                  </li>
                ))}
              </ul>
            )}
          </Row>
          {pairUnsupported ? (
            <Row {...rowProps('sync.addDevice', { help: '' })} last stack>
              <Notice tone="info">{t('st.sync.noPairing')}</Notice>
            </Row>
          ) : mode === 'server' ? (
            <Row {...rowProps('sync.addDevice')} last stack>
              {!pairing && (
                <div className="st-share">
                  <label className="st-radio"><input type="radio" name="st-share" checked={shareMode === 'all'} onChange={() => setShareMode('all')} /> {t('st.sync.shareAll')}</label>
                  <label className="st-radio"><input type="radio" name="st-share" checked={shareMode === 'some'} onChange={() => setShareMode('some')} /> {t('st.sync.shareSome')}</label>
                  {shareMode === 'some' && (
                    <div className="st-share-opts">
                      <div className="st-chips">
                        {vaults.map(v => (
                          <label key={v.id} className="st-radio"><input type="checkbox" checked={shareSel.has(v.id)} onChange={() => toggleVault(v.id)} /> {v.name}</label>
                        ))}
                      </div>
                      <label className="st-radio"><input type="checkbox" checked={shareRO} onChange={e => setShareRO(e.target.checked)} /> {t('st.sync.shareRO')}</label>
                      <div className="st-hint">{t('st.sync.shareNote')}</div>
                    </div>
                  )}
                  <Button variant="primary" onClick={showCode} disabled={shareMode === 'some' && shareSel.size === 0}>{t('st.sync.showCode')}</Button>
                </div>
              )}
              {pairErr && <Notice tone="error">{pairErr}</Notice>}
              {pairing && <PairingPanel pairing={pairing} onClose={() => setPairing(null)} />}
            </Row>
          ) : (
            <Row {...rowProps('sync.addDevice', { help: t('st.sync.localOnlyHub') })} last />
          )}
        </Group>
      )}

      <Group title={t('st.grp.join')}>
        {mode === 'server' && (
          <Row {...rowProps('sync.join', { help: t('st.sync.joinNeedsHub') })} last>
            <Button onClick={leave}>{t('st.sync.leave')}</Button>
          </Row>
        )}
        {mode !== 'server' && (
          <Row {...rowProps('sync.join')} stack last>
            <div className="st-fields">
              <label className="st-field" style={{ flex: 2 }}>{t('st.sync.joinCode')}
                <TextField value={input} placeholder="ABCDE-FGHJK  ·  edinot://pair?…" spellCheck={false} autoComplete="off"
                  onChange={e => setInput(e.target.value)} disabled={busy} />
              </label>
              {needsServer && (
                <label className="st-field" style={{ flex: 2 }}>{t('st.sync.joinServer')}
                  <TextField value={serverField} placeholder="https://hub.tu-dominio.com" spellCheck={false} autoComplete="off"
                    onChange={e => setServerField(e.target.value)} disabled={busy} />
                </label>
              )}
              <label className="st-field">{t('st.sync.joinName')}
                <TextField value={devName} onChange={e => setDevName(e.target.value)} disabled={busy} maxLength={60} />
              </label>
            </div>
            <div className="st-inline">
              <Button variant="primary" onClick={join} disabled={!canJoin}>{busy ? t('st.sync.joining') : t('st.sync.joinBtn')}</Button>
              {busy && progress && <span className="st-hint" aria-live="polite">{progress}</span>}
            </div>
            {joinErr && <Notice tone="error">{joinErr}</Notice>}
            {joinOk && <Notice tone="ok">{joinOk}</Notice>}
          </Row>
        )}
      </Group>

      {mode !== 'server' && (
        <Group title={t('st.grp.server')}>
          <div className="st-notice" style={{ margin: 0 }}>
            <p style={{ margin: '0 0 8px' }}>{t('st.sync.srv.intro')}</p>
            <ol style={{ margin: '0 0 10px', paddingLeft: 20, lineHeight: 1.6 }}>
              <li>{t('st.sync.srv.s1')}</li>
              <li>{t('st.sync.srv.s2')} <code>sudo sh install.sh</code></li>
              <li>{t('st.sync.srv.s3')}</li>
            </ol>
            <div className="st-hint">{t('st.sync.srv.note')}</div>
          </div>
        </Group>
      )}

      <Group title={t('st.grp.offline')}>
        <Row {...rowProps('sync.offlineFull', { help: t('general.offlineFull.tip') })}>
          <Switch label={t('st.row.sync.offlineFull')} checked={settings.offlineMode === 'full'}
            onChange={(v) => setSettings(prev => ({ ...prev, offlineMode: v ? 'full' : 'lite' }))} />
        </Row>
        <Row {...rowProps('sync.cacheMax', { help: t('general.cacheMax.tip') })} labelFor="st-cache-gb">
          <TextField id="st-cache-gb" type="number" min="0" step="0.5" style={{ width: 90, textAlign: 'right' }}
            value={Number.isFinite(cacheGB) ? Number(cacheGB.toFixed(2)) : 0} onChange={e => onCacheChange(e.target.value)} />
          <span className="st-hint">GB</span>
        </Row>
        <Row {...rowProps('sync.cacheStats', {
          help: cacheStats ? t('general.cacheStats', { files: cacheStats.files, bytes: formatBytes(cacheStats.bytes) }) : (desktop ? '…' : t('st.desktopOnly')),
        })} last>
          <Button onClick={enforceNow} disabled={!cacheStats}>{t('general.compact')}</Button>
          <Button variant="danger" onClick={purge} disabled={!cacheStats}>{t('general.clear')}</Button>
        </Row>
      </Group>
    </>
  );
}
