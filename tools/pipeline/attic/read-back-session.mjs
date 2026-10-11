// Read back one migrated session through the host's history API — exactly what
// the GUI renders when you open it.
import { randomUUID } from 'node:crypto';
const HOST = 'http://127.0.0.1:3080';
async function rpc(method, payload = {}) {
  const res = await fetch(`${HOST}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
  });
  return res.json();
}
const list = await rpc('session.list');
const kb = JSON.parse((await import('node:fs')).readFileSync('../dsh-kb-sync/data/kb/dsh-sessions.json', 'utf8'));
const want = kb.sessions.find((s) => s.topic === '健康医疗') ?? kb.sessions[0];

const hist = await rpc('session.history', { sessionId: want.id, maxMessages: 10 });
if (!hist.result?.ok) {
  console.log('session.history failed:', JSON.stringify(hist).slice(0, 500));
  process.exit(1);
}
const v = hist.result.value;
console.log(`session: ${want.id}  (${want.title})`);
console.log(`history keys: ${Object.keys(v).join(', ')}`);
const events = v.events ?? v.entries ?? [];
console.log(`events: ${events.length}   hasMore=${v.hasMore}   projections: ${v.projections ? 'yes' : 'no'}`);
if (v.projections) console.log(`projected title: ${JSON.stringify(v.projections.values?.title)}  asOfSeq=${v.projections.asOfSeq}`);

for (const e of events) {
  const ev = e.event ?? e;
  const t = ev.type;
  if (t === 'user/message') console.log(`\n[user] ${String(ev.data?.content?.[0]?.text ?? '').slice(0, 320).replace(/\n/g, ' ⏎ ')}`);
  else if (t === 'assistant/message')
    console.log(`\n[assistant] ${String((ev.data?.message?.content ?? []).map((c) => c.text ?? '').join('') ?? '').slice(0, 420).replace(/\n/g, ' ⏎ ')}`);
  else console.log(`  · ${t} (seq ${ev.seq})`);
}
