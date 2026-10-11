// Probe chat.deepseek.com internal API shapes before building the full scraper.
// Usage: node probe.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(here, '.token');

function token() {
  if (process.env.DS_TOKEN) return process.env.DS_TOKEN.trim();
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim();
  throw new Error('no token: put it in .token or set DS_TOKEN');
}
const TOKEN = token();

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
  } catch {
    json = undefined;
  }
  return { url: url.toString(), status: res.status, text, json };
}

function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value))
    return depth > 2 ? `array(${value.length})` : `array(${value.length}) of ${shape(value[0], depth + 1)}`;
  if (typeof value === 'object') {
    if (depth > 2) return 'object';
    const keys = Object.keys(value);
    return (
      '{ ' +
      keys
        .slice(0, 40)
        .map((k) => `${k}: ${shape(value[k], depth + 1)}`)
        .join(', ') +
      (keys.length > 40 ? `, ...+${keys.length - 40}` : '') +
      ' }'
    );
  }
  if (typeof value === 'string') return `string(${value.length})`;
  return typeof value;
}

function log(...a) {
  console.log(...a);
}

const out = { at: new Date().toISOString(), probes: [] };

// 1. identity (do not persist email/phone)
const me = await get('/api/v0/users/current');
log('=== users/current ===', me.status);
const meData = me.json?.data?.biz_data;
if (meData) {
  const { email, mobile_number, ...rest } = meData;
  log('identity keys:', Object.keys(meData).join(', '));
  log('masked:', JSON.stringify({ email: email ? '***' : undefined, mobile: mobile_number ? '***' : undefined, ...rest }).slice(0, 200));
  out.probes.push({ step: 'users/current', status: me.status, shape: shape(me.json) });
} else {
  log(me.text.slice(0, 400));
}

// 2. session list — try a few known shapes
const listCandidates = [
  ['/api/v0/chat_session/fetch_page', { count: 100 }],
  ['/api/v0/chat_session/fetch_page', { count: 20 }],
  ['/api/v0/chat_session/fetch_page', {}],
  ['/api/v0/chat_session/page', { count: 100 }],
];
let listing;
for (const [p, q] of listCandidates) {
  const r = await get(p, q);
  const biz = r.json?.data?.biz_data;
  log(`\n=== ${p} ${JSON.stringify(q)} === status=${r.status} code=${r.json?.code ?? '-'} ${biz ? '' : r.text.slice(0, 200)}`);
  if (biz) log('shape:', shape(biz));
  out.probes.push({ step: p + JSON.stringify(q), status: r.status, code: r.json?.code, shape: shape(r.json) });
  if (biz && (biz.chat_sessions || biz.sessions)) {
    listing = biz;
    break;
  }
}

let sessionId;
const sessions = listing?.chat_sessions ?? listing?.sessions ?? [];
if (sessions.length) {
  sessionId = sessions[0].id ?? sessions[0].chat_session_id;
  log(`\nlist ok: ${sessions.length} sessions; has_more=${listing.has_more} cursor keys=${Object.keys(listing).join(',')}`);
  log('first session keys:', Object.keys(sessions[0]).join(', '));
  log('sample:', JSON.stringify(sessions.slice(0, 3), null, 1).slice(0, 800));
  writeFileSync(join(here, 'probe-sessions.sample.json'), JSON.stringify(sessions.slice(0, 5), null, 2));
}

// 3. messages of the most recent session
if (sessionId) {
  for (const [p, q] of [
    ['/api/v0/chat/history_messages', { chat_session_id: sessionId }],
    ['/api/v0/chat/history_messages', { chat_session_id: sessionId, count: 100 }],
  ]) {
    const r = await get(p, q);
    const biz = r.json?.data?.biz_data;
    log(`\n=== ${p} === status=${r.status} code=${r.json?.code ?? '-'} ${biz ? '' : r.text.slice(0, 300)}`);
    if (!biz) continue;
    log('shape:', shape(biz));
    const msgs = biz.chat_messages ?? biz.messages ?? [];
    log(`messages: ${msgs.length}`);
    if (msgs.length) {
      log('message keys:', Object.keys(msgs[0]).join(', '));
      writeFileSync(join(here, 'probe-messages.sample.json'), JSON.stringify(msgs.slice(0, 4), null, 2));
      for (const m of msgs.slice(0, 4)) {
        log(`  role=${m.role} keys=${Object.keys(m).join(',')} contentLen=${String(m.content ?? '').length}`);
      }
      log('\n--- sample message (truncated) ---');
      log(JSON.stringify(msgs[1] ?? msgs[0], null, 1).slice(0, 1200));
    }
    out.probes.push({ step: p, status: r.status, shape: shape(r.json) });
    break;
  }
}

writeFileSync(join(here, 'probe-report.json'), JSON.stringify(out, null, 2));
log('\nwrote probe-report.json / probe-sessions.sample.json / probe-messages.sample.json');
