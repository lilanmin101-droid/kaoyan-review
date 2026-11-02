# 考研复习项目 · 交接文档（HANDOFF）

> **最后更新：2026-11-02 12:11（北京时间，UTC+8）** · 写给零上下文的新接手 agent，换了机器也能用
> 仓库：<https://github.com/lilanmin101-droid/kaoyan-review>（私有，分支 `main`）· 写这份文档时的 HEAD：`6158cf6`（不含本文）
> 本文所有事实都来自仓库文件、运行中的服务和 git 记录；查不到的标了 **【未核实】**。和代码冲突时以代码为准，并顺手把本文改对。

---

## 0. 先看这 10 条（TL;DR）

1. 产品：给 Tony 个人用的**考研复习 Web 应用**，不商用，电脑和手机都要能用（目标是 PWA，能加到主屏）。题库是**数学一和英语一 2015–2025 年真题**，22 套全部入库并核对完。
2. **重中之重是内置的 AI 教练 Agent**。Tony 的原话：「内置的那个agent一定要好好做！」
3. 技术栈：前端 Vue 3 + Vite（`frontend/`）；后端 NestJS 11 + PostgreSQL 17 + Mastra Agent（`backend/`）；题库 JSON 放在 `tiku/`；部署用 Docker Compose + Caddy（`deploy/`）。
4. 本机端口：前端预览 `:4173`；后端 `:3000/api/v1`；Mock `:4010/api/v1`；PG `:5432`，嵌入式，**本机没装 pgvector**。
5. **还没拿到 API key**：DeepSeek 和通义千问都缺，所以 AI 现在全走规则版（mock），`/health` 显示 `"ai":"mock"`。key 只能请 Tony 在**私聊**里发，绝不能在群里发。
6. **还没有部署服务器**：拿到后在 `deploy/` 下运行 `./deploy.sh user@host`。
7. 模型名**不要写死**。key 到手后先调一次 `GET {base}/models`，用实际返回的名字定默认模型。代码里的 `deepseek-flash` 是推测，**【未核实】**。
8. 团队本来是 6 个 agent 在群里协作，现在由你一个人承担全部角色，详见 §3。协作看板是 `BOARD.md`，只追加、不改旧行，每完成一项记一行。
9. 提交规则：在 `/workspace/kaoyan` 里用**一句中文说明**提交到 `main`。**不准 force push**，不准提交 `.env`、key 或原卷 PDF。
10. 未完成事项按优先级列在 §8.3。最重要的几项：PWA v4 已通过（等 HTTPS 真机）；离线题包和墙钟模考已上线；key 到手后下一步是**真模型验证**（先 `npm run key:preflight`，再实测几次 Agent 和批改），**不是批量生成讲解**：按现在的题库默认 `gen:explanations` 要生成 0 题，`--include-expert`（605 道，约 1.44–2.40 美元）可选，见 §7.4；部署。

---

## 1. 项目一句话与目标

**一句话**：Tony 个人非商用的考研复习 Web/PWA。电脑和手机都能用，可以加到主屏。覆盖数一和英一近 11 年（2015–2025）真题，功能有刷题、整卷模考、错题本、单词、AI 教练、讲解和批改。

| 目标 | 说明 |
|---|---|
| 质量 | 按大厂水准打磨：交互细节、边界状态（断网、5xx、409、刷新、凌晨跨日）都要处理好，每轮由「用户」角色在 1280 和 390 两个宽度下复测 |
| 风格 | 纸张和朱批风格，不能有「AI 感」。Tony 定的方向是**墨绿主色 + 朱红批注**。**实际代码**（`frontend/src/style.css`）现在的色板是：`--lv:#2F4F3F` 墨绿（导航选中、主要操作、选中态、进度条）、`--desk:#EDE7DA` 桌面底、`--paper:#FBF8F1` 纸、`--ink:#22201C` 墨、`--sub:#8A8376`、`--hair:#DED6C6` 细线、`--zhu:#A8382A` 朱红。字体：正文 Source Han Serif SC / Noto Serif CJK SC，界面 Noto Sans CJK SC，大号数字 Cormorant Garamond，依赖里有 lxgw-wenkai-webfont。朱红**只用于批改、错误和需要动手的地方**（统筹者定），提示类文字用灰色小字 |
| 重点 | **内置 AI 教练 Agent**，要做到懂你、主动、能动手、会教（§7） |
| 范围 | 数学一（150 分、180 分钟）、英语一（100 分、180 分钟、52 题）。题库 2015–2025 年，共 22 套、820 题 |

页面标题是「研习 · 考研复习」（`frontend/index.html`，`lang=zh-CN translate=no`）。

---

## 2. Tony 的工作偏好（必须遵守）

- **主动决策**：带着做好的决定和成品去找他，**不要把设计问题、取舍问题抛给他**。自己想清楚，选一个方案做完，再告诉他结果。
- **只向他要只有他能给的东西**：API key、账号、钱、服务器。
- **团队不停工**：回答进度时不能让人觉得工作停了，等他的东西时也照常推进别的事。
- **API key 只能在私聊里发，绝不能在群里发**。key 只写进 `backend/.env` 或 `deploy/.env`，这两个文件不进 git。
- **所有沟通都用中文**。时区是 **Asia/Shanghai**，对他说的时间一律用北京时间并注明。注意：BOARD 里很多旧记录用的是太平洋时间（`-08:00` 或「PT」），watcher 日志也是 PT，引用时要换算。
- 他希望交接文档在每个里程碑都更新。额度快用完时要把文档定稿，方便换到别的 agent 接着做。写这份文档时，本周额度已用 76%，**2026-11-04（周三）21:28（北京时间）重置**。
- GitHub 账号是 `lilanmin101-droid`。

---

## 3. 团队与分工（原群聊「考研复习多端项目」）

| 角色 | 原职责 | 你独自接手时怎么做 |
|---|---|---|
| **统筹者** | 排期、拍板取舍、汇总给 Tony、统一建仓和推送 | 每轮先看 BOARD 和 §8.3 待办，自己定优先级；所有裁定写进 BOARD 变更记录 |
| **前端** | Vue 3 页面、PWA、e2e 截图自测 | 改完要在 1280 和 390 两个宽度下跑对应的 `frontend/e2e/e2e*.mjs`，然后 `npm run build`。preview 服务读的是 dist，不重新 build 就看不到改动 |
| **后端** | NestJS 接口、迁移、Agent、定时任务、部署套件 | 改了接口要同步改 `openapi.yaml` 和 `mock/server.js`，然后跑单测、smoke 和 eval，全绿后才重启 :3000。重启前先确认进行中的考试不受影响 |
| **行业专家** | 知识点树、讲解合格标准、eval 用例、数学大题核对、专家讲解 | 新的教练行为先写成 `backend/eval/agent_cases.jsonl` 里的用例，再改实现；讲解标准见 `tiku/explanation_review_standard*.md` |
| **用户**（模拟考生） | 以考生视角试用、复测，记录写在 `user-test/roundN/` | 每改完一批，自己用真实流程走一遍（新注册账号，用 `X-Debug-Now` 拨时间），记录写进 `user-test/round9/` 或新开 round10 |
| **资料/仓库搜索者** | 题库清洗、`tiku/pipeline/*.py`、来源考证、词汇 | **只有这个角色改题目 JSON**，其他人的核对结论都追加到 `tiku/reviews/*.jsonl` |

协作规则（BOARD.md 开头）：
- 接口以 `backend/openapi.yaml` 为准，题目格式以 `tiku/question_schema_draft.json` 为准，知识点以 `tiku/knowledge_tree.json` 为准。
- 改共享格式前先说明，改完在 BOARD「变更记录」追加一行。
- 争议由统筹者拍板。

---

## 4. 技术栈、目录与本地启动

### 4.1 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3.5、Vite 8、TypeScript、KaTeX 0.19、markdown-it + texmath、pinia、@vueuse/core、puppeteer-core（e2e）。**路由是在 `App.vue` 里手写的 hash 路由**，没用 vue-router（vue-router 虽然在依赖里，但没用上） |
| 后端 | NestJS 11、pg 8、@mastra/core（Agent）、zod 4、ts-fsrs 6（间隔复习）、@nestjs/schedule + cron、puppeteer-core + 本机 Chrome（导出 PDF）、bcryptjs + JWT |
| DB | PostgreSQL 17.11。本机用 npm 包 `@embedded-postgres/linux-x64` 的二进制（放在 `pg-runtime/`，数据目录 `pgdata/`，由 `backend/scripts/db.sh` 管理，开发账号 kaoyan/kaoyan）。生产用 `pgvector/pgvector:pg17` 镜像 |
| AI | DeepSeek（主模型：Agent 工具调用、讲解生成、批改主评）+ 通义千问 DashScope（交叉校验和复评），都走 OpenAI 兼容接口 |
| 部署 | Docker Compose（db / migrate / backend / web(Caddy) / backup / import）+ Caddy 自动 HTTPS |

### 4.2 目录（仓库根 = `/workspace/kaoyan`）

