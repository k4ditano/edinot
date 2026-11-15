// Renumerado de listas numeradas («1. 3. 2.» → «1. 2. 3.»).
//
// Markdown solo respeta el número del PRIMER elemento; los demás son libres,
// así que Leer (markdown-it) siempre enseña 1, 2, 3… pero el fuente — y por
// tanto Editar — se descuadraba al mover, borrar, duplicar o pegar bloques.
// Un transactionFilter añade, en la MISMA transacción (sequential, un solo
// deshacer), los cambios que dejan cada lista tocada numerada en orden a
// partir de su primer número. No actúa al teclear ni con cambios remotos
// (Yjs), solo con las operaciones de bloque que pueden desordenar.

import { EditorState } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';

const MARK_RE = /^(\d{1,9})([.)])$/;
const EVENTS = ['move', 'delete', 'input.paste', 'input.drop', 'input.duplicate', 'input.convert'];

// Cambios para renumerar las OrderedList que tocan [from, to].
export function renumberChanges(state, from, to) {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, to + 2000), 50) || syntaxTree(state);
  const changes = [];
  const seen = new Set();
  tree.iterate({
    from: Math.max(0, from - 1), to: Math.min(state.doc.length, to + 1),
    enter: (n) => {
      if (n.name !== 'OrderedList' || seen.has(n.from)) return;
      seen.add(n.from);
      // Empieza por el MENOR número de la lista: al subir el «3.» arriba la
      // lista sigue empezando en 1 (y una que empieza en 5 sigue en 5).
      const items = [];
      for (let li = n.node.firstChild; li; li = li.nextSibling) {
        if (li.name !== 'ListItem') continue;
        const mark = li.getChild('ListMark');
        if (!mark) continue;
        const txt = state.doc.sliceString(mark.from, mark.to);
        const m = MARK_RE.exec(txt);
        if (m) items.push({ mark, txt, num: +m[1], delim: m[2] });
      }
      if (!items.length) return;
      const start = Math.min(...items.map((it) => it.num));
      items.forEach((it, i) => {
        const want = String(start + i) + it.delim;
        if (want !== it.txt) changes.push({ from: it.mark.from, to: it.mark.to, insert: want });
      });
    },
  });
  return changes;
}

export const renumberLists = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !EVENTS.some((e) => tr.isUserEvent(e))) return tr;
  let lo = Infinity, hi = -1;
  tr.changes.iterChangedRanges((_fa, _ta, fb, tb) => { lo = Math.min(lo, fb); hi = Math.max(hi, tb); });
  if (hi < 0) return tr;
  const state = tr.state;
  const a = state.doc.lineAt(Math.min(lo, state.doc.length));
  const b = state.doc.lineAt(Math.min(hi, state.doc.length));
  const changes = renumberChanges(state, a.from, b.to);
  if (!changes.length) return tr;
  return [tr, { changes, sequential: true }];
});
