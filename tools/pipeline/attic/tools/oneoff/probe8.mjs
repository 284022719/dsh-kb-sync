// Probe 8: official export status + fetch_page max count.
import { readFileSync } from 'node:fs';
const TOKEN = readFileSync('.token', 'utf8').trim();
const HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  accept: '*/*',
  'content-type': 'application/json',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'x-client-platform': 'web',
  'x-client-version': '1.0.0',
  origin: 'https://chat.deepseek.com',
  referer: 'https://chat.deepseek.com/',
};
async function j(path) {
  const res = await fetch('https://chat.deepseek.com' + path, { headers: HEADERS });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
}

console.log('=== download_export_history ===');
const st = await j('/api/v0/download_export_history');
console.log(JSON.stringify(st.json ?? st.text, null, 1).slice(0, 900));

console.log('\n=== fetch_page count ceiling ===');
for (const n of [100, 200, 300, 500]) {
  const r = await j(`/api/v0/chat_session/fetch_page?count=${n}`);
  const d = r.json?.data;
  if (d?.biz_code !== 0) console.log(`  count=${n} -> ${d?.biz_code}:${d?.biz_msg}`);
  else {
    const s = d.biz_data.chat_sessions;
    console.log(
      `  count=${n} -> n=${s.length} hasMore=${d.biz_data.has_more} oldest=${s.at(-1).updated_at} (${new Date(s.at(-1).updated_at * 1000).toISOString().slice(0, 10)})`,
    );
  }
}
