// Editor de bloques — modelo. Los «bloques» son los nodos de primer nivel del
// árbol de sintaxis de Lezer (párrafo, título, cada elemento de lista con sus
// hijos, cita/aviso, código, tabla, separador, desplegable <details>…). Aquí
// viven solo funciones puras sobre EditorState: cálculo (cacheado por árbol)
// y las transformaciones de texto (convertir, mover, duplicar, borrar) que
// el resto del editor despacha como UNA transacción de CodeMirror — así pasan
// por y-codemirror y quedan en el UndoManager compartido.

import { embedFor } from './embeds.js';
import { syntaxTree, ensureSyntaxTree, syntaxTreeAvailable } from '@codemirror/language';

export const VIEW_DIRECTIVE_LINE = /^[ \t]*<!--\s*edinot:view=/i;
export const PROPS_LINE = /^[ \t]*<!--\s*edinot:props\s.*-->[ \t]*$/;
export const ANY_DIRECTIVE_LINE = /^[ \t]*<!--\s*edinot:/i;
export const CALLOUT_RE = /^(\s*>\s?)\[!([a-zA-Z]+)\]([+-]?)[ \t]?/;
export const DETAILS_OPEN_RE = /^\s*<details(\s[^>]*)?>/i;
export const DETAILS_CLOSE_RE = /^\s*<\/details>\s*$/i;
export const SUMMARY_RE = /^(\s*<details(?:\s[^>]*)?>\s*<summary>)(.*?)(<\/summary>)\s*$/i;

// Tipos de aviso (sintaxis GitHub/Obsidian) que se pintan con su color.
export const CALLOUT_TYPES = ['note', 'tip', 'idea', 'warning', 'danger', 'info', 'success', 'question', 'quote'];
const CALLOUT_ALIAS = {
  important: 'idea', caution: 'warning', attention: 'warning', error: 'danger', bug: 'danger',
  hint: 'tip', check: 'success', done: 'success', faq: 'question', help: 'question', abstract: 'info',
  summary: 'info', todo: 'info', example: 'note', cite: 'quote', failure: 'danger', fail: 'danger',
};
export function calloutKind(raw) {
  const k = String(raw || '').toLowerCase();
  if (CALLOUT_TYPES.includes(k)) return k;
  return CALLOUT_ALIAS[k] || 'note';
}

const blockCache = new WeakMap(); // Tree → { doc, blocks }

function lineRange(doc, from, to) {
  const a = doc.lineAt(from);
  const b = doc.lineAt(Math.max(from, to - (to > from && doc.sliceString(to - 1, to) === '\n' ? 1 : 0)));
  return { from: a.from, to: b.to, fromLine: a.number, toLine: b.number };
}

// Bloques de primer nivel del documento, en orden. Cada uno:
//   { from, to, fromLine, toLine, type, level?, kind?, node }
// `from/to` siempre alineados a línea completa (inicio de la primera, fin de
// la última). Cacheado por (árbol, doc): recalcularlo es O(nº de bloques).
export function getBlocks(state, { full = true } = {}) {
  // full: árbol completo. Tras una edición CodeMirror solo reparsea hasta el
  // viewport y el resto se completa en segundo plano; para mover/borrar
  // bloques o pintar tablas fuera de pantalla hace falta el documento entero
  // (el reparseo incremental reutiliza fragmentos). Lo que solo mira el
  // viewport (decoraciones en línea, teclado) pide full:false y no fuerza
  // nada en cada pulsación.
  const tree = (!full || syntaxTreeAvailable(state, state.doc.length))
    ? syntaxTree(state)
    : (ensureSyntaxTree(state, state.doc.length, 40) || syntaxTree(state));
  const hit = blockCache.get(tree);
  if (hit && hit.doc === state.doc) return hit.blocks;
  const blocks = computeBlocks(state, tree);
  blockCache.set(tree, { doc: state.doc, blocks });
  return blocks;
}

