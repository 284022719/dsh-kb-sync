// Full statistics over the official export: fragment types, models, branching, sizes.
import { readFileSync, writeFileSync } from 'node:fs';
const convs = JSON.parse(readFileSync('raw/conversations.json', 'utf8'));

const fragHist = {};
const modelHist = {};
const perConvKeys = new Set();
let nodes = 0,
  nodesWithMsg = 0,
  branchPoints = 0,
  maxDepth = 0,
  emptyConvs = 0;
const fragKeysByType = {};
const fragExamples = {};
let totalChars = 0;

for (const c of convs) {
  perConvKeys.add(Object.keys(c).join('|'));
  const map = c.mapping ?? {};
  const ids = Object.keys(map);
  nodes += ids.length;
  let convMsgs = 0;
  for (const id of ids) {
    const n = map[id];
    if ((n.children ?? []).length > 1) branchPoints++;
    const m = n.message;
    if (!m) continue;
    nodesWithMsg++;
    convMsgs++;
    modelHist[m.model ?? '(none)'] = (modelHist[m.model ?? '(none)'] ?? 0) + 1;
    for (const f of m.fragments ?? []) {
      fragHist[f.type] = (fragHist[f.type] ?? 0) + 1;
      fragKeysByType[f.type] ??= [...new Set([...(fragKeysByType[f.type] ?? []), ...Object.keys(f)])];
      fragExamples[f.type] ??= JSON.stringify(f).slice(0, 300);
      if (typeof f.content === 'string') totalChars += f.content.length;
    }
  }
  if (convMsgs === 0) emptyConvs++;
  // depth = longest parent chain
  let d = 0;
  for (const id of ids) {
    let cur = map[id],
      steps = 0;
    while (cur?.parent && cur.parent !== 'root' && map[cur.parent] && steps < 5000) {
      cur = map[cur.parent];
      steps++;
    }
    d = Math.max(d, steps);
  }
  maxDepth = Math.max(maxDepth, d);
}

console.log('conversations:', convs.length, '| empty:', emptyConvs);
console.log('total nodes:', nodes, '| nodes with message:', nodesWithMsg);
console.log('branch points (children>1):', branchPoints);
console.log('max depth:', maxDepth);
console.log('total text chars:', totalChars, `(~${Math.round(totalChars / 1000)}k chars, ~${Math.round(totalChars / 1.5 / 1000)}k tokens zh-ish)`);
console.log('\nfragment types:');
for (const [k, v] of Object.entries(fragHist).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);
console.log('\nmodels:', JSON.stringify(modelHist, null, 1));
console.log('\nconversation key sets:', [...perConvKeys].join(' ;; '));
console.log('\nfragment keys per type:');
for (const [t, ks] of Object.entries(fragKeysByType)) console.log(`  ${t}: ${ks.join(', ')}`);
console.log('\nfragment examples:');
for (const [t, ex] of Object.entries(fragExamples)) console.log(`  ${t}: ${ex}`);
writeFileSync('probe-export-full.json', JSON.stringify({ fragHist, modelHist, nodes, nodesWithMsg, branchPoints, totalChars }, null, 2));
