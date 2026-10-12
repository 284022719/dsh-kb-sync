/**
 * DeepSeek 网页端接口客户端 + 消息规范化。
 *
 * 事实来源：本机已跑了一年的 `deepseek-import/update-from-api.mjs`（同一套接口与字段）。
 * 这里只做两件事，都是纯函数式的：拉取（注入 fetch，便于测试）与规范化。
 *
 * 接口（非官方内部 API，改版即失效）：
 *   GET /api/v0/chat_session/fetch_page?count=100   → data.biz_data.chat_sessions[]
 *   GET /api/v0/chat/history_messages?chat_session_id=<id> → data.biz_data
 *
 * @module dsh-kb-sync/deepseek
 */

/** 网页端根地址。 */
export const BASE = 'https://chat.deepseek.com'

/** 会话列表接口一次最多返回的条数（服务端游标失效，翻页拿到的是同一批）。 */
export const PAGE_COUNT = 100

/** 用户侧 fragment 类型；其余（THINK/RESPONSE/SEARCH/…）属于助手侧。 */
const USER_FRAGS = new Set(['REQUEST', 'FILE'])
const ASSIST_FRAGS = new Set(['THINK', 'RESPONSE', 'SEARCH', 'TOOL_SEARCH', 'TOOL_OPEN', 'TOOL_FIND'])

/** 与参考实现一致的请求头（token 由调用方注入，不在这里读取）。 */
export function browserHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: '*/*',
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    'x-client-platform': 'web',
    'x-client-version': '1.0.0',
    origin: BASE,
    referer: `${BASE}/`,
  }
}

/**
 * unix 秒 → ISO，**带本机时区偏移**（`2026-10-12T21:51:33.123+08:00`）。
 *
 * 为什么不用 `toISOString()`：它输出 UTC（`...+00:00`），而 `stamp()` / `ymd()` 与 Markdown 头
 * 都直接切这个字符串 —— 增量拉进来的会话因此比本地时间早 8 小时，与导出包那条路（写 `+08:00`）
 * 变成两套口径（2026-10-12 实测全库：2442 条 `+08:00` vs 114 条 `+00:00`，按代码路径分裂）。
 * 两种写法指向**同一个时刻**（`Date.parse` 都认），统一到本地偏移后，文件名日期与页面时间才跟着对。
 */
export const iso = (sec) => {
  if (!sec) return null
  const d = new Date(sec * 1000)
  const p = (n) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off < 0 ? '-' : '+'
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}` +
    `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
  )
}

/**
 * ISO → `YYYY-MM-DD HH:mm`，**按本机时区显示**。
 *
 * 不再直接切字符串：库里既有 `+08:00`（导出包、修复后的增量）也有历史遗留的 `+00:00`（修复前的增量），
 * 直接切会把后者显示成早 8 小时的"时间"（2026-10-12 实测：页面显示 13:51、真实 21:51）。
 * 解析成时刻再按本机渲染，两种写法都显示成本地时间。
 */
