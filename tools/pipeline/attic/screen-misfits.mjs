// Deterministic misfit screen: for every conversation, compare its content
// vector against every final-topic centroid and flag the ones whose ASSIGNED
// topic is not the best match. Output is a review worklist, not a rewrite.
//
//   node screen-misfits.mjs            # writes topics/misfit-worklist.json + .md
import { readFileSync, writeFileSync } from 'node:fs';

const final = JSON.parse(readFileSync('topics/final-topics.json', 'utf8'));
const recs = readFileSync('knowledge/conversations.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const catalog = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));

const STOP = new Set(['什么', '怎么', '为什么', '可以', '是不是', '有没有', '意思', '一下', '帮我', '请问', '知道', '这个', '那个', '我们', '他们', '自己', '需要', '应该', '一个', '没有', '就是', '还是', '但是', '因为', '所以', '如果', '然后', '以及', '或者', '并且']);

/** Terms: chinese bigrams + latin/number tokens, lowercase. */
function terms(text) {
  const out = [];
  const clean = String(text).replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, ' ');
  for (const seg of clean.split(' ')) {
    if (!seg) continue;
    if (/^[A-Za-z0-9]+$/.test(seg)) {
      if (seg.length >= 3 && seg.length <= 24) out.push(seg.toLowerCase());
      continue;
    }
    for (let i = 0; i + 2 <= seg.length; i++) {
      const g = seg.slice(i, i + 2);
      if (!STOP.has(g)) out.push(g);
    }
  }
  return out;
}

// document = title (weight 3) + first user message (weight 3) + first 1500 chars of body
function docTerms(rec, title) {
  const first = rec.messages.find((m) => m.role === 'user')?.text ?? '';
  const body = rec.messages
    .map((m) => m.text)
    .join('\n')
    .slice(0, 1500);
  const t = [...terms(title), ...terms(title), ...terms(title), ...terms(first), ...terms(first), ...terms(first), ...terms(body)];
  const tf = new Map();
  for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
  return tf;
}

const docs = recs.map((r, i) => docTerms(r, catalog[i]?.title ?? ''));

// document frequency
const df = new Map();
for (const tf of docs) for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
const N = docs.length;
const idf = (w) => Math.log(1 + N / (1 + (df.get(w) ?? 0)));

function vec(tf) {
  const v = new Map();
  let norm = 0;
  for (const [w, c] of tf) {
    const x = (1 + Math.log(c)) * idf(w);
    v.set(w, x);
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [w, x] of v) v.set(w, x / norm);
  return v;
}
const docVecs = docs.map(vec);

// topic centroids
const topics = final.topics;
const cent = topics.map((t) => {
  const acc = new Map();
  for (const i of t.members) for (const [w, x] of docVecs[i]) acc.set(w, (acc.get(w) ?? 0) + x);
  let norm = 0;
  for (const x of acc.values()) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (const [w, x] of acc) acc.set(w, x / norm);
  return acc;
});

const owner = new Map();
topics.forEach((t, ti) => t.members.forEach((i) => owner.set(i, ti)));

const cos = (a, b) => {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [w, x] of small) {
    const y = big.get(w);
    if (y) s += x * y;
  }
  return s;
};

const flagged = [];
for (const [i, ti] of owner) {
  const scores = cent.map((c) => cos(docVecs[i], c));
  const assigned = scores[ti];
  let best = ti,
    bestScore = assigned;
  for (let k = 0; k < scores.length; k++)
    if (scores[k] > bestScore) {
      best = k;
      bestScore = scores[k];
    }
  const gap = bestScore - assigned;
  if (best !== ti && gap > 0.05) {
    flagged.push({
      idx: i,
      title: catalog[i]?.title ?? '',
      assigned: topics[ti].name,
      assignedScore: Number(assigned.toFixed(4)),
      suggested: topics[best].name,
      suggestedScore: Number(bestScore.toFixed(4)),
      gap: Number(gap.toFixed(4)),
      signals: [...docVecs[i].keys()].slice(0, 12).join(','),
      file: catalog[i]?.path ?? '',
      ratio: catalog[i]?.messages ?? 0,
      date: catalog[i]?.date ?? '',
    });
  }
}
flagged.sort((a, b) => b.gap - a.gap);

console.log(`conversations: ${owner.size} (noise ${final.noise.length} excluded)`);
console.log(`flagged (assigned topic is not the closest): ${flagged.length}  (${((flagged.length / owner.size) * 100).toFixed(1)}%)`);
console.log(`  gap > 0.15: ${flagged.filter((f) => f.gap > 0.15).length}`);
console.log(`  gap > 0.25: ${flagged.filter((f) => f.gap > 0.25).length}`);
const pairs = {};
for (const f of flagged) {
  const k = `${f.assigned} -> ${f.suggested}`;
  pairs[k] = (pairs[k] ?? 0) + 1;
}
console.log('\ntop confusion pairs:');
for (const [k, v] of Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(v).padStart(3)}  ${k}`);

console.log('\n=== 40 most suspicious ===');
for (const f of flagged.slice(0, 40))
  console.log(`  idx ${String(f.idx).padStart(4)} [${f.gap.toFixed(2)}] 「${f.title}」 归入「${f.assigned}」但更像「${f.suggested}」`);

writeFileSync('topics/misfit-worklist.json', JSON.stringify(flagged, null, 1));
writeFileSync(
  'topics/misfit-worklist.md',
  ['# 归属可疑会话清单', '', `共 ${flagged.length} 条（占已归类 ${owner.size} 条的 ${((flagged.length / owner.size) * 100).toFixed(1)}%）`, '', '| idx | 差距 | 标题 | 当前话题 | 更像 | 文件 |', '|-----|------|------|----------|------|------|',
    ...flagged.map((f) => `| ${f.idx} | ${f.gap.toFixed(2)} | ${f.title.replace(/\|/g, '\\|')} | ${f.assigned} | ${f.suggested} | \`${f.file}\` |`)].join('\n'),
);
console.log('\nwrote topics/misfit-worklist.json / .md');
