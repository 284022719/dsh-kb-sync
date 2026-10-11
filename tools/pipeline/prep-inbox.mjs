// 准备 headless 的输入收件箱：把判断所需的一切都放进工作区内的 sync\inbox\。
//
//   node prep-inbox.mjs
//
// 为什么要有这一步：headless 跑在 workspace-write 沙箱里，工作区是
// `<data\import>`（迁移前是 D:\dsh\deepseek-import）。它读不到工作区外的东西吗？
// 其实读得到（只读不受限），但把所有输入集中一处能让提示词更简单、也让每次运行的输入可事后复查。
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { IMPORT_DIR, PIPE_DIR, INBOX_DIR, OUT_DIR, KB_DIR, HEALTH_DIGEST, FINANCE_DIGEST, UPDATE_NEW_ITEMS } from './_paths.mjs';

const WS = IMPORT_DIR;
const INBOX = INBOX_DIR;
const OUT = OUT_DIR;

// 清空并重建（每次运行都要干净，否则残留文件会污染判断）
for (const d of [INBOX, OUT]) {
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}

const log = [];

// 1) 重新生成归类输入（update-new-items.tsv + update-topic-keys.tsv）
try {
  execFileSync(process.execPath, [join(PIPE_DIR, 'prep-update-topics.mjs')], { cwd: PIPE_DIR, encoding: 'utf8', stdio: 'pipe' });
  log.push('prep-update-topics.mjs 已运行');
} catch (e) {
  log.push(`prep-update-topics.mjs 失败：${String(e.message).slice(0, 200)}`);
}

// 2) 健康摘要（脚本自己挑健康相关会话；没有就产出空摘要）
let healthOk = false;
try {
  execFileSync(process.execPath, [join(PIPE_DIR, 'prep-health-update.mjs')], { cwd: PIPE_DIR, encoding: 'utf8', stdio: 'pipe' });
  const dg = join(HEALTH_DIGEST, 'digest-20.md');
  if (existsSync(dg)) {
    const body = readFileSync(dg, 'utf8');
    // 只统计真正的会话节（## 开头）
    const sections = (body.match(/^## /gm) ?? []).length;
    if (sections > 0) {
      copyFileSync(dg, join(INBOX, 'health-digest.md'));
      healthOk = true;
      log.push(`健康摘要已生成：${sections} 个会话`);
    } else {
      log.push('健康摘要为空（本轮无健康相关会话）');
    }
  }
} catch (e) {
  log.push(`prep-health-update.mjs 失败（不影响其余步骤）：${String(e.message).slice(0, 200)}`);
}

// 3) 财务摘要（与健康同规则：只挑本轮变化；没有就产出空摘要）
let finOk = false;
try {
  execFileSync(process.execPath, [join(PIPE_DIR, 'prep-finance-update.mjs')], { cwd: PIPE_DIR, encoding: 'utf8', stdio: 'pipe' });
  const fd = join(FINANCE_DIGEST, 'digest-20.md');
  if (existsSync(fd)) {
    const body = readFileSync(fd, 'utf8');
    const sections = (body.match(/^## /gm) ?? []).length;
    if (sections > 0) {
      copyFileSync(fd, join(INBOX, 'finance-digest.md'));
      finOk = true;
      log.push(`财务摘要已生成：${sections} 个会话`);
    } else {
      log.push('财务摘要为空（本轮无财务相关会话）');
    }
  }
} catch (e) {
  log.push(`prep-finance-update.mjs 失败（不影响其余步骤）：${String(e.message).slice(0, 200)}`);
}

// 4) 新会话清单
const itemsSrc = UPDATE_NEW_ITEMS;
let itemCount = 0;
if (existsSync(itemsSrc)) {
  const j = JSON.parse(readFileSync(itemsSrc, 'utf8'));
  itemCount = (j.items ?? []).length;
  writeFileSync(join(INBOX, 'update-new-items.json'), JSON.stringify(j, null, 1), 'utf8');
  log.push(`新会话清单：${itemCount} 条`);
} else {
  writeFileSync(join(INBOX, 'update-new-items.json'), JSON.stringify({ items: [] }, null, 1), 'utf8');
  log.push('未找到 update-new-items.json，按 0 条处理');
}

// 4b) 清单的 TSV 版 —— **这是提示词里真正喂给模型的那张表**。
// ⚠️ 2026-10-12 踩过：这一步曾经漏掉，于是收件箱里只有 .json、没有 .tsv，
// 而 extract-prompt 读的是 update-new-items.tsv；模型据此认为"本轮没有新增会话"、
// 返回空 assignments，apply 再以「缺少 update-topics.json」拒收 —— 全程不报错，
// 只是安静地什么都没归类。判据：收件箱里 .tsv 与 .json 的条数必须一致。
const itemsTsv = join(WS, 'update-new-items.tsv');
if (existsSync(itemsTsv)) {
  copyFileSync(itemsTsv, join(INBOX, 'update-new-items.tsv'));
  const rows = readFileSync(itemsTsv, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
  log.push(`归类输入表：${rows} 行`);
  if (rows !== itemCount) log.push(`⚠️ update-new-items.tsv 有 ${rows} 行，与清单的 ${itemCount} 条不一致（不是本轮生成的那份？）`);
} else {
  log.push('⚠️ 缺少 update-new-items.tsv（归类任务会没有输入）');
}

// 5) 话题清单
const tk = join(WS, 'update-topic-keys.tsv');
if (existsSync(tk)) copyFileSync(tk, join(INBOX, 'update-topic-keys.tsv'));

// 6) 专题清单（从知识库里的计算文件生成 key/parent/desc）
const specSrc = join(KB_DIR, 'specialties.json');
if (existsSync(specSrc)) {
  const spec = JSON.parse(readFileSync(specSrc, 'utf8'));
  const rows = ['key\tparent\tdesc'];
  for (const t of spec.topics ?? []) {
    rows.push([t.key, t.parent, String(t.desc ?? '').replace(/[\t\r\n]/g, ' ')].join('\t'));
  }
  writeFileSync(join(INBOX, 'specialty-keys.tsv'), rows.join('\n'), 'utf8');
  log.push(`专题清单：${(spec.topics ?? []).length} 个`);
} else {
  writeFileSync(join(INBOX, 'specialty-keys.tsv'), 'key\tparent\tdesc\n', 'utf8');
  log.push('未找到 specialties.json，专题清单为空');
}

// 7) 记录本轮上下文，供 headless 与 apply 共用
writeFileSync(
  join(INBOX, '_meta.json'),
  JSON.stringify({ preparedAt: new Date().toISOString(), itemCount, healthDigest: healthOk, financeDigest: finOk, log }, null, 1),
  'utf8',
);

console.log('收件箱已准备：');
for (const l of log) console.log('  · ' + l);
console.log(`  输出目录（待 headless 填写）：${OUT}`);
