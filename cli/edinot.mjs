#!/usr/bin/env node
// edinot CLI — talks to Edinot sync server as a first-class Yjs peer.
// Use it from shell or wrap with MCP. Auth state stored at
// $XDG_CONFIG_HOME/edinot/cli.json (defaults to ~/.config/edinot/cli.json).

import { ops, loadConfig, saveConfig, defaultServer, api, resolveConfig } from './lib.mjs';
import { ensureHub, stopHub, readHubInfo, hubAlive, hubDir, hubConfig } from '../hub/client.mjs';
import { pullWorkspace } from '../hub/pull.mjs';
import { hubFetch, registerPin, pinFromLink } from '../hub/tls.mjs';
import { exportMarkdown } from './export.mjs';
import QRCode from 'qrcode';
import os from 'node:os';

const argv = process.argv.slice(2);
const cmd = argv[0];

function usage() {
  process.stderr.write(`edinot — Yjs CLI peer

Auth
  login --email <e> --password <p> [--server <url>]
  logout
  whoami

Servidor y equipos (funciona en un VPS sin pantalla)
  serve [--host 0.0.0.0] [--port 17870] [--public-url https://tu-hub] [--no-qr]
  pair [--url https://tu-hub]        código + QR en la terminal para añadir un equipo
  join <código|enlace> [--server U] [--name N]   en el equipo nuevo
  share <vault> [<vault>…] [--read-only] [--url U]   código para dar acceso SOLO a esos vaults
  shares                             accesos compartidos activos (quitar uno: devices revoke <id>)
  devices [list|revoke <id>]

Exportar a Markdown (legible sin Edinot)
  export <carpeta> [--vault <n>] [--attachments] [--no-prune]

Hub local (funciona sin red; se arranca solo)
  hub [status|start|stop|run|pull|push]

Vaults
  status [--json]                    dónde están tus datos y con qué se sincronizan
  vaults [--json]                    lista de vaults con su número de notas
  vaults create <nombre>             crea un vault

Workspaces
  workspaces
  use <id>

Notes (need: logged in + workspace selected)
  list [--vault <name>]
  read <name>
  write <name> [--vault <name>] [--folder <path>]  # body from stdin
  create <name> [--vault <name>] [--folder <path>] [--from -]
  delete <name>
  rename <oldName> <newName>                       # filename only — use move
  move <name> [--vault <name>] [--folder <path|"">]
  search <substring>

Folders
  folders [--vault <name>] [--parent <path>]
  mkfolder <name> [--vault <name>] [--parent <path>]
  rnfolder <folder-path> <newName> [--vault <name>]
  mvfolder <folder-path> <new-parent|""> [--vault <name>]
  rmfolder <folder-path> [--vault <name>]          # cascade delete

Templates
  tpl list [--vault <name>]
  tpl apply <templateName> <newNoteName> [--vault <n>] [--folder <p>] [--var k=v]...

Tables (column-name aware — no positional confusion)
  table list <note>                                          # all tables in note
  table read <note> [--idx N]                                # rows keyed by column
  table add <note> [--idx N] [--position top|bottom|after:K] [--col Name=Val]...
  table set <note> [--idx N] (--row K | --match Col=Val) [--col Name=Val]...
  table del <note> [--idx N] (--row K | --match Col=Val)
  table find <note> [--idx N] [--match Col=Val]...

Examples
  edinot login --email me@x.com --password ******
  edinot workspaces
  edinot use 3
  echo "# hi" | edinot write README
`);
}

