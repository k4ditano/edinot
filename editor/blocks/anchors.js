// Anclas en wikilinks (compatibles con Obsidian):
//   [[Nota#Título]]   → salta al título de esa nota
//   [[#Título]]       → título de la nota actual
//   [[Nota#^id]]      → bloque marcado con ` ^id` al final de su línea
// Todo puro (sin DOM): lo usan el render (markdown-it), Editar y la navegación.

export function splitWikiTarget(name) {
  const s = String(name || '');
  const i = s.indexOf('#');
  if (i < 0) return { note: s.trim(), anchor: '' };
  return { note: s.slice(0, i).trim(), anchor: s.slice(i + 1).trim() };
}

// Normaliza el texto de un título para compararlo (sin marcas, acentos ni mayúsculas).
export function normHeading(text) {
  return String(text || '')
    .replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '')
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~=]/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export const BLOCK_ID_RE = /\s\^([A-Za-z0-9_-]+)\s*$/;

// Línea (0-based) a la que apunta `anchor` dentro de `src`, o -1.
export function findAnchorLine(src, anchor) {
  if (!anchor) return -1;
  const lines = String(src || '').split(/\r?\n/);
  let fence = false;
  if (anchor.startsWith('^')) {
    const id = anchor.slice(1);
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
      if (fence) continue;
      const m = BLOCK_ID_RE.exec(lines[i]);
      if (m && m[1] === id) return i;
    }
    return -1;
  }
  // Obsidian permite «Título#Subtítulo»: se busca el último tramo.
  const want = normHeading(anchor.split('#').pop());
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    if (/^\s{0,3}#{1,6}\s/.test(lines[i]) && normHeading(lines[i]) === want) return i;
  }
  return -1;
}

// Texto de la sección/bloque al que apunta `anchor` (para ![[Nota#Título]]):
// del título hasta el siguiente de nivel igual o superior; un ^id es su línea
// (sin el marcador). Sin ancla → la nota entera. null si no existe.
export function anchorText(src, anchor) {
  const text = String(src || '');
  if (!anchor) return text;
  const line = findAnchorLine(text, anchor);
  if (line < 0) return null;
  const lines = text.split(/\r?\n/);
  if (anchor.startsWith('^')) return lines[line].replace(BLOCK_ID_RE, '');
  const level = (/^\s*(#+)/.exec(lines[line]) || ['', '#'])[1].length;
  let end = lines.length;
  let fence = false;
  for (let i = line + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^\s{0,3}(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(line, end).join('\n').replace(/\s+$/, '');
}
