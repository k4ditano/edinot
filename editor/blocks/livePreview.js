// Editor de bloques (modo «Editar») — la capa estilo Notion sobre CodeMirror.
// El documento sigue siendo Markdown plano (Y.Text, MCP, CLI y exportación no
// cambian): aquí solo se DECORA y se añaden comandos.
//
//   · blockField (StateField): decoraciones de bloque que CodeMirror solo
//     admite desde un campo — tablas/código/separador renderizados (el mismo
//     LpRenderWidget de siempre), cabecera de página (icono, título,
//     propiedades), directivas ocultas y el cierre de los desplegables. Se
//     calcula recorriendo solo los nodos de PRIMER NIVEL del árbol (barato) y
//     los widgets conservan su DOM entre reconstrucciones (updateDOM), así que
//     escribir en notas largas no recrea tablas.
//   · inlinePlugin (ViewPlugin): marcas en línea, marcadores ocultos, títulos,
//     listas, tareas, citas/avisos, enlaces, wikilinks y placeholders — solo
//     sobre los rangos VISIBLES (viewport), recalculado en cada cambio.
//   · Los marcadores ocultos son ATÓMICOS (EditorView.atomicRanges): el cursor
//     los salta y Retroceso/Supr nunca dejan `**` huérfanos (keymap propio +
//     un transactionFilter que borra la pareja si una selección se lleva solo
//     una de las dos marcas).
//   · Asas de bloque (+ y ⋮⋮), arrastrar para reordenar, Alt+Mayús+↑/↓, menú
//     «/», barra flotante sobre la selección y pegar HTML → Markdown. La UI
//     React (BlockUI.jsx) escucha en `blockBus`.

import { EditorView, Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { StateField, StateEffect, Prec, EditorState, findClusterBreak } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree, syntaxTreeAvailable, foldEffect, unfoldEffect, foldedRanges, codeFolding } from '@codemirror/language';
import { completionStatus } from '@codemirror/autocomplete';
import { t } from '../../i18n.js';
import {
  getBlocks, getBlocksInRange, blockAt, isHandleBlock, dispatchMove, linePrefixLength, selectedBlockRange,
  CALLOUT_RE, SUMMARY_RE, DETAILS_CLOSE_RE, calloutKind,
} from './model.js';
import { blockBus } from './bus.js';
import { propsHtml, pageIconHtml, parsePropsLine, tagClick } from './props.js';
import { svg, calloutIcon } from './icons.js';
import { htmlWorthConverting, htmlToMarkdown, warmTurndown } from './paste.js';
import { computeBlockSpacing } from './spacing.js';
import { renumberLists } from './renumber.js';
import { coverHtml, coverAddHtml } from './cover.js';
import { findInlineMath, renderMath } from './math.js';

// ── Widgets ──────────────────────────────────────────────────────────────

class OlMarkWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-lp-olmark'; s.textContent = this.text; return s; }
}

// «3.» → número mostrado según su posición en la lista (Markdown solo usa el
// primero; Leer numera seguido). Empieza en el menor número de la lista.
function orderedDisplay(state, markNode, txt) {
  const m = /^(\d{1,9})([.)])$/.exec(txt);
  const li = markNode.parent, list = li && li.parent;
  if (!m || !list || list.name !== 'OrderedList') return null;
  let min = Infinity, idx = 0, i = 0;
  for (let it = list.firstChild; it; it = it.nextSibling) {
    if (it.name !== 'ListItem') continue;
    const mk2 = it.getChild('ListMark');
    if (!mk2) continue;
    const n = parseInt(state.doc.sliceString(mk2.from, mk2.to), 10);
    if (Number.isFinite(n)) min = Math.min(min, n);
    if (it.from === li.from) idx = i;
    i++;
  }
  return Number.isFinite(min) ? `${min + idx}${m[2]}` : null;
}

class MathInlineWidget extends WidgetType {
  constructor(tex, from) { super(); this.tex = tex; this.from = from; }
  eq(o) { return o.tex === this.tex && o.from === this.from; }
  toDOM(view) {
    const el = document.createElement('span');
    el.className = 'cm-lp-math md-math';
    el.innerHTML = renderMath(this.tex, false);
    // Clic → cursor dentro del LaTeX para editarlo.
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 1 } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() { return true; }
}

class BulletWidget extends WidgetType {
  constructor(depth) { super(); this.depth = depth; }
  eq(o) { return o.depth === this.depth; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-lp-bullet';
    s.textContent = ['•', '◦', '▪'][this.depth % 3];
    return s;
  }
  ignoreEvent() { return false; }
}

class CalloutIconWidget extends WidgetType {
  constructor(kind) { super(); this.kind = kind; }
  eq(o) { return o.kind === this.kind; }
  toDOM(view) {
    const s = document.createElement('span');
    s.className = 'cm-lp-callout-ic';
    s.innerHTML = calloutIcon(this.kind, 18);
    s.title = t('blk.callout.change');
    s.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(s);
      blockBus.emit('callout:menu', { view, pos, rect: s.getBoundingClientRect() });
    });
    return s;
  }
  ignoreEvent() { return true; }
}

class ToggleChevronWidget extends WidgetType {
  constructor(folded, open, close) { super(); this.folded = folded; this.open = open; this.close = close; }
  eq(o) { return o.folded === this.folded; }
  updateDOM(dom) { dom.classList.toggle('folded', this.folded); return true; }
  toDOM(view) {
    const s = document.createElement('span');
    s.className = 'cm-lp-toggle-chev' + (this.folded ? ' folded' : '');
    s.setAttribute('role', 'button');
    s.setAttribute('aria-label', t('blk.toggle.fold'));
    s.innerHTML = svg('chevRight', 14, 2.2);
    s.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFoldAt(view, view.posAtDOM(s));
    });
    return s;
  }
  ignoreEvent() { return true; }
}

class PlaceholderWidget extends WidgetType {
  constructor(text, cls) { super(); this.text = text; this.cls = cls || ''; }
  eq(o) { return o.text === this.text && o.cls === this.cls; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-blk-ph ' + this.cls;
    s.setAttribute('aria-hidden', 'true');
    s.textContent = this.text;
    return s;
  }
  ignoreEvent() { return false; }
}

class HiddenBlockWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const d = document.createElement('div'); d.className = 'cm-blk-hidden'; return d; }
  get estimatedHeight() { return 0; }
  ignoreEvent() { return true; }
}
const hiddenBlockWidget = new HiddenBlockWidget();

// Cabecera de página: icono + (título si la nota no empieza por H1) +
// propiedades si no tienen otro sitio.
class PageHeadWidget extends WidgetType {
  constructor(icon, title, propsLine, editable, cover) {
    super(); this.icon = icon || ''; this.title = title; this.propsLine = propsLine; this.canEdit = editable; this.cover = cover || '';
  }
  eq(o) { return o.icon === this.icon && o.title === this.title && o.propsLine === this.propsLine && o.canEdit === this.canEdit && o.cover === this.cover; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'cm-blk-head' + (this.cover ? ' has-cover' : '');
    let html = coverHtml(this.cover, { editable: this.canEdit })
      + '<div class="blk-head-row">' + pageIconHtml(this.icon, { editable: this.canEdit }) + coverAddHtml(this.cover, { editable: this.canEdit }) + '</div>';
    if (this.title != null) {
      html += `<h1 class="cm-blk-title${this.title ? '' : ' empty'}" data-blk-title="1">${escapeHtml(this.title || t('blk.untitled'))}</h1>`;
    }
    if (this.propsLine != null) html += propsHtml(parsePropsLine(this.propsLine), { editable: this.canEdit });
    el.innerHTML = html;
    wireHeadEvents(el, view, this.canEdit, this.title);
    return el;
  }
  ignoreEvent() { return true; }
}

class PropsWidget extends WidgetType {
  constructor(propsLine, editable) { super(); this.propsLine = propsLine || ''; this.canEdit = editable; }
  eq(o) { return o.propsLine === this.propsLine && o.canEdit === this.canEdit; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'cm-blk-propswrap';
    el.innerHTML = propsHtml(parsePropsLine(this.propsLine), { editable: this.canEdit });
    wireHeadEvents(el, view, this.canEdit, null);
    return el;
  }
  ignoreEvent() { return true; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Nombres que la app pone a una nota nueva: al pulsar el título se
// seleccionan enteros para escribir encima.
const DEFAULT_TITLE_RE = /^(nuevo documento|nueva nota|sin t[ií]tulo|untitled|new document|new note)(\s*\(?\d+\)?)?$/i;

function wireHeadEvents(el, view, editable, title) {
  if (!editable) return;
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('a.blk-prop-url')) return;
    if (e.target.closest('[data-blk-tags]')) {
      if (tagClick(e.target, (action, p) => blockBus.emit('tags:' + action, p))) e.preventDefault();
      return;
    }
    const cv = e.target.closest('[data-blk-cover]');
    if (cv) { e.preventDefault(); blockBus.emit('cover:menu', { action: cv.getAttribute('data-blk-cover'), rect: cv.getBoundingClientRect() }); return; }
    const icon = e.target.closest('[data-blk-icon]');
    const add = e.target.closest('[data-blk-prop-add]');
    const row = e.target.closest('[data-blk-prop]');
    const ttl = e.target.closest('[data-blk-title]');
    if (!icon && !add && !row && !ttl) return;
    e.preventDefault();
    if (icon) blockBus.emit('icon:pick', { rect: icon.getBoundingClientRect() });
    else if (add) blockBus.emit('props:add', { rect: add.getBoundingClientRect() });
    else if (row) blockBus.emit('props:edit', { key: row.getAttribute('data-blk-prop'), rect: row.querySelector('dd').getBoundingClientRect() });
    else if (ttl) {
      // Sin H1: el título viene del nombre del fichero. Al pulsarlo se
      // materializa como «# Título» al principio para editarlo en línea.
      // El cursor va donde se pulsó (antes iba siempre al final y se perdía
      // la selección); un nombre por defecto («Nuevo documento», «Sin
      // título»…) o un doble clic lo seleccionan entero para reescribirlo.
      const name = title || '';
      const insert = '# ' + name + '\n\n';
      let off = name.length;
      try {
        const r = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
        if (r && ttl.contains(r.startContainer) && r.startContainer.nodeType === 3) off = Math.min(name.length, r.startOffset);
      } catch { /* sin posición: al final */ }
      const whole = !name || DEFAULT_TITLE_RE.test(name) || e.detail >= 2;
      const selection = whole ? { anchor: 2, head: 2 + name.length } : { anchor: 2 + off };
      view.dispatch({ changes: { from: 0, insert }, selection, userEvent: 'input.title' });
      view.focus();
    }
  });
}

