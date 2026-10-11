# 每日自动同步：网页端对话 → 本地知识库

> **本文档已随 2026-10-12 的迁移更新（阶段 1）。** 代码在本目录（`D:\dsh\dsh-kb-sync\tools\pipeline\`），
> 运行时数据在 `D:\dsh\dsh-kb-sync\data\import\`，token 在仓库外。下面第一之三 / 一之四两节
> 里仍留有 `D:\dsh\deepseek-import` 的**历史报错原文与生效日志**（它们记的是当时那一刻的事实，
> 刻意不改）；凡是指路的命令与路径都已换成新地址。旧目录整体搬到了
> `D:\dsh\_archive\deepseek-import-retired\`。

把你在外面（手机/公司电脑）用 chat.deepseek.com 产生的对话，**每天自动**吸收进本地知识库。

## 一、它做什么

```
Windows 任务计划程序  DSH-KB-DailySync  每天 21:00
        │
        ├─ 段 1（纯 Node，零 token，不依赖 LLM）
        │    node recon-update.mjs 1     只读侦察：新增/续聊了多少
        │    node update-from-api.mjs    拉取 → 写 Markdown + 更新 catalog/jsonl
        │    ✅ 做完，知识已落盘，可被 grep / read 检索
        │
        └─ 段 2（用 dsh headless，消耗额度）
             2a  headless 只做「判断」，把 JSON 写到 sync\out\
                 · 新会话归类
                 · 健康事实候选（health-digest）
                 · 财务事实候选（finance-digest）
             2b  本地脚本校验并应用，然后重建知识库与健康档案
