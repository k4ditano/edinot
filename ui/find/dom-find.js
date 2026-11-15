// Buscar en texto ya pintado (modo Leer y el bloque de página del canvas).
// Sin tocar el DOM: las coincidencias se resaltan con la CSS Custom Highlight
// API (`::highlight(edinot-find)`), así no se rompe el HTML renderizado ni los
// listeners de casillas, enlaces o tablas.
//
// Igual que el buscador del canvas: sin distinguir mayúsculas ni acentos.

// Pliega un carácter sin cambiar la longitud (para poder volver a la posición
// original): «Á» → «a». Si al plegar saldría más de un carácter, se deja en
// minúscula tal cual.
export function foldChar(ch) {
  const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return f.length === 1 ? f : ch.toLowerCase().slice(0, 1) || ch;
}

export function foldText(s) {
  let out = '';
  for (const ch of String(s || '')) {
    // Caracteres fuera del BMP ocupan 2 unidades: se conservan tal cual.
    out += ch.length === 1 ? foldChar(ch) : ch;
  }
  return out;
}

// [[inicio, fin], …] de `query` en `text` (plegados ambos), sin solaparse.
export function matchOffsets(text, query, cap = 5000) {
  const q = foldText(String(query || '').trim());
  if (!q) return [];
  const hay = foldText(text);
  const out = [];
  let i = hay.indexOf(q);
  while (i >= 0 && out.length < cap) {
    out.push([i, i + q.length]);
    i = hay.indexOf(q, i + q.length);
  }
  return out;
}

const BLOCK = /^(P|LI|H[1-6]|TD|TH|PRE|BLOCKQUOTE|DIV|SECTION|ARTICLE|DT|DD|FIGCAPTION|SUMMARY|TR)$/;
const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|INPUT|SELECT|BUTTON|SVG)$/i;

function blockOf(node, root) {
  let el = node.parentElement;
  while (el && el !== root) { if (BLOCK.test(el.tagName)) return el; el = el.parentElement; }
  return root;
}

// Rangos de `query` dentro de `root`. Una coincidencia puede cruzar negritas o
// enlaces dentro del mismo párrafo, pero no saltar de un bloque a otro.
export function findRanges(root, query, { skip, cap = 5000 } = {}) {
  if (!root || !String(query || '').trim()) return [];
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode(n) {
      for (let el = n.parentElement; el && el !== root; el = el.parentElement) {
        if (SKIP.test(el.tagName)) return 2;
        if (skip && el.matches && el.matches(skip)) return 2;
        if (el.hidden || el.getAttribute('aria-hidden') === 'true') return 2;
      }
      return n.data ? 1 : 2;
    },
  });
  // Texto corrido con un mapa índice → (nodo, desplazamiento); '\n' entre bloques.
  let text = '';
  const map = []; // { start, node }
  let lastBlock = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const b = blockOf(n, root);
    if (lastBlock && b !== lastBlock) text += '\n';
    lastBlock = b;
    map.push({ start: text.length, node: n });
    text += n.data;
  }
  if (!map.length) return [];
  const locate = (idx, end) => {
    // El último trozo que empieza antes (o justo en, si es un inicio) de idx.
    let lo = 0, hi = map.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (map[mid].start < idx || (!end && map[mid].start === idx)) lo = mid; else hi = mid - 1;
    }
    const m = map[lo];
    return { node: m.node, offset: Math.min(m.node.data.length, Math.max(0, idx - m.start)) };
  };
  const out = [];
  for (const [s, e] of matchOffsets(text, query, cap)) {
    const a = locate(s, false), b = locate(e, true);
    const r = doc.createRange();
    try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); out.push(r); } catch { /* nodo desaparecido */ }
  }
  return out;
}

// Pinta todas las coincidencias y la actual. `ns` separa a varios buscadores.
export function paintRanges(ranges, current, ns = 'edinot-find') {
  const hl = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  if (!hl) return false;
  CSS.highlights.set(ns, new Highlight(...ranges.filter((_, i) => i !== current)));
  if (current >= 0 && ranges[current]) CSS.highlights.set(ns + '-current', new Highlight(ranges[current]));
  else CSS.highlights.delete(ns + '-current');
  return true;
}

export function clearPaint(ns = 'edinot-find') {
  if (typeof CSS === 'undefined' || !CSS.highlights) return;
  CSS.highlights.delete(ns);
  CSS.highlights.delete(ns + '-current');
}

// Lleva la coincidencia a la vista (centrada en su contenedor con scroll).
export function revealRange(range) {
  if (!range) return;
  const el = range.startContainer && (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement);
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
}

// «3 de 12» (o «12» si aún no hay una actual).
export function countLabel(t, current, total, cap = 999) {
  if (!total) return '0';
  const tot = total > cap ? `${cap}+` : String(total);
  return current > 0 ? t('search.count', { n: current, total: tot }) : t('search.total', { total: tot });
}
