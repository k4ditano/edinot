// Página ↔ Canvas (Edinot 1.2): una nota se ve como página o como canvas, con
// el mismo contenido. En el canvas, la propia página es un nodo más
// (`kind: 'page'`) que pinta el texto vivo de la nota (su mismo Y.Text): el
// nodo guarda sólo dónde está y su tamaño. Compartido por la app, la CLI y el
// MCP para que todos entiendan igual qué es «el canvas de una nota».
//
// El canvas de una nota es su PRIMERA valla ```edinot-canvas (la que refleja el
// modelo estructurado); las de más abajo siguen siendo tableros sueltos.

export const PAGE_NODE_ID = 'page';
export const PAGE_NODE_W = 760;

const FENCE_OPEN = /^[ \t]*```edinot-canvas[ \t]*$/;
const FENCE_CLOSE = /^[ \t]*```\s*$/;

// [startLine, endLine] (las líneas de las vallas incluidas) del canvas propio, o null.
export function ownCanvasRange(src) {
  const lines = String(src || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_OPEN.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) if (FENCE_CLOSE.test(lines[j])) return [i, j];
    return null;
  }
  return null;
}

// El texto de la página sin su canvas propio: lo que se ve en modo Página.
export function pageText(src) {
  const r = ownCanvasRange(src);
  if (!r) return String(src || '');
  const lines = String(src || '').split('\n');
  return [...lines.slice(0, r[0]), ...lines.slice(r[1] + 1)].join('\n');
}

export function isPageNode(n) {
  return !!n && n.kind === 'page';
}

// Alto de partida del bloque de página: según lo largo que es el texto (el
// bloque se desplaza por dentro; luego cada uno lo redimensiona).
export function pageNodeHeight(src) {
  const lines = pageText(src).split('\n').filter(l => l.trim()).length;
  return Math.max(360, Math.min(1100, 160 + lines * 30));
}

// Una nota recién creada, con solo el título y nada de texto, no necesita una página entera en el canvas: entra
// como una tarjeta pequeña con el título (`compact`) que se abre a página al hacerle doble clic.
export const PAGE_COMPACT_W = 340;
export const PAGE_COMPACT_H = 76;
export function isEmptyPage(src) {
  return pageText(src).replace(/^[ \t]*#{1,6}[ \t].*$/m, '').trim() === '';
}
export function makePageNode(src, at = { x: 0, y: 0 }) {
  const x = Math.round(at.x), y = Math.round(at.y);
  if (isEmptyPage(src)) return { id: PAGE_NODE_ID, kind: 'page', x, y, w: PAGE_COMPACT_W, h: PAGE_COMPACT_H, compact: true };
  return { id: PAGE_NODE_ID, kind: 'page', x, y, w: PAGE_NODE_W, h: pageNodeHeight(src) };
}
// La misma tarjeta ya abierta como página.
export function expandedPageNode(node, src) {
  const { compact, ...rest } = node || {};
  return { ...rest, w: PAGE_NODE_W, h: pageNodeHeight(src) };
}

// El canvas con su bloque de página: si no lo tiene, se le pone a la
// izquierda de lo que haya (o en el origen si está vacío). Devuelve el mismo
// objeto si ya lo tenía.
export function withPageNode(json, src) {
  const j = json || {};
  const nodes = Array.isArray(j.nodes) ? j.nodes : [];
  if (nodes.some(isPageNode)) return j;
  let at = { x: 0, y: 0 };
  const boxes = [...nodes, ...(Array.isArray(j.groups) ? j.groups : [])];
  if (boxes.length) {
    const minX = Math.min(...boxes.map(n => n.x || 0));
    const minY = Math.min(...boxes.map(n => n.y || 0));
    at = { x: minX - (isEmptyPage(src) ? PAGE_COMPACT_W : PAGE_NODE_W) - 80, y: minY };
  }
  return { ...j, nodes: [makePageNode(src, at), ...nodes] };
}

// El primer canvas de una nota que aún no lo tenía: sólo su página.
export function freshPageCanvas(src) {
  return { nodes: [makePageNode(src)], edges: [], groups: [] };
}

// Añade al final del texto la valla del canvas propio (si no la tiene ya).
// Devuelve null cuando no hay nada que cambiar.
export function addOwnCanvas(src) {
  const s = String(src || '');
  if (ownCanvasRange(s)) return null;
  const body = JSON.stringify(freshPageCanvas(s), null, 2);
  const sep = !s ? '' : s.endsWith('\n\n') ? '' : s.endsWith('\n') ? '\n' : '\n\n';
  return s + sep + '```edinot-canvas\n' + body + '\n```\n';
}

// Un rectángulo de la página dentro del canvas, en coordenadas del mundo.
export function pageNodeRect(json) {
  const n = (json && Array.isArray(json.nodes) ? json.nodes : []).find(isPageNode);
  // La tarjeta compacta cuenta como una página de ancho normal: la transición Página↔Canvas no hace zoom de más.
  return n ? { x: n.x || 0, y: n.y || 0, w: n.compact ? PAGE_NODE_W : (n.w || PAGE_NODE_W), h: n.h || 600 } : null;
}

// El viewport (x, y, zoom) en el que el bloque de página ocupa exactamente la
// columna de lectura del modo Página: de ahí sale y ahí vuelve la transición.
// `column`: la columna de texto en píxeles relativos al contenedor del canvas
// ({ left, top, width }).
export function viewportForPageColumn(rect, column) {
  if (!rect || !column || !column.width) return null;
  const zoom = column.width / rect.w;
  return { zoom, x: column.left - rect.x * zoom, y: column.top - rect.y * zoom };
}
