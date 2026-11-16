const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell, ipcMain, protocol, net, Notification, powerMonitor, safeStorage, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* dev runs without dep installed */ }
const { ClipperServer } = require('./clipper.cjs');
let clipperServer = null;
let pendingDeepLinks = [];

app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');
// WebRTCPipeWireCapturer lets desktopCapturer reach the xdg-desktop-portal
// screencast API on Wayland sessions (GNOME/KDE/Hyprland) instead of getting
// black frames through XWayland.
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecodeLinuxGL,VaapiVideoEncoder,WebRTCPipeWireCapturer');

// `edinot://` is dual-purpose: electron-builder registers it at the OS level
// for deep links, and we register it here as a privileged in-app scheme so
// `protocol.handle('edinot', …)` can resolve `edinot://blob/<sha>` URLs
// embedded in note markdown. The two registrations don't conflict.
protocol.registerSchemesAsPrivileged([
  { scheme: 'edinot', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const DIST_DIR = path.join(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8',
};
let appUrl = null; // populated once HTTP server is listening

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isDev = !app.isPackaged;

// In packaged builds, build/resources/ isn't shipped with the asar bundle —
// extraResources copies the icon to <appResources>/app-icon.png. The name
// avoids `icon.png` because electron-builder also drops a copy of the
// source icon as `Resources/icon.png` during the mac bundle stage and the
// two writes raced to hardlink the same source file (EEXIST). In dev, fall
// back to the source path under build/resources/.
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app-icon.png')
  : path.join(__dirname, '..', 'build', 'resources', 'icon.png');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let currentLang = 'es';

// ── App log ─────────────────────────────────────────────────────────────
// Append-only text log at <userData>/edinot.log. Rotated when it crosses
// LOG_MAX_BYTES (keeps a single .1 backup). Captures uncaught exceptions
// (main process), renderer crashes / unresponsive / failed-load events,
// and explicit forwards from the renderer via the `log:append` IPC channel.
// Read back with `log:tail` or revealed in the file manager via
// `log:reveal` so a user can attach it to a bug report.
const LOG_FILE = path.join(app.getPath('userData'), 'edinot.log');
const LOG_FILE_PREV = path.join(app.getPath('userData'), 'edinot.log.1');
const LOG_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
function logRotateIfNeeded() {
  try {
    const st = fsSync.statSync(LOG_FILE);
    if (st.size < LOG_MAX_BYTES) return;
    try { fsSync.unlinkSync(LOG_FILE_PREV); } catch {}
    fsSync.renameSync(LOG_FILE, LOG_FILE_PREV);
  } catch { /* file may not exist yet — that's fine */ }
}
function logLine(level, source, msg, extra) {
  try {
    logRotateIfNeeded();
    const ts = new Date().toISOString();
    const lvl = String(level || 'info').toUpperCase();
    const src = String(source || '-');
    const body = typeof msg === 'string' ? msg : (() => {
      try { return JSON.stringify(msg); } catch { return String(msg); }
    })();
    const tail = extra ? (' ' + (typeof extra === 'string' ? extra : (() => {
      try { return JSON.stringify(extra); } catch { return String(extra); }
    })())) : '';
    fsSync.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fsSync.appendFileSync(LOG_FILE, `${ts}\t${lvl}\t${src}\t${body}${tail}\n`);
  } catch { /* never let logging crash the app */ }
}
function logTail(maxBytes = 200_000) {
  try {
    const st = fsSync.statSync(LOG_FILE);
    const fd = fsSync.openSync(LOG_FILE, 'r');
    try {
      const len = Math.min(maxBytes, st.size);
      const buf = Buffer.alloc(len);
      fsSync.readSync(fd, buf, 0, len, Math.max(0, st.size - len));
      return buf.toString('utf8');
    } finally { fsSync.closeSync(fd); }
  } catch { return ''; }
}
process.on('uncaughtException', (err) => {
  logLine('error', 'main:uncaught', err && err.message, err && err.stack);
});
process.on('unhandledRejection', (reason) => {
  const r = reason && reason.message ? reason.message : reason;
  logLine('error', 'main:unhandledRejection', r, reason && reason.stack);
});
// Renderer crash recovery. Most commonly triggered after a suspend/resume
// cycle: the GPU process loses its driver context, the IPC pipe breaks,
// and Chromium kills the renderer with exit code 133 (SIGTRAP). The
// window stays open but white. We auto-reload the renderer once (per
// cycle) so the user doesn't have to quit + reopen. Backoff guards
// against a true reload loop.
let __rendererReloadTs = 0;
let __rendererReloadCount = 0;
app.on('render-process-gone', (_e, wc, details) => {
  const reason = details && details.reason;
  logLine('error', 'renderer:gone', reason, details);
  // killed/exited cleanly is something else (window closed); only react
  // to actual crashes ('crashed', 'oom', 'abnormal-exit').
  const recoverable = reason === 'crashed' || reason === 'oom' || reason === 'abnormal-exit';
  if (!recoverable) return;
  const now = Date.now();
  if (now - __rendererReloadTs > 60_000) __rendererReloadCount = 0;
  __rendererReloadTs = now;
  __rendererReloadCount++;
  if (__rendererReloadCount > 3) {
    logLine('error', 'renderer:reload-bailout', 'too many crashes in 60s — manual reload required');
    return;
  }
  try {
    if (wc && !wc.isDestroyed()) {
      logLine('info', 'renderer:reload', `attempt ${__rendererReloadCount}`);
      wc.reload();
    }
  } catch (err) {
    logLine('error', 'renderer:reload-fail', err && err.message);
  }
});
app.on('child-process-gone', (_e, details) => {
  logLine('error', 'child:gone', details && details.reason, details);
});

// Recovery on system resume. Reload ONLY if the renderer actually died
// (stale GPU context / broken IPC → white screen). An unconditional
// reload here used to reboot a healthy renderer on every wake, racing
// vault rehydration against a network that's still down — the editor
// came back with the active note unresolvable ("untitled" empty pane).
// A live renderer just needs the sync-socket kick (`power:resume` IPC,
// wired below in whenReady). powerMonitor needs `app.whenReady` so we
// defer setup.
app.whenReady().then(() => {
  try {
    const { powerMonitor } = require('electron');
    powerMonitor.on('resume', () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isCrashed()) {
          logLine('info', 'power:resume', 'renderer dead after wake — reloading');
          mainWindow.webContents.reload();
        }
      } catch (err) {
        logLine('error', 'power:resume-fail', err && err.message);
      }
    });
  } catch (err) {
    logLine('error', 'power:setup-fail', err && err.message);
  }
});
logLine('info', 'app:start', `version=${app.getVersion()} platform=${process.platform} electron=${process.versions.electron}`);

const MENU_I18N = {
  es: {
    'tray.show': 'Mostrar Edinot', 'tray.newNote': 'Nueva nota', 'tray.quit': 'Salir',
    'tray.autostart': 'Iniciar con el sistema',
    'menu.file': 'Archivo', 'menu.edit': 'Editar', 'menu.view': 'Ver', 'menu.window': 'Ventana',
    'menu.new': 'Nuevo', 'menu.open': 'Abrir…', 'menu.import': 'Importar…',
    'menu.save': 'Guardar', 'menu.saveAs': 'Guardar como…',
    'menu.exportBundle': 'Exportar con adjuntos…', 'menu.exportWs': 'Exportar workspace…',
    'menu.hideTray': 'Ocultar a bandeja', 'menu.quit': 'Salir',
    'menu.toggleRender': 'Alternar renderizado',
  },
  en: {
    'tray.show': 'Show Edinot', 'tray.newNote': 'New note', 'tray.quit': 'Quit',
    'tray.autostart': 'Launch at startup',
    'menu.file': 'File', 'menu.edit': 'Edit', 'menu.view': 'View', 'menu.window': 'Window',
    'menu.new': 'New', 'menu.open': 'Open…', 'menu.import': 'Import…',
    'menu.save': 'Save', 'menu.saveAs': 'Save As…',
    'menu.exportBundle': 'Export with attachments…', 'menu.exportWs': 'Export workspace…',
    'menu.hideTray': 'Hide to tray', 'menu.quit': 'Quit',
    'menu.toggleRender': 'Toggle Render',
  },
};
function mt(key) {
  return (MENU_I18N[currentLang] && MENU_I18N[currentLang][key]) || MENU_I18N.es[key] || key;
}

// Pending paths queued before mainWindow is ready (file association launch).
const pendingExternalOpens = [];

function isMarkdownLike(filePath) {
  return /\.(md|markdown|txt)$/i.test(filePath || '');
}

function collectFilePathsFromArgv(argv) {
  // First arg is Electron binary; on Windows / Linux extra positional args
  // after that are files passed by the OS file association handler.
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith('-')) continue;
    if (a === '.' || a === '..') continue;
    if (a.startsWith('edinot://')) continue;
    if (isMarkdownLike(a)) out.push(path.resolve(a));
  }
  return out;
}

function collectDeepLinksFromArgv(argv) {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a === 'string' && a.startsWith('edinot://')) out.push(a);
  }
  return out;
}

function dispatchDeepLinks(urls) {
  for (const url of urls) {
    if (!url || typeof url !== 'string') continue;
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('deeplink:open', { url });
      showApp();
    } else {
      pendingDeepLinks.push(url);
    }
  }
}

function drainPendingDeepLinks() {
  if (!mainWindow || !pendingDeepLinks.length) return;
  const queued = pendingDeepLinks.splice(0);
  for (const url of queued) {
    mainWindow.webContents.send('deeplink:open', { url });
  }
  showApp();
}

// Register this app as the OS handler for edinot:// URLs so the deep links
// a Web Clipper note returns actually open it. electron-builder's `protocols`
// only wires this up for installed packages (.deb/.dmg/.exe); a bare Linux
// AppImage is never "installed", so we register a desktop entry by hand,
// pointing Exec at $APPIMAGE (the real .AppImage path — execPath would be the
// throwaway FUSE mount that vanishes next launch). Idempotent: only rewrites
// when the file content actually changes.
function registerProtocolClient() {
  try {
    if (process.platform === 'linux' && process.env.APPIMAGE) {
      const appImage = process.env.APPIMAGE;
      const appsDir = path.join(app.getPath('home'), '.local', 'share', 'applications');
      const desktopName = 'edinot-url-handler.desktop';
      const desktopFile = path.join(appsDir, desktopName);
      const content = [
        '[Desktop Entry]',
        'Name=Edinot',
        'Exec=' + appImage + ' %u',
        'Icon=edinot',
        'Type=Application',
        'Terminal=false',
        'NoDisplay=true',
        'MimeType=x-scheme-handler/edinot;',
        'StartupWMClass=Edinot',
        '',
      ].join('\n');
      fsSync.mkdirSync(appsDir, { recursive: true });
      let current = null;
      try { current = fsSync.readFileSync(desktopFile, 'utf8'); } catch {}
      if (current !== content) {
        fsSync.writeFileSync(desktopFile, content);
        // Async: con spawnSync esto bloqueaba el proceso principal hasta 8 s
        // justo mientras cargaba la ventana (pasa en cada AppImage nueva).
        const run = (cmd, args) => new Promise((resolve) => {
          try {
            const child = spawn(cmd, args, { stdio: 'ignore' });
            const kill = setTimeout(() => { try { child.kill(); } catch {} }, 4000);
            child.on('error', () => { clearTimeout(kill); resolve(); });
            child.on('exit', () => { clearTimeout(kill); resolve(); });
          } catch { resolve(); }
        });
        run('update-desktop-database', [appsDir])
          .then(() => run('xdg-mime', ['default', desktopName, 'x-scheme-handler/edinot']));
      }
      // NB: do NOT also call app.setAsDefaultProtocolClient here — on Linux it
      // re-registers the main edinot.desktop (Exec …%F, for files) as the
      // scheme default, clobbering the dedicated %u handler we just wrote.
    } else {
      app.setAsDefaultProtocolClient('edinot');
    }
  } catch (err) {
    console.warn('[deeplink] protocol register failed:', err.message);
  }
}

async function dispatchExternalOpens(paths) {
  for (const p of paths) {
    if (!isMarkdownLike(p)) continue;
    try {
      const content = await fs.readFile(p, 'utf8');
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send('file:externalOpen', { path: p, content });
        showApp();
      } else {
        pendingExternalOpens.push(p);
      }
    } catch (err) {
      console.warn('[external-open] failed:', p, err.message);
    }
  }
}

async function drainPendingOpens() {
  if (!mainWindow || !pendingExternalOpens.length) return;
  const queued = pendingExternalOpens.splice(0);
  for (const p of queued) {
    try {
      const content = await fs.readFile(p, 'utf8');
      mainWindow.webContents.send('file:externalOpen', { path: p, content });
    } catch {}
  }
}

// macOS — fired both at launch and while running.
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  dispatchExternalOpens([filePath]);
});

// macOS — edinot:// URLs from web browsers / OS handoffs land here.
app.on('open-url', (e, url) => {
  e.preventDefault();
  dispatchDeepLinks([url]);
});

// Single instance — when launched again, focus existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    dispatchExternalOpens(collectFilePathsFromArgv(argv));
    dispatchDeepLinks(collectDeepLinksFromArgv(argv));
    showApp();
  });

  app.whenReady().then(async () => {
    bootTimes.ready = Math.round(performance.now());
    try { installTlsPinning(); } catch (err) { console.error('[tls] no se pudo instalar la fijación de certificados', err); }
    await startLoopbackServer();
    registerBlobProtocol();
    ensureStableMcpServer();
    buildMenu();
    initAutoStartDefault();
    createTray();
    createWindow();
    // Initial launch: drain argv (Windows/Linux file association)
    dispatchExternalOpens(collectFilePathsFromArgv(process.argv));
    dispatchDeepLinks(collectDeepLinksFromArgv(process.argv));
    initAutoUpdater();
    // Trabajo que no hace falta para el primer frame: el watcher recursivo
    // del export (en Linux recorre todo el árbol) y el registro del esquema
    // edinot:// esperan a que la ventana se haya pintado.
    afterFirstPaint(() => {
      startExportWatcher();
      registerProtocolClient();
    });

    // Wake from OS suspend: the renderer's single shared sync socket is stale
    // and would otherwise wait ~30s to notice. Nudge it to reconnect now.
    try {
      powerMonitor.on('resume', () => {
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('power:resume');
        }
      });
    } catch (err) { console.warn('[power] resume hook failed:', err.message); }

    // Web Clipper loopback server — separate from the UI loopback so its
    // port is predictable (rotation 17800-17812) and the browser extension
    // can probe it without knowing the random UI port.
    try {
      clipperServer = new ClipperServer({
        app,
        ipcMain,
        getMainWindow: () => mainWindow,
      });
      const port = await clipperServer.start();
      console.log(`[clipper] listening on 127.0.0.1:${port}`);
    } catch (err) {
      console.warn('[clipper] failed to start:', err.message);
    }

    app.on('activate', () => {
      // macOS dock click
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showApp();
    });
  });
}

// Loopback cache policy (see startLoopbackServer): hashed renderer chunks
// are immutable; everything else is revalidated with a content ETag.
const HASHED_ASSET_RE = /^\/app\/[^/]+-[A-Z0-9]{8}\.(?:js|css|map)$/;
const loopbackEtags = new Map(); // path → { key, etag }
function loopbackEtag(file, stat) {
  const key = `${stat.size}:${stat.mtimeMs}`;
  const hit = loopbackEtags.get(file);
  if (hit && hit.key === key) return hit.etag;
  try {
    const h = createHash('sha1').update(fsSync.readFileSync(file)).digest('base64url').slice(0, 20);
    // The app version rides along so an update can never collide with a
    // cached copy even if a file's bytes happened to repeat.
    const etag = `"${app.getVersion()}-${h}"`;
    loopbackEtags.set(file, { key, etag });
    return etag;
  } catch { return null; }
}

