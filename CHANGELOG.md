# 更新日志 / Changelog

> 每条描述**当时那个版本**的行为，不保证对当前版本全部成立；当前用法看 [`README.md`](README.md)（中文）与 [`README.en.md`](README.en.md)。
> Entries describe behaviour **at that release**, not necessarily current behaviour — see the READMEs for current usage.

## 0.1.0 — 2026-10-12

**首个公开版本：一个插件，三块能力（拉取 / 编排 / 段 2 判断）。**
First public release: one plugin with three capability blocks (pull / orchestrate / segment-2 judgement).

### 拉取半 · Pull

- 用 DSH 凭据服务里的网页端 `userToken` 拉对话：会话列表 → 沿 `chat_session.current_message_id` 的 parent 链取**权威线程** → 规范化成 `conversations/*.md` + `conversations.jsonl` + `catalog.json`，并在插件内检索（直接扫 JSONL，不建索引）。
- **全量回填**走官方导出包（`export_all` → 轮询 → 下载 zip → 解析 `conversations.json`）；自写 zip 读取器与消息树叶子解析，对着真实导出包实测过（2446 条会话、CRC 全过；"最后一条是助手回复"占 2442/2446，反证"按时间戳找叶子"的坑）。
- **增量**只保证"往后每天长"：列表接口实测 `count` 上限 100、`page`/`cursor` 等一律被忽略（翻不了页），要完整历史只能用回填。
- 事实披露：这一半**读凭据值 + 出网**，`dsh-trust-check` 判 **1 条红线**（无法靠改代码消除）；token 只进凭据服务，不写文件/日志/响应，出网域名只有 `chat.deepseek.com`。
- 时间口径统一为**本地偏移写法**（`+08:00`）；修复前增量路径写 `+00:00`，导致 Markdown 头比本地早 8 小时（已修 115 个历史文件 / 1626 行时间）。

> EN: pulls DeepSeek web conversations into a local knowledge base (markdown + JSONL + catalog) with in-plugin search; full backfill via the official export zip (verified against a real export: 2446 conversations, CRC clean); the incremental path can only ever see the newest 100 conversations (the list endpoint refuses to page) so the export zip remains the way to get full history. This half reads the credential value and goes out to the network — one red line in `dsh-trust-check`. Timestamps are written and displayed in local time.

### 编排半 · Orchestrate

- 同源控制页 `/__dsh-kb-sync/`（**14 条路由**）：状态、知识库规模、最近日志尾部、体检命令输出，以及"运行已有同步脚本 / 跑整链 / 刷新状态"。
- **应用内设置分节**（`lib/client.js`，手写客户端半部、无构建步骤）：**设置 → dsh-kb-sync** 显示状态摘要并给出「拉取增量 / 跑整链 / 打开控制页 / 刷新」；跟随宿主界面语言（中英字典）；**不提供配置编辑**（配置在加载时解析一次）。
- **控制页双语**（`lib/locale.js` + `locale/en.json`）：默认中文，`?lang=en` 或浏览器 `Accept-Language` 切换，右上角可换；中文是源语言（页面里的中文即译文表的键），缺译回落中文。同时修掉页面里"计划任务 21:00 打的就是这条链"这句过期文案。**服务端诊断文案仍是中文**（排错信息，暂不翻）。
- 安全模型：Host 必须环回（挡 DNS rebinding）、`Sec-Fetch-Site` 非同源 403、写操作必须带 `x-dsh-kb-sync: 1`、日志文件名白名单且必须落在日志目录内、argv 全显式不拼 shell。
- 配置**四条通路**（loader `config` → 环境变量 → 用户设置文件 → 插件内 `config.json`），**改完要重启应用**（加载时解析一次并缓存）。
- 默认**自包含**：知识库落在插件自己的 `data/kb/`，不与别的脚本抢目录。

> EN: a same-origin control page with 14 routes; **plus a hand-written client half** that registers a Settings → dsh-kb-sync section (status summary and three actions) with Chinese/English dictionaries, and no config editing; **the control page itself is bilingual too** (`?lang=en`, `Accept-Language`, in-page switcher) with Chinese as the source language, while server-side diagnostics remain Chinese. Loopback-only Host plus a `Sec-Fetch-Site` check, a custom header on writes, a log-name allowlist, and explicit argv. Four config channels with a documented precedence; settings are resolved once at load, so a restart is required after changing them. Self-contained by default (the knowledge base lives inside the plugin folder).

### 段 2 判断（进程内）· Segment 2, in process

