import { createRoot } from 'react-dom/client';
import { perfMark } from '../perf.js';

perfMark('bundle-eval');

const container = document.getElementById('root');
const root = createRoot(container);

// Never leave the static splash on screen when an early module import or
// React mount fails. This is the first code that runs in the renderer, so it
// must also be able to report failures that happen before the app exists.
function reportBootError(error) {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.stack || err.message || String(err);
  console.error('[Edinot] renderer boot failed:', message);
  try {
    window.electronAPI?.logAppend?.({
      level: 'error',
      source: 'renderer:boot-failed',
      msg: err.message || String(err),
      extra: err.stack || undefined,
    });
  } catch {}

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
  if (!container) return;
  container.innerHTML = `
    <main style="box-sizing:border-box;min-height:100vh;padding:48px;display:grid;place-content:center;gap:16px;background:var(--bg,#ebe8df);color:var(--fg,#45443e);font-family:system-ui,sans-serif">
      <section style="max-width:760px">
        <h1 style="margin:0 0 12px;font-size:24px">Edinot no ha podido arrancar</h1>
        <p style="margin:0 0 18px">Se ha producido un error al cargar el editor. Puedes cerrar y volver a abrir la aplicación.</p>
        <pre style="white-space:pre-wrap;overflow:auto;padding:16px;border-radius:8px;background:rgba(0,0,0,.08);font:12px/1.5 ui-monospace,monospace">${escapeHtml(message)}</pre>
      </section>
    </main>`;
}

// Floating companion windows (presentation / quick note) load the same app
// URL with a `#float=<mode>` hash. They mount the tiny EdinotFloat component
// and skip editor.jsx entirely — importing it would boot a second Yjs +
// IndexedDB client on this origin for nothing. Dynamic import() keeps the
// module factories lazy inside the single esbuild IIFE bundle.
const floatMode = (window.location.hash.match(/^#float=(\w+)/) || [])[1] || null;

if (floatMode) {
  import('../float-window.jsx').then(({ EdinotFloat }) => {
    root.render(<EdinotFloat mode={floatMode} />);
  }).catch(reportBootError);
} else {
  Promise.all([
    import('../editor.jsx'),
    import('../clipper-renderer.js'),
  ]).then(() => {
    perfMark('modules-ready');
    const EdinotApp = window.EdinotApp;
    if (typeof EdinotApp !== 'function') {
      throw new Error('El módulo editor.jsx no ha registrado window.EdinotApp');
    }
    root.render(<EdinotApp />);
    try {
      window.electronAPI?.logAppend?.({ level: 'info', source: 'renderer:mount', msg: 'EdinotApp render scheduled' });
    } catch {}
  }).catch(reportBootError);
}
