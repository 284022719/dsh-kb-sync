// Probe 3: download the chat.deepseek.com SPA bundle and find how the web app
// itself calls the session-list endpoint (real query params / pagination).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const html = await (await fetch('https://chat.deepseek.com/', { headers: { 'user-agent': UA } })).text();
console.log('html bytes:', html.length);
const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const links = [...html.matchAll(/<link[^>]+href="([^"]+\.js)"/g)].map((m) => m[1]);
const all = [...new Set([...srcs, ...links])];
console.log('scripts found:', all.length);
for (const s of all) console.log('  ', s);

mkdirSync(join(here, 'bundle'), { recursive: true });
for (const src of all) {
  const url = src.startsWith('http') ? src : 'https://chat.deepseek.com' + (src.startsWith('/') ? '' : '/') + src;
  const name = src.split('/').pop().split('?')[0];
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    const text = await res.text();
    writeFileSync(join(here, 'bundle', name), text);
    console.log(`saved ${name} (${text.length} bytes)`);
  } catch (e) {
    console.log(`failed ${url}: ${e.message}`);
  }
}
