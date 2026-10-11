// 把新增会话的话题归属并入 final-topics.json，供 build-kb 重建话题页。
//
//   node apply-update-topics.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOPICS_DIR, UPDATE_TOPICS, CATALOG } from './_paths.mjs';

const final = JSON.parse(readFileSync(join(TOPICS_DIR, 'final-topics.json'), 'utf8'));
const upd = JSON.parse(readFileSync(UPDATE_TOPICS, 'utf8'));
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));

const byKey = new Map(final.topics.map((t) => [t.key, t]));
const validIdx = new Set(catalog.map((c) => c.idx));
const problems = [];
let applied = 0;
const perTopic = {};

for (const a of upd.assignments ?? []) {
  const t = byKey.get(a.topic);
  if (!t) {
    problems.push(`idx ${a.idx}: 未知话题 ${a.topic}`);
    continue;
  }
  if (!validIdx.has(a.idx)) {
    problems.push(`idx ${a.idx}: 不在 catalog 里`);
    continue;
  }
  if (!t.members.includes(a.idx)) {
    t.members.push(a.idx);
    t.members.sort((x, y) => x - y);
    applied++;
    perTopic[t.key] = (perTopic[t.key] ?? 0) + 1;
  }
}

// 一致性检查：所有 catalog 里的 idx 都必须属于某个话题
const owner = new Map();
for (const t of final.topics) for (const m of t.members) {
  if (owner.has(m)) problems.push(`idx ${m} 同时属于 ${owner.get(m)} 和 ${t.key}`);
  owner.set(m, t.key);
}
const missing = catalog.map((c) => c.idx).filter((i) => !owner.has(i));

console.log(`并入 ${applied} 条新归属`);
for (const [k, v] of Object.entries(perTopic).sort((a, b) => b[1] - a[1])) console.log(`  +${String(v).padStart(2)}  ${k}`);
console.log(`\n话题总数 ${final.topics.length}，覆盖 idx ${owner.size}/${catalog.length}`);
if (missing.length) console.log(`⚠️ 未归类 idx: ${missing.slice(0, 20).join(',')}`);
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems.slice(0, 20)) console.log('  ! ' + p);
} else console.log('无问题 ✔');

final.generatedAt = new Date().toISOString();
writeFileSync(join(TOPICS_DIR, 'final-topics.json'), JSON.stringify(final, null, 1), 'utf8');
console.log('wrote topics/final-topics.json');
