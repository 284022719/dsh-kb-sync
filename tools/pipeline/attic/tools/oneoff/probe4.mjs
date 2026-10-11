// Probe 4: nail down fetch_page cursor semantics (pinned + updated_at unit).
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
async function page(query) {
  const url = new URL('https://chat.deepseek.com/api/v0/chat_session/fetch_page');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: HEADERS });
  const json = await res.json();
  const biz = json?.data?.biz_data;
  if (!biz) return { err: json?.code, raw: JSON.stringify(json).slice(0, 200) };
  return { n: biz.chat_sessions.length, hasMore: biz.has_more, sessions: biz.chat_sessions };
}

const p1 = await page({ count: 100 });
const last = p1.sessions.at(-1);
console.log(`page1 n=${p1.n} hasMore=${p1.hasMore}`);
console.log(`last session: seq=${last.seq_id} updated_at=${last.updated_at} title=${last.title}`);
console.log(`pinned in page1: ${p1.sessions.filter((s) => s.pinned).length}`);

for (const [label, updatedAt] of [
  ['seconds (as returned)', last.updated_at],
  ['milliseconds (x1000)', Math.round(last.updated_at * 1000)],
]) {
  for (const pinned of ['false', 'true']) {
    const r = await page({ count: 100, 'lte_cursor.pinned': pinned, 'lte_cursor.updated_at': updatedAt });
    if (r.err !== undefined) {
      console.log(`  ${label} pinned=${pinned} -> ERR ${r.err} ${r.raw}`);
      continue;
    }
    const newest = r.sessions[0];
    const oldest = r.sessions.at(-1);
    const overlap = r.sessions.filter((s) => p1.sessions.some((x) => x.id === s.id)).length;
    console.log(
      `  ${label.padEnd(22)} pinned=${pinned} -> n=${r.n} hasMore=${r.hasMore} newest=${newest.updated_at} (${newest.title}) oldest=${oldest.updated_at} overlap_with_page1=${overlap}`,
    );
  }
}