// Solo los bloques que tocan [from, to] (decoraciones del viewport): no
// recorre el documento entero en cada pulsación. Si el rango empieza dentro
// de un desplegable, retrocede hasta su `<details>` para saberlo.
export function getBlocksInRange(state, from, to) {
  const tree = syntaxTree(state);
  const cur = tree.topNode.cursor();
  if (!cur.childAfter(Math.max(0, from - 1))) return [];
  const doc = state.doc;
  // ¿Hay un <details> abierto antes? (como mucho 400 bloques hacia atrás)
  let depth = 0, back = 0, startFrom = cur.from;
  const probe = tree.topNode.cursor();
  if (probe.childAfter(Math.max(0, from - 1))) {
    while (back++ < 400 && probe.prevSibling()) {
      if (probe.name !== 'HTMLBlock') continue;
      const txt = doc.sliceString(probe.from, Math.min(probe.to, probe.from + 200));
      if (/^\s*<\/details>/i.test(txt)) depth++;
      else if (DETAILS_OPEN_RE.test(txt)) {
        if (depth === 0) { startFrom = probe.from; break; }
        depth--;
      }
    }
  }
  return computeBlocks(state, tree, startFrom, to);
}

const YT_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)/i;

function computeBlocks(state, tree, rangeFrom = 0, rangeTo = Infinity) {
  const doc = state.doc;
  const out = [];
  const cur = tree.topNode.cursor();
  if (rangeFrom > 0 ? !cur.childAfter(rangeFrom - 1) : !cur.firstChild()) return out;
  const push = (b) => { out.push(b); };
  do {
    if (cur.from > rangeTo) break;
    const name = cur.name;
    const node = cur.node;
    const r = lineRange(doc, cur.from, cur.to);
    if (name === 'BulletList' || name === 'OrderedList') {
      const li = node.cursor();
      if (li.firstChild()) {
        do {
          if (li.name !== 'ListItem') continue;
          const lr = lineRange(doc, li.from, li.to);
          const isTask = !!li.node.getChild('Task');
          push({ ...lr, type: isTask ? 'task' : (name === 'OrderedList' ? 'ordered' : 'bullet'), node: li.node });
        } while (li.nextSibling());
      }
      continue;
    }
    let m;
    if ((m = /^ATXHeading([1-6])$/.exec(name)) || (m = /^SetextHeading([12])$/.exec(name))) {
      push({ ...r, type: 'heading', level: +m[1], node });
      continue;
    }
    switch (name) {
      case 'Paragraph': {
        const text = doc.sliceString(r.from, r.to).trim();
        const isImage = /^!\[[^\]]*\]\([^)]*\)$/.test(text);
        // `$$ … $$` (fórmula en bloque, KaTeX).
        const isMath = !isImage && /^\$\$[\s\S]*\$\$$/.test(text) && text.length > 4;
        // `![[Nota]]` solo en su línea: nota incrustada (transclusión).
        // … o una URL sola de un servicio incrustable (YouTube, Vimeo, Figma…).
        const isEmbed = !isImage && !isMath && (/^!\[\[[^\[\]\n]+\]\]$/.test(text)
          || (/^https?:\/\/\S+$/.test(text) && (YT_RE.test(text) || !!embedFor(text))));
        push({ ...r, type: isImage ? 'image' : isMath ? 'math' : isEmbed ? 'embed' : 'paragraph', node });
        break;
      }
      case 'Blockquote': {
        const first = doc.line(r.fromLine).text;
        const cm = CALLOUT_RE.exec(first);
        push({ ...r, type: cm ? 'callout' : 'quote', kind: cm ? calloutKind(cm[2]) : null, node });
        break;
      }
      case 'FencedCode': case 'CodeBlock': push({ ...r, type: 'code', node }); break;
      case 'HorizontalRule': push({ ...r, type: 'hr', node }); break;
      case 'Table': {
        // Absorbe las directivas edinot:view justo encima (metadatos de la
        // tabla: viajan con ella al mover/borrar).
        const prev = out[out.length - 1];
        if (prev && prev.type === 'directive' && prev.toLine === r.fromLine - 1) {
          out.pop();
          push({ ...r, from: prev.from, fromLine: prev.fromLine, type: 'table', tableLine: r.fromLine - 1, node });
        } else push({ ...r, type: 'table', tableLine: r.fromLine - 1, node });
        break;
      }
      case 'CommentBlock': {
        const text = doc.sliceString(r.from, r.to);
        if (PROPS_LINE.test(doc.line(r.fromLine).text)) push({ ...r, type: 'props', node });
        else if (ANY_DIRECTIVE_LINE.test(text)) {
          // Varias directivas seguidas = un solo bloque oculto.
          const prev = out[out.length - 1];
          if (prev && prev.type === 'directive' && prev.toLine === r.fromLine - 1) { prev.to = r.to; prev.toLine = r.toLine; }
          else push({ ...r, type: 'directive', node });
        } else push({ ...r, type: 'html', node });
        break;
      }
      case 'HTMLBlock': {
        const firstText = doc.line(r.fromLine).text;
        if (DETAILS_OPEN_RE.test(firstText)) {
          // Desplegable: abarca hasta su </details> de cierre (contando anidados).
          push({ ...r, type: 'toggle', openLine: r.fromLine, closeLine: null, node, _open: true });
        } else if (DETAILS_CLOSE_RE.test(firstText) || /^\s*<\/details>/i.test(firstText)) {
          push({ ...r, type: '_close', node });
        } else push({ ...r, type: 'html', node });
        break;
      }
      default:
        push({ ...r, type: 'paragraph', node });
    }
  } while (cur.nextSibling());
  return foldToggles(out, doc);
}

