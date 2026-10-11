/**
 * dsh-kb-sync — segment 2, in-process (phase 2 of the pipeline absorption).
 *
 * The old segment 2 was: `prep-inbox.mjs` → `dsh headless` (a whole second DSH
 * runtime, its own DSH_HOME, its own sandbox) → `apply-extraction.mjs`.
 * Here the middle step becomes one call to the host's `llm` service, so the
 * pipeline no longer needs a headless runtime, a second credentials copy, or a
 * sandbox whose workspace must be provisioned.
 *
 * Kept from the old design on purpose:
 *   - the model only ever *judges*: it returns JSON, never touches the archive;
 *   - `apply-extraction.mjs` still validates that JSON before anything lands
 *     (idx set equality, legal topics, specialty parent match) and refuses to
 *     apply a batch that fails.
 *
 * Flow: ensureInputs (reuse the pipeline's prep scripts) → ask the model →
 * write `sync/out/*` exactly where the old headless wrote them → validate
 * (`apply-extraction --dry-run`) → optionally apply + rebuild.
 *
 * @module dsh-kb-sync/process
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Keys the model must return; anything else is ignored. */
const RESULT_KEYS = ['assignments', 'facts', 'candidates', 'suggestions']

/**
 * Strip the usual decorations a model puts around JSON and return the payload.
 * Tolerates code fences, a leading sentence, and a trailing explanation; when
 * the object is cut off mid-way it tries to close the open containers instead
 * of throwing the whole round away.
 * @param {string} raw - model output.
 * @returns {{ value: object|null, repaired: boolean, note: string }}
 */
export function parseModelJson(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '')
  if (text.trim() === '') return { value: null, repaired: false, note: '空输出' }

  const candidates = []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1])
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  if (first >= 0) candidates.push(text.slice(first))
  candidates.push(text)

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return { value, repaired: candidate !== text, note: candidate === text ? '' : '去掉了 JSON 之外的包装' }
      }
    } catch {
      /* try the next candidate */
    }
  }

  // Last resort: close unterminated strings/containers (truncated generation).
  for (const candidate of candidates) {
    const repaired = closeUnterminated(candidate)
    if (repaired === null) continue
    try {
      const value = JSON.parse(repaired)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return { value, repaired: true, note: '输出被截断，已补齐括号后解析' }
      }
    } catch {
      /* give up */
    }
  }
  return { value: null, repaired: false, note: '无法解析为 JSON 对象' }
}

/**
 * Close an unterminated JSON text so it can be parsed. Best effort only: it
 * drops a trailing partial token and appends the missing closers.
 * @param {string} text - possibly truncated JSON.
 * @returns {string|null} a parseable text, or null when that is hopeless.
 */
function closeUnterminated(text) {
  const stack = []
  let inString = false
  let escaped = false
  let lastComplete = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') { inString = false; lastComplete = i }
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') stack.pop()
    if (ch === ',' || ch === '}' || ch === ']') lastComplete = i
  }
  if (stack.length === 0) return null
  let body = text
  if (inString || lastComplete < 0) {
    // Cut back to the last structurally complete position.
    body = lastComplete >= 0 ? text.slice(0, lastComplete) : text
    if (lastComplete >= 0 && body.endsWith(',')) body = body.slice(0, -1)
  }
  return body + stack.reverse().join('')
}

/**
 * Normalize a parsed model payload into the five files the apply step reads.
 * Missing sections become empty arrays so a partial answer still lands.
 * @param {object} value - parsed model JSON.
 * @returns {object} detached, array-typed sections plus the summary text.
 */
