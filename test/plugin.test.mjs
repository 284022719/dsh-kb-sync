/**
 * Unit tests for dsh-kb-sync's host half.
 *
 * The host service seams are mocked, so these tests exercise the real routing,
 * guards, status assembly, log-tail guard and spawn spec without a running DSH.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, originAllowed, resolveSettings, collectStatus } from '../lib/index.js'

const PREFIX = '/__dsh-kb-sync'

/** Build a fixture pipeline root: sync script, LAST-SYNC, one log, a token file. */
function makeRoot({ tokenAgeDays = 3 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kb-sync-'))
  mkdirSync(join(root, 'sync', 'logs'), { recursive: true })
  writeFileSync(join(root, 'sync', 'sync-daily.cmd'), '@echo off\r\necho hello\r\n')
  writeFileSync(join(root, 'sync', 'LAST-SYNC.txt'), '2026-10-09 21:00:06  sync-ok\n2026-10-10 21:00:07  sync-ok\n')
  writeFileSync(join(root, 'sync', 'logs', 'sync-20261010.log'), 'line-1\nline-2\nline-3\n')
  const token = join(root, '.token')
  writeFileSync(token, 'x'.repeat(64))
  const when = new Date(Date.now() - tokenAgeDays * 86_400_000)
  utimesSync(token, when, when)
  const kbDir = join(root, '..', 'knowledge-base')
  mkdirSync(join(kbDir, 'tools'), { recursive: true })
  writeFileSync(join(kbDir, 'tools', 'kb.mjs'), '// fixture\n')
  return { root, kbDir }
}

/** A subprocess seam stub: records specs; `manual` keeps `done` pending until release(). */
function makeSubprocess({ exitCode = 0, stdout = 'sync worked\n', manual = false } = {}) {
  const specs = []
  let release = () => {}
  const done = manual
    ? new Promise((resolveDone) => {
        release = () => resolveDone({ exitCode, signal: null })
      })
    : Promise.resolve({ exitCode, signal: null })
  const subprocess = {
    spawn(spec) {
      specs.push(spec)
      return {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        },
        done,
        terminate() {},
        waitForExit: async () => true,
      }
    },
  }
  return { subprocess, specs, release }
}

/** Boot the plugin against a mock host and return a request helper. */
function boot({ root, kbDir, subprocess, config } = {}) {
  const routes = []
  const disposers = []
  const ctx = {
    logger: { warn() {} },
    get(key) {
      if (key === 'webServer') {
        return {
          register(route) {
            routes.push(route)
            return () => routes.splice(routes.indexOf(route), 1)
          },
        }
      }
      if (key === 'subprocess') return subprocess
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  }
  apply(ctx, config ?? { root, kbDir, nodeBin: 'node' })
  return {
    routes,
    disposers,
    get prefixRoute() {
      return routes.find((r) => r.kind === 'prefix')
    },
  }
}

/** Drive one request through the plugin's route handler. */
async function request(host, { method = 'GET', url, headers = {}, guard = true } = {}) {
  const route = host.prefixRoute
  assert.ok(route, 'the plugin must register its prefix route')
  const req = {
    method,
    url: url.startsWith('/') ? url : `${PREFIX}${url}`,
    headers: {
      host: '127.0.0.1:19387',
      'sec-fetch-site': 'same-origin',
      ...(guard ? { 'x-dsh-kb-sync': '1' } : {}),
      ...headers,
    },
    resume() {},
    on() {},
  }
  let body = ''
  let status = 0
  const res = {
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    set statusCode(value) {
      status = value
    },
    get statusCode() {
      return status
    },
    end(text) {
      body = text ?? ''
    },
  }
  await route.handler(req, res)
  let json = null
  try {
    json = JSON.parse(body)
  } catch {
    /* html responses are inspected as text */
  }
  return { status, body, json, headers: res.headers }
}

test('registers exactly one prefix route and disposes it', () => {
  const { root, kbDir } = makeRoot()
  const host = boot({ root, kbDir })
  assert.equal(host.routes.length, 1)
  assert.equal(host.routes[0].kind, 'prefix')
  assert.equal(host.routes[0].path, PREFIX)
  host.disposers.forEach((dispose) => dispose())
  assert.equal(host.routes.length, 0)
})

test('GET / serves the control page from the plugin prefix', async () => {
  const { root, kbDir } = makeRoot()
  const host = boot({ root, kbDir })
  const res = await request(host, { url: `${PREFIX}/` })
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/html/)
  assert.match(res.body, /dsh-kb-sync 控制页/)
  assert.match(res.body, /\/__dsh-kb-sync/)
  assert.equal(res.body.includes('<script src='), false)
})

test('status reports paths, token age from mtime, last sync and newest log', async () => {
  const { root, kbDir } = makeRoot({ tokenAgeDays: 25 })
  const host = boot({ root, kbDir })
  const { status, json } = await request(host, { url: `${PREFIX}/status` })
  assert.equal(status, 200)
  assert.equal(json.configured, true)
  assert.equal(json.paths.root, root)
  assert.equal(json.token.present, true)
  assert.equal(json.token.old, true)
  assert.ok(json.token.ageDays >= 24, `age ${json.token.ageDays}`)
  assert.deepEqual(json.lastSync.slice(-1), ['2026-10-10 21:00:07  sync-ok'])
  assert.equal(json.latestLog.name, 'sync-20261010.log')
  assert.match(json.latestLog.tail, /line-3/)
})