| 路径 | 内容 |
|---|---|
| `BOARD.md` | 协作看板 + 变更记录（项目历史最全的地方，约 250 行） |
| `HANDOFF.md` | 本文 |
| `backend/src/` | 按模块分：`auth`（注册登录、/me/settings、/me/stats）、`questions`（题目、hint、explain SSE、passages、reference_answer）、`answers`（作答只追加、AI 批改 grading）、`exams`（模考、计时、自评、成绩汇总、PDF 报告、self-grade-check）、`wrong-questions`（错题本、PDF）、`words`（今日单词、FSRS、发音缓存）、`plans` `checkins`、`agent`（命令栏、工具、撤回、jobs、proposal、coach-answers）、`ai`（llm.ts 接入和 /models 预检、explain、explanation-gen 预生成、专家讲解、讲解核对、cloze-recurrence）、`english`（英一规格、AI 批改器）、`common`（time.ts 学习日、user-time.service、render.interceptor 日期占位符渲染、grading 计分、http-error.filter 统一错误）、`mastery` `feynman` `sync` `events` `db` |
| `backend/migrations/` | 纯 SQL 迁移 `001`–`022`，没有 016。本机已执行到 `022_command_study_day.sql`（`schema_migrations` 表） |
| `backend/scripts/` | db.sh、migrate、import-questions/vocab/words、gen-explanations、ai-check/ai-explain、eval-agent、eval-grading、test-unit、smoke.sh、test-sources.sh、test-english1、repro-*.sh、watch-tiku.js、migrate-dates |
| `backend/eval/` | `agent_cases.jsonl`（专家写的教练用例 38 条）、`grading_cases.jsonl`（批改用例 20 条：翻译 10、小作文 5、大作文 5）、`report-*.md/json`（文件名里是 UTC 时间） |
| `backend/mock/server.js` | 按 openapi 的 example 返回的 Mock 服务，前端联调用 |
| `backend/openapi.yaml` | 接口契约，约 6000 行，60 个操作（§4.5） |
| `backend/import_reports/` | 每卷导入报告、`watch.log`、`watch_last.md`（自动导入汇总表） |
| `backend/test/fake-llm.js` | 本地假 LLM（:4020），没 key 时验证 AI 路径用 |
| `frontend/src/` | `App.vue`（导航、hash 路由、考试进行中横条）、`Login.vue`、`pages/`（Today 今日、Quiz 刷题、English 英一练习、Exam 考场/自评/成绩、Words 单词、Wrong 错题本、Me 我的）、`components/`（EnPaper 英语整卷、ExamCard 整卷模考卡、Errata 勘误）、`lib/`（api.ts、tap.ts 统一点按层、tex.ts、passage.ts、draghint.ts、toast.ts）、`style.css` |
| `frontend/e2e/` | puppeteer 端到端脚本（`e2e.mjs`、`e2e2`–`e2e53`、`e2e-fig.mjs`）和宽公式扫描 `find-wide.mjs`。在 `frontend/` 下用法：`node e2e/e2eNN.mjs <宽度>` |
| `tiku/` | 题库（§5）。`/workspace/tiku` 是指向这里的**软链接**，**不能删**：编译后的后端和各种脚本里还写着旧路径，后端日志显示 `assets: /workspace/tiku` |
| `deploy/` | docker-compose.yml、deploy.sh、server-up.sh、smoke-remote.sh、backup*.sh、Caddyfile、web*.Dockerfile、README.md |
| `data/ecdict/` | ECDICT 词库 csv，约 63 MB，**不进 git**，换机器要从 <https://github.com/skywind3000/ECDICT>（MIT）重新下载 |
| `data/audio/` | 单词发音 mp3 缓存，不进 git |
| `user-test/round2..9/` | 模拟考生的测试记录和截图（最新是 round9） |
| `pgdata/` `pg-runtime/` `pg-build/` `pglogs/` `tmp/` | 本机嵌入式 PG 的数据和二进制，不进 git |

### 4.3 本机怎么启动（写文档时都在运行）

| 服务 | 端口 | 启动命令（在对应目录下） | 备注 |
|---|---|---|---|
| PostgreSQL 17 | 5432 | `cd backend && npm run db:start`（首次：`npm run db:init`） | 嵌入式二进制；`npm run db:stop` / `bash scripts/db.sh psql` |
| 后端 | 3000，`/api/v1` | `cd backend && npm run build && nohup npm start > server.log 2>&1 &` | 读 `backend/.env`；健康检查 `curl localhost:3000/api/v1/health` |
| Mock | 4010，`/api/v1` | `cd backend && nohup npm run mock > mock.log 2>&1 &` | 改了 openapi 要重启 |
| 前端预览 | 4173 | `cd frontend && npm run build && nohup npx vite preview --port 4173 &` | `vite.config.ts` 把 `/api` 代理到 `API_TARGET`，默认 `http://localhost:3000`。**preview 服务的是 dist**，改代码后要重新 build；开发时也可以用 `npm run dev` |
| 题库自动导入 | — | `cd backend && nohup npm run watch:tiku &` | 见 4.4 |

没有进程管理器，进程都是用 nohup 在后台跑的。box 重启后要按上表的顺序（PG → 后端 → mock → 前端 → watcher）重新拉起来。端口 :4999 上是别的角色临时起的假 `/models` 服务，只用于测试，可以忽略。

**换到一台全新的机器**：
1. `git clone` 仓库，然后 `cd backend && npm install && npm run db:init && npm run migrate`。迁移时 pgvector 不可用会自动跳过 `002`。
   - `pg-runtime/` 不在 git 里。`db:init` 现在会自己建目录、写一个最小的 `package.json`（没有它 npm 会装到仓库根），装 `@embedded-postgres/linux-x64`，再手动跑一次它的 postinstall：`cd pg-runtime/node_modules/@embedded-postgres/linux-x64 && node scripts/hydrate-symlinks.js`（还原 lib 软链接；npm 有时不跑 postinstall，不跑的话 initdb 找不到 .so）。旧版 db.sh 没这几步，要手动做。
2. 下载 ECDICT：用 `https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv`（约 63 MB）放到 `data/ecdict/ecdict.csv`；GitHub release 里的 zip 链接现在 404。然后 `npm run build && npm run import:all && npm run import:words -- ../data/ecdict/ecdict.csv --tags ky`，**再**跑 `import-vocab`（真题词汇）。
   - 顺序：先 `import:words` 后 `import-vocab`。以前反过来会撞 `words_word_lower_idx`（vocab 先插了词，ECDICT 再插同词不同大小写就报唯一键冲突）；`be/key-preflight` 分支里 `import-words` 已改成按 `lower(word)` 判重、同批去重，反过来也不报错了，但还是按这个顺序跑。
3. `cp .env.example .env`，把 `JWT_SECRET` 改成随机串，`ASSETS_DIR` 指向仓库的 `tiku/`。
4. 前端：`cd frontend && npm install && npm run build`。
5. 原卷 PDF（`tiku/src/`）不在 git 里，见 §5.6。

### 4.4 题库自动导入（watcher）

`backend/scripts/watch-tiku.js` 监听 `tiku/` 下的题目 JSON、kp_tags、reviews、explanations、vocab 的 `.json` 和 `.jsonl` 文件（`question_schema`、`knowledge_tree`、`.bak` 除外）。有变化就**防抖 5 秒**，然后跑 `npm run import:all`（题库 upsert 加 import-vocab），结果写到：
- `backend/import_reports/watch.log`（追加）和 `watch_last.md`（顶部是按科目/年份的汇总表：题数、文章数、confirmed/pending/suspect 数、问题、✅/❌，后面是完整日志）。时间是 PT。
- `backend/import_reports/import_report_<exam>_<year>.md`（每卷一份）。

**当前状态**：22 卷全部 confirmed。唯一的 ❌ 是 `english1-2024` 第 4 题**没有知识点标签**（错误级，见 `import_report_english1_2024.md`）。math1-2024 另有 9 条 kp_low_confidence 提示。

### 4.5 接口一览（`openapi.yaml`，60 个操作，前缀 `/api/v1`）

| 分组 | 接口 |
|---|---|
| 基础 | `GET /health`（db、pgvector、题数、ai 是否配置）；`POST /auth/register`、`/auth/login`；`GET /auth/me`；`GET/PATCH /me/settings`（目标院校/分数、考试日期、coach_frequency more/normal/less/ask、quiet_hours、timezone；返回 effective）；`GET /me/stats` |
| 题目 | `GET /questions`（默认不含答案，page_size ≤100）、`/questions/years`（`ready` = 可开整卷）、`/questions/{id}`（`include_answer=true` 才带答案和 reference_answer）、`/questions/{id}/hint`、`POST/GET /questions/{id}/explain`（SSE）、`POST …/explain/feedback`；`GET /passages`、`/passages/{id}`；`GET /assets/{path}`（题图，免登录） |
| 作答与批改 | `POST /answers`（单条或批量，client_id 去重，只追加）、`GET /answers`（带 exam/year/question_ids 时每题只返回最新一条）；`GET/POST /answers/{id}/grade`、`…/grade/stream`（SSE） |
| 模考 | `GET /exams`（历史）、`POST /exams`（开考；已有另一场未交卷 → 409）、`GET /exams/active`、`GET /exams/{id}`、`PUT /exams/{id}/progress`（幂等：idempotency_key + client_seq，兼作心跳和暂停）、`POST …/submit`、`…/abandon`、`…/self-ratings`、`GET …/report.pdf` |
| 错题与单词 | `GET /wrong-questions`（status=active/mastered/archived/due/all）、`PATCH /wrong-questions/{id}`、`GET /wrong-questions/export.pdf`；`GET /words/today`、`GET /words/{id}/audio`（免登录）、`POST /words/{id}/review` |
| 计划 | `GET/POST /plans`、`GET /plans/today`、`PATCH /plans/tasks/{id}`、`POST/GET /checkins` |
| 教练 | `POST /agent/commands`（SSE 命令栏）、`GET /agent/actions`（按组）、`POST /agent/actions/{id}/undo`（整组撤回）、`GET /agent/messages`、`POST /agent/messages/{id}/confirm`、`/dismiss`、`/seen`、`GET /agent/jobs`、`POST /agent/jobs/run`（开发用，production 下 404）、`POST /agent/jobs/{job}/run` |
| 其他 | `GET/POST /sync`、`POST /events`、`POST /feynman`（判断结果是模拟的）、`GET /mastery/tree`、`/mastery/profile` |

统一错误格式：`{statusCode, error, message（学生能看懂的中文）, field, code}`，`code` 例如 `already_undone`、`already_decided`、`username_taken`。所有请求都带 `X-Timezone`。开发环境下 `X-Debug-Now` 可以拨时间，生产环境关闭（`DISABLE_DEBUG_NOW=1`）。

---

## 5. 数据与题库

### 5.1 现状

| 科目 | 年份 | 每卷 | 总分/时长 | 状态 |
|---|---|---|---|---|
| 数学一 | 2015–2025 | 2015–2020 年 23 题（8 选择、6 填空、9 解答），2021 年起 22 题（10 选择、6 填空、6 解答） | 150 分 / 180 分钟 | 11 卷共 248 题，全部 confirmed |
| 英语一 | 2015–2025 | 52 题 + 7 篇 passages | 100 分 / 180 分钟 | 11 卷共 572 题，全部 confirmed |

库里共 820 题（`/health` 的 `questions:820`）。单词表 5450 个，其中 ECDICT 考研词（tag ky）4801 个，另外补进了真题词。

