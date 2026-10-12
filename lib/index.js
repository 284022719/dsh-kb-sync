/**
 * dsh-kb-sync — host half.
 *
 * Orchestrates a **pipeline the user already owns** — the author's is a
 * `sync/sync-daily.cmd` that pulls DeepSeek web history into a local knowledge
 * base — and reports its status from a same-origin page.
 *
 * Capability posture — the whole point of this plugin:
 *
 * - **No credentials.** The access token stays in the pipeline's own `.token`
 *   file. This plugin only `stat`s that file to report its age; it never reads
 *   its contents, and it never touches the DSH `credentials` service.
 * - **No network.** Every byte that leaves the machine leaves from the spawned
 *   pipeline. The plugin opens no socket of its own.
 * - **No prompt injection.** No prompt-section registration, no patch override of
 *   a `@deepseek-ai/*` core bundle, no install script.
 * - **Reads status, spawns one command.** File reads are limited to the log /
 *   state files below the configured root; the only write is in-memory state.
 *
 * Routes (same-origin, loopback-only; prefix `/__dsh-kb-sync`):
 *   GET  /            → the control page
 *   GET  /status      → status JSON (token age, last sync, latest log tail)
 *   POST /run         → start the sync command (409 while one is running)
 *   POST /doctor      → run the configured integrity-check command
 *   GET  /log?name=   → tail one log file below `<root>/sync/logs`
 *
 * @module dsh-kb-sync
 */

import { existsSync, readFileSync, readdirSync, openSync, readSync, closeSync, statSync, appendFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPage } from './page.js'
import { fetchHistory, listSessions, renderMarkdown, slugify, toRecord, ymd } from './deepseek.js'
import { downloadExport, readExport, triggerExport, waitForExport } from './export.js'
import { kbStatus, loadKb, readConversation, saveKb, searchKb, writeConversation } from './store.js'
import { askModel, buildUserMessage, clearOutbox, resolveRoute as resolveProcessRoute, writeOutbox } from './process.js'
import { MARKERS, chainVerdict, classifyStage } from './pipeline.js'

/**
 * 插件自己的根目录（由本文件位置推出）。
 *
 * 用途：让数据与配置**默认就住在插件文件夹内** —— `data/kb/` 放知识库、`config.json` 放配置。
 * 于是"这个插件"就是一个可整包拷走的目录，不必把数据散到别处，也不会跟别的脚本抢同一个知识库。
 */
export const PLUGIN_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Stable Cordis plugin name (must match the `cordis.patch.yml` id). */
export const name = 'dsh-kb-sync'

/** The HTTP carrier is the only hard dependency; `subprocess` is read via `ctx.get`. */
export const inject = ['webServer']

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = '/__dsh-kb-sync'

/** Largest log tail returned to the browser. */
const LOG_TAIL_BYTES = 16 * 1024

/** Largest child stdout kept in memory per run. */
const CHILD_STDOUT_BYTES = 4 * 1024 * 1024

/** Largest child stderr kept in memory per run. */
const CHILD_STDERR_BYTES = 1024 * 1024

/** Largest text returned from the doctor action. */
const DOCTOR_TEXT_BYTES = 32 * 1024

/** A log file name we are willing to open: no separators, no traversal. */
const LOG_NAME_RE = /^[A-Za-z0-9._-]{1,120}$/

/** The custom header a mutating request must carry (cross-site forms cannot set it). */
const GUARD_HEADER = 'x-dsh-kb-sync'

/**
 * The default settings file: `$DSH_HOME/.dsh-kb-sync.json` (`~/.dsh/...` when
 * `DSH_HOME` is unset).
 *
 * Why it exists: some DSH profiles rewrite their own `cordis.patch.yml` on
 * restart, which silently drops hand-written loader rows — a plugin configured
 * only there appears to "forget" its settings. A plain JSON file next to the
 * profile survives that, and needs no schema.
 * @returns {string} absolute path of the settings file.
 */
export function defaultConfigFile() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, '.dsh-kb-sync.json')
}

/**
 * Read the settings file, tolerating everything: a missing file, invalid JSON
 * or a non-object payload all resolve to `{}` (and are reported in `/status`).
 * @param {string} path - settings file path.
 * @returns {object} the parsed settings, or an empty object.
 */
export function readConfigFile(path) {
  try {
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Resolve the effective settings from the loader config, falling back to the
 * environment and then to the settings file.
 *
 * Precedence: loader `config` → environment (`DSH_KB_SYNC_ROOT`) → settings file
 * → built-in defaults. Every path is optional. When no root is configured the
 * plugin still loads and the page explains what to configure — it never guesses
 * a personal directory.
 * @param {unknown} config - the loader entry's `config` object.
 * @param {object} [io] - test seams.
 * @param {string} [io.configFile] - settings file to read.
 * @returns {object} resolved settings.
 */
export function resolveSettings(config, io = {}) {
  const c = config !== null && typeof config === 'object' ? config : {}
  const configFile = typeof c.configFile === 'string' && c.configFile !== '' ? resolve(c.configFile) : (io.configFile ?? defaultConfigFile())
  const file = readConfigFile(configFile)
  // 插件自带的配置：跟代码放一起，整包拷走时配置也跟着走。
  const localConfigFile = typeof c.localConfigFile === 'string' && c.localConfigFile !== '' ? resolve(c.localConfigFile) : (io.localConfigFile ?? join(PLUGIN_ROOT, 'config.json'))
  const local = readConfigFile(localConfigFile)
  const pick = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim() !== '') return resolve(value)
    }
    return null
  }
  const number = (...values) => {
    for (const value of values) {
      if (Number.isFinite(value) && value > 0) return value
    }
    return undefined
  }
  // 凭据名不是路径：不能走 pick（那会把它 resolve 成绝对路径）。
  const str = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    return null
  }
  const root = pick(c.root, process.env.DSH_KB_SYNC_ROOT, file.root, local.root)
  const syncScript = pick(c.syncScript, file.syncScript, local.syncScript) ?? (root === null ? null : discoverSyncScript(root))
  const logDir = pick(c.logDir, file.logDir, local.logDir) ?? (root === null ? null : join(root, 'sync', 'logs'))
  const tokenFile = pick(c.tokenFile, file.tokenFile, local.tokenFile) ?? (root === null ? null : join(root, '.token'))
  // 知识库默认落在插件自己的 data/kb —— 不与别的脚本共用目录，也不需要任何配置。
  // 体检目录（`kbDir`）默认就是知识库目录本身：迁移后 `knowledge-base` 已经并入插件文件夹。
  const outDir = pick(c.outDir, process.env.DSH_KB_SYNC_OUT_DIR, file.outDir, local.outDir) ?? join(PLUGIN_ROOT, 'data', 'kb')
  const kbDir = pick(c.kbDir, file.kbDir, local.kbDir) ?? outDir
  // The integrity check is a plain command, not a hard dependency on one
  // project's script: any executable that takes arguments works here.
  const doctorScript = pick(c.doctorScript, file.doctorScript, local.doctorScript) ?? join(kbDir, 'tools', 'kb.mjs')
  const doctorArgs = stringList(c.doctorArgs) ?? stringList(file.doctorArgs) ?? stringList(local.doctorArgs) ?? ['doctor']
  return {
    root,
    doctorScript,
    doctorArgs,
    // —— 网页端拉取相关的设置 ——
    tokenRef: str(c.tokenRef, file.tokenRef, local.tokenRef) ?? 'DEEPSEEK_WEB_TOKEN',
    outDir,
    exportAttempts: number(c.exportAttempts, file.exportAttempts, local.exportAttempts) ?? 30,
    exportIntervalMs: number(c.exportIntervalMs, file.exportIntervalMs, local.exportIntervalMs) ?? 5000,
    fetchImpl: typeof c.fetchImpl === 'function' ? c.fetchImpl : globalThis.fetch,
    syncScript,
    logDir,
    tokenFile,
    kbDir,
    configFile,
    configFileUsed: Object.keys(file).length > 0,
    localConfigFile,
    localConfigUsed: Object.keys(local).length > 0,
    tokenOldDays: number(c.tokenOldDays, file.tokenOldDays, local.tokenOldDays) ?? 21,
    timeoutMs: number(c.timeoutMs, file.timeoutMs, local.timeoutMs) ?? 60 * 60 * 1000,
    nodeBin: pick(c.nodeBin, file.nodeBin, local.nodeBin) ?? 'node',
    lastSyncFile: pick(c.lastSyncFile, file.lastSyncFile, local.lastSyncFile) ?? (root === null ? null : join(root, 'sync', 'LAST-SYNC.txt')),
    // —— 阶段 2：管线代码目录、段 2 的判断模型、单次生成的 token 上限 ——
    // pipelineDir 默认按插件自身布局推出来（tools/pipeline），也可以显式配置或走环境变量。
    pipelineDir: pick(c.pipelineDir, process.env.DSH_PIPELINE_DIR, file.pipelineDir, local.pipelineDir) ?? join(PLUGIN_ROOT, 'tools', 'pipeline'),
    processProvider: str(c.processProvider, file.processProvider, local.processProvider),
    processModel: str(c.processModel, file.processModel, local.processModel),
    processMaxTokens: number(c.processMaxTokens, file.processMaxTokens, local.processMaxTokens) ?? 4096,
    // 整链的新鲜度闸门：距上次成功不足这个时长就跳过（登录补跑用；页面按钮可 force）。
    chainMinIntervalMs: number(c.chainMinIntervalMs, file.chainMinIntervalMs, local.chainMinIntervalMs) ?? 6 * 60 * 60 * 1000,
  }
}

