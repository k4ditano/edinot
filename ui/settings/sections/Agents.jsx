// Opciones para asistentes externos conectados por MCP (Claude Code, Codex, Cursor…):
// permisos por vault, instrucciones y la clave de OpenAI de la búsqueda semántica del MCP.
// Edinot no lleva IA propia; esto solo ajusta cómo se comportan los que se conectan desde fuera.
// Se muestra plegado dentro de «Conexiones».

import { useState, useEffect, useCallback } from 'react';
import { t, useI18n, getLang } from '../../../i18n.js';
import { yMeta } from '../../../store.js';
import { DEFAULT_AI_INSTRUCTIONS, defaultAiInstructions } from '../../../shared/ai-defaults.js';
import { Icon } from '../../shell/icons.jsx';
import { Row, Group, Select, Button, TextField } from '../controls.jsx';
import { rowProps } from '../registry.js';
import { useYVersion } from '../util.js';

export function AssistantOptions({ ctx }) {
  useI18n();
  useYVersion(yMeta); // re-render cuando cambia agentPolicy
  const { settings, setSettings, vaults = [] } = ctx;
  // Permisos por vault de los asistentes externos.
  const vaultOpts = (vaults && vaults.length) ? vaults : [{ id: 'default', name: 'Personal' }];
  const [selVault, setSelVault] = useState(vaultOpts[0].id);
  const [polDraft, setPolDraft] = useState({ allowKinds: '', denyKinds: '', allowAliases: '', denyAliases: '' });
  const [polSaved, setPolSaved] = useState(false);
  useEffect(() => {
    const p = ((yMeta.get('agentPolicy') || {})[selVault]) || {};
    const j = (x) => (Array.isArray(x) ? x.join(', ') : '');
    setPolDraft({ allowKinds: j(p.allowKinds), denyKinds: j(p.denyKinds), allowAliases: j(p.allowAliases), denyAliases: j(p.denyAliases) });
  }, [selVault]);
  const savePolicy = () => {
    const parse = (s) => String(s || '').split(',').map(x => x.trim().toLowerCase().replace(/^@+/, '')).filter(Boolean).slice(0, 50);
    const all = (yMeta.get('agentPolicy') && typeof yMeta.get('agentPolicy') === 'object') ? { ...yMeta.get('agentPolicy') } : {};
    all[selVault] = { allowKinds: parse(polDraft.allowKinds), denyKinds: parse(polDraft.denyKinds), allowAliases: parse(polDraft.allowAliases), denyAliases: parse(polDraft.denyAliases) };
    yMeta.set('agentPolicy', all);
    setPolSaved(true); setTimeout(() => setPolSaved(false), 1400);
  };
  const clearPolicy = () => {
    const all = (yMeta.get('agentPolicy') && typeof yMeta.get('agentPolicy') === 'object') ? { ...yMeta.get('agentPolicy') } : {};
    delete all[selVault];
    yMeta.set('agentPolicy', all);
    setPolDraft({ allowKinds: '', denyKinds: '', allowAliases: '', denyAliases: '' });
  };

  return (
    <>
      <Row {...rowProps('agents.policy', { help: t('ailocal.policyHint') })} stack>
        <div className="st-inline">
          <span className="st-hint">{t('ailocal.policy.vault')}</span>
          <Select label={t('ailocal.policy.vault')} value={selVault} onChange={setSelVault}
            options={vaultOpts.map(v => ({ value: v.id, label: v.name }))} />
        </div>
        <div className="st-fields">
          {[['allowKinds', t('ailocal.policy.allowKinds')], ['denyKinds', t('ailocal.policy.denyKinds')], ['allowAliases', t('ailocal.policy.allowAliases')], ['denyAliases', t('ailocal.policy.denyAliases')]].map(([k, label]) => (
            <label className="st-field" key={k} style={{ minWidth: 300 }}>{label}
              <TextField value={polDraft[k]} onChange={e => setPolDraft(d => ({ ...d, [k]: e.target.value }))} placeholder="claude, codex…" />
            </label>
          ))}
        </div>
        <div className="st-inline">
          <Button variant="primary" onClick={savePolicy}>{polSaved ? t('mcp.ai.saved') : t('ailocal.policy.save')}</Button>
          <Button onClick={clearPolicy}>{t('ailocal.policy.clear')}</Button>
        </div>
      </Row>

      <AiInstructionsRow settings={settings} setSettings={setSettings} />
      <SemanticRecallRows settings={settings} setSettings={setSettings} />
    </>
  );
}

