// Create the health-assistant DSH session: cwd = D:\dsh\health, seeded with the
// core of the personal dossier plus the operating rules, so the assistant starts
// every conversation already knowing who it is talking about.
//
//   node make-health-session.mjs [--dry-run]
//
// The event sequence is the one verified end-to-end earlier in this project
// (loads through the host API and is resumable).
import { zstdCompressSync, constants } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const DRY = process.argv.includes('--dry-run');
const HEALTH = resolve('..\\health');
const HOME = process.env.USERPROFILE || process.env.HOME;
const ROOT = DRY ? resolve('tmp-health-sessions') : join(HOME, '.dsh', 'sessions');
const CWD = HEALTH;
const PRESET = 'standard';
const MANIFEST = join(HEALTH, 'dsh-health-session.json');

function projectKey(cwd) {
  let r = '';
  let sep = false;
  for (const ch of cwd) {
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!sep) r += '-';
      sep = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      r += ch;
      sep = false;
    } else {
      r += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      sep = false;
    }
  }
  return `--${(r.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}
const zstd = (b) => zstdCompressSync(b, { params: { [constants.ZSTD_c_checksumFlag]: 1 } });

const profile = readFileSync(join(HEALTH, 'PROFILE.md'), 'utf8');
const facts = existsSync(join(HEALTH, 'facts.json')) ? JSON.parse(readFileSync(join(HEALTH, 'facts.json'), 'utf8')) : { facts: [] };
const n = (k) => facts.facts.filter((f) => f.kind === k).length;

const baseline = [
  '【已知基线（由档案摘出，细节以 PROFILE.md 为准）】',
  '- 男，1993-06-04 出生（约 33 岁），成都，社区工作者。',
  '- 身高 175cm（2026-03 起自述；2025-09 ~ 2026-02 曾多次自述 172cm，两说并存，已请在会话中确认）。',
  '- 体重长期偏轻：47 → 48 → 50.8 → 52.1 → 53 →（感冒）51 → 52.5kg；BMI 约 16.6~17.2（过轻）；腰围 71cm、臂围 25cm。',
  '- 2026-03-06 体检主要异常：BMI 16.65；总胆红素 35.74 / 直接 9.48 / 间接 26.26（升高，报告要求 3 个月内复查）；尿酸 486 μmol/L（上限 428）；心电图电轴左偏 + 偶发室性早搏；右肺 3×3mm 微小结节（年度随诊）；左肺上叶炎性病灶伴胸膜增厚；腰5-骶1 椎间盘稍膨出；双肾尿盐结晶；尿隐血弱阳性；HDL-C 1.67；2025-11 叶酸偏低。',
  '- 心理：2026-07 医院量表提示轻度强迫、轻度抑郁、中度精神病性、中度睡眠及食欲问题；医生诊断为「轻微抑郁」并否认 ADHD；本人持续怀疑 ADHD，尚未确诊。',
  '- 用药：文拉法辛（2026-07-11 起，服药不规律、有漏服与自行停药；副作用含头晕、恶心、射精障碍，停药后恢复）。体检处方四种药中实际只服用了消炎利胆片与头孢地尼。',
  '- 生活方式：长期 2 点睡 8 点起（约 6 小时）；每周 3-4 次力量训练（哈克深蹲 80kg×16）；长期用含糖奶茶代水、几乎不喝白水；蛋白粉每天 1 勺（曾长期误把高碳水增重粉当蛋白粉）；增重目标从 55kg 逐步提到 65-70kg。',
  '- 最需要闭环的一条：2026 年出现过「右肋下夜间痛整晚 + 稍动即头晕心跳快血氧低 + 黑矇 + 嘴唇白 + 极度困倦」的组合症状，当时建议急诊查血常规（排贫血/消化道隐性出血），**未见任何复查结果**。',
].join('\n');

const userText = [
  '【健康助手·建档】',
  '',
  '这是我的个人健康档案，从我的历史对话里提取整理出来的。请把它作为我们之后所有健康相关对话的长期背景。',
  '',
  baseline,
  '',
  '使用规则（请严格遵守）：',
  '1. 先读 `D:\\dsh\\health\\` 下的档案再回答，不要凭记忆报我的指标。',
  '2. 凡涉及通用医学知识，必须联网核对权威来源（国家卫健委、中国居民膳食指南、中华医学会专科指南、WHO、MedlinePlus/Mayo 类），并给出来源链接。',
  '3. 不给我下诊断结论；不建议我自行调整在服药物的剂量或联用——那类问题请让我去问医生或药师。',
  '4. 出现红旗症状（胸痛、呼吸困难、呕血黑便、突发剧烈头痛、意识改变、单侧肢体无力、持续高热、自伤念头等）时，直接告诉我该去哪里、多快，不要给居家处理方案。',
  '5. 区分事实等级：报告数值 / 医生诊断 / 用户自述 / 模型推测。标着「模型推测」的不等于确诊。',
  '6. 档案是历史快照——涉及我现在的体重、在服药物、新症状时，先问我一句现状。',
  '7. 建议要可执行：给量、频次、时点，并告诉我怎么判断有没有效、什么时候复查。',
  '8. 我报告新数据（体重、体检结果、用药变化）时，写进 `log/` 并更新对应档案，保留日期。',
  '',
  '档案结构：',
  '- `PROFILE.md` 总览与全部指标（下方已内嵌核心内容）',
  '- `METRICS.md` 指标时间线｜`MEDICATIONS.md` 用药与补剂｜`SYMPTOMS.md` 症状与病史',
  '- `PSYCHE.md` 心理与情绪｜`LIFESTYLE.md` 饮食锻炼作息与目标｜`OPEN-ISSUES.md` 待复查',
  '- `SOURCES.md` 每条事实的出处对话文件（可溯源）｜`log/` 新记录写这里',
  '- 原始对话全文：`D:\\dsh\\dsh-kb-sync\\data\\kb\\conversations\\`，检索 `node D:\\dsh\\dsh-kb-sync\\data\\kb\\tools\\search.mjs "关键词"`',
  '',
  '---',
  '',
  profile,
].join('\n');

const assistantText = [
  '已载入你的个人健康档案（本段为建档脚本自动生成的索引，不是模型分析结论）。',
  '',
  `- 提取自 ${n('metric') + n('symptom') + n('condition') + n('medication') + n('supplement') + n('habit') + n('goal') + n('psychological') + n('open_question') + n('profile') + n('family') + n('attachment')} 条事实，来源为你自己的历史对话（可回到 SOURCES.md 溯源）。`,
  `- 其中指标 ${n('metric')} 条、症状与病史 ${n('symptom') + n('condition')} 条、用药与补剂 ${n('medication') + n('supplement')} 条、心理与情绪 ${n('psychological')} 条、习惯与目标 ${n('habit') + n('goal')} 条、待复查 ${n('open_question')} 条。`,
  '',
  '我读取档案的方式：每次回答前先读 `PROFILE.md` 与问题相关的分册，需要原话时用全文检索回到原始对话。',
  '',
  '你可以直接这样问我：',
  '- 「我上次体检哪些指标异常，该复查什么了？」',
  '- 「我想从现在的体重增到目标，这周吃什么、怎么练？」',
  '- 「我在吃某种药，能不能和别的药一起吃？」（这类我会让你去问医生）',
  '- 「今天体重 53kg，记一下」',
  '',
  '两件我会一直守住的边界：**不给你下诊断**；**不建议你自行调整处方药**。',
].join('\n');

function buildLog({ id, createdAt, title }) {
  const header = { type: 'session', version: 0, id, createdAt, cwd: CWD, delegationDepth: 0, agentPreset: PRESET };
  const events = [];
  const push = (type, data, extra = {}) => events.push({ type, seq: events.length, time: createdAt + events.length, data, ...extra });
  push('permission/preset', { preset: 'workspace-write' });
  push('sandbox/mode', { mode: 'workspace-write' });
  push('approval/policy', { policy: 'ask' });
  push('session/title', { title, messageSeqs: [7], source: { kind: 'user' } });
  push('turn/start', { turn: 1 });
  push('step/start', { turn: 1, step: 1 });
  push(
    'user/message',
    { content: [{ type: 'text', text: userText }], source: { kind: 'user', rpcId: randomUUID(), clientTimeZone: 'Asia/Shanghai' }, role: 'user', id: randomUUID() },
    { surfaceOp: 'append' },
  );
  push(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' },
        id: randomUUID(),
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 },
    },
    { surfaceOp: 'append' },
  );
  push('step/end', { turn: 1, step: 1 });
  push('turn/end', { turn: 1, reason: { kind: 'completed' } });
  push('session/end-seed', {});
  return Buffer.concat([
    zstd(Buffer.from(JSON.stringify(header) + '\n', 'utf8')),
    zstd(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')),
  ]);
}

if (DRY && existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
const id = `session-${randomUUID()}`;
const createdAt = Date.now();
const title = '健康助手';
const buf = buildLog({ id, createdAt, title });
mkdirSync(join(ROOT, projectKey(CWD), id), { recursive: true });
writeFileSync(join(ROOT, projectKey(CWD), id, 'session.jsonl.zstd'), buf);
writeFileSync(MANIFEST, JSON.stringify({ cwd: CWD, preset: PRESET, generatedAt: new Date().toISOString(), sessions: [{ id, title, topic: title, key: '健康助手', cwd: CWD, bytes: buf.length }] }, null, 1));

console.log(`档案内嵌：${profile.length.toLocaleString('en-US')} 字符；事实 ${facts.facts.length} 条`);
console.log(`会话：${title}  -> ${id}  (${buf.length} B)`);
console.log(`写入：${join(ROOT, projectKey(CWD), id)}`);
console.log(`清单：${MANIFEST}`);
