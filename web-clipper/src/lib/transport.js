const PORT_RANGE = [17800, 17801, 17802, 17803, 17804, 17805, 17810, 17811, 17812];
const STORAGE_KEYS = {
  port: 'edinot.port',
  token: 'edinot.token',
  lastVault: 'edinot.lastVault',
  lastFolder: 'edinot.lastFolder',
  lastTemplate: 'edinot.lastTemplate'
};

export async function getStored(keys) {
  const out = await chrome.storage.local.get(keys);
  return out;
}

export async function setStored(obj) {
  await chrome.storage.local.set(obj);
}

export async function getToken() {
  const { [STORAGE_KEYS.token]: token } = await getStored([STORAGE_KEYS.token]);
  return token || null;
}

export async function getPort() {
  const { [STORAGE_KEYS.port]: port } = await getStored([STORAGE_KEYS.port]);
  return port || null;
}

async function pingPort(port, token, signal) {
  const url = `http://127.0.0.1:${port}/clipper/ping`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      signal
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body && body.ok === true;
  } catch {
    return false;
  }
}

export async function discoverPort(token) {
  const stored = await getPort();
  const order = stored ? [stored, ...PORT_RANGE.filter(p => p !== stored)] : PORT_RANGE;
  for (const port of order) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 700);
    const ok = await pingPort(port, token, ac.signal);
    clearTimeout(timer);
    if (ok) {
      if (port !== stored) await setStored({ [STORAGE_KEYS.port]: port });
      return port;
    }
  }
  return null;
}

export async function ensurePaired() {
  const token = await getToken();
  if (!token) return { ok: false, reason: 'no_token' };
  const port = await discoverPort(token);
  if (!port) return { ok: false, reason: 'app_unreachable' };
  return { ok: true, port, token };
}

export async function apiRequest(path, init = {}) {
  const paired = await ensurePaired();
  if (!paired.ok) throw new Error(paired.reason);
  const url = `http://127.0.0.1:${paired.port}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${paired.token}`,
    ...(init.headers || {})
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

export async function fetchVaults() {
  return apiRequest('/clipper/vaults');
}

export async function sendClip(payload) {
  return apiRequest('/clipper/clip', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export const STORAGE = STORAGE_KEYS;
