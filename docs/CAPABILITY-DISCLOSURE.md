# 能力披露：dsh-kb-sync

> 方法：[`dsh-trust-check`](https://www.npmjs.com/package/dsh-trust-check)——代码判定、零 token、每条结论附 `文件:行号`。
> 原则照该工具：**只证"有"，不证"无"**；未检出不等于安全。
> 本文件把**实现前的设计目标**与**实现后的实测**并排放，方便你自己核对偏差。

## 一、这个插件有明确的两半，能力面完全不同

|  | 编排半（起你已有的命令） | 拉取半（自己读网页端对话） |
|---|---|---|
| 代码 | `lib/index.js` 的 `/run`、`/doctor`、`/log` | `lib/deepseek.js` + `lib/index.js` 的 `/token`、`/pull`、`/search` |
| 读凭据值 | 否 | **是**（`credentials.resolve`） |
| 出网 | 否 | **是**（只连 `chat.deepseek.com`） |
| 写文件 | 否 | **是**（只在知识库目录内） |
| 结论 | 无红线 | **命中红线** |

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
  source: unpinned | git+https://github.com/<owner>/dsh-kb-sync.git
  evidence: 40 hit(s)
```

**与设计一致：拉取半必然构成红线。** 这条红线（"读到凭据的值 **且** 有网络）无法靠改写代码消除 —— 除非不做拉取。

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
| 1. 声明 install / postinstall / preinstall | 否 | `package.json` 的 `scripts` 只有 `test` |
| 2. `cordis.patch.yml` override / disable `@deepseek-ai/*` 核心 bundle | 否 | 补丁只有一条 `insert` |
| 3. 读凭据/密钥**值** 且 有网络 | **是（命中）** | `lib/index.js` 的 `credentials.resolve` + `lib/deepseek.js` 的 `fetch`；约束见第三节 |
| 4. 明文 `http://` 外连 且 有网络 | 否 | 唯一 `http://` 字面量是 `new URL(req.url, 'http://localhost')` 的解析基址 |
| 5. 字面量 IP 外连 且 有网络 | 否 | 无字面量 IP |

## 五、已知局限（别把报告读成保证）

- 静态扫描**看不到运行时行为**："把 token 发去别处"这类改动只能靠读代码发现，扫描不会自动变红。
- `source: unpinned` 只说明来源未锁：是否锁 commit 取决于你的安装方式（`github:owner/repo` 不锁）。
- 非官方内部接口，DeepSeek 改版即失效；失效时表现为 `/pull` 报 `fetch_page 失败（HTTP … code=…）`。
- 拉取有两条路：**增量**（列表接口游标在服务端失效，最多只回最新 100 条）与**全量回填**（官方导出包：`export_all` → 轮询 → 下载 zip → 解析）。回填的 zip 读取器与消息树解析器已对着真实导出包实测（2446 条会话、CRC 全部通过；最后一条是助手回复的占 2442/2446，反证"按时间戳找叶子"那个坑没踩）。
- `/pull` 与 `/backfill` 的成功路径已在**单元测试**里跑通（含两次调用的幂等、续聊就地更新、检索、越界拒绝、zip 损坏检测）；真机端到端仍需你先粘贴 token。

## 六、顺带记下的两条插件开发实测结论

不涉及本插件功能，但同类插件作者踩起来比功能本身费时间：

1. **`file:` 安装是复制快照，不是软链**。改完源码要刷新：直接再 `install_bundle` 会被判 `ambiguous-install`，正确姿势是**先 `remove_bundle` 再 `install_bundle`**；而且移除操作曾让 profile 的加载列表被应用重写（当时掉了 9 个插件），工作区脚本 `fix-dsh-plugins.ps1` 可一键补回。
2. **保存 profile patch 会热重组配置，但不会换模块**：热重组让 `apply()` 重跑，跑的还是缓存的旧模块；要让新代码生效得重启应用。所以本插件提供"设置文件"这条不依赖 patch 的配置通路。