// Une `<details>` … `</details>` (que Lezer parte en varios bloques) en un
// solo bloque «toggle» con los bloques internos como hijos.
function foldToggles(list, doc) {
  if (!list.some(b => b.type === 'toggle' || b.type === '_close')) return list;
  const out = [];
  const stack = [];
  for (const b of list) {
    if (b.type === 'toggle' && b._open) {
      // `<details>…</details>` en un único bloque HTML (sin líneas en blanco).
      const text = doc.sliceString(b.from, b.to);
      const opens = (text.match(/<details[\s>]/gi) || []).length;
      const closes = (text.match(/<\/details>/gi) || []).length;
      const blk = { ...b, _open: false, children: [] };
      if (closes >= opens) { blk.closeLine = b.toLine; (stack.length ? stack[stack.length - 1].children : out).push(blk); continue; }
      stack.push(blk);
      continue;
    }
    if (b.type === '_close') {
      const open = stack.pop();
      if (!open) { out.push({ ...b, type: 'html' }); continue; }
      open.to = b.to; open.toLine = b.toLine; open.closeLine = b.fromLine;
      (stack.length ? stack[stack.length - 1].children : out).push(open);
      continue;
    }
    if (stack.length) {
      const top = stack[stack.length - 1];
      top.children.push(b);
      top.to = b.to; top.toLine = b.toLine;
      continue;
    }
    out.push(b);
  }
  // Desplegables sin cierre: se quedan hasta el final de lo que abarcan.
  while (stack.length) {
    const open = stack.shift();
    out.push(open);
    for (const c of open.children) if (c.type !== 'toggle') { /* ya contados en open.to */ }
  }
  return out;
}

// Bloque que contiene `pos` (o el más cercano por arriba).
export function blockAt(state, pos, opts) {
  const blocks = getBlocks(state, opts);
  let lo = 0, hi = blocks.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].from <= pos) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  const b = blocks[best];
  return pos <= b.to ? { block: b, index: best } : { block: null, index: best, after: b };
}

