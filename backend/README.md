# 考研复习 App · 后端（第一版）

NestJS 11（TypeScript）+ PostgreSQL 17，REST + SSE，前缀 `/api/v1`。设计见 `agent-architecture.md`，接口见 `openapi.yaml`。

## 一键起来

```bash
cd /workspace/kaoyan/backend
npm install
npm run build
npm run db:start          # 启动本机 Postgres（数据在 ../pgdata，端口 5432）
npm run migrate           # 建表（pgvector 不可用时自动跳过 002）
npm run import:2024       # 导入知识点树 + 2024 数一，生成 import_report_2024.md
npm run import:all        # 导入 /workspace/tiku 下所有 math1_YYYY.json / english1_YYYY.json，每个文件一份 import_report_<exam>_<year>.md
npm run seed:words        # = 导入 ECDICT 考研词（tag ky，约 4800 个；找不到 ECDICT 会提示下载地址），不写任何示例内容
npm start                 # http://localhost:3000/api/v1
npm run test:smoke        # curl 跑一遍主流程，最后打印 ALL OK
npm run test:tools        # Agent 每个写工具 + 撤回还原，最后打印 TOOLS OK
npm run test:sources      # 讲解/思路来源 expert/pending（另起 :3002），最后打印 SOURCES OK
npm run ai:check          # 看 AI 配置：没 Key 显示 mock；有 Key 每个模型发 1 token 测连通
npm run key:preflight     # Key 到位后一键预检（ai:check → 临时后端真模型 → 讲解 dry-run/2 题 → eval:grading → eval:agent），见下文
```

第一次在新机器上：`npm run setup`（= db:init + migrate + import:2024 + seed:words）。
清库重来：`npm run db:reset && npm run migrate && npm run import:2024 && npm run seed:words`。

## Mock 服务（前端先联调用）

```bash
npm run mock              # http://localhost:4010/api/v1 ，MOCK_PORT 可改端口
```

- 按 `openapi.yaml` 里的 example 返回，不需要数据库，不校验 token
- SSE（`/agent/commands`、`/questions/{id}/explain`）按 example 逐条推送，间隔 `MOCK_SSE_DELAY`（默认 400ms）
- `?__status=409` 返回该状态码的错误样例；`?__example=<名字>` 选指定 example
- 改了 `openapi.yaml` 重启 mock 即可

## 目录

| 路径 | 内容 |
|---|---|
| `src/auth` | 注册 / 登录（bcrypt + JWT，`Authorization: Bearer`，SSE 也可用 `?access_token=`） |
| `src/questions` | 题目列表/详情、分步提示 `hint`、讲解 `explain`（SSE）、讲解反馈 |
| `src/answers` | 作答（只追加，`client_id` 去重），判分后更新错题本、掌握度、错因、时段习惯 |
| `src/exams` | 模考：开始、保存进度（幂等）、续考、交卷复盘 |
| `src/wrong-questions` | 错题本、改错因、导出 PDF（KaTeX + 本机 Chrome） |
| `src/words` | 今日单词、复习打分（ts-fsrs） |
| `src/plans` `src/checkins` | 每日计划（带「为什么改」）、打卡 |
| `src/sync` `src/events` | 两端同步（变更日志 + cursor）、批量埋点 |
| `src/ai` | LLM 接入（DeepSeek / 通义千问，OpenAI 兼容）、讲解生成与双模型核对、专家讲解读取 |
| `src/agent` | 命令栏 SSE（Mastra Agent + 工具）、改动记录、撤回、定时任务（@nestjs/schedule） |
| `src/feynman` | 讲给它听（audio/webm、audio/mp4 上传；判断是模拟结果） |
| `src/mastery` | 掌握度地图（完整三层树）、学习档案 |
| `migrations/` | 纯 SQL 迁移（`001_init.sql` 全部表；`002_pgvector.sql` 向量列） |
| `scripts/` | `db.sh`、`migrate.ts`、`import-questions.ts`、`seed-words.ts`、`import-words.ts`、`ai-check.ts`、`ai-explain.ts`、`test-agent-tools.ts`、`smoke.sh`、`test-sources.sh` |
| `test/fake-llm.js` | 本地假 LLM（OpenAI 兼容，:4020），没 Key 时验证 AI 路径用 |
| `mock/server.js` | Mock 服务 |

## 几个约定

