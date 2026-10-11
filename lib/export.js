/**
 * 全量回填：官方导出包这条路径。
 *
 * 为什么必须走导出包：会话列表接口的游标在服务端失效（无论传什么游标都只回最新 100 条），
 * 所以"一次把历史全拉下来"没有别的可靠办法。官方导出是 DeepSeek 自己的机制：
 *
 *   GET /api/v0/export_all               → 让服务端开始准备导出
 *   GET /api/v0/download_export_history  → 查状态；FINISHED 时给 history_download_url（约 7 天有效）
 *   GET <history_download_url>           → 下载 zip（内含 conversations.json）
 *
 * 解析侧的坑（来自本机已跑通的 `deepseek-import/parse-export.mjs`）：导出里每条会话是一棵
 * 消息树，**不能用时间戳找叶子** —— 助手回复常常与它回答的提问时间戳完全相同，按时间戳取最大
 * 会静默停在提问、丢掉最后一条回答。正确做法是按树结构取叶子（`children` 为空），时间戳只做
 * 叶子之间的平手裁决。
 *
 * @module dsh-kb-sync/export
 */

import { inflateRawSync } from 'node:zlib'

/** 触发导出。 */
export const EXPORT_TRIGGER_PATH = '/api/v0/export_all'

/** 查询导出状态（FINISHED 时带下载直链）。 */
export const EXPORT_STATUS_PATH = '/api/v0/download_export_history'

/** 用户侧 fragment 类型。 */
const USER_FRAGS = new Set(['REQUEST', 'FILE'])
const ASSIST_FRAGS = new Set(['THINK', 'RESPONSE', 'SEARCH', 'TOOL_SEARCH', 'TOOL_OPEN', 'TOOL_FIND'])

/** ISO 串统一成 `+00:00` 结尾，便于与增量路径比较。 */
export const normIso = (value) => (value ? String(value).replace('Z', '+00:00') : null)

/** 从任意响应体里取 biz_data。 */
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
 * 让服务端开始准备导出（幂等：已准备好的会直接可用）。
 * @param {{token: string, fetchImpl?: typeof fetch}} input - 调用输入。
 * @returns {Promise<object>} 原始响应体（不解读）。
 */
export async function triggerExport({ token, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`https://chat.deepseek.com${EXPORT_TRIGGER_PATH}`, { headers: browserHeadersSafe(token) })
  const json = await res.json().catch(() => null)
  return json ?? {}
}

/** 本地复制一份请求头（避免与 deepseek.js 循环依赖）。 */
function browserHeadersSafe(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: '*/*',
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    'x-client-platform': 'web',
    'x-client-version': '1.0.0',
    origin: 'https://chat.deepseek.com',
    referer: 'https://chat.deepseek.com/',
  }
}

/**
 * 查导出状态。
 * @param {{token: string, fetchImpl?: typeof fetch}} input - 调用输入。
 * @returns {Promise<{status: string, url: string|null, exportedAt: number|null}>} 状态。
 */
export async function exportStatus({ token, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`https://chat.deepseek.com${EXPORT_STATUS_PATH}`, { headers: browserHeadersSafe(token) })
  const json = await res.json().catch(() => null)
  const biz = requireBiz(res, json, 'download_export_history')
  return {
    status: String(biz.status ?? 'UNKNOWN'),
    url: typeof biz.history_download_url === 'string' && biz.history_download_url !== '' ? biz.history_download_url : null,
    exportedAt: Number.isFinite(biz.exported_at) ? biz.exported_at : null,
  }
}

/**
 * 轮询到导出就绪。
 * @param {{token: string, fetchImpl?: typeof fetch, attempts?: number, intervalMs?: number, onProgress?: (status: object) => void, sleep?: (ms: number) => Promise<void>}} input - 调用输入。
 * @returns {Promise<{url: string, exportedAt: number|null, attempts: number}>} 下载直链。
 */
