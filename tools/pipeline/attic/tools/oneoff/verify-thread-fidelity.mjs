// Scale up the fidelity check: for every BRANCHED conversation, does the
// export-based reconstruction reproduce the web app's authoritative current
// thread (chat_session.current_message_id walked to the root)?
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN = readFileSync('.token', 'utf8').trim();
const HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  accept: '*/*',
  'content-type': 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'x-client-platform': 'web',
  'x-client-version': '1.0.0',
  origin: 'https://chat.deepseek.com',
  referer: 'https://chat.deepseek.com/',
};
const LIMIT = Number(process.argv[2] ?? 40);

const convs = JSON.parse(readFileSync('raw/conversations.json', 'utf8'));
const recs = readFileSync('knowledge/conversations.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function leafCount(map) {
  let n = 0;
  for (const id of Object.keys(map)) {
    const x = map[id];
    if (!x || x.parent === null || x.parent === undefined) continue;
    if ((x.children ?? []).length === 0) n++;
  }
  return n;
}

const branched = recs
  .map((r, i) => ({ i, r, leaves: leafCount(convs[i].mapping) }))
  .filter((x) => x.leaves > 1)
  .sort((a, b) => b.leaves - a.leaves);

console.log(`有分支的会话: ${branched.length} / ${recs.length}`);
console.log(`最多分支的前 5 个: ${branched.slice(0, 5).map((x) => `${x.r.title}(${x.leaves})`).join(', ')}`);

// sample: the most-branched ones + a spread across the rest
const step = Math.max(1, Math.floor(branched.length / LIMIT));
const sample = [];
for (let k = 0; k < branched.length && sample.length < LIMIT; k += step) sample.push(branched[k]);

let match = 0,
  mismatch = [],
  errors = 0;
for (const { i, r, leaves } of sample) {
  try {
    const res = await fetch(`https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${r.id}`, { headers: HEADERS });
    const j = await res.json();
    const biz = j?.data?.biz_data;
    if (!biz) {
      errors++;
      continue;
    }
    const cur = biz.chat_session?.current_message_id;
    const parent = new Map(biz.chat_messages.map((m) => [String(m.message_id), m.parent_id === null ? null : String(m.parent_id)]));
    const apiChain = [];
    let id = String(cur);
    const g = new Set();
    while (id && id !== 'null' && !g.has(id)) {
      g.add(id);
      apiChain.push(id);
      id = parent.get(id);
    }
    apiChain.reverse();
    const mine = r.messages.map((m) => m.id);
    const eq = mine.length === apiChain.length && mine.every((x, k) => x === apiChain[k]);
    if (eq) match++;
    else mismatch.push({ idx: i, title: r.title, leaves, mine: mine.length, api: apiChain.length });
  } catch (e) {
    errors++;
  }
  await new Promise((r2) => setTimeout(r2, 120));
}

console.log(`\n抽样 ${sample.length} 个有分支会话核对: 一致 ${match}, 不一致 ${mismatch.length}, 请求失败 ${errors}`);
for (const m of mismatch.slice(0, 10)) console.log(`  idx ${m.idx} 「${m.title}」 叶子=${m.leaves} 我的=${m.mine} API=${m.api}`);
writeFileSync('analysis-branch-fidelity.json', JSON.stringify({ branched: branched.length, sampled: sample.length, match, mismatch, errors }, null, 1));
console.log(mismatch.length === 0 ? '\n结论：导出重建与网页端当前线程一致 ✔' : '\n结论：存在不一致，需要改用 API 线程 ✗');
