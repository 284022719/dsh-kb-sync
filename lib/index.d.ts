/**
 * dsh-kb-sync 的公开类型声明（手写）。
 *
 * 运行时是**零依赖的 JS**，这份声明只描述插件对外露出的那一小块面：
 *  - 配置对象（loader config / 设置文件 / `config.json` 三者同形）
 *  - `resolveSettings()` 解析出的有效设置（含"哪一份生效"的来源信息）
 *  - `/status` 的 JSON 负载（控制页与应用内分节读的就是它）
 *  - 插件本体（`name` / `inject` / `apply`）
 *
 * 刻意**不 import 宿主包的类型**（`@deepseek-ai/cordis` 等是可选 peer）：宿主上下文用结构化
 * 类型描述就够了，消费者不需要为了看类型而安装宿主类型包。要改这里，请同时让
 * `test/types/usage.ts` 用一遍——`npm run check:types` 会编译它。
 *
 * `./client`（浏览器半部）不在类型面上：它由宿主 `__ModuleLoader__` 加载，不是给人 import 的。
 */

/** 插件 id，也是 loader 行与设置文件里的名字。 */
export const name: 'dsh-kb-sync'

/** 宿主服务依赖：只声明真正的硬依赖（没有 `webServer` 就没法注册路由）。 */
export const inject: string[]

/** 插件目录的绝对路径（README/控制页里的"插件目录"）。 */
export const PLUGIN_ROOT: string

/**
 * 三种配置通道（loader `config`、设置文件、插件目录里的 `config.json`）**同形**，全部可选。
 *
 * 优先级：loader `config` → 环境变量 → 用户设置文件 → 插件目录 `config.json` → 内置默认。
 */
export interface KbSyncConfig {
  /** 流水线根目录。`syncScript`/`logDir`/`lastSyncFile`/`tokenFile` 都从它推。未配置时插件照常加载，控制页会说明怎么配。 */
  root?: string | null
  /** 同步脚本的绝对路径；不配则在 `root` 下按常见文件名探测。 */
  syncScript?: string
  /** 日志目录；默认 `<root>/sync/logs`。 */
  logDir?: string
  /** 最近若干次同步的状态行文件；默认 `<root>/sync/LAST-SYNC.txt`。 */
  lastSyncFile?: string
  /** 凭据文件（只 `stat` mtime 判新鲜度，**从不读正文**）。 */
  tokenFile?: string
  /** 知识库目录。默认插件内的 `data/kb`（自包含）。 */
  outDir?: string
  /** 凭据文件"偏旧"的阈值（天）。默认 21。 */
  tokenOldDays?: number
  /** 体检脚本；留空会**回落默认路径**，没有关闭开关。 */
  doctorScript?: string
  /** 体检脚本的参数数组；默认 `['doctor']`。 */
  doctorArgs?: string[]
  /** 管线代码目录（段 2 用的那些脚本所在处）；默认插件的 `tools/pipeline`。 */
  pipelineDir?: string
  /** 段 2 的提供方；不填则由宿主 `llm` 服务自动选。 */
  processProvider?: string
  /** 段 2 的模型；不填则自动选。 */
  processModel?: string
  /** 段 2 单次生成的 token 上限。默认 4096；太小会出现空输出（`unparseable-output`）。 */
  processMaxTokens?: number
  /** 整链的新鲜度闸门：距上次成功不足这个毫秒数就 `skipped`。默认 6 小时。 */
  chainMinIntervalMs?: number
  /** 凭据服务里的引用名。默认 `DEEPSEEK_WEB_TOKEN`。 */
  tokenRef?: string
  /** 子进程超时（毫秒）。默认 1 小时。 */
  timeoutMs?: number
  /** 全量回填轮询服务端导出状态的次数上限。默认 30。 */
  exportAttempts?: number
  /** 全量回填轮询间隔（毫秒）。默认 5000。 */
  exportIntervalMs?: number
  /** 跑子进程用的 node 可执行文件。默认 `node`。 */
  nodeBin?: string
  /** 注入的 fetch 实现（测试用）。 */
  fetchImpl?: (input: string, init?: Record<string, unknown>) => Promise<unknown>
}

/** `resolveSettings()` 的结果：有效设置 + 每一份配置的来源信息。 */
export interface ResolvedSettings {
  root: string | null
  syncScript: string | null
  logDir: string | null
  lastSyncFile: string | null
  tokenFile: string | null
  outDir: string
  kbDir: string
  doctorScript: string | null
  doctorArgs: string[]
  pipelineDir: string
  processProvider: string | null
  processModel: string | null
  processMaxTokens: number
  chainMinIntervalMs: number
  tokenRef: string
  tokenOldDays: number
  timeoutMs: number
  exportAttempts: number
  exportIntervalMs: number
  nodeBin: string
  /** 用户设置文件路径（`$DSH_HOME/.dsh-kb-sync.json`）。 */
  configFile: string
  /** 用户设置文件是否真的读到了内容。 */
  configFileUsed: boolean
  /** 插件目录里的 `config.json` 路径。 */
  localConfigFile: string
  /** 插件目录配置是否生效。 */
  localConfigUsed: boolean
  fetchImpl: KbSyncConfig['fetchImpl']
}

