// End-to-end check of the health assistant: send one question that only needs the
// personal dossier (no web search), then read back what the agent actually did.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const HOST = 'http://127.0.0.1:3080';
const rpc = async (m, p = {}) =>
  (await fetch(`${HOST}/api/${m}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: m, payload: p }),
  })).json();

const manifest = JSON.parse(readFileSync('../health/dsh-health-session.json', 'utf8'));
const sessionId = manifest.sessions[0].id;
const question = process.argv[2] ?? '只看我的健康档案回答，不要联网：我 2026-03-06 那次体检有哪些异常指标？各自报告要求的复查时间是什么？';

console.log(`session: ${sessionId}`);
console.log(`question: ${question}`);
const sent = await rpc('session.prompt', {
  sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: question }],
  clientTimeZone: 'Asia/Shanghai',
});
console.log('prompt accepted:', sent.result?.ok === true, JSON.stringify(sent.result?.error ?? '').slice(0, 200));

// poll history until the turn completes
let last = 0;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const h = await rpc('session.history', { sessionId, maxMessages: 20 });
  const events = h.result?.value?.events ?? [];
  const done = events.some((e) => (e.event ?? e).type === 'turn/end');
  const texts = events.filter((e) => (e.event ?? e).type === 'assistant/message');
  const toolCalls = events.filter((e) => {
    const ev = e.event ?? e;
    const content = ev.data?.message?.content ?? [];
    return content.some((c) => c.type === 'tool-call');
  });
  if (events.length !== last) {
    last = events.length;
    console.log(`  … events=${events.length} assistantMsgs=${texts.length} toolMsg=${toolCalls.length} done=${done}`);
  }
  if (done && texts.length) break;
}

const h = await rpc('session.history', { sessionId, maxMessages: 30 });
const events = (h.result?.value?.events ?? []).map((e) => e.event ?? e);
const toolNames = [];
let answer = '';
for (const ev of events) {
  const content = ev.data?.message?.content ?? [];
  for (const c of content) if (c.type === 'tool-call') toolNames.push(c.name);
  if (ev.type === 'assistant/message') answer = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}
console.log(`\n工具调用: ${toolNames.length ? toolNames.join(', ') : '（无）'}`);
console.log(`\n=== 回答（前 2000 字）===\n${answer.slice(0, 2000)}`);