```

**两个领域的提炼规则**（硬性规则都写在 `headless-prompt.md` 里）：

| | 健康 | 财务 |
|---|---|---|
| 摘要来源 | `health-digest.md` | `finance-digest.md` |
| 挑选范围 | **只挑本轮** 新增/续聊里的相关会话 | 同左（财务关键词） |
| 产出 | `health-facts.json` | `finance-facts.json` |
| 落点 | `health-facts/manual-<日期>.json` | **`finance/data/candidates.jsonl`（只进候选区）** |
| 是否自动生效 | 是（随后重建档案） | **否——必须由你在财务看板确认后才入账** |

> ⚠️ **财务为什么只写候选、不自动入账**：财务台账的规矩是「每个数字带 `asOf` 与出处、同一指标的多口径全部保留、不合并不取平均」。让模型直接改 `profile.json` / `debts.json` 会破坏这套规矩，而钱的数字一旦悄悄错掉很难发现。所以段 2 只把候选追加到 `candidates.jsonl`。
>
> 候选体积很小、只追加不覆盖；重复抽取会按 `dedupeKey`（topic+label+值+asOf+出处）自动跳过，反复运行不会堆积。
>
> 另外：候选写入是**逐条容错**的——某一条缺字段只跳过那一条并记一条 warning，不会因为一条坏记录把整批丢掉。（归类不一样，idx 集合必须与输入完全一致，错一条就整体不落盘。）

**设计原则**：段 1 不花钱、不会因模型问题失败；段 2 才消耗额度。两者分离，所以段 2 出错也不影响「对话已经落到本地」。

## 一之二、为什么段 2 是两段式（2026-10-09 实测后改的）

最初让 headless 直接跑构建脚本，**实测行不通**：

| 探针结果 | 原因 |
|---|---|
| 写 `sync\`（工作区内）✅ | 正常 |
| 写 `D:\dsh\dsh-kb-sync\data\kb` ❌ | headless 默认 `workspace-write`，工作区 = `D:\dsh\dsh-kb-sync\data\import`，工作区外一律拒绝 |
| 写 `D:\dsh\health` ❌ | 同上 |
| 提权 | `sandbox escalation to "danger-full-access" requires approval, but no approval channel is available` |

**关键结论：任何依赖「提权」的设计，在无人值守下必然失败**（没有审批通道）。因此改成：

- **2a headless**：只读 `sync\inbox\`，只写 `sync\out\`。产出纯判断（归类 JSON、健康事实 JSON、专题建议 JSON、摘要）。**不提权、不写工作区外、不跑构建脚本。**
- **2b 本地脚本**（不受沙箱限制）：`apply-extraction.mjs` 校验 JSON（idx 集合是否一致、话题是否合法、专题 parent 是否匹配），**校验不通过就不落盘并以退出码 2 中止**；通过后落位，再跑所有会写 `knowledge-base\` 与 `health\` 的构建脚本。

好处：不需要审批、最小权限、LLM 产出在应用前是可检查的 JSON、不受 DSH 权限默认值变化影响。

> 附带修好的两个 bug：
> 1. `prep-health-update.mjs` 原来用 `idx >= 2446` 选健康会话（=「首轮导入之后的一切」，实测每轮会重摘 20 个旧会话）。现改为只取 `update-new-items.json` 的 `added` / `changed`（**本轮**变化），实测降到 1 个。
> 2. `update-from-api.mjs` 在「没有需要更新的内容」时原来直接退出、不写清单，下游会读到上一轮的 stale 文件。现在会写一份空清单。

## 一之三、Windows 文件权限问题（已修复）

首次验证时 headless **连 `node` 都跑不起来**：

```
Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\dsh\dsh-kb-sync\data\import)
```

原因是 `D:\dsh\dsh-kb-sync\data\import` 缺少**有效 WRITE_OWNER 权限**，沙箱无法为工作区授予写权限。用 `diagnose-windows-sandbox-acl` 技能诊断并修复后（为该目录加上当前用户的完全控制项），`node` 恢复正常：`FIXED=0 GRANTED=1 REFUSED=0`，验证 `writeOwner: true, writeDac: true`。

**备份与回滚**：改动前的原始权限备份、回滚脚本与诊断报告，2026-10-10 已统一收进
`D:\dsh\_archive\acl-recovery\`（按操作分目录）：
`acl-backup-c384c61bd5b54f08b03b4133e8318148.json` + 同名 `.json.ps1`（回滚脚本，
`-Restore` 指回该 json）与 `acl-report-e68f7c011cfa4f0d8a9d59a36b3cd321.jsonl`
—— 就是本次为 `D:\dsh\dsh-kb-sync\data\import` 授权的那一次。同目录另存了当时那份
`run-console.txt`（RECAP 里的回滚命令也在其中）。索引见 `_archive\acl-recovery\README.md`。
（旧路径 `D:\dsh\acl-reports\` 与 `D:\dsh\acl-recovery\`、`D:\dsh\dsh-acl-recovery\`
三个目录已不复存在，合并到上面这一处。）

## 一之四、会话隔离：自动化不再污染 GUI 的「未分组」（2026-10-09）

段 2a 的 `dsh headless` 原来跑在交互式 home（`~\.dsh`）里。它的 cwd 是
`D:\dsh\dsh-kb-sync\data\import`，而这个目录**没有注册成工作区**，于是每次自动运行都会在
GUI 侧栏的「未分组」下多出一条会话，标题取提示词首句（「你的任务：为刚抓取下来的网…」）；
累计 8 条，全部来自自动化（6 条段 2 判断 + 2 条权限探针），不是人工对话。

修法：给流水线一个**独立 DSH_HOME**——`sync-extract.cmd` 里 `set "DSH_HOME=<data\import>\.dsh-home"`。
该 home 只需要两样东西，且已播种：

| 内容 | 说明 |
|---|---|
| `.credentials.yaml` | 模型凭据。缺了它 `.cmd` 会在 `---- headless ----` 处直接判失败并记日志 |
| `profiles\headless\` | 从 `~\.dsh\profiles\headless` 复制（4 个小文件，无 node_modules；bundle 来自 dsh 安装本身） |

已实测整条链路：`cmd` 里 `set DSH_HOME` → `pwsh` → `dsh headless` 都看得到该变量，
运行 `exit=0`，新会话落在 `.dsh-home\sessions\`，交互式 home 的会话数不再增长。

> ⚠️ 不要去掉这一行。任何**绕过它**的 headless 调用（例如手工在 `D:\dsh\dsh-kb-sync\data\import`
> 里直接跑 `dsh headless`）仍会落进「未分组」。
>
> ⚠️ `.credentials.yaml` 是**复制**不是链接：主 home 里换 key/token 后，要同步更新
> `.dsh-home\.credentials.yaml`，否则段 2 会因鉴权失败而中止。

## 一之五、段 2a 当前不通：`dsh: TRANSPORT: DeepSeek Messages transport failed`（2026-10-12 实测）

阶段 1 迁移后的验收跑（`sync-daily.cmd`，2026-10-12 02:23）：
**段 1 ✅ → prep-inbox ✅ → headless ❌ → apply ✅ → 重建知识库 ✅ → 重建健康档案 ✅ → kb doctor ✅（退出码 0）**。

headless 那一步失败，原文只有两行：

```
[dsh-cost-meter] OpenRouter 价格刷新失败(保留本地价格): fetch failed
dsh: TRANSPORT: DeepSeek Messages transport failed
```

**这是既有问题、不是迁移引入的**（判据：`DSH_HOME` 换成交互式 `~\.dsh` 重跑，同样两行、同样退出码 1）。
两次都失败，所以不是 `.dsh-home` 缺 `DEEPSEEK_WEB_TOKEN`（那份凭据 2026-09-30 之后没再同步过，
但它不是决定因素）。待查方向：headless profile 走的 Messages transport 与模型端点/凭据是否匹配。
`.cmd` 的失败分支是好的：那一次 `LAST-SYNC.txt` 里落了 `2026-10-12 02:23:46  segment2-failed`，
桌面气泡也弹了 —— 不是静默失败。

**方案里的阶段 2 正是治它的**：段 2 改调宿主 `llm` 服务，`dsh headless` 与独立 `.dsh-home` 一起退役，
这条 TRANSPORT 失败随之消失。在那之前，每次夜跑只会损失「归类 / 健康提炼」，**对话与知识库照旧落盘**。

> 实测记录（1 次）：把 `DSH_HOME` 指向交互式 home 的那次探针，在 GUI 侧栏的「未分组」下**多留了一条会话**
> （`~\.dsh\sessions` 204 → 205 条）。它就是那次的 headless 运行，可手动删掉；教训照旧：
> 别拿交互式 home 跑 headless。

## 一之六、段 2 已改成进程内调宿主模型（2026-10-12，方案阶段 2）

`dsh headless` 那一环被 `dsh-kb-sync` 插件的 `POST /__dsh-kb-sync/process` 取代 —— 一个流、一次请求，
不再需要第二个 DSH 运行时、独立的 `.dsh-home`、凭据副本，也不再依赖"工作区只写自己目录内"那套沙箱前提。

```
prep-inbox.mjs（原样复用，输入还是 sync\inbox\）
  → llm.stream({ provider, model, messages, system: extract-prompt.md })
  → 写 sync\out\{update-topics,health-facts,finance-facts,specialty-suggestions}.json + summary.md
  → apply-extraction.mjs --dry-run   （校验：idx 集合 / 话题合法性 / 专题 parent）
  → apply-extraction.mjs --apply + 重建脚本（只有点「跑并落盘」才走这一步）
