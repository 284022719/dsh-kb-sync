// 看被续聊的 3 个会话新增了什么内容（对比备份里的旧版本）。
import { readFileSync, readdirSync } from 'node:fs';

const bk = readdirSync('knowledge').filter((f) => f.startsWith('conversations.jsonl.backup-')).sort().at(-1);
console.log(`对比基线: knowledge/${bk}\n`);
const oldRecs = new Map(readFileSync(`knowledge/${bk}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
const newRecs = new Map(readFileSync('knowledge/conversations.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));

for (const [id, nr] of newRecs) {
  const or = oldRecs.get(id);
  if (!or) continue;
  if (or.messages.length === nr.messages.length && or.updated_at === nr.updated_at) continue;
  const oldIds = new Set(or.messages.map((m) => m.id));
  const added = nr.messages.filter((m) => !oldIds.has(m.id));
  console.log(`=== ${nr.title}（${or.messages.length} → ${nr.messages.length} 条，新增 ${added.length}）===`);
  for (const m of added) {
    const who = m.role === 'user' ? '👤 用户' : '🤖 回答';
    const body = (m.role === 'user' ? m.text : m.text || m.thinking).replace(/\s+/g, ' ').trim();
    console.log(`  ${who} [${String(m.at).slice(0, 16)}] ${body.slice(0, 320)}`);
    if (body.length > 320) console.log(`        …（共 ${body.length} 字）`);
  }
  console.log('');
}
