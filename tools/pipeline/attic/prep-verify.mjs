// Build verification worklists: one compact TSV per batch with the evidence a
// human/LLM needs to re-judge a conversation's topic WITHOUT opening 245 files.
//
//   node prep-verify.mjs [batchSize=245]
//
// verify/in-NN.tsv columns:
//   idx | assigned topic key | msgs | title | first user message (160) | first answer (160)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const SIZE = Number(process.argv[2] ?? 245);
const final = JSON.parse(readFileSync('topics/final-topics.json', 'utf8'));
const recs = readFileSync('knowledge/conversations.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const catalog = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));

const assigned = new Map();
for (const t of final.topics) for (const i of t.members) assigned.set(i, t.key);

const clean = (s, n) =>
  String(s ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

const rows = [];
for (let i = 0; i < recs.length; i++) {
  const r = recs[i];
  const first = r.messages.find((m) => m.role === 'user')?.text ?? '';
  const answer = r.messages.find((m) => m.role === 'assistant' && m.text)?.text ?? '';
  rows.push([i, assigned.get(i) ?? '?', catalog[i]?.messages ?? 0, clean(r.title, 40), clean(first, 160), clean(answer, 160)].join('\t'));
}

if (existsSync('verify')) rmSync('verify', { recursive: true, force: true });
mkdirSync('verify', { recursive: true });
const header = 'idx\tassigned\tmsgs\ttitle\tfirst_user_message\tfirst_answer';
const n = Math.ceil(rows.length / SIZE);
for (let b = 0; b < n; b++) {
  const slice = rows.slice(b * SIZE, (b + 1) * SIZE);
  if (!slice.length) continue;
  writeFileSync(`verify/in-${String(b + 1).padStart(2, '0')}.tsv`, [header, ...slice].join('\n'));
  console.log(`verify/in-${String(b + 1).padStart(2, '0')}.tsv  rows ${b * SIZE}..${b * SIZE + slice.length - 1}  (${slice.length})`);
}

const keyList = final.topics.map((t) => `${t.key}\t${t.desc}`).join('\n');
writeFileSync('verify/topic-keys.tsv', 'key\tdesc\n' + keyList);
console.log(`\nwrote ${n} worklists + verify/topic-keys.tsv (${final.topics.length} topics)`);
