// 增量更新：用登录态从网页端接口把「新会话」与「被续聊的旧会话」拉下来，
// 规范化成与导出解析完全一致的格式，追加/替换进本地知识库。
//
//   node update-from-api.mjs            # 正式更新
//   node update-from-api.mjs --dry-run  # 只看会改什么，不写盘
//
// 与 parse-export.mjs 的区别：这里的数据来自 history_messages 接口，
// 线程末端由 chat_session.current_message_id 权威确定（不用猜叶子）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AUTH_MARKER, classifyAuth } from './auth-marker.mjs';
import { TOKEN as TOKEN_FILE, KNOWLEDGE, KB_DIR, UPDATE_NEW_ITEMS } from './_paths.mjs';

const DRY = process.argv.includes('--dry-run');
const SRC = resolve(KNOWLEDGE);                 // catalog + jsonl 的权威副本
const KB = resolve(KB_DIR);                     // 会话 Markdown 所在
const CONV_DIR = join(KB, 'conversations');

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

const USER_FRAGS = new Set(['REQUEST', 'FILE']);
const ASSIST_FRAGS = new Set(['THINK', 'RESPONSE', 'SEARCH', 'TOOL_SEARCH', 'TOOL_OPEN', 'TOOL_FIND']);
const iso = (sec) => (sec ? new Date(sec * 1000).toISOString().replace('Z', '+00:00') : null);
const stamp = (isoStr) => (isoStr ? String(isoStr).replace('T', ' ').slice(0, 16) : '');
const ymd = (isoStr) => (isoStr ? String(isoStr).slice(0, 10).replace(/-/g, '') : '00000000');
const kbSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const RESERVED = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;
const ILLEGAL = /[\\/:*?"<>|]/g;
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;
function slugify(title, fallback) {
  let s = (title || '').normalize('NFKC').replace(CONTROL, '').replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[. ]+|[. ]+$/g, '');
  if (!s || RESERVED.test(s)) s = fallback;
  s = [...s].slice(0, 60).join('').trim().replace(CONTROL, '').replace(/[. ]+$/, '');
  return s || fallback;
}

// ---------- 拉取 ----------
async function fetchPage() {
  const res = await fetch('https://chat.deepseek.com/api/v0/chat_session/fetch_page?count=100', { headers: HEADERS });
  const j = await res.json();
  const biz = j?.data?.biz_data;
  if (!biz) {
    // 鉴权问题单独打标记，让 sync-daily.cmd 能给出「Token 过期」而不是笼统的失败。
    const auth = classifyAuth(res, j) ? AUTH_MARKER + ' ' : '';
    throw new Error(`${auth}fetch_page 失败: ` + JSON.stringify(j).slice(0, 200));
  }
  return biz;
}
async function fetchMessages(id) {
  const res = await fetch(`https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${id}`, { headers: HEADERS });
  const j = await res.json();
  const biz = j?.data?.biz_data;
  if (!biz) {
    // 不改控制流（调用方原本把 null 当作「该会话没有消息」），只把鉴权事实记进日志。
    if (classifyAuth(res, j)) console.log(`${AUTH_MARKER} history_messages 鉴权失败 id=${id}`);
    return null;
  }
  return biz;
}

// ---------- 规范化（与 parse-export 完全一致的消息形状） ----------
function roleOf(msg) {
  const types = (msg.fragments ?? []).map((f) => f.type);
  if (types.some((t) => USER_FRAGS.has(t))) return 'user';
  if (types.some((t) => ASSIST_FRAGS.has(t))) return 'assistant';
  return 'unknown';
}
function normalizeApiMessage(m) {
  const frags = m.fragments ?? [];
  const pick = (t) => frags.filter((f) => f.type === t);
  const textOf = (t) => pick(t).map((f) => f.content ?? '').filter(Boolean).join('\n\n');
  return {
    id: String(m.message_id),
    at: iso(m.inserted_at),
    model: m.model || null,
    role: (m.role || '').toLowerCase() === 'user' ? 'user' : roleOf(m),
    text: textOf('REQUEST') || textOf('RESPONSE'),
    thinking: textOf('THINK'),
    searches: [...pick('SEARCH'), ...pick('TOOL_SEARCH')].flatMap((f) => (f.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '' }))),
    files: pick('FILE').flatMap((f) => (f.files ?? []).map((x) => ({ name: x.file_name ?? '', size: x.file_size ?? 0 }))),
    toolOps: frags.filter((f) => f.type.startsWith('TOOL_')).length,
  };
}

