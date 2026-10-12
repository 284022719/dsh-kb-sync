/**
 * "随包的东西都是好的" —— 对**发布包里那份代码**做检查，而不是只检查我常改的那几个文件。
 *
 * 两条不变量：
 *  ① `lib/` 与 `tools/pipeline/` 下每个 JS/MJS 都必须能过 `node --check`。
 *     动机：`npm run check` 只逐个点名了 9 个 lib 文件 + 2 个管线入口，而**随包发布的管线有 30 多个脚本**，
 *     别的脚本若有语法错误，用户跑到那一段才会炸，而且是在他的机器上、他的数据上。
 *  ② `.cmd` / `.ps1` **不得含非 ASCII 字节、不得带 BOM**。依据是仓库自己的规矩（`tools/pipeline/README.md`：
 *     "`.cmd` 里绝对不能写中文 —— cmd.exe 按 GBK 读取 .cmd，中文会被搅乱并把后续内容当成命令执行"）。
 *     这类错误在中文环境下写注释时最容易犯，而且后果是**执行到一半乱码/跑错命令**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CODE_DIRS = ['lib', 'tools/pipeline', 'tools']
/** 这些不进发布包（`files` 里的取反项），所以也不参加"随包"检查。 */
const NOT_SHIPPED = ['tools/pipeline/retired/', 'tools/pipeline/pipeline.json', 'tools/pipeline/trigger.log', 'tools/pipeline/trigger.json', 'tools/pipeline/trigger-source.json']

/** 递归列出目录下的文件（相对 ROOT）。 */
function walk(rel, out = []) {
  const abs = join(ROOT, rel)
  let entries
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'attic') continue
      walk(child, out)
    } else if (entry.isFile()) {
      out.push(child)
    }
  }
  return out
}

const files = [...new Set(CODE_DIRS.flatMap((dir) => walk(dir)))].filter((f) => !NOT_SHIPPED.some((skip) => f.startsWith(skip)))

test('随包的 JS/MJS 逐文件语法有效（node --check）', () => {
  const targets = files.filter((f) => /\.(js|mjs)$/.test(f))
  assert.ok(targets.length >= 25, `应当扫到随包的几十个脚本，实际 ${targets.length}`)
  const bad = []
  for (const rel of targets) {
    // stdio: 'ignore' —— 不捕获子进程输出，避免受限沙箱下"管道 stdio"的限制。
    const run = spawnSync(process.execPath, ['--check', join(ROOT, rel)], { stdio: 'ignore' })
    if (run.status !== 0) bad.push(rel)
  }
  assert.deepEqual(bad, [], `这些脚本语法不通过：\n  ${bad.join('\n  ')}`)
})

test('随包的 .cmd/.bat 必须纯 ASCII 且无 BOM（cmd.exe 按 GBK 读；.ps1 允许中文）', () => {
  const shells = files.filter((f) => ['.cmd', '.bat'].some((ext) => f.endsWith(ext)))
  assert.ok(shells.length >= 2, `应当扫到几个 .cmd，实际 ${shells.length}`)
  const problems = []
  for (const rel of shells) {
    const bytes = readFileSync(join(ROOT, rel))
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) problems.push(`${rel}: 带 UTF-8 BOM`)
    const nonAscii = bytes.findIndex((b) => b > 0x7f)
    if (nonAscii >= 0) {
      const line = bytes.subarray(0, nonAscii).toString('latin1').split('\n').length
      problems.push(`${rel}: 第 ${line} 行有非 ASCII 字节（0x${bytes[nonAscii].toString(16)}）`)
    }
  }
  assert.deepEqual(problems, [], `这些 .cmd 违反了纯 ASCII 规矩（中文请放 .ps1/.mjs/.md）：\n  ${problems.join('\n  ')}`)
})

test('运行时文件与 retired 不随包发布（files 取反项在位）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  // 动机（2026-10-12 实测）：`files` 里写了 `tools/pipeline` 这个目录，npm 会把整目录装进去 ——
  // 作者的 pipeline.json（含本机绝对路径，用户装上后脚本会**静默读错数据目录**）、trigger.log，
  // 以及 retired/ 都曾进包。取反项是唯一的排除手段（有 files 字段时 .npmignore/.gitignore 不生效）。
  for (const skip of ['!tools/pipeline/pipeline.json', '!tools/pipeline/trigger.log', '!tools/pipeline/trigger.json', '!tools/pipeline/trigger-source.json', '!tools/pipeline/retired']) {
    assert.ok(pkg.files.includes(skip), `package.json files 应含取反项 ${skip}`)
  }
})

test('随包目录里没有漏进来的备份/临时文件', () => {
  const junk = files.filter((f) => /\.(bak|tmp|orig|rej)$/i.test(f) || /~$/.test(f) || /\.backup-\d/.test(f))
  assert.deepEqual(junk, [], `这些像是临时文件，不该留在随包目录里：\n  ${junk.join('\n  ')}`)
})

/**
 * 脚本里写死的**同目录引用**必须真实存在。
 *
 * 动机（2026-10-12 实测）：把 `tools/pipeline/attic/` 搬去 `data/import/pipeline-attic/` 时，
 * 有 3 处 `join(PIPE_DIR, 'attic', …)` 必须手工改（`build-kb.mjs` 复制 `search.mjs`、
 * 两个 prep-health 脚本读写中间产物）；漏一处就是"用户跑到那一段才炸"。这条把它变成机械检查。
 *
 * 只查**字面量**：`join(PIPE_DIR, 'x.mjs')` / `join(PLUGIN_ROOT, 'x', 'y')`；变量参数（`join(PIPE_DIR, f)`）不硬猜。
 */
