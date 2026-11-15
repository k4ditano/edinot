// Fórmulas LaTeX con KaTeX: `$…$` en línea y `$$…$$` en bloque.
//   · mdMath(md): plugin de markdown-it (Leer, exportar y los widgets de Editar).
//   · renderMath(tex, display): HTML de una fórmula (widgets en línea de Editar).
// Reglas de `$` en línea (las de Pandoc, para no confundir precios): el `$`
// de apertura no va seguido de espacio, el de cierre no va precedido de
// espacio ni seguido de un dígito, y `\$` es un dólar literal.

import katex from 'katex';

const cache = new Map();
export function renderMath(tex, display = false) {
  const key = (display ? 'D' : 'I') + tex;
  if (cache.has(key)) return cache.get(key);
  let html;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
  } catch (e) {
    html = `<span class="md-math-err" title="${String(e && e.message || e).replace(/"/g, '&quot;')}">${tex.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>`;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, html);
  return html;
}

// Busca `$…$` en línea en `text` a partir de `pos`. Devuelve {from, to, tex} o null.
export function findInlineMath(text, pos = 0) {
  for (let i = pos; i < text.length; i++) {
    if (text[i] !== '$') continue;
    if (i > 0 && text[i - 1] === '\\') continue;
    if (text[i + 1] === '$') { i++; continue; } // `$$` no es en línea
    if (!text[i + 1] || /\s/.test(text[i + 1])) continue;
    let j = i + 1;
    for (; j < text.length; j++) {
      if (text[j] !== '$' || text[j - 1] === '\\') continue;
      // Un `$` que no puede cerrar anula esta apertura (precios: «$5 y $10»).
      if (/\s/.test(text[j - 1]) || /\d/.test(text[j + 1] || '')) break;
      return { from: i, to: j + 1, tex: text.slice(i + 1, j) };
    }
    if (j >= text.length) return null;
    i = j - 1; // seguir buscando desde ese `$`
  }
  return null;
}

export function mdMath(md) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$') return false;
    const m = findInlineMath(state.src.slice(state.pos, Math.min(state.posMax, state.pos + 4000)), 0);
    if (!m || m.from !== 0) return false;
    if (!silent) {
      const tok = state.push('math_inline', 'math', 0);
      tok.content = m.tex;
      tok.markup = '$';
    }
    state.pos += m.to;
    return true;
  });

  md.block.ruler.after('blockquote', 'math_block', (state, startLine, endLine, silent) => {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    if (state.src.slice(pos, pos + 2) !== '$$') return false;
    let first = state.src.slice(pos + 2, max);
    let last = '';
    let next = startLine;
    let found = false;
    if (first.trim().endsWith('$$')) {
      // $$ … $$ en una sola línea
      first = first.trim().slice(0, -2);
      found = true;
    }
    if (!found) {
      for (next = startLine + 1; next < endLine; next++) {
        pos = state.bMarks[next] + state.tShift[next];
        max = state.eMarks[next];
        if (pos < max && state.sCount[next] < state.blkIndent) break;
        const line = state.src.slice(pos, max);
        if (line.trim().endsWith('$$')) { last = line.trim().slice(0, -2); found = true; break; }
      }
    }
    if (!found) return false;
    if (silent) return true;
    const body = found && next > startLine
      ? [first, state.getLines(startLine + 1, next, state.tShift[startLine], true), last].join('\n')
      : first;
    state.line = next + 1;
    const tok = state.push('math_block', 'math', 0);
    tok.block = true;
    tok.content = body.trim();
    tok.map = [startLine, state.line];
    tok.markup = '$$';
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  md.renderer.rules.math_inline = (tokens, idx) => `<span class="md-math">${renderMath(tokens[idx].content, false)}</span>`;
  md.renderer.rules.math_block = (tokens, idx) => `<div class="md-math-block">${renderMath(tokens[idx].content, true)}</div>\n`;
}
