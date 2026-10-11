// 查清「18岁女」相关会话的归属：逐条打印这些会话里的用户原话。
import { readFileSync } from 'node:fs';

const recs = readFileSync('knowledge/conversations.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const TITLES = [
  '嗓子肿痛怕冷处理建议',
  '经期大量饮酒致异常出血',
  '阴道润滑液学名',
  '高危性行为后检查建议',
  '经期性爱注意事项',
  '月经周期粘人阶段',
  '21岁E罩杯胸软下垂原因',
  '女孩发育到几岁',
  '18岁女孩儿，左上腹痛',
  '175cm最低健康体重',
];

for (const t of TITLES) {
  const r = recs.find((x) => x.title === t);
  if (!r) {
    console.log(`\n【${t}】未找到`);
    continue;
  }
  console.log(`\n【${t}】${String(r.inserted_at).slice(0, 10)}  ${r.messages.length} 条`);
  const users = r.messages.filter((m) => m.role === 'user');
  for (const m of users.slice(0, 8)) {
    console.log(`  👤 ${String(m.at ?? '').slice(0, 16)}  ${String(m.text).replace(/\s+/g, ' ').slice(0, 150)}`);
  }
  if (users.length > 8) console.log(`  …（共 ${users.length} 条用户消息）`);
}
