import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const watch = process.argv.includes('--watch');
const dev = watch || process.env.NODE_ENV === 'development';

await mkdir(dist, { recursive: true });

// Renderer: ESM + code splitting. `entry.jsx` is the only entry; every
// dynamic import() (editor.jsx, the float window, Ajustes, Calendario, vim,
// turndown, el canvas…) becomes its own content-hashed chunk under
// dist/app/. Hashed names let the loopback server (electron/main.cjs) mark
// them `immutable`, so Chromium keeps them — and their V8 code cache —
// across launches; a new build simply references new names.
const APP_DIR = path.join(dist, 'app');
const buildOptions = {
  entryPoints: [path.join(__dirname, 'entry.jsx')],
  bundle: true,
  outdir: APP_DIR,
  format: 'esm',
  splitting: true,
  entryNames: '[name]-[hash]',
  chunkNames: 'c-[hash]',
  assetNames: '[name]-[hash]',
  platform: 'browser',
  target: ['chrome120'],
  jsx: 'automatic',
  loader: { '.jsx': 'jsx', '.js': 'jsx' },
  inject: [path.join(__dirname, 'shim.js')],
  // EDINOT_NO_MINIFY=1: build de producción legible (perfiles de CPU con nombres).
  minify: !dev && !process.env.EDINOT_NO_MINIFY,
  sourcemap: dev ? 'inline' : 'linked',
  metafile: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
  },
  logLevel: 'info',
};

// Search index worker (Ctrl K «Contenido»): self-contained classic worker,
// built on its own so it never shares chunks with the window bundle. Its
// hashed URL is baked into the renderer through `define`.
const workerBuildOptions = {
  entryPoints: { 'search-worker': path.join(root, 'ui', 'search', 'worker.js') },
  bundle: true,
  outdir: APP_DIR,
  format: 'iife',
  entryNames: '[name]-[hash]',
  platform: 'browser',
  target: ['chrome120'],
  minify: !dev,
  sourcemap: dev ? 'inline' : 'linked',
  metafile: true,
  logLevel: 'warning',
};

async function buildWorker() {
  const r = await esbuild.build(workerBuildOptions);
  const out = Object.keys(r.metafile.outputs).find(f => f.endsWith('.js'));
  return './app/' + path.basename(out);
}

// Outputs needed for first paint: the entry chunk, its static imports and
// the chunks behind the two boot-time dynamic imports in entry.jsx
// (editor.jsx + clipper-renderer.js) with their static imports. They get
// <link rel="modulepreload"> so the browser fetches + compiles them in
// parallel instead of discovering them one level at a time.
function bootGraph(metafile) {
  const outputs = metafile.outputs;
  const rel = (f) => path.relative(dist, path.resolve(root, f)).split(path.sep).join('/');
  const entry = Object.keys(outputs).find(f => f.endsWith('.js') && /build[\\/]entry\.jsx$/.test(outputs[f].entryPoint || ''));
  const bootModules = ['editor.jsx', 'clipper-renderer.js'];
  const want = new Set([entry]);
  // Dynamic chunks whose «entryPoint» is one of the boot modules.
  for (const [f, o] of Object.entries(outputs)) {
    if (f.endsWith('.js') && o.entryPoint && bootModules.some(m => o.entryPoint.endsWith(m))) want.add(f);
  }
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f) || !outputs[f]) return;
    seen.add(f);
    for (const im of outputs[f].imports || []) if (im.kind === 'import-statement') walk(im.path);
  };
  for (const f of want) walk(f);
  const bytes = [...seen].reduce((a, f) => a + outputs[f].bytes, 0);
  return { entry: rel(entry), preload: [...seen].filter(f => f !== entry).map(rel), bytes };
}

// Bundle the MCP server into a single Node script that Claude Desktop (or any
// other MCP client) can spawn without needing the project's node_modules. We
// ship this file via electron-builder's extraResources so installed builds
// have a self-contained executable path.
const mcpBuildOptions = {
  entryPoints: [path.join(root, 'mcp', 'server.mjs')],
  bundle: true,
  outfile: path.join(dist, 'mcp-server.mjs'),
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  // bundle everything inline — no external node_modules required at runtime.
  // Además: silenciar el aviso «localStorage is not available» de Node ≥25
  // (inofensivo, pero llenaba los logs MCP de cada cliente).
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url); { const __ew = process.emitWarning; process.emitWarning = function (w, ...a) { const m = typeof w === 'string' ? w : (w && w.message) || ''; if (/localStorage is not available/.test(m)) return; return __ew.call(process, w, ...a); }; }" },
  logLevel: 'info',
};