/** 凭据文件的新鲜度（只看 mtime，从不读正文）。 */
export interface TokenStatus {
  file: string
  present: boolean
  ageDays: number | null
  thresholdDays: number
  old: boolean
}

/** 一次同步脚本运行的结局。 */
export interface LastResult {
  ok: boolean
  exitCode: number | null
  finishedAt: number | null
  error?: string | null
}

/** 一次增量拉取的摘要（页面"本轮：…"那几行）。 */
export interface PullResult {
  startedAt?: number | null
  finishedAt?: number | null
  listed?: number
  added?: number
  updated?: number
  skipped?: number
  noChanges?: boolean
  fatal?: string | null
  files?: string[]
  errors?: Array<{ title?: string; id?: string; message?: string }>
}

/** 全量回填的进度（后台跑，页面轮询 `/status`）。 */
export interface BackfillState {
  phase?: string | null
  attempts?: number
  exportStatus?: string | null
  exportConversations?: number | null
  zipBytes?: number | null
  added?: number
  updated?: number
  skipped?: number
  files?: string[]
  errors?: Array<{ title?: string; message?: string }>
  fatal?: string | null
  finishedAt?: number | null
}

/** 段 2 的进度与上一次结果。 */
export interface ProcessState {
  running: boolean
  startedAt?: number | null
  finishedAt?: number | null
  phase?: string | null
  log: string[]
  result: {
    ok?: boolean
    applied?: boolean
    skipped?: string | null
    error?: string | null
    message?: string | null
    finishKind?: string | null
    counts?: { assignments: number; facts: number; candidates: number; suggestions: number }
    validation?: string
    applyLog?: string
    raw?: string
  } | null
  /** 这一轮模型是怎么结束的（`stop` / `max-tokens` / `threw`…）：空输出时唯一能区分原因的地方。 */
  finishKind: string | null
  maxTokens: number
  provider: string | null
  model: string | null
  route: { provider?: string; model?: string; source?: string } | null
}

/** 整链里的一段。 */
export interface ChainStage {
  stage: string
  ok: boolean
  code?: string
  message?: string
  exitCode?: number | null
  ms: number
}

/** 整链总判（页面底部那一行，也用于通知文案）。 */
export interface ChainReport {
  ok: boolean
  ms: number
  reason?: string
  warnings?: string[]
  stages: ChainStage[]
  notify?: { case?: string; title: string; body: string } | null
}

/** 知识库规模。 */
export interface KbStats {
  conversationsJsonl?: { bytes: number; mtime: number } | null
  catalog?: { rows: number; mtime?: number } | null
  markdown?: number
  [key: string]: unknown
}

/** `/status` 的完整负载（控制页与应用内分节都读它）。 */
export interface StatusPayload {
  ok: true
  configured: boolean
  message?: string
  running: boolean
  runningSince: number | null
  pulling?: boolean
  pullStartedAt?: number | null
  backfilling?: boolean
  configFile: { path: string; used: boolean; localPath: string; localUsed: boolean }
  paths: { root: string | null; syncScript: string | null; kbDir: string; outDir: string; logDir: string | null; pipelineDir: string }
  token?: TokenStatus
  lastResult?: LastResult | null
  lastPull?: PullResult | null
  backfill?: BackfillState | null
  lastSync?: string[] | null
  latestLog?: { name: string; mtime: number; bytes: number; tail: string } | null
  kb?: KbStats | null
  process: ProcessState
  chain: { running: boolean; startedAt?: number | null; phase?: string | null; stages: ChainStage[]; report: ChainReport | null }
}

/**
 * 宿主上下文里本插件用到的部分。
 *
 * 用结构化类型而不是宿主包的 `Context`：`@deepseek-ai/cordis` 是**可选 peer**，消费者不该为了看类型而装它。
 * 实际用到的服务：`webServer`（路由必需）、`subprocess`、`credentials`、`llm`（后三个按需，缺失时对应功能报错而不是静默失败）。
 */
export interface HostContext {
  get(service: 'webServer'): unknown
  get(service: string): unknown
  readonly [key: string]: unknown
}

/** 默认设置文件：`$DSH_HOME/.dsh-kb-sync.json`（未设 `DSH_HOME` 时是 `~/.dsh/...`）。 */
export function defaultConfigFile(): string

/** 读设置文件；缺失、坏 JSON、非对象一律得到 `{}`（不会抛）。 */
export function readConfigFile(path: string): KbSyncConfig

/** 按优先级解析出有效设置。 */
export function resolveSettings(config?: unknown, io?: { configFile?: string }): ResolvedSettings

/** 读文件尾部至多 `maxBytes` 字节（日志预览用）。 */
export function readTail(path: string, maxBytes: number): string

/**
 * 同源守卫：只接受环回 `Host`；可变请求还要求同源且有自定义头。
 * @param req - 至少要有 `headers`。
 * @param mutating - 是不是写操作（POST）。
 */
export function originAllowed(req: { headers?: Record<string, string | string[] | undefined> }, mutating: boolean): boolean

/** 组装 `/status` 的负载（同步函数，只读本机状态）。 */
export function collectStatus(s: ResolvedSettings, state: Record<string, unknown>): StatusPayload

/** 插件入口：注册同源路由并挂上控制页。 */
export function apply(ctx: HostContext, config?: KbSyncConfig): void
