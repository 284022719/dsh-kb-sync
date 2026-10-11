// Merge the extracted personal-health facts into the health dossier.
//
//   node build-health-profile.mjs
//
// Input : health-facts/batch-*.json   (per-batch extractions, see health-batches/EXTRACT.md)
// Output: D:\dsh\health\{PROFILE,METRICS,MEDICATIONS,SYMPTOMS,PSYCHE,LIFESTYLE,OPEN-ISSUES,SOURCES}.md
//         D:\dsh\health\facts.json
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HEALTH_DIR, HEALTH_FACTS, KB_DIR } from './_paths.mjs';

const OUT = resolve(process.argv[2] ?? HEALTH_DIR);
const SRC = HEALTH_FACTS;
const KB = KB_DIR;

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'log'), { recursive: true });

// batch-* / digest-* 是 agent 提取的；manual-* 是主 agent 手工补的小增量（少量内容不必再派 agent）
const files = existsSync(SRC) ? readdirSync(SRC).filter((f) => /^(batch|digest|manual)-.*\.json$/.test(f)).sort() : [];
if (!files.length) {
  console.error('no health-facts/{batch,digest,manual}-*.json yet');
  process.exit(1);
}

const ALL = [];
const RISKS = [];
const problems = [];
const seen = new Set();
for (const f of files) {
  let j;
  try {
    j = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
  } catch (e) {
    problems.push(`${f}: invalid JSON (${e.message})`);
    continue;
  }
  for (const r of j.risk_flags ?? []) RISKS.push({ ...r, from: f });
  for (const fact of j.facts ?? []) {
    // 回源核对判定「主语错误 / 原文无依据」的条目由修正轮标记 removed：保留在批文件里可追溯，但不进档案。
    if (fact.removed) continue;
    if (!fact.kind || !fact.label) {
      problems.push(`${f}: fact without kind/label: ${JSON.stringify(fact).slice(0, 80)}`);
      continue;
    }
    // dedupe identical assertions coming from the same conversation
    const key = [fact.kind, fact.label, fact.value ?? '', fact.date ?? '', fact.source ?? ''].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ALL.push({ ...fact, batch: j.batch ?? f, status: fact.status ?? '用户自述' });
  }
}

// ---------- 等级用词校正 ----------
// 「报告数值」只该用于报告里的**具体数字**（metric）。目标/病症/待办若标成
// 「报告数值」，实际是报告的建议或结论，容易让人误以为有化验数值支撑。
const STATUS_FIX = {
  goal: { 报告数值: '报告建议' },
  condition: { 报告数值: '报告结论' },
  open_question: { 报告数值: '报告要求' },
  habit: { 报告数值: '报告建议' },
  psychological: { 报告数值: '报告结论' },
  family: { 报告数值: '报告结论' },
};
let relabeled = 0;
for (const f of ALL) {
  const map = STATUS_FIX[f.kind];
  if (map && map[f.status]) {
    f.statusOriginal = f.status;
    f.status = map[f.status];
    relabeled++;
  }
}
if (relabeled) console.log(`等级用词校正 ${relabeled} 条（如 goal 的「报告数值」→「报告建议」）`);

// ---------- 给每条事实一个稳定 id，并应用用户修正层 ----------
// id 由内容派生，因此重新生成档案时不会漂移，控制台里的修正能一直对上。
import { createHash } from 'node:crypto';
const CORR = join(OUT, 'corrections.json');
const corrections = existsSync(CORR) ? (JSON.parse(readFileSync(CORR, 'utf8')).facts ?? {}) : {};
let corrected = 0;
for (const f of ALL) {
  f.id =
    'f' +
    createHash('sha1')
      .update([f.kind, f.label, f.value ?? '', f.date ?? '', f.source ?? ''].join('|'))
      .digest('hex')
      .slice(0, 10);
  const c = corrections[f.id];
  if (!c) continue;
  if (c.label !== undefined) f.label = c.label;
  if (c.value !== undefined) f.value = c.value;
  if (c.status !== undefined) f.status = c.status;
  if (c.note) f.evidence = `${f.evidence ?? ''}　【用户修正：${c.note}】`;
  // 让修正在任何表格里都看得见（有些事实没有 evidence 字段）
  f.value = `${f.value ?? ''}　〔用户修正〕`;
  f.userCorrected = true;
  corrected++;
}
if (corrected) console.log(`已应用用户修正 ${corrected} 条（corrections.json）`);

