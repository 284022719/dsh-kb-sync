# 能力披露：dsh-kb-sync

> 方法：[`dsh-trust-check`](https://www.npmjs.com/package/dsh-trust-check)——代码判定、零 token、每条结论附 `文件:行号`。
> 原则照该工具：**只证"有"，不证"无"**；未检出不等于安全。
> 本文件把**实现前定的设计目标**与**实现后的实测报告**并排放，方便你自己核对偏差。

## 一、设计目标 vs 实测

| 能力 | 设计 | 实测 |
|---|---|---|
| shell / subprocess | **要**（起你配的命令） | ✅ 命中（`lib/index.js:368`、`:408`） |
| fs-read | **要**（状态文件、日志、设置文件） | ✅ 命中（`lib/index.js:30` 等） |
| fs-write | **不要** | ✅ 未命中 |
| credentials（DSH 凭据服务） | **不要**（连服务都不碰） | ✅ 未命中 |
| network（host 侧） | **不要** | ✅ 未命中（唯一 `network` 命中在控制页的同源 `fetch`，见下） |
| 动态代码（`eval` / `new Function`） | **不要** | ✅ 未命中 |
| 提示词注入 | **不要** | ✅ `injections: 0` |
| 安装脚本（install/postinstall/preinstall） | **不要** | ✅ 未命中 |

预期红线 **0 条**；预期裁决 **review（需确认）**，触发原因只有 `shell` 属特权能力。实测与之相符。

## 二、实测扫描输出

```sh
npx dsh-trust-check --dir <path-to-this-repo> --exit-code
```

```
1 plugin(s) · 0 red · 0 accepted · 1 review · 0 expected · 0 clear

dsh-kb-sync 0.1.0 — review
  No hard red lines; if capabilities match why you installed it, mark as expected in Settings.
  why be careful:
    · Execute system commands
    · Access the network
    · Read local files
  capabilities: shell, fs-read, network (same-origin), env
  destinations (literal):
    … + 1 allowlisted/loopback destination(s)
  injections: 0
  source: unpinned | git+https://github.com/<owner>/dsh-kb-sync.git
  evidence: 21 hit(s)

EXITCODE=1
```

三处需要读报告的人自己判：

1. **`network (same-origin)`** —— 命中的是**控制页在浏览器里**的三处 `fetch(PREFIX + '/…')`
   （`lib/page.js:126/137/145`）。host 半部（`lib/index.js`）没有任何 `fetch`/`http`/`https`/socket 调用，
   插件自己不出网；字面量去向只有 loopback。
2. **`env`** —— 一个可选的根目录环境变量 `DSH_KB_SYNC_ROOT`（`lib/index.js:74`、`:123`）。
3. **`injections: 0`** —— 值得记一笔：**首扫时这里是 1**，命中来自 `lib/index.js` 头部注释里出现的
   `systemPrompt` 字样（该版本扫描器对注释中的 API 名仍会计数）；把措辞改成 "prompt-section registration"
   后归零。**这是报告措辞问题，不是行为变化**——代码里从来没有注册过提示词段落。写在这里，是为了避免
   "报告变干净了"被误读成"修了漏洞"。

## 三、五条硬红线逐条核对

| 红线 | 是否命中 | 依据 |
|---|---|---|
| 1. 声明 install / postinstall / preinstall | 否 | `package.json` 的 `scripts` 只有 `test` |
| 2. `cordis.patch.yml` override / disable `@deepseek-ai/*` 核心 bundle | 否 | 补丁只有一条 `insert` |
| 3. 读凭据/密钥**值** 且 有网络 | 否 | 不 import `credentials` 相关调用；凭据文件**只 `stat`**（有单测断言其正文永不进响应） |
| 4. 明文 `http://` 外连 且 有网络 | 否 | 唯一 `http://` 字面量是 `new URL(req.url, 'http://localhost')` 的解析基址 |
| 5. 字面量 IP 外连 且 有网络 | 否 | 无字面量 IP |

## 四、已知局限（别把报告读成保证）

- 静态扫描**看不到运行时行为**：若日后有人把 `ctx.get('subprocess')` 换成别的出网实现，报告不会自动变红。
- 扫描器**不展开依赖树**——本插件零依赖，这一条目前不适用。
- `source: unpinned`：`--dir` 模式只读 `package.json` 的 `repository` 字段（本仓库已回填，所以那一行会显示仓库 URL），
  但**版本/commit 锁定与否取决于你的安装方式**（`github:owner/repo` 不锁 commit）。

## 五、顺带记下的两条插件开发实测结论

不涉及本插件功能，但踩起来比功能本身更费时间，写出来给同类插件作者：

1. **`file:` 安装是复制快照，不是软链**（`profiles/<profile>/node_modules/<pkg>` 是实体目录）。
   改完源码要刷新，直接再 `install_bundle` 会被判 `ambiguous-install`；正确姿势是**先 `remove_bundle` 再 `install_bundle`**。
2. **保存 profile patch 会热重组配置，但不会换模块**：热重组会让 `apply()` 重跑，跑的还是**缓存的旧模块**
   （实测：装完旧版后改源码，热重组后 `/status` 仍返回旧字段集）。要让新代码生效得重启应用——
   也正因为如此，本插件才提供"设置文件"这条不依赖 patch 的配置通路。

## 六、真机验证（Windows + DSH 0.2.0-rc.2）

| 验证项 | 结果 |
|---|---|
| `GET /__dsh-kb-sync/` | ✅ 200，HTML 控制页 |
| `GET /__dsh-kb-sync/status` | ✅ 200：根目录 / 同步脚本 / 知识库目录 / 日志目录、凭据文件年龄与阈值、进度文件末 8 行、最新日志尾部 |
| `POST /__dsh-kb-sync/doctor` | ✅ 200，体检命令退出码 0 |
| 同源守卫（真机） | ✅ 无自定义头的 `POST /run` → 403；`Sec-Fetch-Site: cross-site` → 403 |
| 日志越界（真机） | ✅ `GET /log?name=..%2F..%2F<凭据文件>` → 400 |
| `POST /__dsh-kb-sync/run` | ⚠️ **成功路径未在真机点过**：它会真的跑一次同步（可能耗时、并消耗你自己流水线的额度）。同一条 `subprocess.spawn` 通路已由 `/doctor` 在真机验证，`/run` 由单测（mock 子进程）覆盖 |
| POSIX 执行分支 | ⚠️ 已实现但**未在真机验证**（本机只有 Windows） |
