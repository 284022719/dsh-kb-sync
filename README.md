# dsh-kb-sync

**中文** ｜ [English](README.en.md) ｜ [更新日志](CHANGELOG.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：把**你自己已有的同步流水线**搬到一个同源控制页——一键运行、看状态、看日志、跑完整性体检。

典型的流水线是「网页端对话历史 → 本地知识库」，但插件本身不关心你同步什么。

> **定位：一个插件，三块能力。**
> **① 自己拉取**：用你存在 DSH 凭据服务里的网页端 `userToken` 调 chat.deepseek.com，把对话规范化落到本地知识库，并在插件内检索 —— 这一块**读凭据值、会出网**（见下方能力披露，`dsh-trust-check` 判为**红线**）。
> **② 编排**：起你已有的同步/体检命令、读状态与日志 —— 这一块不读凭据、不出网。
> **③ 段 2 判断**：把管线里「让模型做判断」那一步搬进进程内（准备输入 → 调宿主 `llm` 服务拿一份 JSON → 校验通过才落盘/重建）—— 不读凭据；出网走宿主 `llm` 适配器，域名由你配的提供方决定，插件自己不写死。
> 三块都不注入提示词、都不改核心 bundle、都没有安装脚本（逐项对照见 [`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md) 第一节）。

![dsh-kb-sync 用法与边界：浏览器 → 插件路由 → 你的同步命令 → 状态文件与你的产物](docs/architecture.svg)

<sub>⚠️ 这张图只画**编排半**（阶段 1 的画法）：虚线框里是插件当时对外的 5 个路由与只读状态文件，出网与凭据都在绿色框里 —— 你自己那条命令中。**拉取半（读凭据、连 chat.deepseek.com）与段 2（调宿主模型）都不在图上**，别把它当成全部作用域；全部路由见下方路由表。</sub>

## 它做什么 / 不做什么

| | 说明 |
|---|---|
| ✅ 做（编排半） | 用 DSH 的 `subprocess` 起你配置的命令；读状态文件与日志展示进度；跑你指定的完整性体检命令；全部通过一个本地控制页操作 |
| ✅ 做（拉取半） | 用 DSH 凭据服务里的 `userToken` 调 chat.deepseek.com：拉会话列表 → 只取新增/续聊的线程（`chat_session.current_message_id` 权威定位末端）→ 规范化成 `conversations/*.md` + `conversations.jsonl` + `catalog.json` → 插件内检索 |
| ✅ 做（段 2） | 进程内跑管线的判断步骤：准备输入 → 调宿主 `llm` 服务拿 JSON → 用管线的 `apply-extraction.mjs` 校验 → 通过才落盘并重建；默认只校验不落盘 |
| ❌ 不做 | 不把 token 写进任何文件/日志/响应（只进凭据服务）；拉取半不访问 chat.deepseek.com 之外的任何地址（段 2 出网走宿主 `llm` 适配器，地址由宿主配置决定）；不读凭据文件（那个会过期的 `.token`）的正文、只 `stat` 它的修改时间；不注册提示词段落；不改核心 bundle；无安装脚本、无运行依赖 |

## 目录结构（一个自包含的文件夹）

```
dsh-kb-sync/
├─ lib/                  插件代码：index（路由+整链）/ client（客户端半部：设置页分节）/ locale（多语言）/ deepseek（接口）/ export（回填）/ store（落盘）/ page（界面）/ pipeline（整链判定）/ process（段 2）
├─ locale/               控制页译文（`en.json` —— 中文是源语言，键就是中文原文）
├─ docs/                 能力披露与架构图
├─ test/                 单测（node --test，67 例）
├─ tools/                发布脚本（publish.ps1 / publish.cmd）
├─ config.example.json   配置样例 —— 复制成 config.json 就生效（配置跟着代码走）
├─ data/kb/              **知识库默认就落在这里**（不入库；可配 outDir 改到别处）
├─ package.json / cordis.patch.yml / README.md / README.en.md / CHANGELOG.md / LICENSE
```

> 上面是**源码仓库**的样子。安装包（`package.json` 的 `files` 白名单；2026-10-12 实测
> `npm pack --dry-run` 共 **118** 个文件 / 394 KB）里有 `lib/`、`locale/`、`docs/`、`tools/pipeline/`、
> `cordis.patch.yml`、`config.example.json`、`CHANGELOG.md`、`README.md`、`README.en.md`、`LICENSE`
> —— **`test/`、`tools/publish.*`、`data/` 不在其中**（`config.example.json` 自 0.1.0 起随包发布；
> 更早装的快照里没有它，那就直接新建 `config.json`）。

## 适配你的流水线

插件对你现有的脚本只有**一个硬要求**：一个可执行的同步命令。其余都是可选的，缺了对应功能自动降级、不会报错崩掉：

| 你提供的东西 | 插件用它做什么 | 缺失时 |
|---|---|---|
| 同步命令：`sync/sync-daily.{cmd,ps1,sh}`，或 `syncScript` 显式指定 | `/run` 按钮 | `/run` 返回 `sync-script-missing`，其余功能照常 |
| 日志目录（默认 `sync/logs/`） | `/log` 与「最新日志」 | 状态里不显示日志 |
| 进度文件（默认 `sync/LAST-SYNC.txt`） | 状态里的「最近几次结果」 | 跳过该栏 |
| 一个会过期的凭据文件（默认 `.token`） | **只读它的 mtime**，换算成「年龄天数 / 是否偏旧」 | 跳过该栏 |
| 体检命令（默认 `<kbDir>/tools/kb.mjs doctor`） | `/doctor` 按钮 | 找不到脚本时 `/doctor` 返回 `doctor-script-missing`（没有单独的关闭开关；`doctorScript` 留空只会回落到默认路径，不等于禁用） |

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
    # kbDir:        '...\data\kb'               # 体检脚本的落点（默认＝知识库目录本身）
    # doctorScript: '...\tools\kb.mjs'          # 任何可执行脚本都行
    # doctorArgs:   ['doctor']
    # nodeBin: 'node'
    # timeoutMs: 3600000
    # —— 段 2（阶段 2：进程内调宿主 llm 服务）——
    # pipelineDir:     '<插件目录>\tools\pipeline'  # 管线脚本目录（默认就推到这里）
    # processProvider: 'deepseek-official'          # 不配就取第一个已注册提供方
    # processModel:    'deepseek-v4-flash'          # 不配就取该提供方目录里的第一个模型
    # processMaxTokens: 4096
    # —— 段 3（阶段 3：整链的新鲜度闸门）——
    # chainMinIntervalMs: 21600000                  # 距上次成功不足这么久就整链 skipped（默认 6 小时；页面按钮用 force 绕过）
```

**方式二：插件文件夹里的 `config.json`**（推荐——配置跟着代码走，整包拷走也不丢）

```jsonc
// <插件目录>/config.json   （可先复制同目录的 config.example.json 改名；更早装的快照里没有那个样例文件，直接新建即可）
{ "root": "D:\\path\\to\\pipeline", "outDir": "data/kb", "tokenOldDays": 21 }
```

**方式三：设置文件**（有些 profile 会在重启时重写自己的 `cordis.patch.yml`，手写的 loader 行会丢；设置文件不会）

```jsonc
// $DSH_HOME/.dsh-kb-sync.json    （未设 DSH_HOME 时即 ~/.dsh/.dsh-kb-sync.json）
{ "root": "/srv/pipeline", "tokenOldDays": 14 }
```

**方式四：环境变量** `DSH_KB_SYNC_ROOT` / `DSH_KB_SYNC_OUT_DIR` / `DSH_PIPELINE_DIR`。

**优先级**：loader `config` → 环境变量 → 用户设置文件 → **插件文件夹里的 `config.json`** → 内置默认。文件缺失或 JSON 坏掉都按空处理（不影响加载），读到哪些会在 `/status` 的 `configFile` 字段里报告（`used` / `localUsed`）。

> ⚠️ **改完配置要重启应用才生效。** `resolveSettings()` 只在插件**加载时**跑一次，配置缓存
> 在内存里 —— 改文件后 `/status` 仍会报旧的 `syncScript`（2026-10-12 实测：把 `syncScript`
> 换成 `trigger.cmd` 后，`/status` 继续显示已退役的 `sync-daily.cmd` 并报 `configured:false`）。
> 页面上的其它按钮不受影响（它们读的是同一份内存配置），但"运行已有同步脚本"要等重启才切到新入口。

### 数据落在哪（自包含）

**默认就是插件文件夹内**：`<插件目录>/data/kb/`（`conversations/*.md` + `conversations.jsonl` + `catalog.json`）。
所以插件不与别的脚本共用知识库目录、也不会互相覆盖 —— 想复用别人的库才需要显式配 `outDir`。

```jsonc
// 例：把知识库放到别处（或复用一个已有库）
{ "outDir": "D:\\dsh\\knowledge-base" }
```

POSIX 示例（`syncScript` 指向 `.sh` 时用 `/bin/sh` 执行）：

```jsonc
{ "root": "/srv/kb-pipeline", "syncScript": "/srv/kb-pipeline/sync/daily.sh", "logDir": "/srv/kb-pipeline/sync/logs" }
```

## 使用

打开 **`http://127.0.0.1:<你的 DSH Web 端口>/__dsh-kb-sync/`**（与 GUI 同一个端口）。页面 = 顶部一排按钮 + ①–⑤ 五段，另加 4 张不编号的卡（状态 / 知识库 / 最近日志 / 知识库体检）：

> 也可以不开页面：应用内 **设置 → dsh-kb-sync** 有一份同样的状态摘要（配置 / 根目录 / 知识库目录 / 凭据年龄 / 知识库规模 / 是否在跑）和三个动作——**拉取增量 / 跑整链 / 打开控制页**。它跟随界面语言显示中文或英文；**不提供配置编辑**（配置在插件加载时解析一次，改完要重启，页面能改反而会骗人）。

> **语言**：控制页默认中文；`?lang=en` 强制英文，不带参数时跟随浏览器的 `Accept-Language`（不认识的语言回落中文），页面右上角可切换。中文是**源语言**——页面里写的就是译文表的键（`locale/en.json`），缺译自动回落中文，所以加语言不用改页面代码。

**① 网页端登录态** —— 粘贴一次 `userToken`，它只进 DSH 凭据服务（本机就是 `$DSH_HOME/.credentials.yaml`，由宿主保管；插件自己不把它写进任何文件，日志与响应里也永不带它）。

**② 拉取**
- **拉取新对话（增量）**：会话列表 → 只取「新增 / 续聊」的线程 → 写 `conversations/*.md` + `conversations.jsonl` + `catalog.json`；续聊就地更新、文件名不变。
- **全量回填**：走官方导出包（`export_all` → 轮询到就绪 → 下载 zip → 解析 `conversations.json`）。只在第一次需要完整历史时用；已有会话仅在导出内容更多时才更新。服务端生成导出可能要几分钟，所以它在后台跑，页面每 3 秒刷新阶段：`trigger → waiting-export → downloading → parsing → merging → done`。

**③ 检索** —— 关键词搜标题与正文，可勾「只看用户说的话」；每条命中都可点「展开全文」，直接在页面里读那个会话的完整 Markdown（思考过程与联网检索记录都在）。

**④ 一键整链（阶段 3：调度与通知归插件）** —— 按顺序跑 **Token 检查 → 只读侦察 → 抓取落盘 →
段 2 判断/校验/落盘/重建 → 知识库体检**，每一段都有独立结论、退出码与耗时，页面出表格；
失败时那一行直接写明原因（`token-expired` / `failed` / `spawn-failed` / `finished-with-crash`）。

- **计划任务是可选的外部触发器，它只负责"戳一下"**：`DSH-KB-DailySync` → `tools\pipeline\trigger.cmd` → `POST /pipeline`。
  触发器从 `trigger.json`（插件按真实监听端口写）读地址，先轮询 `/status` 等宿主起来（登录时补跑不会误报失败），
  再把逐段结果追加进 `trigger.log`。**它自己不编排任何东西**，`dsh headless` 已完全不在链上。
  > 本机 2026-10-12 起**已删除该计划任务**（用户取消了每天 21:00 的自动抓取），所以现在整链只有手动入口：
  > 页面上的「跑整链」按钮，或双击 `tools\pipeline\trigger.cmd`。想恢复自动或换个时间，见
  > [`tools/pipeline/README.md`](tools/pipeline/README.md) 第三节的重建命令。
- **新鲜度闸门**：距上次成功不足 `chainMinIntervalMs`（默认 6 小时）时整链返回 `skipped`，
  不再重复拉取与轮转备份；页面按钮走 `force:true` 跳过这个闸门。
- **通知并入状态页**：整链的结论文案（`chain.report.notify`，与退役的 `notify.ps1` 逐句相同）显示在页面上；
  桌面气泡不再是必需环节。

**⑤ 段 2 判断（阶段 2：进程内调宿主模型）** —— 两个按钮：

- **只校验（dry-run，不落盘）**：准备输入 → 调宿主 `llm` 服务拿一份 JSON 判断 → 写 `sync/out/` → 跑管线自己的
  `apply-extraction.mjs` 校验。**默认就是这个模式**，用来先看清"会写哪些文件、各几条"。
- **跑并落盘 + 重建**：校验通过后落盘，并依次重建知识库（`apply-update-topics` / `build-kb` / `build-specialties` / `map-specialties`）
  与健康档案（`build-health-profile` / `sync-knowledge`）。

为什么值得替换掉 `dsh headless`：不再需要第二个 DSH 运行时、不再需要那份单独的 `.dsh-home` 与凭据副本、
也不再依赖"工作区只写自己目录内"那套沙箱前提。**模型仍然只做判断、产出仍是先落盘再校验的 JSON** ——
这条规矩是刻意的：让模型直接改 `health/` 或财务台账，钱的数字悄悄错掉很难发现。

工具栏上的「刷新状态 / 运行已有同步脚本 / 跑知识库体检」这三个按钮仍属编排半（同一排里另两个按钮是拉取）。

| 路由 | 方法 | 作用 |
|---|---|---|
| `/__dsh-kb-sync/` | GET | 控制页（单文件 HTML，无外部请求） |
| `/__dsh-kb-sync/status` | GET | 状态 JSON：路径、凭据文件年龄、进度文件末 8 行、最新日志尾部、拉取/回填/段 2/整链进度 |
| `/__dsh-kb-sync/pipeline` | POST | **整链**（token→recon→fetch→process→doctor）；`{"apply":true}` 落盘并重建，`{"force":true}` 跳过新鲜度闸门 |
| `/__dsh-kb-sync/token` | GET / POST | 查 / 存 userToken（GET 只回「配没配」，**永不回值**） |
| `/__dsh-kb-sync/token/clear` | POST | 清除已存的 userToken |
| `/__dsh-kb-sync/pull` | POST | 增量拉取，同步返回本轮摘要 |
| `/__dsh-kb-sync/backfill` | POST | 启动全量回填，立即返回 202（进度看 `/status`） |
| `/__dsh-kb-sync/kb` | GET | 知识库状态（条数 / 大小 / 最近一次拉取） |
| `/__dsh-kb-sync/search?q=&role=` | GET | 检索；`role=user` 只看用户发言 |
| `/__dsh-kb-sync/conversation?id=` | GET | 取一个会话的完整 Markdown（超过 400 KB 截断并标注） |
| `/__dsh-kb-sync/run` | POST | 启动你已有的同步命令；已在运行时返回 409 |
| `/__dsh-kb-sync/process` | POST | 段 2 判断；默认 dry-run，`{"apply":true}` 才落盘并重建。进行中返回 409 |
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
dir: <path-to-this-repo>
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
  injections: 1 item(s)
    client-inject: @deepseek-ai/dsh-client-locale, @deepseek-ai/dsh-client-ui-settings
  source: unpinned | git+https://github.com/<owner>/dsh-kb-sync.git
  evidence: 40 hit(s)
```

怎么读这份报告（**这次是真有红线，别跳过**）：

- **红线：读凭据值 + 有网络** —— 这是"自己拉取"那一块的必然结果：`credentials.resolve('DEEPSEEK_WEB_TOKEN')` 取出 token，再用 `fetch` 发给 chat.deepseek.com。
  这条无法通过改代码消除（除非不做拉取）；能做的只有**约束范围**：token 只进 DSH 凭据服务、只在这一次请求里用、永不写进文件/日志/响应；**拉取半**的出网目标只有 chat.deepseek.com 一个域名（段 2 出网走宿主 `llm` 适配器，见 [`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md) 第一节）。
- `fs-write`：写知识库（`conversations/*.md`、`conversations.jsonl`、`catalog.json`），全部落在配置的知识库目录内，越界即拒（有单测）。段 2 另有写入（管线的 `sync/out/` 与档案候选 JSON），清单见能力披露第一节。
- `network (outbound)`：命中来自 `lib/deepseek.js` 里那两个接口调用；外加控制页在浏览器里的同源 `fetch`。
- `credentials` / `env`：前者是上面那条红线；后者是可选的根目录环境变量。
- 按该工具的规则，**红线默认应挡住**；你要继续用就得在 **设置 → 插件体检** 里对该插件点"确认风险"（指纹随代码变化会失效，需要重新确认）。
- 未检出不等于安全：静态扫描看不到运行时行为。逐条核对与局限见 [`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md)。

## 已知限制

- **应用内只有一个设置分节**：`lib/client.js` 在 **设置 → dsh-kb-sync** 注册一节（状态几行 + 「拉取增量 / 跑整链 / 打开控制页 / 刷新」），手写、无构建步骤；完整的控制页仍是独立 URL（那里才有检索、全文展开、逐段表格）。
- 客户端分节**不做配置编辑**（配置读的是插件启动时解析的那一份，改配置要重启；页面上能改反而会骗人）。
- **控制页与应用内分节都支持中英**：控制页默认中文、`?lang=en` 或浏览器 `Accept-Language` 切换；设置分节跟随宿主界面语言。**服务端的诊断文案（`/status` 的 message、整链各段输出、流水线脚本自身的输出）仍是中文**——它们是排错信息，翻译收益低、改动面大，暂不翻。
- 需要宿主提供 `subprocess` 服务；缺失时 `/run`、`/doctor` 会明确报错，而不是静默失败。
- 状态是轮询（运行中 3 秒一次），不是推送。
- 已在 Windows + DSH 0.2.0-rc.2 上实测：控制页、`/status`、`/doctor`、越界与跨站拒绝；POSIX 执行分支已写但未实测。
- **2026-10-12 晚：页面那几条路也在真机跑过了**（读数取自 `/status`）—— 一键整链 **21:21:04→21:21:09**（5 段全 `ok`）、`/process` **21:21:39**（自动选中 `deepseek-official` / `deepseek-flash`）、**全量回填 21:23:04→21:25:23 跑完**（真实导出包 25.6 MB / 2549 条会话，0 新增、0 更新、2549 skipped、`errors: []`）、`/run` 的成功路径跑通（`trigger.log` 有 `rc=0`；页面按钮与双击走的是同一条 `trigger.cmd`）。
  > 读法：这几轮上游**没有新内容**（`fetch` 报"没有需要更新的内容 ✔"、段 2 报"本轮条目 0"），所以它们证明的是**管道通 + 幂等 + 跳过路径**，而不是"一次产出新内容的运行"；真正写盘的那几轮看 `data\kb\catalog.json`（2556 条）与 `data\import\knowledge\*.backup-*` 的轮转。
- **拉取有两条路**：日常用**增量**（列表接口 `chat_session/fetch_page` 实测：`count` 上限 **100**，超过报 `ILLEGAL_COUNT`；`page`/`offset`/`page_num`/`seq_id`/`cursor` 全被忽略、`POST` 405 —— **这条路翻不了页**，2026-10-12 实测，所以增量只保证「往后每天长」）；要**完整历史**用**全量回填**（官方导出包）。回填的解析器已对着真实导出包实测：2446 条会话全部解析，最后一条是助手回复的占 **2442/2446**（若按时间戳找叶子，会有几百条停在提问上、丢掉最后一条回答——这正是导出包的已知坑）。
- `userToken` 会过期（数小时~数天）：过期后拉取报错，重新粘一次即可；它是你的账号凭据，不要外传。
- **默认不共用知识库目录**：插件的库在它自己的 `data/kb`。只有你显式把 `outDir` 指到与别的脚本同一个目录，才会出现两边互相重写 `catalog.json` / `conversations.jsonl` 的情况（各自读-改-写）。
- 检索是**直接扫 JSONL、不建索引**（几千会话够快）；会话量再涨一个量级要换方案。

## 开发

```sh
npm test           # node --test：全部 67 个用例
                   #   插件路由/同源守卫/越界拒绝/argv 构造/凭据文件不读正文/时间口径/语言接线（27）
                   # + 客户端半部契约：加载 id、字典中英对齐、settings.section 注册、守卫头（8）
                   # + 多语言：译文表完整、键对齐、占位符一致、英文页无未翻译中文、内联脚本可解析（8）
                   # + 段 2 的 JSON 修复与出件合并（15）+ 整链的阶段判定（9）
npm run check      # 逐文件语法检查 lib/*.js（含 client.js / locale.js）+ 管线两个入口 + ESM import 冒烟
npm run pack:check # npm pack --dry-run：看发布包内容
```

## English summary

A DeepSeek Harness plugin with three capability blocks. **Pull**: it reads the DeepSeek web `userToken` from the DSH credential service, calls chat.deepseek.com, and normalizes conversations into a local knowledge base (markdown + JSONL + catalog) with in-plugin search. **Orchestrate**: it runs and monitors a sync/integrity command you already own. **Segment 2**: it runs the pipeline's judgement step in process through the host `llm` service — prepare the inputs, get one JSON judgement, validate it with the pipeline's own script, and only then write and rebuild. Static capability disclosure (`dsh-trust-check`): **1 red line** — "reads credential values and has network access", which the pull half cannot avoid; the token never leaves the credential service for any file, log, or response, and the pull half's only outbound host is chat.deepseek.com.

**完整英文说明见 [`README.en.md`](README.en.md)。**

## License

MIT
