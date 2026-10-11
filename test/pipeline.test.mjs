/**
 * Unit tests for the whole-chain orchestration (phase 3).
 *
 * These lock in the two hard-won attribution rules: a non-zero exit is not
 * proof of failure, and "token expired" must be proven by a marker.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MARKERS, chainVerdict, classifyStage, completedMarker } from '../lib/pipeline.js'

test('completedMarker finds a success marker anywhere in the output', () => {
  assert.equal(completedMarker(['=== 完成 ==='], 'x\n=== 完成 ===\ny'), '=== 完成 ===')
  assert.equal(completedMarker(['没有需要更新的内容'], '没有需要更新的内容 ✔'), '没有需要更新的内容')
  assert.equal(completedMarker(['=== 完成 ==='], 'boom'), null)
})

test('classifyStage: exit 0 is ok', () => {
  const v = classifyStage({ exitCode: 0, output: '' })
  assert.deepEqual(v.code, 'ok')
  assert.equal(v.ok, true)
})

test('classifyStage: non-zero exit WITH the stage marker is a teardown crash, not a failure', () => {
  const v = classifyStage({ exitCode: 3221225477, output: '新增（本地没有）5 条\nAssertion failed: src\\win\\async.c', successMarkers: MARKERS.recon })
  assert.equal(v.code, 'finished-with-crash')
  assert.equal(v.ok, true)
})

test('classifyStage: non-zero exit + auth marker is reported as an expired token', () => {
  const v = classifyStage({ exitCode: 1, output: 'AUTH_UNAUTHORIZED fetch_page 鉴权失败', successMarkers: MARKERS.recon })
  assert.equal(v.code, 'token-expired')
  assert.equal(v.ok, false)
  assert.match(v.message, /Token/)
})

test('classifyStage: a plain failure never claims to be a token problem', () => {
  const v = classifyStage({ exitCode: 1, output: 'fetch failed: ECONNRESET', successMarkers: MARKERS.recon })
  assert.equal(v.code, 'failed')
  assert.doesNotMatch(v.message, /Token/)
})

test('classifyStage: a stage that never started is spawn-failed', () => {
  const v = classifyStage({ exitCode: null, output: '' })
  assert.equal(v.code, 'spawn-failed')
})

test('classifyStage: a success marker wins over the auth marker when both appear', () => {
  // A round can mention AUTH_UNAUTHORIZED for one session and still finish.
  const v = classifyStage({ exitCode: 1, output: 'AUTH_UNAUTHORIZED id=7\n=== 完成 ===', successMarkers: MARKERS.update })
  assert.equal(v.code, 'finished-with-crash')
  assert.equal(v.ok, true)
})

test('chainVerdict: all ok is ok', () => {
  const v = chainVerdict([{ stage: 'token', ok: true }, { stage: 'fetch', ok: true }])
  assert.equal(v.ok, true)
  assert.equal(v.failedStage, null)
})

test('chainVerdict: names the first failing stage and carries its message', () => {
  const v = chainVerdict([
    { stage: 'token', ok: true },
    { stage: 'recon', ok: false, code: 'token-expired', message: '未授权' },
    { stage: 'fetch', ok: false, message: '不应到达' },
  ])
  assert.equal(v.ok, false)
  assert.equal(v.failedStage, 'recon')
  assert.match(v.reason, /recon/)
  assert.match(v.reason, /未授权/)
})
