// Reuniones y actas (1.4): una sección propia. Cada paso (transcribir el audio, redactar el acta) tiene su propio
// servidor compatible con la API de OpenAI, clave y modelo; el segundo puede reutilizar los del primero.
// La grabación y el acta en sí viven en ui/meetings/.

import { useState, useEffect } from 'react';
import { t, useI18n } from '../../../i18n.js';
import { Icon } from '../../shell/icons.jsx';
import { Row, Group, Button, TextField, Switch, Segmented, Notice } from '../controls.jsx';
import { rowProps } from '../registry.js';
import { MEETING_DEFAULTS, meetingSettings } from '../../meetings/engine.js';

const trimUrl = (v) => String(v || '').trim().replace(/\/+$/, '');

// Un campo con su propio borrador y su botón Guardar.
function FieldRow({ id, settings, setSettings, field, placeholder, secret, normalize = (v) => String(v).trim(), last, extra }) {
  useI18n();
  const saved = settings[field] || '';
  const [v, setV] = useState(saved);
  const [show, setShow] = useState(false);
  useEffect(() => { setV(saved); }, [saved]);
  const dirty = normalize(v) !== saved;
  const save = () => setSettings(prev => ({ ...prev, [field]: normalize(v) }));
  return (
    <Row {...rowProps(id)} stack last={last}>
      <form className="st-inline" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField mono type={secret && !show ? 'password' : 'text'} value={v} onChange={(e) => setV(e.target.value)}
          spellCheck={false} autoComplete="off" placeholder={placeholder} aria-label={t(`st.row.${id}`)} />
        {secret && (
          <Button variant="ghost" onClick={() => setShow(x => !x)} aria-pressed={show} aria-label={t(show ? 'recall.hideKey' : 'recall.showKey')}>
            <Icon name="eye" size={15} />
          </Button>
        )}
        <Button variant="primary" type="submit" disabled={!dirty}>{t('btn.save')}</Button>
        {extra}
      </form>
    </Row>
  );
}

// «Probar»: pide la lista de modelos al servidor (ya guardado) y comprueba que el elegido aparece.
function TestButton({ which }) {
  useI18n();
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setRes(null);
    const c = meetingSettings()[which];
    try {
      const r = await window.electronAPI.meetingTest({ baseUrl: c.url, key: c.key });
      if (!r || !r.ok) setRes({ ok: false, text: t('meet.test.fail', { err: (r && r.error) || '' }) });
      else if ((r.models || []).length && !r.models.includes(c.model)) setRes({ ok: false, text: t('meet.test.noModel', { m: c.model }) });
      else setRes({ ok: true, text: t('meet.test.ok', { n: (r.models || []).length }) });
    } catch (e) { setRes({ ok: false, text: t('meet.test.fail', { err: String((e && e.message) || e) }) }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Button onClick={run} disabled={busy}>{busy ? t('meet.test.busy') : t('meet.test.btn')}</Button>
      {res && <span className="st-hint" role="status" style={{ color: res.ok ? 'var(--accent)' : '#C2410C', flexBasis: '100%' }}>{res.text}</span>}
    </>
  );
}

export function MeetingsSection({ ctx }) {
  useI18n();
  const { settings, setSettings } = ctx;
  const set = (patch) => setSettings(prev => ({ ...prev, ...patch }));
  const haveApi = !!(window.electronAPI && window.electronAPI.meetingTest);
  const same = settings.meetingsLlmSame !== false;
  const f = { settings, setSettings };
  return (
    <>
      {!haveApi && <Notice>{t('meet.desktopOnly')}</Notice>}
      <Group title={t('st.grp.meet.stt')}>
        <FieldRow {...f} id="meetings.sttServer" field="meetingsSttUrl" normalize={trimUrl} placeholder="https://api.openai.com/v1" />
        <FieldRow {...f} id="meetings.sttKey" field="meetingsSttKey" secret placeholder="sk-…" />
        <FieldRow {...f} id="meetings.sttModel" field="meetingsSttModel" placeholder={MEETING_DEFAULTS.sttModel} last extra={haveApi ? <TestButton which="stt" /> : null} />
      </Group>
      <Group title={t('st.grp.meet.llm')}>
        <Row {...rowProps('meetings.llmSame')} last={same}>
          <Switch label={t('st.row.meetings.llmSame')} checked={same} onChange={(v) => set({ meetingsLlmSame: !!v })} />
        </Row>
        {!same && <FieldRow {...f} id="meetings.llmServer" field="meetingsLlmUrl" normalize={trimUrl} placeholder="https://api.openai.com/v1" />}
        {!same && <FieldRow {...f} id="meetings.llmKey" field="meetingsLlmKey" secret placeholder="sk-…" />}
        <FieldRow {...f} id="meetings.llmModel" field="meetingsLlmModel" placeholder={MEETING_DEFAULTS.llmModel} last extra={haveApi ? <TestButton which="llm" /> : null} />
      </Group>
      <Group title={t('st.grp.meet.opts')}>
        <Row {...rowProps('meetings.lang')}>
          <Segmented label={t('st.row.meetings.lang')} value={settings.meetingsLang === 'en' ? 'en' : 'es'}
            options={[{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }]} onChange={(v) => set({ meetingsLang: v })} />
        </Row>
        <Row {...rowProps('meetings.system')}>
          <Switch label={t('st.row.meetings.system')} checked={settings.meetingsSystemAudio !== false} onChange={(v) => set({ meetingsSystemAudio: !!v })} />
        </Row>
        <Row {...rowProps('meetings.diarize')} last={false}>
          <Switch label={t('st.row.meetings.diarize')} checked={settings.meetingsDiarize === true} onChange={(v) => set({ meetingsDiarize: !!v })} />
        </Row>
        {settings.meetingsDiarize === true && (
          <FieldRow {...f} id="meetings.speakers" field="meetingsSpeakers" placeholder="3"
            normalize={(v) => { const n = Math.round(Number(String(v).trim())); return n >= 2 && n <= 20 ? String(n) : ''; }} />
        )}
        <Row {...rowProps('meetings.keep')} last>
          <Switch label={t('st.row.meetings.keep')} checked={settings.meetingsKeepAudio === true} onChange={(v) => set({ meetingsKeepAudio: !!v })} />
        </Row>
      </Group>
    </>
  );
}
