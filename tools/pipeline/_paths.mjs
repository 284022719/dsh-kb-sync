// 管线根路径：**唯一**来源是 `pipeline.json`（与本文件同目录），可用环境变量覆盖。
//
// 为什么要有这个文件：迁到 `dsh-kb-sync\tools\pipeline\` 之前，所有脚本都靠
// 「cwd = D:\dsh\deepseek-import」+ 一堆相对路径（`knowledge/`、`../health`）工作。
// 那套约定在插件自包含目录里不成立 —— 代码在 `tools\pipeline\`、数据在 `data\import\`。
// 现在每个脚本 import 本文件取绝对路径，**运行目录无关**。
//
// 本文件被 import 时就把 cwd 钉在本目录：少数脚本（apply-extraction / prep-inbox 等）
// 历史上按「cwd = 管线根」写的相对路径仍要成立；这样运行目录就与调用方无关了。
//
//   IMPORT_DIR ← pipeline.json.importDir 或 DSH_IMPORT_DIR
//   TOKEN      ← pipeline.json.tokenFile（仓库外，凭据不进工作树）
//   HEALTH_DIR ← pipeline.json.healthDir
//   FIN_DIR    ← pipeline.json.financeDir
//   KB_DIR     ← pipeline.json.kbDir
//   DSH_HOME   ← 只在 headless 调用里用到（见 sync-extract.cmd），这里给出默认值
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(dirname(fileURLToPath(import.meta.url)));

export const PIPE_DIR = dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = join(PIPE_DIR, 'pipeline.json');

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const cfg = readConfig();
const pick = (env, cfgKey, fallback) => {
  const fromEnv = typeof process.env[env] === 'string' && process.env[env].trim() !== '' ? process.env[env].trim() : null;
  const fromCfg = typeof cfg[cfgKey] === 'string' && cfg[cfgKey].trim() !== '' ? cfg[cfgKey].trim() : null;
  return resolve(fromEnv ?? fromCfg ?? fallback);
};

// 默认布局：<插件>\tools\pipeline\ ← 本文件，<插件>\data\import\ 是数据根（pipeline.json 不在时用它）。
const PLUGIN_ROOT = resolve(PIPE_DIR, '..', '..');
export const IMPORT_DIR = pick('DSH_IMPORT_DIR', 'importDir', join(PLUGIN_ROOT, 'data', 'import'));

// 允许用 DSH_KB_SYNC_TOKEN_FILE 临时换一个 token 位置（测试用），默认按配置；都没有就按数据根同级。
const tokenRaw =
  (typeof process.env.DSH_KB_SYNC_TOKEN_FILE === 'string' && process.env.DSH_KB_SYNC_TOKEN_FILE.trim() !== ''
    ? process.env.DSH_KB_SYNC_TOKEN_FILE.trim()
    : null) ??
  (typeof cfg.tokenFile === 'string' && cfg.tokenFile.trim() !== '' ? cfg.tokenFile.trim() : null);

export const TOKEN = tokenRaw === null ? join(IMPORT_DIR, '.token') : resolve(tokenRaw);

export const HEALTH_DIR = pick('DSH_HEALTH_DIR', 'healthDir', join(resolve(PLUGIN_ROOT, '..'), 'health'));
export const FIN_DIR = pick('DSH_FINANCE_DIR', 'financeDir', join(resolve(PLUGIN_ROOT, '..'), 'finance'));
export const KB_DIR = pick('DSH_KB_DIR', 'kbDir', join(PLUGIN_ROOT, 'data', 'kb'));
// 健康控制台（`make-overview.mjs` / `make-snapshot.mjs` 所在）。它被别的会话搬过家
// （2026-10-12：`D:\dsh\health-console` → `D:\dsh\控制台中心\health-console`），所以
// **别从数据目录推**：显式配置优先，兜底才是 `<插件>\..\health-console`。
export const HEALTH_CONSOLE_DIR = pick('DSH_HEALTH_CONSOLE_DIR', 'healthConsoleDir', join(resolve(PLUGIN_ROOT, '..'), 'health-console'));
export const DSH_HOME = resolve(process.env.DSH_KB_SYNC_DSH_HOME ?? join(IMPORT_DIR, '.dsh-home'));

// —— 管线数据子目录（原 `deepseek-import\` 下的那些）——
export const KNOWLEDGE = join(IMPORT_DIR, 'knowledge');
export const RAW = join(IMPORT_DIR, 'raw');
export const HEALTH_FACTS = join(IMPORT_DIR, 'health-facts');
export const HEALTH_BATCHES = join(IMPORT_DIR, 'health-batches');
export const HEALTH_DIGEST = join(IMPORT_DIR, 'health-digest');
export const HEALTH_RESEARCH = join(IMPORT_DIR, 'health-research');
export const FINANCE_DIGEST = join(IMPORT_DIR, 'finance-digest');
export const LOG_DIR = join(IMPORT_DIR, 'sync', 'logs');
export const INBOX_DIR = join(IMPORT_DIR, 'sync', 'inbox');
export const OUT_DIR = join(IMPORT_DIR, 'sync', 'out');
export const TOPICS_DIR = join(IMPORT_DIR, 'topics');
export const SPECIALTIES_MAP = join(IMPORT_DIR, 'specialties-map.json');
export const UPDATE_NEW_ITEMS = join(IMPORT_DIR, 'update-new-items.json');
export const UPDATE_TOPICS = join(IMPORT_DIR, 'update-topics.json');
export const LAST_SYNC = join(IMPORT_DIR, 'LAST-SYNC.txt');
export const CATALOG = join(KNOWLEDGE, 'catalog.json');
export const CONVERSATIONS_JSONL = join(KNOWLEDGE, 'conversations.jsonl');
