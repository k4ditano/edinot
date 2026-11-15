// Server-side support for Notion-style forms on the public share page.
//
// A note's markdown can carry a ```edinot-form``` block whose fields are
// auto-derived from a target table's columns. On the share page (when the
// link opts in via allow_submit) the block becomes a real HTML form that
// POSTs back to /share/:token/form, appending a row to that table in the
// note's Y.Doc.
//
// This mirrors the table/cols/form parsing that lives in editor.jsx (client)
// so the server can render the form and validate + apply submissions with the
// same rules. Kept dependency-free (string ops only) and unit-tested.

const FORM_FENCE_RE = /^[ \t]*```edinot-form[ \t]*$/;
const VIEW_DIRECTIVE_RE = /^[ \t]*<!--\s*edinot:view=([a-z]+)((?::[a-zA-Z]+=[^\s>:]+)*)\s*-->[ \t]*$/;
const COLUMN_TYPES = ['text', 'select', 'number', 'date', 'checkbox', 'tags', 'multiselect', 'status', 'rating', 'progress', 'person', 'wikilink', 'archivo'];

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Strip a cell value of anything that could break the markdown table or inject
// HTML into the (html:true) share renderer. Forms collect plain data, so we
// drop angle brackets, pipes and newlines defensively.
export function sanitizeCell(v) {
  return String(v == null ? '' : v)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\|/g, '/')
    .slice(0, 2000)
    .trim();
}

function splitTableLine(line) {
  return String(line).split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim().replace(/\\\|/g, '|'));
}

// Parse the `cols=...` clause of a view directive into { ColName: {type, options?} }.
function parseColsFromDirective(line) {
  const m = String(line).match(VIEW_DIRECTIVE_RE);
  if (!m) return {};
  // m[2] is the clause string ":key=val:key=val". Find the cols clause.
  const clauses = m[2] || '';
  const colsMatch = clauses.match(/:cols=([^\s>:]+)/);
  if (!colsMatch) return {};
  const out = {};
  for (const raw of colsMatch[1].split(';')) {
    try {
      const dec = decodeURIComponent(raw);
      const eq = dec.indexOf('=');
      if (eq <= 0) continue;
      const k = dec.slice(0, eq).trim();
      const v = dec.slice(eq + 1).trim();
      if (!k || !v) continue;
      const colon = v.indexOf(':');
      let type, options = null;
      if (colon > 0) { type = v.slice(0, colon); options = v.slice(colon + 1).split('|').map(x => x.trim()).filter(Boolean); }
      else { type = v; }
      if (!COLUMN_TYPES.includes(type)) continue;
      out[k] = options && options.length ? { type, options } : { type };
    } catch { /* skip malformed clause */ }
  }
  return out;
}

// All markdown tables in `src`, each with its column-type map (from the view
// directive on the closest non-blank line above) and line bounds. Skips
// fenced code blocks so a table inside ``` isn't treated as data.
export function parseTablesForForms(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^[ \t]*(```|~~~)/.test(line)) { inFence = !inFence; i++; continue; }
    if (inFence) { i++; continue; }
    const sep = lines[i + 1] || '';
    if (/^\s*\|.+\|\s*$/.test(line) && /^\s*\|[\s:|\-]+\|\s*$/.test(sep)) {
      const startLine = i;
      const headers = splitTableLine(line);
      const firstDataLine = i + 2;
      let j = firstDataLine;
      const rows = [];
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { rows.push(splitTableLine(lines[j])); j++; }
      const lastDataLine = j - 1;
      // Closest non-blank line above → view directive (for column types).
      let k = startLine - 1;
      while (k >= 0 && lines[k].trim() === '') k--;
      const cols = k >= 0 ? parseColsFromDirective(lines[k]) : {};
      out.push({ headers, cols, rows, startLine, firstDataLine, lastDataLine });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

export function parseFormBlocks(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (FORM_FENCE_RE.test(lines[i])) {
      const startLine = i;
      let endLine = -1;
      const buf = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[ \t]*```\s*$/.test(lines[j])) { endLine = j; break; }
        buf.push(lines[j]);
      }
      if (endLine < 0) { i++; continue; }
      let json = {};
      const text = buf.join('\n').trim();
      if (text) { try { const p = JSON.parse(text); if (p && typeof p === 'object') json = p; } catch { /* tolerant */ } }
      out.push({ json, startLine, endLine });
      i = endLine + 1;
    } else {
      i++;
    }
  }
  return out;
}

