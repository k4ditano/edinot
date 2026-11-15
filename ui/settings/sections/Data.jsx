// Datos: «Vaults» y «Google Calendar» (la sincronización vive en Sync.jsx).

import { useState, useEffect, useCallback, useRef } from 'react';
import { t, useI18n } from '../../../i18n.js';
import { EMOJI_FOLDER_SET } from '../../shared/emoji.js';
import { Icon } from '../../shell/icons.jsx';
import { Row, Switch, Select, Segmented, Button, TextField, Notice, Popover } from '../controls.jsx';
import { rowProps } from '../registry.js';
import { formatBytes, isElectron } from '../util.js';

export const VAULT_COLORS = ['#4C6C40', '#3F6FA8', '#B5552F', '#7A4A8E', '#2f8a68', '#a07a2c', '#a25058', '#3A3F38'];

function VaultStyleButton({ vault, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return (
    <>
      <button type="button" ref={ref} className="st-li-ic" aria-haspopup="dialog" aria-expanded={open}
        aria-label={t('st.vault.style', { name: vault.name })} title={t('st.vault.styleTip')}
        onClick={() => setOpen(o => !o)}>
        <Icon name="palette" size={15} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} label={t('st.vault.style', { name: vault.name })} width={276}>
        <div className="st-pop-t">{t('st.vault.color')}</div>
        <div className="st-pop-grid" style={{ gridTemplateColumns: 'repeat(5, 26px)' }}>
          <button type="button" className={`st-custom-sw${!vault.color ? ' on' : ''}`} style={!vault.color ? { '--sw': 'var(--faint)', color: 'var(--muted)' } : undefined}
            aria-label={t('st.vault.noColor')} aria-pressed={!vault.color} onClick={() => onChange({ color: null })}>
            <Icon name="close" size={11} stroke={2} />
          </button>
          {VAULT_COLORS.map(c => (
            <button type="button" key={c} className={`ui-swatch${vault.color === c ? ' on' : ''}`}
              style={{ background: c, '--sw': c }} aria-label={c} aria-pressed={vault.color === c}
              onClick={() => onChange({ color: c })} />
          ))}
        </div>
        <div className="st-pop-t">{t('st.vault.icon')}</div>
        <div className="st-pop-grid" style={{ gridTemplateColumns: 'repeat(7, 26px)', gap: 6 }}>
          <button type="button" className="sh-emoji" style={{ width: 26, height: 26 }} aria-label={t('st.vault.noIcon')} aria-pressed={!vault.icon}
            onClick={() => onChange({ icon: null })}><Icon name="close" size={11} stroke={2} /></button>
          {EMOJI_FOLDER_SET.filter((e, i, a) => a.indexOf(e) === i).slice(0, 27).map(em => (
            <button type="button" key={em} className="sh-emoji" style={{ width: 26, height: 26, fontSize: 15 }}
              aria-label={em} aria-pressed={vault.icon === em} onClick={() => onChange({ icon: em })}>{em}</button>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function VaultsSection({ ctx }) {
  useI18n();
  const { vaults, setVaults, activeVault: active, setActiveVault: setActive, files, setFiles } = ctx;
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const create = () => {
    const name = draft.trim();
    if (!name) return;
    const id = 'v' + Date.now().toString(36);
    setVaults([...vaults, { id, name }]);
    setDraft('');
    inputRef.current && inputRef.current.focus();
  };

  const rename = async (id) => {
    const v = vaults.find(x => x.id === id);
    const ask = window.__edinotPrompt;
    if (!ask) return;
    const name = await ask(t('tree.newVaultName'), v.name);
    if (name) setVaults(vaults.map(x => x.id === id ? { ...x, name } : x));
  };

  const remove = async (id) => {
    if (id === 'default') return;
    const ok = await (window.__edinotConfirm
      ? window.__edinotConfirm(t('vault.confirmDelete'), { title: t('vault.deleteTitle') })
      : Promise.resolve(false));
    if (!ok) return;
    setVaults(vaults.filter(x => x.id !== id));
    setFiles(files.map(f => (f.vaultId === id ? { ...f, vaultId: 'default' } : f)));
    if (active === id) setActive('default');
  };

  const restyle = (id, patch) => setVaults(vaults.map(x => {
    if (x.id !== id) return x;
    const next = { ...x, ...patch };
    if (!next.color) delete next.color;
    if (!next.icon) delete next.icon;
    return next;
  }));

  return (
    <>
      <Row {...rowProps('vaults.list', { help: t('vault.hint') })} stack last>
        <div className="st-list">
          {vaults.map(v => {
            const count = files.filter(f => (f.vaultId || 'default') === v.id).length;
            const on = v.id === active;
            return (
              <div key={v.id} className={`st-li${on ? ' on' : ''}`}>
                <button type="button" className="st-li-main" aria-pressed={on} onClick={() => setActive(v.id)} title={t('vault.activate')}>
                  <span className="st-vault-ic" aria-hidden="true" style={{ background: v.color || 'var(--faint)' }}>
                    {v.icon || String(v.name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="st-li-name">{v.name}</span>
                  {on && <span className="st-li-meta">{t('st.vault.active')}</span>}
                  <span className="st-li-meta">{t('st.vault.notes', { n: count })}</span>
                </button>
                <VaultStyleButton vault={v} onChange={(patch) => restyle(v.id, patch)} />
                <button type="button" className="st-li-ic" aria-label={t('btn.rename') + ': ' + v.name} title={t('btn.rename')} onClick={() => rename(v.id)}>
                  <Icon name="edit" size={15} />
                </button>
                {v.id !== 'default' && (
                  <button type="button" className="st-li-ic danger" aria-label={t('btn.delete') + ': ' + v.name} title={t('btn.delete')} onClick={() => remove(v.id)}>
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <form className="st-inline" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <TextField ref={inputRef} placeholder={t('vault.newPh')} aria-label={t('vault.newPh')}
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button variant="primary" type="submit"><Icon name="plus" size={14} stroke={2} />{t('vault.create')}</Button>
        </form>
      </Row>
    </>
  );
}

export function CalendarSection({ ctx }) {
  useI18n();
  const { settings, setSettings, vaults, activeVault, onGoogleSync } = ctx;
  const [status, setStatus] = useState({ connected: false, email: null });
  const [calendars, setCalendars] = useState([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const haveApi = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.gcalStatus;

  const refreshStatus = useCallback(async () => {
    if (!haveApi) return;
    try { setStatus(await window.electronAPI.gcalStatus()); } catch {}
  }, [haveApi]);
  const loadCalendars = useCallback(async () => {
    if (!haveApi) return;
    try {
      const r = await window.electronAPI.gcalCalendars({ clientId: settings.gcalClientId, clientSecret: settings.gcalClientSecret });
      if (r && r.ok) setCalendars(r.calendars || []);
    } catch {}
  }, [haveApi, settings.gcalClientId, settings.gcalClientSecret]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);
  useEffect(() => { if (status.connected) loadCalendars(); }, [status.connected, loadCalendars]);

  const connect = async () => {
    if (!settings.gcalClientId) { setMsg({ err: true, text: t('gcal.needClient') }); return; }
    setBusy('auth'); setMsg(null);
    try {
      const r = await window.electronAPI.gcalAuth({ clientId: settings.gcalClientId, clientSecret: settings.gcalClientSecret });
      if (r && r.ok) { await refreshStatus(); setMsg({ text: t('gcal.connected') }); }
      else setMsg({ err: true, text: t('gcal.authFail', { err: (r && r.error) || '?' }) });
    } catch (e) { setMsg({ err: true, text: String(e.message || e) }); }
    finally { setBusy(''); }
  };
  const disconnect = async () => {
    setBusy('disc');
    try { await window.electronAPI.gcalDisconnect(); await refreshStatus(); setCalendars([]); }
    finally { setBusy(''); }
  };
  const syncNow = async () => {
    setBusy('sync'); setMsg(null);
    try {
      const r = await onGoogleSync();
      if (r && r.ok) {
        const p = r.pulled ? `${r.pulled.added}+/${r.pulled.updated}~/${r.pulled.removed}−` : '—';
        setMsg({ text: t('gcal.syncOk', { pulled: p, pushed: r.pushed || 0 }) });
      } else setMsg({ err: true, text: t('gcal.syncFail', { err: (r && r.error) || '?' }) });
    } catch (e) { setMsg({ err: true, text: String(e.message || e) }); }
    finally { setBusy(''); }
  };

  if (!haveApi) {
    return <Row {...rowProps('calendar.account', { help: t('gcal.desktopOnly') })} last />;
  }

  return (
    <>
      <p className="st-hint" style={{ margin: '0 0 8px' }}>{t('gcal.intro')}</p>
      <Row {...rowProps('calendar.client')} stack>
        <div className="st-fields">
          <label className="st-field">{t('gcal.clientId')}
            <TextField mono value={settings.gcalClientId || ''} placeholder="xxxxx.apps.googleusercontent.com"
              onChange={e => setSettings(prev => ({ ...prev, gcalClientId: e.target.value.trim() }))} />
          </label>
          <label className="st-field">{t('gcal.clientSecret')}
            <TextField mono type="password" value={settings.gcalClientSecret || ''} placeholder="GOCSPX-…"
              onChange={e => setSettings(prev => ({ ...prev, gcalClientSecret: e.target.value.trim() }))} />
          </label>
        </div>
        <details className="st-details">
          <summary>{t('gcal.help.title')}</summary>
          <ol>
            <li>{t('gcal.help.1')}</li>
            <li>{t('gcal.help.2')}</li>
            <li>{t('gcal.help.3')}</li>
            <li>{t('gcal.help.4')}</li>
          </ol>
        </details>
      </Row>
      <Row {...rowProps('calendar.account', status.connected ? { help: status.email || t('gcal.connectedShort') } : null)}>
        {status.connected
          ? <>
              <span className="st-pill ok"><Icon name="check" size={13} stroke={2.4} />{t('gcal.connectedShort')}</span>
              <Button disabled={busy === 'disc'} onClick={disconnect}>{t('gcal.disconnect')}</Button>
            </>
          : <Button variant="primary" disabled={busy === 'auth'} onClick={connect}>{busy === 'auth' ? t('st.working') : t('gcal.connect')}</Button>}
      </Row>
      {status.connected && (
        <>
          <Row {...rowProps('calendar.calendar')}>
            <Select label={t('gcal.calendar')} value={settings.gcalCalendarId || 'primary'} minWidth={220}
              onChange={v => setSettings(prev => ({ ...prev, gcalCalendarId: v }))}
              options={[{ value: 'primary', label: t('gcal.primary') }, ...calendars.map(c => ({ value: c.id, label: c.summary + (c.primary ? ' ★' : '') }))]} />
          </Row>
          <Row {...rowProps('calendar.targetVault')}>
            <Select label={t('gcal.targetVault')} value={settings.gcalTargetVault || activeVault}
              onChange={v => setSettings(prev => ({ ...prev, gcalTargetVault: v }))}
              options={(vaults || []).map(v => ({ value: v.id, label: v.name }))} />
          </Row>
          <Row {...rowProps('calendar.direction')}>
            <Segmented label={t('gcal.direction')} value={settings.gcalDirection || 'both'}
              onChange={v => setSettings(prev => ({ ...prev, gcalDirection: v }))}
              options={[
                { value: 'pull', label: t('st.gcal.pull') },
                { value: 'push', label: t('st.gcal.push') },
                { value: 'both', label: t('st.gcal.both') },
              ]} />
          </Row>
          <Row {...rowProps('calendar.auto')}>
            <Switch label={t('gcal.auto')} checked={!!settings.gcalAuto} onChange={v => setSettings(prev => ({ ...prev, gcalAuto: v }))} />
          </Row>
          <Row {...rowProps('calendar.syncNow')} last>
            <Button disabled={busy === 'sync'} onClick={syncNow}>{busy === 'sync' ? t('st.working') : t('gcal.syncNow')}</Button>
          </Row>
        </>
      )}
      {msg && <Notice tone={msg.err ? 'error' : 'ok'}>{msg.text}</Notice>}
    </>
  );
}
