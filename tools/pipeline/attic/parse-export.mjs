// Parse the official DeepSeek export into a local, greppable knowledge base.
//
//   node parse-export.mjs --sample 2      # dry: print 2 reconstructed conversations
//   node parse-export.mjs                 # full run -> knowledge/
//
// Output:
//   knowledge/conversations/<date>-<slug>-<id8>.md   one file per conversation
//   knowledge/conversations.jsonl                    machine-readable records
//   knowledge/catalog.tsv                            catalog (id/date/turns/chars/title/path)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'knowledge';
const DIR = join(ROOT, 'conversations');
const argv = process.argv.slice(2);
const sampleN = argv.includes('--sample') ? Number(argv[argv.indexOf('--sample') + 1] || 2) : 0;

const convs = JSON.parse(readFileSync('raw/conversations.json', 'utf8'));

const USER_FRAGS = new Set(['REQUEST', 'FILE']);
const ASSIST_FRAGS = new Set(['THINK', 'RESPONSE', 'SEARCH', 'TOOL_SEARCH', 'TOOL_OPEN', 'TOOL_FIND']);

/**
 * Walk up from the real thread leaf to the root to recover the active thread.
 *
 * A leaf is a node with NO children (a node nobody references as a child is the
 * synthetic `root`, i.e. the tree's top, not its bottom). Message timestamps are
 * NOT a reliable leaf signal: in DeepSeek's export the assistant reply often
 * carries exactly the same `inserted_at` as the user message it answers, so a
 * timestamp-max search silently stops on the question and drops the answer.
 * Timestamps are therefore only a tie-break between genuine leaves.
 */
function mainPath(map) {
  const ids = Object.keys(map);
  if (ids.length === 0) return [];
  const isLeaf = (id) => {
    const n = map[id];
    if (!n || n.parent === null || n.parent === undefined) return false; // synthetic root
    return (n.children ?? []).length === 0;
  };
  const ts = (n) => Date.parse(n.message?.inserted_at ?? 0) || 0;
  const depth = (node) => {
    let d = 0,
      cur = node;
    const guard = new Set();
    while (cur && cur.parent && cur.parent !== 'root' && map[cur.parent] && !guard.has(cur.id)) {
      guard.add(cur.id);
      cur = map[cur.parent];
      d++;
    }
    return d;
  };

  let leaves = ids.filter(isLeaf);
  if (leaves.length === 0) {
    // degenerate export: fall back to the most recently inserted message node
    leaves = ids.filter((id) => map[id]?.message);
    if (leaves.length === 0) return [];
  }
  let leafId = leaves[0];
  for (const id of leaves) {
    const a = map[id],
      b = map[leafId];
    if (ts(a) > ts(b) || (ts(a) === ts(b) && depth(a) > depth(b))) leafId = id;
  }

  const chain = [];
  let cur = map[leafId];
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.message) chain.push(cur);
    if (cur.parent === 'root' || cur.parent === null || cur.parent === undefined) break;
    cur = map[cur.parent];
  }
  return chain.reverse();
}

function roleOf(msg) {
  const types = (msg.fragments ?? []).map((f) => f.type);
  if (types.some((t) => USER_FRAGS.has(t))) return 'user';
  if (types.some((t) => ASSIST_FRAGS.has(t))) return 'assistant';
  return 'unknown';
}

/** One exported node -> one normalized message. */
function normalize(node) {
  const msg = node.message;
  const frags = msg.fragments ?? [];
  const pick = (t) => frags.filter((f) => f.type === t);
  const textOf = (t) => pick(t).map((f) => f.content ?? '').filter(Boolean).join('\n\n');
  const searches = [...pick('SEARCH'), ...pick('TOOL_SEARCH')].flatMap((f) =>
    (f.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '' })),
  );
  const files = pick('FILE').flatMap((f) =>
    (f.files ?? []).map((x) => ({ name: x.file_name ?? '', size: x.file_size ?? 0 })),
  );
  return {
    id: node.id,
    at: msg.inserted_at ?? null,
    model: msg.model ?? null,
    role: roleOf(msg),
    text: textOf('REQUEST') || textOf('RESPONSE'),
    thinking: textOf('THINK'),
    searches,
    files,
    toolOps: frags.filter((f) => f.type.startsWith('TOOL_')).length,
  };
}

const RESERVED = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;
// Windows-illegal characters, ASCII + Unicode control/format characters, and
// anything that would make a hostile or unreadable file name.
const ILLEGAL = /[\\/:*?"<>|]/g;
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;
function slugify(title, fallback) {
  let s = (title || '')
    .normalize('NFKC')
    .replace(CONTROL, '')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[. ]+|[. ]+$/g, '');
  if (!s || RESERVED.test(s)) s = fallback;
  s = [...s].slice(0, 60).join('').trim();
  // final safety net: no control chars or trailing dots/spaces may survive
  s = s.replace(CONTROL, '').replace(/[. ]+$/, '');
  return s || fallback;
}
const ymd = (iso) => (iso ? String(iso).slice(0, 10).replace(/-/g, '') : '00000000');
const stamp = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '');
const kb = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function render(conv, messages) {
  const models = [...new Set(messages.map((m) => m.model).filter(Boolean))];
  const chars = messages.reduce((a, m) => a + m.text.length + m.thinking.length, 0);
  const L = [];
  L.push(`# ${conv.title || '(无标题)'}`);
  L.push('');
  L.push(`- **会话 ID**：\`${conv.id}\``);
  L.push(`- **时间**：${stamp(conv.inserted_at)} → ${stamp(conv.updated_at)}`);
  L.push(`- **模型**：${models.join(', ') || '—'}`);
  L.push(`- **消息**：${messages.length} 条，约 ${chars.toLocaleString('en-US')} 字符`);
  L.push(`- **来源**：DeepSeek 官方数据导出（conversations.json）`);
  L.push('');
  L.push('---');
  L.push('');
  for (const m of messages) {
    const when = stamp(m.at);
    if (m.role === 'user') {
      L.push(`## 👤 用户 · ${when}`);
      L.push('');
      for (const f of m.files) L.push(`> 📎 附件：\`${f.name}\`（${kb(f.size)}）`);
      if (m.files.length) L.push('');
      if (m.text) L.push(m.text);
      L.push('');
    } else {
      if (m.thinking) {
        L.push(`### 💭 思考过程 · ${when}`);
        L.push('');
        L.push(m.thinking);
        L.push('');
      }
      if (m.searches.length) {
        L.push('<details><summary>🔍 联网检索（' + m.searches.length + ' 条）</summary>');
        L.push('');
        for (const s of m.searches) L.push(`- [${s.title || s.url}](${s.url})`);
        L.push('');
        L.push('</details>');
        L.push('');
      }
      if (m.text) {
        L.push(`### 🤖 DeepSeek · ${when}`);
        L.push('');
        L.push(m.text);
        L.push('');
      }
    }
  }
  return L.join('\n');
}

