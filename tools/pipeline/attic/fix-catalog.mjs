// Repair the catalog: catalog.json was written sorted by date while
// conversations.jsonl (and therefore every `idx` produced by clustering) is in
// export order. Re-emit both in the canonical index order and carry an explicit
// `idx` column so nothing ever has to guess an offset again.
import { readFileSync, writeFileSync } from 'node:fs';

const recs = readFileSync('knowledge/conversations.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const old = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));

const byId = new Map(old.map((c) => [c.id, c]));
const catalog = recs.map((r, i) => {
  const c = byId.get(r.id);
  if (!c) throw new Error(`no catalog row for ${r.id} (idx ${i})`);
  if (c.title !== r.title) throw new Error(`title mismatch at idx ${i}: ${c.title} != ${r.title}`);
  return { idx: i, ...c };
});

console.log(`rows: ${catalog.length}`);
console.log('first 3 idx/title:', catalog.slice(0, 3).map((c) => `${c.idx}:${c.title}`).join(' | '));
console.log('last 3 idx/title:', catalog.slice(-3).map((c) => `${c.idx}:${c.title}`).join(' | '));

// sanity: is date order different from idx order?
let inversions = 0;
for (let i = 1; i < catalog.length; i++) if (String(catalog[i].inserted_at) < String(catalog[i - 1].inserted_at)) inversions++;
console.log(`date-order inversions vs idx order: ${inversions}`);

writeFileSync('knowledge/catalog.json', JSON.stringify(catalog, null, 1));
writeFileSync(
  'knowledge/catalog.tsv',
  [
    'idx\tdate\tupdated\tturns\tmessages\tchars\tmodels\ttitle\tpath',
    ...catalog.map((c) =>
      [c.idx, c.date, String(c.updated_at).slice(0, 10), c.turns, c.messages, c.chars, c.models.join('+'), String(c.title).replace(/[\t\r\n]/g, ' '), c.path].join('\t'),
    ),
  ].join('\n'),
);
console.log('rewrote knowledge/catalog.json + catalog.tsv in idx order');
