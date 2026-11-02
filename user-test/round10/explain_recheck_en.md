# 英语一讲解复抽（round10 · 复查 a553cb1）

- 复抽人：用户（讲解抽查）
- 时间：2026-11-02 12:30（北京时间 UTC+8）
- 对象：分支 `expert/english1-2020-2025-explain-fix` @ a553cb1，在 /tmp/wt-recheck 临时 worktree 里只读；题库、讲解文件均未改，也没有提交
- 标准：tiku/explanation_review_standard_en.md
- 新抽种子：20261102-2，避开上轮 48 题；完形优先从专家自查改过的 33 题中抽，阅读优先从补了干扰项的 22 题中抽

## 结论

| 部分 | 抽查数 | pass | fail |
|---|---|---|---|
| 上轮 10 个 fail 加脚本查出的 2 个 | 12 | 12 | 0 |
| 新抽（6 翻译 + 12 完形 + 6 阅读） | 24 | 22 | 2 |

- 新抽 fail：english1-2020-13（“照此推理”就是第 12 空 On the basis of 的意思）、english1-2025-40（A、B 干扰项原样保留，没标错因类型，也没有原文依据）
- `check_cloze_leak.py`（分支自带版本，设了 ECDICT_CSV）：**退出码 0**，2020–2025 每年 leaks 0
- 补充：拿 `origin/tiku/cloze-leak-rule3` 的新版脚本跑同一份数据，退出码 0、leaks 0，中文疑似 29 条（只提醒，不计入退出码）。其中抽到的 2023-11、2024-10、2025-14 我人工看过，都是误报

## 机器核对（36 题全部通过）
- 答案：分支相对 origin/main 没改任何 `tiku/english1_*.json` 或 passages 文件；讲解里的答案与题库一致
- 引文：完形和阅读讲解里的英文引句都能在原文中逐字找到；翻译各得分点的中文都是参考译文的子串（“……”拆写的两段各自在参考译文里）。参考译文与题库逐字一致，30 道翻译题都是 4 个得分点、合计 2 分、3 条常见误译
- 乱码：没有 U+FFFD、HTML 实体或残留标签

## 一、复查（12 题）
| 题号 | 题型 | 题库答案 | 结论 | 理由 |
|---|---|---|---|---|
| english1-2020-46 | 翻译 | （文本） | **pass** | 4 个得分点各 0.5 分共 2 分，译法与参考译文逐字一致；3 条误译（eclipse 本义、bridged 误解、intellectual territories）真实常见。 |
| english1-2021-47 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致；误译 rose 主语、entry、before the war 挂错都合理。小瑕疵：“in those societies”放进了第①点而非第②点，不影响给分。 |
| english1-2022-50 | 翻译 | （文本） | **pass** | 4 点共 2 分，①用“正如破译密码……具有更广泛的意义”拆写，两段都在参考译文中；误译 speak volumes、so、wider relevance 合理。 |
| english1-2023-50 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致（“是……关键挑战之一”拆写）；误译名词化硬译、sensitive、critical 合理。 |
| english1-2024-49 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致；误译 volatile、odor signature、characteristic 词性合理。 |
| english1-2025-50 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致；误译 pool、think outside the box、formal setting 合理。 |
| english1-2020-19 | 完形 | C | **pass** | 已去掉“发布”，引句保留第 5 空，并略去第 7、8、20 空；线索标“上下文复现”，A/B/D 逐个给了错因。对照 20 空答案及释义，未见泄题。 |
| english1-2024-20 | 完形 | A | **pass** | 不再译“不宜用”，引原句 would constantly be opening for passers-by，未给出第 19 空 suit；线索改为“前后对比”，正确。 |
| english1-2025-20 | 完形 | A | **pass** | “说明”已删，改用 thriving≈robust 同句同义复现。边界提醒：“与纺织业兴旺相互印证”仍暗含证据关系，但不是 suggesting 的释义，不判泄题。 |
| english1-2024-17 | 完形 | D | **pass** | match/suit 已删；描述动作感应门不停开关、压力垫 limit the surveyed area，未出现第 19 空 suit 或第 20 空 appropriate 的释义（“相配”是本空 complement 的义项）。 |
| english1-2025-16 | 完形 | C | **pass** | 引句保留第 15 空（underwater archaeology ___ and tools），未再出现“技术”；employed=used 讲清，排除理由具体。 |
| english1-2020-24 | 阅读A | B | **pass** | A/C/D 已改成具体错因并标类型（正反颠倒/偷换概念），点出 Glasgow 紧跟 But it can be done 是论据而非新话题、非背景；定位第3段第6句逐字。 |

