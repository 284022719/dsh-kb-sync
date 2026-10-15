# D:\dsh\dsh-kb-sync —— 插件的仓库约定（L3 子项目）

> 本文件 2026-10-16 新建（`/init`）。层级按 `~\.dsh\RULES-PLAN.md` §二：**L3 子项目约定**，
> 只在 cwd 落在本目录内时注入；代理可自主增删。
> **条目来源标注**（每条末尾）按 §三-①：`【硬经验】`＝踩过、有实测代价 ／ `【设计约束】`＝源自代码或既有文档 ／
> `【未验证】`＝推断或约定。**标签定义以 §三-① 为唯一出处，本文件不抄第二遍。**

## 0. 先读这三条，能省掉一轮摸索

1. **本仓库有自己的 `.git`，所以 `projectRoot` ＝本目录** —— `D:\dsh\AGENTS.md`（L2）**不会被注入**
   （本会话实测：注入的是 `~\.dsh\AGENTS.md` 与 `data\import\health-facts\AGENTS.md`，L2 缺席）。
   凡涉及**本仓库以外**的事（知识库 `data\kb`、健康档案、控制台、成果登记），**主动去读 L2**，
   别按"没被注入＝不存在"下结论。【设计约束】
2. **`data/` 里的东西一个字都不能公开**（详见 §5）。改任何随包文件后跑 `npm run preflight`。【硬经验】
3. **`README.md` 的路由表、用例数、链接是被测试机械校验的** —— 改代码不改文档 = 测试变红（§4.1）。【设计约束】

## 1. 这是什么

DSH 插件，**一个插件三块能力**：① 自己拉取（读凭据值 + 出网，`dsh-trust-check` 判 **1 条红线**）／
② 编排（起用户已有的同步命令，不读凭据不出网）／③ 整理（进程内调宿主 `llm` 做 JSON 判断，校验通过才落盘）。
当前定位、路由表、配置四条通路、已知限制的**权威出处是 [`README.md`](README.md)**（英文
[`README.en.md`](README.en.md)，任务导向指南 [`docs/USAGE.md`](docs/USAGE.md)）—— 本文件不重复它们，只写
"在这个仓库里动手时才会踩到"的东西。

## 2. 代码地图（谁是权威）

| 路径 | 作用 | 注意 |
|---|---|---|
| [`lib/index.js`](lib/index.js) | 宿主半部：14 条路由 + 整链编排 + 整理流程 | **约 1600 行、单文件**，改动前先 `grep` 定位 |
| [`lib/page.js`](lib/page.js) | 控制页单文件 HTML（内联 CSS/JS，无外部请求） | 版式约定见 §4.2 |
| [`lib/client.js`](lib/client.js) | 客户端半部：设置分节（手写，**无构建步骤**） | 装配契约见 [`docs/CLIENT-HALF.md`](docs/CLIENT-HALF.md) |
| [`lib/locale.js`](lib/locale.js) + [`locale/en.json`](locale/en.json) | 页面译文；**中文是源语言，键就是中文原文** | 缺译回落中文；英文整页不得残留中文（§4.3） |
| [`lib/deepseek.js`](lib/deepseek.js) / [`lib/export.js`](lib/export.js) | 接口调用 / 官方导出包解析 | 增量翻不了页（`count` 上限 100）是**实测结论**，别"顺手修一下" |
| [`lib/store.js`](lib/store.js) | 知识库落盘（越界即拒） | 写入必须落在配置的 `outDir` 内 |
| [`lib/process.js`](lib/process.js) / [`lib/pipeline.js`](lib/pipeline.js) | 整理（模型判断）/ 阶段判成（`classifyStage`） | 判成**退出码优先**，不看措辞（§4.5） |
| [`tools/pipeline/`](tools/pipeline/README.md) | **作者自己的参考流水线**（随包发布，通用代码、无个人数据） | 别人用法是换目录（`config.pipelineDir`） |
| `data/kb/` · `data/import/` | 用户全部历史对话 + 管线运行时数据 | **不入库、不随包**（所以新克隆里没有它们 —— 文档里不要写成文件链接）；`data/import/health-facts` 是**独立 git 仓库** |
| [`docs/`](docs/PIPELINE-CONTRACT.md) · [`test/`](test) | 契约文档 / 8 个测试文件（91 例） | 契约细节一律读 docs，不要从代码反推后再写进文档 |

## 3. 命令

```sh
npm test              # node --test，8 个文件 91 例（2026-10-16 实测 91 pass / 0 fail）
npm run check         # 逐文件语法检查 lib/*.js + 管线两个入口 + ESM import 冒烟
npm run check:types   # tsc --noEmit（唯一 devDependency 是 typescript；未装会明确跳过）
npm run pack:check    # npm pack --dry-run：看发布包内容
npm run preflight     # 发布前预检＝上面四项 + 能力披露，退出码即结论
node tools/make-screenshots.mjs   # 重生成 README 截图（假数据演示服务 + 无头 Chrome；开发工具、不入包）
```

