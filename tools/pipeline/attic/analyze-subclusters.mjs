// Enumerate candidate "专题" (specialist sub-topics) inside each final topic.
//
// A candidate is a fine-grained cluster from the batch-clustering stage whose
// members mostly SURVIVED the full audit inside one final topic. Membership is
// therefore derived mechanically (intersection), never re-authored by an LLM —
// the only judgement left to a model is which candidates to keep and how to name
// them.
//
//   node analyze-subclusters.mjs [minSize=10]
import { readFileSync, writeFileSync } from 'node:fs';

const MIN = Number(process.argv[2] ?? 10);
const final = JSON.parse(readFileSync('topics/final-topics.json', 'utf8'));
const raw = JSON.parse(readFileSync('topics/merged-prenormalize.json', 'utf8'));
const catalog = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));

const parentOf = new Map();
for (const t of final.topics) for (const i of t.members) parentOf.set(i, t.key);
const parentByKey = new Map(final.topics.map((t) => [t.key, t]));

const rows = [];
for (const t of final.topics) {
  if (t.key.startsWith('99')) continue;
  // fine-grained clusters whose kept members land inside this topic
  const cands = [];
  for (const c of raw.merged) {
    const kept = c.members.filter((i) => parentOf.get(i) === t.key);
    if (kept.length < MIN) continue;
    const chars = kept.reduce((a, i) => a + (catalog[i]?.chars ?? 0), 0);
    const samples = kept
      .slice()
      .sort((a, b) => (catalog[b]?.chars ?? 0) - (catalog[a]?.chars ?? 0))
      .slice(0, 4)
      .map((i) => catalog[i]?.title ?? '?');
    cands.push({
      name: c.name,
      desc: c.descs[0] ?? '',
      kept: kept.length,
      rawSize: c.members.length,
      survival: kept.length / c.members.length,
      chars,
      samples,
      members: kept,
    });
  }
  cands.sort((a, b) => b.kept - a.kept);
  // a 专题 must be genuinely narrower than its parent topic
  const narrower = cands.filter((c) => c.kept <= Math.max(MIN, Math.floor(t.members.length * 0.75)));
  rows.push({ parent: t.key, parentName: t.name, parentSize: t.members.length, candidates: narrower });
}

let total = 0;
const lines = ['# 各一级话题内部的候选专题（成员已按复核结果取交集）', ''];
for (const r of rows) {
  if (!r.candidates.length) continue;
  total += r.candidates.length;
  lines.push(`## ${r.parent}　${r.parentName}（一级共 ${r.parentSize} 个会话）`);
  lines.push('');
  lines.push('| 候选专题 | 有效成员 | 原始簇 | 留存率 | 规模 | 代表会话 |');
  lines.push('|----------|----------|--------|--------|------|----------|');
  for (const c of r.candidates)
    lines.push(`| ${c.name} | ${c.kept} | ${c.rawSize} | ${(c.survival * 100).toFixed(0)}% | ${Math.round(c.chars / 1000)}k字 | ${c.samples.join('；').slice(0, 110)} |`);
  lines.push('');
}
writeFileSync('topics/subcluster-candidates.md', lines.join('\n'));
writeFileSync('topics/subcluster-candidates.json', JSON.stringify(rows, null, 1));

console.log(`topics with candidates: ${rows.filter((r) => r.candidates.length).length}`);
console.log(`total candidates (kept >= ${MIN}): ${total}`);
for (const r of rows) {
  if (!r.candidates.length) continue;
  console.log(`\n${r.parent}（${r.parentSize}）`);
  for (const c of r.candidates.slice(0, 8)) console.log(`   ${String(c.kept).padStart(3)}/${String(c.rawSize).padStart(3)}  ${c.name}   〔${c.chars} 字〕`);
}
console.log('\nwrote topics/subcluster-candidates.md / .json');
