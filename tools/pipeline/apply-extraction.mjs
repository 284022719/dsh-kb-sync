// 应用 headless 的产出：校验 sync\out\ 里的 JSON，落到位，然后由调用方跑构建脚本。
//
//   node sync/apply-extraction.mjs
//
// 设计原则：headless 只产出「判断」（JSON）；校验与应用都在这份**不受沙箱限制**的
// 脚本里做。任何校验不通过都不落盘，并以非零退出码报告，让上层弹窗告警。
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IMPORT_DIR, INBOX_DIR, OUT_DIR, LOG_DIR, HEALTH_FACTS, FIN_DIR, UPDATE_TOPICS, SPECIALTIES_MAP } from './_paths.mjs';

const WS = IMPORT_DIR;
const OUT = OUT_DIR;
const INBOX = INBOX_DIR;

const problems = [];   // 硬失败：不落盘、非零退出、上层弹窗告警
const warnings = [];   // 软问题：跳过个别记录但继续落盘（候选类数据不该因一条坏记录全丢）
const applied = [];
const rd = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    problems.push(`${p} 不是合法 JSON：${String(e.message).slice(0, 120)}`);
    return null;
  }
};

const today = new Date().toISOString().slice(0, 10);

// ---------- 1) 话题归类 ----------
const topicsFile = join(OUT, 'update-topics.json');
if (!existsSync(topicsFile)) {
  problems.push('缺少 update-topics.json（headless 未产出）');
} else {
  const out = rd(topicsFile);
  const items = existsSync(join(INBOX, 'update-new-items.json'))
    ? JSON.parse(readFileSync(join(INBOX, 'update-new-items.json'), 'utf8')).items ?? []
    : [];
  const validKeys = new Set(
    readFileSync(join(INBOX, 'update-topic-keys.tsv'), 'utf8')
      .split('\n')
      .slice(1)
      .map((l) => l.split('\t')[0])
      .filter(Boolean),
  );
  if (out) {
    const asg = out.assignments ?? [];
    const got = new Set(asg.map((a) => a.idx));
    const want = new Set(items.map((x) => x.idx));
    const missing = [...want].filter((i) => !got.has(i));
    const extra = [...got].filter((i) => !want.has(i));
    const illegal = asg.filter((a) => !validKeys.has(a.topic)).map((a) => `${a.idx}:${a.topic}`);

    if (missing.length) problems.push(`归类缺 ${missing.length} 条：${missing.slice(0, 10).join(',')}`);
    if (extra.length) problems.push(`归类多出 ${extra.length} 条：${extra.slice(0, 10).join(',')}`);
    if (illegal.length) problems.push(`非法话题 ${illegal.length} 个：${illegal.slice(0, 5).join(' ')}`);

    if (!problems.length) {
      writeFileSync(UPDATE_TOPICS, JSON.stringify(out, null, 1), 'utf8');
      applied.push(`归类 ${asg.length} 条 → update-topics.json`);
    }
  }
}

// ---------- 2) 健康事实 ----------
const hfFile = join(OUT, 'health-facts.json');
if (existsSync(hfFile)) {
  const hf = rd(hfFile);
  if (hf) {
    const facts = hf.facts ?? [];
    const good = facts.filter((f) => f.kind && f.label && f.evidence && f.status);
    const bad = facts.length - good.length;
    if (bad) warnings.push(`健康事实有 ${bad} 条缺必填字段（kind/label/evidence/status），已跳过，其余照常落盘`);
    if (good.length) {
      const dir = HEALTH_FACTS;
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, `manual-${today}.json`);
      // 已存在同一天的则改名，避免覆盖手工补录
      const finalDest = existsSync(dest) ? join(dir, `headless-${today}-${Date.now()}.json`) : dest;
      writeFileSync(finalDest, JSON.stringify({ ...hf, facts: good }, null, 1), 'utf8');
      applied.push(`健康事实 ${good.length} 条 → ${finalDest.split('\\').pop()}`);
    } else {
      applied.push('健康事实：本轮无有效条目');
    }
  }
} else {
  applied.push('健康事实：headless 未产出该文件');
}