// ── Plegado de desplegables ──────────────────────────────────────────────

function toggleRange(state, pos) {
  const b = blockAt(state, pos, { full: false });
  const blk = b && b.block && b.block.type === 'toggle' ? b.block : null;
  if (!blk) return null;
  const open = state.doc.line(blk.fromLine);
  const lastBody = blk.closeLine ? blk.closeLine - 1 : blk.toLine;
  if (lastBody <= blk.fromLine) return null;
  return { from: open.to, to: state.doc.line(lastBody).to };
}

function isFoldedAt(state, from) {
  let found = false;
  foldedRanges(state).between(from, from + 1, (a) => { if (a === from) found = true; });
  return found;
}

export function toggleFoldAt(view, pos) {
  const r = toggleRange(view.state, pos);
  if (!r) return false;
  if (isFoldedAt(view.state, r.from)) {
    let eff = null;
    foldedRanges(view.state).between(r.from, r.from + 1, (a, b) => { if (a === r.from) eff = unfoldEffect.of({ from: a, to: b }); });
    if (eff) view.dispatch({ effects: eff });
  } else {
    view.dispatch({ effects: foldEffect.of(r) });
  }
  return true;
}

// ── Plegado de secciones (bajo un título) ────────────────────────────────
// Del final de la línea del título hasta el bloque anterior al siguiente
// título de nivel igual o superior (o el final de la nota).
export function sectionRange(state, pos, opts) {
  const blocks = getBlocks(state, opts);
  const i = blocks.findIndex(b => b.type === 'heading' && pos >= b.from && pos <= b.to);
  if (i < 0) return null;
  const h = blocks[i];
  let last = null;
  for (let j = i + 1; j < blocks.length; j++) {
    const b = blocks[j];
    if (b.type === 'heading' && b.level <= h.level) break;
    if (b.type !== 'directive' && b.type !== '_close') last = b;
  }
  if (!last) return null;
  const from = state.doc.line(h.toLine).to;
  return last.to > from ? { from, to: last.to } : null;
}

export function toggleSectionFold(view, pos) {
  const r = sectionRange(view.state, pos);
  if (!r) return false;
  if (isFoldedAt(view.state, r.from)) {
    let eff = null;
    foldedRanges(view.state).between(r.from, r.from + 1, (a, b) => { if (a === r.from) eff = unfoldEffect.of({ from: a, to: b }); });
    if (eff) view.dispatch({ effects: eff });
  } else {
    view.dispatch({ effects: foldEffect.of(r), selection: view.state.selection.main.head > r.from && view.state.selection.main.head <= r.to ? { anchor: r.from } : undefined });
  }
  return true;
}

class HeadingFoldWidget extends WidgetType {
  constructor(folded) { super(); this.folded = folded; }
  eq(o) { return o.folded === this.folded; }
  toDOM(view) {
    const s = document.createElement('span');
    s.className = 'cm-lp-hfold' + (this.folded ? ' folded' : '');
    s.setAttribute('role', 'button');
    s.setAttribute('aria-label', t('blk.toggle.fold'));
    s.title = this.folded ? 'Desplegar sección' : 'Plegar sección';
    s.innerHTML = svg('chevRight', 13, 2.2) + (this.folded ? '<span class="cm-lp-hfold-more">…</span>' : '');
    s.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSectionFold(view, view.posAtDOM(s));
    });
    return s;
  }
  ignoreEvent() { return true; }
}

// ── Campo de bloques ─────────────────────────────────────────────────────

export const setPageMeta = StateEffect.define();
const BLOCK_WIDGET_TYPES = new Set(['table', 'code', 'hr', 'math', 'embed']);
const OWN_CANVAS_FENCE_RE = /^[ \t]*```edinot-canvas[ \t]*$/;
const SRC_TOGGLE_TYPES = new Set(['math', 'embed']); // con el cursor dentro → fuente

function makeRenderWidgetClass(Base) {
  // Igual que LpRenderWidget, pero conserva el DOM si solo se ha desplazado
  // (mismo HTML/fuente): actualiza from/to de la instancia que guardan los
  // cierres del DOM en vez de recrear la tabla en cada tecla.
  return class BlkRenderWidget extends Base {
    toDOM(view) { const dom = super.toDOM(view); dom.__blkW = this; return dom; }
    updateDOM(dom) {
      const old = dom.__blkW;
      if (!old || old.html !== this.html || old.srcKey !== this.srcKey || old.btype !== this.btype
        || old.tableIdx !== this.tableIdx || old.block !== this.block) return false;
      old.from = this.from; old.to = this.to;
      return true;
    }
  };
}

function buildBlockState(state, cfg, meta) {
  const blocks = getBlocks(state);
  const doc = state.doc;
  const decos = [];
  const hidden = []; // rangos ocultos por bloque (atómicos)
  const renderMd = cfg.getRenderMd();
  const editable = !cfg.readOnly && meta.editable !== false;

  const firstContent = blocks.find(b => b.type !== 'props' && b.type !== 'directive');
  const h1 = firstContent && firstContent.type === 'heading' && firstContent.level === 1 ? firstContent : null;
  const props = blocks.find(b => b.type === 'props');
  const title = h1 ? null : (meta.title || '');
  if (meta.header !== false) {
    if (props && props.fromLine === 1) {
      decos.push(Decoration.replace({ widget: new PageHeadWidget(meta.icon, title, doc.sliceString(props.from, props.to), editable, meta.cover), block: true }).range(props.from, props.to));
      hidden.push([props.from, props.to]);
    } else {
      decos.push(Decoration.widget({ widget: new PageHeadWidget(meta.icon, title, (!props && !h1) ? '' : null, editable, meta.cover), block: true, side: -1 }).range(0));
      if (props) {
        decos.push(Decoration.replace({ widget: new PropsWidget(doc.sliceString(props.from, props.to), editable), block: true }).range(props.from, props.to));
        hidden.push([props.from, props.to]);
      } else if (h1) {
        decos.push(Decoration.widget({ widget: new PropsWidget('', editable), block: true, side: 1 }).range(h1.to));
      }
    }
  } else if (props) {
    decos.push(Decoration.replace({ widget: hiddenBlockWidget, block: true }).range(props.from, props.to));
    hidden.push([props.from, props.to]);
  }

  const mathRanges = [];
  // Página ↔ Canvas: en modo Página la nota no enseña su propio canvas (la
  // primera valla ```edinot-canvas): queda oculta y atómica, como una directiva.
  let canvasHidden = !(cfg.hideOwnCanvas && cfg.hideOwnCanvas());
  const visit = (list) => {
    for (const b of list) {
      if (!canvasHidden && b.type === 'code' && OWN_CANVAS_FENCE_RE.test(doc.lineAt(b.from).text)) {
        canvasHidden = true;
        decos.push(Decoration.replace({ widget: hiddenBlockWidget, block: true }).range(b.from, b.to));
        hidden.push([b.from, b.to]);
        continue;
      }
      if (b.type === 'directive') {
        decos.push(Decoration.replace({ widget: hiddenBlockWidget, block: true }).range(b.from, b.to));
        hidden.push([b.from, b.to]);
        continue;
      }
      if (b.type === 'toggle') {
        if (b.children) visit(b.children);
        if (b.closeLine) {
          const cl = doc.line(b.closeLine);
          decos.push(Decoration.replace({ widget: hiddenBlockWidget, block: true }).range(cl.from, cl.to));
          hidden.push([cl.from, cl.to]);
        }
        continue;
      }
      if (!BLOCK_WIDGET_TYPES.has(b.type)) continue;
      if (SRC_TOGGLE_TYPES.has(b.type)) {
        mathRanges.push([b.from, b.to]);
        // Con el cursor dentro se edita el LaTeX en crudo (como Obsidian).
        if (editable && mathInside(state, b.from, b.to)) continue;
      }
      const raw = doc.sliceString(b.from, b.to);
      const html = cfg.renderHtml(renderMd, raw);
      if (!html) continue;
      const W = cfg.RenderWidget;
      decos.push(Decoration.replace({
        // Código también lleva ctxRef: un ```edinot-db es una vista enlazada.
        widget: new W(html, b.from, b.to, true, b.type, b.type === 'table' || b.type === 'code' ? cfg.ctxRef : null, b.type === 'table' ? b.tableLine : undefined, raw),
        block: true,
      }).range(b.from, b.to));
    }
  };
  visit(blocks);
  return {
    meta,
    deco: Decoration.set(decos, true),
    hidden: Decoration.set(hidden.map(([a, b]) => Decoration.mark({}).range(a, b)), true),
    tree: syntaxTree(state),
    // Fin de la primera línea de contenido (título): editarla puede cambiar
    // la cabecera (título del fichero ↔ H1).
    headEnd: firstContent ? doc.lineAt(firstContent.from).to : 0,
    dirty: false,
    mathRanges,
    mathActive: activeMath(state, mathRanges),
  };
}

function mathInside(state, from, to) {
  const { from: a, to: b } = state.selection.main;
  return b >= from && a <= to;
}
function activeMath(state, ranges) {
  for (const [f, t] of ranges) if (mathInside(state, f, t)) return f;
  return -1;
}

const blockRebuildEffect = StateEffect.define();
const BLOCK_REBUILD_DELAY = 160;

// Tras una ráfaga de tecleo (decoraciones solo mapeadas), reconstruir el
// campo para refrescar posiciones de los widgets y bloques nuevos (`---`,
// tablas recién escritas…).
function makeBlockRebuildScheduler(field) {
  return ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; this.timer = null; }
    update(u) {
      if (!u.docChanged || !u.state.field(field).dirty) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        try { if (this.view.state.field(field).dirty) this.view.dispatch({ effects: blockRebuildEffect.of(null) }); } catch {}
      }, BLOCK_REBUILD_DELAY);
    }
    destroy() { if (this.timer) clearTimeout(this.timer); }
  });
}

