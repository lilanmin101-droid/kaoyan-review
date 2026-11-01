## 2026-11-01 08:20:01 PT 自动导入 成功
- 触发文件：english1_2015_kp_tags.json、english1_2016_kp_tags.json、english1_2017_kp_tags.json、english1_2018_kp_tags.json、english1_2019_kp_tags.json、english1_2020_kp_tags.json、english1_2021_kp_tags.json、english1_2022_kp_tags.json、english1_2023_kp_tags.json、english1_2024_kp_tags.json、english1_2025_kp_tags.json
- 没有警告

## 按科目 / 年份汇总（入库后）

❌ 有错误：english1_2024。题数和校对状态取自数据库（叠加 reviews 之后）；❌ = 导入失败 / 有错误级问题 / 文章结构错误 / 校对坏行，「提示」不影响导入。

| 科目 | 年份 | 题数 | 文章 | confirmed | pending | suspect | 全部 confirmed（可开整卷） | 导入问题 | 详细报告 | 状态 |
|---|---|---|---|---|---|---|---|---|---|---|
| english1 | 2015 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2015.md) | ✅ |
| english1 | 2016 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2016.md) | ✅ |
| english1 | 2017 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2017.md) | ✅ |
| english1 | 2018 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2018.md) | ✅ |
| english1 | 2019 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2019.md) | ✅ |
| english1 | 2020 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2020.md) | ✅ |
| english1 | 2021 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2021.md) | ✅ |
| english1 | 2022 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2022.md) | ✅ |
| english1 | 2023 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2023.md) | ✅ |
| english1 | 2024 | 52 | 7 | 52 | 0 | 0 | 是 | 错误级 1 道题；提示 1 条（kp_missing） | [报告](import_report_english1_2024.md) | ❌ |
| english1 | 2025 | 52 | 7 | 52 | 0 | 0 | 是 | 0 | [报告](import_report_english1_2025.md) | ✅ |
| math1 | 2015 | 23 | — | 23 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2015.md) | ✅ |
| math1 | 2016 | 23 | — | 23 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2016.md) | ✅ |
| math1 | 2017 | 23 | — | 23 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2017.md) | ✅ |
| math1 | 2018 | 23 | — | 23 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2018.md) | ✅ |
| math1 | 2019 | 23 | — | 23 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2019.md) | ✅ |
| math1 | 2020 | 23 | — | 23 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2020.md) | ✅ |
| math1 | 2021 | 22 | — | 22 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2021.md) | ✅ |
| math1 | 2022 | 22 | — | 22 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2022.md) | ✅ |
| math1 | 2023 | 22 | — | 22 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2023.md) | ✅ |
| math1 | 2024 | 22 | — | 22 | 0 | 0 | 是 | 提示 9 条（kp_low_confidence） | [报告](import_report_math1_2024.md) | ✅ |
| math1 | 2025 | 22 | — | 22 | 0 | 0 | 是 | 0 | [报告](import_report_math1_2025.md) | ✅ |

## 真题词汇（import:vocab，详见 [import_report_vocab.md](import_report_vocab.md)）

- import:vocab：真题词元 4280 个；词库 5450 词
- 匹配已有单词 2995（词元 2960，词形 35；其中之前补进来的真题词 649），本次有变化 0
- 没匹配上 1320（出现 <3 次 1314，候选补词 6）
- 基础词 basic=1334（本次改了 0；默认不进今日新词队列）
- 补词 新增 0，跳过专有名词 6，缺中文释义（needs_definition，不进学习队列）0
- 报告：import_reports/import_report_vocab.md

## 完整日志

