/**
 * 客户端半部的契约测试。
 *
 * 客户端模块由宿主 Web 端加载（`window.__ModuleLoader__.load({id, factory})`），跑不了真浏览器，
 * 所以这里在 Node 里搭一个最小沙箱：假的 `window` 捕获模块定义，假的 `require` 提供 react，
 * 假的 ctx 记录 locale / slots / effect 的调用，再把守卫头与 `/status` 折叠函数单独测掉。
 * 目的：**插件没进浏览器也能锁住契约**——加载器 id、inject、注册参数、字典齐全、写操作带守卫头。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

/** 在沙箱里执行 client.js，返回模块定义与被假 require 喂大的插件对象。 */
function loadClient() {
  let definition = null
  const fakeWindow = { __ModuleLoader__: { load: (d) => { definition = d } }, open() {} }
  // eslint-disable-next-line no-new-func
  new Function('window', SRC)(fakeWindow)
  assert.ok(definition, 'client.js 必须调用 window.__ModuleLoader__.load({ id, factory })')

  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  const plugin = definition.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require(${name})`)
  })
  return { definition, plugin, fakeWindow }
}

/** 假 ctx：记录 locale.register / slots.inject+register / effect，并按当前语言 bind。 */
function makeCtx(lang = 'zh') {
  const calls = { locale: [], slots: [], effects: [] }
  const dicts = {}
  const ctx = {
    locale: {
      register: (ns, d) => { calls.locale.push(ns); dicts[ns] = d },
      bind: (ns) => (key) => (dicts[ns]?.[lang] ?? dicts[ns]?.zh)?.[key] ?? key,
    },
    slots: {
      inject: (name, cb) => { calls.slots.push({ op: 'inject', name }); return cb() },
      register: (options, component) => {
        calls.slots.push({ op: 'register', options, component })
        return () => calls.slots.push({ op: 'dispose', name: options.name })
      },
    },
    effect: (fn, label) => { calls.effects.push(label); return fn() },
  }
  return { ctx, calls, dicts }
}

test('客户端模块以 dsh-kb-sync 的 id 注册到模块加载器', () => {
  const { definition, plugin } = loadClient()
  assert.equal(definition.id, 'dsh-kb-sync')
  assert.equal(typeof definition.factory, 'function')
  assert.equal(plugin.name, 'ui-dsh-kb-sync')
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply() 注册中英文字典，且两侧键集合完全一致', () => {
  const { plugin } = loadClient()
  const { ctx, calls, dicts } = makeCtx()
  plugin.apply(ctx)

  assert.deepEqual(calls.locale, ['dsh-kb-sync'])
  const { zh, en } = dicts['dsh-kb-sync']
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), 'zh / en 必须一一对应')
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, 'string', `zh.${key} 必须是字符串`)
    assert.ok(value.length > 0, `zh.${key} 不能为空`)
  }
  assert.ok(Object.keys(zh).length >= 20, '字典规模应覆盖整个分节')
})

test('apply() 在 settings.section 注册一个带 label 与 inject 的分节', () => {
  const { plugin } = loadClient()
  const { ctx, calls, dicts } = makeCtx('zh')
  plugin.apply(ctx)

  const injected = calls.slots.find((c) => c.op === 'inject')
  assert.equal(injected.name, 'settings.section')

  const reg = calls.slots.find((c) => c.op === 'register')
  assert.equal(reg.options.name, 'settings.section')
  assert.equal(reg.options.id, 'kb-sync')
  assert.equal(typeof reg.options.order, 'number')
  assert.equal(reg.options.locale, 'dsh-kb-sync')
  assert.equal(typeof reg.options.label, 'function')
  assert.equal(reg.options.label(), '对话知识库')
  assert.equal(typeof reg.component, 'function')
  assert.deepEqual(reg.component, plugin.__internals.KbSyncSection)

  // 字典与分节都挂在 effect 上（重载时会被一起清掉）
  assert.equal(calls.effects.length, 2)
})

test('label 与字典跟随当前语言', () => {
  const { plugin } = loadClient()
  const zh = makeCtx('zh')
  plugin.apply(zh.ctx)
  const zhReg = zh.calls.slots.find((c) => c.op === 'register')
  assert.equal(zhReg.options.label(), '对话知识库')
  assert.equal(zhReg.options.inject().t('act.pull'), '抓取新对话')

  const en = makeCtx('en')
  plugin.apply(en.ctx)
  const enReg = en.calls.slots.find((c) => c.op === 'register')
  assert.equal(enReg.options.label(), 'KB sync')
  assert.equal(enReg.options.inject().t('act.pull'), 'Fetch new chats')
})

test('summarizeStatus() 把 /status 折成设置页要的那几行', () => {
  const { plugin } = loadClient()
  const { summarizeStatus } = plugin.__internals
  const info = summarizeStatus({
    configured: true,
    paths: { root: 'D:\\pipeline', outDir: 'D:\\kb' },
    token: { present: true, ageDays: 19, thresholdDays: 21, old: false },
    kb: { catalog: { rows: 2557 }, conversationsJsonl: { bytes: 62353559 } },
    chain: { running: true },
    process: { running: false },
  })
  assert.equal(info.configured, true)
  assert.equal(info.root, 'D:\\pipeline')
  assert.equal(info.outDir, 'D:\\kb')
  assert.equal(info.tokenPresent, true)
  assert.equal(info.tokenAgeDays, 19)
  assert.equal(info.kbRows, 2557)
  assert.equal(info.kbBytes, 62353559)
  assert.equal(info.activity, 'chain')

  const empty = summarizeStatus(null)
  assert.equal(empty.configured, false)
  assert.equal(empty.root, '')
  assert.equal(empty.tokenPresent, false)
  assert.equal(empty.activity, null)
  assert.equal(empty.kbRows, null)

  const idle = summarizeStatus({ configured: false, pulling: true, backfilling: true })
  assert.equal(idle.activity, 'pull + backfill')
})

test('humanBytes() 给出页面同一口径的大小', () => {
  const { humanBytes } = loadClient().plugin.__internals
  assert.equal(humanBytes(0), '0 B')
  assert.equal(humanBytes(512), '512 B')
  assert.equal(humanBytes(62_353_559), '59.5 MB')
})

test('request() 同源前缀 + 写操作带守卫头（GET 不带）', async (t) => {
  const { request, GUARD_HEADER, PREFIX } = loadClient().plugin.__internals
  const realFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init })
    return { status: 200, json: async () => ({ ok: true }) }
  }
  t.after(() => { globalThis.fetch = realFetch })

  await request('/status')
  assert.equal(seen[0].url, `${PREFIX}/status`)
  assert.equal(seen[0].init.headers[GUARD_HEADER], undefined, 'GET 不该带守卫头')
  assert.equal(seen[0].init.method, undefined)

  await request('/pull', { method: 'POST' })
  assert.equal(seen[1].url, `${PREFIX}/pull`)
  assert.equal(seen[1].init.headers[GUARD_HEADER], '1', '写操作必须带守卫头，否则路由 403')
  assert.equal(seen[1].init.body, '{}')
  assert.equal(seen[1].init.headers['content-type'], 'application/json')
})

test('request() 把非 JSON 响应当成错误，而不是静默成功', async (t) => {
  const { request } = loadClient().plugin.__internals
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ status: 403, json: async () => { throw new Error('not json') } })
  t.after(() => { globalThis.fetch = realFetch })
  await assert.rejects(() => request('/status'), /HTTP 403/)
})

/**
 * 下面这条照**宿主自己的装配规则**写判据（不是照同级插件的习惯）：
 * 依据是本机 DSH 实现里的 `@deepseek-ai/dsh-client-modules`（`resolveMeta()` / `parseDshClient()` /
 * `clientExportOf()` / `graphRow()`）与官方模板 `dsh-agent-preset/skills/cordis-plugin-development/
 * templates/decoration/client.js`。宿主任一条不满足时的真实后果：**模块被静默跳过**（`resolveMeta` 返回 null）
 * 或**直接抛错**（声明 malformed / 没有 `./client` 导出 / 条目不属于任何 batch）——前者在界面上表现为
 * "设置里根本没有这一节"，很难查。所以这里把每条都在 CI 里钉住。
 */
test('客户端半部满足宿主 client-modules 的装配要求（逐条照宿主实现）', () => {
  const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
  const decl = pkg.dsh?.client

  // ① 有声明、且平台是 web —— 不是 web 宿主直接跳过这一包
  assert.ok(decl, 'package.json 必须有 dsh.client 声明')
  assert.equal(decl.platform, 'web', '宿主只服务 platform === "web" 的客户端半部')

  // ② 字段类型 —— 宿主 parseDshClient() 对 inject/external/immediately 逐项校验，不合法直接抛
  for (const field of ['inject', 'external']) {
    if (decl[field] !== undefined) {
      assert.ok(Array.isArray(decl[field]) && decl[field].every((s) => typeof s === 'string'), `dsh.client.${field} 必须是字符串数组`)
    }
  }
  if (decl.immediately !== undefined) assert.equal(typeof decl.immediately, 'boolean', 'dsh.client.immediately 必须是布尔')

  // ③ exports["./client"] 必须能解析成路径（宿主的 clientExportOf：字符串，或带字符串 default 的对象；
  //    声明了 dsh.client 却没有这个导出，宿主会抛 "declares dsh.client but exports no './client' bundle"）
  const clientExport = pkg.exports?.['./client']
  const rel = typeof clientExport === 'string' ? clientExport : clientExport?.default
  assert.equal(typeof rel, 'string', 'exports["./client"] 必须是字符串或带字符串 default 的对象')
  assert.ok(existsSync(join(HERE, '..', rel)), `exports["./client"] 指向的文件必须存在：${rel}`)

  // ④ 注册的模块 id 必须**等于包名**（宿主的 graphRow(id) 注释即 "entry id (package name)"，
  //    manifest 的 entries/batches 都按它索引；对不上 = 条目永远解析不出来）
  const { definition, plugin } = loadClient()
  assert.equal(definition.id, pkg.name, '标签 id 必须等于 package.json 的 name')

  // ⑤ factory 必须返回 cordis 插件，且 inject 里有 slots（否则 apply 拿不到槽位服务）
  assert.ok(Array.isArray(plugin.inject) && plugin.inject.includes('slots'), 'plugin.inject 必须含 slots')
  assert.equal(typeof plugin.apply, 'function')

  // ⑥ dsh.client.inject 是**加载顺序/预取图**：只该列 DSH 客户端包（提供我要用的服务/槽位），
  //    **平台种子模块**（react 一族，由 shell 直接提供）不在图里、不该写进去。
  //    依据：一线包 `dsh-client-ui-settings` 自己 require react，但 inject 只写 `@deepseek-ai/dsh-api-remotes`。
  const SEEDS = ['react', 'react-dom', 'react/jsx-runtime']
  const required = [...SRC.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  for (const name of required) {
    if (name.startsWith('@deepseek-ai/')) {
      assert.ok(decl.inject?.includes(name), `${name} 被 require 了，就该写进 dsh.client.inject`)
    } else {
      assert.ok(!decl.inject?.includes(name), `${name} 若是平台种子模块就不该写进 dsh.client.inject`)
      assert.ok(SEEDS.includes(name), `客户端半部只应从平台种子里 require，别引入新依赖：${name}`)
    }
  }
  // 反向：inject 里列的宿主包必须真的存在（宿主按名字解析 module 图）
  for (const name of decl.inject ?? []) {
    assert.ok(typeof name === 'string' && name.startsWith('@deepseek-ai/'), `inject 里只该出现宿主包名：${name}`)
  }
})
