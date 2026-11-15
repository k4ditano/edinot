// Capa React del editor de bloques: menú «/», menú de bloque (⋮⋮), barra
// flotante sobre la selección, enlaces, «Preguntar a la IA», icono de la
// página y popovers de propiedades. Escucha `blockBus` (lo alimentan las
// extensiones de CodeMirror y la cabecera de Leer) y actúa sobre el
// EditorView con transacciones normales (y-codemirror → UndoManager).
//
// Se monta UNA vez en EdinotApp; las acciones de la app (insertar base de
// datos, imagen, canvas, evento, formulario, plantilla, comentar, IA,
// icono, propiedades) llegan por `actions` — no se duplica su lógica.

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { startCompletion } from '@codemirror/autocomplete';
import { t, useI18n } from '../../i18n.js';
import { perfCountRender } from '../../perf.js';
import { Menu } from '../../ui/shell/Menu.jsx';
import { clampLeft, noteSpan, MIN_FLOAT_WIDTH } from '../../ui/shared/floatBounds.js';
import { EMOJI_FILE_SET } from '../../ui/shared/emoji.js';
import { blockBus } from './bus.js';
import { COVER_GRADIENTS, COVER_COLORS, coverCss } from './cover.js';
import { svg } from './icons.js';
import {
  getBlocks, isHandleBlock, blockAt, convertBlock, duplicateBlock, deleteBlock, dispatchMove,
  blockSnippet, needsBlankBefore, linePrefixLength, CALLOUT_TYPES, CALLOUT_RE,
} from './model.js';
import { closeSlash, toggleInlineMark, focusCodeWidgetAt, blockStep } from './livePreview.js';
import { linkedFence } from '../db/linked.jsx';
import {
  parseProps, inferType, parseTypes, serializeTypes, typeNeedsHint, isTruthy, splitTags,
  PROP_TYPES, TYPES_KEY, TYPE_ICON, visibleEntries, tagsKey,
} from './props.js';

const Svg = ({ name, size = 16, stroke }) => (
  <span className="blk-svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg(name, size, stroke) }} />
);

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Puntuación difusa: prefijo > inicio de palabra > subcadena > subsecuencia.
function fuzzyScore(text, q) {
  if (!q) return 1;
  const s = fold(text);
  if (s.startsWith(q)) return 100 - s.length * 0.01;
  const words = s.split(/[\s/-]+/);
  if (words.some(w => w.startsWith(q))) return 80;
  const i = s.indexOf(q);
  if (i >= 0) return 60 - i;
  let p = 0;
  for (const ch of q) { p = s.indexOf(ch, p); if (p < 0) return 0; p++; }
  return 20;
}

const CONVERT_KINDS = [
  ['text', 'text'], ['h1', null], ['h2', null], ['h3', null], ['bullet', 'list'], ['ordered', 'olist'],
  ['task', 'task'], ['quote', 'quote'], ['callout', 'callout'], ['code', 'code'], ['toggle', 'toggle'],
];

function KindIcon({ kind }) {
  if (kind === 'h1' || kind === 'h2' || kind === 'h3') return <span className="blk-kind-h">{kind.toUpperCase()}</span>;
  const map = { text: 'text', bullet: 'list', ordered: 'olist', task: 'task', quote: 'quote', callout: 'callout', code: 'code', toggle: 'toggle', hr: 'hr' };
  return <Svg name={map[kind] || kind} />;
}

function todayLabel() {
  try { return new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return new Date().toISOString().slice(0, 10); }
}

// ── Inserción de bloques desde el menú «/» ───────────────────────────────
// Quita «/consulta» y convierte la línea (si queda vacía) o crea un bloque
// nuevo debajo. Todo en una transacción.
function insertBlockKind(view, from, to, kind) {
  const state = view.state;
  const doc = state.doc;
  const line = doc.lineAt(from);
  const before = doc.sliceString(line.from, from);
  const after = doc.sliceString(to, line.to);
  const snip = blockSnippet(kind);
  if (!snip) return;
  const contentEmpty = !(before.slice(linePrefixLength(before)) + after).trim();
  let changes, anchor;
  if (contentEmpty) {
    let text = snip.text;
    let caret = snip.caret;
    if (kind === 'text') { text = ''; caret = 0; }
    let pre = '';
    if ((kind === 'hr' || kind === 'code' || kind === 'toggle') && needsBlankBefore(doc, line.number)) pre = '\n';
    // Separador al final del documento: deja una línea para seguir escribiendo.
    changes = { from: line.from, to: line.to, insert: pre + text };
    anchor = line.from + pre.length + caret;
  } else {
    const body = doc.sliceString(line.from, from) + doc.sliceString(to, line.to);
    const insert = body + '\n\n' + (kind === 'text' ? '' : snip.text);
    changes = { from: line.from, to: line.to, insert };
    anchor = line.from + body.length + 2 + (kind === 'text' ? 0 : snip.caret);
  }
  view.dispatch({ changes, selection: { anchor }, userEvent: 'input.block', scrollIntoView: true });
  view.focus();
  if (kind === 'code') focusCodeWidgetAt(view, anchor - 4);
}

function insertTextBlock(view, from, to, markdown) {
  // Bloque de texto multilínea (p. ej. base de datos): en su propia línea con
  // líneas en blanco alrededor.
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const rest = (doc.sliceString(line.from, from) + doc.sliceString(to, line.to));
  const restEmpty = !rest.slice(linePrefixLength(rest)).trim();
  const pre = restEmpty ? (needsBlankBefore(doc, line.number) ? '\n' : '') : rest + '\n\n';
  const nextLine = line.number < doc.lines ? doc.line(line.number + 1) : null;
  const post = nextLine && nextLine.text.trim() ? '\n\n' : '\n';
  const insert = pre + markdown + post;
  view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, userEvent: 'input.block', scrollIntoView: true });
  view.focus();
}

function removeSlash(view, from, to) {
  if (to > from) view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: 'input.slash' });
}

// ── Componente ───────────────────────────────────────────────────────────

