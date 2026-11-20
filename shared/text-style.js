// Estilo de los textos del canvas (etiquetas), como el panel de texto de Figma. Lógica pura: lo usan la app
// (pintar y editar), la exportación a SVG y el importador/MCP.
//
// Campos de una etiqueta (`kind: 'label'`), todos opcionales:
//   font        'sans' | 'display' | 'serif' | 'mono' | cualquier otra familia (se usa tal cual si está instalada)
//   fontSize    px            weight      100…900 (bold: true equivale a 700)
//   italic, underline, strike  booleanos
//   lineHeight  multiplicador (1.25)        letterSpacing  px      transform  'upper' | 'lower' | 'title'
//   align       'left' | 'center' | 'right' | 'justify'
//   wrap        true = caja de ancho fijo con saltos de línea; si no, una línea por cada salto del texto
//   plain       sin relleno ni sombra (texto de diseño, no «post-it»)
//   textSize    'auto' (el ancho se ajusta al texto) | 'height' (ancho fijo, alto automático: lo normal) | 'fixed' (caja fija)
//   maxLines    recorta a N líneas con «…»;  truncate  en caja fija, recorta con «…» lo que no cabe
//   paraSpacing px entre párrafos (cada salto de línea)      list  'bullet' | 'number' (cada línea, un punto)

export const FONT_STACKS = {
  sans: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "'Instrument Sans', 'Inter', system-ui, sans-serif",
  serif: "'Newsreader', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};
export const FONT_KEYS = Object.keys(FONT_STACKS);

/** Familia CSS de una etiqueta. Acepta las claves de arriba o una familia libre (p. ej. de un SVG). */
export function fontStack(font) {
  if (!font) return null;
  if (FONT_STACKS[font]) return FONT_STACKS[font];
  const f = String(font).trim();
  const lower = f.toLowerCase();
  if (/mono|courier|consolas|menlo/.test(lower)) return `${f}, ${FONT_STACKS.mono}`;
  if (/serif/.test(lower) && !/sans/.test(lower)) return `${f}, ${FONT_STACKS.serif}`;
  if (/georgia|times|garamond|playfair|merriweather|lora/.test(lower)) return `${f}, ${FONT_STACKS.serif}`;
  return `${f}, ${FONT_STACKS.sans}`;
}

export const weightOf = (n) => (n.weight != null ? Number(n.weight) : n.bold ? 700 : null);

/** Objeto de estilo (claves en camelCase, para React) del texto de una etiqueta. */
export function labelTextStyle(n) {
  const st = { fontSize: n.fontSize || 20 };
  const fam = fontStack(n.font);
  if (fam) st.fontFamily = fam;
  if (n.color) { st.color = n.color; st.textShadow = 'none'; }
  const w = weightOf(n);
  if (w != null) st.fontWeight = w;
  if (n.plain) { st.padding = 0; st.textShadow = 'none'; if (w == null) st.fontWeight = 400; st.lineHeight = 1.25; }
  if (n.italic) st.fontStyle = 'italic';
  const deco = [n.underline && 'underline', n.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) st.textDecoration = deco;
  if (n.lineHeight) st.lineHeight = n.lineHeight;
  if (n.letterSpacing) st.letterSpacing = `${n.letterSpacing}px`;
  if (n.transform) st.textTransform = n.transform === 'upper' ? 'uppercase' : n.transform === 'lower' ? 'lowercase' : n.transform === 'title' ? 'capitalize' : undefined;
  if (n.align) st.textAlign = n.align;
  if (n.wrap) { st.whiteSpace = 'pre-wrap'; st.wordBreak = 'break-word'; }
  else if (n.noWrap) st.whiteSpace = 'pre';
  if (n.textSize === 'auto') { st.whiteSpace = 'pre'; delete st.wordBreak; }
  const lines = clampLines(n);
  if (lines) { st.display = '-webkit-box'; st.WebkitLineClamp = lines; st.WebkitBoxOrient = 'vertical'; st.overflow = 'hidden'; if (st.whiteSpace === 'pre') st.whiteSpace = 'pre-wrap'; }
  return st;
}

/** Líneas máximas a mostrar (con «…»): `maxLines`, o las que caben en una caja fija con `truncate`. */
export function clampLines(n) {
  if (n.maxLines > 0) return Math.round(n.maxLines);
  if (n.truncate && n.textSize === 'fixed' && n.h > 0) {
    const lh = (n.lineHeight || (n.plain ? 1.25 : 1.35)) * (n.fontSize || 20);
    return Math.max(1, Math.floor(n.h / lh));
  }
  return 0;
}

/** Párrafos de una etiqueta, para pintarla con espacio entre párrafos o como lista. null = texto normal. */
export function labelBlocks(n) {
  if (!n.list && !(n.paraSpacing > 0)) return null;
  const lines = String(n.text || '').split('\n');
  return { list: n.list === 'bullet' || n.list === 'number' ? n.list : null, lines: n.list ? lines.filter(l => l.trim() !== '') : lines, spacing: n.paraSpacing > 0 ? n.paraSpacing : 0 };
}

/** HTML del texto de una etiqueta (exportar): párrafos con espacio o lista; `inline(line)` da el HTML de una línea. */
export function labelHtml(n, inline) {
  const b = labelBlocks(n);
  if (!b) return null;
  if (b.list) {
    const tag = b.list === 'number' ? 'ol' : 'ul';
    return `<${tag} style="margin:0;padding-left:1.3em">${b.lines.map((l, i) => `<li${b.spacing && i < b.lines.length - 1 ? ` style="margin-bottom:${b.spacing}px"` : ''}>${inline(l)}</li>`).join('')}</${tag}>`;
  }
  return b.lines.map((l, i) => `<p style="margin:0${b.spacing && i < b.lines.length - 1 ? `;margin-bottom:${b.spacing}px` : ''}">${l ? inline(l) : '<br>'}</p>`).join('');
}

/** El mismo estilo como atributos de SVG <text> (para exportar). */
export function labelSvgAttrs(n) {
  const a = { 'font-size': n.fontSize || 20, 'font-family': (fontStack(n.font) || FONT_STACKS.sans).replace(/"/g, "'") };
  const w = weightOf(n);
  a['font-weight'] = w != null ? w : (n.plain ? 400 : 600);
  if (n.italic) a['font-style'] = 'italic';
  const deco = [n.underline && 'underline', n.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) a['text-decoration'] = deco;
  if (n.letterSpacing) a['letter-spacing'] = n.letterSpacing;
  return a;
}

/** Líneas del texto tal y como se ven (con su transformación de mayúsculas). Sin medir: los saltos del propio texto. */
export function labelLines(n) {
  let t = String(n.text || '');
  if (n.transform === 'upper') t = t.toUpperCase();
  else if (n.transform === 'lower') t = t.toLowerCase();
  else if (n.transform === 'title') t = t.replace(/\b\p{L}/gu, c => c.toUpperCase());
  return t.split('\n');
}