// El hub local (hub/run.mjs → dist/hub.mjs) como programa suelto: el MCP y la app lo arrancan
// en segundo plano con `node hub.mjs`, así que va junto al MCP y no necesita node_modules.
const hubBuildOptions = {
  ...mcpBuildOptions,
  entryPoints: [path.join(root, 'hub', 'run.mjs')],
  outfile: path.join(dist, 'hub.mjs'),
};

// El CLI como un único archivo ejecutable (`edinot`): se copia a un VPS y funciona sin node_modules.
// Lleva dentro el hub (`edinot serve`); para el hub en segundo plano usa el `hub.mjs` de al lado.
const cliBuildOptions = {
  ...mcpBuildOptions,
  entryPoints: [path.join(root, 'cli', 'edinot.mjs')],
  outfile: path.join(dist, 'edinot.mjs'),
  // El `#!/usr/bin/env node` del propio cli/edinot.mjs lo conserva esbuild como primera línea.
};

// Theme boot: tiny parser-blocking inline script that applies the LAST
// PERSISTED theme's CSS variables before the first paint. Without it, a
// user on e.g. the dark 'graph' theme gets a sage-green flash every cold
// start (the :root defaults) until React hydrates yMeta from IndexedDB.
// editor.jsx mirrors the active theme into localStorage on every change.
// The shell tokens (side/panel/line/…) ride along when the theme defines
// them; otherwise ui/shell.css derives them from bg/fg/accent.
const THEME_BOOT_SCRIPT = `<script>(function(){try{var t=JSON.parse(localStorage.getItem('edinot.theme.v1')||'null');if(!t)return;if(t.system){try{t=window.matchMedia('(prefers-color-scheme: dark)').matches?t.system.dark:t.system.light;}catch(e){}}var r=document.documentElement.style;['bg','toolbar','fg','muted','accent','side','panel','line','hover','accent-soft','faint','hl'].forEach(function(k){if(t[k])r.setProperty('--'+k,t[k]);});if(t.dark)document.documentElement.classList.add('dark');}catch(e){}})()</script>`;

// Build HTML: strip CDN scripts, inject the module entry + IPC glue.
// The entry is `type="module"` (deferred) and the glue is `defer`, so both
// run after parsing in document order — bundle first, glue second, exactly
// like the old pair of classic scripts at the end of <body>. The theme boot
// script stays parser-blocking in <head>.
async function buildHtml(graph) {
  const src = await readFile(path.join(root, 'MarkEdit.html'), 'utf8');
  let out = src;
  // remove CDN React/ReactDOM/Babel script tags
  out = out.replace(/<script[^>]*unpkg\.com[^<]*<\/script>\s*/g, '');
  // remove the two text/babel scripts (the JSX includes and the inline render)
  out = out.replace(/<script type="text\/babel"[^>]*>[\s\S]*?<\/script>\s*/g, '');
  out = out.replace(/<script type="text\/babel"\s+src="[^"]+"\s*><\/script>\s*/g, '');
  const preload = graph
    ? graph.preload.map(f => `<link rel="modulepreload" href="./${f}" />`).join('\n')
    : '';
  // persisted-theme vars before first paint (must precede the closing head)
  out = out.replace(/<\/head>/, THEME_BOOT_SCRIPT + '\n' + (preload ? preload + '\n' : '') + '</head>');
  const entry = graph ? './' + graph.entry : './app/entry.js';
  out = out.replace(/<\/body>/, `<script type="module" src="${entry}"></script>\n<script defer src="./ipc-glue.js"></script>\n</body>`);
  await writeFile(path.join(dist, 'index.html'), out, 'utf8');
}

