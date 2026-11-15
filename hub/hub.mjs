#!/usr/bin/env node
// Hub local de Edinot.
//
// Un proceso en tu equipo (solo 127.0.0.1) que guarda una copia completa de tus
// notas, tablas, calendario, canvas y adjuntos en disco y habla el mismo
// protocolo que el servidor de sincronización: WebSocket Yjs (Hocuspocus) y la
// parte REST que usan el CLI y el MCP. Por eso el CLI y el MCP funcionan sin red
// y con o sin la app abierta. Sin cuentas, sin planes y sin permisos: hay una
// sola persona dueña de todo.
//
// Uso:  node hub.mjs            (queda en primer plano; Ctrl+C lo para)
//   EDINOT_HUB_DIR   carpeta de datos (por defecto, ver paths.mjs)
//   EDINOT_HUB_PORT  puerto preferido (por defecto 17870; si está ocupado, otro libre)

import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import net from 'node:net';
import tlsLib from 'node:tls';
import path from 'node:path';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync, renameSync } from 'node:fs';

import { hubDir, hubInfoPath, hubSecretPath, readHubInfo, DEFAULT_PORT, HUB_VERSION } from './paths.mjs';
import { DocStore, BlobStore } from './store.mjs';
import { ensureServerCert } from './tls.mjs';

const LOCAL_EMAIL = 'local@edinot.local';
const TOKEN_TTL_S = 60 * 60 * 24 * 30;
const MB = 1024 * 1024;
const LIMITS = { label: 'Local', workspaces: 999, collab: false, devices: 999, storageBytes: 1024 * 1024 * MB, maxFileSize: 1024 * MB };

// ── JWT HS256 mínimo (sin dependencias) ─────────────────────────────────────
const b64u = (x) => Buffer.from(x).toString('base64url');
function signJwt(secret, claims, ttl = TOKEN_TTL_S) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...claims, iat: now, exp: now + ttl }));
  const sig = createHmac('sha256', secret).update(head + '.' + body).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('token mal formado');
  const good = createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (good.length !== given.length || !timingSafeEqual(good, given)) throw new Error('invalid signature');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) throw new Error('token caducado');
  return payload;
}
const sameSecret = (a, b) => {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
};

// ── Secretos y espacios de trabajo ──────────────────────────────────────────
function loadSecret(dir) {
  const file = hubSecretPath(dir);
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j.jwtSecret && j.key) return j;
  } catch {}
  const s = { jwtSecret: randomBytes(32).toString('hex'), key: randomBytes(24).toString('base64url') };
  writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch {}
  return s;
}

function loadWorkspaces(dir) {
  const file = path.join(dir, 'workspaces.json');
  let data = null;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  if (!data || !Array.isArray(data.list) || !data.list.length) {
    data = { nextId: 2, list: [{ id: 1, name: 'personal', createdAt: Date.now() }] };
    saveWorkspaces(dir, data);
  }
  return data;
}
function saveWorkspaces(dir, data) {
  const file = path.join(dir, 'workspaces.json');
  const tmp = file + '.tmp-' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

function freePort(preferred) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => (p === 0 ? resolve(0) : tryPort(0)));
      s.once('listening', () => { const got = s.address().port; s.close(() => resolve(got)); });
      s.listen(p, '127.0.0.1');
    };
    tryPort(preferred);
  });
}

const DOC_RX = /^ws:(\d+)(?::vault:([A-Za-z0-9_-]+)(?::note:([A-Za-z0-9_-]+))?)?$/;


// ── Emparejamiento y dispositivos ───────────────────────────────────────────
const PAIR_TTL_MS = 5 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L: easy to type without mistakes
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

function newCode() {
  const bytes = randomBytes(10);
  let c = '';
  for (let i = 0; i < 10; i++) c += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return c; // 10 caracteres ≈ 49 bits; se muestra como ABCDE-FGHJK
}
const normalizeCode = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const prettyCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
const hashCode = (c) => createHash('sha256').update(c).digest('hex');