### 5.2 来源优先级（长期规则）
**官方原卷扫描件 > 原卷版式重排 > 多个来源多数表决**。原卷上的误印**保持原样**，在题目的 `errata` 字段里写「原卷印作 X，应为 Y」，前端用 `Errata.vue` 显示（例如 english1-2025-14 的 Gallon/Gallou、english1-2025-39 的 replace/replaces）。
- 英一主源是 LIziak112/structured-kaoyan-english，只取题面、答案和配图这一层（自由使用），**不取 explanation 字段**（CC BY-NC）；1–45 题的答案用 Echo1LZJY 交叉核对。2020、2021 年的选项顺序在源里被打乱过，已经按原卷重排（`tiku/src/eng1/supplements/<年>.json` 里的 `option_order`）。翻译参考译文和作文范文**不是官方发布的**，`answer_source: "expert"`，前端标「专家」。
- 数一的源是 TsekaLuk/Kaoyan-Math1-Papers 等，每年都有带文本层的原卷 PDF 作对照。
- 来源说明写在 `tiku/src/eng1/SOURCES.md`。⚠️ 这个文件在 `tiku/src/` 下，**被 .gitignore 排除了，不在仓库里**；而且到写文档时，里面**还没有补 sha256**（统筹者已经让资料/仓库搜索者去补）。建议把它移到 `tiku/SOURCES.md` 再提交（§8.3）。

### 5.3 reviews：核对结论的唯一可信来源
- `tiku/reviews/<exam>_<year>.jsonl`：一行一个 JSON，**只追加，不改旧行**。格式：`{"id":"math1-2024-13","status":"confirmed|pending|suspect","by":"用户","note":"…","at":"2026-11-01T04:20","answer":["…"]?}`。`at` 不带时区时按**太平洋时间**解析。
- 导入时的合并规则：状态取 `at` 最新的一条；note 全部追加；checked_by 取并集；带 `answer` 的最新一条会覆盖题目 JSON 里的答案，报告里记 `answer_overridden_by_review`。坏行只进报告，不会让导入失败。详见 `tiku/reviews/README.md`。
- 讲解核对：`reviews/explanations_<exam>_<year>.jsonl`，`pass` 或 `pass_minor` 算已核对（verified）。
- **题目 JSON 只有资料角色能改**，用 `tiku/pipeline/*.py` 修（`build_eng1.py <年> [--reviews]`、`build_2025.py`、`fix_*.py` 都可以重复运行）。入库前跑 `node tiku/check_questions.mjs`（KaTeX、残字、图片）。

### 5.4 知识点与计分
- 知识点树：`tiku/knowledge_tree.json`（数一 + 英一，三层，144 条路径）。每卷有一个 `<exam>_<year>_kp_tags.json`：`{"tags":{id:[路径…]}, "score_by_whole":[ids], "sub_scores":{id:[分…]}, "sub_scores_note", "evidence"}`。英一完形有 80 题标了「英语/完形填空/上下文复现」，`evidence` 里写明复现的是什么，例如 2019-16 的 breaks 复现了 "gaps in the tree line"。
- **计分方式优先级**（`backend/src/common/grading.ts` 的 `resolveScoreByWhole`）：kp_tags 写了 `score_by_whole=true` → 整题计分；kp_tags 写了 `sub_scores` → 按小问；kp_tags 写了 `score_by_whole=false` → 按小问；题目 JSON 自带 → 照它；都没写 → 自动识别，证明题整题计分。多小问的题**每一问都是证明**才整题计分，混合题按小问分开计分。
- **5 道两问独立证明题**按统筹者的最终口径：恢复 `sub_scores`，按问计分，去掉 score_by_whole（行业专家 2026-11-01T07:41-08:00 的记录）。
- **均分规则**（`backend/scripts/import-questions.ts` 的 `scorePlan`）：缺分值的小问按整题分平均拆，**0.5 取整**，**余数给第 1 问**（代码注释写的是「最后一问补齐」，和实现不一致，以代码为准），标记 `score_estimated=true`，`sub_scores_source=even_split`。行业专家估计的分值标 `estimated`，前端会提示「不是官方分值」。
- 自评换算：`full`（全对）= 满分，`approach_ok_calc_wrong`（思路对、算错）= 一半，`no_idea` = 0。成绩汇总里待自评的分数记为 `pending_points`，例如「还有 N 分待自评」。
- 英一：客观题自动判分（match、ordering 也算客观题）；翻译和作文靠自评或 AI 批改。

### 5.5 讲解来源（优先级）
`ai`（双模型核对通过）> `expert`（`tiku/explanations/*_expert.jsonl`，标「行业专家参考解答（非官方解析）」）> `official`（题目 solution，标「官方解析」或「官方解析（未核对）」）> `pending`（显示「讲解生成中」或「思路生成中」，**不输出任何示例内容**）。专家讲解目前覆盖数一 2017、2019、2020、2021、2023、2024。英语没有官方解析，572 题的讲解要等 key 到手后预生成（§7.4）。
- 行业专家（英一 2015–2019，`tiku/explanations/english1_<y>_expert.jsonl`）：完形讲解里提到别的空一律写（n），中文也不用该空答案的词义或近义词；「本句」译文里英文出现的别空，中文同样写（n）占位（规则 4c）。2015–2019 已人工复扫 100 道完形并修完泄露，`check_cloze_leak.py`（b88dfd1 版）2015–2019 泄露 0、4c 提醒 0。2015 Q21 讲解注明题干原卷写作 Juan Carl，即第1段的 Juan Carlos。 2015–2019 阅读 A 的 300 个干扰项（原 298 个缺英文引文）已全部补逐字英文原句，`rd_distractor_stats.py` 缺引文 0，说话人错位的 7 条改标「张冠李戴」。

**英一专家讲解（状态，行业专家 2026-11-02）**：`tiku/explanations/english1_<2020–2025>_expert.jsonl`，每题一行，字段只有 `id/steps/remember/by/source/verified/at`（`backend/src/ai/expert-explanations.ts` 只读这些，`steps` 是字符串数组，末步是「答案：X」或「参考译文：…」）；参考译文在 `english1_translations_expert.jsonl`。本次修订（分支 `expert/english1-2020-2025-explain-fix`）：① 翻译 46–50 全部 30 句在 `steps` 里补「得分点对应译法」（每句 2–4 个点、合计 2 分，译法与参考译文逐字一致）和「常见误译」（每句 ≥2 条，说明错在哪）；② 完形去掉 2020-19、2024-17、2024-20、2025-16、2025-20 等泄题，并逐题人工复查中文释义泄题，改用原文可见词句作依据；③ 阅读 22 题的干扰项补上错因类型和原文依据（含 2020-24）。答案、定位证据句均未改。**自检**：证据句逐字比对原文（现用 `python3 tiku/pipeline/check_quote_verbatim.py [--root <worktree>/tiku]`，覆盖 2015–2025 阅读 A/新题型 21–45 全部 steps 的英文引文和「第N段…：“…”」段号，exit 0=全过；**引文一律照原卷写 `$`，不要写成 `US$`**）；`python3 tiku/pipeline/check_cloze_leak.py` 必须 exit 0（加强版规则在分支 `tiku/cloze-leak-rule3`，它读 `data/ecdict/ecdict.csv`，**文件不在时会静默报 0 条中文疑似**，跑前先确认该文件存在、疑似条数不是 0）。**坑**：中文释义泄题（用另一空答案的中文意思来讲本空，如“技术和工具进步巨大”泄 techniques）脚本只能列疑似、大量是误报，只能人工逐条判断。 **阅读 A 干扰项（分支 `expert/english1-reading-distractors`，2026-11-02）**：剩余 98 道阅读 A 已逐个错误选项补「错误类型 + 原文逐字引文 + 为什么错」，自检（引文逐字、答案/定位步不变、泄题检查、1c525c3 线索类型检查）全过，待统筹者合并；~~态度题 2020-25、2020-28、2024-38 的干扰项未标错误类型~~（已完成，见下）。 同分支另有一个提交，按用户建议把完形 2021-03 的线索标签改为「逻辑连接（让步）」，2021-12、2025-06 改为「词义辨析」。 **阅读讲解打磨（分支 `expert/english1-reading-polish`，2026-11-02，已完成）**：① 态度题 2020-25/2020-28/2024-38 的 9 个错误选项补标准错因类型（态度相反记作「正反颠倒（态度相反）」）+ 原文逐字引文；② 旧 22 题里缺英文引文的 16 题（2020-24；2021-28/34/36；2022-21/27/32/36；2023-21/31/38/39；2024-22/25；2025-36/40）补逐字依据；③ 引文逐字修正：2025-31/35 的 `US$` 改回原文 `$`，2021-42 按原文引号位置改写，2024-28 把 break 改回原文 broke；④ 段号：脚本对照 2015–2025 全部阅读讲解「第N段…：“…”」与本库分段，0 处不符（2020-29、2025-38 已在步骤里注明题干按原卷分段，2025-38 的说明改清楚了）。新增校验脚本 `tiku/pipeline/check_quote_verbatim.py`（规则：___/（N）空位作通配；中文括注去掉再比；纯中文引号不算英文引文）。**第二轮（同分支，2026-11-02）**：① 统筹者定「张冠李戴」入标准，`tiku/explanation_review_standard_en.md` 改为七类错因表（含与偷换概念的区别、态度题括注细分写法），并写明英文引文必须逐字、提交前跑 `check_quote_verbatim.py`；② 用户复抽四条小改：2020-27 D「作者」→「研究者」（补第1段引文），2021-37 A 点明 anachronism（时代错置），2022-31 D 改标无中生有，2025-06 线索去掉「水下的」；③ 定位句计数口径写进标准（按本库分句；缩写不断句；新题型段首编号和空位不算句、空位前后各自断句、紧挨空位无句末标点的引导语不计），`check_quote_verbatim.py` 增加句号校验。按此口径 2015–2025 阅读/新题型 411 处「第N段第M句」全部吻合，**无需改数字**——上一轮报的新题型句号偏差是临时脚本没处理 U.S./Ms./Karen R./Sackett v. EPA 缩写、编号标题和空位造成的误报。遗留：2015-33、2016-39 定位步嵌套引号不配对，句号脚本取不到引文（人工核对句号正确）。 **第三轮（同分支，2026-11-02，按用户复核 user-test/round10/reading_polish_check_en.md）**：2023-32 D 补第2段逐字引文 “quietly retiring them to their relevant sections”，B 改标张冠李戴（撤书指示是发给门店经理的，PRH 做的是设信用额度，已核原文）并写进标准表作例子；2024-38 D 改成「作者判断其他州不太可能都提供保护」；本分支改过的 29 题 `at` 更新为 2026-11-02T13:04+08:00，`verified` 沿用各题型现有固定写法（阅读 A「答案与复核记录一致；证据句已在原文核对」等，本来就一致，未改）；check_quote_verbatim.py 修掉段号/句号报错时引文条数多算的问题。2020–2025 阅读 A 360 条干扰项：缺类型 0、缺英文引文 0（rd_distractor_stats 与自写脚本一致）。待统筹者定：2015–2019 阅读 A 干扰项多为中文转述无英文引文，是补引文还是在标准里注明适用年份。

