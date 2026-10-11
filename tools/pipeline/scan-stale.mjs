// 扫描「过时 / 无效」候选：只做识别与分类，不自动删除。
//
//   node scan-stale.mjs
//
// 输出 D:\dsh\health\stale-candidates.json，供控制台的「清理」页逐条处置。
//
// 判据分两类，语义完全不同：
//   superseded（过时≠无效）：同类状态项里被更晚的记录取代 —— 建议**归档**（折叠），不删
//   invalid（无效）：提取错误 / 第三方数据混入 / 猜测被当事实 / 完全重复 —— 建议删除或标错
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HEALTH_DIR } from './_paths.mjs';

const HEALTH = resolve(process.argv[2] ?? HEALTH_DIR);
const factsFile = JSON.parse(readFileSync(join(HEALTH, 'facts.json'), 'utf8'));
const know = existsSync(join(HEALTH, 'knowledge.json')) ? JSON.parse(readFileSync(join(HEALTH, 'knowledge.json'), 'utf8')) : { sections: [] };

const F = factsFile.facts ?? [];
const candidates = [];
const add = (o) => candidates.push(o);

// ---------- A. 状态类事实：被更晚的记录取代 ----------
// 精度优先：只有「同一个量、同一个标签、值不同」才算新旧版本。
// 指标（metric）是时间序列，不参与；作息/习惯的不同侧面（午睡 vs 周末补觉）也不算。
const QUANT = [
  { name: '身高', re: /身高/, pick: /\d{3}\s*(?:cm|厘米|公分)?/ },
  { name: '体重', re: /体重/, pick: /\d{2,3}(?:\.\d)?\s*(?:kg|公斤|斤)/ },
  { name: '增重目标', re: /(?:增重|体重)\s*目标|目标(?:体重|增重)/, pick: /\d{2,3}(?:-\d{2,3})?\s*(?:kg|公斤|斤)/ },
  { name: '在服药物', re: /在服|当前用药|服药方案/, pick: /[\u4e00-\u9fa5]{2,8}(?:片|胶囊|缓释)/ },
];
const normLabel = (s) => String(s ?? '').replace(/[\s（(].*$/g, '').trim();
for (const f of F) {
  if (['metric', 'attachment'].includes(f.kind)) continue;
  const label = f.label ?? '';
  // 刻意留作对照的历史值不动
  if (/供对照|误用|旧值|此前|历史|最早|备忘/.test(label)) continue;
  const q = QUANT.find((x) => x.re.test(label));
  if (!q) continue;
  const mine = String(f.value ?? '').match(q.pick)?.[0];
  if (!mine) continue;
  const peers = F.filter((g) => {
    if (g.id === f.id || ['metric', 'attachment'].includes(g.kind)) return false;
    if (/供对照|误用|旧值|此前|历史|最早|备忘/.test(g.label ?? '')) return false;
    if (!q.re.test(g.label ?? '')) return false;
    // 标签必须实质相同（去掉括号补充后一致），否则是不同侧面
    if (normLabel(g.label) !== normLabel(label)) return false;
    const other = String(g.value ?? '').match(q.pick)?.[0];
    return other && other !== mine;
  });
  if (!peers.length) continue;
  const newest = peers.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''))).at(-1);
  if (String(newest.date ?? '') <= String(f.date ?? '')) continue;
  add({
    type: 'superseded',
    layer: 'fact',
    id: f.id,
    kind: f.kind,
    label: f.label,
    value: String(f.value ?? '').slice(0, 80),
    date: f.date,
    reason: `「${q.name}」在 ${String(newest.date).slice(0, 10)} 有更新的记录：${String(newest.value ?? '').slice(0, 40)}`,
    suggestion: 'archive',
    newerId: newest.id,
  });
}

