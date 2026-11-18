const { contextBridge, ipcRenderer } = require('electron');

const channels = ['menu:new', 'menu:save', 'menu:saveAs', 'menu:saveAsBundle', 'menu:exportWorkspace', 'menu:toggleRender', 'menu:import', 'file:opened', 'file:externalOpen', 'vault-export:fileChanged', 'update:status', 'update:macDownloadProgress', 'reminder:fire', 'deeplink:open', 'power:resume', 'float:data', 'float:msg'];

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', { path: filePath, content }),
  writeExternal: (filePath, content) => ipcRenderer.invoke('file:writeExternal', { path: filePath, content }),
  saveFileAs: (content) => ipcRenderer.invoke('file:saveAs', { content }),
  saveFileWithAttachments: (content, defaultName) => ipcRenderer.invoke('file:saveWithAttachments', { content, defaultName }),
  exportWorkspaceBundle: (notes) => ipcRenderer.invoke('file:exportWorkspaceBundle', { notes }),
  convertOfficeBlob: (sha, kind, auth) => ipcRenderer.invoke('blob:convertOffice', { sha, kind, auth }),
  cacheBlobBytes: (sha, mime, bytes) => ipcRenderer.invoke('blob:cacheBytes', { sha, mime, bytes }),
  saveBlobToFile: (sha, filename, auth) => ipcRenderer.invoke('blob:saveToFile', { sha, filename, auth }),
  openBlobWith: (sha, filename, auth) => ipcRenderer.invoke('blob:openWith', { sha, filename, auth }),
  exportApply: (payload) => ipcRenderer.invoke('export:apply', payload),
  exportGetRoot: () => ipcRenderer.invoke('export:getRoot'),
  exportRevealRoot: () => ipcRenderer.invoke('export:revealRoot'),
  tableExportXlsx: (payload) => ipcRenderer.invoke('table:exportXlsx', payload),
  noteExport: (payload) => ipcRenderer.invoke('note:export', payload),
  mcpGetInfo: () => ipcRenderer.invoke('mcp:getInfo'),
  mcpSetup: (opts) => ipcRenderer.invoke('mcp:setup', opts),
  mcpRevealFile: (which) => ipcRenderer.invoke('mcp:revealFile', { which }),
  hubEnsure: () => ipcRenderer.invoke('hub:ensure'),
  hubPush: (payload) => ipcRenderer.invoke('hub:push', payload),
  onHubPushProgress: (cb) => {
    const handler = (_e, line) => { try { cb(line); } catch {} };
    ipcRenderer.on('hub:pushProgress', handler);
    return () => ipcRenderer.removeListener('hub:pushProgress', handler);
  },
  appHostName: () => ipcRenderer.invoke('app:hostName'),
  cliStatus: () => ipcRenderer.invoke('cli:status'),
  cliInstall: () => ipcRenderer.invoke('cli:install'),
  cliUninstall: () => ipcRenderer.invoke('cli:uninstall'),
  tlsPinFromLink: (payload) => ipcRenderer.invoke('tls:pinFromLink', payload),
  tlsSetPin: (payload) => ipcRenderer.invoke('tls:setPin', payload),
  openImportDialog: () => ipcRenderer.invoke('file:openImportDialog'),
  importPaths: (paths) => ipcRenderer.invoke('file:importPaths', paths),
  // Sync context — pushed by the renderer after login so the edinot://
  // protocol handler can authenticate blob fetches against the sync server.
  setSyncContext: (httpUrl, token) => ipcRenderer.invoke('sync:setContext', { httpUrl, token }),
  blobCachePath: () => ipcRenderer.invoke('blob:cachePath'),
  blobCacheRead: (sha) => ipcRenderer.invoke('blob:cacheRead', sha),
  blobPurgeCache: () => ipcRenderer.invoke('blob:purgeCache'),
  blobPrefetch: (shas, maxBytes, auth, cacheMaxBytes) => ipcRenderer.invoke('blob:prefetch', { shas, maxBytes, auth, cacheMaxBytes }),
  blobEnforceQuota: (maxBytes) => ipcRenderer.invoke('blob:enforceQuota', { maxBytes }),
  blobCacheStats: () => ipcRenderer.invoke('blob:cacheStats'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', { url }),
  logAppend: (entry) => ipcRenderer.invoke('log:append', entry),
  logTail: (maxBytes) => ipcRenderer.invoke('log:tail', maxBytes),
  logReveal: () => ipcRenderer.invoke('log:reveal'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  // Flashes the taskbar/dock entry. Deliberately does NOT raise the window.
  windowAttention: () => ipcRenderer.invoke('window:attention'),
  windowCapture: (opts) => ipcRenderer.invoke('window:capture', opts || {}),
  urlUnfurl: (url) => ipcRenderer.invoke('url:unfurl', { url }),
  // Floating companion windows (presentation / quick note) + full-screen
  // capture. floatPush flows main-renderer → float window; floatSend flows
  // float window → main renderer. Both relay through the main process.
  floatOpen: (mode) => ipcRenderer.invoke('float:open', { mode }),
  floatClose: (mode) => ipcRenderer.invoke('float:close', { mode }),
  floatCloseSelf: () => ipcRenderer.invoke('float:closeSelf'),
  floatIsOpen: (mode) => ipcRenderer.invoke('float:isOpen', { mode }),
  floatPush: (payload) => ipcRenderer.invoke('float:push', payload || {}),
  floatSend: (payload) => ipcRenderer.invoke('float:send', payload || {}),
  screenCapture: (opts) => ipcRenderer.invoke('screen:capture', opts || {}),
  emailParse: (name, bytes) => ipcRenderer.invoke('email:parse', { name, bytes }),
  appGetVersion: () => ipcRenderer.invoke('app:getVersion'),
  // Google Calendar sync
  meetingBegin: (o) => ipcRenderer.invoke('meeting:begin', o),
  meetingChunk: (o) => ipcRenderer.invoke('meeting:chunk', o),
  meetingEnd: (o) => ipcRenderer.invoke('meeting:end', o),
  meetingPending: () => ipcRenderer.invoke('meeting:pending'),
  meetingDiscard: (o) => ipcRenderer.invoke('meeting:discard', o),
  meetingDone: (o) => ipcRenderer.invoke('meeting:done', o),
  meetingReveal: (o) => ipcRenderer.invoke('meeting:reveal', o),
  meetingSegments: (o) => ipcRenderer.invoke('meeting:segments', o),
  meetingTranscribe: (o) => ipcRenderer.invoke('meeting:transcribe', o),
  meetingDiarize: (o) => ipcRenderer.invoke('meeting:diarize', o),
  meetingChat: (o) => ipcRenderer.invoke('meeting:chat', o),
  meetingTest: (o) => ipcRenderer.invoke('meeting:test', o),
  gcalStatus: () => ipcRenderer.invoke('gcal:status'),
  gcalAuth: (creds) => ipcRenderer.invoke('gcal:auth', creds || {}),
  gcalDisconnect: () => ipcRenderer.invoke('gcal:disconnect'),
  gcalCalendars: (creds) => ipcRenderer.invoke('gcal:calendars', creds || {}),
  gcalList: (opts) => ipcRenderer.invoke('gcal:list', opts || {}),
  gcalPush: (opts) => ipcRenderer.invoke('gcal:push', opts || {}),
  gcalDelete: (opts) => ipcRenderer.invoke('gcal:delete', opts || {}),
  setLanguage: (lang) => ipcRenderer.invoke('app:setLanguage', lang),
  // Ajustes → Atajos: aceleradores del menú ({ new, save, saveAs, … }).
  menuSetAccelerators: (map) => ipcRenderer.invoke('menu:setAccelerators', map || {}),
  // Ajustes → Editor → corrector ortográfico.
  setSpellcheck: (enabled) => ipcRenderer.invoke('app:setSpellcheck', !!enabled),
  updateGetStatus: () => ipcRenderer.invoke('update:getStatus'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateSetUrl: (url) => ipcRenderer.invoke('update:setUrl', url),
  // Manual download path for unsigned macOS builds (electron-updater can't
  // operate without an Apple Developer ID signature, so we fetch the .zip
  // straight from the feed and reveal it in Finder).
  updateMacManualCheck: () => ipcRenderer.invoke('update:macManualCheck'),
  updateMacManualDownload: (opts) => ipcRenderer.invoke('update:macManualDownload', opts),
  updateMacManualCancel: () => ipcRenderer.invoke('update:macManualCancel'),
  // F2 — Reminders: renderer hands the scheduler a flat list of pending
  // reminders (id, vaultId, noteId, title, fireAt, anchor). Main keeps
  // the timers. On fire, main emits 'reminder:fire' to the renderer so
  // the UI can jump to the note. Snooze/Dismiss flow the other way via
  // remindersAction → main reschedules + asks renderer to persist the
  // state into yEvents (single source of truth).
  remindersSync: (items) => ipcRenderer.invoke('reminders:sync', { items }),
  remindersAction: (id, action, payload) => ipcRenderer.invoke('reminders:action', { id, action, payload }),
  clipperGetStatus: () => ipcRenderer.invoke('clipper:getStatus'),
  clipperGetToken: () => ipcRenderer.invoke('clipper:getToken'),
  clipperGenerateToken: () => ipcRenderer.invoke('clipper:generateToken'),
  clipperRevokeToken: () => ipcRenderer.invoke('clipper:revokeToken'),
  onClipperRequest: (cb) => {
    const handler = (_e, payload) => { try { cb(payload); } catch (err) { console.warn('clipper handler err:', err); } };
    ipcRenderer.on('clipper:request', handler);
    return () => ipcRenderer.removeListener('clipper:request', handler);
  },
  clipperRespond: (payload) => ipcRenderer.send('clipper:response', payload),
  on: (channel, listener) => {
    if (!channels.includes(channel)) return () => {};
    const wrapped = (_e, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform,
});
