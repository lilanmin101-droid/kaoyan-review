# 英语一题库格式（已由后端定稿，本文件只记录约定和资料/仓库搜索者的实现）

- 题目：`english1_<年>.json`（v0.2 数组），id `english1-<年>-NN`，number 1–52；每题有 `passage_id`（写作为 null）
- 篇章：`english1_<年>_passages.json`，数组 `{id, section, title, directions, text, images}`；id `english1-<年>-P-cloze|text1..4|partb|translation`；`text` 段落之间用空行分开；Part B 另有 `options`（A–G）和 `subtype`（matching/heading_matching/ordering/gap_fill）
- section / type / 每题分值：use_of_english/choice/0.5；reading_a/choice/2；reading_b/match/2（options A–G，答案一个字母）；translation/translation/2（英一翻译是 5 句 × 2 分 = 10 分，15 分是英语二的整段翻译）；writing_a/essay/10；writing_b/essay/20
- 标记：
  - 完形篇章里，空位写成 `{{n}}`；题目 `stem` 是含这个空的那句，所有空都换成 `（n）______`
  - 翻译篇章里，划线句写成 `<u data-q="46">…</u>`，题目 `stem` 和这句逐字相同（构建时会断言）
  - Part B 的 `stem` 是「人名 + 换行 + 评论原文」，options 每题都带全 A–G
- 翻译和写作：`answer` 是参考译文或范文，`stem` 是题目要求，图片放在 `images`；`source.answer_note` 注明「非官方」
- 知识点：翻译、写作、Part B 按题型直接给出；完形和阅读 A 需要逐题标注，等行业专家写 `english1_<年>_kp_tags.json`
