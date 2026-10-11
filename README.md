# dsh-kb-sync

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：把**你自己已有的同步流水线**搬到一个同源控制页——一键运行、看状态、看日志、跑完整性体检。

典型的流水线是「网页端对话历史 → 本地知识库」，但插件本身不关心你同步什么。

> **定位：一个插件，两半能力。**
> **① 自己拉取**：用你存在 DSH 凭据服务里的网页端 `userToken` 调 chat.deepseek.com，把对话规范化落到本地知识库，并在插件内检索 —— 这一半**读凭据值、会出网**（见下方能力披露，`dsh-trust-check` 判为**红线**）。
> **② 编排**：起你已有的同步/体检命令、读状态与日志 —— 这一半不读凭据、不出网。
> 两半都不注入提示词、都不改核心 bundle、都没有安装脚本。

![dsh-kb-sync 用法与边界：浏览器 → 插件路由 → 你的同步命令 → 状态文件与你的产物](docs/architecture.svg)

<sub>整张图就是它的全部作用域：虚线框内是插件（只提供 5 个同源路由、只读状态文件），出网与凭据都在绿色框里 —— 你自己那条命令中。</sub>

## 它做什么 / 不做什么

| | 说明 |
|---|---|
| ✅ 做 | 用 DSH 的 `subprocess` 起你配置的命令；读状态文件与日志展示进度；跑你指定的完整性体检命令；全部通过一个本地控制页操作 |
| ✅ 做（拉取半） | 用 DSH 凭据服务里的 `userToken` 调 chat.deepseek.com：拉会话列表 → 只取新增/续聊的线程（`chat_session.current_message_id` 权威定位末端）→ 规范化成 `conversations/*.md` + `conversations.jsonl` + `catalog.json` → 插件内检索 |
| ✅ 做（编排半） | 用 DSH 的 `subprocess` 起你配置的命令；读状态文件与日志展示进度；跑你指定的完整性体检命令 |
| ❌ 不做 | 不把 token 写进任何文件/日志/响应（只进凭据服务）；不访问 chat.deepseek.com 之外的任何地址；不读凭据文件（那个会过期的 `.token`）的正文、只 `stat` 它的修改时间；不注册提示词段落；不改核心 bundle；无安装脚本、无运行依赖 |

## 适配你的流水线

插件对你现有的脚本只有**一个硬要求**：一个可执行的同步命令。其余都是可选的，缺了对应功能自动降级、不会报错崩掉：

| 你提供的东西 | 插件用它做什么 | 缺失时 |
|---|---|---|
| 同步命令：`sync/sync-daily.{cmd,ps1,sh}`，或 `syncScript` 显式指定 | `/run` 按钮 | `/run` 返回 `sync-script-missing`，其余功能照常 |
| 日志目录（默认 `sync/logs/`） | `/log` 与「最新日志」 | 状态里不显示日志 |
| 进度文件（默认 `sync/LAST-SYNC.txt`） | 状态里的「最近几次结果」 | 跳过该栏 |
| 一个会过期的凭据文件（默认 `.token`） | **只读它的 mtime**，换算成「年龄天数 / 是否偏旧」 | 跳过该栏 |
| 体检命令（默认 `<kbDir>/tools/kb.mjs doctor`） | `/doctor` 按钮 | `/doctor` 返回 `doctor-script-missing`，或把 `doctorScript` 留空即禁用 |

> 这些默认值都来自一条真实流水线（`sync/sync-daily.cmd`、`sync/logs/`、`LAST-SYNC.txt`、`.token`、`knowledge-base/tools/kb.mjs`），
> 但它们**只是默认值**：每一项都能用配置改成你自己的路径与命令，体检命令也可以是任何可执行脚本（`doctorScript` + `doctorArgs`）。

## 安装

标准 `dsh.bundle` 插件（host 半部、**零依赖**、无客户端构建步骤）：

```sh
dsh plugin --profile web add github:<owner>/dsh-kb-sync
```

装完重启 DSH。要求：DSH 提供 `webServer` 与 `subprocess` 服务（0.2.x 默认都有），Node ≥ 20。

