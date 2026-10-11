// Merge + validate the per-batch topic clustering results.
//   node merge-topics.mjs          # validate coverage, print topic inventory
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const EXPECTED = 2446;
const files = existsSync('topics') ? readdirSync('topics').filter((f) => /^batch-\d+\.json$/.test(f)).sort() : [];
if (files.length === 0) {
  console.error('no topics/batch-*.json yet');
  process.exit(1);
}

const owner = new Map(); // idx -> {batch, topic}
const topics = [];
const problems = [];
const noiseSet = new Set();
const substantive = new Map();

for (const f of files) {
  let j;
  try {
    j = JSON.parse(readFileSync('topics/' + f, 'utf8'));
  } catch (e) {
    problems.push(`${f}: invalid JSON (${e.message})`);
    continue;
  }
  const batch = j.batch ?? Number(f.match(/\d+/)[0]);
  const seen = new Set();
  for (const t of j.topics ?? []) {
    topics.push({ batch, name: t.name, desc: t.desc ?? '', keywords: t.keywords ?? [], members: t.members ?? [] });
    for (const i of t.members ?? []) {
      if (owner.has(i)) problems.push(`${f}: idx ${i} in both "${owner.get(i).topic}" and "${t.name}"`);
      else owner.set(i, { batch, topic: t.name });
      if (seen.has(i)) problems.push(`${f}: idx ${i} duplicated inside batch`);
      seen.add(i);
    }
  }
  for (const i of j.noise ?? []) {
    if (owner.has(i)) problems.push(`${f}: idx ${i} both in topic and noise`);
    owner.set(i, { batch, topic: '(零散)' });
    noiseSet.add(i);
    seen.add(i);
  }
  for (const s of j.substantive ?? []) substantive.set(s.idx, s.summary);
}

const missing = [];
for (let i = 0; i < EXPECTED; i++) if (!owner.has(i)) missing.push(i);

console.log(`batches read: ${files.length}`);
console.log(`topics total: ${topics.length}`);
console.log(`classified idx: ${owner.size} / ${EXPECTED}; missing: ${missing.length}; noise: ${noiseSet.size}`);
console.log(`substantive summaries: ${substantive.size}`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems.slice(0, 40)) console.log('  ! ' + p);
} else console.log('no coverage problems ✔');
if (missing.length) console.log('first missing idx:', missing.slice(0, 30).join(','));

console.log('\n=== topic inventory (name / count / batch) ===');
for (const t of [...topics].sort((a, b) => b.members.length - a.members.length))
  console.log(`  ${String(t.members.length).padStart(4)}  ${t.name.padEnd(14)} b${t.batch}  ${t.desc.slice(0, 40)}`);

writeFileSync('topics/merged-raw.json', JSON.stringify({ topics, noise: [...noiseSet], substantive: [...substantive].map(([idx, summary]) => ({ idx, summary })) }, null, 1));
console.log('\nwrote topics/merged-raw.json');
