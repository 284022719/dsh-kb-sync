/**
 * 发布前预检（作者自用，开发工具、不入发布包）：
 *
 *   node tools/preflight.mjs            # 全部跑一遍
 *   node tools/preflight.mjs --no-npx   # 跳过能力披露（dsh-trust-check 需要 npx/网络）
 *
 * 为什么要有它：`docs/PUBLISHING.md` 第三节那份清单是**给人看的**，人一忙就会漏一项
 * （本仓库就漏过：发布包里曾混进 `pipeline.json` / `trigger.log` / `retired/`）。
 * 这里把能机械化的那几项合成一条命令，退出码就是结论。
 *
 * 子进程输出写进临时文件而不是管道：受限沙箱下 Node 的管道 stdio 会 EPERM，
 * 写文件这条路在两种环境下都能用。
 */
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_NPX = process.argv.includes('--no-npx')
const TMP = mkdtempSync(join(tmpdir(), 'kb-sync-preflight-'))

/**
 * 跑一条命令，返回 `{ code, output }`（输出走临时文件，避免管道 stdio）。
 *
 * `shell: true` 是 Windows 上必须的：`npm.cmd` / `npx.cmd` 不是可执行文件，不加 shell 直接
 * `spawnSync` 会起不来（表现是 code=null、输出为空——2026-10-12 实测踩到）。
 * @param {string[]} argv - 命令与参数。
 * @param {{shell?: boolean}} [opts] - 是否经 shell。
 */
function run(argv, opts = {}) {
  const logPath = join(TMP, `${Math.random().toString(36).slice(2)}.log`)
  const fd = openSync(logPath, 'w')
  const result = opts.shell === true
    ? spawnSync(argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '), { cwd: ROOT, shell: true, stdio: ['ignore', fd, fd] })
    : spawnSync(argv[0], argv.slice(1), { cwd: ROOT, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  const output = readFileSync(logPath, 'utf8')
  return { code: result.status, output }
}

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail === '' ? '' : `　${detail}`}`)
}

/** 命令跑失败时把输出尾部打出来，方便直接看原因。 */
function tail(text, lines = 12) {
  return text.trim().split('\n').slice(-lines).join('\n    ')
}

// ① 单元测试（含随包卫生、文档一致性、契约检查）
{
  const { code, output } = run([process.execPath, '--test'])
  const summary = (output.match(/^ℹ (tests|pass|fail) \d+$/gm) ?? []).join(' ').replace(/ℹ /g, '')
  record('npm test', code === 0, summary)
  if (code !== 0) console.log(`    ${tail(output)}`)
}

// ② 语法 + import 冒烟
{
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { code, output } = run([npm, 'run', 'check'], { shell: true })
  record('npm run check', code === 0, code === 0 ? 'ok' : '')
  if (code !== 0) console.log(`    ${tail(output)}`)
}

// ③ 类型声明能编译（没装 typescript 就明确跳过，而不是假装通过）
{
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const hasTsc = (() => {
    try {
      readFileSync(join(ROOT, 'node_modules', 'typescript', 'package.json'), 'utf8')
      return true
    } catch {
      return false
    }
  })()
  if (!hasTsc) {
    record('npm run check:types', true, '跳过（未装 devDependencies；先 npm install）')
  } else {
    const { code, output } = run([npm, 'run', 'check:types'], { shell: true })
    record('npm run check:types', code === 0, code === 0 ? 'ok' : '')
    if (code !== 0) console.log(`    ${tail(output)}`)
  }
}

// ④ 发布包内容：不该出现的东西一条都不许有（这是把 docs/PUBLISHING.md 的机械检查搬进来）
{
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { code, output } = run([npm, 'pack', '--dry-run', '--json'], { shell: true })
  if (code !== 0) {
    record('发布包内容', false, 'npm pack 失败')
    console.log(`    ${tail(output)}`)
  } else {
    // npm pack --json 输出的是**数组**，前后还可能夹 npm 自己的提示行 —— 只取第一个 `[` 到最后一个 `]`。
    let info = null
    try {
      const from = output.indexOf('[')
      const to = output.lastIndexOf(']')
      info = JSON.parse(output.slice(from, to + 1))[0]
    } catch (error) {
      record('发布包内容', false, `解析 npm pack 输出失败：${String(error.message).slice(0, 80)}`)
    }
    if (info !== null) {
      const paths = info.files.map((f) => f.path)
      const forbidden = /(^|\/)(attic|retired)\/|health-selection|specialties-map|analysis-|probe-|conversations\.jsonl|\.token$|(^|\/)pipeline\.json$|(^|\/)trigger\.(log|json)$|trigger-source\.json/
      const bad = paths.filter((p) => forbidden.test(p))
      const needed = ['lib/index.js', 'lib/client.js', 'lib/index.d.ts', 'locale/en.json', 'cordis.patch.yml', 'README.md', 'README.en.md', 'CHANGELOG.md', 'screenshots.json']
      const missing = needed.filter((p) => !paths.includes(p))

      // ④b 文档里写的**包体量**必须与实际一致。
      // 动机（2026-10-16 实测）：`files` 白名单加了 CONTRIBUTING/SECURITY 之后包变成 58 个文件，
      // 而 README 与 PUBLISHING 还写着旧的 55 —— 数字一旦写死就会漂，所以在这里对一次。
      // 体积写成"约 480 KB"（改一次文档就会变），所以只核对**文件数**。
      const docCounts = ['README.md', 'docs/PUBLISHING.md'].map((file) => ({
        file,
        n: Number((readFileSync(join(ROOT, file), 'utf8').match(/\*\*(\d+)\*\*\s*个文件/) ?? [])[1]),
      }))
      const unreadable = docCounts.filter((d) => !Number.isFinite(d.n)).map((d) => d.file)
      const drifted = docCounts.filter((d) => Number.isFinite(d.n) && d.n !== info.entryCount).map((d) => `${d.file} 写 ${d.n}`)

      record('发布包内容', bad.length === 0 && missing.length === 0 && unreadable.length === 0 && drifted.length === 0, `${info.entryCount} 个文件 / ${Math.round(info.size / 1024)} KB`)
      if (bad.length > 0) console.log(`    不该发布：${bad.join(', ')}`)
      if (missing.length > 0) console.log(`    少了必需文件：${missing.join(', ')}`)
      if (unreadable.length > 0) console.log(`    这些文档里应有 "**N** 个文件" 的写法，没解析到：${unreadable.join('、')}`)
      if (drifted.length > 0) console.log(`    文档里的包体量与实际不符（实际 ${info.entryCount} 个）：${drifted.join('、')}`)
    }
  }
}

// ⑤ 能力披露：宿主自带工具，退出码恒为 1（红线是登记过的），所以只看它跑没跑起来
if (SKIP_NPX) {
  record('dsh-trust-check', true, '跳过（--no-npx）')
} else {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const { code, output } = run([npx, '--yes', 'dsh-trust-check', '--dir', ROOT], { shell: true })
  const line = output.split('\n').find((l) => /\d+ plugin\(s\)/.test(l)) ?? ''
  const ran = code !== null && line !== ''
  record('dsh-trust-check', ran, line.trim() || (ran ? '已运行' : '跑不起来（离线？可加 --no-npx）'))
}

rmSync(TMP, { recursive: true, force: true })
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '预检通过' : `预检未通过：${failed.map((r) => r.name).join(', ')}`}`)
process.exit(failed.length === 0 ? 0 : 1)
