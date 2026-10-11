// 把增量新增的会话补进「专题」层。
//
//   node extend-specialties.mjs
//
// 规则：只在该会话的一级话题正是该专题的父话题时考虑；再看标题/首问是否命中
// 该专题的关键词（由专题名 + 说明 + 它吸收的原始簇名派生）。刻意保守——宁可漏，不要错塞。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KB = '../dsh-kb-sync/data/kb';
const final = JSON.parse(readFileSync('topics/final-topics.json', 'utf8'));
const specFile = JSON.parse(readFileSync('topics/specialties.json', 'utf8'));
const raw = JSON.parse(readFileSync('topics/merged-prenormalize.json', 'utf8'));
const catalog = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));
const recs = readFileSync('knowledge/conversations.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const parentOf = new Map();
for (const t of final.topics) for (const i of t.members) parentOf.set(i, t.key);
const clusterToSpecialty = new Map();
for (const s of specFile.specialties) for (const src of s.sources) clusterToSpecialty.set(src, s);

// 关键词只从**专题名 + 它吸收的原始簇名**派生。
// 刻意不取 desc——描述里全是「症状/工作/生活」这类泛用词，会大量误命
// （实测：靠 desc 会把「高中毕业直接就业人数」误塞进「社会工作与社区治理」）。
const STOP = new Set(['与', '和', '的', '及', '等', '类', '型', '其他', '原文', '相关', '问题', '解析', '指南', '记录', '专题', '工具', '监控', '类型']);
function keywordsOf(s) {
  const words = new Set();
  for (const src of s.sources ?? []) {
    const base = String(src).replace(/[（(].*?[)）]/g, '');
    if (base.length >= 2 && base.length <= 8 && !STOP.has(base)) words.add(base);
    for (let i = 0; i + 2 <= base.length; i++) {
      const g = base.slice(i, i + 2);
      if (!STOP.has(g)) words.add(g);
    }
  }
  for (let i = 0; i + 2 <= s.name.length; i++) {
    const g = s.name.slice(i, i + 2);
    if (!STOP.has(g)) words.add(g);
  }
  return [...words].filter((w) => w.length >= 2 && !/^[A-Za-z]{2}$/.test(w) || /^[A-Za-z]{2,}$/.test(w));
}

const newIdx = catalog.filter((c) => c.idx >= 2446).map((c) => c.idx);
const added = [];
for (const s of specFile.specialties) {
  const kws = keywordsOf(s);
  const specIdx = new Set(s.members ?? []);
  for (const i of newIdx) {
    if (specIdx.has(i)) continue;
    if (parentOf.get(i) !== s.parent) continue;
    const rec = recs[i];
    if (!rec) continue;
    const first = (rec.messages.find((m) => m.role === 'user')?.text ?? '').replace(/\s+/g, ' ');
    const blob = `${rec.title} ${first}`;
    const hit = kws.find((k) => blob.includes(k));
    if (!hit) continue;
    s.members = [...(s.members ?? []), i].sort((a, b) => a - b);
    added.push({ specialty: s.key, idx: i, title: rec.title, hit });
  }
}

console.log(`新增进专题的会话 ${added.length} 条：`);
for (const a of added) console.log(`  + ${a.specialty}  ← idx ${a.idx} 「${a.title}」（命中「${a.hit}」）`);
if (!added.length) console.log('（本轮没有需要补进专题的会话）');

// 重写专题页
const dirName = (k) => k.replace(/[\\/:*?"<>|]/g, '_');
const specOut = JSON.parse(readFileSync(join(KB, 'specialties.json'), 'utf8'));
for (const s of specFile.specialties) {
  const dir = join(KB, 'topics', s.parent, dirName(s.key));
  mkdirSync(dir, { recursive: true });
  const rows = (s.members ?? []).map((i) => catalog[i]).filter(Boolean).sort((a, b) => String(a.inserted_at).localeCompare(String(b.inserted_at)));
  const chars = rows.reduce((a, c) => a + c.chars, 0);
  const turns = rows.reduce((a, c) => a + c.turns, 0);
  const L = [
    `# ${s.name}`,
    '',
    `> ${s.desc ?? ''}`,
    '',
    `- **所属一级话题**：[${final.topics.find((t) => t.key === s.parent)?.name}](../README.md)`,
    `- **会话数**：${rows.length}`,
    `- **时间跨度**：${String(rows[0]?.inserted_at).slice(0, 10)} → ${String(rows[rows.length - 1]?.inserted_at).slice(0, 10)}`,
    `- **规模**：${chars.toLocaleString('en-US')} 字符，约 ${turns} 轮对话`,
    '',
    '## 会话清单',
    '',
    '| # | 日期 | 消息 | 标题 | 文件 |',
    '|---|------|------|------|------|',
    ...rows.map((c, n) => `| ${n + 1} | ${String(c.inserted_at).slice(0, 10)} | ${c.messages} | ${String(c.title || '(无标题)').replace(/\|/g, '\\|')} | [\`${c.path}\`](../../../${c.path}) |`),
    '',
  ];
  writeFileSync(join(dir, 'README.md'), L.join('\n'), 'utf8');
  const out = specOut.topics.find((t) => t.key === s.key);
  if (out) {
    out.count = rows.length;
    out.chars = chars;
    out.turns = turns;
    out.from = String(rows[0]?.inserted_at).slice(0, 10);
    out.to = String(rows[rows.length - 1]?.inserted_at).slice(0, 10);
    out.members = s.members;
  }
}
writeFileSync(join(KB, 'specialties.json'), JSON.stringify(specOut, null, 1), 'utf8');
writeFileSync('topics/specialties.json', JSON.stringify(specFile, null, 1), 'utf8');
console.log('\n已重写专题页与 specialties.json');
