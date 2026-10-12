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
`README.md`、`README.en.md`、`LICENSE`。2026-10-12 实测 **55 个文件 / 622 KB**。

注意 **`tools/pipeline/` 是"作者自己的参考流水线"**：里面是通用代码（拉取、重建、检索、体检），
不含个人数据。别人的用法是把它换成自己的管线目录（`config.pipelineDir`）。

## 三、发布前检查清单

```sh
npm test                 # 80 例必须全绿
npm run check            # 语法 + import 冒烟
npm run check:types      # 类型声明能编译（需先 npm install）
npm run pack:check       # 看发布包内容
```

然后人工过一遍 **包内是否出现个人数据 / 本机运行时文件**（这条是机械检查，务必做）：

```powershell
$j = npm pack --dry-run --json | ConvertFrom-Json
$bad = $j.files.path | Where-Object { $_ -match 'attic|health-selection|specialties-map|analysis-|probe-|conversations|\.token|pipeline\.json|trigger\.(log|json)|trigger-source|retired' }
if ($bad) { "❌ 包内出现不该发布的东西：$($bad -join ', ')" } else { "✓ 干净（2026-10-12 实测 55 个文件）" }
```

> 这条正则 2026-10-12 才补全：此前漏了 `pipeline.json` / `trigger.log` / `retired`，它们确实进过包
> （`test/shipped.test.mjs` 现在会拦住回归）。

还有两件与"内容"无关但同样会卡住发布的事：

1. **历史也会泄露**：`git rm --cached` 只清理新提交，**旧提交里的 blob 依旧会被推上去**。
   发布前必须让待推历史的树是干净的（例如以远端那次提交为父、把当前干净快照压成**一个**发布提交），
   而不是直接推一串开发提交。
2. **网络抖动**：本机到 `github.com` 的 TLS 是间歇性失败（2026-10-12 实测约 1/3 成功率）。
   推送失败先重试几次，别改 TLS 校验开关。

## 四、本地开发身份

`git config user.name` = `YanH`；推送凭据走 `gh auth git-credential`（`gh` 已登录仓库属主账号，
`repo` scope），推送不需要手工输 token。

> ⚠️ **提交里的作者邮箱会随推送公开**（GitHub 会把它显示在每次提交上）。介意的话在推送前改成
> GitHub 的 noreply 地址（`Settings → Emails` 里那一串），或在 `git config user.email` 里换掉。

## 五、推送之后（GitHub 侧）

清单按重要性排，前两条不做等于"发了个没人能发现的东西"：

| # | 事项 | 怎么做 / 判据 |
|---|---|---|
| 1 | **给仓库加 topic `dsh-plugin`** | 社区清单靠 GitHub topic 收录（应用里搜的就是这个字符串）；网页 Settings → Topics，或 `gh api -X PUT repos/:owner/:repo/topics -f names[]=dsh-plugin -f names[]=deepseek-harness` |
| 2 | **确认 CI 绿** | 推完看 Actions：`ubuntu + windows × Node 20/22/24` 六个作业。**Linux 那条同时验证了 POSIX 执行分支**（本机 WSL/Docker 起不来，这条是唯一的平台验证） |
| 3 | **打 tag + Release** | `git tag -a v0.1.0 release/0.1.0 -m "dsh-kb-sync 0.1.0"` → `git push origin v0.1.0`；再用 `gh release create v0.1.0 --notes-file CHANGELOG.md`（或直接贴那一节） |
| 4 | 检查 README 首图 | GitHub 上 `assets/screenshots/preview-01-control-page.png` 要能显示（相对路径 ✓，且图已在仓库里） |
| 5 | 可选：发 npm | `npm publish --access public`（包名 `dsh-kb-sync`）。发布前跑一遍第三节的清单；`files` 白名单已经只含可公开内容 |
| 6 | 可选：仓库描述 | 用 `package.json` 的 `description`；主页指向 npm 或 README 锚点 |

> 发布后如果还要改内容：**新提交的树里也不能出现第一节那些东西** —— `.gitignore` 已经拦住，
> 但历史上曾经出现过的 blob 不会因为新提交而消失（见第三节第 1 条）。