// AI behavior guide editor. Saves to `ySettings.aiInstructions` (synced
// across the workspace). MCP server exposes via `get_ai_instructions`
// tool + `edinot://ai-instructions` resource so any compatible AI
// client picks it up at session start. Export/Import is plain JSON so
// teams can share a baseline ("how we want Edinot used").
function AiInstructionsRow({ settings, setSettings }) {
  useI18n();
  const stored = String((settings && settings.aiInstructions) || '');
  const [draft, setDraft] = useState(stored);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setDraft(stored); }, [stored]);

  const dirty = draft !== stored;
  const usingDefault = !stored;

  const save = useCallback(() => {
    setSettings(prev => ({ ...prev, aiInstructions: draft }));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  }, [draft, setSettings]);

  const loadDefault = useCallback(() => {
    const def = defaultAiInstructions(getLang());
    if (draft && draft !== DEFAULT_AI_INSTRUCTIONS && draft !== def) {
      if (!confirm(t('mcp.ai.confirmLoadDefault'))) return;
    }
    setDraft(def);
  }, [draft]);

  const reset = useCallback(() => {
    if (!stored && !draft) return;
    if (!confirm(t('mcp.ai.confirmReset'))) return;
    setDraft('');
    setSettings(prev => ({ ...prev, aiInstructions: '' }));
  }, [stored, draft, setSettings]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify({
      kind: 'edinot.ai-instructions',
      version: 1,
      exportedAt: new Date().toISOString(),
      instructions: draft,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'edinot-ai-instructions.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [draft]);

  const importJson = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed && parsed.kind !== 'edinot.ai-instructions') {
          if (!confirm(t('mcp.ai.confirmImportUnknown'))) return;
        }
        const incoming = String((parsed && parsed.instructions) || '');
        if (stored && !confirm(t('mcp.ai.confirmImportReplace'))) return;
        setDraft(incoming);
        setSettings(prev => ({ ...prev, aiInstructions: incoming }));
      } catch (err) {
        alert(t('mcp.ai.importErr', { err: err.message || String(err) }));
      }
    };
    input.click();
  }, [stored, setSettings]);

  return (
    <Row {...rowProps('agents.instructions', { help: t('mcp.ai.hint') + (usingDefault ? ' · ' + t('mcp.ai.usingDefault') : '') })} stack>
      <textarea
        className="st-textarea"
        aria-label={t('mcp.ai.title')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={defaultAiInstructions(getLang())}
        rows={14}
        spellCheck={false}
      />
      <div className="st-inline">
        <Button variant="primary" onClick={save} disabled={!dirty}>
          {savedFlash ? t('mcp.ai.saved') : t('mcp.ai.save')}
        </Button>
        <Button onClick={loadDefault}>{t('mcp.ai.loadDefault')}</Button>
        <Button onClick={exportJson} disabled={!draft.trim()}>{t('mcp.ai.export')}</Button>
        <Button onClick={importJson}>{t('mcp.ai.import')}</Button>
        <Button variant="danger" onClick={reset} disabled={!stored && !draft}>{t('mcp.ai.reset')}</Button>
      </div>
    </Row>
  );
}

// Clave de OpenAI para `recall_semantic`. El índice lo mantiene el propio MCP
// (~/.config/edinot): la app no indexa nada, solo guarda la clave en los
// ajustes del workspace para que el MCP la lea.
function SemanticRecallRows({ settings, setSettings }) {
  useI18n();
  const [key, setKey] = useState(settings.openaiKey || '');
  const [showKey, setShowKey] = useState(false);
  useEffect(() => { setKey(settings.openaiKey || ''); }, [settings.openaiKey]);
  const saveKey = () => setSettings(prev => ({ ...prev, openaiKey: key.trim() }));
  const clearKey = () => {
    setKey('');
    setSettings(prev => ({ ...prev, openaiKey: '' }));
  };
  const hasKey = !!(settings.openaiKey || '').trim();

  return (
    <Group title={t('st.agents.semantic')}>
      <p className="st-hint" style={{ margin: '0 0 8px' }}>{t('recall.intro')}</p>
      <Row {...rowProps('agents.recallKey', { help: t('recall.keyHint') })} stack last>
        <form className="st-inline" onSubmit={(e) => { e.preventDefault(); saveKey(); }}>
          <TextField mono
            type={showKey ? 'text' : 'password'}
            aria-label={t('recall.keyLabel')}
            value={key}
            placeholder="sk-…"
            onChange={(e) => setKey(e.target.value)}
            spellCheck={false}
            autoComplete="off" />
          <Button variant="ghost" onClick={() => setShowKey(v => !v)} aria-pressed={showKey} aria-label={t(showKey ? 'recall.hideKey' : 'recall.showKey')} title={t(showKey ? 'recall.hideKey' : 'recall.showKey')}>
            <Icon name="eye" size={15} />
          </Button>
          <Button variant="primary" type="submit" disabled={key.trim() === (settings.openaiKey || '').trim()}>{t('btn.save')}</Button>
          {hasKey && <Button variant="danger" onClick={clearKey} title={t('recall.clearKey')}>{t('recall.clearKey')}</Button>}
        </form>
      </Row>
    </Group>
  );
}