```

**刻意的边界（一条都没放松）**：模型只产出 JSON，从不直接改档案；落盘前必过 `apply-extraction.mjs`；
财务只进候选区；页面上默认那个按钮就是 dry-run。

`headless-prompt.md` 留在本目录当历史件（它描述的是"写 5 个文件"的旧形状）；新形状是**一个 JSON 对象**，
契约在 `extract-prompt.md`。`ENABLE-SEGMENT-2.flag`、`.dsh-home`、`sync-extract.cmd` 现在只有旧的
`sync-daily.cmd` 还在用 —— 等夜跑链路也改到插件路由（方案阶段 3）后即可整体退役。

**路径注意**：这条链由**插件**发起，`settings.pipelineDir` 默认指向
`node_modules\dsh-kb-sync\tools\pipeline\`（即安装快照里的那份），所以改完管线脚本要么重装 bundle、
要么把改动同步进快照；数据仍只写在 `D:\dsh\dsh-kb-sync\data\import\`（由 `pipeline.json` 决定）。

### 验收实测（2026-10-12）

| 环节 | 结果 |
|---|---|
| `apply-extraction.mjs --dry-run`（9 条真实会话、手写一份"看起来合理"的归类） | ✅ 全部校验通过、**未写盘**（`update-topics.json` 的 mtime 未变） |
| 缺 7 条 idx | ✅ 报「归类缺 7 条」、退出码 2、不落盘 |
| 非法话题 | ✅ 报「非法话题 1 个」、退出码 2、不落盘 |
| 坏 JSON | ✅ 报「不是合法 JSON」、退出码 2、不落盘 |
| **模型那一环（`POST /process`）** | ✅ 17.4 s 返回 `ok:true`：归类 9 / 健康事实 1 / 财务候选 0 / 专题建议 1 —— 与输入清单逐条对齐 |
| **落盘 + 重建** | ✅ `applied:true`，6 个重建脚本 `apply-update-topics` / `build-kb` / `build-specialties` / `map-specialties` / `build-health-profile` / `sync-knowledge` **全部 exit 0** |
| 落盘物核对 | ✅ `final-topics.json` 里 2540–2548 全部有了归属；`health-facts\manual-2026-10-11.json`（1 条「吃辣后胃疼／用户自述」）；`specialties-map.json` 1 条；`sync\logs\extract-2026-10-11.md` |
| `kb.mjs doctor` | ✅ exit 0（jsonl 2549 / catalog 2549 / md 2549） |

**这一轮实测暴露并修掉的 4 个静默失效**（都写进提交信息）：① 收件箱漏拷 `update-new-items.tsv`，
模型被告知"本轮没有新会话"；② 校验器在 dry-run 下拿磁盘旧状态判专题建议，4 条全被误拒；
③ `pipeline.json` 里单反斜杠是非法 JSON，整个文件解析失败 → 路径**静默**回落默认值；
④ `sync-knowledge.mjs` 从数据目录推健康控制台路径，而控制台已搬到 `控制台中心\`。
另修 `kb.mjs doctor` 的一处误报（文件名含 `.md` 被截断 → 假"悬空链接"）。

> ⚠️ **本轮不改一件事**：`/process` 应用后**不清空** `update-new-items.json`（那是段 1 的产物，
> 由下一次同步覆盖）。所以连按两次「跑并落盘」会把同一批条目再送一遍 —— 归类幂等（已在话题里的跳过），
> 健康事实会再落一份新的 `manual-<今天>.json`。要连跑就用「只校验」。**待办**：给 apply 加"本轮已处理"
> 标记，属方案阶段 3 的范围。

## 一之七、整链、调度与通知都归插件了（2026-10-12，方案阶段 3）

**一条链在插件进程里跑完**，计划任务只负责"戳一下"：

```
Windows 任务计划 DSH-KB-DailySync  每天 21:00（StartWhenAvailable）
  └─ tools\pipeline\trigger.cmd
       读 trigger-source.json（插件在加载时写）→ 知道插件真正住在哪
       轮询 <插件>/status 直到宿主应答（~3 分钟，登录补跑不会误报失败）
       POST <插件>/__dsh-kb-sync/pipeline  {"apply":true}
         ├─ token   在不在 / 多久没换（与旧 .cmd 同一套判据与阈值）
         ├─ recon   recon-update.mjs（只读）
         ├─ fetch   update-from-api.mjs（写 Markdown + catalog/jsonl + 备份轮转）
         ├─ process 段 2：模型 → 写 sync\out\ → apply-extraction 校验 → 落盘 + 6 个重建脚本
         └─ doctor  kb.mjs doctor（**只警告，不让整链失败**）
       把逐段「结论 / 退出码 / 耗时」追加进 trigger.log