```

> kaoyan-backend@0.1.0 import:all
> node dist/scripts/import-questions.js --tree /workspace/tiku/knowledge_tree.json --questions /workspace/tiku --report-dir import_reports && node dist/scripts/import-vocab.js

english1_2015.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2015.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2015.jsonl',
  records: 104,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2015_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2016.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2016.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2016.jsonl',
  records: 105,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2016_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2017.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2017.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2017.jsonl',
  records: 105,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2017_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2018.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2018.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2018.jsonl',
  records: 104,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2018_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2019.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2019.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2019.jsonl',
  records: 104,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2019_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2020.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2020.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2020.jsonl',
  records: 106,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2020_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2021.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2021.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2021.jsonl',
  records: 112,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2021_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2022.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2022.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2022.jsonl',
  records: 104,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2022_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2023.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2023.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2023.jsonl',
  records: 109,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2023_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2024.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2024.md
  problem counts: { kp_missing: 1 }
  reviews: {
  file: '/workspace/tiku/reviews/english1_2024.jsonl',
  records: 117,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2024_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
english1_2025.json: 52 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_english1_2025.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/english1_2025.jsonl',
  records: 125,
  applied_questions: 52,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 52 }
}
  english1: {
  passages_file: '/workspace/tiku/english1_2025_passages.json',
  passages: 7,
  structure_errors: 0,
  structure_warnings: 0,
  file_level: []
}
math1_2015.json: 23 questions, 23 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2015.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2015.jsonl',
  records: 60,
  applied_questions: 23,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 23 }
}
math1_2016.json: 23 questions, 23 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2016.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2016.jsonl',
  records: 46,
  applied_questions: 23,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 23 }
}
math1_2017.json: 23 questions, 23 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2017.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2017.jsonl',
  records: 38,
  applied_questions: 23,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 23 }
}
math1_2018.json: 23 questions, 23 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2018.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2018.jsonl',
  records: 39,
  applied_questions: 23,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 23 }
}
math1_2019.json: 23 questions, 23 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2019.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2019.jsonl',
  records: 41,
  applied_questions: 23,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 23 }
}
math1_2020.json: 23 questions, 23 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2020.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2020.jsonl',
  records: 39,
  applied_questions: 23,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 23 }
}
math1_2021.json: 22 questions, 22 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2021.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2021.jsonl',
  records: 38,
  applied_questions: 22,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 22 }
}
math1_2022.json: 22 questions, 22 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2022.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2022.jsonl',
  records: 27,
  applied_questions: 22,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 4,
  future_at_lines: 0,
  final_status: { confirmed: 22 }
}
math1_2023.json: 22 questions, 22 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2023.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2023.jsonl',
  records: 38,
  applied_questions: 22,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 7,
  future_at_lines: 0,
  final_status: { confirmed: 22 }
}
math1_2024.json: 22 questions, 0 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2024.md
  problem counts: { kp_low_confidence: 9 }
  reviews: {
  file: '/workspace/tiku/reviews/math1_2024.jsonl',
  records: 23,
  applied_questions: 22,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 9,
  future_at_lines: 0,
  final_status: { confirmed: 22 }
}
math1_2025.json: 22 questions, 22 with solution → /workspace/kaoyan/backend/import_reports/import_report_math1_2025.md
  problem counts: {}
  reviews: {
  file: '/workspace/tiku/reviews/math1_2025.jsonl',
  records: 47,
  applied_questions: 22,
  answer_overridden: 0,
  bad_lines: 0,
  unknown_ids: 0,
  legacy_lines: 0,
  future_at_lines: 0,
  final_status: { confirmed: 22 }
}
done: 22 file(s), 177 kp nodes (144 leaves)
total problem counts: { kp_missing: 1, kp_low_confidence: 9 }
import:vocab：真题词元 4280 个；词库 5450 词
  匹配已有单词 2995（词元 2960，词形 35；其中之前补进来的真题词 649），本次有变化 0
  没匹配上 1320（出现 <3 次 1314，候选补词 6）
  基础词 basic=1334（本次改了 0；默认不进今日新词队列）
  补词 新增 0，跳过专有名词 6，缺中文释义（needs_definition，不进学习队列）0
  报告：import_reports/import_report_vocab.md

```
