/**
 * dsh-kb-sync — the whole daily chain, owned by the plugin (phase 3).
 *
 * Before this, the chain was a shell script (`sync-daily.cmd` → `sync-extract.cmd`
 * → desktop toast) whose middle step needed a second DSH runtime. Now the
 * plugin runs every stage in process and reports each one's outcome and
 * duration, so the page can answer "what failed and why" without anyone
 * reading a log first.
 *
 * Stage map (the old script's responsibilities, moved here verbatim):
 *
 *   ① token   — file present? how old? (the old `.cmd` checks, same threshold)
 *   ② recon   — `recon-update.mjs`: read-only, tells us whether anything changed
 *   ③ fetch   — `update-from-api.mjs`: writes Markdown + catalog/jsonl, rotates backups
 *   ④ process — the model judgement + validation + apply + rebuild (lib/process flow)
 *   ⑤ doctor  — `kb.mjs doctor`: warn-only, never fails the chain
 *
 * Failure attribution is the part worth keeping: a non-zero exit alone is not
 * proof of failure (Node may crash during libuv teardown *after* the work), and
 * "token expired" must be proven by the `AUTH_UNAUTHORIZED` marker rather than
 * guessed. Both rules were learned the hard way and are preserved here.
 *
 * @module dsh-kb-sync/pipeline
 */

/** Success/failure markers, mirroring `tools/pipeline/check-log.mjs`. */
export const MARKERS = {
  recon: ['新增（本地没有）'],
  update: ['=== 完成 ===', '没有需要更新的内容'],
  apply: ['全部校验通过'],
  inbox: ['输出目录（待 headless 填写）', '收件箱已准备'],
  auth: ['AUTH_UNAUTHORIZED'],
}

/**
 * Did this stage actually finish, despite a non-zero exit code?
 * @param {string[]} markers - marker strings that prove completion.
 * @param {string} output - the stage's combined stdout/stderr.
 * @returns {string|null} the marker that matched, or null.
 */
export function completedMarker(markers, output) {
  const text = String(output ?? '')
  return markers.find((m) => text.includes(m)) ?? null
}

/**
 * Turn one stage's exit code + output into an actionable verdict.
 *
 * Codes the page shows (and the notification uses):
 *   ok / finished-with-crash / token-expired / fetch-failed / script-missing /
 *   spawn-failed / failed
 *
 * @param {object} stage - `{ exitCode, output, authMarkers, successMarkers }`.
 * @returns {{ code: string, ok: boolean, message: string }}
 */
export function classifyStage(stage) {
  const output = String(stage.output ?? '')
  if (stage.exitCode === 0) return { code: 'ok', ok: true, message: '完成' }
  if (stage.exitCode === null || stage.exitCode === undefined) {
    return { code: 'spawn-failed', ok: false, message: '进程没能启动（node 或脚本不可用）' }
  }
  const done = completedMarker(stage.successMarkers ?? [], output)
  if (done !== null) {
    return { code: 'finished-with-crash', ok: true, message: `退出码 ${stage.exitCode}，但日志里有完成标记（${done}）——判定为 Node 退出期噪声` }
  }
  if (completedMarker(stage.authMarkers ?? MARKERS.auth, output) !== null) {
    return { code: 'token-expired', ok: false, message: `退出码 ${stage.exitCode}，且接口返回未授权（${MARKERS.auth[0]}）——网页端 Token 很可能已过期` }
  }
  return { code: 'failed', ok: false, message: `退出码 ${stage.exitCode}，且没有完成标记——原因需看输出` }
}

/**
 * Whole-chain verdict from the stage list.
 * @param {object[]} stages - stage reports in order.
 * @returns {{ ok: boolean, failedStage: string|null, reason: string }}
 */
export function chainVerdict(stages) {
  const bad = stages.find((s) => !s.ok)
  if (bad === undefined) return { ok: true, failedStage: null, reason: '全部阶段完成' }
  return { ok: false, failedStage: bad.stage, reason: `${bad.stage}：${bad.message}` }
}

/** Default look-back window used to count what a fetch round actually wrote. */
export const CHAIN_STAGES = ['token', 'recon', 'fetch', 'process', 'doctor']
