# 使用说明（dsh-kb-sync）

> **这份文档管"怎么做"。** 想知道"它是什么、边界在哪、为什么这么设计"，看 [`../README.md`](../README.md)；
> 想知道"每个版本改了什么"，看 [`../CHANGELOG.md`](../CHANGELOG.md)；想核对能力与风险，看 [`CAPABILITY-DISCLOSURE.md`](CAPABILITY-DISCLOSURE.md)。
>
> 下面凡写 `<插件目录>` 的地方，都指装好后的插件文件夹（`file:` 安装是快照，见文末「改了代码不生效」）。

## 一、五分钟跑通

1. **装**：`dsh plugin --profile <你的 profile> add github:284022719/dsh-kb-sync`，然后**重启 DSH**。
2. **打开控制页**（本机从控制台「同步」页签进 —— 那一页嵌的就是它）：`http://127.0.0.1:<你的 DSH Web 端口>/__dsh-kb-sync/`
   （不知道端口就看你平时打开 GUI 的地址；插件和 GUI 同端口）。
3. **粘 token（「网页端登录态」）**：浏览器登录 chat.deepseek.com → F12 → Application → Local Storage → 复制
   `userToken` 的值 → 粘贴 → 保存。它只进 DSH 凭据服务，插件不写任何文件、日志与响应。
4. **拉一次**：先点「抓取新对话」。第一次想要完整历史就点「补齐全量历史」。
5. **搜一条（「找内容」）**：输入关键词，勾不勾「只看用户说的话」都行；命中点「展开全文」。
6. **看一眼是否健康**：「更新知识库」= 一次把「登录态 → 查新增 → 抓取 → 整理 → 体检」跑完。

> 应用内也有入口：**设置 → dsh-kb-sync**（状态摘要 + 抓取新对话 / 更新知识库）。

## 二、我想做 X，该点哪里

| 我想… | 怎么做 | 会写盘吗 | 花额度吗 |
|---|---|---|---|
| 把网页端新聊的对话收进来 | 「抓取新对话」（增量） | 会（只写新增/续聊） | 不花 |
| 补齐很久以前的历史 | 「补齐全量历史」（官方导出包） | 只在导出内容更多时更新 | 不花 |
| 一次跑完整条链 | 首页「更新知识库」 | 会（含重建） | **会**（整理要调模型） |
| 先看看模型会判断成什么、不写入 | 「试运行（只看会改什么）」 | 不写知识库，只写 `sync/out/` | 会 |
| 让判断真正生效并重建知识库/健康档案 | 「写入并重建」 | 会 | 会 |
| 检查知识库有没有坏 | 「跑体检」 | 不写 | 不花 |
| 在本地读某个会话的全文 | 「找内容」搜到后「展开全文」 | 不写 | 不花 |
| 换/清掉已存的 token | 「网页端登录态」里的「保存」/「清除」 | 只动凭据服务 | 不花 |

## 三、三条同步路径怎么选

| 路径 | 覆盖范围 | 什么时候用 | 注意 |
|---|---|---|---|
| **增量拉取** | 列表接口**最多回最新 100 条**，且这条接口**翻不了页**（`count` 上限 100、`page`/`cursor` 等一律被忽略、`POST` 405；2026-10-12 实测） | 日常每天都跑 | 所以它只保证「**往后每天长**」；中间缺的补不回来 |
| **全量回填** | 官方导出包（服务端生成一次完整导出） | 第一次、或发现历史有缺口 | 后台跑，可能几分钟；页面看 `trigger → waiting-export → downloading → parsing → merging → done` |
| **更新知识库** | 上面两步 + 整理 + 体检 | 想一条命令跑完 | **会消耗模型额度**；有 6 小时新鲜度闸门（见第六节） |

> 判据：**新对话永远在增量能看到的范围内**（列表按 `updated_at` 降序），所以"网页端明明有新对话却报 0"通常不是插件的问题——
> 先确认页面上那条对话的实际时间，再看 `/status` 里 `chain.report` 的 `recon`/`fetch` 读数。

## 四、检索技巧（「找内容」）

