// 端到端验证「清理」链路：归档 → 档案里消失 → 恢复回来。
import { readFileSync, existsSync } from 'node:fs';

const H = 'http://127.0.0.1:8791';
const api = async (p, body) => (await fetch(H + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json();

const stale = await api('/api/stale');
console.log(`候选 ${stale.candidates.length} 条，待处置 ${stale.pending}`);
const target = stale.candidates.find((c) => c.suggestion === 'archive');
console.log(`\n拿一条早期版本做测试：\n  ${target.label} = ${target.value}\n  原因：${target.reason}`);

const profBefore = readFileSync('../health/PROFILE.md', 'utf8');
const inBefore = profBefore.includes(String(target.value).slice(0, 20));
console.log(`\n归档前 PROFILE.md 含该值: ${inBefore}`);

const r1 = await api('/api/prune', { action: 'archive', ids: [target.id], layer: 'fact' });
console.log(`归档: ok=${r1.ok} count=${r1.count} 累计归档=${r1.archived}`);

// 触发档案重建（sync 会重跑 build-health-profile）
const sync = await api('/api/sync', {});
console.log(`同步: ok=${sync.ok}`);
const profAfter = readFileSync('../health/PROFILE.md', 'utf8');
const inAfter = profAfter.includes(String(target.value).slice(0, 20));
console.log(`归档后 PROFILE.md 含该值: ${inAfter}  ${inBefore && !inAfter ? '→ 已从档案里折叠 ✔' : '→ 未生效 ✗'}`);
const archivedFile = JSON.parse(readFileSync('../health/archived.json', 'utf8'));
console.log(`archived.json: ${archivedFile.archivedFacts.length} 条`);

// 恢复
const r2 = await api('/api/prune', { action: 'unarchive', ids: [target.id], layer: 'fact' });
console.log(`\n恢复: ok=${r2.ok} 剩余归档=${r2.archived}`);
await api('/api/sync', {});
const profRestored = readFileSync('../health/PROFILE.md', 'utf8');
console.log(`恢复后 PROFILE.md 含该值: ${profRestored.includes(String(target.value).slice(0, 20))} → ${profRestored.includes(String(target.value).slice(0, 20)) ? '已恢复 ✔' : '未恢复 ✗'}`);

const stale2 = await api('/api/stale');
console.log(`\n最终：候选 ${stale2.candidates.length}，待处置 ${stale2.pending}，已处置 ${stale2.done}`);
const backups = existsSync('../health') ? (await import('node:fs')).readdirSync('../health').filter((f) => f.startsWith('facts.backup-')) : [];
console.log(`备份文件: ${backups.length} 个 ${backups.slice(0, 3).join(', ')}`);
