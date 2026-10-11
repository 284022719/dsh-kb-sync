// Which leaf is the CURRENT thread? The web API's chat_session.current_message_id
// is the authoritative tip. Compare it against (a) my parsed thread and
// (b) the deepest leaf, to decide the correct reconstruction rule.
import { readFileSync } from 'node:fs';

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
const convs = JSON.parse(readFileSync('raw/conversations.json', 'utf8'));
const recs = readFileSync('knowledge/conversations.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(convs.map((c) => [c.id, c]));

function leavesOf(map) {
  return Object.keys(map).filter((id) => {
    const n = map[id];
    if (!n || n.parent === null || n.parent === undefined) return false;
    return (n.children ?? []).length === 0;
  });
}
function chainFrom(map, startId) {
  const chain = [];
  let cur = map[startId];
  const g = new Set();
  while (cur && !g.has(cur.id)) {
    g.add(cur.id);
    if (cur.message) chain.push(cur.id);
    if (cur.parent === 'root' || cur.parent === null || cur.parent === undefined) break;
    cur = map[cur.parent];
  }
  return chain.reverse();
}

const names = ['体检报告解读咨询', '增肥', '症状与用药记录总结', '大饼段子抑郁症解读', '成都ADHD挂号困境', '投资'];
const targets = recs.map((r, i) => ({ i, r })).filter(({ r }) => names.includes(r.title));

for (const { i, r } of targets) {
  const c = byId.get(r.id);
  const map = c.mapping;
  const res = await fetch(`https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${c.id}`, { headers: HEADERS });
  const j = await res.json();
  const biz = j?.data?.biz_data;
  const cur = biz?.chat_session?.current_message_id;
  const msgs = biz?.chat_messages ?? [];
  const parent = new Map(msgs.map((m) => [String(m.message_id), m.parent_id === null ? null : String(m.parent_id)]));

  // authoritative path: walk up from current_message_id
  const apiChain = [];
  let id = String(cur);
  const g = new Set();
  while (id && id !== 'null' && !g.has(id)) {
    g.add(id);
    apiChain.push(id);
    id = parent.get(id);
  }
  apiChain.reverse();

  // deepest leaf in the export
  let best = null;
  for (const l of leavesOf(map)) {
    const ch = chainFrom(map, l);
    if (!best || ch.length > best.chain.length) best = { leaf: l, chain: ch };
  }
  const myChain = r.messages.map((m) => m.id);

  const eq = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);
  console.log(`\n「${r.title}」  API 消息节点=${msgs.length}  current_message_id=${cur}`);
  console.log(`  API 当前线程长度=${apiChain.length}   我的解析=${myChain.length}   最深叶子(${best.leaf})=${best.chain.length}`);
  console.log(`  我的解析 == API 当前线程 ? ${eq(myChain, apiChain)}   |   最深叶子 == API 当前线程 ? ${eq(best.chain, apiChain)}`);
  if (!eq(best.chain, apiChain)) {
    const a = new Set(apiChain);
    const extra = best.chain.filter((x) => !a.has(x));
    const missing = apiChain.filter((x) => !new Set(best.chain).has(x));
    console.log(`   最深叶子不在 API 线程内的节点: ${extra.slice(0, 8).join(',')}${extra.length > 8 ? '…' : ''} (${extra.length})`);
    console.log(`   API 线程里最深叶子缺的节点: ${missing.slice(0, 8).join(',')}${missing.length > 8 ? '…' : ''} (${missing.length})`);
  }
}
