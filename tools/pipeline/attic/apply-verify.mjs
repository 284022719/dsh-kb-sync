// Merge the verification pass results into a single correction table.
//
//   node apply-verify.mjs            # report + write topics/corrections.json
//   node apply-verify.mjs --check    # report only
//
// Input : verify/out-NN.json   (per-batch audit: {batch, checked, moves:[{idx,from,to,why}]})
//         topics/corrections-manual.json  (hand-applied corrections; take precedence)
//         topics/final-topics.json        (current assignment, for `from` validation)
// Output: topics/corrections.json  [{idx, to_key, from, reason}]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const CHECK_ONLY = process.argv.includes('--check');
const final = JSON.parse(readFileSync('topics/final-topics.json', 'utf8'));
const VALID = new Set(final.topics.map((t) => t.key));
const current = new Map();
for (const t of final.topics) for (const i of t.members) current.set(i, t.key);

// The taxonomy was renumbered AFTER the audit worklists were generated (topics
// reordered by size), so an auditor's "02-历史文化" may now be "03-历史文化".
// Resolve every key by its NAME — the numeric prefix is presentation only.
const nameOf = (key) => String(key).replace(/^\d+-/, '').trim();
const nameToKey = new Map(final.topics.map((t) => [nameOf(t.key), t.key]));
const resolveKey = (key) => {
  if (VALID.has(key)) return key;
  return nameToKey.get(nameOf(key)) ?? null;
};

const files = existsSync('verify') ? readdirSync('verify').filter((f) => /^out-\d+\.json$/.test(f)).sort() : [];
if (!files.length) {
  console.error('no verify/out-*.json yet');
  process.exit(1);
}

const problems = [];
const moves = new Map(); // idx -> {to, why, src}
let checked = 0;
const perBatch = [];

for (const f of files) {
  let j;
  try {
    j = JSON.parse(readFileSync('verify/' + f, 'utf8'));
  } catch (e) {
    problems.push(`${f}: invalid JSON (${e.message})`);
    continue;
  }
  checked += j.checked ?? 0;
  let n = 0;
  for (const m of j.moves ?? []) {
    const to = resolveKey(m.to);
    if (!to) {
      problems.push(`${f}: idx ${m.idx} target "${m.to}" does not match any topic by name`);
      continue;
    }
    const cur = current.get(m.idx);
    if (cur === undefined) {
      problems.push(`${f}: idx ${m.idx} is not in any topic`);
      continue;
    }
    if (cur === to) continue; // already correct (another batch fixed it / no-op)
    if (m.from && resolveKey(m.from) !== cur)
      problems.push(`${f}: idx ${m.idx} claims from "${m.from}" but is currently "${cur}" (applying anyway)`);
    if (moves.has(m.idx)) {
      const prev = moves.get(m.idx);
      if (prev.to !== to) problems.push(`${f}: idx ${m.idx} conflicting moves -> "${prev.to}" (${prev.src}) vs "${to}" (${f})`);
      continue;
    }
    moves.set(m.idx, { to, why: m.why ?? '', src: f });
    n++;
  }
  perBatch.push({ file: f, checked: j.checked ?? 0, moves: n });
}

const manual = existsSync('topics/corrections-manual.json') ? JSON.parse(readFileSync('topics/corrections-manual.json', 'utf8')) : [];

console.log(`batches: ${files.length}   rows audited: ${checked}`);
for (const b of perBatch) console.log(`  ${b.file}  checked=${b.checked}  moves=${b.moves}  (${((b.moves / (b.checked || 1)) * 100).toFixed(1)}%)`);
console.log(`\ntotal verified moves: ${moves.size}  (${((moves.size / (checked || 1)) * 100).toFixed(1)}% of audited rows)`);
console.log(`manual corrections: ${manual.length}`);

const byPair = {};
for (const [, m] of moves) {
  const k = `${current.get([...moves.entries()].find(([, v]) => v === m)?.[0])}`; // not used; kept simple below
}
const pairCount = {};
for (const [idx, m] of moves) {
  const k = `${current.get(idx)}  ->  ${m.to}`;
  pairCount[k] = (pairCount[k] ?? 0) + 1;
}
console.log('\ntop 20 move pairs:');
for (const [k, v] of Object.entries(pairCount).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(v).padStart(3)}  ${k}`);

if (problems.length) {
  console.log('\nPROBLEMS / notes:');
  for (const p of problems.slice(0, 40)) console.log('  ! ' + p);
} else console.log('\nno problems ✔');

// merged table: manual first (precedence), then verified moves that don't collide
const merged = new Map();
for (const c of manual) merged.set(c.idx, { idx: c.idx, to_key: c.to_key, from: c.from ?? '', reason: `[手工] ${c.reason ?? ''}` });
let applied = 0;
for (const [idx, m] of moves) {
  if (merged.has(idx)) continue;
  merged.set(idx, { idx, to_key: m.to, from: current.get(idx) ?? '', reason: `[复核 ${m.src}] ${m.why}` });
  applied++;
}
console.log(`\nmerged corrections: ${merged.size}  (from verification: ${applied}, manual kept: ${merged.size - applied})`);

if (!CHECK_ONLY) {
  writeFileSync('topics/corrections.json', JSON.stringify([...merged.values()], null, 1));
  console.log('wrote topics/corrections.json');
}
