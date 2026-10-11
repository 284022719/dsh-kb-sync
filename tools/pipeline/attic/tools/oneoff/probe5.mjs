// Probe 5: does lte_cursor actually filter? test wildly different values + param styles.
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
async function raw(qs) {
  const url = 'https://chat.deepseek.com/api/v0/chat_session/fetch_page?' + qs;
  const res = await fetch(url, { headers: HEADERS });
  const json = await res.json();
  const d = json?.data;
  if (d?.biz_code !== 0) return { err: `${d?.biz_code}:${d?.biz_msg}` };
  const s = d.biz_data.chat_sessions;
  return { n: s.length, hasMore: d.biz_data.has_more, newest: s[0].updated_at, oldest: s.at(-1).updated_at, firstId: s[0].id };
}

const base = await raw('count=100');
console.log('baseline       ', JSON.stringify(base));

const cases = [
  ['dotted seconds -1', 'count=100&lte_cursor.pinned=false&lte_cursor.updated_at=1788835574.25'],
  ['dotted seconds int', 'count=100&lte_cursor.pinned=false&lte_cursor.updated_at=1788835575'],
  ['dotted very old', 'count=100&lte_cursor.pinned=false&lte_cursor.updated_at=1600000000'],
  ['dotted none', 'count=100&lte_cursor.pinned=false&lte_cursor.updated_at='],
  ['bracket style', 'count=100&lte_cursor%5Bpinned%5D=false&lte_cursor%5Bupdated_at%5D=1600000000'],
  ['no pinned', 'count=100&lte_cursor.updated_at=1600000000'],
  ['gte_cursor old', 'count=100&gte_cursor.pinned=false&gte_cursor.updated_at=1600000000'],
  ['count=20', 'count=20'],
  ['count=1000', 'count=1000'],
];
for (const [label, qs] of cases) {
  try {
    const r = await raw(qs);
    console.log(label.padEnd(20), JSON.stringify(r));
  } catch (e) {
    console.log(label.padEnd(20), 'ERR ' + e.message);
  }
}
