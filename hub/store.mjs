// Almacén en disco del hub: documentos Yjs y adjuntos. Solo JavaScript puro
// (sin módulos nativos) para que el mismo código corra con Node o con el Node
// que lleva Electron.
//
// Seguridad de los datos (aquí vive tu única copia local):
//  · Cada escritura es atómica: archivo temporal + rename. Un corte de luz deja
//    el documento anterior entero, nunca uno a medias.
//  · Antes de sobrescribir se conserva el estado anterior en `<doc>.prev`.
//  · La primera vez que cambia un documento cada día se copia su versión previa
//    en backups/AAAA-MM-DD/ (se guardan 14 días).

import {
  mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, copyFileSync,
  readdirSync, rmSync, statSync, createWriteStream, createReadStream, unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const SHA_RX = /^[a-f0-9]{64}$/i;
const BACKUP_DAYS = 14;

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');
const today = () => new Date().toISOString().slice(0, 10);

function atomicWrite(file, data) {
  const tmp = file + '.tmp-' + process.pid + '-' + randomUUID().slice(0, 8);
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export class DocStore {
  constructor(dir) {
    this.dir = path.join(dir, 'docs');
    this.backups = path.join(dir, 'backups');
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(this.backups, { recursive: true });
    this._backedUp = new Set(); // `${day}|${file}` ya copiados hoy
    this.pruneBackups();
  }

  fileFor(name) { return path.join(this.dir, b64(name) + '.ydoc'); }

  get(name) {
    try { return readFileSync(this.fileFor(name)); } catch { return null; }
  }

  has(name) { return existsSync(this.fileFor(name)); }

  set(name, data) {
    const file = this.fileFor(name);
    if (existsSync(file)) {
      const day = today();
      const key = day + '|' + path.basename(file);
      if (!this._backedUp.has(key)) {
        try {
          const d = path.join(this.backups, day);
          mkdirSync(d, { recursive: true });
          const dest = path.join(d, path.basename(file));
          if (!existsSync(dest)) copyFileSync(file, dest);
        } catch { /* una copia fallida no debe impedir guardar */ }
        this._backedUp.add(key);
      }
      try { copyFileSync(file, file + '.prev'); } catch {}
    }
    atomicWrite(file, Buffer.from(data));
  }

  /** Nombres de todos los documentos guardados. */
  list(prefix = '') {
    const out = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.ydoc')) continue;
      try {
        const name = unb64(f.slice(0, -5));
        if (name.startsWith(prefix)) out.push(name);
      } catch {}
    }
    return out.sort();
  }

  /** Nombre, tamaño y fecha de cada documento (sin leer su contenido). */
  listMeta(prefix = '') {
    const out = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.ydoc')) continue;
      try {
        const name = unb64(f.slice(0, -5));
        if (!name.startsWith(prefix)) continue;
        const st = statSync(path.join(this.dir, f));
        out.push({ name, bytes: st.size, updatedAt: Math.round(st.mtimeMs) });
      } catch {}
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  pruneBackups() {
    try {
      const limit = new Date(Date.now() - BACKUP_DAYS * 86400e3).toISOString().slice(0, 10);
      for (const d of readdirSync(this.backups)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < limit) rmSync(path.join(this.backups, d), { recursive: true, force: true });
      }
    } catch {}
  }
}

export class BlobStore {
  constructor(dir) {
    this.dir = path.join(dir, 'blobs');
    mkdirSync(this.dir, { recursive: true });
    // Restos de subidas interrumpidas.
    try { for (const f of readdirSync(this.dir)) if (f.startsWith('.tmp-')) unlinkSync(path.join(this.dir, f)); } catch {}
  }

  static valid(sha) { return SHA_RX.test(String(sha || '')); }

  pathFor(sha) { return path.join(this.dir, sha.slice(0, 2), sha.slice(2, 4), sha); }
  metaPath(sha) { return this.pathFor(sha) + '.json'; }

  has(sha) { return existsSync(this.pathFor(sha)); }

  meta(sha) {
    if (!BlobStore.valid(sha) || !this.has(sha)) return null;
    let m = {};
    try { m = JSON.parse(readFileSync(this.metaPath(sha), 'utf8')); } catch {}
    let size = m.size;
    if (typeof size !== 'number') { try { size = statSync(this.pathFor(sha)).size; } catch { size = 0; } }
    return { id: sha.toLowerCase(), mime: m.mime || 'application/octet-stream', size, filename: m.filename || null };
  }

  /** Guarda lo que llega por `req` (flujo) calculando el hash al vuelo. */
  async putStream(req, { mime, filename, maxBytes = Infinity } = {}) {
    const tmp = path.join(this.dir, '.tmp-' + randomUUID());
    const hash = createHash('sha256');
    const sink = createWriteStream(tmp);
    let size = 0;
    let tooBig = false;
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        if (tooBig) return;
        size += chunk.length;
        if (size > maxBytes) { tooBig = true; sink.destroy(); try { req.destroy(); } catch {} return; }
        hash.update(chunk); sink.write(chunk);
      });
      req.on('end', () => sink.end());
      req.on('error', reject);
      sink.on('error', reject);
      sink.on('close', resolve);
    });
    if (tooBig) { try { unlinkSync(tmp); } catch {} return { error: 'too_big' }; }
    if (size === 0) { try { unlinkSync(tmp); } catch {} return { error: 'empty' }; }
    return this._commit(tmp, hash.digest('hex'), size, mime, filename);
  }

  putBuffer(buf, { mime, filename } = {}) {
    const tmp = path.join(this.dir, '.tmp-' + randomUUID());
    writeFileSync(tmp, buf);
    return this._commit(tmp, createHash('sha256').update(buf).digest('hex'), buf.length, mime, filename);
  }

  _commit(tmp, sha, size, mime, filename) {
    const final = this.pathFor(sha);
    mkdirSync(path.dirname(final), { recursive: true });
    const dedup = existsSync(final);
    if (dedup) { try { unlinkSync(tmp); } catch {} } else renameSync(tmp, final);
    if (!dedup || !existsSync(this.metaPath(sha))) {
      atomicWrite(this.metaPath(sha), JSON.stringify({ mime: mime || 'application/octet-stream', size, filename: filename || '' }));
    }
    return { id: sha, mime: mime || 'application/octet-stream', size, filename: filename || '', dedup };
  }

  stream(sha) { return createReadStream(this.pathFor(sha)); }

  /** Todos los hashes guardados (para comprobaciones y, más adelante, sincronizar). */
  list() {
    const out = [];
    for (const a of readdirSync(this.dir)) {
      if (a.length !== 2) continue;
      for (const b of readdirSync(path.join(this.dir, a))) {
        if (b.length !== 2) continue;
        for (const f of readdirSync(path.join(this.dir, a, b))) if (SHA_RX.test(f)) out.push(f.toLowerCase());
      }
    }
    return out;
  }
}