Node ≥ 20（本机实测 24.19.0）。CI 跑 `ubuntu + windows × Node 20/22/24` —— **Linux 那条是唯一的 POSIX 执行分支验证**。【设计约束】

## 4. 会静默坏掉的约束（每条都有测试钉着，改前先读对应测试）

### 4.1 文档是"被校验的" —— [`test/docs.test.mjs`](test/docs.test.mjs)

- `README.md` 里的路由表必须与 `lib/index.js` 的 `sub === '...'` **一一对应**（多一条少一条都失败）；
- 所有文档里的本地链接必须指向真实存在的文件；
- 文档里提到的 `npm run <script>` 必须真实存在；
- `README.md` 必须写明「全部 **N** 个用例」且 `N` ＝ `test/*.test.mjs` 里顶层 `test(` 的实测总数
  （**动态发现测试文件**，所以加了用例要顺手改两份 README 的数字）；
- `screenshots.json` 里列的图必须存在、是 PNG、且进了发布包。

### 4.2 界面里不许出现内部术语 —— [`test/locale.test.mjs`](test/locale.test.mjs) + [`test/plugin.test.mjs`](test/plugin.test.mjs)

`段 1 / 段 2 / 整链 / 阶段 2,3 / dry-run / 落盘 / dsh headless / ①②③④⑤` 一律不许出现在**渲染结果**里
（一条从页面直接钉，一条从**真路由返回的 HTML** 再钉一次）。说人话：抓取 / 整理 / 更新知识库 / 试运行 / 写入。
**版式是用户 2026-10-15 点名重排过的**：首屏只留结论条，分区按任务（收新对话 / 找内容 / 整理 / 运行详情与诊断），
**不编号**，同一个动作只有一个按钮 —— **别退回那一版**。【硬经验】

### 4.3 英文页整页不得残留中日韩表意文字

`?lang=en` 的渲染结果会剥掉译文表与白名单后扫描残留 CJK → **内联 `<script>` / `<style>` 里的注释也必须是 ASCII**
（2026-10-15 踩过：三处中文注释当场变红）。同时：
- `lib/client.js` 的中英字典**两侧键集合必须完全一致**（[`test/client.test.mjs`](test/client.test.mjs) 有断言）；
- 内联脚本里每个 `T('…')` 字面量都必须在译文表里，且脚本要能 `new Function` 解析。

### 4.4 插件的装机链路任一环错都是**静默失败** —— [`docs/INSTALL-PATH.md`](docs/INSTALL-PATH.md)

`cordis.patch.yml` 的 insert 行 `id`/`name` **必须等于包名**（`dsh-kb-sync`）；`dsh.client.platform` 必须是 `web`
（否则静默跳过）；`exports["./client"]` 只接受字符串或带字符串 `default` 的对象；
产物里 `__ModuleLoader__.load({id})` 的 id 必须等于包名。这些规则逐条抄在
[`test/client.test.mjs`](test/client.test.mjs) 与 `test/docs.test.mjs` 里。【设计约束】

### 4.5 插件 ⇄ 管线脚本的接口没有类型系统兜着 —— [`docs/PIPELINE-CONTRACT.md`](docs/PIPELINE-CONTRACT.md)

- **插件传给脚本的每个 `--flag` 必须在脚本源码里出现过**（[`test/shipped.test.mjs`](test/shipped.test.mjs) 静态断言）。
  历史事故：落盘时传 `--apply`，而 `apply-extraction.mjs` 只认 `--dry-run` —— "能跑"纯粹因为
  **未知参数被忽略**；脚本哪天改成默认只校验，那个按钮就**静默退化成只校验**。【硬经验】
- **判成功不看措辞**：用 `lib/pipeline.js` 的 `classifyStage`（退出码优先），
  `全部校验通过` 只剩"容忍 Node 退出期噪声"的用途。有人写回 `/…校验通过…/.test(` 会被断言拦下。【硬经验】

### 4.6 发布包内容靠 `files` 取反项，`.gitignore` 管不住它

有 `files` 字段时 `.npmignore`/`.gitignore` **不生效**，排除只能写 `"!tools/pipeline/xxx"`。
已就位 5 条取反项（`pipeline.json` 含本机绝对路径、`trigger.log`/`trigger.json`/`trigger-source.json` 是本机运行事实、
`retired/`）。**别删** —— 它们确实进过包。【硬经验】

## 5. 绝对不能公开的东西（发布前逐条对 [`docs/PUBLISHING.md`](docs/PUBLISHING.md)）

- **知识库本体**（`data/kb/`）与**管线运行时数据**（`data/import/`：对话语料、健康事实、财务候选、日志、`.dsh-home` 里的凭据）；
- `config.json` / `tools/pipeline/pipeline.json`（含本机绝对路径，**用户装上会静默读错数据目录**）；
- `tools/pipeline/trigger.*`、`health-selection.json`、`specialties-map.json`、`pipeline-attic/`；
- `.token`／凭据（在 `~/.dsh/`，仓库外）。

两条容易漏的：【硬经验】
1. **`git rm --cached` 不清理历史 blob** —— 已进过提交的个人数据必须让"待推的树"是干净的
   （以远端那次提交为父压成一个发布提交），不是直接推一串开发提交。