## 二、新抽（24 题）
| 题号 | 题型 | 题库答案 | 结论 | 理由 |
|---|---|---|---|---|
| english1-2020-48 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致；误译 suppress、rate 硬译、让步漏转折合理（“suppress 译成支持”略牵强）。 |
| english1-2021-46 | 翻译 | （文本） | **pass** | 4 点共 2 分，③“这一比例……基本保持不变”拆写在参考译文中；误译 came out of the war、enrollment、had been 时态合理。 |
| english1-2022-48 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致；误译 obscure、may or may not、not 的否定范围都是真实易错点。 |
| english1-2023-46 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致；误译 put out、regarding 挂错、并列三项合并合理。 |
| english1-2024-50 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致；误译 may well、patches、secondly 层次合理。 |
| english1-2025-47 | 翻译 | （文本） | **pass** | 4 点共 2 分逐字一致；误译 natural、engage、by…by 堆砌合理。 |
| english1-2020-02 | 完形 | A | **pass** | 词义辨析，match=与…相匹敌；用 great traditions 佐证，未泄露第 1、3 空。 |
| english1-2020-13 | 完形 | B | **fail** | 轻度泄题：写“同句前半引出 the precautionary principle……照此推理”，“照此”就是第 12 空 On the basis of 的意思（另三项 At the cost of / In addition to / In contrast to 被一并排除）。旧版“基于预防原则”只是换了说法；线索标“上下文呼应”，可以接受。 |
| english1-2021-15 | 完形 | D | **pass** | 由男女 differences 推出 treatments，排除理由给出，未泄露第 14 空 explain。 |
| english1-2021-16 | 完形 | B | **pass** | 标“逻辑关系（转承）”，用将来研究与当下对比推出 Meanwhile。边界提醒：“你眼下就能做的事”里的“做”接近第 17 空 take steps，但不是 take 的释义，不判泄题。 |
| english1-2022-09 | 完形 | A | **pass** | analogous=similar 复现，引文逐字（略去第 14 空）。小问题：后文 similar to… 其实是 Taiz 反驳“只是表面相似”，讲解说成“这些科学家认为两者相似”，归属不准。 |
| english1-2022-20 | 完形 | B | **pass** | 标“因果”，由逃不开、投资感知威胁系统推出 poor；“和 threat 打交道”未给出第 19 空 recognizes，第 18 空 danger 也略去。 |
| english1-2023-10 | 完形 | D | **pass** | 用下一句 sharing…interaction 推出 meeting point，未出现第 12 空 exchange 的释义（交换/交流）。 |
| english1-2023-11 | 完形 | D | **pass** | 标“因果”，上句原文保留第 10 空、本句保留第 12 空，无泄题。 |
| english1-2024-10 | 完形 | D | **pass** | 用 maximise the usable space 复现推出 occupied，引句未带第 11 空 allow。脚本提示的“占用”是本空答案，属误报。 |
| english1-2024-14 | 完形 | D | **pass** | 标“让步转折”，引句保留第 15 空 principles，排除理由清楚。 |
| english1-2025-12 | 完形 | A | **pass** | 标“转折”，“过了几十年考古学家才回来”没有说出第 13 空 undisturbed。 |
| english1-2025-14 | 完形 | C | **pass** | 时间线推出 resumed，并纠正原卷人名 Gallon→Gallou。边界提醒：“for decades 无人再来”接近第 13 空 undisturbed 的语义，但不是它的释义，不判泄题。 |
| english1-2020-23 | 阅读A | D | **pass** | 定位第3段第2、3句逐字；A/B/C 都标了类型并引原文（nudge the self-image、transform the aspirations、a great deal more than）。 |
| english1-2021-36 | 阅读A | C | **pass** | 定位第1段第1句逐字；A/B/D 错因具体。小问题：B 说“无中生有”，但末段 meddling in the traffic 才是这个干扰项的出处，没点到。 |
| english1-2022-27 | 阅读A | B | **pass** | 定位第2段第3、5句逐字；A/C/D 错因具体，D 用 secure route of social mobility 反证。 |
| english1-2023-38 | 阅读A | A | **pass** | 定位第3段第3句逐字；B/C/D 错因具体，C 引 cite a specific paper。 |
| english1-2024-25 | 阅读A | A | **pass** | 定位第6段第3句逐字，并用末段印刷术、太阳能板佐证；B/C/D 错因具体。 |
| english1-2025-40 | 阅读A | D | **fail** | 只改了 C；A“artifacts 泛指文物，文章重点是数字信息”、B“馆员的作用是论述的一部分，不是全文主旨”是原样保留：既没标错因类型，也没有原文依据（B 实为以偏概全，馆员只在第3–6段）。 |

## 三、边界提醒（不算 fail，建议顺手改）
- 2025-20“与纺织业兴旺相互印证”、2021-16“你眼下就能做的事”、2025-14“for decades 无人再来”：都贴近同篇另一空的意思，但不是那个答案的释义
- 2022-09：Taiz 说的是“只是表面相似”，讲解却写成“这些科学家认为两者相似”，归属不准
- 有几题的线索类型写成“上下文呼应”“因果”“转折”，不是标准里的四类（上下文复现 / 逻辑连接 / 固定搭配 / 词义辨析）。意思没错，建议统一
- 2021-36 B 选项：出处是末段 meddling in the traffic，讲解只写了“无中生有”，没点到这句

## 四、系统性提醒（阅读干扰项）
- 22 道改过的阅读题里，有 5 道只改了部分干扰项，其余是旧版短句：2023-32（A）、2023-39（D）、2024-22（B）、2025-39（B、D）、2025-40（A、B）
- 没改动的约 98 道阅读题仍是旧写法，比如“没提/没说……”，多数没标错因类型。上轮按“有具体理由”放过了这类写法，所以本轮不判 fail；如果要按“类型 + 原文依据”统一，需要专家再批量补一轮
