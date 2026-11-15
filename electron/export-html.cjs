// Documento de exportación (HTML/PDF/Word) de una nota.
//
// El renderer manda el HTML de «Leer» ya limpio de controles (doExportNote en
// editor.jsx): cabecera de página con propiedades (.blk-props), avisos
// (blockquote.md-callout), desplegables (details.md-toggle), bloques de base
// de datos convertidos a tabla estática (staticTableHtml → table.md-table con
// celdas .md-cell-*) y bloques de código (.md-codewrap). Aquí se envuelve en
// un documento imprimible con la tipografía del rediseño y, para Word, se
// simplifica a lo que html-to-docx sabe pintar.

const fsSync = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Colores de los avisos (mismos que ui/blocks.css en tema claro).
const CALLOUT_COLORS = {
  note: ['#E2EAD8', '#4C6C40'],
  tip: ['#F3EBCB', '#8A6A12'], idea: ['#F3EBCB', '#8A6A12'],
  warning: ['#F5E0D2', '#9A4A1C'],
  danger: ['#F3D9D4', '#A8352B'],
  info: ['#DAE5F2', '#2F5E95'],
  success: ['#D9EBDC', '#2C7246'],
  question: ['#E6DEF0', '#6A4C9C'],
  quote: ['#E9EBE4', '#5D6455'],
};
const calloutColors = (type) => CALLOUT_COLORS[type] || CALLOUT_COLORS.note;

