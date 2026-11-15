// Cifrado del hub sin dominio: certificado propio + huella fijada.
//
//  · Servidor: el hub genera una vez un certificado autofirmado (carpeta `tls/` de sus datos) y
//    sirve por TLS. Su huella (SHA-256) viaja en el enlace de emparejamiento (`&f=…`).
//  · Cliente: al emparejarse se lee el certificado del servidor, se comprueba que su huella es la
//    del enlace (canal aparte: nadie en medio puede cambiarla) y se guarda como única autoridad de
//    confianza para ese servidor. Desde entonces solo se acepta ESE certificado: no hay aviso que
//    pulsar ni «confiar por esta vez».
//
// Un hub detrás de un proxy con HTTPS normal (Caddy, nginx) no usa nada de esto.

import tls from 'node:tls';
import https from 'node:https';
import path from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import WebSocket from 'ws';

// ── Huellas ────────────────────────────────────────────────────────────────
export const fingerprintOfDer = (der) => createHash('sha256').update(der).digest('base64url');
export const fingerprintOfPem = (pem) => fingerprintOfDer(new X509Certificate(pem).raw);
const derToPem = (der) => '-----BEGIN CERTIFICATE-----\n' + Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END CERTIFICATE-----\n';
export const sameFingerprint = (a, b) => String(a || '').replace(/[^A-Za-z0-9_-]/g, '') === String(b || '').replace(/[^A-Za-z0-9_-]/g, '') && !!a;

// ── Servidor: certificado propio ───────────────────────────────────────────
function altNamesFor(names) {
  const out = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
  for (const n of names) {
    if (!n) continue;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(n)) out.push({ type: 7, ip: n });
    else if (!n.includes(':')) out.push({ type: 2, value: n });
  }
  return out;
}

/** Devuelve { cert, key, fp }; crea el certificado la primera vez (o si `renew`). */
export async function ensureServerCert(dir, names = [], { renew = false } = {}) {
  const tdir = path.join(dir, 'tls');
  const certFile = path.join(tdir, 'cert.pem');
  const keyFile = path.join(tdir, 'key.pem');
  if (!renew && existsSync(certFile) && existsSync(keyFile)) {
    const cert = readFileSync(certFile, 'utf8');
    try { return { cert, key: readFileSync(keyFile, 'utf8'), fp: fingerprintOfPem(cert) }; } catch { /* corrupto: se rehace */ }
  }
  const { generate } = await import('selfsigned');
  const pems = await generate([{ name: 'commonName', value: 'edinot-hub' }], {
    days: 7300, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: altNamesFor(names) }],
  });
  mkdirSync(tdir, { recursive: true, mode: 0o700 });
  writeFileSync(keyFile, pems.private, { mode: 0o600 });
  writeFileSync(certFile, pems.cert, { mode: 0o644 });
  try { chmodSync(keyFile, 0o600); } catch {}
  return { cert: pems.cert, key: pems.private, fp: fingerprintOfPem(pems.cert) };
}

// ── Cliente: leer el certificado de un servidor (solo para emparejar) ───────────
/** Conecta SIN validar y devuelve el certificado que presenta: { pem, fp }. El que llama debe comparar `fp`. */
export function probePeerCert(host, port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({
      host, port: Number(port), rejectUnauthorized: false,
      servername: /^[\d.]+$|:/.test(host) ? undefined : host,
    });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('el servidor no responde')); }, timeoutMs);
    sock.once('secureConnect', () => {
      clearTimeout(timer);
      const c = sock.getPeerCertificate(true);
      sock.end();
      if (!c || !c.raw) return reject(new Error('el servidor no presentó certificado'));
      resolve({ pem: derToPem(c.raw), fp: fingerprintOfDer(c.raw) });
    });
    sock.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Empareja la huella del enlace con el servidor: devuelve el certificado a fijar o lanza error. */
export async function pinFromLink(serverUrl, expectedFp) {
  const u = new URL(serverUrl);
  if (u.protocol !== 'https:') throw new Error('la dirección no es https');
  const peer = await probePeerCert(u.hostname.replace(/^\[|\]$/g, ''), u.port || 443);
  if (!sameFingerprint(peer.fp, expectedFp)) {
    throw new Error('la huella del servidor NO coincide con la del enlace: no te conectes (puede haber alguien en medio)');
  }
  return peer.pem;
}

// ── Cliente: fetch y WebSocket que solo aceptan el certificado fijado ───────────
const pins = new Map();   // origen (https://host:puerto) → certificado PEM

export function registerPin(url, pem) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && pem) pins.set(u.origin, pem);
  } catch {}
}
export const pinFor = (url) => { try { return pins.get(new URL(url).origin) || null; } catch { return null; } };

const NO_BODY = new Set([101, 204, 205, 304]);

/** Como `fetch`, pero si el origen tiene un certificado fijado solo acepta ese. */
export function hubFetch(url, init = {}) {
  const ca = pinFor(String(url));
  if (!ca) return fetch(url, init);
  return new Promise((resolve, reject) => {
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    let body = init.body;
    if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body)) body = Buffer.from(body.buffer ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : body);
    if (body != null && headers['content-length'] == null) headers['content-length'] = String(Buffer.byteLength(body));
    const req = https.request(new URL(url), {
      method: init.method || 'GET', headers, ca, checkServerIdentity: () => undefined, signal: init.signal,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v)) h.append(k, x);
        resolve(new Response(NO_BODY.has(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, statusText: res.statusMessage, headers: h }));
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/** Clase WebSocket para el proveedor de Yjs: fijada si el origen tiene certificado, la normal si no. */
export function webSocketFor(wsUrl) {
  let origin = '';
  try { const u = new URL(String(wsUrl)); u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'; origin = u.origin; } catch {}
  const ca = pins.get(origin);
  if (!ca) return WebSocket;
  return class PinnedWebSocket extends WebSocket {
    constructor(address, protocols) { super(address, protocols, { ca, checkServerIdentity: () => undefined }); }
  };
}
