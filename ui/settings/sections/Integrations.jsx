// IA → «Integraciones (MCP, Web Clipper)». Movido de McpPane (sin los
// interruptores de agentes, que ahora están en «Agentes y permisos») y
// WebClipperPane.

import { useState, useEffect, useCallback } from 'react';
import { t, useI18n } from '../../../i18n.js';
import { Icon } from '../../shell/icons.jsx';
import { Row, Group, Button, TextField, Notice } from '../controls.jsx';
import { rowProps } from '../registry.js';

const CLIENTS = [
  { id: 'claude', title: 'Claude Desktop', glyph: 'C', tip: 'mcp.configClaude' },
  { id: 'codex', title: 'Codex Desktop', glyph: '⌥', tip: 'mcp.configCodex' },
  { id: 'claudeCode', title: 'Claude Code CLI', glyph: '⌘', tip: 'mcp.configClaudeCode' },
  { id: 'cursor', title: 'Cursor', glyph: '▣', tip: 'mcp.configCursor' },
];

function McpRows({ syncConfig }) {
  useI18n();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, message, ... }
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.mcpGetInfo) {
      window.electronAPI.mcpGetInfo().then(setInfo).catch(() => setInfo({}));
    } else { setInfo({}); }
  }, []);

  const loggedIn = !!(syncConfig && syncConfig.token && syncConfig.currentWorkspaceId);
  const mcpPath = (info && info.mcpServerPath) || '<edinot>/mcp/server.mjs';
  const snippet = JSON.stringify({
    mcpServers: { edinot: { command: 'node', args: [mcpPath] } },
  }, null, 2);
  const codexSnippet = `[mcp_servers.edinot]\ncommand = "node"\nargs = ["${mcpPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]\n`;

  const copy = (text, tag) => {
    try { navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(''), 1400); } catch {}
  };

  // Single setup flow — caller picks which client config to merge in.
  // `target` is one of: 'claude' | 'codex' | 'claudeCode' | 'cursor' | 'none' (credentials only).
  const [target, setTarget] = useState(null);
  const setup = async (which) => {
    if (!window.electronAPI || !window.electronAPI.mcpSetup) return;
    setBusy(true); setStatus(null); setTarget(which);
    try {
      const args = {
        mcpServerPath: info && info.mcpServerPath,
        alsoClaudeConfig: which === 'claude',
        alsoCodexConfig: which === 'codex',
        alsoClaudeCodeConfig: which === 'claudeCode',
        alsoCursorConfig: which === 'cursor',
      };
      if (loggedIn) {
        Object.assign(args, {
          mode: 'sync',
          httpUrl: syncConfig.httpUrl,
          token: syncConfig.token,
          workspaceId: syncConfig.currentWorkspaceId,
          email: syncConfig.email,
          userId: syncConfig.userId,
          tier: syncConfig.tier,
          tlsCa: syncConfig.tlsCa,
        });
      } else {
        args.mode = 'local';
      }
      const res = await window.electronAPI.mcpSetup(args);
      setStatus(res);
    } catch (err) {
      setStatus({ ok: false, error: err.message || String(err) });
    } finally { setBusy(false); }
  };
  const canSetup = !!(window.electronAPI && window.electronAPI.mcpSetup);
  const reveal = (which) => (e) => { e.preventDefault(); window.electronAPI && window.electronAPI.mcpRevealFile && window.electronAPI.mcpRevealFile(which); };
  const merged = (file, which, restartKey) => (
    <div className="st-hint">
      <Icon name="check" size={13} stroke={2.4} /> <code>{file}</code> {t('mcp.claudeConfigUpdated')}{' '}
      <a href="#" onClick={reveal(which)}>{t('mcp.openFolder')}</a> — {t(restartKey)}
    </div>
  );

  return (
    <Group title="MCP">
      <p className="st-hint" style={{ margin: '0 0 8px' }}>
        {t('mcp.intro')}{' '}{loggedIn ? t('mcp.useSession') : t('mcp.noSyncHint')}
      </p>
      <Row {...rowProps('integrations.mcp')} stack>
        <div className="st-cards">
          {CLIENTS.map(c => (
            <button type="button" key={c.id} className="st-card" disabled={busy || !canSetup}
              onClick={() => setup(c.id)} title={t(c.tip)} aria-busy={busy && target === c.id}>
              <span className="st-card-g" aria-hidden="true">{c.glyph}</span>
              <span className="st-card-t">
                <b>{c.title}</b>
                <span>{busy && target === c.id ? t('mcp.configuring') : t('mcp.autoConfigure')}</span>
              </span>
              <Icon name="chevRight" size={15} />
            </button>
          ))}
        </div>
        {!canSetup && <div className="st-hint">{t('st.desktopOnly')}</div>}
        {status && status.ok && (
          <div className="st-notice ok">
            <div>{t('mcp.credsWritten')} <code>{status.cliAuthPath}</code></div>
            {status.localVaultDir && <div>{t('mcp.localMode')} <code>{status.localVaultDir}</code></div>}
            {status.claudeConfigMerged && merged('claude_desktop_config.json', 'claude', 'mcp.restartClaude')}
            {status.codexConfigMerged && merged('~/.codex/config.toml', 'codex', 'mcp.restartCodex')}
            {status.claudeCodeConfigMerged && merged('~/.claude.json', 'claudeCode', 'mcp.restartClaudeCode')}
            {status.cursorConfigMerged && merged('~/.cursor/mcp.json', 'cursor', 'mcp.restartCursor')}
            {status.claudeConfigError && <div className="st-conflict">{t('mcp.claudeConfigErr', { err: status.claudeConfigError })}</div>}
            {status.codexConfigError && <div className="st-conflict">{t('mcp.codexConfigErr', { err: status.codexConfigError })}</div>}
            {status.claudeCodeConfigError && <div className="st-conflict">{t('mcp.claudeCodeConfigErr', { err: status.claudeCodeConfigError })}</div>}
            {status.cursorConfigError && <div className="st-conflict">{t('mcp.cursorWriteErr', { err: status.cursorConfigError })}</div>}
          </div>
        )}
        {status && !status.ok && <Notice tone="error">{status.error || t('mcp.setupFailed')}</Notice>}
      </Row>
      <Row {...rowProps('integrations.creds')}>
        <Button disabled={busy || !canSetup} onClick={() => setup('none')}>
          {busy && target === 'none' ? t('mcp.saving') : t('st.mcp.credsBtn')}
        </Button>
      </Row>
      <Row {...rowProps('integrations.manual')} stack last>
        <details className="st-details">
          <summary>{t('mcp.manualSummary')}</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
            <div className="st-snip">
              <div className="st-snip-head">
                <span>claude_desktop_config.json</span>
                <Button size="sm" onClick={() => copy(snippet, 'json')}>{copied === 'json' ? t('btn.copied') : t('btn.copy')}</Button>
              </div>
              <pre className="st-pre">{snippet}</pre>
            </div>
            <div className="st-snip">
              <div className="st-snip-head">
                <span>~/.codex/config.toml</span>
                <Button size="sm" onClick={() => copy(codexSnippet, 'toml')}>{copied === 'toml' ? t('btn.copied') : t('btn.copy')}</Button>
              </div>
              <pre className="st-pre">{codexSnippet}</pre>
            </div>
            <div className="st-hint">{t('st.mcp.tools')} list_notes · read_note · write_note · create_note · delete_note · rename_note · search_notes</div>
          </div>
        </details>
      </Row>
    </Group>
  );
}