function makeBlockField(cfg) {
  return StateField.define({
    create(state) {
      // Primer montaje: parsear el documento completo (con tope) para que
      // las tablas de más abajo salgan ya renderizadas.
      if (!syntaxTreeAvailable(state, state.doc.length)) ensureSyntaxTree(state, state.doc.length, 150);
      return buildBlockState(state, cfg, { icon: '', title: null, editable: !cfg.readOnly, header: false });
    },
    update(value, tr) {
      let meta = value.meta;
      let force = tr.reconfigured;
      for (const e of tr.effects) {
        if (e.is(setPageMeta)) { meta = { ...meta, ...e.value }; force = true; }
        if (e.is(blockRebuildEffect)) force = true;
      }
      if (force) return buildBlockState(tr.state, cfg, meta);
      if (tr.docChanged) {
        // Escribir dentro de una línea normal (lo habitual) no cambia la
        // estructura de bloques: basta con MAPEAR las decoraciones (O(cambio))
        // y reconstruir cuando se deja de teclear. Si cambia el nº de líneas o
        // se toca un bloque renderizado/oculto o el título, reconstruir ya.
        let structural = tr.startState.doc.lines !== tr.state.doc.lines;
        if (!structural) {
          tr.changes.iterChangedRanges((fA, tA) => {
            if (structural) return;
            if (fA <= value.headEnd) { structural = true; return; }
            value.deco.between(fA, tA, () => { structural = true; return false; });
          });
        }
        if (structural) return buildBlockState(tr.state, cfg, meta);
        return {
          ...value,
          deco: value.deco.map(tr.changes),
          hidden: value.hidden.map(tr.changes),
          headEnd: tr.changes.mapPos(value.headEnd, 1),
          tree: syntaxTree(tr.state),
          dirty: true,
        };
      }
      // El parser terminó en segundo plano (tablas fuera de pantalla, etc.).
      if (syntaxTree(tr.state) !== value.tree) return buildBlockState(tr.state, cfg, meta);
      // El cursor entra o sale de una fórmula $$ → mostrar LaTeX o render.
      if (tr.selection && value.mathRanges && value.mathRanges.length
        && activeMath(tr.state, value.mathRanges) !== value.mathActive) return buildBlockState(tr.state, cfg, meta);
      return value;
    },
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.deco),
      EditorView.atomicRanges.of((view) => view.state.field(f).hidden),
    ],
  });
}

// ── Plugin en línea (viewport) ───────────────────────────────────────────

const mk = (cls) => Decoration.mark({ class: cls });
const lpStrong = mk('cm-lp-strong');
const lpEm = mk('cm-lp-em');
const lpStrike = mk('cm-lp-strike');
const lpCode = Decoration.mark({ class: 'cm-lp-code', attributes: { spellcheck: 'false' } }); // sin subrayado del corrector en código
const lpLink = mk('cm-lp-link');
const lpLinkSrc = mk('cm-lp-linksrc');
const lpDone = mk('cm-lp-task-done');
const lpHide = Decoration.replace({});
const SKIP_NODES = new Set(['Table', 'FencedCode', 'CodeBlock', 'HorizontalRule', 'CommentBlock', 'HTMLBlock']);
const FORMAT_NODES = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode']);
const WIKI_RE = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

function headingPh(level) { return t('blk.ph.h' + Math.min(level, 3)); }

