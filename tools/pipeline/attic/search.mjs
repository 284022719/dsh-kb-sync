// Full-text search over the migrated knowledge base.
//
//   node search.mjs "关键词"                  # search all conversations
//   node search.mjs "关键词" --limit 20       # cap hits
//   node search.mjs "关键词" --topic 健康      # restrict to a topic dir
//   node search.mjs "关键词" --context 3      # context lines around each hit
//   node search.mjs --stats                   # KB statistics
//
// Pure Node, no dependencies. Case-insensitive substring match with line context.
// The KB root defaults to the parent of this script when it lives in <kb>/tools/,
// otherwise to ./knowledge.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const defaultRoot = existsSync(join(HERE, '..', 'conversations')) ? resolve(join(HERE, '..')) : 'knowledge';

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--stats') flags.stats = true;
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
  else positional.push(a);
}
const ROOT = resolve(flags.root ? String(flags.root) : defaultRoot);
const query = positional.join(' ');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const convDir = join(ROOT, 'conversations');
if (!existsSync(convDir)) {
  console.error(`not found: ${convDir}`);
  process.exit(2);
}
const files = walk(convDir);

if (flags.stats) {
  let bytes = 0,
    lines = 0;
  for (const f of files) {
    const s = statSync(f);
    bytes += s.size;
    lines += readFileSync(f, 'utf8').split('\n').length;
  }
  console.log(`conversations: ${files.length}`);
  console.log(`size: ${(bytes / 1048576).toFixed(1)} MB, lines: ${lines}`);
  process.exit(0);
}

if (!query) {
  console.error('usage: node search.mjs "关键词" [--limit N] [--context N] [--topic 子串]');
  process.exit(2);
}

const limit = Number(flags.limit ?? 50);
const context = Number(flags.context ?? 1);
const needle = query.toLowerCase();
const hits = [];

for (const f of files) {
  if (flags.topic && !f.toLowerCase().includes(String(flags.topic).toLowerCase())) continue;
  const text = readFileSync(f, 'utf8');
  const lower = text.toLowerCase();
  let from = 0,
    count = 0;
  const lns = text.split('\n');
  let idx = -1;
  while ((idx = lower.indexOf(needle, from)) !== -1) {
    count++;
    from = idx + needle.length;
  }
  if (count === 0) continue;
  // locate line numbers of the first few matches for context display
  const snippets = [];
  let pos = 0,
    taken = 0;
  while (taken < 3) {
    const at = lower.indexOf(needle, pos);
    if (at === -1) break;
    pos = at + needle.length;
    let lineNo = 0,
      acc = 0;
    for (let i = 0; i < lns.length; i++) {
      const next = acc + lns[i].length + 1;
      if (at < next) {
        lineNo = i;
        break;
      }
      acc = next;
    }
    const lo = Math.max(0, lineNo - context);
    const hi = Math.min(lns.length, lineNo + context + 1);
    snippets.push(
      lns
        .slice(lo, hi)
        .map((l, i) => {
          const n = lo + i + 1;
          const mark = n === lineNo + 1 ? '>' : ' ';
          return `${mark} ${String(n).padStart(5)}| ${l.slice(0, 220)}`;
        })
        .join('\n'),
    );
    taken++;
  }
  const title = (text.split('\n', 1)[0] ?? '').replace(/^#\s*/, '');
  hits.push({ file: f, title, count, snippets, size: statSync(f).size });
}

hits.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
console.log(`query: "${query}"  ->  ${hits.length} conversations, ${hits.reduce((a, h) => a + h.count, 0)} total matches\n`);
for (const h of hits.slice(0, limit)) {
  console.log(`── ${h.title}  [${h.count} hits]  ${h.file.replace(/\\/g, '/')}`);
  for (const s of h.snippets.slice(0, 2)) console.log(s);
  console.log('');
}
if (hits.length > limit) console.log(`... and ${hits.length - limit} more conversations`);