function startLoopbackServer() {
  // YouTube IFrame embeds (since late 2025) require a real http(s) parent
  // origin with a proper Referer header. Custom protocols (file://, app://)
  // trigger "Video player configuration error" / error 153. So we serve
  // dist/ over 127.0.0.1.
  //
  // The port is persisted to userData/.app-port and reused on every launch.
  // Chromium scopes localStorage by origin = scheme + host + port, so a
  // randomly-chosen port on each start would silently wipe the user's
  // sync token + sign them out across every restart (and every auto-update).
  // Reusing the previous port keeps the origin stable.
  return new Promise((resolve, reject) => {
    const PORT_FILE = path.join(app.getPath('userData'), '.app-port');
    let preferred = 0;
    try {
      const raw = fsSync.readFileSync(PORT_FILE, 'utf8').trim();
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 1024 && n < 65536) preferred = n;
    } catch {}

    const server = http.createServer((req, res) => {
      try {
        let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (!rel || rel === '/') rel = '/index.html';
        const resolved = path.normalize(path.join(DIST_DIR, rel));
        if (!resolved.startsWith(DIST_DIR)) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
        fsSync.stat(resolved, (err, stat) => {
          if (err || !stat.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
          const ext = path.extname(resolved).toLowerCase();
          const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
          if (HASHED_ASSET_RE.test(rel)) {
            // Content-hashed chunk (dist/app/*-HASH.js): its bytes can never
            // change under this name, so Chromium may keep it — and the V8
            // code cache attached to it — forever. A new build (or an
            // auto-update) ships new names referenced by a new index.html.
            headers['Cache-Control'] = 'public, max-age=31536000, immutable';
          } else {
            // index.html and the unhashed files (css, fonts, ipc-glue.js):
            // always revalidate. On loopback a 304 costs nothing and keeps
            // the cached copy (and its code cache) when nothing changed.
            const etag = loopbackEtag(resolved, stat);
            headers['Cache-Control'] = 'no-cache';
            if (etag) {
              headers['ETag'] = etag;
              if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
            }
          }
          res.writeHead(200, headers);
          fsSync.createReadStream(resolved).pipe(res);
        });
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });

    const onListening = () => {
      const { port } = server.address();
      try { fsSync.writeFileSync(PORT_FILE, String(port)); } catch {}
      appUrl = `http://127.0.0.1:${port}/index.html`;
      resolve();
    };

    const onError = (err) => {
      // If the preferred port is taken (rare on loopback), fall back to a
      // fresh random one. This means a one-time logout for that user, but
      // every subsequent launch reuses the new saved port.
      if (preferred && err && err.code === 'EADDRINUSE') {
        server.removeListener('error', onError);
        server.once('listening', onListening);
        server.once('error', reject);
        server.listen(0, '127.0.0.1');
        return;
      }
      reject(err);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(preferred || 0, '127.0.0.1');
  });
}

// Tiempos de arranque del proceso principal (ms desde que arrancó el
// proceso). Una sola línea en el log cuando la ventana está lista.
const bootTimes = { ready: null, window: null, readyToShow: null };
// Tareas aplazadas hasta después del primer paint de la ventana principal.
// Si la ventana ya se mostró (o arranca oculta en la bandeja y nunca emite
// ready-to-show a tiempo), un fallback de 3 s las ejecuta igualmente.
const firstPaintQueue = [];
function afterFirstPaint(fn) {
  if (bootTimes.readyToShow != null) { setTimeout(fn, 0); return; }
  firstPaintQueue.push(fn);
  setTimeout(() => {
    const i = firstPaintQueue.indexOf(fn);
    if (i >= 0) { firstPaintQueue.splice(i, 1); try { fn(); } catch {} }
  }, 3000);
}

function createWindow() {
  if (bootTimes.window == null) bootTimes.window = Math.round(performance.now());
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#F8F8F4', // fondo del tema por defecto del rediseño
    title: 'Edinot',
    icon: ICON_PATH,
    show: false,
    // macOS: traffic lights overlaid inside hidden titlebar.
    // Windows + Linux: frameless — we render custom min/max/close as DOM
    // buttons in the titlebar. On Windows this replaces the native
    // titleBarOverlay (WCO), whose controls were painted by the OS on top of
    // ALL web content, so they floated above modals (image lightbox) and
    // collided with content when the window shrank. DOM controls live in the
    // normal stacking order, so modals (z-index ≥ 200) cover them correctly.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: false,
    frame: isMac,
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  // Spanish and English together: without this the dictionary is the system
  // locale's only, and every word in the other language is marked as a typo.
  // (macOS uses its own checker and ignores the list.)
  if (!isMac) {
    try {
      const ses = mainWindow.webContents.session;
      const have = new Set(ses.availableSpellCheckerLanguages || []);
      const langs = ['es-ES', 'es', 'en-US', 'en-GB'].filter(l => have.has(l));
      const pick = [langs.find(l => l.startsWith('es')), langs.find(l => l.startsWith('en'))].filter(Boolean);
      if (pick.length) ses.setSpellCheckerLanguages(pick);
    } catch (err) { logLine('warn', 'main:spellcheck', err && err.message); }
  }

  mainWindow.once('ready-to-show', () => {
    if (!shouldStartHidden()) mainWindow.show();
    if (bootTimes.readyToShow != null) return;
    bootTimes.readyToShow = Math.round(performance.now());
    logLine('info', 'main:perf', `boot app-ready=${bootTimes.ready}ms window=${bootTimes.window}ms ready-to-show=${bootTimes.readyToShow}ms`);
    const queued = firstPaintQueue.splice(0);
    setTimeout(() => { for (const fn of queued) { try { fn(); } catch (err) { logLine('warn', 'main:after-paint', err && err.message); } } }, 0);
  });
  mainWindow.webContents.once('did-finish-load', () => { drainPendingOpens(); drainPendingDeepLinks(); });
  mainWindow.webContents.on('unresponsive', () => logLine('warn', 'renderer:unresponsive', 'window stopped responding'));
  mainWindow.webContents.on('responsive', () => logLine('info', 'renderer:responsive', 'window recovered'));
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => logLine('error', 'renderer:did-fail-load', desc, { code, url }));
  mainWindow.webContents.on('preload-error', (_e, preloadPath, err) => logLine('error', 'renderer:preload-error', err && err.message, { preloadPath }));
  mainWindow.on('unresponsive', () => logLine('warn', 'window:unresponsive', 'window stopped responding'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Close → hide to tray (do not quit unless user asked)
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
    if (isMac && app.dock && app.dock.hide) app.dock.hide();
  });

  mainWindow.loadURL(appUrl);

  // DevTools sólo a petición (EDINOT_DEVTOOLS=1): antes se abría sola en
  // cualquier arranque sin empaquetar (npx electron .) y tapaba la pantalla.
  // Siempre quedan a mano en Ver → Herramientas de desarrollo.
  if (/^(1|true|yes)$/i.test(String(process.env.EDINOT_DEVTOOLS || ''))) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function showApp() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  if (isMac && app.dock && app.dock.show) app.dock.show();
  mainWindow.focus();
}

// ── Launch-at-startup (reminders reliability) ─────────────────────────
// Reminders are scheduled in this main process and fire from the tray even
// with the window closed — but only while the process is alive. Without
// autostart, a reboot silently kills all pending reminders. So we default
// it ON once (first run), start hidden into the tray on a login launch, and
// expose a tray checkbox to turn it off. The OS persists the login-item
// state, so getLoginItemSettings() is the source of truth for the toggle.
const AUTOSTART_MARKER = path.join(app.getPath('userData'), '.autostart-initialized');

function setAutoStart(enabled) {
  if (isDev) return;   // never register the dev electron binary
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: !!enabled,                 // macOS: start hidden into tray
      args: enabled ? ['--hidden'] : [],       // Win/Linux: our start-in-tray flag
    });
  } catch (err) { logLine('warn', 'autostart:set-fail', err && err.message); }
}

function isAutoStartOn() {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch { return false; }
}

// Enable by default the first time only; respect the user's choice afterwards.
function initAutoStartDefault() {
  if (isDev) return;
  try {
    if (!fsSync.existsSync(AUTOSTART_MARKER)) {
      setAutoStart(true);
      fsSync.writeFileSync(AUTOSTART_MARKER, '1');
    }
  } catch (err) { logLine('warn', 'autostart:init-fail', err && err.message); }
}

// True when this launch should stay in the tray (login autostart), so the
// scheduler runs without stealing focus on every boot.
function shouldStartHidden() {
  if (process.argv.includes('--hidden')) return true;
  try {
    const s = app.getLoginItemSettings();
    return !!(s.wasOpenedAtLogin && s.wasOpenedAsHidden);
  } catch { return false; }
}

function createTray() {
  let img = nativeImage.createFromPath(ICON_PATH);
  // macOS tray expects a small template-ish image
  if (isMac) img = img.resize({ width: 18, height: 18 });
  else img = img.resize({ width: 22, height: 22 });

  tray = new Tray(img);
  tray.setToolTip('Edinot');

  const menu = Menu.buildFromTemplate([
    { label: mt('tray.show'), click: () => showApp() },
    { label: mt('tray.newNote'), click: () => { showApp(); mainWindow && mainWindow.webContents.send('menu:new'); } },
    { type: 'separator' },
    { label: mt('tray.autostart'), type: 'checkbox', checked: isAutoStartOn(), click: (item) => setAutoStart(item.checked) },
    { type: 'separator' },
    { label: mt('tray.quit'), click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);

  // Left-click toggles window (Linux/Windows). macOS shows menu by default; also handle click.
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      showApp();
    }
  });
  tray.on('double-click', () => showApp());
}

// Aceleradores del menú personalizables desde Ajustes → Atajos (el renderer
// manda { itemId: 'CmdOrCtrl+…' | null }). Sin entrada = el de siempre.
let menuAccelOverrides = {};
const DEFAULT_ACCELS = {
  new: 'CmdOrCtrl+N', open: 'CmdOrCtrl+O', import: 'CmdOrCtrl+Alt+I', save: 'CmdOrCtrl+S',
  saveAs: 'CmdOrCtrl+Shift+S', exportBundle: 'CmdOrCtrl+Alt+Shift+S', hideTray: 'CmdOrCtrl+W',
  toggleRender: 'CmdOrCtrl+/',
};
function accel(id) {
  if (Object.prototype.hasOwnProperty.call(menuAccelOverrides, id)) return menuAccelOverrides[id] || undefined;
  return DEFAULT_ACCELS[id];
}

