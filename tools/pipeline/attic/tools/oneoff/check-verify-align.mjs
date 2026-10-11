// Verify that verify/in-*.tsv row `idx` lines up with catalog.json idx + titles,
// for every worklist (the subagents reported a possible off-by-one).
import { readFileSync, readdirSync } from 'node:fs';
const cat = JSON.parse(readFileSync('knowledge/catalog.json', 'utf8'));
let grand = { rows: 0, mismatch: 0 };
for (const f of readdirSync('verify').filter((x) => /^in-\d+\.tsv$/.test(x)).sort()) {
  const lines = readFileSync('verify/' + f, 'utf8').split('\n').filter(Boolean);
  let mismatch = 0;
  const examples = [];
  for (const l of lines.slice(1)) {
    const parts = l.split('\t');
    const i = Number(parts[0]);
    const title = (parts[3] ?? '').trim();
    const c = cat[i];
    if (!c || c.title.trim() !== title) {
      mismatch++;
      if (examples.length < 3) examples.push(`idx ${i}: tsv="${title}" catalog="${c ? c.title : 'MISSING'}"`);
    }
  }
  grand.rows += lines.length - 1;
  grand.mismatch += mismatch;
  console.log(`${f}: rows=${lines.length - 1} title-mismatches=${mismatch}${examples.length ? '  e.g. ' + examples.join(' | ') : ''}`);
}
console.log(`\nTOTAL rows=${grand.rows} mismatches=${grand.mismatch}`);
const t = readFileSync('verify/in-08.tsv', 'utf8').split('\n').find((l) => l.startsWith('1715\t'));
console.log('\nspot check idx 1715:');
console.log('  tsv     =', t?.split('\t')[3]);
console.log('  cat[1715]=', cat[1715].title);
console.log('  cat[1714]=', cat[1714].title);