// Pick the table a form writes into: explicit 0-based index, else nearest
// table below the block, else the first table. Returns { table, tableIdx }
// or null when there are no tables.
export function resolveFormTable(tables, formBlock, cfg) {
  if (!tables.length) return null;
  if (cfg && Number.isFinite(cfg.table) && tables[cfg.table]) return { table: tables[cfg.table], tableIdx: cfg.table };
  if (formBlock) {
    for (let k = 0; k < tables.length; k++) {
      if (tables[k].startLine > formBlock.endLine) return { table: tables[k], tableIdx: k };
    }
  }
  return { table: tables[0], tableIdx: 0 };
}

// ── Form-block authoring (used by the MCP server so an AI can create /
// edit / delete forms the same way the visual builder does in editor.jsx).
// All three are pure string ops; the caller persists the returned source.

// Insert a ```edinot-form``` block anchored just above the table at
// `anchorTableIdx` (above its view directive if it has one, matching the
// editor). When there is no such table the block is appended at the end —
// the normal case for a cross-note form whose target table lives elsewhere.
export function insertFormBlock(src, anchorTableIdx, cfg) {
  const lines = String(src || '').split('\n');
  const tables = parseTablesForForms(src);
  const t = tables[anchorTableIdx];
  let anchor = lines.length;
  if (t) {
    anchor = t.startLine;
    let k = t.startLine - 1;
    while (k >= 0 && lines[k].trim() === '') k--;
    if (k >= 0 && VIEW_DIRECTIVE_RE.test(lines[k])) anchor = k;
  }
  const json = cfg || { table: anchorTableIdx };
  lines.splice(anchor, 0, '```edinot-form', JSON.stringify(json), '```', '');
  return lines.join('\n');
}

// Replace the JSON config of the Nth ```edinot-form``` block in place.
export function writeFormBlockConfig(src, blockIdx, cfg) {
  const blocks = parseFormBlocks(src);
  const b = blocks[blockIdx];
  if (!b) return src;
  const lines = String(src || '').split('\n');
  lines.splice(b.startLine + 1, b.endLine - b.startLine - 1, JSON.stringify(cfg));
  return lines.join('\n');
}