```

页面上的**「跑整链」**走同一个路由（带 `force:true`），所以手动与自动是同一条代码路径。

**保留的两条归因规矩**（都是踩过才写的）：① 退出码非 0 **但日志里有该阶段的成功标记** ⇒ 判定为
Node 退出期噪声、不算失败；② 只有在输出里**出现 `AUTH_UNAUTHORIZED`** 才说"Token 可能过期"，
网络抖动一律只说"抓取失败"。

**新鲜度闸门**：距上次成功（读 `LAST-SYNC.txt`）不足 `chainMinIntervalMs`（默认 6 小时）时整链返回
`skipped` —— 登录补跑与 21:00 正跑重叠时，不会重复拉取、也不会反复轮转备份。

**通知**：整链结论写成与退役 `notify.ps1` **逐句相同**的文案，落在状态页（`chain.report.notify`）；
桌面气泡不再是必需环节，也就没有"BOM 丢了导致气泡静默消失"这个失效模式了。

**触发器为什么这么绕**：任务跑的是**可见的** `D:\dsh\dsh-kb-sync\tools\pipeline\trigger.cmd`，
而插件可能从**安装快照**（`<profile>\node_modules\dsh-kb-sync\tools\pipeline`）加载 —— 两个目录不是同一个，
插件写的 `trigger.json` 在快照里（2026-10-12 实测踩到）。所以插件在两处各写一份 `trigger-source.json`
（"真目录在哪"），`trigger.cmd` 把两份当**候选**：逐个检查候选指向的 `pipelineDir` 里**真有没有
`trigger.json`**，取第一个成立的。为什么必须校验、而不是"取第一份存在的"：从仓库直接加载的实例
（`node --test`、临时 fixture）会把 `%TEMP%\kb-sync-<rand>` 写进源码那份提示 —— 2026-10-12 实测正是
"源码提示被测试覆盖 → 任务指向不存在的目录"。校验之后两条路径都验过：源码提示**删掉**、或**指向临时目录**，
任务都能回退到快照那份并 `rc=0`。两个提示文件与 `trigger.log` 都在 `.gitignore` 里（本机事实，不是源码）。

### 阶段 3 验收（2026-10-12）

| 环节 | 结果 |
|---|---|
| `POST /pipeline` 整链（插件内） | ✅ 5 段全 `ok`、退出码 0：token ~0 ms / recon 1.0–1.7 s / fetch 1.0–1.5 s / process 1.4–1.7 s / doctor 1.2–1.9 s |
| 段 2 全路径（另一次带 9 条真实会话） | ✅ 归类 9 / 健康 1 / 专题建议 3、`applied:true`、6 个重建脚本 exit 0 |
| **新鲜度闸门** | ✅ 连跑两次：第二次 `skipped=fresh`「0 分钟前刚成功跑过（阈值 360 分钟）」，2 秒返回 |
| 归因：token 缺失 / 未授权 / 网络失败 / 完成后崩溃 | ✅ 单测覆盖（`test/pipeline.test.mjs` 9 例：标记优先于退出码、未授权才叫 token 过期） |
| `trigger.cmd`（计划任务入口） | ✅ 读到候选、逐段打日志、`rc=0`；源码提示缺失或指向临时目录时**自动回退**快照那份 |
| 计划任务 | ✅ 动作已改指 `trigger.cmd`；Daily 21:00 + `StartWhenAvailable` + `PT30M` 全部保留 |
| 知识库体检 | ✅ `kb.mjs doctor` exit 0（2549/2549/2549） |

**这一轮实测又抓出 4 个静默问题**（都修了，细节在提交信息里）：

1. **触发器找不到提示**：插件只把 `trigger-source.json` 写进快照，而任务跑的是源码那份 `.cmd` → `rc=2`。
2. **闸门从未生效**：状态行用 UTC 写、按本地解析（UTC+8 机器上"3 分钟前"被看成"8 小时前"），
   于是第二次整链照样重跑了一遍拉取。
3. **测试污染生产提示**：`node --test` 会用临时 `dataDir` 覆盖源码那份提示 → 任务指向不存在的目录。
   修法：只让从 `node_modules` 加载的实例写源码那份 + 触发器**校验候选**（不只看文件是否存在）。
4. `resolve(PLUGIN_ROOT, '..', '..')` 推错了源码根（从快照算出来是 profile 目录、从仓库算出来是 `D:\`）——
   两种布局下都应是 `resolve(PLUGIN_ROOT, '..')`。

**退役清单**（阶段 3 之后不再需要，已从本目录移入 `retired\`）：
`sync-daily.cmd`（旧编排入口）、`sync-extract.cmd`（`dsh headless` 段 2）、`notify.ps1`（桌面气泡）、
`ENABLE-SEGMENT-2.flag`（段 2 开关）、`headless-prompt.md`（旧提示词）、`check-log.mjs`（标记判定已进
`lib/pipeline.js`）。

**别一起退休的**：`recon-update.mjs` 与 `update-from-api.mjs` —— 整链仍在直接调用它们（`recon` 与
`fetch` 两段），它们的相对路径由 `_paths.mjs` 接管，所以**留在本目录**。（2026-10-12 实测：我先按
"段 1 也归插件了"的推断把这两个也搬进了 `retired\`，随即发现整链的 `reconScript`/`fetchScript` 正指着它们 ——
推断不能当依据，判据是"谁在调用"。）`.dsh-home\` 同理：它只被 `sync-extract.cmd` 用，可以随该文件一起退役。

## 二、文件

| 文件 | 作用 |
|---|---|
| `trigger.cmd` | **计划任务入口**（本目录）。只负责"戳一下"：挑一份可用的 `trigger-source.json` → 等宿主 `/status` 应答 → `POST /pipeline` → 逐段结果追加进 `trigger.log`。**必须保持纯 ASCII**；不编排任何东西 |
| `retired\` | 阶段 3 退役件：`sync-daily.cmd`（旧编排）、`sync-extract.cmd`（`dsh headless` 段 2）、`notify.ps1`（桌面气泡）、`ENABLE-SEGMENT-2.flag`、`headless-prompt.md`、`check-log.mjs`。**不被任何东西调用**，留作历史与回退 |
| `recon-update.mjs` | **仍在用**：整链的第 ② 段（只读侦察）。**别跟着上面那批一起退休** |
| `update-from-api.mjs` | **仍在用**：整链的第 ③ 段（抓取落盘 + 备份轮转）。同上 |
| `pipeline.json` | **路径唯一来源**（`importDir` / `tokenFile` / `healthDir` / `healthConsoleDir` / `financeDir` / `kbDir`）。改路径只改这里；环境变量可覆盖（`DSH_IMPORT_DIR` 等）。模板见 `pipeline.example.json` |
| `extract-prompt.md` | 段 2 的提示词：要求模型只输出一个 JSON 对象（归类 / 健康事实 / 财务候选 / 专题建议 / 摘要） |
| `_paths.mjs` | 每个 `.mjs` 都 import 它取绝对路径；import 时把 cwd 钉在本目录，运行目录无关 |
| `prep-inbox.mjs` | 段 2 前置：把判断所需输入放进 `sync\inbox\`（含健康与财务摘要、以及**归类用的 `update-new-items.tsv`**） |
| `auth-marker.mjs` | 鉴权失败判定：`classifyAuth()` 区分「真没授权」与「网络/接口问题」，命中时打印 ASCII 标记 `AUTH_UNAUTHORIZED`（整链靠它才敢说"Token 过期"） |
| `prep-finance-update.mjs` | 生成 `<data\import>\finance-digest\digest-20.md`，只挑本轮财务会话 |
| `apply-extraction.mjs` | 校验并应用 `sync\out\` 的产出（`--dry-run` 只校验不落盘、`--apply` 落盘；含写入财务候选区） |
| `..\..\data\import\sync\inbox|out\` | 每次运行重建。`inbox` 是输入，`out` 是 headless 产出（可事后审计） |
| `..\..\data\import\.dsh-home\` | 段 2 专用 DSH home：`dsh headless` 的会话、凭据与缓存都落在这里，**不进交互式侧栏** |
| `..\..\data\import\sync\logs\` | 段 1 日志 `sync-<时间戳>.log`、段 2 摘要 `extract-<日期>.md` |
| `..\..\data\import\LAST-SYNC.txt` | 最近若干次同步的状态行 |
| `ENABLE-SEGMENT-2.flag` | 存在即启用段 2（**当前已存在：段 2 已启用**） |
| `attic\` | 一次性脚本与中间产物（`tools\oneoff\`、`probe-*`、`*-selection*.json`、`bundle\`…）。不被管线调用，留档用 |

> ⚠️ **`.cmd` 里绝对不能写中文。** cmd.exe 按 GBK 读取 .cmd，中文会被搅乱并把后续内容当成命令执行。中文一律放 `notify.ps1` 或 `.mjs` / `.md`，调用方只传错误代码。

> ⚠️ **`notify.ps1` 必须带 UTF-8 BOM，而且这个失效是静默的。**
> Windows PowerShell 5.1 把无 BOM 的文件按 OEM 代码页（这里是 GBK）读，中文文案会变成
> `瀵硅瘽鐭ヨ瘑搴` 这类乱码，脚本直接解析失败；而 `:notify` 把输出重定向到 `nul`，
> 于是**同步照常"成功"，只是所有桌面气泡都没了**。（2026-10-10 实测：编辑工具写 UTF-8
> 不带 BOM，把 BOM 抹掉了，`sync-ok` 与 `token-expired` 两个 case 一起失效。）
> 现在 `tools\pipeline\sync-daily.cmd` 每次运行都会**自检并在缺失时原地补回 BOM**，所以这个失败模式
> 不会再复发。手工改完 `notify.ps1` 后仍建议跑一次
> `powershell -File sync\notify.ps1 -Case sync-ok -LogPath TEST` 确认无报错。

> ℹ️ **知识库完整性检查（2026-10-10 新增）。** `tools\pipeline\sync-daily.cmd` 末尾会跑
> `node D:\dsh\dsh-kb-sync\data\kb\tools\kb.mjs doctor`：核对 `conversations.jsonl` /
> `catalog.json` / `conversations\*.md` 三份清单数量是否一致、有没有悬空链接、
> 以及最新对话是否已超过 3 天没更新（后者能发现同步静默停摆）。
> 它**只读，不写任何东西**，失败也**不会中断流水线**，只弹一条 `kb-check-failed` 警告。
> 手动查看：`node D:\dsh\dsh-kb-sync\data\kb\tools\kb.mjs doctor`（有问题时退出码 1）。

> ⚠️ **不要把同一份日志重定向两次。** `sync-extract.cmd` 调用 pwsh 只在**外层**重定向；若在 `-Command` 里再写 `*>> '%LOG%'`，两个句柄争抢同一文件，pwsh 直接报 "being used by another process" 并失败（已实测踩到）。

> ⚠️ **不要只看退出码判断成败。** Node 在 Windows 上可能在**工作完成之后**因 libuv 断言硬崩
> （`Assertion failed: ... src\win\async.c` → 退出码 `0xC0000409`），于是「成功」被判成「失败」，
> 弹出「Token 可能已过期」这类**错误告警**——那比不告警更糟，会让你不再信任告警。
> 触发条件是「在 fetch / 定时器等异步句柄仍在关闭时调用 `process.exit()`」。
>
> - **根因**：脚本内用 `process.exitCode` + 自然退出；用显式 `AbortController` + `clearTimeout` 代替 `AbortSignal.timeout`。
> - **兜底**：`.cmd` 在非 0 退出时调用 `node sync\check-log.mjs "%LOG%" <阶段名>`，到日志里找成功标记：
>
>   | 阶段名 | 成功标记 |
>   |---|---|
>   | `recon` | 新增（本地没有） |
>   | `update` | `=== 完成 ===` 或 没有需要更新的内容 |
>   | `apply` | 全部校验通过 |
>   | `inbox` | 输出目录（待 headless 填写） |
>   | `reconAuth` | `AUTH_UNAUTHORIZED` |
>   | `updateAuth` | `AUTH_UNAUTHORIZED` |
>
>   命中 → 记一行「exited non-zero but completed」并继续；未命中 → 才当失败。
>   中文标记表放在 `check-log.mjs` 里，因为 `.cmd` 不能含非 ASCII 字节。
>
> ⚠️ **「Token 过期」必须靠证据，不能靠猜（2026-10-10 改）。**
> 旧逻辑是「recon 非 0 退出 + 找不到成功标记 → 判定 Token 过期」，于是网络抖动、接口改版、
> 限流都会被报成 Token 问题，把你引向错误的排查方向。
> 现在 `recon-update.mjs` / `update-from-api.mjs` 抓到响应后调用
> `auth-marker.mjs` 的 `classifyAuth()`：只有 HTTP 401/403、已知未授权业务码
> （40001/40002/40003/40100/40101）或文案命中 `auth|unauthor|token|login|未授权|登录`
> 时，才打印 ASCII 标记 `AUTH_UNAUTHORIZED`；
> `.cmd` 先问 `reconAuth`/`updateAuth`，命中才报「Token 可能已过期」，
> 否则一律报笼统的「同步失败」。

## 三、启用 / 停用

```cmd
REM 启用段 2（建议先按第五节验证一次再启用）
type nul > D:\dsh\dsh-kb-sync\tools\pipeline\ENABLE-SEGMENT-2.flag

