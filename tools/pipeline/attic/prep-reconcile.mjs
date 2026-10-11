// Build a reconciliation inventory from the per-batch clustering results:
// merge same-named topics across batches and emit a compact, LLM-readable list.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const files = readdirSync('topics').filter((f) => /^batch-\d+\.json$/.test(f)).sort();
const catalog = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));

const byName = new Map(); // name -> {name, descs:Set, keywords:Set, members:Set, batches:Set}
const problems = [];
const noise = new Set();
const substantive = new Map();
let covered = 0;

for (const f of files) {
  const j = JSON.parse(readFileSync('topics/' + f, 'utf8'));
  const batch = j.batch ?? Number(f.match(/\d+/)[0]);
  for (const t of j.topics ?? []) {
    const key = t.name.trim();
    if (!byName.has(key)) byName.set(key, { name: key, descs: new Set(), keywords: new Set(), members: new Set(), batches: new Set() });
    const e = byName.get(key);
    if (t.desc) e.descs.add(t.desc);
    for (const k of t.keywords ?? []) e.keywords.add(k);
    for (const i of t.members ?? []) {
      if (e.members.has(i)) problems.push(`idx ${i} repeated inside "${key}"`);
      e.members.add(i);
      covered++;
    }
    e.batches.add(batch);
  }
  for (const i of j.noise ?? []) noise.add(i);
  for (const s of j.substantive ?? []) substantive.set(s.idx, s.summary);
}

const merged = [...byName.values()]
  .map((e) => ({ ...e, descs: [...e.descs], keywords: [...e.keywords], members: [...e.members].sort((a, b) => a - b), batches: [...e.batches].sort() }))
  .sort((a, b) => b.members.length - a.members.length);

const totalMembers = merged.reduce((a, t) => a + t.members.length, 0);
const unique = new Set(merged.flatMap((t) => t.members));
console.log(`batches read: ${files.length} (${files.join(', ')})`);
console.log(`distinct topic names: ${merged.length}`);
console.log(`members: ${totalMembers}, unique: ${unique.size}, noise: ${noise.size}`);
console.log(`coverage: ${unique.size + noise.size} / ${catalog.length}`);
if (problems.length) console.log('problems:', problems.slice(0, 10));

const lines = [];
lines.push('# 话题清点（跨批同名已合并）');
lines.push('');
lines.push(`- 已读批次：${files.length}`);
lines.push(`- 去重后话题名：${merged.length}`);
lines.push(`- 已归类会话：${unique.size}；零散：${noise.size}；合计 ${unique.size + noise.size}/${catalog.length}`);
lines.push('');
lines.push('| 话题名 | 会话数 | 出现批次 | 说明 | 样例会话（最多6条） |');
lines.push('|--------|--------|----------|------|----------------------|');
for (const t of merged) {
  const samples = t.members
    .slice()
    .sort((a, b) => (catalog[b]?.chars ?? 0) - (catalog[a]?.chars ?? 0))
    .slice(0, 6)
    .map((i) => catalog[i]?.title ?? '?')
    .join('；');
  lines.push(`| ${t.name} | ${t.members.length} | ${t.batches.join(',')} | ${t.descs.join(' / ').slice(0, 90)} | ${samples.slice(0, 120)} |`);
}
writeFileSync('topics/inventory.md', lines.join('\n'));
writeFileSync('topics/merged-prenormalize.json', JSON.stringify({ merged, noise: [...noise], substantive: [...substantive].map(([idx, summary]) => ({ idx, summary })) }, null, 1));
console.log('\nwrote topics/inventory.md and topics/merged-prenormalize.json');
console.log('\ntop 40 topics:');
for (const t of merged.slice(0, 40)) console.log(`  ${String(t.members.length).padStart(4)}  ${t.name}`);
