// Modales poco frecuentes de la nota y del workspace: historial de
// versiones, compartir nota / carpeta / vault, auditoría, visor de imagen y
// de PDF. Chunk aparte (editor.jsx los monta con React.lazy al abrirse).

import { ydoc, apiListSnapshots, apiGetSnapshotState, getActiveVaultId, apiTakeSnapshot, apiRestoreSnapshot, apiDeleteSnapshot, apiListShareLinks, apiListAclGrants, apiCreateShareLink, apiRevokeShareLink, apiSetShareLinkSubmit, apiSetShareLinkIncludeLinked, apiRemoveAclGrant, apiUpsertAclGrant, apiListAuditEvents, apiListVaultMembers, apiInviteVaultMember, apiUpdateVaultMemberRole, apiRemoveVaultMember } from '../../store.js';
import * as Y from 'yjs';
import { useI18n, t } from '../../i18n.js';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Icon as ShIcon } from '../shell/icons.jsx';
import {
  VIcon,
  vmRelTime,
} from '../../editor.jsx';


// Simple line-by-line LCS diff. Good enough for typical note sizes
// (a couple hundred lines). Returns an array of { type: 'eq'|'add'|
// 'del', line: string } in unified output order.
function diffLines(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  const m = a.length, n = b.length;
  // Trivial cases — skip the O(mn) table allocation.
  if (m === 0) return b.map(line => ({ type: 'add', line }));
  if (n === 0) return a.map(line => ({ type: 'del', line }));
  // Bounded — refuse to diff massive blobs to keep the UI responsive.
  if (m * n > 4_000_000) {
    return [
      ...a.map(line => ({ type: 'del', line })),
      ...b.map(line => ({ type: 'add', line })),
    ];
  }
  // LCS via row-by-row bottom-up DP.
  const dp = Array(m + 1).fill(0).map(() => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: 'eq', line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', line: a[i] }); i++; }
    else { out.push({ type: 'add', line: b[j] }); j++; }
  }
  while (i < m) { out.push({ type: 'del', line: a[i++] }); }
  while (j < n) { out.push({ type: 'add', line: b[j++] }); }
  return out;
}

// Decode a workspace Y.Doc snapshot blob and return the text of one
// note inside it. Snapshot is the raw `Y.encodeStateAsUpdate` output;
// we hydrate a fresh Y.Doc, apply the update, then read the same
// Y.Text key the live doc uses (`content:{fileId}`).
function readNoteFromSnapshot(snapshotBytes, noteId) {
  try {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, snapshotBytes);
    return ydoc.getText('content:' + noteId).toString();
  } catch (err) {
    console.warn('[snapshot] decode failed:', err.message);
    return null;
  }
}

