// Bridge between the Electron main-side ClipperServer (electron/clipper.cjs)
// and the React app state. The main process forwards HTTP requests from the
// browser extension as `clipper:request` IPC messages. We translate those
// into calls against window.__edinotClipper (installed by editor.jsx once the
// EdinotApp component has mounted and has access to vaults / yFiles / etc.)
// and ship the result back via `clipperRespond`.

const api = window.electronAPI;
if (api && typeof api.onClipperRequest === 'function') {
  const respond = (payload) => {
    try { api.clipperRespond(payload); }
    catch (err) { console.warn('[clipper-renderer] respond failed:', err); }
  };

  api.onClipperRequest(async (msg) => {
    if (!msg || !msg.id) return;
    const { id, kind, payload } = msg;
    const impl = window.__edinotClipper;

    if (!impl) {
      respond({ id, ok: false, error: 'clipper_not_ready' });
      return;
    }

    try {
      if (kind === 'vaults') {
        const data = await impl.listDirectory();
        respond({ id, ok: true, data });
        return;
      }

      if (kind === 'clip') {
        const result = await impl.createClipNote(payload || {});
        respond({ id, ok: true, data: result });
        return;
      }

      respond({ id, ok: false, error: 'unknown_kind' });
    } catch (err) {
      respond({ id, ok: false, error: (err && err.message) || String(err) });
    }
  });
}
