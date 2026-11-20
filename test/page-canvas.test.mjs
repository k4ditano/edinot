// Página ↔ Canvas (1.2): la lógica compartida por la app, la CLI y el MCP.
// `node --test test/`
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { ownCanvasRange, pageText, addOwnCanvas, withPageNode, makePageNode, pageNodeRect, viewportForPageColumn, PAGE_NODE_ID, PAGE_NODE_W } from '../shared/page-canvas.js';
import { seedCanvasFromJson, readCanvasSnapshot, applyCanvasSnapshot, serializeCanvasDeterministic } from '../shared/canvas-model.js';

const NOTE = '# Plan\n\nPrimer párrafo.\n\n- [ ] tarea\n';

test('a note without a canvas keeps its text until it opens one', () => {
  assert.equal(ownCanvasRange(NOTE), null);
  assert.equal(pageText(NOTE), NOTE);
  const withCanvas = addOwnCanvas(NOTE);
  assert.ok(withCanvas.startsWith(NOTE), 'the text is untouched, the canvas goes after it');
  const r = ownCanvasRange(withCanvas);
  assert.ok(r);
  const json = JSON.parse(withCanvas.split('\n').slice(r[0] + 1, r[1]).join('\n'));
  assert.equal(json.nodes.length, 1);
  assert.deepEqual({ id: json.nodes[0].id, kind: json.nodes[0].kind, x: json.nodes[0].x, w: json.nodes[0].w }, { id: PAGE_NODE_ID, kind: 'page', x: 0, w: PAGE_NODE_W });
  assert.equal(addOwnCanvas(withCanvas), null, 'a second time changes nothing');
  // What Page mode shows: the same text, with no fence.
  assert.equal(pageText(withCanvas).trimEnd(), NOTE.trimEnd());
});

test('only the first canvas is the note\'s own; others stay loose boards', () => {
  const two = NOTE + '\n```edinot-canvas\n{"nodes":[]}\n```\n\nMás.\n\n```edinot-canvas\n{"nodes":[{"id":"x"}]}\n```\n';
  const r = ownCanvasRange(two);
  const lines = two.split('\n');
  assert.equal(lines[r[0]], '```edinot-canvas');
  assert.ok(pageText(two).includes('{"nodes":[{"id":"x"}]}'), 'the second board stays in the page');
  assert.ok(!pageText(two).includes('{"nodes":[]}'));
  // An unclosed fence is not a canvas.
  assert.equal(ownCanvasRange('a\n```edinot-canvas\n{}\n'), null);
});

test('an existing board gets the page to the left of what it has, once', () => {
  const json = { nodes: [{ id: 'a', x: 100, y: 50, w: 200, h: 100 }], groups: [{ id: 'g', x: 40, y: 20, w: 400, h: 300 }], edges: [] };
  const out = withPageNode(json, NOTE);
  assert.equal(out.nodes[0].kind, 'page');
  assert.ok(out.nodes[0].x + out.nodes[0].w < 40, 'left of the leftmost box');
  assert.equal(out.nodes[0].y, 20);
  assert.equal(withPageNode(out, NOTE), out, 'already there: the same object');
  assert.equal(withPageNode({ nodes: [] }, NOTE).nodes[0].x, 0);
});

test('the page block is taller for a longer page, within bounds', () => {
  const short = makePageNode('# a\nuna línea\n').h;
  const long = makePageNode('# a\n' + 'línea\n'.repeat(400)).h;
  assert.ok(short >= 360 && long <= 1100 && long > short);
});

test('the transition puts the page block exactly on the reading column', () => {
  const rect = pageNodeRect({ nodes: [{ id: 'page', kind: 'page', x: -840, y: 20, w: 760, h: 600 }] });
  const v = viewportForPageColumn(rect, { left: 300, top: 80, width: 704 });
  // Where the block's left/top corner and right edge land on screen.
  assert.ok(Math.abs(rect.x * v.zoom + v.x - 300) < 1e-9);
  assert.ok(Math.abs(rect.y * v.zoom + v.y - 80) < 1e-9);
  assert.ok(Math.abs((rect.x + rect.w) * v.zoom + v.x - 1004) < 1e-9);
  assert.equal(viewportForPageColumn(null, { left: 0, top: 0, width: 10 }), null);
});

test('the page node lives in the structured model and in its mirror like any node', () => {
  const doc = new Y.Doc();
  const src = addOwnCanvas(NOTE);
  const r = ownCanvasRange(src);
  const json = JSON.parse(src.split('\n').slice(r[0] + 1, r[1]).join('\n'));
  assert.ok(seedCanvasFromJson(doc, json));
  const snap = readCanvasSnapshot(doc);
  assert.equal(snap.nodes[0].kind, 'page');
  // Moving it (a drag in the canvas) and adding a sticky beside it: both survive the mirror.
  applyCanvasSnapshot(doc, { ...snap, nodes: [{ ...snap.nodes[0], x: 120 }, { id: 'n1', kind: 'text', text: 'idea', x: 900, y: 0 }] });
  const mirror = JSON.parse(serializeCanvasDeterministic(doc));
  assert.equal(mirror.nodes.find(n => n.kind === 'page').x, 120);
  assert.equal(mirror.nodes.length, 2);
});

test('a note with only its title enters its canvas as a compact card, and expands to a page', async () => {
  const { isEmptyPage, expandedPageNode, PAGE_COMPACT_W } = await import('../shared/page-canvas.js');
  assert.equal(isEmptyPage(''), true);
  assert.equal(isEmptyPage('# Título\n\n'), true);
  assert.equal(isEmptyPage('# Título\nalgo'), false);
  const n = makePageNode('# Título\n');
  assert.equal(n.compact, true);
  assert.equal(n.w, PAGE_COMPACT_W);
  const big = expandedPageNode(n, '# Título\n');
  assert.equal(big.compact, undefined);
  assert.equal(big.w, 760);
  assert.equal(makePageNode('# T\ntexto').compact, undefined);
});
