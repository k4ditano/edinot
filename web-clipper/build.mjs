import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const argv = process.argv.slice(2);
const watchMode = argv.includes('--watch');
const targetArg = argv.find(a => a.startsWith('--target='));
const target = targetArg ? targetArg.split('=')[1] : 'chrome';
if (!['chrome', 'firefox'].includes(target)) {
  console.error(`Unknown target: ${target}`);
  process.exit(1);
}

const outDir = join(ROOT, 'dist', target);

async function clean() {
  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

async function copyStatic() {
  await mkdir(join(outDir, 'popup'), { recursive: true });
  await mkdir(join(outDir, 'icons'), { recursive: true });
  await cp(join(ROOT, 'src/popup/index.html'), join(outDir, 'popup/index.html'));
  await cp(join(ROOT, 'src/popup/style.css'), join(outDir, 'popup/style.css'));
  if (existsSync(join(ROOT, 'src/icons'))) {
    await cp(join(ROOT, 'src/icons'), join(outDir, 'icons'), { recursive: true });
  }
}

async function copyManifest() {
  const manifestPath = join(ROOT, `manifest.${target}.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

const sharedOpts = {
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox115'],
  platform: 'browser',
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
    'globalThis.__EDINOT_TARGET__': JSON.stringify(target)
  }
};

const entries = [
  {
    entryPoints: [join(ROOT, 'src/background/index.js')],
    outfile: join(outDir, 'background/index.js'),
    format: target === 'firefox' ? 'esm' : 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/content/index.js')],
    outfile: join(outDir, 'content/index.js'),
    format: 'iife'
  },
  {
    entryPoints: [join(ROOT, 'src/popup/index.js')],
    outfile: join(outDir, 'popup/index.js'),
    format: 'esm'
  }
];

async function run() {
  await clean();
  await copyStatic();
  await copyManifest();

  if (watchMode) {
    for (const entry of entries) {
      const ctx = await context({ ...sharedOpts, ...entry });
      await ctx.watch();
    }
    console.log(`[edinot-clipper] watching (${target})…`);
  } else {
    await Promise.all(entries.map(entry => build({ ...sharedOpts, ...entry })));
    console.log(`[edinot-clipper] built → ${outDir}`);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