// Remove the Nth ```edinot-form``` block (and one trailing blank line it
// leaves behind, to avoid accumulating gaps).
export function removeFormBlock(src, blockIdx) {
  const blocks = parseFormBlocks(src);
  const b = blocks[blockIdx];
  if (!b) return src;
  const lines = String(src || '').split('\n');
  let end = b.endLine;
  if (lines[end + 1] !== undefined && lines[end + 1].trim() === '') end++;
  lines.splice(b.startLine, end - b.startLine + 1);
  return lines.join('\n');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(v) { return EMAIL_RE.test(String(v || '').trim()); }

// Validate a values array (indexed by table column) against column types, a set
// of required column names and a set of columns that must hold a valid email.
// Returns { ok, errors: {colIdx: msg} }.
export function validateValues(table, values, requiredNames = [], emailNames = []) {
  const errors = {};
  const required = new Set(requiredNames.map(String));
  const emails = new Set(emailNames.map(String));
  table.headers.forEach((h, i) => {
    const v = sanitizeCell(values[i]);
    if (required.has(h) && !v) { errors[i] = 'required'; return; }
    if (!v) return;
    if (emails.has(h) && !isValidEmail(v)) { errors[i] = 'email'; return; }
    const conf = table.cols[h];
    if (!conf) return;
    if (conf.type === 'number') {
      if (!Number.isFinite(Number(v.replace(',', '.')))) errors[i] = 'number';
    } else if (conf.type === 'date') {
      if (isNaN(Date.parse(v))) errors[i] = 'date';
    } else if (conf.type === 'select' && conf.options && conf.options.length) {
      if (!conf.options.some(o => o.toLowerCase() === v.toLowerCase())) errors[i] = 'option';
    }
  });
  return { ok: Object.keys(errors).length === 0, errors };
}

// Whether a form is closed to new submissions: past its closesAt date, or the
// target table already has >= maxResponses data rows. Returns a reason string
// ('date' | 'max') or null when open.
export function formClosedReason(cfg, table, nowMs) {
  const conf = cfg || {};
  if (conf.closesAt) {
    const ts = Date.parse(conf.closesAt);
    if (Number.isFinite(ts) && nowMs > ts) return 'date';
  }
  if (Number.isFinite(Number(conf.maxResponses)) && table && (table.rows || []).length >= Number(conf.maxResponses)) {
    return 'max';
  }
  return null;
}

// Apply a stamp column (cfg.stamp = column name) by overwriting that column's
// value with the submission timestamp. Returns a new values array.
export function applyStamp(cfg, table, values, isoStamp) {
  const conf = cfg || {};
  if (!conf.stamp) return values;
  const idx = table.headers.findIndex(h => h === conf.stamp);
  if (idx < 0) return values;
  const next = values.slice();
  next[idx] = isoStamp;
  return next;
}

function buildRowLine(headers, values) {
  const cells = headers.map((_, i) => ' ' + sanitizeCell(values[i]) + ' ');
  return '|' + cells.join('|') + '|';
}

// Append a row (values indexed by column) to the table at `tableIdx`. Returns
// the new source string, or the original when the table is missing.
export function appendRowToSource(src, tableIdx, values) {
  const tables = parseTablesForForms(src);
  const t = tables[tableIdx];
  if (!t) return src;
  const lines = String(src || '').split('\n');
  lines.splice(t.lastDataLine + 1, 0, buildRowLine(t.headers, values));
  return lines.join('\n');
}

// Minimal CRDT-friendly text patch — same prefix/suffix trim the editor uses
// (editor.jsx applyTextDiff) so a submission produces a tiny incremental
// update instead of replacing the whole document.
export function applyTextDiff(ytext, newValue) {
  const old = ytext.toString();
  if (old === newValue) return;
  const min = Math.min(old.length, newValue.length);
  let prefix = 0;
  while (prefix < min && old[prefix] === newValue[prefix]) prefix++;
  let suffix = 0;
  while (suffix < min - prefix && old[old.length - 1 - suffix] === newValue[newValue.length - 1 - suffix]) suffix++;
  const deleteLen = old.length - prefix - suffix;
  const insertStr = newValue.slice(prefix, newValue.length - suffix);
  const run = () => {
    if (deleteLen > 0) ytext.delete(prefix, deleteLen);
    if (insertStr.length > 0) ytext.insert(prefix, insertStr);
  };
  if (ytext.doc) ytext.doc.transact(run); else run();
}

// Build the HTML for one form on the share page. Fields derive from the target
// table's visible columns; the client script (in the page) wires submission.
// `targetNoteId` is set for cross-note forms (responses land in another note)
// and is carried as data-note so the POST writes to the right note.
export function buildFormHtml(cfg, table, tableIdx, targetNoteId) {
  const conf = cfg || {};
  const hidden = new Set((conf.hidden || []).map(String));
  // The stamp column is auto-filled on submit, never shown.
  if (conf.stamp) hidden.add(String(conf.stamp));
  const required = new Set((conf.required || []).map(String));
  const emails = new Set((conf.email || []).map(String));
  const labels = conf.labels || {};
  const defaults = conf.defaults || {};
  const help = conf.help || {};
  const title = escapeHtml(conf.title || 'Formulario');
  const desc = conf.description ? `<div class="sform-desc">${escapeHtml(conf.description)}</div>` : '';
  const submit = escapeHtml(conf.submit || 'Enviar');
  // Field order: columns named in cfg.order first, then the rest in table order.
  const orderIdx = orderedColumnIndexes(table.headers, conf.order);
  const fields = orderIdx.map((i) => {
    const h = table.headers[i];
    if (hidden.has(h)) return '';
    const conf2 = table.cols[h] || {};
    const type = emails.has(h) ? 'email' : (conf2.type || 'text');
    const label = escapeHtml(labels[h] || h || ('Col ' + (i + 1)));
    const req = required.has(h);
    const def = defaults[h] != null ? String(defaults[h]) : '';
    const reqMark = req ? ' <span class="sform-req">*</span>' : '';
    const reqAttr = req ? ' data-required="1"' : '';
    const emailAttr = emails.has(h) ? ' data-email="1"' : '';
    const helpHtml = help[h] ? `<div class="sform-help">${escapeHtml(help[h])}</div>` : '';
    let control;
    if ((type === 'select' || type === 'status') && conf2.options && conf2.options.length) {
      const opts = ['<option value="">—</option>']
        .concat(conf2.options.map(o => `<option value="${escapeHtml(o)}"${o === def ? ' selected' : ''}>${escapeHtml(o)}</option>`))
        .join('');
      control = `<select data-col="${i}"${reqAttr}>${opts}</select>`;
    } else if (type === 'date') {
      control = `<input type="date" data-col="${i}"${reqAttr} value="${escapeHtml(def)}">`;
    } else if (type === 'number') {
      control = `<input type="number" step="any" data-col="${i}"${reqAttr} value="${escapeHtml(def)}">`;
    } else if (type === 'email') {
      control = `<input type="email" data-col="${i}"${reqAttr}${emailAttr} value="${escapeHtml(def)}">`;
    } else if (type === 'checkbox') {
      control = `<label class="sform-check"><input type="checkbox" data-col="${i}" data-checkbox="1"${def ? ' checked' : ''}> <span></span></label>`;
    } else if (type === 'archivo') {
      control = `<input type="file" data-col="${i}" data-file="1"${reqAttr}>`;
    } else {
      const ph = (type === 'tags' || type === 'multiselect') ? ' placeholder="a, b, c"' : '';
      control = `<input type="text" data-col="${i}"${reqAttr}${ph} value="${escapeHtml(def)}">`;
    }
    return `<div class="sform-field"><label>${label}${reqMark}</label>${helpHtml}${control}</div>`;
  }).join('');
  const noteAttr = targetNoteId ? ` data-note="${escapeHtml(targetNoteId)}"` : '';
  const redirect = (conf.redirect && /^https?:\/\//i.test(conf.redirect)) ? conf.redirect : '';
  const redirectAttr = redirect ? ` data-redirect="${escapeHtml(redirect)}"` : '';
  // Honeypot: a field hidden from humans; bots fill it and we drop the submit.
  const honeypot = `<div class="sform-hp" aria-hidden="true"><label>No rellenar</label><input type="text" data-hp="1" tabindex="-1" autocomplete="off"></div>`;
  return `<form class="sform" data-table-idx="${tableIdx}"${noteAttr} data-cols="${table.headers.length}"${redirectAttr}>`
    + `<div class="sform-head"><div class="sform-title">${title}</div>${desc}</div>`
    + `<div class="sform-body">${fields}${honeypot}</div>`
    + `<div class="sform-foot"><span class="sform-msg" aria-live="polite"></span>`
    + `<button type="submit" class="sform-submit">${submit}</button></div>`
    + `</form>`;
}

// Column indexes ordered by cfg.order (column names) first, then any remaining
// columns in their natural order. Unknown names in `order` are ignored.
export function orderedColumnIndexes(headers, order) {
  const idxByName = new Map(headers.map((h, i) => [h, i]));
  const seen = new Set();
  const out = [];
  for (const name of (order || [])) {
    const i = idxByName.get(name);
    if (i != null && !seen.has(i)) { out.push(i); seen.add(i); }
  }
  for (let i = 0; i < headers.length; i++) if (!seen.has(i)) out.push(i);
  return out;
}
