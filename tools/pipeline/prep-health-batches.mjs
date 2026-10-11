// Pre-screen the health conversations: which ones actually contain PERSONAL data
// (as opposed to generic medical Q&A)? Score by first-person and personal-metric
// signals, then pack the winners into char-balanced extraction batches.
//
//   node prep-health-batches.mjs [maxCharsPerBatch=140000]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KB_DIR, PIPE_DIR, HEALTH_BATCHES } from './_paths.mjs';

const MAX = Number(process.argv[2] ?? 140000);
const KB = KB_DIR;
const sel = JSON.parse(readFileSync(join(PIPE_DIR, 'health-selection.json'), 'utf8'));

const PERSONAL = /我(的|本人)?|自己|本人|体检|报告|化验|指标|尿酸|血糖|血压|血脂|胆红素|肌酐|结节|体重|身高|BMI|体脂|症状|疼|痛|头晕|失眠|睡眠|熬夜|用药|吃药|剂量|副作用|补剂|蛋白粉|肌酸|增重|增肌|减肥|焦虑|抑郁|拖延|ADHD|注意力|情绪/g;
// Concrete personal measurements: real biometric units only (percentages and
// generic time words are everywhere in advice text and would drown the signal).
const NUMERIC = /(\d+(?:\.\d+)?)\s*(μmol\/L|umol\/L|mmol\/L|mg\/dL|mg\/L|g\/L|mmHg|kg|公斤|斤|cm|厘米|mm|毫米|次\/分|岁|BMI)/g;
const LABELS = /(体检|化验|检验报告|检测报告|诊断|复查|医嘱|处方|门诊|挂号|病历|出院|手术|吃药|服药|用药)/g;
// personal-context co-occurrence: "我…体检/症状/药/指标" within one line
const PERS_CTX = /(我|本人)[^\n]{0,24}(体检|报告|症状|疼|痛|药|剂量|血压|血糖|尿酸|体重|身高|诊断|医生|挂号|处方|手术|睡眠|失眠)/g;

const rows = [];
for (const s of sel) {
  const text = readFileSync(`${KB}/${s.path}`, 'utf8');
  const hits = text.match(PERSONAL) ?? [];
  const uniq = new Set(hits.map((h) => h));
  const firstPerson = (text.match(/我(的|本人)?/g) ?? []).length;
  const attach = (text.match(/📎 附件/g) ?? []).length;
  const numeric = new Set((text.match(NUMERIC) ?? []).map((x) => x.replace(/\s+/g, '')));
  const labels = new Set(text.match(LABELS) ?? []);
  const persCtx = (text.match(PERS_CTX) ?? []).length;
  rows.push({
    ...s,
    hits: hits.length,
    uniq: [...uniq],
    firstPerson,
    attach,
    numeric: [...numeric],
    labels: [...labels],
    persCtx,
    chars: text.length,
  });
}

// personal score: first-person density + metric vocabulary + attachments + bulk
for (const r of rows) {
  r.score = Math.round(
    r.firstPerson * 1.0 + r.uniq.length * 4 + r.attach * 25 + Math.min(60, r.chars / 1500) + Math.min(40, r.messages * 1.5),
  );
  // data density: real measurements, clinical vocabulary, personal co-occurrence
  r.dataScore = Math.round(
    r.numeric.length * 6 + r.labels.length * 24 + r.attach * 40 + r.persCtx * 3 + Math.min(60, r.chars / 5000),
  );
}
rows.sort((a, b) => b.dataScore - a.dataScore);

const TOP = 34;
const KEEP = rows.slice(0, TOP);
console.log(`健康相关会话 ${rows.length} 个 → 取个人数据信号最强的 ${KEEP.length} 个`);
console.log(`保留部分字符数 ${KEEP.reduce((a, r) => a + r.chars, 0).toLocaleString('en-US')}`);
console.log('\n=== 入选会话 ===');
for (const r of KEEP)
  console.log(`  dScore ${String(r.dataScore).padStart(4)}  ${String(Math.round(r.chars / 1000)).padStart(4)}k字  ${r.date}  ${r.title}   〔${r.labels.slice(0, 3).join(' ')}｜${r.numeric.slice(0, 5).join(' ')}〕`);

// pack into batches (greedy, largest first) — big ones get their own batch
const batches = [];
let cur = { chars: 0, items: [] };
for (const r of KEEP) {
  if (cur.items.length && cur.chars + r.chars > MAX) {
    batches.push(cur);
    cur = { chars: 0, items: [] };
  }
  cur.items.push(r);
  cur.chars += r.chars;
}
if (cur.items.length) batches.push(cur);

if (existsSync(HEALTH_BATCHES)) rmSync(HEALTH_BATCHES, { recursive: true, force: true });
mkdirSync(HEALTH_BATCHES, { recursive: true });
const manifest = [];
batches.forEach((b, i) => {
  const name = join(HEALTH_BATCHES, `health-${String(i + 1).padStart(2, '0')}.tsv`);
  const lines = [
    'idx\tdate\tmessages\tchars\ttitle\tpath',
    ...b.items.map((r) => [r.idx, r.date, r.messages, r.chars, String(r.title).replace(/[\t\r\n]/g, ' '), `${KB}/${r.path}`].join('\t')),
  ];
  writeFileSync(name, lines.join('\n'));
  manifest.push({ batch: i + 1, file: name, count: b.items.length, chars: b.chars, titles: b.items.map((r) => r.title) });
});
writeFileSync(join(HEALTH_BATCHES, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`\n批次数: ${batches.length}（每批 <= ${MAX.toLocaleString('en-US')} 字符）`);
for (const m of manifest) console.log(`  ${m.file}  ${String(m.count).padStart(2)} 个会话  ${Math.round(m.chars / 1000)}k 字`);
writeFileSync(join(PIPE_DIR, 'attic', 'health-selection-scored.json'), JSON.stringify(rows, null, 1));
