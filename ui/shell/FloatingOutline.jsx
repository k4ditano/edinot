// Esquema flotante (como en AFFiNE): con el panel derecho cerrado, una
// columna de rayitas en el borde derecho, una por título (más largas cuanto
// más alto el nivel); la de la sección que se lee va resaltada. Al pasar el
// ratón se despliega la lista de títulos y un clic salta a la sección.

import { useState, useEffect, useMemo, memo } from 'react';
import { extractOutline } from './ContextPanel.jsx';

export const FloatingOutline = memo(function FloatingOutline({ content, onJump, getActiveHeading }) {
  const outline = useMemo(() => extractOutline(content), [content]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!getActiveHeading || !outline.length) return undefined;
    let raf = 0;
    const calc = () => {
      raf = 0;
      let r = null;
      try { r = getActiveHeading(); } catch {}
      let n = -1;
      if (r && typeof r.n === 'number') n = r.n;
      else if (r && typeof r.line === 'number') { for (const o of outline) { if (o.line <= r.line) n = o.n; else break; } }
      setActive(prev => (prev === n ? prev : n));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(calc); };
    window.addEventListener('scroll', onScroll, true);
    const tm = setTimeout(calc, 150);
    return () => { window.removeEventListener('scroll', onScroll, true); if (raf) cancelAnimationFrame(raf); clearTimeout(tm); };
  }, [outline, getActiveHeading]);
  if (outline.length < 2) return null;
  const min = Math.min(...outline.map(o => o.level));
  return (
    <nav className={`fo${open ? ' open' : ''}`} aria-label="Esquema"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="fo-lines" aria-hidden="true">
        {outline.slice(0, 40).map(o => (
          <i key={o.n} className={o.n === active ? 'on' : ''} style={{ width: Math.max(8, 20 - (o.level - min) * 5) }} />
        ))}
      </div>
      {open && (
        <div className="fo-card">
          {outline.map(o => (
            <button key={o.n} type="button" className={`fo-item lvl-${o.level - min}${o.n === active ? ' on' : ''}`}
              onClick={() => onJump(o)} title={o.text}>{o.text}</button>
          ))}
        </div>
      )}
    </nav>
  );
});