function buildMenu() {
  const send = (ch, ...args) => mainWindow && mainWindow.webContents.send(ch, ...args);

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: mt('menu.quit'), accelerator: 'Cmd+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    }] : []),
    {
      label: mt('menu.file'),
      submenu: [
        { label: mt('menu.new'), accelerator: accel('new'), click: () => send('menu:new') },
        { label: mt('menu.open'), accelerator: accel('open'), click: openFile },
        { label: mt('menu.import'), accelerator: accel('import'), click: () => send('menu:import') },
        { label: mt('menu.save'), accelerator: accel('save'), click: () => send('menu:save') },
        { label: mt('menu.saveAs'), accelerator: accel('saveAs'), click: () => send('menu:saveAs') },
        { label: mt('menu.exportBundle'), accelerator: accel('exportBundle'), click: () => send('menu:saveAsBundle') },
        { label: mt('menu.exportWs'), click: () => send('menu:exportWorkspace') },
        { type: 'separator' },
        { label: mt('menu.hideTray'), accelerator: accel('hideTray'), click: () => mainWindow && mainWindow.hide() },
        ...(isMac ? [] : [{ label: mt('menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit(); } }]),
      ],
    },
    {
      label: mt('menu.edit'),
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: mt('menu.view'),
      submenu: [
        { label: mt('menu.toggleRender'), accelerator: accel('toggleRender'), click: () => send('menu:toggleRender') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: mt('menu.window'),
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openFile() {
  if (!mainWindow) return;
  const res = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return;
  const filePath = res.filePaths[0];
  try {
    const content = await fs.readFile(filePath, 'utf8');
    mainWindow.webContents.send('file:opened', { path: filePath, content });
  } catch (err) {
    dialog.showErrorBox('Open failed', String(err));
  }
}

ipcMain.handle('file:save', async (_e, { path: filePath, content }) => {
  let target = filePath;
  if (!target) {
    const res = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: 'untitled.md',
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    target = res.filePath;
  }
  await fs.writeFile(target, content, 'utf8');
  return { canceled: false, path: target };
});

// ─── Disk export (Y.Doc → .md, one-way) ──────────────────────────────────
// Mirror snapshot of every note as <userData>/vault-export/<vault>/<name>.md.
// Renderer sends a "snapshot" of all files + vaults (debounced). Main writes
// only what changed, renames on name/vault change, removes deletions.
// Tracking table is in-memory; on first apply after launch it reconciles
// against an on-disk index file.
const EXPORT_ROOT = path.join(app.getPath('userData'), 'vault-export');
const EXPORT_INDEX = path.join(EXPORT_ROOT, '.edinot-index.json');
let exportIndex = null; // { [fileId]: { relPath, contentLen, contentHash } }

// Truncated SHA-256 used to fingerprint exported file contents. Short hashes
// are fine here — we're not chasing collisions, just detecting "this is the
// exact byte sequence we just wrote, so the fs.watch event is our own echo
// and we must NOT push it back to the renderer (would clobber concurrent
// typing)".
function fingerprintContent(s) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(String(s == null ? '' : s), 'utf8').digest('hex').slice(0, 16);
}

function sanitizeSeg(s) {
  return String(s || 'untitled')
    .replace(/[\/\\:*?"<>|\0]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/\s+$/, '')
    .slice(0, 120) || 'untitled';
}

async function loadExportIndex() {
  if (exportIndex) return exportIndex;
  try {
    const raw = await fs.readFile(EXPORT_INDEX, 'utf8');
    exportIndex = JSON.parse(raw) || {};
  } catch { exportIndex = {}; }
  return exportIndex;
}

async function saveExportIndex() {
  await fs.mkdir(EXPORT_ROOT, { recursive: true });
  await fs.writeFile(EXPORT_INDEX, JSON.stringify(exportIndex, null, 2), 'utf8');
}

function buildRelPath(vaults, folders, file) {
  const vault = vaults.find(v => v.id === (file.vaultId || 'default'));
  const vaultName = sanitizeSeg(vault ? vault.name : 'default');
  const rawName = (file.name || 'untitled').replace(/\.(md|markdown|txt)$/i, '');
  const name = sanitizeSeg(rawName);
  // Walk folder chain upward to build subdir path inside the vault.
  const parts = [];
  let cur = file.folderId ? (folders.find(f => f.id === file.folderId) || null) : null;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(sanitizeSeg(cur.name || 'folder'));
    cur = cur.parentId ? (folders.find(f => f.id === cur.parentId) || null) : null;
  }
  return path.join(vaultName, ...parts, `${name}.md`);
}

async function ensureUnique(absPath, ownerId) {
  // If a different note already owns this path, suffix with __<id8>.md.
  let candidate = absPath;
  const dir = path.dirname(absPath);
  const ext = path.extname(absPath);
  const base = path.basename(absPath, ext);
  let i = 0;
  while (true) {
    const owner = Object.entries(exportIndex).find(
      ([id, rec]) => rec && path.join(EXPORT_ROOT, rec.relPath) === candidate && id !== ownerId,
    );
    if (!owner) return candidate;
    i++;
    candidate = path.join(dir, `${base}__${ownerId.slice(0, 8)}${ext}`);
    if (i > 1) candidate = path.join(dir, `${base}__${ownerId.slice(0, 8)}-${i}${ext}`);
  }
}

// ─── File import (docx/pdf/xlsx/csv/html/json/xml → markdown) ──────────────
async function importOne(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);
  const fail = (msg) => ({ name: baseName + '.md', content: '', error: msg });

  try {
    if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
      const content = await fs.readFile(filePath, 'utf8');
      return { name: baseName + '.md', content };
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const TurndownService = require('turndown');
      const buf = await fs.readFile(filePath);
      const { value: html } = await mammoth.convertToHtml({ buffer: buf });
      const md = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' }).turndown(html);
      return { name: baseName + '.md', content: md };
    }
    if (ext === '.html' || ext === '.htm') {
      const TurndownService = require('turndown');
      const html = await fs.readFile(filePath, 'utf8');
      const md = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' }).turndown(html);
      return { name: baseName + '.md', content: md };
    }
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buf = await fs.readFile(filePath);
      const data = await pdfParse(buf);
      const text = (data.text || '').trim();
      const header = `# ${baseName}\n\n_Importado de PDF · ${data.numpages} páginas_\n\n`;
      return { name: baseName + '.md', content: header + text };
    }
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      const XLSX = require('xlsx');
      const wb = ext === '.csv'
        ? XLSX.read(await fs.readFile(filePath, 'utf8'), { type: 'string' })
        : XLSX.read(await fs.readFile(filePath), { type: 'buffer' });
      const parts = [`# ${baseName}\n`];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
        if (!rows.length) continue;
        if (wb.SheetNames.length > 1) parts.push(`\n## ${sheetName}\n`);
        const widths = rows[0].length;
        const header = rows[0].map(c => String(c).trim() || ' ');
        const sep = Array(widths).fill('---');
        parts.push('| ' + header.join(' | ') + ' |');
        parts.push('| ' + sep.join(' | ') + ' |');
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const cells = [];
          for (let j = 0; j < widths; j++) {
            cells.push(String(r[j] != null ? r[j] : '').replace(/\|/g, '\\|').replace(/\n+/g, ' '));
          }
          parts.push('| ' + cells.join(' | ') + ' |');
        }
        parts.push('');
      }
      return { name: baseName + '.md', content: parts.join('\n') };
    }
    if (ext === '.json') {
      const txt = await fs.readFile(filePath, 'utf8');
      return { name: baseName + '.md', content: '# ' + baseName + '\n\n```json\n' + txt + '\n```\n' };
    }
    if (ext === '.xml') {
      const txt = await fs.readFile(filePath, 'utf8');
      return { name: baseName + '.md', content: '# ' + baseName + '\n\n```xml\n' + txt + '\n```\n' };
    }
    return fail(`extensión no soportada: ${ext}`);
  } catch (err) {
    return fail(String((err && err.message) || err));
  }
}

const IMPORT_FILTERS = [
  { name: 'Soportados', extensions: ['md', 'markdown', 'txt', 'docx', 'pdf', 'xlsx', 'xls', 'csv', 'html', 'htm', 'json', 'xml'] },
  { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
  { name: 'Word', extensions: ['docx'] },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'Hojas de cálculo', extensions: ['xlsx', 'xls', 'csv'] },
  { name: 'Web', extensions: ['html', 'htm'] },
  { name: 'Todos', extensions: ['*'] },
];

ipcMain.handle('file:openImportDialog', async () => {
  if (!mainWindow) return { canceled: true, files: [] };
  const res = await dialog.showOpenDialog(mainWindow, {
    filters: IMPORT_FILTERS,
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true, files: [] };
  const out = [];
  for (const fp of res.filePaths) out.push(await importOne(fp));
  return { canceled: false, files: out };
});

ipcMain.handle('file:importPaths', async (_e, paths) => {
  if (!Array.isArray(paths)) return { files: [] };
  const out = [];
  for (const fp of paths) out.push(await importOne(fp));
  return { files: out };
});

ipcMain.handle('menu:setAccelerators', (_e, map) => {
  if (!map || typeof map !== 'object') return { ok: false };
  const next = {};
  for (const id of Object.keys(DEFAULT_ACCELS)) {
    if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
    const v = map[id];
    next[id] = (typeof v === 'string' && v.length < 64) ? v : null;
  }
  if (JSON.stringify(next) === JSON.stringify(menuAccelOverrides)) return { ok: true };
  const prev = menuAccelOverrides;
  menuAccelOverrides = next;
  try { buildMenu(); return { ok: true }; }
  catch (err) {
    // Acelerador no válido: vuelve al menú anterior.
    menuAccelOverrides = prev;
    try { buildMenu(); } catch {}
    logLine('warn', 'menu:accelerators', err && err.message);
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Ajustes → Editor → corrector ortográfico. La ventana nace con
// spellcheck: true; esto lo activa o desactiva en su sesión.
ipcMain.handle('app:setSpellcheck', (e, enabled) => {
  try {
    const ses = e.sender && e.sender.session;
    if (ses && typeof ses.setSpellCheckerEnabled === 'function') ses.setSpellCheckerEnabled(!!enabled);
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('app:setLanguage', (_e, lang) => {
  if (lang !== 'es' && lang !== 'en') return;
  if (lang === currentLang) return;
  currentLang = lang;
  try { buildMenu(); } catch {}
  try {
    if (tray) {
      tray.destroy();
      tray = null;
      createTray();
    }
  } catch {}
});
ipcMain.handle('log:append', (_e, entry = {}) => {
  const { level, source, msg, extra } = entry;
  logLine(level || 'info', source || 'renderer', msg, extra);
  return { ok: true };
});
ipcMain.handle('log:tail', (_e, maxBytes) => ({
  ok: true,
  path: LOG_FILE,
  text: logTail(Math.max(1024, Math.min(2_000_000, Number(maxBytes) || 200_000))),
}));
ipcMain.handle('log:reveal', () => {
  try {
    // Ensure file exists before reveal — empty file is fine.
    if (!fsSync.existsSync(LOG_FILE)) fsSync.writeFileSync(LOG_FILE, '');
    shell.showItemInFolder(LOG_FILE);
    return { ok: true, path: LOG_FILE };
  } catch (err) {
    return { ok: false, error: err && err.message || String(err) };
  }
});

ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('window:isMaximized', () => mainWindow ? mainWindow.isMaximized() : false);

// Only allow http(s) so renderer can't pivot this into a `file://` open.
ipcMain.handle('shell:openExternal', async (_e, { url } = {}) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

// Ask for the user's attention when an MCP-driven `aiPointer` action wants
// them to see what the AI just did — WITHOUT stealing focus. This used to
// restore + show + focus + moveTop, which yanked the window in front of
// whatever the user was actually doing; an assistant announcing itself is
// not worth interrupting a call or a build for.
//
// So: flash the taskbar/dock entry and let the user come over when they
// choose. If the window is already focused there's nothing to signal.
// A window hidden in the tray has no taskbar button to flash, so it stays
// hidden rather than being force-shown — the note is waiting when they
// open it.
ipcMain.handle('window:attention', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  try {
    if (mainWindow.isFocused()) return { ok: true, already: true };
    if (isMac) {
      if (app.dock && app.dock.bounce) app.dock.bounce('informational');
    } else {
      // Windows + Linux: blinks the taskbar button until the window is
      // activated. Electron clears it automatically on focus.
      try { mainWindow.flashFrame(true); } catch {}
    }
    return { ok: true, flashed: true };
  } catch (err) {
    return { ok: false, reason: String(err && err.message || err) };
  }
});

// Capture the current visible web contents as PNG. Used by the
// screenshot_note MCP tool — the renderer hits this after focusing the
// target note and waiting a frame for layout to settle. `rect` is
// optional in client coords; omit to grab the whole viewport. Max edge
// clamp prevents the renderer from asking for a multi-megapixel grab
// that crashes the IPC channel.
ipcMain.handle('window:capture', async (_e, opts = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'no window' };
  try {
    const wc = mainWindow.webContents;
    const rect = opts && opts.rect && typeof opts.rect === 'object'
      ? {
          x: Math.max(0, Math.round(opts.rect.x || 0)),
          y: Math.max(0, Math.round(opts.rect.y || 0)),
          width: Math.max(1, Math.min(4096, Math.round(opts.rect.width || 0))),
          height: Math.max(1, Math.min(4096, Math.round(opts.rect.height || 0))),
        }
      : null;
    const image = rect ? await wc.capturePage(rect) : await wc.capturePage();
    // Optional downscale to keep payload sane. Default cap 1200px wide so
    // a 4K screen doesn't ship a 3MB PNG over MCP.
    const maxW = Math.max(64, Math.min(4096, Number(opts.maxWidth) || 1200));
    const size = image.getSize();
    const sized = (size.width > maxW)
      ? image.resize({ width: maxW })
      : image;
    const buf = sized.toPNG();
    return {
      ok: true,
      mime: 'image/png',
      width: sized.getSize().width,
      height: sized.getSize().height,
      bytes: buf.length,
      base64: buf.toString('base64'),
    };
  } catch (err) {
    return { ok: false, reason: String(err && err.message || err) };
  }
});

// ── URL unfurl (canvas link cards) ───────────────────────────────────────
// Fetch a page's <head> and extract OpenGraph/title metadata so the canvas
// can render a rich link card. Guard rails: http(s) only, no private hosts
// (SSRF), 5s timeout, 512KB body cap, small in-memory TTL cache. Called
// only from a user gesture (pasting/adding a URL on the canvas).
const unfurlCache = new Map(); // url → { at, data }
const UNFURL_TTL_MS = 6 * 60 * 60 * 1000;
const UNFURL_CACHE_MAX = 200;

function unfurlIsPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.startsWith('[')) return true; // IPv6 literals — refuse outright
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast/reserved
  }
  return false;
}

function unfurlDecodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function unfurlExtractMeta(html, pageUrl) {
  const metaTag = (prop) => {
    const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*?content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${p}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    return m ? unfurlDecodeEntities(m[1].trim()) : '';
  };
  const resolveUrl = (u) => {
    if (!u) return '';
    try { return new URL(u, pageUrl).toString(); } catch { return ''; }
  };
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let favicon = '';
  const iconM = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*?href=["']([^"']*)["']/i)
    || html.match(/<link[^>]+href=["']([^"']*)["'][^>]*?rel=["'](?:shortcut )?icon["']/i);
  if (iconM) favicon = resolveUrl(iconM[1]);
  if (!favicon) { try { favicon = new URL('/favicon.ico', pageUrl).toString(); } catch {} }
  const img = resolveUrl(metaTag('og:image') || metaTag('twitter:image'));
  return {
    title: (metaTag('og:title') || metaTag('twitter:title') || (titleTag ? unfurlDecodeEntities(titleTag[1]).replace(/\s+/g, ' ').trim() : '')).slice(0, 240),
    desc: (metaTag('og:description') || metaTag('twitter:description') || metaTag('description')).slice(0, 400),
    imageUrl: /^https?:\/\//i.test(img) ? img : '',
    favicon: /^https?:\/\//i.test(favicon) ? favicon : '',
    siteName: metaTag('og:site_name').slice(0, 120),
  };
}

ipcMain.handle('url:unfurl', async (_e, { url } = {}) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, reason: 'bad-url' };
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, reason: 'bad-url' }; }
  if (unfurlIsPrivateHost(parsed.hostname)) return { ok: false, reason: 'private-host' };
  const cached = unfurlCache.get(url);
  if (cached && Date.now() - cached.at < UNFURL_TTL_MS) return cached.data;
  const data = await new Promise((resolve) => {
    const MAX_BYTES = 512 * 1024;
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), 5000);
    try {
      const req = net.request({ url, redirect: 'follow' });
      req.setHeader('User-Agent', 'Mozilla/5.0 (compatible; Edinot/1.0; link-preview)');
      req.setHeader('Accept', 'text/html,application/xhtml+xml');
      req.on('response', (res) => {
        const ctype = String(res.headers['content-type'] || '');
        if (res.statusCode < 200 || res.statusCode >= 300 || (ctype && !/text\/html|application\/xhtml/i.test(ctype))) {
          clearTimeout(timer);
          done({ ok: false, reason: ctype ? 'not-html' : `http-${res.statusCode}` });
          try { res.destroy && res.destroy(); } catch {}
          return;
        }
        const chunks = [];
        let total = 0;
        const finish = () => {
          clearTimeout(timer);
          const html = Buffer.concat(chunks).toString('utf8');
          done({ ok: true, url, ...unfurlExtractMeta(html, url) });
        };
        res.on('data', (c) => {
          total += c.length;
          chunks.push(c);
          if (total >= MAX_BYTES) { try { res.destroy && res.destroy(); } catch {} finish(); }
        });
        res.on('end', finish);
        res.on('error', () => { clearTimeout(timer); done({ ok: false, reason: 'net' }); });
      });
      req.on('error', () => { clearTimeout(timer); done({ ok: false, reason: 'net' }); });
      req.end();
    } catch (err) {
      clearTimeout(timer);
      done({ ok: false, reason: String(err && err.message || err) });
    }
  });
  if (data && data.ok) {
    unfurlCache.set(url, { at: Date.now(), data });
    if (unfurlCache.size > UNFURL_CACHE_MAX) {
      const first = unfurlCache.keys().next().value;
      unfurlCache.delete(first);
    }
  }
  return data;
});

// ── Floating companion windows (presentation mode / quick note) ─────────
// Small frameless always-on-top windows that load the same app URL with a
// `#float=<mode>` hash, so build/entry.jsx mounts the lightweight
// EdinotFloat component instead of the full app. They hold no state of
// their own: the main window's renderer remains the single source of truth
// and the two sides talk through the float:push / float:send IPC relays.
const floatWindows = new Map(); // mode → BrowserWindow

const isHyprland = process.platform === 'linux' && !!process.env.HYPRLAND_INSTANCE_SIGNATURE;

// Hyprland tiles regular toplevels, so an "always on top" frameless window
// would get tiled like any editor pane. Find our window by its unique title
// and force-float + pin it (pin = visible on every workspace). Best-effort:
// if hyprctl is missing or the shape of `clients -j` changes we silently
// keep the default behavior.
function floatWindowTitle(mode) {
  return `Edinot — ${mode === 'present' ? 'Presentación' : 'Nota flotante'}`;
}

function applyHyprlandFloatRules(title, width, height, pos, attempt = 0) {
  if (!isHyprland) return;
  const { execFile } = require('node:child_process');
  // The window can take a moment to map (and get its title) — until then
  // Hyprland has already tiled it into a narrow column. Retry a few times.
  const retry = () => { if (attempt < 6) applyHyprlandFloatRules(title, width, height, pos, attempt + 1); };
  setTimeout(() => {
    execFile('hyprctl', ['clients', '-j'], { timeout: 3000 }, (err, stdout) => {
      if (err) return;
      let clients;
      try { clients = JSON.parse(stdout); } catch { return; }
      const c = Array.isArray(clients) ? clients.find((x) => x && x.title === title) : null;
      if (!c || !c.address) { retry(); return; }
      const addr = `address:${c.address}`;
      const cmds = [];
      if (!c.floating) cmds.push(`dispatch togglefloating ${addr}`);
      cmds.push(`dispatch pin ${addr}`);
      cmds.push(`dispatch resizewindowpixel exact ${width} ${height},${addr}`);
      if (pos) cmds.push(`dispatch movewindowpixel exact ${Math.round(pos.x)} ${Math.round(pos.y)},${addr}`);
      execFile('hyprctl', ['--batch', cmds.join(' ; ')], { timeout: 3000 }, () => {});
    });
  }, 350);
}

function createFloatWindow(mode) {
  const existing = floatWindows.get(mode);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return { ok: true, already: true }; }
  const isPresent = mode === 'present';
  const width = isPresent ? 460 : 420;
  const height = isPresent ? 560 : 340;
  const title = floatWindowTitle(mode);
  const win = new BrowserWindow({
    width, height,
    minWidth: 280, minHeight: 200,
    title,
    icon: ICON_PATH,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#f4f2ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Electron's spellchecker initializes (dictionary load) on the first
      // text input of a webContents — a visible ~100-300ms hitch on the
      // first keystroke. A quick-capture pad doesn't need it.
      spellcheck: false,
    },
  });
  // 'screen-saver' keeps it above fullscreen apps on Windows/macOS; on most
  // Linux WMs it maps to a strong above hint. Visible-on-all-workspaces so a
  // meeting note follows the user across virtual desktops.
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch { win.setAlwaysOnTop(true); }
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  win.once('ready-to-show', () => { win.show(); applyHyprlandFloatRules(title, width, height); });
  // Renderer-side window.title changes would break the hyprctl title match —
  // pin the title we created the window with.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => {
    floatWindows.delete(mode);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('float:msg', { kind: 'float-closed', mode });
    }
  });
  win.loadURL(`${appUrl}#float=${mode}`);
  floatWindows.set(mode, win);
  return { ok: true };
}

ipcMain.handle('float:open', (_e, { mode } = {}) => {
  if (mode !== 'present' && mode !== 'note') return { ok: false, reason: 'bad mode' };
  return createFloatWindow(mode);
});
ipcMain.handle('float:close', (_e, { mode } = {}) => {
  const win = floatWindows.get(mode);
  if (win && !win.isDestroyed()) win.close();
  return { ok: true };
});
ipcMain.handle('float:closeSelf', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win !== mainWindow) win.close();
  return { ok: true };
});
ipcMain.handle('float:isOpen', (_e, { mode } = {}) => {
  const win = floatWindows.get(mode);
  return { ok: true, open: !!(win && !win.isDestroyed()) };
});
// Main window renderer → float window (content pushes).
ipcMain.handle('float:push', (_e, payload = {}) => {
  const win = floatWindows.get(payload.mode);
  if (!win || win.isDestroyed()) return { ok: false, reason: 'not open' };
  win.webContents.send('float:data', payload);
  return { ok: true };
});
// Float window → main window renderer (requests / submissions).
ipcMain.handle('float:send', (_e, payload = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'no main window' };
  mainWindow.webContents.send('float:msg', payload);
  return { ok: true };
});

// ── Full-screen capture (quick-note "shoot what I'm looking at") ────────
// Wayland first tries native CLI grabbers (grim on wlroots/Hyprland, then
// the GNOME/KDE ones) because they capture without a portal permission
// dialog; everything else (X11, Windows, macOS) goes through
// desktopCapturer thumbnails. Returns PNG base64.
const isWaylandSession = process.platform === 'linux'
  && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

async function captureViaCli() {
  const os = require('node:os');
  const { execFile } = require('node:child_process');
  const tmp = path.join(os.tmpdir(), `edinot-shot-${Date.now().toString(36)}.png`);
  const candidates = [
    ['grim', [tmp]],                          // wlroots / Hyprland
    ['gnome-screenshot', ['-f', tmp]],        // GNOME Wayland
    ['spectacle', ['-b', '-n', '-o', tmp]],   // KDE
  ];
  for (const [bin, args] of candidates) {
    const ok = await new Promise((resolve) => {
      execFile(bin, args, { timeout: 15000 }, (err) => resolve(!err));
    });
    if (!ok) continue;
    try {
      const buf = await fs.readFile(tmp);
      await fs.unlink(tmp).catch(() => {});
      if (buf.length > 0) return buf;
    } catch { /* try next */ }
  }
  return null;
}

async function captureViaDesktopCapturer() {
  const { desktopCapturer, screen } = require('electron');
  const primary = screen.getPrimaryDisplay();
  const scale = primary.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(primary.size.width * scale),
      height: Math.round(primary.size.height * scale),
    },
  });
  if (!sources.length) return null;
  const match = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
  const buf = match.thumbnail ? match.thumbnail.toPNG() : null;
  return buf && buf.length > 0 ? buf : null;
}

ipcMain.handle('screen:capture', async (_e, opts = {}) => {
  const toHide = [];
  if (opts.hideFloat !== false) {
    // Snapshot real geometry from the compositor before hiding. On Wayland
    // win.getBounds() can't know the global position (the protocol doesn't
    // expose it), so ask hyprctl; getBounds stays as the non-Hyprland
    // fallback where it's accurate.
    let hyprGeo = new Map();
    if (isHyprland) {
      hyprGeo = await new Promise((resolve) => {
        const { execFile } = require('node:child_process');
        execFile('hyprctl', ['clients', '-j'], { timeout: 3000 }, (err, stdout) => {
          const m = new Map();
          if (!err) {
            try {
              for (const c of JSON.parse(stdout)) {
                if (c && c.title) m.set(c.title, { x: c.at[0], y: c.at[1], width: c.size[0], height: c.size[1] });
              }
            } catch {}
          }
          resolve(m);
        });
      });
    }
    for (const [mode, win] of floatWindows.entries()) {
      if (!win || win.isDestroyed() || !win.isVisible()) continue;
      let bounds = hyprGeo.get(floatWindowTitle(mode)) || null;
      if (!bounds) { try { bounds = win.getBounds(); } catch {} }
      toHide.push({ win, mode, bounds });
    }
  }
  try {
    for (const { win } of toHide) win.hide();
    // Let the compositor finish the hide animation before grabbing.
    if (toHide.length) await new Promise((r) => setTimeout(r, isWaylandSession ? 400 : 250));
    let buf = null;
    if (isWaylandSession) buf = await captureViaCli();
    if (!buf) buf = await captureViaDesktopCapturer().catch(() => null);
    if (!buf && !isWaylandSession) buf = await captureViaCli();
    if (!buf) return { ok: false, reason: 'capture failed (no grabber available)' };
    return { ok: true, mime: 'image/png', bytes: buf.length, base64: buf.toString('base64') };
  } catch (err) {
    return { ok: false, reason: String(err && err.message || err) };
  } finally {
    for (const { win, mode, bounds } of toHide) {
      try { win.show(); } catch {}
      // hide() unmaps the window; on remap Hyprland treats it as a fresh
      // toplevel and tiles it again, dropping float + pin. Re-apply the
      // rules, restoring the size/position it had before the capture.
      if (bounds) {
        applyHyprlandFloatRules(floatWindowTitle(mode), bounds.width, bounds.height, { x: bounds.x, y: bounds.y });
      } else {
        applyHyprlandFloatRules(floatWindowTitle(mode), 420, 340, null);
      }
    }
  }
});

