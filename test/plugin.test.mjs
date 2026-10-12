/**
 * Unit tests for dsh-kb-sync's host half.
 *
 * The host service seams are mocked, so these tests exercise the real routing,
 * guards, status assembly, log-tail guard and spawn spec without a running DSH.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, originAllowed, resolveSettings, collectStatus, PLUGIN_ROOT } from '../lib/index.js'
import { iso, stamp } from '../lib/deepseek.js'

const PREFIX = '/__dsh-kb-sync'

/** A settings-file path that never exists, so tests never read the real ~/.dsh one. */
const MISSING_CONFIG = join(tmpdir(), 'dsh-kb-sync-test-no-such-config.json')

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
  const kbDir = join(root, 'kb')
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

/** A credential-service stub: one ref, in memory, never exposes values in assertions. */
function makeCredentials(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    async resolve(ref) {
      return store.has(ref) ? { value: store.get(ref) } : undefined
    },
    async describe(ref) {
      return { configured: store.has(ref), writable: true }
    },
    async set(ref, value) {
      store.set(ref, value)
    },
    async unset(ref) {
      store.delete(ref)
    },
  }
}

/** Boot the plugin against a mock host and return a request helper. */
function boot({ root, kbDir, subprocess, credentials, fetchImpl, config } = {}) {
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
      if (key === 'credentials') return credentials
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  }
  // localConfigFile：测试必须屏蔽插件自己那份 config.json，否则开发机上跑测试会读到真配置
  // （2026-10-12 实测：迁移后 config.json 里写了真实 syncScript，发现脚本的用例就失败了）。
  apply(ctx, config ?? { root, kbDir, outDir: kbDir, nodeBin: 'node', configFile: MISSING_CONFIG, localConfigFile: MISSING_CONFIG, fetchImpl })
  return {
    routes,
    disposers,
    get prefixRoute() {
      return routes.find((r) => r.kind === 'prefix')
    },
  }
}

