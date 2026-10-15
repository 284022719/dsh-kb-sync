# 发布须知（作者自用）

> 这份文档回答一个问题：**这个仓库/这个包，哪些东西可以公开，哪些绝对不能。**
> 起因（2026-10-12）：待发布范围里有 121 个新增文件，其中 `tools/pipeline/attic/analysis-index.tsv`（273 KB）、
> `health-selection.json`（87 KB）、`attic/probe-messages.sample.json` 是**真实会话的标题、路径与消息体**——
> 一旦推到公开仓库就是个人数据泄露。审计后把它们搬出代码目录并停跟踪。

## 一、绝对不进仓库、不进发布包

| 东西 | 为什么 | 现在在哪 |
|---|---|---|
| 知识库本体 | 全部历史对话 | `data/kb/`（`.gitignore` 的 `data/`） |
| 管线运行时数据 | 语料、健康事实、财务候选、日志、凭据 home | `data/import/` |
| `health-selection.json` | 真实会话**标题 + 日期 + 文件路径** | `data/import/health-selection.json` |
| `pipeline-attic/`（原 `tools/pipeline/attic/`） | 语料分析（`analysis-*`）、接口探针样本（`probe-*`）、一次性脚本 | `data/import/pipeline-attic/` |
| `specialties-map.json`（代码目录那份） | 由个人语料派生的专题映射（运行时用的是 `data/import/` 那份） | `data/import/pipeline-attic/specialties-map.stale-copy.json` |
| `config.json` / `tools/pipeline/pipeline.json` | 含本机绝对路径与个人目录布局（**用户装上后会静默读错数据目录**） | 本机 |
| `tools/pipeline/trigger.log`、`trigger.json`、`trigger-source.json` | 本机运行日志与触发器的端口事实 | 本机 |
| `tools/pipeline/retired/` | 退役脚本（留档用，插件不调用；其中一个 `.cmd` 里还有中文） | 仓库里保留 |
| `.token` / 凭据 | 账号凭据 | `~/.dsh/`（仓库外） |

`.gitignore` 已经有对应条目（`data/`、`config.json`、`pipeline.json`、`health-selection.json`、
`specialties-map.json`、`tools/pipeline/attic/`、`trigger.json`、`trigger-source.json`、`trigger.log`）——**别删**。

> ⚠️ **`.gitignore` 管不住发布包**：`files` 里写了整个 `tools/pipeline` 目录时，npm 会把目录里的**运行时文件**
> 一起装进去（2026-10-12 实测：`pipeline.json`、`trigger.log`、`retired/` 都进了包）。
> 而且**有 `files` 字段时 `.npmignore`/`.gitignore` 不生效** —— 唯一的排除手段是在 `files` 里写**取反项**：
> `"!tools/pipeline/pipeline.json"` 这种。这些取反项已就位，并由 `test/shipped.test.mjs` 钉住。

## 二、可以公开的（发布包内容）

`package.json` 的 `files` 白名单：`lib/`、`locale/`、`docs/`、`tools/pipeline/`（含 5 条取反项）、
`assets/screenshots/`、`screenshots.json`、`cordis.patch.yml`、`config.example.json`、`CHANGELOG.md`、
`README.md`、`README.en.md`、`CONTRIBUTING.md`、`SECURITY.md`、`LICENSE`。2026-10-16 实测 **58 个文件 / 480 KB**。

注意 **`tools/pipeline/` 是"作者自己的参考流水线"**：里面是通用代码（拉取、重建、检索、体检），
不含个人数据。别人的用法是把它换成自己的管线目录（`config.pipelineDir`）。

## 三、发布前检查清单

```sh
npm run preflight        # 一条命令跑完下列五步；退出码就是结论
```