- **模考计时在服务端**：`PUT /exams/{id}/progress` 必须带 `idempotency_key` + `client_seq`。同一个 key 重发返回第一次的结果；`client_seq` 落后的请求不覆盖答案。两次保存之间最多计 120 秒（断网/关页面不会一直扣时间），`state: paused` 暂停计时。返回 `remaining_seconds`。
- **作答记录只追加**：`answer_records` 上有触发器，禁止 UPDATE/DELETE。
- **Agent 改动都可撤回**：`agent_actions` 存 before/after、summary、reason、target；撤回按 before 恢复，重复撤回 409。
- **掌握度**：`mastery.score` 为空表示没练过；地图接口返回全部 144 个知识点。
- **时区**：「今天」和定时任务按 `APP_TZ`（默认 `Asia/Shanghai`，北京时间）。
- **导入多个年份**：`--questions` 可以是文件、目录或通配符（逗号分隔多个），例如
  `node dist/scripts/import-questions.js --questions '/workspace/tiku/english1_*.json' --report-dir reports`。
  文件名要像 `math1_2024.json`、`english1_2023.json`；同目录下的 `<名字>_kp_tags.json` 自动用来补知识点。新年份不用改代码。
  题目里有 `solution` 就一起存（字符串原样存，数组拼成 Markdown），`include_answer=true` 时返回。
- **导入检查**：除 KaTeX、知识点、答案外，还有
  `ocr_fragment`（提醒，带出问题片段：分数被拆成两个数字如「6⏎1」「17 2」、悬空运算符如「X Y+」、选项公式没包 $、题干末尾残字、PDF 符号字体私有区字符、选项里的 `![…](…)` / `<img>` / `[图]`），
  `image_missing`（错误：stem/options/sub_questions/solution/images 引用的图片按题目 JSON 所在目录解析，文件不存在）。
- **题目图片**：`GET /api/v1/assets/<相对路径>`（不需要登录，只放图片，禁止 `..`），目录是 `ASSETS_DIR`（默认 `/workspace/tiku`）。题目接口返回 `asset_base`，前端用 `asset_base + 相对路径` 显示图片；错题 PDF 里的图片直接读本地文件。Mock 服务同样提供这个路由。
- **校对记录**：核对人不改题目 JSON，把结论追加到 `/workspace/tiku/reviews/<exam>_<year>.jsonl`（一行一个 `{"id","status","by","note","at","answer"?}`，格式见那里的 README.md）。导入时自动读取：状态取 `at` 最新的一条，note 全部追加到 `review.notes`，`checked_by` 取并集，带 `answer` 的最新一条覆盖答案（报告里记 `answer_overridden_by_review`）。坏行、未知 id 写进报告「校对记录」一节，不中断导入。
- **导入不改源文件**：`import:2024` 只读 `/workspace/tiku/*.json`；题目自带知识点为空时从 `math1_2024_kp_tags.json` 取，并记下置信度（`kp_source` / `kp_confidence`）。可加 `--dry-run` 只出报告。

## AI / Agent

Key 放进 `backend/.env`（不要发到群里），重启后端即生效；`npm run ai:check` 检查。没 Key 时一切照常跑，只是走规则版 / 题库内容。

### Key 到位后：一键预检

```bash
cd backend && npm run key:preflight            # 填好 DEEPSEEK_API_KEY / DASHSCOPE_API_KEY 后跑这一条
npm run key:preflight -- --fake                # 没 Key 时演练整套流程（起 test/fake-llm.js，模拟 DeepSeek 思考模式）
```

按顺序检查：① 两个 Key 有没有配（不打印 Key）② 编译 ③ `ai:check`（`/models` 预检模型名 + 每个模型 1 token）④ 在 `PREFLIGHT_PORT`（默认 3108）起一个临时后端：启动日志的 `/models` 预检不能有 ⚠，再用真模型跑一条教练指令（不能 400、不能退回规则版 `mock=true`）⑤ `gen:explanations --dry-run`（看要生成多少题、多少钱），再真生成 2 题（按现在的题库默认范围是 0 题，这时在**临时库**上自动加 `--include-expert` 生成 2 题，只为验证链路；`--no-db-copy` 时不在原库上这么做，只给 ⚠；一题都没生成算 ✗）⑥ `eval:grading`（两个模型都不能报错）⑦ `eval:agent`（AI 模式，`EVAL_TZ=Asia/Shanghai`）。每步打印 ✓ / ✗ / ⚠，最后列出「要改什么」（比如「DEEPSEEK_API_KEY 无效 → 重新复制」「QWEN_MODEL 不在 /models 列表 → 改成列表里的名字」）。全部 ✓（⚠ 只是提醒）退出码 0。