// ---------- B. 第三方数据混入 ----------
// 必须同时满足：出现明确的他人指代 **且** 该指代附近带身高/体重/年龄这类个人量，
// 并且标签里没有任何第一人称。只靠"她/对方"这类词判会大量误伤。
const THIRD_WITH_MEASURE = /(她|他|对方|第三方|女友|男友|前妻|同事|邻居|主播|患者|路人|博主)[^\n]{0,24}?(\d{2,3}\s*(?:cm|kg|斤|厘米|公斤)|[0-9]{1,2}\s*岁)/;
for (const f of F) {
  const label = f.label ?? '';
  if (/我|本人|自己/.test(label)) continue;         // 标签明确是本人，跳过
  const blob = `${f.value ?? ''} ${f.evidence ?? ''}`;
  if (!/我/.test(blob) && THIRD_WITH_MEASURE.test(blob)) {
    add({
      type: 'invalid',
      layer: 'fact',
      id: f.id,
      kind: f.kind,
      label,
      value: String(f.value ?? '').slice(0, 80),
      date: f.date,
      reason: '描述的是**别人**的身高/体重/年龄（有明确他人指代 + 具体个人量，且全文没有"我"）',
      suggestion: 'delete',
    });
  }
}

// ---------- C. 混进个人事实里的「通用参考值」 ----------
// 例如「对应身高175cm的正常体重范围 56.7–73.2」「理想中位体重 64.3」——这是通用知识，
// 不是你的数据。判据要严：必须**以参考/对照开头**，且不能是目标/建议/要求。
const GENERIC_LABEL = /^(对应|参考[:：]|正常体重|成人正常|理想体重|标准体重|健康体重区间|中位体重|BMI\s*(?:正常)?范围)/;
const NOT_GENERIC = /目标|建议|要求|结论|我|自述|实测|医嘱/;
for (const f of F) {
  const label = f.label ?? '';
  if (GENERIC_LABEL.test(label) && !NOT_GENERIC.test(label)) {
    add({
      type: 'invalid',
      layer: 'fact',
      id: f.id,
      kind: f.kind,
      label,
      value: String(f.value ?? '').slice(0, 80),
      date: f.date,
      reason: '这是**通用参考值**（按身高算出来的标准/理想范围），不是你自己测出来的数据；留在事实里会被误当成你的指标',
      suggestion: 'delete',
    });
    continue; // 已归类，不再重复命中其它规则
  }
  if (/\b参考|\b对照/.test(label) && f.status === '模型推测' && !NOT_GENERIC.test(label)) {
    add({
      type: 'invalid',
      layer: 'fact',
      id: f.id,
      kind: f.kind,
      label,
      value: String(f.value ?? '').slice(0, 80),
      date: f.date,
      reason: '看起来是通用参考/对照值而非你的个人数据，请确认是否该留在事实列表里',
      suggestion: 'review',
    });
    continue;
  }
}

// ---------- D. 推测与担忧（应当保留，但别被当成事实用） ----------
// 「脂肪肝（仅为担忧，未确诊）」「睾酮偏低（仅为担忧，未检查）」这类**有意记录的不确定性**
// 是有价值的，不删、不归档，只提示它在别处不宜被当作确诊。
const CONCERN = /仅为担忧|未确诊|未检查|可疑|待排除|怀疑/;
for (const f of F) {
  if (f.status !== '模型推测') continue;
  if (!CONCERN.test(`${f.label ?? ''} ${f.value ?? ''}`)) continue;
  add({
    type: 'concern',
    layer: 'fact',
    id: f.id,
    kind: f.kind,
    label: f.label,
    value: String(f.value ?? '').slice(0, 80),
    date: f.date,
    reason: '这是**有意保留的"担忧/未确诊"记录**——不要删（它提醒你这件事没查过），但也别在任何地方当成已确诊',
    suggestion: 'keep',
  });
}

// ---------- E. 猜测出来的数值被放在硬数据类别里 ----------
for (const f of F) {
  if (f.status !== '模型推测') continue;
  if (!['profile', 'metric', 'condition'].includes(f.kind)) continue;
  if (CONCERN.test(`${f.label ?? ''} ${f.value ?? ''}`)) continue; // 上面已归类
  if (GENERIC_LABEL.test(f.label ?? '')) continue; // 上面已归类
  add({
    type: 'invalid',
    layer: 'fact',
    id: f.id,
    kind: f.kind,
    label: f.label,
    value: String(f.value ?? '').slice(0, 80),
    date: f.date,
    reason: '这是**模型推算**出来的数值，却归在需要实测的类别里（profile/metric/condition），容易被当成实测值',
    suggestion: 'flag',
  });
}

