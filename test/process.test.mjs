/**
 * Unit tests for the in-process segment 2 (phase 2).
 *
 * These cover the parts that must not silently degrade: parsing whatever the
 * model actually returned, normalizing a partial answer, and writing the exact
 * `sync/out` layout the apply step has always expected.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { askModel, buildUserMessage, normalizeResult, parseModelJson, resolveRoute, summaryMarkdown, writeOutbox } from '../lib/process.js'

const SAMPLE = {
  assignments: [{ idx: 2540, topic: '04-AI与编程开发', why: 'DSH 会话模式' }],
  facts: [],
  candidates: [],
  suggestions: [],
  summary: '本轮 1 条归类。',
}

test('parseModelJson accepts a bare object', () => {
  const parsed = parseModelJson(JSON.stringify(SAMPLE))
  assert.equal(parsed.value.assignments.length, 1)
  assert.equal(parsed.repaired, false)
})

test('parseModelJson unwraps a fenced code block', () => {
  const parsed = parseModelJson('```json\n' + JSON.stringify(SAMPLE) + '\n```')
  assert.equal(parsed.value.summary, '本轮 1 条归类。')
  assert.equal(parsed.repaired, true)
})

test('parseModelJson tolerates a sentence before and after the object', () => {
  const parsed = parseModelJson(`好的，结果如下：\n${JSON.stringify(SAMPLE)}\n以上就是全部。`)
  assert.equal(parsed.value.assignments[0].topic, '04-AI与编程开发')
  assert.equal(parsed.repaired, true)
})

test('parseModelJson repairs a truncated object instead of dropping the round', () => {
  const cut = JSON.stringify(SAMPLE).slice(0, JSON.stringify(SAMPLE).length - 30)
  const parsed = parseModelJson(cut)
  assert.notEqual(parsed.value, null, `expected a repair for: ${cut}`)
  assert.equal(parsed.repaired, true)
  assert.equal(parsed.value.assignments[0].idx, 2540)
})

test('parseModelJson reports empty output instead of throwing', () => {
  const parsed = parseModelJson('   ')
  assert.equal(parsed.value, null)
  assert.match(parsed.note, /空输出/)
})

test('normalizeResult fills missing sections with empty arrays', () => {
  const result = normalizeResult({ assignments: SAMPLE.assignments })
  assert.deepEqual(result.facts, [])
  assert.deepEqual(result.candidates, [])
  assert.deepEqual(result.suggestions, [])
  assert.equal(result.summary, '')
})

test('normalizeResult accepts the legacy per-file envelopes', () => {
  const result = normalizeResult({
    'update-topics': { assignments: SAMPLE.assignments },
    'health-facts': { facts: [{ kind: 'symptom', label: 'x', evidence: 'y', status: '用户自述' }] },
    'finance-facts': { candidates: [{ topic: 'debt', label: 'z', evidence: 'e', status: '用户自述', asOf: '2026-10-01' }] },
  })
  assert.equal(result.assignments.length, 1)
  assert.equal(result.facts.length, 1)
  assert.equal(result.candidates.length, 1)
})

test('normalizeResult ignores non-array garbage', () => {
  const result = normalizeResult({ assignments: 'nope', facts: null, summary: 42 })
  assert.deepEqual(result.assignments, [])
  assert.deepEqual(result.facts, [])
  assert.equal(result.summary, '')
})

test('buildUserMessage omits absent digests and says so for an empty round', () => {
  const message = buildUserMessage({ itemsTsv: '', topicKeysTsv: 'key\tdesc\n01-x\tx' })
  assert.match(message, /本轮没有新增或续聊的会话/)
  assert.doesNotMatch(message, /health-digest/)
  assert.match(message, /update-topic-keys\.tsv/)
})

test('buildUserMessage clips an oversized digest', () => {
  const message = buildUserMessage({ itemsTsv: '', healthDigest: 'x'.repeat(500), digestMaxChars: 100 })
  assert.match(message, /已截断，原始长度 500 字符/)
})

test('writeOutbox writes only the sections that carry data, plus the summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-sync-out-'))
  try {
    const written = writeOutbox(dir, normalizeResult(SAMPLE))
    assert.deepEqual(written.sort(), ['summary.md', 'update-topics.json'])
    const topics = JSON.parse(readFileSync(join(dir, 'update-topics.json'), 'utf8'))
    assert.equal(topics.assignments[0].idx, 2540)
    assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /归类：1 条/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('summaryMarkdown lists every assignment', () => {
  const text = summaryMarkdown(normalizeResult(SAMPLE))
  assert.match(text, /- 2540 → 04-AI与编程开发（DSH 会话模式）/)
})

test('resolveRoute prefers the configured pair and validates it', async () => {
  const llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'other', name: 'Other' }],
    listModels: async (provider) => (provider === 'deepseek-official' ? [{ provider, id: 'deepseek-v4-flash', name: 'flash' }] : []),
  }
  const configured = await resolveRoute(llm, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  assert.deepEqual(configured, { provider: 'deepseek-official', model: 'deepseek-v4-flash', source: 'config' })

  const auto = await resolveRoute(llm, null)
  assert.equal(auto.source, 'auto')
  assert.equal(auto.provider, 'deepseek-official')

  const stale = await resolveRoute(llm, { provider: 'gone', model: 'gone' })
  assert.equal(stale.provider, 'deepseek-official')
  assert.equal(stale.source, 'auto')
})

test('resolveRoute reports an empty catalog instead of guessing', async () => {
  const none = await resolveRoute({ listProviders: () => [] }, null)
  assert.equal(none.error, 'no-provider')
  const noModel = await resolveRoute({ listProviders: () => [{ id: 'p', name: 'P' }], listModels: async () => [] }, null)
  assert.equal(noModel.error, 'no-model')
})

test('askModel joins text-delta chunks and surfaces a terminal error', async () => {
  const okStream = {
    async *stream() {
      yield { type: 'text-delta', index: 0, text: '{"assign' }
      yield { type: 'text-delta', index: 0, text: 'ments":[]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const ok = await askModel({ llm: okStream, provider: 'p', model: 'm', system: 's', user: 'u', maxTokens: 16 })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.result.assignments, [])

  const badStream = {
    async *stream() {
      yield { type: 'text-delta', index: 0, text: 'partial' }
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'nope' } } }
    },
  }
  const bad = await askModel({ llm: badStream, provider: 'p', model: 'm', system: 's', user: 'u', maxTokens: 16 })
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'provider-error')
  assert.match(bad.message, /nope/)
})
