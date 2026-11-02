# 第 10 轮接口复测（用户视角）· 5a 周报 E1/E2 · 5b 暂停

- 后端：main 657d943，`http://localhost:3000/api/v1`（dist/src/main.js）；题库 math1 2024 = 22 题
- 时间：2026-11-02 12:16（北京时间）；所有"当前时间"用 `X-Debug-Now` 头模拟（+08:00）
- 账号（新库新注册，时区 Asia/Shanghai，密码从 /workspace/.kaoyan_testpw 读，本文不记录）：
  kaosheng_r14w、kaosheng_r14x（5a）；kaosheng_r14b2（5b 暂停/趋势/跨 04:00）；kaosheng_r14c（5b 24h 自动交卷）
- 脚本：lib10.sh（`source lib10.sh; reg <用户名>; DN=<ISO> req <METHOD> <path> [json]`）；原始请求/响应：raw10.log（token 已打码）
- 结果：5a 6/6 PASS；5b 10 项里 9 项 PASS，1 项 FAIL（详情接口没有 exam_name）

## 5a 周报 E1/E2

考试日 2026-12-26，周三 11-04 21:30 用 `POST /agent/jobs/run {"job":"weekly"}` 生成周报（r14w）；另一个账号 r14x 在周日 11-08 21:30 生成。读取接口是 `GET /agent/messages`（kind=weekly）和 `GET /plans/today`（tips.weekly）。

| # | 步骤（DN） | 期望 | 实际 | 结论 |
|---|---|---|---|---|
| 5a-1 | r14w 11-04 22:00 读 | 本周内不出现"当时"；距考试 52 天 | headline「下周重点：每天先做 5 道题…」；details「本周（11-02–11-08）…当前阶段：基础，距考试 52 天。」；/plans/today days_to_exam=52，tips.weekly 内容一致 | PASS |
| 5a-2 | r14w 11-06 10:00 读（本周内的旧周报） | 不出现"当时"，天数实时算：N−2 | details「…距考试 50 天。」，relative_day「前天」；/plans/today 52→50 一致 | PASS |
| 5a-3 | r14w 11-09 02:00 读（学习日还是 11-08） | 还算本周，不出现"当时" | headline「下周重点：…」，details「本周（11-02–11-08）…距考试 48 天」；/plans/today date=2026-11-08 | PASS |
| 5a-4 | r14w 11-09 04:30 读（过期） | headline 变成「当时定的下周重点：…」；details 变成「那周（11-02–11-08）…当时距考试 N 天」 | headline「当时定的下周重点：每天先做 5 道题，把节奏找回来。」；details「那周（11-02–11-08）没有作答记录，也没有学习时长记录。当时阶段：基础，当时距考试 52 天。」；/plans/today tips.weekly=null（只在当周显示） | PASS |
| 5a-5 | r14w 11-12 10:00 读（生成后第 8 天） | 同 5a-4，N 固定为当时的值 | 和 5a-4 完全相同（当时距考试 52 天），days_to_exam=44 | PASS |
| 5a-6 | r14x 周日 11-08 21:30 生成，分别在 21:31、11-09 03:59、11-09 04:00、11-16 21:30（8 天后）读 | 04:00 之前是本周文案，04:00 起切换到"当时"文案 | 21:31 和 03:59 是「下周重点：…/本周（11-02–11-08）…距考试 48 天」；04:00 和 11-16 是「当时定的下周重点：…/那周（11-02–11-08）…当时距考试 48 天」 | PASS |

## 5b 暂停

前置：每场都是 `POST /exams {"exam":"math1","year":2024}`，并且先 `PUT /exams/:id/progress` 答 1 题（避免触发 2 分钟内放弃即删除的规则）。started_at 跟随 DN（比如 DN 10:00+08 → started_at 02:00Z）。