function buildInline(view, cfg) {
  const { state } = view;
  const doc = state.doc;
  const decos = [];
  const atomic = [];
  const hide = (a, b) => { if (b > a) { decos.push(lpHide.range(a, b)); atomic.push([a, b]); } };
  const replaceW = (a, b, widget) => { decos.push(Decoration.replace({ widget }).range(a, b)); atomic.push([a, b]); };
  const eatSpace = (to, lineEnd) => { let e = to; while (e < lineEnd) { const c = doc.sliceString(e, e + 1); if (c === ' ' || c === '\t') e++; else break; } return e; };
  const sel = state.selection.main;
  const focused = view.hasFocus;
  const blocks = getBlocksInRange(state, view.viewport.from, view.viewport.to);
  const tree = syntaxTree(state);
  const lineClasses = new Map(); // lineFrom → Set(class)
  const addLine = (from, cls) => { let s = lineClasses.get(from); if (!s) lineClasses.set(from, s = new Set()); s.add(cls); };
  const skipLines = new Set(); // líneas tapadas por un widget de bloque
  const toggleOpens = new Map(); // nº de línea → bloque toggle

  // Bloques que tocan el viewport: clases de línea para avisos/citas y
  // desplegables, y qué líneas no hay que decorar.
  const vpFrom = view.viewport.from, vpTo = view.viewport.to;
  const walk = (list) => {
    for (const b of list) {
      if (b.to < vpFrom || b.from > vpTo) { if (b.type === 'toggle' && b.children) walk(b.children); continue; }
      if (b.type === 'table' || b.type === 'code' || b.type === 'hr' || b.type === 'directive' || b.type === 'props' || (SRC_TOGGLE_TYPES.has(b.type) && !(!cfg.readOnly && mathInside(state, b.from, b.to)))) {
        for (let n = b.fromLine; n <= b.toLine; n++) skipLines.add(n);
        continue;
      }
      if (b.type === 'callout' || b.type === 'quote') {
        const kind = b.kind || 'note';
        for (let n = b.fromLine; n <= b.toLine; n++) {
          const ln = doc.line(n);
          if (ln.to < vpFrom || ln.from > vpTo) continue;
          if (b.type === 'callout') {
            addLine(ln.from, 'cm-lp-callout');
            addLine(ln.from, 'cm-lp-callout-' + kind);
            if (n === b.fromLine) addLine(ln.from, 'cm-lp-callout-first');
            if (n === b.toLine) addLine(ln.from, 'cm-lp-callout-last');
          } else {
            addLine(ln.from, 'cm-lp-quote');
          }
        }
        continue;
      }
      if (b.type === 'toggle') {
        toggleOpens.set(b.fromLine, b);
        const last = b.closeLine ? b.closeLine - 1 : b.toLine;
        for (let n = b.fromLine + 1; n <= last; n++) {
          const ln = doc.line(n);
          if (ln.to < vpFrom || ln.from > vpTo) continue;
          addLine(ln.from, 'cm-lp-toggle-body');
          if (!ln.text.trim() && (n === b.fromLine + 1 || n === last)) addLine(ln.from, 'cm-lp-toggle-gap');
        }
        if (b.closeLine) skipLines.add(b.closeLine);
        if (b.children) walk(b.children);
      }
    }
  };
  walk(blocks);
  const spacing = computeBlockSpacing(doc, blocks);
  const lineStyle = (from, css) => decos.push(Decoration.line({ attributes: { style: css } }).range(from));

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from, to,
      enter: (node) => {
        const name = node.name;
        const a = node.from, b = node.to;
        if (SKIP_NODES.has(name)) return false;
        const hm = /^(ATX|Setext)Heading([1-6])$/.exec(name);
        if (hm) {
          const ln = doc.lineAt(a);
          addLine(ln.from, 'cm-lp-h' + hm[2]);
          // Flecha para plegar la sección (al final del título; visible al
          // pasar el ratón o si está plegada).
          if (hm[1] === 'ATX' && ln.text.replace(/^\s*#+\s*/, '').trim()) {
            const sr = sectionRange(state, ln.from, { full: false });
            if (sr) decos.push(Decoration.widget({ widget: new HeadingFoldWidget(isFoldedAt(state, sr.from)), side: 1 }).range(ln.to));
          }
          if (hm[1] === 'Setext') {
            const last = doc.lineAt(b);
            if (last.number !== ln.number) addLine(last.from, 'cm-lp-setext-rule');
          }
          return;
        }
        switch (name) {
          case 'StrongEmphasis': decos.push(lpStrong.range(a, b)); return;
          case 'Emphasis': decos.push(lpEm.range(a, b)); return;
          case 'Strikethrough': decos.push(lpStrike.range(a, b)); return;
          case 'InlineCode': decos.push(lpCode.range(a, b)); return;
          case 'Link': {
            const ln = doc.lineAt(a);
            // `[!note]` de un aviso → icono.
            const cm = CALLOUT_RE.exec(ln.text);
            if (cm && a === ln.from + cm[1].length) {
              const end = ln.from + cm[0].length;
              replaceW(a, end, new CalloutIconWidget(calloutKind(cm[2])));
              addLine(ln.from, 'cm-lp-callout-head');
              return false;
            }
            // `[[wikilink]]` lo pinta el pase de wikilinks.
            if (doc.sliceString(a - 1, a) === '[' && doc.sliceString(b, b + 1) === ']') return false;
            const marks = node.node.getChildren('LinkMark');
            const urlNode = node.node.getChild('URL');
            const inside = sel.from >= a && sel.to <= b && focused;
            if (marks.length >= 2) {
              decos.push(lpLink.range(marks[0].to, marks[1].from));
              hide(marks[0].from, marks[0].to);
              if (inside) {
                // Cursor dentro: se ve la URL (no hay otra forma de editarla).
                decos.push(lpLinkSrc.range(marks[1].from, b));
              } else {
                hide(marks[1].from, b);
              }
            } else decos.push(lpLink.range(a, b));
            void urlNode;
            return false;
          }
          case 'Image': {
            const html = cfg.renderHtml(cfg.getRenderMd(), doc.sliceString(a, b));
            const W = cfg.RenderWidget;
            if (html) replaceW(a, b, new W(html, a, b, false, 'image'));
            return false;
          }
          case 'HeaderMark': {
            const ln = doc.lineAt(a);
            if (a === ln.from || doc.sliceString(ln.from, a).trim() === '') hide(ln.from, eatSpace(b, ln.to));
            else hide(a, b); // marcas de cierre `## Título ##`
            return;
          }
          case 'QuoteMark': {
            const ln = doc.lineAt(a);
            hide(a, eatSpace(b, ln.to));
            return;
          }
          case 'URL':
            // URL suelta (autoenlace GFM): con aspecto de enlace.
            if (!node.node.parent || node.node.parent.name !== 'Link') decos.push(lpLink.range(a, b));
            return;
          case 'EmphasisMark': case 'StrikethroughMark': hide(a, b); return;
          case 'CodeMark': if ((b - a) <= 2) hide(a, b); return;
          case 'ListMark': {
            const li = node.node.parent;
            const ln = doc.lineAt(a);
            const indent = a - ln.from;
            const depth = listDepth(node.node);
            if (depth > 0) {
              decos.push(Decoration.line({ attributes: { style: `padding-left: ${depth * 1.6}em` } }).range(ln.from));
              hide(ln.from, a);
            } else if (indent > 0) hide(ln.from, a);
            const task = li && li.getChild('Task');
            if (task) { hide(a, eatSpace(b, ln.to)); return; }
            const txt = doc.sliceString(a, b);
            if (/^[-*+]$/.test(txt)) replaceW(a, eatSpace(b, ln.to), new BulletWidget(depth));
            else {
              // Número que de verdad sale (como Leer): el menor de la lista + posición.
              const want = orderedDisplay(state, node.node, txt);
              if (want && want !== txt) replaceW(a, b, new OlMarkWidget(want));
              else decos.push(mk('cm-lp-olmark').range(a, b));
            }
            addLine(ln.from, 'cm-lp-li');
            return;
          }
          case 'TaskMarker': {
            const ln = doc.lineAt(a);
            const checked = /x/i.test(doc.sliceString(a, b));
            replaceW(a, eatSpace(b, ln.to), new cfg.TaskWidget(checked, a));
            addLine(ln.from, 'cm-lp-li');
            addLine(ln.from, 'cm-lp-task-line');
            if (checked) {
              const end = node.node.parent ? Math.min(node.node.parent.to, ln.to) : ln.to;
              const start = eatSpace(b, ln.to);
              if (end > start) decos.push(lpDone.range(start, end));
            }
            return;
          }
        }
      },
    });

    // Wikilinks (fuera de la gramática Markdown) + desplegables + placeholders
    // en las líneas visibles.
    let ln = doc.lineAt(from);
    for (;;) {
      if (!skipLines.has(ln.number)) {
        // Líneas en blanco entre bloques: alto fijo de 1em (el margen entre
        // párrafos de Leer), también la del cursor, para que el texto no
        // salte al pasar el cursor por ellas.
        if (!ln.text.trim() && !lineClasses.has(ln.from)) {
          addLine(ln.from, 'cm-blk-blank');
          const h = spacing.blank.get(ln.number);
          if (h != null) lineStyle(ln.from, `line-height: ${h}em`);
        } else if (!ln.text.trim() && lineClasses.has(ln.from) && lineClasses.get(ln.from).has('cm-lp-toggle-body')
          && !lineClasses.get(ln.from).has('cm-lp-toggle-gap')) {
          // Línea en blanco en medio de un desplegable: hueco de párrafo.
          lineStyle(ln.from, 'line-height: 0.6em');
        } else if (lineClasses.has(ln.from) && (lineClasses.get(ln.from).has('cm-lp-quote') || lineClasses.get(ln.from).has('cm-lp-callout'))
          && /^\s*(>\s*)+$/.test(ln.text)) {
          // `>` vacío entre párrafos de una cita/aviso: hueco de párrafo.
          lineStyle(ln.from, 'line-height: 0.6em');
        }
        const pt = spacing.pad.get(ln.number);
        if (pt != null) lineStyle(ln.from, `padding-top: ${pt}em`);
        // Fórmulas $…$ (fuera de código; con el cursor dentro, LaTeX en crudo)
        // y notas al pie [^1] / definiciones [^1]: texto.
        if (ln.text.indexOf('$') >= 0) {
          let p = 0, m;
          while ((m = findInlineMath(ln.text, p))) {
            const a = ln.from + m.from, b = ln.from + m.to;
            p = m.to;
            const inner = tree.resolveInner(a + 1, 1);
            if (/Code|URL|Link/.test(inner.name) || (inner.parent && /Code/.test(inner.parent.name))) continue;
            if (focused && sel.to >= a && sel.from <= b) { decos.push(mk('cm-lp-mathsrc').range(a, b)); continue; }
            replaceW(a, b, new MathInlineWidget(m.tex, a));
          }
        }
        // ` ^id` al final de la línea (destino de [[Nota#^id]]): discreto.
        if (ln.text.indexOf('^') >= 0) {
          const bm = /\s\^[A-Za-z0-9_-]+\s*$/.exec(ln.text);
          if (bm) decos.push(mk('cm-lp-blockid').range(ln.from + bm.index + 1, ln.to));
        }
        if (ln.text.indexOf('[^') >= 0) {
          const def = /^\s*\[\^[^\]\s]+\]:/.exec(ln.text);
          if (def) {
            addLine(ln.from, 'cm-lp-fndef');
            decos.push(mk('cm-lp-fnlabel').range(ln.from, ln.from + def[0].length));
          }
          const FN_RE = /\[\^([^\]\s]+)\]/g;
          let fm;
          while ((fm = FN_RE.exec(ln.text))) {
            if (def && fm.index < def[0].length) continue;
            const fa = ln.from + fm.index, fb = fa + fm[0].length;
            decos.push(Decoration.mark({ class: 'cm-lp-fnref', attributes: { 'data-fn': fm[1] } }).range(fa, fb));
            if (!(focused && sel.to >= fa && sel.from <= fb)) { hide(fa, fa + 2); hide(fb - 1, fb); }
          }
        }
        const tg = toggleOpens.get(ln.number);
        if (tg) decorateToggleHead(state, ln, tg, decos, atomic, focused, sel);
        else if (ln.text.indexOf('[[') >= 0) {
          WIKI_RE.lastIndex = 0;
          let m;
          while ((m = WIKI_RE.exec(ln.text))) {
            const base = ln.from + m.index;
            const labelStart = m[2] ? base + 2 + m[1].length + 1 : base + 2;
            const labelEnd = base + m[0].length - 2;
            hide(base, labelStart);
            decos.push(Decoration.mark({ class: 'cm-lp-link cm-lp-wikilink', attributes: { 'data-wikiname': m[1] } }).range(labelStart, labelEnd));
            hide(labelEnd, base + m[0].length);
          }
        }
      }
      if (ln.to >= to || ln.number >= doc.lines) break;
      ln = doc.line(ln.number + 1);
    }
  }

  // Placeholders: línea vacía con el cursor («Escribe / para comandos») y
  // bloques vacíos (título, lista, tarea, cita, aviso).
  if (!cfg.readOnly) {
    const allEmpty = doc.length === 0 || (doc.lines <= 2 && !doc.toString().trim());
    if (allEmpty) {
      decos.push(Decoration.widget({ widget: new PlaceholderWidget(t('blk.ph.page'), 'page'), side: 1 }).range(doc.length));
    } else if (focused && sel.empty) {
      const line = doc.lineAt(sel.head);
      if (!skipLines.has(line.number)) {
        const text = line.text;
        const pre = linePrefixLength(text);
        if (text.length === pre && !toggleOpens.has(line.number)) {
          let ph = t('blk.ph.slash');
          if (/^\s*#{1,6}\s/.test(text)) ph = headingPh(/^\s*(#+)/.exec(text)[1].length);
          else if (/\[[ xX]\]\s*$/.test(text)) ph = t('blk.ph.task');
          else if (/^\s*([-*+]|\d+[.)])\s/.test(text)) ph = t('blk.ph.list');
          else if (CALLOUT_RE.test(text)) ph = t('blk.ph.callout');
          else if (/^\s*>/.test(text)) ph = t('blk.ph.quote');
          decos.push(Decoration.widget({ widget: new PlaceholderWidget(ph), side: 1 }).range(line.to));
        }
      }
    }
  }

  for (const [from, set] of lineClasses) decos.push(Decoration.line({ class: [...set].join(' ') }).range(from));
  return {
    decorations: Decoration.set(decos, true),
    atomic: Decoration.set(atomic.map(([a, b]) => Decoration.mark({}).range(a, b)), true),
  };
}

function listDepth(listMarkNode) {
  let d = 0;
  for (let n = listMarkNode.parent && listMarkNode.parent.parent; n; n = n.parent) {
    if (n.name === 'ListItem') d++;
  }
  return d;
}

function decorateToggleHead(state, ln, blk, decos, atomic, focused, sel) {
  const m = SUMMARY_RE.exec(ln.text);
  const folded = (() => {
    const r = toggleRange(state, ln.from);
    return r ? isFoldedAt(state, r.from) : false;
  })();
  const chev = new ToggleChevronWidget(folded);
  decos.push(Decoration.line({ class: 'cm-lp-toggle-head' + (folded ? ' folded' : '') }).range(ln.from));
  if (m) {
    const a = ln.from, b = ln.from + m[1].length;
    decos.push(Decoration.replace({ widget: chev }).range(a, b)); atomic.push([a, b]);
    const c = b + m[2].length;
    if (ln.to > c) { decos.push(lpHide.range(c, ln.to)); atomic.push([c, ln.to]); }
    if (!m[2].trim()) {
      decos.push(Decoration.widget({ widget: new PlaceholderWidget(t('blk.ph.toggle')), side: 1 }).range(c));
    }
  } else {
    // `<details>` sin <summary> en la misma línea: chevron + texto tal cual.
    const mm = /^\s*<details(?:\s[^>]*)?>/i.exec(ln.text);
    if (mm) { const b = ln.from + mm[0].length; decos.push(Decoration.replace({ widget: chev }).range(ln.from, b)); atomic.push([ln.from, b]); }
  }
}

function makeInlinePlugin(cfg) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      const r = buildInline(view, cfg);
      this.decorations = r.decorations; this.atomic = r.atomic;
    }
    update(u) {
      const foldChanged = u.transactions.some(tr => tr.effects.some(e => e.is(foldEffect) || e.is(unfoldEffect)));
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || foldChanged
        || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        const r = buildInline(u.view, cfg);
        this.decorations = r.decorations; this.atomic = r.atomic;
      }
    }
  }, {
    decorations: (v) => v.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => { const p = view.plugin(plugin); return p ? p.atomic : Decoration.none; }),
  });
}

// ── Deshacer: cada operación de bloque es un paso propio ─────────────────
// El Y.UndoManager agrupa lo que pasa en 350 ms; mover dos veces seguidas con
// Alt+Mayús+↓ sería un solo «deshacer». Cortamos la captura alrededor.
const undoManagers = new WeakMap(); // EditorView → Y.UndoManager
export function blockStep(view, fn) {
  const um = undoManagers.get(view);
  try { if (um) um.stopCapturing(); } catch {}
  const r = fn();
  try { if (um) um.stopCapturing(); } catch {}
  return r;
}

// ── Teclado ──────────────────────────────────────────────────────────────

function vimNormal(view) {
  const cm = view.cm;
  return !!(cm && cm.state && cm.state.vim && !cm.state.vim.insertMode);
}

