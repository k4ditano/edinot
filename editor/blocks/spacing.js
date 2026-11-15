// Espaciado entre bloques del modo «Editar» (puro: sin DOM ni CodeMirror view).

// ── Espaciado entre bloques ──────────────────────────────────────────────
// El hueco entre dos bloques lo decide su TIPO, no cuántas líneas en blanco
// haya en el fuente (como Leer, donde markdown-it colapsa los márgenes). Los
// valores son los de Leer (MarkEdit.html / shell.css) pasados a «em» del
// texto base: hueco = max(después(anterior), antes(actual)).
//   · Con líneas en blanco entre medias: la PRIMERA lleva todo el hueco
//     (line-height) y las demás quedan casi planas (BLANK_EXTRA_EM).
//   · Sin línea en blanco (título pegado a un párrafo): padding-top en la
//     primera línea del bloque.
// Los widgets de bloque (tabla/código/separador) ya traen su padding interno
// (WIDGET_PAD_EM, blocks.css), que se descuenta.
const GAP = {
  paragraph: [0.6, 0.6], image: [1.0, 1.0], html: [0.6, 0.6], toggle: [0.6, 0.6],
  h1: [0.4, 1.1], h2: [1.9, 0.8], h3: [1.65, 0.65], h4: [1.35, 0.55], h5: [1.35, 0.55], h6: [1.35, 0.55],
  list: [0.5, 0.5], quote: [0.9, 0.9], callout: [0.9, 0.9],
  code: [0.9, 0.9], table: [1.0, 1.0], hr: [1.6, 1.6], math: [0.9, 0.9], embed: [1.0, 1.0],
};
const LIST_TYPES = new Set(['bullet', 'ordered', 'task']);
const WIDGET_TYPES = new Set(['code', 'table', 'hr', 'math', 'embed']);
const WIDGET_PAD_EM = 0.4;
const HR_INNER_EM = 0.9; // margen del <hr> dentro de su widget
const BLANK_EXTRA_EM = 0.3;
const MIN_GAP_EM = 0.15;
// Tamaño de letra relativo de la primera línea (el padding va en su «em»).
const LINE_SCALE = { h1: 2.5, h2: 1.58, h3: 1.28, callout: 0.94 };

function gapKey(b) {
  if (b.type === 'heading') return 'h' + b.level;
  if (LIST_TYPES.has(b.type)) return 'list';
  return GAP[b.type] ? b.type : null;
}
function widgetInner(b) {
  if (!WIDGET_TYPES.has(b.type)) return 0;
  return WIDGET_PAD_EM + (b.type === 'hr' ? HR_INNER_EM : 0);
}
const sameList = (a, b) => LIST_TYPES.has(a.type) && LIST_TYPES.has(b.type)
  && a.node && b.node && a.node.parent && b.node.parent && a.node.parent.from === b.node.parent.from;

// Devuelve { blank: Map(nº línea → em de alto), pad: Map(nº línea → em de padding-top) }.
export function computeBlockSpacing(doc, blocks) {
  const blank = new Map(), pad = new Map();
  const seq = (list) => {
    let prev = null;
    for (const b of list) {
      if (b.type === 'props' || b.type === 'directive' || b.type === '_close') { prev = null; continue; }
      if (b.type === 'toggle' && b.children) seq(b.children);
      const kc = gapKey(b);
      if (prev && kc) {
        const kp = gapKey(prev);
        if (kp && sameList(prev, b)) {
          // Lista «suelta» (líneas en blanco entre elementos): hueco de párrafo.
          let first = true;
          for (let n = prev.toLine + 1; n < b.fromLine; n++) {
            if (doc.line(n).text.trim()) break;
            blank.set(n, first ? 0.45 : BLANK_EXTRA_EM);
            first = false;
          }
        } else if (kp) {
          let g = Math.max(GAP[kp][1], GAP[kc][0]) - widgetInner(prev) - widgetInner(b);
          g = Math.max(MIN_GAP_EM, Math.round(g * 100) / 100);
          let first = true;
          for (let n = prev.toLine + 1; n < b.fromLine; n++) {
            if (doc.line(n).text.trim()) { first = false; break; }
            blank.set(n, first ? g : BLANK_EXTRA_EM);
            first = false;
          }
          if (prev.toLine + 1 >= b.fromLine && !WIDGET_TYPES.has(b.type)) {
            const s = LINE_SCALE[kc] || 1;
            pad.set(b.fromLine, Math.round((g / s) * 1000) / 1000);
          }
        }
      }
      prev = b;
    }
  };
  seq(blocks);
  return { blank, pad };
}