- 不碰正在跑的服务：临时后端单独端口；数据库用 `.env` 那个库的临时拷贝（需要 `pg_dump` / `pg_restore`，结束删除）。没装就加 `--no-db-copy` 用原库（会写入 2 条讲解和几个测试号）。
- 其他选项：`--gen-limit N`（第 5 步真生成几题，0 = 只 dry-run）、`--skip-eval`（跳过 ⑥⑦，省钱）、`--keep`（不清理，排查用）。日志和评测报告都放 `/tmp/kaoyan-key-preflight-<时间>/`，不弄脏仓库。
- `eval:agent` 的自动项有不通过时记 ⚠ 而不是 ✗：那是真模型的行为问题（交给后端 / 行业专家看报告），不是 Key 配置问题；但模型调用报错（400/401/429）或用例前提没落库会记 ✗。
- 已知坑（演练时复现并修了）：DeepSeek `deepseek-flash` 默认开思考模式，多轮工具调用要回传 `reasoning_content`，Mastra 不回传 → 第二轮 400。现在 Agent 请求统一带 `thinking:{type:"disabled"}`（`src/ai/llm.ts` 的 `mastraProviderOptions`）。
- 在服务器（docker compose）上：镜像里没有 tsc、test/ 和这个脚本，整套预检在开发机的仓库里跑；服务器上只验 Key：`cd deploy && docker compose exec backend node dist/scripts/ai-check.js`（改了 deploy/.env 要先 `docker compose up -d backend` 让新 Key 生效）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 空 | **必填才开 AI**：Agent、夜间/周报、讲解生成 |
| `DASHSCOPE_API_KEY` | 空 | 通义千问（核对讲解用的第二个模型）；`ai:explain` 需要两个 Key 都有 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | |
| `DEEPSEEK_CHAT_MODEL` | `deepseek-flash` | Agent、追问（旧名 `deepseek-chat` 自动换成 flash + 关思考） |
| `DEEPSEEK_REASONER_MODEL` | `deepseek-flash` | 讲解生成（开思考模式；旧名 `deepseek-reasoner` 自动换） |
| `DASHSCOPE_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | |
| `QWEN_MODEL` | `qwen-max` | 独立解答 + 判等价 / 审证明 |
| `AI_MOCK` | 空 | 设 `1` 时即使有 Key 也走规则版 |
| `AI_TIMEOUT_MS` | `120000` | 单次模型调用超时 |
| `APP_TZ` | `Asia/Shanghai` | 「今天」和定时任务的时区 |
| `JOBS_ENABLED` | `1` | `0` 关闭自动定时任务（仍可 `POST /agent/jobs/{job}/run` 手动跑） |
| `JOB_NIGHTLY_CRON` / `JOB_WEEKLY_CRON` / `JOB_PHASE_CRON` | `0 0 23 * * *` / `0 30 21 * * 0` / `0 10 0 * * *` | 秒 分 时 日 月 周 |
| `PHASE_SPRINT_DAYS` / `PHASE_INTENSIVE_DAYS` | `30` / `180` | 距考试 ≤ 这些天切冲刺 / 强化 |
| `AGENT_MAX_STEPS` | `10` | Agent 单次最多工具步数 |
| `EXPLANATIONS_DIR` | `$ASSETS_DIR/explanations` | 行业专家讲解 `*_expert.jsonl` 所在目录 |
| `REVIEWS_DIR` | `$ASSETS_DIR/reviews` | 讲解核对记录 `explanations_<exam>_<year>.jsonl` 所在目录（只读） |
| `AUDIO_DIR` | `/workspace/kaoyan/data/audio` | 单词发音 mp3 缓存（`<accent>/<word>.mp3`） |
| `AUDIO_UPSTREAM` | `https://dict.youdao.com/dictvoice` | 发音上游 |
| `AUDIO_TIMEOUT_MS` | `8000` | 发音上游超时 |

