// Shared markdown-table CRUD used by the `edinot table` CLI subcommands.
// Mirrors the parser/serializer in mcp/server.mjs — if you change either,
// keep both in sync (no runtime import bridge between them yet).

function splitTableLine(line) {
  // Split on unescaped `|`, drop empty leading/trailing, unescape `\|`.
  return String(line).split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim().replace(/\\\|/g, '|'));
}
function parseTableBlocks(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const sepLine = (lines[i + 1] || '').trim();
    if (!/^\|[\s\-:|]+\|$/.test(sepLine)) continue;
    const headers = splitTableLine(line);
    const rows = [];
    let j = i + 2;
    while (j < lines.length) {
      const r = lines[j].trim();
      if (!r.startsWith('|') || !r.endsWith('|')) break;
      rows.push(splitTableLine(lines[j]));
      j++;
    }
    out.push({
      tableIdx: idx++, headers, rows,
      startLine: i, firstDataLine: i + 2, lastDataLine: j - 1,
    });
    i = j - 1;
  }
  return out;
}
function buildRow(headers, values) {
  return `| ${headers.map(h => {
    const v = values[h] != null ? values[h] : values[h.toLowerCase()];
    return v == null ? '' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }).join(' | ')} |`;
}
function splice(text, block, newRows) {
  const lines = String(text || '').split('\n');
  const headerSep = lines.slice(block.startLine, block.firstDataLine);
  const before = lines.slice(0, block.startLine);
  const after = lines.slice(block.lastDataLine + 1);
  return [...before, ...headerSep, ...newRows, ...after].join('\n');
}
function pick(blocks, idx) {
  if (!blocks.length) throw new Error('note has no markdown tables');
  if (idx == null) {
    if (blocks.length > 1) throw new Error(`note has ${blocks.length} tables — pass --idx N`);
    return blocks[0];
  }
  const b = blocks[idx];
  if (!b) throw new Error(`--idx ${idx} out of range (0..${blocks.length - 1})`);
  return b;
}
function rowToObj(headers, row) {
  const o = {};
  for (let i = 0; i < headers.length; i++) o[headers[i]] = row[i] || '';
  return o;
}
function matchRow(headers, row, match) {
  for (const [k, v] of Object.entries(match || {})) {
    const idx = headers.findIndex(h => h.toLowerCase() === String(k).toLowerCase());
    if (idx < 0) return false;
    if (!String(row[idx] || '').toLowerCase().includes(String(v).toLowerCase())) return false;
  }
  return true;
}

export async function runTableCommand(s, sub, noteName, flags) {
  const f = s.findFileByName(noteName);
  if (!f) { process.stderr.write(`error: note not found: ${noteName}\n`); process.exit(2); }
  const content = await s.readContent(f.id);
  const blocks = parseTableBlocks(content);
  if (sub === 'list') {
    for (const b of blocks) {
      process.stdout.write(`#${b.tableIdx}\t[${b.headers.join(' | ')}]\trows=${b.rows.length}\tline=${b.startLine + 1}\n`);
    }
    if (!blocks.length) process.stdout.write('(no tables)\n');
    return;
  }
  const b = pick(blocks, flags.idx);
  if (sub === 'read') {
    const out = b.rows.map(r => rowToObj(b.headers, r));
    process.stdout.write(JSON.stringify({ tableIdx: b.tableIdx, headers: b.headers, rows: out }, null, 2) + '\n');
    return;
  }
  if (sub === 'find') {
    const hits = [];
    b.rows.forEach((r, idx) => { if (matchRow(b.headers, r, flags.match)) hits.push({ rowIdx: idx, row: rowToObj(b.headers, r) }); });
    process.stdout.write(JSON.stringify({ tableIdx: b.tableIdx, hits }, null, 2) + '\n');
    return;
  }
  // Mutating ops below.
  const existing = b.rows.map(r => `| ${r.map(c => String(c || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
  if (sub === 'add') {
    const rowStr = buildRow(b.headers, flags.cols);
    let newRows;
    const pos = flags.position;
    if (pos === 'top') newRows = [rowStr, ...existing];
    else if (pos && pos.startsWith('after:')) {
      const n = Number(pos.slice('after:'.length));
      const at = Math.max(0, Math.min(n + 1, existing.length));
      newRows = [...existing.slice(0, at), rowStr, ...existing.slice(at)];
    } else newRows = [...existing, rowStr];
    await s.writeContent(f.id, splice(content, b, newRows));
    process.stdout.write(`added row to table #${b.tableIdx}\n`);
    return;
  }
  // For set/del we need to identify a target row.
  let target = -1;
  if (flags.row != null) target = flags.row;
  else if (Object.keys(flags.match).length) target = b.rows.findIndex(r => matchRow(b.headers, r, flags.match));
  if (target < 0 || target >= b.rows.length) {
    process.stderr.write('error: row not found — pass --row N or --match Col=Val\n'); process.exit(2);
  }
  if (sub === 'del') {
    existing.splice(target, 1);
    await s.writeContent(f.id, splice(content, b, existing));
    process.stdout.write(`deleted row ${target} from table #${b.tableIdx}\n`);
    return;
  }
  if (sub === 'set') {
    const merged = { ...rowToObj(b.headers, b.rows[target]), ...flags.cols };
    // Re-key with case-insensitive match against headers.
    const final = {};
    for (const h of b.headers) {
      const k = Object.keys(merged).find(kk => kk.toLowerCase() === h.toLowerCase());
      final[h] = k != null ? merged[k] : '';
    }
    existing[target] = buildRow(b.headers, final);
    await s.writeContent(f.id, splice(content, b, existing));
    process.stdout.write(`updated row ${target} in table #${b.tableIdx}\n`);
    return;
  }
  process.stderr.write(`error: unknown table sub: ${sub} (use list|read|add|set|del|find)\n`); process.exit(2);
}
