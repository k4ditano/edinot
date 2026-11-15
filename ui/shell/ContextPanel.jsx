// Panel de contexto (derecha, 312px) con tres pestañas:
//   · Contexto — esquema de la nota (encabezados), «Enlazan aquí» y datos.
//   · Comentarios — el panel de comentarios de siempre, ahora en línea.
//   · IA — solo lectura: agentes conectados por MCP, tareas pendientes y lo
//     que han editado en esta nota. Para pedirles algo se les menciona
//     (@alias) en un comentario; la app no tiene chat ni asistente propio.
// El contenido de Comentarios llega hecho desde EdinotApp (`commentsSlot`)
// porque su lógica (hilos, menciones, notificaciones) vive allí.

import { useState, useMemo, useRef, useEffect, memo } from 'react';
import { t, useI18n } from '../../i18n.js';
import { perfCountRender } from '../../perf.js';
import { Icon } from './icons.jsx';
import { formatShortDate } from '../shared/region.js';

const baseName = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');

// Encabezados h1–h3 del markdown, ignorando bloques de código. `n` es el
// índice entre los h1–h3 (sirve para encontrar el mismo en el render).
export function extractOutline(src) {
  const out = [];
  if (!src) return out;
  const lines = String(src).split(/\r?\n/);
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const m = l.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2]
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
      .trim();
    if (!text) continue;
    out.push({ level: m[1].length, text, line: i, n: out.length });
  }
  return out;
}

export function relTime(ts) {
  if (!ts) return null;
  const d = Date.now() - ts;
  if (d < 60e3) return t('time.now');
  if (d < 3600e3) return t('time.min', { n: Math.floor(d / 60e3) });
  if (d < 86400e3) return t('time.h', { n: Math.floor(d / 3600e3) });
  if (d < 2 * 86400e3) return t('time.yesterday');
  if (d < 30 * 86400e3) return t('time.d', { n: Math.floor(d / 86400e3) });
  return formatShortDate(ts); // Ajustes → Idioma y región → formato de fecha
}

// Secciones memo: al escribir sólo cambian los datos (palabras, caracteres);
// el esquema y «Enlazan aquí» llegan con identidad estable (ver
// useStableBySig en ContextPanel) y no se vuelven a pintar.
const OutlineSection = memo(function OutlineSection({ outline, onJumpHeading, getActiveHeading }) {
  perfCountRender('CtxOutline');
  const minLevel = outline.length ? Math.min(...outline.map(o => o.level)) : 1;
  // Encabezado activo (la sección que se está leyendo), siguiendo el scroll
  // de la nota. getActiveHeading() → { n } (Leer) o { line } (Editar).
  const [activeN, setActiveN] = useState(-1);
  const listRef = useRef(null);
  useEffect(() => {
    if (!getActiveHeading || !outline.length) { setActiveN(-1); return undefined; }
    let raf = 0;
    const calc = () => {
      raf = 0;
      let r = null;
      try { r = getActiveHeading(); } catch {}
      let n = -1;
      if (r && typeof r.n === 'number') n = r.n;
      else if (r && typeof r.line === 'number') { for (const o of outline) { if (o.line <= r.line) n = o.n; else break; } }
      setActiveN(prev => (prev === n ? prev : n));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(calc); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const tm = setTimeout(calc, 120);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); clearTimeout(tm); };
  }, [outline, getActiveHeading]);
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.sh-outline-item.on');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [activeN]);
  return (
      <section>
        <h3 className="sh-ctx-h">{t('shell.ctx.outline')}</h3>
        {outline.length === 0
          ? <p className="sh-ctx-empty">{t('shell.ctx.outlineEmpty')}</p>
          : (
            <ul className="sh-outline" ref={listRef}>
              {outline.map(o => (
                <li key={o.n}>
                  <button type="button" className={`sh-outline-item lvl-${o.level - minLevel}${o.n === activeN ? ' on' : ''}`}
                    aria-current={o.n === activeN ? 'location' : undefined}
                    onClick={() => onJumpHeading(o)}>{o.text}</button>
                </li>
              ))}
            </ul>
          )}
      </section>
  );
});

const BacklinksSection = memo(function BacklinksSection({ backlinks, outgoingCount, onOpenNote }) {
  perfCountRender('CtxBacklinks');
  return (
      <section>
        <h3 className="sh-ctx-h">{t('shell.ctx.backlinks', { n: backlinks.length })}</h3>
        {backlinks.length === 0
          ? <p className="sh-ctx-empty">{t('wnav.empty.backlinks')}</p>
          : (
            <div className="sh-cards">
              {backlinks.map(b => (
                <button type="button" key={b.file.id} className="sh-card" onClick={() => onOpenNote(b.file.id)}>
                  <span className="sh-card-title">{baseName(b.file.name)}</span>
                  {b.snippet && <span className="sh-card-sub">{b.snippet}</span>}
                </button>
              ))}
            </div>
          )}
        {outgoingCount > 0 && <p className="sh-ctx-note">{t(outgoingCount === 1 ? 'shell.ctx.outgoing1' : 'shell.ctx.outgoing', { n: outgoingCount })}</p>}
      </section>
  );
});

