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
import { readFileSync } from 'node:fs'
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
  assert.equal(zhReg.options.inject().t('act.pull'), '拉取增量')

  const en = makeCtx('en')
  plugin.apply(en.ctx)
  const enReg = en.calls.slots.find((c) => c.op === 'register')
  assert.equal(enReg.options.label(), 'KB sync')
  assert.equal(enReg.options.inject().t('act.pull'), 'Pull new')
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
