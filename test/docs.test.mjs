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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
  // 这条防的是"加了用例忘了改文档"：**动态**发现 test/*.test.mjs（写死清单会漏掉新文件——2026-10-12 就漏过），
  // 再数每个文件里顶层 `test(` 的个数。
  const testFiles = readdirSync(join(ROOT, 'test')).filter((f) => /\.test\.mjs$/.test(f))
  assert.ok(testFiles.length >= 3, `应当发现多个测试文件，实际 ${testFiles.length}`)
  const count = testFiles
    .map((f) => (read(`test/${f}`).match(/^test\(/gm) ?? []).length)
    .reduce((a, b) => a + b, 0)
  const zh = read('README.md')
  const en = read('README.en.md')
  assert.match(zh, new RegExp(`全部 ${count} 个用例`), `README.md 应写明「全部 ${count} 个用例」`)
  assert.match(en, new RegExp(`${count} cases`), `README.en.md 应写明 ${count} cases`)
})

test('screenshots.json 里的截图真实存在、是 PNG、且进了发布包', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.ok(pkg.files.includes('screenshots.json'), 'package.json files 应含 screenshots.json')
  assert.ok(pkg.files.includes('assets/screenshots'), 'package.json files 应含 assets/screenshots')
  const list = JSON.parse(read('screenshots.json'))
  assert.ok(Array.isArray(list) && list.length >= 3, 'screenshots.json 应是一个至少 3 项的路径数组')
  for (const rel of list) {
    const abs = join(ROOT, rel)
    assert.ok(existsSync(abs), `截图不存在：${rel}`)
    const bytes = readFileSync(abs)
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${rel} 不是 PNG（文件头不对）`)
    assert.ok(bytes.length > 6000, `${rel} 太小，可能是张空白图`)
  }
  assert.ok(read('README.md').includes(list[0]), 'README.md 应嵌入第一张截图')
  assert.ok(read('README.en.md').includes(list[0]), 'README.en.md 也应嵌入它')
})

test('类型声明接线完整：types 字段、exports.types、文件存在、被 tsconfig 覆盖', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.types, './lib/index.d.ts', 'package.json 应有指向 lib/index.d.ts 的 types 字段')
  assert.equal(pkg.exports['.'].types, './lib/index.d.ts', 'exports["."] 应有 types 条件')
  assert.ok(pkg.files.includes('lib'), 'files 含 lib/ 才会把声明一起发布')
  assert.ok(pkg.scripts['check:types'], 'package.json 应有 check:types 脚本')
  assert.ok(pkg.devDependencies?.typescript, 'typescript 应声明在 devDependencies（只有它在用）')
  assert.ok(existsSync(join(ROOT, 'lib', 'index.d.ts')), 'lib/index.d.ts 应存在')
  // 放在 types/ 而不是 test/：`node --test` 会把 test/ 目录下的 .ts 也当测试文件跑（Node 24 会剥类型）。
  assert.ok(existsSync(join(ROOT, 'types', 'usage.ts')), 'types/usage.ts 应存在（正例+反例都用一遍公开面）')
  const tsconfig = JSON.parse(read('tsconfig.json'))
  assert.ok(tsconfig.include.some((p) => p.includes('lib/index.d.ts')), 'tsconfig 应覆盖声明文件')
  assert.ok(tsconfig.include.some((p) => p.includes('types')), 'tsconfig 应覆盖类型用例')
  assert.equal(tsconfig.compilerOptions.strict, true, '类型检查应当是 strict 的，否则等于没查')
})

/**
 * 安装链路（见 docs/INSTALL-PATH.md）：patch 行 → loader 说明符 → 包目录 → 两侧代码。
 * 这条链上任一环写错都是**静默失败**（插件不加载 / 设置里没有那一节），所以把可机械检查的部分钉住。
 */
test('安装行与包元数据一致：patch ↔ package.json ↔ 包名', () => {
  const pkg = JSON.parse(read('package.json'))

  // ① bundle patch 声明指向的文件必须存在（宿主读不到 patch 会抛，行也就不会被插入）
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 应指向 ./cordis.patch.yml')
  assert.ok(existsSync(join(ROOT, 'cordis.patch.yml')), 'cordis.patch.yml 必须存在')
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'cordis.patch.yml 必须随包发布（files 白名单）')

  // ② patch 顶层是 YAML 序列，且恰好一个 insert 行、id/name 都等于包名
  //    （宿主只插 `insert` 行；没有 insert 但带 id 的行按 override 处理，那是 enable/disable 用的）
  const patch = read('cordis.patch.yml').split('\n').filter((line) => !line.trim().startsWith('#'))
  assert.equal(patch[0].trim(), '- insert:', 'patch 顶层应以 `- insert:` 开头')
  const ids = patch.filter((line) => /^\s*-\s*id:\s*/.test(line))
  const names = patch.filter((line) => /^\s*name:\s*/.test(line))
  assert.equal(ids.length, 1, 'patch 里应恰好有一个插入行')
  assert.equal(names.length, 1, 'patch 里应恰好有一个 name')
  assert.equal(ids[0].split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, ''), pkg.name, '插入行 id 必须等于包名')
  assert.equal(names[0].split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, ''), pkg.name, '插入行 name 必须等于包名（宿主用它解析包目录，也是客户端注册 id）')

  // ③ 两侧入口都要真实存在：宿主半部由 loader import，客户端半部由 client-modules 读文件
  const mainRel = typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.'] : pkg.exports?.['.']?.default
  assert.equal(typeof mainRel, 'string', 'exports["."] 应给出宿主半部入口')
  assert.ok(existsSync(join(ROOT, mainRel)), `宿主半部入口必须存在：${mainRel}`)
  const clientRel = typeof pkg.exports?.['./client'] === 'string' ? pkg.exports['./client'] : pkg.exports?.['./client']?.default
  assert.ok(existsSync(join(ROOT, clientRel)), `客户端半部入口必须存在：${clientRel}`)

  // ④ 宿主版本闸门：插件管理器会读 engines.dsh
  assert.ok(typeof pkg.dsh?.engines?.dsh === 'string' && pkg.dsh.engines.dsh.length > 0, 'dsh.engines.dsh 应有值')
})
