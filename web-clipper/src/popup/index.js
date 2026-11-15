import { ensurePaired, fetchVaults, setStored, STORAGE, getStored } from '../lib/transport.js';

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status-pill'),
  pairView: $('pair-view'),
  clipView: $('clip-view'),
  pairToken: $('pair-token'),
  pairBtn: $('pair-btn'),
  pairError: $('pair-error'),
  title: $('f-title'),
  vault: $('f-vault'),
  folder: $('f-folder'),
  template: $('f-template'),
  mode: $('f-mode'),
  tags: $('f-tags'),
  clipBtn: $('clip-btn'),
  resetBtn: $('reset-btn'),
  clipErr: $('clip-error'),
  clipOk: $('clip-ok')
};

let directory = null;

function showPair(error) {
  els.pairView.hidden = false;
  els.clipView.hidden = true;
  els.pairError.textContent = error || '';
}

function showClip() {
  els.pairView.hidden = true;
  els.clipView.hidden = false;
}

function setStatus(state, label) {
  els.status.textContent = label;
  els.status.className = `pill ${state}`;
}

function populateSelect(sel, items, valueFn, labelFn, current) {
  sel.innerHTML = '';
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = valueFn(item);
    opt.textContent = labelFn(item);
    if (current && opt.value === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function loadDirectory() {
  const dir = await fetchVaults();
  directory = dir;
  const stored = await getStored([STORAGE.lastVault, STORAGE.lastFolder, STORAGE.lastTemplate]);

  populateSelect(els.vault, dir.vaults, v => v.id, v => v.name, stored[STORAGE.lastVault]);

  const onVaultChange = () => {
    const vid = els.vault.value;
    const folders = (dir.folders || []).filter(f => f.vaultId === vid);
    const folderItems = [{ id: '', name: '(root)' }, ...folders];
    populateSelect(els.folder, folderItems, f => f.id, f => f.path || f.name, stored[STORAGE.lastFolder]);
    const templates = (dir.templates || []).filter(t => !t.vaultId || t.vaultId === vid);
    const tplItems = [{ id: '', name: '(none)' }, ...templates];
    populateSelect(els.template, tplItems, t => t.id, t => t.name, stored[STORAGE.lastTemplate]);
  };
  els.vault.addEventListener('change', onVaultChange);
  onVaultChange();
}

async function prefillFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.title) els.title.value = tab.title;
}

async function pairFlow() {
  const token = els.pairToken.value.trim();
  if (!token) {
    els.pairError.textContent = 'Token required';
    return;
  }
  await setStored({ [STORAGE.token]: token });
  const paired = await ensurePaired();
  if (paired.ok) {
    setStatus('ok', 'paired');
    showClip();
    try {
      await loadDirectory();
      await prefillFromActiveTab();
    } catch (e) {
      els.clipErr.textContent = e.message;
    }
  } else {
    showPair(paired.reason === 'app_unreachable' ? 'App not reachable. Open Edinot.' : 'Pairing failed.');
  }
}

async function clipFlow() {
  els.clipErr.textContent = '';
  els.clipOk.textContent = '';
  els.clipBtn.disabled = true;
  try {
    const overrides = {
      title: els.title.value.trim() || null,
      vault: els.vault.value || null,
      folder: els.folder.value || null,
      template: els.template.value || null,
      tags: els.tags.value.split(',').map(s => s.trim()).filter(Boolean)
    };
    const mode = els.mode.value;
    const resp = await chrome.runtime.sendMessage({
      type: 'clipper:performClip',
      mode,
      overrides
    });
    if (resp?.ok) {
      els.clipOk.textContent = `Saved: ${resp.result?.name || overrides.title}`;
      setTimeout(() => window.close(), 700);
    } else {
      els.clipErr.textContent = resp?.error || 'Clip failed';
    }
  } catch (e) {
    els.clipErr.textContent = e.message;
  } finally {
    els.clipBtn.disabled = false;
  }
}

async function init() {
  setStatus('', '…');
  const paired = await ensurePaired();
  if (!paired.ok) {
    setStatus('bad', paired.reason === 'no_token' ? 'unpaired' : 'offline');
    showPair(paired.reason === 'app_unreachable' ? 'App not reachable. Open Edinot.' : '');
  } else {
    setStatus('ok', 'paired');
    showClip();
    try {
      await loadDirectory();
      await prefillFromActiveTab();
    } catch (e) {
      els.clipErr.textContent = e.message;
    }
  }
  els.pairBtn.addEventListener('click', pairFlow);
  els.clipBtn.addEventListener('click', clipFlow);
  els.resetBtn.addEventListener('click', async () => {
    await chrome.storage.local.clear();
    location.reload();
  });
}

init();