// ---------- D. 待办可能已完成（原定时间已过很久） ----------
const today = new Date();
for (const f of F) {
  if (f.kind !== 'open_question') continue;
  const d = f.date ? new Date(f.date) : null;
  if (!d || Number.isNaN(d.getTime())) continue;
  const months = (today - d) / (1000 * 60 * 60 * 24 * 30);
  if (months >= 3 && /复查|复诊|随诊|检查|就诊|挂号/.test(`${f.label} ${f.value ?? ''}`)) {
    add({
      type: 'stale-todo',
      layer: 'fact',
      id: f.id,
      kind: f.kind,
      label: f.label,
      value: String(f.value ?? '').slice(0, 80),
      date: f.date,
      reason: `这是 ${String(f.date).slice(0, 10)} 提出的待办，已过去约 ${months.toFixed(0)} 个月——**可能已完成，也可能一直没做**`,
      suggestion: 'review',
    });
  }
}

// ---------- E. 同一天重复提取（真正的冗余） ----------
// 注意：性别/年龄/出生日期这类**稳定身份项**在不同对话里反复出现是互相印证，
// 不是冗余，不能删。只在「同一天、同标签、同值、不同出处」时才算重复提取。
const IDENTITY = /性别|出生|年龄|籍贯|学历|职业|居住|所在/;
const dupKey = new Map();
for (const f of F) {
  if (IDENTITY.test(f.label ?? '')) continue;
  const k = [String(f.date ?? '').slice(0, 10), f.kind, f.label, f.value ?? ''].join('|').toLowerCase();
  if (!dupKey.has(k)) dupKey.set(k, []);
  dupKey.get(k).push(f);
}
for (const [, group] of dupKey) {
  if (group.length < 2) continue;
  const sorted = [...group].sort((a, b) => String(a.source ?? '').localeCompare(String(b.source ?? '')));
  for (const f of sorted.slice(1)) {
    add({
      type: 'invalid',
      layer: 'fact',
      id: f.id,
      kind: f.kind,
      label: f.label,
      value: String(f.value ?? '').slice(0, 80),
      date: f.date,
      reason: `同一天从另一个会话里重复提取了同一条（先出现的出处：${String(sorted[0].source ?? '').slice(0, 34)}）`,
      suggestion: 'delete',
    });
  }
}

// ---------- F. 结论层：引用了已被取代的数值 ----------
const SUPERSEDED_VALUES = candidates.filter((c) => c.type === 'superseded' && /身高|体重/.test(c.label ?? '')).map((c) => String(c.value ?? '').match(/\d{2,3}\s*(cm|kg|厘米|公斤)/)?.[0]).filter(Boolean);
for (const s of know.sections) {
  for (const it of s.items) {
    const blob = `${it.body ?? ''} ${it.why ?? ''} ${(it.basedOn ?? []).join(' ')}`;
    for (const v of new Set(SUPERSEDED_VALUES)) {
      if (blob.includes(v)) {
        add({
          type: 'stale-ref',
          layer: 'knowledge',
          section: s.key,
          id: it.id,
          label: it.title,
          value: `引用了 ${v}`,
          reason: `这条结论的依据里引用了早期数值「${v}」（已被更晚的体重/身高记录取代），建议核对后更新`,
          suggestion: 'review',
        });
      }
    }
  }
}

// ---------- 汇总 ----------
const byType = {};
for (const c of candidates) byType[c.type] = (byType[c.type] ?? 0) + 1;
const bySuggest = {};
for (const c of candidates) bySuggest[c.suggestion] = (bySuggest[c.suggestion] ?? 0) + 1;

writeFileSync(join(HEALTH, 'stale-candidates.json'), JSON.stringify({ scannedAt: new Date().toISOString(), totalFacts: F.length, byType, bySuggest, candidates }, null, 1));

console.log(`扫描 ${F.length} 条事实 + ${know.sections.reduce((a, s) => a + s.items.length, 0)} 条结论`);
console.log('\n按类型:');
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log('\n按建议:');
for (const [k, v] of Object.entries(bySuggest).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}（${k === 'archive' ? '归档，可恢复' : k === 'delete' ? '删除' : k === 'flag' ? '标记存疑' : '人工复核'}）`);
console.log('\n=== 抽样 25 条 ===');
for (const c of candidates.slice(0, 25)) console.log(`  [${c.type}] ${c.label} = ${String(c.value).slice(0, 34)}\n        ${c.reason}`);
console.log(`\nwrote ${join(HEALTH, 'stale-candidates.json')}`);
