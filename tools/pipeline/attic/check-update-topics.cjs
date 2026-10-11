const fs = require('fs');
const path = require('path');
const dir = 'D:\\dsh\\deepseek-import';

const tsv = fs.readFileSync(path.join(dir, 'update-new-items.tsv'), 'utf8').replace(/^\uFEFF/, '');
const tsvIdx = tsv.split(/\r?\n/).slice(1).filter(l => l.trim()).map(l => Number(l.split('\t')[0]));

const keys = fs.readFileSync(path.join(dir, 'update-topic-keys.tsv'), 'utf8').replace(/^\uFEFF/, '')
  .split(/\r?\n/).slice(1).filter(l => l.trim()).map(l => l.split('\t')[0]);

const data = JSON.parse(fs.readFileSync(path.join(dir, 'update-topics.json'), 'utf8'));
const asg = data.assignments;

const idxList = asg.map(a => a.idx);
const idxSet = new Set(idxList);
const tsvSet = new Set(tsvIdx);

function assert(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!cond) process.exitCode = 1;
}

assert('JSON 合法且含 assignments 数组', Array.isArray(asg), 'assignments=' + asg.length);
assert('无重复 idx', idxSet.size === idxList.length, 'unique=' + idxSet.size + '/' + idxList.length);
assert('idx 集合 == TSV idx 集合',
  idxSet.size === tsvSet.size && [...idxSet].every(i => tsvSet.has(i)),
  'json=' + idxSet.size + ' tsv=' + tsvSet.size +
  ' 缺=' + [...tsvSet].filter(i => !idxSet.has(i)).join(',') +
  ' 多=' + [...idxSet].filter(i => !tsvSet.has(i)).join(','));
const badKeys = [...new Set(asg.map(a => a.topic).filter(t => !keys.includes(t)))];
assert('所有 topic 都是合法 key', badKeys.length === 0, 'illegal=' + JSON.stringify(badKeys));
const longWhy = asg.filter(a => [...String(a.why)].length > 20);
assert('why 均 <= 20 字', longWhy.length === 0, longWhy.map(a => a.idx + ':' + a.why).join(','));
assert('idx 均为数字', asg.every(a => Number.isInteger(a.idx)));
assert('generatedAt 存在', typeof data.generatedAt === 'string' && data.generatedAt.length > 0, data.generatedAt);
assert('notes 存在', typeof data.notes === 'string' && data.notes.length > 0);

const dist = {};
for (const a of asg) dist[a.topic] = (dist[a.topic] || 0) + 1;
console.log('\n=== 话题分布（按 key 顺序，含 0 条项） ===');
for (const k of keys) console.log(String(dist[k] || 0).padStart(3) + '  ' + k);
console.log('合计 ' + asg.length + ' 条 / TSV ' + tsvIdx.length + ' 条');
