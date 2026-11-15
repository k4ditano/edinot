// Edinot — marcas de rendimiento ligeras (arranque + búsqueda).
//
// performance.mark() cuesta prácticamente nada, así que las marcas se
// registran siempre; lo que va detrás de un flag es el *informe*. Para
// verlo: localStorage.setItem('edinot.perf', '1') y recargar, o cualquier
// build de desarrollo (npm run dev).
//   • Arranque: una sola línea "[perf] boot …" cuando se levanta el velo.
//   • Búsqueda: una línea por consulta con el tiempo de cálculo.

let enabled = null;
export function perfEnabled() {
  if (enabled !== null) return enabled;
  try {
    enabled = process.env.NODE_ENV === 'development' || localStorage.getItem('edinot.perf') === '1';
  } catch { enabled = false; }
  return enabled;
}

export function perfMark(name) {
  try { performance.mark('edinot:' + name); } catch {}
}

function markTime(name) {
  try {
    const e = performance.getEntriesByName('edinot:' + name, 'mark');
    return e.length ? Math.round(e[0].startTime) : null;
  } catch { return null; }
}

function emit(msg, extra) {
  console.info('[perf] ' + msg);
  try {
    window.electronAPI?.logAppend?.({ level: 'info', source: 'renderer:perf', msg, extra });
  } catch {}
}

// Informe único del arranque: ms desde el origen de la navegación hasta
// cada hito. Sólo la primera llamada cuenta (el velo puede re-evaluarse).
const BOOT_MARKS = ['bundle-eval', 'modules-ready', 'app-mount', 'idb-ready', 'vault-ready', 'veil-lift'];
let bootReported = false;
export function perfReportBoot() {
  if (bootReported) return;
  bootReported = true;
  perfMark('veil-lift');
  if (!perfEnabled()) return;
  const parts = BOOT_MARKS.map(m => `${m}=${markTime(m) ?? '–'}ms`);
  emit('boot ' + parts.join(' '));
}

// Envuelve un cálculo síncrono (p.ej. los resultados de una búsqueda) y
// registra cuánto tardó. Sin flag, sólo se paga la llamada a la función.
export function perfTime(label, fn, detail) {
  if (!perfEnabled()) return fn();
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  emit(`${label} ${ms.toFixed(1)}ms${detail ? ' ' + detail : ''}`);
  return out;
}

// Contador de renders por componente (sólo con el flag): window.__renderCounts
// = { Sidebar: n, … }. Sirve para comprobar que escribir en el editor no
// re-renderiza la barra lateral, el panel ni las filas.
export function perfCountRender(name) {
  if (!perfEnabled()) return;
  try {
    const c = window.__renderCounts || (window.__renderCounts = {});
    c[name] = (c[name] || 0) + 1;
  } catch {}
}