// memo: EdinotApp re-renders on every content bump while typing; las
// acciones llegan como proxy estable (se leen al usarlas).
export const BlockUI = memo(function BlockUI({ getView, actions, readOnly }) {
  perfCountRender('BlockUI');
  useI18n();
  const [slash, setSlash] = useState(null); // { from, query, rect }
  const [slashSel, setSlashSel] = useState(0);
  const [bubble, setBubble] = useState(null); // { from, to, rect }
  const bubbleRef = useRef(null);
  bubbleRef.current = bubble;
  const [menu, setMenu] = useState(null); // { anchor, items, label }
  const [pop, setPop] = useState(null); // { kind: 'link'|'emoji'|'icon'|'prop'|'addProp', … }
  const fileRef = useRef(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const A = () => actionsRef.current || {};

  useEffect(() => { blockBus.menuOpen = !!(menu || pop); }, [menu, pop]);

  // ── Ítems del menú «/» ─────────────────────────────────────────────────
  const items = useMemo(() => {
    const blk = (kind, icon, kw, kbd) => ({
      id: kind, group: 'blocks', icon, label: t('blk.it.' + kind), hint: t('blk.it.' + kind + '.hint'), kw, kbd,
      run: (view, from, to) => insertBlockKind(view, from, to, kind),
    });
    const ins = (id, icon, kw, run) => ({ id, group: 'insert', icon, label: t('blk.it.' + id), hint: t('blk.it.' + id + '.hint'), kw, run });
    return [
      blk('text', 'text', 'texto text parrafo paragraph p', ''),
      blk('h1', 'h1', 'titulo heading h1 encabezado', '#'),
      blk('h2', 'h2', 'titulo heading h2 subtitulo', '##'),
      blk('h3', 'h3', 'titulo heading h3', '###'),
      blk('bullet', 'list', 'lista vinetas bullet ul unordered', '-'),
      blk('ordered', 'olist', 'lista numerada numbered ol ordered', '1.'),
      blk('task', 'task', 'tareas todo checklist casilla checkbox', '[]'),
      blk('toggle', 'toggle', 'desplegable toggle details plegable acordeon', '>'),
      blk('callout', 'callout', 'aviso callout nota note tip consejo warning', '!'),
      blk('quote', 'quote', 'cita quote blockquote', '"'),
      blk('code', 'code', 'codigo code snippet fence', '```'),
      blk('hr', 'hr', 'separador divider hr linea rule', '---'),
      ins('db', 'database', 'base de datos database tabla table kanban tablero galeria', (view, from, to) => {
        const md = A().buildDatabaseMarkdown ? A().buildDatabaseMarkdown() : null;
        if (md) insertTextBlock(view, from, to, md); else removeSlash(view, from, to);
      }),
      // Vista enlazada: una tabla de otra nota, con su propia vista; los
      // datos siguen viviendo (y se editan) en la nota de origen.
      ins('dbLinked', 'link', 'vista enlazada linked view base de datos database tabla table otra nota', (view, from, to, rect) => {
        removeSlash(view, from, to);
        const here = A().noteId;
        const dbs = (A().databases || []).filter(d => d.noteId !== here)
          .slice().sort((a, b) => a.title.localeCompare(b.title) || a.note.localeCompare(b.note));
        setMenu({
          anchor: rect, label: t('blk.it.dbLinked'),
          items: dbs.length
            ? dbs.slice(0, 60).map(d => ({
              label: d.title, hint: d.sub || undefined, icon: 'database',
              onSelect: () => {
                insertTextBlock(view, from, from, linkedFence({ note: d.noteId, t: d.idx, sig: d.headers.join('|') }));
                view.focus();
              },
            }))
            : [{ label: t('blk.it.dbLinked.none'), disabled: true }],
        });
      }),
      ins('image', 'image', 'imagen image foto picture', (view, from, to) => { removeSlash(view, from, to); A().openImagePicker && A().openImagePicker(); }),
      ins('file', 'attach', 'archivo file adjunto attachment pdf', (view, from, to) => { removeSlash(view, from, to); fileRef.current && fileRef.current.click(); }),
      ins('canvas', 'canvas', 'canvas pizarra whiteboard dibujo', (view, from, to, rect) => {
        removeSlash(view, from, to);
        const canv = (A().canvases || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setMenu({
          anchor: rect, label: t('blk.it.canvas'),
          items: [
            { label: t('blk.it.canvas.new'), icon: 'plus', onSelect: () => A().createCanvasEmbed && A().createCanvasEmbed() },
            ...(canv.length ? [{ type: 'sep' }] : []),
            ...canv.slice(0, 40).map(c => ({ label: (c.name || '').replace(/\.(md|markdown|txt)$/i, ''), icon: 'canvas', onSelect: () => A().embedCanvas && A().embedCanvas(c.id) })),
          ],
        });
      }),
      // Evento: token en línea «⏰ AAAA-MM-DD HH:MM» (la próxima hora en punto)
      // con la fecha seleccionada para reescribirla. Sale en el calendario
      // como cualquier fecha de nota, sin sacar al usuario de la nota (el
      // Calendario ya es una página, no un modal).
      ins('event', 'event', 'evento event recordatorio reminder calendario fecha', (view, from, to) => {
        const dt = new Date(Date.now() + 60 * 60 * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        const date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        const before = from > 0 ? view.state.doc.sliceString(from - 1, from) : '';
        const lead = before && !/\s/.test(before) ? ' ' : '';
        const token = `${lead}⏰ ${date} ${pad(dt.getHours())}:00`;
        const start = from + lead.length + 2;
        view.dispatch({ changes: { from, to, insert: token }, selection: { anchor: start, head: start + date.length }, userEvent: 'input.type' });
        view.focus();
      }),
      ins('form', 'form', 'formulario form encuesta survey', (view, from, to) => { removeSlash(view, from, to); A().openFormBuilder && A().openFormBuilder(); }),
      ins('link', 'link', 'enlace nota link note wikilink mencion', (view, from, to) => {
        view.dispatch({ changes: { from, to, insert: '[[' }, selection: { anchor: from + 2 }, userEvent: 'input.type' });
        view.focus();
        setTimeout(() => startCompletion(view), 0);
      }),
      ins('template', 'template', 'plantilla template', (view, from, to, rect) => {
        removeSlash(view, from, to);
        const tpls = A().templates || [];
        setMenu({
          anchor: rect, label: t('blk.it.template'),
          items: tpls.length
            ? tpls.map(tp => ({ label: (tp.name || '').replace(/\.(md|markdown|txt)$/i, ''), icon: 'template', onSelect: () => A().insertTemplate && A().insertTemplate(tp) }))
            : [{ label: t('blk.it.template.none'), disabled: true }],
        });
      }),
      ins('emoji', 'emoji', 'emoji emoticono icono', (view, from, to, rect) => {
        removeSlash(view, from, to);
        setPop({ kind: 'emoji', rect });
      }),
      ins('today', 'date', 'fecha hoy today date dia', (view, from, to) => {
        const s = todayLabel();
        view.dispatch({ changes: { from, to, insert: s }, selection: { anchor: from + s.length }, userEvent: 'input.type' });
        view.focus();
      }),
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t('blk.it.text')]);

  const filtered = useMemo(() => {
    if (!slash) return [];
    const q = fold(slash.query.trim());
    if (!q) return items;
    return items
      .map(it => ({ it, s: Math.max(fuzzyScore(it.label, q), fuzzyScore(it.kw, q) * 0.9, it.kbd && q === fold(it.kbd) ? 120 : 0) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.it);
  }, [slash && slash.query, items]);

  const runSlashItem = useCallback((it) => {
    const view = getView();
    const s = blockBus.slash;
    if (!view || !s || !it) { closeSlash(); return; }
    const from = s.from;
    const to = view.state.selection.main.head;
    const rect = slash && slash.rect;
    closeSlash();
    try { it.run(view, from, Math.max(from + 1, to), rect); } catch (err) { console.warn('[blocks] slash', err); }
  }, [getView, slash]);

  // Bus: «/»
  useEffect(() => {
    const offU = blockBus.on('slash:update', (p) => {
      setSlash(prev => {
        if (!prev || prev.query !== p.query) setSlashSel(0);
        return { from: p.from, query: p.query, rect: p.rect };
      });
      setBubble(null);
    });
    const offC = blockBus.on('slash:close', () => setSlash(null));
    return () => { offU(); offC(); };
  }, []);

  const filteredRef = useRef(filtered); filteredRef.current = filtered;
  const selRef = useRef(slashSel); selRef.current = slashSel;
  const runRef = useRef(runSlashItem); runRef.current = runSlashItem;
  useEffect(() => blockBus.on('slash:key', (key) => {
    const list = filteredRef.current;
    if (key === 'Escape') { closeSlash(); return true; }
    if (!list.length) { if (key === 'Enter' || key === 'Tab') { closeSlash(); return false; } return false; }
    if (key === 'ArrowDown') { setSlashSel(i => (i + 1) % list.length); return true; }
    if (key === 'ArrowUp') { setSlashSel(i => (i - 1 + list.length) % list.length); return true; }
    if (key === 'Enter' || key === 'Tab') { runRef.current(list[Math.min(selRef.current, list.length - 1)]); return true; }
    return false;
  }), []);

  // Bus: barra flotante, menú de bloque, cabecera
  useEffect(() => {
    const offs = [
      blockBus.on('bubble', (p) => setBubble(p ? { from: p.from, to: p.to, rect: p.rect } : null)),
      blockBus.on('bubble:escape', () => {
        if (!bubbleRef.current) return false;
        setBubble(null);
        return true;
      }),
      blockBus.on('block:menu', (p) => openBlockMenu(p)),
      blockBus.on('callout:menu', (p) => openCalloutMenu(p)),
      blockBus.on('icon:pick', (p) => setPop({ kind: 'icon', rect: p.rect })),
      blockBus.on('cover:menu', (p) => {
        if (p.action === 'remove') { A().setCover && A().setCover(null); return; }
        // «Añadir portada»: degradado al azar (como Notion); luego se cambia.
        if (p.action === 'add') { A().setCover && A().setCover('g:' + Math.floor(Math.random() * 1e6)); return; }
        setPop({ kind: 'cover', rect: p.rect });
      }),
      blockBus.on('props:add', (p) => setPop({ kind: 'addProp', rect: p.rect })),
      blockBus.on('props:edit', (p) => openPropEditor(p.key, p.rect)),
      blockBus.on('tags:add', (p) => setPop({ kind: 'addTag', rect: p.rect })),
      blockBus.on('tags:remove', (p) => writeTags(list => list.filter(x => x.toLowerCase() !== String(p.tag || '').toLowerCase()))),
      blockBus.on('tags:open', (p) => A().openTag && A().openTag(p.tag)),
    ];
    return () => offs.forEach(f => f());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refocus = () => { const v = getView(); if (v) setTimeout(() => v.focus(), 0); };

  // ── Menú de bloque ─────────────────────────────────────────────────────
  const convertItems = (view, block) => CONVERT_KINDS.map(([kind]) => ({
    label: t('blk.it.' + kind), icon: <KindIcon kind={kind} />,
    onSelect: () => { const b = freshBlock(view, block); if (b) blockStep(view, () => convertBlock(view, b, kind)); refocus(); },
  }));

  function freshBlock(view, block) {
    const r = blockAt(view.state, Math.min(block.from, view.state.doc.length));
    return r && r.block && isHandleBlock(r.block) ? r.block : null;
  }

  function openBlockMenu({ view, block, rect }) {
    if (!view || !block) return;
    const blocks = getBlocks(view.state).filter(isHandleBlock);
    const idx = blocks.findIndex(b => b.from === block.from);
    const text = view.state.doc.sliceString(block.from, block.to);
    const convertible = !['table', 'hr', 'image', 'html'].includes(block.type);
    setMenu({
      anchor: { x: rect.left, y: rect.bottom + 4 }, label: t('blk.handle.grip'),
      items: [
        ...(convertible ? [{ label: t('blk.menu.convert'), icon: <Svg name="convert" />, submenu: () => convertItems(view, block) }, { type: 'sep' }] : []),
        { label: t('blk.menu.duplicate'), icon: 'copy', onSelect: () => { const b = freshBlock(view, block); if (b) blockStep(view, () => duplicateBlock(view, b)); refocus(); } },
        { label: t('blk.menu.up'), icon: <Svg name="up" />, kbd: 'Alt ⇧ ↑', disabled: idx <= 0, onSelect: () => { blockStep(view, () => dispatchMove(view, idx, idx - 1)); refocus(); } },
        { label: t('blk.menu.down'), icon: <Svg name="down" />, kbd: 'Alt ⇧ ↓', disabled: idx < 0 || idx >= blocks.length - 1, onSelect: () => { blockStep(view, () => dispatchMove(view, idx, idx + 2)); refocus(); } },
        { type: 'sep' },
        ...(A().commentOn ? [{ label: t('blk.menu.comment'), icon: 'comment', onSelect: () => A().commentOn(stripMd(text)) }] : []),
        { type: 'sep' },
        { label: t('blk.menu.delete'), icon: 'trash', danger: true, onSelect: () => { const b = freshBlock(view, block); if (b) blockStep(view, () => deleteBlock(view, b)); refocus(); } },
      ],
    });
  }

  function openCalloutMenu({ view, pos, rect }) {
    setMenu({
      anchor: { x: rect.left, y: rect.bottom + 4 }, label: t('blk.callout.change'),
      items: CALLOUT_TYPES.map(k => ({
        label: t('blk.callout.' + k), icon: <span className={`blk-callout-dot c-${k}`} dangerouslySetInnerHTML={{ __html: svg('c-' + k, 15, 1.8) }} />,
        onSelect: () => {
          const line = view.state.doc.lineAt(pos);
          const m = CALLOUT_RE.exec(line.text);
          if (!m) return;
          const a = line.from + m[1].length, b = a + m[0].length - m[1].length;
          view.dispatch({ changes: { from: a, to: b, insert: `[!${k}] ` }, userEvent: 'input.callout' });
          refocus();
        },
      })),
    });
  }

  // ── Propiedades ────────────────────────────────────────────────────────
  function readProps() {
    const src = A().getContent ? A().getContent() : '';
    return parseProps(src).props;
  }
  function openPropEditor(key, rect) {
    const props = readProps();
    const types = parseTypes(props);
    const type = inferType(key, props[key], types);
    if (type === 'checkbox') {
      // Casilla: clic = conmutar, sin popover.
      writeProp(key, isTruthy(props[key]) ? 'false' : 'true', type);
      return;
    }
    setPop({ kind: 'prop', key, type, value: props[key] || '', rect, isNew: false });
  }
  function writeProp(key, value, type, { rename = null, remove = false } = {}) {
    if (!A().setProps) return;
    A().setProps((props) => {
      const next = { ...props };
      const types = parseTypes(props);
      const finalKey = rename && rename !== key ? rename : key;
      if (rename && rename !== key) { delete next[key]; delete types[key]; }
      if (remove) { delete next[finalKey]; delete types[finalKey]; }
      else {
        next[finalKey] = value;
        if (type && typeNeedsHint(finalKey, value, type)) types[finalKey] = type; else delete types[finalKey];
      }
      const ts = serializeTypes(types);
      if (ts) next[TYPES_KEY] = ts; else delete next[TYPES_KEY];
      // `_types` siempre al final.
      if (next[TYPES_KEY]) { const v = next[TYPES_KEY]; delete next[TYPES_KEY]; next[TYPES_KEY] = v; }
      return next;
    });
  }

  // Etiquetas de la nota: la propiedad de tipo «tags» (o una nueva «tags»).
  function writeTags(fn) {
    if (!A().setProps) return;
    A().setProps((props) => {
      const key = tagsKey(props) || 'tags';
      const next = { ...props };
      const list = fn(splitTags(props[key]));
      if (list.length) next[key] = list.join(', '); else delete next[key];
      if (next[TYPES_KEY]) { const v = next[TYPES_KEY]; delete next[TYPES_KEY]; next[TYPES_KEY] = v; }
      return next;
    });
  }

  // ── Barra flotante: acciones ───────────────────────────────────────────
  const bubbleView = () => { const v = getView(); return v && bubble ? v : null; };
  const doMark = (mark) => { const v = bubbleView(); if (v) { toggleInlineMark(v, mark); v.focus(); } };
  const selectedText = () => { const v = getView(); if (!v) return ''; const s = v.state.selection.main; return v.state.doc.sliceString(s.from, s.to); };

  const openTurnInto = (rect) => {
    const v = bubbleView();
    if (!v) return;
    const r = blockAt(v.state, v.state.selection.main.from);
    const block = r && r.block;
    if (!block || !isHandleBlock(block)) return;
    setMenu({ anchor: { x: rect.left, y: rect.bottom + 6 }, label: t('blk.menu.convert'), items: convertItems(v, block) });
  };

  if (readOnly) return null;

  return createPortal(
    <>
      {slash && (
        <SlashMenu slash={slash} items={filtered} sel={Math.min(slashSel, Math.max(0, filtered.length - 1))}
          onHover={setSlashSel} onPick={runSlashItem} />
      )}
      {bubble && !slash && !menu && !pop && (
        <Bubble rect={bubble.rect}
          onTurn={openTurnInto}
          onBold={() => doMark('**')} onItalic={() => doMark('*')} onStrike={() => doMark('~~')} onCode={() => doMark('`')}
          onLink={(rect) => setPop({ kind: 'link', rect, from: bubble.from, to: bubble.to })}
          onComment={A().commentOn ? () => { const txt = selectedText(); setBubble(null); A().commentOn(stripMd(txt)); } : null}
          onExtract={A().extractToNote ? () => {
            // Extraer a nota nueva: líneas completas si la selección abarca
            // varias; el fragmento se sustituye por [[Nota]].
            const v = getView(); if (!v) return;
            const sel = v.state.selection.main;
            const a = v.state.doc.lineAt(sel.from), b = v.state.doc.lineAt(sel.to);
            const multi = a.number !== b.number;
            const from = multi ? a.from : sel.from, to = multi ? b.to : sel.to;
            const text = v.state.doc.sliceString(from, to);
            const name = A().extractToNote(text);
            setBubble(null);
            if (!name) return;
            const link = `[[${name}]]`;
            v.dispatch({ changes: { from, to, insert: link }, selection: { anchor: from + link.length }, userEvent: 'input.extract' });
            v.focus();
          } : null}
          onToDb={A().linesToDatabase ? () => {
            // Lista / párrafos seleccionados → base de datos (tabla tipada).
            const v = getView(); if (!v) return;
            const sel = v.state.selection.main;
            const a = v.state.doc.lineAt(sel.from), b = v.state.doc.lineAt(sel.to);
            const md = A().linesToDatabase(v.state.doc.sliceString(a.from, b.to));
            setBubble(null);
            if (!md) return;
            v.dispatch({ changes: { from: a.from, to: b.to, insert: md }, selection: { anchor: a.from }, userEvent: 'input.convert', scrollIntoView: true });
            v.focus();
          } : null} />
      )}
      {menu && <Menu anchor={menu.anchor} items={menu.items} label={menu.label} onClose={() => { setMenu(null); refocus(); }} />}
      {pop && pop.kind === 'link' && (
        <LinkPopover rect={pop.rect} getView={getView} from={pop.from} to={pop.to} noteNames={A().noteNames}
          onClose={() => { setPop(null); refocus(); }} />
      )}
      {pop && (pop.kind === 'emoji' || pop.kind === 'icon') && (
        <EmojiPop rect={pop.rect} canRemove={pop.kind === 'icon' && !!A().icon}
          onPick={(e) => {
            if (pop.kind === 'icon') { A().setIcon && A().setIcon(e); setPop(null); return; }
            const v = getView();
            if (v) { const s = v.state.selection.main; v.dispatch({ changes: { from: s.from, to: s.to, insert: e }, selection: { anchor: s.from + e.length }, userEvent: 'input.type' }); }
            setPop(null); refocus();
          }}
          onRemove={() => { A().setIcon && A().setIcon(null); setPop(null); }}
          onClose={() => { setPop(null); refocus(); }} />
      )}
      {pop && pop.kind === 'cover' && (
        <CoverPop rect={pop.rect} current={A().cover}
          onPick={(v) => { A().setCover && A().setCover(v); setPop(null); }}
          onUpload={(f) => { A().uploadCover && A().uploadCover(f); setPop(null); }}
          onRemove={() => { A().setCover && A().setCover(null); setPop(null); }}
          onClose={() => setPop(null)} />
      )}
      {pop && pop.kind === 'prop' && (
        <PropPopover key={pop.key + ':' + (pop.isNew ? 'n' : 'e')} pop={pop} existing={Object.keys(readProps())}
          members={A().members || []}
          onSave={(value, opts) => { writeProp(pop.key, value, opts.type || pop.type, opts); setPop(null); }}
          onDelete={() => { writeProp(pop.key, '', pop.type, { remove: true }); setPop(null); }}
          onClose={() => setPop(null)} />
      )}
      {pop && pop.kind === 'addTag' && (
        <TagPopover rect={pop.rect} current={(() => { const pr = readProps(); const k = tagsKey(pr); return k ? splitTags(pr[k]) : []; })()}
          known={A().allTags || []}
          onPick={(tag) => { writeTags(list => (list.some(x => x.toLowerCase() === tag.toLowerCase()) ? list : [...list, tag])); setPop(null); }}
          onClose={() => setPop(null)} />
      )}
      {pop && pop.kind === 'addProp' && (
        <AddPropPopover rect={pop.rect} existing={visibleEntries(readProps()).map(([k]) => k)}
          onPick={(name, type) => {
            if (type === 'checkbox') { writeProp(name, 'false', type); setPop(null); return; }
            if (type === 'date') { writeProp(name, new Date().toISOString().slice(0, 10), type); setPop(null); return; }
            setPop({ kind: 'prop', key: name, type, value: type === 'status' ? t('blk.st.todo') : '', rect: pop.rect, isNew: true });
          }}
          onClose={() => setPop(null)} />
      )}
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          (async () => { for (const f of files) await (A().attachFile && A().attachFile(f)); })();
        }} />
    </>,
    portalHost(),
  );
});

// Contenedor propio dentro de .macwin (ahí viven las variables del tema
// activo y la clase .dark), sin colgar el portal de un nodo de React.
function portalHost() {
  const mac = document.querySelector('.macwin');
  if (!mac) return document.body;
  let host = mac.querySelector(':scope > .blk-portal');
  if (!host) {
    host = document.createElement('div');
    host.className = 'blk-portal';
    mac.appendChild(host);
  }
  return host;
}

function stripMd(s) {
  return String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*(#{1,6}\s+|>\s?(\[![a-z]+\]\s?)?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gim, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (m, a, b) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Posicionamiento común ────────────────────────────────────────────────
function useFloating(ref, rect, { prefer = 'below', gap = 6, align = 'left', extra = 0 } = {}) {
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, m = 8;
    let left = align === 'center' ? (rect.left + (rect.right != null ? rect.right : rect.left)) / 2 - r.width / 2 : rect.left;
    let top;
    const below = (rect.bottom != null ? rect.bottom : rect.top) + gap;
    const above = rect.top - gap - r.height;
    if (prefer === 'above') top = above >= m ? above : below;
    else top = below + r.height <= vh - m ? below : (above >= m ? above : Math.max(m, vh - m - r.height));
    left = clampLeft(left, r.width, rect.left, m);
    setPos({ left, top });
  }, [rect && rect.left, rect && rect.top, rect && rect.bottom, rect && rect.right, extra]);
  return pos;
}

function SlashMenu({ slash, items, sel, onHover, onPick }) {
  const ref = useRef(null);
  const pos = useFloating(ref, slash.rect, { gap: 8 });
  useEffect(() => {
    const el = ref.current && ref.current.querySelector('[aria-selected="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  let lastGroup = null;
  return (
    <div ref={ref} className="blk-slash" role="listbox" aria-label={t('blk.slash.label')}
      style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.preventDefault()}>
      {!items.length && <div className="blk-slash-empty">{t('blk.slash.none')}</div>}
      {items.map((it, i) => {
        const head = it.group !== lastGroup ? (lastGroup = it.group, <div key={'g' + it.group} className="blk-slash-grp">{t(it.group === 'blocks' ? 'blk.slash.grp.blocks' : 'blk.slash.grp.insert')}</div>) : null;
        return [head,
          <div key={it.id} role="option" aria-selected={i === sel} className={`blk-slash-it${i === sel ? ' on' : ''}`}
            onMouseMove={() => i !== sel && onHover(i)} onClick={() => onPick(it)}>
            <span className="blk-slash-ic">{/^h[123]$/.test(it.icon) ? <span className="blk-kind-h">{it.icon.toUpperCase()}</span> : <Svg name={it.icon} />}</span>
            <span className="blk-slash-txt"><span>{it.label}</span><span className="blk-slash-hint">{it.hint}</span></span>
            {it.kbd ? <span className="blk-kbd">{it.kbd}</span> : null}
          </div>];
      })}
    </div>
  );
}

// Barra de formato. Con la ventana estrecha y el panel derecho abierto a la nota
// le quedan ~300 px: primero pasa a «compacta» (solo iconos, el texto va en el
// tooltip) y, si aun así no cabe en el hueco de la nota, a dos filas («wrap»).
// Solo si el hueco es menor que MIN_FLOAT_WIDTH puede salirse de la nota.
function Bubble({ rect, onTurn, onBold, onItalic, onStrike, onCode, onLink, onComment, onExtract, onToDb }) {
  const ref = useRef(null);
  const [mode, setMode] = useState('full');     // 'full' | 'compact' | 'wrap'
  const lastRect = useRef(null);
  const [wrapW, setWrapW] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.right != null ? rect.right : rect.left)}`;
    const moved = lastRect.current !== key;
    lastRect.current = key;
    // Selección nueva (o ventana distinta): se vuelve a probar desde el modo completo.
    if (moved && mode !== 'full') { setMode('full'); setWrapW(null); return; }
    const span = noteSpan(rect.left);
    if (!span) return;                                     // ancla fuera de la nota: solo la ventana
    const free = Math.max(MIN_FLOAT_WIDTH, Math.floor(span.right - span.left - 16));
    const w = el.getBoundingClientRect().width;
    if (w <= free + 0.5) return;
    if (mode === 'full') setMode('compact');
    else if (mode === 'compact') { setWrapW(free); setMode('wrap'); }
  }, [rect && rect.left, rect && rect.top, rect && rect.right, mode]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pos = useFloating(ref, rect, { prefer: 'above', gap: 10, align: 'center', extra: mode + ':' + wrapW });
  const compact = mode !== 'full';
  const btn = (label, onClick, content, cls = '') => (
    <button type="button" className={`blk-bb-btn ${cls}`} aria-label={label} title={label}
      onMouseDown={(e) => { e.preventDefault(); onClick(e.currentTarget.getBoundingClientRect()); }}>{content}</button>
  );
  return (
    <div ref={ref} className={`blk-bubble${compact ? ' compact' : ''}${mode === 'wrap' ? ' wrap' : ''}`} role="toolbar" aria-label={t('blk.bubble.label')}
      style={{ left: pos.left, top: pos.top, maxWidth: mode === 'wrap' && wrapW ? wrapW : undefined }}
      onMouseDown={(e) => e.preventDefault()}>
      {btn(t('blk.menu.convert'), onTurn, compact ? <><Svg name="text" size={15} /><Svg name="chevDown" size={12} stroke={2} /></> : <>{t('blk.bubble.turn')}<Svg name="chevDown" size={12} stroke={2} /></>, 'wide')}
      <span className="blk-bb-sep" aria-hidden="true" />
      {btn(t('blk.bubble.bold'), onBold, <b>B</b>)}
      {btn(t('blk.bubble.italic'), onItalic, <i className="blk-bb-i">i</i>)}
      {btn(t('blk.bubble.strike'), onStrike, <s>S</s>)}
      {btn(t('blk.bubble.code'), onCode, <Svg name="code" size={15} />)}
      {btn(t('blk.bubble.link'), onLink, <Svg name="link" size={15} />)}
      {(onExtract || onToDb) && <span className="blk-bb-sep" aria-hidden="true" />}
      {onExtract && btn(t('blk.bubble.extractTip'), onExtract, <Svg name="file" size={14} />)}
      {onToDb && btn(t('blk.bubble.toDbTip'), onToDb, <Svg name="database" size={14} />)}
      {onComment && <span className="blk-bb-sep" aria-hidden="true" />}
      {onComment && btn(t('blk.bubble.comment'), onComment, compact ? <Svg name="comment" size={15} /> : t('blk.bubble.comment'), 'wide')}
    </div>
  );
}

function Backdrop({ onClose }) {
  return <div className="blk-pop-backdrop" onMouseDown={(e) => { e.preventDefault(); onClose(); }} />;
}

function LinkPopover({ rect, getView, from, to, noteNames, onClose }) {
  const ref = useRef(null);
  const pos = useFloating(ref, rect, { gap: 8 });
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { setTimeout(() => inputRef.current && inputRef.current.focus(), 0); }, []);
  const names = useMemo(() => { try { return (noteNames ? noteNames() : []) || []; } catch { return []; } }, []);
  const fq = fold(q.trim());
  const notes = useMemo(() => {
    const list = names.map(n => ({ n, s: fq ? fuzzyScore(n, fq) : 1 })).filter(x => x.s > 0);
    list.sort((a, b) => b.s - a.s);
    return list.slice(0, 8).map(x => x.n);
  }, [fq, names]);
  const isUrl = /^(https?:\/\/|mailto:|www\.)\S+$/i.test(q.trim()) || /^\S+\.[a-z]{2,}(\/\S*)?$/i.test(q.trim());
  const options = [...(isUrl ? [{ kind: 'url', v: q.trim() }] : []), ...notes.map(n => ({ kind: 'note', v: n }))];

  const apply = (opt) => {
    const view = getView();
    if (!view || !opt) return onClose();
    const text = view.state.doc.sliceString(from, to);
    let insert;
    if (opt.kind === 'url') {
      const url = /^www\./i.test(opt.v) ? 'https://' + opt.v : (/^[a-z]+:/i.test(opt.v) ? opt.v : 'https://' + opt.v);
      insert = `[${text}](${url})`;
    } else {
      insert = fold(text.trim()) === fold(opt.v) ? `[[${opt.v}]]` : `[[${opt.v}|${text.replace(/[\[\]|]/g, '')}]]`;
    }
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.link' });
    onClose();
  };

  return (
    <>
      <Backdrop onClose={onClose} />
      <div ref={ref} className="blk-pop blk-linkpop" style={{ left: pos.left, top: pos.top }}>
        <input ref={inputRef} className="blk-pop-input" value={q} placeholder={t('blk.link.ph')}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(options.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); apply(options[sel] || (q.trim() ? { kind: 'url', v: q.trim() } : null)); }
          }} />
        {options.length > 0 && (
          <div className="blk-pop-list" role="listbox">
            {options.map((o, i) => (
              <div key={o.kind + o.v} role="option" aria-selected={i === sel} className={`blk-pop-it${i === sel ? ' on' : ''}`}
                onMouseMove={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); apply(o); }}>
                <Svg name={o.kind === 'url' ? 'link' : 'file'} size={15} />
                <span className="blk-pop-it-txt">{o.kind === 'url' ? t('blk.link.url', { url: o.v }) : o.v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const EXTRA_EMOJI = ['🙂', '😀', '🎉', '👍', '❤️', '🤔', '👀', '🙏', '💪', '🧩', '🗓️', '⏰', '🔒', '🌍', '🍀', '☕', '🎵', '🐛', '🧭', '🏁', '🚧', '🛒', '✈️', '🏆'];

function CoverPop({ rect, current, onPick, onUpload, onRemove, onClose }) {
  const ref = useRef(null);
  const fileRef = useRef(null);
  const pos = useFloating(ref, rect, { gap: 6 });
  const sw = (v) => (
    <button key={v} type="button" className={`blk-cover-sw${v === current ? ' on' : ''}`} style={{ background: coverCss(v) }}
      aria-label={t('blk.cover.pick')} onClick={() => onPick(v)} />
  );
  return (
    <>
      <Backdrop onClose={onClose} />
      <div ref={ref} className="blk-pop blk-coverpop" style={{ left: pos.left, top: pos.top }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="blk-pop-sub">{t('blk.cover.gradients')}</div>
        <div className="blk-cover-grid">{COVER_GRADIENTS.map(sw)}</div>
        <button type="button" className="blk-pop-link" onClick={() => onPick('g:' + Math.floor(Math.random() * 1e6))}>{t('blk.cover.shuffle')}</button>
        <div className="blk-pop-sub">{t('blk.cover.colors')}</div>
        <div className="blk-cover-grid">{COVER_COLORS.map(sw)}</div>
        <div className="blk-cover-actions">
          <button type="button" className="blk-pop-link" onClick={() => fileRef.current && fileRef.current.click()}>{t('blk.cover.upload')}</button>
          {current && <button type="button" className="blk-pop-link" onClick={onRemove}>{t('blk.cover.remove')}</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onUpload(f); }} />
      </div>
    </>
  );
}

function EmojiPop({ rect, canRemove, onPick, onRemove, onClose }) {
  const ref = useRef(null);
  const pos = useFloating(ref, rect, { gap: 6 });
  const all = useMemo(() => [...new Set([...EMOJI_FILE_SET, ...EXTRA_EMOJI])], []);
  return (
    <>
      <Backdrop onClose={onClose} />
      <div ref={ref} className="blk-pop blk-emojipop" style={{ left: pos.left, top: pos.top }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="blk-emoji-grid">
          {all.map((e, i) => <button key={i} type="button" className="blk-emoji" onClick={() => onPick(e)}>{e}</button>)}
        </div>
        {canRemove && <button type="button" className="blk-pop-link" onClick={onRemove}>{t('blk.icon.remove')}</button>}
      </div>
    </>
  );
}

const STATUS_DEFAULTS = () => [t('blk.st.todo'), t('blk.st.doing'), t('blk.st.done'), t('blk.st.blocked')];

function PropPopover({ pop, existing, members, onSave, onDelete, onClose }) {
  const ref = useRef(null);
  const pos = useFloating(ref, pop.rect, { gap: 6 });
  const [name, setName] = useState(pop.key);
  const [type, setType] = useState(pop.type);
  const [value, setValue] = useState(pop.value || '');
  const [tagDraft, setTagDraft] = useState('');
  const [typed, setTyped] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { setTimeout(() => inputRef.current && inputRef.current.focus(), 0); }, [type]);
  const dup = name.trim() !== pop.key && existing.includes(name.trim());
  const save = (v = value, ty = type) => {
    const nm = name.trim();
    if (!nm || dup) return;
    if (ty === 'tags' && tagDraft.trim()) v = [...splitTags(v), tagDraft.trim().replace(/^#/, '')].join(', ');
    if (!String(v).trim() && pop.isNew) { onClose(); return; }
    if (!String(v).trim()) { onDelete(); return; }
    onSave(String(v), { type: ty, rename: nm !== pop.key ? nm : null });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); save(); }
  };
  let editor = null;
  if (type === 'status' || type === 'select') {
    const opts = [...new Set([...(pop.value ? [pop.value] : []), ...(type === 'status' ? STATUS_DEFAULTS() : [])])];
    const fq = typed ? fold(value) : '';
    const shown = opts.filter(o => !fq || fold(o).includes(fq));
    if (typed && value.trim() && !opts.some(o => fold(o) === fold(value.trim()))) shown.push(value.trim());
    editor = (
      <>
        <input ref={inputRef} className="blk-pop-input" value={value} onChange={(e) => { setValue(e.target.value); setTyped(true); }} onKeyDown={onKey} />
        <div className="blk-pop-list">
          {shown.map(o => (
            <div key={o} className={`blk-pop-it${o === value ? ' on' : ''}`} onMouseDown={(e) => { e.preventDefault(); save(o); }}>
              <span className={`blk-pill tone-${type === 'status' ? toneOf(o) : 'neutral'}`}>{o}</span>
            </div>
          ))}
        </div>
      </>
    );
  } else if (type === 'date') {
    editor = <input ref={inputRef} type="date" className="blk-pop-input" value={/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''}
      onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} />;
  } else if (type === 'tags') {
    const tags = splitTags(value);
    editor = (
      <div className="blk-tags-edit">
        {tags.map(tg => (
          <span key={tg} className="blk-tag">#{tg}
            <button type="button" aria-label="×" onClick={() => setValue(tags.filter(x => x !== tg).join(', '))}>×</button>
          </span>
        ))}
        <input ref={inputRef} className="blk-pop-input" value={tagDraft} placeholder={t('blk.props.tagPh')}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && tagDraft.trim()) {
              e.preventDefault();
              setValue([...tags, tagDraft.trim().replace(/^#/, '')].join(', '));
              setTagDraft('');
            } else if (e.key === 'Enter') { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'Backspace' && !tagDraft && tags.length) setValue(tags.slice(0, -1).join(', '));
          }} />
      </div>
    );
  } else if (type === 'person') {
    editor = (
      <>
        <input ref={inputRef} className="blk-pop-input" value={value} list="blk-members" onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} />
        <datalist id="blk-members">{(members || []).map(m => <option key={m} value={m} />)}</datalist>
      </>
    );
  } else {
    editor = <input ref={inputRef} className="blk-pop-input" type={type === 'number' ? 'number' : (type === 'url' ? 'url' : 'text')}
      value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} />;
  }
  return (
    <>
      <Backdrop onClose={() => save()} />
      <div ref={ref} className="blk-pop blk-proppop" style={{ left: pos.left, top: pos.top }}>
        <div className="blk-proppop-head">
          <input className="blk-pop-input blk-proppop-name" value={name} aria-label={t('blk.props.name')}
            onChange={(e) => setName(e.target.value.replace(/[=;]/g, ''))} onKeyDown={onKey} />
          <select className="blk-proppop-type" value={type} aria-label={t('blk.props.type')} onChange={(e) => setType(e.target.value)}>
            {PROP_TYPES.map(ty => <option key={ty} value={ty}>{t('blk.ptype.' + ty)}</option>)}
          </select>
        </div>
        {dup && <div className="blk-pop-err">{t('blk.props.dup')}</div>}
        {editor}
        <div className="blk-proppop-foot">
          {!pop.isNew && <button type="button" className="blk-pop-link danger" onClick={onDelete}><Svg name="trash" size={14} />{t('blk.props.delete')}</button>}
          <button type="button" className="blk-pop-primary" onClick={() => save()} disabled={dup}>{t('blk.props.save')}</button>
        </div>
      </div>
    </>
  );
}

function toneOf(v) {
  const f = fold(v);
  if (/^(hecho|done|completad|terminad|listo)/.test(f)) return 'ok';
  if (/^(en curso|en progreso|in progress|doing)/.test(f)) return 'go';
  if (/^(bloquead|blocked|cancelad)/.test(f)) return 'bad';
  return 'neutral';
}

// «+ Etiqueta»: escribir una nueva o elegir una de las que ya se usan.
function TagPopover({ rect, current, known, onPick, onClose }) {
  const ref = useRef(null);
  const pos = useFloating(ref, rect, { gap: 6 });
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { setTimeout(() => inputRef.current && inputRef.current.focus(), 0); }, []);
  const clean = (s) => String(s || '').trim().replace(/^#+/, '').replace(/[\s,;=]+/g, '-').slice(0, 60);
  const have = new Set(current.map(x => x.toLowerCase()));
  const nq = fold(clean(q));
  const list = known.filter(tg => !have.has(tg.toLowerCase()) && (!nq || fold(tg).includes(nq))).slice(0, 8);
  const typed = clean(q);
  const exact = typed && known.some(tg => tg.toLowerCase() === typed.toLowerCase());
  const opts = [...(typed && !exact && !have.has(typed.toLowerCase()) ? [{ tag: typed, isNew: true }] : []), ...list.map(tag => ({ tag }))];
  const at = Math.min(sel, Math.max(0, opts.length - 1));
  return (
    <>
      <Backdrop onClose={onClose} />
      <div ref={ref} className="blk-pop blk-addtag" style={{ left: pos.left, top: pos.top }}>
        <input ref={inputRef} className="blk-pop-input" value={q} placeholder={t('blk.tags.ph')}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(i + 1, opts.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && opts[at]) { e.preventDefault(); onPick(opts[at].tag); }
          }} />
        {opts.length > 0 && (
          <div className="blk-pop-list">
            {opts.map((o, i) => (
              <div key={(o.isNew ? 'new:' : '') + o.tag} className={`blk-pop-it${i === at ? ' on' : ''}`}
                onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); onPick(o.tag); }}>
                <Svg name="tag" size={15} />
                <span className="blk-pop-it-txt">{o.isNew ? t('blk.tags.create', { tag: o.tag }) : '#' + o.tag}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AddPropPopover({ rect, existing, onPick, onClose }) {
  const ref = useRef(null);
  const pos = useFloating(ref, rect, { gap: 6 });
  const [name, setName] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { setTimeout(() => inputRef.current && inputRef.current.focus(), 0); }, []);
  const suggestions = [
    ['status', t('blk.pname.status')], ['date', t('blk.pname.date')], ['person', t('blk.pname.person')], ['tags', t('blk.pname.tags')],
  ].filter(([, n]) => !existing.includes(n));
  const pick = (type, defName) => {
    let nm = (name.trim() || defName || t('blk.ptype.' + type)).replace(/[=;]/g, '');
    let i = 2;
    const base = nm;
    while (existing.includes(nm)) nm = `${base} ${i++}`;
    onPick(nm, type);
  };
  return (
    <>
      <Backdrop onClose={onClose} />
      <div ref={ref} className="blk-pop blk-addprop" style={{ left: pos.left, top: pos.top }}>
        <input ref={inputRef} className="blk-pop-input" value={name} placeholder={t('blk.props.namePh')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'Enter' && name.trim()) { e.preventDefault(); pick(inferType(name.trim(), '', null)); }
          }} />
        {!name.trim() && suggestions.length > 0 && (
          <div className="blk-pop-list">
            {suggestions.map(([ty, nm]) => (
              <div key={ty} className="blk-pop-it" onMouseDown={(e) => { e.preventDefault(); pick(ty, nm); }}>
                <Svg name={TYPE_ICON[ty]} size={15} /><span className="blk-pop-it-txt">{nm}</span>
              </div>
            ))}
          </div>
        )}
        <div className="blk-pop-sub">{t('blk.props.type')}</div>
        <div className="blk-type-grid">
          {PROP_TYPES.map(ty => (
            <button key={ty} type="button" className="blk-type-btn" onMouseDown={(e) => { e.preventDefault(); pick(ty); }}>
              <Svg name={TYPE_ICON[ty]} size={15} />{t('blk.ptype.' + ty)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
