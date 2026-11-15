// Temas de Edinot (antes en editor.jsx) + utilidades de apariencia que
// comparten el App y Ajustes: «Como el sistema», reducir animaciones.

import { useState, useEffect } from 'react';

// `dark: true` drives the .macwin.dark class (and the boot-script class) —
// never infer darkness from the theme key.
// `edinot` / `edinotDark` son la paleta del rediseño y el tema por defecto.
// Definen además los tokens del shell (side/panel/line/hover/accentSoft/
// faint/hl); el resto de temas los derivan en ui/shell.css con color-mix().
export const THEMES = {
  // Diseño de referencia (2026-11-12): tarjeta blanca, barra lateral gris-verdosa
  // (la barra lleva un degradado de `side` hacia `bg`), acento NEGRO y los
  // pasteles solo en el contenido (ui/design.css).
  edinot:     { name: 'Edinot',        bg: '#FFFFFF', toolbar: '#FFFFFF', fg: '#111213', muted: '#6F7579', accent: '#0B0B0C',
                side: '#DCE7E3', panel: '#FFFFFF', line: '#ECEDEE', hover: '#F1F2F3', accentSoft: '#EEEFF0', faint: '#A4A9AC', hl: '#FFF1C9' },
  edinotDark: { name: 'Edinot oscuro', bg: '#141515', toolbar: '#141515', fg: '#ECEEEE', muted: '#9AA1A4', accent: '#F4F5F5', dark: true,
                side: '#1F2927', panel: '#181A1A', line: '#2A2D2E', hover: '#232626', accentSoft: '#272B2B', faint: '#6D7376', hl: '#4A3F1F' },
  // La paleta verde anterior, por si se prefiere.
  sageClassic:     { name: 'Edinot clásico (verde)', bg: '#F8F8F4', toolbar: '#F3F4EE', fg: '#1B1E18', muted: '#5D6455', accent: '#4C6C40',
                side: '#EFF1EA', panel: '#F3F4EE', line: '#DDE0D5', hover: '#E4E8DC', accentSoft: '#E2EAD8', faint: '#8A9181', hl: '#F3E3A6' },
  // Temas v1.1.86: página casi blanca con un toque de color en la barra
  // lateral y el acento (antes el fondo entero era de color saturado y solo
  // traían 5 colores); oscuros casi neutros. Mismas claves que antes.
  sage: { name: 'Salvia', bg: '#FBFCF9', toolbar: '#FBFCF9', fg: '#1B1F17', muted: '#646B5C', accent: '#4C7A3E',
    side: '#F1F4EC', panel: '#FBFCF9', line: '#E1E6D9', hover: '#E8EDE1', accentSoft: '#E6EFE0', faint: '#9EA596', hl: '#FFF4D6' },
  cream: { name: 'Crema', bg: '#FFFDF8', toolbar: '#FFFDF8', fg: '#22201A', muted: '#6E6656', accent: '#B07A1F',
    side: '#F7F2E7', panel: '#FFFDF8', line: '#ECE5D5', hover: '#F0E9DA', accentSoft: '#F6EBD3', faint: '#A69F8E', hl: '#FFF4D6' },
  paper: { name: 'Papel', bg: '#FDFCFA', toolbar: '#FDFCFA', fg: '#1F1D1A', muted: '#6C6860', accent: '#6B5E52',
    side: '#F4F2EE', panel: '#FDFCFA', line: '#E7E4DE', hover: '#EDEAE4', accentSoft: '#EEE9E2', faint: '#A3A098', hl: '#FFF4D6' },
  sepia: { name: 'Sepia', bg: '#F8F1E3', toolbar: '#F8F1E3', fg: '#3B2F22', muted: '#7A6A55', accent: '#9C6B30',
    side: '#EFE5D1', panel: '#F8F1E3', line: '#E3D6BE', hover: '#EADFC8', accentSoft: '#F0E0C2', faint: '#A8977E', hl: '#F5E2A8' },
  sky: { name: 'Cielo', bg: '#FAFCFF', toolbar: '#FAFCFF', fg: '#111827', muted: '#5B6880', accent: '#2F6FC9',
    side: '#EEF3FA', panel: '#FAFCFF', line: '#DEE6F1', hover: '#E5ECF6', accentSoft: '#E3EDFB', faint: '#98A3B5', hl: '#FFF4D6' },
  rose: { name: 'Rosa', bg: '#FFFBFB', toolbar: '#FFFBFB', fg: '#261416', muted: '#7A5A5E', accent: '#C24E62',
    side: '#F9EFF0', panel: '#FFFBFB', line: '#F0DEE0', hover: '#F4E5E7', accentSoft: '#FBE3E8', faint: '#B09A9D', hl: '#FFF4D6' },
  lavender: { name: 'Lavanda', bg: '#FCFBFF', toolbar: '#FCFBFF', fg: '#1C1726', muted: '#6A6080', accent: '#7558C4',
    side: '#F2EFFA', panel: '#FCFBFF', line: '#E5E0F2', hover: '#EBE6F6', accentSoft: '#ECE6FA', faint: '#A39CB5', hl: '#FFF4D6' },
  mint: { name: 'Menta', bg: '#FAFDFB', toolbar: '#FAFDFB', fg: '#0F1F18', muted: '#557064', accent: '#1F8A63',
    side: '#EDF6F1', panel: '#FAFDFB', line: '#DCEBE3', hover: '#E3F0E9', accentSoft: '#DDF2E8', faint: '#93ABA0', hl: '#FFF4D6' },
  terra: { name: 'Terracota', bg: '#FFFCF9', toolbar: '#FFFCF9', fg: '#241812', muted: '#7A6352', accent: '#B5592E',
    side: '#F8F0E8', panel: '#FFFCF9', line: '#EFE2D6', hover: '#F3E8DD', accentSoft: '#F8E5D9', faint: '#AC9888', hl: '#FFF4D6' },
  graph: { name: 'Grafito', bg: '#18191A', toolbar: '#18191A', fg: '#E6E7E5', muted: '#9A9C98', accent: '#7FB069', dark: true,
    side: '#1E1F20', panel: '#1B1C1D', line: '#2D2F30', hover: '#2A2C2D', accentSoft: '#233021', faint: '#6B6D6A', hl: '#4A3F1F' },
  midnight: { name: 'Medianoche', bg: '#0F141C', toolbar: '#0F141C', fg: '#DDE4EE', muted: '#8B97AB', accent: '#6EA8FE', dark: true,
    side: '#141B25', panel: '#121822', line: '#222C3A', hover: '#1E2733', accentSoft: '#17263C', faint: '#5E6A7D', hl: '#3D3620' },
  nord: { name: 'Nórdico', bg: '#1E222A', toolbar: '#1E222A', fg: '#E5E9F0', muted: '#9AA3B2', accent: '#88C0D0', dark: true,
    side: '#242933', panel: '#21252E', line: '#323846', hover: '#2C323D', accentSoft: '#1F3440', faint: '#687083', hl: '#3F3A25' },
  mocha: { name: 'Moca', bg: '#1A1613', toolbar: '#1A1613', fg: '#ECE3D9', muted: '#A8998A', accent: '#D49A5C', dark: true,
    side: '#211C18', panel: '#1E1916', line: '#312A24', hover: '#2B2520', accentSoft: '#33271B', faint: '#786B5F', hl: '#4A3B1C' },
  plum: { name: 'Ciruela', bg: '#17131B', toolbar: '#17131B', fg: '#E9E2F0', muted: '#A496B4', accent: '#B48CE6', dark: true,
    side: '#1E1823', panel: '#1A151F', line: '#2E2636', hover: '#29222F', accentSoft: '#2B2138', faint: '#73687F', hl: '#3E3326' },
  oled: { name: 'Negro OLED', bg: '#000000', toolbar: '#000000', fg: '#E8E8E8', muted: '#9A9A9A', accent: '#4DA3FF', dark: true,
    side: '#0A0A0A', panel: '#070707', line: '#222222', hover: '#1A1A1A', accentSoft: '#0F2238', faint: '#666666', hl: '#3F3615' },
};

