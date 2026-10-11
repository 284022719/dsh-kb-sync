// 为增量新增的会话准备话题归类输入。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMPORT_DIR, KB_DIR, UPDATE_NEW_ITEMS } from './_paths.mjs';
const upd = JSON.parse(readFileSync(UPDATE_NEW_ITEMS, 'utf8'));
const topics = JSON.parse(readFileSync(join(KB_DIR, 'topics.json'), 'utf8'));

const keys = topics.topics.map((t) => `${t.key}\t${t.desc || ''}`).join('\n');
writeFileSync(join(IMPORT_DIR, 'update-topic-keys.tsv'), 'key\tdesc\n' + keys, 'utf8');

const rows = [
  'idx\tdate\tmsgs\ttitle\tfirst_request',
  ...upd.items.map((x) => [x.idx, x.date, x.msgs, String(x.title).replace(/[\t\r\n]/g, ' '), String(x.first_request ?? '').replace(/[\t\r\n]/g, ' ')].join('\t')),
];
writeFileSync(join(IMPORT_DIR, 'update-new-items.tsv'), rows.join('\n'), 'utf8');

console.log(`新增会话 ${upd.items.length} 个 → update-new-items.tsv`);
console.log(`现有话题 ${topics.topics.length} 个 → update-topic-keys.tsv`);
console.log('\n新增会话一览：');
for (const x of upd.items) console.log(`  ${x.idx}  ${x.date}  ${String(x.msgs).padStart(3)}条  ${x.title}`);
