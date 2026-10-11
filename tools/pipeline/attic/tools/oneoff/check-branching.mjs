// Investigate the message-count gap between the web API's history_messages and
// the export-based main-path reconstruction, for the most important health chats.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

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

function stats(map) {
  const ids = Object.keys(map);
  const msgNodes = ids.filter((id) => map[id]?.message);
  const isLeaf = (id) => {
    const n = map[id];
    if (!n || n.parent === null || n.parent === undefined) return false;
    return (n.children ?? []).length === 0;
  };
  const leaves = ids.filter(isLeaf);
  const depthOf = (id) => {
    let d = 0,
      cur = map[id];
    const g = new Set();
    while (cur && cur.parent && cur.parent !== 'root' && map[cur.parent] && !g.has(cur.id)) {
      g.add(cur.id);
      cur = map[cur.parent];
      d++;
    }
    return d;
  };
  const leafInfo = leaves.map((id) => ({ id, depth: depthOf(id), msgs: 0 }));
  for (const l of leafInfo) {
    let cur = map[l.id],
      c = 0;
    const g = new Set();
    while (cur && !g.has(cur.id)) {
      g.add(cur.id);
      if (cur.message) c++;
      if (cur.parent === 'root' || cur.parent === null) break;
      cur = map[cur.parent];
    }
    l.msgs = c;
  }
  return { nodes: ids.length, msgNodes: msgNodes.length, leaves: leafInfo.sort((a, b) => b.msgs - a.msgs) };
}

const targets = recs
  .map((r, i) => ({ i, r }))
  .filter(({ r }) => ['体检报告解读咨询', '症状与用药记录总结', '增肥', '大饼段子抑郁症解读', '成都ADHD挂号困境'].includes(r.title));

for (const { i, r } of targets) {
  const c = byId.get(r.id);
  const st = stats(c.mapping);
  console.log(`\n=== idx ${i} 「${r.title}」 ===`);
  console.log(` 导出: 节点 ${st.nodes}, 其中消息节点 ${st.msgNodes}, 真叶子 ${st.leaves.length} 条`);
  console.log(` 我的输出: ${r.messages.length} 条消息`);
  for (const l of st.leaves.slice(0, 6)) console.log(`   叶子 ${l.id}: 链路 ${l.msgs} 条消息, 深度 ${l.depth}`);

  // compare with the API
  const url = `https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${c.id}`;
  const res = await fetch(url, { headers: HEADERS });
  const j = await res.json();
  const msgs = j?.data?.biz_data?.chat_messages ?? [];
  const roles = {};
  for (const m of msgs) roles[m.role] = (roles[m.role] ?? 0) + 1;
  console.log(` API: ${msgs.length} 条消息 ${JSON.stringify(roles)}`);
  const ids = new Set(msgs.map((m) => String(m.message_id)));
  console.log(` API 的 message_id 是否就对应导出的节点 id（取前若干）: ${[...ids].slice(0, 6).join(',')}`);
}
