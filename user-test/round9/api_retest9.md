# 第9轮复测（后端 cc3d6ca；用户，北京时间 2026-11-02 01:04）
账号：新号 kaosheng_r13b、r13c（Asia/Shanghai）。日志在 raw9.log 和 raw9_cmd.log（不含密码和 token）。

1 过期建议 PASS：
  - r13b 在 11-02 22:00 force nightly，生成一条 pending 建议，target_date=2026-11-03。
  - 拨到 11-11：顶层 status 和 proposal.status 都是 expired。headline 是「已过期，计划没动。原本想在11-03（周二）的计划里加「做 5 道基础题热身」。」。
  - 这时确认，返回 409，code=proposal_expired，message 是「这条建议已经过期了，计划没动；还需要的话直接跟教练说一声」，同时返回 target_date=2026-11-03。确认前后，11-01–11-10 的计划没有变化。
  - 对照：r13c 拨到 11-04 03:30（学习日还是 11-03）时 status 是 pending，headline 是「…想在今天（11-03）的计划里加…」。确认成功，返回「已在今天（11-03）的计划里加了「做 5 道基础题热身」」。
  - 小问题：details 里括号套了两层，写成「建议的日子（11-03（周二））已经过去了…」，建议改成「建议的日子 11-03（周二）已经过去了」。
2 这周 PASS：
  - 11-04：「这周（11-02–11-08）还没有作答记录。…」
  - 周日 11-08 02:00（学习日 11-07）：「这周（11-02–11-08）…凌晨 4 点前还算 11-07 这一天。」
  - 周一 11-09 02:00（学习日 11-08，是周日）：「这周（11-02–11-08）…凌晨 4 点前还算 11-08 这一天。」
  - 周一 11-09 04:30：「这周（11-09–11-15）…」，边界正确。
3 开考后 2 分钟内放弃 PASS：
  - 新开数一 2019，返回 201，resumed:false。同一份卷子再开，返回 200，resumed:true。
  - 换数一 2020 开考，返回 409，code=other_exam_active，message 是「还有一场「2019 数学一」模考没交卷，先接着做或放弃那一场，再开新的」。active_exam 里有 id、kind、title、exam、exam_name、year、status、question_count、answered_count=0、remaining_seconds=10800、started_at。
  - 一题不答立刻 abandon，返回 {status:"discarded",discarded:true}。之后 GET 返回 404，/exams 列表、/me/stats、/agent/messages 里都没有它。
  - 答 1 题再 abandon，返回 status:abandoned，discarded:false。
  - 不答题，X-Debug-Now 设为开考后 121 秒再 abandon，返回 discarded:false。
  - 开考时间不受 X-Debug-Now 控制：带 X-Debug-Now 2026-11-05 开考，started_at 仍是真实时间 2026-11-01T17:04:57Z。只有 abandon 时用的「现在」会读调试头。
4 字数线 PASS（英一 2022 整卷，翻译、小作文、大作文交卷时都自评 full）：
  - 46（翻译，中文短句）：word_count=6，min_words=12，flags=["word_count_low"]。
  - 51（小作文，10 个英文词）：word_count=10，min_words=50，flags=["word_count_low"]。
  - 52（大作文，100 个英文词）：word_count=100，min_words=80，flags=[]。
  - 47–50 没作答：unanswered=true，0 分，self_rating 改成了 no_idea。
  - 观察：大作文用了 100 个同一个词「students」，也照常按 full 记 20 分，没有提示。词数线拦不住这种灌水，供参考。
