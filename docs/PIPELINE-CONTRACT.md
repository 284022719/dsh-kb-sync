# 插件 ⇄ 管线脚本的接口契约

> 插件不 import 管线脚本，而是**按 argv 调它们**（`node <script> [args]`，cwd = 管线目录），再从
> **stdout 里的标记**与**退出码**判断成败。这层接口没有任何类型系统兜着：一侧改了标志或输出措辞，
> 另一侧可能只是"看起来还在跑"。这份文档把它写死，`test/shipped.test.mjs` 里有一条测试钉住可机械检查的部分。
>
> 证据出处都在本机代码里（2026-10-12 读，行号指当时版本）。

## 一、调用表

| 谁调 | 脚本 | argv | cwd | 超时 | 判定成功的依据 |
|---|---|---|---|---|---|
| 段 2 准备 | `prep-inbox.mjs` | `[]` | 管线目录 | 15 min | 退出码 0（`lib/index.js:1023`） |
| 段 2 只校验 | `apply-extraction.mjs` | `['--dry-run']` | 管线目录 | 15 min | stdout 含 `全部校验通过`（`lib/index.js:1081`） |
| 段 2 落盘 | `apply-extraction.mjs` | **`[]`** | 管线目录 | 15 min | stdout 含 `全部校验通过`（`lib/index.js:1109`） |
| 整链 ② 侦察 | `recon-update.mjs` | `['1']`（历史遗留的位置参数，脚本里已不起作用） | 管线目录 | 15 min | 退出码 + 阶段标记（`lib/index.js:730`） |
| 整链 ③ 抓取 | `update-from-api.mjs` | `[]` | 管线目录 | 15 min | 退出码 + 阶段标记（`lib/index.js:746`） |
| 落盘后重建 | `apply-update-topics.mjs` → `build-kb.mjs` → `build-specialties.mjs` → `map-specialties.mjs` → `build-health-profile.mjs` → `sync-knowledge.mjs` | 每个都 `[]` | 管线目录 | 各 15 min | 每个脚本的退出码（`lib/index.js:955-962`, `1121`） |
| 体检 | `doctorScript`（默认 `<知识库>/tools/kb.mjs`） | `doctorArgs`（默认 `['doctor']`） | 知识库目录 | 5 min | 退出码 + stdout/stderr 原样回给页面（`lib/index.js:157`, `582`） |
| 你已有的同步脚本 | `syncScript` | 见 `syncArgv()`：`.cmd/.bat` → `cmd.exe /c`；`.ps1` → `pwsh -File`；其它 → `/bin/sh`（POSIX 分支） | 脚本所在目录 | `timeoutMs`（默认 1 h） | 退出码 + 状态文件（`lib/index.js:505-542`） |

**脚本侧自己声明的用法**（`apply-extraction.mjs` 头部注释）：

```
node apply-extraction.mjs            # 校验 + 落盘
node apply-extraction.mjs --dry-run  # 只校验：跑完全部判据、打印将要写什么，不碰任何文件
```

## 二、踩过的坑（这层接口最典型的坏法）

**标志名两侧不一致，而且"错的那侧"因为未知参数被忽略而看起来能跑。**

- 插件原来调落盘时传 `['--apply']`；`apply-extraction.mjs` 里只有
  `const DRY = process.argv.includes('--dry-run')` —— **它不认 `--apply`**。
- 于是"落盘"能成功，纯粹因为**没有 `--dry-run` 就等于落盘**。风险：
  一旦脚本改成默认只校验（或加严格参数解析），插件那个「跑并落盘 + 重建」按钮就会**静默变成只校验**——
  按钮没报错、日志看着正常、知识库不更新。
- 2026-10-12 修：插件落盘改为**不传标志**，与脚本文档写的用法一致。
- 另一个方向的历史遗留：侦察阶段传的位置参数 `['1']`（旧的"要翻几页"），现在脚本里已被忽略、
  但插件还在传 —— 无害，留着是为了不改变对旧脚本的行为。

## 三、机械防线

`test/shipped.test.mjs` 里两条断言：

1. **插件引用的脚本必须存在**：`lib/` 里出现的每个 `<name>.mjs` 字面量都要能在
   `tools/pipeline/`（或它指到的位置）里找到 —— 防的是"脚本改名了，插件还在调旧名字"。
2. **插件传的标志必须被脚本承认**：`runPipelineScript(files.X, ['--flag'], …)` 里的每个 `--flag`
   都要在对应脚本的源码里出现过 —— **上面那个 `--apply` 就是这样被抓出来的**
   （脚本里只有 `--dry-run`）。位置参数（`'1'`）不查，它们可能是脚本的业务参数。

## 四、还没覆盖的

- 输出**措辞**（`全部校验通过` 这类）没有测试兜着：脚本改一个字，插件就会把成功的落盘判成失败。
  目前靠人看；要机械检查得让脚本输出结构化结果（例如最后一行 JSON），那是脚本侧的重构，
  两边都在跑生产任务，不在这一轮做。
- 退出码语义（哪些非零算"需要修"、哪些算"上游没问题"）散在 `lib/pipeline.js` 的阶段表里，
  与脚本自身的退出码没有交叉校验。
