// Anclas de comentarios que no se desplazan al editar.
//
// Antes, un comentario guardaba solo el texto citado (`anchorText`) y se
// buscaba con indexOf: si se editaba ese texto o aparecía antes otra copia,
// el comentario saltaba de sitio o se perdía. Ahora además guarda dos
// posiciones RELATIVAS de Yjs (`anchorFrom`/`anchorTo`, base64) sobre el
// Y.Text de la nota: siguen al texto aunque se escriba antes o dentro. Los
// registros antiguos, o los que crean el CLI/MCP sin posiciones, siguen
// funcionando con `anchorText` (campos nuevos = aditivos y opcionales).
//
// En «Editar» los rangos anclados se resaltan con un StateField de
// CodeMirror que el editor actualiza con setCommentMarks.

import * as Y from 'yjs';
import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

// { anchorFrom, anchorTo } para el rango [from, to) del Y.Text, o null.
export function makeAnchor(ytext, from, to) {
  if (!ytext || !(to > from)) return null;
  try {
    const a = Y.createRelativePositionFromTypeIndex(ytext, from, 0);
    const b = Y.createRelativePositionFromTypeIndex(ytext, to, -1);
    return { anchorFrom: toB64(Y.encodeRelativePosition(a)), anchorTo: toB64(Y.encodeRelativePosition(b)) };
  } catch { return null; }
}

// Rango actual {from, to} de un comentario con posiciones, o null.
export function resolveAnchor(ytext, rec) {
  if (!ytext || !rec || !rec.anchorFrom || !rec.anchorTo || !ytext.doc) return null;
  try {
    const a = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromB64(rec.anchorFrom)), ytext.doc);
    const b = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromB64(rec.anchorTo)), ytext.doc);
    if (!a || !b || a.type !== ytext || b.type !== ytext || !(b.index > a.index)) return null;
    return { from: a.index, to: b.index };
  } catch { return null; }
}

// Rango de un comentario: posiciones relativas o, si no, la 1.ª aparición
// del texto citado.
export function commentRange(ytext, rec, src) {
  const r = resolveAnchor(ytext, rec);
  if (r) return r;
  const needle = String((rec && rec.anchorText) || '').trim();
  if (!needle) return null;
  const text = src != null ? src : (ytext ? ytext.toString() : '');
  const i = text.indexOf(needle);
  return i >= 0 ? { from: i, to: i + needle.length } : null;
}

// ── Resaltado en «Editar» ────────────────────────────────────────────────
export const setCommentMarks = StateEffect.define(); // [{ id, from, to }]

export const commentMarksField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setCommentMarks)) continue;
      const len = tr.state.doc.length;
      const ranges = (e.value || [])
        .filter(r => r && r.to > r.from && r.from >= 0 && r.to <= len)
        .sort((a, b) => a.from - b.from)
        .map(r => Decoration.mark({ class: 'cm-comment-anchor', attributes: { 'data-comment-id': r.id } }).range(r.from, r.to));
      deco = Decoration.set(ranges, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