export async function waitForExport({
  token,
  fetchImpl = globalThis.fetch,
  attempts = 30,
  intervalMs = 5000,
  onProgress,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
}) {
  let last = null
  for (let i = 1; i <= attempts; i += 1) {
    last = await exportStatus({ token, fetchImpl })
    onProgress?.({ attempt: i, ...last })
    if (last.status === 'FINISHED' && last.url !== null) return { url: last.url, exportedAt: last.exportedAt, attempts: i }
    if (i < attempts) await sleep(intervalMs)
  }
  const error = new Error(`导出未在预期时间内就绪（最后状态 ${last?.status ?? '未知'}）`)
  error.status = last?.status ?? null
  throw error
}

/**
 * 下载导出包。
 * @param {{url: string, fetchImpl?: typeof fetch}} input - 调用输入。
 * @returns {Promise<Buffer>} zip 字节。
 */
export async function downloadExport({ url, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(url)
  if (!res.ok) {
    const error = new Error(`下载导出包失败（HTTP ${res.status}）`)
    error.status = res.status
    throw error
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('下载到的不是 zip（缺少 PK 魔数）')
  }
  return bytes
}

/** CRC32（zip 校验用）。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

/**
 * 计算 CRC32。
 * @param {Buffer} buffer - 数据。
 * @returns {number} 无符号 CRC32。
 */
export function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

/**
 * 极简 zip 读取器：只做"按名字取一个条目"这一件事，零依赖。
 *
 * 支持 stored(0) 与 deflate(8)；逐条校验 CRC32 —— 下载截断/损坏会当场报错，而不是
 * 之后在 JSON 解析处抛一句看不懂的话。
 * @param {Buffer} buffer - zip 字节。
 * @returns {Map<string, Buffer>} 文件名 → 内容（目录条目被跳过）。
 */
export function readZipEntries(buffer) {
  const EOCD = 0x06054b50
  let eocd = -1
  const scanFrom = Math.max(0, buffer.length - 66_000)
  for (let i = buffer.length - 22; i >= scanFrom; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('不是有效的 zip：找不到中央目录结尾记录')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`中央目录第 ${i} 项签名不对`)
    const method = buffer.readUInt16LE(offset + 10)
    const expectedCrc = buffer.readUInt32LE(offset + 16)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`条目 ${name} 的本地头签名不对`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error(`条目 ${name} 用了不支持的压缩方式 ${method}`)
    if (uncompressedSize !== 0 && data.length !== uncompressedSize) {
      throw new Error(`条目 ${name} 解压后大小不符（期望 ${uncompressedSize}，得到 ${data.length}）`)
    }
    if (crc32(data) !== expectedCrc) throw new Error(`条目 ${name} 的 CRC32 校验失败（下载可能被截断）`)
    entries.set(name, data)
  }
  return entries
}

/** 助手/用户判定（与接口路径同一套 fragment 规则）。 */
function roleOf(msg) {
  const types = (msg.fragments ?? []).map((f) => f.type)
  if (types.some((t) => USER_FRAGS.has(t))) return 'user'
  if (types.some((t) => ASSIST_FRAGS.has(t))) return 'assistant'
  return 'unknown'
}

/** 导出里的一个节点 → 规范化消息。 */
export function normalizeExportNode(node) {
  const msg = node.message ?? {}
  const frags = msg.fragments ?? []
  const pick = (t) => frags.filter((f) => f.type === t)
  const textOf = (t) => pick(t).map((f) => f.content ?? '').filter(Boolean).join('\n\n')
  return {
    id: String(node.id),
    at: normIso(msg.inserted_at),
    model: msg.model ?? null,
    role: roleOf(msg),
    text: textOf('REQUEST') || textOf('RESPONSE'),
    thinking: textOf('THINK'),
    searches: [...pick('SEARCH'), ...pick('TOOL_SEARCH')].flatMap((f) => (f.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '' }))),
    files: pick('FILE').flatMap((f) => (f.files ?? []).map((x) => ({ name: x.file_name ?? '', size: x.file_size ?? 0 }))),
    toolOps: frags.filter((f) => f.type.startsWith('TOOL_')).length,
  }
}

