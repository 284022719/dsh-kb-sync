# 安装链路：从 `dsh plugin add` 到两侧代码被加载

> **为什么写**：宿主半部（`lib/index.js`）与客户端半部（`lib/client.js`）都不由消费者 `import`，
> 而是宿主按**包元数据**自己找、自己装。这条链上任一环写错，后果大多是**静默的**——
> 插件不加载、或加载了但设置里没有那一节，界面不报错。
>
> 核对对象：本机 DSH **0.2.0-rc.2** 实现（`app.asar`：`@deepseek-ai/dsh-plugin-manager`、
> `@deepseek-ai/dsh-client-modules`、`@deepseek-ai/dsh-cordis-client-runner`）与官方插件模板
> （`@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/`），2026-10-12 读。
> 客户端半部的细节另见 [`CLIENT-HALF.md`](CLIENT-HALF.md)。

## 一、整条链

| # | 宿主做什么 | 依据（0.2.0-rc.2） | 我们提供什么 | 写错的后果 |
|---|---|---|---|---|
| 1 | `dsh plugin add <spec>` 把包装进 profile 的 `node_modules`，并在 profile 的 `package.json` 里记为依赖 | `dsh-plugin-manager`（`RESTORED_FILES = ["package.json","pnpm-lock.yaml"]`） | 安装 spec 用 `file:<插件目录>`（本地）或 `github:284022719/dsh-kb-sync` | — |
| 2 | 读包的 `dsh.bundle` 声明，找 patch 文件 | `metadata?.dsh?.bundle !== undefined` → `bundlePatchPaths(dir, manifest.dsh.bundle)`；**patch 读不了会抛** | `dsh.bundle.patch: "./cordis.patch.yml"`，文件随包发布（`files` 未排除它） | 找不到 patch = 插件行不会被插入 = **插件完全不加载** |
| 3 | 只把 **`insert`** 行插进 profile 的 cordis 配置；**没有 `insert` 但带 `id` 的行**按 *override* 处理（`dsh plugin enable/disable` 就写这种） | `patches.filter(item => item.insert !== void 0)`；`overrides: [… item.insert === void 0 && typeof item.id === "string" && !declared.has(item.id) …]` | `- insert:` → 一行 `{ id: dsh-kb-sync, name: dsh-kb-sync }` | 把该插的行写成 override，插件行不会出现；enable/disable 也会对不上 |
| 4 | 插入行的 `name` 是 **loader 要 import 的模块说明符**，宿主用它解析到包目录与 `package.json` | `locatePkgJson(loaderName, baseUrl)` → `expectedPackageName = exactPackageSpecifier(loaderName)` | `name: 'dsh-kb-sync'` = 包名 | 名字与包名不一致 → 解析不到包 → 客户端半部扫不到（设置里没有这一节） |
| 5 | 由 loaderName 解析出的 `packageName` 去读该包的 `dsh.client`，扫进 boot manifest（**行 id = 包名**） | `resolveMeta()` / `graphRow(id)` 注释：*entry id (package name)* | `dsh.client.platform: "web"` + `exports["./client"]` | 见 [`CLIENT-HALF.md`](CLIENT-HALF.md) 的"违反后果"列 |
| 6 | 宿主半部由 loader 按同一行 import 并 apply | cordis 插件协议：`name` / `inject` / `apply(ctx, config)` | `lib/index.js` 的 `name='dsh-kb-sync'`、`inject=['webServer']`、`apply()` | 加载报错会体现在插件管理页的状态里 |

**一句话记住闭环**：**patch 行的 `name` = 包名 = 客户端注册 id**。这三个值必须一致，链条才通。

## 二、我们的三处对齐（都可在仓库里核）

1. **patch 行与官方模板同形**：模板是
   ```yaml
   - insert:
       - id: my-decoration
         name: '@local/my-decoration'
   ```
   我们是
   ```yaml
   - insert:
       - id: dsh-kb-sync
         name: 'dsh-kb-sync'
   ```
2. **`name` 与包名一致**：`package.json.name === 'dsh-kb-sync'`，与客户端注册的
   `__ModuleLoader__.load({ id: 'dsh-kb-sync' })` 相同。
3. **入口文件真实存在**：`main`/`exports["."]` 指向 `lib/index.js`，`exports["./client"]` 指向
   `lib/client.js`，两者都随包发布。

## 三、自动化防线

`test/docs.test.mjs` 里有一条"安装行与包元数据一致"的用例，钉住可机械检查的部分：
`dsh.bundle.patch` 指向的文件存在、patch 的顶层是 `- insert:` 且恰好一行、该行的 `id`/`name`
都等于包名、`main` 与 `exports["./client"]` 指向的文件存在、`dsh.engines.dsh` 有值。
**改包名、改行、改路径而忘了同步**，CI 会当场失败。

## 四、还没验证到的部分

以上是**读宿主实现 + 单测**的结论。**"装上去后真的能在应用里看到"仍需一次真机验证**：
`dsh plugin --profile desktop remove dsh-kb-sync` → `add file:D:/dsh/dsh-kb-sync` → 重启，
然后看两处：**设置 → dsh-kb-sync** 是否出现；控制页「展开全文」的时间是否为本地时间。