## 配置

插件不猜你的目录：没配置时它照常加载，控制页会直接告诉你缺什么。

**方式一：profile patch**（`~/.dsh/profiles/<profile>/cordis.patch.yml`，按 id 覆盖）

```yaml
- id: dsh-kb-sync
  name: 'dsh-kb-sync'
  config:
    root: 'D:\path\to\pipeline'          # 流水线根目录；下面几项都能由它推出来
    # syncScript:   '...\sync\sync-daily.cmd'   # 默认自动发现 sync\sync-daily.{cmd,ps1,sh}
    # logDir:       '...\sync\logs'
    # lastSyncFile: '...\sync\LAST-SYNC.txt'
    # tokenFile:    '...\.token'                # 只读 mtime，不读内容
    # tokenOldDays: 21                          # 超过就标「token 偏旧」
    # kbDir:        '...\knowledge-base'        # 体检脚本的默认落点
    # doctorScript: '...\tools\kb.mjs'          # 任何可执行脚本都行
    # doctorArgs:   ['doctor']
    # nodeBin: 'node'
    # timeoutMs: 3600000
```

**方式二：设置文件**（推荐——有些 profile 会在重启时重写自己的 `cordis.patch.yml`，手写的 loader 行会丢；设置文件不会）

```jsonc
// $DSH_HOME/.dsh-kb-sync.json    （未设 DSH_HOME 时即 ~/.dsh/.dsh-kb-sync.json）
{ "root": "/srv/pipeline", "tokenOldDays": 14 }
```

**方式三：环境变量** `DSH_KB_SYNC_ROOT`。

**优先级**：loader `config` → 环境变量 → 设置文件 → 内置默认。设置文件缺失或 JSON 坏掉都按空处理（不影响加载），是否读到会在 `/status` 的 `configFile` 字段里报告。

POSIX 示例（`syncScript` 指向 `.sh` 时用 `/bin/sh` 执行）：

```jsonc
{ "root": "/srv/kb-pipeline", "syncScript": "/srv/kb-pipeline/sync/daily.sh", "logDir": "/srv/kb-pipeline/sync/logs" }
```

## 使用

打开 **`http://127.0.0.1:<你的 DSH Web 端口>/__dsh-kb-sync/`**（与 GUI 同一个端口）。页面上有：刷新状态 / 运行同步 / 跑完整性体检；运行期间每 3 秒自动刷新。

| 路由 | 方法 | 作用 |
|---|---|---|
| `/__dsh-kb-sync/` | GET | 控制页（单文件 HTML，无外部请求） |
| `/__dsh-kb-sync/status` | GET | 状态 JSON：路径、凭据文件年龄、进度文件末 8 行、最新日志尾部 16 KB |
| `/__dsh-kb-sync/run` | POST | 启动同步命令；已在运行时返回 409 |
| `/__dsh-kb-sync/doctor` | POST | 运行体检命令，返回 stdout / stderr / 退出码 |
| `/__dsh-kb-sync/log?name=` | GET | 读日志目录下某个文件的尾部（文件名白名单 + 越界拒绝） |

## 安全模型

- **只监听环回**：`Host` 必须是 `127.0.0.1` / `localhost` / `::1`（挡住 DNS rebinding）；`Sec-Fetch-Site` 非同源一律 403。
- **写操作要自定义头**：POST 必须带 `x-dsh-kb-sync: 1`，跨站表单设不了自定义头。
- **日志读取白名单**：`^[A-Za-z0-9._-]{1,120}$`，且解析后必须落在日志目录内。
- **argv 全显式**：`cmd.exe /c <脚本>`（POSIX 走 `/bin/sh`），不做字符串拼 shell。
- **凭据文件只 stat 不读**：状态里只有「是否存在 / 修改时间 / 年龄天数」，正文永不进响应（有单测守着）。

## 能力披露（`dsh-trust-check`）

代码判定、可复现、零 token：

```sh
npx dsh-trust-check --dir /path/to/dsh-kb-sync --exit-code
```