// ---------- 归档层：被折叠的条目保留在数据里，但不进入生成的档案文件 ----------
const ARCH = join(OUT, 'archived.json');
const archived = new Set(existsSync(ARCH) ? (JSON.parse(readFileSync(ARCH, 'utf8')).archivedFacts ?? []) : []);
let archivedCount = 0;
for (const f of ALL)
  if (archived.has(f.id)) {
    f.archived = true;
    archivedCount++;
  }
if (archivedCount) console.log(`已折叠归档 ${archivedCount} 条（archived.json，仍保留在 facts.json 里可恢复）`);

// ---------- 归属分离：把「不是本人」的事实挑出来 ----------
// 这个账号有**多人使用**的迹象：体检报告是 32 岁男性，但另有若干会话是女性生理问题
// （经期、阴道、怀孕、罩杯），还有明确说「女朋友21岁」的。这些不能混进他的画像——
// 否则助手会把「18岁，女」当成他的基本信息。
const OTHER_RE = /月经|姨妈|经期|怀孕|妊娠|排卵|阴道|宫颈|子宫|罩杯|乳房|胸软|下垂|哺乳|白带|女朋友|女友|卵子|雌激素|女性|女孩|女生|21岁女|18岁女/;
// 已人工确认属于他人的会话（文件名）
const OTHER_CONVERSATIONS = new Set([
  '20261001-经期大量饮酒致异常出血-84270dd3.md',
  '20260929-阴道润滑液学名-91e7fc8c.md',
  '20260929-高危性行为后检查建议-07e0378c.md',
  '20260928-嗓子肿痛怕冷处理建议-79e36055.md',
  '20260926-经期性爱注意事项-324d7b2f.md',
  '20260914-月经周期粘人阶段-1663ed17.md',
  '20261001-21岁E罩杯胸软下垂原因-4e198cc0.md',
  '20261002-女孩发育到几岁-68465f17.md',
  '20260923-18岁女孩儿,左上腹痛-f0366151.md',
]);
let otherCount = 0;
for (const f of ALL) {
  const blob = `${f.label ?? ''} ${f.value ?? ''} ${f.evidence ?? ''}`;
  const femaleSelf = /\d{1,2}\s*岁[，,、\s]*女/.test(blob);
  // 提取/裁决阶段已在源文件里标了 subject（例如「用户确认这组数据显示的是他人」），尊重它。
  if (f.subject === 'other' || OTHER_RE.test(blob) || femaleSelf || OTHER_CONVERSATIONS.has(String(f.source ?? ''))) {
    f.subject = 'other';
    otherCount++;
  } else {
    f.subject = 'self';
  }
}
console.log(`归属分离：本人 ${ALL.length - otherCount} 条，他人/待确认 ${otherCount} 条`);

