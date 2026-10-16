# 更新日志 / Changelog

> 每条描述**当时那个版本**的行为，不保证对当前版本全部成立；当前用法看 [`README.md`](README.md)（中文）与 [`README.en.md`](README.en.md)。
> Entries describe behaviour **at that release**, not necessarily current behaviour — see the READMEs for current usage.

## 0.2.0 — 2026-10-16

> 两个主题：**控制页按任务重排**（去掉内部术语与重复入口），以及**面向公开发布的加固**
> （代码注释与文档的能力陈述对账、两条防漂移测试、社区门面文件）。安装方式不变。

### 控制页重排 + 术语改造（2026-10-15）

起因：控制页把五项功能平铺、编号 ①–⑤，工具栏和卡片里还各摆一套「拉取 / 回填」按钮；界面上又直接写着
「段 2」这类只有作者看得懂的内部流程名。这一版按**任务**分块、只留说人话的名字，并去掉两个多余入口
（"插件页直连"与重复的抓取按钮）。

**版式**（`lib/page.js` 重写）：

- 首屏只留**结论条**：一句话结论（正常 / 需要看一眼 / 上次没成功）+ 三个关键数字
  （知识库会话数、最近一次更新、登录态年龄）+ 主按钮「**更新知识库**」；真有事才多出一块「要你处理」。
- 分区按**任务**分，**不再编号**：**收新对话 / 找内容 / 整理 / 运行详情与诊断**（最后一块是折叠的，
  里面放当前状态、知识库规模、最近日志、体检、分步表格、运行已有脚本）。
- 同一个动作**只留一个按钮**：以前工具栏和卡片里各摆一套「拉取 / 全量回填」，互相抢焦点。
- 补齐全量历史、网页端登录态都收进折叠；页面在宽屏下不再是一根细柱子（`max-width: 1080px` 居中）。

**术语**（用户原话："段 2 这是什么神奇称呼"）—— 界面上不再出现内部流程名：

| 以前（开发者视角） | 现在（界面） |
|---|---|
| ① 网页端登录态 / ② 拉取 / ③ 检索 / ④ 一键整链 / ⑤ 段 2 判断 | 网页端登录态 / 收新对话 / 找内容 / 整理 / 更新知识库 |
| 段 1 / 段 2 | 抓取 / **整理**（模型归类与提炼） |
| 整链、阶段 2/3 | 更新知识库 |
| dry-run / 只校验（不落盘） | 试运行（只看会改什么，不写入） |
| 落盘 / 跑并落盘 + 重建 | 写入 / 写入并重建 |
| 步骤表里的 `token/recon/fetch/process/doctor` | 登录态 / 查有没有新内容 / 抓取 / 整理 / 体检（原始代码只留在悬停提示里，排错时对日志用） |

**取消直连入口**：`lib/client.js` 的应用内分节**删掉「打开控制页」按钮**（那个按钮指向插件的直连地址）；
README/USAGE 里 "进哪一页" 只留一条主路径。理由：多给一个入口 = 多记一个地址、多一处会失效的链接。

**防回退**：新增两条判据 —— `test/locale.test.mjs` 扫渲染结果里不许出现
`段 1 / 段 2 / 整链 / 阶段 2,3 / dsh headless / dry-run / 落盘 / ①②③④⑤`；
`test/plugin.test.mjs` 从**真路由返回的 HTML** 再钉一次（`段 2 / 整链 / dsh headless / dry-run`）。
顺带一条给未来的自己：**内联 `<script>` 与 `<style>` 里的注释必须是 ASCII** —— `locale.test.mjs` 会把
英文页里译文表以外的任何中日韩文字判成"漏翻"（这次踩了：三处中文注释当场变红）。

用例数 86 → **87**；`lib/client.js` 的中英字典同步去掉 `act.open`（两侧键集合必须一致，有测试钉着）。

> EN: the control page was re-laid-out by task (one-line verdict bar, then bring-in / find / organise,
> with details folded into "run details & diagnostics"), the ①–⑤ numbering is gone, and every internal
> flow name in the UI became plain language (segment 1/2 → fetch/organise, full chain → update,
> dry run → dry run, "landing" → write). The in-app section no longer offers an "open control page"
> button (one answer to "where do I go"). Two tests now fail if the jargon creeps back. 87 cases.

> ⚠️ **本机要重装快照 + 重启才看得到**：`file:` 安装是**复制快照**（运行中的实例用的是启动时缓存的模块）。
> 先 `dsh plugin --profile <profile> remove dsh-kb-sync` 再 `add`，然后重启应用；插件的信任指纹会随代码变化失效，需要在设置里重新确认一次。

### 发布加固（2026-10-16）

**① 能力陈述与实现对账** —— 修的是"公开页面上写着与代码相反的话"这一类问题：

- `lib/index.js` 头部的 capability posture 段是"只做编排"的早期版本一路留下来的：它写着
  "**No credentials** … never touches the DSH `credentials` service" 与 "**No network**"，
  而同一个文件里早在调 `credentials.resolve()`；那段里的路由清单也停在 5 条（实际 14 条）。
  现在改成**按三块能力分别陈述**，并写明哪一块构成静态扫描的红线、为什么消不掉。
- `docs/CAPABILITY-DISCLOSURE.md` 两处失真：设置分节的三个动作名还写着 2026-10-15 已经删掉的
  「打开控制页」（实际是 抓取新对话 / 更新知识库 / 刷新）；"`scripts` 只有 `test`" 也不再成立。
