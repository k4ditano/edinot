// Formularios en línea (```edinot-form```) y su constructor. Chunk aparte:
// editor.jsx los carga con React.lazy sólo en notas con formularios.

import { useI18n, t } from '../../i18n.js';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Icon as ShIcon } from '../../ui/shell/icons.jsx';
import {
  TypedFieldInput,
  parseSourceTables,
  validateTypedValues,
} from '../../editor.jsx';


// Inline form rendered in place of a ```edinot-form``` block in render mode.
// Fields are auto-derived from a target table's columns (using their declared
// types). On submit it appends a row to that table via onSubmit(valuesArray),
// where valuesArray is ordered to match the table headers. Hidden columns,
// per-column labels and default values come from the block's JSON config.
const FORM_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function FormView({ cfg, headers, cols, tableIdx, onSubmit, onAttach, onConfigure, readOnly = false, missingTarget = false, crossNote = false, rowCount = 0 }) {
  useI18n();
  const conf = cfg || {};
  // The stamp column is auto-filled on submit, so it is never shown as a field.
  const hidden = useMemo(() => {
    const s = new Set((conf.hidden || []).map(x => String(x)));
    if (conf.stamp) s.add(String(conf.stamp));
    return s;
  }, [conf.hidden, conf.stamp]);
  const required = useMemo(() => new Set((conf.required || []).map(x => String(x))), [conf.required]);
  const emails = useMemo(() => new Set((conf.email || []).map(x => String(x))), [conf.email]);
  const labels = conf.labels || {};
  const defaults = conf.defaults || {};
  const help = conf.help || {};
  const orderIdx = useMemo(() => {
    const idxByName = new Map((headers || []).map((h, i) => [h, i]));
    const seen = new Set(); const out = [];
    for (const name of (conf.order || [])) { const i = idxByName.get(name); if (i != null && !seen.has(i)) { out.push(i); seen.add(i); } }
    for (let i = 0; i < (headers || []).length; i++) if (!seen.has(i)) out.push(i);
    return out;
  }, [(headers || []).join('|'), (conf.order || []).join('|')]);
  const visible = orderIdx.map(i => ({ h: headers[i], i })).filter(({ h }) => !hidden.has(h));
  const makeInitial = () => (headers || []).map((h) => (defaults[h] != null ? String(defaults[h]) : ''));
  const [values, setValues] = useState(makeInitial);
  const [errors, setErrors] = useState({});
  const [sent, setSent] = useState(false);
  // Re-seed when the table schema changes (columns added/removed/renamed).
  useEffect(() => { setValues(makeInitial()); setErrors({}); }, [(headers || []).join('')]);

  const closedReason = (() => {
    if (conf.closesAt) { const ts = Date.parse(conf.closesAt); if (Number.isFinite(ts) && Date.now() > ts) return 'date'; }
    if (Number.isFinite(Number(conf.maxResponses)) && rowCount >= Number(conf.maxResponses)) return 'max';
    return null;
  })();
  const disabled = readOnly || !!closedReason;

  const updateAt = (i, v) => setValues(prev => { const next = [...prev]; next[i] = v; return next; });
  const trySubmit = () => {
    if (disabled) return;
    const errs = validateTypedValues(headers, cols, values);
    visible.forEach(({ h, i }) => {
      const v = String(values[i] || '').trim();
      if (required.has(h) && !v) errs[i] = t('form.required');
      else if (v && emails.has(h) && !FORM_EMAIL_RE.test(v)) errs[i] = t('form.invalidEmail');
    });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const out = (headers || []).map((_, i) => (values[i] == null ? '' : values[i]));
    if (conf.stamp) {
      const si = (headers || []).indexOf(conf.stamp);
      if (si >= 0) out[si] = new Date().toISOString().slice(0, 16).replace('T', ' ');
    }
    onSubmit(out);
    setValues(makeInitial());
    setErrors({});
    setSent(true);
  };

  if (!headers || !headers.length) {
    return (
      <div className="md-form md-form-empty">
        <span>{missingTarget ? t('form.noteMissing') : t('form.tableMissing')}</span>
        {onConfigure && !readOnly ? (
          <button type="button" className="md-form-gear" title={t('form.configure')}
            onClick={(e) => { e.stopPropagation(); onConfigure(); }}><ShIcon name="settings" size={14} /></button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="md-form" onClickCapture={() => { if (sent) setSent(false); }}>
      <div className="md-form-head">
        <div className="md-form-title">
          {conf.title || t('form.title')}
          {crossNote ? <span className="md-form-crossnote" title={t('form.crossNote.tip')}>↗ {t('form.crossNote')}</span> : null}
          {onConfigure && !readOnly ? (
            <button type="button" className="md-form-gear" title={t('form.configure')}
              onClick={(e) => { e.stopPropagation(); onConfigure(); }}><ShIcon name="settings" size={14} /></button>
          ) : null}
        </div>
        {conf.description ? <div className="md-form-desc">{conf.description}</div> : null}
      </div>
      {closedReason ? (
        <div className="md-form-body"><div className="md-form-closed">{t('form.closed')}</div></div>
      ) : (
        <div className="md-form-body">
          {visible.map(({ h, i }) => (
            <TypedFieldInput key={i} index={i} conf={emails.has(h) ? { type: 'text' } : cols[h]}
              value={values[i]} label={labels[h] || h || `Col ${i + 1}`} error={errors[i]}
              help={help[h]} required={required.has(h)} disabled={disabled}
              idPrefix={`mdform-${tableIdx}`} simpleComplex onAttach={onAttach}
              onChange={(v) => updateAt(i, v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
                  e.preventDefault(); trySubmit();
                }
              }} />
          ))}
        </div>
      )}
      {!closedReason && (
        <div className="md-form-foot">
          {sent ? (
            <span className="md-form-sent">✓ {conf.success || t('form.sent')}
              {(conf.redirect && /^https?:\/\//i.test(conf.redirect))
                ? <> · <a href={conf.redirect} target="_blank" rel="noreferrer noopener">{t('form.openLink')}</a></>
                : null}
            </span>
          ) : <span />}
          <button type="button" className="md-form-submit" onClick={trySubmit} disabled={disabled}
            title={readOnly ? t('form.readonly') : undefined}>
            {conf.submit || t('form.submit')}
          </button>
        </div>
      )}
    </div>
  );
}

// Visual form builder — create or edit a ```edinot-form``` without touching
// JSON. Configures destination (this/other note + table), general copy, per-
// field options (visible / label / help / required / email / order), an auto
// timestamp column and close limits. Builds a clean config object and hands it
// to onSave(cfg, mode, blockIdx, anchorTableIdx).
function FormBuilderModal({ state, activeId, activeContent, files, onClose, onSave }) {
  useI18n();
  const mode = state ? (state.mode || 'create') : 'create';
  const editing = mode === 'edit';
  const [scope, setScope] = useState('this');
  const [otherNoteId, setOtherNoteId] = useState('');
  const [tableIdx, setTableIdx] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submit, setSubmit] = useState('');
  const [success, setSuccess] = useState('');
  const [redirect, setRedirect] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [maxResponses, setMaxResponses] = useState('');
  const [stamp, setStamp] = useState('');
  const [order, setOrder] = useState([]);
  const [hidden, setHidden] = useState(new Set());
  const [required, setRequired] = useState(new Set());
  const [email, setEmail] = useState(new Set());
  const [labels, setLabels] = useState({});
  const [help, setHelp] = useState({});

  const otherNotes = useMemo(() => (files || [])
    .filter(f => f.id !== activeId)
    .map(f => ({ id: f.id, name: (f.name || '').replace(/\.(md|markdown|txt)$/i, ''), tables: parseSourceTables(f.content || '') }))
    .filter(n => n.tables.length)
    .sort((a, b) => a.name.localeCompare(b.name)), [files, activeId]);
  const thisTables = useMemo(() => parseSourceTables(activeContent || ''), [activeContent]);
  const targetTables = scope === 'other'
    ? ((otherNotes.find(n => n.id === otherNoteId) || {}).tables || [])
    : thisTables;
  const targetTable = targetTables[tableIdx] || null;
  const columns = targetTable ? targetTable.headers : [];
  const colType = (h) => (targetTable && targetTable.directive && targetTable.directive.cols && targetTable.directive.cols[h] && targetTable.directive.cols[h].type) || 'text';
  const columnsKey = columns.join('');

  // Seed everything when the modal opens.
  useEffect(() => {
    if (!state) { destInitRef.current = true; return; }
    const cfg = state.cfg || {};
    setTitle(cfg.title || ''); setDescription(cfg.description || '');
    setSubmit(cfg.submit || ''); setSuccess(cfg.success || ''); setRedirect(cfg.redirect || '');
    setClosesAt(cfg.closesAt || ''); setMaxResponses(cfg.maxResponses != null ? String(cfg.maxResponses) : '');
    setStamp(cfg.stamp || '');
    const sc = cfg.note ? 'other' : 'this';
    const oid = cfg.note ? String(cfg.note) : (otherNotes[0] ? otherNotes[0].id : '');
    const tIdx = Number.isFinite(cfg.table) ? cfg.table : (Number.isFinite(state.anchorTableIdx) ? state.anchorTableIdx : 0);
    setScope(sc); setOtherNoteId(oid); setTableIdx(tIdx);
    // Resolve the target columns synchronously here (the state vars above only
    // apply next render) so the initial field seed is correct on open.
    const content = sc === 'other' ? (((files || []).find(f => f.id === oid) || {}).content || '') : (activeContent || '');
    const tbl = parseSourceTables(content)[tIdx] || null;
    const cols = tbl ? tbl.headers : [];
    destInitRef.current = true; // re-arm the destination-change reset for this open
    if (editing) {
      setOrder(Array.isArray(cfg.order) && cfg.order.length
        ? [...cfg.order.filter(c => cols.includes(c)), ...cols.filter(c => !cfg.order.includes(c))]
        : cols.slice());
      setHidden(new Set((cfg.hidden || []).filter(c => cols.includes(c))));
      setRequired(new Set((cfg.required || []).filter(c => cols.includes(c))));
      setEmail(new Set((cfg.email || []).filter(c => cols.includes(c))));
      setLabels({ ...(cfg.labels || {}) });
      setHelp({ ...(cfg.help || {}) });
    } else {
      setOrder(cols.slice());
      setHidden(new Set()); setRequired(new Set()); setEmail(new Set()); setLabels({}); setHelp({});
    }
  }, [state]);

  // When the user changes the destination (create mode only — it's locked when
  // editing), reset per-field config to defaults for the new columns. Skips the
  // first run after open, which the seed effect above already handled.
  const destInitRef = useRef(true);
  useEffect(() => {
    if (!state || editing) return;
    if (destInitRef.current) { destInitRef.current = false; return; }
    setOrder(columns.slice());
    setHidden(new Set()); setRequired(new Set()); setEmail(new Set()); setLabels({}); setHelp({}); setStamp('');
  }, [scope, otherNoteId, tableIdx, columnsKey]);

  if (!state) return null;
  const tableLabel = (tb, i) => `#${i + 1} · ${((tb.headers || []).join(', ') || '—').slice(0, 40)}`;
  const toggle = (setFn) => (key) => setFn(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleHidden = toggle(setHidden), toggleRequired = toggle(setRequired), toggleEmail = toggle(setEmail);
  const move = (i, d) => setOrder(prev => { const n = prev.slice(); const j = i + d; if (j < 0 || j >= n.length) return prev; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const canSave = columns.length > 0;

  const doSave = () => {
    if (!canSave) return;
    const cfg = {};
    if (scope === 'other' && otherNoteId) cfg.note = otherNoteId;
    cfg.table = tableIdx;
    if (title.trim()) cfg.title = title.trim();
    if (description.trim()) cfg.description = description.trim();
    if (submit.trim()) cfg.submit = submit.trim();
    if (success.trim()) cfg.success = success.trim();
    const rd = redirect.trim();
    if (rd && /^https?:\/\//i.test(rd)) cfg.redirect = rd;
    const hid = order.filter(c => hidden.has(c)); if (hid.length) cfg.hidden = hid;
    const req = order.filter(c => required.has(c)); if (req.length) cfg.required = req;
    const eml = order.filter(c => email.has(c)); if (eml.length) cfg.email = eml;
    const lbl = {}; for (const c of columns) if (labels[c] && labels[c] !== c) lbl[c] = labels[c]; if (Object.keys(lbl).length) cfg.labels = lbl;
    const hlp = {}; for (const c of columns) if (help[c]) hlp[c] = help[c]; if (Object.keys(hlp).length) cfg.help = hlp;
    if (order.length === columns.length && order.some((c, i) => c !== columns[i])) cfg.order = order;
    if (stamp && columns.includes(stamp)) cfg.stamp = stamp;
    if (closesAt) cfg.closesAt = closesAt;
    const mx = parseInt(maxResponses, 10); if (Number.isFinite(mx) && mx > 0) cfg.maxResponses = mx;
    onSave(cfg, mode, state.blockIdx, state.anchorTableIdx);
  };

  return (
    <>
      <div className="dropdown-backdrop" style={{ background: 'rgba(0,0,0,0.32)', zIndex: 95 }} onClick={onClose} />
      <div className="table-row-editor form-builder">
        <div className="tre-title">{editing ? t('form.builder.editTitle') : t('form.builder.newTitle')}</div>
        <div className="tre-body">
          {/* Destino */}
          <div className="fb-section">{t('form.builder.destination')}</div>
          <div className="tre-field">
            <label>{t('form.target.where')}</label>
            <select value={scope} disabled={editing} onChange={(e) => setScope(e.target.value)}>
              <option value="this">{t('form.target.thisNote')}</option>
              <option value="other" disabled={!otherNotes.length}>{t('form.target.otherNote')}</option>
            </select>
          </div>
          {scope === 'other' && (
            <div className="tre-field">
              <label>{t('form.target.note')}</label>
              <select value={otherNoteId} disabled={editing} onChange={(e) => { setOtherNoteId(e.target.value); setTableIdx(0); }}>
                {otherNotes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
          )}
          <div className="tre-field">
            <label>{t('form.target.table')}</label>
            {targetTables.length
              ? <select value={tableIdx} disabled={editing} onChange={(e) => setTableIdx(Number(e.target.value))}>
                  {targetTables.map((tb, i) => <option key={i} value={i}>{tableLabel(tb, i)}</option>)}
                </select>
              : <div className="tre-err-msg">{t('form.target.noTables')}</div>}
          </div>
          {scope === 'other' && <div className="md-form-desc" style={{ padding: '0 2px' }}>{t('form.target.privacyHint')}</div>}

          {/* General */}
          <div className="fb-section">{t('form.builder.general')}</div>
          <div className="tre-field"><label>{t('form.builder.titleField')}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('form.title')} /></div>
          <div className="tre-field"><label>{t('form.builder.descField')}</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="tre-field"><label>{t('form.builder.submitField')}</label>
            <input type="text" value={submit} onChange={(e) => setSubmit(e.target.value)} placeholder={t('form.submit')} /></div>
          <div className="tre-field"><label>{t('form.builder.successField')}</label>
            <input type="text" value={success} onChange={(e) => setSuccess(e.target.value)} placeholder={t('form.sent')} /></div>
          <div className="tre-field"><label>{t('form.builder.redirectField')}</label>
            <input type="text" value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder="https://…" /></div>

          {/* Campos */}
          <div className="fb-section">{t('form.builder.fields')}</div>
          {columns.length ? order.map((h, i) => (
            <div key={h} className={`fb-field${hidden.has(h) ? ' fb-field-off' : ''}`}>
              <div className="fb-field-head">
                <div className="fb-reorder">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="↑">↑</button>
                  <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} title="↓">↓</button>
                </div>
                <span className="fb-field-name">{h} <span className="fb-field-type">{colType(h)}</span></span>
                <label className="fb-chk"><input type="checkbox" checked={!hidden.has(h)} onChange={() => toggleHidden(h)} /> {t('form.builder.visible')}</label>
              </div>
              {!hidden.has(h) && (
                <div className="fb-field-body">
                  <input type="text" className="fb-inp" value={labels[h] || ''} placeholder={t('form.builder.labelPh', { col: h })}
                    onChange={(e) => setLabels(p => ({ ...p, [h]: e.target.value }))} />
                  <input type="text" className="fb-inp" value={help[h] || ''} placeholder={t('form.builder.helpPh')}
                    onChange={(e) => setHelp(p => ({ ...p, [h]: e.target.value }))} />
                  <label className="fb-chk"><input type="checkbox" checked={required.has(h)} onChange={() => toggleRequired(h)} /> {t('form.builder.required')}</label>
                  <label className="fb-chk"><input type="checkbox" checked={email.has(h)} onChange={() => toggleEmail(h)} /> {t('form.builder.email')}</label>
                </div>
              )}
            </div>
          )) : <div className="tre-err-msg">{t('form.target.noTables')}</div>}

          {/* Avanzado */}
          <div className="fb-section">{t('form.builder.advanced')}</div>
          <div className="tre-field"><label>{t('form.builder.stamp')}</label>
            <select value={stamp} onChange={(e) => setStamp(e.target.value)}>
              <option value="">{t('form.builder.stampNone')}</option>
              {columns.map(h => <option key={h} value={h}>{h}</option>)}
            </select></div>
          <div className="tre-field"><label>{t('form.builder.closesAt')}</label>
            <input type="date" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></div>
          <div className="tre-field"><label>{t('form.builder.maxResponses')}</label>
            <input type="number" min="0" value={maxResponses} onChange={(e) => setMaxResponses(e.target.value)} placeholder="∞" /></div>
        </div>
        <div className="tre-buttons">
          <button className="tre-btn" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="tre-btn tre-btn-primary" onClick={doSave} disabled={!canSave}>
            {editing ? t('btn.save') : t('form.target.insert')}
          </button>
        </div>
      </div>
    </>
  );
}

export { FormView, FormBuilderModal };