// Bloques «movibles» (los que reciben asa): todo menos directivas/props.
export function isHandleBlock(b) {
  return b && b.type !== 'directive' && b.type !== 'props' && b.type !== '_close';
}

// ── Prefijos de línea ────────────────────────────────────────────────────
const PREFIX_RE = /^(\s*)(?:(#{1,6})\s+|((?:>\s?)+)(?:\[![a-zA-Z]+\][+-]?\s?)?|([-*+])\s+(\[[ xX]\]\s+)?|(\d{1,9})([.)])\s+(\[[ xX]\]\s+)?)/;

// Longitud del marcador oculto al inicio de la línea (título, lista, tarea,
// cita/aviso). 0 si no hay.
export function linePrefixLength(text) {
  const m = PREFIX_RE.exec(text);
  return m ? m[0].length : 0;
}

export function stripLinePrefix(text) {
  const m = PREFIX_RE.exec(text);
  return m ? text.slice(m[0].length) : text;
}

// Texto «plano» de un bloque: sus líneas sin marcadores de bloque, sin vallas
// de código y, si es un desplegable, el título + el contenido.
export function blockPlainLines(state, b) {
  const doc = state.doc;
  const lines = [];
  for (let n = b.fromLine; n <= b.toLine; n++) lines.push(doc.line(n).text);
  if (b.type === 'code') {
    let body = lines.slice();
    if (/^\s*(```|~~~)/.test(body[0] || '')) body = body.slice(1);
    if (body.length && /^\s*(```|~~~)\s*$/.test(body[body.length - 1])) body = body.slice(0, -1);
    return body;
  }
  if (b.type === 'toggle') {
    const sm = SUMMARY_RE.exec(lines[0] || '');
    const head = sm ? sm[2] : '';
    const body = lines.slice(1).filter(l => !DETAILS_CLOSE_RE.test(l));
    while (body.length && !body[0].trim()) body.shift();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    return [head, ...body];
  }
  if (b.type === 'table' || b.type === 'hr' || b.type === 'html' || b.type === 'image') return lines;
  if (b.type === 'bullet' || b.type === 'ordered' || b.type === 'task') {
    // Solo la primera línea pierde el marcador; los hijos anidados se quedan.
    return [stripLinePrefix(lines[0]), ...lines.slice(1)];
  }
  return lines.map(stripLinePrefix);
}

// Markdown de un bloque convertido a `kind`.
//   text · h1 · h2 · h3 · bullet · ordered · task · quote · callout · code · toggle
export function convertBlockText(state, b, kind) {
  let lines = blockPlainLines(state, b);
  if (!lines.length) lines = [''];
  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  switch (kind) {
    case 'text': return lines.join('\n');
    case 'h1': return '# ' + joined;
    case 'h2': return '## ' + joined;
    case 'h3': return '### ' + joined;
    case 'bullet': return lines.map((l, i) => (i === 0 || !/^\s/.test(l)) ? '- ' + l.trimStart() : l).join('\n');
    case 'ordered': {
      let n = 0;
      return lines.map((l, i) => (i === 0 || !/^\s/.test(l)) ? `${++n}. ${l.trimStart()}` : l).join('\n');
    }
    case 'task': return lines.map((l, i) => (i === 0 || !/^\s/.test(l)) ? '- [ ] ' + l.trimStart() : l).join('\n');
    case 'quote': return lines.map(l => '> ' + l).join('\n');
    case 'callout': return lines.map((l, i) => (i === 0 ? '> [!note] ' : '> ') + l).join('\n');
    case 'code': return '```\n' + lines.join('\n') + '\n```';
    case 'toggle': {
      const [head, ...body] = lines;
      return `<details><summary>${head.trim()}</summary>\n\n${body.join('\n')}${body.length ? '\n' : ''}\n</details>`;
    }
    default: return null;
  }
}

// Separador entre dos bloques: listas pegadas con un salto; el resto, con
// una línea en blanco (si no, Markdown fundiría los párrafos).
function isListType(t) { return t === 'bullet' || t === 'ordered' || t === 'task'; }
function sepBetween(a, b) { return (isListType(a.type) && isListType(b.type)) ? '\n' : '\n\n'; }

// Bloques seleccionados: rango [i, i+n) de bloques con asa que toca la
// selección principal (n = 1 si la selección cabe en un bloque).
export function selectedBlockRange(state, blocks = getBlocks(state).filter(isHandleBlock)) {
  const { from, to } = state.selection.main;
  let i = -1, k = -1;
  for (let x = 0; x < blocks.length; x++) {
    const b = blocks[x];
    if (b.to >= from && b.from <= to) { if (i < 0) i = x; k = x; }
  }
  if (i < 0) return null;
  // Una selección que termina justo al principio de un bloque no lo incluye.
  if (k > i && to === blocks[k].from && from !== to) k--;
  return { i, n: k - i + 1 };
}

const ITEM_MARK_RE = /^\s*([-*+]|\d{1,9}[.)])\s+/;
// Ancho del marcador del elemento de lista (sangría para anidar debajo).
export function listContentIndent(lineText) {
  const m = ITEM_MARK_RE.exec(lineText);
  return m ? m[0].length : 0;
}

// Cambios para mover los bloques [i, i+n) delante del bloque `j`
// (j === blocks.length → al final). Con `child`, se anidan como hijos del
// elemento de lista j-1 (solo si todos los movidos son elementos de lista).
// Devuelve { changes, at, assoc, offset, text } o null. Un solo dispatch.
export function moveBlockChanges(state, i, j, n = 1, child = false) {
  const blocks = getBlocks(state).filter(isHandleBlock);
  const b = blocks[i], bl = blocks[i + n - 1];
  if (!b || !bl) return null;
  const doc = state.doc;
  const parent = child ? blocks[j - 1] : null;
  if (child) {
    if (!parent || !isListType(parent.type) || (j - 1 >= i && j - 1 < i + n)) return null;
    for (let x = i; x < i + n; x++) if (!isListType(blocks[x].type)) return null;
  } else if (j >= i && j <= i + n) return null;
  const text = doc.sliceString(b.from, bl.to);
  const next = blocks[i + n];
  const prev = blocks[i - 1];
  // Quitar los bloques con su hueco de después (o el de antes si son los últimos).
  // Entre `prev` y `next` queda el separador que les toca (si no, una lista
  // seguida de un párrafo se fundiría con él).
  let del;
  if (prev && next) del = { from: prev.to, to: next.from, insert: sepBetween(prev, next) };
  else if (next) del = { from: b.from, to: next.from };
  else if (prev) del = { from: prev.to, to: bl.to };
  else return null;
  if (child) {
    const pad = ' '.repeat(listContentIndent(doc.lineAt(parent.from).text));
    const nested = text.split('\n').map((l) => (l ? pad + l : l)).join('\n');
    // Si el padre va justo antes, el borrado empieza donde insertamos: hay
    // que insertar ANTES de borrar (mismo punto, orden de los cambios).
    if (del.from === parent.to) {
      // El padre va justo antes: un solo cambio (borrar + insertar anidado).
      return { changes: [{ from: del.from, to: del.to, insert: '\n' + nested + (del.insert || '') }], at: parent.to, assoc: -1, offset: 1, text: nested };
    }
    return { changes: [{ from: parent.to, insert: '\n' + nested }, del], at: parent.to, assoc: -1, offset: 1, text: nested };
  }
  if (j >= blocks.length) {
    const last = blocks[blocks.length - 1];
    if (!last || (last.from >= b.from && last.to <= bl.to)) return null;
    const sep = sepBetween(last, b);
    return { changes: [del, { from: last.to, insert: sep + text }], at: last.to, assoc: -1, offset: sep.length, text };
  }
  const target = blocks[j];
  return { changes: [del, { from: target.from, insert: text + sepBetween(bl, target) }], at: target.from, assoc: -1, offset: 0, text };
}

// Ejecuta un movimiento y deja el cursor al principio del bloque movido.
export function dispatchMove(view, i, j, userEvent = 'move.block', n = 1, child = false) {
  const res = moveBlockChanges(view.state, i, j, n, child);
  if (!res) return false;
  const changes = view.state.changes(res.changes);
  // Posición del bloque tras el cambio: mapear su punto de inserción.
  const pos = changes.mapPos(res.at, res.assoc) + res.offset;
  const caret = Math.min(changes.newLength, pos + linePrefixLength(res.text.split('\n')[0]));
  const head = n > 1 ? Math.min(changes.newLength, pos + res.text.length) : caret;
  view.dispatch({ changes, selection: n > 1 ? { anchor: pos, head } : { anchor: caret }, userEvent, scrollIntoView: true });
  return true;
}

export function duplicateBlock(view, b) {
  const doc = view.state.doc;
  const text = doc.sliceString(b.from, b.to);
  const sep = isListType(b.type) ? '\n' : '\n\n';
  view.dispatch({
    changes: { from: b.to, insert: sep + text },
    selection: { anchor: b.to + sep.length + linePrefixLength(text) },
    userEvent: 'input.duplicate', scrollIntoView: true,
  });
}

export function deleteBlock(view, b) {
  const state = view.state;
  const blocks = getBlocks(state).filter(isHandleBlock);
  const i = blocks.findIndex(x => x.from === b.from);
  const next = blocks[i + 1], prev = blocks[i - 1];
  let from = b.from, to = b.to;
  if (next) to = next.from;
  else if (prev) from = prev.to;
  else to = Math.min(state.doc.length, b.to + 1);
  view.dispatch({ changes: { from, to }, selection: { anchor: Math.min(from, state.doc.length - (to - from)) }, userEvent: 'delete.block' });
}

export function convertBlock(view, b, kind) {
  const next = convertBlockText(view.state, b, kind);
  if (next == null) return false;
  view.dispatch({
    changes: { from: b.from, to: b.to, insert: next },
    selection: { anchor: b.from + Math.min(next.length, kindCaretOffset(next, kind)) },
    userEvent: 'input.convert', scrollIntoView: true,
  });
  return true;
}

function kindCaretOffset(text, kind) {
  const first = text.split('\n')[0];
  if (kind === 'code') return 4;
  if (kind === 'toggle') { const m = SUMMARY_RE.exec(first); return m ? m[1].length + m[2].length : 0; }
  return first.length;
}

// Plantillas Markdown de cada tipo de bloque del menú «/».
export function blockSnippet(kind) {
  switch (kind) {
    case 'text': return { text: '', caret: 0 };
    case 'h1': return { text: '# ', caret: 2 };
    case 'h2': return { text: '## ', caret: 3 };
    case 'h3': return { text: '### ', caret: 4 };
    case 'bullet': return { text: '- ', caret: 2 };
    case 'ordered': return { text: '1. ', caret: 3 };
    case 'task': return { text: '- [ ] ', caret: 6 };
    case 'quote': return { text: '> ', caret: 2 };
    case 'callout': return { text: '> [!note] ', caret: 10 };
    case 'code': return { text: '```\n\n```', caret: 4, block: true };
    case 'toggle': {
      const head = '<details><summary>';
      return { text: head + '</summary>\n\n\n\n</details>', caret: head.length, block: true };
    }
    case 'hr': return { text: '---\n\n', caret: 5, block: true };
    default: return null;
  }
}

// ¿La línea `n` está en blanco o es el inicio del documento? (para no pegar
// un separador `---` a un párrafo: lo convertiría en título setext).
export function needsBlankBefore(doc, lineNo) {
  if (lineNo <= 1) return false;
  return doc.line(lineNo - 1).text.trim() !== '';
}
