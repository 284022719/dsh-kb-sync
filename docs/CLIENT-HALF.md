# 客户端半部的装配契约（已对宿主实现核对）

> **为什么单独写一份**：客户端半部（`lib/client.js`）不是被人 `import` 的，而是由宿主 Web 端在启动时加载并装配。
> 它最难受的失败模式是**静默的**——声明写错时宿主可能直接跳过这一包（`resolveMeta()` 返回 `null`），
> 界面上表现为"设置里根本没有这一节"，不报错、也看不出为什么。
>
> 所以这份文档把**每一条要求、宿主代码里的依据、违反的后果、以及我们怎么满足**列清楚。
> 核对对象：本机 DSH **0.2.0-rc.2** 的实现（`app.asar` 内，2026-10-12 读）。
> 自动化防线：`test/client.test.mjs` 最后一条用例逐条照宿主规则断言。

## 一、宿主怎么找、怎么装一个客户端半部

宿主包 `@deepseek-ai/dsh-client-modules`：

| 步骤 | 宿主代码 | 要求 | 我们 |
|---|---|---|---|
| ① 读包的 `package.json` | `resolveMeta()` → `parseDshClient(packageName, pkg.dsh.client)` | 必须有 `dsh.client`，且 `platform === 'web'`；**否则静默跳过这一包**（返回 `null`） | `dsh.client = { platform: "web", inject: [locale, ui-settings] }` |
| ② 校验声明字段 | `parseDshClient()`：`inject`/`external` 必须是字符串数组，`immediately` 必须是布尔，否则**直接抛错** | 类型正确 | 只有字符串数组，无 `immediately` |
| ③ 找客户端产物路径 | `clientExportOf(pkgName, pkg.exports)`：接受**字符串**，或带**字符串 `default`** 的对象；否则抛 `exports["./client"] must be a string or an object with a string default` | `exports["./client"]` 可解析 | `"./client": "./lib/client.js"` |
| ④ 读产物文件 | `readFileSync(record.meta.clientPath)` | 文件必须真的存在 | `lib/client.js` 随包发布（`files` 含 `lib`） |
| ⑤ 生成图行 | `graphRow(id, rev, fields)`，注释写明 *"entry id (package name)"*；`entries`/`batches` 都按它索引 | 产物里 `__ModuleLoader__.load({ id })` 的 `id` **必须等于包名** | `id: 'dsh-kb-sync'` = `package.json.name` |
| ⑥ 装配 | `parseBootManifest()`：每个 entry 必须属于某个 initial-load batch，否则抛 `belongs to no initial-load batch` | 宿主自动分组，插件不必管 | — |
| ⑦ 应用 | 官方模板 `dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js` | 产物形态：`window.__ModuleLoader__.load({ id, factory(require){…return {inject,apply}} })`；`react` 走 `require` | 与模板骨架一致（另加 `name`） |

**`immediately` 到底是什么**：前端 bundle 里唯一的使用点是
`prefetchImmediateTier(){ … manifest.plugins.filter(e => e.immediately).map(e => this.modules.prefetch(e.id)) }`
——**它只决定"是否提前下载"**，不决定插件是否 apply（模块本来就在 initial batch 里）。设置分节不在关键路径上，
所以不写它（合法：字段可选），省一点启动开销。

## 二、`dsh.client.inject` 是"加载顺序/预取图"，不是"我 require 了什么"

- 它只该列 **DSH 客户端包**（提供了我要用的服务/槽位，或必须排在我前面）。
- **平台种子模块**（`react` 一族，由 shell 直接提供）**不在图里**：依据是一线包
  `@deepseek-ai/dsh-client-ui-settings` 自己也 `require('react')`，但它的 `inject` 只写
  `["@deepseek-ai/dsh-api-remotes"]`。
- 我们列的 `@deepseek-ai/dsh-client-locale`（界面语言服务）与
  `@deepseek-ai/dsh-client-ui-settings`（设置页/槽位宿主），与同样注册 `settings.section`、
  且实测可用的 `dsh-trust-check` 完全一致。
- **服务是否就绪由 cordis 的 `inject: ['slots','locale']` 保证**（服务不存在时插件等待），
  图里的顺序只是提前量。

## 三、设置分节的注册参数（对宿主自带的账户分节逐字段核对）

宿主 `@deepseek-ai/dsh-client-ui-settings-account` 是这么注册 `settings.section` 的：

```js
ctx.slots.inject("settings.section", () => {
  ctx.slots.register({
    name: "settings.section", id: "account", order: -10,
    label: () => t("nav"),            // 左侧导航里的名字
    locale: "settings.account",       // 字典命名空间
    inject: () => operations,         // 注入给组件的 props
  }, AccountMenu)
})
```

我们的 `lib/client.js` 用同一组字段（`name`/`id`/`order`/`label`/`locale`/`inject`），
`id: 'kb-sync'`、`order: 90`、`label: () => t('nav.label')`、`inject: () => ({ t: ctx.locale.bind(NS) })`。
设置页左侧按 `order` 排序、按 `label` 显示，`active === id` 时渲染我们的组件。

## 四、还没验证到的部分（诚实说明）

以上都是**读宿主实现 + 单测**的结论。**"重启后设置里真的出现这一节"还没在真机上看到**——
运行中的实例用的是安装时的快照，改完代码必须 `remove` + `add` 这个 bundle 再重启。
真机验收只需看一眼：**设置 → dsh-kb-sync** 是否出现，点进去是否显示状态与三个按钮。
