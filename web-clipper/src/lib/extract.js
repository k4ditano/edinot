import { Readability, isProbablyReaderable } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    hr: '---'
  });
  td.use(gfm);
  td.addRule('removeScripts', {
    filter: ['script', 'style', 'noscript', 'iframe'],
    replacement: () => ''
  });
  td.addRule('imageAlt', {
    filter: 'img',
    replacement: (_, node) => {
      const src = node.getAttribute('src') || '';
      const alt = (node.getAttribute('alt') || '').trim();
      if (!src) return '';
      return `![${alt}](${src})`;
    }
  });
  return td;
}

function getMeta(doc, name) {
  const sel = `meta[name="${name}"], meta[property="${name}"]`;
  const el = doc.querySelector(sel);
  return el ? (el.getAttribute('content') || '').trim() : '';
}

export function extractMetadata(doc, url) {
  const u = new URL(url);
  return {
    url,
    site: u.hostname.replace(/^www\./, ''),
    title: (doc.querySelector('title')?.textContent || getMeta(doc, 'og:title') || u.hostname).trim(),
    author: getMeta(doc, 'author') || getMeta(doc, 'article:author') || getMeta(doc, 'twitter:creator'),
    published: getMeta(doc, 'article:published_time') || getMeta(doc, 'og:published_time') || getMeta(doc, 'date'),
    excerpt: getMeta(doc, 'og:description') || getMeta(doc, 'description'),
    favicon: doc.querySelector('link[rel~="icon"]')?.href || `${u.origin}/favicon.ico`,
    ogImage: getMeta(doc, 'og:image')
  };
}

export function extractArticle(doc, url) {
  const meta = extractMetadata(doc, url);
  const cloned = doc.cloneNode(true);
  let article = null;
  try {
    if (isProbablyReaderable(cloned)) {
      const reader = new Readability(cloned, { keepClasses: false });
      article = reader.parse();
    }
  } catch (e) {
    article = null;
  }
  const td = makeTurndown();
  const html = article?.content || doc.body.innerHTML;
  const markdown = td.turndown(html);
  return {
    ...meta,
    title: article?.title || meta.title,
    author: article?.byline || meta.author,
    excerpt: article?.excerpt || meta.excerpt,
    content: markdown,
    rawText: article?.textContent || ''
  };
}

export function extractSelection(doc, url, selectionHtml) {
  const meta = extractMetadata(doc, url);
  const td = makeTurndown();
  return {
    ...meta,
    content: td.turndown(selectionHtml || ''),
    isSelection: true
  };
}
