// 第二轮增量：把「腹泻满两周」与新进展整合成一条结论。
//
//   node add-update2-conclusions.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HEALTH = resolve('..\\health');
const KNOW = join(HEALTH, 'knowledge.json');
const know = JSON.parse(readFileSync(KNOW, 'utf8'));

const sec = know.sections.find((s) => s.key === 'followup');
if (!sec) {
  console.error('找不到「复查与就医」分类');
  process.exit(1);
}

const TITLE = '一次消化内科门诊，把四件事一起解决';
if (sec.items.some((x) => x.title === TITLE)) {
  console.log('已存在，跳过');
  process.exit(0);
}

sec.items.push({
  id: 'upd2-consolidated-visit',
  bucket: '已过期/立即安排',
  title: TITLE,
  body: [
    '你手上现在有四件**都指向消化内科**的事，分开跑就是四次挂号。挂一次，一次说清：',
    '',
    '1. **腹泻满两周**（2026-09-24 起，到今天 10-07 已约 14 天仍未缓解）——成人的持续性腹泻通常以 2 周围界。',
    '2. **胆红素三项复查**——体检报告要求 3 个月内复查（约 2026-06-06 到期，**已逾期约 4 个月**）。',
    '3. **慢性胆囊炎**——你 2026-09-20 决定「不专门复查，只控制饮食作息」，那正好并到这一次。',
    '4. **止痛片/布洛芬 + 头孢后的消化道检查**——请医生开血常规 + 大便隐血。',
    '',
    '**挂号时就这么说**（主诉）：',
    '> 「胆红素升高 7 个月未复查，最近腹泻两周，有慢性胆囊炎，期间吃过止痛片和头孢。」',
    '',
    '**到位后要做的检查**：肝功能（含胆红素分型）、腹部超声、血常规、大便常规＋隐血；必要时大便培养、乳糖氢呼气试验。',
    '**带上**：2026-03-11 那份体检报告（或本档案 `METRICS.md`）、近期用药清单（`MEDICATIONS.md`）。',
    '',
    '⚠️ 注意**不要**把「腹泻」当成小事拖到下次年度体检——两周是临床上判断「该查了」的常见界线，而且你同期还有头晕、眼前发黑、极度困倦。',
  ].join('\n'),
  why: [
    '依据：',
    '① 你 2026-09-24 自述大便稀、10-07 仍在肠胃敏感期（`SYMPTOMS.md`、`FACTS` 记录），持续约 14 天；',
    '② 体检报告明确要求胆红素 3 个月内复查，未见复查记录（`OPEN-ISSUES.md`）；',
    '③ 你 2026-09-20 自己决定胆囊不专门复查——并进这一次即可；',
    '④ 你 2026-09-23 服过止痛片、家中备布洛芬、同期在吃头孢，NSAID 增加消化道出血风险属临床共识。',
    '',
    '⚠️ 本条**尚未联网核对权威来源**（「腹泻两周应就诊」这一界线属临床常规，建议让助手用 web_search 补上指南链接再依赖）。',
  ].join('\n'),
  basedOn: [
    '2026-09-24 ~ 10-07 腹泻未缓解（约 14 天）',
    '2026-03-06 胆红素三项升高，报告要求 3 个月内复查',
    '慢性胆囊炎（2026-03-11 医生诊断）',
    '2026-09-23 服止痛片、家中备布洛芬、同期头孢',
    '同期头晕 / 黑矇 / 极度困倦',
  ],
  sources: [],
  grade: '临床常规',
  confidence: 'high',
  note: '依据待补来源',
  origin: '增量更新 2026-10-07（第二轮）',
  generatedAt: new Date().toISOString(),
});

know.updatedAt = new Date().toISOString();
writeFileSync(KNOW, JSON.stringify(know, null, 1), 'utf8');
const total = know.sections.reduce((a, s) => a + s.items.length, 0);
console.log(`+ 已过期/立即安排  ${TITLE}`);
console.log(`结论总数 ${total}`);
