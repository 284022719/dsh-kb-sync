/**
 * 生成门面截图（作者自用，开发工具，不入发布包）。
 *
 *   node tools/make-screenshots.mjs          # 生成 assets/screenshots/*.png + screenshots.json
 *   node tools/make-screenshots.mjs --keep   # 不删临时目录（排错用）
 *
 * 两条硬约束：
 *   ① **截图必须来自真实页面代码**：HTML 由 `lib/page.js` 的 `renderPage()` 生成，不是另画一张图；
 *   ② **画面里只能有假数据**：演示服务自带一份写死的假状态（`D:\demo\...`、示例对话标题），
 *      **不读**用户的知识库、配置或凭据，也不连任何外部网络。
 *
 * 做法：起一个只监 127.0.0.1 的本地服务 → 用无头 Chrome 逐个 URL 截图（`--virtual-time-budget`
 * 让页面里的异步 load() 跑完）→ 需要交互/滚动的画面由演示服务在页面尾部注入一小段脚本驱动
 * （点搜索、滚动到某一段），真实的事件处理器不变。
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPage } from '../lib/page.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_DIR = join(ROOT, 'assets', 'screenshots')
const TMP_DIR = join(ROOT, 'data', 'import', 'screenshot-tmp')
const PORT = 19399
const PREFIX = '/__dsh-kb-sync'
const KEEP = process.argv.includes('--keep')

/** 演示用的假数据：全是编的，别改成真实路径。 */
const DEMO = {
  root: 'D:\\demo\\pipeline',
  outDir: 'D:\\demo\\pipeline\\data\\kb',
  configFile: 'C:\\Users\\demo\\.dsh\\.dsh-kb-sync.json',
  tokenFile: 'C:\\Users\\demo\\.dsh\\.dsh-kb-sync-token',
  logFile: 'sync-20261012-2100.log',
}

const STATUS = {
  ok: true,
  configured: true,
  running: false,
  pulling: false,
  backfilling: false,
  paths: { root: DEMO.root, syncScript: `${DEMO.root}\\tools\\pipeline\\trigger.cmd`, kbDir: DEMO.outDir, outDir: DEMO.outDir, logDir: `${DEMO.root}\\data\\import\\sync\\logs`, pipelineDir: `${DEMO.root}\\tools\\pipeline` },
  token: { file: DEMO.tokenFile, present: true, ageDays: 3, thresholdDays: 21, old: false },
  lastSync: [
    '2026-10-12 21:00:06  sync-ok  ok',
    '2026-10-11 21:00:07  sync-ok  ok',
    '2026-10-10 21:00:05  sync-ok  ok',
  ],
  latestLog: { name: DEMO.logFile, mtime: 1791810000000, bytes: 20480, tail: '[21:00:01] token 3 天前更新\n[21:00:02] recon: 新增 4 条，续聊 1 条\n[21:00:05] fetch: 写入 5 个会话\n[21:00:06] 完成\n' },
  kb: { dir: DEMO.outDir, conversationsJsonl: { bytes: 8_912_345, mtime: 1791810000000 }, catalog: { rows: 312 }, markdown: 312 },
  pulling: false,
  lastPull: { startedAt: 1791809900000, finishedAt: 1791810005000, listed: 100, added: 4, updated: 1, skipped: 95, noChanges: false, files: ['conversations/20261012-示例对话-周末行程-ab12cd34.md'], errors: [] },
  backfilling: false,
  backfill: { phase: 'done', attempts: 3, exportStatus: 'FINISHED', exportConversations: 312, zipBytes: 25_607_301, added: 0, updated: 0, skipped: 312, errors: [], files: [], fatal: null, finishedAt: 1791810000000 },
  process: {
    running: false,
    phase: 'done',
    provider: 'demo-provider',
    model: 'demo-model',
    route: { provider: 'demo-provider', model: 'demo-model', source: 'auto' },
    log: ['[21:00:03] [init] pipeline=<plugin>\\tools\\pipeline', '[21:00:03] [route] demo-provider / demo-model（自动选择）', '[21:00:04] [input] 本轮条目 4；健康摘要 320 字；财务摘要 0 字'],
    result: { ok: true, applied: true, counts: { assignments: 4, facts: 2, candidates: 1, suggestions: 1 }, validation: '全部校验通过', applyLog: '归类 4 条 → final-topics\n健康事实 2 条 → health-facts', raw: '{"assignments":[…]}' },
  },
  chain: {
    running: false,
    phase: 'done',
    stages: [],
    report: { ok: true, ms: 8421, reason: '全部阶段完成', warnings: [], notify: { case: 'sync-ok', title: '对话知识库：同步成功', body: '整链完成（8 秒）：新增 4、续聊 1。' }, stages: [
      { stage: 'token', ok: true, code: 'ok', message: '完成', exitCode: 0, ms: 1 },
      { stage: 'recon', ok: true, code: 'ok', message: '完成', exitCode: 0, ms: 1082 },
      { stage: 'fetch', ok: true, code: 'ok', message: '完成', exitCode: 0, ms: 3105 },
      { stage: 'process', ok: true, code: 'ok', message: '完成', exitCode: 0, ms: 2964 },
      { stage: 'doctor', ok: false, code: 'failed', message: '示例：3 份清单数量对不上', exitCode: 1, ms: 1269 },
    ] },
  },
}