/** Drive one request through the plugin's route handler. */
async function request(host, { method = 'GET', url, headers = {}, guard = true, body: requestBody = '' } = {}) {
  const route = host.prefixRoute
  assert.ok(route, 'the plugin must register its prefix route')
  const listeners = new Map()
  const req = {
    method,
    url: url.startsWith('/') ? url : `${PREFIX}${url}`,
    headers: {
      host: '127.0.0.1:19387',
      'sec-fetch-site': 'same-origin',
      ...(guard ? { 'x-dsh-kb-sync': '1' } : {}),
      ...headers,
    },
    on(event, callback) {
      listeners.set(event, callback)
      // The real request streams its body then ends; tests have no socket, so
      // deliver on registration instead: 'data' is registered before 'end', so
      // the queued callbacks run in the right order.
      if (event === 'data' && requestBody !== '') queueMicrotask(() => callback(Buffer.from(requestBody, 'utf8')))
      if (event === 'end') queueMicrotask(() => callback())
    },
    destroy() {},
    resume() {},
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

test('the control page follows ?lang= and falls back through Accept-Language', async () => {
  const { root, kbDir } = makeRoot()
  const host = boot({ root, kbDir })

  const zh = await request(host, { url: `${PREFIX}/` })
  assert.match(zh.body, /<html lang="zh-CN">/)
  assert.match(zh.body, /刷新状态/)

  const en = await request(host, { url: `${PREFIX}/?lang=en` })
  assert.match(en.body, /<html lang="en">/)
  assert.match(en.body, />Refresh</, '按钮文案应是英文')
  assert.match(en.body, />Search</)
  // 注意：中文 msgid 仍会出现在内联字典里（浏览器端要靠它查表），所以"英文页无残留中文"这条
  // 由 test/locale.test.mjs 的剥离式断言负责，这里只验接线。

  const byHeader = await request(host, { url: `${PREFIX}/`, headers: { 'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8' } })
  assert.match(byHeader.body, /<html lang="en">/)

  // `?lang=` 优先于 Accept-Language
  const preferQuery = await request(host, { url: `${PREFIX}/?lang=zh`, headers: { 'accept-language': 'en-US,en;q=0.9' } })
  assert.match(preferQuery.body, /<html lang="zh-CN">/)

  const unknown = await request(host, { url: `${PREFIX}/?lang=de`, headers: { 'accept-language': 'fr-FR' } })
  assert.match(unknown.body, /<html lang="zh-CN">/, '不认识的语言回落中文')

  // 语言参数不会变成注入点
  const hostile = await request(host, { url: `${PREFIX}/?lang=${encodeURIComponent('en"><script>x</script>')}` })
  assert.equal(hostile.body.includes('<script>x</script>'), false)
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
  const host = boot({ config: { configFile: MISSING_CONFIG, localConfigFile: MISSING_CONFIG } })
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

test('POST /doctor runs the default kb.mjs doctor and returns its output', async () => {
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

test('POST /doctor honours a custom doctor script and arguments', async () => {
  const { root, kbDir } = makeRoot()
  const script = join(root, 'check.mjs')
  writeFileSync(script, '// fixture\n')
  const sub = makeSubprocess({ stdout: 'custom check ok\n' })
  const host = boot({
    config: {
      root,
      kbDir,
      configFile: MISSING_CONFIG,
      doctorScript: script,
      doctorArgs: ['verify', '--json'],
    },
    subprocess: sub.subprocess,
  })
  const res = await request(host, { method: 'POST', url: `${PREFIX}/doctor` })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.deepEqual(sub.specs[0].argv.slice(1), [script, 'verify', '--json'])

  const missing = boot({ config: { root, kbDir, configFile: MISSING_CONFIG, doctorScript: join(root, 'nope.mjs') } })
  const missingRes = await request(missing, { method: 'POST', url: `${PREFIX}/doctor` })
  assert.equal(missingRes.json.error, 'doctor-script-missing')
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
  const discovered = resolveSettings({ root, configFile: MISSING_CONFIG, localConfigFile: MISSING_CONFIG })
  assert.equal(discovered.syncScript, join(root, 'sync', 'sync-daily.cmd'))
  // 知识库（以及默认的体检目录）都在插件自己的 data/kb 下，不再推导到 ../knowledge-base
  assert.equal(discovered.outDir, join(PLUGIN_ROOT, 'data', 'kb'))
  assert.equal(discovered.kbDir, join(PLUGIN_ROOT, 'data', 'kb'))
  assert.equal(discovered.doctorScript, join(PLUGIN_ROOT, 'data', 'kb', 'tools', 'kb.mjs'))

  const override = resolveSettings({ root, kbDir: join(root, 'kb-elsewhere'), tokenOldDays: 7, configFile: MISSING_CONFIG, localConfigFile: MISSING_CONFIG })
  assert.equal(override.kbDir, join(root, 'kb-elsewhere'))
  assert.equal(override.tokenOldDays, 7)

  assert.equal(resolveSettings({ configFile: MISSING_CONFIG, localConfigFile: MISSING_CONFIG }).root, null)
})

test('the settings file supplies values the loader config omits, and loader config wins', () => {
  const { root } = makeRoot()
  const file = join(root, 'settings.json')
  writeFileSync(file, JSON.stringify({ root, tokenOldDays: 5 }))

  const fromFile = resolveSettings({ configFile: file, localConfigFile: MISSING_CONFIG })
  assert.equal(fromFile.root, root)
  assert.equal(fromFile.tokenOldDays, 5)
  assert.equal(fromFile.configFileUsed, true)
  assert.equal(fromFile.syncScript, join(root, 'sync', 'sync-daily.cmd'))

  const other = makeRoot()
  const overridden = resolveSettings({ configFile: file, root: other.root, tokenOldDays: 30, localConfigFile: MISSING_CONFIG })
  assert.equal(overridden.root, other.root)
  assert.equal(overridden.tokenOldDays, 30)

  writeFileSync(file, '{ this is not json')
  const broken = resolveSettings({ configFile: file, localConfigFile: MISSING_CONFIG })
  assert.equal(broken.root, null)
  assert.equal(broken.configFileUsed, false)
})

test('by default the knowledge base lives inside the plugin folder, and its config.json is read', () => {
  const bare = resolveSettings({ configFile: MISSING_CONFIG, localConfigFile: MISSING_CONFIG })
  assert.equal(bare.outDir, join(PLUGIN_ROOT, 'data', 'kb'), '未配置时知识库落在插件自己的 data/kb')
  assert.equal(bare.localConfigUsed, false)

  const { root } = makeRoot()
  const localFile = join(root, 'plugin-config.json')
  writeFileSync(localFile, JSON.stringify({ outDir: join(root, 'kb-local'), tokenOldDays: 9 }))
  const withLocal = resolveSettings({ configFile: MISSING_CONFIG, localConfigFile: localFile })
  assert.equal(withLocal.outDir, join(root, 'kb-local'))
  assert.equal(withLocal.tokenOldDays, 9)
  assert.equal(withLocal.localConfigUsed, true)

  // 用户设置文件比插件自带配置优先
  const userFile = join(root, 'user-config.json')
  writeFileSync(userFile, JSON.stringify({ outDir: join(root, 'kb-user') }))
  const both = resolveSettings({ configFile: userFile, localConfigFile: localFile })
  assert.equal(both.outDir, join(root, 'kb-user'))
})

test('collectStatus never reads the token file contents', () => {
  const { root, kbDir } = makeRoot()
  const settings = resolveSettings({ root, kbDir, configFile: MISSING_CONFIG, localConfigFile: MISSING_CONFIG })
  const status = collectStatus(settings, { running: false, startedAt: null, lastResult: null })
  assert.equal(status.token.present, true)
  const serialized = JSON.stringify(status)
  assert.equal(serialized.includes('xxxxxxxx'), false, 'token content must never reach the response')
})

test('registers its route even when the host exposes no effect seam', () => {
  const { root, kbDir } = makeRoot()
  const routes = []
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
      return undefined
    },
  }
  apply(ctx, { root, kbDir })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, PREFIX)
  assert.equal(routes[0].kind, 'prefix')
})

// ---------------------------------------------------------------------------
// 网页端拉取 / 凭据 / 检索
// ---------------------------------------------------------------------------

/** A fake chat.deepseek.com: records calls, serves the two endpoints we use. */
function makeApi({ sessions = [], history = {} } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const text = String(url)
    calls.push({ url: text, headers: init.headers ?? {} })
    const respond = (payload, status = 200) => ({ status, ok: status < 400, json: async () => payload })
    if (text.includes('fetch_page')) {
      return respond({ code: 0, data: { biz_code: 0, biz_data: { chat_sessions: sessions, has_more: false } } })
    }
    if (text.includes('history_messages')) {
      const id = new URL(text).searchParams.get('chat_session_id')
      const biz = history[id]
      if (!biz) return respond({ code: 40003, msg: 'not found' }, 404)
      return respond({ code: 0, data: { biz_code: 0, biz_data: biz } })
    }
    return respond({}, 404)
  }
  return { fetchImpl, calls }
}

/** Build one history_messages payload with a real parent chain. */
function makeHistory({ id, title, turns }) {
  let parent = null
  let clock = 1_700_000_000
  const chat_messages = []
  for (const turn of turns) {
    chat_messages.push({
      message_id: chat_messages.length + 1,
      parent_id: parent,
      role: 'USER',
      inserted_at: (clock += 60),
      fragments: [{ type: 'REQUEST', content: turn.user }],
    })
    parent = chat_messages.length
    chat_messages.push({
      message_id: chat_messages.length + 1,
      parent_id: parent,
      role: 'ASSISTANT',
      model: 'deepseek-chat',
      inserted_at: (clock += 60),
      fragments: [...(turn.thinking ? [{ type: 'THINK', content: turn.thinking }] : []), { type: 'RESPONSE', content: turn.assistant }],
    })
    parent = chat_messages.length
  }
  return {
    chat_session: { id, title, current_message_id: parent, inserted_at: 1_700_000_000, updated_at: clock },
    chat_messages,
  }
}

const TOKEN_VALUE = 'secret-token-value-that-must-never-be-echoed'

test('token routes store and clear the value without echoing it', async () => {
  const { root, kbDir } = makeRoot()
  const credentials = makeCredentials()
  const host = boot({ root, kbDir, credentials })

  const before = await request(host, { url: `${PREFIX}/token` })
  assert.equal(before.json.configured, false)

  const saved = await request(host, { method: 'POST', url: `${PREFIX}/token`, body: JSON.stringify({ token: TOKEN_VALUE }) })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.ok, true)
  assert.equal(JSON.stringify(saved.json).includes(TOKEN_VALUE), false, 'the value must not come back')
  assert.equal(credentials.store.get('DEEPSEEK_WEB_TOKEN'), TOKEN_VALUE)

  const after = await request(host, { url: `${PREFIX}/token` })
  assert.equal(after.json.configured, true)
  assert.equal(JSON.stringify(after.json).includes(TOKEN_VALUE), false)

  const cleared = await request(host, { method: 'POST', url: `${PREFIX}/token/clear` })
  assert.equal(cleared.json.ok, true)
  assert.equal(credentials.store.has('DEEPSEEK_WEB_TOKEN'), false)
})

test('pull without a token reports no-token instead of failing silently', async () => {
  const { root, kbDir } = makeRoot()
  const host = boot({ root, kbDir, credentials: makeCredentials(), fetchImpl: makeApi().fetchImpl })
  const res = await request(host, { method: 'POST', url: `${PREFIX}/pull` })
  assert.equal(res.status, 400)
  assert.equal(res.json.error, 'no-token')
})

test('pull writes markdown + jsonl + catalog, then skips an unchanged second run', async () => {
  const { root, kbDir } = makeRoot()
  const credentials = makeCredentials({ DEEPSEEK_WEB_TOKEN: TOKEN_VALUE })
  const sessions = [
    { id: 'aaaaaaaa-1111', title: '拔牙之后能吃什么', updated_at: 1_700_000_300 },
    { id: 'bbbbbbbb-2222', title: '蛋白粉怎么选', updated_at: 1_700_000_400 },
  ]
  const api = makeApi({
    sessions,
    history: {
      'aaaaaaaa-1111': makeHistory({ id: 'aaaaaaaa-1111', title: '拔牙之后能吃什么', turns: [{ user: '拔牙后能吃辣吗', assistant: '建议先别吃。', thinking: '考虑创口' }] }),
      'bbbbbbbb-2222': makeHistory({ id: 'bbbbbbbb-2222', title: '蛋白粉怎么选', turns: [{ user: '乳清蛋白和植物蛋白怎么选', assistant: '看乳糖耐受。' }] }),
    },
  })
  const host = boot({ root, kbDir, credentials, fetchImpl: api.fetchImpl })

  const first = await request(host, { method: 'POST', url: `${PREFIX}/pull` })
  assert.equal(first.status, 200)
  assert.equal(first.json.added, 2)
  assert.equal(first.json.updated, 0)
  assert.equal(first.json.listed, 2)
  assert.equal(JSON.stringify(first.json).includes(TOKEN_VALUE), false)
  assert.equal(api.calls[0].headers.authorization, `Bearer ${TOKEN_VALUE}`)
  assert.equal(api.calls[0].headers.origin, 'https://chat.deepseek.com')

  const jsonl = readFileSync(join(kbDir, 'conversations.jsonl'), 'utf8').trim().split('\n')
  assert.equal(jsonl.length, 2)
  const row = JSON.parse(jsonl[0])
  assert.equal(row.id, 'aaaaaaaa-1111')
  assert.equal(row.messages.length, 2)
  assert.equal(row.messages[0].role, 'user')
  assert.equal(row.messages[1].thinking, '考虑创口')
  assert.match(row.file, /^conversations\/\d{8}-/)

  const catalog = JSON.parse(readFileSync(join(kbDir, 'catalog.json'), 'utf8'))
  assert.equal(catalog.length, 2)
  assert.equal(readFileSync(join(kbDir, row.file), 'utf8').includes('拔牙后能吃辣吗'), true)

  const second = await request(host, { method: 'POST', url: `${PREFIX}/pull` })
  assert.equal(second.json.added, 0)
  assert.equal(second.json.updated, 0)
  assert.equal(second.json.skipped, 2)
  assert.equal(second.json.noChanges, true)
})

test('a continued thread is re-fetched in place and keeps its filename', async () => {
  const { root, kbDir } = makeRoot()
  const credentials = makeCredentials({ DEEPSEEK_WEB_TOKEN: TOKEN_VALUE })
  const session = { id: 'cccccccc-3333', title: '增重计划', updated_at: 1_700_000_200 }
  const api = makeApi({ sessions: [session], history: { 'cccccccc-3333': makeHistory({ id: session.id, title: session.title, turns: [{ user: '第一问', assistant: '第一答' }] }) } })
  const host = boot({ root, kbDir, credentials, fetchImpl: api.fetchImpl })

  await request(host, { method: 'POST', url: `${PREFIX}/pull` })
  const before = JSON.parse(readFileSync(join(kbDir, 'conversations.jsonl'), 'utf8').trim().split('\n')[0])
  assert.equal(before.messages.length, 2)

  api.calls.length = 0
  session.updated_at += 600
  const api2 = makeApi({ sessions: [session], history: { 'cccccccc-3333': makeHistory({ id: session.id, title: session.title, turns: [{ user: '第一问', assistant: '第一答' }, { user: '第二问', assistant: '第二答' }] }) } })
  const host2 = boot({ root, kbDir, credentials, fetchImpl: api2.fetchImpl })
  const res = await request(host2, { method: 'POST', url: `${PREFIX}/pull` })
  assert.equal(res.json.updated, 1)
  assert.equal(res.json.added, 0)

  const after = JSON.parse(readFileSync(join(kbDir, 'conversations.jsonl'), 'utf8').trim().split('\n')[0])
  assert.equal(after.messages.length, 4)
  assert.equal(after.file, before.file, 'a continued thread keeps its markdown path')
  assert.equal(JSON.parse(readFileSync(join(kbDir, 'catalog.json'), 'utf8')).length, 1)
})

test('search finds titles and message text, and can filter to the user voice', async () => {
  const { root, kbDir } = makeRoot()
  const credentials = makeCredentials({ DEEPSEEK_WEB_TOKEN: TOKEN_VALUE })
  const api = makeApi({
    sessions: [{ id: 'dddddddd-4444', title: '牙齿话题', updated_at: 1_700_000_100 }],
    history: { 'dddddddd-4444': makeHistory({ id: 'dddddddd-4444', title: '牙齿话题', turns: [{ user: '我昨天拔了智齿', assistant: '止痛药按说明书吃，说明书里有剂量。' }] }) },
  })
  const host = boot({ root, kbDir, credentials, fetchImpl: api.fetchImpl })
  await request(host, { method: 'POST', url: `${PREFIX}/pull` })

  const all = await request(host, { url: `${PREFIX}/search?q=${encodeURIComponent('说明书')}` })
  assert.equal(all.json.ok, true)
  assert.equal(all.json.hits.length, 1)
  assert.equal(all.json.hits[0].matches[0].role, 'assistant')

  const userOnly = await request(host, { url: `${PREFIX}/search?q=${encodeURIComponent('说明书')}&role=user` })
  assert.equal(userOnly.json.hits.length, 0, 'the assistant line must not match the user-only filter')

  const byTitle = await request(host, { url: `${PREFIX}/search?q=${encodeURIComponent('牙齿')}` })
  assert.equal(byTitle.json.hits[0].titleHit, true)

  const kb = await request(host, { url: `${PREFIX}/kb` })
  assert.equal(kb.json.markdown, 1)
  assert.equal(kb.json.catalog.rows, 1)
})

test('GET /conversation returns one conversation as markdown', async () => {
  const { root, kbDir } = makeRoot()
  const credentials = makeCredentials({ DEEPSEEK_WEB_TOKEN: TOKEN_VALUE })
  const api = makeApi({
    sessions: [{ id: 'eeeeeeee-5555', title: '睡眠', updated_at: 1_700_000_100 }],
    history: { 'eeeeeeee-5555': makeHistory({ id: 'eeeeeeee-5555', title: '睡眠', turns: [{ user: '最近总醒', assistant: '先固定起床时间。', thinking: '排查作息' }] }) },
  })
  const host = boot({ root, kbDir, credentials, fetchImpl: api.fetchImpl })
  await request(host, { method: 'POST', url: `${PREFIX}/pull` })

  const ok = await request(host, { url: `${PREFIX}/conversation?id=eeeeeeee-5555` })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.ok, true)
  assert.match(ok.json.markdown, /# 睡眠/)
  assert.match(ok.json.markdown, /## 👤 用户/)
  assert.match(ok.json.markdown, /### 💭 思考过程/)
  assert.match(ok.json.markdown, /### 🤖 DeepSeek/)
  assert.equal(ok.json.truncated, false)
  assert.equal(ok.json.file.endsWith('.md'), true)

  assert.equal((await request(host, { url: `${PREFIX}/conversation?id=nope` })).status, 404)
  assert.equal((await request(host, { url: `${PREFIX}/conversation` })).status, 404)

  // 没配置时知识库落在插件自己的 data/kb（空库），未知 id 自然是 404
  const emptyKb = boot({ config: { configFile: MISSING_CONFIG, localConfigFile: MISSING_CONFIG, outDir: join(root, 'kb-empty') } })
  const res = await request(emptyKb, { url: `${PREFIX}/conversation?id=x` })
  assert.equal(res.status, 404)
})

test('the knowledge base writer refuses to escape its directory', async () => {
  const { resolveInside } = await import('../lib/store.js')
  assert.throws(() => resolveInside('D:\\kb', '..\\evil.md'), /路径越界/)
  assert.throws(() => resolveInside('D:\\kb', 'C:\\Windows\\evil.md'), /路径越界/)
  assert.ok(resolveInside('D:\\kb', 'conversations/ok.md').startsWith('D:\\kb'))
})

// ---------------------------------------------------------------------------
// 全量回填：zip 读取 / 消息树解析 / 端到端
// ---------------------------------------------------------------------------

const { crc32, parseExportConversations, readExport, readZipEntries } = await import('../lib/export.js')

/** 手工造一个 stored(0) 的 zip —— 只依赖规范，不依赖被测代码的压缩分支。 */
function buildZip(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, data)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, name]))
    offset += local.length + name.length + data.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, eocd])
}

