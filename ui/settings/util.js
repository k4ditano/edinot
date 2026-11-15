// Utilidades de Ajustes (movidas de editor.jsx).

import { useState, useEffect } from 'react';

export function formatBytes(b) {
  if (!Number.isFinite(b)) return '–';
  const units = ['B','KB','MB','GB','TB'];
  let v = b, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

// Re-render cuando cambia un Y.Map/Y.Doc (yMeta: ambientConfig,
// taggedAgents, agentPolicy). Diferido ~30ms como useYVersion de editor.jsx
// para no pintar dentro de la transacción de una pulsación.
export function useYVersion(yobj) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!yobj) return;
    let tm = null;
    const cb = () => { if (!tm) tm = setTimeout(() => { tm = null; setV(x => x + 1); }, 30); };
    yobj.observeDeep(cb);
    return () => { yobj.unobserveDeep(cb); if (tm) clearTimeout(tm); };
  }, [yobj]);
  return v;
}

export const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI;
export const isMacPlatform = () => typeof window !== 'undefined' && !!(window.electronAPI && window.electronAPI.platform === 'darwin');