REM 停用段 2
del D:\dsh\dsh-kb-sync\tools\pipeline\ENABLE-SEGMENT-2.flag
```

```powershell
# 看任务状态
Get-ScheduledTaskInfo -TaskName "DSH-KB-DailySync"

# 立即手动跑一次（不需要等 21:00）
Start-ScheduledTask -TaskName "DSH-KB-DailySync"
# 或直接跑脚本：cmd /c "D:\dsh\dsh-kb-sync\tools\pipeline\sync-daily.cmd"

# 改时间（例：改成每天 22:30）
Set-ScheduledTask -TaskName "DSH-KB-DailySync" -Trigger (New-ScheduledTaskTrigger -Daily -At 22:30)

# 暂停 / 恢复 / 删除
Disable-ScheduledTask -TaskName "DSH-KB-DailySync"
Enable-ScheduledTask  -TaskName "DSH-KB-DailySync"
Unregister-ScheduledTask -TaskName "DSH-KB-DailySync" -Confirm:$false
```

任务设置为「登录时可用（Interactive only）」——这是**必要的**，桌面气泡需要用户会话。同时开了 **StartWhenAvailable**：如果 21:00 你不在电脑前，登录后会尽快补跑。

## 四、⚠️ 最大的脆弱点：Token 会过期

抓取用的是网页端 localStorage 里的 Bearer token（token 文件在仓库外，默认
`%USERPROFILE%\.dsh\.dsh-kb-sync-token`，路径写在 `pipeline.json` 的 `tokenFile`）。
**它会过期**，过期后接口返回未授权，脚本会弹「Token 可能已过期」的桌面气泡。

**两道防线（2026-10-10 补齐）**：

1. **提前提醒**：`.token` 文件的修改时间就是「token 取得时间」。段 1 每次开跑都会算它的天数，
   超过 `TOKEN_OLD_DAYS`（当前 **21 天**，在 `tools\pipeline\sync-daily.cmd` 顶部，需改就改那里）就弹
   「Token 已偏旧」气泡 —— 这条 `token-old` 文案在 `notify.ps1` 里一直存在，但此前**没有任何地方触发**，
   于是第一次知道出问题永远是同步已经失败。
   > 实测参考：2026-09-23 取的 token 到 10-09 已 16 天仍可用，所以阈值取 21 天留提前量。
2. **失败归因**：真的失败时，只有 `auth-marker.mjs` 判定为鉴权问题才会报「Token 过期」，
   其它原因报「同步失败」，不再误导（见第二节末的说明）。

**更新方法**：

1. 浏览器登录 https://chat.deepseek.com
2. F12 打开控制台，运行：
   ```js
   JSON.parse(localStorage.getItem('userToken')).value
   ```
3. 把输出的字符串（64 字符左右）写入 `%USERPROFILE%\.dsh\.dsh-kb-sync-token`（**只有这一行，不要换行以外的任何内容**）

```powershell
# 也可以直接（路径与 pipeline.json 的 tokenFile 一致即可）：
Set-Content -Path "$env:USERPROFILE\.dsh\.dsh-kb-sync-token" -Value "<粘贴token>" -NoNewline -Encoding ascii
```

## 五、段 2 已验证（2026-10-09）

段 2 已按第一节之二改造成两段式，并**在空轮状态下实测跑通**：

```
prep inbox ✓ → headless（沙箱内判断）✓ → apply（校验+应用）✓
→ 重建知识库 ✓ → 重建健康档案 ✓ → 快照 ✓ → 退出码 0
```

headless 的自我报告确认它遵守了边界：「全程未写入 `knowledge-base`/`health`、未提权、未运行任何构建或同步脚本」。

`ENABLE-SEGMENT-2.flag` **已创建，段 2 当前为启用状态**。

**验证时用的空轮测试怎么复现**（不改动真实数据）：

```powershell
# 1) 备份并清空本轮变化，让段 2 走一遍完整管道但不产生任何内容变更
Copy-Item D:\dsh\dsh-kb-sync\data\import\update-new-items.json $env:TEMP\uni.bak.json
'{ "generatedAt": "2026-01-01T00:00:00.000Z", "added": [], "changed": [], "items": [] }' |
  Set-Content D:\dsh\dsh-kb-sync\data\import\update-new-items.json -Encoding UTF8