// Per-note version history modal. Lists every snapshot of the live
// workspace ordered newest-first, shows a side-by-side diff between
// the selected snapshot and the current note content, exposes
// restore (server merges snapshot state into live Y.Doc) and a
// "snapshot now" button. Read-only viewers see a hidden state since
// they can't restore — but the listing + diff still helps audit.
function HistoryModal({ open, onClose, active, syncConfig, isViewer }) {
  useI18n();
  const [snapshots, setSnapshots] = useState([]);
  const [selected, setSelected] = useState(null);    // { meta, content }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [takingLabel, setTakingLabel] = useState('');

  const wsId = syncConfig && syncConfig.currentWorkspaceId;
  const canCall = !!(syncConfig && syncConfig.token && syncConfig.httpUrl && wsId);

  const refresh = useCallback(async () => {
    if (!canCall) return;
    setBusy(true); setError(null);
    try {
      const r = await apiListSnapshots(syncConfig.httpUrl, syncConfig.token, wsId);
      setSnapshots(r.snapshots || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  }, [syncConfig, wsId, canCall]);

  useEffect(() => {
    if (open) { refresh(); setSelected(null); }
  }, [open, refresh]);

  // Esc closes the modal — matches the rest of the modal family.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pickSnapshot = async (meta) => {
    if (!active || !canCall) return;
    setBusy(true); setError(null);
    try {
      const bytes = await apiGetSnapshotState(syncConfig.httpUrl, syncConfig.token, wsId, meta.id);
      const content = readNoteFromSnapshot(bytes, active.id);
      setSelected({ meta, content: content == null ? '' : content });
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  const takeSnapshot = async () => {
    if (!canCall) return;
    setBusy(true); setError(null);
    try {
      // Capture the user's currently-active vault doc. Manual snapshot
      // of the legacy shell would be useless under per-vault mode
      // since notes no longer live there.
      const activeVid = getActiveVaultId ? getActiveVaultId() : null;
      await apiTakeSnapshot(syncConfig.httpUrl, syncConfig.token, wsId, takingLabel.trim() || 'manual', activeVid);
      setTakingLabel('');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  const restoreSelected = async () => {
    if (!selected || !canCall) return;
    if (!confirm(t('dlg.restoreSnapshot', { ts: new Date(selected.meta.ts).toLocaleString() }))) return;
    setBusy(true); setError(null);
    try {
      await apiRestoreSnapshot(syncConfig.httpUrl, syncConfig.token, wsId, selected.meta.id);
      await refresh();
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  const deleteSelected = async () => {
    if (!selected || !canCall) return;
    if (!confirm(t('dlg.deleteSnapshot'))) return;
    setBusy(true); setError(null);
    try {
      await apiDeleteSnapshot(syncConfig.httpUrl, syncConfig.token, wsId, selected.meta.id);
      setSelected(null);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  if (!open) return null;

  const currentContent = active ? (active.content || '') : '';
  const diff = selected ? diffLines(selected.content, currentContent) : [];
  const added = diff.filter(d => d.type === 'add').length;
  const removed = diff.filter(d => d.type === 'del').length;

  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onClose} />
      <div className="history-modal" role="dialog" aria-label="Historial de versiones">
        <div className="history-head">
          <span className="history-title">{t('hist.title')} · {active ? active.name.replace(/\.(md|markdown|txt)$/i, '') : t('hist.noNote')}</span>
          <button className="history-close" onClick={onClose} title={t('btn.close')}><VIcon name="close" /></button>
        </div>
        <div className="history-body">
          <div className="history-list">
            <div className="history-toolbar">
              {!isViewer && (
                <div className="history-toolbar-row">
                  <input
                    className="sync-input"
                    placeholder={t('hist.labelPh')}
                    value={takingLabel}
                    onChange={(e) => setTakingLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') takeSnapshot(); }} />
                  <button className="vault-add-btn history-icon-btn" onClick={takeSnapshot} disabled={busy} title={t('hist.takeTip')}><VIcon name="plus" /></button>
                </div>
              )}
              <div className="history-toolbar-row">
                <span style={{ flex: 1, fontSize: 11, opacity: 0.7, alignSelf: 'center' }}>
                  {snapshots.length === 1 ? t('hist.count.one') : t('hist.count.many', { n: snapshots.length })}
                </span>
                <button className="vault-add-btn history-icon-btn" onClick={refresh} disabled={busy} title={t('hist.refresh')}><VIcon name="refresh" /></button>
              </div>
            </div>
            <div className="history-items">
              {snapshots.length === 0 && !busy && (
                <div className="history-empty">{t('hist.emptyList')}</div>
              )}
              {snapshots.map(s => (
                <button
                  key={s.id}
                  className={`history-item${selected && selected.meta.id === s.id ? ' on' : ''}`}
                  onClick={() => pickSnapshot(s)}
                  disabled={busy}>
                  <div className="history-item-row">
                    <span className="history-item-ts" title={new Date(s.ts).toLocaleString()}>{vmRelTime(Date.parse(s.ts))}</span>
                  </div>
                  <div className="history-item-row history-item-meta">
                    <span className={`history-item-label label-${(s.label || 'auto')}`}>{s.label || 'auto'}</span>
                    {s.document_name && s.document_name.includes(':vault:') && (
                      <span className="history-item-vault" title={s.document_name}>
                        <VIcon name="vault" /> {s.document_name.split(':vault:')[1]}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span className="history-item-size">{Math.round(s.bytes / 1024)} KB</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="history-detail">
            {!selected && (
              <div className="history-empty">{t('hist.pick')}</div>
            )}
            {selected && (
              <>
                <div className="history-detail-head">
                  <span className="history-detail-meta">
                    {new Date(selected.meta.ts).toLocaleString()}
                    <span className="history-detail-stats">
                      {' · '}<span className="diff-add-count">+{added}</span>
                      {' '}<span className="diff-del-count">−{removed}</span>
                    </span>
                  </span>
                  <span className="history-detail-actions">
                    {!isViewer && (
                      <button className="vault-add-btn" onClick={restoreSelected} disabled={busy}>{t('hist.restore')}</button>
                    )}
                    {!isViewer && (
                      <button className="vault-add-btn" onClick={deleteSelected} disabled={busy} style={{ color: '#b04848' }}>{t('hist.delete')}</button>
                    )}
                  </span>
                </div>
                <div className="history-diff">
                  {diff.length === 0 && <div className="history-empty">{t('hist.identical')}</div>}
                  {diff.map((d, i) => (
                    <div key={i} className={`diff-line diff-${d.type}`}>
                      <span className="diff-mark">{d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}</span>
                      <span className="diff-text">{d.line || ' '}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {error && <div className="history-error">{error}</div>}
      </div>
    </>
  );
}

// Share-link modal for a note. Owner/editor creates public read or
// comment-only links; reader gets a URL like <server>/share/<token>.
// Small inline badge that shows the expiry state of a share link. Renders
// nothing when the link never expires. Re-runs the timer once a minute so
// "expires in" stays roughly fresh while the dialog is open.
function ShareExpiryBadge({ expiresAt }) {
  useI18n();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setTick(x => x + 1), 60_000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const ms = Number(expiresAt) - Date.now();
  const expired = ms <= 0;
  const date = new Date(Number(expiresAt));
  const dateStr = date.toLocaleString();
  let rel = '';
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  const hr  = Math.round(abs / 3_600_000);
  const dy  = Math.round(abs / 86_400_000);
  if (abs < 3_600_000) rel = `${min} min`;
  else if (abs < 86_400_000) rel = `${hr} h`;
  else rel = `${dy} d`;
  const label = expired ? t('share.expiry.expired') : t('share.expiry.expiresIn', { rel });
  return (
    <span
      className={`role-badge ${expired ? 'role-viewer' : 'role-editor'}`}
      title={t('share.expiry.tipUntil', { date: dateStr })}
      data-tick={tick}>
      {label}
    </span>
  );
}

function NoteShareModal({ open, onClose, note, syncConfig }) {
  useI18n();
  const [links, setLinks] = useState([]);
  const [grants, setGrants] = useState([]);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState('view');
  const [label, setLabel] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantLevel, setGrantLevel] = useState('edit');
  const [allowSubmit, setAllowSubmit] = useState(false);
  const [includeLinked, setIncludeLinked] = useState(false);
  const [error, setError] = useState(null);
  // Expiry TTL for newly-created links. Stored as a preset key; we resolve
  // to an absolute epoch-ms at create time. 'custom' reveals a
  // datetime-local input next to the select.
  const [ttl, setTtl] = useState('never');
  const [customExpiry, setCustomExpiry] = useState('');
  const wsId = syncConfig && syncConfig.currentWorkspaceId;
  const canCall = !!(syncConfig && syncConfig.token && syncConfig.httpUrl && wsId && note);
  const baseUrl = syncConfig && syncConfig.httpUrl ? syncConfig.httpUrl.replace(/\/$/, '') : '';

  const noteId = note && note.id;
  const httpUrl = syncConfig && syncConfig.httpUrl;
  const token = syncConfig && syncConfig.token;
  const refresh = useCallback(async () => {
    if (!httpUrl || !token || !wsId || !noteId) return;
    setBusy(true); setError(null);
    try {
      const [r, g] = await Promise.all([
        apiListShareLinks(httpUrl, token, wsId, 'note', noteId),
        apiListAclGrants(httpUrl, token, wsId, 'note', noteId),
      ]);
      setLinks(r.links || []);
      setGrants(g.grants || []);
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  }, [httpUrl, token, wsId, noteId]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !note) return null;

  const resolveExpiry = () => {
    const now = Date.now();
    if (ttl === '1h')  return now + 60 * 60 * 1000;
    if (ttl === '24h') return now + 24 * 60 * 60 * 1000;
    if (ttl === '7d')  return now + 7 * 24 * 60 * 60 * 1000;
    if (ttl === '30d') return now + 30 * 24 * 60 * 60 * 1000;
    if (ttl === 'custom') {
      if (!customExpiry) { window.alert(t('share.expiry.invalidDate')); return undefined; }
      const ts = Date.parse(customExpiry);
      if (!Number.isFinite(ts)) { window.alert(t('share.expiry.invalidDate')); return undefined; }
      if (ts <= now) { window.alert(t('share.expiry.pastDate')); return undefined; }
      return ts;
    }
    return null; // never
  };

  const create = async () => {
    const expiresAt = resolveExpiry();
    if (expiresAt === undefined) return; // cancelled / invalid
    setBusy(true); setError(null);
    try {
      await apiCreateShareLink(syncConfig.httpUrl, syncConfig.token, wsId, 'note', note.id, { level, label: label.trim() || null, expiresAt, allowSubmit, includeLinked });
      setLabel('');
      await refresh();
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };
  const revoke = async (id) => {
    if (!confirm(t('share.revoke.confirmLink'))) return;
    setBusy(true);
    try {
      await apiRevokeShareLink(syncConfig.httpUrl, syncConfig.token, wsId, 'note', note.id, id);
      await refresh();
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };
  const copy = (token) => {
    const row = links.find(l => l.token === token);
    const url = (row && row.share_url) || `${baseUrl}/share/${token}`;
    try { navigator.clipboard.writeText(url); } catch {}
  };

  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onClose} />
      <div className="vault-share-modal" role="dialog">
        <div className="vault-share-head">
          <span className="vault-share-title">{t('share.note.title', { name: note.name.replace(/\.(md|markdown|txt)$/i, '') })}</span>
          <button className="history-close" onClick={onClose} title={t('btn.closeEsc')}>×</button>
        </div>
        <div className="vault-share-body">
          {links.length === 0 && !busy && <div className="vault-share-empty">{t('share.empty.note')}</div>}
          {links.map(l => (
            <div key={l.id} className="vault-share-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="vault-share-email" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  {l.share_url || `${baseUrl}/share/${l.token}`}
                </span>
                <span className={`role-badge role-${l.level === 'view' ? 'viewer' : 'editor'}`}>{l.level}</span>
                <ShareExpiryBadge expiresAt={l.expires_at} />
                <button
                  className={`role-badge ${l.allow_submit ? 'role-editor' : 'role-viewer'}`}
                  style={{ cursor: 'pointer', border: 'none' }}
                  title={t('share.allowSubmit.tip')}
                  onClick={async () => {
                    setBusy(true); setError(null);
                    try {
                      await apiSetShareLinkSubmit(syncConfig.httpUrl, syncConfig.token, wsId, 'note', note.id, l.id, !l.allow_submit);
                      await refresh();
                    } catch (err) { setError(err.message || String(err)); }
                    finally { setBusy(false); }
                  }}>{l.allow_submit ? t('share.allowSubmit.on') : t('share.allowSubmit.off')}</button>
                <button
                  className={`role-badge ${l.include_linked ? 'role-editor' : 'role-viewer'}`}
                  style={{ cursor: 'pointer', border: 'none' }}
                  title={t('share.includeLinked.tip')}
                  onClick={async () => {
                    setBusy(true); setError(null);
                    try {
                      await apiSetShareLinkIncludeLinked(syncConfig.httpUrl, syncConfig.token, wsId, 'note', note.id, l.id, !l.include_linked);
                      await refresh();
                    } catch (err) { setError(err.message || String(err)); }
                    finally { setBusy(false); }
                  }}>{l.include_linked ? t('share.includeLinked.on') : t('share.includeLinked.off')}</button>
                <button className="vault-add-btn" onClick={() => copy(l.token)} title={t('btn.copy.tip')} aria-label={t('btn.copy.tip')}><ShIcon name="copy" size={14} /></button>
                <button className="ws-icon danger" onClick={() => revoke(l.id)} title={t('share.revoke.tip')}>×</button>
              </div>
              {l.label && <div style={{ fontSize: 11, opacity: 0.7 }}>{l.label}</div>}
            </div>
          ))}
          <div className="vault-share-invite">
            <input className="sync-input"
              placeholder={t('share.labelPh')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={{ flex: 1, minWidth: 100 }} />
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="view">{t('share.level.view')}</option>
              <option value="comment">{t('share.level.comment')}</option>
            </select>
            <select value={ttl} onChange={(e) => {
              setTtl(e.target.value);
              if (e.target.value === 'custom' && !customExpiry) {
                const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
                const pad = (n) => String(n).padStart(2, '0');
                setCustomExpiry(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
              }
            }} title={t('share.expiry.label')}>
              <option value="never">{t('share.expiry.never')}</option>
              <option value="1h">{t('share.expiry.1h')}</option>
              <option value="24h">{t('share.expiry.24h')}</option>
              <option value="7d">{t('share.expiry.7d')}</option>
              <option value="30d">{t('share.expiry.30d')}</option>
              <option value="custom">{t('share.expiry.custom')}</option>
            </select>
            {ttl === 'custom' && (
              <input type="datetime-local" className="sync-input"
                value={customExpiry}
                onChange={(e) => setCustomExpiry(e.target.value)}
                style={{ minWidth: 180 }} />
            )}
            <button className="vault-add-btn" onClick={create} disabled={busy}>{t('share.createLink')}</button>
          </div>
          <label className="share-form-toggle" title={t('share.allowSubmit.tip')}
            style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12, opacity: 0.85, cursor: 'pointer' }}>
            <input type="checkbox" checked={allowSubmit} onChange={(e) => setAllowSubmit(e.target.checked)} />
            <span>{t('share.allowSubmit')}</span>
          </label>
          <label className="share-form-toggle" title={t('share.includeLinked.tip')}
            style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, fontSize: 12, opacity: 0.85, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeLinked} onChange={(e) => setIncludeLinked(e.target.checked)} />
            <span>{t('share.includeLinked')}</span>
          </label>
          <div style={{ borderTop: '1px dashed rgba(0,0,0,0.15)', marginTop: 12, paddingTop: 12 }}>
            <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {t('share.aclHead')}
            </div>
            {grants.length === 0 && !busy && (
              <div className="vault-share-empty" style={{ fontSize: 12 }}>
                {t('share.acl.empty.note')}
              </div>
            )}
            {grants.map(g => (
              <div key={g.id} className="vault-share-row">
                <span className="vault-share-email">{g.email || `user#${g.user_id}`}</span>
                <span className={`role-badge role-${g.level === 'view' ? 'viewer' : 'editor'}`}>{g.level}</span>
                <button
                  className="ws-icon danger"
                  onClick={async () => {
                    if (!confirm(t('share.removeGrant.confirm'))) return;
                    setBusy(true); setError(null);
                    try {
                      await apiRemoveAclGrant(syncConfig.httpUrl, syncConfig.token, wsId, 'note', note.id, g.id);
                      await refresh();
                    } catch (err) { setError(err.message || String(err)); }
                    finally { setBusy(false); }
                  }}
                  title={t('share.acl.remove.tip')}>×</button>
              </div>
            ))}
            <div className="vault-share-invite">
              <input className="sync-input"
                placeholder={t('share.acl.emailPh')}
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                style={{ flex: 1 }} />
              <select value={grantLevel} onChange={(e) => setGrantLevel(e.target.value)}>
                <option value="view">view</option>
                <option value="comment">comment</option>
                <option value="edit">edit</option>
                <option value="admin">admin</option>
                <option value="none">none (block)</option>
              </select>
              <button className="vault-add-btn"
                disabled={busy || !grantEmail.trim()}
                onClick={async () => {
                  setBusy(true); setError(null);
                  try {
                    await apiUpsertAclGrant(syncConfig.httpUrl, syncConfig.token, wsId, 'note', note.id, {
                      email: grantEmail.trim(), level: grantLevel,
                    });
                    setGrantEmail('');
                    await refresh();
                  } catch (err) { setError(err.message || String(err)); }
                  finally { setBusy(false); }
                }}>{t('share.acl.grant')}</button>
            </div>
          </div>
          {error && <div className="vault-share-error">{error}</div>}
          <div className="vault-share-hint">
            {t('share.hint')}
          </div>
        </div>
      </div>
    </>
  );
}

// Folder share modal — clone of NoteShareModal targeting resource_type
// 'folder'. Lets owner/editor share a folder via public link AND grant
// per-user access. As with NoteShareModal, grants are storage-only at
// this stage; the renderer-side UI hide consumes them but Yjs CRDT
// writes within a vault doc are not enforced server-side.
function FolderShareModal({ folder, onClose, syncConfig }) {
  const [links, setLinks] = useState([]);
  const [grants, setGrants] = useState([]);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState('view');
  const [label, setLabel] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantLevel, setGrantLevel] = useState('edit');
  const [error, setError] = useState(null);
  const wsId = syncConfig && syncConfig.currentWorkspaceId;
  const canCall = !!(syncConfig && syncConfig.token && syncConfig.httpUrl && wsId && folder);
  const baseUrl = syncConfig && syncConfig.httpUrl ? syncConfig.httpUrl.replace(/\/$/, '') : '';

  const refresh = useCallback(async () => {
    if (!canCall) return;
    setBusy(true); setError(null);
    try {
      const [r, g] = await Promise.all([
        apiListShareLinks(syncConfig.httpUrl, syncConfig.token, wsId, 'folder', folder.id),
        apiListAclGrants(syncConfig.httpUrl, syncConfig.token, wsId, 'folder', folder.id),
      ]);
      setLinks(r.links || []);
      setGrants(g.grants || []);
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  }, [syncConfig, wsId, folder, canCall]);

  useEffect(() => { if (folder) refresh(); }, [folder, refresh]);
  useEffect(() => {
    if (!folder) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [folder, onClose]);

  if (!folder) return null;

  const createLink = async () => {
    setBusy(true); setError(null);
    try {
      await apiCreateShareLink(syncConfig.httpUrl, syncConfig.token, wsId, 'folder', folder.id, {
        level, label: label.trim() || null,
      });
      setLabel('');
      await refresh();
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };
  const revokeLink = async (id) => {
    if (!confirm(t('share.revoke.confirmLink'))) return;
    setBusy(true);
    try {
      await apiRevokeShareLink(syncConfig.httpUrl, syncConfig.token, wsId, 'folder', folder.id, id);
      await refresh();
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };
  const copy = (token) => {
    const row = links.find(l => l.token === token);
    const url = (row && row.share_url) || `${baseUrl}/share/${token}`;
    try { navigator.clipboard.writeText(url); } catch {}
  };
  const grant = async () => {
    if (!grantEmail.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiUpsertAclGrant(syncConfig.httpUrl, syncConfig.token, wsId, 'folder', folder.id, {
        email: grantEmail.trim(), level: grantLevel,
      });
      setGrantEmail('');
      await refresh();
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };
  const ungrant = async (id) => {
    if (!confirm(t('share.removeGrant.confirm'))) return;
    setBusy(true); setError(null);
    try {
      await apiRemoveAclGrant(syncConfig.httpUrl, syncConfig.token, wsId, 'folder', folder.id, id);
      await refresh();
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onClose} />
      <div className="vault-share-modal" role="dialog">
        <div className="vault-share-head">
          <span className="vault-share-title">{t('share.folder.title', { name: folder.name })}</span>
          <button className="history-close" onClick={onClose} title={t('btn.closeEsc')} aria-label={t('btn.close')}>×</button>
        </div>
        <div className="vault-share-body">
          {links.length === 0 && !busy && (
            <div className="vault-share-empty">{t('share.empty.folder')}</div>
          )}
          {links.map(l => (
            <div key={l.id} className="vault-share-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="vault-share-email" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  {l.share_url || `${baseUrl}/share/${l.token}`}
                </span>
                <span className={`role-badge role-${l.level === 'view' ? 'viewer' : 'editor'}`}>{l.level}</span>
                <button className="vault-add-btn" onClick={() => copy(l.token)} title={t('btn.copy.tip')} aria-label={t('btn.copy.tip')}><ShIcon name="copy" size={14} /></button>
                <button className="ws-icon danger" onClick={() => revokeLink(l.id)} title={t('share.revoke.tip')} aria-label={t('share.revoke.tip')}>×</button>
              </div>
              {l.label && <div style={{ fontSize: 11, opacity: 0.7 }}>{l.label}</div>}
            </div>
          ))}
          <div className="vault-share-invite">
            <input className="sync-input" placeholder={t('share.labelPh')}
              value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="view">view</option>
              <option value="comment">comment</option>
            </select>
            <button className="vault-add-btn" onClick={createLink} disabled={busy}>{t('share.createLink')}</button>
          </div>
          <div style={{ borderTop: '1px dashed rgba(0,0,0,0.15)', marginTop: 12, paddingTop: 12 }}>
            <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {t('share.aclHeadShort')}
            </div>
            {grants.length === 0 && !busy && (
              <div className="vault-share-empty" style={{ fontSize: 12 }}>{t('share.acl.empty.folder')}</div>
            )}
            {grants.map(g => (
              <div key={g.id} className="vault-share-row">
                <span className="vault-share-email">{g.email || `user#${g.user_id}`}</span>
                <span className={`role-badge role-${g.level === 'view' ? 'viewer' : 'editor'}`}>{g.level}</span>
                <button className="ws-icon danger" onClick={() => ungrant(g.id)} title={t('share.acl.remove.tip')} aria-label={t('share.acl.remove.tip')}>×</button>
              </div>
            ))}
            <div className="vault-share-invite">
              <input className="sync-input" placeholder={t('share.acl.emailPh')}
                value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} style={{ flex: 1 }} />
              <select value={grantLevel} onChange={(e) => setGrantLevel(e.target.value)}>
                <option value="view">view</option>
                <option value="comment">comment</option>
                <option value="edit">edit</option>
                <option value="admin">admin</option>
                <option value="none">none (block)</option>
              </select>
              <button className="vault-add-btn" disabled={busy || !grantEmail.trim()} onClick={grant}>{t('share.acl.grant')}</button>
            </div>
          </div>
          {error && <div className="vault-share-error">{error}</div>}
        </div>
      </div>
    </>
  );
}

// Workspace audit log viewer — owner-only. Lists events newest-first
// with a kind filter dropdown. Reads via apiListAuditEvents from the
// server's append-only audit_log table.
function AuditModal({ workspaceId, onClose, syncConfig }) {
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [kindFilter, setKindFilter] = useState('');

  const canCall = !!(syncConfig && syncConfig.token && syncConfig.httpUrl && workspaceId);

  const refresh = useCallback(async () => {
    if (!canCall) return;
    setBusy(true); setError(null);
    try {
      const r = await apiListAuditEvents(syncConfig.httpUrl, syncConfig.token, workspaceId, { kind: kindFilter || undefined, limit: 500 });
      setEvents(r.events || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  }, [syncConfig, workspaceId, canCall, kindFilter]);

  useEffect(() => { if (workspaceId) refresh(); }, [workspaceId, refresh]);

  useEffect(() => {
    if (!workspaceId) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspaceId, onClose]);

  if (!workspaceId) return null;

  const knownKinds = Array.from(new Set(events.map(e => e.kind))).sort();
  const summarize = (e) => {
    const p = e.payload || {};
    const v = {
      who: e.user_email || t('audit.system'),
      tgt: e.target_user_email ? ` → ${e.target_user_email}` : '',
      role: p.role ? ` (${p.role})` : '',
      id: e.target_id,
      from: p.ip ? t('audit.from', { ip: p.ip }) : '',
    };
    switch (e.kind) {
      case 'workspace.member.invite':       return t('audit.member.invite', v);
      case 'workspace.member.remove':       return t('audit.member.remove', v);
      case 'workspace.member.role_change':  return t('audit.member.role', v);
      case 'workspace.delete':              return t('audit.ws.delete', { ...v, name: p.name });
      case 'vault.member.invite':           return t('audit.vault.invite', v);
      case 'vault.member.role_change':      return t('audit.vault.role', v);
      case 'vault.member.remove':           return t('audit.vault.remove', v);
      case 'workspace.migrate.to_vaults':   return t('audit.ws.migrate', { ...v, n: p.vaultsCreated });
      case 'snapshot.restore':              return t('audit.snapshot.restore', v);
      case 'share.link.create':             return t('audit.share.create', { ...v, type: p.resourceType ? ` (${p.resourceType})` : '' });
      case 'share.link.visit':              return t('audit.share.visit', v);
      case 'share.blob.fetch':              return t('audit.share.blob', { ...v, id: String(e.target_id).slice(0, 10) });
      case 'acl.grant.upsert':              return t('audit.acl.upsert', { ...v, level: p.level, type: p.resourceType });
      case 'acl.grant.remove':              return t('audit.acl.remove', v);
      case 'invite.pending.resend':         return t('audit.invite.resend', v);
      default:                              return `${v.who} · ${e.kind}`;
    }
  };

  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onClose} />
      <div className="audit-modal" role="dialog">
        <div className="audit-head">
          <span className="audit-title">{t('qa.audit.title')}</span>
          <button className="history-close" onClick={onClose} title={t('btn.closeEsc')} aria-label={t('btn.close')}>×</button>
        </div>
        <div className="audit-toolbar">
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">{t('audit.all')}</option>
            {knownKinds.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <span style={{ flex: 1, fontSize: 11, opacity: 0.7, alignSelf: 'center' }}>
            {events.length === 1 ? t('audit.count1') : t('audit.countN', { n: events.length })}
          </span>
          <button className="vault-add-btn" onClick={refresh} disabled={busy} title={t('audit.refresh')} aria-label={t('audit.refresh')}>↻</button>
        </div>
        <div className="audit-body">
          {!events.length && !busy && <div className="vault-share-empty">{t('audit.empty')}</div>}
          {events.map(e => (
            <div key={e.id} className="audit-row">
              <span className="audit-ts">{new Date(e.ts).toLocaleString()}</span>
              <span className="audit-kind">{e.kind}</span>
              <span className="audit-summary">{summarize(e)}</span>
            </div>
          ))}
        </div>
        {error && <div className="vault-share-error">{error}</div>}
      </div>
    </>
  );
}

// Vault sharing modal — owner-only. Lists the per-vault members
// (vault_members table) and lets the owner invite by email + adjust
// roles. Pre-Fase-B clients still use the workspace-level role for
// actual Y.Doc access; vault_members is persisted so the next
// per-vault-doc-enabled build picks it up without re-entering.
function VaultShareModal({ vault, onClose, syncConfig, isOwner }) {
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const wsId = syncConfig && syncConfig.currentWorkspaceId;
  const canCall = !!(syncConfig && syncConfig.token && syncConfig.httpUrl && wsId && vault);

  const refresh = useCallback(async () => {
    if (!canCall) return;
    setBusy(true); setError(null);
    try {
      const r = await apiListVaultMembers(syncConfig.httpUrl, syncConfig.token, wsId, vault.id);
      setMembers(r.members || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  }, [syncConfig, wsId, vault, canCall]);

  useEffect(() => { if (vault) refresh(); }, [vault, refresh]);

  useEffect(() => {
    if (!vault) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vault, onClose]);

  if (!vault) return null;

  const doInvite = async () => {
    if (!email.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiInviteVaultMember(syncConfig.httpUrl, syncConfig.token, wsId, vault.id, email.trim(), role);
      setEmail('');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  const doRole = async (uid, newRole) => {
    setBusy(true); setError(null);
    try {
      await apiUpdateVaultMemberRole(syncConfig.httpUrl, syncConfig.token, wsId, vault.id, uid, newRole);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  const doRemove = async (uid) => {
    if (!confirm(t('dlg.removeMemberVault'))) return;
    setBusy(true); setError(null);
    try {
      await apiRemoveVaultMember(syncConfig.httpUrl, syncConfig.token, wsId, vault.id, uid);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onClose} />
      <div className="vault-share-modal" role="dialog">
        <div className="vault-share-head">
          <span className="vault-share-title">{t('share.vault.title', { name: vault.name })}</span>
          <button className="history-close" onClick={onClose} title={t('btn.closeEsc')} aria-label={t('btn.close')}>×</button>
        </div>
        <div className="vault-share-body">
          {members.length === 0 && !busy && (
            <div className="vault-share-empty">
              Nadie tiene acceso explícito a este vault todavía.
              Cuando inviertes a alguien aquí, accederá SOLO a este vault y a los que tenga explícitos.
              Sin entradas, el rol del workspace decide.
            </div>
          )}
          {members.map(m => (
            <div key={m.user_id} className="vault-share-row">
              <span className="vault-share-email">{m.email}</span>
              {isOwner ? (
                <select
                  value={m.role}
                  onChange={(e) => doRole(m.user_id, e.target.value)}
                  disabled={busy}
                  className={`role-badge role-${m.role}`}
                  style={{ border: 'none', cursor: 'pointer' }}>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
              ) : (
                <span className={`role-badge role-${m.role}`}>{m.role}</span>
              )}
              {isOwner && (
                <button className="ws-icon danger" onClick={() => doRemove(m.user_id)} title={t('share.acl.remove.tip')} aria-label={t('share.acl.remove.tip')}>×</button>
              )}
            </div>
          ))}
          {isOwner && (
            <div className="vault-share-invite">
              <input className="sync-input"
                placeholder={t('share.acl.emailPh')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doInvite(); }}
                style={{ flex: 1 }} />
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button className="vault-add-btn" onClick={doInvite} disabled={busy || !email.trim()}>{t('qa.invite')}</button>
            </div>
          )}
          {error && <div className="vault-share-error">{error}</div>}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Image modal: lightbox + crop + rotate
// ─────────────────────────────────────────────────────────────
function ImageModal({ src, sha, name, auth, onClose, onReplace }) {
  useI18n();
  const [mode, setMode] = useState('view'); // 'view' | 'crop'
  const [rotation, setRotation] = useState(0);
  const [copied, setCopied] = useState(false);
  const [crop, setCrop] = useState(null); // {x, y, w, h} in image-space
  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const draggingRef = useRef(null); // { type: 'new'|'move', startX, startY, orig }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (mode === 'crop') setMode('view');
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  const stageToImage = (clientX, clientY) => {
    const img = imgRef.current;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / r.width;
    const scaleY = img.naturalHeight / r.height;
    return {
      x: Math.max(0, Math.min(img.naturalWidth, (clientX - r.left) * scaleX)),
      y: Math.max(0, Math.min(img.naturalHeight, (clientY - r.top) * scaleY)),
    };
  };

  const onPointerDown = (e) => {
    if (mode !== 'crop') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = stageToImage(e.clientX, e.clientY);
    if (!p) return;
    draggingRef.current = { type: 'new', startX: p.x, startY: p.y };
    setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onPointerMove = (e) => {
    const d = draggingRef.current;
    if (!d || mode !== 'crop') return;
    const p = stageToImage(e.clientX, e.clientY);
    if (!p) return;
    if (d.type === 'new') {
      const x = Math.min(d.startX, p.x);
      const y = Math.min(d.startY, p.y);
      const w = Math.abs(p.x - d.startX);
      const h = Math.abs(p.y - d.startY);
      setCrop({ x, y, w, h });
    }
  };
  const onPointerUp = () => { draggingRef.current = null; };

  const applyCrop = () => {
    const img = imgRef.current;
    if (!img || !crop || crop.w < 4 || crop.h < 4) { setMode('view'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = crop.w;
    canvas.height = crop.h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    const out = canvas.toDataURL('image/png');
    setCrop(null);
    setMode('view');
    onReplace(out);
  };

  const applyRotate = () => {
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    setRotation((rotation + 90) % 360);
    onReplace(canvas.toDataURL('image/png'));
  };

  // Render the currently-shown image to a PNG blob so it can ride the
  // clipboard. Prefer the already-loaded <img> (no refetch, works for
  // edinot://blob / data: / blob: without taint); fall back to fetching the
  // source bytes and transcoding non-PNG via createImageBitmap.
  const imageToPngBlob = async () => {
    const img = imgRef.current;
    if (img && img.naturalWidth) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const b = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        if (b) return b;
      } catch {} // tainted canvas (cross-origin) — fall through to fetch
    }
    const resp = await fetch(src);
    const raw = await resp.blob();
    if (raw.type === 'image/png') return raw;
    const bmp = await createImageBitmap(raw);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  };

  const copyImage = async () => {
    try {
      // Pass a Promise<Blob> to ClipboardItem so the async encode keeps the
      // click's user-gesture alive (Chromium requirement for clipboard.write).
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': imageToPngBlob() }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      window.alert(t('img.copyFail', { err: String(err && err.message || err) }));
    }
  };

  const downloadImage = async () => {
    // Blob-backed attachment (edinot://blob/<sha>): save through the native
    // dialog. A plain `<a href="edinot://…" download>` is ignored by Chromium
    // for a custom scheme and NAVIGATES the whole window to the raw image —
    // which is exactly the "opens huge, can't close, must quit" bug.
    if (sha && window.electronAPI && window.electronAPI.saveBlobToFile) {
      try {
        const res = await window.electronAPI.saveBlobToFile(sha, name || 'imagen.png', auth || null);
        if (res && !res.canceled && !res.ok && res.error) {
          window.alert(t('attach.saveFail', { err: res.error }));
        }
      } catch (err) {
        window.alert(String(err && err.message || err));
      }
      return;
    }
    // data: / blob: / http(s) srcs — fetch into an object URL first so the
    // download attribute is honored regardless of the source scheme (a remote
    // or cross-origin href would otherwise navigate instead of downloading).
    try {
      const resp = await fetch(src);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'imagen.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      window.alert(String(err && err.message || err));
    }
  };

  // crop rect screen coords for overlay
  const cropOverlay = () => {
    const img = imgRef.current;
    if (!img || !crop) return null;
    const r = img.getBoundingClientRect();
    const stage = stageRef.current.getBoundingClientRect();
    const sX = r.width / img.naturalWidth;
    const sY = r.height / img.naturalHeight;
    return {
      left: r.left - stage.left + crop.x * sX,
      top: r.top - stage.top + crop.y * sY,
      width: crop.w * sX,
      height: crop.h * sY,
    };
  };

  const overlay = mode === 'crop' && crop ? cropOverlay() : null;

  return (
    <div className="img-modal" onClick={onClose}>
      <div className="img-stage" ref={stageRef}
           onClick={(e) => e.stopPropagation()}
           onPointerDown={onPointerDown}
           onPointerMove={onPointerMove}
           onPointerUp={onPointerUp}
           style={{ cursor: mode === 'crop' ? 'crosshair' : 'default' }}>
        <img ref={imgRef} src={src} alt="" className="img-modal-pic"
             draggable={false} />
        {overlay && (
          <div className="img-crop-rect" style={overlay}>
            <div className="img-crop-handle nw" />
            <div className="img-crop-handle ne" />
            <div className="img-crop-handle sw" />
            <div className="img-crop-handle se" />
          </div>
        )}
      </div>
      <div className="img-toolbar" onClick={(e) => e.stopPropagation()}>
        {mode === 'view' && (
          <>
            <button onClick={() => { setMode('crop'); setCrop(null); }}>{t('img.crop')}</button>
            <button onClick={applyRotate}>⟳ {t('img.rotate')}</button>
            <button onClick={copyImage}>{copied ? t('img.copied') : t('img.copy')}</button>
            <button onClick={downloadImage}>⬇ {t('btn.download')}</button>
            <div className="img-toolbar-sep" />
            <button onClick={onClose}>{t('btn.close')}</button>
          </>
        )}
        {mode === 'crop' && (
          <>
            <span className="img-hint">{t('img.dragHint')}</span>
            <div className="img-toolbar-sep" />
            <button onClick={() => { setCrop(null); setMode('view'); }}>{t('btn.cancel')}</button>
            <button className="primary" onClick={applyCrop} disabled={!crop || crop.w < 4}>{t('img.applyCrop')}</button>
          </>
        )}
      </div>
    </div>
  );
}

// Full-size in-app PDF viewer. Spawned when the user clicks a PDF
// preview inside a table cell (where the iframe is intentionally
// pointer-events: none to keep the cell layout intact). Esc / backdrop
// click closes. The blob URL is loaded directly — Electron's custom
// protocol handles auth + caching transparently.
function PdfModal({ src, name, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="pdf-modal-backdrop" onClick={onClose}>
      <div className="pdf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-modal-head">
          <span className="pdf-modal-title" title={name || ''}>{name || 'PDF'}</span>
          <button type="button" className="pdf-modal-close" onClick={onClose} aria-label={t('btn.close')} title={t('btn.closeEsc')}><ShIcon name="close" size={16} /></button>
        </div>
        <iframe className="pdf-modal-frame" src={src} title={name || 'PDF'} />
      </div>
    </div>
  );
}

export { HistoryModal, NoteShareModal, FolderShareModal, VaultShareModal, AuditModal, ImageModal, PdfModal };
