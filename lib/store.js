/**
 * 本地知识库读写层：`conversations.jsonl`（全文，检索源）+ `catalog.json`（清单）
 * + `conversations/*.md`（人读的单会话原文）。
 *
 * 两条不变量：
 * 1. **任何写都必须落在配置的知识库目录内** —— 相对路径先解析、再校验前缀，越界即抛。
 * 2. **先备份、再原子替换** —— 写临时文件后 rename，避免半截文件；旧版本按代数轮转。
 *
 * @module dsh-kb-sync/store
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/** 备份保留代数（与参考实现一致：最新 2 代）。 */
export const KEEP_BACKUP_GENERATIONS = 2

/** 一次检索最多返回的会话数上限。 */
export const MAX_SEARCH_LIMIT = 50

/**
 * 把相对路径解析到根目录内；越界（`..`、绝对路径、盘符）直接抛错。
 * @param {string} root - 允许写入的根目录。
 * @param {string} rel - 相对路径。
 * @returns {string} 绝对路径。
 */
export function resolveInside(root, rel) {
  const base = resolve(root)
  const target = resolve(base, rel)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`路径越界：${rel}`)
  }
  return target
}

/** 读 JSON，坏文件按缺省值处理（知识库不该因为一个坏文件就不可用）。 */
function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

/**
 * 读取知识库现状。
 * @param {string} outDir - 知识库根目录。
 * @returns {{recs: object[], catalog: object[], byId: Map<string, {rec: object, idx: number}>}} 现状。
 */
export function loadKb(outDir) {
  const recs = []
  const jsonlPath = join(outDir, 'conversations.jsonl')
  if (existsSync(jsonlPath)) {
    for (const line of readFileSync(jsonlPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line)
        if (rec && typeof rec.id === 'string') recs.push(rec)
      } catch {
        /* 跳过坏行：宁可少一条，不要整库不可读 */
      }
    }
  }
  let catalog = readJson(join(outDir, 'catalog.json'), [])
  if (!Array.isArray(catalog)) catalog = []
  const byId = new Map(recs.map((rec, idx) => [rec.id, { rec, idx }]))
  return { recs, catalog, byId }
}

/** 删除过旧的备份，只留最新 N 代。 */
function pruneBackups(dir, fileName, keep = KEEP_BACKUP_GENERATIONS) {
  try {
    const prefix = `${fileName}.backup-`
    const stale = readdirSync(dir)
      .filter((n) => n.startsWith(prefix))
      .sort()
      .slice(0, -keep)
    for (const name of stale) rmSync(join(dir, name), { force: true })
  } catch {
    /* 轮转失败不影响本轮写入 */
  }
}

/** 原子写文本：临时文件 + rename。 */
export function writeTextAtomic(path, text, { backup = false } = {}) {
  mkdirSync(dirname(path), { recursive: true })
  if (backup && existsSync(path)) {
    const stampStr = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = `${path}.backup-${stampStr}`
    copyFileSync(path, backupPath)
    pruneBackups(dirname(path), path.split(sep).pop())
  }
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

/**
 * 写一个会话的 Markdown（路径安全 + 原子）。
 * @param {string} outDir - 知识库根目录。
 * @param {string} relPath - 形如 `conversations/xxx.md` 的相对路径。
 * @param {string} markdown - 正文。
 * @returns {string} 实际写入的绝对路径。
 */
export function writeConversation(outDir, relPath, markdown) {
  const target = resolveInside(outDir, relPath)
  writeTextAtomic(target, markdown)
  return target
}

/**
 * 落盘整库（JSONL + catalog），写前备份、写时原子替换。
 * @param {string} outDir - 知识库根目录。
 * @param {{recs: object[], catalog: object[]}} kb - 全量内容。
 * @returns {{jsonlBytes: number, catalogRows: number}} 写入结果。
 */
export function saveKb(outDir, { recs, catalog }) {
  const jsonlPath = join(outDir, 'conversations.jsonl')
  const catalogPath = join(outDir, 'catalog.json')
  writeTextAtomic(jsonlPath, recs.map((r) => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''), { backup: true })
  writeTextAtomic(catalogPath, JSON.stringify(catalog, null, 1), { backup: true })
  return { jsonlBytes: statSync(jsonlPath).size, catalogRows: catalog.length }
}

/** 知识库概览（只读）。 */
export function kbStatus(outDir) {
  const jsonlPath = join(outDir, 'conversations.jsonl')
  const catalogPath = join(outDir, 'catalog.json')
  const convDir = join(outDir, 'conversations')
  const status = {
    dir: outDir,
    conversationsJsonl: existsSync(jsonlPath) ? { bytes: statSync(jsonlPath).size, mtime: statSync(jsonlPath).mtimeMs } : null,
    catalog: existsSync(catalogPath) ? { rows: (readJson(catalogPath, []) || []).length, mtime: statSync(catalogPath).mtimeMs } : null,
    markdown: 0,
  }
  try {
    if (existsSync(convDir)) status.markdown = readdirSync(convDir).filter((n) => n.endsWith('.md')).length
  } catch {
    /* 目录不可读就当 0 */
  }
  return status
}

/** 取命中位置前后的一小段文本，压成一行。 */
function snippet(text, index, width = 90) {
  const flat = String(text).replace(/\s+/g, ' ')
  if (flat.length <= width * 2) return flat
  const start = Math.max(0, index - width)
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + width * 2)}${start + width * 2 < flat.length ? '…' : ''}`
}

/**
 * 在知识库里做子串检索（标题 + 正文；可选只看用户说的话）。
 *
 * 与参考实现同一取舍：**不建索引**，直接扫 JSONL —— 几千会话 / 几十 MB 量级够快，
 * 也不引入"索引与正文不同步"这类静默错误。数据再涨一个量级再考虑索引。
 * @param {string} outDir - 知识库根目录。
 * @param {{query: string, role?: 'any'|'user', limit?: number, ids?: string[]}} input - 检索输入。
 * @returns {{hits: object[], scanned: number}} 命中与扫描量。
 */
export function searchKb(outDir, { query, role = 'any', limit = 20, ids = null }) {
  const needle = String(query ?? '').toLowerCase()
  if (needle === '') return { hits: [], scanned: 0 }
  const { recs } = loadKb(outDir)
  const idFilter = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null
  const hits = []
  for (const rec of recs) {
    if (idFilter && !idFilter.has(rec.id)) continue
    const titleHit = String(rec.title ?? '').toLowerCase().includes(needle)
    const matches = []
    for (const m of rec.messages ?? []) {
      if (role === 'user' && m.role !== 'user') continue
      for (const field of ['text', 'thinking']) {
        const value = m[field]
        if (!value) continue
        const at = value.toLowerCase().indexOf(needle)
        if (at >= 0) {
          matches.push({ role: m.role, at: m.at, snippet: snippet(value, at) })
          break
        }
      }
      if (matches.length >= 3) break
    }
    if (!titleHit && matches.length === 0) continue
    hits.push({ id: rec.id, title: rec.title, updated_at: rec.updated_at, file: rec.file, titleHit, matches })
  }
  hits.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
  return { hits: hits.slice(0, Math.min(limit, MAX_SEARCH_LIMIT)), scanned: recs.length }
}