const SEARCH = { ok: true, query: '示例关键词', role: 'any', scanned: 312, hits: [
  { id: 'demo-0001', title: '示例对话：周末行程怎么排', file: 'conversations/20261012-示例对话-周末行程-ab12cd34.md', updated_at: '2026-10-12 21:00', titleHit: true, matches: [
    { role: 'user', snippet: '帮我看看这个周末怎么安排比较合适，示例关键词出现了。' },
    { role: 'assistant', snippet: '可以按「上午户外、下午室内」排，示例关键词在正文里也会被命中。' },
  ] },
  { id: 'demo-0002', title: '示例对话：预算表怎么记', file: 'conversations/20261010-示例对话-预算表-ef56gh78.md', updated_at: '2026-10-10 09:12', titleHit: false, matches: [
    { role: 'user', snippet: '记账的表想换个结构，示例关键词。' },
  ] },
] }

const CONVERSATION = { ok: true, id: 'demo-0001', title: '示例对话：周末行程怎么排', updated_at: '2026-10-12 21:00', truncated: false, markdown: '# 示例对话：周末行程怎么排\n\n- **会话 ID**：`demo-0001`\n- **时间**：2026-10-12 20:40 → 21:00\n- **消息**：4 条\n\n## 👤 用户\n\n帮我看看这个周末怎么安排。\n\n### 🤖 DeepSeek\n\n可以按「上午户外、下午室内」排。\n' }

const TOKEN_STATUS = { ok: true, available: true, configured: true, ref: 'DEEPSEEK_WEB_TOKEN' }

/**
 * 页面尾部注入的演示脚本：只负责"点一下搜索"，其余交给浏览器。
 *
 * **不再用滚动定位**：页面内容是异步渲染的，早先两种滚动手法（一次性 `scrollTo(y)`、每 200ms
 * `scrollIntoView`）都实测截到过纯白图。改成**高窗口整页截图**（`--window-size=1280,2200`）后
 * 结果稳定——整页本来就在一张图里，不需要滚。
 * @param {string} mode - 演示模式。
 * @returns {string} 注入的 `<script>`。
 */
