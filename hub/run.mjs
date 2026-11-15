#!/usr/bin/env node
// Arranca el hub como programa suelto (lo lanzan en segundo plano la app, el CLI y el MCP).
// Va aparte de hub.mjs a propósito: hub.mjs es una biblioteca y no debe arrancar nada al
// importarse (dentro del paquete único del CLI, «el archivo principal» es el mismo).
//   EDINOT_HUB_DIR, EDINOT_HUB_PORT, EDINOT_HUB_HOST, EDINOT_HUB_PUBLIC_URL, EDINOT_HUB_ALLOWED_HOSTS
import { startHub } from './hub.mjs';

try {
  const hub = await startHub();
  console.log(`[edinot-hub] escuchando en ${hub.info.url} (pid ${process.pid})`);
  console.log(`[edinot-hub] datos en ${hub.info.dir}`);
  const bye = async () => { console.log('[edinot-hub] cerrando…'); await hub.stop(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
} catch (err) {
  if (err && err.code === 'ALREADY_RUNNING') { console.error('[edinot-hub] ' + err.message); process.exit(0); }
  console.error('[edinot-hub] could not start:', err && err.stack || err);
  process.exit(1);
}
