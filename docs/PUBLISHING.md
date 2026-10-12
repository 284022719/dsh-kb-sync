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
| `config.json` / `tools/pipeline/pipeline.json` | 含本机绝对路径与个人目录布局 | 本机 |
| `.token` / 凭据 | 账号凭据 | `~/.dsh/`（仓库外） |

`.gitignore` 已经有对应条目（`data/`、`config.json`、`pipeline.json`、`health-selection.json`、
`specialties-map.json`、`tools/pipeline/attic/`）——**这六条别删**。

## 二、可以公开的（发布包内容）

`package.json` 的 `files` 白名单：`lib/`、`locale/`、`docs/`、`tools/pipeline/`、`cordis.patch.yml`、
`config.example.json`、`CHANGELOG.md`、`README.md`、`README.en.md`、`LICENSE`。

注意 **`tools/pipeline/` 是"作者自己的参考流水线"**：里面是通用代码（拉取、重建、检索、体检），
不含个人数据。别人的用法是把它换成自己的管线目录（`config.pipelineDir`）。

## 三、发布前检查清单

```sh
npm test                 # 67 例必须全绿
npm run check            # 语法 + import 冒烟
npm run pack:check       # 看发布包内容
```

然后人工过一遍 **包内是否出现个人数据**（这条是机械检查，务必做）：

```powershell
$j = npm pack --dry-run --json | ConvertFrom-Json
$bad = $j.files.path | Where-Object { $_ -match 'attic|health-selection|specialties-map|analysis-|probe-|conversations|\.token' }
if ($bad) { "❌ 包内出现疑似个人数据：$($bad -join ', ')" } else { "✓ 干净" }
```

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
