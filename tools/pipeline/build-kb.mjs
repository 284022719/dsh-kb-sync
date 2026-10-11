// Assemble the final topic-organised knowledge base.
//
//   node build-kb.mjs --src knowledge --out ..\dsh-kb-sync\data\kb
//
// Input : topics/final-topics.json  { topics:[{key,name,desc,members:[idx]}], noise:[idx] }
//         knowledge/catalog.json    (idx order = catalog order = conversations.jsonl order)
//         knowledge/conversations/  (2446 rendered markdown files)
// Output: <out>/README.md, <out>/topics/<key>/README.md, <out>/topics.json,
//         <out>/conversations/ (moved), <out>/catalog.*, <out>/tools/search.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, cpSync, readdirSync, linkSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { PIPE_DIR, TOPICS_DIR, KNOWLEDGE, KB_DIR } from './_paths.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const SRC = resolve(arg('--src', KNOWLEDGE));
const OUT = resolve(arg('--out', KB_DIR));

const final = JSON.parse(readFileSync(join(TOPICS_DIR, 'final-topics.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(SRC, 'catalog.json'), 'utf8'));
const recs = readFileSync(join(SRC, 'conversations.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

if (catalog.length !== recs.length) throw new Error(`catalog(${catalog.length}) != jsonl(${recs.length})`);
const idxOf = new Map();
catalog.forEach((c, i) => idxOf.set(c.id, i));

console.log(`source: ${SRC}`);
console.log(`target: ${OUT}`);
console.log(`conversations: ${catalog.length}`);

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'topics'), { recursive: true });

// --- move the conversation markdown into the KB (once) ---
if (!existsSync(join(OUT, 'conversations'))) {
  renameSync(join(SRC, 'conversations'), join(OUT, 'conversations'));
  console.log('moved conversations/');
} else {
  console.log('conversations/ already present, leaving as-is');
}
// 发布这三个「逐字节相同」的文件：优先硬链接去重（同一卷；conversations.jsonl 省 58 MB）。
// ⚠️ **不能**改回无条件 cpSync —— 那会把 knowledge-base 里的硬链接换成新副本，静默变回两份。
// 而且「已是同一 inode」时必须跳过：cpSync 会截断重写目标，而目标与源是同一个 inode，
// 等于让源文件自己写自己。详见 AGENTS.md「个人历史档案」一节。
for (const f of ['catalog.json', 'catalog.tsv', 'conversations.jsonl']) {
  const src = join(SRC, f);
  const dst = join(OUT, f);
  if (!existsSync(src)) continue;
  try {
    if (existsSync(dst) && statSync(dst).ino === statSync(src).ino) {
      console.log(`${f}: 已是硬链接，跳过`);
      continue;
    }
    if (existsSync(dst)) unlinkSync(dst);
    linkSync(src, dst);
    console.log(`${f}: 硬链接`);
  } catch (e) {
    cpSync(src, dst);
    console.log(`${f}: 拷贝（硬链接不可用：${e.code || e.message}）`);
  }
}
mkdirSync(join(OUT, 'tools'), { recursive: true });
for (const f of ['search.mjs']) cpSync(join(PIPE_DIR, 'attic', f), join(OUT, 'tools', f));

// --- per-topic pages ---
const human = (n) => n.toLocaleString('en-US');
const topicsOut = [];
const assigned = new Set();

function buildTopic({ key, name, desc, members }) {
  const rows = members
    .map((i) => ({ i, c: catalog[i], r: recs[i] }))
    .filter((x) => x.c)
    .sort((a, b) => String(a.c.inserted_at).localeCompare(String(b.c.inserted_at)));
  for (const r of rows) assigned.add(r.i);
  const chars = rows.reduce((a, r) => a + r.c.chars, 0);
  const turns = rows.reduce((a, r) => a + r.c.turns, 0);
  const dates = rows.map((r) => String(r.c.inserted_at).slice(0, 10)).sort();
  const models = [...new Set(rows.flatMap((r) => r.c.models))];
  const firstReq = (r) => (r.r.messages.find((m) => m.role === 'user')?.text ?? '').replace(/\s+/g, ' ').trim();

  const L = [];
  L.push(`# ${name}`);
  L.push('');
  if (desc) L.push(`> ${desc}`);
  L.push('');
  L.push(`- **会话数**：${rows.length}`);
  L.push(`- **时间跨度**：${dates[0] ?? '—'} → ${dates[dates.length - 1] ?? '—'}`);
  L.push(`- **规模**：${human(chars)} 字符，约 ${human(turns)} 轮对话`);
  L.push(`- **涉及模型**：${models.join(', ') || '—'}`);
  L.push('');
  L.push('## 会话清单');
  L.push('');
  L.push('| # | 日期 | 消息 | 标题 | 文件 |');
  L.push('|---|------|------|------|------|');
  rows.forEach((r, n) => {
    const title = (r.c.title || '(无标题)').replace(/\|/g, '\\|');
    L.push(`| ${n + 1} | ${String(r.c.inserted_at).slice(0, 10)} | ${r.c.messages} | ${title} | [\`${r.c.path}\`](../../${r.c.path}) |`);
  });
  L.push('');
  L.push('## 各会话首问（便于快速定位）');
  L.push('');
  for (const r of rows) {
    const q = firstReq(r);
    if (q) L.push(`- **${String(r.c.inserted_at).slice(0, 10)}** ｜ ${r.c.title} — ${q.slice(0, 120)}`);
  }
  L.push('');
  return { text: L.join('\n'), rows, chars, turns, dates };
}

const dirName = (key) => key.replace(/[\\/:*?"<>|]/g, '_');

for (const t of final.topics) {
  const key = dirName(t.key ?? t.name);
  const dir = join(OUT, 'topics', key);
  mkdirSync(dir, { recursive: true });
  const built = buildTopic({ ...t, key });
  writeFileSync(join(dir, 'README.md'), built.text, 'utf8');
  const files = built.rows.map((r) => `../../${r.c.path}`).join('\n');
  writeFileSync(join(dir, 'files.txt'), files + '\n');
  topicsOut.push({
    key,
    name: t.name,
    desc: t.desc ?? '',
    subtopics: t.subtopics ?? [],
    session: t.session !== false,
    count: built.rows.length,
    chars: built.chars,
    turns: built.turns,
    from: built.dates[0] ?? '',
    to: built.dates[built.dates.length - 1] ?? '',
    readme: `topics/${key}/README.md`,
    members: built.rows.map((r) => r.i),
  });
  console.log(`  ${String(built.rows.length).padStart(4)}  ${key}`);
}

const noise = final.noise ?? [];
const unassigned = [];
for (let i = 0; i < catalog.length; i++) if (!assigned.has(i)) unassigned.push(i);

// --- global index ---
const totalChars = catalog.reduce((a, c) => a + c.chars, 0);
const allDates = catalog.map((c) => String(c.inserted_at).slice(0, 10)).filter(Boolean).sort();
const spanFrom = allDates[0] ?? '—';
const spanTo = allDates[allDates.length - 1] ?? '—';
const G = [];
G.push('# DeepSeek 对话知识库');
G.push('');
G.push(`从 DeepSeek 网页端（chat.deepseek.com）迁移到本地的全部对话，按话题组织。`);
G.push('');
G.push(`- **会话总数**：${human(catalog.length)}`);
G.push(`- **总规模**：约 ${human(totalChars)} 字符`);
G.push(`- **时间跨度**：${spanFrom} → ${spanTo}`);
G.push(`- **数据来源**：DeepSeek 官方「导出所有历史数据」（conversations.json）`);
G.push(`- **生成时间**：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
G.push('');
G.push('## 目录结构');
G.push('');
G.push('```');
G.push('knowledge-base/');
G.push('├─ README.md            ← 本文件，总索引');
G.push('├─ topics/              ← 话题目录，每个话题一个 README（会话清单 + 首问速查）');
G.push('├─ conversations/       ← 全部会话原文，一个会话一个 Markdown');
G.push('├─ catalog.tsv          ← 全量目录（日期/轮数/字符数/模型/标题/路径）');
G.push('├─ conversations.jsonl  ← 机器可读的全量结构化数据');
G.push('└─ tools/search.mjs     ← 全文检索工具');
G.push('```');
G.push('');
G.push('## 话题总览');
G.push('');
G.push('| # | 话题 | 会话数 | 轮数 | 时间跨度 | 入口 |');
G.push('|---|------|--------|------|----------|------|');
topicsOut
  .slice()
  .sort((a, b) => b.count - a.count)
  .forEach((t, i) => {
    G.push(`| ${i + 1} | **${t.name}** | ${t.count} | ${t.turns} | ${t.from} ~ ${t.to} | [进入](${t.readme}) |`);
  });
G.push('');
G.push('## 怎么用');
G.push('');
G.push('- 全文检索：`node tools/search.mjs "关键词"`（可加 `--limit 30 --context 2 --topic 健康`）');
G.push('- 统计：`node tools/search.mjs --stats`');
G.push('- 按话题浏览：进 `topics/<话题>/README.md`，里面有会话清单与每条会话的首问');
G.push('- 精读原文：`conversations/` 下按日期命名的 Markdown，保留完整提问、思考过程、回答与联网检索记录');
G.push(`- 零散杂问：${topicsOut.find((t) => t.key.startsWith('99'))?.count ?? 0} 条无明确主题的会话单独放在 \`topics/99-零散杂问/\``);
G.push('');
G.push('## 专题（细分入口）');
G.push('');
const specFile = join(OUT, 'specialties.json');
if (existsSync(specFile)) {
  const spec = JSON.parse(readFileSync(specFile, 'utf8')).topics.slice().sort((a, b) => b.chars - a.chars);
  G.push(`一级话题偏粗时，可以从这 ${spec.length} 个专题切入——它们是各一级话题内部成规模的细粒度簇（成员由「簇成员 ∩ 复核后成员」机械求交集得出）：`);
  G.push('');
  G.push('| 专题 | 所属一级话题 | 会话数 | 规模 | 时间跨度 | 入口 |');
  G.push('|------|--------------|--------|------|----------|------|');
  for (const s of spec)
    G.push(`| **${s.name}** | ${s.parentName} | ${s.count} | ${Math.round(s.chars / 1000)}k 字 | ${s.from} ~ ${s.to} | [进入](topics/${s.parent}/${s.key}/README.md) |`);
  G.push('');
} else {
  G.push('（未生成专题层：运行 `node build-specialties.mjs` 后重建本页）');
  G.push('');
}
G.push('## 在 DSH 里继续对话');
G.push('');
G.push('本知识库在 DSH 里注册成**两个工作区**，共 42 个已经载入对应导览、可以直接接着聊的会话：');
G.push('');
G.push('- **知识库·话题**（工作目录 = 本知识库根目录）：每个一级话题一个会话，标题 `【知识库】话题名`');
G.push('- **知识库·专题**（工作目录 = `topics/`）：每个专题一个会话，标题 `【专题】专题名`');
G.push('');
for (const t of topicsOut.filter((x) => x.session !== false).sort((a, b) => (a.key > b.key ? 1 : -1)))
  G.push(`- 【知识库】${t.name} — ${t.count} 个会话，${t.from} ~ ${t.to}`);
G.push('');
G.push('这些会话的工作目录就是知识库（或它的 `topics/`），所以可以直接在对话里让我读 `topics/…`、搜 `conversations/`、跑 `tools/search.mjs`，而不用把几千万字原文塞进上下文。');
G.push('');
G.push('## 迁移过程与数据质量');
G.push('');
G.push('- **来源**：DeepSeek 网页端「导出所有历史数据」生成的官方压缩包（`conversations.json`，含全部会话的 `mapping` 消息树）。');
G.push('- **重建主路径**：导出里每条会话是一棵树（含重新生成产生的分支）。脚本按「无子节点的叶子」确定当前主线程——注意**不能用时间戳找叶子**，官方导出里模型回答的时间戳常与提问完全相同，用时间戳会静默丢掉最后一条回答。');
G.push('- **话题归属**：2446 个会话先按时间切成 10 批并行聚类，再合并成互斥的一级话题；随后又做了一轮**全量人工复核**，逐条比对标题／首问／首答，改判 401 条（约 16%），其中第 07 批错配率高达 42%。');
G.push('- **已知数据问题**：官方导出里**少量会话的标题与内容不符**（例如标题「什么是多巴胺女孩」，正文通篇在聊 3D 打印）。检索与话题归属均以正文为准，引用标题时请留意。');
G.push('- **已知取舍**：为保证可用性，话题归入一级话题时做了合并（如各类「健康 X」合并为健康医疗）；极少数跨领域会话必定存在更合适的归属，可按需手工搬运。');
G.push('');
writeFileSync(join(OUT, 'README.md'), G.join('\n'), 'utf8');

writeFileSync(
  join(OUT, 'topics.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), total: catalog.length, totalChars, topics: topicsOut, noise: [...new Set([...noise, ...unassigned])] }, null, 1),
);

console.log(`\nassigned: ${assigned.size} / ${catalog.length}`);
if (unassigned.length) console.log(`unassigned (${unassigned.length}) -> treated as noise: ${unassigned.slice(0, 20).join(',')}...`);
console.log(`wrote ${OUT}\\README.md, topics.json, ${topicsOut.length} topic pages`);