### 5.6 词汇与原卷 PDF
- 真题词汇：`tiku/vocab/english1_exam_vocab.json`（2015–2025 年共 4280 个词元，ky 词库覆盖 48.1%），由 `pipeline/build_vocab.py` 生成，后端用 `import:vocab` 导入频次、年份和例句。基础词（basic）默认不进今日新词。规则：**不放自拟内容**，例句只用真题原句，没有就是 null。
- 原卷 PDF 和 OCR 原始材料在 `tiku/src/`（约 137 MB，37 个 PDF）。**不进 git，也不用 LFS**。部署后靠每日备份（`tiku-src-*.tar`）留底。⚠️ 现在**只有这台 box 上有一份**（服务器还没给），换机器前要先打包带走，或者按 SOURCES.md 重新下载。

### 5.7 资料角色现状（资料/仓库搜索者维护，2026-11-02 12:20 北京时间）
- **工作目录**：`/workspace/kaoyan-wt-tiku`（`git worktree`，不在 `/workspace/kaoyan` 里切分支；那份留给后端在 main 上跑服务和 watcher）。提交作者沿用仓库现有的 `lilanmin101-droid` noreply 邮箱，用 `git -c user.name=… -c user.email=… commit`，本机没设全局 git 身份。
- **待合分支**（统筹者已审，等 Tony「可以合」）：
  - `tiku/eng1-2024-04-kp`（`edd1e6a`）：`english1-2024-04` 补「英语/完形填空/词义辨析」+「英语/完形填空/逻辑关系与连接词」（行业专家结论）。合进 main 后 watcher 自动重导，导入报告里 english1-2024 唯一的 ❌ 消失。
  - `tiku/cloze-leak-rule3`：`pipeline/check_cloze_leak.py` 在原有规则 1、2（答案词挨着原文邻词、引号/本句里出现）之外新增：
    - 规则 3：讲解任何位置提到同篇其他空的答案词（4 个字母以上，不是本空选项，原文空外没出现）→ 报错；
    - 规则 4b：引用带别的空（`___`）的英文原句并附（中文译文）→ 报错；
    - 规则 4a：其他空答案的中文释义（讲解里「词“释义”」+ ECDICT）出现在本空讲解 → 只提醒，不影响退出码，误报多，需人工看。
    - 用法：`ECDICT_CSV=/workspace/kaoyan/data/ecdict/ecdict.csv python3 tiku/pipeline/check_cloze_leak.py [年份…]`（ECDICT 不进 git，后端导词库时会下载；不设就只用讲解里的释义）。退出码 1 = 有泄题。
    - 当前结果：报错 3 处（2024-17 suit、2024-20 中文译文、2025-16 中文译文），疑似 43 处，清单 `/workspace/kaoyan-pending/cloze_leak_report.txt`，交行业专家在 `expert/english1-2020-2025-explain-fix` 修。**查不出**：用近义中文暗示答案（如 2025-20 用「说明」暗示 suggesting），只能人工看。
- **原卷 PDF**：换机后 `tiku/src/` 丢失，正在 `/workspace/kaoyan` 里跑 `python3 tiku/pipeline/verify_sources.py --fetch` 按 SOURCES.md 重下并核对 sha256，日志 `/workspace/verify_sources_fetch.log`。脚本的 urllib 下载没设超时，个别站点会卡住，卡住就杀掉重跑（已下的文件会跳过）。
- **规则不变**：题目 JSON 只由资料角色改，用 `tiku/pipeline/*.py`；其他角色的核对结论追加到 `tiku/reviews/*.jsonl`，标签结论交给资料落库。

---

## 6. 关键产品规则与已定裁决（都已落地，除非标了「进行中」）

### 6.1 时间与文案
| 规则 | 细节 |
|---|---|
| **学习日在凌晨 4 点切换** | `common/time.ts` 里 `DAY_START_HOUR=4`，0:00–3:59 还算前一天。统一口径是 `UserTimeService.today()`。影响范围：计划、命令栏、单词、打卡、错题到期、统计、教练、days_to_exam。阶段检查放在 04:10。接口带 `study_date`、`relative_day`、`due_relative_day` |
| 时区 | 优先级：`users.settings.timezone` → `X-Timezone` 头 → `APP_TZ`（默认 Asia/Shanghai）。前端自己不算「今天」 |
| 相对日期文案 | 写成「明天（11-02）」「今天（11-01）」，远一点的日期写「11-02（周一）」。库里存的是 `{{date:YYYY-MM-DD}}` 占位符（`{{date:D|plan}}` 是计划语境），**读的时候**按读者当时的学习日渲染（全局 `RenderInterceptor` + SSE）。日期两边不留空格。已经过去的计划要用过去时，例如「11-05（周四）当天计划做…」。actions 的 before/after 快照也走同一套渲染。存量数据用 `npm run migrate:dates` 转过 |
| 引号 | 外层「」，里层『』，不允许第三层 |
| 凌晨提示 | 「凌晨 4 点前还算 MM-DD 这一天」只在 0–4 点、**每个学习日第一条**涉及今天/明天/昨天的回复里说一次（`users.early_note_day`）。晚间复盘已经说过就不再说 |

### 6.2 教练指令
| 规则 | 细节 |
|---|---|
| 去重 | 键 = 用户 + 意图 + 日期 + 任务（类型 + 目标/数量）。**只在同一学习日内、60 秒以内生效**，时间按 `X-Debug-Now` 之后的「现在」算；换了学习日，同一句话一定重新执行。重复时回复「N 秒前说过同样的话…这次没有重复执行。还要再加的话，回『确认再加 3 道』」，`done.deduped=true`。只有数据没变才算重复（`state_fp`） |
| 数量 | 照用户说的来：「一道」=1、「两道」=2，数字原样用，没说数量默认 3。**带「加/再/多」= 在现有基础上递增**；**只给数字**（「今天重做 5 道」）= 设成这个数，和现有数量一样就是「已经有了」（coach-31..36） |
| 问题不当指令 | 「那今天的单词还背吗」「今天还要做什么」「错题还剩几道」「离考试还有几天」「我这周进度怎么样」都用真实数据**直接回答**，`actions=[]`，计划不动。`done.question_kind` 取 words/todo/wrong_left/exam_days/week，前端据此不显示撤销（`agent/coach-answers.ts`） |
| 含糊指令 | 例如「帮我调一下」，先问一个问题，不改计划（coach-11） |
| 执行和说的不一致 | 比如没有错题、不够 N 道、日期已过、超过 20 道，回复末尾用一句话说明；没有错题就按说的数量排基础题 |

### 6.3 教练标准（懂你 / 主动 / 能动手 / 会教）
- **每条建议都带证据**（数据来源、错题、正确率），**一次只给一条最重要的动作**（headline），细节折叠在 details 里。「教练说」一次只显示一句，优先级：今日一句 > 昨晚复盘 > 周报。
- **被忽略就降频**：说「别管我」或连续 2 天没看 → 降频，可撤回。因为没看而降的，再看就恢复。**从不升级打扰**。coach_frequency 取 more（多一条 12:30 午间提醒）/ normal / less（每 3 天复盘一次）/ ask（只发 proposal，确认后才执行）。免打扰时段里的消息排到时段结束再送。
- **手滑记粗心**：「这题我会，是手滑」→ `markCareless`，`error_type=careless`，掌握度不降，可撤回。
- **只加和改，不删**：不删作答记录（`answer_records` 有触发器，禁止 UPDATE 和 DELETE）和笔记。「把错题本全删了」要拒绝或改成别的做法（coach-13）。
- **所有写操作都进 `agent_actions`**（summary、reason、target、before/after），**按组撤回**：一次命令、一次确认的建议或一次定时任务算一组，撤回任意一条都会在一个事务里倒序撤回整组；第二次撤回返回 409 `already_undone`。
- proposal（ask 模式）：每次运行都新建一条，已确认或已忽略的永远不再改，每条只能确认一次（重复确认 409 `already_decided`）。今天已经建议过、确认过或目标日计划里已有的不再提（`proposal_skipped_reason`）。**过期建议失效**：后端和前端正在做，前端已提交 `bc913e1`「建议卡支持已过期状态」，后端改动还没提交（§8.2）。

