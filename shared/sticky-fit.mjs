// Auto font-size for sticky notes: largest size (10-42px) whose wrapped text
// fits the tile. Pure + deterministic — computed at render time, never
// persisted, so concurrent editors always agree and no write cascades happen.
// Ancho aproximado de una palabra en «em» para una letra de interfaz tipo sans.
const NARROW = new Set('iljtfrI.,:;\'|!()[]'.split(''));
const WIDE = new Set('mw@%&'.split(''));
export function widthEm(word) {
  let w = 0;
  for (const ch of String(word)) {
    if (NARROW.has(ch)) w += 0.32;
    else if (ch === 'M' || ch === 'W') w += 0.95;
    else if (WIDE.has(ch)) w += 0.88;
    else if (ch !== ch.toLowerCase() && ch === ch.toUpperCase()) w += 0.68;   // mayúscula
    else w += 0.6;
  }
  return w;
}
export function stickyFontSize(text, w, h, defaultSize = 180) {
  const s = String(text || '');
  if (!s.trim()) return 18;
  const availW = Math.max(20, (w || defaultSize) - 26);
  const availH = Math.max(20, (h || defaultSize) - 26);
  const paragraphs = s.split('\n');
  // Reparto por PALABRAS (no por caracteres): una palabra no se parte a mitad si cabe entera en una línea. El ancho se
  // estima letra a letra (estrechas como i/l/t, anchas como m/w, mayúsculas más anchas) y con un margen, porque un ancho
  // medio fijo se quedaba corto con palabras de letras anchas («Feedback» se partía en «Feedbac/k»).
  const maxW = availW * 0.94;
  const SPACE = 0.3;
  const fits = (fs) => {
    const limit = maxW / fs;                                     // ancho de línea en «em»
    let lines = 0;
    for (const p of paragraphs) {
      let cur = 0, n = 1;
      for (const w of p.split(/\s+/).filter(Boolean)) {
        const ww = widthEm(w);
        if (ww > limit) return false;                            // se partiría por la mitad
        if (cur === 0) cur = ww;
        else if (cur + SPACE + ww <= limit) cur += SPACE + ww;
        else { n++; cur = ww; }
      }
      lines += n;
    }
    return lines * fs * 1.3 <= availH;
  };
  let lo = 10, hi = 42;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}