| 步骤 | 查什么 |
|---|---|
| `npm test` | 用例全绿（含随包卫生、文档一致性、插件⇄管线契约） |
| `npm run check` | 每个 lib 文件语法 + ESM import 冒烟 |
| `npm run check:types` | 类型声明能编译（未装 devDependencies 会明确跳过，不假装通过） |
| 发布包内容 | `npm pack --dry-run --json`：**不该出现的**（`attic`/`retired`/`health-selection`/`pipeline.json`/`trigger.*`/`.token`…）与**必须有的**（两侧入口、`index.d.ts`、`locale`、两份 README、`screenshots.json`）逐项核对 |
| `dsh-trust-check` | 能力披露（宿主自带工具；红线是登记过的，所以只看它跑没跑起来。离线可加 `--no-npx`） |
然后人工过一遍 **包内是否出现个人数据 / 本机运行时文件**（这条是机械检查，务必做）：

```powershell
$j = npm pack --dry-run --json | ConvertFrom-Json
$bad = $j.files.path | Where-Object { $_ -match 'attic|health-selection|specialties-map|analysis-|probe-|conversations|\.token|pipeline\.json|trigger\.(log|json)|trigger-source|retired' }
if ($bad) { "❌ 包内出现不该发布的东西：$($bad -join ', ')" } else { "✓ 干净（2026-10-16 实测 58 个文件）" }
```

> 这条正则 2026-10-12 才补全：此前漏了 `pipeline.json` / `trigger.log` / `retired`，它们确实进过包
> （`test/shipped.test.mjs` 现在会拦住回归）。

还有三件与"内容"无关但同样会卡住发布的事：

1. **历史也会泄露**：`git rm --cached` 只清理新提交，**旧提交里的 blob 依旧会被推上去**。
   发布前必须让待推历史的树是干净的 —— 做法是**以远端那次提交为父，把当前干净快照压成**
   **一个**发布提交（`git commit-tree <当前树的 hash> -p <远端 tip> -F <说明文件>`，再建 release 分支与 tag），
   而不是直接推一串开发提交。
   > 2026-10-16 实测：本地 `main` 的开发史里**真有 3 个提交**碰过个人语料产物
   > （`3028ec3` 引入 `tools/pipeline/attic/analysis-index.tsv` 与 `health-selection.json`、
   > `ae65022` 又动过、`95e0d84` 才删掉）—— 直接 `git push origin main` 等于把这些 blob 永久推上公网。
   > **判据**：压完快照跑 `git rev-list <快照> --count -- tools/pipeline/attic tools/pipeline/health-selection.json`，
   > **必须为 0**；再 `git ls-tree -r --name-only <快照>` 搜一遍 `attic|health-selection|analysis-|probe-`。
2. **公开前先在"新克隆"里跑一遍 CI 的全套命令**（本机没有 CI 环境时最接近的替代）：
   `git clone <仓库> tmp && cd tmp && npm ci && npm test && npm run check && npm run check:types && npm run pack:check`。
   > 2026-10-16 实测这条**当场抓到一个真问题**：`data/` 被 gitignore，新克隆里不存在，
   > 而文档链接检查要求文档里的本地链接真实存在 —— 仓库的 `AGENTS.md` 当时链接了 `data/kb`，
   > **本机（`data/` 在）全绿、新克隆与 CI 必红**。判据：这类路径写成代码片段，别写成文件链接。
   > 顺带也验证了 `package-lock.json` 能被 `npm ci` 用（integrity 校验通过）。
3. **网络抖动**：本机到 `github.com` 的 TLS 是间歇性失败（2026-10-12 实测约 1/3 成功率；
   **2026-10-16 复测仍是约 1/3**：8 次里成功 3 次）。推送失败先重试几次，别改 TLS 校验开关。

## 四、本地开发身份

`git config user.name` = `YanH`；推送凭据走 `gh auth git-credential`（`gh` 已登录仓库属主账号，
`repo` scope），推送不需要手工输 token。

> ⚠️ **提交里的作者邮箱会随推送公开**（GitHub 会把它显示在每次提交上）。介意的话在推送前改成
> GitHub 的 noreply 地址（`Settings → Emails` 里那一串），或在 `git config user.email` 里换掉。

## 五、推送之后（GitHub 侧）

清单按重要性排，前两条不做等于"发了个没人能发现的东西"：

