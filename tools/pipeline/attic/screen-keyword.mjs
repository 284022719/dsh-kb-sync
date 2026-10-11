// Screen 2: containment-based misfit detection, tuned for SHORT conversations.
//
// Cosine on TF-IDF vectors punishes short docs (few terms -> small norm), so the
// earlier screen missed misfiled one-liners. Containment asks a different
// question: "of this conversation's DISTINCTIVE terms, what fraction appears in
// each topic's term profile?" A 3-message chat about INTP shares far more with
// the psychology topic than with the pet topic, and containment shows that.
//
//   node screen-keyword.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const final = JSON.parse(readFileSync('topics/final-topics.json', 'utf8'));
const recs = readFileSync('knowledge/conversations.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const catalog = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));

const STOP = new Set(['什么', '怎么', '为什么', '可以', '是不是', '有没有', '意思', '一下', '帮我', '请问', '知道', '这个', '那个', '我们', '他们', '自己', '需要', '应该', '一个', '没有', '就是', '还是', '但是', '因为', '所以', '如果', '然后', '以及', '或者', '并且', '现在', '已经', '多少', '哪个', '哪些', '时候', '问题', '解释', '介绍', '区别', '总结', '分析', '方法', '什么意', '么意思']);

function terms(text) {
  const out = [];
  for (const seg of String(text).replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, ' ').split(' ')) {
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

// document-frequency over the whole corpus (title + first request only, the
// fields that actually drive topical identity for short chats)
const focus = recs.map((r, i) => {
  const first = r.messages.find((m) => m.role === 'user')?.text ?? '';
  const body = r.messages.map((m) => m.text).join(' ').slice(0, 1200);
  return { title: catalog[i]?.title ?? '', first, body };
});
const df = new Map();
for (const f of focus) {
  const set = new Set(terms(`${f.title} ${f.title} ${f.first} ${f.body}`));
  for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
}
const N = focus.length;
const idf = (t) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));
const COMMON = 4.0; // terms appearing in >~5% of the corpus are not distinctive

// topic term profiles: distinctive terms of members (title+first+body), weighted by frequency
const profiles = final.topics.map((t) => {
  const prof = new Map();
  for (const i of t.members) {
    const f = focus[i];
    const tf = new Map();
    for (const w of [...terms(f.title), ...terms(f.title), ...terms(f.first), ...terms(f.first), ...terms(f.body)]) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const [w, c] of tf) prof.set(w, (prof.get(w) ?? 0) + (1 + Math.log(c)));
  }
  // keep only the most characteristic terms, scaled by size so big topics don't dominate
  const entries = [...prof.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(120, Math.min(600, t.members.length * 12)));
  return new Map(entries);
});

const owner = new Map();
final.topics.forEach((t, ti) => t.members.forEach((i) => owner.set(i, ti)));

const scored = [];
for (const [i, ti] of owner) {
  if (final.topics[ti].key.startsWith('99')) continue; // 零散杂问 is legitimately heterogeneous
  const f = focus[i];
  const docTerms = [...new Set([...terms(f.title), ...terms(f.title), ...terms(f.first), ...terms(f.first)])].filter((w) => idf(w) > COMMON);
  if (docTerms.length === 0) continue;
  const contain = profiles.map((p) => {
    let hit = 0;
    for (const w of docTerms) if (p.has(w)) hit += 1;
    return hit / docTerms.length;
  });
  const assigned = contain[ti];
  let best = ti,
    bestScore = assigned;
  for (let k = 0; k < contain.length; k++)
    if (contain[k] > bestScore) {
      best = k;
      bestScore = contain[k];
    }
  scored.push({
    idx: i,
    title: f.title,
    first: f.first.slice(0, 42),
    assigned: final.topics[ti].name,
    assignedKey: final.topics[ti].key,
    assignedScore: Number(assigned.toFixed(2)),
    suggested: final.topics[best].name,
    suggestedKey: final.topics[best].key,
    suggestedScore: Number(bestScore.toFixed(2)),
    gap: Number((bestScore - assigned).toFixed(2)),
    terms: docTerms.slice(0, 10).join(' '),
    msgs: catalog[i]?.messages ?? 0,
    file: catalog[i]?.path ?? '',
  });
}

const flagged = scored.filter((s) => s.gap >= 0.2 && s.suggestedScore >= 0.4);
flagged.sort((a, b) => b.gap - a.gap || b.suggestedScore - a.suggestedScore);
console.log(`scored: ${scored.length} (noise bucket excluded)`);
console.log(`flagged: ${flagged.length}  (${((flagged.length / scored.length) * 100).toFixed(1)}%)`);

const pairs = {};
for (const f of flagged) pairs[`${f.assigned} -> ${f.suggested}`] = (pairs[`${f.assigned} -> ${f.suggested}`] ?? 0) + 1;
console.log('\ntop confusion pairs:');
for (const [k, v] of Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(v).padStart(3)}  ${k}`);

console.log('\n=== 宠物园艺与自然 members flagged ===');
for (const f of flagged.filter((x) => x.assignedKey.startsWith('19'))) console.log(`  [${f.gap}] 「${f.title}」 -> ${f.suggested} (terms: ${f.terms})`);

console.log('\n=== 30 most confident misfits ===');
for (const f of flagged.slice(0, 30)) console.log(`  idx ${String(f.idx).padStart(4)} [${f.gap}] msgs=${String(f.msgs).padStart(3)} 「${f.title}」 归「${f.assigned}」-> 疑「${f.suggested}」 (${f.terms.slice(0, 40)})`);

writeFileSync('topics/misfit-keyword.json', JSON.stringify(flagged, null, 1));
writeFileSync(
  'topics/misfit-keyword.md',
  ['# 归属可疑清单（包含度筛查）', '', `共 ${flagged.length} 条 / 已归类 ${scored.length} 条`, '', '| idx | 差距 | 消息 | 标题 | 当前话题 | 更像 | 特征词 | 文件 |', '|-----|------|------|------|----------|------|--------|------|',
    ...flagged.map((f) => `| ${f.idx} | ${f.gap} | ${f.msgs} | ${f.title.replace(/\|/g, '\\|')} | ${f.assigned} | ${f.suggested} | ${f.terms} | \`${f.file}\` |`)].join('\n'),
);
console.log('\nwrote topics/misfit-keyword.json / .md');