// @font-face del build (dist/fonts.css) con rutas absolutas file://. Sólo
// sirve donde el HTML se abre en esta máquina (el PDF se imprime desde un
// archivo temporal); el HTML exportado usa las pilas de reserva.
function exportFontCss(distDir) {
  try {
    const css = fsSync.readFileSync(path.join(distDir, 'fonts.css'), 'utf8');
    const base = pathToFileURL(path.join(distDir, 'fonts')).href;
    return css.replace(/url\(\.\/fonts\//g, `url(${base}/`);
  } catch { return ''; }
}

// Los desplegables salen abiertos: en papel no se pueden abrir.
function openToggles(html) {
  return String(html || '').replace(/<details\b(?![^>]*\bopen\b)/gi, '<details open');
}

const STYLE = `
  :root { --fg: #1B1E18; --muted: #5D6455; --faint: #8A9181; --line: #DDE0D5; --side: #EFF1EA; --hover: #E9EBE4;
    --accent: #4C6C40; --accent-soft: #E2EAD8; --pill-h: 200deg;
    --font-ui: 'Inter', 'Instrument Sans', -apple-system, 'Segoe UI', system-ui, sans-serif;
    --font-serif: 'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace; }
  * { box-sizing: border-box; }
  @page { margin: 18mm 16mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 15px/1.65 var(--font-ui); color: var(--fg); background: #fff; max-width: 760px; margin: 40px auto; padding: 0 24px; }
  @media print { body { margin: 0 auto; padding: 0; max-width: none; } }
  h1,h2,h3,h4,h5,h6 { font-family: var(--font-serif); font-weight: 600; line-height: 1.2; letter-spacing: -0.005em; margin: 1.5em 0 0.45em; break-after: avoid; page-break-after: avoid; }
  h1 { font-size: 2.2em; margin-top: 0.2em; } h2 { font-size: 1.55em; } h3 { font-size: 1.25em; } h4 { font-size: 1.05em; }
  p { margin: 0.6em 0; }
  ul, ol { padding-left: 1.5em; margin: 0.6em 0; }
  li { margin: 0.2em 0; }
  li.task-list-item { list-style: none; margin-left: -1.3em; }
  .task-list-item-checkbox { margin: 0 0.45em 0 0; vertical-align: -1px; accent-color: var(--accent); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 1.6em 0; }
  a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .wikilink { color: var(--accent); }
  .wikilink-broken { color: var(--muted); }
  code { font-family: var(--font-mono); background: var(--hover); padding: 1px 5px; border-radius: 5px; font-size: 0.86em; }
  pre { font-family: var(--font-mono); background: #F3F4EE; border: 1px solid var(--line); padding: 12px 14px; border-radius: 10px; overflow: auto; font-size: 0.86em; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  pre code { background: none; padding: 0; font-size: 1em; }
  .md-codewrap { margin: 0.9em 0; break-inside: avoid; }
  .md-codewrap pre { margin: 0; }
  .md-code-bar { font-family: var(--font-mono); font-size: 11px; color: var(--muted); text-transform: lowercase; margin: 0 0 4px 2px; }
  blockquote { border-left: 3px solid var(--line); margin: 0.8em 0; padding: 2px 14px; color: var(--muted); }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { border-bottom: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 500; font-size: 0.92em; border-bottom-color: #C9CEC0; background: transparent; }
  td:first-child { font-weight: 500; }

  /* Cabecera de página: icono y propiedades */
  .blk-page-icon.has { width: 56px; height: 56px; border-radius: 14px; background: var(--side); display: flex; align-items: center; justify-content: center; font-size: 32px; line-height: 1; margin: 0 0 12px; }
  .blk-page-icon.none { display: none; }
  .blk-page-title { margin-top: 0; }
  .blk-props { font-size: 0.9em; line-height: 1.4; margin: 0 0 22px; break-inside: avoid; }
  .blk-props-list { display: grid; grid-template-columns: 150px minmax(0, 1fr); row-gap: 2px; margin: 0; }
  .blk-prop { display: contents; }
  .blk-prop dt { color: var(--muted); display: flex; align-items: center; gap: 8px; min-height: 28px; margin: 0; }
  .blk-prop dt svg { flex: none; color: var(--faint); }
  .blk-prop dd { margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-height: 28px; }
  .blk-prop-empty { color: var(--faint); }
  .blk-pill { height: 22px; padding: 0 9px; border-radius: 6px; display: inline-flex; align-items: center; font-weight: 500; font-size: 0.92em; background: var(--hover); color: var(--fg); }
  .blk-pill.tone-go { background: var(--accent-soft); color: var(--accent); }
  .blk-pill.tone-ok { background: #D9EBDC; color: #2C7246; }
  .blk-pill.tone-bad { background: #F5E0D2; color: #8A3B14; }
  .blk-pill.tone-warn { background: #F3EBCB; color: #6B5410; }
  .blk-person { display: inline-flex; align-items: center; gap: 7px; }
  .blk-avatar { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
  .blk-tag { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 0.92em; }
  .blk-tag button { display: none; }
  .blk-check { width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid var(--faint); display: inline-block; position: relative; }
  .blk-check.on { background: var(--accent); border-color: var(--accent); }
  .blk-check.on::after { content: ''; position: absolute; left: 3.5px; top: 0.5px; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
  .blk-prop-url { color: var(--accent); }
  .blk-props-rule { height: 1px; background: var(--line); margin: 12px 0 0; }

  /* Avisos */
  .md-callout { display: flex; gap: 12px; padding: 12px 16px; border-radius: 10px; border: 0; background: var(--c-bg, var(--accent-soft)); color: var(--fg); margin: 0.9em 0; font-size: 0.95em; line-height: 1.6; break-inside: avoid; }
  .md-callout-ic { color: var(--c-fg, var(--accent)); display: inline-flex; margin-top: 2px; flex: none; }
  .md-callout-body { flex: 1; min-width: 0; }
  .md-callout-body > :first-child { margin-top: 0; }
  .md-callout-body > :last-child { margin-bottom: 0; }
  .md-callout-title { font-weight: 600; margin: 0 0 2px; }
${Object.entries(CALLOUT_COLORS).map(([k, [bg, fg]]) => `  .md-callout-${k} { --c-bg: ${bg}; --c-fg: ${fg}; }`).join('\n')}

  /* Desplegables (siempre abiertos al exportar) */
  .md-toggle { margin: 0.7em 0; }
  .md-toggle > summary { list-style: none; display: flex; align-items: center; gap: 6px; font-weight: 600; padding: 2px 0; }
  .md-toggle > summary::-webkit-details-marker { display: none; }
  .md-toggle-chev { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .md-toggle-chev::before { content: ''; width: 6px; height: 6px; border-right: 1.6px solid var(--muted); border-bottom: 1.6px solid var(--muted); transform: rotate(45deg); margin-top: -4px; }
  .md-toggle-body { padding-left: 22px; border-left: 2px solid var(--line); margin-left: 7px; }
  .md-toggle-body > :first-child { margin-top: 0.3em; }

  /* Celdas con tipo de las bases de datos */
  .md-cell-pill, .md-cell-tag { display: inline-block; padding: 1px 8px; border-radius: 6px; font-size: 0.9em; font-weight: 500;
    background: hsl(var(--pill-h,200deg),45%,91%); color: hsl(var(--pill-h,200deg),50%,28%); margin: 1px 3px 1px 0; }
  .md-cell-status { display: inline-flex; align-items: center; gap: 6px; padding: 1px 9px 1px 8px; border-radius: 6px; font-size: 0.9em; font-weight: 500; white-space: nowrap;
    background: hsl(var(--pill-h,200deg),45%,91%); color: hsl(var(--pill-h,200deg),50%,26%); }
  .md-cell-status-dot { width: 7px; height: 7px; border-radius: 50%; background: hsl(var(--pill-h,200deg),50%,45%); }
  .md-cell-rating { color: #C08A12; letter-spacing: 1px; }
  .md-cell-prog { display: inline-flex; align-items: center; gap: 8px; min-width: 110px; width: 100%; }
  .md-cell-prog-track { flex: 1; height: 5px; min-width: 48px; border-radius: 3px; background: var(--hover); overflow: hidden; }
  .md-cell-prog-bar { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .md-cell-prog-num { font-family: var(--font-mono); font-size: 0.8em; color: var(--muted); min-width: 3.2em; text-align: right; }
  .md-cell-person { display: inline-flex; align-items: center; gap: 6px; margin-right: 6px; white-space: nowrap; }
  .md-cell-person-av { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #fff; background: hsl(var(--pill-h,200deg),38%,46%); }
  .md-cell-date { white-space: nowrap; }
  .md-cell-check { font-size: 1.1em; }

  .export-letterhead { display: flex; margin: 0 0 26px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
  .export-letterhead.lh-left { justify-content: flex-start; }
  .export-letterhead.lh-center { justify-content: center; }
  .export-letterhead.lh-right { justify-content: flex-end; }
  .export-letterhead img { max-height: 64px; max-width: 300px; height: auto; width: auto; }
`;

// Envuelve el fragmento HTML de una nota en un documento imprimible.
// `opts.fontCss`: @font-face a incrustar (sólo PDF, ver exportFontCss).
function buildExportHtml(title, innerHtml, letterhead, opts = {}) {
  // Membrete opcional: logo arriba, alineado según Ajustes (data: URL para
  // que el documento sea autónomo).
  const lhAlign = (letterhead && ['left', 'center', 'right'].includes(letterhead.align)) ? letterhead.align : 'left';
  const lhHtml = (letterhead && typeof letterhead.logo === 'string' && /^data:image\//i.test(letterhead.logo))
    ? `<div class="export-letterhead lh-${lhAlign}"><img src="${letterhead.logo}" alt=""></div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${opts.fontCss || ''}
${STYLE}</style></head><body>${lhHtml}${openToggles(innerHtml)}</body></html>`;
}

// ── Word ────────────────────────────────────────────────────────────────
// html-to-docx no entiende flex/grid, <svg>, <details>, <dl> ni variables
// CSS: se reescribe el HTML a tablas y estilos en línea sencillos.

// Sustituye cada elemento <tag …> cuyo tag de apertura casa con `openRe`
// (anclado al inicio del tag) por fn(openTag, inner), respetando anidación.
function replaceBalanced(html, tag, openTest, fn) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  let out = '';
  let pos = 0;
  for (;;) {
    re.lastIndex = pos;
    let m;
    let start = -1;
    let openTag = '';
    while ((m = re.exec(html))) {
      if (!m[1] && openTest(m[0])) { start = m.index; openTag = m[0]; break; }
    }
    if (start < 0) break;
    let depth = 1;
    let end = -1;
    let innerEnd = -1;
    re.lastIndex = start + openTag.length;
    while ((m = re.exec(html))) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) { innerEnd = m.index; end = m.index + m[0].length; break; }
    }
    if (end < 0) break;
    const inner = html.slice(start + openTag.length, innerEnd);
    out += html.slice(pos, start) + fn(openTag, replaceBalanced(inner, tag, openTest, fn));
    pos = end;
  }
  return out + html.slice(pos);
}