function ClipperRows() {
  useI18n();
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copyOk, setCopyOk] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.clipperGetStatus) return;
    try {
      const s = await window.electronAPI.clipperGetStatus();
      setStatus(s);
      const tok = await window.electronAPI.clipperGetToken();
      if (tok?.ok) setToken(tok.token || '');
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const regenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.clipperGenerateToken();
      if (r?.ok) { setToken(r.token); setRevealed(true); }
      await refresh();
    } finally { setBusy(false); }
  };

  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.electronAPI.clipperRevokeToken();
      setToken('');
      setRevealed(false);
      await refresh();
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1200);
    } catch {}
  };

  const running = !!status?.running;
  const port = status?.port;
  const desktop = !!window.electronAPI?.clipperGetStatus;

  return (
    <Group title={t('clipper.title')}>
      <Row {...rowProps('integrations.clipper', { help: t('clipper.desc') })}>
        <span className={`st-pill${running ? ' ok' : ' bad'}`}>
          <span className={`st-dot${running ? ' on' : ''}`} aria-hidden="true" />
          {running ? t('clipper.running') : t('clipper.stopped')}
        </span>
        <span className="st-hint">{running ? t('clipper.port', { port }) : (desktop ? t('clipper.unavailable') : t('st.desktopOnly'))}</span>
      </Row>
      <Row {...rowProps('integrations.clipperToken')} stack last>
        <div className="st-inline">
          <TextField mono
            type={revealed ? 'text' : 'password'}
            aria-label={t('clipper.token')}
            value={token}
            readOnly
            placeholder={t('clipper.noToken')} />
          <Button variant="ghost" onClick={() => setRevealed(v => !v)} aria-pressed={revealed} aria-label={revealed ? t('clipper.hide') : t('clipper.show')} title={revealed ? t('clipper.hide') : t('clipper.show')}>
            <Icon name="eye" size={15} />
          </Button>
          <Button onClick={copy} disabled={!token} title={t('clipper.copyTip')}>
            {copyOk ? <Icon name="check" size={14} stroke={2.4} /> : <Icon name="copy" size={14} />}{t('clipper.copy')}
          </Button>
        </div>
        <div className="st-inline">
          <Button variant="primary" onClick={regenerate} disabled={busy || !desktop}>{t('clipper.generate')}</Button>
          <Button variant="danger" onClick={revoke} disabled={busy || !token}>{t('clipper.revoke')}</Button>
        </div>
        <details className="st-details">
          <summary>{t('clipper.howTo')}</summary>
          <ol>
            <li>{t('clipper.step1')}</li>
            <li>{t('clipper.step2pre')} <code>web-clipper/dist/chrome</code> {t('clipper.step2or')} <code>/firefox</code>{t('clipper.step2post')}</li>
            <li>{t('clipper.step3')}</li>
            <li>{t('clipper.step4')}</li>
          </ol>
        </details>
      </Row>
    </Group>
  );
}

