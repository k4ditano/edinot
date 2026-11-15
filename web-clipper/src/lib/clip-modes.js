export const MODES = {
  ARTICLE: 'article',
  SELECTION: 'selection',
  BOOKMARK: 'bookmark'
};

export function buildBookmarkContent(meta) {
  const lines = [
    `# ${meta.title}`,
    '',
    meta.excerpt ? `> ${meta.excerpt}` : '',
    '',
    `- URL: <${meta.url}>`,
    meta.site ? `- Site: ${meta.site}` : '',
    meta.author ? `- Author: ${meta.author}` : '',
    meta.published ? `- Published: ${meta.published}` : '',
    `- Clipped: ${new Date().toISOString()}`
  ].filter(Boolean);
  return lines.join('\n');
}

export function defaultArticleBody(meta) {
  const front = [
    `# ${meta.title}`,
    '',
    `> Source: [${meta.site}](${meta.url})${meta.author ? ` — ${meta.author}` : ''}${meta.published ? ` — ${meta.published}` : ''}`,
    ''
  ];
  return front.join('\n') + (meta.content || '');
}

export function defaultSelectionBody(meta) {
  const front = [
    `# ${meta.title}`,
    '',
    `> Selección desde [${meta.site}](${meta.url})`,
    ''
  ];
  return front.join('\n') + (meta.content || '');
}