// ── Email import (.eml / .msg dropped into a note) ──────────────────────
// Parsing happens here in the main process: mailparser (MIME) and
// @kenjiuno/msgreader (Outlook OLE) are Node-only, and the sandboxed
// renderer just ships the raw bytes over and gets clean markdown +
// attachment buffers back. HTML bodies are converted with turndown so the
// note stays real markdown instead of an HTML blob.
function emailAddressText(addr) {
  if (!addr) return '';
  if (typeof addr.text === 'string') return addr.text;
  if (Array.isArray(addr)) return addr.map(emailAddressText).filter(Boolean).join(', ');
  return String(addr || '');
}

function htmlToMarkdown(html) {
  const TurndownService = require('turndown');
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  // Outlook HTML is soup — drop the invisible plumbing wholesale.
  td.remove(['style', 'script', 'title', 'head']);
  td.keep(['img']);
  // GFM tables (Joplin fork): real data tables become markdown tables —
  // including the header-less ones Outlook emits — while single-cell layout
  // tables (the classic MSO wrapper around the whole body) unwrap to plain
  // text instead of becoming a giant one-column table.
  try {
    const { gfm } = require('@joplin/turndown-plugin-gfm');
    td.use(gfm);
  } catch { /* plugin missing → tables flatten like before, still readable */ }
  return td.turndown(String(html || ''));
}

async function parseEmlBuffer(buf) {
  const { simpleParser } = require('mailparser');
  // skipImageLinks keeps inline images as `cid:` references instead of
  // multi-megabyte data: URIs — the renderer rewires each cid to its
  // uploaded edinot://blob URL after pushing the attachment to sync.
  const parsed = await simpleParser(buf, { skipImageLinks: true });
  const bodyMd = parsed.html ? htmlToMarkdown(parsed.html) : String(parsed.text || '');
  return {
    subject: parsed.subject || '',
    from: emailAddressText(parsed.from),
    to: emailAddressText(parsed.to),
    date: parsed.date ? parsed.date.toISOString() : null,
    markdown: bodyMd,
    attachments: (parsed.attachments || []).map((a) => ({
      filename: a.filename || 'adjunto',
      mime: a.contentType || 'application/octet-stream',
      cid: a.cid || null,
      inline: a.contentDisposition === 'inline' && !!a.cid,
      base64: Buffer.from(a.content).toString('base64'),
    })),
  };
}

function parseMsgBuffer(buf) {
  const MsgReader = require('@kenjiuno/msgreader').default;
  const reader = new MsgReader(buf);
  const data = reader.getFileData();
  if (!data || data.error) throw new Error(data && data.error || 'msg parse failed');
  const recipients = (data.recipients || [])
    .map((r) => r.name && r.email ? `${r.name} <${r.email}>` : (r.email || r.name))
    .filter(Boolean).join(', ');
  const bodyMd = data.bodyHtml ? htmlToMarkdown(data.bodyHtml) : String(data.body || '');
  const attachments = (data.attachments || []).map((att) => {
    const file = reader.getAttachment(att);
    return {
      filename: (file && file.fileName) || att.fileName || att.name || 'adjunto',
      mime: att.mimeType || 'application/octet-stream',
      cid: att.contentId || null,
      inline: !!att.contentId,
      base64: Buffer.from((file && file.content) || new Uint8Array()).toString('base64'),
    };
  }).filter((a) => a.base64.length > 0);
  return {
    subject: data.subject || '',
    from: data.senderName && data.senderEmail
      ? `${data.senderName} <${data.senderEmail}>`
      : (data.senderEmail || data.senderName || ''),
    to: recipients,
    date: data.messageDeliveryTime || data.clientSubmitTime || null,
    markdown: bodyMd,
    attachments,
  };
}

ipcMain.handle('email:parse', async (_e, { name, bytes } = {}) => {
  try {
    if (!bytes) return { ok: false, reason: 'no bytes' };
    const buf = Buffer.from(bytes);
    if (buf.length > 50 * 1024 * 1024) return { ok: false, reason: 'email too large (max 50MB)' };
    const lower = String(name || '').toLowerCase();
    const result = lower.endsWith('.msg') ? parseMsgBuffer(buf) : await parseEmlBuffer(buf);
    return { ok: true, ...result };
  } catch (err) {
    logLine('error', 'email:parse', err && err.message, { name });
    return { ok: false, reason: String(err && err.message || err) };
  }
});

// F2 — Reminders scheduler. Renderer is the source of truth (yEvents).
// It pushes a flat list each time yEvents changes (or vault swap). We
// keep one setTimeout per id and clear/rebuild on every sync. On fire
// we post a system Notification and tell the renderer (so it can open
// the source note + show the snooze/dismiss banner).
//
// Far-future items (>24h) are scheduled with a coarse chain so we don't
// hold a multi-day timer that node would happily round to MAX_INT32.
const reminderTimers = new Map(); // id → { fireAt, timer, item }
const reminderFired = new Map();  // id → fireAt (skip re-arm until renderer changes fireAt)
const MAX_TIMER_MS = 2 ** 31 - 1; // node setTimeout cap (~24.85d)

function clearReminderTimer(id) {
  const slot = reminderTimers.get(id);
  if (slot && slot.timer) { try { clearTimeout(slot.timer); } catch {} }
  reminderTimers.delete(id);
}

function clearAllReminderTimers() {
  for (const id of Array.from(reminderTimers.keys())) clearReminderTimer(id);
}

function scheduleReminder(item) {
  if (!item || !item.id || !item.fireAt) return;
  const id = item.id;
  clearReminderTimer(id);
  const fireAt = Number(item.fireAt);
  if (!Number.isFinite(fireAt)) return;
  // Avoid re-firing while user hasn't snoozed/dismissed. We only re-arm
  // when the renderer has changed fireAt (snooze writes a later time).
  if (reminderFired.get(id) === fireAt) return;
  const delay = fireAt - Date.now();
  const armNow = () => fireReminder(id, item);
  if (delay <= 0) {
    const timer = setTimeout(armNow, 0);
    reminderTimers.set(id, { fireAt, timer, item });
    return;
  }
  if (delay > MAX_TIMER_MS) {
    // Re-arm after a long sleep; we'll recompute on each cycle.
    const timer = setTimeout(() => scheduleReminder(item), MAX_TIMER_MS - 1000);
    reminderTimers.set(id, { fireAt, timer, item });
    return;
  }
  const timer = setTimeout(armNow, delay);
  reminderTimers.set(id, { fireAt, timer, item });
}

function fireReminder(id, item) {
  reminderTimers.delete(id);
  reminderFired.set(id, Number(item.fireAt));
  try {
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      const n = new Notification({
        title: item.title || 'Edinot',
        body: item.body || (item.noteName ? `Recordatorio · ${item.noteName}` : 'Recordatorio'),
        silent: false,
      });
      n.on('click', () => {
        showApp();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('reminder:fire', { id, item, action: 'open' });
        }
      });
      n.show();
    }
  } catch (err) {
    logLine('warn', 'reminder:notification-failed', err && err.message);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('reminder:fire', { id, item, action: 'fire' });
  }
}

ipcMain.handle('reminders:sync', (_e, { items } = {}) => {
  const list = Array.isArray(items) ? items : [];
  const next = new Map();
  for (const item of list) {
    if (!item || !item.id || !item.fireAt) continue;
    next.set(item.id, item);
  }
  // Drop timers + fired-state for ids no longer in the list.
  for (const id of Array.from(reminderTimers.keys())) {
    if (!next.has(id)) clearReminderTimer(id);
  }
  for (const id of Array.from(reminderFired.keys())) {
    if (!next.has(id)) reminderFired.delete(id);
  }
  // Rebuild/refresh remaining timers (fireAt may have shifted via snooze).
  for (const item of next.values()) scheduleReminder(item);
  return { ok: true, scheduled: reminderTimers.size };
});

ipcMain.handle('reminders:action', (_e, { id, action } = {}) => {
  if (!id) return { ok: false };
  // 'dismiss' / 'snoozed' → renderer already wrote yEvents; we just
  // drop the timer here so the user doesn't double-fire if the next
  // sync is slow. 'open' is a no-op (renderer handles UI).
  if (action === 'dismiss' || action === 'snoozed') {
    clearReminderTimer(id);
    reminderFired.delete(id);
  }
  return { ok: true };
});

app.on('before-quit', () => { clearAllReminderTimers(); });

// ── Google Calendar sync ─────────────────────────────────────────────────
// OAuth 2.0 for installed apps (loopback redirect + PKCE). The user supplies
// a Google Cloud OAuth client (id + secret for the "Desktop app" type) in
// Settings → Calendario. Refresh/access tokens are stored device-locally,
// encrypted with the OS keychain via safeStorage (NOT synced through Yjs).
const GCAL_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GCAL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email';
const GCAL_TOKEN_FILE = path.join(app.getPath('userData'), 'gcal-tokens.bin');

function gcalSaveTokens(obj) {
  try {
    const raw = JSON.stringify(obj || {});
    if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
      fsSync.writeFileSync(GCAL_TOKEN_FILE, safeStorage.encryptString(raw));
    } else {
      // Fallback: plaintext (best-effort) when no OS keychain is present.
      fsSync.writeFileSync(GCAL_TOKEN_FILE, Buffer.from('plain:' + raw, 'utf8'));
    }
  } catch (err) { logLine('warn', 'gcal:save-tokens-failed', err && err.message); }
}
function gcalLoadTokens() {
  try {
    if (!fsSync.existsSync(GCAL_TOKEN_FILE)) return null;
    const buf = fsSync.readFileSync(GCAL_TOKEN_FILE);
    let raw;
    if (buf.slice(0, 6).toString('utf8') === 'plain:') raw = buf.slice(6).toString('utf8');
    else if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) raw = safeStorage.decryptString(buf);
    else return null;
    return JSON.parse(raw);
  } catch (err) { logLine('warn', 'gcal:load-tokens-failed', err && err.message); return null; }
}
function gcalClearTokens() { try { if (fsSync.existsSync(GCAL_TOKEN_FILE)) fsSync.unlinkSync(GCAL_TOKEN_FILE); } catch {} }

// Minimal HTTPS JSON request. `body` may be a string (form) or object (JSON).
function gcalRequest(method, urlStr, { headers = {}, body = null, form = null } = {}) {
  return new Promise((resolve, reject) => {
    let payload = null;
    const h = { Accept: 'application/json', ...headers };
    if (form) { payload = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (body != null) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    if (payload) h['Content-Length'] = Buffer.byteLength(payload);
    const u = new URL(urlStr);
    const req = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers: h }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error((parsed && (parsed.error_description || (parsed.error && parsed.error.message) || parsed.error)) || `HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Return a valid access token, refreshing if needed. Persists the refreshed one.
async function gcalAccessToken(clientId, clientSecret) {
  const tok = gcalLoadTokens();
  if (!tok || !tok.refresh_token) throw new Error('not_connected');
  if (tok.access_token && tok.expiry && Date.now() < tok.expiry - 60000) return tok.access_token;
  const res = await gcalRequest('POST', GCAL_TOKEN_URL, {
    form: {
      client_id: clientId || tok.client_id,
      client_secret: clientSecret || tok.client_secret || '',
      refresh_token: tok.refresh_token,
      grant_type: 'refresh_token',
    },
  });
  const next = {
    ...tok,
    access_token: res.access_token,
    expiry: Date.now() + (res.expires_in ? res.expires_in * 1000 : 3600000),
  };
  gcalSaveTokens(next);
  return next.access_token;
}

ipcMain.handle('gcal:status', () => {
  const tok = gcalLoadTokens();
  return { connected: !!(tok && tok.refresh_token), email: tok ? (tok.email || null) : null };
});

ipcMain.handle('gcal:disconnect', () => { gcalClearTokens(); return { ok: true }; });

// Run the loopback OAuth + PKCE dance. Returns { connected, email } on success.
ipcMain.handle('gcal:auth', async (_e, { clientId, clientSecret } = {}) => {
  if (!clientId) return { ok: false, error: 'missing_client_id' };
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; try { server.close(); } catch {} resolve(val); };
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, `http://127.0.0.1`);
        if (!u.searchParams.get('code') && !u.searchParams.get('error')) { res.writeHead(404); res.end(); return; }
        const respond = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;padding:3rem;text-align:center"><h2>${msg}</h2><p>Puedes cerrar esta pestaña y volver a Edinot.</p></body>`); };
        if (u.searchParams.get('error')) { respond('Conexión cancelada'); finish({ ok: false, error: u.searchParams.get('error') }); return; }
        if (u.searchParams.get('state') !== state) { respond('Estado inválido'); finish({ ok: false, error: 'bad_state' }); return; }
        const code = u.searchParams.get('code');
        const port = server.address().port;
        const tokenRes = await gcalRequest('POST', GCAL_TOKEN_URL, {
          form: {
            client_id: clientId,
            client_secret: clientSecret || '',
            code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: `http://127.0.0.1:${port}`,
          },
        });
        let email = null;
        try {
          const info = await gcalRequest('GET', 'https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokenRes.access_token}` } });
          email = info && info.email || null;
        } catch {}
        gcalSaveTokens({
          client_id: clientId,
          client_secret: clientSecret || '',
          refresh_token: tokenRes.refresh_token,
          access_token: tokenRes.access_token,
          expiry: Date.now() + (tokenRes.expires_in ? tokenRes.expires_in * 1000 : 3600000),
          email,
        });
        respond('✅ Edinot conectado a Google Calendar');
        showApp();
        finish({ ok: true, connected: true, email });
      } catch (err) {
        try { res.writeHead(500); res.end(); } catch {}
        finish({ ok: false, error: err && err.message });
      }
    });
    server.on('error', (err) => finish({ ok: false, error: err && err.message }));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const authUrl = `${GCAL_AUTH_URL}?` + new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: GCAL_SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();
      shell.openExternal(authUrl);
    });
    // Safety timeout — abandon after 5 minutes.
    setTimeout(() => finish({ ok: false, error: 'timeout' }), 5 * 60 * 1000);
  });
});