- **讲解 / 给个思路**（`POST|GET /questions/{id}/explain`、`GET /questions/{id}/hint`）：来源 `source` 优先级 `ai`（已过双模型核对）> `expert`（`/workspace/tiku/explanations/*_expert.jsonl`，「行业专家参考解答（非官方解析）」，文件追加后自动生效）> `official`（questions.solution）> `pending`（讲解「讲解生成中」/ 思路「思路生成中」，不推内容）。**没 Key 时从不输出示例内容**；有 Key 时追问由 AI 以专家/官方讲解为底稿回答。
- **讲解生成**：`npm run ai:explain -- --exam math1 --year 2024 [--ids math1-2024-17] [--force] [--dry-run]`。deepseek-reasoner 以专家/官方讲解为底稿写分步讲解，qwen 独立解答再和题库答案比对（证明题改为逐步审证明），一致才 `published`，否则 `needs_review`（前端显示「这题讲解待核对」）；报告写到 `ai_explain_report_<exam>_<year>.md`。缺任一 Key 直接跳过。
- **讲解预生成**：`npm run gen:explanations -- --dry-run` 先看要生成多少题和估算费用。默认跳过已有专家讲解（`tiku/explanations/*_expert.jsonl`）和只有官方解析的题，dry-run 会分别列出两类各跳过多少；`--include-expert` / `--include-official` 连这些也生成。按现在的题库（集成分支 fc81df6：英一 572 道全有专家讲解，数一 33 道）默认要生成 **0 题**；`--include-expert` 是 605 道、约 **1.44–2.40 美元**（DeepSeek 加通义千问，2026-11-02 dry-run），可选。
- **Agent**（`POST /agent/commands`）：Mastra Agent + deepseek-chat。读工具 getProfile / getWrongQuestions / getAnswerHistory / searchQuestions（按知识点路径 + 年份题号，没用向量）；写工具 updateDailyPlan / addReviewCard / upsertReminder / switchPhase / writeDailyTip，每次写都记 AgentAction 可撤回；不删作答记录和笔记。没 Key 时是规则版（`done.mock = true`）。
- **定时任务**（`GET /agent/jobs`）：每晚 23:00 复盘 + 明日任务、周日 21:30 周报、每天 00:10 阶段检查（只往前切）。同一用户同一天同一任务只跑一次（`job_runs`）。
- **本地验证 AI 路径**：`npm run fake-llm` 起假模型（:4020），再用 `DEEPSEEK_API_KEY=fake DEEPSEEK_BASE_URL=http://127.0.0.1:4020 DASHSCOPE_API_KEY=fake DASHSCOPE_BASE_URL=http://127.0.0.1:4020 DEEPSEEK_REASONER_MODEL=fake-reasoner DEEPSEEK_CHAT_MODEL=fake-chat QWEN_MODEL=fake-qwen PORT=3001 node dist/src/main.js` 起一个后端。假模型写进 `ai_explanations` 的行 `model LIKE 'fake%'`，测完删掉。
- **还是模拟的**：费曼「讲给它听」的转写和判断、TTS。

## 单词

- `npm run import:words -- <ecdict.csv | stardict.db> [--tags ky] [--all] [--limit N] [--dry-run]`，词库是 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT），已下载到 `/workspace/kaoyan/data/ecdict/ecdict.csv`。
- 默认只导 tag 含 `ky`（考研）的约 4800 个；按 word upsert：音标/释义/词性/`frq_rank`（ECDICT 词频排名）用 ECDICT 的，`frequency`（真题出现次数，暂无来源，为 0）、`examples`、学习进度保留，tags 取并集（加 `ecdict`）。「今日新词」按 `frequency DESC, frq_rank ASC NULLS LAST, id` 取，先出常见词。
- `npm run import:vocab`（真题词汇 → words）：ECDICT 路径依次找 `--ecdict` → `ECDICT_CSV` → 本 worktree 的 `data/ecdict/ecdict.csv` → 主仓库（`git rev-parse --git-common-dir`）的 `data/ecdict/ecdict.csv`；都找不到会在开头打 ⚠ 并列出找过的路径。重跑时会给**释义为空**的词补上 ECDICT 释义（音标 / 词性 / `frq_rank` 空的一起补，`needs_definition` 改回 false），已有释义的不覆盖。
- **不放自拟内容**：`examples` 在有真实例句来源（真题原句）或 AI Key 之前为 `null`；原来 12 个示例单词的自拟例句、自拟词频已删除，数据改用 ECDICT（`004_words_ecdict.sql`）。

## 环境说明 / 已知问题

