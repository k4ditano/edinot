import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameToHtml } from '../shared/frame-html.js';

test('a frame becomes an HTML page with positioned, styled pieces in stack order', () => {
  const json = {
    groups: [{ id: 'f', title: 'Inicio', x: 100, y: 100, w: 400, h: 826 }],
    nodes: [{ id: 'l', kind: 'label', text: 'Hola **Abel**', rich: true, plain: true, fontSize: 24, weight: 700, x: 124, y: 160, w: 300, h: 30, z: 5 }],
    annotations: [
      { id: 'bg', kind: 'shape', shape: 'rect', x: 100, y: 126, w: 400, h: 800, rx: 36, fill: '#0f172a', color: 'none', bbox: { x: 100, y: 126, w: 400, h: 800 }, z: 1 },
      { id: 'p', kind: 'path', d: 'M 120 300 L 200 300', color: '#fff', strokeWidth: 2, fill: 'none', bbox: { x: 120, y: 300, w: 80, h: 0 }, z: 6 },
      { id: 'far', kind: 'shape', shape: 'rect', x: 2000, y: 2000, w: 10, h: 10, bbox: { x: 2000, y: 2000, w: 10, h: 10 } },
    ],
  };
  const html = frameToHtml(json, json.groups[0]);
  assert.match(html, /<title>Inicio<\/title>/);
  assert.match(html, /width:400px;height:800px/);
  assert.match(html, /left:0px;top:0px;z-index:1;width:400px;height:800px;background:#0f172a;border-radius:36px/);
  assert.match(html, /<span style="font-weight:700">Abel<\/span>/);
  assert.match(html, /<svg style="position:absolute;z-index:3;/);
  assert.doesNotMatch(html, /2000/);
});

test('auto layout frames export as real flex / grid (fill, span, nested)', () => {
  const json = {
    groups: [
      { id: 'list', title: 'Lista', x: 0, y: 0, w: 360, h: 600, layout: { dir: 'column', gap: 12, pad: 16 } },
      { id: 'cards', title: 'Tarjetas', x: 16, y: 300, w: 328, h: 200, layout: { dir: 'grid', columns: 2, gap: 8, pad: 0 } },
    ],
    nodes: [
      { id: 't', kind: 'label', text: 'Título', plain: true, fontSize: 24, x: 16, y: 42, w: 200, h: 30 },
      { id: 'b', kind: 'shape', shape: 'rect', text: 'Botón', x: 16, y: 90, w: 100, h: 44, sizeW: 'fill' },
      { id: 'c1', kind: 'shape', shape: 'rect', text: 'A', x: 16, y: 330, w: 100, h: 60, sizeW: 'fill' },
      { id: 'c2', kind: 'shape', shape: 'rect', text: 'B', x: 200, y: 330, w: 100, h: 60, span: 2, sizeW: 'fill' },
    ],
    annotations: [],
  };
  const html = frameToHtml(json, json.groups[0]);
  assert.match(html, /display:flex;flex-direction:column;gap:12px/);
  assert.match(html, /padding:16px/);
  assert.match(html, /display:grid;grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /grid-column:span 2/);
  assert.match(html, /align-self:stretch;width:auto/);
});