- 把管线里"让模型做判断"那一步搬进宿主进程：准备输入 → 调宿主 `llm.stream` 拿**一份 JSON** → 用管线自己的 `apply-extraction.mjs` 校验（归类 idx 集合必须与输入一致、话题合法、专题 parent 匹配）→ **通过才落盘并重建**（6 个脚本：`apply-update-topics` / `build-kb` / `build-specialties` / `map-specialties` / `build-health-profile` / `sync-knowledge`）。
- 页面默认按钮是 **dry-run**（只校验、不落盘）；模型**从不直接改档案**，财务只写候选区、永不自动入账。单次生成上限可配（`processMaxTokens`）。

> EN: runs the pipeline's judgement step inside the host process — prepare inputs, one JSON judgement through the host `llm` service, validate with the pipeline's own script, and only then write and rebuild. The default button is a dry run; the model never edits the archive directly and finance data only ever lands as candidates.

### 整链（阶段 3）· The full chain

- 五段 `token → recon → fetch → process → doctor`，每段有独立结论、退出码与耗时；失败行直接写原因（`token-expired` / `failed` / `spawn-failed` / `finished-with-crash`）。
- 归因规矩：**退出码非 0 但日志里有该段成功标记 ⇒ 判定为 Node 退出期噪声**；只有输出里出现 `AUTH_UNAUTHORIZED` 才说"token 可能过期"。
- **新鲜度闸门**：距上次成功不足 `chainMinIntervalMs`（默认 6 小时）时整链 `skipped`，防重复拉取与备份轮转；页面按钮用 `force` 绕过。
- 通知并入状态页（文案与退役的 `notify.ps1` 逐句相同），桌面气泡不再是必需环节。
- 触发器 `tools/pipeline/trigger.cmd` 只负责"戳一下"（读 `trigger-source.json` → 等宿主 `/status` → `POST /pipeline`），它自己不编排任何东西；计划任务**是可选的**，删掉后手动跑同一套代码路径。

> EN: five stages with per-stage verdicts, exit codes and timings; a non-zero exit with the stage's success marker counts as teardown noise, and only an explicit auth marker is reported as an expired token. A freshness gate (default 6h) prevents duplicate pulls; the notification text lives on the status page. The scheduled task is optional — the same code path runs manually.

### 本版本内修掉的问题 · Fixes in this release

- 触发器候选提示与源码根推断；新鲜度闸门的时区 bug（UTC 写、本地读 → 3 分钟前被读成 8 小时前）；`/process` 应用后不清空清单的重复送批（用「只校验」规避）。
- 段 2 空输出（`unparseable-output`）→ 单次生成上限从 4096 提到可配。
- 时间显示早 8 小时（见上）。

> EN: fixes include the trigger's two-location pointer and source-root resolution, the freshness gate's timezone bug, the reload trap after a config change, and the 8-hour timestamp display offset.

### 文档 · Docs

