/**
 * 多语言与渲染的契约测试。
 *
 * 重点是那条**机械判据**：把译文表里的所有 msgid（以及语言切换器里的语言名）从英文页面里删掉后，
 * 页面里**不允许再有任何中日韩表意文字** —— 漏翻一句就会当场失败。这样"加了一句中文忘了加译文"
 * 不会再悄悄溜过去。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SOURCE_LANG, SUPPORTED_LANGS, dictionary, normalizeLang, translator } from '../lib/locale.js'
import { renderPage } from '../lib/page.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EN = JSON.parse(readFileSync(join(HERE, '..', 'locale', 'en.json'), 'utf8'))
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** 语言切换器里的语言名是专有名词，不算漏翻。 */
const ALLOWED_CJK = ['中文']

test('译文表可用：非空、每条都是字符串、没有空译文', () => {
  assert.equal(SUPPORTED_LANGS.includes(SOURCE_LANG), true)
  assert.equal(SUPPORTED_LANGS.includes('en'), true)
  const keys = Object.keys(EN)
  assert.ok(keys.length >= 100, `译文条目应有上百条，实际 ${keys.length}`)
  for (const key of keys) {
    assert.equal(typeof EN[key], 'string', `${key} 的译文必须是字符串`)
    assert.ok(EN[key].trim().length > 0, `${key} 的译文不能为空`)
    assert.equal(CJK.test(EN[key]), false, `${key} 的译文里不该再出现中文（除非确有必要）`)
  }
  // 占位符两侧必须一致，否则运行时会把 {x} 原样吐出来
  for (const key of keys) {
    const a = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const b = [...EN[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(b, a, `${key} 的占位符与译文不一致`)
  }
})

test('normalizeLang()：问号参数、Accept-Language、大写、未知值', () => {
  assert.equal(normalizeLang('en'), 'en')
  assert.equal(normalizeLang('EN'), 'en')
  assert.equal(normalizeLang('en-US'), 'en')
  assert.equal(normalizeLang('en-US,en;q=0.9,zh-CN;q=0.8'), 'en')
  assert.equal(normalizeLang('zh-CN,zh;q=0.9'), 'zh')
  assert.equal(normalizeLang('zh'), 'zh')
  assert.equal(normalizeLang('fr-FR,fr;q=0.9'), SOURCE_LANG, '不认识的语言回落源语言')
  assert.equal(normalizeLang(''), SOURCE_LANG)
  assert.equal(normalizeLang(undefined), SOURCE_LANG)
  assert.equal(normalizeLang(null), SOURCE_LANG)
})

test('translator()：命中、回落、占位符、源语言恒等', () => {
  const en = translator('en')
  assert.equal(en('刷新'), 'Refresh')
  assert.equal(en('这句话还没翻译'), '这句话还没翻译', '缺译回落中文原文，页面不会空掉')
  assert.equal(en('　{days} 天', { days: 3 }), '　3 days')
  assert.equal(en('{a} 与 {b}', { a: 1 }), '1 与 {b}', '缺参数时保留占位符，不吐 undefined')
  const zh = translator('zh')
  assert.equal(zh('刷新'), '刷新')
  assert.deepEqual(dictionary('zh'), {})
  assert.equal(dictionary('en')['刷新'], 'Refresh')
  assert.equal(dictionary('fr')['刷新'], undefined, '没有该语言的文件就返回空表而不是报错')
})

test('中文页：默认渲染、含中文、语言切换链接、内联字典为空', () => {
  const html = renderPage({ prefix: '/__dsh-kb-sync', lang: 'zh', root: 'D:\\p', configFile: 'C:\\c.json' })
  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /更新知识库/)
  assert.match(html, /root = D:\\p/)
  assert.match(html, /href="\?lang=en"/)
  assert.match(html, /var DICT = \{\};/, '源语言不需要内联译文表')
})

test('页面里不出现内部术语（段 1 / 段 2 / 整链 / 阶段 N / dry-run / 落盘 / ①②③④⑤）', () => {
  // 2026-10-15：用户看着页面问"段 2 是什么神奇称呼"——这些是开发者视角的段名与流程名，
  // 界面上要说人话（抓取 / 整理 / 更新知识库 / 试运行 / 写入）。这条判据防止它们再爬回来。
  const html = renderPage({ prefix: '/__dsh-kb-sync', lang: 'zh', root: 'D:\\p', configFile: 'C:\\c.json' })
  for (const banned of ['段 1', '段 2', '整链', '阶段 2', '阶段 3', 'dsh headless', 'dry-run', '落盘', '①', '②', '③', '④', '⑤']) {
    assert.equal(html.includes(banned), false, `页面里不该再出现「${banned}」`)
  }
})

test('英文页：把译文表的 msgid 全删掉后，不允许残留任何中文', () => {
  const html = renderPage({
    prefix: '/__dsh-kb-sync',
    lang: 'en',
    root: 'D:\\pipeline',
    configFile: 'C:\\Users\\x\\.dsh\\.dsh-kb-sync.json',
    configFileUsed: true,
  })
  assert.match(html, /<html lang="en">/)
  assert.match(html, /Refresh/)
  assert.match(html, /Update knowledge base/)

  let stripped = html
  // 先长后短：字典里键互相包含（`未运行` 是 `未运行（…）` 的前缀），短键先剥会留下残片。
  // 同时剥 JSON 转义过的形态——内联字典里带引号的键会被转义成 \" 。
  for (const key of Object.keys(EN).sort((a, b) => b.length - a.length)) {
    stripped = stripped.split(key).join('')
    const escaped = JSON.stringify(key).slice(1, -1)
    if (escaped !== key) stripped = stripped.split(escaped).join('')
  }
  for (const allowed of ALLOWED_CJK) stripped = stripped.split(allowed).join('')
  const leftover = stripped.match(new RegExp(CJK.source + '[^<\\n]{0,40}', 'g'))
  assert.equal(leftover, null, `英文页面里还有没翻译的中文：${JSON.stringify(leftover)}`)
})

test('未配置 root 时，启动提示也是可翻译的', () => {
  const zh = renderPage({ prefix: '/__dsh-kb-sync', lang: 'zh', root: null, configFile: 'C:\\c.json' })
  assert.match(zh, /尚未配置 root/)
  const en = renderPage({ prefix: '/__dsh-kb-sync', lang: 'en', root: null, configFile: 'C:\\c.json' })
  assert.match(en, /No root configured yet/)
  assert.equal(CJK.test(en.split('var DICT')[0].replace(/中文/g, '')), false, '英文页的 HTML 部分不该有中文')
})

test('内联脚本语法有效，且 T() 与内联字典能对上', () => {
  const html = renderPage({ prefix: '/__dsh-kb-sync', lang: 'en', root: 'D:\\p', configFile: 'c.json' })
  const script = html.split('<script>')[1].split('</script>')[0]
  assert.ok(script.length > 1000, '应当拿到内联脚本')
  // 语法检查：注入的字典 JSON 或模板拼错都会在这里炸
  // eslint-disable-next-line no-new-func
  assert.doesNotThrow(() => new Function(script))
  // 脚本里用到的每个 T('…') 字面量都必须在译文表里（否则英文页会漏翻，上一条测试会兜住；这里给出更直接的原因）
  const used = new Set([...script.matchAll(/T\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")))
  assert.ok(used.size > 40, `内联脚本应使用几十条文案，实际 ${used.size}`)
  for (const text of used) {
    if (!CJK.test(text)) continue
    assert.equal(typeof EN[text], 'string', `内联脚本里的「${text}」没有英文译文`)
  }
})

test('语言参数被转义进 href（不接受注入）', () => {
  const html = renderPage({ prefix: '/__dsh-kb-sync', lang: 'en"><script>x</script>', root: 'D:\\p' })
  assert.equal(html.includes('<script>x</script>'), false)
  assert.match(html, /<html lang="zh-CN">/, '不认识的语言回落源语言（zh-CN）')
})
