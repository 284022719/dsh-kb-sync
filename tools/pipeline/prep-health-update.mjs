// 为「增量新增 / 被续聊」的健康相关会话生成提取摘要。
//
//   node prep-health-update.mjs
//
// 输出 health-digest/digest-20.md（独立编号，不覆盖既有摘要），
// 之后交给提取 agent 产出 health-facts/digest-20.json，再由 build-health-profile 合并。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KB_DIR, KNOWLEDGE, HEALTH_DIGEST, UPDATE_NEW_ITEMS } from './_paths.mjs';
const KB = KB_DIR;
const recs = readFileSync(join(KNOWLEDGE, 'conversations.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const catalog = JSON.parse(readFileSync(join(KNOWLEDGE, 'catalog.json'), 'utf8'));

// 被续聊、且属于健康核心来源的会话
const CONTINUED_HEALTH = ['体检报告解读咨询'];

// 新增会话里与健康/饮食/心理/医疗相关的（按标题关键词）
const HEALTHY_TITLE = /吃|喝|拉稀|腹泻|豆浆|牛奶|鼠|睡眠|瘫痪|嗓子|鼻血|着凉|打喷嚏|经期|性爱|性行为|阴道|生殖|胸|发育|体重|BMI|健康|医|病|症|药|检查|MBTI|人格|心理|情绪|ADHD|失眠|疲劳|头晕|胆|胃|肠|肝|肾|尿酸|疫苗|体检|医院|就诊|近视|眼|牙|听|血压|血糖|营养/;

// ---- 只挑「本轮」的会话 ----
// 早先这里用的是 `c.idx >= 2446`（即"首轮导入之后新增的一切"），那是错的：
// 每跑一次都会把过去所有健康会话重新摘一遍，导致事实被反复提取。
// 正确来源是段 1 写下的 update-new-items.json —— 它的 added / changed 就是本轮变化。
const roundFile = UPDATE_NEW_ITEMS;
const round = existsSync(roundFile) ? JSON.parse(readFileSync(roundFile, 'utf8')) : { added: [], changed: [], items: [] };
const roundIds = new Map(); // id -> 原因
for (const a of round.added ?? []) roundIds.set(a.id, '本轮新增');
for (const c of round.changed ?? []) roundIds.set(c.id, '本轮续聊');
if (!roundIds.size) {
  console.log('本轮没有新增或续聊的会话，无健康内容可提取。');
  writeFileSync(join(HEALTH_DIGEST, 'digest-20.md'), '# 健康事实提取输入（增量更新批）\n\n本轮无新增或续聊的会话。\n', 'utf8');
  process.exit(0);
}

const want = new Map();
for (let i = 0; i < recs.length; i++) {
  const r = recs[i];
  const c = catalog[i];
  if (!roundIds.has(r.id)) continue;                    // 不在本轮，跳过
  const why = roundIds.get(r.id);
  // 本轮续聊里，健康核心会话一律纳入
  if (CONTINUED_HEALTH.some((t) => (r.title ?? '').includes(t))) {
    want.set(r.id, { rec: r, cat: c, why: `${why}的健康核心会话` });
    continue;
  }
  // 其余按标题关键词筛
  if (HEALTHY_TITLE.test(r.title ?? '')) {
    want.set(r.id, { rec: r, cat: c, why: `${why}且标题命中健康关键词` });
  }
}

if (!want.size) {
  console.log('本轮有变化，但没有健康相关会话。');
  writeFileSync(join(HEALTH_DIGEST, 'digest-20.md'), '# 健康事实提取输入（增量更新批）\n\n本轮变化的会话均与健康无关。\n', 'utf8');
  process.exit(0);
}

console.log(`选中 ${want.size} 个会话（本轮共变化 ${roundIds.size} 个）：`);
for (const [, v] of want) console.log(`  idx ${v.cat.idx}  ${v.cat.date}  ${v.rec.title}  （${v.why}）`);

// ---- 摘要（与 prep-health-digest 同规则：全部用户原话 + 含数值的模型回答） ----
const NUMERIC = /(\d+(?:\.\d+)?)\s*(μmol\/L|umol\/L|mmol\/L|mg\/dL|mg\/L|g\/L|mmHg|kg|公斤|斤|cm|厘米|mm|毫米|次\/分|岁|BMI|×)/g;
const CLIN = /(体检|化验|检验|检测报告|诊断|复查|医嘱|处方|门诊|挂号|病历|出院|手术|参考范围|上限|偏高|偏低|阳性|阴性|结节|轻度|中度)/g;
const A_CHARS = 2000;

function digestOf(rec) {
  const blocks = [];
  for (const m of rec.messages) {
    const body = String(m.role === 'user' ? m.text : [m.text, m.thinking].filter(Boolean).join('\n')).trim();
    if (!body) continue;
    if (m.role === 'user') {
      blocks.push(`【用户】${body}`);
      continue;
    }
    const nums = (body.match(NUMERIC) ?? []).length;
    const clin = (body.match(CLIN) ?? []).length;
    const isFirst = !blocks.some((x) => x.startsWith('【回答】'));
    if (isFirst || nums >= 3 || (clin >= 2 && nums >= 1)) blocks.push(`【回答】${body.slice(0, A_CHARS)}${body.length > A_CHARS ? ' …（截断）' : ''}`);
  }
  return blocks.join('\n\n');
}

const L = ['# 健康事实提取输入（增量更新批）', '', '> 本批是 2026-09-23 之后新增或被续聊的健康相关会话。', ''];
let totalChars = 0;
for (const v of [...want.values()].sort((a, b) => b.cat.idx - a.cat.idx)) {
  const d = digestOf(v.rec);
  totalChars += d.length;
  const file = String(v.cat.path).split('/').pop();
  L.push(`<!-- source: ${file} | 会话日期 ${v.cat.date} | ${v.rec.messages.length} 条消息 | 摘要 ${Math.round(d.length / 1000)}k -->`);
  L.push(`## ${v.rec.title}`);
  L.push('');
  L.push(`- 出处文件：\`${file}\``);
  L.push(`- 会话日期：${v.cat.date}`);
  L.push(`- 更新于：${String(v.rec.updated_at).slice(0, 16)}`);
  L.push('');
  L.push(d);
  L.push('');
  L.push('---');
  L.push('');
}

const out = join(HEALTH_DIGEST, 'digest-20.md');
writeFileSync(out, L.join('\n'), 'utf8');
console.log(`\nwrote ${out}（${want.size} 个会话，摘要 ${Math.round(totalChars / 1000)}k 字符）`);