### 6.4 模考
| 规则 | 细节 |
|---|---|
| 入口 | **电脑顶栏**有「模考」（今日、刷题、模考、单词、错题本、我的）。**手机底栏固定 5 个**（今日、刷题、单词、错题本、我的），入口是「刷题」页最上面的**「整卷模考」卡**：年份用小标签选，**点年份只选中**，按「开考 · 2018 英语一」才开考。卡上写「180 分钟 · 满分 100/150」 |
| 考试条 | 有未交卷的考试时，除考场外每页顶部挂「考试进行中 · 标题 · 剩 xx 分钟 · 继续」（暂停时显示「· 已暂停」）。分钟数**向下取整**，按秒倒计时，和考场共用 `/exams/active` 的 `remaining_seconds` 加本地时钟 |
| 开考与继续 | 都走 `#/exam/go`，**直接进考场**。只有开考返回 **409**（另一场没交卷）时，才出「还没交卷」页，写明「你刚才点的是 X，先把 Y 接着做完，或者放弃它」 |
| 接回重试 | 遇到 5xx 或断网时退避重试 3 次，期间显示「正在接回考场…」，还不行就显示「暂时没接上考场 · 再试一次」。**任何情况都不能退回开考表单** |
| 计时（墙上时钟，后端 `6fe6937`/`5475478`，前端 `5562726`/`afa0412`） | **已用 = 现在 − 开考 − 暂停时长 − 服务器容错**。服务器容错只补两段：后端停机超过 30 秒的那段、返回 5xx 的那段（`server_credit_seconds`）；**学生自己断网、锁屏、切走都不补**。旧的「两次保存最多计 120 秒」已取消，心跳只用来同步答案。前端记截止时间，每秒用「截止 − 现在」算剩余，切回前台先按本机时钟重算再以服务端 `remaining_seconds` 为准。断网时答案本机排队，联网后补交；刷新或重开回到同一场。整卷、自定义模考、小测同一套规则 |
| 时间到 | 按**最后一次同步的答案**自动交卷，`submitted_at` = 到点那一刻，`auto_submitted:true`。之后心跳、作答、交卷、暂停、放弃都返回 **409 `{code:'exam_auto_submitted', exam_id, status:'submitted'}`**；前端提示「时间到了，已经自动交卷」并跳成绩页 |
| 字段与接口 | 考试对象：`pause_count`、`paused_seconds`、`server_credit_seconds`、`auto_submitted`、`clock:'wall'`、`remaining_seconds`（每次读取/心跳实时算）、`paused_at`（暂停中才有，否则 null）、`non_continuous`；result 上也有 `pause_count`、`paused_seconds`、`auto_submitted`、`non_continuous`。`POST /exams/{id}/pause`、`POST /exams/{id}/resume`，次数不限，重复 pause / 未暂停 resume 不重复计数；心跳带 `state=paused/running` 也记入暂停日志。用户第 11 轮接口复测 A–D 全过（`api_retest11.md`），界面复测通过（s01–s03） |
| 暂停规则 | 暂停时遮住题目。**累计暂停 > 15 分钟 → `non_continuous:true`**（跨 04:00 学习日不再触发，openapi 和代码都已去掉）（行业专家把门槛从 30 收到 15）：成绩页写「中途暂停较久，这次不计入模考趋势」，「考过的」列表标「不计入趋势」，分数和错题照常保留，趋势线和预测分排除。暂停旁提示「已暂停 N 分钟，超过 15 分钟这场就不算进趋势了」，10 分钟弹一次提醒，超 15 变红，继续后顶栏显示「停过 N 分」（前端 `0664652`）。**暂停挂超过 24 小时，按暂停前那一刻自动交卷**。成绩页「中途暂停 N 次，共 M 分钟」（向上取整）。**后端已提交 `15c55a8`**（`GET /exams?trend=1` 只返回计入趋势的场次，24 小时自动交卷带 `auto_submit_reason`，详情和列表带 `paused_at`/`exam_name`/`submitted_date`）。**用户第 10 轮接口复测 10 项过 9 项**（`user-test/round10/api_retest10.md`）：唯一没过的是 `GET /exams/:id` 详情缺 `exam_name`，后端在 `be/key-preflight` 补 |
| 模考趋势图 | 「考过的」页顶部，按科目切换（前端 `fe1c0ec`）：朱笔实心点细线连接，`non_continuous` 场次画空心点、不连线；下一行「按最近 3 次连续作答估：约 N 分」；点任一点进那场成绩。数据直接用 `/exams` 列表 |
| 误开放弃 | **开考 2 分钟内一道没答就放弃 → 整场删除**，不进历史、统计、错题和教练数据，返回 `{discarded:true}`（`DISCARD_WINDOW_SECONDS=120`）。**进行中：后端已写好，还没提交** |
| 成绩页 | 有分题型、分科（高数/线代/概率）、丢分知识点前 5、教练一句话、逐题对照（按钮「逐题对照答案（52 题）▾」；有待自评的题时默认展开）、导出 PDF、地址 `#/exam/<id>/result` |

### 6.4.1 离线题包（后端 `7fe2c67` 已上线 :3000，openapi 已推）
- **拉包**：`GET /api/v1/offline/pack?since_version=`，没变返回 **304**（前端继续用旧包）。内容：今日任务里那篇阅读和完形 + **10 道错题重做**（`origin:'wrong_redo'`）+ 今天要背的单词；带题干、选项、答案、讲解、图片地址和版本号。**每天 04:00 换包**。不出新题，**不缓存模考，不缓存全题库**。
- **讲解**：`explanation` 是**对象** `{source, source_label, verified, steps}`，纯文本解析在 `solution`。每题带 `explanation_status:'ready'|'pending'`；英语题现在都是 `pending`（讲解要等 key 跑 gen:explanations），界面写「讲解还没出」；数学 248 道离线可看全。
- **离线作答**：刷题页切到题包，「对答案」本地判对错、看解析；教练点评和学习记录等补传后更新。
- **补传**：走现有单题作答接口 `POST /answers`，**逐条串行**，每条带 `client_id`、`answered_at`、`source:'offline_pack'`、`pack_version`，有用时再带 `time_spent_seconds`（`local_correct` 不传，后端判分）。重复提交返回 `duplicate:true`，不重复计分。**不开 `/answers/batch`，也不开 `/today/pack`**（曾有草案，已作废）。`answered_at` 早于 7 天或晚于现在会被截断，响应里 `answered_at_clamped` 说明原因。按作答时间计入当天。
- **重试**：网络错误和 5xx 退避重试（2 秒起翻倍，最长 5 分钟）；201 且 `status:'rejected'` 直接丢弃并记日志；400 不重试。
- **前端进度**：`0664652`/`40bfa41` 已切新路径，但**还要按后端 4 点修正**：① `explanation` 按对象解析；② 错题重做 `origin` 是 `'wrong_redo'` 不是 `'wrong'`；③ 按响应处理 rejected / 400 / 5xx；④ 带 `time_spent_seconds`，不传 `local_correct`。改完后用户做浏览器测试：打开 `#/quiz`，断网刷 5 道题，联网后核对补传、计分和错题本。

### 6.5 自评（英一翻译和作文，数一解答题）
- **没作答的题**：不出自评选项，题卡上写「没作答，记 0 分」，交卷时直接记 0（后端 `unanswered=true`）。
- **字数线**（`exams/self-grade-check.ts`）：小作文 < 50 词、大作文 < 80 词、翻译 < 参考译文字数的 30%（中文按汉字数加英文词数算）。这时选「基本到位」或「大概一半」会先问「只写了 N 个字，确定按『基本到位』算？」。学生坚持就照记，题卡和成绩页标「自评·字数不足」（后端 `self_grade_flags:["word_count_low"]`，存在库里，换设备也能看到）。有 key 以后，AI 批改分和自评分并排显示，**以学生选的为准**。
- 自评按钮**按题目 id 绑定**，不按位置绑定。数一的计算题按小问自评，证明题只能整题自评，交卷后也能补评或改评。
- 「去自评」直接滚到对应那题并高亮 2 秒。今日页顶部有「XX 还有 N 分待自评 · 去自评」卡。全站文案统一用「待自评」。
- **前端：自评页回填**（`frontend/src/pages/Exam.vue` 的 `fromServer`）：打开已交卷的考试（换设备、刷新、从今日卡或成绩页进 `#/exam/<id>/rate`）时，已评档位从后端 `result.per_question` 回填——整题读 `self_rating`（只有一问的读 `sub_scores[0]`），计算题按小问读 `sub_scores[].self_rating`；题卡「自评·字数不足」以后端 `self_grade_flags` 为准并写回本机 `exam:short:<id>`，后端没给这个字段的题才用本机记录，和成绩页一致。补评时回填的档位一起提交，不会丢。回归脚本 e2e54：先自己注册测试号、token 写到 `/tmp/fe-tok`，在 `frontend/` 下 `node e2e/e2e54-setup.mjs` 造数（打印英一、数一两个考试 id），再 `E2E_EXAM=<id> [E2E_MATH=<id>] node e2e/e2e54.mjs <宽度>`（默认打 :4180 preview，API_TARGET=:3000）。

### 6.6 导航与其他
- `#/`、空 hash、未知地址**一律进「今日」页，不做任何自动跳转**。
- 错题本：做错自动进错题本，错因可以改（概念、计算、审题、方法、粗心）。点「已掌握，移出」后 `status=mastered`，至少 1 天后到期，进入复习（`status=due` 筛选，FSRS 卡片），放在页面底部的折叠区，可以放回。后来做对了的题会标出来。
- 单词：显示「今日第 n / 总数」，分母当天第一次请求时冻结（`scheduled_today`），刷新不会变；有真题频次、年份、例句和「看原文」跳转；发音用有道 dictvoice，缓存到本地，失败就退回浏览器朗读。
- 点按：统一用 `lib/tap.ts`，按下就有反馈，以按下的元素为准，点击区域 ≥40px。宽公式可以横向滑动，第一次出现时用**灰色小字**提示「← 公式较宽，可左右拖动」。
- 手机上英一新题型的 A–G 默认收成一行一句（刷题页和考场都是）；完形点空位会就地弹出选项，桌面上也可以按 A–D 键。

---

## 7. AI / Agent 架构

### 7.1 设计（`backend/agent-architecture.md`，加上现在的实现）
- `POST /agent/commands` 是 SSE，事件有 step、action、done（`reply`、`action_count`、`deduped`、`question_kind`、`mock`）。实现是 Mastra Agent + DeepSeek function calling，单次最多 10 步（`AGENT_MAX_STEPS`）。**没 key 时走规则版**（`done.mock=true`），行为和接口形状保持一致。
- 工具（`agent/mastra-tools.ts`）：只读的有 `getProfile`、`getWrongQuestions`（支持按做错日期筛 `wrong_from`/`wrong_to`）、`getAnswerHistory`、`searchQuestions`（按知识点路径 + 年份题号，**没用向量**）；写的有 `updateDailyPlan`、`addReviewCard`、`upsertReminder`、`switchPhase`、`writeDailyTip`、`markCareless`、`setProactive`。写操作全部记 `agent_actions`，可撤回。
- 记忆（学习档案）：`mastery`、`error_profile`（四类错因）、`reminders`（下次记住）、`habits`（时段效率）、`goals`/phase（foundation/intensive/sprint）、`agent_actions`、`users.settings`。
- **架构文档里规划了但还没实现**：`generateVariant`（变式题）、`buildMockExam`（考前 30 天专属卷）、`synthesizeAudioReview`（TTS）。费曼「讲给它听」的判断目前是模拟的。
- 定时任务（`agent/jobs.service.ts`）：每小时触发一次，再按每个用户自己的时区挑出到点的用户。`nightly` 23:00 复盘并生成明日任务；`weekly` 周日 21:30 周报；`phase_check` 04:10；`midday` 12:30（只发给 more 的用户）。同一用户同一天同一任务只跑一次（`job_runs`），`JOBS_ENABLED=0` 可以关。

