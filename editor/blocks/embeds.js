// Incrustados: una línea que es solo una URL de un servicio conocido se pinta
// como iframe (además de YouTube, que ya tenía su propia regla). Puro.
//   embedFor(url) → { kind, src, height?, ratio? } | null

function u(url) { try { return new URL(url); } catch { return null; } }

export function embedFor(raw) {
  const url = u(String(raw || '').trim());
  if (!url || !/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname;
  let m;
  if (host === 'vimeo.com' && (m = /^\/(?:video\/)?(\d+)/.exec(path))) {
    return { kind: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}?dnt=1`, ratio: '16 / 9' };
  }
  if (host === 'player.vimeo.com' && /^\/video\/\d+/.test(path)) return { kind: 'vimeo', src: url.href, ratio: '16 / 9' };
  if (host === 'loom.com' && (m = /^\/(?:share|embed)\/([a-f0-9]+)/i.exec(path))) {
    return { kind: 'loom', src: `https://www.loom.com/embed/${m[1]}`, ratio: '16 / 9' };
  }
  if (host === 'figma.com' && /^\/(file|design|proto|board|slides)\//.test(path)) {
    return { kind: 'figma', src: `https://www.figma.com/embed?embed_host=edinot&url=${encodeURIComponent(url.href)}`, height: 450 };
  }
  if (host === 'miro.com' && (m = /^\/app\/board\/([^/]+)/.exec(path))) {
    return { kind: 'miro', src: `https://miro.com/app/live-embed/${m[1]}/?embedMode=view_only_without_ui`, height: 450 };
  }
  if (host === 'docs.google.com' && (m = /^\/(document|spreadsheets|presentation|forms)\/d\/([^/]+)/.exec(path))) {
    const [, type, id] = m;
    if (type === 'presentation') return { kind: 'gslides', src: `https://docs.google.com/presentation/d/${id}/embed`, ratio: '16 / 9.6' };
    if (type === 'forms') return { kind: 'gforms', src: `https://docs.google.com/forms/d/${id}/viewform?embedded=true`, height: 600 };
    return { kind: type === 'document' ? 'gdocs' : 'gsheets', src: `https://docs.google.com/${type}/d/${id}/preview`, height: 520 };
  }
  if (host === 'drive.google.com' && (m = /^\/file\/d\/([^/]+)/.exec(path))) {
    return { kind: 'gdrive', src: `https://drive.google.com/file/d/${m[1]}/preview`, height: 480 };
  }
  if (host === 'open.spotify.com' && (m = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(path))) {
    return { kind: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352 };
  }
  if (host === 'codepen.io' && (m = /^\/([^/]+)\/(?:pen|full|details)\/([^/]+)/.exec(path))) {
    return { kind: 'codepen', src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, height: 400 };
  }
  if (host === 'excalidraw.com' && /^#(json|room)=/.test(url.hash)) {
    return { kind: 'excalidraw', src: url.href, height: 480 };
  }
  return null;
}

export function embedHtml(e, href, escapeHtml) {
  const style = e.ratio ? `aspect-ratio: ${e.ratio}` : `height: ${e.height || 420}px`;
  return `<div class="md-embed md-embed-${e.kind}">`
    + `<iframe src="${escapeHtml(e.src)}" style="${style}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" `
    + `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen title="${escapeHtml(e.kind)}"></iframe>`
    + `<a class="md-embed-src" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>`
    + `</div>`;
}
