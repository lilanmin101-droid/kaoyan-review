# 英一 2015–2019 阅读 A 干扰项复核（专家 ae80898 + a06afd5）

- 测试人：用户；时间：2026-11-02 13:13–13:35（北京时间）
- **基准：origin/coord/integration `c57e2d9`**（已含 ae80898 和 a06afd5）。集成分支已含这两个提交，所以没有自己试合。
- 方法：临时 worktree（detach 到 c57e2d9），用完删除；没有改对方分支。

## 结论表

| 项 | 结果 |
|---|---|
| 1 rd_distractor_stats（RD_YEARS=2015-2019） | 300 条：缺类型 0、缺引文 0、引文对不上 0 **PASS** |
| 1 check_cloze_leak b88dfd1（含 4c）2015–2019 | exit 0，leaks 0，4c 提醒 0 **PASS** |
| 1 check_clue_type 1c525c3 | exit 0 **PASS** |
| 1 check_quote_verbatim（默认 + `--all 2015..2019`） | 都是 exit 0，不符 0 **PASS** |
| 2 7 处改标张冠李戴 | **6/7 成立**；2019-32 C 不成立（建议改回无中生有） |
| 3 2017-31C、2019-26C、2019-36B 改写后 | **3/3 不再泄露**后面题的答案 |
| 3 全量扫 300 条引文（脚本 + 人工） | 脚本命中 51 条（33 条指向后面的题）。人工判断：**1 处实质泄露（2016-37 C → 2016-38）**、1 处中度暗示（2017-23 B → 2017-24），其余是标题题/态度题必然重叠或很弱的暗示 |
| 4 抽 15 题 45 条（种子 20261108） | 44/45 类型贴切，45/45 读得懂；2018-31 C 建议改张冠李戴 |
| 5 a06afd5 的 4 条小建议 | **4/4 PASS** |
| 6 答案步、题库、完形/翻译没被意外改 | **PASS** |

**失败项（2）：**
1. **2016-37 C 泄露 2016-38 答案。** 引文 “make it for the people who are already obsessed with it”，再加「是服务现有忠实读者」。这正是 38 的定位句和答案 B（is meant for the most loyal customers）。旧版就有，ae80898 补成逐字英文后更明显。建议改用第3段 “rushing to eliminate its print edition would be a mistake” 之类的句子，或者只写「原文没说要开拓新读者群」，不点出“给谁做”。
2. **2019-32 C 改标张冠李戴不成立。** 选项说 our current knowledge of consciousness **inspires** popular sci-fi TV series。原文第3段只说人们着迷于类人机器人，“similar to those recently depicted on” 科幻剧。“认识启发了科幻剧”这层因果原文谁都没说，所以不是「内容没变、主体换了」。按标准第36行的区分，应该是无中生有。讲解说的“作者说的不是 Eagleman 说的”也能成立，但只是次要理由。

## 2. 7 处改标张冠李戴（对照原文和标准「内容没变、主体换了」）

| 题 | 原文主体 → 选项主体 | 判断 |
|---|---|---|
| 2015-28 A | “California’s lame argument … similar to, say, going through a suspect’s purse”：加州的类比 → 作者认为 | 成立 |
| 2015-38 D | “finding guilty … Andy Coulson, for conspiring … Rebekah Brooks, innocent of the same charge”：Coulson 的共谋 → Brooks 的辩护 | 成立 |
| 2017-31 A | “the UK’s GDP has been the envy of the Western world” 是作者叙述 → 肯尼迪称赞英国 | 成立 |
| 2017-32 D | 不顾警告投票脱欧的是 “over 17 million people” → 决策者 | 成立。小建议：第2段第1句有 “has annoyed policymakers”，学生容易拿它来支持 D，讲解可以顺带说一句“只说困扰，没说不再重视” |
| 2018-32 D | “DeepMind has almost apologized” → NHS 信托 | 成立 |
| 2019-22 B | 短期主义 “has worsened in publicly traded companies” → 政府 | 成立 |
| 2019-32 C | 见失败项 2 | **不成立** |

