// Búsqueda de contenido: piezas puras compartidas por el hilo principal
// (editor.jsx, Ctrl K) y el worker del índice (ui/search/worker.js), para
// que ambos plieguen acentos, enmascaren y troceen la consulta EXACTAMENTE
// igual. Sin dependencias: el worker se empaqueta aparte.

// Strip non-prose chrome before substring search so a query like
// "edinot" doesn't match the `<!-- edinot:view=... -->` directive that
// renders a table as kanban/table/etc. Also strips fenced code blocks
// where directive comments / config JSON tend to live. Cheap regex pass
// — runs over short note bodies per keystroke during global search.
// Replacement char preserves length so callers can map a hit index back
// to the same offset in the original text (used for snippet rendering
// in the global search modal).
export function searchableContent(text) {
  if (!text) return '';
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length))
    .replace(/```[\s\S]*?```/g, m => ' '.repeat(m.length))
    // Blob URLs in `![name](edinot://blob/<sha>)` and bare refs always
    // contain the literal "edinot" — match would always hit on the
    // protocol scheme, not the user's content. Mask the URL only;
    // the human-readable name in `[...]` brackets stays searchable.
    .replace(/edinot:\/\/\S+/g, m => ' '.repeat(m.length));
}

// Stop-words dropped from a multi-token query before scoring. We never strip
// them from a single-token search, so `el` / `the` / `de` still find their
// literal occurrences when that's all the user typed.
export const GS_STOP_WORDS = new Set([
  // ES
  'a','al','algo','algunas','algunos','ante','antes','como','con','contra',
  'de','del','desde','donde','durante','el','la','las','lo','los','para',
  'pero','por','que','qué','si','sin','sobre','su','sus','un','una','unas',
  'unos','y','o','u','e','en','es','está','este','esto','estos','esa',
  'esos','le','les','me','mi','mis','no','nos','nuestro','nuestra','os',
  'se','te','tu','tus','ya','muy','también','así',
  // EN
  'an','the','and','or','of','in','to','for','on','at','by','from',
  'with','this','that','those','these','it','its','as','be','is','are',
  'was','were','been','have','has','had','do','does','did','not','i',
  'you','we','they','he','she','my','your','our','their','if','so',
]);

// Accent-fold a string. NFD decomposes 'á' → 'a' + combining acute; we
// then drop every combining mark in the U+0300–U+036F block. Result is
// the same string sans diacritics — Spanish + English coverage.
export function gsFold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Fold + emit a parallel index map so callers can translate a position in
// the folded buffer back to the corresponding UTF-16 offset in the
// original string. Needed because `snippet.pos` feeds `jumpToMatch`,
// which scrolls + highlights in the source text where the accent still
// exists. Length(folded) ≤ length(original); the trailing sentinel at
// `map[folded.length]` equals `original.length`.
export function gsFoldWithMap(s) {
  const src = String(s || '');
  const n = src.length;
  // Fast path: pure ASCII can't carry combining marks, so the fold is the
  // identity and the offset map is 1:1. Skips n× normalize() calls — the
  // dominant cost when re-folding a whole vault on every keystroke.
  let ascii = true;
  for (let i = 0; i < n; i++) { if (src.charCodeAt(i) > 0x7f) { ascii = false; break; } }
  if (ascii) {
    const map = new Array(n + 1);
    for (let i = 0; i <= n; i++) map[i] = i;
    return { folded: src, map };
  }
  let folded = '';
  const map = [];
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    // ASCII chars normalize to themselves — skip the expensive call.
    if (ch.charCodeAt(0) < 0x80) { folded += ch; map.push(i); continue; }
    const norm = ch.normalize('NFD');
    for (let j = 0; j < norm.length; j++) {
      const code = norm.charCodeAt(j);
      if (code >= 0x0300 && code <= 0x036f) continue;
      folded += norm[j];
      map.push(i);
    }
  }
  map.push(n);
  return { folded, map };
}

// Split a query into search terms, dropping stop-words ONLY if at least
// one useful term remains after the filter. Single-token queries are
// returned unchanged so the user can still search for a stop-word.
export function gsQueryTerms(q) {
  const tokens = gsFold(String(q || '').toLowerCase()).split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return tokens;
  const filtered = tokens.filter(t => !GS_STOP_WORDS.has(t));
  return filtered.length >= 1 ? filtered : tokens;
}