```
1 plugin(s) · 1 red · 0 accepted · 0 review · 0 expected · 0 clear

dsh-kb-sync 0.1.0 — red                    (退出码 2 = 有红线)
  Stop by default; confirm the risk in Settings if you still want to keep it.
  why be careful:
    · Detected in code: reads credential values and has network access
    · May touch secrets or sensitive env vars
    · Execute system commands
  capabilities: shell, fs-write, fs-read, network (outbound), credentials, env
  destinations (literal):
    … + 2 allowlisted/loopback destination(s)
  secret touches:
    read: creds.resolve(
  source: unpinned | git+https://github.com/<owner>/dsh-kb-sync.git
  evidence: 40 hit(s)
```

怎么读这份报告（**这次是真有红线，别跳过**）：

- **红线：读凭据值 + 有网络** —— 这是"自己拉取"那一半的必然结果：`credentials.resolve('DEEPSEEK_WEB_TOKEN')` 取出 token，再用 `fetch` 发给 chat.deepseek.com。
  这条无法通过改代码消除（除非不做拉取）；能做的只有**约束范围**：token 只进 DSH 凭据服务、只在这一次请求里用、永不写进文件/日志/响应；出网目标只有 chat.deepseek.com 一个域名。
- `fs-write`：写知识库（`conversations/*.md`、`conversations.jsonl`、`catalog.json`），全部落在配置的知识库目录内，越界即拒（有单测）。
- `network (outbound)`：命中来自 `lib/deepseek.js` 里那两个接口调用；外加控制页在浏览器里的同源 `fetch`。
- `credentials` / `env`：前者是上面那条红线；后者是可选的根目录环境变量。
- 按该工具的规则，**红线默认应挡住**；你要继续用就得在 **设置 → 插件体检** 里对该插件点"确认风险"（指纹随代码变化会失效，需要重新确认）。
- 未检出不等于安全：静态扫描看不到运行时行为。逐条核对与局限见 [`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md)。

## 已知限制

- **纯 host 半部**：没有设置页内的分节 UI（那需要 React 客户端半部 + 构建步骤），控制页是独立 URL。
- 需要宿主提供 `subprocess` 服务；缺失时 `/run`、`/doctor` 会明确报错，而不是静默失败。
- 状态是轮询（运行中 3 秒一次），不是推送。
- 界面文案目前是中文。
- 已在 Windows + DSH 0.2.0-rc.2 上实测：控制页、`/status`、`/doctor`、越界与跨站拒绝；POSIX 执行分支已写但未实测；`/run` 的**成功路径**未在真机点过（它会真的跑一次同步，可能耗时并消耗你自己的额度）。
- **拉取只做增量**：列表接口的游标在服务端失效（无论传什么游标都只回最新 100 条），所以第一版保证的是「往后每天长」；**全量历史回填**（走官方导出 zip）还没做。
- `userToken` 会过期（数小时~数天）：过期后拉取报错，重新粘一次即可；它是你的账号凭据，不要外传。
- **与已有脚本共用知识库目录时注意**：两边都会重写 `catalog.json` / `conversations.jsonl`（各自读-改-写），建议二选一，或把 `outDir` 指到别的目录避免互相覆盖。
- 检索是**直接扫 JSONL、不建索引**（几千会话够快）；会话量再涨一个量级要换方案。

## 开发

```sh
node --test        # 14 个用例：路由、同源守卫、越界拒绝、argv 构造、凭据文件不读正文、体检命令可配置
```

## English summary

A DeepSeek Harness plugin with two halves. **Pull**: it reads the DeepSeek web `userToken` from the DSH credential service, calls chat.deepseek.com, and normalizes conversations into a local knowledge base (markdown + JSONL + catalog) with in-plugin search. **Orchestrate**: it runs and monitors a sync/integrity command you already own. Static capability disclosure (`dsh-trust-check`): **1 red line** — "reads credential values and has network access", which the pull half cannot avoid; the token never leaves the credential service for any file, log, or response, and the only outbound host is chat.deepseek.com.

## License

MIT