/**
 * Coerce a config value into a list of non-empty argument strings.
 * @param {unknown} value - candidate value (array or single string).
 * @returns {string[]|null} the list, or null when the value cannot supply one.
 */
function stringList(value) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null
  if (source === null) return null
  const list = source.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => String(item))
  return list.length > 0 ? list : null
}

/**
 * First existing sync script below the root, so the Windows default is not
 * hard-coded into a published plugin.
 * @param {string} root - the pipeline root.
 * @returns {string} the script path to use (existence is re-checked before running).
 */
function discoverSyncScript(root) {
  const candidates = [
    join(root, 'sync', 'sync-daily.cmd'),
    join(root, 'sync', 'sync-daily.ps1'),
    join(root, 'sync', 'sync-daily.sh'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

/** Read the last `maxBytes` of a file as UTF-8 text, without loading the whole file. */
export function readTail(path, maxBytes) {
  const size = statSync(path).size
  const start = Math.max(0, size - maxBytes)
  const length = size - start
  if (length === 0) return ''
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = readSync(fd, buffer, 0, length, start)
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** Newest file in a directory by mtime, or null when the directory is absent/empty. */
function newestFile(dir) {
  if (dir === null || !existsSync(dir)) return null
  let best = null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    let info
    try {
      info = statSync(path)
    } catch {
      continue
    }
    if (best === null || info.mtimeMs > best.mtimeMs) best = { name: entry.name, path, mtime: info.mtimeMs, bytes: info.size }
  }
  return best
}

/** Whether a hostname names this machine's loopback interface. */
function isLoopbackName(hostname) {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
}

/** Extract the hostname of the request's Host header without trusting it. */
function requestHostname(req) {
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  if (host === '') return ''
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? '' : host.slice(1, end)
  }
  return host.split(':')[0]
}

/**
 * Same-origin guard. Three independent checks:
 *
 * 1. the Host header must be loopback — otherwise a hostile domain resolving to
 *    127.0.0.1 could drive this plugin through the victim's browser (DNS rebinding);
 * 2. `Sec-Fetch-Site`, when the browser sends it, must be same-origin/none;
 * 3. an `Origin`, when present, must be loopback too;
 * 4. mutating requests must carry the plugin's own header (`GUARD_HEADER`).
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {boolean} mutating - whether this request may change state.
 * @returns {boolean} true when the request may proceed.
 */
export function originAllowed(req, mutating) {
  if (!isLoopbackName(requestHostname(req))) return false
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== '' && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (!isLoopbackName(new URL(origin).hostname)) return false
    } catch {
      return false
    }
  }
  if (mutating && req.headers[GUARD_HEADER] !== '1') return false
  return true
}

/** Send a JSON response with no-store caching. */
function sendJson(res, status, payload) {
  const text = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(text)
}

/** Send the HTML control page. */
function sendHtml(res, html) {
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'")
  res.end(html)
}

/** Truncate a string to a byte budget (UTF-8 safe enough for diagnostics). */
function cap(text, maxBytes) {
  if (text.length <= maxBytes) return text
  return text.slice(text.length - maxBytes)
}

