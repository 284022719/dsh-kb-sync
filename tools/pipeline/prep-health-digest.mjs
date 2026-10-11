// Build compact extraction digests for the health batches.
//
// Subagents cannot reliably read 200k-400k character conversations, so reduce
// each conversation to what actually carries PERSONAL facts:
//   * every user turn, verbatim (the user is the one stating their own data)
//   * assistant turns that look like report interpretations (>=3 measurements),
//     truncated; the first assistant turn is always kept (it usually enumerates
//     the uploaded report item by item)
//
//   node prep-health-digest.mjs [maxCharsPerBatch=70000]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEALTH_DIGEST, HEALTH_BATCHES } from './_paths.mjs';

const MAX = Number(process.argv[2] ?? 70000);
const NUMERIC = /(\d+(?:\.\d+)?)\s*(μmol\/L|umol\/L|mmol\/L|mg\/dL|mg\/L|g\/L|mmHg|kg|公斤|斤|cm|厘米|mm|毫米|次\/分|岁|BMI|×)/g;
const CLIN = /(体检|化验|检验|检测报告|诊断|复查|医嘱|处方|门诊|挂号|病历|出院|手术|参考范围|上限|偏高|偏低|阳性|阴性|结节|轻度|中度)/g;
const A_CHARS = 2000;

function digest(file) {
  const text = readFileSync(file, 'utf8');
  const title = (text.split('\n', 1)[0] ?? '').replace(/^#\s*/, '');
  const lines = text.split('\n');
  const blocks = [];
  let cur = null;
  for (const line of lines) {
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
  let kept = 0,
    dropped = 0;
  blocks.forEach((b, i) => {
    const body = b.body.join('\n').trim();
    if (!body) return;
    if (b.role === 'user') {
      out.push(`【用户】${body}`);
      kept++;
      return;
    }
    if (b.role === 'think') {
      dropped++;
      return; // reasoning adds bulk, rarely states user measurements
    }
    const nums = (body.match(NUMERIC) ?? []).length;
    const clin = (body.match(CLIN) ?? []).length;
    const isFirst = !out.some((x) => x.startsWith('【回答】'));
    if (isFirst || nums >= 3 || (clin >= 2 && nums >= 1)) {
      out.push(`【回答】${body.slice(0, A_CHARS)}${body.length > A_CHARS ? ' …（截断）' : ''}`);
      kept++;
    } else dropped++;
  });
  return { title, digest: out.join('\n\n'), blocks: blocks.length, kept, dropped };
}

const batches = readdirSync('health-batches').filter((f) => /^health-\d+\.tsv$/.test(f)).sort();
if (existsSync(HEALTH_DIGEST)) rmSync(HEALTH_DIGEST, { recursive: true, force: true });
mkdirSync(HEALTH_DIGEST, { recursive: true });

const plan = [];
for (const bf of batches) {
  const rows = readFileSync(join(HEALTH_BATCHES, bf), 'utf8').split('\n').filter(Boolean).slice(1);
  const items = [];
  for (const row of rows) {
    const [idx, date, messages, chars, title, path] = row.split('\t');
    const d = digest(path);
    items.push({ idx, date, messages, title, rawPath: path, file: path.split(/[\\/]/).pop(), ...d });
  }
  plan.push({ batch: bf, items });
}

// repack into balanced digests
const flat = plan.flatMap((p) => p.items.map((it) => ({ ...it, srcBatch: p.batch })));
flat.sort((a, b) => b.digest.length - a.digest.length);
const out = [];
let cur = { chars: 0, items: [] };
for (const it of flat) {
  if (cur.items.length && cur.chars + it.digest.length > MAX) {
    out.push(cur);
    cur = { chars: 0, items: [] };
  }
  cur.items.push(it);
  cur.chars += it.digest.length;
}
if (cur.items.length) out.push(cur);

const manifest = [];
out.forEach((b, i) => {
  const name = join(HEALTH_DIGEST, `digest-${String(i + 1).padStart(2, '0')}.md`);
  const L = [`# 健康事实提取输入 · 第 ${i + 1} 批`, ''];
  for (const it of b.items) {
    L.push(`<!-- source: ${it.file} | 会话日期 ${it.date} | ${it.messages} 条消息 | 原始 ${Math.round(readFileSync(it.rawPath, 'utf8').length / 1000)}k 字符 → 摘要 ${Math.round(it.digest.length / 1000)}k -->`);
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
  manifest.push({ batch: i + 1, file: name, chars: b.chars, conversations: b.items.map((x) => x.file) });
});

console.log(`原批 ${batches.length} 个 → 摘要批 ${out.length} 个（每批 <= ${MAX.toLocaleString('en-US')} 字符）`);
const rawTotal = flat.reduce((a, x) => a + readFileSync(x.rawPath, 'utf8').length, 0);
const digTotal = flat.reduce((a, x) => a + x.digest.length, 0);
console.log(`总原文 ${(rawTotal / 1e6).toFixed(2)}M 字符 → 摘要 ${(digTotal / 1e6).toFixed(2)}M 字符（压到 ${((digTotal / rawTotal) * 100).toFixed(0)}%）`);
for (const m of manifest) console.log(`  ${m.file}  ${String(m.conversations.length).padStart(2)} 个会话  ${Math.round(m.chars / 1000)}k 字`);
writeFileSync(join(HEALTH_DIGEST, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), batches: manifest }, null, 1));
