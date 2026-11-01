# 教练接口复测 第4轮（用户，2026-11-01 07:52–07:55 PST）
账号：kaosheng_r9a / r9c（America/Los_Angeles），kaosheng_r9b（Asia/Shanghai），coach_frequency=ask。原始日志在 raw.log、cmd*.txt（不含密码和 token）。
当时时间：洛杉矶 07:53，上海 23:53。

1 去重 PASS：r9a 确认 nightly「做 5 道基础题热身」后，force midday 和 weekly 都返回 proposal_skipped「没有新的建议：计划里该有的都有了，这次不打扰你」。之后 midday 换成了「练 3 道「变限积分」」。r9a 的错题已经排进 11-02，没有再被提议到 11-01（7 天范围内生效）。
2 测试触发 PASS：ask 模式下 force midday，summary 是「中午了，今天还没排计划。回一句「今天只有一小时」，我帮你排。（测试触发）」，不含「提醒频率」，返回和 action 里都有 forced:true。
3 周报 PASS：details 是「本周（10-26–11-01）还没有作答记录，也还没有学习时长记录。当前阶段：基础。」。messages、plans/today、plans、actions 和 SSE 回复里用户能看到的文字都扫过一遍，没有 null、NaN 或 undefined。
4 why_changed PASS：11-02 的计划 why_changed 是「是从今天（11-01）做错的题里挑的。演示建议：还没有足够的作答数据，先加 5 道基础题热身。」，新的在前。why_changed_latest 是「是从今天（11-01）做错的题里挑的。」。两个 task 各有自己的 why_changed。
5 时段词 PASS：洛杉矶 07:53 显示「错题本里还有 1 道没掌握，今天先重做 1 道。」；上海 23:53 显示「…今晚先重做 1 道。」。
6 status PASS：确认或忽略前是 pending，之后是 confirmed 或 dismissed。confirm 返回 message.status=confirmed，headline「已在 11-01 的计划里加了「重做 1 道错题」」；dismiss 返回 message.status=dismissed，headline「已忽略，计划没改」。重复 dismiss 返回 409 already_decided「这条建议已经处理过了」。
7 题目 PASS：2025-14 的 errata 是 Gallon→Gallou，2025-39 是 replace→replaces，都有 note。2019-22 返回 sub_scores [5,3,3]，与 sub_questions 一致，source=estimated。2016-19 5+5，2017-18 4+6，2020-19 5+5，2023-20 6+6，2024-19 6+6，score_by_whole 都是 false。
8 单词 基本PASS：默认 20 个词里 basic:true 的是 0 个；加 include_basic=1 后 20 个里有 17 个是 basic 词。frequency、exam_years、examples 都有值。但 20 个词的 added_at 全是 null（见 B4）。

## 新问题
B1 聊天指令去重太死：r9a 先说「今天做错的明天排 1 道」，当时没有错题，回复没改。随后做错 1 题，11 秒后再说同一句，返回 deduped「11 秒前说过同样的话…这次没有重复执行」。数据已经变了，应该重新执行。回复里还出现了「。，」（「…排 5 道基础题」。，这次没有重复执行」）。
B2 /plans/today（11-01）的计划是空的，但 why_changed 显示的是 11-02 那条改动的原因「是从今天（11-01）做错的题里挑的。」，why_changed_latest 是 null，两者不一致，容易让人误以为今天的计划被改过。
B3 r9b 忽略了建议后，force midday 和 weekly 的 proposal_skipped 都写「计划里该有的都有了」。实际计划没改，应该写成「这条你已经忽略过了」之类。
B4 /words/today 的 added_at 全是 null。brief 要求「no nulls」，后端只承诺了 frequency 和 examples 不为 null，需要后端确认 added_at 为 null 是不是预期。
B5 小问题：上海 23:53 force midday，文案仍然是「中午了…」。测试触发可以接受，可以考虑按当地时间改写。2018-19 是整题计分，顶层 sub_scores 返回 [null]，建议改成 null 或 []。