function flag(args, name, fallback = undefined) {
  const i = args.indexOf('--' + name);
  if (i === -1) return fallback;
  return args[i + 1];
}
function flagBool(args, name) {
  return args.includes('--' + name);
}
// Collect every `--flag k=v` occurrence into a plain object. Used by table
// commands where the user repeats `--col k=v --col k2=v2` and likewise --match.
function collectKv(args, flagName) {
  const out = {};
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== flagName) continue;
    const kv = args[i + 1];
    const eq = kv.indexOf('=');
    if (eq <= 0) continue;
    out[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return out;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function require_(cond, msg) {
  if (!cond) { process.stderr.write(`error: ${msg}\n`); process.exit(2); }
}

// Dibuja un texto como QR en la terminal (cabe en unas 15 líneas).
async function printQr(text) {
  process.stdout.write((await QRCode.toString(text, { type: 'terminal', small: true })) + '\n');
}
function printPairing(r, { ttlMin = 5 } = {}) {
  process.stdout.write(`\nCódigo para añadir un equipo: ${r.display}   (un solo uso, caduca en ${ttlMin} min)\n`);
  if (r.uri) {
    process.stdout.write(`Enlace: ${r.uri}\n`);
    if (r.fingerprint) process.stdout.write('(El enlace lleva la huella del certificado del servidor: úsalo completo; el código suelto no basta en un servidor cifrado con certificado propio.)\n');
    return printQr(r.uri);
  }
  process.stdout.write('Falta la dirección pública para el QR: usa --url <https://tu-hub> (o arranca con --public-url).\n');
}
// Acepta «ABCDE-FGHJK» o un enlace edinot://pair?u=…&c=…
function parsePairInput(input, serverFlag) {
  const raw = String(input || '').trim();
  if (/^edinot:\/\//i.test(raw)) {
    const u = new URL(raw);
    return { server: u.searchParams.get('u'), code: u.searchParams.get('c'), fp: u.searchParams.get('f') || null };
  }
  return { server: serverFlag || null, code: raw, fp: null };
}

// Informe de una copia de documentos y adjuntos (pull y push).
function printCopyReport(rep, dryRun, t0) {
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  process.stdout.write(`\nDocumentos: ${rep.docs} copiados (${mb(rep.bytes)}), ${rep.skippedExisting.length} ya estaban, ${rep.failed.length} con error\n`);
  process.stdout.write(`Adjuntos:   ${rep.blobs.referenced} mencionados, ${rep.blobs.copied} copiados, ${rep.blobs.already} ya estaban, ${rep.blobs.missing.length} que el origen ya no tiene, ${rep.blobs.failed.length} con error\n`);
  if (!dryRun) process.stdout.write(`Verificación: ${rep.verified} documentos releídos del destino y completos${rep.notVerified.length ? `, ${rep.notVerified.length} SIN verificar` : ''}\n`);
  process.stdout.write(`Tiempo: ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  for (const f of rep.failed.slice(0, 10)) process.stdout.write(`  error: ${f.name}: ${f.error}\n`);
  for (const n of rep.notVerified.slice(0, 10)) process.stdout.write(`  sin verificar: ${n}\n`);
  for (const f of rep.blobs.failed.slice(0, 10)) process.stdout.write(`  adjunto con error: ${f.sha}: ${f.error}\n`);
}

async function withSession(fn) {
  let cfg;
  try { cfg = await resolveConfig(); }
  catch (err) { require_(false, err.message); }
  require_(cfg && (cfg.token || cfg.mode === 'local'), 'no hay sesión ni hub local; prueba: edinot hub start');
  require_(cfg.mode === 'local' || cfg.workspaceId, 'no workspace selected; run: edinot workspaces && edinot use <id>');
  const session = await ops.open(cfg);
  try {
    const out = await fn(session, cfg);
    // Acceso compartido de solo lectura: el servidor descarta las escrituras; no se aparenta que se guardaron.
    const lost = session.readOnlyWrites ? session.readOnlyWrites() : [];
    if (lost.length) throw new Error('este acceso es de SOLO LECTURA: el cambio no se ha guardado en el servidor');
    return out;
  }
  finally { await session.close(); }
}

async function main() {
  try {
    switch (cmd) {
      case 'login': {
        const email = flag(argv, 'email');
        const password = flag(argv, 'password');
        const server = flag(argv, 'server', defaultServer());
        require_(email && password, 'login needs --email and --password');
        require_(server, 'login needs --server <url> (or EDINOT_SERVER)');
        const r = await api.login(server, email, password);
        const cfg = {
          server,
          token: r.token,
          email: r.email,
          userId: r.userId,
          workspaces: r.workspaces || [],
          workspaceId: (r.workspaces && r.workspaces[0] && r.workspaces[0].id) || null,
        };
        saveConfig(cfg);
        process.stdout.write(`ok logged in as ${r.email}; ${cfg.workspaces.length} workspace(s)\n`);
        if (cfg.workspaceId) process.stdout.write(`active workspace: ${cfg.workspaceId}\n`);
        break;
      }
      case 'hub': {
        const sub = argv[1] || 'status';
        if (sub === 'start') {
          const info = await ensureHub();
          process.stdout.write(`ok hub en marcha: ${info.url} (pid ${info.pid})\ndatos: ${info.dir || hubDir()}\n`);
        } else if (sub === 'stop') {
          const was = await stopHub();
          process.stdout.write(was ? 'ok hub parado\n' : 'no había hub en marcha\n');
        } else if (sub === 'status') {
          const info = readHubInfo();
          if (info && await hubAlive(info)) {
            process.stdout.write(`hub en marcha\n  url:   ${info.url}\n  pid:   ${info.pid}\n  desde: ${info.startedAt}\n  datos: ${info.dir || hubDir()}\n`);
          } else {
            process.stdout.write(`hub parado (datos en ${hubDir()})\nse arranca solo al usar cualquier comando, o con: edinot hub start\n`);
          }
        } else if (sub === 'pull') {
          // Trae una copia de un workspace remoto al hub. El servidor remoto no recibe nada.
          const saved = loadConfig();
          const server = flag(argv, 'server') || (saved && saved.token ? saved.server : null);
          let token = flag(argv, 'token') || (saved && saved.token && saved.server === server ? saved.token : null);
          const email = flag(argv, 'email'), password = flag(argv, 'password');
          require_(server, 'pull necesita --server <url> (o una sesión remota guardada: edinot login)');
          if (!token) {
            require_(email && password, 'pull necesita --token, o --email y --password');
            token = (await api.login(server, email, password)).token;
          }
          const wsRemote = Number(flag(argv, 'workspace') || (saved && saved.workspaceId) || 0);
          require_(wsRemote, 'pull necesita --workspace <id> (mira: edinot workspaces)');
          const hubCfg = await hubConfig({ workspaceId: Number(flag(argv, 'hub-workspace')) || wsRemote });
          require_(hubCfg && hubCfg.workspaceId, 'el hub no tiene workspace');
          require_(server.replace(/\/$/, '') !== hubCfg.server.replace(/\/$/, ''), 'el origen es el propio hub');
          const dryRun = flagBool(argv, 'dry-run');
          process.stdout.write(`${dryRun ? 'Simulación: ' : ''}trayendo ${server} (workspace ${wsRemote}) → hub ${hubCfg.server} (workspace ${hubCfg.workspaceId})\n`);
          process.stdout.write('El servidor remoto solo se lee: no recibe ningún cambio.\n');
          const t0 = Date.now();
          const rep = await pullWorkspace({
            remote: { server, token, workspaceId: wsRemote },
            hub: { server: hubCfg.server, token: hubCfg.token, workspaceId: hubCfg.workspaceId },
            dryRun, mergeExisting: flagBool(argv, 'merge-existing'), skipBlobs: flagBool(argv, 'skip-blobs'),
            onProgress: (e) => {
              if (e.kind === 'list') process.stdout.write(`${e.docs} documentos (${(e.bytes / 1048576).toFixed(1)} MB)\n`);
              else if (e.kind === 'doc' && e.index % 25 === 0) process.stdout.write(`  documentos ${e.index}/${e.total}\n`);
              else if (e.kind === 'doc-error') process.stdout.write(`  ! ${e.name}: ${e.error}\n`);
            },
          });
          printCopyReport(rep, dryRun, t0);
          if (rep.failed.length || rep.notVerified.length || rep.blobs.failed.length) process.exitCode = 1;
        } else if (sub === 'push') {
          // Copia los datos del hub de ESTE equipo a otro hub (el de un servidor al que te has emparejado).
          // Hace falta ANTES de sincronizar un equipo con datos con un hub vacío: copiar los documentos
          // así no «siembra» el texto dos veces; sincronizando directamente, las notas se duplicarían.
          const saved = loadConfig();
          const target = flag(argv, 'to') || (saved && saved.token ? saved.server : null);
          const token = flag(argv, 'token') || process.env.EDINOT_PUSH_TOKEN || (saved && saved.token && saved.server === target ? saved.token : null);
          require_(target, 'push necesita --to <url del hub de destino>');
          require_(token, 'push necesita una credencial: --token <t> (o la variable EDINOT_PUSH_TOKEN), o estar emparejado con ese hub');
          const local = await hubConfig();
          require_(local && local.workspaceId, 'no hay hub local con datos en este equipo');
          require_(target.replace(/\/$/, '') !== local.server.replace(/\/$/, ''), 'el destino es el propio hub de este equipo');
          if (process.env.EDINOT_PUSH_CA) registerPin(target, process.env.EDINOT_PUSH_CA);
          const tws = Number(flag(argv, 'workspace')) || 0;
          let destWs = tws;
          if (!destWs) {
            const list = (await api.workspaces(target, token)).workspaces || [];
            require_(list.length, 'el hub de destino no tiene ningún workspace');
            destWs = list[0].id;
          }
          const dryRun = flagBool(argv, 'dry-run');
          process.stdout.write(`${dryRun ? 'Simulación: ' : ''}copiando el hub de este equipo → ${target} (workspace ${destWs})\n`);
          const t0 = Date.now();
          const rep = await pullWorkspace({
            remote: { server: local.server, token: local.token, workspaceId: local.workspaceId },
            hub: { server: target, token, workspaceId: destWs, ca: process.env.EDINOT_PUSH_CA || (saved && saved.server === target ? saved.tlsCa : null) || null },
            dryRun, mergeExisting: flagBool(argv, 'merge-existing'), skipBlobs: flagBool(argv, 'skip-blobs'),
            onProgress: (e) => {
              if (e.kind === 'list') process.stdout.write(`${e.docs} documentos (${(e.bytes / 1048576).toFixed(1)} MB)\n`);
              else if (e.kind === 'doc' && e.index % 25 === 0) process.stdout.write(`  documentos ${e.index}/${e.total}\n`);
              else if (e.kind === 'doc-error') process.stdout.write(`  ! ${e.name}: ${e.error}\n`);
            },
          });
          printCopyReport(rep, dryRun, t0);
          if (rep.failed.length || rep.notVerified.length || rep.blobs.failed.length) process.exitCode = 1;
        } else if (sub === 'run') {
          const { startHub } = await import('../hub/hub.mjs');
          const hub = await startHub();
          process.stdout.write(`hub escuchando en ${hub.info.url} (Ctrl+C para parar)\ndatos: ${hub.info.dir}\n`);
          const bye = async () => { await hub.stop(); process.exit(0); };
          process.on('SIGINT', bye);
          process.on('SIGTERM', bye);
          await new Promise(() => {}); // en primer plano hasta Ctrl+C
        } else {
          require_(false, 'uso: edinot hub [start|stop|status|run|pull|push]');
        }
        break;
      }
      case 'serve': {
        // Hub abierto a otros equipos (para un VPS o un PC siempre encendido). En primer plano: el sistema
        // (systemd, Docker…) lo mantiene vivo. Sin pantalla: todo se hace desde aquí.
        const { startHub } = await import('../hub/hub.mjs');
        const host = flag(argv, 'host') || process.env.EDINOT_HUB_HOST || '0.0.0.0';
        const port = Number(flag(argv, 'port') || process.env.EDINOT_HUB_PORT) || 17870;
        const publicUrl = flag(argv, 'public-url') || process.env.EDINOT_HUB_PUBLIC_URL || null;
        const allowed = [flag(argv, 'allow-host'), process.env.EDINOT_HUB_ALLOWED_HOSTS].filter(Boolean).join(',');
        let hub;
        const tlsOpt = flagBool(argv, 'no-tls') ? false : flagBool(argv, 'tls') ? true : undefined;
        try { hub = await startHub({ host, port, publicUrl, allowedHosts: allowed, tls: tlsOpt, renewCert: flagBool(argv, 'new-cert') }); }
        catch (err) {
          if (err && err.code === 'ALREADY_RUNNING') require_(false, 'ya hay un hub en marcha con estos datos. Paralo con: edinot hub stop');
          if (err && err.code === 'PORT_BUSY') require_(false, `${err.message}. Elige otro con --port <n>.`);
          throw err;
        }
        process.stdout.write(`hub escuchando en ${host}:${hub.info.port}  (datos: ${hub.info.dir})\n`);
        const shownUrl = hub.info.publicUrl || publicUrl;
        if (shownUrl) process.stdout.write(`dirección pública: ${shownUrl}\n`);
        if (hub.info.tls) process.stdout.write(`cifrado: TLS con certificado propio (huella ${hub.info.fingerprint}). Los equipos se emparejan con el enlace, que la lleva.\n`);
        if (/^http:\/\//i.test(shownUrl || '') && !/^(localhost|127\.)/.test(new URL(shownUrl).hostname)) {
          process.stdout.write('AVISO: la dirección pública es http (sin cifrar). Pon HTTPS delante (Caddy, nginx…) antes de usarlo fuera de una red de confianza.\n');
        }
        if (host !== '127.0.0.1' && !publicUrl) {
          process.stdout.write('AVISO: sin --public-url solo aceptará peticiones dirigidas a 127.0.0.1. Pasa --public-url https://<ip o dominio>:<puerto> (o --allow-host).\n');
        }
        if (!flagBool(argv, 'no-qr') && hub.devices.list.length === 0) {
          process.stdout.write('\nAún no hay ningún equipo emparejado. Añade el primero:');
          await printPairing(hub.createPairing());
          process.stdout.write('Más códigos, cuando quieras:  edinot pair\n');
        }
        const bye = async () => { await hub.stop(); process.exit(0); };
        process.on('SIGINT', bye); process.on('SIGTERM', bye);
        await new Promise(() => {});
        break;
      }
      case 'pair': {
        // Pide al hub de este equipo un código para emparejar otro equipo.
        const cfg = await hubConfig();
        require_(cfg && cfg.token, 'no hay hub en marcha en este equipo (arráncalo con: edinot serve)');
        const info = readHubInfo();
        const res = await hubFetch(cfg.server.replace(/\/$/, '') + '/pair/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
          body: JSON.stringify({ url: flag(argv, 'url') || (info && info.publicUrl) || undefined }),
        });
        const r = await res.json().catch(() => ({}));
        require_(res.ok, r.error || `el hub respondió ${res.status}`);
        await printPairing(r);
        break;
      }
      case 'join': {
        // En el equipo nuevo: canjea el código y guarda la sesión (CLI y MCP quedan apuntando a ese hub).
        const parsed = parsePairInput(argv[1], flag(argv, 'server'));
        const { server, code } = parsed;
        const fp = parsed.fp || flag(argv, 'fingerprint');
        require_(code, 'join necesita el código o el enlace: edinot join ABCDE-FGHJK --server https://tu-hub');
        require_(server, 'falta la dirección del hub: usa el enlace completo o --server <https://tu-hub>');
        const name = flag(argv, 'name') || os.hostname().split('.')[0];
        // Servidor con certificado propio: se fija el certificado cuya huella coincide con la del enlace.
        let tlsCa = null;
        if (fp) {
          try { tlsCa = await pinFromLink(server, fp); } catch (err) { require_(false, err.message); }
          registerPin(server, tlsCa);
        }
        let res;
        try {
          res = await hubFetch(server.replace(/\/$/, '') + '/pair/redeem', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }),
          });
        } catch (err) {
          const c = err && err.cause && (err.cause.code || err.cause.message) || err.message;
          if (/SELF.SIGNED|UNABLE_TO_VERIFY|CERT/i.test(String(c))) require_(false, 'el servidor usa un certificado propio: usa el enlace completo (edinot://…), que lleva su huella, o añade --fingerprint <huella>');
          require_(false, `no se pudo contactar con ${server}: ${c}`);
        }
        const r = await res.json().catch(() => ({}));
        require_(res.ok, r.error || `el hub respondió ${res.status}`);
        saveConfig({
          server, token: r.token, email: r.email, userId: r.userId, workspaces: r.workspaces || [],
          workspaceId: (r.workspaces && r.workspaces[0] && r.workspaces[0].id) || null, deviceId: r.deviceId,
          ...(tlsCa ? { tlsCa } : {}),
        });
        process.stdout.write(`ok este equipo («${name}») está emparejado con ${server}\n`);
        break;
      }
      case 'share': {
        // Da acceso a otra persona o equipo SOLO a algunos vaults (y, si quieres, solo para leer).
        // La granularidad es el vault: el texto de las notas vive dentro del documento de su vault.
        const wanted = argv.slice(1).filter(a => !a.startsWith('--') && a !== flag(argv, 'url'));
        require_(wanted.length, 'uso: edinot share <vault> [<vault>…] [--read-only]');
        const cfg = await hubConfig();
        require_(cfg && cfg.token, 'no hay hub en marcha en este equipo (arráncalo con: edinot serve)');
        const vs = await withSession(async (sess) => sess.listVaults());
        const ids = [], labels = [];
        for (const w of wanted) {
          const v = vs.find(x => x.id === w || String(x.name).toLowerCase() === w.toLowerCase());
          require_(v, `vault no encontrado: «${w}». Hay: ${vs.map(x => x.name).join(', ')}`);
          ids.push(v.id); labels.push(v.name);
        }
        const readOnly = flagBool(argv, 'read-only');
        const info = readHubInfo();
        const res = await hubFetch(cfg.server.replace(/\/$/, '') + '/pair/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
          body: JSON.stringify({ url: flag(argv, 'url') || (info && info.publicUrl) || undefined, scope: { vaults: ids, readOnly } }),
        });
        const r = await res.json().catch(() => ({}));
        require_(res.ok, r.error || `el hub respondió ${res.status}`);
        process.stdout.write(`\nAcceso ${readOnly ? 'de SOLO LECTURA' : 'de lectura y escritura'} a: ${labels.join(', ')}\n`);
        process.stdout.write('Quien use este código no podrá leer ni cambiar ningún otro vault ni administrar el servidor (sí verá sus nombres).\n');
        await printPairing(r);
        process.stdout.write('Para quitarle el acceso:  edinot shares   y luego   edinot devices revoke <id>\n');
        break;
      }
      case 'shares': {
        let cfg;
        try { cfg = await resolveConfig(); } catch (err) { require_(false, err.message); }
        require_(cfg && cfg.token, 'no hay sesión ni hub local');
        const r = await (await hubFetch(cfg.server.replace(/\/$/, '') + '/devices', { headers: { Authorization: `Bearer ${cfg.token}` } })).json();
        const shared = (r.devices || []).filter(d => d.scope);
        if (flagBool(argv, 'json')) { process.stdout.write(JSON.stringify(shared, null, 2) + '\n'); break; }
        if (!shared.length) { process.stdout.write('ningún acceso compartido todavía (usa: edinot share <vault>)\n'); break; }
        const vs = await withSession(async (sess) => sess.listVaults()).catch(() => []);
        const nameOf = (id) => (vs.find(v => v.id === id) || {}).name || id;
        for (const d of shared) {
          const seen = d.lastSeenAt ? new Date(d.lastSeenAt).toISOString().replace('T', ' ').slice(0, 16) : '—';
          process.stdout.write(`${d.id}  ${d.name}  →  ${d.scope.vaults.map(nameOf).join(', ')}  (${d.scope.readOnly ? 'solo lectura' : 'lectura y escritura'}; visto: ${seen})\n`);
        }
        break;
      }
      case 'devices': {
        const sub = argv[1] || 'list';
        let cfg;
        try { cfg = await resolveConfig(); } catch (err) { require_(false, err.message); }
        require_(cfg && cfg.token, 'no hay sesión ni hub local');
        const auth = { Authorization: `Bearer ${cfg.token}` };
        const base = cfg.server.replace(/\/$/, '');
        if (sub === 'list') {
          const r = await (await hubFetch(base + '/devices', { headers: auth })).json();
          if (flagBool(argv, 'json')) { process.stdout.write(JSON.stringify(r.devices || [], null, 2) + '\n'); break; }
          if (!(r.devices || []).length) process.stdout.write('ningún equipo emparejado todavía (usa: edinot pair)\n');
          for (const d of r.devices || []) {
            const seen = d.lastSeenAt ? new Date(d.lastSeenAt).toISOString().replace('T', ' ').slice(0, 16) : '—';
            process.stdout.write(`${d.id}  ${d.name}  (visto: ${seen})${d.scope ? '  [compartido: ' + d.scope.vaults.join(', ') + (d.scope.readOnly ? ', solo lectura' : '') + ']' : ''}\n`);
          }
        } else if (sub === 'revoke') {
          const id = argv[2];
          require_(id, 'uso: edinot devices revoke <id>');
          const res = await hubFetch(`${base}/devices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth });
          const r = await res.json().catch(() => ({}));
          require_(res.ok, r.error || `el hub respondió ${res.status}`);
          process.stdout.write(`ok revocado: ${r.revoked}. Ya no puede sincronizar.\n`);
        } else require_(false, 'uso: edinot devices [list|revoke <id>]');
        break;
      }
      case 'export': {
        const outDir = argv[1];
        require_(outDir && !outDir.startsWith('--'), 'export necesita <carpeta de destino>');
        const withAtt = flagBool(argv, 'attachments');
        await withSession(async (s, cfg) => {
          const rep = await exportMarkdown(s, outDir, {
            vault: flag(argv, 'vault') || null,
            attachments: withAtt,
            prune: !flagBool(argv, 'no-prune'),
            fetchBlob: withAtt ? (sha) => api.blobFetch(cfg.server, cfg.token, sha) : null,
          });
          process.stdout.write(`ok ${rep.notes} notas en ${outDir} (${rep.rewritten} escritas, ${rep.unchanged} sin cambios, ${rep.removed} retiradas)\n`);
          if (withAtt) process.stdout.write(`adjuntos: ${rep.attachments} copiados${rep.attachmentsMissing.length ? `, ${rep.attachmentsMissing.length} no disponibles` : ''}\n`);
          for (const f of rep.failed.slice(0, 10)) process.stdout.write(`  error: ${f.name}: ${f.error}\n`);
          if (rep.failed.length) process.exitCode = 1;
        });
        break;
      }
      case 'logout':
        saveConfig(null);
        process.stdout.write('ok logged out\n');
        break;
      case 'whoami': {
        const cfg = loadConfig();
        if (!cfg || cfg.mode === 'hub') {
          const info = readHubInfo();
          process.stdout.write(JSON.stringify({
            mode: 'hub local', hub: info && (await hubAlive(info)) ? info.url : 'parado (se arranca solo)',
            workspaceId: (cfg && cfg.workspaceId) || null,
          }, null, 2) + '\n');
          break;
        }
        process.stdout.write(JSON.stringify({
          server: cfg.server, email: cfg.email, userId: cfg.userId,
          workspaceId: cfg.workspaceId, workspaces: cfg.workspaces,
        }, null, 2) + '\n');
        break;
      }
      case 'workspaces': {
        let cfg;
        try { cfg = await resolveConfig(); } catch (err) { require_(false, err.message); }
        require_(cfg && cfg.token, 'login first');
        const r = await api.workspaces(cfg.server, cfg.token);
        cfg.workspaces = r.workspaces || [];
        if (!cfg.hub) saveConfig(cfg);
        for (const w of cfg.workspaces) {
          const mark = w.id === cfg.workspaceId ? '*' : ' ';
          process.stdout.write(`${mark} ${w.id}  ${w.name}  (${w.role})\n`);
        }
        break;
      }
      case 'use': {
        const id = Number(argv[1]);
        require_(id, 'use needs <id>');
        const cfg = loadConfig() || { mode: 'hub' };
        cfg.workspaceId = id;
        saveConfig(cfg);
        process.stdout.write(`ok active workspace: ${id}\n`);
        break;
      }
      case 'list': {
        const vault = flag(argv, 'vault');
        await withSession(async (s) => {
          const files = s.listFiles({ vault });
          if (flagBool(argv, 'json')) { process.stdout.write(JSON.stringify(files.map(f => ({ id: f.id, vault: s.vaultName(f.vaultId), vaultId: f.vaultId, name: f.name })), null, 2) + '\n'); return; }
          for (const f of files) {
            const v = s.vaultName(f.vaultId);
            process.stdout.write(`${f.id}\t${v}\t${f.name}\n`);
          }
        });
        break;
      }
      case 'read': {
        const name = argv[1];
        require_(name, 'read needs <name>');
        await withSession(async (s) => {
          const f = s.findFileByName(name);
          require_(f, `not found: ${name}`);
          process.stdout.write(await s.readContent(f.id));
        });
        break;
      }
      case 'write': {
        const name = argv[1];
        const vault = flag(argv, 'vault');
        const folder = flag(argv, 'folder');
        require_(name, 'write needs <name>');
        const body = await readStdin();
        await withSession(async (s) => {
          let f = s.findFileByName(name);
          if (!f) f = await s.createFile(name, vault || 'default', folder || null);
          await s.writeContent(f.id, body);
          process.stdout.write(`ok wrote ${body.length} bytes to ${f.name}\n`);
        });
        break;
      }
      case 'create': {
        const name = argv[1];
        const vault = flag(argv, 'vault') || 'default';
        const folder = flag(argv, 'folder');
        const fromStdin = flagBool(argv, 'from') && argv[argv.indexOf('--from') + 1] === '-';
        require_(name, 'create needs <name>');
        const body = fromStdin ? await readStdin() : '';
        await withSession(async (s) => {
          const existing = s.findFileByName(name);
          require_(!existing, `already exists: ${name}`);
          const f = await s.createFile(name, vault, folder || null);
          if (body) await s.writeContent(f.id, body);
          process.stdout.write(`ok created ${f.id} ${f.name}\n`);
        });
        break;
      }
      case 'move': {
        const name = argv[1];
        const vault = flag(argv, 'vault');
        const folder = flag(argv, 'folder');
        require_(name, 'move needs <name>');
        require_(vault !== undefined || folder !== undefined, 'move needs --vault and/or --folder');
        await withSession(async (s) => {
          const f = s.findFileByName(name);
          require_(f, `not found: ${name}`);
          const out = await s.moveFile(f.id, vault, folder);
          process.stdout.write(`ok moved ${out.name} → vault=${s.vaultName(out.vaultId)} folder=${out.folderId || '(root)'}\n`);
        });
        break;
      }
      case 'status': {
        // Resumen: dónde están tus datos y con qué se sincronizan. Sin efectos (no arranca nada).
        const saved = loadConfig();
        const info = readHubInfo();
        const running = !!(info && await hubAlive(info));
        const remote = !!(saved && saved.token && saved.server);
        const out = {
          hubLocal: { running, url: running ? info.url : null, dir: (info && info.dir) || hubDir() },
          sync: remote
            ? { mode: 'servidor', server: saved.server, cifrado: /^https:/i.test(saved.server) ? (saved.tlsCa ? 'certificado propio fijado' : 'https') : 'SIN CIFRAR (http)',
                equipo: saved.deviceId || null, acceso: saved.scope ? { vaults: saved.scope.vaults, soloLectura: !!saved.scope.readOnly } : 'completo' }
            : { mode: saved && saved.mode === 'local' ? 'carpeta local' : 'solo este equipo' },
        };
        if (flagBool(argv, 'json')) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); break; }
        process.stdout.write(`Hub local:      ${running ? `en marcha (${info.url})` : 'parado (se arranca solo al usar cualquier comando)'}\n`);
        process.stdout.write(`Datos:          ${out.hubLocal.dir}\n`);
        if (remote) {
          process.stdout.write(`Sincronización: con ${saved.server}  [${out.sync.cifrado}]\n`);
          process.stdout.write(`Acceso:         ${saved.scope ? `compartido: ${saved.scope.vaults.join(', ')} (${saved.scope.readOnly ? 'solo lectura' : 'lectura y escritura'})` : 'completo'}\n`);
        } else process.stdout.write('Sincronización: solo en este equipo (para otros equipos: edinot join <enlace>)\n');
        break;
      }
      case 'vaults': {
        // vaults                 lista con el número de notas
        // vaults create <nombre> crea un vault nuevo
        const sub = argv[1];
        if (sub === 'create') {
          const name = argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();
          require_(name, 'uso: edinot vaults create <nombre>');
          const v = await withSession(async (sess) => sess.createVault(name));
          process.stdout.write(`ok vault creado: ${v.name} (id ${v.id})\n`);
        } else {
          require_(!sub, 'uso: edinot vaults [create <nombre>]');
          const list = await withSession(async (sess) => sess.listVaults());
          if (flagBool(argv, 'json')) process.stdout.write(JSON.stringify(list, null, 2) + '\n');
          else for (const v of list) process.stdout.write(`${v.id}\t${v.name}\t${v.noteCount} notas\n`);
        }
        break;
      }
      case 'folders': {
        const vault = flag(argv, 'vault');
        const parent = flag(argv, 'parent');
        await withSession(async (s) => {
          const arg = (parent !== undefined) ? { vault, parent } : vault;
          const out = s.listFolders(arg);
          for (const f of out) {
            process.stdout.write(`${f.id}\t${f.vault || f.vaultId || ''}\t${f.path || f.name}\n`);
          }
        });
        break;
      }
      case 'mkfolder': {
        const name = argv[1];
        const vault = flag(argv, 'vault') || 'default';
        const parent = flag(argv, 'parent');
        require_(name, 'mkfolder needs <name>');
        await withSession(async (s) => {
          const f = await s.createFolder(name, vault, parent || null);
          process.stdout.write(`ok created folder ${f.path || f.name} (${f.id})\n`);
        });
        break;
      }
      case 'rnfolder': {
        const ref = argv[1];
        const newName = argv[2];
        const vault = flag(argv, 'vault') || 'default';
        require_(ref && newName, 'rnfolder needs <folder> <newName>');
        await withSession(async (s) => {
          const out = s.renameFolder(ref, newName, vault);
          process.stdout.write(`ok renamed folder → ${newName} (${out.id})\n`);
        });
        break;
      }
      case 'mvfolder': {
        const ref = argv[1];
        const parent = argv[2];
        const vault = flag(argv, 'vault') || 'default';
        require_(ref && parent !== undefined, 'mvfolder needs <folder> <new-parent|"">');
        await withSession(async (s) => {
          const out = s.moveFolder(ref, parent, vault);
          process.stdout.write(`ok moved folder ${ref} → ${parent || '(root)'} (${out.id})\n`);
        });
        break;
      }
      case 'rmfolder': {
        const ref = argv[1];
        const vault = flag(argv, 'vault') || 'default';
        require_(ref, 'rmfolder needs <folder>');
        await withSession(async (s) => {
          const r = s.deleteFolder(ref, vault);
          process.stdout.write(`ok deleted folder ${ref} (folders: ${r.foldersRemoved ?? '-'}, files: ${r.filesRemoved ?? '-'})\n`);
        });
        break;
      }
      case 'delete': {
        const name = argv[1];
        require_(name, 'delete needs <name>');
        await withSession(async (s) => {
          const f = s.findFileByName(name);
          require_(f, `not found: ${name}`);
          await s.deleteFile(f.id);
          process.stdout.write(`ok deleted ${f.id}\n`);
        });
        break;
      }
      case 'rename': {
        const oldName = argv[1];
        const newName = argv[2];
        require_(oldName && newName, 'rename needs <oldName> <newName>');
        await withSession(async (s) => {
          const f = s.findFileByName(oldName);
          require_(f, `not found: ${oldName}`);
          s.renameFile(f.id, newName);
          process.stdout.write(`ok renamed ${f.id} → ${newName}\n`);
        });
        break;
      }
      case 'table': {
        // Sub-dispatcher. Reuses MCP table primitives via a local mini-engine
        // so a sync session is enough — no need to spin up the MCP server.
        const sub = argv[1];
        const noteName = argv[2];
        require_(sub && noteName, 'table needs <sub> <note>');
        const { runTableCommand } = await import('./table-ops.mjs');
        await withSession(async (s) => {
          const flags = {
            idx: flag(argv, 'idx') != null ? Number(flag(argv, 'idx')) : null,
            row: flag(argv, 'row') != null ? Number(flag(argv, 'row')) : null,
            position: flag(argv, 'position') || null,
            cols: collectKv(argv, '--col'),
            match: collectKv(argv, '--match'),
          };
          await runTableCommand(s, sub, noteName, flags);
        });
        break;
      }
      case 'tpl': {
        // edinot tpl list [--vault X]                  → list templates
        // edinot tpl apply <name> <newName> [--vault X] [--folder P] [--var k=v ...]
        const sub = argv[1];
        require_(sub, 'tpl needs subcommand: list | apply');
        if (sub === 'list') {
          await withSession(async (s) => {
            const vaultArg = flag(argv, 'vault');
            const vaults = s.listVaults();
            const targets = vaultArg
              ? vaults.filter(v => v.id === vaultArg || (v.name || '').toLowerCase() === vaultArg.toLowerCase())
              : vaults;
            for (const v of targets) {
              const folders = s.listFolders({ vault: v.id });
              const root = folders.find(f => !f.parentId && f.name === 'Plantillas');
              if (!root) continue;
              const ids = new Set([root.id]);
              let grew = true;
              while (grew) {
                grew = false;
                for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
              }
              for (const f of s.listFiles({ vault: v.id })) {
                const inTplFolder = (f.folderId && ids.has(f.folderId))
                  || (typeof f.id === 'string' && f.id.startsWith(v.id + '/Plantillas/'));
                if (!inTplFolder) continue;
                process.stdout.write(`${f.name}\t${v.name}\n`);
              }
            }
          });
        } else if (sub === 'apply') {
          const tplName = argv[2];
          const newName = argv[3];
          require_(tplName && newName, 'apply needs <templateName> <newNoteName>');
          const vaultArg = flag(argv, 'vault');
          const folderArg = flag(argv, 'folder');
          // Collect every --var k=v into an object.
          const vars = {};
          for (let i = 0; i < argv.length; i++) {
            if (argv[i] === '--var' && argv[i + 1]) {
              const eq = argv[i + 1].indexOf('=');
              if (eq > 0) vars[argv[i + 1].slice(0, eq)] = argv[i + 1].slice(eq + 1);
            }
          }
          await withSession(async (s) => {
            const tpl = s.findFileByName(tplName);
            require_(tpl, `template not found: ${tplName}`);
            if (s.findFileByName(newName)) { process.stderr.write(`already exists: ${newName}\n`); process.exit(2); }
            const targetVault = vaultArg || s.vaultName(tpl.vaultId) || 'default';
            // Reuse the MCP substitutor for consistency. We bundle the template
            // engine into the MCP file, so import it lazily from there.
            const { substituteForCli } = await import('./tpl-engine.mjs');
            const body = substituteForCli(await s.readContent(tpl.id), vars, {
              vaultName: targetVault,
              templateName: tpl.name.replace(/\.(md|markdown|txt)$/i, ''),
              noteCount: s.listFiles({ vault: targetVault }).length,
              folderName: folderArg ? String(folderArg).split('/').pop() : '',
              folderPath: folderArg || '',
            });
            const f = await s.createFile(newName, targetVault, folderArg || null);
            await s.writeContent(f.id, body);
            process.stdout.write(`${f.id}\t${f.name}\n`);
          });
        } else {
          process.stderr.write(`unknown tpl subcommand: ${sub}\n`);
          process.exit(2);
        }
        break;
      }
      case 'search': {
        const q = argv[1];
        require_(q, 'search needs <substring>');
        await withSession(async (s) => {
          const ql = q.toLowerCase();
          for (const f of s.listFiles({})) {
            const c = await s.readContent(f.id);
            if (c.toLowerCase().includes(ql) || (f.name || '').toLowerCase().includes(ql)) {
              const idx = c.toLowerCase().indexOf(ql);
              const snip = idx >= 0 ? c.slice(Math.max(0, idx - 30), idx + q.length + 30).replace(/\s+/g, ' ') : '';
              process.stdout.write(`${f.id}\t${f.name}\t${snip}\n`);
            }
          }
        });
        break;
      }
      case undefined:
      case '-h':
      case '--help':
      case 'help':
        usage();
        break;
      default:
        process.stderr.write(`unknown command: ${cmd}\n`);
        usage();
        process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`error: ${e && e.message ? e.message : e}\n`);
    process.exit(1);
  }
}
main();
