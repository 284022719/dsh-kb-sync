// Download the official DeepSeek data export zip (streams to disk).
import { createWriteStream, readFileSync, mkdirSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { TOKEN as TOKEN_FILE, RAW } from './_paths.mjs';

const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
const HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  accept: '*/*',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'x-client-platform': 'web',
  'x-client-version': '1.0.0',
  origin: 'https://chat.deepseek.com',
  referer: 'https://chat.deepseek.com/',
};

const st = await (
  await fetch('https://chat.deepseek.com/api/v0/download_export_history', { headers: HEADERS })
).json();
const d = st.data.biz_data;
console.log('status:', d.status, '| exported_at:', new Date(d.exported_at * 1000).toISOString());
if (d.status !== 'FINISHED') {
  console.log('not finished yet:', JSON.stringify(d).slice(0, 400));
  process.exit(1);
}
mkdirSync(RAW, { recursive: true });
const nameFromUrl = decodeURIComponent(
  (d.history_download_url.match(/filename%3D([^&]+)/) ?? [, 'deepseek_export'])[1],
);
const out = join(RAW, nameFromUrl.endsWith('.zip') ? nameFromUrl : nameFromUrl + '.zip');
console.log('downloading ->', out);
const res = await fetch(d.history_download_url);
console.log('http', res.status, res.headers.get('content-length'), 'bytes');
if (!res.ok) {
  console.log((await res.text()).slice(0, 500));
  process.exit(1);
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
console.log('saved', out, statSync(out).size, 'bytes');