// ---------- 3) 财务候选 → 只进候选区，绝不自动入账 ----------
// 为什么只写候选：台账里每个数字都带 asOf 与出处，且同一指标的多口径全部保留。
// 让 LLM 直接改 profile.json / debts.json 会破坏这套规矩，也会让"钱"的数字悄悄错掉。
// 所以这里只追加到 finance/data/candidates.jsonl，由用户在看板里确认后才入账。
const ffFile = join(OUT, 'finance-facts.json');
if (existsSync(ffFile)) {
  const ff = rd(ffFile);
  if (ff) {
    const cands = ff.candidates ?? [];
    const good = cands.filter((c) => c.topic && c.label && c.evidence && c.status && c.asOf);
    const bad = cands.length - good.length;
    if (bad) warnings.push(`财务候选有 ${bad} 条缺必填字段（topic/label/evidence/status/asOf），已跳过，其余照常落盘`);
    if (good.length) {
      const finData = join(FIN_DIR, 'data');
      mkdirSync(finData, { recursive: true });
      const jl = join(finData, 'candidates.jsonl');
      const seen = existsSync(jl)
        ? new Set(
            readFileSync(jl, 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((l) => { try { return JSON.parse(l).dedupeKey; } catch { return null; } })
              .filter(Boolean),
          )
        : new Set();
      const lines = [];
      let dup = 0;
      for (const c of good) {
        const key = [c.topic, c.label, c.amount ?? c.value ?? '', c.asOf, c.source].join('|');
        if (seen.has(key)) { dup++; continue; }
        seen.add(key);
        lines.push(JSON.stringify({ ...c, dedupeKey: key, extractedAt: new Date().toISOString(), batch: ff.batch ?? '' }));
      }
      if (lines.length) {
        const prev = existsSync(jl) ? readFileSync(jl, 'utf8') : '';
        writeFileSync(jl, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + lines.join('\n') + '\n', 'utf8');
      }
      applied.push(`财务候选 ${lines.length} 条 → finance/data/candidates.jsonl${dup ? `（${dup} 条重复已跳过）` : ''}　⚠️ 待你确认后才入账`);
    } else {
      applied.push('财务候选：本轮无（0 条）');
    }
  }
} else {
  applied.push('财务候选：headless 未产出该文件');
}

// ---------- 4) 专题建议 → 覆盖层（供 map-specialties.mjs 读取） ----------
const spFile = join(OUT, 'specialty-suggestions.json');
if (existsSync(spFile)) {
  const sp = rd(spFile);
  if (sp) {
    const sugg = sp.suggestions ?? [];
    if (sugg.length) {
      // 校验 parent 是否与该 idx 的话题一致
      const topicsOut = existsSync(UPDATE_TOPICS)
        ? JSON.parse(readFileSync(UPDATE_TOPICS, 'utf8')).assignments ?? []
        : [];
      const topicOf = new Map(topicsOut.map((a) => [a.idx, a.topic]));
      const specKeys = new Map(
        readFileSync(join(INBOX, 'specialty-keys.tsv'), 'utf8')
          .split('\n')
          .slice(1)
          .map((l) => l.split('\t'))
          .filter((r) => r[0])
          .map((r) => [r[0], r[1]]),
      );
      const ok = [];
      for (const s of sugg) {
        const parent = specKeys.get(s.specialty);
        const topic = topicOf.get(s.idx);
        if (!parent) problems.push(`专题建议 ${s.idx}：未知专题 ${s.specialty}`);
        else if (topic !== parent) problems.push(`专题建议 ${s.idx}：话题 ${topic} ≠ 专题父话题 ${parent}`);
        else ok.push({ idx: s.idx, specialty: s.specialty, why: s.why ?? '' });
      }
      if (ok.length) {
        const overlayPath = SPECIALTIES_MAP;
        const overlay = existsSync(overlayPath) ? JSON.parse(readFileSync(overlayPath, 'utf8')) : { entries: [] };
        overlay.entries ??= [];
        const have = new Set(overlay.entries.map((e) => e.idx));
        for (const e of ok) if (!have.has(e.idx)) overlay.entries.push({ ...e, addedAt: new Date().toISOString() });
        overlay.updatedAt = new Date().toISOString();
        writeFileSync(overlayPath, JSON.stringify(overlay, null, 1), 'utf8');
        applied.push(`专题建议 ${ok.length} 条 → specialties-map.json`);
      }
      const rejected = sugg.length - ok.length;
      if (rejected) applied.push(`专题建议 ${rejected} 条未通过校验，已丢弃`);
    } else {
      applied.push('专题建议：本轮无');
    }
  }
}

// ---------- 5) 摘要 ----------
const sumFile = join(OUT, 'summary.md');
if (existsSync(sumFile)) {
  const dir = LOG_DIR;
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `extract-${today}.md`);
  copyFileSync(sumFile, dest);
  applied.push(`摘要 → sync/logs/extract-${today}.md`);
} else {
  applied.push('摘要：headless 未产出');
}

// ---------- 报告 ----------
console.log('应用结果：');
for (const a of applied) console.log('  ✓ ' + a);
if (warnings.length) {
  console.log('跳过（不阻塞）：');
  for (const w of warnings) console.log('  ! ' + w);
}
if (problems.length) {
  console.log('问题：');
  for (const p of problems) console.log('  ✗ ' + p);
  console.log('\n结论：存在硬问题，归类文件未落盘（其余已尽力应用）。');
  process.exit(2);
}
console.log('\n结论：全部校验通过 ✔');
