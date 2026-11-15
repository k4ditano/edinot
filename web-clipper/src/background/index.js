import { sendClip, ensurePaired, setStored, STORAGE } from '../lib/transport.js';
import { MODES, buildBookmarkContent, defaultArticleBody, defaultSelectionBody } from '../lib/clip-modes.js';

const CONTEXT_MENU_IDS = {
  selection: 'edinot-clip-selection',
  page: 'edinot-clip-page',
  bookmark: 'edinot-clip-bookmark'
};

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/index.js']
    });
  } catch (e) {
  }
}

async function askContent(tabId, type) {
  await ensureContentScript(tabId);
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp || { ok: false, error: 'no_response' });
    });
  });
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message: message || '',
      priority: 1
    });
  } catch {
  }
}

async function performClip({ tab, mode, overrides }) {
  if (!tab || !tab.id) return { ok: false, error: 'no_tab' };

  const paired = await ensurePaired();
  if (!paired.ok) {
    notify('Edinot Web Clipper', 'App not paired. Open Edinot → Settings → Web Clipper.');
    return { ok: false, error: paired.reason };
  }

  let extractType;
  if (mode === MODES.SELECTION) extractType = 'extract:selection';
  else if (mode === MODES.BOOKMARK) extractType = 'extract:bookmark';
  else extractType = 'extract:article';

  const resp = await askContent(tab.id, extractType);
  if (!resp.ok) {
    notify('Edinot Web Clipper', `Extract failed: ${resp.error}`);
    return resp;
  }
  const data = resp.data;

  let body;
  if (mode === MODES.BOOKMARK) body = buildBookmarkContent(data);
  else if (mode === MODES.SELECTION) body = defaultSelectionBody(data);
  else body = defaultArticleBody(data);

  const payload = {
    mode,
    title: overrides?.title || data.title,
    body,
    meta: {
      url: data.url,
      site: data.site,
      author: data.author,
      published: data.published,
      excerpt: data.excerpt,
      favicon: data.favicon,
      ogImage: data.ogImage,
      tags: overrides?.tags || [],
      clippedAt: new Date().toISOString()
    },
    target: {
      vault: overrides?.vault || null,
      folder: overrides?.folder || null,
      template: overrides?.template || null
    }
  };

  try {
    const result = await sendClip(payload);
    notify('Clipped ✓', `Saved as "${result.name || payload.title}"`);
    if (overrides?.vault) await setStored({ [STORAGE.lastVault]: overrides.vault });
    if (overrides?.folder !== undefined) await setStored({ [STORAGE.lastFolder]: overrides.folder });
    if (overrides?.template !== undefined) await setStored({ [STORAGE.lastTemplate]: overrides.template });
    return { ok: true, result };
  } catch (err) {
    notify('Edinot Web Clipper', `Clip failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function quickClip(tab) {
  const stored = await chrome.storage.local.get([STORAGE.lastVault, STORAGE.lastFolder, STORAGE.lastTemplate]);
  return performClip({
    tab,
    mode: MODES.ARTICLE,
    overrides: {
      vault: stored[STORAGE.lastVault] || null,
      folder: stored[STORAGE.lastFolder] || null,
      template: stored[STORAGE.lastTemplate] || null
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.selection,
      title: 'Clip selection to Edinot',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.page,
      title: 'Clip page to Edinot',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.bookmark,
      title: 'Bookmark to Edinot (URL only)',
      contexts: ['page']
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === CONTEXT_MENU_IDS.selection) {
    await quickClipMode(tab, MODES.SELECTION);
  } else if (info.menuItemId === CONTEXT_MENU_IDS.page) {
    await quickClip(tab);
  } else if (info.menuItemId === CONTEXT_MENU_IDS.bookmark) {
    await quickClipMode(tab, MODES.BOOKMARK);
  }
});

async function quickClipMode(tab, mode) {
  const stored = await chrome.storage.local.get([STORAGE.lastVault, STORAGE.lastFolder, STORAGE.lastTemplate]);
  return performClip({
    tab,
    mode,
    overrides: {
      vault: stored[STORAGE.lastVault] || null,
      folder: stored[STORAGE.lastFolder] || null,
      template: stored[STORAGE.lastTemplate] || null
    }
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'quick-clip') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await quickClip(tab);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'clipper:performClip') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await performClip({ tab, mode: msg.mode, overrides: msg.overrides });
      sendResponse(result);
    })();
    return true;
  }
  if (msg?.type === 'clipper:ensurePaired') {
    ensurePaired().then(sendResponse);
    return true;
  }
});
