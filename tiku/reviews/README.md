# 校对记录（reviews）

团队规则：**只有资料同学改题目 JSON**（`/workspace/tiku/<exam>_<year>.json`）。核对题目的人（用户、行业专家等）不改题目文件，把结论追加写在这里。

- 文件名和题目文件对应：`math1_2024.json` → `reviews/math1_2024.jsonl`，`english1_2023.json` → `reviews/english1_2023.jsonl`
- 一行一个 JSON 对象（JSON Lines），**只追加，不改旧行**；改主意就再写一行，时间更晚的那条生效
- 后端导入脚本（`npm run import:2024` / `npm run import:all`）每次都会读取这里，叠加后入库；题目 JSON 本身不会被改

## 每行的格式

```json
{"id":"math1-2024-03","status":"confirmed","by":"用户","note":"重建后复核，答案 A（-1/6）正确","at":"2026-11-01T04:15"}
{"id":"math1-2024-13","status":"confirmed","by":"用户","note":"取 -1/π","at":"2026-11-01T04:20","answer":["$-\\frac{1}{\\pi}$"]}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 题目 id，如 `math1-2024-03`，必须在对应的题目文件里 |
| `status` | 是 | `confirmed`（确认无误）/ `pending`（待核对）/ `suspect`（有问题） |
| `by` | 是 | 谁核对的：`用户`、`行业专家`…… |
| `at` | 是 | 时间，`2026-11-01T04:15` 或 `2026-11-01`；不带时区按太平洋时间；也可带 `Z` 或 `+08:00` |
| `note` | 否 | 结论和理由（怎么验算的、改了什么） |
| `answer` | 否 | 字符串数组。写了就用它覆盖题目 JSON 里的答案（选择题写字母，如 `["C"]`；其他写 LaTeX） |

## 导入时怎么合并

对每道题：

1. **状态**：取 `at` 最新的那一条的 `status`（时间相同取文件里靠后的）
2. **备注**：所有记录的 `note` 按时间顺序追加到 `review.notes`，格式「by（at）：note」
3. **核对人**：`review.checked_by` = 原有的 ∪ 所有记录的 `by`
4. **答案**：取「带 `answer` 的记录里最新的一条」；和题目 JSON 不一样时，导入报告里记一条 `answer_overridden_by_review`，方便资料同学回头把题目文件改过来

坏行（不是 JSON、缺字段、status 不对、时间解析不了）和题目文件里没有的 id 会列在导入报告「校对记录」一节里，**不生效，但不会让导入失败**。

## 旧字段名（兼容）

早期写法 `reviewer`（= `by`）、`date`（= `at`）、`exam` + `year` + `number`（拼成 `id`）、`fix_request`（作为备注追加）目前还能用，导入报告会提示改成新格式。新写的行请用上面的字段。
