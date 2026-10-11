// 验证控制台的「修正 → 同步」链路真的通。
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const H = 'http://127.0.0.1:8791';
const api = async (p, body) => (await fetch(H + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json();

const state = await api('/api/state');
const target = state.facts.find((f) => f.kind === 'profile' && /身高/.test(f.label)) ?? state.facts[0];
console.log(`测试目标事实: ${target.id} 「${target.label}」 = ${target.value}`);

// 1. 写一条修正
const before = target.value;
const r1 = await api('/api/fact', { id: target.id, fields: { value: (before ?? '') + '（测试批注）', note: '自动化测试，稍后撤销' } });
console.log(`写入修正: ${r1.ok ? 'ok' : JSON.stringify(r1).slice(0, 200)}`);

// 2. 确认读得到
const s2 = await api('/api/state');
const t2 = s2.facts.find((f) => f.id === target.id);
console.log(`回读: value="${t2?.value}"  已修正标记=${t2?._corrected === true}  批注="${t2?.corrected?.note ?? ''}"`);

// 3. 同步（会重新生成 KNOWLEDGE.md 与档案文件）
const sync = await api('/api/sync', {});
console.log(`同步: ok=${sync.ok} status=${sync.status}`);
console.log((sync.stdout ?? '').split('\n').filter(Boolean).slice(0, 6).map((l) => '   ' + l).join('\n'));
if (sync.stderr) console.log('   stderr: ' + sync.stderr.slice(0, 400));

// 4. 档案里是否体现了修正
const prof = existsSync('../health/PROFILE.md') ? readFileSync('../health/PROFILE.md', 'utf8') : '';
console.log(`PROFILE.md 含「用户修正」字样: ${prof.includes('用户修正')}`);

// 5. 撤销测试修正
const r5 = await api('/api/fact', { id: target.id, action: 'clear' });
console.log(`撤销: ${r5.ok ? 'ok' : JSON.stringify(r5).slice(0, 200)}`);
const sync2 = await api('/api/sync', {});
console.log(`再次同步: ok=${sync2.ok}`);
const s3 = await api('/api/state');
console.log(`撤销后回读: value="${s3.facts.find((f) => f.id === target.id)?.value}"  已修正标记=${s3.facts.find((f) => f.id === target.id)?._corrected === true}`);
