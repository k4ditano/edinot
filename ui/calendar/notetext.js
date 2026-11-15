// Mutaciones puras sobre el texto de las notas para el calendario (sin
// dependencias: las prueba un script de node). Quien llama escribe el
// resultado en el Y.Text vivo de la nota con applyTextDiff.

const hasTime = (s) => /[ T]\d{1,2}:\d{2}/.test(String(s || ''));

// ── Texto de las notas ──────────────────────────────────────────────────
export const INLINE_TOKEN_RE_G = /(📅|⏰|@due\()\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\)?/g;
const TASK_ANY_RE = /^(\s*[-*]\s+\[)( |x|X)\]/;

// Línea de una nota a la que apunta un evento inline (anchor.line +
// snippet; si la línea se movió, se busca por snippet).
export function findAnchorLine(lines, anchor) {
  if (!anchor) return -1;
  const snip = anchor.snippet;
  let i = Number.isFinite(anchor.line) ? anchor.line : -1;
  if (i >= 0 && lines[i] != null && (!snip || lines[i].trim().slice(0, 160) === snip)) return i;
  if (!snip) return -1;
  return lines.findIndex(l => l.trim().slice(0, 160) === snip);
}

const tokenText = (token, start) => {
  const d = start.slice(0, 10);
  const t = hasTime(start) ? start.slice(11, 16) : '';
  if (token === '@due(') return `@due(${d}${t ? ' ' + t : ''})`;
  return `${token} ${d}${t ? ' ' + t : ''}`;
};

// Cambia en la nota el token de fecha de un evento inline a `newStart`
// ('YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm'). Devuelve el texto nuevo o null.
export function rewriteInlineToken(src, ev, newStart) {
  const lines = String(src).split('\n');
  const i = findAnchorLine(lines, ev.anchor);
  if (i < 0) return null;
  const line = lines[i];
  const want = String(ev.start || '');
  let hit = null;
  for (const m of line.matchAll(INLINE_TOKEN_RE_G)) {
    const s = m[3] ? `${m[2]}T${m[3].padStart(5, '0')}` : m[2];
    if (s === want) { hit = m; break; }
    if (!hit) hit = m;
  }
  if (!hit) return null;
  const next = line.slice(0, hit.index) + tokenText(hit[1], newStart) + line.slice(hit.index + hit[0].length);
  if (next === line) return null;
  lines[i] = next;
  return lines.join('\n');
}

// Marca / desmarca la tarea de la línea del anchor.
export function toggleTaskAt(src, anchor, done) {
  const lines = String(src).split('\n');
  const i = findAnchorLine(lines, anchor);
  if (i < 0 || !TASK_ANY_RE.test(lines[i])) return null;
  const cur = /\[[xX]\]/.test(lines[i].match(TASK_ANY_RE)[0]);
  const want = done == null ? !cur : !!done;
  if (want === cur) return null;
  lines[i] = lines[i].replace(TASK_ANY_RE, `$1${want ? 'x' : ' '}]`);
  return lines.join('\n');
}

// Añade «📅 fecha [hora]» al final de la línea de una tarea sin fecha.
export function appendDateToken(src, anchor, start) {
  const lines = String(src).split('\n');
  const i = findAnchorLine(lines, anchor);
  if (i < 0) return null;
  if (/(📅|⏰|@due\()\s*\d{4}-\d{2}-\d{2}/.test(lines[i])) return null;
  lines[i] = lines[i].replace(/\s+$/, '') + ' ' + tokenText('📅', start);
  return lines.join('\n');
}

// Tareas abiertas sin token de fecha (bandeja «Sin fecha»). Cacheado por
// el texto de cada nota.
const undatedCache = new Map(); // fileId → { text, rows }
export function undatedTasksIn(fileId, text) {
  const hit = undatedCache.get(fileId);
  if (hit && hit.text === text) return hit.rows;
  const rows = [];
  if (text) {
    const lines = String(text).split(/\r?\n/);
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (/^\s*```/.test(raw)) { fence = !fence; continue; }
      if (fence) continue;
      const m = raw.match(/^\s*[-*]\s+\[ \]\s+(.*\S)/);
      if (!m) continue;
      if (/(📅|⏰|@due\()\s*\d{4}-\d{2}-\d{2}/.test(raw)) continue;
      rows.push({ id: `${fileId}:${i}:${m[1].slice(0, 40)}`, noteId: fileId, title: m[1].trim(), anchor: { line: i, snippet: raw.trim().slice(0, 160) } });
    }
  }
  undatedCache.set(fileId, { text, rows });
  return rows;
}

// Texto plano de una nota para la tarjeta «Nota del día».
export function notePreview(text, maxLines = 3) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim())
    .filter(l => l && !/^#{1,6}\s/.test(l) && !/^```/.test(l) && !/^>/.test(l) && !/^---$/.test(l));
  return lines.slice(0, maxLines)
    .map(l => l.replace(/^[-*]\s+\[( |x|X)\]\s+/, '').replace(/^[-*]\s+/, '').replace(/[*_`~]/g, '').replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1'))
    .join(' ');
}
