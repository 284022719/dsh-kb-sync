// Probe 2: pagination of the session list, and the fragment shape of messages.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = readFileSync(join(here, '.token'), 'utf8').trim();
const HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  accept: '*/*',
  'content-type': 'application/json',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'x-client-platform': 'web',
  'x-client-version': '1.0.0',
  'x-app-version': '20241129.1',
  origin: 'https://chat.deepseek.com',
  referer: 'https://chat.deepseek.com/',
};
async function get(path, params) {
  const url = new URL('https://chat.deepseek.com' + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { url, status: res.status, text, json };
}

// ---- 1. pagination ----
const first = await get('/api/v0/chat_session/fetch_page', { count: 100 });
const list = first.json.data.biz_data.chat_sessions;
const minSeq = Math.min(...list.map((s) => s.seq_id));
console.log(`page1: ${list.length} sessions, has_more=${first.json.data.biz_data.has_more}, minSeq=${minSeq}`);
console.log(`seq range: ${Math.max(...list.map((s) => s.seq_id))} .. ${minSeq}`);

const variants = [
  { lte_cursor: minSeq },
  { cursor: minSeq },
  { lte_seq_id: minSeq },
  { last_seq_id: minSeq },
  { offset: 100 },
  { page: 2 },
];
for (const v of variants) {
  const r = await get('/api/v0/chat_session/fetch_page', { count: 100, ...v });
  const biz = r.json?.data?.biz_data;
  if (!biz) {
    console.log(`  ${JSON.stringify(v)} -> status=${r.status} code=${r.json?.code} ${r.text.slice(0, 120)}`);
    continue;
  }
  const seqs = biz.chat_sessions.map((s) => s.seq_id);
  const same = biz.chat_sessions.length === list.length && seqs[0] === list[0].seq_id;
  console.log(
    `  ${JSON.stringify(v)} -> n=${biz.chat_sessions.length} has_more=${biz.has_more} firstSeq=${seqs[0]} minSeq=${Math.min(...seqs)} ${same ? '(SAME AS PAGE 1 — ignored)' : '(DIFFERENT ✔)'}`,
  );
}

// ---- 2. fragment shapes ----
const sid = list[0].id;
const m = await get('/api/v0/chat/history_messages', { chat_session_id: sid });
const msgs = m.json.data.biz_data.chat_messages;
console.log(`\nmessages in "${list[0].title}": ${msgs.length}`);
for (const msg of msgs.slice(0, 6)) {
  const ftypes = (msg.fragments ?? []).map((f) => `${f.type}(${String(f.content ?? '').length})`);
  console.log(`  #${msg.message_id} ${msg.role} fragments=[${ftypes.join(', ')}] status=${msg.status}`);
}
const fragTypes = {};
for (const msg of msgs)
  for (const f of msg.fragments ?? []) {
    const k = `${msg.role}/${f.type}`;
    fragTypes[k] = (fragTypes[k] ?? 0) + 1;
  }
console.log('fragment type histogram:', JSON.stringify(fragTypes, null, 1));
const sampleFrag = msgs.flatMap((x) => x.fragments ?? []).find((f) => f.type && f.type !== 'THINK');
console.log('non-THINK fragment keys:', sampleFrag ? Object.keys(sampleFrag).join(',') : 'none');
const userFrag = msgs.find((x) => x.role === 'USER')?.fragments?.[0];
console.log('USER fragment sample:', JSON.stringify(userFrag).slice(0, 400));
writeFileSync(join(here, 'probe2-report.json'), JSON.stringify({ pagination: { minSeq, hasMore: first.json.data.biz_data.has_more }, fragTypes }, null, 2));
