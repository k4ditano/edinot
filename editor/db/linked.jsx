// Vista enlazada de una base de datos: un bloque ```edinot-db``` muestra, en
// otra nota, una tabla que vive en su nota de origen.
//
//   ```edinot-db
//   {"note":"<id de la nota>","t":0,"sig":"Tarea|Estado|Fecha","dir":"<!-- edinot:view=kanban:by=Estado -->"}
//   ```
//
// `t` es el índice de la tabla dentro de la nota y `sig` sus cabeceras, para
// reencontrarla si se añaden tablas por encima. `dir` (opcional) es la vista
// propia del bloque: pestaña, filtros, orden, columnas ocultas, anchos…
//
// Los datos se guardan siempre en la nota de origen; la vista, en el bloque.
// Para no tocar el bloque de base de datos, éste trabaja sobre una «fuente
// virtual»: la nota de origen con su directiva cambiada por una mezcla de la
// del bloque (vista) y la del origen (tipos y colores de columna). Al
// escribir, el resultado se reparte: filas, columnas y tipos → origen;
// vista → bloque.

import { useState, useEffect, useRef } from 'react';
import { t, useI18n } from '../../i18n.js';
import { DbIcon } from './icons.jsx';

export const LINKED_LANG = 'edinot-db';

const DIR_RE = /^[ \t]*<!--\s*edinot:view=([a-z]+)((?::[a-zA-Z]+=[^\s>:]+)*)\s*-->[ \t]*$/;
// Cláusulas que describen la forma de los datos (van con la tabla, en el
// origen); el resto describe cómo se mira (va con cada vista enlazada).
const SHAPE = new Set(['cols', 'ocol', 'colors']);

export function parseLinkedConfig(body) {
  try {
    const c = JSON.parse(String(body || '').trim());
    if (!c || typeof c !== 'object' || !c.note) return null;
    return { note: String(c.note), t: Number.isInteger(c.t) ? c.t : 0, sig: typeof c.sig === 'string' ? c.sig : '', dir: typeof c.dir === 'string' && c.dir ? c.dir : null };
  } catch { return null; }
}

export function linkedFence(cfg) {
  const o = { note: cfg.note, t: cfg.t || 0, sig: cfg.sig || '' };
  if (cfg.dir) o.dir = cfg.dir;
  return '```' + LINKED_LANG + '\n' + JSON.stringify(o) + '\n```';
}