- [`README.md`](README.md) / [`README.en.md`](README.en.md)：用法与边界；
- [`docs/USAGE.md`](docs/USAGE.md) / [`docs/USAGE.en.md`](docs/USAGE.en.md)：**任务导向的用户指南**（五分钟跑通、"我想做 X 点哪里"、三条同步路径怎么选、段 2 的两个按钮、手动/计划任务、配置改哪一份、数据与备份、排错手册）；
- [`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md)：逐条能力披露与已知局限；
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md)：发布须知（哪些绝不能进仓库/进包、发布前检查清单、历史也会泄露这条坑）；
- [`docs/architecture.svg`](docs/architecture.svg)：编排半的作用域图（拉取半与段 2 不在图上，见 README 图注）；
- [`tools/pipeline/README.md`](tools/pipeline/README.md)：流水线、调度与重建命令。

### 工程 · Engineering

- **CI**（`.github/workflows/ci.yml`）：ubuntu + windows × Node 20/22/24 跑 `npm test` / `check` / `pack:check`——Windows 之外的 runner 才验得到 POSIX 执行分支。
- **文档一致性测试**（`test/docs.test.mjs`）：本地链接必须存在、README 路由表必须与代码一一对应、文档提到的 npm script 必须存在、README 里的用例数必须与实测一致、截图清单里的图必须存在且是 PNG——**"文档漂了"变成失败，而不是靠人记得**。
- **截图生成器**（`tools/make-screenshots.mjs`，开发工具、不入发布包）：起一个**只喂假数据**的本地演示服务 + 无头 Chrome，把**真实页面**截成 4 张门面图（首屏 / 整页 / 检索命中 / 英文界面）并写 `screenshots.json`；图里的 `D:\demo\...` 与对话全是编的，不含作者任何数据。
- **类型声明**（`lib/index.d.ts` + `package.json` 的 `types` / `exports["."].types`）：配置对象、`resolveSettings()` 的有效设置、`/status` 负载、插件本体都有类型；刻意不 import 宿主包类型（`@deepseek-ai/cordis` 是可选 peer，消费者不该为了看类型而装它）。用 `npm run check:types`（`tsc --noEmit`，`strict`）编译 `types/usage.ts` 验证——那里既有正例也有 `@ts-expect-error` 反例，**声明退化成 `any` 同样会失败**。这是本仓库唯一的 devDependency（typescript），运行依赖仍为零。
- 发布须知补「推送之后」清单：GitHub topic `dsh-plugin`（社区清单靠它收录）、确认 CI 绿（Linux 那条是唯一的 POSIX 平台验证）、打 tag / Release、可选 npm publish。
- **客户端半部的装配契约已对宿主实现逐条核对**（读 `app.asar` 里的 `@deepseek-ai/dsh-client-modules`：`resolveMeta()` / `parseDshClient()` / `clientExportOf()` / `graphRow()`，以及官方插件模板）：`dsh.client.platform` 必须是 `web`（否则**静默跳过**）、`exports["./client"]` 只接受字符串或带字符串 `default` 的对象、产物里 `__ModuleLoader__.load({id})` 的 **id 必须等于包名**、`settings.section` 的注册字段与宿主自带账户分节逐字段一致、而 `immediately` 只是**预取提示**（前端唯一用法是 `prefetchImmediateTier()`）。结论写进 [`docs/CLIENT-HALF.md`](docs/CLIENT-HALF.md)，并用 `test/client.test.mjs` 的最后一条用例把这些规则钉在 CI 里（顺带纠正一条过严的判据：`react` 是平台种子，不该出现在 `dsh.client.inject`）。
- **安装链路也对宿主实现核了一遍**（读 @deepseek-ai/dsh-plugin-manager 与官方插件模板）：dsh.bundle.patch 读不到会**抛错**、只有 **insert** 行会被插入（没有 insert 但带 id 的行是 nable/disable 用的 *override*）、插入行的 **
- **发布包卫生**（2026-10-12 实测并修）：iles 里写了整个 	ools/pipeline 目录时，npm 会把目录里的**运行时文件**一起装进包 —— 作者的 `pipeline.json`（含本机绝对路径，用户装上后脚本会**静默读错数据目录**）、`trigger.log` 与 `retired/`（退役脚本，其中一个 .cmd 里还有中文）此前确实在包里。有 `files` 字段时 `.npmignore`/`.gitignore` 都不生效，**唯一手段是 `files` 取反项**（已加 5 条）；发布包从 64 降到 **55 个文件**。新增 `test/shipped.test.mjs`：每个随包 JS 过 `node --check`、`.cmd/.bat` 必须纯 ASCII 无 BOM（仓库自己的规矩）、取反项必须在位、无备份/临时文件。
- **随包脚本只读审计 + 机械化**（2026-10-12）：28 个随包管线/插件脚本过了一遍 —— **没有本机硬依赖**（`D:\dsh\...` 只出现在注释里，不在代码路径上），对外部项目（`../health-console`、`../health`、`../finance`）的引用**都有 `existsSync` 守卫**（缺了就跳过那一步，不报错）。顺手把「写死的同目录引用必须真实存在」做成测试：搬 `attic/` 时正是 3 处 `join(PIPE_DIR, 'attic', …)` 需要手工改，漏一处就是「用户跑到那段才炸」（只查字面量，变量参数不硬猜；用户配置与 `data/` 允许不存在，否则新克隆 / CI 会假失败）。
ame 是 loader 要 import 的模块说明符**，而它解析出的包名**同时**是客户端半部在 boot manifest 里的行 id。三处必须一致：**patch 行的 
ame = 包名 = __ModuleLoader__.load({id}) 的 id**。结论见 [`docs/INSTALL-PATH.md`](docs/INSTALL-PATH.md)，并用测试钉住可机械检查的部分（改包名/改行忘同步就失败）。

> EN: usage and boundaries in both READMEs; per-capability disclosure in `docs/CAPABILITY-DISCLOSURE.md`; the pipeline, its schedule and the rebuild commands in `tools/pipeline/README.md`.
