// 验证在线控制台提供的是新版总览界面。
const H = 'http://127.0.0.1:8791';
const r = await fetch(H + '/');
const html = await r.text();
console.log('GET / ->', r.status, '| 含总览板代码:', html.includes('renderBoard'), '| 默认页签为总览:', html.includes('data-tab="board" class="tab on"'));
const o = await fetch(H + '/overview');
const t = await o.text();
console.log('GET /overview ->', o.status, t.length, 'bytes | 含最优先横幅:', t.includes('已过期'));
const s = await fetch(H + '/api/state');
const j = await s.json();
const total = j.knowledge.sections.reduce((a, x) => a + x.items.length, 0);
console.log('状态: 分类', j.knowledge.sections.length, '个 | 结论', total, '条 | 事实', j.facts.length, '条');
const urgent = j.knowledge.sections.flatMap((x) => x.items).filter((i) => /已过期|立即安排/.test(i.bucket || ''));
console.log('最优先条目:', urgent.length, '条 ->', urgent.map((i) => i.title).join(' / '));
