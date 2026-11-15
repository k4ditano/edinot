const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const PORT_RANGE = [17800, 17801, 17802, 17803, 17804, 17805, 17810, 17811, 17812];
const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const RENDERER_TIMEOUT_MS = 20000;

function genToken() {
  return randomBytes(24).toString('base64url');
}

class ClipperServer {
  constructor({ app, getMainWindow, ipcMain }) {
    this.app = app;
    this.getMainWindow = getMainWindow;
    this.ipcMain = ipcMain;
    this.tokenFile = path.join(app.getPath('userData'), '.clipper-token');
    this.portFile = path.join(app.getPath('userData'), '.clipper-port');
    this.token = this._readToken();
    this.server = null;
    this.port = null;
    this.pending = new Map();
    this._listener = (_e, payload) => this._onRendererResponse(payload);
    this.ipcMain.on('clipper:response', this._listener);
  }

  _readToken() {
    try { return fs.readFileSync(this.tokenFile, 'utf8').trim() || null; }
    catch { return null; }
  }

  _writeToken(t) {
    try {
      fs.writeFileSync(this.tokenFile, t || '', { mode: 0o600 });
    } catch (err) {
      console.warn('[clipper] token write failed:', err.message);
    }
  }

  generateToken() {
    const t = genToken();
    this.token = t;
    this._writeToken(t);
    return t;
  }

  revokeToken() {
    this.token = null;
    try { fs.unlinkSync(this.tokenFile); } catch {}
  }

  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      hasToken: !!this.token,
      tokenPreview: this.token ? `${this.token.slice(0, 6)}…${this.token.slice(-4)}` : null,
      protocol: PROTOCOL_VERSION
    };
  }

  getToken() {
    return this.token;
  }

  _onRendererResponse(payload) {
    if (!payload || !payload.id) return;
    const entry = this.pending.get(payload.id);
    if (!entry) return;
    this.pending.delete(payload.id);
    clearTimeout(entry.timer);
    if (payload.ok) entry.resolve(payload.data ?? null);
    else entry.reject(new Error(payload.error || 'renderer_error'));
  }

  _askRenderer(kind, payload, timeoutMs = RENDERER_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const win = this.getMainWindow();
      if (!win || !win.webContents || win.webContents.isDestroyed()) {
        reject(new Error('app_window_unavailable'));
        return;
      }
      const id = randomBytes(8).toString('hex');
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('renderer_timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      win.webContents.send('clipper:request', { id, kind, payload });
    });
  }

  _checkAuth(req) {
    if (!this.token) return false;
    const h = req.headers['authorization'];
    if (!h || typeof h !== 'string') return false;
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    if (!m) return false;
    return m[1] === this.token;
  }

  _cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  _send(res, status, body) {
    this._cors(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }

  async _readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_PAYLOAD_BYTES) {
          reject(new Error('payload_too_large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async _handle(req, res) {
    if (req.method === 'OPTIONS') {
      this._cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    let pathname;
    try { pathname = new URL(req.url, 'http://x').pathname; }
    catch { pathname = req.url || ''; }

    if (!pathname.startsWith('/clipper/')) {
      this._send(res, 404, { ok: false, error: 'not_found' });
      return;
    }

    // /clipper/ping must be cheap + auth-checked so the extension can
    // probe the port range without leaking the running state to unauth
    // callers. 401 still confirms there's *a* clipper here.
    if (pathname === '/clipper/ping') {
      if (!this._checkAuth(req)) {
        this._send(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      this._send(res, 200, {
        ok: true,
        app: 'edinot',
        version: this.app.getVersion(),
        protocol: PROTOCOL_VERSION
      });
      return;
    }

    if (!this._checkAuth(req)) {
      this._send(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    try {
      if (pathname === '/clipper/vaults' && req.method === 'GET') {
        const data = await this._askRenderer('vaults', {});
        this._send(res, 200, data || { vaults: [], folders: [], templates: [] });
        return;
      }

      if (pathname === '/clipper/clip' && req.method === 'POST') {
        const raw = await this._readBody(req);
        let payload;
        try { payload = JSON.parse(raw); }
        catch { throw new Error('invalid_json'); }
        if (!payload || typeof payload.body !== 'string') throw new Error('missing_body');
        if (!payload.title || typeof payload.title !== 'string') throw new Error('missing_title');
        const data = await this._askRenderer('clip', payload, 30000);
        this._send(res, 200, { ok: true, ...(data || {}) });
        return;
      }

      this._send(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      const status = err.message === 'app_window_unavailable' ? 503
        : err.message === 'renderer_timeout' ? 504
        : err.message === 'payload_too_large' ? 413
        : 500;
      this._send(res, status, { ok: false, error: err.message });
    }
  }

  _tryBind(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this._handle(req, res).catch(err => {
          try { this._send(res, 500, { ok: false, error: err.message }); }
          catch {}
        });
      });
      const onError = (err) => { server.removeListener('listening', onListen); reject(err); };
      const onListen = () => { server.removeListener('error', onError); resolve(server); };
      server.once('error', onError);
      server.once('listening', onListen);
      server.listen(port, '127.0.0.1');
    });
  }

  async start() {
    if (!this.token) this.generateToken();
    let lastErr = null;
    for (const port of PORT_RANGE) {
      try {
        const server = await this._tryBind(port);
        this.server = server;
        this.port = port;
        try { fs.writeFileSync(this.portFile, String(port)); } catch {}
        return port;
      } catch (e) {
        lastErr = e;
        if (e && e.code !== 'EADDRINUSE') throw e;
      }
    }
    const err = new Error('no_port_available');
    err.cause = lastErr;
    throw err;
  }

  stop() {
    this.ipcMain.removeListener('clipper:response', this._listener);
    if (this.server) {
      try { this.server.close(); } catch {}
      this.server = null;
    }
    this.port = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('server_stopped'));
    }
    this.pending.clear();
  }
}

module.exports = { ClipperServer, genToken, PORT_RANGE, PROTOCOL_VERSION };
