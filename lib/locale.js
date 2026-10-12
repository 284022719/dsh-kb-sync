/**
 * 控制页的多语言（msgid 风格）。
 *
 * 约定：**中文就是源语言**，页面里写什么中文就把它当 key；`locale/<lang>.json` 是
 * "中文原文 → 该语言译文" 的映射表。好处是加一种语言 = 加一个 JSON + 在 SUPPORTED_LANGS 里加一个词，
 * 不用动页面代码；**缺译自动回落中文原文**，页面不会因为漏词而空掉。
 *
 * 为什么不用语义 key（`btn.refresh` 之类）：那种写法要把每句中文改成 key，且要额外维护一份中文表；
 * 这里语言是"附加"的，源语言零成本。代价是改了中文原文就要同步改译文——单测会用
 * "英文页面里不允许残留未翻译中文"这条断言把漏改当场抓出来（见 test/locale.test.mjs）。
 *
 * @module dsh-kb-sync/locale
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 源语言：没有对应的 JSON，直接原样输出。 */
export const SOURCE_LANG = 'zh'
/** 支持的语言：源语言 + 每个有 `locale/<code>.json` 的语言。 */
export const SUPPORTED_LANGS = ['zh', 'en']

const LOCALE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locale')
const cache = new Map()

/**
 * 读一种语言的译文表（源语言返回空表）。
 * @param {string} lang - 语言代码（会先规范化）。
 * @returns {Record<string, string>} 中文原文 → 译文。
 */
export function dictionary(lang) {
  const code = normalizeLang(lang)
  if (code === SOURCE_LANG) return {}
  if (!cache.has(code)) {
    let dict = {}
    try {
      const parsed = JSON.parse(readFileSync(join(LOCALE_DIR, `${code}.json`), 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) dict = parsed
    } catch {
      // 文件缺失/坏 JSON 都按"没有译文"处理：页面回落中文，而不是报错。
      dict = {}
    }
    cache.set(code, dict)
  }
  return cache.get(code)
}

/**
 * 把 `?lang=` / `Accept-Language` 之类的值规范化成支持的语言代码。
 * `en-US` → `en`；`en-US,en;q=0.9` → `en`；空值或不认识 → 源语言。
 * @param {unknown} value - 原始值。
 * @returns {string} 支持的语言代码。
 */
export function normalizeLang(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === '') return SOURCE_LANG
  for (const part of raw.split(',')) {
    const tag = part.split(';')[0].trim()
    if (tag === '') continue
    const base = tag.split('-')[0]
    if (SUPPORTED_LANGS.includes(base)) return base
    if (SUPPORTED_LANGS.includes(tag)) return tag
  }
  return SOURCE_LANG
}

/**
 * 造一个翻译函数。
 * @param {string} lang - 语言代码。
 * @returns {(text: string, vars?: Record<string, unknown>) => string} `t('刷新状态')` / `t('新增 {n} 条', { n: 3 })`。
 */
export function translator(lang) {
  const dict = dictionary(lang)
  return (text, vars) => {
    const hit = dict[text]
    let out = typeof hit === 'string' && hit !== '' ? hit : text
    if (vars !== undefined && vars !== null) {
      out = out.replace(/\{(\w+)\}/g, (whole, key) =>
        vars[key] === undefined || vars[key] === null ? whole : String(vars[key]),
      )
    }
    return out
  }
}
