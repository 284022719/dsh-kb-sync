// Build the 专题 (specialist) layer: derive membership mechanically from the
// curated cluster list, write one page per 专题 into the knowledge base, and
// emit a topics.json-shaped file so the DSH session generator can consume it.
//
//   node build-specialties.mjs
//
// topics/specialties.json          curated {key,name,parent,desc,sources:[rawClusterName]}
// topics/merged-prenormalize.json  raw clusters (members)
// topics/final-topics.json         audited membership (the authority)
// -> <kb>/topics/<parent>/<key>/README.md
// -> <kb>/specialties.json         { cwd, topics:[{key,name,desc,parent,members,...}] }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TOPICS_DIR, KB_DIR } from './_paths.mjs';

const KB = resolve(process.argv[2] ?? KB_DIR);
const spec = JSON.parse(readFileSync(join(TOPICS_DIR, 'specialties.json'), 'utf8'));
const raw = JSON.parse(readFileSync(join(TOPICS_DIR, 'merged-prenormalize.json'), 'utf8'));
const final = JSON.parse(readFileSync(join(TOPICS_DIR, 'final-topics.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(KB, 'catalog.json'), 'utf8'));

const parentOf = new Map();
for (const t of final.topics) for (const i of t.members) parentOf.set(i, t.key);
const clusterByName = new Map(raw.merged.map((c) => [c.name, c]));
const parentByKey = new Map(final.topics.map((t) => [t.key, t]));

const problems = [];
const out = [];
for (const s of spec.specialties) {
  const parent = parentByKey.get(s.parent);
  if (!parent) {
    problems.push(`${s.key}: parent "${s.parent}" does not exist`);
    continue;
  }
  const members = new Set();
  for (const src of s.sources) {
    const c = clusterByName.get(src);
    if (!c) {
      problems.push(`${s.key}: source cluster "${src}" not found`);
      continue;
    }
    for (const i of c.members) if (parentOf.get(i) === parent.key) members.add(i);
  }
  const list = [...members].sort((a, b) => a - b);
  if (list.length === 0) {
    problems.push(`${s.key}: empty after intersecting with parent "${parent.key}"`);
    continue;
  }
  // page
  const dir = join(KB, 'topics', parent.key, s.key);
  mkdirSync(dir, { recursive: true });
  const rows = list
    .map((i) => catalog[i])
    .filter(Boolean)
    .sort((a, b) => String(a.inserted_at).localeCompare(String(b.inserted_at)));
  const chars = rows.reduce((a, c) => a + c.chars, 0);
  const turns = rows.reduce((a, c) => a + c.turns, 0);
  const L = [];
  L.push(`# ${s.name}`);
  L.push('');
  L.push(`> ${s.desc}`);
  L.push('');
  L.push(`- **所属一级话题**：[${parent.name}](../README.md)`);
  L.push(`- **会话数**：${rows.length}（占该一级话题 ${parent.members.length} 条的 ${((rows.length / parent.members.length) * 100).toFixed(0)}%）`);
  L.push(`- **时间跨度**：${String(rows[0]?.inserted_at).slice(0, 10)} → ${String(rows[rows.length - 1]?.inserted_at).slice(0, 10)}`);
  L.push(`- **规模**：${chars.toLocaleString('en-US')} 字符，约 ${turns} 轮对话`);
  L.push('');
  L.push('## 会话清单');
  L.push('');
  L.push('| # | 日期 | 消息 | 标题 | 文件 |');
  L.push('|---|------|------|------|------|');
  rows.forEach((c, n) => L.push(`| ${n + 1} | ${String(c.inserted_at).slice(0, 10)} | ${c.messages} | ${String(c.title || '(无标题)').replace(/\|/g, '\\|')} | [\`${c.path}\`](../../../${c.path}) |`));
  L.push('');
  writeFileSync(join(dir, 'README.md'), L.join('\n'), 'utf8');

  out.push({
    key: s.key,
    name: s.name,
    desc: s.desc,
    parent: parent.key,
    parentName: parent.name,
    count: rows.length,
    chars,
    turns,
    from: String(rows[0]?.inserted_at).slice(0, 10),
    to: String(rows[rows.length - 1]?.inserted_at).slice(0, 10),
    session: true,
    members: list,
  });
}

if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log('  ! ' + p);
} else console.log('no problems ✔');

console.log(`\n专题 ${out.length} 个：`);
for (const t of out.sort((a, b) => b.chars - a.chars))
  console.log(`  ${String(t.count).padStart(3)} 会话 ${String(Math.round(t.chars / 1000)).padStart(5)}k字  ${t.key}  ∈ ${t.parentName}`);

const totalMembers = new Set(out.flatMap((t) => t.members)).size;
console.log(`\n专题覆盖的会话（去重）：${totalMembers} / ${catalog.length}`);

writeFileSync(join(KB, 'specialties.json'), JSON.stringify({ generatedAt: new Date().toISOString(), topics: out }, null, 1));
console.log(`wrote ${join(KB, 'specialties.json')}`);
