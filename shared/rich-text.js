// Texto con estilos mezclados en un mismo bloque (como el texto de Figma), con marcas ligeras al escribir:
//   **negrita**   *cursiva*   __subrayado__   ~~tachado~~   `código`   {#e11d48|color}   {+20|tamaño}
// Se activa por etiqueta (`rich: true`); sin él, el texto se ve tal cual. Lógica pura.

const RULES = [
  { re: /^\*\*([\s\S]+?)\*\*(?!\*)/, set: { b: true } },
  { re: /^__([\s\S]+?)__/, set: { u: true } },
  { re: /^~~([\s\S]+?)~~/, set: { s: true } },
  { re: /^\*([^*\n]+?)\*/, set: { i: true } },
  { re: /^`([^`\n]+?)`/, set: { code: true }, raw: true },
  { re: /^\{(#[0-9a-fA-F]{3,8})\|([^{}\n]+?)\}/, color: true },
  { re: /^\{\+(\d{1,3})\|([^{}\n]+?)\}/, size: true },
];

/** Trozos con estilo de una línea: [{ t, b, i, u, s, code, color, size }]. */
export function parseRichLine(line, base = {}) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ ...base, t: buf }); buf = ''; } };
  let rest = String(line || '');
  while (rest.length) {
    let hit = null;
    for (const r of RULES) {
      const m = r.re.exec(rest);
      if (!m) continue;
      hit = { r, m };
      break;
    }
    if (!hit) { buf += rest[0]; rest = rest.slice(1); continue; }
    flush();
    const { r, m } = hit;
    if (r.color) out.push(...parseRichLine(m[2], { ...base, color: m[1] }));
    else if (r.size) out.push(...parseRichLine(m[2], { ...base, size: Number(m[1]) }));
    else if (r.raw) out.push({ ...base, ...r.set, t: m[1] });
    else out.push(...parseRichLine(m[1], { ...base, ...r.set }));
    rest = rest.slice(m[0].length);
  }
  flush();
  return out;
}

export function parseRich(text) {
  return String(text || '').split('\n').map(l => parseRichLine(l));
}

/** El texto sin marcas (para buscar, contar o copiar). */
export function richPlain(text) {
  return parseRich(text).map(l => l.map(s => s.t).join('')).join('\n');
}
