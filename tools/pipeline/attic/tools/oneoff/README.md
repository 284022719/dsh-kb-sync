# 一次性 / 排错脚本（2026-10-10 从根目录归档）

这里的 32 个脚本原先散落在 `dsh-kb-sync\tools\pipeline\attic\` 根目录，与 43 个**在用**工具链脚本混在一起，
找东西时要先分辨哪个是哪一类。归档判据是客观的：

> **在 `dsh-kb-sync\tools\pipeline\attic\` 全树（含 `sync\*.cmd` / `*.ps1` / `*.md`）以及
> `D:\dsh` 下其它项目目录、Windows 计划任务里，都没有任何引用。**

也就是说：没有任何脚本、命令或文档会调用它们；它们都是当时为了探明某个接口、
检查某个中间产物、或复现某个问题而临时写的。
计划任务 `DSH-KB-DailySync` 只调用 `dsh-kb-sync\tools\pipeline\sync-daily.cmd`，不受影响。

## 清单

| 前缀 | 个数 | 用途 |
| --- | --- | --- |
| `probe2`–`probe8` | 7 | 探明网页端接口返回结构 |
| `check-*` | 6 | 检查中间产物（分支、控制台、标题质量、对齐） |
| `inspect-*` | 4 | 检视导出内容与字段映射 |
| `read-*` / `show-continued` | 4 | 回读单个会话/专题 |
| `verify-*` | 3 | 早期的一次性校验 |
| `test-*` | 4 | 手工试验（控制台、健康会话、剪枝、会话契约） |
| `debug-archive` / `final-check` / `acceptance-check` | 3 | 排错与验收 |
| `add-update4-conclusions` | 1 | 第四批更新的结论补录 |

> 注：`probe.mjs`、`add-update-conclusions.mjs`、`add-update2-conclusions.mjs`、
> `check-update-topics.cjs`、`read-back-session.mjs` **仍留在根目录** ——
> 它们被别处引用或写在 README 里，不属于一次性脚本。

## ⚠️ 移动会破坏相对路径

这些脚本大多按「从 `dsh-kb-sync\tools\pipeline\attic\` 根目录运行」写的，路径类似
`../dsh-kb-sync/data/kb/...`、`./knowledge/...`。放在这里直接跑会找不到文件。

## 要用某个脚本时

**方式一（推荐）**：临时移回根目录，用完再挪回来。

```powershell
cd D:\dsh\dsh-kb-sync\tools\pipeline
git mv tools/oneoff/verify-prune.mjs .
node verify-prune.mjs
git mv verify-prune.mjs tools/oneoff/
```

**方式二**：如果要长期再用，说明它不该在这里 —— 把它移回根目录，
并补进 `README.md` / `sync\README.md` 的工具表，让它重新变成「被引用」的脚本。

## 想撤销这次归档

```powershell
cd D:\dsh\dsh-kb-sync\tools\pipeline
git mv tools/oneoff/*.mjs .
```

或直接回退到归档前的那次提交（`git log --oneline` 找到 `chore(tools):` 之前的那条）。
