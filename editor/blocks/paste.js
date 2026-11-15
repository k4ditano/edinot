// Pegar HTML → Markdown (turndown + GFM). Solo cuando el portapapeles trae
// text/html con estructura de verdad (negritas, enlaces, listas, tablas…):
// el HTML que copian los editores de código (VS Code, etc.) son <div>/<span>
// con estilos y se pega como texto plano, igual que antes.
// Nota: el bundle es un IIFE de esbuild, así que el import() dinámico no
// parte el fichero (turndown va dentro del bundle, ~30 KB); solo retrasa la
// evaluación del módulo al primer pegado.

let tdPromise = null;
function getTurndown() {
  if (!tdPromise) {
    tdPromise = Promise.all([import('turndown'), import('@joplin/turndown-plugin-gfm')]).then(([tdMod, gfmMod]) => {
      const TurndownService = tdMod.default || tdMod;
      const gfm = (gfmMod.gfm || (gfmMod.default && gfmMod.default.gfm));
      const td = new TurndownService({
        headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced',
        emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined',
      });
      if (gfm) td.use(gfm);
      // Fuera estilos/scripts/comentarios de Office.
      td.remove(['style', 'script', 'meta', 'title', 'head']);
      // <mark> → ==resaltado== no es estándar: dejar el texto.
      td.addRule('edinotMark', { filter: ['mark', 'u', 'span'], replacement: (c) => c });
      // Listas con un solo espacio tras el marcador (turndown pone 3).
      td.addRule('edinotListItem', {
        filter: 'li',
        replacement(content, node, options) {
          content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n  ');
          const parent = node.parentNode;
          let prefix = options.bulletListMarker + ' ';
          if (parent && parent.nodeName === 'OL') {
            const start = parent.getAttribute('start');
            const index = Array.prototype.indexOf.call(parent.children, node);
            prefix = (start ? Number(start) + index : index + 1) + '. ';
          }
          const isTask = node.firstChild && node.firstChild.nodeName === 'INPUT' && node.firstChild.type === 'checkbox';
          if (isTask) prefix = '- ';
          return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
        },
      });
      return td;
    });
  }
  return tdPromise;
}

const STRUCTURE_RE = /<(b|strong|i|em|a\s|h[1-6]|ul|ol|li|table|img|blockquote|pre|code|hr|s|del|strike|p)[\s>]/i;
const CODE_EDITOR_RE = /vscode|monaco|data-mx-|class="?(hljs|cm-line|ace_)|<meta[^>]+ProgId[^>]+Excel/i;

export function htmlWorthConverting(html) {
  if (!html || html.length > 2_000_000) return false;
  if (CODE_EDITOR_RE.test(html)) return false;
  return STRUCTURE_RE.test(html);
}

export async function htmlToMarkdown(html) {
  const td = await getTurndown();
  // Quitar el envoltorio <!--StartFragment--> de Chrome/Windows.
  const frag = html.replace(/^[\s\S]*<!--StartFragment-->/, '').replace(/<!--EndFragment-->[\s\S]*$/, '');
  let md = td.turndown(frag);
  md = md.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return md;
}

// Precarga en segundo plano (primer pegado sin espera perceptible).
export function warmTurndown() { try { getTurndown(); } catch {} }
