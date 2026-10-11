// 增量更新后的整体核验。
const H = 'http://127.0.0.1:8791';
const api = async (p) => (await fetch(H + p)).json();
const fs = await import('node:fs');

const st = await api('/api/state');
console.log('=== 控制台（在线）===');
const kTotal = st.knowledge.sections.reduce((a, s) => a + s.items.length, 0);
console.log(` 结论 ${kTotal} 条 / ${st.knowledge.sections.length} 分类；事实 ${st.facts.length} 条`);
for (const s of st.knowledge.sections) console.log(`   ${s.title}: ${s.items.length}`);
const urgent = st.facts ? null : null;

const stale = await api('/api/stale');
console.log(` 清理候选 ${stale.candidates.length} 条（待处置 ${stale.pending}）`);

console.log('\n=== 知识库 ===');
const cat = JSON.parse(fs.readFileSync('../dsh-kb-sync/data/kb/catalog.json', 'utf8'));
const recs = fs.readFileSync('../dsh-kb-sync/data/kb/conversations.jsonl', 'utf8').split('\n').filter(Boolean);
const dates = cat.map((c) => String(c.inserted_at).slice(0, 10)).sort();
console.log(` 会话 ${cat.length} 条（jsonl ${recs.length} 条）`);
console.log(` 时间跨度 ${dates[0]} → ${dates.at(-1)}`);
console.log(` 总字符 ${cat.reduce((a, c) => a + c.chars, 0).toLocaleString('en-US')}`);
const newOnes = cat.filter((c) => c.idx >= 2446);
console.log(` 本次新增 ${newOnes.length} 条`);
const md = fs.readdirSync('../dsh-kb-sync/data/kb/conversations').length;
console.log(` Markdown 文件 ${md} 个 ${md === cat.length ? '✔ 与目录一致' : '✗ 不一致'}`);
const topics = JSON.parse(fs.readFileSync('../dsh-kb-sync/data/kb/topics.json', 'utf8'));
console.log(` 话题 ${topics.topics.length} 个，覆盖 ${topics.topics.reduce((a, t) => a + t.count, 0)} 条`);
const spec = JSON.parse(fs.readFileSync('../dsh-kb-sync/data/kb/specialties.json', 'utf8'));
console.log(` 专题 ${spec.topics.length} 个，覆盖 ${new Set(spec.topics.flatMap((t) => t.members)).size} 条`);

console.log('\n=== 健康档案 ===');
const facts = JSON.parse(fs.readFileSync('../health/facts.json', 'utf8')).facts;
const subj = {};
for (const f of facts) subj[f.subject ?? '(未标)'] = (subj[f.subject ?? '(未标)'] ?? 0) + 1;
console.log(` 事实 ${facts.length} 条，归属 ${JSON.stringify(subj)}`);
const files = ['PROFILE', 'METRICS', 'MEDICATIONS', 'SYMPTOMS', 'PSYCHE', 'LIFESTYLE', 'OPEN-ISSUES', 'SOURCES', 'FRIEND', 'KNOWLEDGE'];
for (const f of files) {
  const p = `../health/${f}.md`;
  console.log(`   ${f}.md ${fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) + ' KB' : '缺失'}`);
}
const prof = fs.readFileSync('../health/PROFILE.md', 'utf8');
const rows = prof.split('\n').filter((l) => l.startsWith('| '));
console.log(` PROFILE 表格行 ${rows.length}，其中含女性生理内容 ${rows.filter((l) => /18\s*岁.*女|月经|阴道|怀孕|罩杯/.test(l)).length} 条`);
