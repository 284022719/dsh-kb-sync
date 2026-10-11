# 能力披露：dsh-kb-sync

> 方法：`dsh-trust-check`（代码判定、零 token、每条附 `文件:行号`）。
> 原则照该工具：**只证"有"，不证"无"**；未检出不等于安全。
> 本文件同时是**实现前的设计披露**与**实现后的实测披露**，两者对照着看才有意义。

## 一、实现前的设计目标（写代码之前定的）

| 能力 | 设计 | 实际 |
|---|---|---|
| shell / subprocess | **要**（调用既有流水线） | ✅ 命中（`lib/index.js:299`、`:339`） |
| fs-read | **要**（状态、日志） | ✅ 命中（多处） |
| fs-write | **不要** | ✅ 未命中 |
| credentials | **不要**（连服务都不碰） | ✅ 未命中 |
| network（host 侧） | **不要** | ✅ 未命中（唯一 network 命中在控制页的同源 `fetch`） |
| 动态代码 | **不要**（无 `eval`/`new Function`） | ✅ 未命中 |
| 提示词注入 | **不要** | ✅ `injections: 0` |
| 安装脚本 | **不要** | ✅ 未命中 |

预期红线：**0 条**。预期裁决：**需确认（review）**，触发原因是 `shell` 属特权能力。

## 二、实现后实测

```sh
node <trust-check>/bin/trust-check.mjs --dir <path-to-this-repo> --exit-code
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
  source: unpinned | no repository
  evidence: 18 hit(s)

EXITCODE=1
```

**与设计目标一致，`redLines` 为空。** 三处需要读报告的人自己判：

1. `network (same-origin)` —— 命中的是**控制页在浏览器里**的 `fetch(PREFIX + '/status')`
   （`lib/page.js:126/137/145`）。这是同源调用；host 半部（`lib/index.js`）里没有任何
   `fetch`/`http`/`https`/socket 调用，插件自己不出网。字面量去向只有 loopback。
2. `env` —— 一个可选的根目录环境变量 `DSH_KB_SYNC_ROOT`（`lib/index.js:73`）。
3. `injections: 0` —— 值得记一笔：**首扫时这里是 1**，命中来自 `lib/index.js` 头部注释里
   出现的 `systemPrompt` 字样（该版本扫描器对注释里的 API 名仍计数）。把措辞改成
   "prompt-section registration" 后归零。**这是报告措辞问题，不是行为变化**——代码里从来
   没有注册过提示词段落。披露在此，避免"报告变干净了"被误读成"修了漏洞"。

### 红线逐条核对（trust-check 的五条硬红线）

| 红线 | 是否命中 | 依据 |
|---|---|---|
| 1. 声明 install/postinstall/preinstall | 否 | `package.json` 只有 `test` |
| 2. `cordis.patch.yml` override/disable `@deepseek-ai/*` | 否 | 补丁只有一条 `insert` |
| 3. 读凭据/密钥**值** + 有网络 | 否 | 不 import `credentials` 相关调用；`.token` **只 `stat`**（`lib/index.js:244`，且 `test/plugin.test.mjs` 有用例断言正文不进响应） |
| 4. 明文 `http://` 外连 + 有网络 | 否 | 唯一 `http://` 字面量是 `new URL(req.url, 'http://localhost')` 的解析基址 |
| 5. 字面量 IP 外连 + 有网络 | 否 | 无字面量 IP |

### 已知局限（别把报告读成保证）

- 静态扫描**看不到运行时**：如果将来有人把 `ctx.get('subprocess')` 换成别的出网实现，报告不会自动变红。
- 扫描器**不展开依赖树**——本插件零依赖，所以这一条目前不适用。
- `source: unpinned | no repository`：`package.json` 尚未回填 `repository`（仓库地址在发布时才有）。
  发布后回填即可从 "unpinned" 变成锁定来源。

## 三、对照：抓网页端历史的两个社区插件（同一次会话实测）

| | `deepseek-web-import` | `dsh-web-chat` | **dsh-kb-sync** |
|---|---|---|---|
| 抓网页端历史 | 是（手工粘 `userToken`） | 是（真浏览器登录） | 否（复用你已有的流水线） |
| 覆盖存量 | 否（接口最多最近 100 条） | 可（recover） | 取决于你的流水线 |
| 产出知识库 | 否（导入为 DSH 会话） | 否（markdown / 会话） | 沿用你已有的聚类与提炼 |
| 红线 | **1 条**（读凭据值 + 出网） | 0 条 | 0 条 |
| 需确认项 | TLS 校验被关闭、子进程 | 浏览器自动化、`dynamic-code`、prompt 注入、浏览器 profile 即凭据 | `shell` 特权能力 |

> `deepseek-web-import` 的 `transport.js` 里有 `if (lib === https) opts.rejectUnauthorized = false;`
> ——携带 Bearer token 的请求不验证证书。这条**不在**信任检查的红线表里，但是真实风险。
> 本插件不碰 token，因此不继承该风险。
