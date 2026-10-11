// 把联网生成的行动结论合并成可编辑的 knowledge.json（控制台的数据源）。
//
//   node build-conclusions.mjs           # 合并 health-research/*.json
//   node build-conclusions.mjs --force   # 已有条目也覆盖（默认保留用户改过的）
//
// 规则：**用户改过的条目永不被覆盖**（editedByUser/createdByUser 标记）。
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HEALTH = resolve(process.argv[2] ?? '..\\health');
const SRC = 'health-research';
const FORCE = process.argv.includes('--force');
const KNOW = join(HEALTH, 'knowledge.json');

const SECTION_MAP = {
  饮食: { key: 'diet', title: '吃什么', order: 1 },
  增重增肌: { key: 'weight', title: '增重增肌：吃与练', order: 2 },
  复查就医: { key: 'followup', title: '复查与就医', order: 3 },
  生活习惯: { key: 'habits', title: '生活习惯与补剂', order: 4 },
};
const SECTION_DESC = {
  diet: '基于你的指标（尿酸偏高、胆红素升高、胆囊炎、双肾尿盐结晶、偏瘦）与权威指南给出的宜吃/适量/避免清单。',
  weight: '针对 175cm/约52kg、BMI≈17、每周 3-4 次力量训练、睡眠约 6 小时的具体方案。',
  followup: '把体检报告的复查要求、已过期项与心理复诊排成一张可执行的清单。',
  habits: '作息、饮水与饮料、补剂、久坐等可以逐条改掉的习惯。',
};

const files = existsSync(SRC) ? readdirSync(SRC).filter((f) => /^\d+-.*\.json$/.test(f)).sort() : [];
if (!files.length) {
  console.error('health-research/ 下还没有研究结果');
  process.exit(1);
}

let know = existsSync(KNOW) ? JSON.parse(readFileSync(KNOW, 'utf8')) : { version: 1, updatedAt: null, sections: [] };
know.sections ??= [];

const byKey = new Map(know.sections.map((s) => [s.key, s]));
let added = 0,
  kept = 0,
  updated = 0;

for (const f of files) {
  let j;
  try {
    j = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
  } catch (e) {
    console.error(`! ${f} 解析失败: ${e.message}`);
    continue;
  }
  for (const it of j.items ?? []) {
    const map = SECTION_MAP[it.section] ?? { key: it.section, title: it.section, order: 9 };
    let sec = byKey.get(map.key);
    if (!sec) {
      sec = { key: map.key, title: map.title, desc: SECTION_DESC[map.key] ?? '', order: map.order, items: [] };
      know.sections.push(sec);
      byKey.set(map.key, sec);
    }
    const id = `${f.replace(/\.json$/, '')}-${(it.title ?? '').slice(0, 12).replace(/\s+/g, '')}`;
    const existingIdx = sec.items.findIndex((x) => x.id === id);
    const item = {
      id,
      bucket: it.bucket ?? '未分组',
      title: it.title ?? '',
      body: it.body ?? '',
      why: it.why ?? '',
      sources: it.sources ?? [],
      basedOn: it.basedOn ?? [],
      grade: it.grade ?? '经验',
      confidence: it.confidence ?? 'medium',
      origin: f,
      generatedAt: j.generatedAt ?? new Date().toISOString(),
    };
    if (existingIdx < 0) {
      sec.items.push(item);
      added++;
    } else {
      const cur = sec.items[existingIdx];
      if (FORCE || !(cur.editedByUser || cur.createdByUser)) {
        // 保留用户批注与状态
        sec.items[existingIdx] = { ...item, ...(cur.status ? { status: cur.status, note: cur.note, flaggedAt: cur.flaggedAt, flaggedByUser: true } : {}) };
        updated++;
      } else kept++;
    }
  }
}

know.sections.sort((a, b) => (a.order ?? 9) - (b.order ?? 9));
// bucket 排序：让「宜吃」在「适量」前、「避免」在后
const BUCKET_ORDER = ['立即改', '已过期/立即安排', '核心动作', '宜吃', '饮食安排', '近期安排', '适量', '训练调整', '逐步改', '按期随访', '监测', '继续保持', '避免', '未分组'];
for (const s of know.sections) {
  s.items.sort((a, b) => {
    const ia = BUCKET_ORDER.indexOf(a.bucket);
    const ib = BUCKET_ORDER.indexOf(b.bucket);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}
know.updatedAt = new Date().toISOString();
writeFileSync(KNOW, JSON.stringify(know, null, 1), 'utf8');

console.log(`读入 ${files.length} 份研究结果`);
console.log(`新增 ${added} 条，更新 ${updated} 条，保留你的改动 ${kept} 条`);
for (const s of know.sections) {
  const b = {};
  for (const i of s.items) b[i.bucket] = (b[i.bucket] ?? 0) + 1;
  console.log(`  ${s.title}（${s.items.length}）: ${Object.entries(b).map(([k, v]) => `${k} ${v}`).join('，')}`);
}
console.log(`\nwrote ${KNOW}`);