// Comando `edinot` en la terminal (Linux, macOS y Windows): un script que apunta al CLI de la propia app.
function CliRows() {
  useI18n();
  const api = window.electronAPI;
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (api && api.cliStatus) api.cliStatus().then(setSt).catch(() => setSt(null)); }, []);
  if (!api || !api.cliStatus) return null;
  const run = async (fn) => {
    setBusy(true); setErr(null);
    try { const r = await fn(); if (r && r.ok === false) setErr(r.error); else setSt(r); }
    catch (e) { setErr(String(e && e.message || e)); }
    finally { setBusy(false); }
  };
  const pathHint = st && !st.inPath
    ? (st.platform === 'win32'
      ? t('st.cli.pathWin', { dir: st.dir })
      : t('st.cli.pathUnix', { dir: st.dir }))
    : null;
  const exportLine = st && st.platform !== 'win32' ? `export PATH="$HOME/.local/bin:$PATH"` : '';
  return (
    <Group title={t('st.cli.group')}>
      <Row {...rowProps('integrations.cli')} stack last>
        <div className="st-inline">
          {st && st.installed
            ? <>
                <span className="st-pill ok"><span className="st-dot on" aria-hidden="true" />{t('st.cli.installed')}</span>
                <Button onClick={() => run(api.cliInstall)} disabled={busy}>{t('st.cli.reinstall')}</Button>
                <Button variant="ghost" onClick={() => run(api.cliUninstall)} disabled={busy}>{t('st.cli.remove')}</Button>
              </>
            : <Button variant="primary" onClick={() => run(api.cliInstall)} disabled={busy || !st}>{t('st.cli.install')}</Button>}
        </div>
        {st && st.installed && <div className="st-hint">{t('st.cli.try')} <code>edinot help</code> · <code>{st.file}</code></div>}
        {st && st.installed && pathHint && (
          <Notice tone="info">
            {pathHint}
            {exportLine && <> <code>{exportLine}</code> <Button size="sm" onClick={() => { try { navigator.clipboard.writeText(exportLine); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {} }}>{copied ? t('st.sync.copied') : t('st.sync.copy')}</Button></>}
          </Notice>
        )}
        {err && <Notice tone="error">{err}</Notice>}
      </Row>
    </Group>
  );
}

export function IntegrationsSection({ ctx }) {
  return (
    <>
      <McpRows syncConfig={ctx.syncConfig} />
      <CliRows />
      <ClipperRows />
    </>
  );
}
