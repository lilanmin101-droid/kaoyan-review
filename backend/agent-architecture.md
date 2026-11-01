# 考研复习 · 私教 Agent 后端架构 v0.1

技术栈：NestJS + PostgreSQL（pgvector）+ Mastra，模型 DeepSeek（推理模式）为主、通义千问交叉验证。接口前缀 `/api/v1`，流式输出走 SSE。

## 1. 学习档案（Agent 记忆）
| 表 | 关键字段 | 说明 |
|---|---|---|
| mastery | user_id, kp_path, score(0-1), recent_acc, last_practiced_at, feynman_result | 知识点掌握度，掌握度地图数据源 |
| error_profile | user_id, kp_path, concept, calc, reading, method | 四类错因计数 |
| reminders | user_id, question_id, text, fsrs_card_id | 每道错题的「下次记住」 |
| habits | user_id, hour_bucket, acc, avg_seconds, exam_time_pattern(jsonb) | 时段效率、模考时间分配 |
| goals | id, user_id, text, subtasks(jsonb), status, phase | 用户目标与拆解；phase = foundation/intensive/sprint |
| agent_actions | id, user_id, tool, reason, before(jsonb), after(jsonb), undoable, undone_at | 操作日志，用于首页展示与撤回 |

## 2. Agent 工具（Mastra tools，DeepSeek function calling）
- 只读：getProfile, getWrongQuestions, getAnswerHistory, searchQuestions（pgvector + 知识点过滤）
- 讲题：getHint(questionId, step), explain(questionId, selectedText?) —— 仅基于已校验解析；diagnoseError；judgeFeynman
- 出题：generateVariant（双模型解题 + SymPy 验算，三方一致才入库）, buildMockExam, buildQuiz
- 写操作（全部写 agent_actions，可撤回）：updateDailyPlan, addReviewCard, upsertReminder, switchPhase
- 输出：writeDailyTip, writeReview, synthesizeAudioReview（TTS）, exportWrongPdf

固定流程用 Mastra workflow：错题 → 诊断错因 → 讲解 → 生成变式题 → 验算 → 推送。
目标拆解、主动调整计划由 Agent 自主决定调用哪些工具。

## 3. 定时任务
- 每晚 23:00：当日复盘，更新档案，生成明日任务
- 交卷后：模考时间分配复盘
- 每周日：周报 + 下周计划
- 每日：按距考试天数检查阶段切换；考前 30 天自动组专属模拟卷
- 事件触发：某科连续 3 天未练、某知识点正确率连续下滑

## 4. 规则
- Agent 只能新增和修改，不能删除作答记录与笔记
- 每次写操作在首页留一条记录，撤回按 before 数据恢复
- 讲解必须带出处（年份、题号、知识点）；双模型不一致时显示「这题讲解待核对」
- 用户反馈「没讲清 / 讲错了」→ 自动重讲或进入核对队列

## 5. 排期（4 周）
- 第 1 周：登录、题库导入、OpenAPI + Mock（第 2 天）、Docker Compose
- 第 2 周：刷题与模考、错题本、PDF、同步、今日任务
- 第 3 周：背单词与发音、可信讲解与分步提示、双模型校题、Agent 框架 + 学习档案 + 操作日志、错因诊断、英语专项
- 第 4 周：变式题、主动触发、目标拆解、周报、联调

## 6. 验收标准（`npm run eval:agent` 自动测；内置用例在 LA 和上海两个时区各跑一遍）

报告写到 `eval/report-<时间>.md/.json`。单测或内置用例有一条不过，就以 exit 1 退出。`eval/agent_cases.jsonl` 是行业专家写的用例（没有就跳过）：能对上的断言自动判，其余列出来人工打分，加 `--strict` 时也计入退出码。

| 维度 | 指标（可测） | 怎么测 |
|---|---|---|
| 懂你 | 「今天」只在一处算：users.settings.timezone → X-Timezone → APP_TZ。同一用户在电脑和手机上拿到的日期一致 | r6-tz：/me/settings、/plans/today、命令 done.date 都等于该时区的今天 |
| 懂你 | 数量照用户说的：一道=1、两道=2、数字原样用，没说才默认 3 | 单测 parseCount；r6-dedupe-qty：新用户说「加一道」，计划里只有 1 题 |
| 懂你 | 「这题我会，是手滑」→ error_type=careless，掌握度不降，可撤回 | hard-3-careless；coach-05 |
| 主动 | 主动消息只给 1 个最重要的动作（headline），细节折叠在 details 里 | hard-1-one-action：headline 是一句话、只有一个动作 |
| 主动 | 「别管我」或连续 2 天没看 → 降低频率，可撤回。因为没看而降的，再看就恢复；从不升级打扰 | hard-2-backoff；coach-06/07；`POST /agent/messages/{id}/seen` |
| 能动手 | 每次改动都写进 agent_actions（summary/reason/target），都能撤回，二次撤回返回 409 | test:tools；coach-20 |
| 能动手 | 幂等：去重键 = 用户 + 意图 + 日期 + 任务（类型 + 目标/数量）。60 秒内同键已执行过、或计划里已有，就跳过，step 说明「已经有了」，done.deduped=true | r6-dedupe-qty：重复说 3 次，计划里仍只有 1 条；coach-02 |
| 能动手 | 指令含糊（「帮我调一下」）先问一个问题，不改计划 | coach-11 |
| 会教 | 单词进度 = position / scheduled_today。分母在当天第一次请求时冻结（快照），F5 不会变少 | r6-words：记住 1 个 + 忘了 1 个，刷新后显示 3/20 |
| 会教 | 讲解/提示要标是否已核对（verified），拿不准时直说 | smoke；coach-14/16/21 人工打分 |

当前结果（2026-11-01）：单测 46/46，内置 58/58，专家用例自动 30/30，人工打分 108 条。