/** 一条真实形状的导出会话：助手回复与提问**同一时间戳**（正是那个坑）。 */
function makeExportConversation({ id, title, turns }) {
  const mapping = { root: { id: 'root', parent: null, children: [], message: null } }
  let parent = 'root'
  let clock = Date.parse('2026-01-01T00:00:00+00:00')
  turns.forEach((turn, index) => {
    const at = new Date((clock += 60_000)).toISOString().replace('Z', '+00:00')
    const userId = `u${index}`
    mapping[userId] = { id: userId, parent, children: [], message: { model: null, inserted_at: at, fragments: [{ type: 'REQUEST', content: turn.user }] } }
    mapping[parent].children.push(userId)
    const assistantId = `a${index}`
    mapping[assistantId] = {
      id: assistantId,
      parent: userId,
      children: [],
      message: { model: 'deepseek-chat', inserted_at: at, fragments: [{ type: 'THINK', content: turn.thinking ?? '' }, { type: 'RESPONSE', content: turn.assistant }] },
    }
    mapping[userId].children.push(assistantId)
    parent = assistantId
  })
  return { id, title, inserted_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T01:00:00+00:00', mapping }
}

test('zip reader returns file entries, skips directories and rejects a corrupted entry', () => {
  const zip = buildZip([
    { name: 'dir/', data: Buffer.alloc(0) },
    { name: 'conversations.json', data: Buffer.from('[]', 'utf8') },
    { name: 'user.json', data: Buffer.from('{"id":"x"}', 'utf8') },
  ])
  const entries = readZipEntries(zip)
  assert.deepEqual([...entries.keys()].sort(), ['conversations.json', 'user.json'])
  assert.equal(entries.get('user.json').toString('utf8'), '{"id":"x"}')

  const broken = Buffer.from(zip)
  broken[broken.indexOf(Buffer.from('{"id":"x"}')[0])] ^= 0xff
  assert.throws(() => readZipEntries(broken), /CRC32 校验失败/)
})

test('export parsing keeps the assistant leaf even when the timestamps tie (the documented trap)', () => {
  const records = parseExportConversations([
    makeExportConversation({ id: 'c1', title: '牙齿', turns: [{ user: '拔牙后能吃什么', assistant: '先别吃辣的。', thinking: '创口' }] }),
  ])
  assert.equal(records.length, 1)
  assert.equal(records[0].messages.length, 2)
  assert.equal(records[0].messages.at(-1).role, 'assistant')
  assert.equal(records[0].messages.at(-1).text, '先别吃辣的。')
  assert.equal(records[0].messages.at(-1).thinking, '创口')
  assert.equal(records[0].turns, 1)
})

test('backfill walks export_all → poll → download → merge, and is idempotent', async () => {
  const { root, kbDir } = makeRoot()
  const credentials = makeCredentials({ DEEPSEEK_WEB_TOKEN: TOKEN_VALUE })
  const conversations = [
    makeExportConversation({ id: 'e1', title: '拔牙', turns: [{ user: '拔牙后能吃什么', assistant: '先别吃辣的。' }] }),
    makeExportConversation({ id: 'e2', title: '增重', turns: [{ user: '怎么增重', assistant: '多吃 + 练。' }] }),
  ]
  const zip = buildZip([
    { name: 'conversations.json', data: Buffer.from(JSON.stringify(conversations), 'utf8') },
    { name: 'user.json', data: Buffer.from('{"id":"u"}', 'utf8') },
  ])
  let statusCalls = 0
  const seen = []
  const fetchImpl = async (url) => {
    const text = String(url)
    seen.push(text)
    if (text.includes('export_all')) return { status: 200, ok: true, json: async () => ({ code: 0 }) }
    if (text.includes('download_export_history')) {
      statusCalls += 1
      return {
        status: 200,
        ok: true,
        json: async () => (statusCalls < 2
          ? { code: 0, data: { biz_code: 0, biz_data: { status: 'PENDING', exported_at: null, history_download_url: null } } }
          : { code: 0, data: { biz_code: 0, biz_data: { status: 'FINISHED', exported_at: 1_760_000_000, history_download_url: 'https://cdn.example/export.zip' } } }),
      }
    }
    if (text.startsWith('https://cdn.example/')) {
      return { status: 200, ok: true, arrayBuffer: async () => zip }
    }
    return { status: 404, ok: false, json: async () => ({}) }
  }

  const host = boot({ root, kbDir, credentials, fetchImpl, config: { root, kbDir, outDir: kbDir, configFile: MISSING_CONFIG, fetchImpl, exportIntervalMs: 1, exportAttempts: 5 } })
  const started = await request(host, { method: 'POST', url: `${PREFIX}/backfill` })
  assert.equal(started.status, 202)
  assert.equal(started.json.ok, true)

  let status = null
  for (let i = 0; i < 200; i += 1) {
    const res = await request(host, { url: `${PREFIX}/status` })
    status = res.json
    if (status.backfill && (status.backfill.phase === 'done' || status.backfill.phase === 'failed')) break
    await new Promise((done) => setTimeout(done, 10))
  }
  assert.equal(status.backfill.phase, 'done', `phase=${status.backfill.phase} fatal=${status.backfill.fatal}`)
  assert.equal(status.backfill.exportConversations, 2)
  assert.equal(status.backfill.added, 2)
  assert.equal(status.backfill.attempts, 2)
  assert.ok(status.backfill.zipBytes > 0)
  assert.equal(seen.some((u) => u.includes('export_all')), true)
  assert.equal(seen.some((u) => u.startsWith('https://cdn.example/')), true)

  const jsonl = readFileSync(join(kbDir, 'conversations.jsonl'), 'utf8').trim().split('\n')
  assert.equal(jsonl.length, 2)
  assert.equal(JSON.parse(jsonl[0]).messages.at(-1).role, 'assistant')

  // 再回填一次：同样的内容不该重复新增
  statusCalls = 0
  await request(host, { method: 'POST', url: `${PREFIX}/backfill` })
  for (let i = 0; i < 200; i += 1) {
    const res = await request(host, { url: `${PREFIX}/status` })
    status = res.json
    if (status.backfill && status.backfill.phase === 'done' && status.backfill.finishedAt !== null && status.backfill.attempts === 2) break
    await new Promise((done) => setTimeout(done, 10))
    if (i === 199) assert.fail('second backfill did not finish')
  }
  assert.equal(status.backfill.added, 0)
  assert.equal(status.backfill.skipped, 2)
  assert.equal(readFileSync(join(kbDir, 'conversations.jsonl'), 'utf8').trim().split('\n').length, 2)
})

test('iso() 写本地偏移、stamp() 按本地显示（含历史 +00:00 记录）', () => {
  // 2026-10-12T13:51:33Z —— 北京时间为 21:51:33
  const epoch = Date.UTC(2026, 9, 12, 13, 51, 33) / 1000
  const pad = (n) => String(n).padStart(2, '0')
  const d = new Date(epoch * 1000)
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

  const s = iso(epoch)
  // 带显式本地偏移（而不是 UTC 的 +00:00），且指向同一个时刻
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  assert.equal(Date.parse(s), epoch * 1000)
  assert.equal(s.slice(0, 16), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)

  // 新写法（本地偏移）与历史遗留的 +00:00 写法，显示出来都必须是本地时间
  assert.equal(stamp(s), local)
  assert.equal(stamp('2026-10-12T13:51:33.991+00:00'), local)
  // 非时间串不炸，按原样截断兜底
  assert.equal(stamp('not-a-date'), 'not-a-date')
  assert.equal(stamp(null), '')
})