ipcMain.handle('gcal:calendars', async (_e, { clientId, clientSecret } = {}) => {
  try {
    const at = await gcalAccessToken(clientId, clientSecret);
    const res = await gcalRequest('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer', { headers: { Authorization: `Bearer ${at}` } });
    const items = (res.items || []).map(c => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
    return { ok: true, calendars: items };
  } catch (err) { return { ok: false, error: err && err.message }; }
});

// Pull events from a Google calendar within [timeMin, timeMax] (ISO strings).
ipcMain.handle('gcal:list', async (_e, { clientId, clientSecret, calendarId, timeMin, timeMax } = {}) => {
  try {
    const at = await gcalAccessToken(clientId, clientSecret);
    const cal = encodeURIComponent(calendarId || 'primary');
    const out = [];
    let pageToken = '';
    do {
      const qs = new URLSearchParams({
        singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
        ...(timeMin ? { timeMin } : {}), ...(timeMax ? { timeMax } : {}),
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const res = await gcalRequest('GET', `https://www.googleapis.com/calendar/v3/calendars/${cal}/events?${qs}`, { headers: { Authorization: `Bearer ${at}` } });
      for (const e of (res.items || [])) {
        if (e.status === 'cancelled') continue;
        const startObj = e.start || {};
        const allDay = !!startObj.date;
        const start = startObj.dateTime || startObj.date || null;
        if (!start) continue;
        out.push({
          gcalId: e.id,
          title: e.summary || '(sin título)',
          start,
          end: (e.end && (e.end.dateTime || e.end.date)) || null,
          allDay,
          etag: e.etag || null,
          htmlLink: e.htmlLink || null,
        });
      }
      pageToken = res.nextPageToken || '';
    } while (pageToken);
    return { ok: true, events: out };
  } catch (err) { return { ok: false, error: err && err.message }; }
});

// Push (insert or patch) an app event to Google. Returns the gcalId.
ipcMain.handle('gcal:push', async (_e, { clientId, clientSecret, calendarId, gcalId, event } = {}) => {
  try {
    const at = await gcalAccessToken(clientId, clientSecret);
    const cal = encodeURIComponent(calendarId || 'primary');
    const toGcalTime = (iso, allDay) => allDay ? { date: String(iso).slice(0, 10) } : { dateTime: new Date(iso).toISOString() };
    const body = {
      summary: event.title || '(sin título)',
      start: toGcalTime(event.start, event.allDay),
      end: toGcalTime(event.end || event.start, event.allDay),
    };
    const res = gcalId
      ? await gcalRequest('PATCH', `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(gcalId)}`, { headers: { Authorization: `Bearer ${at}` }, body })
      : await gcalRequest('POST', `https://www.googleapis.com/calendar/v3/calendars/${cal}/events`, { headers: { Authorization: `Bearer ${at}` }, body });
    return { ok: true, gcalId: res.id, etag: res.etag || null };
  } catch (err) { return { ok: false, error: err && err.message }; }
});

ipcMain.handle('gcal:delete', async (_e, { clientId, clientSecret, calendarId, gcalId } = {}) => {
  try {
    const at = await gcalAccessToken(clientId, clientSecret);
    const cal = encodeURIComponent(calendarId || 'primary');
    await gcalRequest('DELETE', `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(gcalId)}`, { headers: { Authorization: `Bearer ${at}` } });
    return { ok: true };
  } catch (err) { return { ok: false, error: err && err.message }; }
});

// Packaged path of the bundled MCP server inside process.resourcesPath. On
// AppImage builds this path is ephemeral (`/tmp/.mount_*/resources/...`) — it
// changes every launch and only exists while Edinot is running. Pointing
// Claude Desktop's config at it breaks the next time the user launches.
// `ensureStableMcpServer` copies the bundled file into the userData dir on
// startup so we can hand out a stable path that survives across runs.
const STABLE_MCP_PATH = path.join(app.getPath('userData'), 'mcp-server.mjs');
function ensureStableMcpServer() {
  if (!app.isPackaged) return; // dev runs use the source tree directly
  // El MCP arranca el hub local con un `hub.mjs` que busca a su lado, y la app usa `edinot.mjs`
  // (el CLI) para copiar datos a otro hub: van juntos.
  for (const name of ['mcp-server.mjs', 'hub.mjs', 'edinot.mjs']) {
    const bundled = path.join(process.resourcesPath, name);
    const stable = path.join(path.dirname(STABLE_MCP_PATH), name);
    try {
      const b = fsSync.statSync(bundled);
      let stale = true;
      try {
        const u = fsSync.statSync(stable);
        stale = u.size !== b.size || u.mtimeMs < b.mtimeMs;
      } catch {}
      if (stale) {
        fsSync.mkdirSync(path.dirname(stable), { recursive: true });
        fsSync.copyFileSync(bundled, stable);
      }
    } catch (err) {
      console.warn(`[mcp] stage ${name} failed:`, err.message || err);
    }
  }
}

ipcMain.handle('mcp:getInfo', () => {
  const root = path.resolve(__dirname, '..');
  // Packaged → hand out the stable userData copy (resourcesPath is ephemeral
  // on AppImage). Dev → use the source tree as before.
  let mcpServerPath;
  if (app.isPackaged) {
    ensureStableMcpServer();
    mcpServerPath = STABLE_MCP_PATH;
  } else {
    mcpServerPath = path.join(root, 'mcp', 'server.mjs');
  }
  return {
    appDir: root,
    mcpServerPath,
    cliPath: path.join(root, 'cli', 'edinot.mjs'),
    nodeBin: process.execPath, // electron binary; use system node for mcp server
    cliAuthPath: path.join(cliConfigDir(), 'cli.json'),
    claudeConfigPath: claudeDesktopConfigPath(),
    claudeConfigPaths: claudeDesktopConfigPaths(),
    codexConfigPath: codexConfigPath(),
    claudeCodeConfigPath: claudeCodeConfigPath(),
    cursorConfigPath: cursorConfigPath(),
  };
});

function claudeDesktopConfigPath() {
  return claudeDesktopConfigPaths()[0];
}

function claudeDesktopConfigPaths() {
  const home = require('node:os').homedir();
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
  }
  if (process.platform === 'win32') {
    const standard = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const packagesRoot = path.join(localAppData, 'Packages');
    let storePaths = [];
    try {
      // MSIX / Microsoft Store builds virtualize %APPDATA% under the package's
      // LocalCache, so Claude reads a different config than the normal installer.
      storePaths = fsSync.readdirSync(packagesRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(name => /^Claude_/i.test(name) || /^Anthropic[._]?Claude(?:Desktop)?[_\.]/i.test(name))
        .map(name => path.join(packagesRoot, name, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
    } catch {}
    return Array.from(new Set([...storePaths, standard]));
  }
  return [path.join(home, '.config', 'Claude', 'claude_desktop_config.json')];
}

// Codex Desktop / OpenAI Codex CLI reads MCP server definitions from
// `~/.codex/config.toml`. Same location on every platform.
function codexConfigPath() {
  return path.join(require('node:os').homedir(), '.codex', 'config.toml');
}

// Claude Code CLI (the `claude` terminal tool) reads user-scope MCP servers
// from `~/.claude.json` under the same `mcpServers` shape Claude Desktop uses.
// Same path on every platform.
function claudeCodeConfigPath() {
  return path.join(require('node:os').homedir(), '.claude.json');
}

// Cursor reads global MCP servers from `~/.cursor/mcp.json` — same JSON
// shape as Claude Desktop. Same path on every platform.
function cursorConfigPath() {
  return path.join(require('node:os').homedir(), '.cursor', 'mcp.json');
}

// Merge / replace the `mcpServers.edinot` entry inside a JSON MCP config file
// (Claude Desktop, Claude Code CLI, Cursor — all share the same shape).
// Preserves every other key in the file. Creates the file/dir if missing.
async function mergeJsonMcpConfig(filePath, serverPath, env = {}) {
  let existing = {};
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    existing = JSON.parse(raw);
    if (!existing || typeof existing !== 'object') existing = {};
  } catch { /* missing or empty — start fresh */ }
  if (!existing.mcpServers || typeof existing.mcpServers !== 'object') existing.mcpServers = {};
  existing.mcpServers.edinot = { command: 'node', args: [serverPath] };
  if (env && Object.keys(env).length) existing.mcpServers.edinot.env = env;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf8');
}

// Merge / replace the `[mcp_servers.edinot]` block inside a Codex TOML
// config. We don't pull in a full TOML parser — the block is well-defined
// and a string-level splice keeps neighbouring user config intact.
function mergeCodexBlock(existing, serverPath, env = {}) {
  const escapedArg = serverPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const envPairs = Object.entries(env || {})
    .filter(([, v]) => v != null && String(v))
    .map(([k, v]) => `"${String(k).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" = "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const envLine = envPairs.length ? `\nenv = { ${envPairs.join(', ')} }` : '';
  // Codex defaults to a 10s startup and 60s per-tool deadline, and it kills
  // the server (not just the call) when they trip — the user then sees
  // `Transport closed` on every following tool. The first call after launch
  // pays a full workspace sync, and uploads add the blob round-trip on top,
  // so give both budgets real headroom.
  const block = `[mcp_servers.edinot]\ncommand = "node"\nargs = ["${escapedArg}"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 180${envLine}`;
  if (!existing) return block + '\n';
  const lines = existing.split('\n');
  const header = '[mcp_servers.edinot]';
  const start = lines.findIndex(l => l.trim() === header);
  if (start < 0) {
    const sep = existing.endsWith('\n\n') ? '' : (existing.endsWith('\n') ? '\n' : '\n\n');
    return existing + sep + block + '\n';
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) { end = i; break; }
  }
  const blockLines = block.split('\n');
  blockLines.push(''); // trailing blank line before next header / EOF
  lines.splice(start, end - start, ...blockLines);
  return lines.join('\n');
}

// Carpeta de configuración compartida con el CLI y el MCP (cli/lib.mjs: configDir).
// Respeta XDG_CONFIG_HOME para poder aislar pruebas y perfiles sin tocar el real.
function cliConfigDir() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(require('node:os').homedir(), '.config'), 'edinot');
}

// ─── Hub local ────────────────────────────────────────────────────────────
// Un proceso aparte (hub/run.mjs) que guarda la copia completa de tus datos en
// disco. La app se sincroniza con él y el CLI/MCP también, así que funcionan sin
// red con o sin la app abierta. Sigue en marcha al cerrar la app (a propósito:
// `edinot hub stop` lo para). Aquí solo se localiza, se arranca y se entrega su
// dirección y clave al renderer.
function hubDataDir() {
  if (process.env.EDINOT_HUB_DIR) return process.env.EDINOT_HUB_DIR;
  const home = require('node:os').homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'edinot', 'hub');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'edinot', 'hub');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'edinot', 'hub');
}
function readHubInfoFile() {
  try {
    const j = JSON.parse(fsSync.readFileSync(path.join(hubDataDir(), 'hub.json'), 'utf8'));
    return j && j.url && j.key ? j : null;
  } catch { return null; }
}
async function hubResponds(info, ms = 1200) {
  if (!info) return false;
  try {
    const r = await fetch(info.url.replace(/\/$/, '') + '/healthz', { signal: AbortSignal.timeout(ms) });
    const j = r.ok ? await r.json() : null;
    return !!(j && j.ok && j.hub);
  } catch { return false; }
}
function hubScript() {
  if (process.env.EDINOT_HUB_SCRIPT) return process.env.EDINOT_HUB_SCRIPT;
  if (app.isPackaged) { ensureStableMcpServer(); return path.join(path.dirname(STABLE_MCP_PATH), 'hub.mjs'); }
  const bundled = path.join(path.resolve(__dirname, '..'), 'dist', 'hub.mjs');
  return fsSync.existsSync(bundled) ? bundled : path.join(path.resolve(__dirname, '..'), 'hub', 'run.mjs');
}
let hubStarting = null;
function ensureHubFromMain() {
  if (hubStarting) return hubStarting;
  hubStarting = (async () => {
    let info = readHubInfoFile();
    if (await hubResponds(info)) return { ok: true, url: info.url, key: info.key, dir: hubDataDir() };
    const script = hubScript();
    if (!fsSync.existsSync(script)) return { ok: false, error: 'no encuentro el hub: ' + script };
    try {
      fsSync.mkdirSync(hubDataDir(), { recursive: true, mode: 0o700 });
      const log = fsSync.openSync(path.join(hubDataDir(), 'hub.log'), 'a');
      // Chromium deja descriptores sin marcar al lanzar procesos (p. ej. el puerto de
      // depuración): el hub los heredaría y retendría sockets de la app incluso tras
      // cerrarla. En POSIX se cierran del 3 al 255 antes de ejecutar el hub.
      const posix = process.platform !== 'win32';
      const cmd = posix ? '/bin/sh' : process.execPath;
      const args = posix
        ? ['-c', 'i=3; while [ $i -lt 256 ]; do eval "exec $i>&-" 2>/dev/null; i=$((i+1)); done; exec "$0" "$@"', process.execPath, script]
        : [script];
      const child = require('node:child_process').spawn(cmd, args, {
        detached: true, stdio: ['ignore', log, log], windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      child.unref();
    } catch (err) { return { ok: false, error: 'no se pudo lanzar el hub: ' + (err.message || err) }; }
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      await new Promise(r => setTimeout(r, 150));
      info = readHubInfoFile();
      if (await hubResponds(info, 800)) return { ok: true, url: info.url, key: info.key, dir: hubDataDir() };
    }
    return { ok: false, error: 'el hub no arrancó a tiempo (mira ' + path.join(hubDataDir(), 'hub.log') + ')' };
  })().finally(() => { hubStarting = null; });
  return hubStarting;
}
ipcMain.handle('hub:ensure', () => ensureHubFromMain());

// Copiar los datos de este equipo a otro hub (el de un servidor al que se acaba de emparejar) ANTES de
// sincronizar con él. Se ejecuta el mismo `edinot hub push` que usa el CLI, con el CLI empaquetado.
// La credencial viaja por variable de entorno, no por la línea de comandos.
function cliScript() {
  if (app.isPackaged) { ensureStableMcpServer(); return path.join(path.dirname(STABLE_MCP_PATH), 'edinot.mjs'); }
  const bundled = path.join(path.resolve(__dirname, '..'), 'dist', 'edinot.mjs');
  return fsSync.existsSync(bundled) ? bundled : path.join(path.resolve(__dirname, '..'), 'cli', 'edinot.mjs');
}
ipcMain.handle('hub:push', async (e, { target, token, ca } = {}) => {
  if (!target || !token) return { ok: false, error: 'faltan el destino y la credencial' };
  const script = cliScript();
  if (!fsSync.existsSync(script)) return { ok: false, error: 'no encuentro el CLI: ' + script };
  const wc = e.sender;
  return new Promise((resolve) => {
    const out = [];
    let child;
    try {
      child = require('node:child_process').spawn(process.execPath, [script, 'hub', 'push', '--to', target], {
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EDINOT_PUSH_TOKEN: token, ...(ca ? { EDINOT_PUSH_CA: ca } : {}), NODE_NO_WARNINGS: '1' },
      });
    } catch (err) { resolve({ ok: false, error: String(err && err.message || err) }); return; }
    const feed = (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        if (!line.trim()) continue;
        out.push(line); if (out.length > 60) out.shift();
        try { if (!wc.isDestroyed()) wc.send('hub:pushProgress', line); } catch {}
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (err) => resolve({ ok: false, error: String(err && err.message || err), output: out }));
    child.on('close', (code) => resolve({ ok: code === 0, code, output: out }));
  });
});
// ── Servidores con certificado propio (hub cifrado sin dominio) ─────────────────
// El certificado se fija al emparejar (la huella viene en el enlace) y desde entonces SOLO se acepta ese
// para ese servidor; el resto de sitios sigue la validación normal de Chromium. Los certificados fijados se
// guardan en un archivo de la carpeta de datos para estar listos antes de que la ventana se conecte.
const nodeCrypto = require('node:crypto');
const nodeTls = require('node:tls');
let tlsPinsCache = null;
const tlsPinsFile = () => path.join(app.getPath('userData'), 'tls-pins.json');
function tlsPins() {
  if (tlsPinsCache) return tlsPinsCache;
  try { tlsPinsCache = JSON.parse(fsSync.readFileSync(tlsPinsFile(), 'utf8')) || {}; } catch { tlsPinsCache = {}; }
  return tlsPinsCache;
}
function saveTlsPins() { try { fsSync.writeFileSync(tlsPinsFile(), JSON.stringify(tlsPins()), { mode: 0o600 }); } catch {} }
const certFp = (pem) => nodeCrypto.createHash('sha256').update(new nodeCrypto.X509Certificate(pem).raw).digest('base64url');
function installTlsPinning() {
  session.defaultSession.setCertificateVerifyProc((req, cb) => {
    let pinned = null;
    for (const [origin, pem] of Object.entries(tlsPins())) {
      try { if (new URL(origin).hostname.replace(/^\[|\]$/g, '') === req.hostname.replace(/^\[|\]$/g, '')) { pinned = pem; break; } } catch {}
    }
    if (!pinned) return cb(-3);                       // validación normal
    try { cb(certFp(req.certificate.data) === certFp(pinned) ? 0 : -2); } catch { cb(-2); }
  });
}
ipcMain.handle('tls:pinFromLink', async (_e, { url, fp } = {}) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return { ok: false, error: 'la dirección no es https' };
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const der = await new Promise((resolve, reject) => {
      const sock = nodeTls.connect({ host, port: Number(u.port || 443), rejectUnauthorized: false, servername: /^[\d.]+$|:/.test(host) ? undefined : host });
      const timer = setTimeout(() => { sock.destroy(); reject(new Error('el servidor no responde')); }, 8000);
      sock.once('secureConnect', () => { clearTimeout(timer); const c = sock.getPeerCertificate(true); sock.end(); c && c.raw ? resolve(c.raw) : reject(new Error('el servidor no presentó certificado')); });
      sock.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
    const got = nodeCrypto.createHash('sha256').update(der).digest('base64url');
    if (!fp || got !== String(fp)) return { ok: false, error: 'la huella del servidor NO coincide con la del enlace: no te conectes (puede haber alguien en medio)' };
    const pem = '-----BEGIN CERTIFICATE-----\n' + Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END CERTIFICATE-----\n';
    tlsPins()[u.origin] = pem; saveTlsPins();
    return { ok: true, pem };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('tls:setPin', (_e, { url, pem } = {}) => {
  try { const o = new URL(url).origin; if (pem) tlsPins()[o] = pem; else delete tlsPins()[o]; saveTlsPins(); return true; } catch { return false; }
});
// ── Comando `edinot` en la terminal ─────────────────────────────────────────────
// Un script pequeño que apunta a la copia estable del CLI que mantiene la app (no al AppImage, que cambia
// de ruta al actualizarse). Usa el Node del sistema si es 20+, y si no el propio Electron como Node.
// No toca el PATH de nadie: si la carpeta no está en él, la interfaz dice cómo añadirla.
function cliBinDir() {
  return process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'Edinot', 'bin')
    : path.join(require('node:os').homedir(), '.local', 'bin');
}
const cliBinFile = () => path.join(cliBinDir(), process.platform === 'win32' ? 'edinot.cmd' : 'edinot');
function cliState() {
  const file = cliBinFile();
  let installed = false;
  try { installed = fsSync.readFileSync(file, 'utf8').includes('Generado por Edinot'); } catch {}
  const dir = cliBinDir();
  const inPath = String(process.env.PATH || '').split(path.delimiter).some((d) => d && path.resolve(d) === path.resolve(dir));
  return { installed, file, dir, inPath, platform: process.platform };
}
ipcMain.handle('cli:status', () => cliState());
ipcMain.handle('cli:install', () => {
  try {
    const script = cliScript();
    if (!fsSync.existsSync(script)) return { ok: false, error: 'no encuentro el CLI: ' + script };
    const exe = process.env.APPIMAGE || process.execPath;
    const sq = (x) => String(x).replace(/'/g, "'\\''");
    let body;
    if (process.platform === 'win32') {
      body = `@echo off\r\nrem Generado por Edinot (Ajustes > Conexiones). Se regenera al reinstalar.\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${script}" %*\r\n`;
    } else {
      body = `#!/bin/sh
# Generado por Edinot (Ajustes > Conexiones). Se regenera al reinstalar.
SCRIPT='${sq(script)}'
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; then
  exec node "$SCRIPT" "$@"
fi
exec /usr/bin/env ELECTRON_RUN_AS_NODE=1 '${sq(exe)}' "$SCRIPT" "$@"
`;
    }
    // Nunca se pisa un archivo que no haya creado Edinot (p. ej. un lanzador `edinot` de la propia app).
    try {
      const prev = fsSync.readFileSync(cliBinFile(), 'utf8');
      if (!prev.includes('Generado por Edinot')) return { ok: false, error: `Ya existe un archivo «edinot» que no es este comando (${cliBinFile()}). Renómbralo o bórralo y vuelve a intentarlo: no lo he tocado.` };
    } catch {}
    fsSync.mkdirSync(cliBinDir(), { recursive: true });
    fsSync.writeFileSync(cliBinFile(), body, { mode: 0o755 });
    if (process.platform !== 'win32') fsSync.chmodSync(cliBinFile(), 0o755);
    return { ok: true, ...cliState() };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('cli:uninstall', () => {
  try { if (cliState().installed) fsSync.unlinkSync(cliBinFile()); return { ok: true, ...cliState() }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('app:hostName', () => require('node:os').hostname().split('.')[0]);

// Reuse the active app session as the MCP server's identity. Writes
// `~/.config/edinot/cli.json` (the file the MCP server already reads on
// startup) so the user no longer has to do a separate `edinot login` step
// from a terminal. Optionally also merges the `mcpServers.edinot` entry
// into Claude Desktop's config.
ipcMain.handle('mcp:setup', async (_e, { mode, httpUrl, token, workspaceId, email, userId, tier, tlsCa, alsoClaudeConfig, alsoCodexConfig, alsoClaudeCodeConfig, alsoCursorConfig, mcpServerPath }) => {
  const cliPath = path.join(cliConfigDir(), 'cli.json');
  const result = { ok: true, cliAuthPath: cliPath };
  let payload;
  if (mode === 'hub') {
    // La app está sincronizada con el hub local: el MCP y el CLI lo usan directamente
    // (se arranca solo, sin red). No se guarda ni puerto ni token: cambian entre arranques.
    payload = { mode: 'hub', workspaceId: workspaceId || null };
    result.hub = true;
  } else if (mode === 'local') {
    // No sync: route the MCP server at the disk-exported vault tree the app
    // already maintains. Writes there are pulled back into the Y.Doc via the
    // export watcher.
    payload = { mode: 'local', vaultDir: EXPORT_ROOT };
    result.localVaultDir = EXPORT_ROOT;
  } else {
    if (!httpUrl || !token || !workspaceId) {
      return { ok: false, error: 'app no autenticada — inicia sesión en Sync primero' };
    }
    payload = { server: httpUrl, email: email || null, token, workspaceId, userId: userId || null, tier: tier || null, ...(tlsCa ? { tlsCa } : {}) };
  }
  try {
    await fs.mkdir(path.dirname(cliPath), { recursive: true });
    await fs.writeFile(cliPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    return { ok: false, error: 'error al escribir cli.json: ' + (err.message || err) };
  }

  const fallbackPath = app.isPackaged
    ? (ensureStableMcpServer(), STABLE_MCP_PATH)
    : path.join(path.resolve(__dirname, '..'), 'mcp', 'server.mjs');
  const serverPath = mcpServerPath || fallbackPath;

  if (alsoClaudeConfig) {
    const claudePaths = claudeDesktopConfigPaths();
    const merged = [];
    const errors = [];
    for (const claudePath of claudePaths) {
      try {
        await mergeJsonMcpConfig(claudePath, serverPath, { EDINOT_AGENT_KIND: 'claude' });
        merged.push(claudePath);
      } catch (err) {
        errors.push(`${claudePath}: ${err.message || String(err)}`);
      }
    }
    if (merged.length) {
      result.claudeConfigPath = merged[0];
      result.claudeConfigPaths = merged;
      result.claudeConfigMerged = true;
    } else if (errors.length) {
      result.claudeConfigError = errors.join('; ');
    }
  }

  if (alsoClaudeCodeConfig) {
    const ccPath = claudeCodeConfigPath();
    try {
      await mergeJsonMcpConfig(ccPath, serverPath, { EDINOT_AGENT_KIND: 'claude-code' });
      result.claudeCodeConfigPath = ccPath;
      result.claudeCodeConfigMerged = true;
    } catch (err) {
      result.claudeCodeConfigError = err.message || String(err);
    }
  }

  if (alsoCursorConfig) {
    const curPath = cursorConfigPath();
    try {
      await mergeJsonMcpConfig(curPath, serverPath, { EDINOT_AGENT_KIND: 'cursor' });
      result.cursorConfigPath = curPath;
      result.cursorConfigMerged = true;
    } catch (err) {
      result.cursorConfigError = err.message || String(err);
    }
  }

  if (alsoCodexConfig) {
    const codexPath = codexConfigPath();
    let existing = '';
    try { existing = await fs.readFile(codexPath, 'utf8'); }
    catch { /* missing — start fresh */ }
    try {
      const next = mergeCodexBlock(existing, serverPath, { EDINOT_AGENT_KIND: 'codex' });
      await fs.mkdir(path.dirname(codexPath), { recursive: true });
      await fs.writeFile(codexPath, next, 'utf8');
      result.codexConfigPath = codexPath;
      result.codexConfigMerged = true;
    } catch (err) {
      result.codexConfigError = err.message || String(err);
    }
  }
  return result;
});

// Reveal the cli.json / Claude config file in the OS file manager.
ipcMain.handle('mcp:revealFile', async (_e, { which }) => {
  let target = '';
  if (which === 'cli') target = path.join(cliConfigDir(), 'cli.json');
  else if (which === 'claude') target = claudeDesktopConfigPath();
  else if (which === 'codex') target = codexConfigPath();
  else if (which === 'claudeCode') target = claudeCodeConfigPath();
  else if (which === 'cursor') target = cursorConfigPath();
  else return { ok: false };
  try { await fs.access(target); shell.showItemInFolder(target); }
  catch { shell.openPath(path.dirname(target)); }
  return { ok: true };
});

ipcMain.handle('export:getRoot', () => EXPORT_ROOT);

// Export a rendered markdown table to .xlsx. Renderer hands us the headers
// + rows it already parsed; we surface a Save dialog and write the workbook
// out via the bundled `xlsx` dep. Keeping the heavy lib here (Node side)
// avoids dragging it into the renderer bundle.
//
// Cells arrive as raw markdown source (`**Total**`, `[texto](url)`…) — Excel
// has no notion of those markers, so strip the inline syntax and keep the
// visible text. `_`-emphasis only strips at word boundaries so snake_case
// survives (mirrors CommonMark's intra-word rule).
function stripMdInlineForCell(value) {
  let t = String(value == null ? '' : value);
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');                  // image → alt
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');                   // link → text
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');             // wikilink alias
  t = t.replace(/\[\[([^\]]+)\]\]/g, '$1');                        // wikilink
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');                       // bold **
  t = t.replace(/__([^_\n]+)__/g, '$1');                           // bold __
  t = t.replace(/\*([^*\n]+)\*/g, '$1');                           // italic *
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2'); // italic _
  t = t.replace(/~~([^~\n]+)~~/g, '$1');                           // strikethrough
  t = t.replace(/==([^=\n]+)==/g, '$1');                           // highlight
  t = t.replace(/`([^`\n]+)`/g, '$1');                             // inline code
  return t.trim();
}

ipcMain.handle('table:exportXlsx', async (_e, { headers, rows, defaultName, sheetName } = {}) => {
  try {
    if (!Array.isArray(headers) || !Array.isArray(rows)) {
      return { ok: false, error: 'invalid table payload' };
    }
    const XLSX = require('xlsx');
    const cleanHeaders = headers.map(stripMdInlineForCell);
    const cleanRows = rows.map(r => Array.isArray(r) ? r.map(stripMdInlineForCell) : []);
    const aoa = [cleanHeaders, ...cleanRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Tabla').slice(0, 31));
    const safeDefault = String(defaultName || 'tabla.xlsx').replace(/[/\\]/g, '_');
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    const res = await dialog.showSaveDialog(win, {
      title: 'Exportar tabla como Excel',
      defaultPath: safeDefault.endsWith('.xlsx') ? safeDefault : `${safeDefault}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await fs.writeFile(res.filePath, buf);
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Documento imprimible de la nota (tipografía del rediseño, avisos,
// desplegables, propiedades y bases de datos) y su versión para Word.
const { buildExportHtml, toDocxHtml, exportFontCss } = require('./export-html.cjs');

// Replace `edinot://blob/<sha>` image sources with inline data: URLs so a
// Node-side converter (Word export) can embed them — the custom protocol only
// resolves inside a BrowserWindow (that's why PDF already shows them). Only
// images are inlined (not pdf/video blobs), and only from cache/already-known
// creds, so this stays cheap for the common "export the note I'm viewing" case.
async function inlineBlobImagesForExport(html) {
  const s = String(html || '');
  const imgRe = /<img\b[^>]*\bsrc="edinot:\/\/blob\/([a-f0-9]{64})/gi;
  const shas = new Set();
  let m;
  while ((m = imgRe.exec(s))) shas.add(m[1].toLowerCase());
  if (!shas.size) return s;
  const map = new Map();
  for (const sha of shas) {
    try {
      const got = await resolveBlobBytes(sha, null);
      if (got && got.ok && got.bytes) map.set(sha, `data:${got.mime || 'image/png'};base64,${got.bytes.toString('base64')}`);
    } catch {}
  }
  return s.replace(/edinot:\/\/blob\/([a-f0-9]{64})/gi, (full, sha) => map.get(sha.toLowerCase()) || full);
}

ipcMain.handle('note:export', async (_e, { format, name, markdown, html, letterhead } = {}) => {
  try {
    const npath = require('path');
    const os = require('os');
    const base = (String(name || 'nota').replace(/\.(md|markdown|txt)$/i, '').replace(/[/\\]/g, '_')) || 'nota';
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    if (format === 'md') {
      const res = await dialog.showSaveDialog(win, { title: 'Exportar como Markdown', defaultPath: `${base}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      await fs.writeFile(res.filePath, String(markdown || ''), 'utf8');
      return { ok: true, path: res.filePath };
    }
    const doc = buildExportHtml(base, html || '', letterhead);
    if (format === 'html') {
      const res = await dialog.showSaveDialog(win, { title: 'Exportar como HTML', defaultPath: `${base}.html`, filters: [{ name: 'HTML', extensions: ['html'] }] });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      await fs.writeFile(res.filePath, doc, 'utf8');
      return { ok: true, path: res.filePath };
    }
    if (format === 'pdf') {
      const res = await dialog.showSaveDialog(win, { title: 'Exportar como PDF', defaultPath: `${base}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const tmp = npath.join(os.tmpdir(), `edinot-export-${Date.now()}.html`);
      // El PDF se imprime desde este equipo: incrusta las fuentes del build.
      fsSync.writeFileSync(tmp, buildExportHtml(base, html || '', letterhead, { fontCss: exportFontCss(DIST_DIR) }), 'utf8');
      const off = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
      try {
        await off.loadFile(tmp);
        const pdf = await off.webContents.printToPDF({ printBackground: true, preferCSSPageSize: false });
        await fs.writeFile(res.filePath, pdf);
      } finally {
        try { off.destroy(); } catch {}
        try { fsSync.unlinkSync(tmp); } catch {}
      }
      return { ok: true, path: res.filePath };
    }
    if (format === 'docx') {
      const res = await dialog.showSaveDialog(win, { title: 'Exportar como Word', defaultPath: `${base}.docx`, filters: [{ name: 'Word', extensions: ['docx'] }] });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      let HTMLtoDOCX;
      try { HTMLtoDOCX = require('html-to-docx'); }
      catch (e) { return { ok: false, error: 'export a Word no disponible: ' + (e && e.message || e) }; }
      // Reuse the same HTML document (logo letterhead + table styling) — the
      // converter embeds data: images and maps headings/tables/lists to Word.
      // edinot:// blob images must be inlined first (Node can't resolve them).
      const docInlined = await inlineBlobImagesForExport(toDocxHtml(doc));
      const out = await HTMLtoDOCX(docInlined, null, { table: { row: { cantSplit: true } }, footer: false, pageNumber: false });
      const buf = Buffer.isBuffer(out) ? out : Buffer.from(out);
      await fs.writeFile(res.filePath, buf);
      return { ok: true, path: res.filePath };
    }
    return { ok: false, error: 'unknown format: ' + format };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// ─── Disk → Y.Doc reverse sync (used by the local-mode MCP server) ────────
// Watches the vault-export folder; when an .md file changes (someone edited
// it on disk, eg the MCP server) we look up its file ID via the export index
// and send the new content to the renderer so it applies a Y.Text diff. The
// existing Y → disk export naturally suppresses the loop: when the renderer's
// next debounced flush runs, contentLen matches and no rewrite happens.
const watchDebounce = new Map();
let exportWatcher = null;
function startExportWatcher() {
  if (exportWatcher) return;
  try { fsSync.mkdirSync(EXPORT_ROOT, { recursive: true }); } catch {}
  try {
    exportWatcher = fsSync.watch(EXPORT_ROOT, { recursive: true }, (eventType, relPath) => {
      if (!relPath || !relPath.endsWith('.md')) return;
      const key = relPath;
      if (watchDebounce.has(key)) clearTimeout(watchDebounce.get(key));
      watchDebounce.set(key, setTimeout(async () => {
        watchDebounce.delete(key);
        const absPath = path.join(EXPORT_ROOT, relPath);
        let content;
        try { content = await fs.readFile(absPath, 'utf8'); } catch { return; }
        await loadExportIndex();
        const norm = relPath.split(path.sep).join('/');
        let foundId = null;
        for (const [id, rec] of Object.entries(exportIndex)) {
          if (!rec) continue;
          if (rec.relPath.split(path.sep).join('/') === norm) { foundId = id; break; }
        }
        if (!foundId) return;
        // If the disk content's fingerprint matches what we last exported,
        // this fs.watch event is our own echo — pushing back to the renderer
        // would risk reverting concurrent typing that hasn't been re-exported
        // yet, so we drop it. Only genuine external writes (eg. the MCP
        // server in local mode) make it through.
        const diskHash = fingerprintContent(content);
        if (exportIndex[foundId] && exportIndex[foundId].contentHash === diskHash) return;
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('vault-export:fileChanged', { fileId: foundId, content });
        }
      }, 250));
    });
  } catch (err) {
    console.warn('[export-watch] could not start watcher:', err.message);
  }
}
ipcMain.handle('export:revealRoot', async () => {
  await fs.mkdir(EXPORT_ROOT, { recursive: true });
  shell.openPath(EXPORT_ROOT);
});

ipcMain.handle('export:apply', async (_e, { files, vaults, folders, full }) => {
  if (!Array.isArray(files) || !Array.isArray(vaults)) return { ok: false };
  // `full === false` is an incremental snapshot carrying only the notes whose
  // content changed. Absent ids are unchanged, NOT deleted — so skip the
  // deletion pass. Deletions/renames always arrive as a full snapshot.
  const isFull = full !== false;
  const folderList = Array.isArray(folders) ? folders : [];
  await loadExportIndex();
  await fs.mkdir(EXPORT_ROOT, { recursive: true });

  const seen = new Set();
  for (const f of files) {
    if (!f || !f.id) continue;
    seen.add(f.id);
    const relPath = buildRelPath(vaults, folderList, f);
    let absPath = path.join(EXPORT_ROOT, relPath);
    absPath = await ensureUnique(absPath, f.id);
    const finalRel = path.relative(EXPORT_ROOT, absPath);

    const prev = exportIndex[f.id];
    if (prev && prev.relPath !== finalRel) {
      const prevAbs = path.join(EXPORT_ROOT, prev.relPath);
      try {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.rename(prevAbs, absPath);
      } catch {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
      }
    } else {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
    }

    const content = typeof f.content === 'string' ? f.content : '';
    const newHash = fingerprintContent(content);
    const needsWrite = !prev || prev.relPath !== finalRel || prev.contentHash !== newHash;
    if (needsWrite) {
      await fs.writeFile(absPath, content, 'utf8');
    } else {
      // hash matches; still write if file missing on disk
      try { await fs.access(absPath); } catch { await fs.writeFile(absPath, content, 'utf8'); }
    }
    exportIndex[f.id] = { relPath: finalRel, contentLen: content.length, contentHash: newHash };
  }

  // Deletions: anything tracked but not in snapshot (full snapshots only —
  // an incremental payload omits unchanged notes, which must not be deleted).
  if (isFull) {
    for (const id of Object.keys(exportIndex)) {
      if (seen.has(id)) continue;
      const rec = exportIndex[id];
      try { await fs.unlink(path.join(EXPORT_ROOT, rec.relPath)); } catch {}
      delete exportIndex[id];
    }
  }

  await saveExportIndex();
  return { ok: true, root: EXPORT_ROOT, count: files.length };
});

ipcMain.handle('file:writeExternal', async (_e, { path: filePath, content }) => {
  if (!filePath) return { ok: false, error: 'no path' };
  try {
    await fs.writeFile(filePath, content || '', 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('file:saveAs', async (_e, { content }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    defaultPath: 'untitled.md',
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  await fs.writeFile(res.filePath, content, 'utf8');
  return { canceled: false, path: res.filePath };
});

// Export a note with every `edinot://blob/<sha>` reference rewritten to a
// `data:<mime>;base64,<bytes>` URI, producing a single portable .md file. We
// resolve each sha from the local blob-cache first, then fall back to a
// server fetch (using the same auth context that the protocol handler uses).
ipcMain.handle('file:saveWithAttachments', async (_e, { content, defaultName }) => {
  if (!mainWindow) return { canceled: true };
  const sha_rx = /edinot:\/\/blob\/([a-f0-9]{64})/gi;
  const shas = new Set();
  let m;
  while ((m = sha_rx.exec(content)) !== null) shas.add(m[1].toLowerCase());

  const cacheDir = BLOB_CACHE_DIR();
  const resolved = new Map(); // sha → { mime, base64 }
  let totalBytes = 0;

  for (const sha of shas) {
    let bytes = null;
    let mime = 'application/octet-stream';
    try {
      bytes = await fs.readFile(path.join(cacheDir, sha + '.bin'));
      const metaTxt = await fs.readFile(path.join(cacheDir, sha + '.meta'), 'utf8').catch(() => '');
      mime = (metaTxt && metaTxt.trim()) || mime;
    } catch { /* cache miss */ }
    if (!bytes && blobSyncContext.httpUrl && blobSyncContext.token) {
      try {
        const url = `${blobSyncContext.httpUrl.replace(/\/$/, '')}/blobs/${sha}?t=${encodeURIComponent(blobSyncContext.token)}`;
        const r = await net.fetch(url);
        if (r.ok) {
          bytes = Buffer.from(await r.arrayBuffer());
          mime = r.headers.get('content-type') || mime;
          // Write through to cache for future use.
          try { await writeBlobCacheAtomic(cacheDir, sha, bytes, mime); } catch {}
        }
      } catch { /* network failure → leave unresolved */ }
    }
    if (bytes) {
      totalBytes += bytes.length;
      resolved.set(sha, { mime, base64: bytes.toString('base64') });
    }
  }

  const unresolved = [];
  const rewritten = content.replace(sha_rx, (full, sha) => {
    const lower = sha.toLowerCase();
    const r = resolved.get(lower);
    if (!r) { unresolved.push(lower); return full; }
    return `data:${r.mime};base64,${r.base64}`;
  });

  const res = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    defaultPath: defaultName || 'untitled.md',
    title: 'Exportar con adjuntos inline',
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  await fs.writeFile(res.filePath, rewritten, 'utf8');
  return {
    canceled: false,
    path: res.filePath,
    attachmentsCount: resolved.size,
    unresolvedCount: unresolved.length,
    totalBytes,
  };
});

// Export every note in the workspace as a folder of .md files alongside a
// shared `attachments/` subdirectory with the raw blob bytes, rewriting each
// `edinot://blob/<sha>` reference to a relative `attachments/...` path so the
// resulting tree is portable without Edinot.
ipcMain.handle('file:exportWorkspaceBundle', async (_e, { notes }) => {
  if (!mainWindow) return { canceled: true };
  if (!Array.isArray(notes) || !notes.length) return { canceled: true, error: 'no notes' };

  const dlg = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Carpeta destino para el workspace exportado',
  });
  if (dlg.canceled || !dlg.filePaths[0]) return { canceled: true };
  const outDir = dlg.filePaths[0];

  // 1. Collect every unique sha referenced, plus the alt-text it appeared
  //    with (used to derive the on-disk filename).
  const sha_rx = /edinot:\/\/blob\/([a-f0-9]{64})/gi;
  const md_link_rx = /(!?)\[([^\]\n]*)\]\(edinot:\/\/blob\/([a-f0-9]{64})[^)]*\)/gi;
  const blobFile = new Map(); // sha → { filename, mime, bytes }
  const seenNames = new Set();

  // Helpers
  const sanitize = (s) => String(s || '').replace(/[\/\\:*?"<>|\0]/g, '_').slice(0, 120) || 'attachment';
  const ensureUnique = (name) => {
    let candidate = name;
    let i = 1;
    while (seenNames.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      candidate = `${stem} (${i})${ext}`;
      i++;
    }
    seenNames.add(candidate.toLowerCase());
    return candidate;
  };

  // First pass — collect candidate filenames for each sha (use the first alt
  // that's not a "Subiendo…" placeholder).
  const altBySha = new Map();
  for (const note of notes) {
    md_link_rx.lastIndex = 0;
    let m;
    while ((m = md_link_rx.exec(note.content)) !== null) {
      const alt = m[2];
      const sha = m[3].toLowerCase();
      if (!altBySha.has(sha) && alt && !/^Subiendo /.test(alt)) {
        altBySha.set(sha, alt);
      }
    }
  }

  // Second pass — resolve each blob from cache or sync server.
  const cacheDir = BLOB_CACHE_DIR();
  let resolved = 0, unresolved = 0, totalBytes = 0;
  for (const sha of altBySha.keys()) {
    let bytes = null;
    let mime = 'application/octet-stream';
    try {
      bytes = await fs.readFile(path.join(cacheDir, sha + '.bin'));
      const metaTxt = await fs.readFile(path.join(cacheDir, sha + '.meta'), 'utf8').catch(() => '');
      if (metaTxt) mime = metaTxt.trim();
    } catch {}
    if (!bytes && blobSyncContext.httpUrl && blobSyncContext.token) {
      try {
        const url = `${blobSyncContext.httpUrl.replace(/\/$/, '')}/blobs/${sha}?t=${encodeURIComponent(blobSyncContext.token)}`;
        const r = await net.fetch(url);
        if (r.ok) {
          bytes = Buffer.from(await r.arrayBuffer());
          mime = r.headers.get('content-type') || mime;
        }
      } catch {}
    }
    if (!bytes) { unresolved++; continue; }
    const baseName = sanitize(altBySha.get(sha) || sha.slice(0, 12));
    const finalName = ensureUnique(baseName);
    blobFile.set(sha, { filename: finalName, mime, bytes });
    totalBytes += bytes.length;
    resolved++;
  }

  // 3. Write attachments and the rewritten notes.
  const attachDir = path.join(outDir, 'attachments');
  if (blobFile.size) await fs.mkdir(attachDir, { recursive: true });
  for (const [sha, rec] of blobFile.entries()) {
    await fs.writeFile(path.join(attachDir, rec.filename), rec.bytes);
  }

  const noteNamesSeen = new Set();
  const ensureNoteFilename = (rawName) => {
    const base = sanitize(rawName.replace(/\.(md|markdown|txt)$/i, '')) + '.md';
    let candidate = base;
    let i = 1;
    while (noteNamesSeen.has(candidate.toLowerCase())) {
      candidate = base.replace(/\.md$/, ` (${i}).md`);
      i++;
    }
    noteNamesSeen.add(candidate.toLowerCase());
    return candidate;
  };

  let unresolvedRefsInDoc = 0;
  for (const note of notes) {
    const rewritten = note.content.replace(sha_rx, (full, rawSha) => {
      const sha = rawSha.toLowerCase();
      const rec = blobFile.get(sha);
      if (!rec) { unresolvedRefsInDoc++; return full; }
      return `attachments/${encodeURIComponent(rec.filename)}`;
    });
    const filename = ensureNoteFilename(note.name || 'untitled');
    await fs.writeFile(path.join(outDir, filename), rewritten, 'utf8');
  }

  return {
    canceled: false,
    outDir,
    noteCount: notes.length,
    attachmentCount: resolved,
    unresolvedCount: unresolved,
    unresolvedRefsInDoc,
    totalBytes,
  };
});

// Renderer-side helpers can call this to fetch a blob's bytes (from cache or
// the sync server) and convert via mammoth/xlsx so inline previews work for
// docx and xlsx. Returns the HTML body string.
ipcMain.handle('blob:convertOffice', async (_e, { sha, kind, auth }) => {
  if (!SHA_RX.test(sha)) return { ok: false, error: 'bad sha' };
  const cacheDir = BLOB_CACHE_DIR();
  let bytes = null;
  let lastError = null;
  try { bytes = await fs.readFile(path.join(cacheDir, sha + '.bin')); }
  catch {
    // Prefer credentials the renderer just handed us (always fresh, sourced
    // from React state) over the IPC-pushed `blobSyncContext` (which can lag
    // behind on the very first render after boot).
    const creds = (auth && auth.httpUrl && auth.token) ? auth : blobSyncContext;
    if (!creds.httpUrl || !creds.token) {
      lastError = 'sin conexión y no está en caché local';
    } else {
      try {
        const url = `${creds.httpUrl.replace(/\/$/, '')}/blobs/${sha}?t=${encodeURIComponent(creds.token)}`;
        const r = await net.fetch(url);
        if (r.ok) {
          bytes = Buffer.from(await r.arrayBuffer());
          try {
            await writeBlobCacheAtomic(cacheDir, sha, bytes,
              r.headers.get('content-type') || 'application/octet-stream');
          } catch {}
        } else {
          lastError = `el servidor respondió ${r.status} ${r.statusText || ''}`.trim();
        }
      } catch (err) {
        lastError = `fallo al contactar el servidor: ${err && err.message || err}`;
      }
    }
  }
  if (!bytes) return { ok: false, error: lastError || 'no se pudo obtener el adjunto' };

  try {
    if (kind === 'docx') {
      const mammoth = require('mammoth');
      const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
      return { ok: true, html };
    }
    if (kind === 'xlsx') {
      const XLSX = require('xlsx');
      const wb = XLSX.read(bytes, { type: 'buffer' });
      const parts = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (wb.SheetNames.length > 1) parts.push(`<h3>${sheetName.replace(/[<>&]/g, '')}</h3>`);
        parts.push(XLSX.utils.sheet_to_html(sheet, { editable: false }));
      }
      return { ok: true, html: parts.join('\n') };
    }
    return { ok: false, error: 'unsupported kind' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// ─── Blob protocol (edinot://blob/<sha>) ─────────────────────────────────
// Resolves attachment URLs embedded in markdown. Cache-first: looks for the
// bytes in <userData>/blob-cache; on miss, fetches from the configured sync
// server (using the user's auth token) and writes through to cache.

let blobSyncContext = { httpUrl: null, token: null };
const BLOB_CACHE_DIR = () => path.join(app.getPath('userData'), 'blob-cache');
const SHA_RX = /^[a-f0-9]{64}$/i;

// Atomically write a blob to the on-disk cache: stream to a unique temp file,
// fsync, then rename over the final path (rename is atomic on the same fs).
// This prevents a half-written `.bin` — from an interrupted process or two
// concurrent writers (prefetch + protocol fetch) — from ever being read back
// and served as a permanently-broken "immutable" attachment. Empty buffers
// are refused so a zero-byte cache entry can't shadow a real blob.
async function writeBlobCacheAtomic(cacheDir, sha, buf, mime) {
  if (!buf || !buf.length) return false;
  await fs.mkdir(cacheDir, { recursive: true });
  const binPath = path.join(cacheDir, sha + '.bin');
  const metaPath = path.join(cacheDir, sha + '.meta');
  const suffix = `${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const tmpBin = binPath + '.' + suffix;
  const tmpMeta = metaPath + '.' + suffix;
  try {
    await fs.writeFile(tmpBin, buf);
    await fs.writeFile(tmpMeta, mime || 'application/octet-stream', 'utf8');
    await fs.rename(tmpBin, binPath);
    await fs.rename(tmpMeta, metaPath);
    return true;
  } catch (err) {
    try { await fs.unlink(tmpBin); } catch {}
    try { await fs.unlink(tmpMeta); } catch {}
    throw err;
  }
}

ipcMain.handle('sync:setContext', (_e, ctx) => {
  blobSyncContext = ctx && ctx.httpUrl && ctx.token ? { httpUrl: ctx.httpUrl, token: ctx.token } : { httpUrl: null, token: null };
});

ipcMain.handle('blob:cachePath', () => BLOB_CACHE_DIR());

// Cache-only read (no server fallback). Powers the renderer's attachment
// self-heal: blobs the server lost (historic GC bug) usually survive in this
// device's cache, so the renderer re-uploads them from here.
ipcMain.handle('blob:cacheRead', async (_e, sha) => {
  if (!SHA_RX.test(String(sha || ''))) return { ok: false };
  const dir = BLOB_CACHE_DIR();
  try {
    const bytes = await fs.readFile(path.join(dir, sha + '.bin'));
    const mime = (await fs.readFile(path.join(dir, sha + '.meta'), 'utf8').catch(() => 'application/octet-stream')).trim();
    return { ok: true, bytes, mime };
  } catch {
    return { ok: false };
  }
});

// Fetch a blob's bytes — cache-first, then server. Uses caller-supplied auth
// (always fresh from React state) before falling back to the IPC-pushed
// blobSyncContext, so it's robust against the boot-time race.
async function resolveBlobBytes(sha, auth) {
  if (!SHA_RX.test(sha)) return { ok: false, error: 'bad sha' };
  const cacheDir = BLOB_CACHE_DIR();
  try {
    const bytes = await fs.readFile(path.join(cacheDir, sha + '.bin'));
    const mime = (await fs.readFile(path.join(cacheDir, sha + '.meta'), 'utf8').catch(() => 'application/octet-stream')).trim();
    return { ok: true, bytes, mime };
  } catch { /* cache miss → fetch */ }
  const creds = (auth && auth.httpUrl && auth.token) ? auth : blobSyncContext;
  if (!creds.httpUrl || !creds.token) return { ok: false, error: 'sin conexión y no está en caché' };
  try {
    const url = `${creds.httpUrl.replace(/\/$/, '')}/blobs/${sha}?t=${encodeURIComponent(creds.token)}`;
    const r = await net.fetch(url);
    if (!r.ok) return { ok: false, error: `servidor respondió ${r.status} ${r.statusText || ''}`.trim() };
    const bytes = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get('content-type') || 'application/octet-stream';
    try { await writeBlobCacheAtomic(cacheDir, sha, bytes, mime); } catch {}
    return { ok: true, bytes, mime };
  } catch (err) {
    return { ok: false, error: `fallo al contactar el servidor: ${err && err.message || err}` };
  }
}

// "Descargar adjunto…" — show save dialog and write bytes to chosen path.
ipcMain.handle('blob:saveToFile', async (_e, { sha, filename, auth }) => {
  if (!mainWindow) return { canceled: true };
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: filename || 'archivo',
    title: 'Guardar adjunto como…',
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  const got = await resolveBlobBytes(sha, auth);
  if (!got.ok) return { canceled: false, ok: false, error: got.error };
  try {
    await fs.writeFile(res.filePath, got.bytes);
    return { canceled: false, ok: true, path: res.filePath };
  } catch (err) {
    return { canceled: false, ok: false, error: err.message || String(err) };
  }
});

// "Abrir con…" — write bytes to OS temp dir (preserving filename so the
// extension routes to the right default app) and shell-open them.
ipcMain.handle('blob:openWith', async (_e, { sha, filename, auth }) => {
  const got = await resolveBlobBytes(sha, auth);
  if (!got.ok) return { ok: false, error: got.error };
  const safe = String(filename || sha.slice(0, 12)).replace(/[\/\\:*?"<>|\0]/g, '_').slice(0, 200) || 'archivo';
  const dir = path.join(app.getPath('temp'), 'edinot-open');
  const target = path.join(dir, `${sha.slice(0, 12)}-${safe}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(target, got.bytes);
  } catch (err) {
    return { ok: false, error: 'error al escribir temp: ' + (err.message || err) };
  }
  const err = await shell.openPath(target);
  if (err) return { ok: false, error: err };
  return { ok: true, path: target };
});

// Write bytes the renderer already has (typically a freshly uploaded file)
// straight to the cache so the first preview/protocol-fetch hits disk instead
// of triggering a round-trip to the sync server.
ipcMain.handle('blob:cacheBytes', async (_e, { sha, mime, bytes }) => {
  if (!sha || !/^[a-f0-9]{64}$/i.test(sha)) return { ok: false, error: 'bad sha' };
  if (!bytes) return { ok: false, error: 'no bytes' };
  const cacheDir = BLOB_CACHE_DIR();
  try {
    await writeBlobCacheAtomic(cacheDir, sha, Buffer.from(bytes), mime || 'application/octet-stream');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// Batch prefetch for offline-first. Resolves sizes in a single bulk-metadata
// request, then concurrently downloads only blobs that (a) aren't cached and
// (b) fit under `maxBytes`. After writes finish we enforce the on-disk cache
// quota so prefetch can't push us over the limit. Returns a per-sha report.
ipcMain.handle('blob:prefetch', async (_e, { shas, maxBytes, auth, cacheMaxBytes } = {}) => {
  if (!Array.isArray(shas) || shas.length === 0) return { ok: true, results: [] };
  const creds = (auth && auth.httpUrl && auth.token) ? auth : blobSyncContext;
  if (!creds.httpUrl || !creds.token) return { ok: false, error: 'no sync credentials' };
  const cap = Number.isFinite(maxBytes) && maxBytes >= 0 ? maxBytes : Infinity;
  const cacheDir = BLOB_CACHE_DIR();
  await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
  const base = creds.httpUrl.replace(/\/$/, '');
  const tokenQuery = encodeURIComponent(creds.token);

  const candidates = [];
  const results = [];
  for (const sha of shas) {
    if (!SHA_RX.test(sha)) { results.push({ sha, status: 'invalid' }); continue; }
    try {
      await fs.access(path.join(cacheDir, sha + '.bin'));
      results.push({ sha, status: 'cached' });
    } catch { candidates.push(sha); }
  }
  if (candidates.length === 0) return { ok: true, results };

  const META_CHUNK = 500;
  const sizeBySha = new Map();
  const mimeBySha = new Map();
  for (let i = 0; i < candidates.length; i += META_CHUNK) {
    const slice = candidates.slice(i, i + META_CHUNK);
    try {
      const r = await net.fetch(`${base}/blobs/meta`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: slice }),
      });
      if (!r.ok) {
        for (const sha of slice) results.push({ sha, status: 'meta_failed', code: r.status });
        continue;
      }
      const json = await r.json();
      for (const m of (json.blobs || [])) {
        sizeBySha.set(m.id, Number(m.size));
        if (m.mime) mimeBySha.set(m.id, m.mime);
      }
    } catch (err) {
      for (const sha of slice) results.push({ sha, status: 'meta_error', error: err.message });
    }
  }

  const toFetch = [];
  for (const sha of candidates) {
    if (!sizeBySha.has(sha)) {
      if (!results.find(r => r.sha === sha)) results.push({ sha, status: 'missing' });
      continue;
    }
    const size = sizeBySha.get(sha);
    if (size > cap) { results.push({ sha, status: 'over_limit', size }); continue; }
    toFetch.push(sha);
  }

  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < toFetch.length) {
      const sha = toFetch[cursor++];
      try {
        const r = await net.fetch(`${base}/blobs/${sha}?t=${tokenQuery}`);
        if (!r.ok) { results.push({ sha, status: 'fetch_failed', code: r.status }); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        const mime = r.headers.get('content-type') || mimeBySha.get(sha) || 'application/octet-stream';
        await writeBlobCacheAtomic(cacheDir, sha, buf, mime);
        results.push({ sha, status: 'fetched', size: buf.length });
      } catch (err) {
        results.push({ sha, status: 'fetch_error', error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));

  if (Number.isFinite(cacheMaxBytes) && cacheMaxBytes > 0) {
    await enforceCacheQuota(cacheMaxBytes).catch(() => {});
  }
  return { ok: true, results };
});

// Iterate the cache dir, sum .bin sizes, sort by atime ASC and unlink the
// oldest until the total fits under `maxBytes`. atime is bumped implicitly
// on every protocol-handler read; on noatime filesystems it falls back to
// mtime ordering which is still a reasonable LRU approximation.
async function enforceCacheQuota(maxBytes) {
  const cacheDir = BLOB_CACHE_DIR();
  let names;
  try { names = await fs.readdir(cacheDir); }
  catch { return { ok: true, evicted: 0, before: 0, after: 0 }; }
  const bins = names.filter(n => n.endsWith('.bin'));
  const entries = [];
  for (const name of bins) {
    try {
      const st = await fs.stat(path.join(cacheDir, name));
      entries.push({ name, size: st.size, atimeMs: st.atimeMs || st.mtimeMs });
    } catch {}
  }
  const total = entries.reduce((s, e) => s + e.size, 0);
  if (total <= maxBytes) return { ok: true, evicted: 0, before: total, after: total };
  entries.sort((a, b) => a.atimeMs - b.atimeMs);
  let current = total;
  let evicted = 0;
  for (const e of entries) {
    if (current <= maxBytes) break;
    try {
      await fs.unlink(path.join(cacheDir, e.name));
      await fs.unlink(path.join(cacheDir, e.name.replace(/\.bin$/, '.meta'))).catch(() => {});
      current -= e.size;
      evicted++;
    } catch {}
  }
  return { ok: true, evicted, before: total, after: current };
}

ipcMain.handle('blob:enforceQuota', async (_e, { maxBytes } = {}) => {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return { ok: false, error: 'invalid maxBytes' };
  return enforceCacheQuota(maxBytes);
});

ipcMain.handle('blob:cacheStats', async () => {
  const cacheDir = BLOB_CACHE_DIR();
  let names;
  try { names = await fs.readdir(cacheDir); }
  catch { return { ok: true, files: 0, bytes: 0 }; }
  let total = 0, files = 0;
  for (const n of names) {
    if (!n.endsWith('.bin')) continue;
    try { const st = await fs.stat(path.join(cacheDir, n)); total += st.size; files++; } catch {}
  }
  return { ok: true, files, bytes: total };
});

ipcMain.handle('blob:purgeCache', async () => {
  const dir = BLOB_CACHE_DIR();
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(entries.map(name => fs.unlink(path.join(dir, name)).catch(() => {})));
    return { ok: true, count: entries.length };
  } catch { return { ok: true, count: 0 }; }
});

function registerBlobProtocol() {
  protocol.handle('edinot', async (request) => {
    let url;
    try { url = new URL(request.url); }
    catch { return new Response('bad url', { status: 400 }); }
    if (url.host !== 'blob') return new Response('not found', { status: 404 });
    const sha = url.pathname.replace(/^\/+/, '').toLowerCase();
    if (!SHA_RX.test(sha)) return new Response('bad blob id', { status: 400 });

    const cacheDir = BLOB_CACHE_DIR();
    const binPath = path.join(cacheDir, sha + '.bin');
    const metaPath = path.join(cacheDir, sha + '.meta');

    // Cache hit — but ignore a zero-byte entry (a truncated write from an
    // older build or an interrupted process) so we re-fetch a clean copy
    // instead of serving a permanently-broken "immutable" attachment.
    try {
      const [bytes, mime] = await Promise.all([
        fs.readFile(binPath),
        fs.readFile(metaPath, 'utf8').catch(() => 'application/octet-stream'),
      ]);
      if (bytes && bytes.length > 0) {
        return new Response(bytes, {
          headers: {
            'Content-Type': (mime || 'application/octet-stream').trim(),
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        });
      }
    } catch {}

    if (!blobSyncContext.httpUrl || !blobSyncContext.token) {
      return new Response('No sync configured. Log in to fetch attachments.', { status: 503 });
    }

    const target = `${blobSyncContext.httpUrl.replace(/\/$/, '')}/blobs/${sha}?t=${encodeURIComponent(blobSyncContext.token)}`;
    let upstream;
    try { upstream = await net.fetch(target); }
    catch (err) {
      return new Response('Upstream fetch failed: ' + err.message, { status: 502 });
    }
    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => '');
      return new Response(txt || `Upstream ${upstream.status}`, { status: upstream.status });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const mime = upstream.headers.get('content-type') || 'application/octet-stream';
    try { await writeBlobCacheAtomic(cacheDir, sha, buf, mime); } catch { /* cache failures are non-fatal */ }
    return new Response(buf, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  });
}

app.on('before-quit', () => { isQuitting = true; });

// Don't auto-quit when window closes — tray keeps app alive
app.on('window-all-closed', (e) => {
  // intentional no-op: tray keeps process alive
});

// ─────────────────────────────────────────────────────────────
// Auto-update (electron-updater)
//
// Feed URL is taken from package.json `build.publish` at build time.
// At runtime we allow override via EDINOT_UPDATES_URL env or a small
// json file at <userData>/updates-config.json: { "url": "https://…/" }.
// ─────────────────────────────────────────────────────────────
let updateStatus = { state: 'idle', info: null, error: null, progress: null };

function emitUpdateStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', updateStatus);
  }
}

function setUpdateStatus(patch) {
  updateStatus = { ...updateStatus, ...patch };
  emitUpdateStatus();
}

// macOS auto-update is gated on code signing. Catch the various phrasings
// electron-updater uses for that failure so the UI can render a useful
// "build unsigned — update manually" state instead of "No se pudo comprobar".
function isMacSigningError(msg) {
  return /code[- ]?sign(ing|ature)|not signed|com\.apple\.security|Squirrel|trusted by|requires signing/i.test(msg);
}

async function readUpdateOverride() {
  if (process.env.EDINOT_UPDATES_URL) return process.env.EDINOT_UPDATES_URL.trim();
  try {
    const file = path.join(app.getPath('userData'), 'updates-config.json');
    const raw = await fs.readFile(file, 'utf8');
    const j = JSON.parse(raw);
    return typeof j.url === 'string' ? j.url.trim() : null;
  } catch { return null; }
}

async function initAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) {
    setUpdateStatus({ state: 'disabled' });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  // Stream updater internals to console — invaluable when an AppImage
  // download stalls silently and we need to know whether it was a
  // network, signature or filesystem failure.
  try { autoUpdater.logger = console; } catch {}

  const override = await readUpdateOverride();
  if (override) {
    try { autoUpdater.setFeedURL({ provider: 'generic', url: override }); } catch (err) { console.warn('[updater] setFeedURL failed:', err.message); }
  }

  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => setUpdateStatus({ state: 'available', info, error: null }));
  autoUpdater.on('update-not-available', (info) => setUpdateStatus({ state: 'none', info, error: null }));
  autoUpdater.on('download-progress', (p) => setUpdateStatus({ state: 'downloading', progress: { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond } }));
  autoUpdater.on('update-downloaded', (info) => setUpdateStatus({ state: 'downloaded', info, progress: null }));
  autoUpdater.on('error', (err) => {
    const msg = String(err && err.message || err);
    // 404 / missing manifest = nothing published yet → treat as "up to date".
    // Network errors → silently keep previous state instead of dumping a stack.
    if (/HttpError:\s*404/i.test(msg) || /Cannot find channel/i.test(msg)) {
      setUpdateStatus({ state: 'none', error: null });
      return;
    }
    if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|net::/.test(msg)) {
      setUpdateStatus({ state: 'none', error: null });
      return;
    }
    // macOS refuses to operate the in-app updater on unsigned builds. The
    // exact error text varies by electron-updater version ("Could not get
    // code signature", "Code signing is required for auto-update on macOS",
    // "...not signed using a certificate trusted by..."). Surface a state
    // the UI can render with an honest "download manually" message instead
    // of a scary red error the user can't act on.
    if (process.platform === 'darwin' && isMacSigningError(msg)) {
      setUpdateStatus({ state: 'unsupported', error: null });
      console.warn('[updater] mac build is not code-signed; auto-update disabled:', msg);
      return;
    }
    setUpdateStatus({ state: 'error', error: 'No se pudo comprobar ahora mismo.' });
    console.warn('[updater]', msg);
  });

  // First check after 10s so app start isn't blocked, then every 6h.
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 10_000);
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
}

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('clipper:getStatus', () => {
  if (!clipperServer) return { running: false, port: null, hasToken: false, tokenPreview: null, protocol: 1 };
  return clipperServer.getStatus();
});

ipcMain.handle('clipper:getToken', () => {
  if (!clipperServer) return { ok: false, error: 'not_started' };
  return { ok: true, token: clipperServer.getToken(), port: clipperServer.port };
});

ipcMain.handle('clipper:generateToken', () => {
  if (!clipperServer) return { ok: false, error: 'not_started' };
  const token = clipperServer.generateToken();
  return { ok: true, token, port: clipperServer.port };
});

ipcMain.handle('clipper:revokeToken', () => {
  if (!clipperServer) return { ok: false, error: 'not_started' };
  clipperServer.revokeToken();
  return { ok: true };
});

ipcMain.handle('update:getStatus', () => updateStatus);

ipcMain.handle('update:check', async () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false, reason: 'disabled' };
  try {
    const res = await autoUpdater.checkForUpdates();
    return { ok: true, info: res && res.updateInfo };
  } catch (err) {
    const msg = String(err && err.message || err);
    // Same classification as the autoUpdater 'error' event: a missing
    // manifest or transient network blip is "nothing new", not a failure
    // the user should see as a red error.
    if (/HttpError:\s*404/i.test(msg) || /Cannot find channel/i.test(msg) ||
        /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|net::/.test(msg)) {
      return { ok: true, info: null, upToDate: true };
    }
    if (process.platform === 'darwin' && isMacSigningError(msg)) {
      setUpdateStatus({ state: 'unsupported', error: null });
      return { ok: true, info: null, upToDate: true, unsupported: true };
    }
    return { ok: false, reason: msg };
  }
});

ipcMain.handle('update:download', async () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false, reason: 'disabled' };
  // Flip state immediately so the renderer can show "Conectando…" before
  // electron-updater emits its first `download-progress` event (which on
  // Linux/AppImage can lag a few seconds while it allocates the cache file).
  setUpdateStatus({ state: 'downloading', progress: null });
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (err) {
    setUpdateStatus({ state: 'error', error: 'No se pudo descargar la actualización.' });
    return { ok: false, reason: String(err && err.message || err) };
  }
});

ipcMain.handle('update:install', () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false, reason: 'disabled' };
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

ipcMain.handle('update:setUrl', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { ok: false, reason: 'bad-url' };
  const file = path.join(app.getPath('userData'), 'updates-config.json');
  await fs.writeFile(file, JSON.stringify({ url: url.trim() }, null, 2), 'utf8');
  if (autoUpdater) {
    try { autoUpdater.setFeedURL({ provider: 'generic', url: url.trim() }); } catch (err) { return { ok: false, reason: err.message }; }
  }
  return { ok: true };
});

// ─────────────────────────────────────────────────────────────
// Manual download for unsigned macOS builds
//
// electron-updater refuses to operate on unsigned Mac apps, so we expose a
// parallel path that just downloads the latest .zip from the same feed URL
// to ~/Downloads and reveals it in Finder. The user then drag-installs
// manually. No Gatekeeper trickery — first launch still needs right-click →
// Open, like any unsigned .app.
// ─────────────────────────────────────────────────────────────
async function getFeedBaseUrl() {
  const override = await readUpdateOverride();
  if (override) return override;
  try {
    const pkg = require(path.join(app.getAppPath(), 'package.json'));
    const pub = (pkg.build && pkg.build.publish) || [];
    const first = Array.isArray(pub) ? pub[0] : pub;
    if (first && first.url) return first.url;
  } catch {}
  return null;
}

function netFetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Minimal line-based parser for electron-builder's latest-mac.yml. We need
// only `version`, the first `files[].url`, and that file's size — a real
// yaml parser would be overkill and pulling a dep just for this is silly.
function parseLatestMacYml(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = { version: null, fileUrl: null, size: null };
  let inFiles = false;
  for (const line of lines) {
    const v = line.match(/^version:\s*(.+?)\s*$/);
    if (v) { out.version = v[1].replace(/^['"]|['"]$/g, ''); continue; }
    if (/^files:\s*$/.test(line)) { inFiles = true; continue; }
    if (inFiles) {
      const u = line.match(/^\s+-\s+url:\s*(.+?)\s*$/);
      if (u && !out.fileUrl) { out.fileUrl = u[1]; continue; }
      const sz = line.match(/^\s+size:\s*(\d+)\s*$/);
      if (sz && !out.size) { out.size = parseInt(sz[1], 10); continue; }
      if (/^[A-Za-z]/.test(line)) inFiles = false;
    }
  }
  return out;
}

function semverGreater(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

ipcMain.handle('update:macManualCheck', async () => {
  if (process.platform !== 'darwin') return { ok: false, reason: 'not-mac' };
  try {
    const base = await getFeedBaseUrl();
    if (!base) return { ok: false, reason: 'no-feed-url' };
    const baseUrl = base.endsWith('/') ? base : base + '/';
    const buf = await netFetchBuffer(baseUrl + 'latest-mac.yml');
    const meta = parseLatestMacYml(buf.toString('utf8'));
    if (!meta.version || !meta.fileUrl) {
      return { ok: false, reason: 'manifest-parse-failed' };
    }
    const current = app.getVersion();
    return {
      ok: true,
      version: meta.version,
      current,
      isNewer: semverGreater(meta.version, current),
      downloadUrl: baseUrl + meta.fileUrl,
      filename: meta.fileUrl,
      size: meta.size || null,
    };
  } catch (err) {
    return { ok: false, reason: String(err && err.message || err) };
  }
});

let macDownloadCancel = null;

function emitMacDownloadProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:macDownloadProgress', payload);
  }
}

ipcMain.handle('update:macManualDownload', async (_e, opts = {}) => {
  if (process.platform !== 'darwin') return { ok: false, reason: 'not-mac' };
  const url = opts && opts.url;
  const filename = opts && opts.filename;
  if (!url || !filename) return { ok: false, reason: 'missing-args' };
  // Force the renderer-provided filename through basename so it can't
  // escape ~/Downloads with `../` or absolute paths.
  const safe = path.basename(String(filename));
  const dest = path.join(app.getPath('downloads'), safe);
  try {
    await new Promise((resolve, reject) => {
      const req = net.request(url);
      let cancelled = false;
      macDownloadCancel = () => { cancelled = true; try { req.abort(); } catch {} };
      req.on('response', (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
        let transferred = 0;
        const out = fsSync.createWriteStream(dest);
        out.on('error', reject);
        res.on('data', (chunk) => {
          if (cancelled) return;
          transferred += chunk.length;
          out.write(chunk);
          emitMacDownloadProgress({
            transferred, total,
            percent: total ? (transferred / total) * 100 : 0,
          });
        });
        res.on('end', () => {
          out.end(() => cancelled ? reject(new Error('cancelled')) : resolve());
        });
        res.on('error', (err) => { out.end(); reject(err); });
      });
      req.on('error', reject);
      req.end();
    });
    macDownloadCancel = null;
    try { shell.showItemInFolder(dest); } catch {}
    return { ok: true, path: dest };
  } catch (err) {
    macDownloadCancel = null;
    try { fsSync.unlinkSync(dest); } catch {}
    return { ok: false, reason: String(err && err.message || err) };
  }
});

ipcMain.handle('update:macManualCancel', () => {
  if (typeof macDownloadCancel === 'function') macDownloadCancel();
  return { ok: true };
});
