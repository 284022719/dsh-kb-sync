// Inspect the structure of the official export's conversations.json.
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync('raw/conversations.json', 'utf8');
console.log('bytes:', raw.length);
const data = JSON.parse(raw);
console.log('top-level:', Array.isArray(data) ? `array(${data.length})` : typeof data);
if (!Array.isArray(data) && typeof data === 'object') console.log('top keys:', Object.keys(data).join(', '));

const convs = Array.isArray(data) ? data : (data.conversations ?? data.data ?? []);
console.log('conversations:', convs.length);

const c0 = convs[0];
console.log('\n--- conversation keys ---');
console.log(Object.keys(c0).join(', '));
console.log('\n--- sample conversation (metadata only) ---');
const { chat_messages, messages, mapping, ...meta } = c0;
console.log(JSON.stringify(meta, null, 1).slice(0, 1200));

const msgs = c0.chat_messages ?? c0.messages ?? [];
console.log('\nmessages in conv0:', msgs.length);
if (msgs.length) {
  console.log('message keys:', Object.keys(msgs[0]).join(', '));
  console.log('\n--- first user message ---');
  console.log(JSON.stringify(msgs.find((m) => m.role === 'user') ?? msgs[0], null, 1).slice(0, 900));
  console.log('\n--- first assistant message ---');
  const a = msgs.find((m) => m.role === 'assistant');
  console.log(JSON.stringify(a, null, 1).slice(0, 1200));
}

// global stats
let totalMsgs = 0;
const roleHist = {};
const fragHist = {};
const msgKeySet = new Set();
for (const c of convs) {
  const m = c.chat_messages ?? c.messages ?? [];
  totalMsgs += m.length;
  for (const msg of m) {
    roleHist[msg.role] = (roleHist[msg.role] ?? 0) + 1;
    for (const k of Object.keys(msg)) msgKeySet.add(k);
    const frags = msg.fragments ?? [];
    for (const f of frags) fragHist[`${msg.role}/${f.type}`] = (fragHist[`${msg.role}/${f.type}`] ?? 0) + 1;
  }
}
console.log('\n=== GLOBAL ===');
console.log('total messages:', totalMsgs);
console.log('roles:', JSON.stringify(roleHist));
console.log('fragment types:', JSON.stringify(fragHist, null, 1));
console.log('union of message keys:', [...msgKeySet].join(', '));

const times = convs.map((c) => c.updated_at).filter(Boolean).sort((a, b) => a - b);
if (times.length)
  console.log(
    'conversation time span:',
    new Date(times[0] * 1000).toISOString().slice(0, 10),
    '..',
    new Date(times.at(-1) * 1000).toISOString().slice(0, 10),
  );
writeFileSync('probe-export-shape.json', JSON.stringify({ convCount: convs.length, totalMsgs, roleHist, fragHist }, null, 2));