export function normalizeResult(value) {
  const v = value !== null && typeof value === 'object' ? value : {}
  const asArray = (x) => (Array.isArray(x) ? x : [])
  const out = {
    assignments: asArray(v.assignments),
    facts: asArray(v.facts),
    candidates: asArray(v.candidates),
    suggestions: asArray(v.suggestions),
    summary: typeof v.summary === 'string' ? v.summary : '',
  }
  // Tolerate the older per-file shape (`{facts:[...]}` etc.) by also accepting
  // an explicit `update-topics` / `health-facts` / `finance-facts` envelope.
  if (out.assignments.length === 0 && Array.isArray(v['update-topics']?.assignments)) out.assignments = v['update-topics'].assignments
  if (out.facts.length === 0 && Array.isArray(v['health-facts']?.facts)) out.facts = v['health-facts'].facts
  if (out.candidates.length === 0 && Array.isArray(v['finance-facts']?.candidates)) out.candidates = v['finance-facts'].candidates
  if (out.suggestions.length === 0 && Array.isArray(v['specialty-suggestions']?.suggestions)) out.suggestions = v['specialty-suggestions'].suggestions
  return out
}

/**
 * Resolve the provider/model pair the process step should call.
 * An explicit pair wins; otherwise the first registered provider and its first
 * advertised model is used, which is the same pair the GUI offers first.
 * @param {object} llm - the host `llm` service.
 * @param {object|null} preferred - `{ provider, model }` from config, if any.
 * @param {AbortSignal} [signal] - cancellation for model discovery.
 * @returns {Promise<{provider: string, model: string, source: string}|{error: string}>}
 */
export async function resolveRoute(llm, preferred = null, signal) {
  const providers = llm.listProviders()
  if (providers.length === 0) return { error: 'no-provider' }
  const provider = preferred?.provider && providers.some((p) => p.id === preferred.provider)
    ? preferred.provider
    : providers[0].id
  const models = await llm.listModels(provider)
  if (models.length === 0) return { error: 'no-model', provider }
  const model = preferred?.model && models.some((m) => m.id === preferred.model && m.provider === provider)
    ? preferred.model
    : models[0].id
  const source = preferred?.provider === provider && preferred?.model === model ? 'config' : 'auto'
  return { provider, model, source }
}

/** Read a file's text, or '' when it is absent — digests are optional inputs. */
function readIfPresent(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** Keep a prompt section bounded: the model only needs the head of a digest. */
function clip(text, maxChars, label) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n…（${label} 已截断，原始长度 ${text.length} 字符）`
}

/**
 * Build the user message: the task prompt plus whichever inputs the prep step
 * produced. Sections are omitted when their input file is missing or empty,
 * which is how the model learns "this round has no health content".
 * @param {object} parts - prompt text and inbox contents.
 * @returns {string} the user message.
 */
export function buildUserMessage(parts) {
  const sections = []
  if (parts.itemsTsv) {
    sections.push(`## 输入：本轮新增/续聊的会话（update-new-items.tsv）\n\n\`\`\`\n${parts.itemsTsv.trim()}\n\`\`\``)
  } else {
    sections.push('## 输入：本轮新增/续聊的会话\n\n（空：本轮没有新增或续聊的会话）')
  }
  if (parts.topicKeysTsv) sections.push(`## 输入：合法话题清单（update-topic-keys.tsv）\n\n\`\`\`\n${parts.topicKeysTsv.trim()}\n\`\`\``)
  if (parts.specialtyKeysTsv) sections.push(`## 输入：合法专题清单（specialty-keys.tsv）\n\n\`\`\`\n${parts.specialtyKeysTsv.trim()}\n\`\`\``)
  if (parts.healthDigest) sections.push(`## 输入：健康相关会话摘要（health-digest.md）\n\n${clip(parts.healthDigest, parts.digestMaxChars ?? 120_000, '健康摘要')}`)
  if (parts.financeDigest) sections.push(`## 输入：财务相关会话摘要（finance-digest.md）\n\n${clip(parts.financeDigest, parts.digestMaxChars ?? 120_000, '财务摘要')}`)
  sections.push('## 现在开始\n\n只输出那一个 JSON 对象。')
  return sections.join('\n\n')
}

/**
 * Ask the host model for this round's judgement and return the normalized
 * sections. One stream, one attempt: retry policy belongs to the host.
 *
 * Deliberately dependency-free: the request message is built as the documented
 * persistent `Message` shape and the stream is consumed by reading
 * `text-delta` chunks, so this file imports nothing from `@deepseek-ai/dsh-llm`
 * (which lives in the host's own node_modules, not in the plugin's).
 * @param {object} deps - `{ llm, provider, model, system, user, maxTokens, signal }`.
 * @returns {Promise<{ ok: boolean, result?: object, raw?: string, note?: string, error?: string, message?: string }>}
 */
