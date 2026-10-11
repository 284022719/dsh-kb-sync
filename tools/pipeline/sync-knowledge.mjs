// 把控制台里的内容同步成助手可读的文件。
//
//   node sync-knowledge.mjs
//
// 1) knowledge.json  -> D:\dsh\health\KNOWLEDGE.md   （行动结论，助手每次回答前读它）
// 2) corrections.json 覆盖层 -> 临时给 facts.json 打补丁 -> 重跑档案生成 -> 还原 facts.json
//    （保证原始提取永不被破坏，同时让修正体现在 PROFILE/METRICS/SYMPTOMS 等文件里）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HEALTH_DIR, PIPE_DIR } from './_paths.mjs';

const HEALTH = resolve(HEALTH_DIR);
// health-console 仍在 D:\dsh\控制台中心\health-console（插件外的既有控制台）。
const HEALTH_CONSOLE_DIR = resolve(PIPE_DIR, '..', '..', '..', 'health-console');
const KNOW = join(HEALTH, 'knowledge.json');
const CORR = join(HEALTH, 'corrections.json');
const FACTS = join(HEALTH, 'facts.json');
const KB = join(HEALTH, 'knowledge-base.md');

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);

// ---------- 1. KNOWLEDGE.md ----------
const know = readJson(KNOW, { sections: [] });
const total = know.sections.reduce((a, s) => a + s.items.length, 0);
const flagged = know.sections.flatMap((s) => s.items.map((i) => ({ s, i }))).filter((x) => x.i.status);
const edited = know.sections.flatMap((s) => s.items.map((i) => ({ s, i }))).filter((x) => x.i.editedByUser || x.i.createdByUser);

const L = [];
L.push('# 行动结论（可修改）');
L.push('');
L.push('> 这份文件是**本地控制台**的可读镜像：在控制台里改条目，这里会同步更新。');
L.push('> 每条结论都注明**依据**（个人指标 + 权威来源）。`[来源]` 给出可点开的链接。');
L.push('> 已标为「存疑」的条目说明**用户认为它不对**——请勿再据此建议，除非用户明确更正过。');
L.push('');
L.push(`- 生成时间：${know.updatedAt ?? '—'}`);
L.push(`- 条目总数：${total}（其中你手动改过 ${edited.length} 条，标记存疑 ${flagged.length} 条）`);
L.push('');
if (flagged.length) {
  L.push('## ⚠️ 已被标记为存疑/错误的条目（不要使用）');
  L.push('');
  for (const { i } of flagged) L.push(`- **${i.title}**（${i.status}）${i.note ? ` — 你的批注：${i.note}` : ''}`);
  L.push('');
}
for (const s of know.sections) {
  L.push(`## ${s.title}`);
  L.push('');
  if (s.desc) L.push(`${s.desc}`);
  L.push('');
  const buckets = [...new Set(s.items.map((i) => i.bucket || '未分组'))];
  for (const b of buckets) {
    L.push(`### ${b}`);
    L.push('');
    for (const i of s.items.filter((x) => (x.bucket || '未分组') === b)) {
      const tags = [i.grade, i.editedByUser ? '用户已修改' : '', i.status ? `⚠️${i.status}` : ''].filter(Boolean).join(' · ');
      L.push(`- **${i.title}**${tags ? `　\`${tags}\`` : ''}`);
      if (i.body) L.push(`  - 怎么做：${i.body}`);
      if (i.why) L.push(`  - 依据：${i.why}`);
      if (i.basedOn?.length) L.push(`  - 涉及数据：${i.basedOn.join('；')}`);
      if (i.sources?.length) L.push(`  - 来源：${i.sources.map((x) => `[${x.title || x.url}](${x.url})`).join(' ｜ ')}`);
      if (i.note) L.push(`  - 你的批注：${i.note}`);
    }
    L.push('');
  }
}
writeFileSync(join(HEALTH, 'KNOWLEDGE.md'), L.join('\n'), 'utf8');
console.log(`KNOWLEDGE.md: ${total} 条（改过 ${edited.length}，存疑 ${flagged.length}）`);

// ---------- 3. 顺带刷新「一页总览」 ----------
const ov = join(HEALTH_CONSOLE_DIR, 'make-overview.mjs');
if (existsSync(ov)) {
  const r2 = spawnSync(process.execPath, [ov, HEALTH], { encoding: 'utf8', cwd: dirname(ov) });
  const line = (r2.stdout ?? '').split('\n')[1];
  console.log(`一页总览已刷新${line ? `　（${line.trim()}）` : r2.status === 0 ? '' : '（失败）'}`);
  if (r2.status !== 0) console.log((r2.stderr ?? '').slice(-800));
}

// ---------- 2. 用修正层重新生成档案文件 ----------
// build-health-profile 会读取 corrections.json 应用用户修正，并给每条事实写稳定 id。
const corr = readJson(CORR, { facts: {} });
const corrIds = Object.keys(corr.facts ?? {});
const r = spawnSync(process.execPath, [join(PIPE_DIR, 'build-health-profile.mjs'), HEALTH], {
  encoding: 'utf8',
  cwd: PIPE_DIR,
});
if (r.status === 0) {
  const line = (r.stdout ?? '').split('\n').find((x) => x.includes('已应用用户修正'));
  console.log(`档案已按修正重新生成${line ? `　（${line.trim()}）` : ''}`);
  if (!corrIds.length) console.log('（当前没有事实修正）');
} else {
  console.log('档案生成失败：');
  console.log((r.stderr ?? '').slice(-1500));
  process.exitCode = 1;
}
