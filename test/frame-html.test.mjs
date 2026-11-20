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
