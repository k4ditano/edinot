// Plugins de markdown-it para los bloques nuevos (Leer + exportaciones):
//   · Avisos  > [!note] Título  (sintaxis GitHub/Obsidian) → caja tintada con icono.
//   · Desplegables <details><summary>Título</summary> … </details> → <details>
//     plegable. El renderer va con html:false, así que el bloque se reconoce
//     aquí y el contenido interior se tokeniza como Markdown normal.

import { calloutKind } from './model.js';
import { calloutIcon } from './icons.js';

const CALLOUT_HEAD = /^\[!([a-zA-Z]+)\]([+-]?)[ \t]*/;

function calloutCore(state) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open.type !== 'blockquote_open') continue;
    // Primer inline del blockquote (paragraph_open, inline).
    const inline = tokens[i + 2];
    if (!inline || inline.type !== 'inline' || tokens[i + 1].type !== 'paragraph_open') continue;
    const m = CALLOUT_HEAD.exec(inline.content);
    if (!m) continue;
    const kind = calloutKind(m[1]);
    // Título: el resto de la primera línea (opcional).
    const nl = inline.content.indexOf('\n');
    const firstLine = (nl < 0 ? inline.content : inline.content.slice(0, nl)).slice(m[0].length);
    // Con más líneas, la primera es el título (en negrita); un aviso de una
    // sola línea es solo texto (como en Notion).
    const titled = nl >= 0 && firstLine.trim();
    open.meta = { callout: kind, title: titled ? firstLine.trim() : '' };
    // Corre antes de la regla `inline`: basta con recortar el contenido (el
    // marcador y el título, que se pinta aparte) para que los hijos salgan
    // ya sin él.
    inline.content = nl < 0 ? firstLine.trim() : inline.content.slice(nl + 1);
    // Cierre emparejado (mismo nivel).
    let depth = 0;
    for (let j = i; j < tokens.length; j++) {
      if (tokens[j].type === 'blockquote_open') depth++;
      else if (tokens[j].type === 'blockquote_close') { depth--; if (depth === 0) { tokens[j].meta = { callout: kind }; break; } }
    }
    // Párrafo vacío tras quitar la cabecera: no pintarlo.
    if (!inline.content.trim() && tokens[i + 3] && tokens[i + 3].type === 'paragraph_close') {
      tokens[i + 1].hidden = true; tokens[i + 3].hidden = true;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const OPEN_RE = /^<details(\s[^>]*)?>\s*(?:<summary>(.*?)<\/summary>)?\s*$/i;
const CLOSE_RE = /^<\/details>\s*$/i;

function detailsBlock(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = state.src.slice(start, max);
  const m = OPEN_RE.exec(line);
  if (!m) return false;
  // Buscar el </details> que cierra (contando anidados).
  let depth = 1, next = startLine;
  while (++next < endLine) {
    const s = state.bMarks[next] + state.tShift[next];
    const txt = state.src.slice(s, state.eMarks[next]);
    if (/^<details[\s>]/i.test(txt)) depth++;
    else if (CLOSE_RE.test(txt)) { depth--; if (depth === 0) break; }
  }
  if (silent) return true;
  const open = /\sopen(\s|=|$)/i.test(m[1] || '');
  const tOpen = state.push('edinot_details_open', 'details', 1);
  tOpen.meta = { summary: m[2] || '', open };
  tOpen.map = [startLine, next];
  tOpen.block = true;
  const oldMax = state.lineMax, oldParent = state.parentType;
  state.parentType = 'edinot_details';
  state.lineMax = next;
  state.md.block.tokenize(state, startLine + 1, next);
  state.lineMax = oldMax;
  state.parentType = oldParent;
  const tClose = state.push('edinot_details_close', 'details', -1);
  tClose.block = true;
  state.line = Math.min(next + 1, endLine);
  return true;
}

export function blocksMarkdownIt(md) {
  md.core.ruler.after('block', 'edinot_callout', calloutCore);
  md.block.ruler.before('html_block', 'edinot_details', detailsBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  const prevOpen = md.renderer.rules.blockquote_open;
  md.renderer.rules.blockquote_open = (tokens, idx, opts, env, self) => {
    const meta = tokens[idx].meta;
    if (meta && meta.callout) {
      const title = meta.title ? `<div class="md-callout-title">${md.renderInline(meta.title, env)}</div>` : '';
      // <blockquote> (no <div>): las exportaciones (HTML/PDF/Word) que no
      // conocen .md-callout lo siguen pintando como una cita.
      return `<blockquote class="md-callout md-callout-${meta.callout}" data-callout="${meta.callout}">`
        + `<span class="md-callout-ic" aria-hidden="true">${calloutIcon(meta.callout, 18)}</span>`
        + `<div class="md-callout-body">${title}`;
    }
    return prevOpen ? prevOpen(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
  const prevClose = md.renderer.rules.blockquote_close;
  md.renderer.rules.blockquote_close = (tokens, idx, opts, env, self) => {
    if (tokens[idx].meta && tokens[idx].meta.callout) return '</div></blockquote>\n';
    return prevClose ? prevClose(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.edinot_details_open = (tokens, idx, opts, env) => {
    const { summary, open } = tokens[idx].meta;
    return `<details class="md-toggle"${open ? ' open' : ''}><summary class="md-toggle-sum">`
      + `<span class="md-toggle-chev" aria-hidden="true"></span>`
      + `<span class="md-toggle-title">${summary ? md.renderInline(summary, env) : escapeHtml('')}</span></summary>`
      + `<div class="md-toggle-body">\n`;
  };
  md.renderer.rules.edinot_details_close = () => '</div></details>\n';
}
