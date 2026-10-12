/**
 * 类型用例：**只用一遍公开面**，让 `npm run check:types` 去编译它。
 *
 * 这里不是运行时测试（`node --test` 不跑 .ts），它的价值在两处：
 *  ① 正例：声明里的字段名/类型必须真能用（写错了这里就报错）；
 *  ② 反例：`@ts-expect-error` 那几行**必须报错**——一旦声明退化成 `any`，TS 会报
 *     "Unused '@ts-expect-error' directive"，检查同样失败。
 */
import {
  apply,
  collectStatus,
  defaultConfigFile,
  name,
  originAllowed,
  readConfigFile,
  readTail,
  resolveSettings,
  type ChainReport,
  type KbSyncConfig,
  type ResolvedSettings,
  type StatusPayload,
} from '../lib/index.js'

// —— 正例 ——
export const pluginName: 'dsh-kb-sync' = name
export const config: KbSyncConfig = {
  root: 'D:\\demo\\pipeline',
  syncScript: 'D:\\demo\\pipeline\\tools\\pipeline\\trigger.cmd',
  tokenOldDays: 21,
  processMaxTokens: 8192,
  chainMinIntervalMs: 6 * 60 * 60 * 1000,
  doctorArgs: ['doctor'],
}
export const settings: ResolvedSettings = resolveSettings(config)
export const outDir: string = settings.outDir
export const root: string | null = settings.root
export const configUsed: boolean = settings.configFileUsed
export const fromFile: KbSyncConfig = readConfigFile(defaultConfigFile())
export const tail: string = readTail('sync.log', 4096)
export const allowed: boolean = originAllowed({ headers: { host: '127.0.0.1:19387' } }, true)
export const status: StatusPayload = collectStatus(settings, {})
export const report: ChainReport | null = status.chain.report
export const catalogRows: number | undefined = status.kb?.catalog?.rows
export const tokenAge: number | null | undefined = status.token?.ageDays
export const finishKind: string | null = status.process.finishKind
export const stageMs: number | undefined = status.chain.stages[0]?.ms
export const routes: number = apply({ get: () => undefined }, config) ?? 0

// —— 反例：这些**必须**报错，否则说明类型退化了 ——
// @ts-expect-error tokenOldDays 是 number
export const badDays: KbSyncConfig = { tokenOldDays: '21' }
// @ts-expect-error outDir 是 string
export const badOutDir: number = settings.outDir
// @ts-expect-error chain.report 可能为 null
export const badReport: ChainReport = status.chain.report
// @ts-expect-error doctorArgs 是 string[]
export const badArgs: KbSyncConfig = { doctorArgs: 'doctor' }