/** Read a text file, or '' when it is absent — the inbox files are all optional. */
function readTextFile(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Everything the page needs, assembled from file metadata and in-memory state.
 * @param {object} s - resolved settings.
 * @param {object} state - the plugin instance's runtime state.
 * @returns {object} the status payload.
 */
export function collectStatus(s, state) {
  const configured = Boolean(s.syncScript !== null && existsSync(s.syncScript))
  const status = {
    ok: true,
    configured,
    running: state.running,
    runningSince: state.running ? state.startedAt : null,
    configFile: { path: s.configFile, used: s.configFileUsed, localPath: s.localConfigFile, localUsed: s.localConfigUsed },
    paths: { root: s.root, syncScript: s.syncScript, kbDir: s.kbDir, outDir: s.outDir, logDir: s.logDir, pipelineDir: s.pipelineDir },
    lastResult: state.lastResult,
    // 阶段 2：段 2 的进度（内存态，重启即清空）。模型名不是凭据，可以照实回。
    process: {
      running: Boolean(state.processing),
      startedAt: state.processStartedAt,
      finishedAt: state.processFinishedAt,
      phase: state.processPhase,
      log: state.processLog ?? [],
      result: state.lastProcess ?? null,
      // 2026-10-12 加：这一轮模型是怎么结束的（stop / max-tokens / threw / …）。
      // 空输出失败时**这是唯一能区分**"被 maxTokens 截断"与"提供方直接失败"的字段，
      // 而它此前只写在 lastProcess 里、状态页要翻 JSON 才看得到。照实回（不是凭据）。
      finishKind: state.lastProcess?.finishKind ?? null,
      maxTokens: s.processMaxTokens,
      provider: s.processProvider,
      model: s.processModel,
      route: state.processRoute ?? null,
    },
    // 阶段 3：整链的逐段结果与耗时（页面「一键整链」用这份）。
    chain: {
      running: Boolean(state.chaining),
      startedAt: state.chainStartedAt,
      phase: state.chainPhase,
      stages: state.chainStages ?? [],
      report: state.chainReport ?? null,
    },
  }
  if (s.root === null) {
    status.message = `尚未配置 root。三种配法任选其一：① 在本 profile 的 cordis.patch.yml 里给 id: dsh-kb-sync 加 config.root；② 设置环境变量 DSH_KB_SYNC_ROOT；③ 写设置文件 ${s.configFile}（形如 {"root":"..."}，重启不丢）。`
  } else if (!configured) {
    status.message = '找不到同步脚本；可用 config.syncScript 或设置文件里的 syncScript 显式指定。'
  }

  // Token age from the file's mtime only — the contents are never read here.
  if (s.tokenFile !== null) {
    let present = false
    let ageDays = null
    try {
      const info = statSync(s.tokenFile)
      present = true
      ageDays = Math.floor((Date.now() - info.mtimeMs) / 86_400_000)
    } catch {
      present = false
    }
    status.token = {
      file: s.tokenFile,
      present,
      ageDays,
      thresholdDays: s.tokenOldDays,
      old: present && ageDays !== null && ageDays >= s.tokenOldDays,
    }
  }

  if (s.lastSyncFile !== null && existsSync(s.lastSyncFile)) {
    try {
      status.lastSync = readTail(s.lastSyncFile, 8 * 1024).trim().split(/\r?\n/).slice(-8)
    } catch {
      status.lastSync = []
    }
  }

  const latest = newestFile(s.logDir)
  if (latest !== null) {
    status.latestLog = { name: latest.name, mtime: latest.mtime, bytes: latest.bytes, tail: readTail(latest.path, LOG_TAIL_BYTES) }
  }
  // 知识库现状与本轮拉取状态（不含任何凭据内容）。
  status.pulling = state.pulling
  status.lastPull = state.lastPull
  status.backfilling = state.backfilling
  status.backfill = state.backfill
  status.kb = s.outDir === null ? null : kbStatus(s.outDir)
  return status
}

/**
 * The plugin body: one prefix route dispatching the actions.
 * @param {object} ctx - host context.
 * @param {unknown} [config] - the loader entry's config object.
 */
export function apply(ctx, config) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  const settings = resolveSettings(config)
  const state = { running: false, startedAt: null, finishedAt: null, lastResult: null, runId: null, pulling: false, pullStartedAt: null, lastPull: null, backfilling: false, backfill: null, processing: false, processStartedAt: null, processFinishedAt: null, processPhase: null, processLog: [], lastProcess: null, processRoute: null, chaining: false, chainStartedAt: null, chainStages: [], chainLog: [], chainReport: null, chainPhase: null }

  /** Log through the host logger; never fail a route because logging failed. */
  function log(message) {
    try {
      ctx.logger?.warn?.(`[dsh-kb-sync] ${message}`)
    } catch {
      /* logging must never break a request */
    }
  }

  /**
   * Tell the *scheduled task* where the pipeline really lives.
   *
   * The task runs `<source>\tools\pipeline\trigger.cmd`, but the plugin may be
   * loaded from the installed snapshot (`<profile>\node_modules\dsh-kb-sync\…`),
   * and those are different directories (2026-10-12: the trigger file landed in
   * the snapshot while the `.cmd` looked in the source tree).
   *
   * Two copies, and the `.cmd` treats them as **candidates**: it only trusts one
   * whose `pipelineDir` actually contains a `trigger.json`, so whichever copy is
   * stale or written by a throwaway instance (a test run with a temp data dir
   * clobbered the source copy on 2026-10-12) cannot break the nightly run.
   */
  function writeTriggerHint() {
    if (settings.pipelineDir === null || settings.root === null) return
    const payload = `${JSON.stringify({ dataDir: settings.root, pipelineDir: settings.pipelineDir, pluginRoot: PLUGIN_ROOT, note: 'trigger.cmd 只信 pipelineDir 里真存在 trigger.json 的那一份；指错了就改这里或 config.pipelineDir' }, null, 1)}\n`

    // ① 插件自己所在的那份（运行时通常就是安装快照）—— 可靠的一份。
    try {
      writeFileSync(join(settings.pipelineDir, 'trigger-source.json'), payload, 'utf8')
    } catch {
      /* 写不成不影响链路 */
    }

    // ② 源码目录那份（计划任务实际跑的是它里面的 trigger.cmd）。只让"从 profile
    // 安装目录加载"的实例写：从仓库直接加载的实例（测试、临时 fixture）没有资格
    // 覆盖这份生产提示 —— 2026-10-12 实测：`node --test` 会把 %TEMP%\kb-sync-<rand>
    // 写进去，而计划任务读的正是这个文件。
    if (/[\\/]node_modules[\\/]/.test(PLUGIN_ROOT)) {
      try {
        writeFileSync(join(resolve(PLUGIN_ROOT, '..'), 'tools', 'pipeline', 'trigger-source.json'), payload, 'utf8')
      } catch {
        /* 源码目录不存在也正常（插件被拷到别处）：那就不写 */
      }
    }
  }
  writeTriggerHint()

  /** Spawn one command through the subprocess seam and collect its output. */
  async function spawnCollect(argv, cwd, timeoutMs) {
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) return { error: 'subprocess-unavailable' }
    const handle = subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: CHILD_STDOUT_BYTES },
        stderr: { maxBytes: CHILD_STDERR_BYTES },
      },
      graceMs: timeoutMs,
    })
    const outcome = await handle.done
    const stdout = handle.collected?.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected?.stderr?.readFrom(0).text ?? ''
    return { exitCode: outcome.exitCode, signal: outcome.signal, stdout, stderr }
  }

  /** The argv for the configured sync script, without any shell interpolation. */
  function syncArgv() {
    if (process.platform === 'win32') return ['cmd.exe', '/c', settings.syncScript]
    const lower = settings.syncScript.toLowerCase()
    if (lower.endsWith('.ps1')) return ['pwsh', '-NoProfile', '-File', settings.syncScript]
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) return ['cmd.exe', '/c', settings.syncScript]
    return ['/bin/sh', settings.syncScript]
  }

  /** Start the sync command; refuse a second concurrent run. */
  function startSync() {
    if (state.running) return { ok: false, error: 'already-running' }
    if (settings.syncScript === null || !existsSync(settings.syncScript)) {
      return { ok: false, error: 'sync-script-missing', message: settings.syncScript ?? '未配置' }
    }
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) return { ok: false, error: 'subprocess-unavailable' }

    const runId = randomUUID()
    state.running = true
    state.startedAt = Date.now()
    state.runId = runId
    let handle
    try {
      handle = subprocess.spawn({
        argv: syncArgv(),
        cwd: settings.root ?? '.',
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: CHILD_STDOUT_BYTES },
          stderr: { maxBytes: CHILD_STDERR_BYTES },
        },
        graceMs: settings.timeoutMs,
      })
    } catch (error) {
      state.running = false
      state.startedAt = null
      return { ok: false, error: 'spawn-failed', message: String(error?.message ?? error) }
    }

    handle.done.then(
      (outcome) => {
        state.lastResult = {
          runId,
          ok: outcome.exitCode === 0,
          exitCode: outcome.exitCode,
          signal: outcome.signal,
          finishedAt: Date.now(),
          tail: cap(handle.collected?.stdout?.readFrom(0).text ?? '', LOG_TAIL_BYTES),
          stderr: cap(handle.collected?.stderr?.readFrom(0).text ?? '', 4 * 1024),
        }
      },
      (error) => {
        state.lastResult = {
          runId,
          ok: false,
          exitCode: null,
          signal: null,
          finishedAt: Date.now(),
          tail: '',
          stderr: `子进程失败：${String(error?.message ?? error)}`,
        }
      },
    ).finally(() => {
      state.running = false
      state.finishedAt = Date.now()
    })

    log(`sync started (run ${runId})`)
    return { ok: true, started: true, runId, startedAt: state.startedAt }
  }

  /** Run the configured integrity-check command and return its output. */
  async function runDoctor() {
    if (settings.doctorScript === null) return { ok: false, error: 'not-configured' }
    if (!existsSync(settings.doctorScript)) return { ok: false, error: 'doctor-script-missing', message: settings.doctorScript }
    const cwd = settings.kbDir ?? resolve(settings.doctorScript, '..')
    const result = await spawnCollect([settings.nodeBin, settings.doctorScript, ...settings.doctorArgs], cwd, 5 * 60 * 1000)
    if (result.error !== undefined) return { ok: false, error: result.error }
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: cap(result.stdout, DOCTOR_TEXT_BYTES),
      stderr: cap(result.stderr, 4 * 1024),
    }
  }

  // ---- 整链编排（阶段 3：调度与通知也归插件） ----

  /**
   * When did the chain last succeed? Read from `LAST-SYNC.txt`, so the answer
   * survives a host restart — the point of this check is to skip a *redundant*
   * catch-up run (logon trigger) without skipping a needed one.
   *
   * ⚠️ The newest lines are written with an explicit UTC offset
   * (`2026-10-12T04:16:43+08:00`); older lines (the .cmd era) are naive local
   * time. Parsing the offset-less form as local is exactly what bit us on
   * 2026-10-12: the writer used `toISOString()` (UTC) while the reader assumed
   * local, so a run 3 minutes old looked 8 hours old and the gate let a
   * duplicate run through. New lines carry the offset, so neither side guesses.
   * @returns {{at: number, kase: string}|null} epoch ms of the newest status line.
   */
  function lastSuccessAt() {
    if (settings.lastSyncFile === null || !existsSync(settings.lastSyncFile)) return null
    try {
      const lines = readFileSync(settings.lastSyncFile, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '')
      for (let i = lines.length - 1; i >= 0; i--) {
        // 带偏移：2026-10-12T04:16:43+08:00 ；不带偏移（旧行）：2026-10-12 04:16:43
        const withOffset = lines[i].match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})\s+(\S+)/)
        if (withOffset !== null) {
          const at = Date.parse(`${withOffset[1]}T${withOffset[2]}${withOffset[3]}`)
          if (Number.isFinite(at)) return { at, kase: withOffset[4] }
          continue
        }
        const naive = lines[i].match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s+(\S+)/)
        if (naive === null) continue
        const at = Date.parse(`${naive[1]}T${naive[2]}`)
        if (Number.isFinite(at)) return { at, kase: naive[3] }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Run one chain stage, timing it and turning its exit code into a verdict.
   * @param {string} name - stage name shown on the page.
   * @param {(ctx: object) => Promise<object>} body - returns `{ exitCode, output, successMarkers?, authMarkers?, ...extra }`.
   * @returns {Promise<object>} the stage report.
   */
  async function stage(name, body) {
    const startedAt = Date.now()
    progress(name, '开始')
    let raw
    try {
      raw = await body()
    } catch (error) {
      raw = { exitCode: null, output: String(error?.message ?? error), crashed: true }
    }
    const verdict = classifyStage({
      exitCode: raw.exitCode,
      output: raw.output,
      successMarkers: raw.successMarkers,
      authMarkers: raw.authMarkers,
    })
    const report = {
      stage: name,
      ok: verdict.ok,
      code: verdict.code,
      message: verdict.message,
      exitCode: raw.exitCode ?? null,
      ms: Date.now() - startedAt,
      ...(raw.detail !== undefined ? { detail: raw.detail } : {}),
      ...(raw.tail !== undefined ? { tail: cap(raw.tail, 2000) } : {}),
    }
    progress(name, `${report.ok ? '✅' : '❌'} ${report.message}（${report.ms} ms）`)
    return report
  }

  /** Combine a stage's stdout and stderr for marker scanning and diagnostics. */
  const combined = (result) => `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  /**
   * The whole daily chain: token sanity → recon → fetch → judgement → doctor.
   *
   * Every stage is the pipeline's own script; only the judgement runs in
   * process (through the host `llm` service). The chain stops at the first hard
   * failure but always writes a status line, so the page and `LAST-SYNC.txt`
   * agree on what happened.
   * @param {object} [options] - `{ apply?: boolean, dryRun?: boolean }`.
   * @returns {Promise<object>} the chain report.
   */
  async function runChain(options = {}) {
    if (state.chaining) return { ok: false, error: 'already-running' }
    const files = pipelineFiles()
    if (!existsSync(files.reconScript) || !existsSync(files.fetchScript)) {
      return { ok: false, error: 'pipeline-missing', message: `找不到段 1 脚本（${files.dir}）` }
    }
    const apply = options.apply !== false

    // 新鲜度闸门：登录后的补跑会与 21:00 的正跑重叠，而 fetch 每跑一次都会
    // 重写 catalog/jsonl 并轮转备份。刚成功过就跳过（页面按钮可用 force 绕过）。
    if (options.force !== true) {
      const last = lastSuccessAt()
      if (last !== null && Date.now() - last.at < settings.chainMinIntervalMs) {
        const minutes = Math.round((Date.now() - last.at) / 60000)
        const message = `${minutes} 分钟前刚成功跑过（阈值 ${Math.round(settings.chainMinIntervalMs / 60000)} 分钟），本轮跳过以免重复拉取与备份轮转。`
        progress('skip', message)
        state.chainReport = { ok: true, skipped: 'fresh', reason: message, stages: [], warnings: [], ms: 0, finishedAt: Date.now() }
        state.chainPhase = 'done'
        return state.chainReport
      }
    }

    state.chaining = true
    state.chainStartedAt = Date.now()
    state.chainStages = []
    state.chainLog = []
    state.processLog = []
    state.chainPhase = 'token'
    try {
      const stages = []

      // ① token：老的 .cmd 检查，同样只看"在不在 + 多老"，不读内容。
      const tokenStage = await stage('token', async () => {
        if (settings.tokenFile === null) return { exitCode: 1, output: '未配置 tokenFile' }
        if (!existsSync(settings.tokenFile)) {
          return { exitCode: 1, output: `token 文件不存在：${settings.tokenFile}`, detail: { file: settings.tokenFile, present: false } }
        }
        const info = statSync(settings.tokenFile)
        const ageDays = Math.floor((Date.now() - info.mtimeMs) / 86_400_000)
        const old = ageDays >= settings.tokenOldDays
        return {
          exitCode: 0,
          output: `token 存在于 ${settings.tokenFile}，${ageDays} 天前更新（阈值 ${settings.tokenOldDays} 天）`,
          successMarkers: ['token 存在于'],
          detail: { file: settings.tokenFile, present: true, ageDays, thresholdDays: settings.tokenOldDays, old },
        }
      })
      stages.push(tokenStage)
      if (!tokenStage.ok) return finishChain(stages, { failedAt: 'token' })

      // ② recon：只读侦察
      const reconStage = await stage('recon', async () => {
        const run = await runPipelineScript(files.reconScript, ['1'], files.dir)
        return {
          exitCode: run.error !== undefined ? null : run.exitCode,
          output: combined(run),
          successMarkers: MARKERS.recon,
          authMarkers: MARKERS.auth,
          tail: combined(run),
        }
      })
      stages.push(reconStage)

      // ②b recon 失败只对"鉴权"与"未知"两种情形硬停；"完成后崩溃"已被 classifyStage 判成 ok。
      if (!reconStage.ok) return finishChain(stages, { failedAt: 'recon' })

      // ③ fetch：真正落盘的一步
      const fetchStage = await stage('fetch', async () => {
        const run = await runPipelineScript(files.fetchScript, [], files.dir)
        return {
          exitCode: run.error !== undefined ? null : run.exitCode,
          output: combined(run),
          successMarkers: MARKERS.update,
          authMarkers: MARKERS.auth,
          tail: combined(run),
        }
      })
      stages.push(fetchStage)
      if (!fetchStage.ok) return finishChain(stages, { failedAt: 'fetch' })

      // ④ judgement：模型 + 校验 + 应用 + 重建（与 /process 同一条实现）
      // 整链模式下抑制它的阶段日志：chainStages 已经逐段记了时间与结论，两份日志只会互相干扰。
      state.quietProgress = true
      let judgement
      try {
        judgement = await runProcess({ apply, echo: false })
      } finally {
        state.quietProgress = false
      }
      // 段 2 有三种结果，页面必须能分清（2026-10-12 实测：把"无事可做"渲染成
      // "归类 0/健康 0" 是**假计数** —— 看起来像"跑了但没结果"，其实压根没调模型）：
      //   ① skipped  —— 本轮没有新增/续聊、也没有摘要，不调用模型（不耗额度）
      //   ② 正常完成 —— 有 counts，并按 apply 区分"已落盘并重建" / "仅校验"
      //   ③ 失败     —— 带 error 与 message
      const judgementStage = {
        stage: 'process',
        ok: judgement.ok,
        code: judgement.ok ? (judgement.skipped ? 'skipped' : 'ok') : (judgement.error ?? 'failed'),
        message: judgement.ok
          ? judgement.skipped
            ? `本轮无事可做，未调用模型：${judgement.message ?? judgement.skipped}`
            : `归类 ${judgement.counts?.assignments ?? 0} / 健康 ${judgement.counts?.facts ?? 0} / 财务候选 ${judgement.counts?.candidates ?? 0} / 专题建议 ${judgement.counts?.suggestions ?? 0}${judgement.applied ? '（已落盘并重建）' : '（仅校验，未落盘）'}`
          : `${judgement.error} — ${String(judgement.message ?? '').slice(0, 300)}`,
        exitCode: judgement.ok ? 0 : 1,
        ms: judgement.ms ?? 0,
        detail: judgement.counts ?? (judgement.skipped !== undefined ? { skipped: judgement.skipped } : null),
      }
      stages.push(judgementStage)
      progress('process', `${judgementStage.ok ? '✅' : '❌'} ${judgementStage.message}（${judgementStage.ms} ms）`)

      // ⑤ doctor：只报警，不让整链失败
      const doctorStage = await stage('doctor', async () => {
        const run = await runDoctor()
        return {
          exitCode: run.error !== undefined ? null : run.exitCode,
          output: cap(`${run.stdout ?? ''}\n${run.stderr ?? ''}`, 4000),
          // doctor 的"成功"就是退出码 0；这里**故意不给** successMarkers：
          // 知识库体检失败只是警告，由 finishChain 记进 warnings，不改整链结论。
          detail: { warnOnly: true },
        }
      })
      stages.push(doctorStage)
      if (!doctorStage.ok) {
        doctorStage.code = 'warn'
        progress('doctor', `⚠️ 体检未通过（不影响整链）：${String(doctorStage.tail ?? '').slice(-200)}`)
      }

      return finishChain(stages, { failedAt: null })
    } catch (error) {
      log(`chain failed: ${String(error?.stack ?? error)}`)
      return finishChain(state.chainStages ?? [], { failedAt: 'internal', message: String(error?.message ?? error).slice(0, 300) })
    } finally {
      state.chaining = false
    }
  }

  /** Write the chain outcome into `LAST-SYNC.txt` and keep it for the page. */
  function finishChain(stages, { failedAt, message }) {
    const verdict = failedAt === null ? chainVerdict(stages.filter((s) => s.code !== 'warn')) : { ok: false, failedStage: failedAt, reason: message ?? `${failedAt} 阶段失败` }
    const warnings = stages.filter((s) => s.code === 'warn').map((s) => `${s.stage}：${s.message}`)
    const report = {
      ok: verdict.ok,
      startedAt: state.chainStartedAt,
      finishedAt: Date.now(),
      ms: Date.now() - (state.chainStartedAt ?? Date.now()),
      stages,
      failedStage: verdict.failedStage,
      reason: verdict.reason,
      warnings,
      // 与旧 notify.ps1 的文案一一对应，页面与可选气泡共用同一句话。
      notify: chainNotify(verdict, stages),
    }
    state.chainReport = report
    state.chainStages = stages
    state.chainPhase = 'done'
    writeStatusLine(report)
    return report
  }

  /**
   * Same wording the retired `notify.ps1` used, so the page says exactly what
   * the desktop bubble used to say (and a bubble can re-use it verbatim).
   * @param {{ok: boolean, failedStage: string|null, reason: string}} verdict - chain verdict.
   * @param {object[]} stages - stage reports.
   * @returns {{ case: string, title: string, level: string, body: string }}
   */
  function chainNotify(verdict, stages) {
    const tokenStage = stages.find((s) => s.stage === 'token')
    const failed = stages.find((s) => s.stage === verdict.failedStage)
    if (verdict.ok) {
      const process = stages.find((s) => s.stage === 'process')
      return {
        case: 'sync-ok',
        title: '对话知识库：同步成功',
        level: 'info',
        body: `整链完成（${Math.round((Date.now() - (state.chainStartedAt ?? Date.now())) / 1000)} 秒）。${process?.message ?? ''}`,
      }
    }
    if (verdict.failedStage === 'token' && tokenStage?.detail?.present === false) {
      return { case: 'token-missing', title: '对话知识库：找不到 Token', level: 'error', body: `token 文件不存在：${tokenStage.detail.file}` }
    }
    if (failed?.code === 'token-expired') {
      return { case: 'token-expired', title: '对话知识库：Token 可能已过期', level: 'warn', body: `${failed.stage} 阶段返回未授权，请重新从网页端取 Token 覆盖 ${settings.tokenFile ?? '(未配置)'}。` }
    }
    if (verdict.failedStage === 'process') {
      return { case: 'segment2-failed', title: '对话知识库：段 2 提炼失败', level: 'error', body: `抓取已完成，但判断/校验/重建出错：${verdict.reason}` }
    }
    if (verdict.failedStage === 'doctor') {
      return { case: 'kb-check-failed', title: '对话知识库：完整性检查未通过', level: 'warn', body: '知识库三份清单数量对不上或有悬空链接；运行体检看详情。' }
    }
    return { case: 'sync-failed', title: '对话知识库：同步失败', level: 'error', body: verdict.reason }
  }

  /**
   * Append the old-style status line (the page, the hub and humans all read it).
   *
   * Format kept identical to the retired `notify.ps1`: **local** wall-clock,
   * space-separated (`2026-10-12 04:17:34  sync-ok  ok`). This function's first
   * version used `toISOString()` (UTC) while the freshness gate parsed the time
   * as local — on a UTC+8 machine a 3-minute-old run then looked 8 hours old and
   * the gate let a duplicate run through (2026-10-12 实测). Both sides now use
   * local time, and the reader additionally accepts an explicit offset so a
   * hand-written line can never be misread.
   */
  function writeStatusLine(report) {
    if (settings.lastSyncFile === null) return
    try {
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      const line = `${stamp}  ${report.notify.case}  ${report.ok ? 'ok' : report.reason}`
      appendFileSync(settings.lastSyncFile, `${line}\n`, 'utf8')
    } catch (error) {
      log(`could not append to ${settings.lastSyncFile}: ${String(error?.message ?? error)}`)
    }
    // 顺带把"触发器"该往哪 POST 记下来：计划任务只读这个文件，不猜端口。
    // ⚠️ 这个文件只写到**插件自己所在的** tools\pipeline（运行时可能是安装快照那份）；
    // 而计划任务跑的是 D:\dsh 里可见的那份 trigger.cmd，它读同一目录下的
    // trigger-source.json（下面第 2 步在插件加载时就写好了）来找到这里。
    try {
      const port = ctx.get('webServer')?.port
      if (Number.isInteger(port) && port > 0 && settings.pipelineDir !== null) {
        writeFileSync(
          join(settings.pipelineDir, 'trigger.json'),
          `${JSON.stringify({ url: `http://127.0.0.1:${port}${ROUTE_PREFIX}/pipeline`, header: GUARD_HEADER, generatedAt: new Date().toISOString() }, null, 1)}\n`,
          'utf8',
        )
      }
    } catch {
      /* 触发器文件只是方便，写不成不影响链路 */
    }
  }

  // ---- 阶段 2：段 2 的判断改由宿主 llm 服务做（不再需要 dsh headless） ----

  /** Append one progress line and mirror it to the host log (quiet during the whole chain). */
  function progress(phase, message) {
    state.processPhase = phase
    if (state.quietProgress) return
    const line = `${new Date().toISOString().slice(11, 19)} [${phase}] ${message}`
    state.processLog.push(line)
    if (state.processLog.length > 60) state.processLog = state.processLog.slice(-60)
    log(`process ${line}`)
  }

  /**
   * Run one pipeline script through the host subprocess seam — the same path
   * the sync script already uses, so segment 2 inherits the host's process and
   * sandbox policy instead of spawning its own child.
   * @param {string} script - absolute script path.
   * @param {string[]} args - arguments after the script.
   * @param {string} cwd - working directory.
   * @returns {Promise<{ exitCode: number|null, stdout: string, stderr: string, error?: string }>}
   */
  async function runPipelineScript(script, args, cwd) {
    const result = await spawnCollect([settings.nodeBin, script, ...args], cwd, 15 * 60 * 1000)
    return {
      exitCode: result.exitCode ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      ...(result.error !== undefined ? { error: result.error } : {}),
    }
  }

  /** The pipeline's own script paths, all derived from `tools/pipeline`. */
  function pipelineFiles() {
    const dir = settings.pipelineDir
    const dataDir = settings.root ?? join(dir, '..', '..', 'data', 'import')
    return {
      dir,
      inbox: join(dataDir, 'sync', 'inbox'),
      out: join(dataDir, 'sync', 'out'),
      prepScript: join(dir, 'prep-inbox.mjs'),
      applyScript: join(dir, 'apply-extraction.mjs'),
      promptFile: join(dir, 'extract-prompt.md'),
      reconScript: join(dir, 'recon-update.mjs'),
      fetchScript: join(dir, 'update-from-api.mjs'),
      rebuild: [
        join(dir, 'apply-update-topics.mjs'),
        join(dir, 'build-kb.mjs'),
        join(dir, 'build-specialties.mjs'),
        join(dir, 'map-specialties.mjs'),
        join(dir, 'build-health-profile.mjs'),
        join(dir, 'sync-knowledge.mjs'),
      ],
    }
  }

  /**
   * Segment 2, in process: prepare inputs with the pipeline's own scripts, ask
   * the host model for one JSON judgement, write it where the apply step reads
   * it, validate it, and (optionally) apply + rebuild.
   *
   * The route awaits this, so a slow model shows up as a slow response rather
   * than a fire-and-forget that the page cannot see. `/status` carries
   * `process.phase` while it runs, which is what the page polls.
   * @param {object} options - `{ apply?: boolean }`.
   * @returns {Promise<object>} the round report, with `ms` elapsed.
   */
  async function runProcess(options = {}) {
    const startedAt = Date.now()
    const result = await runProcessInner(options)
    return { ...result, ms: Date.now() - startedAt }
  }

  /**
   * The body of {@link runProcess}; the wrapper only adds the elapsed time so
   * every return path (including the failures) reports how long it took.
   * @param {object} options - `{ apply?: boolean, echo?: boolean }`.
   * @returns {Promise<object>} the round report without `ms`.
   */
  async function runProcessInner(options = {}) {
    if (state.processing) return { ok: false, error: 'already-processing' }
    const llm = ctx.get('llm')
    if (llm === undefined) {
      return { ok: false, error: 'llm-unavailable', message: '宿主没有注册 llm 服务；无法在进程内做段 2 判断。' }
    }
    const files = pipelineFiles()
    if (!existsSync(files.prepScript) || !existsSync(files.promptFile)) {
      return {
        ok: false,
        error: 'pipeline-missing',
        message: `找不到管线脚本：${files.prepScript}（可用 config.pipelineDir 指定）`,
      }
    }

    const apply = options.apply !== false
    state.processing = true
    state.processStartedAt = Date.now()
    state.processFinishedAt = null
    state.processLog = []
    state.processPhase = 'init'
    try {
      progress('init', `pipeline=${files.dir} data=${settings.root ?? '(推导)'}`)

      const route = await resolveProcessRoute(llm, settings)
      if (route.error !== undefined) {
        state.lastProcess = { ok: false, error: route.error, message: route.message ?? route.error }
        progress('route', `失败：${route.error}${route.message ? ` — ${route.message}` : ''}`)
        return { ok: false, ...state.lastProcess }
      }
      state.processRoute = { provider: route.provider, model: route.model, source: route.source }
      progress('route', `${route.provider} / ${route.model}（${route.source === 'config' ? '来自配置' : '自动选择'}）`)

      progress('prep', '准备收件箱（复用管线自己的 prep-inbox.mjs）…')
      const prep = await runPipelineScript(files.prepScript, [], files.dir)
      if (prep.error !== undefined) {
        state.lastProcess = { ok: false, error: prep.error, message: `无法启动管线脚本：${prep.error}` }
        progress('prep', `失败：${prep.error}`)
        return { ok: false, ...state.lastProcess }
      }
      if (prep.exitCode !== 0 && !/收件箱已准备/.test(prep.stdout)) {
        state.lastProcess = { ok: false, error: 'prep-failed', message: cap(`${prep.stdout}\n${prep.stderr}`, 4000) }
        progress('prep', '失败')
        return { ok: false, ...state.lastProcess }
      }
      progress('prep', '收件箱就绪')

      const inputs = {
        itemsTsv: readTextFile(join(files.inbox, 'update-new-items.tsv')),
        topicKeysTsv: readTextFile(join(files.inbox, 'update-topic-keys.tsv')),
        specialtyKeysTsv: readTextFile(join(files.inbox, 'specialty-keys.tsv')),
        healthDigest: readTextFile(join(files.inbox, 'health-digest.md')),
        financeDigest: readTextFile(join(files.inbox, 'finance-digest.md')),
      }
      const itemLines = inputs.itemsTsv.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1
      progress('input', `本轮条目 ${itemLines}；健康摘要 ${inputs.healthDigest.length} 字；财务摘要 ${inputs.financeDigest.length} 字`)
      if (itemLines <= 0 && inputs.healthDigest === '' && inputs.financeDigest === '') {
        state.lastProcess = { ok: true, skipped: 'nothing-to-do', message: '本轮没有新增/续聊，也没有健康/财务摘要；不调用模型。' }
        progress('input', '没有可判断的内容，跳过（不消耗额度）')
        return state.lastProcess
      }

      clearOutbox(files.out)
      const system = readTextFile(files.promptFile)
      const user = buildUserMessage(inputs)
      progress('model', `调用 ${route.provider}/${route.model}（maxTokens=${settings.processMaxTokens}）…`)
      const asked = await askModel({
        llm,
        provider: route.provider,
        model: route.model,
        system,
        user,
        maxTokens: settings.processMaxTokens,
      })
      if (!asked.ok) {
        state.lastProcess = {
          ok: false,
          error: asked.error,
          message: asked.message,
          // finishKind：模型这一轮是怎么结束的（stop / max-tokens / error / aborted）。
          // 空输出时没它就分不清"被截断"和"提供方直接失败"（2026-10-12 实测踩过）。
          finishKind: asked.finishKind ?? null,
          raw: cap(asked.raw ?? '', 4000),
        }
        progress('model', `失败：${asked.error} — ${asked.message}`)
        return { ok: false, ...state.lastProcess }
      }
      progress('model', `收到 ${asked.raw.length} 字符；${asked.note || 'JSON 直接可解析'}`)

      const written = writeOutbox(files.out, asked.result)
      progress('outbox', `已写 ${written.join(', ')}`)

      const validation = await runPipelineScript(files.applyScript, ['--dry-run'], files.dir)
      const validationOk = /全部校验通过/.test(validation.stdout)
      progress('validate', validationOk ? '校验通过' : `校验未通过（exit ${validation.exitCode}）`)
      if (!validationOk) {
        state.lastProcess = {
          ok: false,
          error: validation.error ?? 'validation-failed',
          message: cap(`${validation.stdout}\n${validation.stderr}`, 6000),
          result: asked.result,
        }
        return { ok: false, ...state.lastProcess }
      }

      const report = {
        ok: true,
        route: state.processRoute,
        counts: {
          assignments: asked.result.assignments.length,
          facts: asked.result.facts.length,
          candidates: asked.result.candidates.length,
          suggestions: asked.result.suggestions.length,
        },
        applied: false,
        validation: cap(validation.stdout, 4000),
        summary: asked.result.summary,
      }

      if (apply) {
        const appliedRun = await runPipelineScript(files.applyScript, ['--apply'], files.dir)
        const appliedOk = /全部校验通过/.test(appliedRun.stdout)
        progress('apply', appliedOk ? '已落盘' : `落盘失败（exit ${appliedRun.exitCode}）`)
        if (!appliedOk) {
          state.lastProcess = { ok: false, error: appliedRun.error ?? 'apply-failed', message: cap(`${appliedRun.stdout}\n${appliedRun.stderr}`, 6000) }
          return { ok: false, ...state.lastProcess }
        }
        report.applied = true
        report.applyLog = cap(appliedRun.stdout, 4000)

        for (const script of files.rebuild) {
          const name = basename(script)
          const run = await runPipelineScript(script, [], files.dir)
          progress('rebuild', `${name} → exit ${run.exitCode}`)
          report.rebuild ??= []
          report.rebuild.push({ script: name, exitCode: run.exitCode, stderr: cap(run.stderr, 800) })
        }
      }

      state.lastProcess = report
      state.processFinishedAt = Date.now()
      progress('done', `完成：${JSON.stringify(report.counts)}${apply ? '（已应用并重建）' : '（dry-run，未落盘）'}`)
      return report
    } catch (error) {
      log(`process failed: ${String(error?.stack ?? error)}`)
      state.lastProcess = { ok: false, error: 'internal-error', message: String(error?.message ?? error).slice(0, 300) }
      state.processFinishedAt = Date.now()
      return { ok: false, ...state.lastProcess }
    } finally {
      state.processing = false
      state.processFinishedAt ??= Date.now()
    }
  }

  /** Tail one named log file, refusing anything outside `<logDir>`. */
  function readNamedLog(name) {
    if (settings.logDir === null) return { ok: false, error: 'not-configured' }
    if (typeof name !== 'string' || !LOG_NAME_RE.test(name) || name.includes('..')) {
      return { ok: false, error: 'invalid-name' }
    }
    const dir = resolve(settings.logDir)
    const target = resolve(dir, name)
    if (target !== join(dir, name) || !target.startsWith(dir + sep)) return { ok: false, error: 'invalid-name' }
    if (!existsSync(target)) return { ok: false, error: 'not-found', message: name }
    return { ok: true, name, tail: readTail(target, LOG_TAIL_BYTES) }
  }

  // ---- 网页端拉取：读凭据值 + 出网（能力披露里如实记为红线） ----

  /** 从任何要回给浏览器 / 写进日志的字符串里抹掉 token。 */
  const redactText = (text, token) => {
    const value = String(text ?? '')
    return token ? value.split(token).join('[token]') : value
  }

  /** 取一次 token：只在本次调用内使用，绝不写进响应、日志或文件。 */
  async function readToken() {
    const creds = ctx.get('credentials')
    if (creds === undefined) return { creds: null, token: '' }
    try {
      const resolved = await creds.resolve(settings.tokenRef)
      return { creds, token: resolved?.value ? String(resolved.value).trim().replace(/[\r\n]/g, '') : '' }
    } catch {
      return { creds, token: '' }
    }
  }

  /** token 配置状态：只说"配没配"，永不回值。 */
  async function tokenStatus() {
    const creds = ctx.get('credentials')
    if (creds === undefined) return { ok: true, available: false, ref: settings.tokenRef, configured: false }
    try {
      const info = await creds.describe(settings.tokenRef)
      return { ok: true, available: true, ref: settings.tokenRef, configured: Boolean(info?.configured), writable: Boolean(info?.writable) }
    } catch (error) {
      return { ok: false, available: true, ref: settings.tokenRef, configured: false, message: redactText(error?.message, null).slice(0, 200) }
    }
  }

  /** 保存 token（值只进凭据服务）。 */
  async function saveToken(raw) {
    const creds = ctx.get('credentials')
    if (creds === undefined) return { ok: false, error: 'credentials-unavailable' }
    const token = String(raw ?? '').trim().replace(/[\r\n]/g, '')
    if (token === '') return { ok: false, error: 'empty-token' }
    try {
      await creds.set(settings.tokenRef, token)
      log('token saved')
      return { ok: true }
    } catch (error) {
      // 凭据服务自己的报错可能带值，只记不转述。
      log(`saveToken failed: ${redactText(error?.message, token)}`)
      return { ok: false, error: 'save-failed' }
    }
  }

  /** 清除 token。 */
  async function clearToken() {
    const creds = ctx.get('credentials')
    if (creds === undefined) return { ok: false, error: 'credentials-unavailable' }
    try {
      await creds.unset(settings.tokenRef)
      log('token cleared')
      return { ok: true }
    } catch (error) {
      log(`clearToken failed: ${redactText(error?.message, null)}`)
      return { ok: false, error: 'clear-failed' }
    }
  }

  /** 读 JSON 请求体（限长；空体/坏 JSON → {}）。 */
  function readJsonBody(req) {
    return new Promise((resolveBody) => {
      const chunks = []
      let total = 0
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        resolveBody(value)
      }
      req.on?.('data', (chunk) => {
        if (settled) return
        total += chunk.length
        if (total > 64 * 1024) {
          finish({})
          req.destroy?.()
          return
        }
        chunks.push(chunk)
      })
      req.on?.('end', () => {
        if (settled) return
        const text = Buffer.concat(chunks).toString('utf8')
        if (text.trim() === '') return finish({})
        try {
          const parsed = JSON.parse(text)
          finish(parsed !== null && typeof parsed === 'object' ? parsed : {})
        } catch {
          finish({})
        }
      })
      req.on?.('error', () => finish({}))
    })
  }

  /**
   * 增量拉取：会话列表 → 只取"新增 / 续聊"的线程 → 规范化落盘。
   *
   * 为什么是增量：列表接口的游标在服务端失效（无论传什么都返回最新 100 条），
   * 所以"往后每天长"可靠、而"一次拉全量"必须走官方导出包（另一个阶段的事）。
   * @returns {Promise<object>} 本轮摘要（不含任何 token）。
   */
  async function runPull() {
    if (state.pulling) return { ok: false, error: 'already-pulling' }
    if (settings.outDir === null) return { ok: false, error: 'not-configured', message: '未配置知识库目录（config.outDir，或 config.root 推出来的 kbDir）' }
    const { creds, token } = await readToken()
    if (creds === null) return { ok: false, error: 'credentials-unavailable' }
    if (token === '') return { ok: false, error: 'no-token', message: `尚未保存 userToken（凭据名 ${settings.tokenRef}）` }

    state.pulling = true
    state.pullStartedAt = Date.now()
    const summary = { startedAt: state.pullStartedAt, listed: 0, added: 0, updated: 0, skipped: 0, errors: [], files: [] }
    try {
      const kb = loadKb(settings.outDir)
      const { sessions } = await listSessions({ token, fetchImpl: settings.fetchImpl })
      summary.listed = sessions.length

      const targets = []
      for (const session of sessions) {
        const local = kb.byId.get(session.id)
        if (!local) targets.push(session)
        else if (Number(session.updated_at) * 1000 > (Date.parse(local.rec.updated_at ?? 0) || 0) + 1000) targets.push(session)
        else summary.skipped += 1
      }

      const records = []
      for (const session of targets) {
        try {
          const biz = await fetchHistory({ token, sessionId: session.id, fetchImpl: settings.fetchImpl })
          records.push(toRecord(session, biz))
        } catch (error) {
          summary.errors.push({ id: session.id, title: String(session.title ?? '').slice(0, 80), message: redactText(error?.message, token).slice(0, 200) })
        }
      }

      mergeRecords(records, summary)
      summary.noChanges = summary.added + summary.updated === 0
      summary.finishedAt = Date.now()
      state.lastPull = summary
      log(`pull done: listed=${summary.listed} added=${summary.added} updated=${summary.updated} errors=${summary.errors.length}`)
      return { ok: true, ...summary }
    } catch (error) {
      const message = redactText(error?.message, token).slice(0, 300)
      state.lastPull = { ...summary, finishedAt: Date.now(), fatal: message }
      log(`pull failed: ${message}`)
      return { ok: false, error: 'pull-failed', message, status: error?.status ?? null }
    } finally {
      state.pulling = false
    }
  }

  /**
   * 把一批规范化记录并入知识库 —— 增量拉取与全量回填共用这一段，避免两条写路径各自漂移。
   *
   * 判定：本地没有 → added；本地有但新记录消息更多 → updated（就地更新、文件名保持不变）；否则 skipped。
   * @param {object[]} records - `{id,title,inserted_at,updated_at,messages,chars,models,turns}`。
   * @param {object} summary - 累加计数的摘要对象。
   * @returns {object} 同一个摘要对象。
   */
  function mergeRecords(records, summary) {
    const kb = loadKb(settings.outDir)
    let nextIdx = kb.catalog.reduce((max, row) => Math.max(max, Number(row.idx) || 0), -1) + 1
    const usedNames = new Set(kb.catalog.map((row) => String(row.path ?? '').split('/').pop().toLowerCase()))
    for (const record of records) {
      try {
        const local = kb.byId.get(record.id)
        const isNew = local === undefined
        if (!isNew && (record.messages?.length ?? 0) <= (local.rec.messages?.length ?? 0)) {
          summary.skipped += 1
          continue
        }
        let relPath
        if (!isNew && local.rec.file) {
          relPath = local.rec.file
        } else {
          const base = `${ymd(record.inserted_at)}-${slugify(record.title, 'untitled')}-${String(record.id).slice(0, 8)}`
          let name = `${base}.md`
          let i = 1
          while (usedNames.has(name.toLowerCase())) name = `${base}-${++i}.md`
          usedNames.add(name.toLowerCase())
          relPath = `conversations/${name}`
        }
        writeConversation(settings.outDir, relPath, renderMarkdown(record, record.messages))
        const catalogRow = {
          idx: isNew ? nextIdx++ : local.idx,
          id: record.id,
          title: record.title,
          date: ymd(record.inserted_at),
          inserted_at: record.inserted_at,
          updated_at: record.updated_at,
          turns: record.turns,
          messages: record.messages.length,
          chars: record.chars,
          models: record.models,
          path: relPath,
        }
        const row = { id: record.id, title: record.title, inserted_at: record.inserted_at, updated_at: record.updated_at, file: relPath, messages: record.messages }
        if (isNew) {
          kb.catalog.push(catalogRow)
          kb.recs.push(row)
          summary.added += 1
        } else {
          kb.catalog[local.idx] = catalogRow
          kb.recs[local.idx] = row
          summary.updated += 1
        }
        summary.files.push(relPath)
      } catch (error) {
        summary.errors.push({ id: record.id, title: String(record.title ?? '').slice(0, 80), message: String(error?.message ?? error).slice(0, 200) })
      }
    }
    if (summary.added + summary.updated > 0) saveKb(settings.outDir, { recs: kb.recs, catalog: kb.catalog })
    return summary
  }

  /**
   * 全量回填：走官方导出包（`export_all` → 轮询 → 下载 zip → 解析 → 并入）。
   *
   * 为什么在后台跑：服务端生成导出可能要几分钟，一个 HTTP 请求挂在那里等不合适。
   * 这里立即返回，进度写进 `state.backfill`（由 `/status` 报告阶段）。
   * @returns {Promise<object>} 启动结果（不是完成结果）。
   */
  async function runBackfill() {
    if (state.backfilling || state.pulling) return { ok: false, error: 'already-busy' }
    if (settings.outDir === null) return { ok: false, error: 'not-configured', message: '未配置知识库目录' }
    const { creds, token } = await readToken()
    if (creds === null) return { ok: false, error: 'credentials-unavailable' }
    if (token === '') return { ok: false, error: 'no-token', message: `尚未保存 userToken（凭据名 ${settings.tokenRef}）` }

    state.backfilling = true
    const progress = { startedAt: Date.now(), phase: 'trigger', attempts: 0, exportStatus: null, exportedAt: null, zipBytes: 0, exportConversations: 0, added: 0, updated: 0, skipped: 0, errors: [], files: [], fatal: null, finishedAt: null }
    state.backfill = progress

    void (async () => {
      try {
        progress.phase = 'trigger'
        await triggerExport({ token, fetchImpl: settings.fetchImpl })
        progress.phase = 'waiting-export'
        const ready = await waitForExport({
          token,
          fetchImpl: settings.fetchImpl,
          attempts: settings.exportAttempts,
          intervalMs: settings.exportIntervalMs,
          onProgress: (status) => {
            progress.attempts = status.attempt
            progress.exportStatus = status.status
          },
        })
        progress.exportedAt = ready.exportedAt
        progress.phase = 'downloading'
        const zipBytes = await downloadExport({ url: ready.url, fetchImpl: settings.fetchImpl })
        progress.zipBytes = zipBytes.length
        progress.phase = 'parsing'
        const { records } = readExport(zipBytes)
        progress.exportConversations = records.length
        progress.phase = 'merging'
        mergeRecords(records, progress)
        progress.phase = 'done'
        log(`backfill done: conversations=${records.length} added=${progress.added} updated=${progress.updated} skipped=${progress.skipped}`)
      } catch (error) {
        progress.fatal = redactText(error?.message, token).slice(0, 300)
        progress.phase = 'failed'
        log(`backfill failed: ${progress.fatal}`)
      } finally {
        progress.finishedAt = Date.now()
        state.backfilling = false
      }
    })()

    return { ok: true, started: true, startedAt: progress.startedAt }
  }

  /** One request → one action. */
  async function handle(req, res) {
    const url = new URL(req.url ?? ROUTE_PREFIX, 'http://localhost')
    const sub = url.pathname.slice(ROUTE_PREFIX.length) || '/'
    const method = req.method ?? 'GET'
    const mutating = method === 'POST'

    if (!originAllowed(req, mutating)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    // POST 的体在这里一次性读完（限长）；GET 不读。其它路由不需要体。
    const body = mutating ? await readJsonBody(req) : null

    try {
      if (sub === '/' || sub === '') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        // 语言：`?lang=` 优先，其次浏览器的 Accept-Language，都不认识就回落中文（源语言）。
        const lang = url.searchParams.get('lang') ?? req.headers['accept-language'] ?? ''
        sendHtml(
          res,
          renderPage({
            prefix: ROUTE_PREFIX,
            lang,
            root: settings.root,
            configFile: settings.configFile,
            configFileUsed: settings.configFileUsed,
          }),
        )
        return
      }
      if (sub === '/status') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        sendJson(res, 200, collectStatus(settings, state))
        return
      }
      if (sub === '/token') {
        if (method === 'GET') {
          sendJson(res, 200, await tokenStatus())
          return
        }
        if (method === 'POST') {
          const result = await saveToken(body?.token)
          sendJson(res, result.ok ? 200 : 400, result)
          return
        }
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (sub === '/token/clear') {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        const result = await clearToken()
        sendJson(res, result.ok ? 200 : 400, result)
        return
      }
      if (sub === '/pull') {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        const result = await runPull()
        sendJson(res, result.ok ? 200 : result.error === 'already-pulling' ? 409 : 400, result)
        return
      }
      if (sub === '/backfill') {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        const result = await runBackfill()
        sendJson(res, result.ok ? 202 : result.error === 'already-busy' ? 409 : 400, result)
        return
      }
      if (sub === '/conversation') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (settings.outDir === null) return sendJson(res, 400, { ok: false, error: 'not-configured' })
        const record = readConversation(settings.outDir, url.searchParams.get('id') ?? '')
        if (record === null) return sendJson(res, 404, { ok: false, error: 'not-found' })
        const markdown = renderMarkdown(record, record.messages ?? [])
        sendJson(res, 200, {
          ok: true,
          id: record.id,
          title: record.title,
          file: record.file,
          updated_at: record.updated_at,
          truncated: markdown.length > 400_000,
          markdown: markdown.length > 400_000 ? `${markdown.slice(0, 400_000)}\n\n…（已截断，完整原文见 ${record.file}）` : markdown,
        })
        return
      }
      if (sub === '/kb') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        sendJson(res, 200, {
          ok: true,
          ...(settings.outDir === null ? { dir: null } : kbStatus(settings.outDir)),
          pulling: state.pulling,
          lastPull: state.lastPull,
        })
        return
      }
      if (sub === '/search') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (settings.outDir === null) return sendJson(res, 400, { ok: false, error: 'not-configured' })
        const query = url.searchParams.get('q') ?? ''
        const role = url.searchParams.get('role') === 'user' ? 'user' : 'any'
        const rawLimit = Number(url.searchParams.get('limit') ?? 20)
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20
        sendJson(res, 200, { ok: true, query, role, ...searchKb(settings.outDir, { query, role, limit }) })
        return
      }
      if (sub === '/run') {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        const result = startSync()
        sendJson(res, result.ok ? 202 : result.error === 'already-running' ? 409 : 400, result)
        return
      }
      if (sub === '/doctor') {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        sendJson(res, 200, await runDoctor())
        return
      }
      if (sub === '/pipeline') {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        // 整链：token → recon → 抓取 → 判断/校验/落盘/重建 → 体检。
        // 页面按钮与计划任务都打这里（任务用 tools\pipeline\trigger.cmd 读端口后 POST）。
        // force:true 跳过"刚跑过就跳过"的新鲜度闸门（页面按钮用）。
        const result = await runChain({ apply: body?.apply === true, force: body?.force === true })
        sendJson(res, result.ok ? 200 : result.error === 'already-running' ? 409 : 400, result)
        return
      }
      if (sub === '/process') {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        // 默认 dry-run：模型与校验都跑，但不落盘。带 {"apply":true} 才应用并重建。
        const result = await runProcess({ apply: body?.apply === true })
        sendJson(res, result.ok ? 200 : result.error === 'already-processing' ? 409 : 400, result)
        return
      }
      if (sub === '/log') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        const result = readNamedLog(url.searchParams.get('name'))
        sendJson(res, result.ok ? 200 : result.error === 'invalid-name' ? 400 : 404, result)
        return
      }
      sendJson(res, 404, { ok: false, error: 'not-found' })
    } catch (error) {
      log(`route failed: ${sub} — ${String(error?.stack ?? error)}`)
      sendJson(res, 500, { ok: false, error: 'internal-error' })
    }
  }

  // `effect` ties the route to the plugin's fiber so a reload replaces it;
  // hosts without it still get the route (registration is what serves requests).
  const register = () => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: handle })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = register()
      return () => dispose()
    }, 'dsh-kb-sync: routes')
  } else {
    register()
  }
}