- **关键词匹配标题与正文**，大小写不敏感；`role=user` 只看你说的话（找"我当时怎么说的"最有用）。
- 结果是**直接扫 JSONL、不建索引**：几千会话很快，量再大一个量级就得换方案。
- 每条命中可「展开全文」，读的是规范化后的 Markdown（**含思考过程与联网检索记录**）；原文超过 400 KB 会截断并在页面上标注。
- 想批量检索就调路由：`/__dsh-kb-sync/search?q=<关键词>&role=user`（返回 JSON）。

## 五、整理（模型归类与提炼）：试运行与写入

**默认按钮就是试运行**，它的价值是"先看清会写哪些文件、各几条"：

1. 准备输入（复用管线的 `prep-inbox.mjs`）→ 2. 调宿主 `llm` 服务拿**一份 JSON 判断** →
3. 写 `<管线数据目录>/sync/out/` → 4. 用管线的 `apply-extraction.mjs` 校验（归类 idx 集合必须与输入完全一致、话题必须合法、专题 parent 必须匹配）。

**校验不通过就整批不写入**（这是刻意的：让模型直接改档案，钱的数字或健康事实悄悄错掉很难发现）。
「写入并重建」在通过后依次重建：`apply-update-topics` → `build-kb` → `build-specialties` → `map-specialties` → `build-health-profile` → `sync-knowledge`。

- 单次生成上限可配（`processMaxTokens`，默认 4096）；太小会出现空输出（报 `unparseable-output`）。
- 财务永远只进**候选区**，不自动入账。

## 六、手动与自动

**手动（任何平台都能用）**

- 页面上的「更新知识库」按钮（自带 `force:true`，跳过新鲜度闸门）。
- 双击 `<root>\tools\pipeline\trigger.cmd`（Windows）：它只"戳一下"——挑一份可用的 `trigger-source.json` →
  轮询 `/status` 等宿主起来（约 3 分钟）→ `POST /pipeline` → 逐段结果追加进 `trigger.log`。
  **宿主没在运行就 `exit 3`**，并在 `LAST-SYNC.txt` 留一行。

**自动（可选，Windows 计划任务）**

```powershell
# 从零建一条每天 21:00 的（字段与作者本机那条逐项一致：Interactive + StartWhenAvailable + PT30M）
$action    = New-ScheduledTaskAction -Execute '<插件目录>\tools\pipeline\trigger.cmd' -WorkingDirectory '<插件目录>\tools\pipeline'
$trigger   = New-ScheduledTaskTrigger -Daily -At 21:00
$set       = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType Interactive
Register-ScheduledTask -TaskName 'DSH-KB-DailySync' -Action $action -Trigger $trigger -Settings $set -Principal $principal

# 停用 / 恢复 / 删除
Disable-ScheduledTask  -TaskName 'DSH-KB-DailySync'
Enable-ScheduledTask   -TaskName 'DSH-KB-DailySync'
Unregister-ScheduledTask -TaskName 'DSH-KB-DailySync' -Confirm:$false
```

任务必须是「登录时可用（`Interactive`）」：整条链要 POST 到**你登录会话里跑的 DSH 宿主**。

**新鲜度闸门**：距上次成功不足 `chainMinIntervalMs`（默认 6 小时）时返回 `skipped`，避免重复拉取与备份轮转；
计划任务不绕过它，页面按钮 / `{"force":true}` 绕过。

## 七、配置：改哪一份才生效

**优先级**（前一个非空即生效）：loader `config` → 环境变量 → **用户设置文件** → **插件目录里的 `config.json`** → 内置默认。

| 通道 | 位置 |
|---|---|
| loader config | 你的 profile `cordis.patch.yml` 里按插件 id 的那一行 |
| 环境变量 | `DSH_KB_SYNC_ROOT` / `DSH_KB_SYNC_OUT_DIR` / `DSH_PIPELINE_DIR` |
| 设置文件 | `$DSH_HOME/.dsh-kb-sync.json`（未设 `DSH_HOME` 时即 `~/.dsh/.dsh-kb-sync.json`） |
| 插件目录 | `<插件目录>/config.json`（可从随包的 `config.example.json` 复制） |

