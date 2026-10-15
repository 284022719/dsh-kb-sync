# 参与开发 / Contributing

> English summary at the bottom.

先谢谢你有兴趣。这个仓库的规矩不多，但有几条是**测试钉着的**——违反会当场变红，而不是靠人记得。

## 环境

- **Node ≥ 20**（`engines` 下限；CI 跑 20 / 22 / 24）
- `npm install` 只装一个开发依赖（`typescript`，给 `check:types` 用）。**运行依赖为零**，别加。
- 零构建步骤：`lib/client.js` 是手写的客户端半部，不走打包器。

```sh
npm install
npm test              # node --test：全部用例（文档一致性、随包卫生、契约检查都在里面）
npm run check         # 逐文件语法检查 + ESM import 冒烟
npm run check:types   # tsc --noEmit（strict）
npm run pack:check    # npm pack --dry-run：看发布包里到底有什么
npm run preflight     # 上面四项 + 能力披露，一条命令给结论（提交前跑这个最省事）
```

## 改动的硬规矩（每条都对应一个测试）

1. **文档是被校验的，不是装饰**
   `README.md` 的路由表必须与 `lib/index.js` 里 `sub === '…'` 的分支**一一对应**；
   `lib/index.js` 头部的路由清单也要与之一致（`test/docs.test.mjs`）；
   文档里提到的 `npm run <x>` 必须真实存在；用例数写在两份 README 里且必须与实际一致。
   → **加了路由/用例，就顺手改文档**，否则 `npm test` 直接失败。

2. **界面里不出现内部术语**
   页面上不许出现 `段 1 / 段 2 / 整链 / dry-run / 落盘 / dsh headless / ①②③④⑤`，要说人话
   （抓取 / 整理 / 更新知识库 / 试运行 / 写入）。两条测试从渲染结果和真路由返回的 HTML 各钉一遍。
   → 改文案前先想"用户看到这句会知道该点什么吗"。

3. **英文页整页不得残留中日韩文字**
   内联 `<script>` / `<style>` 里的**注释也必须是 ASCII**（英文页会逐字扫描）。
   客户端字典 `zh` / `en` 两侧**键集合必须完全一致**。

4. **插件 ⇄ 管线脚本的接口没有类型系统兜着**
   插件按 argv 调 `tools/pipeline/*.mjs`、按退出码判成败。**传给脚本的每个 `--flag` 必须在脚本源码里出现**
   （写错了会被"未知参数被忽略"掩盖成"能跑"）。调用表与踩过的坑见
   [`docs/PIPELINE-CONTRACT.md`](docs/PIPELINE-CONTRACT.md)。

5. **判成败看退出码，不看输出措辞**（`lib/pipeline.js` 的 `classifyStage`）。

6. **`data/` 一个字都不许进提交**（个人对话语料、健康事实、财务候选、凭据）。
   哪些能公开、哪些绝不能，见 [`docs/PUBLISHING.md`](docs/PUBLISHING.md)。

7. **`package.json` 的 `files` 取反项别删**：有 `files` 字段时 `.gitignore`/`.npmignore` 不生效，
   排除只能靠 `!tools/pipeline/…` 这种取反项（作者的运行时会话文件曾因此进过包）。

## 提交

- 提交信息：`type(scope): 中文正文`，正文写**为什么**和**实测读数**（`feat` / `fix` / `docs` /
  `test` / `chore` / `perf` / `refactor`）。
- 一次提交一件事；测试与它修的 bug 放同一次提交里。
- 改**规则/约定**类内容（`AGENTS.md`、`docs/`）时，注明来源（实测 / 代码现状 / 未验证）。

## 开发时最容易踩的两个坑（本机实测）

- **改了源码不等于应用里生效**：`file:` 安装是**复制快照**，要
  `dsh plugin --profile <profile> remove dsh-kb-sync` → `add` → **重启应用**；
  信任指纹会随代码变化失效，需要在 **设置 → 插件体检** 里重新确认。
- **配置只在插件加载时解析一次**：改配置后 `/status` 仍报旧值，**必须重启**。

## 报问题 / 提功能

用仓库的 issue 模板（Bug report / Feature request）。**贴日志前先抹掉 token 与个人对话内容** ——
安全相关请走 [`SECURITY.md`](SECURITY.md)，不要开公开 issue。

---

## English summary

Node ≥ 20, one dev dependency (typescript), no build step, zero runtime dependencies. Run
`npm run preflight` before opening a PR. The rules that tests enforce: the README route table and the
`lib/index.js` header list must match the code; user-facing copy must avoid internal jargon; the English
page must contain no CJK (including comments in inline `<style>`/`<script>`) and the `zh`/`en`
dictionaries must have identical key sets; every `--flag` the plugin passes to a pipeline script must
exist in that script; success is judged by exit code, not by output wording; nothing under `data/` may
be committed. Commits use `type(scope): summary` with the reason and measured numbers in the body.