test('an unconfigured root reports a message instead of failing', async () => {
  const host = boot({ config: {} })
  const { status, json } = await request(host, { url: `${PREFIX}/status` })
  assert.equal(status, 200)
  assert.equal(json.configured, false)
  assert.match(json.message, /root/)
})

test('GET /log tails a named log and refuses traversal names', async () => {
  const { root, kbDir } = makeRoot()
  const host = boot({ root, kbDir })
  const ok = await request(host, { url: `${PREFIX}/log?name=sync-20261010.log` })
  assert.equal(ok.status, 200)
  assert.match(ok.json.tail, /line-2/)

  for (const name of ['../../etc/passwd', 'nested/path.log', 'log.txt/../../x', '']) {
    const bad = await request(host, { url: `${PREFIX}/log?name=${encodeURIComponent(name)}` })
    assert.equal(bad.status, 400, `name ${name} must be refused`)
  }
})

test('the same-origin guard rejects rebinding hosts, cross-site fetches and headerless writes', async () => {
  const { root, kbDir } = makeRoot()
  const host = boot({ root, kbDir, subprocess: makeSubprocess().subprocess })

  const rebind = await request(host, { url: `${PREFIX}/status`, headers: { host: 'evil.example' } })
  assert.equal(rebind.status, 403)

  const crossSite = await request(host, { url: `${PREFIX}/status`, headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.status, 403)

  const foreignOrigin = await request(host, { url: `${PREFIX}/status`, headers: { origin: 'https://evil.example' } })
  assert.equal(foreignOrigin.status, 403)

  const noHeader = await request(host, { method: 'POST', url: `${PREFIX}/run`, headers: { 'content-type': 'application/json' }, guard: false })
  assert.equal(noHeader.status, 403)

  assert.equal(originAllowed({ headers: { host: '127.0.0.1:19387' } }, false), true)
  assert.equal(originAllowed({ headers: { host: '127.0.0.1:19387' } }, true), false)
})

test('POST /run spawns the sync script with an explicit argv and no stdin', async () => {
  const { root, kbDir } = makeRoot()
  const sub = makeSubprocess({ stdout: 'segment 1 done\n', manual: true })
  const host = boot({ root, kbDir, subprocess: sub.subprocess })

  const started = await request(host, { method: 'POST', url: `${PREFIX}/run` })
  assert.equal(started.status, 202)
  assert.equal(started.json.ok, true)
  assert.equal(started.json.started, true)
  assert.equal(sub.specs.length, 1)
  assert.equal(sub.specs[0].stdio.stdin, 'ignore')
  assert.equal(sub.specs[0].cwd, root)
  assert.deepEqual(sub.specs[0].argv.slice(-1), [join(root, 'sync', 'sync-daily.cmd')])
  assert.ok(sub.specs[0].argv[0].startsWith(process.platform === 'win32' ? 'cmd' : '/'))

  const running = await request(host, { url: `${PREFIX}/status` })
  assert.equal(running.json.running, true)

  const second = await request(host, { method: 'POST', url: `${PREFIX}/run` })
  assert.equal(second.status, 409)
  assert.equal(second.json.error, 'already-running')

  sub.release()
  await new Promise((resolveTick) => setTimeout(resolveTick, 10))

  const finished = await request(host, { url: `${PREFIX}/status` })
  assert.equal(finished.json.running, false)
  assert.equal(finished.json.lastResult.ok, true)
  assert.equal(finished.json.lastResult.exitCode, 0)
  assert.match(finished.json.lastResult.tail, /segment 1 done/)
})

test('POST /doctor runs kb.mjs doctor and returns its output', async () => {
  const { root, kbDir } = makeRoot()
  const sub = makeSubprocess({ stdout: 'doctor: all good\n' })
  const host = boot({ root, kbDir, subprocess: sub.subprocess })
  const res = await request(host, { method: 'POST', url: `${PREFIX}/doctor` })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.match(res.json.stdout, /doctor: all good/)
  assert.equal(sub.specs[0].argv[1], join(kbDir, 'tools', 'kb.mjs'))
  assert.equal(sub.specs[0].argv[2], 'doctor')
})

test('unknown sub-paths 404 and wrong methods 405', async () => {
  const { root, kbDir } = makeRoot()
  const host = boot({ root, kbDir })
  assert.equal((await request(host, { url: `${PREFIX}/nope` })).status, 404)
  assert.equal((await request(host, { method: 'POST', url: `${PREFIX}/status` })).status, 405)
  assert.equal((await request(host, { url: `${PREFIX}/run` })).status, 405)
})

test('resolveSettings discovers the windows default script and honours overrides', () => {
  const { root } = makeRoot()
  const discovered = resolveSettings({ root })
  assert.equal(discovered.syncScript, join(root, 'sync', 'sync-daily.cmd'))
  assert.equal(discovered.kbDir, join(root, '..', 'knowledge-base'))

  const override = resolveSettings({ root, kbDir: join(root, 'kb-elsewhere'), tokenOldDays: 7 })
  assert.equal(override.kbDir, join(root, 'kb-elsewhere'))
  assert.equal(override.tokenOldDays, 7)

  assert.equal(resolveSettings({}).root, null)
})

test('collectStatus never reads the token file contents', () => {
  const { root, kbDir } = makeRoot()
  const settings = resolveSettings({ root, kbDir })
  const status = collectStatus(settings, { running: false, startedAt: null, lastResult: null })
  assert.equal(status.token.present, true)
  const serialized = JSON.stringify(status)
  assert.equal(serialized.includes('xxxxxxxx'), false, 'token content must never reach the response')
})