const byKind = (k) => ALL.filter((x) => x.kind === k && !x.archived && x.subject !== 'other');
const sortByDate = (a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''));
const table = (rows, cols) => {
  const out = [`| ${cols.map((c) => c.h).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${cols.map((c) => String(c.f(r) ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
  return out.join('\n');
};
const srcLink = (s) => (s ? `\`${s}\`` : '—');

const profileRows = byKind('profile').sort(sortByDate);
const metrics = byKind('metric').sort(sortByDate);
const conditions = byKind('condition').sort(sortByDate);
const symptoms = byKind('symptom').sort(sortByDate);
const meds = byKind('medication').sort(sortByDate);
const supps = byKind('supplement').sort(sortByDate);
const habits = byKind('habit').sort(sortByDate);
const goals = byKind('goal').sort(sortByDate);
const psyche = byKind('psychological').sort(sortByDate);
const attach = byKind('attachment').sort(sortByDate);
const family = byKind('family').sort(sortByDate);
const open = byKind('open_question').sort(sortByDate);

console.log(`批次数: ${files.length}   事实总数（去重后）: ${ALL.length}`);
console.log('按 kind 分布:');
for (const [k, v] of Object.entries(ALL.reduce((a, x) => ((a[x.kind] = (a[x.kind] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(4)}  ${k}`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems.slice(0, 15)) console.log('  ! ' + p);
}

// ---------- PROFILE.md ----------
const otherFacts = ALL.filter((x) => x.subject === 'other' && !x.archived);
const P = [];
P.push('# 个人健康档案');
P.push('');
P.push(`> 由 DeepSeek 历史对话自动提取，生成时间 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}。`);
P.push('> 每条事实都标注了**日期**与**出处**，可回到 `SOURCES.md` 或原始对话核对。');
P.push('> **本档案是历史快照，不是当前状态的保证**；涉及体重、在服药物、新症状时请先确认现状。');
P.push('');
if (otherFacts.length) {
  P.push('## ℹ️ 档案里另有一份「朋友的健康记录」');
  P.push('');
  P.push(`本档案默认描述的是**你自己**（32 岁男性，成都，体检报告上那位）。历史对话里还有 ${otherFacts.length} 条事实，是你在**替朋友询问**的——内容全是女性生理问题（月经、阴道、妊娠、罩杯），其中一条会话明确说了「女朋友 21 岁」。`);
  P.push('');
  P.push('这些事实**已从下方所有表格中剔除**，单独放在 [FRIEND.md](./FRIEND.md)。**不要把它们当成你的情况**。');
  P.push('');
  P.push('> 涉及「经期 / 阴道 / 怀孕 / 罩杯」的问题时，默认是**在问朋友**，回答前先确认一句对象是谁。');
  P.push('');
}
if (profileRows.length) {
  P.push('## 基本画像');
  P.push('');
  P.push(table(profileRows, [
    { h: '项', f: (r) => r.label },
    { h: '值', f: (r) => r.value },
    { h: '日期', f: (r) => r.date },
    { h: '来源等级', f: (r) => r.status },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
  P.push('');
}
const stat = (n, label, file) => `| ${label} | ${n} | ${file ? `[${file}](./${file})` : '—'} |`;
P.push('## 档案构成');
P.push('');
P.push('| 类别 | 条数 | 文件 |');
P.push('|---|---|---|');
P.push(stat(metrics.length, '体检与化验指标', 'METRICS.md'));
P.push(stat(conditions.length, '已确诊/医生明确的病症', 'SYMPTOMS.md'));
P.push(stat(symptoms.length, '自述症状', 'SYMPTOMS.md'));
P.push(stat(meds.length, '用药', 'MEDICATIONS.md'));
P.push(stat(supps.length, '补剂', 'MEDICATIONS.md'));
P.push(stat(habits.length, '生活习惯', 'LIFESTYLE.md'));
P.push(stat(goals.length, '目标', 'LIFESTYLE.md'));
P.push(stat(psyche.length, '心理与情绪', 'PSYCHE.md'));
P.push(stat(open.length, '待复查/未决', 'OPEN-ISSUES.md'));
P.push(stat(family.length, '家人健康', 'SOURCES.md'));
P.push(stat(attach.length, '上传过的报告文件', 'SOURCES.md'));
P.push('');
P.push('## 全部指标（按时间）');
P.push('');
if (metrics.length) {
  P.push(table(metrics, [
    { h: '日期', f: (r) => r.date },
    { h: '项目', f: (r) => r.label },
    { h: '数值', f: (r) => `${r.value ?? ''}${r.unit ? ' ' + r.unit : ''}` },
    { h: '参考范围', f: (r) => r.reference },
    { h: '等级', f: (r) => r.status },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else P.push('（未提取到指标）');
P.push('');
P.push('## 待办与风险提示');
P.push('');
if (open.length) {
  for (const r of open) P.push(`- **${r.label}**${r.value ? `：${r.value}` : ''}${r.date ? `（${r.date}）` : ''} — ${r.evidence ?? ''} 〔${srcLink(r.source)}〕`);
} else P.push('（未提取到明确的待复查项——⚠️ 这不代表没有问题，只是历史对话里没有明确记录）');
P.push('');
if (RISKS.length) {
  P.push('### 提取过程中被单独标记的风险');
  P.push('');
  for (const r of RISKS)
    P.push(`- **[${r.level ?? r.severity ?? '?'}] ${r.title ?? r.label ?? ''}**：${r.detail ?? r.value ?? r.why ?? ''}${r.evidence ? ` — ${r.evidence}` : ''}`);
  P.push('');
}
P.push('## ⚠️ 需要先跟你确认的两处矛盾数据');
P.push('');
P.push('- **身高：已确认 175cm（2026-10-10 用户确认）。** 2025-09 ~ 2026-02 的对话里曾自述 **172cm**，2026-03 起改为 **175cm**；两次都原样保留在档案里（见 `METRICS.md`），但**当前身高一律按 175cm 计算**，BMI/热量/蛋白质目标都以此为准。另有一条模型从健身房地秤图片读出的 172cm 已按「非用户陈述」移除。');
P.push('- **体重**：同样存在多条时间线（46kg → 48kg → 50.8 → 52.1 → 53 → 51 → 52.8kg 等，部分来自体脂秤、部分为自述）。做增重建议前请先称一次并记录到 `log/`。');
P.push('');
writeFileSync(join(OUT, 'PROFILE.md'), P.join('\n'), 'utf8');

// ---------- METRICS.md ----------
const M = ['# 体检与化验指标时间线', '', '> 数值来自用户上传的体检/化验报告或其转述；`等级` 标注了事实来源。', ''];
if (metrics.length) {
  M.push(table(metrics, [
    { h: '日期', f: (r) => r.date },
    { h: '项目', f: (r) => r.label },
    { h: '数值', f: (r) => `${r.value ?? ''}${r.unit ? ' ' + r.unit : ''}` },
    { h: '参考范围', f: (r) => r.reference },
    { h: '等级', f: (r) => r.status },
    { h: '原文', f: (r) => r.evidence },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else M.push('（未提取到指标）');
M.push('');
if (attach.length) {
  M.push('## 上传过的报告文件');
  M.push('');
  for (const r of attach) M.push(`- \`${r.value ?? r.label}\`${r.date ? `（${r.date}）` : ''} 〔${srcLink(r.source)}〕`);
  M.push('');
}
M.push('## 需要新测量的项');
M.push('');
M.push('- 体重与体脂：档案里的体重值都是历史值，做增重/减脂建议前请先称一次并记录到 `log/`。');
M.push('- 血压：若有记录请补充测量条件（静息/时间）。');
M.push('');
writeFileSync(join(OUT, 'METRICS.md'), M.join('\n'), 'utf8');

// ---------- MEDICATIONS.md ----------
const D = ['# 用药与补剂', '', '> ⚠️ 本文件只记录**用户实际用过/在用的**东西，**不构成用药建议**。任何剂量调整以主诊医生为准。', ''];
D.push('## 药物');
D.push('');
if (meds.length) {
  D.push(table(meds, [
    { h: '日期', f: (r) => r.date },
    { h: '药物', f: (r) => r.label },
    { h: '剂量/用法', f: (r) => r.value },
    { h: '等级', f: (r) => r.status },
    { h: '原文', f: (r) => r.evidence },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else D.push('（未提取到用药记录）');
D.push('');
D.push('## 补剂');
D.push('');
if (supps.length) {
  D.push(table(supps, [
    { h: '日期', f: (r) => r.date },
    { h: '补剂', f: (r) => r.label },
    { h: '剂量/用法', f: (r) => r.value },
    { h: '等级', f: (r) => r.status },
    { h: '原文', f: (r) => r.evidence },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else D.push('（未提取到补剂记录）');
D.push('');
D.push('## 已知的用药注意事项（来自对话记录）');
D.push('');
D.push('- 对话里出现过「多种药物联用是否安全」的提问。**任何联用、加量、停药都必须先问医生或药师**，尤其是心血管类、精神类、以及 PDE5 抑制剂类。');
D.push('- 记录里若出现「应该没事/可以一起吃」这类结论，只代表当时模型的说法，**不构成医嘱**。');
D.push('');
writeFileSync(join(OUT, 'MEDICATIONS.md'), D.join('\n'), 'utf8');

// ---------- SYMPTOMS.md ----------
const S = ['# 症状与病史', '', '## 医生明确的病症', ''];
if (conditions.length) {
  S.push(table(conditions, [
    { h: '日期', f: (r) => r.date },
    { h: '病症', f: (r) => r.label },
    { h: '详情', f: (r) => r.value },
    { h: '等级', f: (r) => r.status },
    { h: '原文', f: (r) => r.evidence },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else S.push('（未提取到医生明确的诊断——含「模型推测」的判断不列在此处）');
S.push('');
S.push('## 自述症状');
S.push('');
if (symptoms.length) {
  S.push(table(symptoms, [
    { h: '日期', f: (r) => r.date },
    { h: '症状', f: (r) => r.label },
    { h: '描述', f: (r) => r.value },
    { h: '等级', f: (r) => r.status },
    { h: '原文', f: (r) => r.evidence },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else S.push('（未提取到自述症状）');
S.push('');
S.push('## 使用说明');
S.push('');
S.push('- `等级 = 模型推测` 的条目**不是诊断**，只表示当时讨论过这种可能。');
S.push('- 症状按时间排列；出现时间接近的条目可能在描述同一件事。');
S.push('');
writeFileSync(join(OUT, 'SYMPTOMS.md'), S.join('\n'), 'utf8');

// ---------- PSYCHE.md ----------
const Y = ['# 心理与情绪', '', '> 这部分同样来自对话记录。**不做诊断**；出现持续低落、功能受损或自伤念头时应就诊精神科/心理科。', ''];
if (psyche.length) {
  Y.push(table(psyche, [
    { h: '日期', f: (r) => r.date },
    { h: '主题', f: (r) => r.label },
    { h: '描述', f: (r) => r.value },
    { h: '等级', f: (r) => r.status },
    { h: '原文', f: (r) => r.evidence },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else Y.push('（未提取到心理相关事实）');
Y.push('');
writeFileSync(join(OUT, 'PSYCHE.md'), Y.join('\n'), 'utf8');

// ---------- LIFESTYLE.md ----------
const L = ['# 饮食、锻炼与作息', '', '## 现状（习惯）', ''];
if (habits.length) {
  L.push(table(habits, [
    { h: '日期', f: (r) => r.date },
    { h: '类别', f: (r) => r.label },
    { h: '具体', f: (r) => r.value },
    { h: '等级', f: (r) => r.status },
    { h: '原文', f: (r) => r.evidence },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else L.push('（未提取到习惯记录）');
L.push('');
L.push('## 目标');
L.push('');
if (goals.length) {
  L.push(table(goals, [
    { h: '日期', f: (r) => r.date },
    { h: '目标', f: (r) => r.label },
    { h: '具体', f: (r) => r.value },
    { h: '原文', f: (r) => r.evidence },
    { h: '出处', f: (r) => srcLink(r.source) },
  ]));
} else L.push('（未提取到明确目标）');
L.push('');
writeFileSync(join(OUT, 'LIFESTYLE.md'), L.join('\n'), 'utf8');

// ---------- OPEN-ISSUES.md ----------
const O = ['# 待复查与未决问题', '', '> 这些是对话里出现过的、**明确悬而未决**的事项。逐条跟进后把结果写进 `log/`。', ''];
if (open.length) {
  for (const r of open.sort(sortByDate)) {
    O.push(`## ${r.label}`);
    O.push('');
    if (r.value) O.push(`- **内容**：${r.value}`);
    if (r.date) O.push(`- **提出日期**：${r.date}`);
    O.push(`- **来源等级**：${r.status}`);
    if (r.evidence) O.push(`- **原文**：${r.evidence}`);
    if (r.source) O.push(`- **出处**：\`${r.source}\``);
    O.push('');
  }
} else O.push('（未提取到待复查项）');
O.push('## 就医资源（来自对话记录）');
O.push('');
O.push('- 记录里出现过成都本地的就医挂号和门诊经历；具体机构与挂号方式请以 `SOURCES.md` 中对应会话为准。');
O.push('');
writeFileSync(join(OUT, 'OPEN-ISSUES.md'), O.join('\n'), 'utf8');

// ---------- SOURCES.md ----------
const R = ['# 事实与出处对照', '', `共 ${ALL.length} 条事实，来自 ${files.length} 批提取。原始对话在 \`${KB}\\conversations\\\`。`, ''];
R.push('| kind | 标签 | 值 | 日期 | 等级 | 置信度 | 出处文件 |');
R.push('|---|---|---|---|---|---|---|');
for (const r of ALL.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))) {
  R.push(
    `| ${r.kind} | ${String(r.label).replace(/\|/g, '\\|')} | ${String(r.value ?? '').replace(/\|/g, '\\|').slice(0, 60)} | ${r.date ?? ''} | ${r.status} | ${r.confidence ?? ''} | ${srcLink(r.source)} |`,
  );
}
R.push('');
writeFileSync(join(OUT, 'SOURCES.md'), R.join('\n'), 'utf8');

// ---------- FRIEND.md：替朋友问的那些记录 ----------
const O2 = [
  '# 朋友的健康记录（你替她问的）',
  '',
  '> 这些来自女性生理问题的会话，**不是你的情况**——是你在替朋友询问。',
  '> 已从 `PROFILE.md` / `SYMPTOMS.md` / `MEDICATIONS.md` 等本人档案中剔除，不会影响对你的判断。',
  '> 里面有几条**有时效性**的事项（见下方「需要尽快处理」），值得你转达给她。',
  '',
];
const FRIEND_URGENT = otherFacts.filter((f) => f.kind === 'open_question' || /高危|检测|出血|量多|贫血|晕|急诊|就医/.test(`${f.label} ${f.value}`));
if (FRIEND_URGENT.length) {
  O2.push('## 值得转达给她的重点');
  O2.push('');
  O2.push('（按时间排列；带 ❗ 的是**有时效性**的——建议尽快让她本人就医）');
  O2.push('');
  for (const f of FRIEND_URGENT.sort(sortByDate))
    O2.push(`${f.kind === 'open_question' || /高危|急诊/.test(`${f.label} ${f.value}`) ? '❗ ' : '- '}**${f.label}**${f.value ? `：${f.value}` : ''}${f.date ? `（${f.date}）` : ''}${f.evidence ? `\n  - 原文：${f.evidence}` : ''}`);
  O2.push('');
  O2.push('> ⚠️ 这些只是从对话里提取的记录，**不是诊断**。带她去看医生时把这段给医生看即可。');
  O2.push('');
}
O2.push(`## 全部记录（${otherFacts.length} 条）`);
O2.push('');
if (otherFacts.length) {
  O2.push(
    table(otherFacts.sort(sortByDate), [
      { h: '类型', f: (r) => r.kind },
      { h: '标签', f: (r) => r.label },
      { h: '值', f: (r) => String(r.value ?? '').slice(0, 60) },
      { h: '日期', f: (r) => r.date },
      { h: '等级', f: (r) => r.status },
      { h: '出处', f: (r) => srcLink(r.source) },
    ]),
  );
} else O2.push('（无）');
O2.push('');
writeFileSync(join(OUT, 'FRIEND.md'), O2.join('\n'), 'utf8');

writeFileSync(
  join(OUT, 'facts.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), batches: files.length, total: ALL.length, facts: ALL }, null, 1),
);
console.log(`\nwrote ${OUT}\\{PROFILE,METRICS,MEDICATIONS,SYMPTOMS,PSYCHE,LIFESTYLE,OPEN-ISSUES,SOURCES}.md + facts.json`);
