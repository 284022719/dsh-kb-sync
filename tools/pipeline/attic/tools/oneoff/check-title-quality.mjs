// Data-quality check: do exported session titles actually describe their conversation?
// For each conversation, measure how much of the title's character bigrams appear
// in the conversation body. A title with ~zero overlap is a source-side mismatch.
import { readFileSync, writeFileSync } from 'node:fs';

const recs = readFileSync('knowledge/conversations.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const catalog = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));

const bigrams = (s) => {
  const clean = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i + 2 <= clean.length; i++) out.add(clean.slice(i, i + 2));
  if (clean.length === 1) out.add(clean);
  // latin words
  for (const w of s.match(/[A-Za-z][A-Za-z0-9]{2,}/g) ?? []) out.add(w.toLowerCase());
  return out;
};

const rows = [];
for (let i = 0; i < recs.length; i++) {
  const r = recs[i];
  const title = String(r.title ?? '');
  if (!title.trim()) continue;
  const body = r.messages.map((m) => m.text + '\n' + m.thinking).join('\n');
  const bodyLower = body.toLowerCase();
  const grams = [...bigrams(title)];
  if (grams.length === 0) continue;
  let hit = 0;
  for (const g of grams) if (bodyLower.includes(g.toLowerCase())) hit++;
  const ratio = hit / grams.length;
  rows.push({
    idx: i,
    title,
    ratio,
    grams: grams.length,
    msgs: r.messages.length,
    chars: catalog[i]?.chars ?? 0,
    first: (r.messages.find((m) => m.role === 'user')?.text ?? '').replace(/\s+/g, ' ').slice(0, 60),
    file: r.file,
  });
}

rows.sort((a, b) => a.ratio - b.ratio);
const buckets = { '0.00-0.20': 0, '0.20-0.40': 0, '0.40-0.60': 0, '0.60-0.80': 0, '0.80-1.00': 0 };
for (const r of rows) {
  if (r.ratio < 0.2) buckets['0.00-0.20']++;
  else if (r.ratio < 0.4) buckets['0.20-0.40']++;
  else if (r.ratio < 0.6) buckets['0.40-0.60']++;
  else if (r.ratio < 0.8) buckets['0.60-0.80']++;
  else buckets['0.80-1.00']++;
}
console.log(`checked: ${rows.length} titled conversations`);
console.log('title-bigram presence in body:');
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}  ${String(v).padStart(5)}  ${((v / rows.length) * 100).toFixed(1)}%`);

const low = rows.filter((r) => r.ratio < 0.2);
console.log(`\nlikely mismatched titles (ratio < 0.2): ${low.length}`);
console.log('\n=== 40 worst (title vs body overlap 0) ===');
for (const r of low.slice(0, 40))
  console.log(`  idx ${String(r.idx).padStart(4)} ratio=${r.ratio.toFixed(2)} msgs=${String(r.msgs).padStart(3)} 标题「${r.title}」 首问「${r.first}」`);

writeFileSync('analysis-title-quality.json', JSON.stringify({ buckets, low: low.slice(0, 400) }, null, 1));
console.log('\nwrote analysis-title-quality.json');