// ---------- sample mode ----------
if (sampleN > 0) {
  const picks = [...convs].sort((a, b) => (b.mapping ? Object.keys(b.mapping).length : 0) - (a.mapping ? Object.keys(a.mapping).length : 0)).slice(0, sampleN);
  console.log(`total conversations: ${convs.length}`);
  for (const c of picks) {
    const path = mainPath(c.mapping ?? {});
    console.log('\n' + '='.repeat(70));
    console.log(`TITLE: ${c.title}  | nodes=${Object.keys(c.mapping ?? {}).length} | path=${path.length}`);
    console.log('='.repeat(70));
    console.log(JSON.stringify(path.slice(0, 6).map((n) => ({ id: n.id, children: n.children, ...normalize(n), text: undefined, thinking: undefined })), null, 1));
    const msgs = path.map(normalize).filter((m) => m.role !== 'unknown');
    for (const m of msgs.slice(0, 4)) {
      console.log(`  [${m.role}/${m.model}] ${stamp(m.at)} text=${m.text.length} think=${m.thinking.length} search=${m.searches.length} files=${m.files.length}`);
    }
  }
  process.exit(0);
}

// ---------- full run ----------
if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const catalog = [];
const jsonl = [];
const usedNames = new Set();
const stats = { convs: 0, messages: 0, chars: 0, branchesPruned: 0, unknown: 0, bytes: 0 };

for (const conv of convs) {
  const map = conv.mapping ?? {};
  const path = mainPath(map);
  stats.branchesPruned += Object.values(map).filter((n) => (n.children ?? []).length > 1).length;
  const messages = path.map(normalize).filter((m) => {
    if (m.role === 'unknown') stats.unknown++;
    return m.role !== 'unknown' && (m.text || m.thinking || m.files.length || m.searches.length);
  });
  const chars = messages.reduce((a, m) => a + m.text.length + m.thinking.length, 0);
  const models = [...new Set(messages.map((m) => m.model).filter(Boolean))];

  let base = `${ymd(conv.inserted_at)}-${slugify(conv.title, 'untitled')}-${conv.id.slice(0, 8)}`;
  let name = base + '.md';
  let i = 1;
  while (usedNames.has(name.toLowerCase())) name = `${base}-${++i}.md`;
  usedNames.add(name.toLowerCase());

  const md = render(conv, messages);
  try {
    writeFileSync(join(DIR, name), md, 'utf8');
  } catch (err) {
    // Never lose a conversation to an unrepresentable file name: fall back to the id.
    name = `${ymd(conv.inserted_at)}-untitled-${conv.id.slice(0, 8)}.md`;
    writeFileSync(join(DIR, name), md, 'utf8');
    console.warn(`  ! fell back to id-based name for "${conv.title}" (${err.code})`);
  }
  stats.bytes += Buffer.byteLength(md);
  stats.convs++;
  stats.messages += messages.length;
  stats.chars += chars;

  catalog.push({
    id: conv.id,
    title: conv.title ?? '',
    date: ymd(conv.inserted_at),
    inserted_at: conv.inserted_at,
    updated_at: conv.updated_at,
    turns: messages.filter((m) => m.role === 'user').length,
    messages: messages.length,
    chars,
    models,
    path: `conversations/${name}`,
  });
  jsonl.push({
    id: conv.id,
    title: conv.title,
    inserted_at: conv.inserted_at,
    updated_at: conv.updated_at,
    file: `conversations/${name}`,
    messages,
  });
}

catalog.sort((a, b) => String(a.inserted_at).localeCompare(String(b.inserted_at)));
writeFileSync(join(ROOT, 'catalog.json'), JSON.stringify(catalog, null, 1));
writeFileSync(
  join(ROOT, 'catalog.tsv'),
  ['date\tupdated\tturns\tchars\tmodels\ttitle\tpath', ...catalog.map((c) => [c.date, String(c.updated_at).slice(0, 10), c.turns, c.chars, c.models.join('+'), c.title.replace(/[\t\r\n]/g, ' '), c.path].join('\t'))].join('\n'),
);
writeFileSync(join(ROOT, 'conversations.jsonl'), jsonl.map((r) => JSON.stringify(r)).join('\n'));

console.log('=== parse complete ===');
console.log(JSON.stringify(stats, null, 1));
console.log(`markdown: ${(stats.bytes / 1048576).toFixed(1)} MB in ${stats.convs} files`);
console.log(`catalog.tsv: ${catalog.length} rows`);