常用项：`root`（流水线根目录，`syncScript`/`logDir`/`lastSyncFile`/`tokenFile` 由它推）、`outDir`（知识库，默认插件内 `data/kb`）、
`tokenOldDays`（默认 21）、`chainMinIntervalMs`（默认 6 小时）、`processProvider`/`processModel`/`processMaxTokens`。
读到哪几份，看 `/status` 的 `configFile`（`used` / `localUsed`）。

> ⚠️ **改完配置必须重启应用**：`resolveSettings()` 只在插件加载时跑一次，配置缓存在内存里——
> 不重启的话 `/status` 还会报旧值（2026-10-12 实测）。

## 八、数据、备份与迁移

| 内容 | 默认位置 |
|---|---|
| 知识库 | `<插件目录>/data/kb/`：`conversations/*.md` + `conversations.jsonl` + `catalog.json` |
| 管线运行时数据 | `<插件目录>/data/import/`：日志、`LAST-SYNC.txt`、`sync/inbox|out`、健康事实、财务候选 |
| 凭据文件（只 `stat` mtime） | 流水线自己的 `.token`（可在配置里改） |

- **备份轮转**：每次抓取写盘前把旧清单轮转成 `*.backup-<时间戳>`，知识库里保留最近若干代（常量 `KEEP_BACKUP_GENERATIONS`）。
- **迁移**：整个插件目录拷走即可（配置跟着代码走）；数据在 `data/` 里，一起拷。
- **复用别人的库**：把 `outDir` 指到那个目录即可，但要知道两边会各自读-改-写同一份清单。

## 九、排错手册

| 症状 | 判据 / 处置 |
|---|---|
| 抓取报未授权、更新知识库某一步 `token-expired` | token 过期（数小时~数天）→ 在「网页端登录态」里重新粘一次；判据是输出里出现 `AUTH_UNAUTHORIZED`，不是随便一次网络抖动 |
| 手动跑 `trigger.cmd` 得到 `exit 3` | 约 3 分钟没等到 `/status` → **那一刻 DSH 应用没在运行**；起应用再跑 |
| 更新知识库返回 `skipped: fresh` | 6 小时内刚成功过；要强跑就点页面按钮（`force`），或改小 `chainMinIntervalMs` |
| 409 `already-running` / `already-processing` | 上一个同类任务还在跑，等它结束 |
| 整理时空输出 / `unparseable-output` | 单次生成上限太小 → 调大 `processMaxTokens`，重启 |
| `/doctor` 报 `doctor-script-missing` | 体检脚本不存在；`doctorScript` **留空只会回落默认路径**（没有关闭开关） |
| 打开页面 403 / 提示 forbidden | 必须从 `127.0.0.1` / `localhost` 访问；跨站请求会被拒（这是设计） |
| 改完源码不生效 | `file:` 安装是**复制快照**：先 `remove` 再 `add` 这个 bundle，然后**重启应用**（运行中的实例用的是启动时缓存的模块） |
| 页面「展开全文」时间比实际早 8 小时 | 0.1.0 之前的老数据；新版已改成本地偏移写法并修了显示（历史 `.md` 也已就地修正） |
| 列表接口只回 100 条 | 该接口的硬上限，无法翻页；补历史用**全量回填** |
| 计划任务跑了但知识库没长 | 看 `trigger.log` 与 `LAST-SYNC.txt`：多半是上游没有新内容（`fetch` 报"没有需要更新的内容"） |

## 十、语言

- **控制页**：默认中文；`?lang=en` 强制英文；不带参数时跟随浏览器 `Accept-Language`（不认识回落中文）；右上角可切换。
- **应用内设置分节**：跟随宿主界面语言（中英字典）。
- **服务端诊断文案**（`/status` 的 message、各段输出、管线脚本自身输出）目前是中文——它们是排错信息。

## 十一、停用与卸载

```powershell
# 只停用（保留配置与数据）
dsh plugin --profile <profile> remove dsh-kb-sync     # 卸载插件
# 知识库与管线数据都在 <插件目录>/data/ 下，先拷走再删目录
```

安全边界（写死在代码里，不是建议）：只接受环回 Host、非同源 403、写操作必须带 `x-dsh-kb-sync: 1`、
日志名白名单、argv 全显式、凭据文件只 `stat` 不读正文。逐条核对见 [`CAPABILITY-DISCLOSURE.md`](CAPABILITY-DISCLOSURE.md)。