function loadDevices(dir) {
  try {
    const j = JSON.parse(readFileSync(path.join(dir, 'devices.json'), 'utf8'));
    if (j && Array.isArray(j.list)) return j;
  } catch {}
  return { list: [] };
}
function saveDevices(dir, data) {
  const file = path.join(dir, 'devices.json');
  const tmp = file + '.tmp-' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

function portFree(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

// ── Candado: un solo hub por carpeta de datos ───────────────────────────────
// Dos hubs sobre los mismos archivos podrían pisarse. El candado se toma con
// `wx` (falla si existe) y contiene el pid; si ese proceso ya no existe, el
// candado es de un hub que murió y se retoma.
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return !!(err && err.code === 'EPERM'); }
}
const heldHere = new Set();   // candados que ESTE proceso tiene tomados ahora mismo
function acquireLock(dir) {
  const file = path.join(dir, 'hub.lock');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
      heldHere.add(file);
      return () => { heldHere.delete(file); try { if (readFileSync(file, 'utf8').trim() === String(process.pid)) unlinkSync(file); } catch {} };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      let owner = NaN;
      try { owner = Number(readFileSync(file, 'utf8').trim()); } catch {}
      // Un candado con MI pid que yo no tengo tomado es de un hub anterior con el mismo pid
      // (en un contenedor el pid es siempre 1): está muerto, se retoma.
      const mine = owner === process.pid && !heldHere.has(file);
      if (owner && !mine && pidAlive(owner)) {
        throw Object.assign(new Error(`a hub is already running (pid ${owner})`), { code: 'ALREADY_RUNNING', info: readHubInfo(dir) });
      }
      try { unlinkSync(file); } catch {}
    }
  }
  throw Object.assign(new Error('could not take the hub lock'), { code: 'LOCK_FAILED' });
}

// ── Servidor ────────────────────────────────────────────────────────────────
/**
 * Opciones (todas con valor por defecto o variable de entorno):
 *   host        dirección en la que escucha (EDINOT_HUB_HOST; por defecto solo este equipo, 127.0.0.1)
 *   publicUrl   dirección pública si va detrás de un proxy con HTTPS (EDINOT_HUB_PUBLIC_URL)
 *   allowedHosts  otros valores de «Host» aceptados, separados por comas (EDINOT_HUB_ALLOWED_HOSTS)
 *   pairTtlMs   validez de un código de emparejamiento (por defecto 5 min)
 *   connectionTimeoutMs  espera de autenticación por conexión (30 s; las pruebas lo bajan)
 */
export async function startHub({
  dir = hubDir(),
  port = Number(process.env.EDINOT_HUB_PORT) || DEFAULT_PORT,
  host = process.env.EDINOT_HUB_HOST || '127.0.0.1',
  publicUrl = process.env.EDINOT_HUB_PUBLIC_URL || null,
  allowedHosts = process.env.EDINOT_HUB_ALLOWED_HOSTS || '',
  tls = process.env.EDINOT_HUB_TLS == null ? undefined : !/^(0|no|false|off)$/i.test(process.env.EDINOT_HUB_TLS),
  renewCert = false,
  pairTtlMs = PAIR_TTL_MS,
  connectionTimeoutMs = 30000,
} = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const releaseLock = acquireLock(dir);
  try {
    const hub = await startLocked({ dir, port, host, publicUrl, extraHosts: allowedHosts, tls, renewCert, pairTtlMs, connectionTimeoutMs, releaseLock });
    return hub;
  } catch (err) {
    releaseLock();
    throw err;
  }
}