/** 从 current_message_id 向上走到根，得到权威的「当前线程」。 */
function currentThread(biz) {
  const nodes = new Map(biz.chat_messages.map((m) => [String(m.message_id), m]));
  const chain = [];
  let cur = nodes.get(String(biz.chat_session.current_message_id));
  const guard = new Set();
  while (cur && !guard.has(String(cur.message_id))) {
    guard.add(String(cur.message_id));
    chain.push(cur);
    if (cur.parent_id === null || cur.parent_id === undefined) break;
    cur = nodes.get(String(cur.parent_id));
  }
  return chain.reverse().map(normalizeApiMessage).filter((m) => m.role !== 'unknown' && (m.text || m.thinking || m.files.length || m.searches.length));
}

function render(conv, messages) {
  const models = [...new Set(messages.map((m) => m.model).filter(Boolean))];
  const chars = messages.reduce((a, m) => a + m.text.length + m.thinking.length, 0);
  const L = [];
  L.push(`# ${conv.title || '(无标题)'}`);
  L.push('');
  L.push(`- **会话 ID**：\`${conv.id}\``);
  L.push(`- **时间**：${stamp(conv.inserted_at)} → ${stamp(conv.updated_at)}`);
  L.push(`- **模型**：${models.join(', ') || '—'}`);
  L.push(`- **消息**：${messages.length} 条，约 ${chars.toLocaleString('en-US')} 字符`);
  L.push(`- **来源**：DeepSeek 网页端接口同步（增量更新）`);
  L.push('');
  L.push('---');
  L.push('');
  for (const m of messages) {
    const when = stamp(m.at);
    if (m.role === 'user') {
      L.push(`## 👤 用户 · ${when}`);
      L.push('');
      for (const f of m.files) L.push(`> 📎 附件：\`${f.name}\`（${kbSize(f.size)}）`);
      if (m.files.length) L.push('');
      if (m.text) L.push(m.text);
      L.push('');
    } else {
      if (m.thinking) {
        L.push(`### 💭 思考过程 · ${when}`);
        L.push('');
        L.push(m.thinking);
        L.push('');
      }
      if (m.searches.length) {
        L.push('<details><summary>🔍 联网检索（' + m.searches.length + ' 条）</summary>');
        L.push('');
        for (const s of m.searches) L.push(`- [${s.title || s.url}](${s.url})`);
        L.push('');
        L.push('</details>');
        L.push('');
      }
      if (m.text) {
        L.push(`### 🤖 DeepSeek · ${when}`);
        L.push('');
        L.push(m.text);
        L.push('');
      }
    }
  }
  return L.join('\n');
}

