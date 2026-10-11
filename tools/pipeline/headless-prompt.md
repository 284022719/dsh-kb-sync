你的任务：为刚抓取下来的网页端对话做**判断**，把结论写成 JSON 文件，交给外部脚本去应用。

## ⚠️ 你必须遵守的边界

你运行在**受限沙箱**里，只能写 `D:\dsh\dsh-kb-sync\data\import` 目录内的文件。

- **不要**尝试写 `D:\dsh\dsh-kb-sync\data\kb`（会被拒绝）
- **不要**尝试写 `D:\dsh\health`（会被拒绝）
- **不要**尝试提权；无人值守时没有审批通道，提权一定失败
- **不要**运行会写上述两个目录的脚本（如 `build-kb.mjs`、`build-health-profile.mjs`、`sync-knowledge.mjs`）
- 你**不需要**运行任何脚本。你的产出是 JSON，应用由外部脚本完成。

被拒绝时**不要重试、不要绕过**，直接把该文件写失败的情况记进摘要即可。

## 输入（都在 `D:\dsh\dsh-kb-sync\data\import\sync\inbox\`）

| 文件 | 内容 |
|---|---|
| `update-new-items.json` | 本轮新会话清单（`items` 数组：idx / title / first_request / msgs / date）。**若 `items` 为空，说明本轮没有新会话** |
| `update-topic-keys.tsv` | 合法话题清单（表头 `key\tdesc`），话题**只能从这里选** |
| `health-digest.md` | 健康相关会话摘要；**若不存在**表示本轮无健康内容 |
| `finance-digest.md` | 财务相关会话摘要；**若不存在**表示本轮无财务内容 |
| `specialty-keys.tsv` | 合法专题清单（表头 `key\tparent\tdesc`） |

## 输出（都写到 `D:\dsh\dsh-kb-sync\data\import\sync\out\`）

### 1. `update-topics.json`（必写）

为 `update-new-items.json` 里**每一个** idx 分配一个话题：

```json
{
  "generatedAt": "<ISO 时间>",
  "assignments": [ { "idx": 2527, "topic": "01-健康医疗", "why": "不超过20字" } ],
  "notes": "整体说明"
}
```

