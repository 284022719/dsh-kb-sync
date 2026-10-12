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
// argv[2] 是"翻几页"——**这条接口翻不了页**（2026-10-12 实测：count 上限 100，超过报 ILLEGAL_COUNT；
// page / offset / page_num / seq_id / cursor 全被忽略；POST 405）。参数保留只为兼容调用方
// （插件按 `['1']` 调），实际永远只拿得到最近 100 条；更早的缺口只能靠全量回填。
const REQUESTED_PAGES = Number(process.argv[2] ?? 1);

const recs = readFileSync(join(KB_DIR, 'conversations.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const local = new Map(recs.map((r) => [r.id, r]));
console.log(`本地已有会话: ${recs.length}`);

// unix 秒 → ISO，带本机时区偏移：原先用 toISOString() 输出 UTC，日志里会显示成"早 8 小时"的
// 最新/最旧时间（2026-10-12 实测：日志说 09:59，实际 17:59，差点误判成漏拉）。
const iso = (epochSec) => {
  const d = new Date(epochSec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}` +
    `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
  );
};
const stamp = (isoStr) => (isoStr ? String(isoStr).replace('T', ' ').slice(0, 16) : '');

const res = await fetch('https://chat.deepseek.com/api/v0/chat_session/fetch_page?count=100', { headers: HEADERS });
const j = await res.json();
const biz = j?.data?.biz_data;
if (!biz) {
  // 交给 auth-marker 区分「真没授权」与「其它失败」，避免误报 Token 过期。
  reportFetchFailure(res, j, 'fetch_page');
  process.exit(1);
}
const list = biz.chat_sessions ?? [];
console.log(
  `最近 ${list.length} 条（接口上限 100、不可翻页${REQUESTED_PAGES > 1 ? `；你要的 ${REQUESTED_PAGES} 页按 1 页算` : ''}）` +
    `, has_more=${biz.has_more}, 最新=${stamp(iso(list[0]?.updated_at))}, 最旧=${stamp(iso(list.at(-1)?.updated_at))}`,
);

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
    console.log(`  ${stamp(iso(s.updated_at))}  ${s.title}   [${s.id}]`);
}
if (touched.length) {
  console.log('\n=== 已有但被更新过（可能续聊了）===');
  for (const s of touched.sort((a, b) => b.updated_at - a.updated_at)) {
    const l = local.get(s.id);
    console.log(`  ${stamp(l.updated_at).slice(0, 10)} → ${stamp(iso(s.updated_at)).slice(0, 10)}  ${s.title}   [${s.id}]`);
  }
}
const oldestNew = isNew.length ? Math.min(...isNew.map((s) => s.updated_at)) : null;
console.log(`\n本地最新记录的日期: ${recs.map((r) => stamp(r.updated_at).slice(0, 10)).sort().at(-1)}`);
if (oldestNew) console.log(`新增里最旧的一条: ${stamp(iso(oldestNew))}`);
console.log('说明：这条接口最多只回最近 100 条且**不支持翻页**（count>100 报 ILLEGAL_COUNT；page/cursor 被忽略）——');
console.log('      中间若有更早的缺口，只能用全量回填（官方导出包）补，别指望多翻几页。');