### 7.2 模型
- DeepSeek 是主模型，通义千问用来交叉校验。讲解生成时 DeepSeek 写，千问独立解题再比对，一致才发布，否则标「这题讲解待核对」。AI 批改时 DeepSeek 主评、千问复评，分歧（作文 >1 档、翻译 >1 分）标「批改待核对」。
- 环境变量（`backend/.env.example`）：`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_CHAT_MODEL`、`DEEPSEEK_REASONER_MODEL`、`DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`、`QWEN_MODEL`、`AI_MOCK`、`AI_TIMEOUT_MS`、`EXPLAIN_ON_DEMAND` 等。
- ⚠️ **模型名不要靠记忆**：`.env.example`、`llm.ts` 和 deploy README 都写着「2026-07-24 起 deepseek-chat/deepseek-reasoner 下线，改用 deepseek-flash」，这是**没有验证过的说法**。统筹者的裁定：key 一到，**先调一次 `GET {base}/models`，以实际返回的名字为准**，再定默认模型和旧名映射。`llm.ts` 里已经有启动预检，`gen:explanations` 开始前也会预检：列表里没有配置的名字就自动换一个，并在日志里打 ⚠。接上 key 后先看日志确认。
- 接上 key 后还要确认：DeepSeek 新模型的思考模式加工具调用，多轮时要回传 `reasoning_content`，不回传会报 400。发一条教练消息，看后端日志里有没有 400。
- 没 key 时自测 AI 路径：`npm run fake-llm`（:4020）配合 README 里那串环境变量，另起一个 :3001 后端；或者 `AI_FAKE=1`。

### 7.3 评测
| 命令 | 内容 | 最新结果 |
|---|---|---|
| `npm run eval:agent` | 单测 + 内置用例（在 America/Los_Angeles 和 Asia/Shanghai 两个时区各跑一遍）+ 专家用例 `eval/agent_cases.jsonl`（38 条，coach-01..38，支持 `turns` 多轮），报告写到 `eval/report-*.md`。有一条不过就 exit 1，`--strict` 时专家用例也计入 | `report-2026-11-01T16-46-33`（北京时间 11-02 00:46）：**单测 199/199，内置断言 406/0，专家用例自动断言 62/0，另有 108 条待人工打分**，coach-38 7/7 |
| `npm run eval:grading` | 批改用例 `eval/grading_cases.jsonl` 20 条，两个模型分别批改，再和专家期望比对。没 key 时 skipped，`AI_FAKE=1` 时用假模型 | 只有假模型的自检（`grading-report-2026-11-01T15-39-35`），**数字不代表真实质量**。key 到手后要用真模型跑一遍 |
| `npm run test:unit` / `test:tools` / `test:sources` / `test:smoke` / `test:english1` | 单测 / Agent 写工具加撤回（TOOLS OK）/ 讲解来源（SOURCES OK）/ 主流程 curl（ALL OK）/ 英一 | 后端第 12 轮（`2c68743`）报告全绿 |

后端的习惯：在**旁路端口**（例如 3108）和**独立的库副本**上跑完测试，再重启 :3000，并确认进行中考试的指纹前后一致。

### 7.4 讲解预生成（key 到手后先做真模型验证，不是批量生成）
- `npm run gen:explanations`，先加 `--dry-run` 估算，不调模型。**默认跳过已有专家讲解（605 道：英一 572、数一 33）和只有官方解析的（215 道）**，按现在的题库（集成分支 fc81df6）默认要生成 **0 道**（820 道里）。所以 key 到了的下一步是真模型验证：先 `npm run key:preflight`，再实测几次 Agent 对话和英语批改，不是批量生成。`--include-expert` 可选：605 道，DeepSeek 加通义千问约 **1.44–2.40 美元**（2026-11-02 dry-run）。官方解析的题加 `--include-official`。官方解析的加 `--include-official`。可以断点续跑，可以限速（`--concurrency 3 --rpm 30`），其他参数有 `--retry-failed`、`--force`、`--ids`、`--limit`、`--include-official`。脚本分别估算 DeepSeek 高峰和低峰价格，尽量在低峰时段跑（具体时段以 DeepSeek 官网为准，**【未核实】**）。
- 质检：答案字母和标准答案一致；证据句必须在原文里找得到，并标出第 N 段第 M 句；步骤数和长度在范围内。不合格的存为「待核对」，不当作正常讲解显示。完形可以用空格所在的句子作证据，并且要点出 kp_tags `evidence` 里的「上下文复现」（新题型的规则不变）。**这部分正在做，还没提交**（`ai/cloze-recurrence.ts`）。
- 有 key 而某题没讲解时，讲解接口会现场生成一次并入库，同一题并发请求也只生成一次。`EXPLAIN_ON_DEMAND=0` 可以关。
- 部署机上的命令写在 `deploy/README.md` 的「拿到 Key 之后：预生成讲解」一节。
- **Key 到了先跑一键预检**：`cd backend && npm run key:preflight`（`scripts/key-preflight.sh`，说明在 `backend/README.md`「Key 到位后：一键预检」）。依次：查 Key → tsc → `ai:check`（含 `/models` 预检和模型名）→ 复制一份临时库、起临时后端（:3108）真模型发一条教练消息（查有没有 400 / mock）→ 讲解 dry-run + 真生成 2 题（默认范围 0 题时在临时库上加 `--include-expert`，一题没生成算 ✗）→ `eval:grading` → `eval:agent`（`EVAL_TZ=Asia/Shanghai`）。结束自动关临时后端、删临时库，不碰 :3000 和主库。没 Key 时 `npm run key:preflight -- --fake` 用假模型演练过，**全流程通过（2026-11-02）**。
- 演练中修的坑：`deepseek-flash` 默认开思考模式，多轮工具调用要回传 `reasoning_content`，Mastra 不回传 → 第二轮 400。Agent 请求现在统一带 `thinking:{type:"disabled"}`（`src/ai/llm.ts` 的 `mastraProviderOptions`）。讲解生成不受影响。

---

## 8. 当前进度

### 8.1 已完成（主要功能）
- **账号**：注册登录（JWT，30 天）；「我的」页：目标院校/分数、考试日期（今日页倒计时）、提醒频率、免打扰、时区、学习统计、掌握度地图、错题 PDF。
- **刷题**：数一按年份做整卷，KaTeX 渲染公式，答题卡；填空直接填；解答题看参考答案后按小问或整题三档自评；分步思路；讲解（SSE，带来源和核对标签）；刷新后恢复进度和草稿；题旁朱批（错题优先，其次是正确率低于 50% 的知识点）；题干表格 `{{table:n}}`；勘误显示。英一：完形空位就地选；阅读 A 在电脑上左右分栏；新题型 A–G；翻译划线句跳转；作文统计字数并显示配图；客观题按篇对答案。
- **模考**：数一、英一整卷都能考，服务端计时，暂停、离线队列、409、放弃、交卷两次确认、自评、成绩页、成绩单 PDF、历史；整卷模考卡、考试进行中横条、待自评卡。
- **错题本**：自动收录、改错因、已掌握后进复习、导出 PDF。**单词**：ECDICT + 真题词汇，FSRS，发音缓存，固定分母。
- **教练**：命令栏 SSE、计划改动加原因（why_changed）、按组撤回、问答模式、去重、四种提醒频率、proposal 确认和忽略、夜间、周报、午间、阶段任务、凌晨规则、日期占位符渲染。规则版完整可用，**真 AI 还没接**。
- **题库**：22 卷全部 confirmed，有知识点、小问分值、reviews、专家讲解（数一）、真题词汇、errata。
- **部署套件**：compose、deploy.sh、smoke-remote、每日备份（保留 7 天，包括 tiku/src）、无 Docker 的备选方案，都写好了，**还没在真机上跑过**。
- **PWA v4**（前端 `4a3c59d`，用户复测通过 r01–r04）：manifest「研习」、theme `#2F4F3F`、background `#FBF8F1`；墨绿主色已落实。启动和切回前台时发绕过 SW 的 HEAD 请求探测真实网络，断网每 5 秒再探；恢复联网后自动重拉当前页、补传答案，离线提示 5 秒内自动消失（刷题页不重载）；SW 激活和打开页面时清掉不在清单里的旧 js/css；maskable 图标已预缓存；index.html 带 content-length。离线文案「现在没网，连上再试 · 看到的是上次同步的内容」，不出现「服务器」。**还差 HTTPS 真机加到主屏**。
- **开发环境作答时间跟 `X-Debug-Now` 走**（只在开发环境；tunnel 和生产忽略这个头），可以造过去某天的作答，测周报和离线「按作答时间计入当天」用。
- **Git**：私有仓库已推，提交记录见 `git log`。

### 8.2 最近测试结论（`user-test/round9/`）
- **模考入口这一轮全部关闭**（截图 l01–l03）：`#/` 进今日页；点年份不会开考（上一轮报的问题是误点，已经收回）；考试条不会误出现。之前的 h01–h08、j01–j09、k01–k06 里的问题都已修复并复测通过。
- **API 第 8 轮复测**（`api_retest8.md`，后端 `2c68743`，北京时间 11-02 00:50）：问答不当指令、P4 跨学习日去重、P1/P3 日期文案、P2 快照渲染全部 PASS。新发现两个小问题：
  - ① 8 天后，过期的 pending 建议还能确认，应该让它失效。**前端已提交 `bc913e1`，后端在改，还没提交。**
  - ② 「这周（11-02）」只写了一天，应该改成「这周（11-02 起）」。**未修。**