const hasClass = (cls) => (openTag) => {
  const m = openTag.match(/\bclass="([^"]*)"/i);
  return !!m && m[1].split(/\s+/).includes(cls);
};
const innerOf = (html, cls, tag = 'div') => {
  let found = null;
  replaceBalanced(html, tag, hasClass(cls), (_o, inner) => { if (found == null) found = inner; return ''; });
  return found;
};

function toDocxHtml(doc) {
  let s = String(doc || '');
  // Iconos SVG fuera (Word no los pinta y algunos rompen el conversor).
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
  // Casillas de tareas → símbolos.
  s = s.replace(/<input\b[^>]*type="checkbox"[^>]*>/gi, (tag) => (/\bchecked\b/i.test(tag) ? '☑ ' : '☐ '));
  // Propiedades de la página → tabla de dos columnas.
  s = replaceBalanced(s, 'div', hasClass('blk-props'), (_o, inner) => {
    const rows = [];
    const re = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
    let m;
    while ((m = re.exec(inner))) {
      const k = m[1].replace(/<[^>]+>/g, '').trim();
      const v = m[2].replace(/<span class="blk-avatar"[^>]*>[\s\S]*?<\/span>/gi, '').replace(/<(?!\/?(strong|em|a)\b)[^>]+>/gi, ' ').replace(/\s+/g, ' ').trim();
      rows.push(`<tr><td style="color:#5D6455;border:0;padding:3px 8px 3px 0">${k}</td><td style="border:0;padding:3px 0">${v}</td></tr>`);
    }
    return rows.length ? `<table style="width:100%;border-collapse:collapse;border:0">${rows.join('')}</table><hr>` : '';
  });
  // Avisos → tabla de una celda con fondo y borde de color.
  s = replaceBalanced(s, 'blockquote', hasClass('md-callout'), (open, inner) => {
    const type = (open.match(/data-callout="([a-z-]+)"/i) || [])[1] || 'note';
    const [bg, fg] = calloutColors(type);
    const body = innerOf(inner, 'md-callout-body') ?? inner.replace(/<span class="md-callout-ic"[^>]*>\s*<\/span>/i, '');
    const titled = body.replace(/<div class="md-callout-title">([\s\S]*?)<\/div>/i, '<p><strong>$1</strong></p>');
    return `<table style="width:100%;border-collapse:collapse;margin:8px 0"><tr><td style="background-color:${bg};border:0;border-left:3px solid ${fg};padding:8px 12px">${titled}</td></tr></table>`;
  });
  // Desplegables → título en negrita + contenido.
  s = replaceBalanced(s, 'details', () => true, (_o, inner) => {
    const sum = (inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || '';
    const title = sum.replace(/<[^>]+>/g, '').trim();
    const body = inner.replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, '');
    return `<p><strong>${title}</strong></p>${body}`;
  });
  // Barra del bloque de código (etiqueta de lenguaje) fuera.
  s = replaceBalanced(s, 'div', hasClass('md-code-bar'), () => '');
  // Barras de progreso → «60 %».
  s = replaceBalanced(s, 'span', hasClass('md-cell-prog'), (open) => {
    const pct = (open.match(/title="([^"]*)"/) || [])[1] || '';
    return esc(pct);
  });
  // Avatares de persona fuera (la inicial suelta queda rara en Word).
  s = s.replace(/<span class="md-cell-person-av">[\s\S]*?<\/span>/gi, '').replace(/<span class="md-cell-status-dot"><\/span>/gi, '');
  return s;
}

