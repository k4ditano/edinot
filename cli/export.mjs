// Exporta todas las notas a archivos Markdown normales, legibles sin Edinot.
//
//   <destino>/<vault>/<carpetas…>/<nota>.md
//   <destino>/_attachments/<sha>.<ext>      (con attachments: true; los enlaces se reescriben a relativos)
//   <destino>/.edinot-export.json           (qué archivos escribió esta herramienta)
//
// Garantías:
//  · Solo se borran archivos que esta herramienta escribió antes (los del manifiesto)
//    y que ya no corresponden a ninguna nota. Nunca se toca nada ajeno.
//  · Un archivo cuyo contenido no cambió no se reescribe (conserva su fecha).
//  · Es una copia de lectura: editar los .md exportados no cambia las notas.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const BLOB_URL = /edinot:\/\/blob\/([a-f0-9]{64})/g;
const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'audio/mpeg': '.mp3', 'video/mp4': '.mp4',
};

export function safeSegment(name, fallback = 'sin-nombre') {
  const s = String(name == null ? '' : name)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 120);
  return s || fallback;
}

function writeIfChanged(file, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  try { if (existsSync(file) && readFileSync(file).equals(buf)) return false; } catch {}
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  writeFileSync(tmp, buf);
  renameSync(tmp, file);
  return true;
}

function removeEmptyDirs(dir, stopAt) {
  let d = dir;
  while (d.startsWith(stopAt) && d !== stopAt) {
    try { if (readdirSync(d).length) return; rmdirSync(d); } catch { return; }
    d = path.dirname(d);
  }
}

/**
 * @param s        sesión de ops.open (listVaults, listFolders, listFiles, readContent)
 * @param outDir   carpeta de destino
 * @param opts     { vault, attachments, prune, fetchBlob(sha) → {buffer, mime}, onProgress }
 */
export async function exportMarkdown(s, outDir, { vault = null, attachments = false, prune = true, fetchBlob = null, onProgress = () => {} } = {}) {
  outDir = path.resolve(outDir);
  mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, '.edinot-export.json');
  let previous = {};
  try { previous = JSON.parse(readFileSync(manifestPath, 'utf8')).files || {}; } catch {}

  const vaultName = (id) => s.vaultName(id || 'default');
  const folderPath = new Map();
  for (const f of s.listFolders({})) folderPath.set(f.id, f.path || f.name);

  const files = s.listFiles({ vault: vault || undefined }).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  // Con --vault, tanto la limpieza como el manifiesto se limitan a la carpeta de ese vault.
  let scopePrefix = null;
  if (vault) {
    const v = s.listVaults().find(x => x.id === vault || x.name === vault);
    scopePrefix = safeSegment(v ? v.name : vault, 'default') + path.sep;
  }
  const inScope = (rel) => !scopePrefix || String(rel).startsWith(scopePrefix);
  const used = new Set();
  const written = {};
  const report = { notes: 0, rewritten: 0, unchanged: 0, removed: 0, attachments: 0, attachmentsMissing: [], failed: [] };

  const attachmentName = new Map(); // sha → nombre de archivo ya escrito
  const copyAttachment = async (sha) => {
    if (attachmentName.has(sha)) return attachmentName.get(sha);
    let name = null;
    try {
      const got = await fetchBlob(sha);
      const ext = MIME_EXT[got.mime] || '';
      name = sha + ext;
      writeIfChanged(path.join(outDir, '_attachments', name), got.buffer);
      report.attachments++;
    } catch { report.attachmentsMissing.push(sha); }
    attachmentName.set(sha, name);
    return name;
  };

  for (const f of files) {
    try {
      const segs = [safeSegment(vaultName(f.vaultId), 'default')];
      if (f.folderId && folderPath.has(f.folderId)) {
        for (const part of String(folderPath.get(f.folderId)).split('/')) segs.push(safeSegment(part, 'carpeta'));
      }
      let base = safeSegment(f.name, 'nota');
      if (!/\.[A-Za-z0-9]{1,6}$/.test(base)) base += '.md';
      let rel = path.join(...segs, base);
      for (let n = 2; used.has(rel.toLowerCase()); n++) {
        const ext = path.extname(base);
        rel = path.join(...segs, `${base.slice(0, base.length - ext.length)} (${n})${ext}`);
      }
      used.add(rel.toLowerCase());

      let content = String(await s.readContent(f.id));
      if (attachments && fetchBlob) {
        const shas = [...new Set([...content.matchAll(BLOB_URL)].map(m => m[1]))];
        const depth = path.dirname(rel).split(path.sep).length;
        const up = '../'.repeat(depth);
        for (const sha of shas) {
          const name = await copyAttachment(sha);
          if (name) content = content.split(`edinot://blob/${sha}`).join(`${up}_attachments/${encodeURI(name)}`);
        }
      }
      const changed = writeIfChanged(path.join(outDir, rel), content);
      written[f.id] = rel;
      report.notes++;
      changed ? report.rewritten++ : report.unchanged++;
      onProgress({ kind: 'note', rel, changed });
    } catch (err) {
      report.failed.push({ name: f.name, error: err.message });
    }
  }

  // Limpieza: solo archivos que escribimos nosotros y que ya no corresponden a nada.
  if (prune) {
    const keep = new Set(Object.values(written).map(r => r.toLowerCase()));
    for (const rel of Object.values(previous)) {
      if (!inScope(rel) || keep.has(String(rel).toLowerCase())) continue;
      const abs = path.join(outDir, rel);
      if (!abs.startsWith(outDir + path.sep)) continue; // por si el manifiesto estuviera manipulado
      try { unlinkSync(abs); report.removed++; removeEmptyDirs(path.dirname(abs), outDir); } catch {}
    }
  }
  const merged = { ...Object.fromEntries(Object.entries(previous).filter(([, rel]) => !inScope(rel))), ...written };
  writeFileSync(manifestPath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), files: merged }, null, 2));
  return report;
}
