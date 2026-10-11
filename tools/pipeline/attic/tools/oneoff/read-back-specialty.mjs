// Read back one 专题 session through the host history API (what the GUI renders).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const HOST = 'http://127.0.0.1:3080';
async function rpc(method, payload = {}) {
  const res = await fetch(`${HOST}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
  });
  return res.json();
}
const mf = JSON.parse(readFileSync('../dsh-kb-sync/data/kb/dsh-specialty-sessions.json', 'utf8'));
const want = mf.sessions.find((s) => s.topic.includes('爬虫')) ?? mf.sessions[0];
const hist = await rpc('session.history', { sessionId: want.id, maxMessages: 10 });
if (!hist.result?.ok) {
  console.log('failed:', JSON.stringify(hist).slice(0, 300));
  process.exit(1);
}
const v = hist.result.value;
console.log(`cwd=${mf.cwd}`);
console.log(`title=${JSON.stringify(v.projections?.values?.title)}  asOfSeq=${v.projections?.asOfSeq}`);
for (const e of v.events ?? []) {
  const ev = e.event ?? e;
  if (ev.type === 'user/message') console.log(`\n[user]\n${ev.data?.content?.[0]?.text ?? ''}`);
  else if (ev.type === 'assistant/message')
    console.log(`\n[assistant]\n${String((ev.data?.message?.content ?? []).map((c) => c.text ?? '').join('')).slice(0, 1200)}`);
}