改标前这 7 条是 6 条偷换概念、1 条正反颠倒（2015-28 A）。改成张冠李戴后，与讲解理由（都是“是 X 不是 Y”的主体错位）一致了。

## 3. 泄露复查

### 指定 3 条

- **2017-31 C**：只引 “So, what Kennedy was referring to was”，没有带出 34 题的证据 “it is no longer enough”。PASS
- **2019-26 C**：改引第3段第1句 “continue to do their utmost to keep students in school (and paying tuition) and improve their graduation rates”，旧版的「好成绩能带来更多经费」（直接露 28 题 A）已去掉。PASS。轻度提醒：这句也是 30 题的定位句之一，但只是原因之一，不会暗示 30 题答案 B。
- **2019-36 B**：改引 “online-only retailers, especially smaller ones”，旧版的「大型连锁本就在收税」（直接露 39 题 B）已去掉。PASS。轻度提醒：顺带能排除 39 题的 D（Small retailers），但不指向答案。

### 全量扫

- 脚本 `/tmp/xleak.py` 的做法：同一篇文章里，把每条干扰项步骤的英文引文（≥3 词）和其他题定位步引文做子串比对。命中 51 条，其中 33 条指向后面的题。
- 33 条逐条人工判断：
  - **实质泄露 1 处**：2016-37 C → 38（失败项 1）。
  - **中度暗示 1 处**：2017-23 B 引 “Passengers must pay $85 every five years to process their background checks”。这是 24 题定位句，24 题答案是 D an unreasonable price for enrollment。建议只说“原文没说更便宜”，不引价格句。
  - **轻度暗示（可不改）**：
    - 2016-37 D / 2016-38 C 的 “I would raise prices” → 40 题 B（Luxury Good）。这句本来就是 37 题自身的论据，属于必然重叠。
    - 2017-38 D 的 “legally sound in defining a kind of favoritism that is not criminal” → 40 题 D supportive。
    - 2018-22 A 的 “may need a lot of help adjusting” → 25 题 B possible solutions。
    - 2017-31 A 的 “envy of the Western world” → 32、35 题，只是背景句。
  - 其余（2015-31 → 35、2015-38 → 40、2017-21/24 → 25、2017-33 → 35、2018-24 → 25、2018-31 → 35、2018-39 → 40、2019-21 → 25、2019-27/28 → 29/30、2019-36 A → 40）：目标多是标题题或全文题，引的是本题自身证据，不指向对方答案。
- 指向前面题的 18 条：没有新问题。2018-37 C 引 36 题定位句里的 “permanently decreased demand”，但 36 题的答案是 B rigid management，不受影响。

## 4. 抽样（`random.Random(20261108).sample(2015–2019 阅读A 100 题按年份/题号, 15)`）

- 抽到：2015-21、2015-22、2015-31、2015-34、2016-29、2016-39、2017-22、2017-28、2017-30、2017-35、2017-38、2018-31、2019-26、2019-30、2019-38，共 45 条干扰项。
- 44/45 类型贴切，45/45 学生读得懂，引文逐字，中文解释清楚。
- **2018-31 C**（It fell short of the latter’s expectations）现标偷换概念。讲解自己写的是「协议没顾及病人的 expectations of privacy，不是没达到 DeepMind 的期望」，是主体错位（病人 → DeepMind），按这次 7 条的同一逻辑应标张冠李戴。建议专家顺手全量搜一遍「不是 X 的」这类主体错位理由，统一标签。
- 轻微：2016-29 B、2017-22 B 标正反颠倒或偷换概念都说得通，不判错。

## 5. a06afd5 四条小建议

