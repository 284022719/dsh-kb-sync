# DeepSeek 对话迁移工具链

把 DeepSeek 网页端（chat.deepseek.com）的全部历史对话搬到本地，按话题组织成知识库，并为每个话题在 DSH 里生成一个可继续对话的会话。

产物在上一级目录：`D:\dsh\dsh-kb-sync\data\kb\`。

## 一句话流程

```
官方导出 zip → conversations.json → 重建每条会话的主线程 → Markdown + catalog
    → 分批话题聚类 → 合并成一级话题 → 全量复核改判 → 组装知识库
    → 每个话题生成一个 DSH 会话 → RPC 挂载到 GUI 工作区
```

## 为什么走"官方导出"而不是爬接口

`chat.deepseek.com` 的会话列表接口 `GET /api/v0/chat_session/fetch_page` 的游标（`lte_cursor.pinned` / `lte_cursor.updated_at`）在服务端**不生效**：无论传什么游标都返回最新的同样 100 条，`count` 上限也低于 1000。因此无法靠翻页拿到全量。

但同一个前端 bundle 里存在官方导出接口：

- `GET /api/v0/export_all` — 触发"导出所有历史数据"
- `GET /api/v0/download_export_history` — 查询状态并拿到下载直链（`history_download_url`，有效期约 7 天）

导出包内含 `user.json` 与 `conversations.json`（本例 2446 个会话、约 40 MB）。这条路径是官方机制，比逆向翻页完整、稳定得多。

## 脚本清单（按执行顺序）

| 脚本 | 作用 |
|---|---|
| `probe.mjs` | 接口/分页/导出端点/SPA bundle 的侦察脚本（`probe2`–`probe8` 已归档，见下） |
| `download-export.mjs` | 查询导出状态并流式下载 zip |
| `parse-export.mjs` | **核心解析**：重建主线程 → 每会话一个 Markdown + `catalog.json/tsv` + `conversations.jsonl` |
| `fix-catalog.mjs` | 把 catalog 重排成与 `conversations.jsonl` 一致的 idx 顺序（消除下标错位） |
| `analyze-corpus.mjs` | 语料统计与关键词，供话题聚类参考 |
| `split-batches.mjs` | 按时间切成 10 批，供并行聚类 |
| `prep-reconcile.mjs` | 合并跨批同名话题，生成 `topics/inventory.md` 清点表 |
| `expand-taxonomy.mjs` | 把体系（taxonomy.json）展开成最终成员表 `topics/final-topics.json`，并应用修正 |
| `screen-misfits.mjs` / `screen-keyword.mjs` | 两种确定性的归属错配筛查（余弦 / 包含度） |
| `prep-verify.mjs` | 生成复核清单 `verify/in-NN.tsv`（标题+首问+首答，供逐条复判） |
| `apply-verify.mjs` | 合并复核结果成 `topics/corrections.json`（按**话题名**解析 key，不依赖序号） |
| `build-kb.mjs` | 组装知识库：话题页、总索引、`topics.json`，并搬入会话原文 |
| `analyze-subclusters.mjs` | 统计每个一级话题内部成规模的细粒度簇（专题候选） |
| `build-specialties.mjs` | 按 `topics/specialties.json` 生成 18 个专题页与成员表（交集法，不重新判定归属） |
| `make-dsh-sessions.mjs` | ~~为每个话题/专题生成一个 DSH 会话日志~~ **已退役**（2026-10-10），见下 |
| `attach-dsh-sessions.mjs` | ~~通过宿主 RPC 把会话热挂载到 GUI 工作区~~ **已退役**（2026-10-10）|
| `rename-workspaces.mjs` | ~~命名「知识库·话题」「知识库·专题」两个工作区~~ **已退役**（2026-10-10）|
| `decode-session.mjs` | 解码任意 DSH 会话日志为可读 JSONL（调试/验证用） |
| `verify-sessions.mjs` / `read-back-session.mjs` | 从宿主侧核对会话是否出现、标题是否正确、渲染内容是否符合预期 |

> 📦 **一次性 / 排错脚本在 `tools\oneoff\`（2026-10-10 归档）。**
> 判据：在 `dsh-kb-sync\tools\pipeline\` 全树、`D:\dsh` 下其它项目目录、以及 Windows 计划任务里
> **都没有任何引用**。共 32 个（`probe2`–`probe8`、`check-*`、`inspect-*`、`read-*`、
> `verify-prune|update|thread-fidelity`、`test-*`、`debug-archive`、`final-check`、
> `acceptance-check`、`add-update4-conclusions`）。
> 归档后根目录只剩 43 个**在用**的工具链脚本。
> ⚠️ 这些脚本按「从根目录运行」写路径，直接在新位置跑会找不到文件 ——
> 需要用的时候按 `tools\oneoff\README.md` 里的一行命令临时移回来。

## 两个必须知道的坑（都踩过并修复）

1. **不能用时间戳确定会话主线程的末尾。** 官方导出里模型回答的 `inserted_at` 常常与它回答的那条提问**完全相同**，用"时间戳最大的节点"当叶子会静默丢掉最后一条回答——本例 744 个会话因此只剩提问、另有 823 个会话尾部被截断。正确做法是按树结构取叶子（`children` 为空的节点），时间戳只能用于多个真叶子之间的取舍。
2. **`catalog.json` 的排序必须与聚类用的 idx 一致。** 早期版本把 catalog 按日期排序、而 `conversations.jsonl` 是导出顺序，两者下标错位达 ±9，导致"按 idx 找原文"会取错文件。现在 catalog 带显式 `idx` 列并与之对齐。

## 复核发现的经验事实

- DeepSeek 官方导出里**少量会话的标题与内容不符**（例：标题「什么是多巴胺女孩」，正文 62 处 3D 打印），复核时必须看正文，不能只看标题。
- 分批聚类的错配不是随机的：少数"大口袋"话题会系统性吸附邻近内容。本例第 06、07 两批错配率 33.5% / 42%，其余批次 5%~18%；全量复核共改判 401 条。
- 因此**逐批复核 + 统一改判**比一次聚类更可靠；`verify` 那一步值得保留。

## 增量更新（网页端有新对话时）

不用重新导出全量。`history_messages` 接口的 `current_message_id` 给出**权威的当前线程**，比导出的消息树更准（导出得靠规则猜叶子）。

```powershell
node recon-update.mjs 1               # 只读：看新增/续聊了多少（自动翻页越过本地最新时间，保证不漏）
node update-from-api.mjs --dry-run    # 只看会改什么
node update-from-api.mjs              # 落盘：新会话写 Markdown，续聊的覆盖原文件；写前自动备份
node prep-update-topics.mjs           # 生成归类输入（update-new-items.tsv + update-topic-keys.tsv）
#  → 交给一个 agent 归类，产出 update-topics.json（只能落在既有话题里）
node apply-update-topics.mjs          # 并入 topics/final-topics.json
node build-kb.mjs --src knowledge --out ..\dsh-kb-sync\data\kb
node build-specialties.mjs ..\dsh-kb-sync\data\kb   # 先重算专题成员（权威）
node map-specialties.mjs                       # 再按显式映射表把新会话补进专题
```

健康档案侧（新对话涉及健康时）：

```powershell
node prep-health-update.mjs   # 挑出新增/续聊的健康相关会话 → health-digest/digest-20.md
#  → 交给一个 agent 按 health-batches/EXTRACT.md 提取 → health-facts/digest-20.json
node build-health-profile.mjs ..\health   # 合并全部批次、重建档案（含归属分离）
node sync-knowledge.mjs                   # 刷新 KNOWLEDGE.md 与一页总览
```

### 增量更新新踩的三个坑

1. **成员只能有一个权威存储。** `topics/specialties.json` 是**策划源**（只有 key/name/parent/desc/sources），成员由 `build-specialties.mjs` 算出来写进 `knowledge-base/specialties.json`。一个脚本误把策划源当成员存储写回，一次就把 639 条成员清成 7 条——**改前先确认写的是哪个文件**。
2. **关键词匹配补专题必然失败**：专题主题是语义性的（「嗓子肿痛」不含「症状」）。松了会误塞（「高中毕业直接就业人数」命中"工作"进了「社会工作与社区治理」），紧了全漏。改用**显式映射表 + 父话题校验**（当前 37 条映射，拦下 1 条话题不匹配的）。
3. **这个账号有多人使用**：体检报告是 32 岁男性，但另有会话是女性生理问题（经期/阴道/怀孕），还明确说过「女朋友 21 岁」。`build-health-profile.mjs` 里的归属分离（`OTHER_RE` + `OTHER_CONVERSATIONS`）把这类事实剔到 `OTHERS.md`，**绝不能混进本人画像**。

## 复现

```powershell
cd D:\dsh\deepseek-import
# 0. 准备凭证：把网页端 userToken 写进 .token
node download-export.mjs                       # 1. 下载官方导出
node parse-export.mjs                          # 2. 解析成 Markdown（约 1 分钟）
node fix-catalog.mjs                           # 3. 对齐 idx 顺序
node analyze-corpus.mjs; node split-batches.mjs 10   # 4. 语料统计 + 分批
# 5. 逐批聚类（先前由 10 个并行子 agent 完成，结果在 topics/batch-*.json）
node prep-reconcile.mjs                        # 6. 跨批合并清点
# 7. 设计一级话题体系 → topics/taxonomy.json
node expand-taxonomy.mjs                       # 8. 展开成员表
node prep-verify.mjs                           # 9. 生成复核清单
# 10. 全量复核 → verify/out-*.json
node apply-verify.mjs; node expand-taxonomy.mjs  # 11. 合并改判并重算成员
node build-kb.mjs --src knowledge --out ..\dsh-kb-sync\data\kb   # 12. 组装知识库
# 完。知识库通过技能 knowledge-base + knowledge-base\tools\kb.mjs 被检索消费。
# （原 13/14 步「每个话题生成一个 DSH 会话并挂载到 GUI」已于 2026-10-10 退役，
#   用户要的是本地知识库检索层、不是侧栏里多出 42 个会话。退役件见
#   D:\dsh\_archive\kb-retired\，不要恢复。）
```

> `.token` 是你自己的账号凭证，只存在本机，请勿外传；如已失效，重新导出即可。
