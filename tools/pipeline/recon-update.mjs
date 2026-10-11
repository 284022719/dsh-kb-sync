// 增量侦察：拉取最新的会话列表，与本地已有记录对比，看新增/更新了多少。
//
//   node recon-update.mjs [pages=1]
//
// 只读，不改任何文件。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportFetchFailure } from './auth-marker.mjs';
import { TOKEN as TOKEN_FILE, KB_DIR } from './_paths.mjs';

const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
const HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  accept: '*/*',
  'content-type': 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'x-client-platform': 'web',
  'x-client-version': '1.0.0',
  origin: 'https://chat.deepseek.com',
  referer: 'https://chat.deepseek.com/',
};
const PAGES = Number(process.argv[2] ?? 1);

const recs = readFileSync(join(KB_DIR, 'conversations.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const local = new Map(recs.map((r) => [r.id, r]));
console.log(`本地已有会话: ${recs.length}`);

const iso = (epochSec) => new Date(epochSec * 1000).toISOString().replace('Z', '+00:00');
const list = [];
for (let p = 1; p <= PAGES; p++) {
  const url = `https://chat.deepseek.com/api/v0/chat_session/fetch_page?count=100`;
  const res = await fetch(url, { headers: HEADERS });
  const j = await res.json();
  const biz = j?.data?.biz_data;
  if (!biz) {
    // 交给 auth-marker 区分「真没授权」与「其它失败」，避免误报 Token 过期。
    reportFetchFailure(res, j, 'fetch_page');
    process.exit(1);
  }
  list.push(...biz.chat_sessions);
  console.log(`第 ${p} 页: ${biz.chat_sessions.length} 条, has_more=${biz.has_more}, 最新=${iso(biz.chat_sessions[0].updated_at).slice(0, 16)}, 最旧=${iso(biz.chat_sessions.at(-1).updated_at).slice(0, 16)}`);
  if (!biz.has_more) break;
}

const isNew = list.filter((s) => !local.has(s.id));
const known = list.filter((s) => local.has(s.id));
const touched = known.filter((s) => {
  const l = local.get(s.id);
  const localUp = l.updated_at ? Date.parse(l.updated_at) / 1000 : 0;
  return s.updated_at > localUp + 1; // 容 1 秒误差
});

console.log(`\n最近 ${list.length} 个会话中：`);
console.log(`  新增（本地没有）    : ${isNew.length}`);
console.log(`  已有且之后有更新    : ${touched.length}`);
console.log(`  已有且无变化        : ${known.length - touched.length}`);

if (isNew.length) {
  console.log('\n=== 新增会话 ===');
  for (const s of isNew.sort((a, b) => b.updated_at - a.updated_at))
    console.log(`  ${iso(s.updated_at).slice(0, 16)}  ${s.title}   [${s.id}]`);
}
if (touched.length) {
  console.log('\n=== 已有但被更新过（可能续聊了）===');
  for (const s of touched.sort((a, b) => b.updated_at - a.updated_at)) {
    const l = local.get(s.id);
    console.log(`  ${String(l.updated_at).slice(0, 10)} → ${iso(s.updated_at).slice(0, 10)}  ${s.title}   [${s.id}]`);
  }
}
const oldestNew = isNew.length ? Math.min(...isNew.map((s) => s.updated_at)) : null;
console.log(`\n本地最新记录的日期: ${recs.map((r) => String(r.updated_at).slice(0, 10)).sort().at(-1)}`);
if (oldestNew) console.log(`新增里最旧的一条: ${iso(oldestNew).slice(0, 16)}（若早于本地最新日期，说明中间还有遗漏，需要多翻几页）`);
