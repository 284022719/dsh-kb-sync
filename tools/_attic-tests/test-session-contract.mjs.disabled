// Verify that hand-written event rows satisfy DSH's own storage-record contract.
import { decodeStorageRecord, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';

console.log('SESSION_FORMAT_VERSION =', SESSION_FORMAT_VERSION);

const now = Date.now();
const rows = [
  { type: 'permission/preset', seq: 0, time: now, data: { preset: 'workspace-write' } },
  { type: 'sandbox/mode', seq: 1, time: now, data: { mode: 'workspace-write' } },
  { type: 'approval/policy', seq: 2, time: now, data: { policy: 'ask' } },
  { type: 'session/title', seq: 3, time: now, data: { title: '健康医疗', messageSeqs: [6], source: { kind: 'fallback' } } },
  { type: 'turn/start', seq: 4, time: now, data: { turn: 1 } },
  { type: 'step/start', seq: 5, time: now, data: { turn: 1, step: 1 } },
  {
    type: 'user/message',
    seq: 6,
    time: now,
    data: {
      content: [{ type: 'text', text: '【知识库】健康医疗话题' }],
      source: { kind: 'user', rpcId: crypto.randomUUID(), clientTimeZone: 'Asia/Shanghai' },
      role: 'user',
      id: crypto.randomUUID(),
    },
    surfaceOp: 'append',
  },
  {
    type: 'assistant/message',
    seq: 7,
    time: now,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '本话题共 12 个会话…' }],
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' },
        id: crypto.randomUUID(),
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 },
    },
    surfaceOp: 'append',
  },
  { type: 'step/end', seq: 8, time: now, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 9, time: now, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'session/end-seed', seq: 10, time: now, data: {} },
];

let ok = 0;
const flat = [];
for (const row of rows) {
  try {
    const decoded = decodeStorageRecord(row);
    if (!Array.isArray(decoded)) throw new Error('decodeStorageRecord did not return an array');
    for (const ev of decoded) {
      flat.push(ev);
      if (typeof ev.seq !== 'number') console.log('  ! decoded event without numeric seq:', JSON.stringify(ev).slice(0, 120));
    }
    ok++;
  } catch (e) {
    console.log(`  !! ${row.type} REJECTED: ${e.message}`);
  }
}
console.log(`\nrows accepted: ${ok}/${rows.length}`);
console.log(`events after decode: ${flat.length}`);
const seqOk = flat.every((e, i) => e.seq === i);
console.log(`seq continuity 0..${flat.length - 1}: ${seqOk ? 'OK' : 'BROKEN -> ' + flat.map((e) => e.seq).join(',')}`);
console.log('types:', flat.map((e) => e.type).join(' '));