- `topic` 必须**逐字**等于 `update-topic-keys.tsv` 里的某个 key，**不得自创**。`99-零散杂问` 是无明确主题时的兜底。
- 判断依据是 `title` 与 `first_request`。两者都看不出主题、且 `msgs >= 6` 时，去 `D:\dsh\dsh-kb-sync\data\kb\conversations\` 按标题找文件读前 40 行。⚠️ 该目录**只读**，只读不写。
- `items` 为空时，`assignments` 写成 `[]`。

### 2. `health-facts.json`（仅当 `health-digest.md` 存在，且含**关于用户本人**的健康内容时）

先读 `D:\dsh\dsh-kb-sync\data\import\health-batches\EXTRACT.md`（提取规范，含字段定义与硬规则），再按规范提取。

```json
{
  "batch": "headless-<YYYY-MM-DD>",
  "note": "一句话说明本批来源",
  "facts": [
    {
      "kind": "symptom",
      "label": "简短标签",
      "value": "事实内容",
      "date": "YYYY-MM-DD",
      "date_source": "会话日期",
      "status": "用户自述",
      "evidence": "原文片段（不超过80字）",
      "source": "文件名.md",
      "confidence": "high"
    }
  ],
  "no_personal_data": []
}
```

**硬规则**（必须遵守）：
- 只提取**关于用户本人**的事实。若原文没有「我/本人」，或明确是**替朋友**问的（女性生理问题、明确说「女朋友」等），**不要**当作本人事实提取；这类会话列入 `no_personal_data`。
- `status` 只能是：`报告数值` / `报告结论` / `报告建议` / `报告要求` / `医生诊断` / `用户自述` / `模型推测` / `已改善` / `已解决`。严格区分。
- **不得编造**。没有的数值不要写。`evidence` 必须是原文片段。
- 无可提取内容时，写 `"facts": []`。

### 3. `finance-facts.json`（仅当 `finance-digest.md` 存在，且含**关于用户本人**的财务内容时）

⚠️ **这不是入账。** 你只产出**候选**；外部脚本会把它们追加到 `D:\dsh\控制台中心\finance\data\candidates.jsonl`，**由用户在看板里确认后才进台账**。所以宁可多留原文、也不要替用户下结论。

```json
{
  "batch": "headless-<YYYY-MM-DD>",
  "note": "一句话说明本批来源",
  "candidates": [
    {
      "kind": "debt",
      "topic": "debt",
      "label": "微粒贷余额（自述）",
      "value": "27061.89 元",
      "amount": 27061.89,
      "unit": "CNY",
      "asOf": "2026-10-06",
      "status": "用户自述",
      "evidence": "原文片段，不超过80字",
      "source": "文件名.md",
      "confidence": "high",
      "affects": "debts"
    }
  ],
  "no_personal_data": []
}
```

**字段取值**：
- `topic`：`income` / `expense` / `debt` / `asset` / `cash` / `rate` / `payment` / `plan`
- `status`：`用户自述` / `截图` / `模型推算` / `助手建议`
- `affects`：`profile` / `debts` / `cashflow` / `none` —— 建议它可能影响台账哪一块，仅作提示
- `amount`：能提取成数字就填（单位元，去掉千分位）；提不出就**省略该字段**，不要瞎猜

**硬规则**（必须遵守）：
1. **绝不臆造数字。** 只抄原文真的出现过的值；原文没写就只用文字描述。
2. 每条都要有 `asOf`（该数字对应的日期）与 `source`（文件名）。
3. **同一指标出现多个口径时全部保留、逐条列出**，不要合并、不要取平均——台账就是这么管的（例：花呗余额在截图与自述里是两个数，两条都写）。
4. 只提取**关于用户本人**的财务信息；替别人问的不要。
5. `evidence` 必须是原文片段，方便以后核对。
6. 无可提取内容时写 `"candidates": []`。

### 4. `specialty-suggestions.json`（必写，可为空数组）

如果本轮有新会话**明显**属于某个专题，写出建议。规则很严：

- 该会话的**一级话题必须正好等于**该专题的 `parent`（对照 `specialty-keys.tsv`）
- 只有当会话内容**确实**是该专题的主题时才建议；拿不准就**不要**写
- 宁可漏，不要错塞

```json
{
  "suggestions": [ { "idx": 2527, "specialty": "16-症状与用药咨询", "why": "血糖与饥饿机制" } ]
}
```

### 5. `summary.md`（必写）

```markdown
# 段 2 提炼摘要 <YYYY-MM-DD>

- 新增会话：N 条；续聊：N 条
- 归类：逐条列 idx / 标题 / 话题 / 理由
- 专题建议：有/无，分别是哪些
- 健康：提取 N 条事实；有无值得注意的新发现（尤其需要就医的）
- 财务：提取 N 条候选；有无需要注意的（金额冲突、利率变化、临近的还款）
- 自检：assignments 的 idx 集合是否与输入完全一致；所有 topic 是否合法
- 遇到的问题：写清哪一步失败、原文报错
```

## 自检（必须做）

写完后自己核对：
1. `update-topics.json` 的 idx 集合 == 输入 `update-new-items.json` 的 idx 集合（无重复、无遗漏、无多余）
2. 每个 `topic` 都在 `update-topic-keys.tsv` 里
3. 每个 `specialty` 的 parent 都与该 idx 的话题一致
4. 所有输出文件都是**严格合法 JSON**（不是带注释的伪 JSON）

把自检结果写进 `summary.md`。

## 最后

用一段话总结你做了什么（会打到 stdout 进日志）。**不要**输出 JSON 全文。