# 2) 跑段 2
cmd /c "D:\dsh\dsh-kb-sync\tools\pipeline\sync-extract.cmd"

# 3) 看结果
Get-Content D:\dsh\dsh-kb-sync\data\import\sync\logs\ad-hoc.log
Get-Content D:\dsh\dsh-kb-sync\data\import\sync\logs\extract-<今天>.md
```

**成本提示**：段 2 每次会调用模型（归类 + 可能的健康事实提取），消耗额度。段 1 不消耗。

## 六、排错

| 现象 | 原因 / 处理 |
|---|---|
| 桌面弹出「Token 可能已过期」 | 按第四节重新取 token |
| 桌面弹出「找不到 Token」 | `.token` 文件不存在或被清空 |
| 桌面弹出「段 2 提炼失败」 | 看日志里 `---- headless ----` 或 `---- apply ----` 之后的内容。`apply-extraction` 报「非法话题」「归类缺 N 条」时它**不会落盘**，知识库保持原样 |
| 日志里 `isolated DSH_HOME has no credentials` | `.dsh-home\.credentials.yaml` 丢了或没同步。按第一之四节补齐（从 `~\.dsh\.credentials.yaml` 复制） |
| GUI 侧栏「未分组」又冒出「你的任务：…」 | 有 headless 运行没走独立 home。检查 `sync-extract.cmd` 是否仍在设置 `DSH_HOME` |
| 日志里 `segment 2 skipped - flag not present` | 正常。段 2 被停用了（删掉标志文件即可恢复此状态） |
| 日志末尾有 `Assertion failed: ... uv async.c` | **可忽略**。这是 Node 在 Windows 上退出时的 libuv 噪音，不影响结果（退出码仍为 0） |
| `pwsh: cannot access the file ... being used by another process` | 同一份日志被重定向了两次。见第二节末尾的警告 |
| 同步成功但没有新内容 | 正常。`没有需要更新的内容 ✔` 表示期间没聊新的 |
| 任务没在 21:00 跑 | 电脑关机或未登录。登录后会补跑（StartWhenAvailable） |
| 想确认最后一次结果 | `Get-Content D:\dsh\dsh-kb-sync\data\import\LAST-SYNC.txt` |

## 七、日志在哪看

```powershell
# 最近一次段 1 日志
Get-ChildItem D:\dsh\dsh-kb-sync\data\import\sync\logs\sync-*.log | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content

# 段 2 的摘要
Get-ChildItem D:\dsh\dsh-kb-sync\data\import\sync\logs\extract-*.md | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content

# 段 2 这一轮实际交给 headless 的输入，以及它产出的原始 JSON（可审计）
Get-ChildItem D:\dsh\dsh-kb-sync\data\import\sync\inbox
Get-ChildItem D:\dsh\dsh-kb-sync\data\import\sync\out
```