// Accent presets offered in Ajustes → Tema. Any hex works via the custom
// picker; these are just curated starting points.
export const ACCENT_PRESETS = ['#5a7a4e', '#2f8a68', '#3d6da3', '#6d9ee3', '#7a5fa8', '#a97fd1', '#a25058', '#d0568c', '#b0623a', '#c98f4e'];

// Acentos con nombre del rediseño (Ajustes → Apariencia). El primero de la
// fila es siempre «Del tema» (accentOverride = null).
export const NAMED_ACCENTS = [
  { id: 'blue', color: '#2F6FC9' },
  { id: 'green', color: '#4C6C40' },
  { id: 'clay', color: '#B5552F' },
  { id: 'plum', color: '#7A4A8E' },
  { id: 'graphite', color: '#3A3F38' },
];

// themeKey guardado → clave efectiva. 'system' sigue al sistema operativo.
export const SYSTEM_THEME = 'system';
export const LIGHT_THEME = 'edinot';
export const DARK_THEME = 'edinotDark';
export function resolveThemeKey(raw, osDark) {
  if (raw === SYSTEM_THEME) return osDark ? DARK_THEME : LIGHT_THEME;
  return THEMES[raw] ? raw : LIGHT_THEME;
}

function useMedia(query) {
  const get = () => {
    try { return !!(window.matchMedia && window.matchMedia(query).matches); } catch { return false; }
  };
  const [v, setV] = useState(get);
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia && window.matchMedia(query); } catch { mq = null; }
    if (!mq) return;
    const on = () => setV(!!mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener(on); };
  }, [query]);
  return v;
}
export const usePrefersDark = () => useMedia('(prefers-color-scheme: dark)');
export const usePrefersReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');

// Payload del espejo en localStorage (lo lee el script de arranque de
// build/build.mjs antes del primer pintado).
export function themeBootPayload(theme, key, accent, accentOverridden) {
  return {
    key, bg: theme.bg, toolbar: theme.toolbar,
    fg: theme.fg, muted: theme.muted, accent, dark: !!theme.dark,
    side: theme.side, panel: theme.panel, line: theme.line, hover: theme.hover,
    'accent-soft': accentOverridden ? undefined : theme.accentSoft,
    faint: theme.faint, hl: theme.hl,
  };
}
