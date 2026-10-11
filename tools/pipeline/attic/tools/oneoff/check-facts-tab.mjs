// 最终核验：在线控制台是否已提供修好的事实页。
const h = await (await fetch('http://127.0.0.1:8791/')).text();
const checks = [
  ['总览板代码', h.includes('renderBoard')],
  ['默认页签＝总览', h.includes('class="tab on" data-tab="board"')],
  ['事实表用滚动容器', h.includes('tablewrap')],
  ['粘性表头改到容器内(top:0)', h.includes('position:sticky;top:0;z-index:2')],
  ['旧写法 top:57px 已移除', !h.includes('top:57px')],
  ['等级说明：报告数值', h.includes('报告里的具体数字')],
  ['等级说明：报告建议', h.includes('报告给出的建议')],
  ['等级说明：模型推测', h.includes('当时只是猜测')],
  ['深链支持 #facts', h.includes("__START_TAB__")],
];
for (const [k, v] of checks) console.log((v ? '  ok   ' : '  MISS ') + k);

const j = await (await fetch('http://127.0.0.1:8791/api/state')).json();
const g = j.facts.filter((f) => /BMI回到正常范围/.test(f.label));
console.log('\n那条 goal 的等级现在是:', g.map((f) => f.status).join(','), '（应为 报告建议）');
const dist = {};
for (const f of j.facts) dist[f.kind + '/' + f.status] = (dist[f.kind + '/' + f.status] ?? 0) + 1;
console.log('goal 类等级分布:', Object.entries(dist).filter(([k]) => k.startsWith('goal/')).map(([k, v]) => k + '×' + v).join('  '));