// Interior editable de un nodo de formato: { innerFrom, innerTo } o null.
function formatInner(node, doc) {
  if (FORMAT_NODES.has(node.name)) {
    const first = node.firstChild, last = node.lastChild;
    if (!first || !last || first === last || first.from === last.from) return null;
    if (!/Mark$/.test(first.name) || !/Mark$/.test(last.name)) return null;
    return { innerFrom: first.to, innerTo: last.from };
  }
  if (node.name === 'Link') {
    const marks = node.getChildren('LinkMark');
    if (marks.length < 2) return null;
    const close = marks.find(m => doc.sliceString(m.from, m.to) === ']');
    if (!close) return null;
    return { innerFrom: marks[0].to, innerTo: close.from };
  }
  return null;
}

function hiddenBlockBefore(state, line) {
  // ¿La línea anterior es un widget de bloque / línea oculta?
  if (line.number <= 1) return false;
  const prev = state.doc.line(line.number - 1);
  const b = blockAt(state, prev.from, { full: false });
  const blk = b && b.block;
  if (!blk) return false;
  if (blk.type === 'table' || blk.type === 'code' || blk.type === 'hr' || blk.type === 'props' || blk.type === 'directive') return true;
  if (blk.type === 'toggle' && blk.closeLine === prev.number) return true;
  return false;
}

function wikiAround(text, idx) {
  WIKI_RE.lastIndex = 0;
  let m;
  while ((m = WIKI_RE.exec(text))) {
    const s = m.index, e = s + m[0].length;
    if (idx >= s && idx <= e) {
      const labelStart = m[2] ? s + 2 + m[1].length + 1 : s + 2;
      return { from: s, to: e, innerFrom: labelStart, innerTo: e - 2 };
    }
  }
  return null;
}

function deleteInnerChar(view, n, pos, forward) {
  const { state } = view;
  const doc = state.doc;
  const { innerFrom, innerTo } = n;
  if (innerTo - innerFrom <= 0) {
    view.dispatch({ changes: { from: n.from, to: n.to }, userEvent: forward ? 'delete.forward' : 'delete.backward' });
    return true;
  }
  const line = doc.lineAt(pos);
  let a, b;
  if (forward) {
    a = pos; b = line.from + findClusterBreak(line.text, pos - line.from, true);
  } else {
    b = pos; a = line.from + findClusterBreak(line.text, pos - line.from, false);
  }
  a = Math.max(a, innerFrom); b = Math.min(b, innerTo);
  if (b <= a) return false;
  // Si se queda vacío, fuera también las marcas.
  if (a <= innerFrom && b >= innerTo) {
    view.dispatch({ changes: { from: n.from, to: n.to }, selection: { anchor: n.from }, userEvent: forward ? 'delete.forward' : 'delete.backward' });
    return true;
  }
  view.dispatch({ changes: { from: a, to: b }, selection: { anchor: a }, userEvent: forward ? 'delete.forward' : 'delete.backward' });
  return true;
}

function blkBackspace(view) {
  if (vimNormal(view)) return false;
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return false;
  const pos = sel.head;
  const doc = state.doc;
  const line = doc.lineAt(pos);
  const tree = syntaxTree(state);
  // 1) Dentro o justo detrás de un formato en línea (**, *, ~~, `, [..](..)).
  for (let n = tree.resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'Paragraph' || n.type.isTop) break;
    const inner = formatInner(n, doc);
    if (!inner) continue;
    if (pos === n.to || (pos > inner.innerFrom && pos <= inner.innerTo)) {
      const at = pos === n.to ? inner.innerTo : pos;
      if (at <= inner.innerFrom) break;
      return deleteInnerChar(view, { from: n.from, to: n.to, ...inner }, at, false);
    }
    break;
  }
  // 1b) Wikilink [[…]].
  if (line.text.indexOf('[[') >= 0) {
    const w = wikiAround(line.text, pos - line.from);
    if (w && (pos - line.from === w.to || (pos - line.from > w.innerFrom && pos - line.from <= w.innerTo))) {
      const at = pos - line.from === w.to ? w.innerTo : pos - line.from;
      if (at > w.innerFrom) {
        return deleteInnerChar(view, { from: line.from + w.from, to: line.from + w.to, innerFrom: line.from + w.innerFrom, innerTo: line.from + w.innerTo }, line.from + at, false);
      }
    }
  }
  // 2) Al principio del contenido de un bloque con marcador oculto (título,
  //    lista, tarea, cita/aviso): quitar el marcador → texto normal.
  const pre = linePrefixLength(line.text);
  if (pre > 0 && pos === line.from + pre) {
    view.dispatch({ changes: { from: line.from, to: line.from + pre }, selection: { anchor: line.from }, userEvent: 'delete.backward' });
    return true;
  }
  // 2b) Título de un desplegable: deshacer el desplegable (queda el texto).
  const sm = SUMMARY_RE.exec(line.text);
  if (sm && pos === line.from + sm[1].length) {
    const b = blockAt(state, pos, { full: false });
    const blk = b && b.block;
    const changes = [{ from: line.from, to: line.to, insert: sm[2] }];
    if (blk && blk.type === 'toggle' && blk.closeLine) {
      const cl = doc.line(blk.closeLine);
      changes.push({ from: Math.max(cl.from - 1, line.to), to: cl.to });
    }
    view.dispatch({ changes, selection: { anchor: line.from }, userEvent: 'delete.backward' });
    return true;
  }
  // 3) Inicio de línea pegado a un bloque oculto/renderizado: no fundirse con él.
  if (pos === line.from && hiddenBlockBefore(state, line)) {
    if (!line.text.length && line.number < doc.lines) {
      view.dispatch({ changes: { from: line.from, to: line.to + 1 }, selection: { anchor: line.from }, userEvent: 'delete.backward' });
    }
    return true;
  }
  return false;
}

function blkDelete(view) {
  if (vimNormal(view)) return false;
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return false;
  const pos = sel.head;
  const doc = state.doc;
  const tree = syntaxTree(state);
  for (let n = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'Paragraph' || n.type.isTop) break;
    const inner = formatInner(n, doc);
    if (!inner) continue;
    if (pos === n.from || (pos >= inner.innerFrom && pos < inner.innerTo)) {
      const at = pos === n.from ? inner.innerFrom : pos;
      if (at >= inner.innerTo) break;
      return deleteInnerChar(view, { from: n.from, to: n.to, ...inner }, at, true);
    }
    break;
  }
  // Fin de línea justo encima de un bloque renderizado/oculto: no fundirlo.
  const line = doc.lineAt(pos);
  if (pos === line.to && line.number < doc.lines) {
    const next = doc.line(line.number + 1);
    const nb = blockAt(state, next.from, { full: false });
    const blk = nb && nb.block;
    if (blk && blk.from === next.from && WIDGET_BLOCKS.has(blk.type)) {
      if (!line.text.length && line.number > 1) {
        view.dispatch({ changes: { from: line.from - 1, to: line.to }, userEvent: 'delete.forward' });
      }
      return true;
    }
  }
  return false;
}

const WIDGET_BLOCKS = new Set(['table', 'code', 'hr', 'props', 'directive']);

// Rango de un bloque que se pinta como widget u oculto (tabla, código,
// separador, propiedades, directivas, cierre de desplegable) que contiene
// `pos` — el cursor puede acabar en su borde (p. ej. Ctrl+Fin al final de
// la nota) y lo tecleado ahí rompería el bloque.
const WIDGET_NODES = new Set(['Table', 'FencedCode', 'CodeBlock', 'HorizontalRule', 'CommentBlock', 'HTMLBlock']);
function widgetRangeAt(state, pos) {
  // Filtro barato antes de calcular bloques: solo interesa si en `pos` hay
  // un nodo de bloque renderizado/oculto (o un </details>).
  let hit = false;
  const tree = syntaxTree(state);
  for (const side of [-1, 1]) {
    for (let n = tree.resolveInner(pos, side); n && !hit; n = n.parent) if (WIDGET_NODES.has(n.name)) hit = true;
  }
  if (!hit) return null;
  const r = blockAt(state, pos, { full: false });
  const b = r && r.block;
  if (!b) return null;
  if (WIDGET_BLOCKS.has(b.type)) return { from: b.from, to: b.to };
  if (b.type === 'toggle' && b.closeLine) {
    const cl = state.doc.line(b.closeLine);
    if (pos >= cl.from && pos <= cl.to) return { from: cl.from, to: cl.to };
  }
  return null;
}

// Mueve lo tecleado dentro/en el borde de un bloque-widget a un párrafo nuevo
// justo después (o antes, si el cursor está en su inicio).
function widgetEdgeFilter() {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !tr.isUserEvent('input.type')) return tr;
    let ins = null, count = 0;
    tr.changes.iterChanges((fA, tA, fB, tB, text) => { count++; if (fA === tA) ins = { pos: fA, text: text.toString() }; });
    if (count !== 1 || !ins || !ins.text || /\n/.test(ins.text)) return tr;
    const w = widgetRangeAt(tr.startState, ins.pos);
    if (!w) return tr;
    if (ins.pos === w.from && w.from > 0) {
      const insert = ins.text + '\n\n';
      return { changes: { from: w.from, insert }, selection: { anchor: w.from + ins.text.length }, userEvent: 'input.type', scrollIntoView: true };
    }
    const insert = '\n\n' + ins.text;
    return { changes: { from: w.to, insert }, selection: { anchor: w.to + insert.length }, userEvent: 'input.type', scrollIntoView: true };
  });
}

