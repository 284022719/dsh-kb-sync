// Second-tier digests: lifestyle/diet/training conversations that did not make
// the top-34 by data density, but that directly serve diet & exercise guidance.
// Writes NEW files (digest-1x.md) so already-running readers are not disturbed.
//
//   node prep-health-digest2.mjs [maxCharsPerBatch=70000]
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KB_DIR, PIPE_DIR, HEALTH_DIGEST } from './_paths.mjs';

const MAX = Number(process.argv[2] ?? 70000);
const NUMERIC = /(\d+(?:\.\d+)?)\s*(μmol\/L|umol\/L|mmol\/L|mg\/dL|mg\/L|g\/L|mmHg|kg|公斤|斤|cm|厘米|mm|毫米|次\/分|岁|BMI|×|g\b|克|毫升|ml|IU)/g;
const CLIN = /(体检|化验|检验|检测报告|诊断|复查|医嘱|处方|门诊|挂号|病历|出院|手术|参考范围|上限|偏高|偏低|阳性|阴性|结节|轻度|中度)/g;
const A_CHARS = 2000;

const KEY = /增肌|增重|补剂|蛋白粉|肌酸|饮食|营养|健身|锻炼|运动|训练|睡眠|作息|体重|BMI|叶酸|维生素|体重过轻|身材|体脂|喝|吃|胃|肠|消化/i;

const KB = KB_DIR;
const scored = JSON.parse(readFileSync(join(PIPE_DIR, 'attic', 'health-selection-scored.json'), 'utf8'));
// everything already shipped in digest 01-03
const already = new Set();
for (const f of readdirSync(HEALTH_DIGEST).filter((x) => /^digest-\d+\.md$/.test(x))) {
  const txt = readFileSync(join(HEALTH_DIGEST, f), 'utf8');
  for (const m of txt.matchAll(/出处文件：`([^`]+)`/g)) already.add(m[1]);
}

// substantive ones only: tiny generic lookups (1-3k) add noise, not facts
const pick = scored.filter(
  (r) => !already.has(r.path.split(/[\\/]/).pop()) && KEY.test(r.title) && r.chars >= 4000,
);
console.log(`补充候选（标题命中饮食/锻炼/睡眠关键词）: ${pick.length}`);
for (const r of pick.slice(0, 40)) console.log(`   ${String(Math.round(r.chars / 1000)).padStart(3)}k  ${r.date}  ${r.title}`);

function digest(file) {
  const text = readFileSync(file, 'utf8');
  const title = (text.split('\n', 1)[0] ?? '').replace(/^#\s*/, '');
  const blocks = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const h = /^##\s+👤\s+用户|^###\s+💭|^###\s+🤖\s+DeepSeek/.exec(line);
    if (h) {
      if (cur) blocks.push(cur);
      cur = { role: h[0].includes('用户') ? 'user' : h[0].includes('💭') ? 'think' : 'assistant', body: [] };
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) blocks.push(cur);
  const out = [];
  for (const b of blocks) {
    const body = b.body.join('\n').trim();
    if (!body) continue;
    if (b.role === 'user') {
      out.push(`【用户】${body}`);
      continue;
    }
    if (b.role === 'think') continue;
    const nums = (body.match(NUMERIC) ?? []).length;
    const clin = (body.match(CLIN) ?? []).length;
    const isFirst = !out.some((x) => x.startsWith('【回答】'));
    if (isFirst || nums >= 3 || (clin >= 2 && nums >= 1)) out.push(`【回答】${body.slice(0, A_CHARS)}${body.length > A_CHARS ? ' …（截断）' : ''}`);
  }
  return { title, digest: out.join('\n\n') };
}

const items = pick.map((r) => ({ ...r, file: r.path.split(/[\\/]/).pop(), raw: `${KB}/${r.path}`, ...digest(`${KB}/${r.path}`) }));
items.sort((a, b) => b.digest.length - a.digest.length);
const batches = [];
let cur = { chars: 0, items: [] };
for (const it of items) {
  if (cur.items.length && cur.chars + it.digest.length > MAX) {
    batches.push(cur);
    cur = { chars: 0, items: [] };
  }
  cur.items.push(it);
  cur.chars += it.digest.length;
}
if (cur.items.length) batches.push(cur);

const manifest = [];
batches.forEach((b, i) => {
  const name = join(HEALTH_DIGEST, `digest-${10 + i + 1}.md`);
  const L = [`# 健康事实提取输入（补充批）· 第 ${i + 1} 组`, ''];
  for (const it of b.items) {
    L.push(`<!-- source: ${it.file} | 会话日期 ${it.date} | 原始 ${Math.round(it.chars / 1000)}k 字符 → 摘要 ${Math.round(it.digest.length / 1000)}k -->`);
    L.push(`## ${it.title}`);
    L.push('');
    L.push(`- 出处文件：\`${it.file}\``);
    L.push(`- 会话日期：${it.date}`);
    L.push('');
    L.push(it.digest);
    L.push('');
    L.push('---');
    L.push('');
  }
  writeFileSync(name, L.join('\n'));
  manifest.push({ batch: 10 + i + 1, file: name, chars: b.chars, conversations: b.items.map((x) => x.file) });
});

console.log(`\n补充摘要批 ${batches.length} 个：`);
for (const m of manifest) console.log(`  ${m.file}  ${String(m.conversations.length).padStart(2)} 个会话  ${Math.round(m.chars / 1000)}k 字`);
writeFileSync(join(HEALTH_DIGEST, 'manifest2.json'), JSON.stringify({ generatedAt: new Date().toISOString(), batches: manifest }, null, 1));
