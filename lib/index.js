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
 *   POST /doctor      → run `<kbDir>/tools/kb.mjs doctor`
 *   GET  /log?name=   → tail one log file below `<root>/sync/logs`
 *
 * @module dsh-kb-sync
 */

import { existsSync, readFileSync, readdirSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { renderPage } from './page.js'

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
  const root = pick(c.root, process.env.DSH_KB_SYNC_ROOT, file.root)
  const syncScript = pick(c.syncScript, file.syncScript) ?? (root === null ? null : discoverSyncScript(root))
  const logDir = pick(c.logDir, file.logDir) ?? (root === null ? null : join(root, 'sync', 'logs'))
  const tokenFile = pick(c.tokenFile, file.tokenFile) ?? (root === null ? null : join(root, '.token'))
  const kbDir = pick(c.kbDir, file.kbDir) ?? (root === null ? null : resolve(root, '..', 'knowledge-base'))
  return {
    root,
    syncScript,
    logDir,
    tokenFile,
    kbDir,
    configFile,
    configFileUsed: Object.keys(file).length > 0,
    tokenOldDays: number(c.tokenOldDays, file.tokenOldDays) ?? 21,
    timeoutMs: number(c.timeoutMs, file.timeoutMs) ?? 60 * 60 * 1000,
    nodeBin: pick(c.nodeBin, file.nodeBin) ?? 'node',
    lastSyncFile: pick(c.lastSyncFile, file.lastSyncFile) ?? (root === null ? null : join(root, 'sync', 'LAST-SYNC.txt')),
  }
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
    configFile: { path: s.configFile, used: s.configFileUsed },
    paths: { root: s.root, syncScript: s.syncScript, kbDir: s.kbDir, logDir: s.logDir },
    lastResult: state.lastResult,
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
  const state = { running: false, startedAt: null, finishedAt: null, lastResult: null, runId: null }

  /** Log through the host logger; never fail a route because logging failed. */
  function log(message) {
    try {
      ctx.logger?.warn?.(`[dsh-kb-sync] ${message}`)
    } catch {
      /* logging must never break a request */
    }
  }

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

  /** Run `kb.mjs doctor` and return its output. */
  async function runDoctor() {
    if (settings.kbDir === null) return { ok: false, error: 'not-configured' }
    const tool = join(settings.kbDir, 'tools', 'kb.mjs')
    if (!existsSync(tool)) return { ok: false, error: 'kb-tool-missing', message: tool }
    const result = await spawnCollect([settings.nodeBin, tool, 'doctor'], settings.kbDir, 5 * 60 * 1000)
    if (result.error !== undefined) return { ok: false, error: result.error }
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: cap(result.stdout, DOCTOR_TEXT_BYTES),
      stderr: cap(result.stderr, 4 * 1024),
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
    req.resume?.() // drain any body so the connection can be reused

    try {
      if (sub === '/' || sub === '') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        const configured = settings.root === null
          ? `尚未配置 root。可写设置文件 ${settings.configFile}（形如 {"root":"..."}），或在 profile patch 里给 id: dsh-kb-sync 加 config.root，或设环境变量 DSH_KB_SYNC_ROOT。`
          : `root = ${settings.root}${settings.configFileUsed ? `（设置文件：${settings.configFile}）` : ''}`
        sendHtml(res, renderPage({ prefix: ROUTE_PREFIX, configured }))
        return
      }
      if (sub === '/status') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        sendJson(res, 200, collectStatus(settings, state))
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
