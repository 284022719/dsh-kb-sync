// Read a session's history in a human-useful way: tools used, then the final text.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const HOST = 'http://127.0.0.1:3080';
const rpc = async (m, p = {}) =>
  (await fetch(`${HOST}/api/${m}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: m, payload: p }),
  })).json();

const mf = process.argv[2] ?? '../health/dsh-health-session.json';
const sessionId = JSON.parse(readFileSync(mf, 'utf8')).sessions[0].id;
const h = await rpc('session.history', { sessionId, maxMessages: 60 });
if (!h.result?.ok) {
  console.log('history failed:', JSON.stringify(h).slice(0, 300));
  process.exit(1);
}
const events = (h.result.value.events ?? []).map((e) => e.event ?? e);

const types = {};
for (const e of events) types[e.type] = (types[e.type] ?? 0) + 1;
console.log(`events=${events.length}  类型分布: ${JSON.stringify(types)}`);

const toolCalls = [];
for (const e of events) {
  if (e.type === 'tool/call') toolCalls.push({ name: e.data?.name, args: JSON.stringify(e.data?.arguments ?? '').slice(0, 200) });
  const content = e.data?.message?.content ?? [];
  for (const c of content) if (c.type === 'tool-call') toolCalls.push({ name: c.name, args: String(c.arguments ?? '').slice(0, 200) });
}
console.log(`\n工具调用 ${toolCalls.length} 次：`);
for (const t of toolCalls) console.log(`  - ${t.name}  ${t.args}`);

const texts = [];
for (const e of events) {
  if (e.type !== 'assistant/message') continue;
  const t = (e.data?.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  if (t) texts.push(t);
}
console.log(`\n含文本的 assistant 消息: ${texts.length}`);
console.log('\n===== 最终回答 =====\n');
console.log(texts.length ? texts[texts.length - 1] : '(没有文本回答)');