export const stamp = (isoStr) => {
  if (!isoStr) return ''
  const t = Date.parse(isoStr)
  if (!Number.isFinite(t)) return String(isoStr).replace('T', ' ').slice(0, 16)
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** ISO → `YYYYMMDD`（文件名用）。 */
export const ymd = (isoStr) => (isoStr ? String(isoStr).slice(0, 10).replace(/-/g, '') : '00000000')

const RESERVED = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i
const ILLEGAL = /[\\/:*?"<>|]/g
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g

/**
 * 标题 → 安全文件名片段（保留中文，去掉路径非法字符与控制字符）。
 * @param {string} title - 会话标题。
 * @param {string} fallback - 标题为空时用的兜底串。
 * @returns {string} 最长 60 个字符的文件名片段。
 */
export function slugify(title, fallback) {
  let s = (title || '').normalize('NFKC').replace(CONTROL, '').replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/^[. ]+|[. ]+$/g, '')
  if (!s || RESERVED.test(s)) s = fallback
  s = [...s].slice(0, 60).join('').trim().replace(CONTROL, '').replace(/[. ]+$/, '')
  return s || fallback
}

/** 助手侧消息里可出现的 fragment 类型 → 是否属于助手。 */
function roleOf(msg) {
  const types = (msg.fragments ?? []).map((f) => f.type)
  if (types.some((t) => USER_FRAGS.has(t))) return 'user'
  if (types.some((t) => ASSIST_FRAGS.has(t))) return 'assistant'
  return 'unknown'
}

/**
 * 一条原始 message → 精简结构。
 * @param {object} m - `chat_messages[]` 里的一条。
 * @returns {object} `{id, at, model, role, text, thinking, searches, files, toolOps}`。
 */
export function normalizeApiMessage(m) {
  const frags = m.fragments ?? []
  const pick = (t) => frags.filter((f) => f.type === t)
  const textOf = (t) => pick(t).map((f) => f.content ?? '').filter(Boolean).join('\n\n')
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
  }
}

/**
 * 从 `chat_session.current_message_id` 沿 parent 走到根，得到权威的当前线程。
 *
 * 这是本插件**不用猜叶子**的原因：导出包里得靠规则找叶子，而这里服务端直接给了游标。
 * @param {object} biz - `history_messages` 的 `biz_data`。
 * @returns {object[]} 规范化后的消息（已过滤空消息与 unknown 角色）。
 */
export function currentThread(biz) {
  const nodes = new Map((biz.chat_messages ?? []).map((m) => [String(m.message_id), m]))
  const chain = []
  let cur = nodes.get(String(biz.chat_session?.current_message_id))
  const guard = new Set()
  while (cur && !guard.has(String(cur.message_id))) {
    guard.add(String(cur.message_id))
    chain.push(cur)
    if (cur.parent_id === null || cur.parent_id === undefined) break
    cur = nodes.get(String(cur.parent_id))
  }
  return chain
    .reverse()
    .map(normalizeApiMessage)
    .filter((m) => m.role !== 'unknown' && (m.text || m.thinking || m.files.length || m.searches.length))
}

/** 附件大小的易读写法。 */
const sizeText = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

/**
 * 渲染一个会话为 Markdown（格式与参考实现一致，便于两个写入方共存）。
 * @param {{id: string, title: string, inserted_at: string, updated_at: string}} conv - 会话元信息。
 * @param {object[]} messages - 规范化消息。
 * @returns {string} Markdown 全文。
 */
export function renderMarkdown(conv, messages) {
  const models = [...new Set(messages.map((m) => m.model).filter(Boolean))]
  const chars = messages.reduce((a, m) => a + m.text.length + m.thinking.length, 0)
  const L = []
  L.push(`# ${conv.title || '(无标题)'}`)
  L.push('')
  L.push(`- **会话 ID**：\`${conv.id}\``)
  L.push(`- **时间**：${stamp(conv.inserted_at)} → ${stamp(conv.updated_at)}`)
  L.push(`- **模型**：${models.join(', ') || '—'}`)
  L.push(`- **消息**：${messages.length} 条，约 ${chars.toLocaleString('en-US')} 字符`)
  L.push('- **来源**：DeepSeek 网页端接口同步（dsh-kb-sync 插件）')
  L.push('')
  L.push('---')
  L.push('')
  for (const m of messages) {
    const when = stamp(m.at)
    if (m.role === 'user') {
      L.push(`## 👤 用户 · ${when}`)
      L.push('')
      for (const f of m.files) L.push(`> 📎 附件：\`${f.name}\`（${sizeText(f.size)}）`)
      if (m.files.length) L.push('')
      if (m.text) L.push(m.text)
      L.push('')
    } else {
      if (m.thinking) {
        L.push(`### 💭 思考过程 · ${when}`)
        L.push('')
        L.push(m.thinking)
        L.push('')
      }
      if (m.searches.length) {
        L.push(`<details><summary>🔍 联网检索（${m.searches.length} 条）</summary>`)
        L.push('')
        for (const s of m.searches) L.push(`- [${s.title || s.url}](${s.url})`)
        L.push('')
        L.push('</details>')
        L.push('')
      }
      if (m.text) {
        L.push(`### 🤖 DeepSeek · ${when}`)
        L.push('')
        L.push(m.text)
        L.push('')
      }
    }
  }
  return L.join('\n')
}

