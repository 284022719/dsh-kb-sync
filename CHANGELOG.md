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
- 安全模型：Host 必须环回（挡 DNS rebinding）、`Sec-Fetch-Site` 非同源 403、写操作必须带 `x-dsh-kb-sync: 1`、日志文件名白名单且必须落在日志目录内、argv 全显式不拼 shell。
- 配置**四条通路**（loader `config` → 环境变量 → 用户设置文件 → 插件内 `config.json`），**改完要重启应用**（加载时解析一次并缓存）。
- 默认**自包含**：知识库落在插件自己的 `data/kb/`，不与别的脚本抢目录。

> EN: a same-origin control page with 14 routes; **plus a hand-written client half** that registers a Settings → dsh-kb-sync section (status summary and three actions) with Chinese/English dictionaries, and no config editing. Loopback-only Host plus a `Sec-Fetch-Site` check, a custom header on writes, a log-name allowlist, and explicit argv. Four config channels with a documented precedence; settings are resolved once at load, so a restart is required after changing them. Self-contained by default (the knowledge base lives inside the plugin folder).

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
- [`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md)：逐条能力披露与已知局限；
- [`docs/architecture.svg`](docs/architecture.svg)：编排半的作用域图（拉取半与段 2 不在图上，见 README 图注）；
- [`tools/pipeline/README.md`](tools/pipeline/README.md)：流水线、调度与重建命令。

> EN: usage and boundaries in both READMEs; per-capability disclosure in `docs/CAPABILITY-DISCLOSURE.md`; the pipeline, its schedule and the rebuild commands in `tools/pipeline/README.md`.
