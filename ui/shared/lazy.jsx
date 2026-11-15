// Carga diferida de superficies pesadas (Ajustes, Calendario, canvas, bases
// de datos, modales poco usados…).
//
// Cada superficie vive en su propio chunk (build/build.mjs: ESM + splitting)
// y se pide la primera vez que se pinta. Mientras llega —en el loopback de
// Electron son milisegundos— se ve un esqueleto con los tokens del shell, y
// si el chunk no carga (instalación dañada) un aviso con «Reintentar» en vez
// de tumbar toda la app.

import { Component, Suspense, lazy, useEffect, useState } from 'react';
import { t } from '../../i18n.js';

// Envuelve un import() para que todas las llamadas compartan la promesa (el
// prefetch en reposo y el primer render no piden el chunk dos veces) y para
// poder reintentar tras un fallo.
export function lazyModule(loader) {
  let p = null;
  const load = () => {
    if (!p) p = loader().catch((err) => { p = null; throw err; });
    return p;
  };
  return load;
}

// React.lazy sobre una exportación con nombre.
export function lazyNamed(load, name) {
  const C = lazy(() => load().then((m) => {
    if (!m || typeof m[name] !== 'function' && typeof m[name] !== 'object') throw new Error(`${name} no está en el módulo diferido`);
    return { default: m[name] };
  }));
  C.displayName = 'Lazy(' + name + ')';
  return C;
}

// Precarga en reposo (tras el arranque) de chunks que es probable que se
// usen en la sesión: el primer uso ya no espera ni a la red ni a compilar.
export function prefetchWhenIdle(loads, delay = 2500) {
  if (typeof window === 'undefined') return;
  const run = () => {
    for (const load of loads) {
      try { Promise.resolve(load()).catch(() => {}); } catch {}
    }
  };
  setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 5000 });
    else run();
  }, delay);
}

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-edinot', 'lazy-skeleton');
  el.textContent = `
.lz-skel { box-sizing: border-box; color: var(--muted); }
.lz-page { flex: 1; min-width: 0; padding: 40px 48px; display: flex; flex-direction: column; gap: 14px; }
.lz-bar { height: 12px; border-radius: 6px; background: var(--hover, rgba(0,0,0,.06)); }
.lz-bar.lz-title { height: 22px; width: 220px; margin-bottom: 10px; }
.lz-box { border: 1px solid var(--line, rgba(0,0,0,.08)); border-radius: 10px; background: var(--panel, transparent); }
.lz-bar, .lz-box.lz-shimmer { position: relative; overflow: hidden; }
.lz-bar::after, .lz-box.lz-shimmer::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--bg, #fff) 55%, transparent), transparent);
  transform: translateX(-100%); animation: lz-sweep 1.2s ease-in-out infinite;
}
@keyframes lz-sweep { to { transform: translateX(100%); } }
.reduce-motion .lz-bar::after, .reduce-motion .lz-box.lz-shimmer::after { animation: none; }
@media (prefers-reduced-motion: reduce) { .lz-bar::after, .lz-box.lz-shimmer::after { animation: none; } }
.lz-err { padding: 14px 16px; font-size: 13px; display: flex; gap: 10px; align-items: center; }
.lz-err button { font: inherit; border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 7px; padding: 3px 10px; cursor: pointer; }
`;
  document.head.appendChild(el);
}

// Aparece sólo si la carga tarda (>120 ms): en el caso normal no hay parpadeo.
function useDelayed(ms) {
  const [show, setShow] = useState(false);
  useEffect(() => { const id = setTimeout(() => setShow(true), ms); return () => clearTimeout(id); }, [ms]);
  return show;
}

export function PageSkeleton() {
  ensureStyles();
  const show = useDelayed(120);
  return (
    <div className="lz-skel lz-page" aria-busy="true" aria-label={t('lazy.loading')}>
      {show && (
        <>
          <div className="lz-bar lz-title" />
          <div className="lz-bar" style={{ width: '62%' }} />
          <div className="lz-bar" style={{ width: '48%' }} />
          <div className="lz-bar" style={{ width: '55%' }} />
          <div className="lz-box lz-shimmer" style={{ height: 180, marginTop: 12 }} />
        </>
      )}
    </div>
  );
}

export function BlockSkeleton({ height = 160 }) {
  ensureStyles();
  const show = useDelayed(120);
  return (
    <div className={`lz-skel lz-box${show ? ' lz-shimmer' : ''}`} style={{ height, minHeight: 48 }}
      aria-busy="true" aria-label={t('lazy.loading')} />
  );
}

class LazyBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('[lazy] no se pudo cargar', this.props.label || '', error); }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;
    ensureStyles();
    return (
      <div className="lz-skel lz-box lz-err" role="alert">
        <span>{t('lazy.failed')}</span>
        <button type="button" onClick={() => this.setState({ error: null })}>{t('lazy.retry')}</button>
      </div>
    );
  }
}

// Componente listo para usar: <Lazy* {...props} /> con su Suspense y su
// barrera de errores. `fallback` es el esqueleto (o null para modales).
export function withLazy(load, name, { fallback = null, silent = false } = {}) {
  const C = lazyNamed(load, name);
  function LazyWrapper(props) {
    return (
      <LazyBoundary label={name} silent={silent}>
        <Suspense fallback={typeof fallback === 'function' ? fallback(props) : fallback}>
          <C {...props} />
        </Suspense>
      </LazyBoundary>
    );
  }
  LazyWrapper.displayName = 'WithLazy(' + name + ')';
  LazyWrapper.load = load;
  return LazyWrapper;
}