/** 把响应体里的 biz_data 取出来；取不到就抛出带状态码的错误。 */
function requireBiz(res, json, what) {
  const biz = json?.data?.biz_data
  if (biz) return biz
  const code = json?.data?.biz_code ?? json?.code ?? res?.status
  const msg = json?.data?.biz_msg || json?.msg || ''
  const error = new Error(`${what} 失败（HTTP ${res?.status ?? '?'} code=${code ?? '?'}）${String(msg).slice(0, 120)}`)
  error.status = res?.status
  error.bizCode = code
  throw error
}

/**
 * 拉取会话列表（最多 {@link PAGE_COUNT} 条；服务端游标失效，翻页不生效）。
 * @param {{token: string, fetchImpl?: typeof fetch, count?: number}} input - 调用输入。
 * @returns {Promise<{sessions: object[], hasMore: boolean}>} 会话列表。
 */
export async function listSessions({ token, fetchImpl = globalThis.fetch, count = PAGE_COUNT }) {
  const res = await fetchImpl(`${BASE}/api/v0/chat_session/fetch_page?count=${count}`, { headers: browserHeaders(token) })
  const json = await res.json().catch(() => null)
  const biz = requireBiz(res, json, 'fetch_page')
  return { sessions: Array.isArray(biz.chat_sessions) ? biz.chat_sessions : [], hasMore: Boolean(biz.has_more) }
}

/**
 * 拉取一个会话的权威历史。
 * @param {{token: string, sessionId: string, fetchImpl?: typeof fetch}} input - 调用输入。
 * @returns {Promise<object>} `biz_data`（含 `chat_session` 与 `chat_messages`）。
 */
export async function fetchHistory({ token, sessionId, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`${BASE}/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(sessionId)}`, {
    headers: browserHeaders(token),
  })
  const json = await res.json().catch(() => null)
  return requireBiz(res, json, 'history_messages')
}

/**
 * 一个会话 + 它的原始 biz_data → 知识库记录。
 * @param {object} session - 列表里的会话（`{id, title, updated_at}`）。
 * @param {object} biz - `history_messages` 的 `biz_data`。
 * @returns {{id: string, title: string, inserted_at: string, updated_at: string, messages: object[], chars: number, models: string[], turns: number}} 记录。
 */
export function toRecord(session, biz) {
  const messages = currentThread(biz)
  // 两个来源都报了自己的 updated_at（列表 vs 历史详情）。取较新的那个落盘 —— 否则
  // "列表时间比历史时间新"时，本地记录永远比列表旧，每一轮都会被判成"续聊"重复拉取。
  const updatedCandidates = [iso(biz.chat_session?.updated_at), iso(session.updated_at)].filter(Boolean).sort()
  const conv = {
    id: session.id,
    title: session.title || '',
    inserted_at: iso(biz.chat_session?.inserted_at ?? session.inserted_at ?? session.updated_at),
    updated_at: updatedCandidates.length > 0 ? updatedCandidates[updatedCandidates.length - 1] : null,
  }
  return {
    ...conv,
    messages,
    chars: messages.reduce((a, m) => a + m.text.length + m.thinking.length, 0),
    models: [...new Set(messages.map((m) => m.model).filter(Boolean))],
    turns: messages.filter((m) => m.role === 'user').length,
  }
}