// Triple clic en un título: CodeMirror selecciona la línea entera con su
// «# » oculto y el salto de línea, y al escribir encima se perdía el formato
// de título (el texto acababa como párrafo). Se recorta al texto visible.
function headingLineText(state, pos) {
  const line = state.doc.lineAt(pos);
  const m = /^(#{1,6})\s+/.exec(line.text);
  return m ? { from: line.from + m[0].length, to: line.to, level: m[1].length, line } : null;
}
function headingSelectFilter() {
  return EditorState.transactionFilter.of((tr) => {
    if (tr.docChanged || !tr.selection || !tr.isUserEvent('select.pointer')) return tr;
    const sel = tr.selection.main;
    if (sel.empty || tr.selection.ranges.length > 1) return tr;
    const h = headingLineText(tr.startState, sel.from);
    if (!h || sel.from > h.from || sel.to < h.to || sel.to > h.to + 1) return tr;
    if (h.to <= h.from) return tr;
    return [tr, { selection: { anchor: h.from, head: h.to }, userEvent: 'select.pointer' }];
  });
}
// Ctrl/Cmd+A dentro del título de la página (H1): primero selecciona solo el
// título; una segunda pulsación ya selecciona toda la nota.
function selectTitleFirst(view) {
  const { state } = view;
  const sel = state.selection.main;
  const h = headingLineText(state, sel.head);
  if (!h || h.level !== 1 || h.to <= h.from) return false;
  if (sel.from === h.from && sel.to === h.to) return false;
  if (sel.from < h.line.from || sel.to > h.line.to) return false;
  view.dispatch({ selection: { anchor: h.from, head: h.to }, userEvent: 'select' });
  return true;
}

function blkEnter(view) {
  if (vimNormal(view)) return false;
  if (completionStatus(view.state) === 'active') return false;
  if (blockBus.slash) return blockBus.emit('slash:key', 'Enter');
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  // En el borde de un bloque-widget: párrafo nuevo después (o antes).
  const w = widgetRangeAt(state, sel.head);
  if (w) {
    if (sel.head === w.from && w.from > 0) {
      view.dispatch({ changes: { from: w.from, insert: '\n\n' }, selection: { anchor: w.from }, userEvent: 'input' });
    } else {
      view.dispatch({ changes: { from: w.to, insert: '\n\n' }, selection: { anchor: w.to + 2 }, userEvent: 'input', scrollIntoView: true });
    }
    return true;
  }
  // Título de un desplegable → saltar al contenido (desplegándolo).
  const sm = SUMMARY_RE.exec(line.text);
  if (sm && sel.head >= line.from + sm[1].length) {
    const r = toggleRange(state, line.from);
    if (r && isFoldedAt(state, r.from)) toggleFoldAt(view, line.from);
    const b = blockAt(view.state, line.from, { full: false });
    const blk = b && b.block;
    if (blk && blk.type === 'toggle') {
      const doc = view.state.doc;
      // Primera línea del cuerpo (tras la línea en blanco obligatoria).
      let n = blk.fromLine + 1;
      if (n < (blk.closeLine || doc.lines + 1) && !doc.line(n).text.trim()) n++;
      if (blk.closeLine && n >= blk.closeLine) {
        // Cuerpo vacío: crear una línea.
        const at = doc.line(blk.closeLine).from;
        view.dispatch({ changes: { from: at, insert: '\n\n' }, selection: { anchor: at }, userEvent: 'input' });
      } else {
        view.dispatch({ selection: { anchor: doc.line(n).to }, scrollIntoView: true });
      }
      return true;
    }
  }
  // Elemento de lista / tarea vacío (primer nivel) → salir de la lista a un
  // párrafo, con la línea en blanco que Markdown necesita (si no, el texto
  // siguiente seguiría dentro del elemento por continuación perezosa).
  if (/^([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s*)?$/.test(line.text) || /^([-*+]|\d{1,9}[.)])$/.test(line.text)) {
    const prevIsItem = line.number > 1 && /^\s*([-*+]|\d{1,9}[.)])\s/.test(state.doc.line(line.number - 1).text);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: prevIsItem ? '\n' : '' }, selection: { anchor: line.from + (prevIsItem ? 1 : 0) }, userEvent: 'input' });
    return true;
  }
  // Línea vacía de cita/aviso → salir de la cita.
  if (/^>\s?$/.test(line.text) || /^>\s?\[![a-zA-Z]+\][+-]?\s*$/.test(line.text)) {
    const prevInQuote = line.number > 1 && /^\s*>/.test(state.doc.line(line.number - 1).text);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: prevInQuote ? '\n' : '' }, selection: { anchor: line.from + (prevInQuote ? 1 : 0) }, userEvent: 'input' });
    return true;
  }
  // ``` + Enter → cerrar la valla y entrar al bloque de código.
  const fm = /^(\s*)(```+|~~~+)([\w+-]*)\s*$/.exec(line.text);
  if (fm && sel.head === line.to) {
    const tree = syntaxTree(state);
    const node = tree.resolveInner(line.from, 1);
    let fc = node; while (fc && fc.name !== 'FencedCode') fc = fc.parent;
    const closed = fc && fc.getChildren('CodeMark').length >= 2 && state.doc.lineAt(fc.to).number !== line.number;
    if (!closed) {
      const insert = '\n\n' + fm[1] + fm[2];
      view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + 1 }, userEvent: 'input' });
      focusCodeWidgetAt(view, line.from);
      return true;
    }
  }
  // Párrafo o título de primer nivel: Enter = bloque nuevo (línea en blanco
  // en medio, como cada bloque de Notion). Mayús+Enter = salto suave.
  if (line.text.trim()) {
    let ctx = 'top';
    for (let n = syntaxTree(state).resolveInner(sel.head, -1); n; n = n.parent) {
      if (/^(ListItem|Blockquote|FencedCode|CodeBlock|Table|HTMLBlock|CommentBlock)$/.test(n.name)) { ctx = n.name; break; }
    }
    if (ctx === 'top') {
      const head = sel.head;
      const rest = state.doc.sliceString(head, line.to);
      // Al final, con texto pegado debajo: otra línea en blanco para que el
      // bloque nuevo no se funda con el siguiente.
      const nextText = line.number < state.doc.lines && state.doc.line(line.number + 1).text.trim();
      const insert = '\n\n' + (!rest.trim() && nextText ? '\n' : '');
      view.dispatch({
        changes: { from: head, to: head, insert },
        selection: { anchor: head + 2 },
        userEvent: 'input', scrollIntoView: true,
      });
      return true;
    }
  }
  return false;
}

function softBreak(view) {
  if (vimNormal(view)) return false;
  view.dispatch(view.state.replaceSelection('\n'), { userEvent: 'input', scrollIntoView: true });
  return true;
}

export function focusCodeWidgetAt(view, pos) {
  // Tras el ciclo de medida de CodeMirror (que recoloca la selección DOM en
  // el contenido y le devolvería el foco).
  setTimeout(() => {
    try {
      let code = null, best = Infinity;
      for (const blk of view.dom.querySelectorAll('.cm-lp-block.cm-lp-code')) {
        const d = Math.abs(view.posAtDOM(blk) - pos);
        if (d < best) { best = d; code = blk.querySelector('pre code') || blk.querySelector('pre'); }
      }
      if (code && best <= 4) {
        code.focus();
        const r = document.createRange(); r.selectNodeContents(code); r.collapse(false);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
    } catch {}
  }, 60);
}

function moveCurrentBlock(view, dir) {
  if (vimNormal(view)) return false;
  const state = view.state;
  const blocks = getBlocks(state).filter(isHandleBlock);
  const range = selectedBlockRange(state, blocks);
  if (!range) return true;
  const { i, n } = range;
  if (n > 1) {
    // Varios bloques seleccionados: se mueven juntos y siguen seleccionados.
    blockStep(view, () => (dir < 0 ? (i > 0 && dispatchMove(view, i, i - 1, 'move.block', n)) : (i + n < blocks.length && dispatchMove(view, i, i + n + 1, 'move.block', n))));
    return true;
  }
  const pos = state.selection.main.head;
  const offset = pos - blocks[i].from;
  const ok = blockStep(view, () => (dir < 0 ? (i > 0 && dispatchMove(view, i, i - 1)) : (i < blocks.length - 1 && dispatchMove(view, i, i + 2))));
  if (ok) {
    const nb = getBlocks(view.state).filter(isHandleBlock);
    const moved = dir < 0 ? nb[i - 1] : nb[i + 1];
    if (moved) view.dispatch({ selection: { anchor: Math.min(moved.to, moved.from + offset) }, scrollIntoView: true });
  }
  return true;
}

let plainPasteUntil = 0;

// Formato en línea con conmutación: si la selección ya está envuelta en la
// marca, la quita; si no, la pone.
export function toggleInlineMark(view, mark) {
  const { state } = view;
  const sel = state.selection.main;
  const doc = state.doc;
  const L = mark.length;
  const nodeName = { '**': 'StrongEmphasis', '*': 'Emphasis', '~~': 'Strikethrough', '`': 'InlineCode' }[mark];
  // ¿Dentro de un nodo de ese tipo? → quitarlo.
  const tree = syntaxTree(state);
  for (let n = tree.resolveInner(sel.from, 1); n; n = n.parent) {
    if (n.name === nodeName) {
      const inner = formatInner(n, doc);
      if (inner && sel.from >= n.from && sel.to <= n.to) {
        view.dispatch({
          changes: [{ from: n.from, to: inner.innerFrom }, { from: inner.innerTo, to: n.to }],
          selection: { anchor: Math.max(n.from, sel.from - (inner.innerFrom - n.from)), head: Math.max(n.from, sel.to - (inner.innerFrom - n.from)) },
          userEvent: 'input.format',
        });
        return true;
      }
    }
    if (n.name === 'Paragraph') break;
  }
  if (sel.empty) {
    view.dispatch({ changes: { from: sel.from, insert: mark + mark }, selection: { anchor: sel.from + L }, userEvent: 'input.format' });
    return true;
  }
  // Recortar espacios de los bordes (Markdown no admite `** x**`).
  let a = sel.from, b = sel.to;
  while (a < b && /\s/.test(doc.sliceString(a, a + 1))) a++;
  while (b > a && /\s/.test(doc.sliceString(b - 1, b))) b--;
  if (a === b) return true;
  // Selección que cruza líneas: marcar cada línea por separado.
  const startLine = doc.lineAt(a), endLine = doc.lineAt(b);
  if (startLine.number !== endLine.number) {
    const changes = [];
    for (let n = startLine.number; n <= endLine.number; n++) {
      const ln = doc.line(n);
      let x = Math.max(ln.from + linePrefixLength(ln.text), n === startLine.number ? a : ln.from);
      let y = n === endLine.number ? b : ln.to;
      while (x < y && /\s/.test(doc.sliceString(x, x + 1))) x++;
      while (y > x && /\s/.test(doc.sliceString(y - 1, y))) y--;
      if (y > x) changes.push({ from: x, insert: mark }, { from: y, insert: mark });
    }
    view.dispatch({ changes, userEvent: 'input.format' });
    return true;
  }
  view.dispatch({
    changes: [{ from: a, insert: mark }, { from: b, insert: mark }],
    selection: { anchor: a + L, head: b + L },
    userEvent: 'input.format',
  });
  return true;
}

