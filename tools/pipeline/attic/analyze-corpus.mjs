// Corpus statistics to ground topic clustering: activity over time, keyword
// frequency across titles and first user requests, size distribution.
import { readFileSync, writeFileSync } from 'node:fs';

const recs = readFileSync('knowledge/conversations.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

console.log('conversations:', recs.length);

const firstReq = (r) => (r.messages.find((m) => m.role === 'user')?.text ?? '').replace(/\s+/g, ' ');

// ---- activity over time ----
const months = {};
for (const r of recs) {
  const m = String(r.inserted_at ?? '').slice(0, 7);
  months[m] = (months[m] ?? 0) + 1;
}
console.log('\n=== conversations started per month ===');
for (const [m, n] of Object.entries(months).sort()) console.log(`  ${m}  ${'#'.repeat(Math.ceil(n / 4))} ${n}`);

// ---- size distribution ----
const sizes = recs.map((r) => ({ t: r.title, c: r.messages.length, chars: r.messages.reduce((a, m) => a + m.text.length + m.thinking.length, 0) }));
const buckets = { '1 msg': 0, '2-4': 0, '5-10': 0, '11-30': 0, '31-100': 0, '100+': 0 };
for (const s of sizes) {
  const n = s.c;
  if (n <= 1) buckets['1 msg']++;
  else if (n <= 4) buckets['2-4']++;
  else if (n <= 10) buckets['5-10']++;
  else if (n <= 30) buckets['11-30']++;
  else if (n <= 100) buckets['31-100']++;
  else buckets['100+']++;
}
console.log('\n=== message-count distribution ===');
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(7)} ${v}`);

console.log('\n=== 30 largest conversations ===');
for (const s of [...sizes].sort((a, b) => b.chars - a.chars).slice(0, 30))
  console.log(`  ${String(s.c).padStart(4)} msgs ${String(Math.round(s.chars / 1000)).padStart(5)}k chars  ${s.t}`);

// ---- keyword frequency ----
const STOP = new Set(['什么','怎么','为什么','如何','可以','是否','有没有','哪些','哪个','这个','那个','我们','他们','现在','已经','需要','应该','一个','没有','不是','就是','还是','但是','因为','所以','如果','然后','以及','或者','并且','这些','那些','时候','问题','一下','帮我','请问','请问一下','知道','了解','介绍','推荐','看看','告诉','说一','说明']);
function grams(text, n) {
  const clean = text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ' ');
  const out = {};
  for (const seg of clean.split(/\s+/)) {
    if (/^[A-Za-z0-9]+$/.test(seg)) {
      if (seg.length >= 2 && seg.length <= 20) out[seg.toLowerCase()] = (out[seg.toLowerCase()] ?? 0) + 1;
      continue;
    }
    for (let i = 0; i + n <= seg.length; i++) {
      const g = seg.slice(i, i + n);
      out[g] = (out[g] ?? 0) + 1;
    }
  }
  return out;
}
function topGrams(texts, n, minCount) {
  const total = {};
  for (const t of texts) for (const [g, c] of Object.entries(grams(t, n))) total[g] = (total[g] ?? 0) + c;
  return Object.entries(total)
    .filter(([g, c]) => c >= minCount && !STOP.has(g))
    .sort((a, b) => b[1] - a[1]);
}

const titles = recs.map((r) => r.title ?? '');
const reqs = recs.map((r) => firstReq(r).slice(0, 200));
const corpus = [...titles, ...titles, ...reqs]; // titles weighted 2x

for (const n of [2, 3]) {
  console.log(`\n=== top ${n}-grams (titles 2x weight + first request) ===`);
  const rows = topGrams(corpus, n, n === 2 ? 12 : 8).slice(0, 90);
  console.log(rows.map(([g, c]) => `${g}:${c}`).join('  '));
}

writeFileSync(
  'analysis-keywords.json',
  JSON.stringify({ months, buckets, top2: topGrams(corpus, 2, 12).slice(0, 400), top3: topGrams(corpus, 3, 8).slice(0, 400) }, null, 1),
);

// ---- clustering input for LLM passes: compact one line per conversation ----
const lines = recs.map(
  (r, i) => `${i}\t${String(r.inserted_at).slice(0, 10)}\t${r.messages.length}\t${(r.title ?? '').replace(/[\t\r\n]/g, ' ')}\t${firstReq(r).slice(0, 90).replace(/[\t\r\n]/g, ' ')}`,
);
writeFileSync('analysis-index.tsv', ['idx\tdate\tmsgs\ttitle\tfirst_request', ...lines].join('\n'));
console.log(`\nwrote analysis-index.tsv (${lines.length} rows), analysis-keywords.json`);