- README 的包体量、用例数等实测数字同步到当前值（包体量 55 → **58** 个文件，约 480 KB）。

**② 三条防漂移测试**（都是让上面那类问题"下次自己变红"）：

- 文档一致性组：`lib/index.js` 头部逐行列出的路由必须与实际路由**一一对应**，
  且头部写的总数必须等于实际条数；
- 文档一致性组：披露文档里写的客户端**动作名与个数**，必须等于 `lib/client.js` 的 `act.*` 字典；
- 随包卫生组：`package.json` 不得声明任何**安装期钩子**（`install` / `postinstall` / `prepare` …），
  运行依赖必须为空 —— 这两条正是能力披露里声明"没有"的东西。

**③ 社区门面**：新增 [`CONTRIBUTING.md`](CONTRIBUTING.md)（开发规矩，标明哪几条是测试钉着的）、
[`SECURITY.md`](SECURITY.md)（三块能力面、对 token 的承诺、私密报告通道与回应预期）、
GitHub issue 表单（bug / feature）与 PR 模板；三个文件都进发布包。

用例数 87 → **91**。

> EN: 0.2.0 also hardens the public-facing story. The module header of `lib/index.js` had claimed
> "no credentials, no network" since the orchestrate-only days, while the same file resolves credentials
> and the route list stopped at 5 of 14 — both now state the three capability blocks and name the red
> line. Two stale claims in the capability disclosure (a removed settings action, and "scripts only has
> `test`") are fixed, and three new tests pin the class of defect: the header route list must equal the
> real routes, the disclosure's action names must equal the client dictionary, and `package.json` must
> declare no install hooks and no runtime dependencies. Adds CONTRIBUTING.md, SECURITY.md, GitHub issue
> forms and a PR template (all shipped). 91 cases; package **58** files, ~480 KB.

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
- **插件 ⇄ 管线脚本的接口契约**（2026-10-12 实测并修）：插件不 import 脚本，而是按 argv 调、按 stdout 标记判成败。审计时抓到一处**静默错位** —— 落盘那一步插件传的是 `['--apply']`，而 `apply-extraction.mjs` 只认 `--dry-run`（**没有该标志就是落盘**），所以落盘成功纯属「未知参数被忽略」；脚本哪天改成默认只校验，页面那个「跑并落盘 + 重建」按钮就会**静默变成只校验**。已改为**不传标志**（对齐脚本文档写的用法）。新增 `docs/PIPELINE-CONTRACT.md`（调用表：谁调谁、argv、cwd、超时、判成依据）与一条机械断言：插件引用的脚本必须存在、**传出去的每个 `--flag` 必须在脚本源码里出现过**（负向对照已验证：把 `--dry-run` 改回 `--apply`，测试立刻报 `apply-extraction.mjs 不认 --apply`）。
- **判成不再依赖输出措辞**（2026-10-12 修）：段 2 的「只校验 / 落盘」两步原来都是 `/全部校验通过/.test(stdout)` —— 脚本改个措辞，成功就会被判成失败（静默）。现在改为**退出码优先**、复用 `lib/pipeline.js` 的 `classifyStage`（与整链同一条判成路径，非零退出时只有出现完成标记才容忍为 Node 退出期噪声）；`全部校验通过` 只剩标记用途。依据：`apply-extraction.mjs` 里唯一的显式退出是失败时的 `process.exit(2)`。新增静态断言防止写回按措辞判成。**仍缺**：`/process` 路由的端到端测试（需要宿主 `llm` 服务的桩），已记在 `docs/PIPELINE-CONTRACT.md`。
- **段 2 路由的端到端测试**（2026-10-12）：给测试夹具加了宿主 `llm` 桩（`listProviders`/`listModels`/`stream`）与按脚本给退出码的 subprocess 桩，三条用例覆盖段 2 的落盘与只校验路径（含"退出码 0 但措辞全换仍判成功"）。顺带记录一个坑：**收件箱全空时 `/process` 走「没活干」快速路径、不调模型**（行为正确），测试必须先造 `sync/inbox/update-new-items.tsv`。
- **`npm run preflight`**（2026-10-12）：把上一节那份"发布前清单"从**给人看**变成**可执行** —— 测试 / 语法 / 类型 / 发布包内容（不该出现 vs 必须有）/ 能力披露，五步一条命令、退出码就是结论。`docs/PUBLISHING.md` 第三节改为引用它。写这个脚本时踩到两个坑并修掉：Windows 上 `spawnSync('npm.cmd')` 不加 `shell: true` 起不来（表现是输出为空、code=null）；`npm pack --json` 输出的是**数组**且前后可能夹提示行，只能取第一个 `[` 到最后一个 `]`。负向对照已验证：去掉一条 `files` 取反项后，它当场报 `不该发布：tools/pipeline/pipeline.json` 并退出 1。
ame 是 loader 要 import 的模块说明符**，而它解析出的包名**同时**是客户端半部在 boot manifest 里的行 id。三处必须一致：**patch 行的 
ame = 包名 = __ModuleLoader__.load({id}) 的 id**。结论见 [`docs/INSTALL-PATH.md`](docs/INSTALL-PATH.md)，并用测试钉住可机械检查的部分（改包名/改行忘同步就失败）。

> EN: usage and boundaries in both READMEs; per-capability disclosure in `docs/CAPABILITY-DISCLOSURE.md`; the pipeline, its schedule and the rebuild commands in `tools/pipeline/README.md`.