function makeKeymap() {
  const slashKey = (key) => (view) => (blockBus.slash ? blockBus.emit('slash:key', key) : false);
  return Prec.highest(keymap.of([
    { key: 'Backspace', run: blkBackspace },
    { key: 'Delete', run: blkDelete },
    { key: 'Enter', run: blkEnter },
    { key: 'Shift-Enter', run: softBreak },
    { key: 'ArrowDown', run: slashKey('ArrowDown') },
    { key: 'ArrowUp', run: slashKey('ArrowUp') },
    { key: 'Tab', run: slashKey('Tab') },
    { key: 'Escape', run: (view) => {
      if (blockBus.slash) return blockBus.emit('slash:key', 'Escape');
      return blockBus.emit('bubble:escape');
    } },
    { key: 'Alt-Shift-ArrowUp', run: (v) => moveCurrentBlock(v, -1), preventDefault: true },
    { key: 'Alt-Shift-ArrowDown', run: (v) => moveCurrentBlock(v, 1), preventDefault: true },
    { key: 'Mod-b', run: (v) => toggleInlineMark(v, '**'), preventDefault: true },
    { key: 'Mod-i', run: (v) => toggleInlineMark(v, '*'), preventDefault: true },
    { key: 'Mod-Shift-x', run: (v) => toggleInlineMark(v, '~~'), preventDefault: true },
    { key: 'Mod-e', run: (v) => toggleInlineMark(v, '`'), preventDefault: true },
    { key: 'Mod-Shift-v', run: () => { plainPasteUntil = Date.now() + 1500; return false; } },
    { key: 'Mod-a', run: selectTitleFirst },
  ]));
}

// Una selección que se lleva una sola de las dos marcas de un formato (p. ej.
// `**negr|ita** y m|ás` → borrar) borra también la otra: nunca `**` huérfanos.
function orphanMarkFilter() {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    if (!(tr.isUserEvent('delete') || tr.isUserEvent('input') || tr.isUserEvent('cut') || tr.isUserEvent('move.drop'))) return tr;
    if (tr.isUserEvent('input.format') || tr.isUserEvent('input.convert')) return tr;
    const start = tr.startState;
    const tree = syntaxTree(start);
    const doc = start.doc;
    const extra = [];
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (toA <= fromA) return;
      tree.iterate({
        from: fromA, to: toA,
        enter: (n) => {
          if (SKIP_NODES.has(n.name)) return false;
          if (!FORMAT_NODES.has(n.name) && n.name !== 'Link') return;
          const inner = formatInner(n.node, doc);
          if (!inner) return;
          const touch = (a, b) => fromA < b && toA > a;
          const openHit = touch(n.from, inner.innerFrom);
          const closeHit = touch(inner.innerTo, n.to);
          if (openHit === closeHit) return;
          extra.push([n.from, inner.innerFrom], [inner.innerTo, n.to]);
        },
      });
    });
    if (!extra.length) return tr;
    const changes = [];
    for (const [a, b] of extra) {
      const ma = tr.changes.mapPos(a, 1), mb = tr.changes.mapPos(b, -1);
      if (mb > ma) changes.push({ from: ma, to: mb });
    }
    if (!changes.length) return tr;
    return [tr, { changes, sequential: true }];
  });
}

// ── Menú «/» y barra flotante (detección; la UI está en BlockUI.jsx) ──────

function inCodeAt(state, pos) {
  for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'InlineCode' || n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'HTMLBlock' || n.name === 'CommentBlock') return true;
  }
  return false;
}

export function openSlashAt(view, from) {
  blockBus.slash = { view, from };
  emitSlash(view);
}

function emitSlash(view) {
  const s = blockBus.slash;
  if (!s || s.view !== view) return;
  const { state } = view;
  const head = state.selection.main.head;
  const ch = state.doc.sliceString(s.from, s.from + 1);
  const q = head > s.from ? state.doc.sliceString(s.from + 1, head) : null;
  if (ch !== '/' || q == null || q.length > 40 || /\n/.test(q) || / {2}/.test(q) || !state.selection.main.empty) {
    closeSlash();
    return;
  }
  // Medir fuera del ciclo de actualización (CodeMirror no deja leer el
  // layout durante un update).
  const from = s.from;
  view.requestMeasure({
    key: 'blk-slash',
    read: () => { try { return view.coordsAtPos(from); } catch { return null; } },
    write: (rect) => {
      if (!blockBus.slash || blockBus.slash.view !== view || blockBus.slash.from !== from) return;
      if (!rect) { closeSlash(); return; }
      blockBus.emit('slash:update', { view, from, query: q, rect: { left: rect.left, top: rect.top, bottom: rect.bottom } });
    },
  });
}

export function closeSlash() {
  if (!blockBus.slash) return;
  const view = blockBus.slash.view;
  blockBus.slash = null;
  blockBus.emit('slash:close');
  // Quitar el «Escribe para filtrar…» (vive en las decoraciones del plugin).
  setTimeout(() => { try { if (view && view.dom.isConnected) view.dispatch({ effects: slashClosedEffect.of(null) }); } catch {} }, 0);
}
const slashClosedEffect = StateEffect.define();

function makeInteractionPlugin(cfg) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      if (cfg.undoManager) undoManagers.set(view, cfg.undoManager);
      this.mouseDown = false;
      this.bubbleTimer = null;
      this.onMouseUp = () => {
        if (!this.mouseDown) return;
        this.mouseDown = false;
        this.scheduleBubble();
      };
      document.addEventListener('mouseup', this.onMouseUp, true);
      warmTurndown();
      this.decorations = Decoration.none;
    }
    slashPlaceholder(view) {
      const s = blockBus.slash;
      const head = view.state.selection.main.head;
      if (s && s.view === view && head === s.from + 1 && view.state.doc.sliceString(s.from, s.from + 1) === '/') {
        return Decoration.set([Decoration.widget({ widget: new PlaceholderWidget(t('blk.slash.filter'), 'slash'), side: 1 }).range(s.from + 1)]);
      }
      return Decoration.none;
    }
    scheduleBubble() {
      if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
      this.bubbleTimer = setTimeout(() => { this.bubbleTimer = null; this.emitBubble(); }, 60);
    }
    emitBubble() {
      const view = this.view;
      const sel = view.state.selection.main;
      if (cfg.readOnly || sel.empty || !view.hasFocus || this.mouseDown || blockBus.slash) {
        blockBus.emit('bubble', null);
        return;
      }
      let a = null, b = null;
      try { a = view.coordsAtPos(sel.from, 1); b = view.coordsAtPos(sel.to, -1); } catch {}
      if (!a || !b) { blockBus.emit('bubble', null); return; }
      blockBus.emit('bubble', {
        view, from: sel.from, to: sel.to,
        rect: { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), startLeft: a.left },
      });
    }
    update(u) {
      // «/» recién tecleado al principio de línea o tras un espacio.
      const had = !!blockBus.slash;
      if (u.docChanged && !cfg.readOnly && !blockBus.slash) {
        for (const tr of u.transactions) {
          if (!tr.isUserEvent('input.type')) continue;
          let typed = null;
          tr.changes.iterChanges((fA, tA, fB, tB, ins) => { if (ins.toString() === '/') typed = fB; });
          if (typed == null) continue;
          const state = u.state;
          if (state.selection.main.head !== typed + 1) continue;
          const before = typed > 0 ? state.doc.sliceString(typed - 1, typed) : '\n';
          if (!/[\s\n]/.test(before) && typed !== state.doc.lineAt(typed).from) continue;
          if (inCodeAt(state, typed)) continue;
          blockBus.slash = { view: u.view, from: typed };
          break;
        }
      }
      if (blockBus.slash && blockBus.slash.view === u.view) {
        if (u.docChanged && had) blockBus.slash.from = u.changes.mapPos(blockBus.slash.from, -1);
        if (u.docChanged || u.selectionSet || u.geometryChanged) emitSlash(u.view);
        if (u.focusChanged && !u.view.hasFocus) {
          // Clic en el menú: no robamos el foco (mousedown preventDefault);
          // cualquier otro blur lo cierra.
          setTimeout(() => { if (!u.view.hasFocus && !blockBus.menuOpen) closeSlash(); }, 120);
        }
      }
      if (u.selectionSet || u.focusChanged || u.docChanged) {
        if (this.mouseDown) blockBus.emit('bubble', null);
        else this.scheduleBubble();
      }
      this.decorations = this.slashPlaceholder(u.view);
    }
    destroy() {
      document.removeEventListener('mouseup', this.onMouseUp, true);
      if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
      if (blockBus.slash && blockBus.slash.view === this.view) closeSlash();
      blockBus.emit('bubble', null);
    }
  }, {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e) {
        if (e.button === 0) { this.mouseDown = true; blockBus.emit('bubble', null); }
        return false;
      },
    },
  });
}

// ── Asas de bloque: + y ⋮⋮ (arrastrar para mover) ─────────────────────────

