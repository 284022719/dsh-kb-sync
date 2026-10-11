// 诊断归档为何未生效
import { readFileSync } from 'node:fs';
const H = 'http://127.0.0.1:8791';
const api = async (p, body) => (await fetch(H + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json();

const stale = await api('/api/stale');
const target = stale.candidates.find((c) => c.suggestion === 'archive');
console.log('目标 id:', target.id, '| label:', target.label);

const state = await api('/api/state');
const fact = state.facts.find((f) => f.id === target.id);
console.log('server 端这条事实:', JSON.stringify({ id: fact.id, label: fact.label, value: String(fact.value).slice(0, 40), archived: fact._archived }));

const facts = JSON.parse(readFileSync('../health/facts.json', 'utf8')).facts;
const same = facts.filter((f) => f.id === target.id);
console.log('facts.json 里能按该 id 找到:', same.length, same.map((f) => f.label));

const r = await api('/api/prune', { action: 'archive', ids: [target.id], layer: 'fact' });
console.log('归档结果:', JSON.stringify(r));
console.log('archived.json:', readFileSync('../health/archived.json', 'utf8'));

const sync = await api('/api/sync', {});
console.log('\n=== sync stdout ===');
console.log((sync.stdout ?? '').split('\n').filter(Boolean).join('\n'));
console.log('=== sync stderr ===');
console.log((sync.stderr ?? '').slice(0, 600));

const prof = readFileSync('../health/PROFILE.md', 'utf8');
console.log('\nPROFILE.md 是否仍含该 label:', prof.includes(target.label));
console.log('PROFILE.md 是否含「已折叠」相关行:', /已折叠/.test(prof));
const archivedIds = JSON.parse(readFileSync('../health/archived.json', 'utf8')).archivedFacts;
console.log('archived.json 里的 id:', archivedIds);
await api('/api/prune', { action: 'unarchive', ids: [target.id], layer: 'fact' });
await api('/api/sync', {});
console.log('\n（已恢复）');
