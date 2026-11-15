// Avatar generativo del workspace (sustituye a la inicial en un cuadrado).
// Del nombre sale una semilla estable; con ella se elige una paleta y se
// colocan tres manchas difuminadas sobre un degradado, más un brillo suave.
// Mismo workspace → mismo glifo; workspaces distintos → glifos distintos.

import { memo } from 'react';
import { GEN_PALETTES, genHash, genRng } from '../shared/generative.js';

const PALETTES = GEN_PALETTES;
const hash = genHash;
const rng = genRng;

export const WsGlyph = memo(function WsGlyph({ name, size = 22, radius = 6 }) {
  const seed = hash(String(name || 'Edinot').trim().toLowerCase());
  const r = rng(seed);
  const pal = PALETTES[seed % PALETTES.length];
  const rot = Math.round(r() * 360);
  const id = 'wsg' + seed.toString(36);
  const blobs = [0, 1, 2].map((i) => ({
    cx: 6 + r() * 20, cy: 6 + r() * 20, rr: 9 + r() * 9, c: pal[(i + (seed >>> 3)) % 3],
  }));
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" style={{ display: 'block', borderRadius: radius, flex: 'none' }}>
      <defs>
        <linearGradient id={id + 'g'} gradientTransform={`rotate(${rot} .5 .5)`}>
          <stop offset="0" stopColor={pal[0]} />
          <stop offset="1" stopColor={pal[2]} />
        </linearGradient>
        <filter id={id + 'b'} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4.2" /></filter>
        <radialGradient id={id + 'h'} cx=".3" cy=".25" r=".6">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id + 'c'}><rect width="32" height="32" rx={radius * 32 / size} /></clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="32" height="32" fill={`url(#${id}g)`} />
        <g filter={`url(#${id}b)`} opacity=".9">
          {blobs.map((b, i) => <circle key={i} cx={b.cx} cy={b.cy} r={b.rr} fill={b.c} />)}
        </g>
        <rect width="32" height="32" fill={`url(#${id}h)`} />
        <rect width="32" height="32" fill="none" stroke="#000" strokeOpacity=".08" strokeWidth="1.5" rx={radius * 32 / size} />
      </g>
    </svg>
  );
});