function demoScript(mode) {
  if (mode !== 'search') return ''
  return `<script>
window.addEventListener('load', function () {
  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    var q = document.getElementById('q');
    if (q && !window.__demoSearched) { window.__demoSearched = 1; q.value = '示例关键词'; document.getElementById('search').click(); }
    if (tries > 40) clearInterval(timer);
  }, 200);
});
</script>`
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (payload, type = 'application/json; charset=utf-8') => {
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
    }
    if (url.pathname === PREFIX || url.pathname === `${PREFIX}/`) {
      const html = renderPage({
        prefix: PREFIX,
        lang: url.searchParams.get('lang') ?? 'zh',
        root: DEMO.root,
        configFile: DEMO.configFile,
        configFileUsed: true,
      })
      const mode = url.searchParams.get('demo') ?? ''
      return send(mode === '' ? html : html.replace('</body>', `${demoScript(mode)}</body>`), 'text/html; charset=utf-8')
    }
    const sub = url.pathname.slice(PREFIX.length)
    if (sub === '/status') return send(STATUS)
    if (sub === '/token') return send(TOKEN_STATUS)
    if (sub === '/kb') return send({ ok: true, ...STATUS.kb, pulling: false, lastPull: STATUS.lastPull })
    if (sub === '/search') return send(SEARCH)
    if (sub === '/conversation') return send(CONVERSATION)
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'not-found' }))
  })
  return new Promise((ready) => server.listen(PORT, '127.0.0.1', () => ready(server)))
}

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/**
 * 跑一次无头浏览器截图。
 *
 * ⚠️ 必须**异步**：早先这里用了 `spawnSync`，它把 Node 的事件循环堵住，演示服务就永远回不了
 * 页面里的 fetch —— 无头浏览器一直等，直到超时被杀（表现为 exit=null、没有 PNG）。
 * @param {string} browser - 浏览器可执行文件。
 * @param {string[]} args - 命令行参数。
 * @returns {Promise<{code: number|null, stderr: string}>} 退出码与（截断的）stderr。
 */
function shoot(browser, args) {
  return new Promise((done) => {
    const child = spawn(browser, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(0, 600) })
    const timer = setTimeout(() => child.kill(), 90_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code, stderr })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      done({ code: null, stderr: String(error.message) })
    })
  })
}

const SHOTS = [
  { file: 'preview-01-control-page.png', url: '/', size: '1280,900', note: '控制页首屏：工具栏 + ① 登录态 + ② 拉取' },
  { file: 'preview-02-full-page.png', url: '/', size: '1280,2200', note: '整页：③ 检索 / 状态 / 知识库 / 日志 / 体检 / ④ 整链逐段 / ⑤ 段 2' },
  { file: 'preview-03-search.png', url: '/?demo=search', size: '1280,2200', note: '③ 检索命中的样子（命中片段 + 展开全文）' },
  { file: 'preview-04-english.png', url: '/?lang=en', size: '1280,2200', note: '同一页面切到英文（?lang=en）' },
]

const server = await startServer()
if (process.argv.includes('--serve')) {
  console.log(`演示服务已在 http://127.0.0.1:${PORT}${PREFIX}/ （--serve：只服务不截图，Ctrl+C 结束）`)
  console.log(`  ?demo=status | ?demo=chain | ?demo=process | ?demo=search | ?lang=en`)
} else {
const browser = findBrowser()
if (browser === null) {
  server.close()
  console.error('找不到 Chrome/Edge，无法截图')
  process.exit(1)
}
mkdirSync(OUT_DIR, { recursive: true })
if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true })
mkdirSync(TMP_DIR, { recursive: true })

const made = []
for (const shot of SHOTS) {
  const target = join(OUT_DIR, shot.file)
  const profile = join(TMP_DIR, shot.file.replace(/\.png$/, ''))
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--window-size=${shot.size}`,
    '--force-device-scale-factor=1',
    '--virtual-time-budget=5000',
    `--screenshot=${target}`,
    `http://127.0.0.1:${PORT}${PREFIX}${shot.url}`,
  ]
  const run = await shoot(browser, args)
  const ok = existsSync(target) && statSync(target).size > 6000
  if (!ok) {
    console.error(`截图失败：${shot.file}（exit=${run.code}）\n${run.stderr.slice(0, 400)}`)
    server.close()
    process.exit(1)
  }
  made.push({ file: shot.file, bytes: statSync(target).size, note: shot.note })
  console.log(`  ✓ ${shot.file}  ${Math.round(statSync(target).size / 1024)} KB  ${shot.note}`)
}
server.close()

// screenshots.json：与同级插件同格式（一个路径数组）
writeFileSync(join(ROOT, 'screenshots.json'), `${JSON.stringify(made.map((m) => `assets/screenshots/${m.file}`), null, 2)}\n`, 'utf8')
if (!KEEP) rmSync(TMP_DIR, { recursive: true, force: true })
console.log(`\n共 ${made.length} 张 → ${OUT_DIR}`)
console.log(`screenshots.json 已更新（${readdirSync(OUT_DIR).length} 个文件在目录里）`)
}
