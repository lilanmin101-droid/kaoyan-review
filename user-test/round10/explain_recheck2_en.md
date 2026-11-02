# 英语一讲解二次复抽（round10 · 复查 9139d27 / 269b7bf）

- 复抽人：用户（讲解抽查）
- 时间：2026-11-02 12:41（北京时间 UTC+8）
- 对象：`expert/english1-2020-2025-explain-fix` @ `9139d27`（主改动）+ `269b7bf`（只改 BOARD 里的一个数字：「改 89 题」更正为「94 题线索标签有改动」）。在 `/tmp/expfix` 临时 worktree（detached）只读，对方分支没改
- 标准：`tiku/explanation_review_standard_en.md`；上一轮记录 `explain_recheck_en.md`（fadc77d）
- 工具：`check_clue_type.py` 取自 `tiku/clue-type-check` @ `1c525c3`；`check_cloze_leak.py` rule3 版取自 `origin/tiku/cloze-leak-rule3`，另跑分支自带版；ECDICT 用 `/workspace/kaoyan/data/ecdict/ecdict.csv`

## 结论

| # | 复核项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 2020-13 去掉「照此推理」 | **PASS** | 改成「上下文复现：advisable 与同句的 advice 同根复现」，又补了前文 public warning、people should … 都是劝告。现在没有任何字眼对应第 12 空 On the basis of（依据/照此）；引句不带第 12 空，第 5、7 空也省掉了 |
| 2 | 2025-40 A/B 干扰项 + 「馆员只在第 3、4、6 段」 | **PASS** | A 标偷换概念，引第 1 段 “still here, decades, even centuries later. Why? Because they’re tangible.”；B 标以偏概全，引第 6 段 “we play an integral role in identifying, preserving, and providing accessibility to digital artifacts”，两段引文都逐字对得上。按原文逐段查：librarian(s) 只出现在第 3、4、6 段，第 5 段（ZIP 盘、格式过时）没有，**更正属实**，我上一轮写的「第 3–6 段」不对 |
| 3 | 2022-09 说话人 | **PASS** | 写明 similar 那句是 “Taiz 自己反驳……（这是 Taiz 的反驳，不是那些科学家的观点）”。原文第 4 段末 “…similar to the firing in a complex animal brain…,” Taiz said，对得上；引句略去第 14 空 superficially |
| 4 | 2023-32、2023-39、2024-22、2025-39、2021-36 B 干扰项 | **PASS** | 2023-32 A 改成正反颠倒，引 remove PRH books from prominent areas；2023-39 D 改成无中生有，引第 4 段 a citation database 和 “a listing in Scopus seems to be a criterion to be targeted…”；2024-22 B 改成偷换概念，引前一句 Later civilisations would value the skilled blacksmith’s labour…；2025-39 B 改成无中生有，引 Without constant migration of digital assets…，D 改成偷换概念，引 analog materials “have a chance of surviving”；2021-36 B 点到末段 meddling in the traffic on their network，并说明 meddling≠拖慢。5 题干扰项现在都有「类型 + 原文依据」，引文全部逐字核对通过 |
| 5 | 线索类型 `check_clue_type.py`（1c525c3） | **PASS** | `python3 check_clue_type.py --root /tmp/expfix/tiku`：2020–2025 每年错误 0（非标准 0，未标 0），**退出码 0**。对照：同一脚本跑 a553cb1 能报出非标准和未标，说明脚本确实在查。另外我自己数了一遍：120 道完形里线索标签有改动的是 **94** 道，和 269b7bf 的更正一致 |
| 6a | 泄题检查 `check_cloze_leak.py` | **PASS** | rule3 版：2020–2025 leaks 全是 0，**退出码 0**；中文疑似 27 条只提醒。分支自带版也是 leaks 0、退出码 0 |
| 6b | 25 处中文近义词人工抽 8（种子 20261102） | **PASS 8/8** | 从 diff 里（去掉线索标签后正文有变的完形，除 2020-13、2022-09 外正好 25 题，和专家说的数对上）抽到 2021-03、2021-04、2021-16、2023-20、2024-01、2024-19、2025-07、2025-11，逐题对照全篇 20 空答案看，见下表 |
| 7 | 新抽 12 题（种子 20261103，避开前两轮抽过的和本轮第 1–6 项看过的题） | **PASS 12/12** | 8 题从本次有改动且没抽过的 75 题里抽，4 题从其余没抽过的 146 题里抽。没发现修复引入的新问题，见下表 |

**总计：7 项全过，0 FAIL。** 另有 3 条线索标签不够贴切、1 条脚本误报，都只是提醒（见第三节）。

机器核对（本次 107 道有改动的题 + 抽到的 20 题）：讲解里的英文引句逐字在原文中都找得到，未命中 0（唯一报的是 2025-29 remember 里的模板 “deliver more X”，不是引文）；分支相对 a553cb1 没改 `tiku/english1_*.json`，答案没动。