- **已测通过**（前端 r24，北京时间 11-02 12:30，真后端 :3000，1280/390）：「自评·字数不足」全新浏览器配置（无本机记录）打开成绩页和逐题对照照样显示，只跟后端 `self_grade_flags` 走；今日页卡和成绩页「去自评」跳到自评页后目标题高亮约 2.5 秒消失。顺带修了自评页换设备不回填已评档位的问题（见 §6.5）。截图 `/workspace/kaoyan-ui/r24-a-*`、`r24-b-*`、`r24-c-*`（`-1280`/`-390`）。
- **round10（用户，三项已测完、等复测，分支 `user/round10`，记录在 `user-test/round10/`）**：
  - 英一 2020–2025 专家讲解抽查（每年 8 题，种子 20261102，依据 `tiku/explanation_review_standard_en.md`）：48 题 38 过 10 不过。答案、译文、范文和题库一致，证据句都能逐字找到。不过的：翻译 6 题都缺「得分点对应译法」和「常见误译」（整批 30 句要补）；完形 2020-19、2024-20、2025-20 用中文说出了同篇别的空的答案；阅读 2020-24 干扰项没说为什么错。行业专家在 `expert/english1-2020-2025-explain-fix` 修，修完由用户复抽。详情 `explain_spotcheck_en.md`，逐题结论 `reviews_en_spotcheck.jsonl`。
  - 讲解二次复抽（11-02 12:41，`explain_recheck2_en.md`）：行业专家 `9139d27`/`269b7bf` 7 项全过——2020-13、2025-40（馆员只在第 3、4、6 段，属实）、2022-09、5 题干扰项都已修好；`check_clue_type.py`（1c525c3）退出码 0，`check_cloze_leak.py`（rule3）退出码 0；25 处中文近义词抽 8 全过，新抽 12 全过。只剩提醒：2021-03/2021-12/2025-06 线索标签可更贴切；rule3 把「逻辑连接」的「连接」误报成 connection/connected。可以和 `tiku/clue-type-check` 一起合。
  - 阅读 A 干扰项复抽（11-02 12:52，`reading_distractors_check_en.md`）：行业专家 `959620c`（98 题 294 条）+ `14b28ce`（2021-03/2021-12/2025-06 线索标签）**已复测，可合并**。种子 20261104 抽 20 题 60 条全过；全量 294 条缺类型 0、缺英文引文 0、引文对不上原文 0（用了 29 次「张冠李戴」，标准没列，请统筹者定要不要加进去）；定位步、答案步、题目和答案文件都没改；check_clue_type（1c525c3）和 check_cloze_leak（27de578）都 exit 0。遗留问题在旧 22 题：2020-25/2020-28/2024-38 态度题 9 条没写类型，另有 17 题缺英文引文，专家说的数字属实，下一批补。
  - 英一 2015–2019 专家讲解抽查（11-02 12:56，`explain_spotcheck_2015_2019_en.md`）：以 `5f25177`（含 `4fee95d`）为准，种子 20261105 抽 40 题，38 过 2 不过（2017-01「诸多」泄露 host，2018-19「大多配合」泄露 willing）。全量看完形又找到 4 处中文泄露（2015-07、2017-09、2017-11、2018-03）和 1 处疑似（2017-19），check_cloze_leak 都没报，**要等行业专家改完再合**。客观题答案对题库 0 处不一致，引文 0 处真不一致，阅读 A 300 条干扰项全有类型。(a)(b)(c) 都 PASS：46–52 共 35 题逐字等于专家译文，修前前端参考译文和讲解对不上，现在对上了；Juan Carl 按原卷保留，建议 2015-21 讲解补一句说明；21 个 kp_tags 的 at 换算正确。2025-35/2025-31 引文在 `expert/english1-reading-polish` 修。
  - 阅读讲解打磨复核（11-02 13:02，`reading_polish_check_en.md`）：行业专家 `expert/english1-reading-polish`（b469187/c98679f/5e1bf5f/5471cf8）。四处小改、4 处引文逐字、态度题 9 条类型都过；check_quote_verbatim exit 0，反例（改字母/段号/句号）都能报，用它跑修前版本正好报出 5 处；clue_type 1c525c3、cloze_leak 27de578 exit 0（2025-06 那条提醒消失）；答案步、定位步、题库都没动；抽 10 题全过；新标准七类表清楚。**还差两句**：2023-32 D 没补引文（17 题里漏的 1 题，rd_distractor_stats 缺引文 1），2024-38 D 语病会读反。补完可合。
  - 英一 2015–2019 完形复测（专家 b66cefd，以集成 241ccc1 为准）全过：点名 7 处、新改 5 题无泄露；cloze_leak b88dfd1 的 4c 提醒 101→0，clue_type、quote_verbatim（含 --all）exit 0；人工扫 100 题 0 泄露（2 处轻度提醒）；抽 15 题（种子 20261107）可读；答案、题库、阅读、翻译未动，2015-21 已补说明。reading-polish 在 241ccc1 复核：2023-32、2024-38 D 已修，全过。详情 `user-test/round10/cloze_2015_2019_recheck_en.md`、`reading_polish_check_en.md`。
  - 5a/5b/5c 已测完（`api_retest10.md`、`offline_pack_test.md`）：5a 周报 E1/E2 全过；5b 15 分钟门槛（900 秒不标、901 秒标）、累计暂停、trend=1、24 小时自动交卷全过，唯一 FAIL 是详情缺 `exam_name`，后端已在 `be/key-preflight` `0991c39` 补上，待集成分支上线后复测；5c 断网 5 题在 1280/390 两种宽度 6/6 全过，FAIL 是注册/登录后要刷新才拉题包，前端在 `fe/offline-polish` 修，另有 8 处别扭点（①标签外露等）已交前端，⑤⑦后端已查清，改成显示 `pack.summary`。
  - 待复测（等集成分支上线）：详情 `exam_name`；作答列表 `source`/`study_date`（`7a82c75`）；登录后拉题包和离线页 8 处别扭点；PR #2 周报文案「这周（11-02 起）」「那周（11-02–11-08）」。测试号密码只在 `/workspace/.kaoyan_testpw`，别写进报告。
- **离线题包 round10 修复**（前端 r25，分支 `fe/offline-polish`，北京时间 11-02，真后端 :3000 + be/key-preflight 的 mock，1280/390，`frontend/e2e/e2e55.mjs`、`e2e55-mock.mjs`）：登录/注册成功后不刷新就拉题包；翻译原文不再露 `<u>` 标签（划线句带序号）；恢复联网留在离线页，顶部提示补传进度和「回到在线刷题」；完形当前空标出；顶栏跟着当前题写「离线题包 · 年份 科目」；英语主观题自评用英语措辞、手机上不被底栏挡；日期和「做了」之间加空格；选错项整行标色；离线 F5 回到顶部。题包说明改用后端 `summary`，没有就按 `counts`/实际题数拼（不再写死「今天任务里的…加 10 道错题」）；题包页加「今日题 / 错题重做」分组入口一点就到；今日页显示「今天已经做了 N 题」（/me/stats，含补传），没排任务时说题包已备好什么。截图 `/workspace/kaoyan-ui/r25-*`。
- **今日页题包那句去重**（前端，分支 `fe/today-summary-dedupe`，基于 coord/integration，北京时间 11-02 13:00）：后端 summary 以「今天还没排任务」开头时，今日页去掉这几个字，读作「离线题包已备好：自动挑了…」，不再一屏说两遍。e2e42 改成 `E2E_BASE`/`E2E_TOKEN_FILE`/`E2E_TAG` 可配（默认仍 :4173、/tmp/tok）；e2e54 结尾标签写实际目标（base + `E2E_API`）；e2e55 加断言今日页「今天还没排任务」最多一次。:3109（集成后端）和 :3000 各 1280/390：e2e54、e2e42、e2e55 全过，截图 `r2{4,5,6,7}-s3109-*`、`-s3000-*`。

### 8.3 待办（按优先级）
**P0（马上要做）**
1. （多半已完成，先 `git status` 核对）**把工作区里还没提交的后端改动收尾并提交**。写这份文档时 `git status` 显示有：2 分钟内放弃即删除（`exams.service.ts`/`controller`）、过期建议失效（`agent/proposal-view.ts`、`jobs.service.ts`、`agent.controller.ts`、`plans.controller.ts`）、完形证据放宽和复现提示（`ai/explain.ts`、`explanation-gen.ts`、新文件 `ai/cloze-recurrence.ts`），以及 openapi、mock、smoke、test-unit。先跑 `test:unit`、`smoke`、`eval:agent`，全绿再提交。
2. ~~PWA 还没配~~ **已完成（v4，见 §8.1）**，只差 HTTPS 真机验证。原记录：`frontend/package.json` 里有 `vite-plugin-pwa`，但 `vite.config.ts` 没启用，`index.html` 没有 manifest，也没有 service worker 和 apple-touch-icon，**现在手机还不能真正「加到主屏」**。需要配好 manifest（名字「研习」、主题色、图标）、SW 缓存策略（API 不缓存，SSE 不拦截），然后在 HTTPS 下验证。
3. 把 `tiku/src/eng1/SOURCES.md` 移到或复制到 `tiku/SOURCES.md` 并提交（现在被 gitignore 排除了），补全每份原卷的 sha256、下载链接和大小；数一的来源也一并写进去。
4. 给 `english1-2024-04` 补知识点标签（导入报告里唯一的错误级问题）。

5a. **周报 E1/E2**（后端已提交 `76f233d`，`{{nextweek}}` 占位符，存量自动迁移；**待用户复测**）：E1 当周的旧周报不要带「当时」，天数实时算，写「距考试 N 天」；E2 过期后标题改成「当时定的下周重点：…」。8 天后看是「那周（11-02–11-08）…当时距考试 47 天」（已上线）。
5b. **`non_continuous`、`paused_at`、24 小时自动交卷**（后端 `15c55a8` 已提交，确认 :3000 已重启上线）后 @ 用户测（15 分钟门槛、10 分钟提醒、成绩页标注、趋势图空心点）。
5c. **离线题包**：round10 问题前端已在 `fe/offline-polish` 修完（见 §8.2），待合并后 @ 用户复测（尤其换到带 `summary` 的后端后题包说明那句、错题重做入口）。:3000 还没有 `summary`/`plan_tasks` 时前端按实际题数写中性说法（「文章 N 篇（共 X 题），加 Y 道错题重做」）。

**P1（key 或服务器到手后）**
5. 拿到 key：填进 `backend/.env` → **`npm run key:preflight`**（一条命令做完 ai:check、真模型教练消息、讲解 2 题、eval:grading、eval:agent，见 §7.4；`--fake` 演练已通过）→ 全过再实测几次 Agent 和批改（默认 `gen:explanations` 现在是 0 道，不用批量跑；`--include-expert` 605 道约 1.44–2.40 美元，可选）→ eval:agent 的人工打分（108 条）。
6. 拿到服务器：按 `deploy/README.md` 操作，`./deploy.sh user@host --dry-run` 后正式部署，再 `./smoke-remote.sh https://域名`。配好域名才有 HTTPS，加到主屏和麦克风都要 HTTPS；大陆服务器需要备案。
7. 「这周（11-02 起）」的文案；复测「自评·字数不足」换设备后的显示和高亮 2 秒。

**P2（功能补完）**
8. 变式题生成（双模型解题 + SymPy 验算，三方一致才入库）、考前 30 天专属模拟卷、事件触发（某科连续 3 天没练、某知识点正确率连续下滑）。
9. 费曼「讲给它听」接真实的转写和判断；TTS 语音复盘。
10. 部署机上启用 pgvector，`searchQuestions` 改成向量检索（本机装不上，生产镜像自带）。
11. ~~落实墨绿主色（见 §1），删掉模板残留的 `HelloWorld.vue` 和 `assets/vue.svg`、`vite.svg`、`hero.png`；把 `e2e*.mjs` 整理到 `frontend/e2e/` 目录。~~ **已完成**：`--lv:#2F4F3F` 已在 `frontend/src/style.css`；模板残留已删；脚本在 `frontend/e2e/`（`cd frontend && node e2e/e2eNN.mjs <宽度>`）。`e2e51.mjs` 读写的 service worker 改为相对脚本定位 `frontend/dist/sw.js`。
12. 修正 `scorePlan` 的注释（写的是「最后一问补齐」，实际是余数给第一问）。

