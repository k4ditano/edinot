// Resaltado de código para los bloques ``` (Leer y Editar comparten el mismo
// renderizador markdown-it, así que basta con resaltar en la regla `fence`).
// highlight.js «core» + una lista corta de lenguajes para no inflar el chunk.

import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ini from 'highlight.js/lib/languages/ini';
import plaintext from 'highlight.js/lib/languages/plaintext';

const LANGS = {
  javascript, typescript, python, bash, shell, json, css, xml, sql, markdown, yaml,
  java, c, cpp, csharp, go, rust, php, ruby, kotlin, swift, diff, dockerfile, ini, plaintext,
};
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

// Lenguajes que ofrece el selector (valor que se escribe tras ```, etiqueta).
export const CODE_LANGS = [
  ['', 'Texto'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'],
  ['bash', 'Bash'], ['json', 'JSON'], ['html', 'HTML'], ['css', 'CSS'], ['sql', 'SQL'],
  ['markdown', 'Markdown'], ['yaml', 'YAML'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'],
  ['csharp', 'C#'], ['go', 'Go'], ['rust', 'Rust'], ['php', 'PHP'], ['ruby', 'Ruby'],
  ['kotlin', 'Kotlin'], ['swift', 'Swift'], ['diff', 'Diff'], ['dockerfile', 'Dockerfile'],
  ['toml', 'TOML / INI'],
];

const ALIAS = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'bash', zsh: 'bash', console: 'shell', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml',
  yml: 'yaml', md: 'markdown', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', golang: 'go', rs: 'rust', rb: 'ruby',
  kt: 'kotlin', toml: 'ini', docker: 'dockerfile', patch: 'diff', text: 'plaintext', txt: 'plaintext' };

export function resolveLang(lang) {
  const l = String(lang || '').trim().toLowerCase().split(/\s+/)[0];
  if (!l) return null;
  const name = ALIAS[l] || l;
  return hljs.getLanguage(name) ? name : null;
}

// HTML resaltado (ya escapado) o null si no hay lenguaje conocido. Bloques
// enormes se dejan sin resaltar para no bloquear el render.
export function highlightCode(code, lang) {
  const name = resolveLang(lang);
  if (!name || name === 'plaintext' || code.length > 60000) return null;
  try { return hljs.highlight(code, { language: name, ignoreIllegals: true }).value; } catch { return null; }
}

// <select> del lenguaje para la barra del bloque de código.
export function langSelectHtml(lang, escapeHtml) {
  const cur = String(lang || '').trim().split(/\s+/)[0];
  const known = CODE_LANGS.some(([v]) => v === cur);
  const opts = (known ? CODE_LANGS : [[cur, cur], ...CODE_LANGS])
    .map(([v, label]) => `<option value="${escapeHtml(v)}"${v === cur ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  return `<select class="md-code-lang md-code-langsel" data-code-lang="1" title="Lenguaje">${opts}</select>`;
}

// Reescribe la línea de apertura ``` con otro lenguaje (conserva la valla).
export function withFenceLang(openLine, lang) {
  const m = /^(\s*)(`{3,}|~{3,})\s*(\S*)(.*)$/.exec(openLine);
  if (!m) return openLine;
  return `${m[1]}${m[2]}${lang}${lang ? m[4].replace(/^\s*/, m[4].trim() ? ' ' : '') : ''}`;
}

// Cambia el lenguaje del n-ésimo bloque ``` / ~~~ del fuente (orden de
// aparición, igual que los .md-codewrap renderizados).
export function setNthFenceLang(src, nth, lang) {
  const lines = src.split('\n');
  let count = -1, open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (!m) continue;
    if (open) { if (lines[i].trim().startsWith(open) && /^\s*(`{3,}|~{3,})\s*$/.test(lines[i])) open = null; continue; }
    open = m[1];
    // Las vallas propias (edinot-canvas, edinot-db…) no se pintan como código.
    if (/^\s*(`{3,}|~{3,})\s*edinot-/.test(lines[i])) continue;
    count++;
    if (count === nth) { lines[i] = withFenceLang(lines[i], lang); return lines.join('\n'); }
  }
  return src;
}
