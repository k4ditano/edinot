import { extractArticle, extractSelection } from '../lib/extract.js';

function selectionHTML() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
  const container = document.createElement('div');
  for (let i = 0; i < sel.rangeCount; i++) {
    container.appendChild(sel.getRangeAt(i).cloneContents());
  }
  return container.innerHTML;
}

function reply(payload) {
  return payload;
}

// The background re-injects this script on every clip. Guard so we register
// the message listener exactly once per page — otherwise each injection adds
// another listener and they race on sendResponse ("message channel closed").
if (!window.__edinotClipperContentLoaded) {
  window.__edinotClipperContentLoaded = true;
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg?.type === 'extract:article') {
      const data = extractArticle(document, location.href);
      sendResponse(reply({ ok: true, data }));
    } else if (msg?.type === 'extract:selection') {
      const html = selectionHTML();
      const data = extractSelection(document, location.href, html);
      sendResponse(reply({ ok: true, data, hasSelection: !!html }));
    } else if (msg?.type === 'extract:bookmark') {
      const data = extractArticle(document, location.href);
      sendResponse(reply({
        ok: true,
        data: {
          url: data.url,
          site: data.site,
          title: data.title,
          author: data.author,
          published: data.published,
          excerpt: data.excerpt,
          favicon: data.favicon,
          ogImage: data.ogImage,
          content: ''
        }
      }));
    } else {
      sendResponse({ ok: false, error: 'unknown_type' });
    }
  } catch (err) {
    sendResponse({ ok: false, error: String(err?.message || err) });
  }
  return true;
});
}