| # | 事项 | 怎么做 / 判据 | 状态（2026-10-16 核对） |
|---|---|---|---|
| 1 | **给仓库加 topic `dsh-plugin`** | 社区清单靠 GitHub topic 收录（应用里搜的就是这个字符串）；网页 Settings → Topics，或 `gh api -X PUT repos/:owner/:repo/topics -f names[]=dsh-plugin -f names[]=deepseek-harness` | ✅ 已设：`deepseek-harness` / `dsh` / `dsh-plugin` / `knowledge-base` |
| 2 | **确认 CI 绿** | 推完看 Actions：`ubuntu + windows × Node 20/22/24` 六个作业。**Linux 那条同时验证了 POSIX 执行分支**（本机 WSL/Docker 起不来，这条是唯一的平台验证） | ⏳ 等推送。⚠️ 仓库此前**一次 CI 都没跑过** —— `.github/workflows/ci.yml` 加在 `580f160`，而它不在远端 tip `7916e43` 里 |
| 3 | **打 tag + Release** | 见下方"发布 0.2.0 的确切命令"（本地已建好 `v0.2.0` 并验证） | ⏳ 等推送 |
| 4 | 检查 README 首图 | GitHub 上 `assets/screenshots/preview-01-control-page.png` 要能显示（相对路径 ✓，且图已在仓库里） | ⏳ |
| 5 | 可选：发 npm | `npm publish --access public`（包名 `dsh-kb-sync`）。发布前跑一遍第三节的清单 | ⏳ 2026-10-16 实测 npm 上仍是 **404**（名字没被占） |
| 6 | 仓库描述 | 必须**与能力披露一致**：别提"No credentials, no network"（拉取半读凭据值、出网），那是 2026-10-11 只做编排时的旧话 | ✅ 2026-10-16 已改为"…Pull half reads a web token and calls chat.deepseek.com." |

### 发布 0.2.0 的确切命令（2026-10-16 全部本地验证，含 `--dry-run`）

```sh
# 0) 把这一版提交在 main 上，然后以「远端 tip」为父压出一个发布快照
git rev-list origin/main -1                                   # 应为 7916e43（远端 tip 没动过才安全）
TREE=$(git rev-parse 'HEAD^{tree}')
COMMIT=$(git commit-tree $TREE -p origin/main -F <发布说明文件>)
git branch release/0.2.0 $COMMIT
git tag -a v0.2.0 $COMMIT -m "dsh-kb-sync 0.2.0"

# 1) 推之前的三条自查（第三节第 1 条那两个判据 + 树一致性）
git diff --stat HEAD release/0.2.0                            # 必须为空：快照与 main 的树一致
git rev-list release/0.2.0 --not origin/main --count          # 必须是 1：只多一个提交
git rev-list release/0.2.0 --count -- tools/pipeline/attic tools/pipeline/health-selection.json   # 必须是 0

# 2) 推（TLS 会抖：失败就重试几次；凭据走 gh）
git -c credential.helper='!gh auth git-credential' push origin release/0.2.0:main
git -c credential.helper='!gh auth git-credential' push origin v0.2.0

# 3) Release：把 CHANGELOG 的 0.2.0 那一节单独存成文件当 notes
gh release create v0.2.0 --title "dsh-kb-sync 0.2.0" --notes-file <0.2.0 那一节的 markdown>
```

> 2026-10-16 用 `--dry-run` 验证过：`release/0.2.0 → main` 是 **fast-forward**（`7916e43..28ee842`），
> tag 是新建的。当时远端**没有任何 tag / release**，本地那条 `release/0.1.0` 快照**从未推上去过** ——
> 所以 **v0.2.0 是这个仓库第一个带 tag 的发布**；CHANGELOG 里 0.1.0 那一节记的是"当时写完、
> 但没以 tag / npm 形式发出去"的那一版内容。
>
> 发布后如果还要改内容：**新提交的树里也不能出现第一节那些东西** —— `.gitignore` 已经拦住，
> 但历史上曾经出现过的 blob 不会因为新提交而消失（见第三节第 1 条）。

