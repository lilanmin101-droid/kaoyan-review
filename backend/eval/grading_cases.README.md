# AI 批改评测用例 `grading_cases.jsonl`

`npm run eval:grading` 读这个文件（每行一个 JSON 对象），把每条作答**分别**交给 DeepSeek（主评）和通义千问（复评）批改（直接调后端的 `gradeWithModel`，和 `POST /answers/{id}/grade` 用的是同一套提示词、校验和分数规范化），再和专家给的期望结果比对。格式示例见 `grading_cases.example.jsonl`。

## 运行

| 情况 | 行为 |
|---|---|
| 两个 Key 都没配 | 打印 `eval:grading skipped: no key`，退出码 0 |
| 只配了一个 Key | 只跑这个模型，另一个在报告里标 `skipped` |
| `AI_FAKE=1` | 两个模型都换成确定性假模型，端到端自检（数字不代表真实质量）；再加 `AI_FAKE_DISAGREE=1` 可以造出两模型分歧 |
| `--cases <文件>` | 换用例文件，例如 `--cases eval/grading_cases.example.jsonl` |
| `--strict` | 有用例没通过或模型报错时退出码 1（默认只出报告、退出码 0） |
| `EVAL_CONCURRENCY=3` | 并发请求数 |

报告写到 `eval/grading-report-<UTC 时间>.md`（同名 `.json` 是机器可读版）。

## 每行的字段

```jsonc
{
  "id": "grade-tr-01",                 // 必填，唯一
  "kind": "translation",               // 必填：translation（每句 2 分）| writing_a（小作文 10 分）| writing_b（大作文 20 分）
  "question_id": "english1-2024-46",   // 题库里的题号（从数据库读题干、参考译文/范文、所属文章）
  "question": {                        // 或者直接内联题目（有它就不查题库）
    "stem": "…", "answer": ["参考译文或范文"], "passage_text": null
  },
  "answer_text": "考生作答原文",         // 必填，字符串（空串 = 交白卷）
  "expected": {                        // 专家给的标准答案，对应批改结果 {band, score, max_score, points_hit[], points_missed[], errors[{span,type,fix}]}
    "score": 2,                        // 必填，0.5 的倍数，0–max_score
    "score_range": [2, 2],             // 可选：可以接受的分数区间（落在区间内也算分数通过）
    "band": null,                      // 作文必填 0–5（零档–第五档）；翻译写 null
    "points_hit_must": ["…"],          // 模型的 points_hit 里应该出现的要点（按意思模糊匹配，不要求逐字）
    "points_missed_must": ["…"],       // 不该被算成「答到了」的要点
    "errors_must": [{"span": "工作出", "type": "vocab"}],  // 模型 errors 里应该找到的错误（按 span 片段匹配；type 只做参考）
    "word_count": 0                    // 可选，仅备注
  },
  "check": {
    "score_tolerance": 0.5,            // 可选：允许的分数误差；缺省 翻译 0.5 / 小作文 1 / 大作文 2
    "band_must_be_within": 1           // 可选：允许的档位误差；缺省 1
  },
  "note": "说明（出现在没通过的明细里）", "by": "行业专家", "source": "…", "at": "2026-11-01T07:04-08:00"   // 其他字段原样忽略
}
```

`errors[].type` 只能是 `grammar | vocab | spelling | logic | off_topic`。

## 判定和指标

- **单条通过**：分数落在 `score_range` 内，或与 `expected.score` 相差 ≤ `score_tolerance`；并且（作文）档位相差 ≤ `band_must_be_within`。
- 每个模型**分别**统计：通过率、档位完全一致率、档位 ±1 以内比例、平均分数绝对误差（MAE）、分数落在区间比例、`points_hit` 召回（按要点数微平均）、该漏要点没被误判为答到的比例、`errors_must` 找到率、平均耗时；另按题型拆分。
- **每条用例并排表**：期望分/档、两个模型各自的分/档、召回、通过与否。
- **交叉复评分歧率**：两模型都出分的用例中，按线上规则（作文差 > 1 档、翻译差 > 1 分，即 `ai-grader.disagrees()`，线上会标「需人工复核」）判为分歧的比例。
- **分歧用例单独列表**：两模型分差 > 该条 `score_tolerance`，或档差 > 1。
- **无法使用的行**：JSON 解析失败、缺必填字段、取值越界、id 重复、题库里找不到 `question_id` 的行，都列在报告末尾，不影响其他用例。