- **77 题 `at`**：76 道完形加 2015-20 由 a06afd5 更新为 2026-11-02T13:12+08:00；2015-21 的 `at` 由 ae80898 更新（阅读 A 100 题的 `at` 都已更新）。PASS
- **2019-13**：改成「本句给出具体例子——林木线上因公路、铁轨而出现的空隙，空格表举例」，重复已去掉。PASS
- **2015-16/17**：中文改成「速度为何有所变化」，没用“加速”，正好避免露出 15 题 faster。PASS
- **2015-20**：改成 “care was taken to ___ that”，与原文 “care was taken to {{20}} that” 逐字一致。PASS

## 6. 范围（d3ba737 → c57e2d9）

- **2015–2019 答案步**：0 改动。
- **ae80898**：只动了阅读 A 21–40 的干扰项步骤（A/B/C/D 错），步数不变，其他字段不变。
- **a06afd5**：只改了 2015-16、2015-17、2015-20、2019-13 的步骤，以及 77 题的 `at`。
- **题库、passages、翻译、图片**：0 diff。
- **2020–2025 讲解和 check_quote_verbatim.py**：只有 05d854d 的改动，上一轮已复核。

---

## 追加：复核专家 d2ad7ef 的 5 处修改（含 abd6532，快进）+ 跨题泄题清单（740afbc）人工分类

- 时间：2026-11-02 13:21–13:45（北京时间）
- **基准：origin/coord/integration `d2ad7ef`**。集成分支最新提交就是 d2ad7ef。
- 方法：临时 worktree 读取，用完删除。

### 结论

| 项 | 结果 |
|---|---|
| 2016-37 C | 新引文是第4段第1句 “only if they go about doing it the right way”，逐字一致。这句本来就是 37 题自己的定位句，**不再露 38 题答案**。PASS。小意见：选项“开拓新读者来源”和原文“用正确方式转型”的对应稍弱，标无中生有也说得通，不判错。 |
| 2019-32 C | 已改标**无中生有**；引文 “similar to those recently depicted on popular sci-fi TV series” 逐字一致。PASS |
| 2017-23 B | 去掉了 $85 句，改引第5段第4句 “focus on travelers who are higher risk, saving time for everyone involved”（23 题自己的定位句），**不再暗示 24 题 D**。「把快换成便宜」：expedited 原文省的是时间，选项换成了钱，偷换概念贴切。PASS |
| 2018-31 C | 已改标张冠李戴：病人的 expectations of privacy 被安到 the latter（DeepMind）头上。PASS |
| 2017-32 D | 补的 “has annoyed policymakers for over half a century” 与第2段第1句逐字一致，解释“只是困扰、没说不再重视”到位。PASS |
| 改动范围（abd6532..d2ad7ef） | 只改了上面 5 条干扰项步骤和这 5 题的 `at`（→13:19），步数和其他字段不变；另有 BOARD 一行。PASS |
| 我的重叠扫描（/tmp/xleak.py）重跑 2015–2019 | 51 → 49 条，少掉的正是 2016-37 C→38 和 2017-23 B→24；**这 5 处没有任何重叠**。PASS |
| check_cloze_leak（b88dfd1 版，含 4c）2015–2019 | exit 0，每年 leaks 0、提醒 0 |
| check_clue_type（1c525c3 版） | exit 0，每年错误 0 |
| check_quote_verbatim（默认 + `--all 2015..2019`） | 都是 exit 0。英文引文 123/122/117/120/119 条，不符 0（2017 年因 2017-32 D 多 1 条） |
| rd_distractor_stats（RD_YEARS=2015-2019） | 300 条：缺类型 0、缺引文 0、引文对不上 0、无段落定位 0 |

更正：上一节第 1 项说三项检查用的是「_ccl4c.py / _clue1c.py」，实际取的是 b88dfd1 和 1c525c3 版的 `check_cloze_leak.py` 和 `check_clue_type.py`。这次按正确路径重跑，结果同上全为 0。

