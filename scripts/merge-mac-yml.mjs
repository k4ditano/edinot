#!/usr/bin/env node
// Merge two electron-builder latest-mac.yml manifests into one combined
// manifest. The mac CI job builds x64 and arm64 in sequence (running both
// archs in one electron-builder invocation hits an EEXIST race in the
// staging dir), and each run writes a fresh latest-mac.yml that contains
// only the arch it just built — the second run silently clobbers the
// first. Result: electron-updater on Intel Macs sees a manifest that only
// advertises the arm64 zip, and refuses to download.
//
// This script takes two yml files (typically: a pre-arm64 snapshot of the
// x64 manifest and the post-arm64 manifest), splices their `files:`
// arrays together (deduped by url), and writes the merged result. The
// header (version) and trailer (path/sha512/releaseDate) come from the
// most recent run — that's also the one electron-builder considers
// authoritative for non-arch-aware fields.
//
// No yaml dependency: electron-builder emits a flat, predictable shape
// (single `files:` block of `- url: …` entries followed by top-level
// keys), so a line-based parser is plenty.
//
// Usage: node merge-mac-yml.mjs <yml-A> <yml-B> <out>

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function splitManifest(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = { header: [], files: [], trailer: [] };
  let phase = 'header';
  let block = null;
  for (const line of lines) {
    if (phase === 'header') {
      out.header.push(line);
      if (/^files:\s*$/.test(line)) phase = 'files';
      continue;
    }
    if (phase === 'files') {
      // A top-level key (no leading whitespace, ends the files[] array).
      if (/^[A-Za-z]/.test(line)) {
        if (block) { out.files.push(block); block = null; }
        phase = 'trailer';
        out.trailer.push(line);
        continue;
      }
      const isEntryStart = /^\s+-\s+url:/.test(line);
      if (isEntryStart) {
        if (block) out.files.push(block);
        block = [line];
      } else if (block) {
        block.push(line);
      }
      // Blank lines inside the files[] section (rare) are kept with the
      // current block so we don't lose formatting on re-emit.
    } else {
      out.trailer.push(line);
    }
  }
  if (block) out.files.push(block);
  return out;
}

function urlOf(block) {
  for (const line of block) {
    const m = line.match(/^\s+-?\s*url:\s*(.+?)\s*$/);
    if (m) return m[1];
  }
  return null;
}

const [, , aPath, bPath, outPath] = process.argv;
if (!aPath || !bPath || !outPath) {
  console.error('usage: merge-mac-yml.mjs <a.yml> <b.yml> <out.yml>');
  process.exit(2);
}

// Both inputs are required to be present — we'd rather fail loudly than
// quietly emit a single-arch manifest. CI fix-up logic decides whether
// to short-circuit (e.g. when only one arch was built) before calling us.
if (!existsSync(aPath)) { console.error(`missing input: ${aPath}`); process.exit(2); }
if (!existsSync(bPath)) { console.error(`missing input: ${bPath}`); process.exit(2); }

const A = splitManifest(readFileSync(aPath, 'utf8'));
const B = splitManifest(readFileSync(bPath, 'utf8'));

const seen = new Set();
const merged = [];
// B's entries come first so its arch is what electron-updater sees as the
// "primary" if it ever falls back to position order — but the contents of
// A get spliced right after so Intel clients still find a match.
for (const block of [...B.files, ...A.files]) {
  const url = urlOf(block);
  if (!url || seen.has(url)) continue;
  seen.add(url);
  merged.push(block);
}

if (merged.length === 0) {
  console.error('merge produced zero file entries — refusing to overwrite');
  process.exit(1);
}

const rendered = [
  ...B.header,
  ...merged.flatMap(b => b),
  ...B.trailer,
].join('\n');

writeFileSync(outPath, rendered, 'utf8');
console.log(`merged ${merged.length} entries from ${aPath} + ${bPath} → ${outPath}`);
