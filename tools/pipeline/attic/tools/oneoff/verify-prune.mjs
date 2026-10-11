// 精确验证：归档按 label 消失、删除会建备份、可从备份恢复。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const H = 'http://127.0.0.1:8791';
const api = async (p, body) => (await fetch(H + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const prof = () => readFileSync('../health/PROFILE.md', 'utf8');

console.log('=== 1. 归档：按 label 判断是否从档案里折叠 ===');
const stale = await api('/api/stale');
const sup = stale.candidates.find((c) => c.suggestion === 'archive');
console.log(`  目标：${sup.label}（${sup.value}）`);
console.log(`  归档前档案含该 label：${prof().includes(sup.label)}`);
await api('/api/prune', { action: 'archive', ids: [sup.id], layer: 'fact' });
await api('/api/sync', {});
console.log(`  归档后档案含该 label：${prof().includes(sup.label)}`);
await api('/api/prune', { action: 'unarchive', ids: [sup.id], layer: 'fact' });
await api('/api/sync', {});
console.log(`  恢复后档案含该 label：${prof().includes(sup.label)}`);

console.log('\n=== 2. 删除：应生成备份，且可从备份还原 ===');
const del = (await api('/api/stale')).candidates.find((c) => c.suggestion === 'delete');
console.log(`  目标：${del.label} = ${del.value}`);
const before = read('../health/facts.json').facts.length;
const b0 = readdirSync('../health').filter((f) => f.startsWith('facts.backup-')).length;
await api('/api/prune', { action: 'delete', ids: [del.id], layer: 'fact' });
const after = read('../health/facts.json').facts.length;
const b1 = readdirSync('../health').filter((f) => f.startsWith('facts.backup-')).length;
console.log(`  facts.json: ${before} → ${after} 条（-${before - after}）；备份文件 ${b0} → ${b1}`);

// 从最新备份还原
const bk = readdirSync('../health').filter((f) => f.startsWith('facts.backup-')).sort().at(-1);
const snapshot = read(`../health/${bk}`);
SnapshotRestore: {
  writeFileSync('../health/facts.json', JSON.stringify(snapshot, null, 1), 'utf8');
}
const restored = read('../health/facts.json').facts.length;
console.log(`  从 ${bk} 还原后：${restored} 条 ${restored === before ? '✔' : '✗'}`);

console.log('\n=== 3. 清理页状态 ===');
const s2 = await api('/api/stale');
console.log(`  候选 ${s2.candidates.length}，待处置 ${s2.pending}，已处置 ${s2.done}`);
console.log(`  已归档 id 数：${read('../health/archived.json').archivedFacts.length}`);