/**
 * 从消息树里取"当前线程"：按 `children` 找真叶子，再沿 parent 走回根。
 * @param {Record<string, object>} map - 导出的 `mapping`。
 * @returns {object[]} 从根到叶的节点序列。
 */
export function mainPath(map) {
  const ids = Object.keys(map)
  if (ids.length === 0) return []
  const isLeaf = (id) => {
    const node = map[id]
    if (!node || node.parent === null || node.parent === undefined) return false // 合成根
    return (node.children ?? []).length === 0
  }
  const ts = (node) => Date.parse(node.message?.inserted_at ?? 0) || 0
  const depth = (node) => {
    let d = 0
    let cur = node
    const guard = new Set()
    while (cur && cur.parent && cur.parent !== 'root' && map[cur.parent] && !guard.has(cur.id)) {
      guard.add(cur.id)
      cur = map[cur.parent]
      d += 1
    }
    return d
  }
  let leaves = ids.filter(isLeaf)
  if (leaves.length === 0) leaves = ids.filter((id) => map[id]?.message)
  if (leaves.length === 0) return []
  let leafId = leaves[0]
  for (const id of leaves) {
    const a = map[id]
    const b = map[leafId]
    if (ts(a) > ts(b) || (ts(a) === ts(b) && depth(a) > depth(b))) leafId = id
  }
  const chain = []
  let cur = map[leafId]
  const guard = new Set()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    if (cur.message) chain.push(cur)
    if (cur.parent === 'root' || cur.parent === null || cur.parent === undefined) break
    cur = map[cur.parent]
  }
  return chain.reverse()
}

/**
 * 解析 `conversations.json`。
 *
 * 真实导出包里这个文件是**顶层数组**（实测 2026-09-23 那份：2446 条）；对象包裹的形状
 * （`{conversations:[…]}` / `{data:{conversations:[…]}}`）一并兼容，免得将来改版又白跑一轮。
 * @param {object|object[]} root - 解析后的导出 JSON。
 * @returns {object[]} 与增量路径同形状的记录（`{id,title,inserted_at,updated_at,messages,chars,models,turns}`）。
 */
export function parseExportConversations(root) {
  const conversations = Array.isArray(root) ? root : (root?.conversations ?? root?.data?.conversations ?? [])
  const records = []
  for (const conv of conversations) {
    const path = mainPath(conv.mapping ?? {})
    const messages = path.map(normalizeExportNode).filter((m) => m.role !== 'unknown' && (m.text || m.thinking || m.files.length || m.searches.length))
    records.push({
      id: String(conv.id),
      title: conv.title ?? '',
      inserted_at: normIso(conv.inserted_at),
      updated_at: normIso(conv.updated_at ?? conv.inserted_at),
      messages,
      chars: messages.reduce((a, m) => a + m.text.length + m.thinking.length, 0),
      models: [...new Set(messages.map((m) => m.model).filter(Boolean))],
      turns: messages.filter((m) => m.role === 'user').length,
    })
  }
  return records
}

/**
 * 从 zip 字节里取 `conversations.json` 并解析。
 * @param {Buffer} zipBytes - 导出包。
 * @returns {{records: object[], user: object|null}} 会话记录与（可选的）user.json。
 */
export function readExport(zipBytes) {
  const entries = readZipEntries(zipBytes)
  let conversationsEntry = null
  let userEntry = null
  for (const name of entries.keys()) {
    const base = name.split('/').pop()
    if (base === 'conversations.json') conversationsEntry = name
    if (base === 'user.json') userEntry = name
  }
  if (conversationsEntry === null) throw new Error('导出包里没有 conversations.json')
  const parsed = JSON.parse(entries.get(conversationsEntry).toString('utf8'))
  const user = userEntry === null ? null : JSON.parse(entries.get(userEntry).toString('utf8'))
  return { records: parseExportConversations(parsed), user }
}
