// Buscar dentro de la nota / el canvas (Ctrl/⌘ F, 1.2) y el buscador global en Ctrl/⌘ ⇧ F.
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldText, matchOffsets, countLabel } from '../ui/find/dom-find.js';
import { searchCanvas, pageMatchRanges } from '../editor/canvas/find.js';
import { effectiveBindings, matchShortcut } from '../ui/shared/shortcuts.js';

const ev = (key, { ctrl = true, shift = false, alt = false } = {}) => ({
  key: shift ? key.toUpperCase() : key, code: 'Key' + key.toUpperCase(),
  ctrlKey: ctrl, metaKey: false, shiftKey: shift, altKey: alt,
});

test('fold keeps length and ignores case and accents', () => {
  assert.equal(foldText('Árbol ÉXITO'), 'arbol exito');
  assert.equal(foldText('Página').length, 'Página'.length);
  assert.deepEqual(matchOffsets('La página y la PAGINA', 'pagina'), [[3, 9], [15, 21]]);
  assert.deepEqual(matchOffsets('aaaa', 'aa'), [[0, 2], [2, 4]]);
  assert.deepEqual(matchOffsets('texto', '   '), []);
});

test('counter says «3 de 12»', () => {
  const t = (k, v) => (k === 'search.count' ? `${v.n} de ${v.total}` : `${v.total} resultados`);
  assert.equal(countLabel(t, 3, 12), '3 de 12');
  assert.equal(countLabel(t, 0, 12), '12 resultados');
  assert.equal(countLabel(t, 1, 1200), '1 de 999+');
  assert.equal(countLabel(t, 0, 0), '0');
});

test('canvas search finds text inside the page block, not in its own canvas fence', () => {
  const canvas = { nodes: [{ id: 'page', kind: 'page', x: 0, y: 0, w: 760, h: 600 }, { id: 's1', kind: 'text', sticky: true, text: 'Riesgos', x: 900, y: 0, w: 180, h: 180 }], edges: [], groups: [] };
  const src = '# Plan\n\nRevisar riesgos el lunes.\n\nMás riesgos.\n\n```edinot-canvas\n' + JSON.stringify(canvas) + '\n```\n';
  const rect = (n) => ({ x: n.x, y: n.y, w: n.w, h: n.h });
  const ranges = pageMatchRanges(src, 'riesgos');
  assert.equal(ranges.length, 2, 'two in the text, none in the fence JSON');
  for (const [a, b] of ranges) assert.equal(src.slice(a, b).toLowerCase(), 'riesgos');
  const hits = searchCanvas(canvas, 'riesgos', rect, () => src);
  assert.deepEqual(hits.map(h => h.kind), ['page', 'page', 'node']);
  assert.deepEqual(hits[0].at, ranges[0]);
  // Sin el texto de la página (tableros incrustados) se comporta como antes.
  assert.deepEqual(searchCanvas(canvas, 'riesgos', rect).map(h => h.kind), ['node']);
});

test('Ctrl+F is the in-note search and Ctrl+Shift+F the global one', () => {
  const b = effectiveBindings({});
  assert.equal(b.localSearch, 'Mod+F');
  assert.equal(b.globalSearch, 'Mod+Shift+F');
  assert.equal(matchShortcut(ev('f'), b), 'localSearch');
  assert.equal(matchShortcut(ev('f', { shift: true }), b), 'globalSearch');
  assert.equal(matchShortcut(ev('k'), b), 'palette');
});

test('saved custom shortcuts are respected', () => {
  // Alguien que había puesto la búsqueda global en Mod+G.
  let b = effectiveBindings({ globalSearch: 'Mod+G' });
  assert.equal(matchShortcut(ev('g'), b), 'globalSearch');
  assert.equal(matchShortcut(ev('f'), b), 'localSearch');
  assert.equal(matchShortcut(ev('f', { shift: true }), b), null);
  // Alguien que dejó a mano la global en Mod+F: sigue abriendo la global.
  b = effectiveBindings({ globalSearch: 'Mod+F' });
  assert.equal(matchShortcut(ev('f'), b), 'globalSearch');
  // Alguien que había cambiado la búsqueda local (Alt+F de antes, o desactivada).
  b = effectiveBindings({ localSearch: 'Alt+F' });
  assert.equal(matchShortcut(ev('f', { ctrl: false, alt: true }), b), 'localSearch');
  assert.equal(matchShortcut(ev('f'), b), null);
  b = effectiveBindings({ localSearch: '' });
  assert.equal(matchShortcut(ev('f'), b), null);
});