// ── Exportar desde Markdown (MCP export_note, sin renderer) ─────────────
// `render(md)` = markdown-it con html:false. Se reproduce lo esencial de
// «Leer»: propiedades bajo el título, comentarios edinot:* fuera, avisos
// `> [!tipo]` y desplegables <details><summary>.
const DET_OPEN = '%%EDINOT-DETAILS-OPEN%%';
const DET_CLOSE = '%%EDINOT-DETAILS-CLOSE%%';
function markdownToExportFragment(md, render) {
  const lines = String(md || '').split('\n');
  let props = null;
  const kept = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced) {
      const pm = line.match(/^[ \t]*<!--\s*edinot:props\s+(.*?)\s*-->[ \t]*$/);
      if (pm) {
        if (!props) {
          props = [];
          for (const part of pm[1].split(';')) {
            const eq = part.indexOf('=');
            if (eq > 0 && part.slice(0, eq).trim()) props.push([part.slice(0, eq).trim(), part.slice(eq + 1).trim()]);
          }
        }
        continue;
      }
      if (/^[ \t]*<!--\s*edinot:[\s\S]*?-->[ \t]*$/.test(line)) continue;
      const dm = line.match(/^\s*<details>\s*<summary>([\s\S]*?)<\/summary>\s*$/i);
      if (dm) { kept.push('', DET_OPEN + dm[1], ''); continue; }
      if (/^\s*<\/details>\s*$/i.test(line)) { kept.push('', DET_CLOSE, ''); continue; }
    }
    kept.push(line);
  }
  let html = render(kept.join('\n'));
  html = html.replace(new RegExp(`<p>${DET_OPEN}([\\s\\S]*?)</p>`, 'g'),
    '<details open class="md-toggle"><summary class="md-toggle-sum"><span class="md-toggle-chev"></span><span class="md-toggle-title">$1</span></summary><div class="md-toggle-body">');
  html = html.replace(new RegExp(`<p>${DET_CLOSE}</p>`, 'g'), '</div></details>');
  // Tareas «- [ ]» / «- [x]» → casillas.
  html = html.replace(/<li>(<p>)?\[( |x|X)\]\s/g, (_m, p, c) =>
    `<li class="task-list-item">${p || ''}<input class="task-list-item-checkbox" type="checkbox" disabled${c.trim() ? ' checked' : ''}> `);
  html = replaceBalanced(html, 'blockquote', () => true, (open, inner) => {
    const m = inner.match(/^\s*<p>\[!([a-z]+)\][ \t]*([^\n]*?)(\n|<\/p>)/i);
    if (!m) return `${open}${inner}</blockquote>`;
    const type = m[1].toLowerCase();
    const first = m[2].trim();
    let rest = inner.slice(inner.indexOf(m[0]) + m[0].length);
    let body;
    if (m[3] === '\n') {
      // Primera línea = título; el resto del párrafo sigue como texto.
      body = `<div class="md-callout-title">${first}</div><p>${rest}`;
    } else {
      body = (first ? `<p>${first}</p>` : '') + rest;
    }
    return `<blockquote class="md-callout md-callout-${esc(type)}" data-callout="${esc(type)}"><div class="md-callout-body">${body}</div></blockquote>`;
  });
  if (props && props.length) {
    const dl = `<div class="blk-props"><dl class="blk-props-list">${props.map(([k, v]) =>
      `<div class="blk-prop"><dt><span>${esc(k)}</span></dt><dd>${esc(v)}</dd></div>`).join('')}</dl><div class="blk-props-rule"></div></div>`;
    const h1End = /^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i.exec(html);
    html = h1End ? html.slice(0, h1End[0].length) + dl + html.slice(h1End[0].length) : dl + html;
  }
  return html;
}

module.exports = { buildExportHtml, toDocxHtml, exportFontCss, openToggles, markdownToExportFragment };
