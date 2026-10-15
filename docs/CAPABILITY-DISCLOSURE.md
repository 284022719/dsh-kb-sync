# 能力披露：dsh-kb-sync

> 方法：[`dsh-trust-check`](https://www.npmjs.com/package/dsh-trust-check)——代码判定、零 token、每条结论附 `文件:行号`。
> 原则照该工具：**只证"有"，不证"无"**；未检出不等于安全。
> 本文件把**实现前的设计目标**与**实现后的实测**并排放，方便你自己核对偏差。

## 一、这个插件有明确的三块，能力面完全不同

|  | 编排半（起你已有的命令） | 拉取半（自己读网页端对话） | 段 2 判断（阶段 2：进程内调模型） |
|---|---|---|---|
| 代码 | `lib/index.js` 的 `/run`、`/doctor`、`/log` | `lib/deepseek.js` + `lib/index.js` 的 `/token`、`/pull`、`/search` | `lib/index.js` 的 `/process` + `lib/process.js` + `tools/pipeline/extract-prompt.md` |
| 读凭据值 | 否 | **是**（`credentials.resolve`） | 否（模型调用走宿主 `llm` 服务，凭据在它手里） |
| 出网 | 否 | **是**（只连 `chat.deepseek.com`） | **是**（经宿主 `llm` 适配器出网；地址由宿主配置决定，插件不写死域名） |
| 写文件 | 否 | **是**（只在知识库目录内） | **是**（`sync/out/*`、`health-facts/manual-*.json`、`finance/data/candidates.jsonl`、`specialties-map.json`，全在管线的 `data/import` 里） |
| 起子进程 | 是（你配的那条命令） | 否 | 是（管线的 `prep-inbox.mjs` / `apply-extraction.mjs` / 重建脚本，经宿主 `subprocess` 缝） |
| 结论 | 无红线 | **命中红线** | 与拉取半同属"模型 + 网络"，不新增凭据读取 |

> **段 2 的设计边界（刻意保留）**：模型只产出 JSON，**从不直接改档案**。落盘前一定先由
> `tools/pipeline/apply-extraction.mjs` 校验（归类 idx 集合必须与输入完全一致、话题必须合法、
> 专题 parent 必须匹配），校验不通过就整批不落盘。财务数据只进候选区，永不自动入账。
> 页面上默认那个按钮就是 **dry-run**：跑模型 + 跑校验，但不写任何文件。

> **客户端半部（`lib/client.js`，2026-10-12 加）**：只做一件事 —— 在宿主 Web 端注册一个
> `settings.section`（**设置 → dsh-kb-sync**），显示状态摘要并给三个动作（**抓取新对话 / 更新知识库 / 刷新**）。
> 它通过**同源 `fetch`** 打插件自己的路由（写操作带 `x-dsh-kb-sync: 1`，与页面同一套守卫），
> **不新增出网域名、不读凭据、不写任何文件**——所以 §四 的五条红线判定不变，`dsh-trust-check`
> 也不会因为它变红。它没有构建步骤（手写，符合客户端模块表的 `window.__ModuleLoader__.load` 形态）；
> 单测锁住契约：加载 id、`inject: ['slots','locale']`、中英字典键一一对应、`settings.section` 注册参数、
> 写操作带守卫头。

## 二、实测扫描输出

```sh
npx dsh-trust-check --dir <path-to-this-repo> --exit-code
```

```
1 plugin(s) · 1 red · 0 accepted · 0 review · 0 expected · 0 clear

dsh-kb-sync 0.1.0 — red                    (退出码 2)
  Stop by default; confirm the risk in Settings if you still want to keep it.
  why be careful:
    · Detected in code: reads credential values and has network access
    · May touch secrets or sensitive env vars
    · Execute system commands
  capabilities: shell, fs-write, fs-read, network (outbound), credentials, env
  destinations (literal):
    … + 2 allowlisted/loopback destination(s)
  secret touches:
    read: creds.resolve(
  injections: 1 item(s)
    client-inject: @deepseek-ai/dsh-client-locale, @deepseek-ai/dsh-client-ui-settings
  source: unpinned | git+https://github.com/<owner>/dsh-kb-sync.git
  evidence: 40 hit(s)
```

**与设计一致：拉取半必然构成红线。** 这条红线（"读到凭据的值 **且** 有网络）无法靠改写代码消除 —— 除非不做拉取。

> `injections: client-inject:` 那两行是**客户端分节声明的宿主包**（`dsh.client.inject`），不是权限：
> 它只说明"这个设置分节要在宿主 Web 端的设置页与 locale 服务存在时才挂载"，不新增任何能力项。

## 三、这条红线具体意味着什么（以及被什么约束住）

| 问题 | 事实 |
|---|---|
| 读的是什么 | `credentials.resolve('DEEPSEEK_WEB_TOKEN')` —— 你在插件页面粘贴一次的**网页端 userToken**（不是账号密码，也不是 API key） |
| 它去哪 | 只进 DSH 凭据服务（`$DSH_HOME/.credentials.yaml`）；每次拉取时取出，装进 `Authorization: Bearer` 头 |
| 它不会去哪 | 不写进任何文件、日志、响应或知识库；错误文本经 `redactText()` 抹掉 token；单测断言响应里不含 token 值 |
| 出网目标 | 只有 `https://chat.deepseek.com` 的两个接口（`lib/deepseek.js` 的 `BASE` 常量）；没有其它字面量域名 |
| 写文件范围 | 只在配置的知识库目录内写 `conversations/*.md`、`conversations.jsonl`、`catalog.json`；相对路径解析后校验前缀，越界抛错（单测覆盖） |
| 为什么不用 `.token` 文件 | 那个文件是明文。`/status` 仍会 `stat` 一个 `.token` 文件报"年龄天数"，那是**编排半**的功能，从不读它正文 |

按该工具的规则，**红线默认应挡住**：要在 设置 → 插件体检 里点"确认风险"才能继续用；代码一变指纹失效，需要重新确认。

## 四、五条硬红线逐条核对

| 红线 | 是否命中 | 依据 |
|---|---|---|
| 1. 声明 install / postinstall / preinstall | 否 | `package.json` 的 `scripts` 只有开发用命令（`test` / `check` / `check:types` / `pack:check` / `preflight`），**没有任何安装期钩子**；`test/shipped.test.mjs` 有一条断言钉住这一点 |
| 2. `cordis.patch.yml` override / disable `@deepseek-ai/*` 核心 bundle | 否 | 补丁只有一条 `insert` |
| 3. 读凭据/密钥**值** 且 有网络 | **是（命中）** | `lib/index.js` 的 `credentials.resolve` + `lib/deepseek.js` 的 `fetch`；约束见第三节 |
| 4. 明文 `http://` 外连 且 有网络 | 否 | 唯一 `http://` 字面量是 `new URL(req.url, 'http://localhost')` 的解析基址 |
| 5. 字面量 IP 外连 且 有网络 | 否 | 无字面量 IP |

## 五、已知局限（别把报告读成保证）

- 静态扫描**看不到运行时行为**："把 token 发去别处"这类改动只能靠读代码发现，扫描不会自动变红。
- `source: unpinned` 只说明来源未锁：是否锁 commit 取决于你的安装方式（`github:owner/repo` 不锁）。
- 非官方内部接口，DeepSeek 改版即失效；失效时表现为 `/pull` 报 `fetch_page 失败（HTTP … code=…）`。
- 拉取有两条路：**增量**（列表接口 `chat_session/fetch_page`：`count` 上限 100、超过报 `ILLEGAL_COUNT`，`page`/`offset`/`page_num`/`seq_id`/`cursor` 一律被忽略、`POST` 405 —— 即**只能拿最近 100 条、翻不了页**；2026-10-12 实测）与**全量回填**（官方导出包：`export_all` → 轮询 → 下载 zip → 解析）。回填的 zip 读取器与消息树解析器已对着真实导出包实测（2446 条会话、CRC 全部通过；最后一条是助手回复的占 2442/2446，反证"按时间戳找叶子"那个坑没踩）。**2026-10-12 晚的真机全量回填**：25.6 MB / 2549 条会话、合并 0 新增 0 更新 2549 skipped（幂等），无 error/fatal。
- `/pull` 与 `/backfill` 的成功路径已在**单元测试**里跑通（含两次调用的幂等、续聊就地更新、检索、越界拒绝、zip 损坏检测）。
- **真实 API 端到端（只读远端、写入临时目录）**：用真实 `userToken` 对 chat.deepseek.com 跑过一轮完整 `/pull` —— 列表 100 条、无需更新的 100 条全部正确跳过（1.2 s）；再从临时库里删掉一条使其"看起来是新的"，第二次运行正确拉到该会话的权威历史并写成 Markdown（16 条消息 / 26,855 字符，`## 👤 用户` 与 `### 🤖 DeepSeek` 小节齐全），文件名形如 `20261011-标题-<id8>.md`，与参考实现一致。这一轮**没有写你的生产知识库**（预置的是拷贝、输出到 `tmp`）。
- **2026-10-12 晚：原先列为"尚未跑过"的两条都跑过了**（真机、真凭据、真导出包）——① 控制页发起的**一键整链**（`/status`：21:21:04→21:21:09，5 段全 `ok`）与**段 2**（21:21:39，自动路由 `deepseek-official` / `deepseek-flash`，收件箱就绪）；② **真实全量回填**（21:23:04→21:25:23：25.6 MB、2549 条会话、0 新增 0 更新 2549 skipped、无 error/fatal）。
  > 读法提醒：那一轮上游**无新内容**（`fetch` 与段 2 都判"无事可做"），所以证明的是**按钮 → 路由 → 整链/回填整条管道通、且幂等**，不是一次产出新内容的运行。另：这次页面跑的是**重启后加载的新模块**（"旧实例跑缓存模块"那个坑见第六节第 4 条）。

## 六、顺带记下的四条插件开发实测结论

不涉及本插件功能，但同类插件作者踩起来比功能本身费时间：

1. **`file:` 安装是复制快照，不是软链**（2026-10-12 复核仍成立：装好的 `node_modules\dsh-kb-sync\` 里
   没有源码里新增的 `tools\pipeline\`、`lib\index.js` 哈希也不同）。改完源码要刷新：
   直接再 `install_bundle` 会被判 `ambiguous-install`，正确姿势是**先 `remove_bundle` 再 `install_bundle`**；
   而且移除操作曾让 profile 的加载列表被应用重写（当时掉了 9 个插件），工作区脚本 `fix-dsh-plugins.ps1` 可一键补回。
2. **保存 profile patch 会热重组配置，但不会换模块**：热重组让 `apply()` 重跑，跑的还是缓存的旧模块；
   要让新代码生效得重启应用。所以本插件提供"设置文件 / 插件文件夹里的 `config.json`"这两条不依赖 patch 的配置通路。
3. **应用会重写 profile 的 `cordis.patch.yml`**（2026-10-12 实测：手写进去的 `- id: dsh-kb-sync` 配置块在
   一次应用重启后不见了，文件从约 12 KB 缩回 670 B）。这不影响功能 —— 那几行本来就只是
   `resolver` 的备选输入之一，真正生效的是 `<插件>/config.json`（`/status` 的 `configFile.localUsed`
   会告诉你是哪一份生效）。**别把配置只写在 patch 里。**
4. **"路由有响应"不等于"跑的是新代码"**（2026-10-12 实测，代价是一轮返工）：改完源码、重装 bundle 之后，
   应用里跑的还是**重启前缓存的那个模块** —— 新路由会照常应答，只是执行旧逻辑（本次表现：源码里早已修掉的
   `readIfPresent is not defined` 反复出现在 400 响应里）。判据不是 curl 通不通，而是**拿装好的副本与源码对哈希**
   （`node_modules\dsh-kb-sync\lib\index.js` vs 仓库里的同名文件），再重启。把改动直接拷进 `node_modules`
   快照也没用 —— HMR 不会为此换模块。