### check_reading_cross_leak.py（分支 tiku/reading-cross-leak 740afbc）在 d2ad7ef 上

- 我自己在 d2ad7ef 上跑了一遍：exit 0，共 55 条提醒（2015–2019 39 条、2020–2025 16 条）。输出与 `/workspace/kaoyan-pending/reading_cross_leak_d2ad7ef.txt` **完全一致**，**这 5 处都不在清单里**。
- 55 条人工分类：**真泄露 2、弱提示 14、共用依据句可接受 39**。2015–2019 的 39 条里：真泄露 0、弱提示 10、可接受 29。

**真泄露（2 条，都在 2020–2025，指向后面的题，建议专家改）：**
- **2021-28 D → 29**：引 “the value of the avoided deforestation just for carbon dioxide emissions alone is more than the program costs”，并解释为「避免砍伐对减排的价值」。这正是 29 题的依据，答案 C “it can protect the environment”。
- **2025-27 C → 30**：引 “a price we must pay for understanding the world”。这直接对应 30 题答案 C “Energy-intensive research work is inevitable”。

**弱提示（14 条，可不改；其中 2021-24 C 最强，建议顺手换）：**
- 2021-24 C → 25：“will not be willing to pay more indefinitely”，接近 25 题标题答案 D “Ever-rising Fares Aren’t Sustainable”。
- 指向后面的题：
  - 2015-38 C → 40
  - 2016-36 D → 37
  - 2017-21 B → 25（“increasingly massive security lines”接近标题 C）
  - 2017-31 A → 32
  - 2017-38 D → 40（supportive）
  - 2018-22 A → 25（帮扶政策 → solutions）
  - 2018-31 A → 35（cautious）
  - 2019-21 B → 25
  - 2024-36 B → 37
- 指向前面的题，学生已作答，影响小：
  - 2015-28 A → 27：「作者称之为 lame 并要求抛弃」就是 27 题的 disapproval。
  - 2016-32 A → 31
  - 2020-27 D → 26
  - 2024-30 D → 28

**共用依据句可接受（39 条）**：大多是标题题、主旨题、态度题（如 2015-35、2017-35、2018-40、2019-40、2025-35、2025-40 等），它们本来就要引各段依据；或者引的是本题自己的论据，与他题定位句重叠但不指向对方答案（如 2016-24 A/B/D → 23、2018-37 C → 36、2019-26 A/C → 30）。

### 与我上次的 51 条重叠扫描对比（同在 d2ad7ef、2015–2019：我的 49 条、去重后 48 对；他的 39 条）

- **他有我无（3 条）**：2015-28 A → 27、2017-25 A → 22、2019-39 D → 40。原因是引文中间有 “…” 省略或只部分重叠，我用的整段子串匹配会漏，他的 6 连词匹配能抓到。这 3 条是**我的漏报**。
- **我有他无（12 对）**：2015-31 D → 35、2016-37 D → 40、2016-38 C → 37/40、2017-24 B → 25、2017-33 A → 35、2018-25 C → 22、2018-36 C → 37、2019-25 D → 21、2019-27 B → 30、2019-27 D → 30、2019-28 D → 30。这些都是 ≤5 个词的短引文（如 “I would raise prices”、“underused PreCheck lanes”、“(and paying tuition)”），他的默认 `--n 6` 抓不到。人工看都不是真泄露，只有 “I would raise prices” → 2016-40 Luxury Good 算弱提示。
- **误报**：他的清单没有误报，55 条都确实是文字重叠。脚本本身声明只提醒、需人工判断，其中 39 条属于可接受的共用。
- **建议**：默认保持 6；可以在说明里加一句“`--n 4` 能多抓短引文（全库 88 条，n=5 为 64 条），会多出不少噪音”。以前那两处问题（2016-37 C 原 11 词引文、2017-23 B 原 $85 句）用 n=6 都能抓到。