const InfoSection = memo(function InfoSection({ info }) {
  return (
      <section>
        <h3 className="sh-ctx-h">{t('shell.ctx.info')}</h3>
        <dl className="sh-dl">
          <dt>{t('shell.ctx.words')}</dt><dd>{info.words.toLocaleString()}</dd>
          <dt>{t('shell.ctx.chars')}</dt><dd>{info.chars.toLocaleString()}</dd>
          <dt>{t('shell.ctx.reading')}</dt><dd>{t('shell.ctx.readingMin', { n: Math.max(1, Math.round(info.words / 200)) })}</dd>
          {info.editedAt ? <><dt>{t('shell.ctx.edited')}</dt><dd>{relTime(info.editedAt)}</dd></> : null}
          {info.openedAt ? <><dt>{t('shell.ctx.opened')}</dt><dd>{relTime(info.openedAt)}</dd></> : null}
          <dt>{t('shell.ctx.vault')}</dt><dd>{info.vault}</dd>
          {info.folder ? <><dt>{t('shell.ctx.folder')}</dt><dd>{info.folder}</dd></> : null}
        </dl>
      </section>
  );
});

function ContextTab({ outline, onJumpHeading, getActiveHeading, backlinks, outgoingCount, onOpenNote, info }) {
  return (
    <div className="sh-ctx-body">
      <OutlineSection outline={outline} onJumpHeading={onJumpHeading} getActiveHeading={getActiveHeading} />
      <BacklinksSection backlinks={backlinks} outgoingCount={outgoingCount} onOpenNote={onOpenNote} />
      <InfoSection info={info} />
    </div>
  );
}

// Devuelve el mismo array mientras su firma no cambie.
function useStableBySig(list, sigOf) {
  const ref = useRef({ sig: null, list });
  const sig = list.map(sigOf).join('\n');
  if (ref.current.sig !== sig) ref.current = { sig, list };
  return ref.current.list;
}

// Pestaña IA (solo lectura): quién está conectado por MCP, sus tareas y lo que
// han editado en la nota abierta.

export const ContextPanel = memo(function ContextPanel({
  tab, setTab, content, onJumpHeading, getActiveHeading, backlinks, outgoingCount, onOpenNote, info,
  commentsSlot, commentsCount, isCanvas,
}) {
  perfCountRender('ContextPanel');
  useI18n();
  const outlineRaw = useMemo(() => (isCanvas ? [] : extractOutline(content)), [content, isCanvas]);
  const outline = useStableBySig(outlineRaw, o => `${o.n}|${o.level}|${o.text}`);
  const backlinksStable = useStableBySig(backlinks, b => `${b.file.id}|${b.file.name}|${b.snippet || ''}`);
  const tabs = [
    { id: 'context', label: t('shell.ctx.tab') },
    { id: 'comments', label: t('shell.cmt.tab'), badge: commentsCount },
  ];
  const onTabKey = (e) => {
    const i = tabs.findIndex(x => x.id === tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      setTab(n.id);
      const el = e.currentTarget.querySelector(`[data-tab="${n.id}"]`);
      if (el) el.focus();
    }
  };
  return (
    <aside className="sh-ctx" aria-label={t('shell.panel.label')}>
      <div role="tablist" className="sh-tabs" aria-label={t('shell.panel.label')} onKeyDown={onTabKey}>
        {tabs.map(x => (
          <button key={x.id} type="button" role="tab" data-tab={x.id} id={'sh-tab-' + x.id}
            aria-selected={tab === x.id} aria-controls={'sh-tabpanel-' + x.id} tabIndex={tab === x.id ? 0 : -1}
            className={`sh-tab${tab === x.id ? ' on' : ''}`} onClick={() => setTab(x.id)}>
            {x.label}
            {x.badge ? <span className="sh-tab-badge">{x.badge}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={'sh-tabpanel-' + tab} aria-labelledby={'sh-tab-' + tab} className="sh-tabpanel">
        {tab === 'context' && (
          <ContextTab outline={outline} onJumpHeading={onJumpHeading} getActiveHeading={getActiveHeading} backlinks={backlinksStable}
            outgoingCount={outgoingCount} onOpenNote={onOpenNote} info={info} />
        )}
        {tab === 'comments' && commentsSlot}
      </div>
    </aside>
  );
});
