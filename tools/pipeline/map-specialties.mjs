// 把增量新增的会话补进「专题」层——用**显式映射表**而非关键词猜测。
//
//   node map-specialties.mjs
//
// 关键约定（踩过坑）：
//   成员成员的**唯一权威**是 `knowledge-base/specialties.json`（由 build-specialties.mjs
//   从原始簇 ∩ 复核后成员算出来的）。`topics/specialties.json` 只是**策划源**
//   （key/name/parent/desc/sources），**不含 members**——早期版本误把它当成员存储写回，
//   结果把 639 条成员清成了 7 条。现在这里只读策划源，绝不写回。
//
// 为什么不用关键词自动匹配：专题主题往往是语义性的（「嗓子肿痛」不会字面包含「症状」），
// 关键词规则实测要么误塞（把「高中毕业直接就业人数」塞进「社会工作与社区治理」），要么全漏。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TOPICS_DIR, UPDATE_TOPICS, KB_DIR, SPECIALTIES_MAP, CATALOG } from './_paths.mjs';

const KB = KB_DIR;
const final = JSON.parse(readFileSync(join(TOPICS_DIR, 'final-topics.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const assign = JSON.parse(readFileSync(UPDATE_TOPICS, 'utf8'));
const store = JSON.parse(readFileSync(join(KB, 'specialties.json'), 'utf8'));   // 成员权威
const curated = JSON.parse(readFileSync(join(TOPICS_DIR, 'specialties.json'), 'utf8'));    // 只读策划源

const byIdx = new Map(catalog.map((c) => [c.idx, c]));
// 话题归属以 final-topics.json 为准（权威、跨轮次有效）。
// update-topics.json 只是**本轮**的增量输入——单靠它会让往轮的 idx 误报「没有话题归属」。
const topicOf = new Map();
for (const t of final.topics) for (const m of t.members) topicOf.set(m, t.key);
for (const a of assign.assignments ?? []) topicOf.set(a.idx, a.topic); // 本轮覆盖
const parentName = (key) => final.topics.find((t) => t.key === key)?.name ?? key;

// idx → 专题 key（逐条判定的；只写确信的，拿不准就留在一级话题里）
const MAP = {
  2454: '05-AI编程助手与工具链',
  2482: '05-AI编程助手与工具链',
  2483: '05-AI编程助手与工具链',
  2496: '06-技术概念与接口',
  2500: '07-MBTI与人格类型',
  2494: '10-股票与投资推演',
  2509: '10-股票与投资推演',
  2465: '13-手机与电脑故障排查',
  2467: '13-手机与电脑故障排查',
  2489: '13-手机与电脑故障排查',
  2446: '14-翻译与词语释义',
  2457: '14-翻译与词语释义',
  2479: '14-翻译与词语释义',
  2480: '14-翻译与词语释义',
  2447: '16-症状与用药咨询',
  2452: '16-症状与用药咨询',
  2461: '16-症状与用药咨询',
  2471: '16-症状与用药咨询',
  2472: '16-症状与用药咨询',
  2478: '16-症状与用药咨询',
  2481: '16-症状与用药咨询',
  2486: '16-症状与用药咨询',
  2487: '16-症状与用药咨询',
  2493: '16-症状与用药咨询',
  2498: '16-症状与用药咨询',
  2499: '16-症状与用药咨询',
  2501: '16-症状与用药咨询',
  2451: '17-猫狗行为与养护',
  2466: '17-猫狗行为与养护',
  2477: '17-猫狗行为与养护',
  2485: '17-猫狗行为与养护',
  2453: '18-增重增肌与身体形象',
  2455: '18-增重增肌与身体形象',
  2460: '18-增重增肌与身体形象',
  2464: '18-增重增肌与身体形象',
  2490: '18-增重增肌与身体形象',
  2502: '18-增重增肌与身体形象',
  2507: '18-增重增肌与身体形象',
  // —— 第二轮增量（2026-10-07）——
  2513: '14-翻译与词语释义', // 英文格言翻译
  2515: '13-手机与电脑故障排查', // 微信群好友查询方法
  2516: '05-AI编程助手与工具链', // DSH 兼容 Claude
  2518: '18-增重增肌与身体形象', // 自拍替代方案（形象）
  // 未归入专题：2514 小熊猫（非猫狗宠物）、2517 SD 卡、2519 直播配置——没有对应专题，留在一级话题
  // —— 第三轮增量（2026-10-09）——
  2521: '14-翻译与词语释义', // 碧蓝航线广告牌翻译
  2524: '16-症状与用药咨询', // 血糖与饥饿机制（健康医疗）
  // 未归入专题：2520 抚养权（法律，无对应专题）、2522 choker 需求分析（商业）、
  //             2523 deepin 桌面（话题 02 ≠ 技术概念专题的父话题 04）、2525 小米监控当摄像头（非故障排查）、2526 毒品科普
};

// ---------- 覆盖层：headless 每轮建议的专题归属 ----------
// 代码里的 MAP 是**人工复核过的基线**；headless 无法写这个文件（它在沙箱里），
// 只能把建议写到 sync/out/，再由 sync/apply-extraction.mjs 校验后追加到这里。
// 校验项：专题存在 + 该会话的一级话题正好等于该专题的 parent（与 MAP 同规则）。
if (existsSync(SPECIALTIES_MAP)) {
  try {
    const overlay = JSON.parse(readFileSync(SPECIALTIES_MAP, 'utf8'));
    let n = 0;
    for (const e of overlay.entries ?? []) {
      if (e.idx && e.specialty && MAP[e.idx] === undefined) {
        MAP[e.idx] = e.specialty;
        n++;
      }
    }
    if (n) console.log(`覆盖层生效：新增 ${n} 条来自 headless 的专题建议（specialties-map.json）`);
  } catch (err) {
    console.log(`⚠️ specialties-map.json 读取失败，已忽略：${String(err.message).slice(0, 120)}`);
  }
}

const problems = [];
let added = 0;
for (const [idxStr, specKey] of Object.entries(MAP)) {
  const idx = Number(idxStr);
  const t = store.topics.find((x) => x.key === specKey);
  if (!t) {
    problems.push(`idx ${idx}: 专题 ${specKey} 不在成员库里`);
    continue;
  }
  const topic = topicOf.get(idx);
  if (!topic) {
    problems.push(`idx ${idx}: 没有话题归属`);
    continue;
  }
  if (topic !== t.parent) {
    problems.push(`idx ${idx}「${byIdx.get(idx)?.title}」：话题 ${topic} ≠ 专题父话题 ${t.parent}，跳过`);
    continue;
  }
  if (!t.members.includes(idx)) {
    t.members = [...t.members, idx].sort((a, b) => a - b);
    added++;
  }
}

console.log(`显式映射表 ${Object.keys(MAP).length} 条，实际并入 ${added} 条`);
if (problems.length) {
  console.log('跳过/问题：');
  for (const p of problems) console.log('  ! ' + p);
} else console.log('无问题 ✔');

for (const t of store.topics) {
  const rows = (t.members ?? []).map((i) => catalog[i]).filter(Boolean).sort((a, b) => String(a.inserted_at).localeCompare(String(b.inserted_at)));
  const chars = rows.reduce((a, c) => a + c.chars, 0);
  const turns = rows.reduce((a, c) => a + c.turns, 0);
  const dir = join(KB, 'topics', t.parent, t.key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'README.md'),
    [
      `# ${t.name}`,
      '',
      `> ${t.desc ?? ''}`,
      '',
      `- **所属一级话题**：[${parentName(t.parent)}](../README.md)`,
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
    ].join('\n'),
    'utf8',
  );
  t.count = rows.length;
  t.chars = chars;
  t.turns = turns;
  t.from = String(rows[0]?.inserted_at).slice(0, 10);
  t.to = String(rows[rows.length - 1]?.inserted_at).slice(0, 10);
}

writeFileSync(join(KB, 'specialties.json'), JSON.stringify(store, null, 1), 'utf8');
const total = new Set(store.topics.flatMap((t) => t.members ?? [])).size;
console.log(`专题共覆盖 ${total} 个会话（去重）；已重写专题页与 specialties.json`);

// 策划源保持纯净：若曾被污染（带了 members），这里去掉
let cleaned = 0;
for (const s of curated.specialties) if (s.members) { delete s.members; cleaned++; }
if (cleaned) {
  writeFileSync(join(TOPICS_DIR, 'specialties.json'), JSON.stringify(curated, null, 1), 'utf8');
  console.log(`策划源清理：去掉 ${cleaned} 个被误写入的 members 字段（它不该存成员）`);
}