2. **`tools/pipeline/retired/` 留在仓库**（留档用，插件不调用），但**不随包**。
   另：随包的 `.cmd/.bat` 必须纯 ASCII 无 BOM（cmd.exe 按 GBK 读；`.ps1` 允许中文）——有测试钉着。

```powershell
# 机械核对包内有无个人数据/本机运行时文件（细则在 docs/PUBLISHING.md 第三节）
$j = npm pack --dry-run --json | ConvertFrom-Json
$bad = $j.files.path | Where-Object { $_ -match 'attic|health-selection|specialties-map|analysis-|probe-|conversations|\.token|pipeline\.json|trigger\.(log|json)|trigger-source|retired' }
if ($bad) { "❌ 包内出现不该发布的东西：$($bad -join ', ')" } else { "✓ 干净" }
```

## 6. 本机运行事实（改完代码要真看到效果，得这么做）

- **`file:` 安装是"复制快照"**：改完代码要 `dsh plugin --profile <profile> remove dsh-kb-sync` → `add` → **重启应用**；
  插件的信任指纹会随代码变化失效，需要在 **设置 → 插件体检** 里重新确认一次。【硬经验】
- **配置只在插件加载时解析一次并缓存** —— 改配置文件后 `/status` 仍报旧值（实测：换了 `syncScript` 后
  仍显示已退役的 `sync-daily.cmd`）。**改配置必须重启**，页面能改反而会骗人，所以刻意不做配置编辑。【硬经验】
- **整链只活在宿主里**：DSH 应用没在跑时，`tools/pipeline/trigger.cmd` 等约 3 分钟后 `exit 3`。
  计划任务 `DSH-KB-DailySync` 已于 2026-10-12 按用户要求**删除**，现在只有手动入口
  （控制页「更新知识库」按钮，或双击 `trigger.cmd`）；重建命令见 [`tools/pipeline/README.md`](tools/pipeline/README.md) 第三节。
- **本机知识库不在仓库里**：`data/kb/`（`conversations/*.md` + `conversations.jsonl` + `catalog.json`）。
  规模别写死，跑 `node data\kb\tools\kb.mjs stats`。检索入口与"不要全量递归"的判据见 `D:\dsh\AGENTS.md`。【设计约束】

## 7. 复核发现与处置（2026-10-16）

- **文档里不要链接 `data/` 下的路径**（当场踩到）：`data/` 被 gitignore，**新克隆与 CI 里都不存在**，
  而 §4.1 那条链接检查会逐个要求文档里的本地链接真实存在 —— 链接到它 = **CI 直接红**。
  2026-10-16 在"新克隆"沙盒里就是这么红的（本文件当时把 `data/kb` 写成了文件链接）。
  判据：这类路径一律写成代码片段（`data/kb` 这样），不写成文件链接。【硬经验】
- **`lib/index.js` 头部的能力陈述已修正**（2026-10-16）：那段 docblock 是"只做编排"的早期版本留下来的，
  写着 "**No credentials** … never touches the DSH `credentials` service" 与 "**No network**"，
  而同一文件早在调 `credentials.resolve()`；路由清单也停在 5 条（实际 14 条）。现在改成按**三块能力分别陈述**、
  写明红线在哪，并逐行列出 14 条路由；配套加了断言（头部清单必须与实际路由一一对应、写的总数必须相等）。
  ⚠️ **同一事实还有第二个落点**：GitHub 仓库的 description 当时也写着 "No credentials, no network of its own"，
  2026-10-16 一并改掉 —— 一处能力陈述有多个落点时，**要么同一次改完，要么就会漂**。【硬经验】
- **`data\import\health-facts\AGENTS.md` 是受保护规则文件**（在 `D:\dsh\tools\rules-files.mjs` 清单里），
  **本文件没有登记进那份清单**。要不要补进去由用户定（参照该文件 48–49 行对 `session-length.js` 的同类留白）。【未验证】

## 8. 提交与协作

- **两个仓库**：本目录的 `.git` 与 `data\import\health-facts\.git` 各提交各的；**`data/` 被根仓库整个忽略**，
  所以新克隆里没有它（§4.1 的链接检查对此有反应，见 §7）。动手前先 `git status`。
- 提交信息沿用本仓库既有风格：`type(scope): 中文正文`，正文写**为什么**与实测读数（`feat/fix/docs/test/chore`）。
- 派 `workflow`/`subagent` 的子代理**会把提示当执行指令、真的写文件** —— 在本仓库演示时显式命令它写 `tmp\`
  或"不要写文件、只返回结构化结果"（判据见 L1「实测陷阱」与 L2「批量任务的编排」）。【硬经验】

## 9. 本文件怎么改

`~\.dsh\RULES-PLAN.md` §三（新增 / 归属 / 复核 / 退役）+ §九（治理预算与停止规则）适用。
落地判据只有一句：**只写"在本仓库动手时才会踩到"的东西**，其余放指针并带章节名 ——
README / docs / `tools/pipeline/README.md` 已有的内容不要搬进来（"一个事实一个家"）。
