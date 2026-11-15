// Cómo el CLI, el MCP y la app encuentran, arrancan y paran el hub local.

import { spawn } from 'node:child_process';
import { openSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hubDir, readHubInfo, hubAlive } from './paths.mjs';

export { readHubInfo, hubAlive, hubDir };

/**
 * Programa que arranca el hub: `run.mjs` en el repo; `hub.mjs` (el paquete ya construido desde
 * run.mjs) al lado del MCP o del CLI empaquetados. `EDINOT_HUB_SCRIPT` lo fuerza.
 */
export function hubScriptPath() {
  if (process.env.EDINOT_HUB_SCRIPT) return process.env.EDINOT_HUB_SCRIPT;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const run = path.join(here, 'run.mjs');
  return existsSync(run) ? run : path.join(here, 'hub.mjs');
}

/** Lanza el hub desligado de este proceso (sobrevive al CLI/MCP que lo pidió). */
export function spawnHubDetached() {
  const script = hubScriptPath();
  if (!existsSync(script)) throw new Error(`no encuentro el hub (${script})`);
  const dir = hubDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const log = openSync(path.join(dir, 'hub.log'), 'a');
  const env = { ...process.env };
  // Dentro de Electron, `process.execPath` es la app: hay que pedirle que actúe como Node.
  if (process.versions && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  const child = spawn(process.execPath, [script], {
    detached: true, stdio: ['ignore', log, log], env, windowsHide: true,
  });
  child.unref();
  return child.pid;
}

/**
 * Devuelve el hub en marcha, arrancándolo si hace falta (`start: true`).
 * Si no responde a tiempo, lanza un error que dice dónde mirar.
 */
export async function ensureHub({ start = true, timeoutMs = 15000 } = {}) {
  let info = readHubInfo();
  if (info && await hubAlive(info)) return info;
  if (!start) return null;

  spawnHubDetached();
  const t0 = Date.now();
  let delay = 60;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 400);
    info = readHubInfo();
    if (info && await hubAlive(info, 800)) return info;
  }
  const logFile = path.join(hubDir(), 'hub.log');
  let tail = '';
  try { tail = readFileSync(logFile, 'utf8').trim().split('\n').slice(-3).join(' | '); } catch {}
  throw new Error(`the hub did not start within ${Math.round(timeoutMs / 1000)} s${tail ? ` (${tail})` : ''}. Log: ${logFile}`);
}

/** Para el hub en marcha. Devuelve true si había uno. */
export async function stopHub({ timeoutMs = 10000 } = {}) {
  const info = readHubInfo();
  if (!info || !info.pid) return false;
  try { process.kill(info.pid, 'SIGTERM'); } catch { return false; }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!(await hubAlive(info, 500))) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

/** Configuración lista para `ops.open`: inicia sesión en el hub con su clave. */
export async function hubConfig({ start = true, workspaceId = null } = {}) {
  const info = await ensureHub({ start });
  if (!info) return null;
  const base = info.url.replace(/\/$/, '');
  const res = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'local', password: info.key }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`the hub rejected the key (HTTP ${res.status})`);
  const r = await res.json();
  const wsList = r.workspaces || [];
  const chosen = wsList.find(w => w.id === workspaceId) || wsList[0] || null;
  return {
    hub: true,
    server: info.url,
    token: r.token,
    email: r.email,
    userId: r.userId,
    workspaces: wsList,
    workspaceId: chosen ? chosen.id : null,
  };
}
