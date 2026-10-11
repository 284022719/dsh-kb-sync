// 把增量更新里发现的新风险补进结论层 knowledge.json。
//
//   node add-update-conclusions.mjs
//
// 只新增「需要就医跟进」类的条目，且**不编造来源**：能溯源到个人数据的写个人数据，
// 医学依据部分标注为「待核对来源」或引用已有条目的同一来源，绝不用记忆充当证据。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HEALTH = resolve('..\\health');
const KNOW = join(HEALTH, 'knowledge.json');
const know = JSON.parse(readFileSync(KNOW, 'utf8'));

const ITEMS = [
  {
    key: 'followup',
    bucket: '近期安排',
    title: '止痛药 + 头孢同服过：去查一次血常规与大便隐血',
    body:
      '你在 2026-09-23 晚上吃过止痛片，家里还有布洛芬；同期在吃头孢。这两类药都属于「增加消化道出血风险」的组合（NSAID 伤胃黏膜 + 抗生素扰肠道菌群）。\n' +
      '做法：挂消化内科时**一并说明**你在吃/吃过什么、吃了多久、有没有黑便或腹痛，请医生开「血常规 + 大便隐血」——这两项很便宜，而且能直接回答「有没有隐性出血」。\n' +
      '如果出现黑便、呕血、持续上腹痛，直接急诊，不要等门诊。',
    why:
      '依据：① 你的个人用药记录（2026-09-23 止痛片、家中布洛芬、同期头孢）；② 你同期还报过大便稀、头晕、眼前发黑、极度困倦——这些与失血/脱水都相关；③ NSAID 增加消化道出血风险属临床共识。\n' +
      '⚠️ 本条的依据部分**尚未联网核对权威来源**（生成时未做检索），请在使用前让助手用 web_search 补上指南链接。',
    basedOn: ['2026-09-23 服用止痛片', '家中备有布洛芬', '同期服用头孢', '2026-09-24 起大便稀', '2026-09 头晕/黑矇/极度困倦'],
    sources: [],
    grade: '经验',
    confidence: 'medium',
    note: '依据待补来源',
  },
  {
    key: 'followup',
    bucket: '近期安排',
    title: '大便稀期间继续喝豆浆牛奶：先停，并注意脱水',
    body:
      '你 2026-09-24 自述大便稀、自己怀疑与豆浆/牛奶有关；9-25 又问了红枣牛奶和现磨豆浆。对话里你已经得到「先停」的建议，但**没有缓解记录**。\n' +
      '做法：① 豆浆、牛奶、红枣牛奶先全停 3-5 天，用粥/米饭/鸡蛋替代；② 每天记录次数与性状；③ 补液——米汤、淡盐水、口服补液盐，别只喝白水；④ 如果一天超过 5 次、带血或伴发热，去消化内科。\n' +
      '停掉之后如果好转，说明多半是乳糖不耐受或大豆低聚糖不耐受，之后可以试零乳糖奶少量恢复（这也是你增重需要的蛋白来源）。',
    why:
      '依据：① 你 2026-09-24 自述「大便稀，可能是最近豆浆牛奶喝的多」；② 同期反复头晕、眼前发黑、极度困倦——腹泻叠加这些会加重脱水与低血压；③ 你本身已偏瘦（BMI≈17）且热量摄入不足，腹泻会进一步损失。\n' +
      '⚠️ 同样**尚未联网核对来源**，建议让助手补权威链接后再依赖。',
    basedOn: ['2026-09-24 大便稀', '自述与豆浆/牛奶相关', '2026-09-25 询问红枣牛奶/现磨豆浆', '头晕/黑矇/极度困倦'],
    sources: [],
    grade: '经验',
    confidence: 'medium',
    note: '依据待补来源',
  },
  {
    key: 'followup',
    bucket: '已过期/立即安排',
    title: '黑矇 + 听不清别人说话：这条必须在两周内查清',
    body:
      '2026-09-24~10-01 这段时间你多次报「间断头晕、眼前发黑（黑矇）、听不清别人说话、嘴唇发白、睡 10 小时仍极度困倦」，同期还有运动后头晕剧烈心跳、血氧低。\n' +
      '对话里已经给过「急诊级」的判断，但没有你实际就诊或检查结果。做法：**两周内**挂神经内科 + 心内科，明确要求做：血常规（排贫血）、心电图/24h 动态心电图、血压与血糖、必要时头颅影像。\n' +
      '只要再出现一次黑矇、意识模糊、单侧肢体无力或说话不清，**直接急诊**，不要等症状过去。',
    why:
      '依据：① 你自己在上述日期多次描述这些症状；② 你 2026-03-06 体检已有「电轴左偏 + 偶发室性早搏」；③ 黑矇/听力模糊叠加心脏异常属需要尽快排除脑血管与心律失常的情形（临床常规）。',
    basedOn: ['2026-09 间断黑矇', '听不清别人说话', '嘴唇发白', '睡 10 小时仍困倦', '2026-03-06 心电图：电轴左偏 + 偶发室性早搏'],
    sources: [],
    grade: '临床常规',
    confidence: 'high',
    note: '依据待补来源',
  },
];

let added = 0;
for (const it of ITEMS) {
  const sec = know.sections.find((s) => s.key === it.key);
  if (!sec) {
    console.log(`! 找不到分类 ${it.key}`);
    continue;
  }
  const id = `upd-${it.title.slice(0, 14).replace(/\s+/g, '')}`;
  if (sec.items.some((x) => x.id === id || x.title === it.title)) {
    console.log(`· 已存在，跳过：${it.title}`);
    continue;
  }
  sec.items.push({
    id,
    bucket: it.bucket,
    title: it.title,
    body: it.body,
    why: it.why,
    sources: it.sources,
    basedOn: it.basedOn,
    grade: it.grade,
    confidence: it.confidence,
    note: it.note,
    origin: '增量更新 2026-10-07',
    generatedAt: new Date().toISOString(),
  });
  added++;
  console.log(`+ ${it.bucket}  ${it.title}`);
}

know.updatedAt = new Date().toISOString();
writeFileSync(KNOW, JSON.stringify(know, null, 1), 'utf8');
const total = know.sections.reduce((a, s) => a + s.items.length, 0);
console.log(`\n新增 ${added} 条，结论总数 ${total}`);
