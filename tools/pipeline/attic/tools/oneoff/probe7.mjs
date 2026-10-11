// Inspect how the SPA uses the official export endpoints.
import { readdirSync, readFileSync } from 'node:fs';
const f = readdirSync('bundle').find((x) => x.startsWith('main.'));
const s = readFileSync('bundle/' + f, 'utf8');
for (const pat of ['export_all', 'download_export_history', 'exportHistory', 'ExportHistory', 'export']) {
  console.log('===== ' + pat + ' =====');
  let i = -1,
    n = 0;
  while ((i = s.indexOf(pat, i + 1)) !== -1 && n < 8) {
    n++;
    console.log('...' + s.slice(Math.max(0, i - 400), i + 400).replace(/\s+/g, ' ') + '...');
    console.log('---');
  }
  if (n === 0) console.log('(none)');
}
