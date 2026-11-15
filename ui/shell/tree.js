// Índice del árbol de la barra lateral: agrupa notas y carpetas de UN vault
// por carpeta padre una sola vez (O(notas + carpetas)), en vez de filtrar
// las listas enteras por cada carpeta en cada render. La barra lateral lo
// memoiza por identidad de `files`/`folders` — que el App ya mantiene
// estables (stabilizeList) — así que no se recalcula al teclear.

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true });

export function buildTreeIndex(files, folders, vaultId, templateFolderIds) {
  const tpl = templateFolderIds || new Set();
  const filesAt = new Map();    // folderId|'' → [file]
  const foldersAt = new Map();  // parentId|'' → [folder]
  const folderById = new Map();
  const templates = [];
  for (const fd of folders || []) {
    if (!fd || (fd.vaultId || 'default') !== vaultId) continue;
    folderById.set(fd.id, fd);
  }
  for (const fd of folderById.values()) {
    if (tpl.has(fd.id)) continue; // la carpeta de plantillas tiene su propia entrada
    const parent = fd.parentId && folderById.has(fd.parentId) ? fd.parentId : '';
    if (!foldersAt.has(parent)) foldersAt.set(parent, []);
    foldersAt.get(parent).push(fd);
  }
  let total = 0;
  for (const f of files || []) {
    if (!f || (f.vaultId || 'default') !== vaultId) continue;
    if (f.folderId && tpl.has(f.folderId)) { templates.push(f); continue; }
    const k = f.folderId && folderById.has(f.folderId) ? f.folderId : '';
    if (!filesAt.has(k)) filesAt.set(k, []);
    filesAt.get(k).push(f);
    total++;
  }
  for (const l of filesAt.values()) l.sort(byName);
  for (const l of foldersAt.values()) l.sort(byName);
  templates.sort(byName);
  const counts = new Map();
  const countIn = (folderId) => {
    if (counts.has(folderId)) return counts.get(folderId);
    counts.set(folderId, 0); // corta ciclos de parentId
    let n = (filesAt.get(folderId) || []).length;
    for (const sub of foldersAt.get(folderId) || []) n += countIn(sub.id);
    counts.set(folderId, n);
    return n;
  };
  return {
    filesIn: (folderId) => filesAt.get(folderId || '') || [],
    foldersIn: (folderId) => foldersAt.get(folderId || '') || [],
    folderById,
    countIn,
    templates,
    total,
  };
}

// Cadena de carpetas (de la raíz a la hoja) que contiene a `file`.
export function folderChain(file, folderById) {
  const out = [];
  let fid = file && file.folderId;
  const seen = new Set();
  while (fid && folderById.has(fid) && !seen.has(fid)) {
    seen.add(fid);
    const fd = folderById.get(fid);
    out.unshift(fd);
    fid = fd.parentId || null;
  }
  return out;
}

// Aplana el árbol visible (según `expanded`) en filas para pintar/virtualizar
// y para la navegación con teclado.
// `opts.rootFiles === false`: las notas sueltas en la raíz del vault no se listan
// (están en «Todas las notas»; la barra lateral sólo enseña carpetas y lo que hay dentro).
export function flattenTree(index, expanded, opts) {
  const rootFiles = !opts || opts.rootFiles !== false;
  const rows = [];
  const walk = (folderId, depth, guard) => {
    for (const fd of index.foldersIn(folderId)) {
      if (guard.has(fd.id)) continue;
      const open = !!expanded[fd.id];
      rows.push({ kind: 'folder', id: fd.id, folder: fd, depth, open, count: index.countIn(fd.id) });
      if (open) { const g = new Set(guard); g.add(fd.id); walk(fd.id, depth + 1, g); }
    }
    if (folderId || rootFiles) for (const f of index.filesIn(folderId)) rows.push({ kind: 'file', id: f.id, file: f, depth });
  };
  walk('', 0, new Set());
  return rows;
}