- 本机没有 Docker，apt 源不可用，Postgres 17.11 用的是 npm 包 `@embedded-postgres/linux-x64` 里的二进制（在 `../pg-runtime`），由 `scripts/db.sh` 管理。账号 `kaoyan/kaoyan`。
- **pgvector 没装上**：二进制包不带服务端头文件；源码编译需要 `make`，本机没有且装不了。`002_pgvector.sql` 已写好，装上扩展后再跑 `npm run migrate` 即可。在正式部署机器上建议直接用 `pgvector/pgvector:pg17` 镜像。
- PDF 导出依赖本机 `/usr/bin/google-chrome`（`CHROME_PATH` 可改）和思源宋体（Noto Serif CJK）。

### 单词发音

- `GET /api/v1/words/{id}/audio?accent=us|uk`（默认 us）返回 mp3，**不需要登录**（`<audio src>` 直接用）。第一次从有道 dictvoice 取（type=2 美音 / type=1 英音）存到 `AUDIO_DIR/<accent>/<word>.mp3`，之后只读本地，不再联网；响应头 `X-Audio-Cache: hit|miss`。
- 上游失败返回 502 JSON `{error:"audio_upstream_failed", fallback:"speech_synthesis", word, accent, …}`，前端改用浏览器 `speechSynthesis`。
- `/words/today` 的每个词带 `audio_url_us` / `audio_url_uk`（相对地址）。
- 预取：`npm run audio:prefetch -- --limit 200 [--accent us|uk|both] [--user <用户名>]`（先取该用户 1 天内到期复习的词，再按新词顺序补足；已缓存的跳过）。
- 缓存不放 `/workspace/tiku`（题库目录对后端只读）。mock 返回 0.4 秒静音 mp3 占位（响应头 `X-Mock-Audio: silent-placeholder`），`?__status=502` 模拟上游失败。

### 讲解核对（verified）

- 来源：`$REVIEWS_DIR`（默认 `$ASSETS_DIR/reviews`）下的 `explanations_<exam>_<year>.jsonl`，只读，改了自动重读（按 mtime+大小）。
- 兼容两种格式：`{id, kind, result, by, note, at}`（2023）和 `{id, verdict, category?, by, at, note?}`（2024，没有 kind）。结果取 `result || verdict`，`pass` / `pass_minor` = 已核对，`fail` = 未通过。kind 可写 `official_solution` / `expert` / `expert_explanation` 等；没写时，题目有专家讲解且没有官方解析就当 expert，否则当 official_solution。
- 同一 (id, kind) 取 `at` 最晚的一条（`parseAt`，不带时区的按太平洋时间，DST 安全，在 `src/common/time.ts`）。
- explain（meta + done）、hint、`GET /questions/{id}` 的 `explanation`、`/wrong-questions` 的 `explanation` 都带 `verified`（另有 `review`：最新那条的 verdict/by/at/note）。错题 PDF 附讲解时标「· 已核对 / · 未核对」。
- 出处文字：官方解析已核对「官方解析」，未核对或没通过「官方解析（未核对）」；专家讲解一律「行业专家参考解答（非官方解析）」，另看 `verified`。优先级仍是 expert > official（官方解析没通过但有专家讲解的题直接给专家讲解）。

### 分值与自评计分

- 导入时（只改入库副本，题库 JSON 不动）：**证明题**（任一小问是证明 / 整题是证明，按 type、题干、小问题干、答案「证明题…」判断；现在是 2023-20、2024-19）不拆分，小问分值留 null，`score_by_whole=true`；**计算题**缺的小问分值按整题平均拆（0.5 取整），小问 `score_estimated=true`，题目 `score_estimated=true`。
- `/questions`、`/wrong-questions` 返回 `score_estimated`、`score_by_whole`（小问上也有 `score_estimated`）。前端在估算分值旁标「估」。
- 自评计分（`POST /answers` 与交卷一致）：全对 `full` = 满分，思路对但算错 `approach_ok_calc_wrong` = 一半，没思路 `no_idea` = 0。作答记录多了 `points` / `max_points`。计算题可按小问自评（带 `sub_number`，按小问分值算）；证明题只按整题，带 `sub_number` 会被忽略（`sub_number_ignored: true`）。
- 交卷 `self_ratings` 的值可以是一个自评（整题），也可以是计算题的 `{"1":"full","2":"approach_ok_calc_wrong"}`（结果 `per_question[].sub_scores`）；证明题按小问给返回 400。