async function startLocked({ dir, port, host, publicUrl, extraHosts, tls, renewCert, pairTtlMs, connectionTimeoutMs, releaseLock }) {
  const secret = loadSecret(dir);
  const workspaces = loadWorkspaces(dir);
  const docs = new DocStore(dir);
  const blobs = new BlobStore(dir);
  // Solo este equipo (por defecto) o abierto a la red (`serving`: otros equipos se emparejan con él).
  const serving = !LOOPBACK.has(host) || !!publicUrl;
  // Cifrado: si el hub escucha fuera de este equipo, sirve él mismo por TLS con un certificado propio
  // (un proxy con HTTPS delante se pone con el hub en 127.0.0.1, o con --no-tls / EDINOT_HUB_TLS=0). El servidor de sincronización sigue escuchando
  // solo en este equipo (sin cifrar, no sale de aquí) y el TLS le pasa las conexiones ya descifradas.
  const tlsOn = tls === undefined ? (serving && !LOOPBACK.has(host)) : !!tls;
  if (tlsOn && publicUrl && /^http:/i.test(publicUrl)) publicUrl = publicUrl.replace(/^http:/i, 'https:');
  let realPort;
  let tlsPort = 0;
  if (tlsOn) {
    tlsPort = port;
    if (tlsPort !== 0 && !(await portFree(tlsPort, host))) throw Object.assign(new Error(`port ${tlsPort} is already in use`), { code: 'PORT_BUSY' });
    realPort = await freePort(0);
  } else if (serving && port !== 0) {
    if (!(await portFree(port, host))) throw Object.assign(new Error(`port ${port} is already in use`), { code: 'PORT_BUSY' });
    realPort = port;
  } else {
    realPort = await freePort(port);
  }
  let tlsMaterial = null;
  if (tlsOn) {
    let names = [];
    try { if (publicUrl) names = [new URL(publicUrl).hostname.replace(/^\[|\]$/g, '')]; } catch {}
    tlsMaterial = await ensureServerCert(dir, names, { renew: renewCert });
  }
  const allowedHosts = new Set([`127.0.0.1:${realPort}`, `localhost:${realPort}`, `[::1]:${realPort}`]);
  if (publicUrl) {
    try {
      const u = new URL(publicUrl);
      allowedHosts.add(u.host.toLowerCase());                       // con o sin puerto, como lo mande el cliente
      if (u.port === '' ) allowedHosts.add(u.hostname.toLowerCase());
    } catch { throw new Error(`EDINOT_HUB_PUBLIC_URL is not a valid address: ${publicUrl}`); }
  }
  for (const h of String(extraHosts || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) allowedHosts.add(h);
  const devices = loadDevices(dir);
  const pending = new Map();      // hash del código → { expiresAt }
  const attempts = new Map();     // ip → marcas de tiempo de intentos fallidos
  const tooMany = (ip, limit = 20) => {
    const now = Date.now();
    const arr = (attempts.get(ip) || []).filter(t => now - t < 60_000);
    attempts.set(ip, arr);
    return arr.length >= limit;
  };
  const failed = (ip) => { const arr = attempts.get(ip) || []; arr.push(Date.now()); attempts.set(ip, arr); };
  // Crea un código de emparejamiento (de un solo uso). Lo usan POST /pair/start y `edinot serve`.
  const createPairing = (baseUrl = null, scope = null) => {
    for (const [k, v] of pending) if (v.expiresAt < Date.now()) pending.delete(k);
    if (pending.size >= 5) return { error: 'several codes are already active; wait for them to expire' };
    const code = newCode();
    const expiresAt = Date.now() + pairTtlMs;
    pending.set(hashCode(code), { expiresAt, scope: scope || null });
    const base = baseUrl || publicUrl || null;
    const fpPart = tlsMaterial ? `&f=${tlsMaterial.fp}` : '';
    return { code, display: prettyCode(code), expiresAt, url: base, scope: scope || null, fingerprint: tlsMaterial ? tlsMaterial.fp : null,
      uri: base ? `edinot://pair?u=${encodeURIComponent(base)}&c=${code}${fpPart}` : null };
  };
  const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconocida').split(',')[0].trim();
  // La clave maestra solo vale desde ESTE equipo, directamente: si la petición llega con cabeceras de
  // proxy es que viene de fuera, aunque el proxy esté en la misma máquina.
  const isDirectLocal = (req) => LOOPBACK.has(req.socket.remoteAddress || '')
    && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'] && !req.headers['forwarded'];

  const wsView = () => workspaces.list.map(w => ({ id: w.id, name: w.name, role: 'owner', isOwn: true, ownerEmail: LOCAL_EMAIL }));
  const findWs = (id) => workspaces.list.find(w => w.id === Number(id));
  const authBody = (token, extra = {}) => ({
    token, email: LOCAL_EMAIL, userId: 1, tier: 'team', tierLabel: LIMITS.label, sync: true, expiresAt: 0,
    workspaces: wsView(), limits: LIMITS, hub: true, ...extra,
  });
  const mint = (deviceId = null) => signJwt(secret.jwtSecret, {
    sub: '1', email: LOCAL_EMAIL, tier: 'team', workspaces: wsView().map(w => w.id), hub: true, ...(deviceId ? { dev: deviceId } : {}),
  });
  // Valida un token; si es de un dispositivo emparejado, comprueba que no esté revocado.
  let lastTouch = 0;
  const authorize = (token) => {
    const claims = verifyJwt(secret.jwtSecret, token);
    if (claims.dev) {
      const d = devices.list.find(x => x.id === claims.dev);
      if (!d) throw new Error('device revoked');
      claims.scope = d.scope || null;
      const now = Date.now();
      if (now - (d.lastSeenAt || 0) > 60_000 && now - lastTouch > 5_000) {
        d.lastSeenAt = now; lastTouch = now;
        try { saveDevices(dir, devices); } catch {}
      }
    }
    return claims;
  };

  const cors = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Edinot-Filename, X-Edinot-Mime');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  };
  const send = (res, status, body) => {
    cors(res);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  const readJson = (req, limit = 1024 * 1024) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
  const readBuffer = (req, limit = 512 * MB) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const tokenOf = (req, url) => {
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('t') || url.searchParams.get('token') || '');
  };
  const notHere = (res) => send(res, 501, { error: 'Not available on the local hub (there is only one person and no public links).', code: 'local_hub' });

  async function handleHttp({ request: req, response: res }) {
    const url = new URL(req.url, 'http://hub.local');
    const p = url.pathname;
    const method = req.method;
    let m;

    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 421, { error: 'host not allowed' });
    if (method === 'OPTIONS') { cors(res); res.statusCode = 204; res.end(); return; }
    if (p === '/healthz') return send(res, 200, { ok: true, hub: true, version: HUB_VERSION, pid: process.pid });

    if (method === 'POST' && p === '/auth/login') {
      if (!isDirectLocal(req)) return send(res, 403, { error: 'the key only works from the hub\'s own computer; pair this device with a code', code: 'pair_required' });
      const ip = clientIp(req);
      if (tooMany(ip)) return send(res, 429, { error: 'too many attempts, wait a minute' });
      const body = await readJson(req);
      if (!body || !body.password || !sameSecret(body.password, secret.key)) {
        failed(ip);
        return send(res, 401, { error: 'invalid credentials' });
      }
      return send(res, 200, authBody(mint()));
    }

    // Canjear un código de emparejamiento: único endpoint sin token, con límite de intentos.
    if (method === 'POST' && p === '/pair/redeem') {
      const ip = clientIp(req);
      if (tooMany(ip, 10)) return send(res, 429, { error: 'too many attempts, wait a minute' });
      const body = await readJson(req);
      const code = normalizeCode(body && body.code);
      const h = code.length === 10 ? hashCode(code) : null;
      const entry = h && pending.get(h);
      if (!entry) { failed(ip); return send(res, 401, { error: 'invalid code', code: 'bad_code' }); }
      pending.delete(h);                                        // un solo uso, también si caducó
      if (entry.expiresAt < Date.now()) return send(res, 410, { error: 'the code has expired; generate another', code: 'expired' });
      const name = String((body && body.name) || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || 'unnamed device';
      const device = { id: randomBytes(6).toString('hex'), name, createdAt: Date.now(), lastSeenAt: Date.now(), ...(entry.scope ? { scope: entry.scope } : {}) };
      devices.list.push(device);
      saveDevices(dir, devices);
      return send(res, 200, authBody(mint(device.id), { deviceId: device.id, deviceName: device.name, ...(device.scope ? { scope: device.scope } : {}) }));
    }

    // Todo lo demás exige token.
    let claims;
    try { claims = authorize(tokenOf(req, url)); }
    catch (err) { return send(res, 401, { error: 'unauthorized: ' + err.message }); }

    if (p === '/auth/refresh' && method === 'POST') return send(res, 200, authBody(mint(claims.dev || null), claims.dev ? { deviceId: claims.dev, ...(claims.scope ? { scope: claims.scope } : {}) } : {}));

    // Un invitado (credencial con alcance: solo ciertos vaults) no administra el hub: ni emparejar,
    // ni ver o quitar equipos, ni importar/exportar documentos. Sí puede leer adjuntos (por su hash, que
    // no se adivina) y, si no es de solo lectura, subirlos.
    if (claims.scope) {
      const readish = method === 'GET' || method === 'HEAD';
      const ok = p === '/auth/me' || (p === '/workspaces' && method === 'GET') || p.startsWith('/me/')
        || /^\/workspaces\/\d+\/(members|grants\/me|snapshots)$/.test(p)
        || (p.startsWith('/blobs') && (readish || p === '/blobs/meta' || p === '/blobs/text' || (!claims.scope.readOnly && method === 'POST' && p === '/blobs')));
      if (!ok) return send(res, 403, { error: 'not allowed: this credential belongs to a shared access', code: 'scoped' });
    }

    // Crear un código para emparejar otro equipo.
    if (method === 'POST' && p === '/pair/start') {
      const body = await readJson(req);
      let scope = null;
      if (body && body.scope) {
        const vs = Array.isArray(body.scope.vaults) ? body.scope.vaults.map(String) : [];
        if (!vs.length || vs.length > 50 || !vs.every(v => /^[A-Za-z0-9_-]{1,64}$/.test(v))) return send(res, 400, { error: 'invalid scope: give 1 to 50 vault ids' });
        scope = { vaults: [...new Set(vs)], readOnly: !!body.scope.readOnly };
      }
      const r = createPairing(body && body.url, scope);
      return r.error ? send(res, 429, { error: r.error }) : send(res, 200, r);
    }
    if (p === '/devices' && method === 'GET') {
      return send(res, 200, { devices: devices.list.map(({ id, name, createdAt, lastSeenAt, scope }) => ({ id, name, createdAt, lastSeenAt, ...(scope ? { scope } : {}) })) });
    }
    m = p.match(/^\/devices\/([a-f0-9]{12})$/);
    if (m && method === 'DELETE') {
      const i = devices.list.findIndex(d => d.id === m[1]);
      if (i < 0) return send(res, 404, { error: 'device not found' });
      const [gone] = devices.list.splice(i, 1);
      saveDevices(dir, devices);
      // Corta sus conexiones abiertas: los demás dispositivos se reconectan solos; el revocado ya no pasa.
      try { server.closeConnections(); } catch {}
      return send(res, 200, { ok: true, revoked: gone.name });
    }
    if (p === '/auth/me' && method === 'GET') {
      return send(res, 200, { email: LOCAL_EMAIL, userId: 1, tier: 'team', status: 'active', sync: true, expiresAt: 0, workspaces: wsView(), limits: LIMITS });
    }

    if (p === '/workspaces') {
      if (method === 'GET') return send(res, 200, { workspaces: wsView() });
      if (method === 'POST') {
        const body = await readJson(req);
        const name = String((body && body.name) || '').trim();
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) return send(res, 400, { error: 'invalid name (a-z, 0-9, _ -, max 40)' });
        if (workspaces.list.some(w => w.name === name)) return send(res, 409, { error: 'workspace already exists' });
        const w = { id: workspaces.nextId++, name, createdAt: Date.now() };
        workspaces.list.push(w);
        saveWorkspaces(dir, workspaces);
        return send(res, 201, { ok: true, id: w.id, name });
      }
    }

    m = p.match(/^\/workspaces\/(\d+)\/members$/);
    if (m && method === 'GET') {
      if (!findWs(m[1])) return send(res, 404, { error: 'workspace not found' });
      return send(res, 200, { members: [{ userId: 1, email: LOCAL_EMAIL, role: 'owner' }], myRole: 'owner' });
    }
    m = p.match(/^\/workspaces\/(\d+)\/snapshots$/);
    if (m && method === 'GET') {
      if (!findWs(m[1])) return send(res, 404, { error: 'workspace not found' });
      const vault = url.searchParams.get('vault');
      return send(res, 200, vault ? { documentName: `ws:${m[1]}:vault:${vault}`, snapshots: [] } : { snapshots: [], byDoc: {} });
    }
    m = p.match(/^\/workspaces\/(\d+)\/grants\/me$/);
    if (m && method === 'GET') {
      if (!findWs(m[1])) return send(res, 404, { error: 'workspace not found' });
      return send(res, 200, { grants: [] }); // sin otras personas no hay permisos que restrinjan
    }
    m = p.match(/^\/workspaces\/(\d+)\/docs$/);
    if (m && method === 'GET') {
      if (!findWs(m[1])) return send(res, 404, { error: 'workspace not found' });
      const id = Number(m[1]);
      const docsOf = docs.listMeta(`ws:${id}`).filter(d => d.name === `ws:${id}` || d.name.startsWith(`ws:${id}:`));
      return send(res, 200, { docs: docsOf });
    }
    if (/^\/workspaces\//.test(p)) return notHere(res);

    // ── Notificaciones ──────────────────────────────────────────────────────
    // Con una sola persona no hay avisos de otros: bandeja vacía. El canal de
    // eventos se queda abierto (sin eventos): si respondiera 404, el navegador
    // reintentaría la conexión cada pocos segundos para siempre.
    if (p === '/me/notifications' && method === 'GET') return send(res, 200, { notifications: [], unread: 0 });
    if (p === '/me/notifications/unread-count' && method === 'GET') return send(res, 200, { unread: 0 });
    if (p === '/me/notifications/stream' && method === 'GET') {
      cors(res);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.write('retry: 60000\n\n');
      const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 25_000);
      const stopHb = () => clearInterval(hb);
      req.on('close', stopHb); req.on('error', stopHb);
      return; // no se cierra: el canal sigue abierto
    }
    if (p.startsWith('/me/notifications') && ['POST', 'DELETE'].includes(method)) return send(res, 200, { ok: true, updated: 0 });

    if (p === '/me/quota' && method === 'GET') {
      let used = 0;
      for (const id of blobs.list()) { const mt = blobs.meta(id); if (mt) used += mt.size; }
      return send(res, 200, { tier: 'team', sync: true, storageBytes: LIMITS.storageBytes, maxFileSize: LIMITS.maxFileSize, used, remaining: Math.max(0, LIMITS.storageBytes - used) });
    }

    // ── Importar / exportar el estado de un documento ───────────────────────
    // Lo usa `edinot hub pull` para traer copias de un servidor remoto. A
    // diferencia de abrir el documento por WebSocket, aquí NO se siembra el
    // texto desde el vault (sembrar y luego aplicar el estado real duplicaría el contenido).
    if (p === '/hub/docs') {
      const name = url.searchParams.get('name') || '';
      if (!DOC_RX.test(name)) return send(res, 400, { error: 'invalid document name' });
      const wsId = Number(DOC_RX.exec(name)[1]);
      if (!findWs(wsId)) return send(res, 404, { error: 'workspace not found' });
      if (method === 'GET') {
        const state = docs.get(name);
        if (!state) return send(res, 404, { error: 'not found' });
        cors(res); res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(state.length));
        res.end(state); return;
      }
      if (method === 'POST') {
        const update = await readBuffer(req);
        if (!update.length) return send(res, 400, { error: 'empty state' });
        const existed = docs.has(name);
        const isNote = /:note:/.test(name);
        if (existed && isNote && url.searchParams.get('merge') !== '1') {
          // Un documento de nota que ya está en el hub pudo nacer sembrado; mezclarlo duplicaría texto.
          return send(res, 409, { error: 'ya existe en el hub', code: 'exists' });
        }
        const conn = await server.openDirectConnection(name, { noSeed: true });
        try { await conn.transact((doc) => { Y.applyUpdate(doc, update, 'import'); }); }
        finally { await conn.disconnect(); }
        return send(res, 200, { ok: true, existed, bytes: update.length });
      }
    }

    // ── Adjuntos ────────────────────────────────────────────────────────────
    if (method === 'POST' && p === '/blobs') {
      const mime = String(req.headers['x-edinot-mime'] || req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().slice(0, 200);
      let filename = '';
      if (req.headers['x-edinot-filename']) { try { filename = decodeURIComponent(String(req.headers['x-edinot-filename'])).slice(0, 255); } catch {} }
      const r = await blobs.putStream(req, { mime, filename, maxBytes: LIMITS.maxFileSize });
      if (r.error === 'empty') return send(res, 400, { error: 'empty upload' });
      if (r.error) return send(res, 413, { error: 'file too large', code: 'file_too_large' });
      return send(res, 201, { ok: true, id: r.id, mime: r.mime, size: r.size, filename: r.filename, dedup: r.dedup, quotaUsed: 0, quotaLimit: LIMITS.storageBytes });
    }
    if (method === 'POST' && p === '/blobs/meta') {
      const body = await readJson(req);
      const ids = Array.isArray(body && body.ids) ? body.ids.slice(0, 500) : [];
      return send(res, 200, { blobs: ids.map(id => BlobStore.valid(id) && blobs.meta(id)).filter(Boolean) });
    }
    if (method === 'POST' && p === '/blobs/text') {
      // El hub no extrae texto de PDF/OCR todavía: se responde vacío en vez de fallar.
      await readJson(req);
      return send(res, 200, { blobs: [] });
    }
    m = p.match(/^\/blobs\/([a-f0-9]{64})(?:\/(meta|text))?$/i);
    if (m) {
      const sha = m[1].toLowerCase();
      const meta = blobs.meta(sha);
      if (method === 'GET' && m[2] === 'meta') return meta ? send(res, 200, meta) : send(res, 404, { error: 'not found' });
      if (method === 'GET' && m[2] === 'text') return meta ? send(res, 200, { id: sha, status: 'unsupported', source: 'none', tokens: 0, text: '' }) : send(res, 404, { error: 'not found' });
      if (method === 'DELETE') {
        // Nunca se borra un adjunto desde fuera: aquí vive la única copia local.
        return send(res, 200, { ok: true, tombstoned: false, freedBytes: 0 });
      }
      if (method === 'GET') {
        if (!meta) return send(res, 404, { error: 'not found' });
        cors(res);
        res.statusCode = 200;
        res.setHeader('Content-Type', meta.mime);
        res.setHeader('Content-Length', String(meta.size));
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        if (meta.filename) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
        await new Promise((resolve) => {
          const s = blobs.stream(sha);
          s.on('error', () => { try { res.end(); } catch {} resolve(); });
          res.on('close', resolve); res.on('finish', resolve);
          s.pipe(res);
        });
        return;
      }
    }

    return send(res, 404, { error: 'not found' });
  }

  // Un documento de nota suelta nace del contenido que ya tiene el vault.
  const seedNote = (name) => {
    const mn = name.match(/^ws:(\d+):vault:([A-Za-z0-9_-]+):note:([A-Za-z0-9_-]+)$/);
    if (!mn) return null;
    const vaultState = docs.get(`ws:${mn[1]}:vault:${mn[2]}`);
    if (!vaultState) return null;
    try {
      const src = new Y.Doc();
      Y.applyUpdate(src, vaultState);
      const text = src.getText('content:' + mn[3]).toString();
      if (!text) return null;
      const target = new Y.Doc();
      target.getText('content').insert(0, text);
      return Buffer.from(Y.encodeStateAsUpdate(target));
    } catch { return null; }
  };

  const server = new Hocuspocus({
    port: realPort,
    address: tlsOn ? '127.0.0.1' : host,
    timeout: connectionTimeoutMs,   // tiempo que espera Hocuspocus a que una conexión se autentique
    quiet: true,
    stopOnSignals: false,

    async onRequest(payload) {
      try { await handleHttp(payload); }
      catch (err) {
        if (!payload.response.headersSent) send(payload.response, 500, { error: 'internal hub error: ' + (err && err.message) });
      }
      throw null; // ya respondido: que Hocuspocus no escriba su 200 por defecto
    },

    async onAuthenticate({ token, documentName, requestHeaders, connection }) {
      const host = String((requestHeaders && requestHeaders.host) || '').toLowerCase();
      if (host && !allowedHosts.has(host)) throw new Error('host not allowed');
      if (!token) throw new Error('Token required');
      let claims;
      try { claims = authorize(token); } catch (err) { throw new Error('Invalid token: ' + err.message); }
      const m = DOC_RX.exec(documentName);
      if (!m) throw new Error('Invalid document name (expected ws:{id}[:vault:{vid}[:note:{nid}]])');
      // Acceso compartido: solo los vaults permitidos (con sus notas), en lectura o escritura según el
      // alcance. El documento «shell» del workspace (lista de vaults) solo se ofrece en lectura.
      if (claims.scope) {
        if (m[2]) {
          if (!claims.scope.vaults.includes(m[2])) throw new Error('no access to this vault');
          if (claims.scope.readOnly && connection) connection.readOnly = true;
        } else if (connection) connection.readOnly = true;
      }
      if (!findWs(m[1])) throw new Error('Workspace does not exist');
      return { user: { id: 1, email: LOCAL_EMAIL }, tier: 'team', workspaceId: Number(m[1]), vaultId: m[2] || null, noteId: m[3] || null, role: 'owner', readOnly: false };
    },

    extensions: [
      // Persistencia: cargar el estado guardado al abrir un documento y guardarlo
      // (con retardo) cada vez que cambia y al descargarlo.
      {
        async onLoadDocument({ document, documentName, context }) {
          const state = docs.get(documentName) || (context && context.noSeed ? null : seedNote(documentName));
          if (state) Y.applyUpdate(document, state);
          return document;
        },
        async onStoreDocument({ document, documentName }) {
          docs.set(documentName, Y.encodeStateAsUpdate(document));
        },
      },
    ],
  });

  await server.listen();
  let tlsServer = null;
  const tlsSockets = new Set();
  if (tlsOn) {
    tlsServer = tlsLib.createServer({ cert: tlsMaterial.cert, key: tlsMaterial.key, minVersion: 'TLSv1.2' }, (socket) => {
      tlsSockets.add(socket);
      socket.on('close', () => tlsSockets.delete(socket));
      socket.on('error', () => {});
      server.server.httpServer.emit('connection', socket);   // HTTP y WebSocket, como si llegaran en claro
    });
    tlsServer.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => { tlsServer.once('error', reject); tlsServer.listen(tlsPort, host, resolve); });
    tlsPort = tlsServer.address().port;
  }
  const info = {
    version: HUB_VERSION,
    url: `http://127.0.0.1:${realPort}`,   // para los clientes de ESTE equipo (CLI, MCP, app)
    publicUrl: publicUrl || null,
    host,
    serving,
    tls: tlsOn,
    fingerprint: tlsMaterial ? tlsMaterial.fp : null,
    port: tlsOn ? tlsPort : realPort,
    localPort: realPort,
    key: secret.key,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    dir,
  };
  writeFileSync(hubInfoPath(dir), JSON.stringify(info, null, 2), { mode: 0o600 });
  try { chmodSync(hubInfoPath(dir), 0o600); } catch {}

  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    // Corta ya las conexiones que queden: si no, `ws` espera hasta 30 s a que el otro lado complete el cierre.
    try { for (const c of server.server.webSocketServer.clients) c.terminate(); } catch {}
    try { for (const s of tlsSockets) s.destroy(); if (tlsServer) tlsServer.close(); } catch {}
    try { await server.destroy(); } catch {}
    try {
      const cur = readHubInfo(dir);
      if (cur && cur.pid === process.pid) unlinkSync(hubInfoPath(dir));
    } catch {}
    releaseLock();
  }
  return { server, info, stop, docs, blobs, workspaces, devices, createPairing };
}
