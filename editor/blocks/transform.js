// Transformaciones de la barra flotante (puras, sin DOM):
//   · extractTitle: nombre para «Extraer a nota nueva».
//   · linesToDbRows: lista/párrafos seleccionados → filas de base de datos.

const MARK_RE = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?/;

function plain(s) {
  return String(s || '')
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~=]/g, '')
    .trim();
}

// Título: el primer título Markdown del fragmento o su primera línea con texto.
export function extractTitle(text) {
  const lines = String(text || '').split(/\r?\n/);
  const h = lines.find((l) => /^\s{0,3}#{1,6}\s+\S/.test(l));
  let base = h ? h.replace(/^\s*#+\s+/, '').replace(/\s+#+\s*$/, '') : (lines.find((l) => l.trim()) || '');
  base = plain(base.replace(MARK_RE, '').replace(/^\s*>\s?/, ''));
  base = base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;:!¡¿…]+$/, '').trim();
  if (base.length > 60) base = base.slice(0, 60).replace(/\s+\S*$/, '').trim() || base.slice(0, 60);
  return base || 'Nota extraída';
}

// Nombre libre entre `taken` (Set de nombres en minúsculas, sin .md).
export function uniqueName(base, taken) {
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const n = `${base} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${base} ${Date.now()}`;
}

// Cada elemento de lista (o párrafo) → una fila. Los hijos anidados se
// añaden al nombre del padre tras « — ». Las tareas rellenan «Hecho».
export function linesToDbRows(text) {
  const rows = [];
  let hasTasks = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = /^\s*/.exec(raw)[0].replace(/\t/g, '    ').length;
    const m = MARK_RE.exec(raw);
    const name = plain(raw.replace(MARK_RE, '').replace(/^\s*>\s?/, '').replace(/^\s*#+\s+/, '')).replace(/\|/g, '\\|');
    if (!name) continue;
    if (m && m[1] != null) hasTasks = true;
    if (indent >= 2 && rows.length && m) {
      rows[rows.length - 1].name += ' — ' + name;
      continue;
    }
    rows.push({ name, done: m && m[1] != null ? /x/i.test(m[1]) : null });
  }
  return { hasTasks, rows };
}