## 一、25 处中文近义词抽 8
| 题号 | 答案 | 改了什么 | 结论 |
|---|---|---|---|
| english1-2021-03 | A while | 「may not be (inevitable)」改成「（即未必不可避免）」，标签改为上下文复现 | pass。不涉及别空答案（peaks/generally…）。提醒：讲的是前后对比让步，标「逻辑连接（让步）」更准 |
| english1-2021-04 | B accumulation | 「也说明」→「可见」，补了上下文复现标签 | pass。引的 higher measures of abdominal fat 从第 9 空 with 之后开始引，没带出 with |
| english1-2021-16 | B Meanwhile | 「你眼下就能做的事」→「读者现在就有 steps 可以减少腹部脂肪」 | pass。上一轮提的「做」≈ 第 17 空 take 已经去掉；“减少腹部脂肪”是原文 reduce abdominal fat，不是空 |
| english1-2023-20 | A ruins | 「描述古建筑的现状」→「讲古建筑的现状」 | pass。「描述」= 第 4 空 describe，已去掉 |
| english1-2024-01 | D Without | 线索从「逻辑关系（方式/特征）」改成词义辨析，补「四个介词里只有 without 表‘没有、无需’」 | pass。没有涉及 improving/convenience 的说法 |
| english1-2024-19 | B suit | 「环境与门是否相配」→「传感器要看所处环境来选」 | pass。「相配」接近第 17 空 complement，已去掉；“选”是原文 chosen，不是空 |
| english1-2025-07 | D protected | 「说明…起什么作用」→「讲…有什么用」 | pass。「说明」接近第 19 空 suggesting，已去掉；“古城…lay unseen”也没带出第 4 空 remains |
| english1-2025-11 | D examine | 「也说明」→「也可见」，补上下文复现标签 | pass。同上，避开 suggesting；讲解仍然通顺正确 |

## 二、新抽 12 题（种子 20261103）
| 题号 | 题型 | 答案 | 结论 | 理由 |
|---|---|---|---|---|
| english1-2020-14 | 完形 | D After all | pass | 只补了「逻辑连接」标签；“先传言、后找到证据”没说出第 15 空 connection |
| english1-2020-20 | 完形 | D end up | pass | 补「固定搭配」，end up with 讲清，排除项逐个给义 |
| english1-2021-11 | 完形 | D went by | pass | 补「固定搭配」，as the years went by，排除理由具体 |
| english1-2021-12 | 完形 | B attributable | pass | 补「固定搭配」，be attributable to 讲清。提醒：四个选项都是「形容词 + to」，靠搭配区分不了，标「词义辨析」更准；可以再加一句 resulted from 是因果线索 |
| english1-2021-17 | 完形 | D take | pass | 补「固定搭配」take steps，没涉及第 16 空 Meanwhile、第 18 空 well-being |
| english1-2022-02 | 完形 | C compared | pass | 排除项里的「类比」改成「相比」（「类比」接近第 9 空 analogous），改得对；similar to… 引在第 4 段，段号正确，略去第 14 空 |
| english1-2025-06 | 完形 | A currents | pass | 补「固定搭配：shifting currents 是常见搭配」。提醒：讲解主要靠场景（海底）+ 谓语（erode）在判断，标「词义辨析」更贴切 |
| english1-2025-17 | 完形 | B light | pass | 补「固定搭配」bring … to light，排除项 into effect / to mind 正确 |
| english1-2021-21 | 阅读A | C | pass | 定位第 1 段第 3 句逐字，首句反问 justify 和第 2 句 grimly reliable annual ritual 都对得上。干扰项是旧版短句（没标类型），归入 98 道批量改，本轮不判 fail |
| english1-2022-37 | 阅读A | A | pass | 定位第 3 段第 2 句 handbrake 逐字。干扰项是旧版「没说/没提」，同上 |
| english1-2025-29 | 阅读A | A | pass | 定位第 6 段第 2 句、第 7 段第 1 句逐字；D 点到 to power our intelligence（第 6 段第 1 句）。B/C 是旧版短句，同上 |
| english1-2025-34 | 阅读A | C | pass | 定位第 6 段第 2 句（Hawley 的引语）逐字，plateau≠decline 讲清。B/D 是旧版短句，同上 |

## 三、提醒（不算 fail）
- **线索标签不够贴切**（脚本只查是不是四类之一，查不出选得对不对）：2021-03 while（上下文复现 → 逻辑连接（让步））、2021-12 attributable（固定搭配 → 词义辨析）、2025-06 currents（固定搭配 → 词义辨析）。@行业专家 有空顺手改，不影响合并
- **rule3 泄题脚本的新误报**：统一成标准标签后，「逻辑连接」里的「连接」会被当成别空答案的中文义：2020 的第 15 空 connection（2020-09/12/14/17 报疑似）、2025 的第 18 空 connected（2025-09/12）。只是提醒，不影响退出码。建议 @资料/仓库搜索者 在 `check_cn` 里把四个标准标签词排除掉
- 阅读 A 旧版干扰项（本次抽到 2021-21、2022-37、2025-29、2025-34）等 `expert/english1-reading-distractors` 那 98 道改完再复抽
