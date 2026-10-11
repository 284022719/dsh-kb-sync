// Expand the LLM-designed taxonomy into final topic membership.
//
//   node expand-taxonomy.mjs
//
// Inputs:
//   topics/taxonomy.json             { topics:[{key,name,desc,subtopics,sources:[rawName]}], extra:[{idx,topic_key}], notes }
//   topics/merged-prenormalize.json  raw cluster name -> members
//   topics/corrections.json          [{idx,to_key,from,reason}]  (manual + verification audit)
//   knowledge/catalog.json           idx -> metadata
// Output:
//   topics/final-topics.json         { topics:[{key,name,desc,subtopics,members,session}], noise, notes }
//
// Ordering matters: the noise bucket (99-零散杂问) is materialised BEFORE
// corrections are applied, because the audit moves conversations BOTH out of it
// (mis-bucketed short chats) and into it (genuinely topicless ones).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const tax = JSON.parse(readFileSync('topics/taxonomy.json', 'utf8'));
const raw = JSON.parse(readFileSync('topics/merged-prenormalize.json', 'utf8'));
const catalog = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));

const byName = new Map(raw.merged.map((t) => [t.name, t]));
const problems = [];
const usedSource = new Map();

const topics = tax.topics.map((t) => {
  const members = new Set();
  for (const s of t.sources ?? []) {
    const r = byName.get(s);
    if (!r) {
      problems.push(`topic "${t.name}": source "${s}" does not exist in the merged inventory`);
      continue;
    }
    if (usedSource.has(s)) problems.push(`source "${s}" used by both "${usedSource.get(s)}" and "${t.name}"`);
    usedSource.set(s, t.name);
    for (const m of r.members) members.add(m);
  }
  return { key: t.key, name: t.name, desc: t.desc ?? '', subtopics: t.subtopics ?? [], members: [...members].sort((a, b) => a - b) };
});

const unclaimed = raw.merged.map((t) => t.name).filter((n) => !usedSource.has(n));
if (unclaimed.length) problems.push(`unclaimed raw topics (${unclaimed.length}): ${unclaimed.slice(0, 25).join('、')}`);

// --- extra assignments (conversations no batch classified) ---
const keyToTopic = () => new Map(topics.map((t) => [t.key, t]));
for (const e of tax.extra ?? []) {
  const t = keyToTopic().get(e.topic_key);
  if (!t) {
    problems.push(`extra idx ${e.idx}: unknown topic_key "${e.topic_key}"`);
    continue;
  }
  if (!t.members.includes(e.idx)) t.members.push(e.idx);
}

// --- owner map + the noise bucket, BEFORE corrections ---
function buildOwner() {
  const owner = new Map();
  for (const t of topics)
    for (const m of t.members) {
      if (owner.has(m)) problems.push(`idx ${m} in both "${owner.get(m)}" and "${t.name}"`);
      else owner.set(m, t.name);
    }
  return owner;
}
const noiseKey = '99-零散杂问';
const noiseMembers = raw.noise.filter((i) => !buildOwner().has(i));
topics.push({
  key: noiseKey,
  name: '零散杂问',
  desc: '无法归入任何话题的零散提问：单轮常识问答、名词查询、临时闲聊与模型未作答的记录',
  subtopics: [
    { name: '名词与概念查询', desc: '「XX 是什么意思」这类单句查询' },
    { name: '零散计算与常识', desc: '一次性换算、天气、时间等即时问题' },
  ],
  members: [...noiseMembers].sort((a, b) => a - b),
  session: false,
});

// --- corrections: the audit's re-judgements win over the batch clustering ---
let corrections = [];
if (existsSync('topics/corrections.json')) {
  corrections = JSON.parse(readFileSync('topics/corrections.json', 'utf8'));
  const byKey = keyToTopic();
  for (const c of corrections) {
    const to = byKey.get(c.to_key);
    if (!to) {
      problems.push(`correction idx ${c.idx}: unknown to_key "${c.to_key}"`);
      continue;
    }
    for (const t of topics) t.members = t.members.filter((m) => m !== c.idx);
    if (!to.members.includes(c.idx)) to.members.push(c.idx);
  }
  for (const t of topics) t.members.sort((a, b) => a - b);
  console.log(`applied ${corrections.length} corrections (manual + audited)`);
}

const owner = buildOwner();
const noise = topics.find((t) => t.key === noiseKey).members;
const missing = [];
for (let i = 0; i < catalog.length; i++) if (!owner.has(i)) missing.push(i);

console.log(`topics: ${topics.length} (incl. ${noiseKey})`);
console.log(`raw clusters consumed: ${usedSource.size} / ${raw.merged.length}`);
console.log(`classified: ${owner.size}  noise bucket: ${noise.length}  missing: ${missing.length}  total: ${catalog.length}`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems.slice(0, 30)) console.log('  ! ' + p);
  console.log(`  (${problems.length} total)`);
} else console.log('no problems ✔');

console.log('\n=== final topics ===');
for (const t of [...topics].sort((a, b) => b.members.length - a.members.length)) {
  const chars = t.members.reduce((a, i) => a + (catalog[i]?.chars ?? 0), 0);
  const dates = t.members.map((i) => catalog[i]?.date ?? '').sort();
  console.log(
    `  ${String(t.members.length).padStart(4)} 会话  ${String(chars).padStart(9)} 字  ${dates[0]}~${dates[dates.length - 1]}  ${t.key}${t.session === false ? '  [不建会话]' : ''}`,
  );
}
if (missing.length) console.log('\nmissing idx:', missing.slice(0, 40).join(','));

writeFileSync(
  'topics/final-topics.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), notes: tax.notes ?? '', topics, noise }, null, 1),
);
console.log('\nwrote topics/final-topics.json');
