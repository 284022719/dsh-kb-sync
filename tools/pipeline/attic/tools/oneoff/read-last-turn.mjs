// Show the state of the health session's LAST turn: is it finished, and what did
// it actually say (reconstructing from streaming chunk events if needed).
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

const list = await rpc('session.list');
const row = list.result.value.items.find((i) => i.sessionId === sessionId);
console.log(`running=${row?.running}  blank=${row?.blank}  title=${row?.projections?.values?.title}`);

const h = await rpc('session.history', { sessionId, maxMessages: 80 });
const events = (h.result.value.events ?? []).map((e) => e.event ?? e);
console.log(`events=${events.length}`);
for (const e of events.filter((x) => /turn\/|step\//.test(x.type))) console.log(`  seq ${e.seq} ${e.type} ${JSON.stringify(e.data)}`);

// reconstruct streamed text of the last turn
const lastTurnStart = events.map((e) => e.type).lastIndexOf('turn/start');
const tail = events.slice(lastTurnStart);
const chunks = tail.filter((e) => e.type === 'assistant/chunk');
const finals = tail.filter((e) => e.type === 'assistant/message');
let streamed = '';
for (const c of chunks) {
  const d = c.data ?? {};
  const piece = d.delta ?? d.text ?? d.chunk ?? (typeof d === 'string' ? d : '');
  if (typeof piece === 'string') streamed += piece;
}
const finalText = finals
  .map((e) => (e.data?.message?.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n'))
  .filter(Boolean)
  .join('\n---\n');

console.log(`\n最后一回合: chunk 事件 ${chunks.length} 个, 最终 assistant/message ${finals.length} 个`);
console.log(`\n===== 最终消息文本 =====\n${finalText || '(无)'}`);
console.log(`\n===== 流式重建文本（前 3000 字）=====\n${streamed.slice(0, 3000) || '(无)'}`);