// Bundled fonts (Inter + JetBrains Mono, latin/latin-ext variable woff2) —
// served locally so startup never touches the network (no FOUT, no offline
// stall). Source of truth lives in build/resources/fonts.
// New app shell stylesheet (tokens + sidebar/top bar/panel/palette/home).
// Lives outside MarkEdit.html so the inline legacy CSS stops growing; the
// <link> sits after the inline <style> so shell rules win on equal
// specificity.
async function copyShellCss() {
  await copyFile(path.join(root, 'ui', 'shell.css'), path.join(dist, 'shell.css'));
  // Página Calendario (ui/calendar/*).
  await copyFile(path.join(root, 'ui', 'calendar', 'calendar.css'), path.join(dist, 'calendar.css'));
  // «Todas las notas» (ui/allnotes/*).
  await copyFile(path.join(root, 'ui', 'allnotes', 'allnotes.css'), path.join(dist, 'allnotes.css'));
  // Bases de datos (editor/db/*): mismo trato que shell.css.
  await copyFile(path.join(root, 'ui', 'db.css'), path.join(dist, 'db.css'));
  // Editor de bloques («Editar»): asas, menú «/», barra flotante, avisos…
  await copyFile(path.join(root, 'ui', 'blocks.css'), path.join(dist, 'blocks.css'));
  // Capa de diseño Notion/AFFiNE (se carga la última).
  await copyFile(path.join(root, 'ui', 'design.css'), path.join(dist, 'design.css'));
  // KaTeX (fórmulas $…$): su CSS y sus fuentes, servidos en local.
  const kSrc = path.join(root, 'node_modules', 'katex', 'dist');
  const kOut = path.join(dist, 'katex');
  await mkdir(path.join(kOut, 'fonts'), { recursive: true });
  await copyFile(path.join(kSrc, 'katex.min.css'), path.join(kOut, 'katex.min.css'));
  const { readdir } = await import('node:fs/promises');
  for (const f of await readdir(path.join(kSrc, 'fonts'))) {
    if (f.endsWith('.woff2')) await copyFile(path.join(kSrc, 'fonts', f), path.join(kOut, 'fonts', f));
  }
}

async function copyFonts() {
  const srcDir = path.join(__dirname, 'resources', 'fonts');
  const outDir = path.join(dist, 'fonts');
  await mkdir(outDir, { recursive: true });
  const { readdir } = await import('node:fs/promises');
  for (const f of await readdir(srcDir)) {
    if (f.endsWith('.woff2')) await copyFile(path.join(srcDir, f), path.join(outDir, f));
    if (f === 'fonts.css') await copyFile(path.join(srcDir, f), path.join(dist, 'fonts.css'));
  }
}

// IPC glue: bridges Electron menu actions to the renderer's keyboard shortcuts.
async function buildIpcGlue() {
  const glue = `
(function () {
  if (!window.electronAPI) return;
  const fire = (mod, key, shift) => {
    const evt = new KeyboardEvent('keydown', {
      key, code: 'Key' + key.toUpperCase(),
      ctrlKey: !mod || mod === 'ctrl',
      metaKey: mod === 'meta',
      shiftKey: !!shift, bubbles: true,
    });
    window.dispatchEvent(evt);
  };
  const isMac = window.electronAPI.platform === 'darwin';
  const m = isMac ? 'meta' : 'ctrl';

  // Ver → Alternar render: se pide por id para que funcione aunque el
  // usuario haya cambiado el atajo en Ajustes → Atajos.
  window.electronAPI.on('menu:toggleRender', () => {
    window.dispatchEvent(new CustomEvent('edinot:shortcut', { detail: { id: 'toggleRender' } }));
  });
  window.electronAPI.on('menu:new', () => {
    window.dispatchEvent(new CustomEvent('edinot:new'));
  });
  window.electronAPI.on('menu:import', () => {
    window.dispatchEvent(new CustomEvent('edinot:import'));
  });

  // Save / Save As — pull live content from window.__edinotIO (set by editor.jsx).
  // The legacy code read \`.md-editor.value\` which only worked while the editor
  // was a <textarea>; CodeMirror has no \`.value\`, so saves wrote empty files.
  const getActive = () => {
    if (window.__edinotIO && typeof window.__edinotIO.getActive === 'function') {
      return window.__edinotIO.getActive();
    }
    return null;
  };

  window.electronAPI.on('menu:save', async () => {
    const a = getActive();
    if (!a) return;
    const targetPath = a.path || window.__currentFilePath || null;
    const res = await window.electronAPI.saveFile(targetPath, a.content || '');
    if (res && !res.canceled && res.path) {
      window.__currentFilePath = res.path;
      if (window.__edinotIO && window.__edinotIO.onSaved) window.__edinotIO.onSaved(res.path);
    }
  });
  window.electronAPI.on('menu:saveAs', async () => {
    const a = getActive();
    if (!a) return;
    const res = await window.electronAPI.saveFileAs(a.content || '');
    if (res && !res.canceled && res.path) {
      window.__currentFilePath = res.path;
      if (window.__edinotIO && window.__edinotIO.onSaved) window.__edinotIO.onSaved(res.path);
    }
  });

  window.electronAPI.on('file:opened', ({ path, content }) => {
    window.__currentFilePath = path;
    window.dispatchEvent(new CustomEvent('edinot:open', { detail: { path, content } }));
  });

  // OS-level file association: double-click a .md → main process sends this.
  // Renderer keeps it as an "external" file (not in yFiles) until user imports.
  window.electronAPI.on('file:externalOpen', ({ path, content }) => {
    window.dispatchEvent(new CustomEvent('edinot:externalOpen', { detail: { path, content } }));
  });
})();
`;
  await writeFile(path.join(dist, 'ipc-glue.js'), glue, 'utf8');
}

