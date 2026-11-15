// Generador de colores compartido por el avatar del workspace (WsGlyph) y las
// portadas de nota: misma semilla → mismo resultado en todos los equipos.

export const GEN_PALETTES = [
  ['#5B8DEF', '#A974FF', '#FF8FB1'],
  ['#2BB673', '#9BE15D', '#00B4DB'],
  ['#FF7A59', '#FFC75F', '#F15BB5'],
  ['#00C2D1', '#4361EE', '#B5179E'],
  ['#F9A826', '#F94144', '#90BE6D'],
  ['#7F5AF0', '#2CB67D', '#4CC9F0'],
  ['#EF476F', '#FFD166', '#06D6A0'],
  ['#3A86FF', '#8338EC', '#FF006E'],
  ['#2EC4B6', '#FF9F1C', '#E71D36'],
  ['#6A994E', '#A7C957', '#F2E8CF'],
];

export function genHash(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function genRng(seed) {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

// Fondo CSS (degradado lineal + 3 manchas radiales) para una semilla.
export function genCss(seed) {
  const r = genRng(seed);
  const pal = GEN_PALETTES[seed % GEN_PALETTES.length];
  const rot = Math.round(r() * 360);
  const spots = [0, 1, 2].map((i) => {
    const x = Math.round(10 + r() * 80), y = Math.round(10 + r() * 80), s = Math.round(35 + r() * 30);
    return `radial-gradient(circle at ${x}% ${y}%, ${pal[(i + (seed >>> 3)) % 3]}E6 0%, transparent ${s}%)`;
  });
  return `${spots.join(', ')}, linear-gradient(${rot}deg, ${pal[0]}, ${pal[2]})`;
}