function makeHandlesPlugin(cfg) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.block = null;
      this.drag = null;
      const box = document.createElement('div');
      box.className = 'cm-blk-handles';
      box.innerHTML = `<button type="button" class="cm-blk-plus" tabindex="-1" aria-label="${t('blk.handle.add')}" title="${t('blk.handle.addTip')}">${svg('plus', 15, 2)}</button>`
        + `<button type="button" class="cm-blk-grip" tabindex="-1" aria-label="${t('blk.handle.grip')}" title="${t('blk.handle.gripTip')}">${svg('grip')}</button>`;
      this.box = box;
      this.plus = box.firstChild;
      this.grip = box.lastChild;
      const ind = document.createElement('div');
      ind.className = 'cm-blk-dropline';
      this.ind = ind;
      view.dom.appendChild(box);
      view.dom.appendChild(ind);
      this.raf = 0;
      this.lastXY = null;
      this.onMove = (e) => {
        if (this.drag) return;
        this.lastXY = { x: e.clientX, y: e.clientY };
        if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.track(); });
      };
      window.addEventListener('mousemove', this.onMove, { passive: true });
      this.plus.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.addBelow(e.altKey); });
      this.grip.addEventListener('mousedown', (e) => this.startDrag(e));
      this.onScroll = () => { if (this.block) this.place(this.block); };
      window.addEventListener('scroll', this.onScroll, true);
    }
    handleBlocks() { return getBlocks(this.view.state).filter(isHandleBlock); }
    track() {
      const view = this.view;
      if (cfg.readOnly || !this.lastXY || !view.dom.isConnected) return this.hide();
      if (blockBus.menuOpen) return; // con un menú abierto el asa se queda quieta
      const { x, y } = this.lastXY;
      const r = view.contentDOM.getBoundingClientRect();
      if (y < r.top || y > r.bottom || x < r.left - 72 || x > r.right + 24) return this.hide();
      const blk = this.blockAtY(y);
      if (!blk) return this.hide();
      this.block = blk;
      this.place(blk);
    }
    blockAtY(y) {
      const view = this.view;
      let lb;
      try { lb = view.lineBlockAtHeight(y - view.documentTop); } catch { return null; }
      if (!lb) return null;
      const res = blockAt(view.state, lb.from);
      // Un desplegable es un único bloque (con su contenido dentro).
      const blk = res && res.block;
      return blk && isHandleBlock(blk) ? blk : null;
    }
    place(blk) {
      const view = this.view;
      let lb;
      try { lb = view.lineBlockAt(blk.from); } catch { return this.hide(); }
      const domRect = view.dom.getBoundingClientRect();
      // Centrado en la primera línea de TEXTO del bloque (los títulos llevan
      // relleno arriba; las tablas/código son un widget: su parte superior).
      let midY;
      const textPos = Math.min(blk.to, view.state.doc.lineAt(blk.from).from + linePrefixLength(view.state.doc.lineAt(blk.from).text));
      const c = (blk.type === 'table' || blk.type === 'code' || blk.type === 'hr') ? null : view.coordsAtPos(textPos, 1);
      if (c) midY = (c.top + c.bottom) / 2 - domRect.top;
      else midY = lb.top + view.documentTop - domRect.top + Math.min(lb.height, 30) / 2;
      const contentLeft = view.contentDOM.getBoundingClientRect().left - domRect.left;
      this.box.style.transform = `translate(${Math.round(contentLeft - 52)}px, ${Math.round(midY - 13)}px)`;
      this.box.classList.add('on');
    }
    hide() {
      if (this.drag) return;
      this.block = null;
      this.box.classList.remove('on');
    }
    addBelow(above) {
      const view = this.view;
      const blk = this.block;
      if (!blk) return;
      const doc = view.state.doc;
      let at, insert, caret;
      if (above) {
        at = blk.from; insert = '/\n\n'; caret = at + 1;
      } else {
        at = blk.to; insert = '\n\n/'; caret = at + insert.length;
        // Un párrafo vacío justo debajo: reutilizarlo.
        const ln = doc.lineAt(blk.to);
        if (ln.number + 2 <= doc.lines && !doc.line(ln.number + 1).text.trim() && !doc.line(ln.number + 2).text.trim()) {
          at = doc.line(ln.number + 2).from; insert = '/'; caret = at + 1;
        }
      }
      view.dispatch({ changes: { from: at, insert }, selection: { anchor: caret }, userEvent: 'input.type.block', scrollIntoView: true });
      view.focus();
      openSlashAt(view, caret - 1);
    }
    startDrag(e) {
      if (e.button !== 0 || !this.block) return;
      e.preventDefault();
      e.stopPropagation();
      const view = this.view;
      const blocks = this.handleBlocks();
      const index = blocks.findIndex(b => b.from === this.block.from);
      if (index < 0) return;
      // Si el bloque agarrado está dentro de una selección de varios bloques,
      // se arrastran todos.
      let first = index, count = 1;
      const range = view.state.selection.main.empty ? null : selectedBlockRange(view.state, blocks);
      if (range && range.n > 1 && index >= range.i && index < range.i + range.n) { first = range.i; count = range.n; }
      const allList = blocks.slice(first, first + count).every(b => b.type === 'bullet' || b.type === 'ordered' || b.type === 'task');
      this.drag = { index: first, count, allList, startX: e.clientX, startY: e.clientY, moved: false, target: null, child: false, block: this.block };
      const onMove = (ev) => {
        const d = this.drag;
        if (!d) return;
        if (!d.moved && Math.abs(ev.clientY - d.startY) < 4 && Math.abs(ev.clientX - d.startX) < 4) return;
        d.moved = true;
        this.box.classList.add('dragging');
        view.dom.classList.add('cm-blk-dragging');
        d.target = this.dropTarget(ev.clientY, blocks);
        // Arrastrar a la derecha (>40 px) sobre un elemento de lista = anidar
        // debajo del elemento de encima.
        const above = blocks[d.target - 1];
        d.child = d.allList && ev.clientX - d.startX > 40 && !!above
          && (above.type === 'bullet' || above.type === 'ordered' || above.type === 'task')
          && !(d.target - 1 >= d.index && d.target - 1 < d.index + d.count);
        this.showDropLine(d.target, blocks, d.child);
        autoScroll(view, ev.clientY);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        const d = this.drag;
        this.drag = null;
        this.box.classList.remove('dragging');
        view.dom.classList.remove('cm-blk-dragging');
        this.ind.classList.remove('on', 'child');
        if (!d) return;
        if (!d.moved) {
          blockBus.emit('block:menu', { view, block: d.block, index: d.index, rect: this.grip.getBoundingClientRect() });
          return;
        }
        if (d.target != null) blockStep(view, () => dispatchMove(view, d.index, d.target, 'move.block', d.count, d.child));
        view.focus();
      };
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    }
    dropTarget(y, blocks) {
      const view = this.view;
      for (let j = 0; j < blocks.length; j++) {
        let lb;
        try { lb = view.lineBlockAt(blocks[j].from); } catch { continue; }
        const top = lb.top + view.documentTop;
        let bottom;
        try { const le = view.lineBlockAt(blocks[j].to); bottom = le.bottom + view.documentTop; } catch { bottom = top + lb.height; }
        if (y < (top + bottom) / 2) return j;
      }
      return blocks.length;
    }
    showDropLine(j, blocks, child = false) {
      const view = this.view;
      const domRect = view.dom.getBoundingClientRect();
      let y;
      try {
        if (j < blocks.length) y = view.lineBlockAt(blocks[j].from).top + view.documentTop - domRect.top - 3;
        else y = view.lineBlockAt(blocks[blocks.length - 1].to).bottom + view.documentTop - domRect.top + 2;
      } catch { return; }
      const contentRect = view.contentDOM.getBoundingClientRect();
      const indent = child ? 28 : 0;
      this.ind.style.transform = `translate(${Math.round(contentRect.left - domRect.left + indent)}px, ${Math.round(y)}px)`;
      this.ind.style.width = Math.round(contentRect.width - indent) + 'px';
      this.ind.classList.add('on');
      this.ind.classList.toggle('child', child);
    }
    update(u) {
      if (this.block && (u.docChanged || u.geometryChanged)) {
        // El bloque puede haberse movido: esconder y recolocar con el ratón
        // (no se puede medir el layout dentro de un update).
        if (u.docChanged) { this.block = null; this.hide(); }
        else if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.block) this.place(this.block); });
      }
    }
    destroy() {
      window.removeEventListener('mousemove', this.onMove);
      window.removeEventListener('scroll', this.onScroll, true);
      if (this.raf) cancelAnimationFrame(this.raf);
      this.box.remove();
      this.ind.remove();
    }
  });
}

function autoScroll(view, y) {
  let el = view.dom.parentElement;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) return;
  const r = el.getBoundingClientRect();
  if (y < r.top + 48) el.scrollTop -= 14;
  else if (y > r.bottom - 48) el.scrollTop += 14;
}

// ── Pegar ────────────────────────────────────────────────────────────────

function pasteHandler(cfg) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (cfg.readOnly) return false;
      const cd = event.clipboardData;
      if (!cd) return false;
      if (event.target && event.target.closest && event.target.closest('.cm-lp-block, .cm-lp-inline')) return false;
      // Ficheros/imágenes: el manejador de siempre (adjuntos).
      if ((cd.files && cd.files.length) || Array.from(cd.items || []).some(i => i.kind === 'file')) return false;
      const plain = cd.getData('text/plain');
      if (Date.now() < plainPasteUntil) {
        plainPasteUntil = 0;
        if (!plain) return false;
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(plain), { userEvent: 'input.paste', scrollIntoView: true });
        return true;
      }
      const html = cd.getData('text/html');
      if (!html || !htmlWorthConverting(html)) return false;
      if (inCodeAt(view.state, view.state.selection.main.from)) return false;
      event.preventDefault();
      htmlToMarkdown(html).then((md) => {
        const text = md || plain || '';
        if (!text) return;
        const sel = view.state.selection.main;
        // Bloques (títulos, listas, tablas) pegados a mitad de párrafo: a una
        // línea nueva para que Markdown los reconozca.
        const line = view.state.doc.lineAt(sel.from);
        const blocky = /\n/.test(text) || /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```)/.test(text);
        const needsBreak = blocky && sel.from > line.from + linePrefixLength(line.text) && line.text.trim() !== '';
        const insert = (needsBreak ? '\n\n' : '') + text;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert },
          selection: { anchor: sel.from + insert.length },
          userEvent: 'input.paste', scrollIntoView: true,
        });
      }).catch((err) => {
        console.warn('[blocks] html→md', err);
        if (plain) view.dispatch(view.state.replaceSelection(plain), { userEvent: 'input.paste' });
      });
      return true;
    },
  });
}

// ── Ensamblado ───────────────────────────────────────────────────────────

// cfg: { getRenderMd, renderHtml(renderMd, src), RenderWidget, TaskWidget,
//        ctxRef, readOnly }
export function blockEditorExtensions(cfg) {
  const conf = { ...cfg, RenderWidget: makeRenderWidgetClass(cfg.RenderWidget) };
  const field = makeBlockField(conf);
  return [
    field,
    makeBlockRebuildScheduler(field),
    makeInlinePlugin(conf),
    codeFolding({ placeholderDOM: () => { const s = document.createElement('span'); s.className = 'cm-blk-foldph'; return s; } }),
    ...(conf.readOnly ? [] : [makeKeymap(), renumberLists, orphanMarkFilter(), widgetEdgeFilter(), headingSelectFilter(), pasteHandler(conf), makeInteractionPlugin(conf), makeHandlesPlugin(conf)]),
    EditorView.editorAttributes.of({ class: 'cm-blk-editor' }),
  ];
}

export { setPageMeta as blockPageMeta };