// ---------- 主流程 ----------
const recs = readFileSync(join(SRC, 'conversations.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const catalog = JSON.parse(readFileSync(join(SRC, 'catalog.json'), 'utf8'));
const localById = new Map(recs.map((r, i) => [r.id, { rec: r, idx: i }]));
const localMaxUp = Math.max(...catalog.map((c) => Date.parse(c.updated_at ?? 0)));
console.log(`本地: ${recs.length} 条，updated_at 最新 ${new Date(localMaxUp).toISOString().slice(0, 16)}`);

// 翻页直到越过本地最新时间（保证不漏）
const seen = new Map();
for (let p = 1; p <= 10; p++) {
  const biz = await fetchPage();
  for (const s of biz.chat_sessions) if (!seen.has(s.id)) seen.set(s.id, s);
  const oldest = Math.min(...biz.chat_sessions.map((s) => s.updated_at));
  console.log(`  第 ${p} 页 ${biz.chat_sessions.length} 条，最旧 ${iso(oldest).slice(0, 16)}${biz.has_more ? '' : '（没有更多）'}`);
  if (!biz.has_more || oldest * 1000 <= localMaxUp) break;
}

const sessions = [...seen.values()];
const isNew = sessions.filter((s) => !localById.has(s.id));
const updated = sessions.filter((s) => {
  const l = localById.get(s.id);
  return l && s.updated_at * 1000 > Date.parse(l.rec.updated_at ?? 0) + 1000;
});
console.log(`\n扫描 ${sessions.length} 个会话：新增 ${isNew.length}，续聊更新 ${updated.length}`);

const nothingToDo = !isNew.length && !updated.length;
if (nothingToDo) {
  console.log('没有需要更新的内容 ✔');
  // 必须也写一份空的清单：下游（归类、健康提取）靠它判断"本轮没有新内容"。
  // 否则它会读到上一轮的 stale 文件，把已经处理过的会话重做一遍。
  if (!DRY) {
    writeFileSync(
      UPDATE_NEW_ITEMS,
      JSON.stringify({ generatedAt: new Date().toISOString(), added: [], changed: [], items: [] }, null, 1),
      'utf8',
    );
    console.log('已写入空清单 update-new-items.json（本轮无变化）');
  }
  // 这里**不用** process.exit(0)：强制退出会在 undici / 定时器句柄仍在关闭时触发 libuv 断言
  // （"Assertion failed: ... src\win\async.c"），进程可能以 0xC0000409 硬崩、退出码变成非 0，
  // 让上层把"其实成功了"报成失败并弹出错误告警。改成跳过后续工作、让进程自然退出。
}

if (!nothingToDo) {

// 备份 + 轮转
//
// 每个文件每轮存一份：conversations.jsonl 约 58 MB，而这里原先是**不封顶**的，
// 到 2026-10-10 已经攒了 3 代 / 176 MB。只保留最新 KEEP_BACKUP_GENERATIONS 代；
// 裁剪包在 try/catch 里 —— 删旧备份失败绝不能连累这一轮同步。
const KEEP_BACKUP_GENERATIONS = 2;
function pruneBackups(fileName) {
  try {
    const prefix = `${fileName}.backup-`;
    const stale = readdirSync(SRC)
      .filter((n) => n.startsWith(prefix))
      .sort()                                // 文件名里是 ISO 时间戳，字典序 = 时间序
      .slice(0, -KEEP_BACKUP_GENERATIONS);   // 留下最新的 N 个，其余是要删的
    for (const n of stale) {
      rmSync(join(SRC, n), { force: true });
      console.log(`  轮转：删除旧备份 ${n}`);
    }
  } catch (e) {
    console.warn(`  ! 轮转 ${fileName} 的旧备份失败（不影响本轮）: ${e.message}`);
  }
}

if (!DRY) {
  const stampStr = new Date().toISOString().replace(/[:.]/g, '-');
  for (const f of ['catalog.json', 'catalog.tsv', 'conversations.jsonl']) {
    if (existsSync(join(SRC, f))) copyFileSync(join(SRC, f), join(SRC, `${f}.backup-${stampStr}`));
    pruneBackups(f);
  }
  console.log(`已备份 catalog/journal 到 *.backup-${stampStr}（每个文件只留最新 ${KEEP_BACKUP_GENERATIONS} 代）`);
}

let nextIdx = Math.max(...catalog.map((c) => c.idx)) + 1;
const usedNames = new Set(catalog.map((c) => String(c.path).split('/').pop().toLowerCase()));
const added = [];
const changed = [];
const newItems = [];

async function handle(s, kind) {
  const biz = await fetchMessages(s.id);
  if (!biz) {
    console.log(`  ! ${s.title}: 拉取消息失败，跳过`);
    return;
  }
  const messages = currentThread(biz);
  const conv = {
    id: s.id,
    title: s.title || '',
    inserted_at: iso(biz.chat_session.inserted_at ?? s.updated_at),
    updated_at: iso(biz.chat_session.updated_at ?? s.updated_at),
  };
  const md = render(conv, messages);
  const chars = messages.reduce((a, m) => a + m.text.length + m.thinking.length, 0);
  const models = [...new Set(messages.map((m) => m.model).filter(Boolean))];
  const turns = messages.filter((m) => m.role === 'user').length;

  let relPath;
  if (kind === 'updated') {
    relPath = localById.get(s.id).rec.file; // 文件名保持不变
  } else {
    let base = `${ymd(conv.inserted_at)}-${slugify(conv.title, 'untitled')}-${s.id.slice(0, 8)}`;
    let name = base + '.md';
    let i = 1;
    while (usedNames.has(name.toLowerCase())) name = `${base}-${++i}.md`;
    usedNames.add(name.toLowerCase());
    relPath = `conversations/${name}`;
  }

  if (!DRY) {
    mkdirSync(CONV_DIR, { recursive: true });
    writeFileSync(join(CONV_DIR, relPath.split('/').pop()), md, 'utf8');
  }

  const catalogRow = {
    idx: kind === 'updated' ? localById.get(s.id).idx : nextIdx++,
    id: conv.id,
    title: conv.title,
    date: ymd(conv.inserted_at),
    inserted_at: conv.inserted_at,
    updated_at: conv.updated_at,
    turns,
    messages: messages.length,
    chars,
    models,
    path: relPath,
  };
  const jsonlRow = { id: conv.id, title: conv.title, inserted_at: conv.inserted_at, updated_at: conv.updated_at, file: relPath, messages };

  if (kind === 'updated') {
    const idx = localById.get(s.id).idx;
    catalog[idx] = catalogRow;
    recs[idx] = jsonlRow;
    changed.push({ id: s.id, title: conv.title, from: localById.get(s.id).rec.messages.length, to: messages.length, idx });
    console.log(`  ~ 续聊 ${String(localById.get(s.id).rec.messages.length).padStart(3)} → ${String(messages.length).padStart(3)} 条  ${conv.title}`);
  } else {
    catalog.push(catalogRow);
    recs.push(jsonlRow);
    added.push({ id: s.id, title: conv.title, idx: catalogRow.idx, date: catalogRow.date, messages: messages.length, chars });
    newItems.push({
      idx: catalogRow.idx,
      date: catalogRow.date,
      msgs: messages.length,
      chars,
      title: conv.title,
      first_request: (messages.find((m) => m.role === 'user')?.text ?? '').replace(/\s+/g, ' ').slice(0, 90),
    });
    console.log(`  + 新增 ${String(messages.length).padStart(3)} 条  ${catalogRow.date}  ${conv.title}`);
  }
}

console.log('\n=== 处理续聊的会话 ===');
for (const s of updated.sort((a, b) => a.updated_at - b.updated_at)) await handle(s, 'updated');
console.log('\n=== 处理新会话 ===');
for (const s of isNew.sort((a, b) => a.updated_at - b.updated_at)) await handle(s, 'new');

if (DRY) {
  console.log(`\n[dry-run] 将新增 ${added.length}，更新 ${changed.length}，未写盘`);
}

if (!DRY) {

recs.sort((a, b) => 0); // 保持追加顺序（idx 与之对齐）
catalog.sort((a, b) => a.idx - b.idx);
writeFileSync(join(SRC, 'conversations.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n'), 'utf8');
writeFileSync(join(SRC, 'catalog.json'), JSON.stringify(catalog, null, 1), 'utf8');
writeFileSync(
  join(SRC, 'catalog.tsv'),
  [
    'idx\tdate\tupdated\tturns\tmessages\tchars\tmodels\ttitle\tpath',
    ...catalog.map((c) => [c.idx, c.date, String(c.updated_at).slice(0, 10), c.turns, c.messages, c.chars, c.models.join('+'), String(c.title).replace(/[\t\r\n]/g, ' '), c.path].join('\t')),
  ].join('\n'),
  'utf8',
);
// 镜像到知识库（build-kb 也会做，但这里先同步便于立即检索）
for (const f of ['catalog.json', 'catalog.tsv', 'conversations.jsonl']) copyFileSync(join(SRC, f), join(KB, f));

writeFileSync(UPDATE_NEW_ITEMS, JSON.stringify({ generatedAt: new Date().toISOString(), added, changed, items: newItems }, null, 1));

console.log(`\n=== 完成 ===`);
console.log(`新增 ${added.length} 个会话，更新 ${changed.length} 个；总计 ${catalog.length} 条`);
console.log(`新会话清单: update-new-items.json（供话题归类）`);
}
}
