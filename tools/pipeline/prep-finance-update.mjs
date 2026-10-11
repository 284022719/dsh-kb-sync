// 为「本轮新增 / 续聊」的财务相关会话生成提取摘要，供段 2 的 headless 判断使用。
//
//   node prep-finance-update.mjs
//
// 输出 finance-digest/digest-20.md。与 prep-health-update.mjs 同一套规则：
// **只取 update-new-items.json 的 added / changed（本轮变化）**，不扫全量，
// 否则每轮都会把过去所有财务会话重摘一遍。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWLEDGE, FINANCE_DIGEST, UPDATE_NEW_ITEMS, FIN_DIR } from './_paths.mjs';

const recs = readFileSync(join(KNOWLEDGE, 'conversations.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const catalog = JSON.parse(readFileSync(join(KNOWLEDGE, 'catalog.json'), 'utf8'));

// 财务相关关键词。刻意保守：宁可漏，不要把随口提到"钱"的闲聊全捞进来。
const FIN_RE = /工资|薪水|薪|收入|到手|绩效|年终|奖金|公积金|社保|支出|开销|花呗|借呗|微粒贷|分付|信用卡|网贷|贷款|还款|还债|还清|欠款|负债|债务|利息|年化|分期|手续费|罚息|逾期|存款|储蓄|理财|基金|股票|投资|预算|记账|现金流|房贷|房租|余额|资产|存款|攒钱|省钱|提前还/;

// ---- 只挑本轮变化的会话 ----
const roundFile = UPDATE_NEW_ITEMS;
const round = existsSync(roundFile) ? JSON.parse(readFileSync(roundFile, 'utf8')) : { added: [], changed: [] };
const roundWhy = new Map();
for (const a of round.added ?? []) roundWhy.set(a.id, '本轮新增');
for (const c of round.changed ?? []) roundWhy.set(c.id, '本轮续聊');

if (!roundWhy.size) {
  mkdirSync(FINANCE_DIGEST, { recursive: true });
  writeFileSync(join(FINANCE_DIGEST, 'digest-20.md'), '# 财务事实提取输入（增量更新批）\n\n本轮无新增或续聊的会话。\n', 'utf8');
  console.log('本轮没有新增或续聊的会话，无财务内容可提取。');
  process.exit(0);
}

const want = [];
for (let i = 0; i < recs.length; i++) {
  const r = recs[i];
  if (!roundWhy.has(r.id)) continue;
  const blob = `${r.title ?? ''} ${(r.messages.find((m) => m.role === 'user')?.text ?? '')}`;
  if (!FIN_RE.test(blob)) continue;
  want.push({ rec: r, cat: catalog[i], why: roundWhy.get(r.id) });
}

if (!want.length) {
  mkdirSync(FINANCE_DIGEST, { recursive: true });
  writeFileSync(join(FINANCE_DIGEST, 'digest-20.md'), '# 财务事实提取输入（增量更新批）\n\n本轮变化的会话与财务无关。\n', 'utf8');
  console.log(`本轮共变化 ${roundWhy.size} 个会话，其中没有财务相关的。`);
  process.exit(0);
}

// ---- 摘要：用户原话全保留；模型回答只保留含金额/利率的段落 ----
const MONEY = /(\d[\d,]*(?:\.\d+)?)\s*(元|块|万|万元|k|K|%|％|厘|个点)/g;
const FIN_WORD = /(利息|年化|利率|日息|月供|本金|余额|还款|逾期|罚息|分期|账单|到手|工资|收入|支出|负债|净资产|提前还清)/g;
const A_CHARS = 2200;

function digestOf(rec) {
  const out = [];
  for (const m of rec.messages) {
    const body = String(m.role === 'user' ? m.text : [m.text, m.thinking].filter(Boolean).join('\n')).trim();
    if (!body) continue;
    if (m.role === 'user') {
      out.push(`【用户】${body}`);
      continue;
    }
    const money = (body.match(MONEY) ?? []).length;
    const words = (body.match(FIN_WORD) ?? []).length;
    const isFirst = !out.some((x) => x.startsWith('【回答】'));
    // 财务场景：模型回答里几乎每个有用结论都带金额，所以门槛比健康那边低
    if (isFirst || money >= 2 || (money >= 1 && words >= 2)) {
      out.push(`【回答】${body.slice(0, A_CHARS)}${body.length > A_CHARS ? ' …（截断）' : ''}`);
    }
  }
  return out.join('\n\n');
}

const L = ['# 财务事实提取输入（增量更新批）', '', '> 本批只含**本轮**新增/续聊、且与财务相关的会话。', ''];
let chars = 0;
for (const v of want.sort((a, b) => b.cat.idx - a.cat.idx)) {
  const d = digestOf(v.rec);
  chars += d.length;
  const file = String(v.cat.path).split('/').pop();
  L.push(`<!-- source: ${file} | 会话日期 ${v.cat.date} | ${v.rec.messages.length} 条消息 | 摘要 ${Math.round(d.length / 1000)}k -->`);
  L.push(`## ${v.rec.title}`);
  L.push('');
  L.push(`- 出处文件：\`${file}\``);
  L.push(`- 会话日期：${v.cat.date}`);
  L.push(`- 变化类型：${v.why}`);
  L.push('');
  L.push(d);
  L.push('');
  L.push('---');
  L.push('');
}

mkdirSync(FINANCE_DIGEST, { recursive: true });
writeFileSync(join(FINANCE_DIGEST, 'digest-20.md'), L.join('\n'), 'utf8');
console.log(`选中 ${want.length} 个财务相关会话（本轮共变化 ${roundWhy.size} 个）：`);
for (const v of want) console.log(`  idx ${v.cat.idx}  ${v.cat.date}  ${v.rec.title}  （${v.why}）`);
console.log(`\nwrote finance-digest/digest-20.md（摘要 ${Math.round(chars / 1000)}k 字符）`);