| # | 步骤（DN） | 期望 | 实际（关键字段） | 结论 |
|---|---|---|---|---|
| 5b-1 | 10:05 暂停，10:21:01 继续（16m01s），10:30 交卷 | non_continuous:true，不计入趋势 | resume：paused_seconds=961，non_continuous=true；submit：counts_in_trend=false | PASS |
| 5b-2 | 13:10 暂停，13:24 继续（14m） | 不标记 | paused_seconds=840，non_continuous=false，counts_in_trend=true | PASS |
| 5b-3 | 边界值：正好 15:00 和 15:01 | 900 秒不标记；901 秒标记（规则是 >900） | 900 → nc=false/trend=true；901 → nc=true/trend=false | PASS |
| 5b-4 | 两次暂停累计：8m+8m=16m | 按累计时长判断，超过 15 分钟要标记 | 第 1 次后 480/false；第 2 次后 pause_count=2，paused_seconds=960，nc=true；交卷 counts_in_trend=false | PASS |
| 5b-5 | 重复暂停：10:05 暂停，10:06 再暂停 | 不重复计数 | 两次都是 pause_count=1，paused_at 一直是 02:05Z | PASS |
| 5b-6 | 没暂停时继续：10:22 再调 resume | 不重复计数 | pause_count=1，paused_seconds=961，不变 | PASS |
| 5b-7 | `GET /exams?trend=1` 排除不连续的场次 | 只返回 nc=false 的已交卷场次 | r14b2 共 6 场：trend=1 只返回 3 场（569d42b3、159a71d3、aa5e8306），3 场 nc=true 的（6801cfa0、d0f65f3a、c161afa3）都被排除；r14c 的自动交卷场次，trend=1 返回 0 场 | PASS |
| 5b-8 | r14c：11-05 09:30 暂停，11-06 09:29（23h59m）读，11-06 09:31（24h01m）读 | 23h59m 还在暂停；超过 24h 后按暂停开始那一刻自动交卷 | 09:29：status=paused，auto_submitted=false；09:31：status=submitted，auto_submitted=true，auto_submit_reason=`paused_too_long`，submitted_at=2026-11-05T01:30:00Z（=暂停开始），submitted_date=2026-11-05，non_continuous=true，counts_in_trend=false；之后 pause/resume 都返回 409 `exam_auto_submitted`「暂停超过 24 小时，已经按暂停那一刻保存的答案自动交卷」 | PASS |
| 5b-9 | 跨 04:00：11-04 03:30 开考，04:10 交卷，不暂停 | 以 openapi 为准：第 16 轮已删掉"跨 04:00 标记"规则，所以不标记、计入趋势，submitted_date 记在开考那个学习日 | non_continuous=false，counts_in_trend=true，started_date=submitted_date=2026-11-03，出现在 trend=1 里 | PASS（有文档冲突，见下方备注 1） |
| 5b-10 | 详情 `GET /exams/:id` 和列表 `GET /exams` 都带 paused_at、exam_name、submitted_date | 两个接口都有这三个字段 | 列表：三个字段都有（exam_name「数学一」；暂停中 paused_at=01:30Z；已交卷 submitted_date）。详情：paused_at、submitted_date 有，**exam_name 没有**（`has("exam_name")=false`，只有 exam=math1 和 title「2024 数学一」）；POST /exams 和 submit 的返回里也没有 | **FAIL** |

## 备注
1. 跨 04:00 规则有文档冲突：HANDOFF §6 和本轮任务写的是"跨 04:00 学习日也标记"，但 openapi.yaml（第 1907、5197、5646 行附近）和代码（exam-clock.ts，nonContinuous = paused > 900）都写明第 16 轮已删掉这条规则。本轮按契约判 PASS，建议同步更新 HANDOFF §6。
2. 5b-10 FAIL 的定位：`exams.service.ts` 里详情视图（约第 228 行的 return）没有输出 `exam_name`，列表（第 302 行）和 409 active_exam（第 157 行）都有 `exam_name: EXAM_CN[r.exam] ?? r.exam`。openapi 里也只在 ExamHistoryItem 中定义了 exam_name，所以要么给详情补上这个字段，要么把契约和 HANDOFF 改成"只在列表里有"。
3. 观察（没算 FAIL）：自动交卷后 paused_seconds=0，因为考试按暂停开始那一刻结算，暂停时间不计入考试时长；暂停中详情显示 paused_seconds=86340。如果前端要显示"暂停了多久"，需要另外处理。