### 8.4 已知问题和风险
- 本机 PG 没有 pgvector（`/health` 显示 `pgvector:false`），不影响现有功能。
- 原卷 PDF 只在这台 box 上有（§5.6）。
- watcher、BOARD 旧记录、reviews 的 `at` 混用了 PT 和北京时间，看时间要注意时区。
- **测试密码已轮换**（后端 `5bcf161`）：git 历史里泄露过的 5 个旧密码全部失效（旧密码登录 401），1,697 个测试号统一改成新密码。新密码**只在仓库外**：`/workspace/.kaoyan_testpw` 和 `/workspace/.secrets/test-accounts.env` 的 `TEST_PW`；脚本都从这两处读。**不要把值写进仓库、文档或群里**。历史不重写。
- **开发 `:3000` 的 JWT 密钥仍是 `.env.example` 里的占位串**（只本机访问，换了会登出所有测试号）。**正式部署必须生成新密钥**，`main.ts` 在生产环境会拒绝太短的密钥。
- **临时 https 隧道已备好但没开**：本机 `127.0.0.1:8080` 是前端，`/api` 转到 `:3001` 的独立后端（关注册、只允许 tony 登录、忽略 `X-Debug-Now`、单独 JWT 密钥；tony 的密码只在本机文件）。准备用 Cloudflare quick tunnel 暴露给 Tony 手机测 PWA。**必须等 Tony 在私聊里亲口同意才开**，URL 和密码只私下发给 Tony，绝不进群。
- 库里有约 1700 个测试账号（smoke 和复测时注册的），部署时用的是新库，不受影响。
- 前端 e2e 脚本要先把登录 token 写进 `/tmp/tok`，并依赖本机的 `/usr/bin/google-chrome`。

---

## 9. 阻塞项（只有 Tony 能解决）

| 阻塞 | 现状 | 怎么要 |
|---|---|---|
| **DeepSeek API key** | `backend/.env` 里 `DEEPSEEK_API_KEY` 是空的 | 请 Tony 在**私聊**里发（不要在群里），收到后只写进 `.env` |
| **通义千问（DashScope）API key** | `DASHSCOPE_API_KEY` 是空的 | 同上。讲解生成和 `ai:explain` 两个 key 都要有 |
| **是否开临时 https 隧道** | 已问 Tony（私聊里的「开吧 / 先不开，等服务器」），未回复 | 同意后让后端开，URL/密码私聊发 Tony |
| **部署服务器** | 还没给 | 需要 Linux 2C4G、40G 硬盘，装好 Docker 和 Compose v2，能 SSH 免密登录，放行 22/80/443；域名可选（有域名才有 HTTPS；大陆服务器要备案）。到手后：`cd deploy && ./deploy.sh user@host --dry-run && ./deploy.sh user@host`；非 22 端口用 `SSH_OPTS="-p 2222 -i ~/.ssh/kaoyan_deploy" ./deploy.sh user@host`；装到别的目录就在后面加路径参数 |

---

## 10. 接手第一天清单

```bash
# 0. 先读：本文、BOARD.md 最后 30 行、git log、user-test/round9/api_retest8.md
cd /workspace/kaoyan && git status && git log --oneline | head -20

# 1. 服务都在吗
curl -s localhost:3000/api/v1/health     # 期望 ok:true, questions:820, ai:"mock"（没 key 时）
curl -s -o /dev/null -w '%{http_code}\n' localhost:4010/api/v1/health   # mock 返回 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:4173/                # 前端返回 200
ss -ltnp | grep -E ':(3000|4010|4173|5432)'
ps aux | grep watch-tiku | grep -v grep   # 自动导入
# 不在就按 §4.3 拉起：cd backend && npm run db:start && npm run build && nohup npm start > server.log 2>&1 &

# 2. 后端测试（在 backend/ 下）
npm run test:unit        # 期望 199/199 左右（会随用例增加）
npm run test:smoke       # 最后打印 ALL OK（会注册一个 smoke_* 账号）
npm run test:tools       # TOOLS OK
npm run test:sources     # SOURCES OK（另起 :3002）
npm run eval:agent       # 单测 + 内置 406/0 + 专家 62/0；有一条不过就 exit 1；报告在 eval/report-*.md
#    注意：eval 和 smoke 会写库。想不影响 :3000，就像原后端那样用旁路端口 + 库副本

# 3. 前端
cd ../frontend && npm run build          # vue-tsc + vite build，不能有报错
# e2e：先注册或登录拿 token 写到 /tmp/tok，再按 1280 和 390 两个宽度跑，例如
node e2e/e2e37.mjs 1280 && node e2e/e2e37.mjs 390   # 整卷模考卡、考试条、待评
node e2e/e2e42.mjs 1280 && node e2e/e2e42.mjs 390   # 今日页待自评卡

# 4. 题库
cat ../backend/import_reports/watch_last.md | head -40   # 22 卷，只有 english1-2024 一个 ❌（Q4 缺知识点）
node ../tiku/check_questions.mjs                         # 入库质检（用法见脚本开头）

# 5. 处理 §8.3 P0：先把工作区里没提交的改动收尾、测试、提交
```

验收「一切正常」的标准：health 正常；smoke 打印 ALL OK；eval:agent 退出码 0；前端 build 通过；所选 e2e 在 1280 和 390 两个宽度下都没有 `ERR` 和横向溢出；watch_last 里除已知项外没有新的 ❌。

---

## 11. 仓库与 git

- 地址：<https://github.com/lilanmin101-droid/kaoyan-review>（私有）。本机 `/workspace/kaoyan` 的 origin 已经配好，box 上的 `gh` 和 git 已用 `lilanmin101-droid` 认证，可以直接 push。换机器的话，需要 Tony 本人授权 GitHub，在群聊里做不了，要去私聊。
- **提交约定**：改完、自测通过后，在 `/workspace/kaoyan` 用**一句中文说明**提交到 `main`，例如「后端：……；前端：……」。**禁止 force push**，禁止改写已推送的历史。每轮检查一次有没有漏提交的。
- **`.gitignore` 要点**：`node_modules/`、`dist/`、`dist-*/`、日志、`tmp/`；`.env` 和 `.env.*`（保留 `.env.example`）、`*.pem`、`*.key`、`id_rsa*`、`.ssh/`、`secrets/`、`*.token`；`pgdata/`、`pg-runtime/`、`pg-build/`、`pglogs/`、备份和 dump；`data/audio/`、`backend/uploads/`、`data/ecdict/ecdict.csv`；`tiku/src/`、`tiku/img_tmp/`、`tiku/**/*.pdf`、`user-test/**/*.pdf`。
- 推送前扫一遍密钥，比如 `git diff --cached | grep -nE 'sk-[A-Za-z0-9]{20,}|API_KEY=.+|BEGIN (RSA|OPENSSH) PRIVATE'`，确认没有 key、`.env` 和 PDF。首次推送时扫描结果是干净的。测试脚本里的 JWT 已经改成读环境变量。
- 更新本文：每个里程碑都改，修改顶部的「最后更新」（北京时间），然后提交。

### 11.1 集成分支与上 main 流程（统筹者维护，北京时间 2026-11-02 13:07）
- **怎么做**：各角色在自己的 `git worktree` 和分支上工作，不要在 `/workspace/kaoyan` 里切分支（那份是 main，跑着 :3000、:4173 和 watcher）。统筹者在 `/workspace/kaoyan-integ` 把各分支合进 **`coord/integration`**。冲突时 BOARD.md 和 HANDOFF.md 两边的行都保留，合完跑检查再推送。**合 main 必须等 Tony 明确说「可以合」**（Auto-review 会拦住自动推 main）。Tony 同意后：先把 `main` 快进到 `coord/integration`，再由后端重启 :3000 和 :4173、重导词表（import-vocab 会补缺的释义）、跑 smoke，最后 @用户 复测。
- **合并前三项检查**（在集成 worktree 里跑，退出码都要是 0）：`ECDICT_CSV=/workspace/kaoyan/data/ecdict/ecdict.csv python3 tiku/pipeline/check_cloze_leak.py`；`python3 tiku/pipeline/check_clue_type.py --root $PWD/tiku`；`python3 tiku/pipeline/check_quote_verbatim.py`。改了代码还要跑：`frontend` 下 `npm run build`，`backend` 下 `npm run build && npm run test:unit`（集成分支上是 318 条）。
- **`coord/integration` 当前是 `f11c6f0`**（已推送）。已合入：PR #1、PR #2；`fe/retest-r10`、`fe/offline-polish`(74a79f5)、`fe/today-summary-dedupe`(124df24)；`be/key-preflight`（合到 0061033：预检真生成 2 题、import-vocab 补释义、mock summary 带题型）；`tiku/eng1-2024-04-kp`、`tiku/cloze-leak-rule3`(27de578)、`tiku/cloze-leak-rule4c`(b88dfd1)、`tiku/clue-type-check`、`tiku/eng1-2021-text4-typo`(d75e4da)、`tiku/eng1-2015-2019-expert-answers`(5f25177)、`tiku/vocab-rebuild`(40b5b8c)；`expert/english1-2020-2025-explain-fix`、`expert/english1-reading-distractors`(959620c/14b28ce)、`expert/eng1-2021-text4-quote`(24592db)、`expert/english1-2015-2019-explanations`（合到 b66cefd：完形泄题共改 77 题，4c 提醒清零）、`expert/english1-reading-polish`（合到 05d854d：「张冠李戴」写进标准，七类错因，check_quote_verbatim.py）、`expert/eval-human-scoring`；`user/round10`（合到 9f271bd）；`coord/handoff`。
- **已验证**：三项检查都是 0；后端构建通过，单测 318 条全过；前端 e2e42/54/55/55-mock 在 1280 和 390 两种宽度下全过（ac8788b 上跑的）；后端旁路在 fc81df6 上跑的导入、smoke 121、离线 smoke 30、eval 全过。
- **合 main 前还在等**：①后端在 f11c6f0 上补跑导入和 smoke（单独的库）；②用户在 241ccc1 及以后复测 2015–2019 完形和 2023-32、2024-38。两项都过了，就请 Tony 说「可以合」。
- **之后排的**：2015–2019 那 298 条干扰项补英文原句（行业专家在 `expert/english1-2015-2019-explanations` 上做）。
