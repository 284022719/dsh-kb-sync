# 安全策略 / Security policy

> English summary at the bottom.

## 这个插件的能力面（读之前先知道它在做什么）

`dsh-kb-sync` 有**三块能力，footprint 完全不同**（逐块对照表在
[`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md) 第一节）：

| 块 | 读凭据值 | 出网 | 起子进程 |
|---|---|---|---|
| **拉取**（`lib/deepseek.js` / `lib/export.js` / `lib/store.js`） | **是** | **是**（只连 `chat.deepseek.com`） | 否 |
| **编排**（`/run`、`/doctor`、`/log`） | 否 | 否 | 是（你配的那条命令） |
| **整理**（`/process`、`lib/process.js`） | 否（凭据在宿主 `llm` 服务手里） | 是（经宿主 `llm` 适配器，域名由你配的提供方决定） | 是（管线的几个脚本） |

静态扫描（`npx dsh-trust-check --dir <本仓库>`）因此恒报 **1 条红线**："读到凭据的值 **且** 有网络"。
**这条红线无法靠改代码消除** —— 除非不做"拉取"这块功能。

## 我们对 token 的承诺（都有测试钉住）

- token 只进 **DSH 凭据服务**，每次请求取出装进 `Authorization: Bearer` 头；
- **不写进任何文件、日志、响应或知识库**；`/token` 只回"配没配"，**永不回值**；
- 错误文本经 `redactText()` 处理，单测断言响应里不含 token 值；
- 编排半只 `stat` 管线的 `.token` 文件（报"年龄天数"），**从不读它正文**；
- 控制页/设置分节的所有写操作都要求自定义头 `x-dsh-kb-sync: 1`，且 `Host` 必须是环回地址、
  `Sec-Fetch-Site` 非同源一律 403（防 DNS rebinding 与跨站表单）。

**这些承诺一旦被违反就是安全缺陷**，请按下面的方式报。

## 报告漏洞

请**不要**开公开 issue 贴敏感细节。按优先级：

1. **GitHub 私密报告**：本仓库 **Security → Advisories → Report a vulnerability**
   （走 GitHub 的私密通道，只有维护者能看到）；
2. 若该通道不可用，开一个**不含细节**的 issue，只写"我有安全问题要报，请给我一个联系方式"。

报告里请包含：

- 受影响的版本（`package.json` 的 `version`）与 DSH 版本、操作系统；
- 复现步骤或最小 PoC；
- 影响判断：是**读到了不该读的东西**（token 外泄 / 越界读写），还是**防护可被绕过**
  （同源守卫、环回校验、日志路径白名单、知识库目录前缀校验）；
- 如果涉及 token，**不要在报告里贴真 token**。

**回应预期**：这是个人维护的 0.x 插件，没有 SLA。隐私/凭据类问题会优先处理；
修好后会在 [CHANGELOG](CHANGELOG.md) 里写清楚，必要时发 advisory。

## 不在范围内（已知且有意的行为）

- **读到凭据值 + 出网**本身：这是"拉取"功能的必然结果，已在能力披露里登记，
  `dsh-trust-check` 会明确报红线，需要你在 **设置 → 插件体检** 里确认风险才能继续用。
- **非官方内部接口**：拉取走的是 `chat.deepseek.com` 的网页端接口，DeepSeek 改版即失效；
  失效不是漏洞，但**如果它开始把 token 发往别的域名**，那是漏洞，请报。
- **"静态扫描没报 = 安全"** 不成立：扫描看不到运行时行为，局限见
  [`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md) 第五节。
- **你自己配的命令**：`syncScript` / `doctorScript` 是你提供的可执行脚本，插件按 argv 起它，
  它做什么由你负责。

## 版本支持

只维护**最新发布版**（0.x 阶段）。旧版本的问题请先升到最新版复现 —— 用
[`CHANGELOG.md`](CHANGELOG.md) 对照改了什么。

---

## English summary

`dsh-kb-sync` has three capability blocks with very different footprints (table in
[`docs/CAPABILITY-DISCLOSURE.md`](docs/CAPABILITY-DISCLOSURE.md) §1); the **pull** half reads the DeepSeek web
`userToken` from the DSH credential service and calls `chat.deepseek.com`, which is why the static scan
always reports one red line. The token is never written to a file, log, response, or knowledge base
(`/token` reports only whether one is stored), errors are redacted, and writes require a custom header
plus a loopback `Host`. To report a vulnerability, use **Security → Advisories → Report a vulnerability**
on this repository — please do not open a public issue containing credentials or personal conversation
content. Only the latest 0.x release is supported.
