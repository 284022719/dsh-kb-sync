/**
 * 文档一致性测试：**让"文档漂了"变成失败，而不是靠人记得。**
 *
 * 三件事：
 *  1. 每份文档里的本地链接（`](path)`）都必须指向仓库里真实存在的文件；
 *  2. README 的路由表必须与 `lib/index.js` 实际处理的路由**逐一对应**（多一条少一条都算失败）；
 *  3. 文档里提到的 `npm run <script>` 必须真的在 `package.json` 里存在。
 *
 * 不检查外部 http(s) 链接（那需要出网，会把测试变成依赖网络的东西）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = ['README.md', 'README.en.md', 'CHANGELOG.md', 'docs/USAGE.md', 'docs/USAGE.en.md', 'docs/PUBLISHING.md', 'docs/CAPABILITY-DISCLOSURE.md']

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

test('文档里的本地链接都指向真实存在的文件', () => {
  const missing = []
  for (const doc of DOCS) {
    const text = read(doc)
    const base = dirname(join(ROOT, doc))
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1]
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const path = target.split('#')[0]
      if (path === '') continue
      if (!existsSync(resolve(base, path))) missing.push(`${doc} → ${target}`)
    }
  }
  assert.deepEqual(missing, [], `这些链接指向不存在的文件：\n  ${missing.join('\n  ')}`)
})

test('README 的路由表与代码里实际处理的路由一一对应', () => {
  const code = read('lib/index.js')
  // 代码里是 `sub === '/x'` 这种分支；`/` 与空串等价，都算根。
  const handled = new Set()
  for (const m of code.matchAll(/sub === '(\/[^']*)'/g)) handled.add(m[1])
  if (/sub === '\/' \|\| sub === ''/.test(code)) handled.add('/')

  const table = read('README.md')
  const documented = new Set()
  for (const m of table.matchAll(/^\| `\/__dsh-kb-sync([^`|]*)`/gm)) {
    const raw = m[1].split('?')[0].trim()
    documented.add(raw === '' ? '/' : raw)
  }

  assert.ok(documented.size >= 10, `路由表看起来没解析出来（${documented.size} 条）`)
  const undocumented = [...handled].filter((r) => !documented.has(r)).sort()
  const phantom = [...documented].filter((r) => !handled.has(r)).sort()
  assert.deepEqual(undocumented, [], `代码里有、README 路由表里没有：${undocumented.join(', ')}`)
  assert.deepEqual(phantom, [], `README 路由表里有、代码里没有：${phantom.join(', ')}`)
})

test('文档里提到的 npm script 都真实存在', () => {
  const scripts = JSON.parse(read('package.json')).scripts ?? {}
  const referenced = new Set()
  for (const doc of DOCS) {
    for (const m of read(doc).matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) referenced.add(m[1])
  }
  assert.ok(referenced.size >= 2, `应当至少引用到 test/check/pack:check，实际 ${[...referenced].join(', ')}`)
  const missing = [...referenced].filter((name) => scripts[name] === undefined)
  assert.deepEqual(missing, [], `文档提到了不存在的 script：${missing.join(', ')}`)
})

test('发布白名单里含两份 README、CHANGELOG 与 docs', () => {
  const pkg = JSON.parse(read('package.json'))
  for (const entry of ['docs', 'CHANGELOG.md', 'README.md', 'README.en.md', 'config.example.json', 'locale']) {
    assert.ok(pkg.files.includes(entry), `package.json files 缺少 ${entry}`)
  }
})

test('README 里的测试用例数与实际一致', () => {
  // 这条防的是"加了用例忘了改文档"：从测试文件里数 `test(` 的个数。
  const count = ['test/plugin.test.mjs', 'test/client.test.mjs', 'test/locale.test.mjs', 'test/process.test.mjs', 'test/pipeline.test.mjs', 'test/docs.test.mjs']
    .map((f) => (read(f).match(/^test\(/gm) ?? []).length)
    .reduce((a, b) => a + b, 0)
  const zh = read('README.md')
  const en = read('README.en.md')
  assert.match(zh, new RegExp(`全部 ${count} 个用例`), `README.md 应写明「全部 ${count} 个用例」`)
  assert.match(en, new RegExp(`${count} cases`), `README.en.md 应写明 ${count} cases`)
})