export async function askModel(deps) {
  const { llm, provider, model, system, user, maxTokens, signal } = deps
  const messages = [
    {
      id: `kb-sync-${Date.now().toString(36)}`,
      role: 'user',
      content: [{ type: 'text', text: user }],
      source: { kind: 'dsh-kb-sync' },
    },
  ]
  let raw = ''
  let finish
  try {
    for await (const chunk of llm.stream({
      provider,
      model,
      messages,
      ...(typeof system === 'string' && system !== '' ? { system } : {}),
      ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {}),
      purpose: 'dsh-kb-sync-process',
      ...(signal ? { signal } : {}),
    })) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text
      else if (chunk?.type === 'finish') finish = chunk.reason
    }
  } catch (error) {
    return { ok: false, error: 'stream-failed', message: String(error?.message ?? error).slice(0, 300) }
  }
  const kind = finish?.kind ?? 'stop'
  if (kind === 'error' || kind === 'aborted') {
    return {
      ok: false,
      error: kind === 'aborted' ? 'aborted' : 'provider-error',
      message: String(finish?.failure?.message ?? kind).slice(0, 300),
      raw,
    }
  }
  const parsed = parseModelJson(raw)
  if (parsed.value === null) return { ok: false, error: 'unparseable-output', message: parsed.note, raw: raw.slice(0, 4000) }
  return { ok: true, result: normalizeResult(parsed.value), raw, note: parsed.note, finishKind: kind }
}

/**
 * Write the judgement where the apply step reads it — byte-for-byte the layout
 * `apply-extraction.mjs` has always consumed (`sync/out/*.json` + `summary.md`).
 * @param {string} outDir - `<import>/sync/out`.
 * @param {object} result - normalized sections.
 * @returns {string[]} the file names written.
 */
export function writeOutbox(outDir, result) {
  mkdirSync(outDir, { recursive: true })
  const written = []
  const put = (name, payload) => {
    writeFileSync(join(outDir, name), `${JSON.stringify(payload, null, 1)}\n`, 'utf8')
    written.push(name)
  }
  if (result.assignments.length > 0) {
    put('update-topics.json', { generatedAt: new Date().toISOString(), assignments: result.assignments })
  }
  if (result.facts.length > 0) put('health-facts.json', { batch: `llm-${new Date().toISOString().slice(0, 10)}`, facts: result.facts })
  if (result.candidates.length > 0) put('finance-facts.json', { batch: `llm-${new Date().toISOString().slice(0, 10)}`, candidates: result.candidates })
  if (result.suggestions.length > 0) put('specialty-suggestions.json', { suggestions: result.suggestions })
  writeFileSync(join(outDir, 'summary.md'), summaryMarkdown(result), 'utf8')
  written.push('summary.md')
  return written
}

/** Render the round summary the apply step copies into `sync/logs/`. */
export function summaryMarkdown(result) {
  const lines = [`# 段 2 提炼摘要 ${new Date().toISOString().slice(0, 10)}`, '']
  lines.push(`- 归类：${result.assignments.length} 条`)
  lines.push(`- 健康事实：${result.facts.length} 条`)
  lines.push(`- 财务候选：${result.candidates.length} 条`)
  lines.push(`- 专题建议：${result.suggestions.length} 条`)
  lines.push('')
  if (result.assignments.length > 0) {
    lines.push('## 归类逐条')
    lines.push('')
    for (const a of result.assignments) lines.push(`- ${a.idx} → ${a.topic}${a.why ? `（${a.why}）` : ''}`)
    lines.push('')
  }
  if (result.summary) {
    lines.push('## 模型自述')
    lines.push('')
    lines.push(result.summary)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Clear stale judgement before a new round so a failed model call cannot be
 * mistaken for "the previous round's files are still valid".
 * @param {string} outDir - `<import>/sync/out`.
 */
export function clearOutbox(outDir) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
}

export const PROCESS_RESULT_KEYS = RESULT_KEYS
