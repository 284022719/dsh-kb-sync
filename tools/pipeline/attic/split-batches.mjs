// Split analysis-index.tsv into N batch files for parallel topic clustering.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const N = Number(process.argv[2] ?? 10);
const rows = readFileSync('analysis-index.tsv', 'utf8').split('\n').filter(Boolean);
const header = rows.shift();
mkdirSync('batches', { recursive: true });
const per = Math.ceil(rows.length / N);
for (let i = 0; i < N; i++) {
  const slice = rows.slice(i * per, (i + 1) * per);
  if (!slice.length) continue;
  const name = `batches/batch-${String(i + 1).padStart(2, '0')}.tsv`;
  writeFileSync(name, [header, ...slice].join('\n'));
  console.log(`${name}: rows ${i * per}..${i * per + slice.length - 1} (${slice.length})`);
}