test('脚本里写死的同目录引用都真实存在（排除用户配置与运行时数据）', () => {
  // 这些**允许不存在**：用户配置（gitignore 里，新克隆没有）、运行时数据目录、触发器状态。
  const OPTIONAL = [/^config\.json$/i, /^pipeline\.json$/i, /^trigger/i, /^data[\\/]/i, /^logs?[\\/]/i, /\.token$/i]
  const refs = []
  for (const rel of files.filter((f) => /\.(js|mjs)$/.test(f))) {
    const base = rel.startsWith('tools/pipeline/') ? 'tools/pipeline' : '.'
    const text = readFileSync(join(ROOT, rel), 'utf8')
    for (const m of text.matchAll(/join\((PIPE_DIR|PLUGIN_ROOT)\s*,\s*'([^']+)'(?:\s*,\s*'([^']+)')?\)/g)) {
      const target = m[3] === undefined ? m[2] : `${m[2]}/${m[3]}`
      if (OPTIONAL.some((re) => re.test(target))) continue
      refs.push({ file: rel, target, base })
    }
  }
  assert.ok(refs.length >= 5, `应当扫到多处同目录引用，实际 ${refs.length}`)
  const missing = refs.filter((r) => !existsSync(join(ROOT, r.base, r.target))).map((r) => `${r.file} → ${r.target}`)
  assert.deepEqual(missing, [], `这些引用在包内不存在（用户跑到那段会炸）：\n  ${missing.join('\n  ')}`)
})

/**
 * 插件 ⇄ 管线脚本的接口契约（见 docs/PIPELINE-CONTRACT.md）。
 *
 * 这层接口没有类型系统兜着：插件按 argv 调脚本、按 stdout 标记判成败。最典型的坏法是
 * **标志名两侧不一致、而错的那侧因为"未知参数被忽略"看起来能跑** —— 2026-10-12 实测：
 * 插件调落盘时传 `['--apply']`，而 `apply-extraction.mjs` 里只有 `process.argv.includes('--dry-run')`
 * （没有该标志就等于落盘），于是落盘成功纯属巧合；脚本哪天改成默认只校验，按钮就会**静默变成只校验**。
 */
test('插件引用的管线脚本都存在，且传的标志被脚本承认', () => {
  const index = readFileSync(join(ROOT, 'lib/index.js'), 'utf8')

  // ① 插件引用的脚本都要存在：既包括 `prepScript: join(dir, 'prep-inbox.mjs')` 这种带键名的，
  //    也包括重建数组里那些没有键名的（`join(dir, 'build-kb.mjs'),`）。
  const scriptFiles = [...new Set([...index.matchAll(/join\(dir,\s*'([^']+\.mjs)'\)/g)].map((m) => m[1]))]
  assert.ok(scriptFiles.length >= 9, `应当解析出插件用到的管线脚本，实际 ${scriptFiles.length}`)
  const missingScripts = scriptFiles.filter((file) => !existsSync(join(ROOT, 'tools/pipeline', file)))
  assert.deepEqual(missingScripts, [], `插件引用的脚本在 tools/pipeline 里不存在：${missingScripts.join(', ')}`)

  // 键名映射只用于下面把 `files.X` 翻成脚本文件
  const scripts = new Map()
  for (const m of index.matchAll(/(\w+):\s*join\(dir,\s*'([^']+\.mjs)'\)/g)) scripts.set(m[1], m[2])

  // ② 传出去的标志必须出现在对应脚本源码里（位置参数不查，它们可能是脚本的业务参数）
  const checks = []
  for (const m of index.matchAll(/runPipelineScript\(\s*files\.(\w+)\s*,\s*\[([^\]]*)\]/g)) {
    const [, key, args] = m
    const file = scripts.get(key)
    if (file === undefined) continue
    const text = readFileSync(join(ROOT, 'tools/pipeline', file), 'utf8')
    for (const flag of args.matchAll(/'(--[a-z-]+)'/g)) checks.push({ file, flag: flag[1], known: text.includes(flag[1]) })
  }
  assert.ok(checks.length >= 1, `应当扫到至少一处带标志的调用，实际 ${checks.length}`)
  const unknown = checks.filter((c) => !c.known).map((c) => `${c.file} 不认 ${c.flag}`)
  assert.deepEqual(unknown, [], `插件传了脚本不认的标志（脚本会静默忽略）：\n  ${unknown.join('\n  ')}`)
})

/**
 * 判成不得依赖脚本输出的**措辞**。
 *
 * 依据：`apply-extraction.mjs` 只认 `--dry-run`、失败时 `process.exit(2)`（脚本里唯一的显式退出），
 * 所以"成功/失败"应当由**退出码**决定；措辞只在 `classifyStage` 里当"容忍 Node 退出期噪声"的标记用。
 * 2026-10-12 实测：原来落盘那步是 `/全部校验通过/.test(stdout)` —— 脚本改个措辞，成功的落盘就会被判成失败。
 */
test('判成不依赖输出措辞：没有 /…校验通过…/.test( 这种条件的回归', () => {
  const index = readFileSync(join(ROOT, 'lib/index.js'), 'utf8')
  const wordingJudged = [...index.matchAll(/\/[^/\n]*校验通过[^/\n]*\/\.test\(/g)].map((m) => m[0])
  assert.deepEqual(wordingJudged, [], '不要再按输出措辞判成败（用 classifyStage：退出码优先）')
  const wired = [...index.matchAll(/classifyStage\(\{ exitCode: (validation|appliedRun)\.exitCode/g)]
  assert.ok(wired.length >= 2, `校验与落盘两处都应走 classifyStage，实际 ${wired.length} 处`)
})