// Sustituye el bloque ```edinot-db número `n` (en orden de aparición) de `src`.
export function replaceLinkedFence(src, n, cfg) {
  const lines = String(src || '').split('\n');
  let fence = null, count = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[ \t]*(```|~~~)(.*)$/);
    if (!m) continue;
    if (fence) { if (m[1] === fence && !m[2].trim()) fence = null; continue; }
    fence = m[1];
    if (m[1] !== '```' || m[2].trim() !== LINKED_LANG || ++count !== n) continue;
    let j = i + 1;
    while (j < lines.length && !/^[ \t]*```[ \t]*$/.test(lines[j])) j++;
    if (j >= lines.length) return null;
    lines.splice(i, j - i + 1, ...linkedFence(cfg).split('\n'));
    return lines.join('\n');
  }
  return null;
}

const sigOf = (headers) => (headers || []).map(h => String(h || '').trim()).join('|');

// Índice de la tabla a la que apunta `cfg` en `tables`, o -1.
export function resolveLinkedTable(tables, cfg) {
  if (!tables || !tables.length || !cfg) return -1;
  const at = tables[cfg.t];
  if (at && (!cfg.sig || sigOf(at.headers) === cfg.sig)) return cfg.t;
  if (cfg.sig) {
    const i = tables.findIndex(tb => sigOf(tb.headers) === cfg.sig);
    if (i >= 0) return i;
  }
  return at ? cfg.t : -1;
}

function parseDir(line) {
  const m = String(line || '').match(DIR_RE);
  if (!m) return null;
  const clauses = [];
  for (const part of (m[2] || '').split(':')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq > 0) clauses.push([part.slice(0, eq), part.slice(eq + 1)]);
  }
  return { view: m[1], clauses };
}
function buildDir(view, clauses) {
  return `<!-- edinot:view=${view || 'table'}${clauses.map(([k, v]) => `:${k}=${v}`).join('')} -->`;
}
const shapeOf = (d) => (d ? d.clauses.filter(([k]) => SHAPE.has(k)) : []);
const lookOf = (d) => (d ? d.clauses.filter(([k]) => !SHAPE.has(k)) : []);
const sameClauses = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fuente que ve el bloque: la del origen con la vista del bloque (si tiene).
export function virtualSource(src, table, embedDir) {
  const emb = parseDir(embedDir);
  if (!emb || !table) return src;
  const lines = src.split('\n');
  const own = table.dirLineIdx >= 0 ? parseDir(lines[table.dirLineIdx]) : null;
  const line = buildDir(emb.view, [...shapeOf(own), ...lookOf(emb)]);
  if (table.dirLineIdx >= 0) lines[table.dirLineIdx] = line;
  else lines.splice(table.startLine, 0, line);
  return lines.join('\n');
}

// Reparte el resultado `next` (fuente virtual tras la edición) entre la nota
// de origen y la vista del bloque. Devuelve { source, dir } o null si la
// tabla ya no está.
export function splitLinkedResult(src, idx, next, parseTables) {
  const t1 = parseTables(next)[idx];
  const t0 = parseTables(src)[idx];
  if (!t1 || !t0) return null;
  const nl = next.split('\n');
  const tableLines = nl.slice(t1.startLine, t1.endLine + 1);
  const nd = t1.dirLineIdx >= 0 ? parseDir(nl[t1.dirLineIdx]) : null;
  const dir = nd ? buildDir(nd.view, lookOf(nd)) : null;

  const lines = src.split('\n');
  const own = t0.dirLineIdx >= 0 ? parseDir(lines[t0.dirLineIdx]) : null;
  lines.splice(t0.startLine, t0.endLine - t0.startLine + 1, ...tableLines);
  const shape = shapeOf(nd);
  if (!sameClauses(shape, shapeOf(own))) {
    const line = buildDir(own ? own.view : 'table', [...lookOf(own), ...shape]);
    if (t0.dirLineIdx >= 0) lines[t0.dirLineIdx] = line;
    else if (shape.length) lines.splice(t0.startLine, 0, line);
  }
  return { source: lines.join('\n'), dir };
}

// env (de editor.jsx): read(id) → texto | null, subscribe(id, fn) → off,
// write(id, texto), noteName(id), open(id, pos), canEdit(id).
export function LinkedDatabase({ cfg, env, baseCtxRef, ops, surface, onConfig, DatabaseBlock }) {
  useI18n();
  const [, setVer] = useState(0);
  useEffect(() => env.subscribe(cfg.note, () => setVer(v => v + 1)), [env, cfg.note]);
  const cfgRef = useRef(cfg); cfgRef.current = cfg;
  const ctxRef = useRef(null);

  const src = env.read(cfg.note);
  const name = env.noteName(cfg.note);
  const tables = src == null ? [] : ops.parseSourceTables(src);
  const idx = resolveLinkedTable(tables, cfg);
  const head = (
    <div className="db-linked-head">
      <DbIcon name="link" size={13} />
      <span className="db-linked-label">{t('db.linked.from')}</span>
      <button type="button" className="db-linked-src" disabled={!name}
        onClick={() => env.open(cfg.note, idx >= 0 && tables[idx] ? tables[idx].startLine : 0)}>{name || t('db.linked.missingNote')}</button>
    </div>
  );
  if (src == null || idx < 0) {
    return (
      <div className="db-linked db-linked-empty">
        {head}
        <div className="db-linked-msg">{src == null && name ? t('db.linked.loading') : t('db.linked.missing')}</div>
      </div>
    );
  }

  // Si la tabla se ha movido (otra tabla por encima), el bloque lo apunta.
  const resolvedT = idx;
  const base = baseCtxRef.current || {};
  ctxRef.current = {
    ...base,
    noteId: cfg.note,
    readOnly: !!base.readOnly || !env.canEdit(cfg.note),
    getSource: () => {
      const s = env.read(cfgRef.current.note) || '';
      const tb = ops.parseSourceTables(s)[resolvedT];
      return virtualSource(s, tb, cfgRef.current.dir);
    },
    mutateSource: (fn) => {
      const c = cfgRef.current;
      const s = env.read(c.note);
      if (s == null) return;
      const tb = ops.parseSourceTables(s)[resolvedT];
      if (!tb) return;
      const virt = virtualSource(s, tb, c.dir);
      const next = typeof fn === 'function' ? fn(virt) : fn;
      if (typeof next !== 'string' || next === virt) return;
      const r = splitLinkedResult(s, resolvedT, next, ops.parseSourceTables);
      if (!r) return;
      if (r.source !== s) env.write(c.note, r.source);
      const sig = sigOf(ops.parseSourceTables(r.source)[resolvedT]?.headers);
      if ((r.dir || null) !== (c.dir || null) || c.t !== resolvedT || c.sig !== sig) {
        onConfig({ ...c, t: resolvedT, sig, dir: r.dir });
      }
    },
  };
  const meta = ops.parseSourceTables(ctxRef.current.getSource())[resolvedT];
  return (
    <div className="db-linked">
      {head}
      {meta && <DatabaseBlock key="db" meta={meta} idx={resolvedT} ctxRef={ctxRef} ops={ops} surface={surface} />}
    </div>
  );
}