// Fresh chunk directory every build: hashed names would otherwise pile up
// (and get packaged) forever. The legacy single-file bundle goes too.
await rm(APP_DIR, { recursive: true, force: true });
await rm(path.join(dist, 'bundle.js'), { force: true });
await rm(path.join(dist, 'bundle.js.map'), { force: true });
await mkdir(APP_DIR, { recursive: true });

await buildIpcGlue();
await copyFonts();
await copyShellCss();

const workerUrl = await buildWorker();
buildOptions.define.__EDINOT_SEARCH_WORKER__ = JSON.stringify(workerUrl);

function reportSizes(graph, metafile) {
  const js = Object.entries(metafile.outputs).filter(([f]) => f.endsWith('.js'));
  const total = js.reduce((a, [, o]) => a + o.bytes, 0);
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`[esbuild] renderer: ${js.length} chunks, ${kb(total)} total; arranque (entry + precarga): ${kb(graph.bytes)}`);
}

if (watch) {
  // In watch mode index.html must follow the hashed entry name: rebuild it
  // from the metafile after every successful build.
  const plugin = {
    name: 'edinot-html',
    setup(b) {
      b.onEnd(async (r) => {
        if (r.errors.length || !r.metafile) return;
        const graph = bootGraph(r.metafile);
        await buildHtml(graph);
        // Drop chunks from previous rebuilds that are no longer referenced.
        const { readdir } = await import('node:fs/promises');
        const live = new Set(Object.keys(r.metafile.outputs).map(f => path.basename(f)));
        live.add(path.basename(workerUrl));
        live.add(path.basename(workerUrl) + '.map');
        for (const f of await readdir(APP_DIR)) if (!live.has(f)) await rm(path.join(APP_DIR, f), { force: true });
      });
    },
  };
  const ctx = await esbuild.context({ ...buildOptions, plugins: [plugin] });
  await ctx.watch();
  // shell.css is copied, not bundled — recopy it on change while watching.
  const { watch: fsWatch } = await import('node:fs');
  fsWatch(path.join(root, 'ui', 'shell.css'), () => { copyShellCss().catch(() => {}); });
  fsWatch(path.join(root, 'ui', 'calendar', 'calendar.css'), () => { copyShellCss().catch(() => {}); });
  fsWatch(path.join(root, 'ui', 'allnotes', 'allnotes.css'), () => { copyShellCss().catch(() => {}); });
  fsWatch(path.join(root, 'ui', 'db.css'), () => { copyShellCss().catch(() => {}); });
  fsWatch(path.join(root, 'ui', 'blocks.css'), () => { copyShellCss().catch(() => {}); });
  fsWatch(path.join(root, 'ui', 'design.css'), () => { copyShellCss().catch(() => {}); });
  console.log('[esbuild] watching…');
} else {
  const r = await esbuild.build(buildOptions);
  const graph = bootGraph(r.metafile);
  await buildHtml(graph);
  if (process.env.EDINOT_METAFILE) await writeFile(process.env.EDINOT_METAFILE, JSON.stringify(r.metafile), 'utf8');
  reportSizes(graph, r.metafile);
  console.log('[esbuild] renderer written to dist/app/');
  try {
    await esbuild.build(mcpBuildOptions);
    console.log('[esbuild] MCP server bundle written to dist/mcp-server.mjs');
    await esbuild.build(hubBuildOptions);
    console.log('[esbuild] hub bundle written to dist/hub.mjs');
    await esbuild.build(cliBuildOptions);
    try { (await import('node:fs')).chmodSync(path.join(dist, 'edinot.mjs'), 0o755); } catch {}
    console.log('[esbuild] CLI bundle written to dist/edinot.mjs');
  } catch (err) {
    console.warn('[esbuild] MCP server bundle failed (non-fatal):', err.message);
  }
}
