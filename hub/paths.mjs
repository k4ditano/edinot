// Dónde vive el hub local de Edinot y cómo lo encuentran el CLI, el MCP y la app.
//
// El hub es un proceso en tu equipo (127.0.0.1) que guarda una copia completa
// de tus datos en disco y habla el mismo protocolo que el servidor de sincronización.
// Así el CLI y el MCP funcionan sin red, con o sin la app abierta.
//
//   <hubDir>/hub.json      estado en marcha: { url, port, key, pid, startedAt, version }
//   <hubDir>/secret.json   { jwtSecret, key } — se crea una vez
//   <hubDir>/docs/         un archivo por documento Yjs
//   <hubDir>/blobs/        adjuntos por hash (aa/bb/<sha>)
//   <hubDir>/backups/      copia diaria de cada documento que cambia (14 días)

import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

export const HUB_VERSION = 1;
export const DEFAULT_PORT = 17870;

export function hubDir() {
  if (process.env.EDINOT_HUB_DIR) return process.env.EDINOT_HUB_DIR;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'edinot', 'hub');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'edinot', 'hub');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'edinot', 'hub');
}

export const hubInfoPath = (dir = hubDir()) => path.join(dir, 'hub.json');
export const hubSecretPath = (dir = hubDir()) => path.join(dir, 'secret.json');

/** Lee hub.json (o null). No comprueba que el proceso siga vivo: ver `hubAlive`. */
export function readHubInfo(dir = hubDir()) {
  try {
    const j = JSON.parse(readFileSync(hubInfoPath(dir), 'utf8'));
    return j && j.url && j.key ? j : null;
  } catch { return null; }
}

/** ¿Responde el hub de `info` en su /healthz? */
export async function hubAlive(info, timeoutMs = 1500) {
  if (!info || !info.url) return false;
  try {
    const res = await fetch(info.url.replace(/\/$/, '') + '/healthz', { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const j = await res.json();
    return !!(j && j.ok && j.hub);
  } catch { return false; }
}
