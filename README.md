# dsh-kb-sync

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：把你**自己已有**的同步流水线（DeepSeek 网页端历史 → 本地知识库）搬到一个同源控制页上——一键运行、看状态、看日志、跑知识库体检。

> **一句话定位**：它只做**编排**。抓取、鉴权与出网全部留在你已经跑通的那个脚本里；插件自身**不读凭据、不出网、不注入提示词**。

## 它做什么 / 不做什么

| | 说明 |
|---|---|
| ✅ 做 | 用 `subprocess` 起你配置的命令；读 `LAST-SYNC.txt` / `sync\logs\*` / `token 文件的 mtime` 展示状态；调 `<kb>\tools\kb.mjs doctor` 做完整性体检 |
| ❌ 不做 | 不读 `.token` 的内容（只 `stat` 它的修改时间）；不连任何网络；不使用 DSH `credentials` 服务；不注册提示词段落；不改核心 bundle；无安装脚本 |

出网与 token 都留给你自己的流水线（例如作者用的是「官方导出接口 + `chat.deepseek.com` 的 `history_messages`」那套脚本），插件只负责按键和读结果。

## 安装

插件是标准 `dsh.bundle`（host 半部，无客户端构建步骤、**零依赖**）：

```sh
# 从 GitHub 源码安装
dsh plugin --profile web add github:<owner>/dsh-kb-sync
```

装完重启 DSH。

## 配置

插件不猜你的目录：没配置时它照常加载，控制页会告诉你去配什么。在你的 profile patch 里按 id 覆盖（`~/.dsh/profiles/<profile>/cordis.patch.yml`）：

```yaml
- id: dsh-kb-sync
  name: 'dsh-kb-sync'
  config:
    root: 'D:\path\to\pipeline'      # 流水线根目录；下面几项都可由它推出来
    # syncScript: '...\sync\sync-daily.cmd'   # 默认自动发现 sync\sync-daily.{cmd,ps1,sh}
    # logDir:     '...\sync\logs'
    # lastSyncFile: '...\sync\LAST-SYNC.txt'
    # tokenFile:  '...\.token'                # 只读 mtime，不读内容
    # kbDir:      '...\knowledge-base'        # 需含 tools\kb.mjs
    # tokenOldDays: 21                        # 超过就标「token 偏旧」
    # nodeBin: 'node'
    # timeoutMs: 3600000
```

也可以用环境变量 `DSH_KB_SYNC_ROOT` 指定根目录。

> ⚠️ 有些 profile 的 `cordis.patch.yml` 会被应用在重启时重写成它自己的权威副本，手写的 loader 行可能被抹掉——重启后核对一次。

## 使用

打开 **`http://127.0.0.1:<你的 DSH Web 端口>/__dsh-kb-sync/`**（就是你平时打开 GUI 的那个端口）。页面上有：刷新状态 / 运行同步 / 跑知识库体检，运行期间每 3 秒自动刷新。

| 路由 | 方法 | 作用 |
|---|---|---|
| `/__dsh-kb-sync/` | GET | 控制页（单文件 HTML，无外部请求） |
| `/__dsh-kb-sync/status` | GET | 状态 JSON（路径、token 年龄、LAST-SYNC 末 8 行、最新日志尾部 16 KB） |
| `/__dsh-kb-sync/run` | POST | 启动同步命令；已在运行返回 409 |
| `/__dsh-kb-sync/doctor` | POST | 运行 `kb.mjs doctor`，返回其 stdout/stderr 与退出码 |
| `/__dsh-kb-sync/log?name=` | GET | 读 `logs\` 下某个日志的尾部（文件名白名单 + 越界拒绝） |

## 安全模型

- **只监听环回**：`Host` 必须是 `127.0.0.1` / `localhost` / `::1`（挡住 DNS rebinding），`Sec-Fetch-Site` 非同源一律 403。
- **写操作要自定义头**：POST 必须带 `x-dsh-kb-sync: 1`，跨站表单设不了自定义头。
- **日志读取白名单**：`^[A-Za-z0-9._-]{1,120}$` 且必须落在 `logs\` 目录内。
- **argv 全显式**：`cmd.exe /c <脚本>`（POSIX 走 `/bin/sh`），不做字符串拼 shell。
- **token 只 stat 不读**：状态里只有「存在与否 / 修改时间 / 年龄天数」，正文永不进响应（有测试守着）。

## 能力披露（`dsh-trust-check`）

代码判定、可复现、零 token：

```sh
npx dsh-trust-check --dir /path/to/dsh-kb-sync --exit-code
```

```
1 plugin(s) · 0 red · 0 accepted · 1 review · 0 expected · 0 clear

dsh-kb-sync 0.1.0 — review          (退出码 1 = 需确认)
  No hard red lines; if capabilities match why you installed it, mark as expected in Settings.
  why be careful:
    · Execute system commands
    · Access the network
    · Read local files
  capabilities: shell, fs-read, network (same-origin), env
  destinations (literal):
    … + 1 allowlisted/loopback destination(s)
  injections: 0
  evidence: 18 hit(s)
```

怎么读这份报告：

- `shell` / `fs-read` 是**设计使然**（起你配的命令、读状态与日志）。
- `network (same-origin)` 来自控制页自己的 `fetch(PREFIX + '/status')`——同源调用，不是外连；插件在 host 侧不开任何 socket。
- `env` 来自一个可选的根目录环境变量。
- **0 红线**：没有「读凭据值 + 出网」、没有明文 http 外连、没有字面量 IP、没有 override `@deepseek-ai/*` 核心 bundle、没有安装脚本。
- 未检出不等于安全；静态扫描看不到运行时行为。更完整的对照与局限见 [`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md)。

## 已知限制

- **纯 host 半部**：没有设置页内的分节 UI（那需要 React 客户端半部 + 构建步骤）。控制页是独立 URL；要做成设置页一节是可以的，见 issue。
- 需要宿主提供 `subprocess` 服务；缺失时 `/run`、`/doctor` 报错而非静默失败。
- 状态为轮询（运行中 3 秒一次），不是推送。
- 界面文案目前是中文。
- 只在 Windows 上实测（`cmd.exe /c`）；POSIX 分支已写但未实测。

## 开发

```sh
node --test        # 11 个用例：路由、同源守卫、越界拒绝、argv、token 不读正文
```

## English summary

A host-only DeepSeek Harness plugin that orchestrates a **user-owned** sync pipeline (DeepSeek web history → local knowledge base): run it, watch status/logs, and run the knowledge base's own integrity check, from a same-origin page at `/__dsh-kb-sync/`. It holds **no credentials and opens no network connection of its own** — both stay inside the pipeline it spawns. Static capability disclosure (`dsh-trust-check`): 0 red lines, capabilities `shell` + `fs-read` + same-origin `network` + `env`.

## License

MIT
