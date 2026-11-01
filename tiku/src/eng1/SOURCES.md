# 英语一 原始资料来源（资料/仓库搜索者，2026-11-01 PT）

| 目录 | 仓库 | 文件 | 年份覆盖 | 许可 | 用途 |
|---|---|---|---|---|---|
| liziak112/ | github.com/LIziak112/structured-kaoyan-english（commit 见 liziak112/COMMIT） | data/<年>-1/<年>-1.json、.md、assets/ | 2015–2025 全部 52 题，均有答案；翻译 46–50 有参考译文，写作 51/52 有范文；大作文配图（2025 无配图文件） | 分层许可（liziak112/LICENSE.md）：题面/答案/选项/配图＝第一层，自由使用；`explanation` 解析字段＝CC BY-NC 4.0 基础上仅限非商业 | 主源。build_eng1.py 只读第一层字段，不取 explanation |
| echo/ | github.com/Echo1LZJY/echo-kaoyan-english-skill（commit 见 echo/COMMIT） | skills/kaoyan-english/references/papers/english-i/<年>/answers.json、question-map.json、meta.json | 2015–2025，1–45 客观题答案 | 仓库没有 LICENSE 文件（默认保留所有权利），只用来交叉核对答案，不拷题面 | 答案核对 |
| tsekaluk/ | github.com/TsekaLuk/Kaoyan-English1-Papers（commit 见 tsekaluk/COMMIT） | solutions/2024/english1_2024.md | 名为 2024，实际内容是 **2022** 年解析（同仓库 papers/english1_2024.pdf 也是 2022 年答案，已删）| 无 LICENSE | 不使用，仅留档说明 |

其它看过但没下载：m2kar/KaoYan-English（仅到 2020，PDF/Word，无许可）、JimmyKudo16/KaoYan-English_1（文件在百度网盘，需要登录）、ayaka-notes/201-english（LaTeX，到 2023）、tsukiyou/kaoyan_English1_2010-2025（作者声明 AI 生成、不保证正确）。

## 两源答案比对（1–45 题）
- 一致：2015、2016、2017、2018、2019、2021、2022、2023、2024
- 2020：24 处不一致（第 1、3–20 题，第 36–40 题）。**已解决**：LIziak112 这 25 题的选项顺序被打乱（答案内容自洽，字母不对）。对照原卷扫描件（TsekaLuk 仓库 english1_from_github/english1_2020.pdf 第 1–2、6 页）与 kaoyan.b2cedu.com 原卷选项顺序后，build 时按原卷顺序重排（supplements/2020.json 的 option_order）；重排后字母与 Echo1LZJY 和公开答案（1–5 CABDA…）一致。注意懒笔记 2020 页也沿用了打乱后的顺序，不能当独立来源。
- 2025：第 39 题 LIziak112=C，Echo=D。**已解决为 C**（过级鸭、懒笔记、英语真题网、启航版解析一致，内容也对应 C）。

## 说明
- 翻译参考译文和写作范文都不是考试院官方发布的（官方只公布评分标准）
- 2024 年题面里改掉的明显 OCR 错误见 pipeline/build_eng1.py 的 FIXES

## 补充与修正（2026-11-01 PT，第二轮）
- `supplements/<年>.json`：源缺失题干的补全（2022 第 45 题 John Fraser，三处公开页面一致）、选项重排（2020）、复核备注（2025 Q39）。
- 逐年 OCR 修正：pipeline/build_eng1.py 的 `YEAR_FIXES`（纯字符串、命中会打印）和通用 `FIXES`；2021 Part B directions 源里误抄成小标题题型说明，按懒笔记整卷页改成选句填空（`DIRECTIONS_FIX`）。
- 2024 原卷核对修正层：pipeline/fix_english1_2024.py（用户对照 src/eng1/verify2024/ 官方原卷逐条给出；可重复运行，build 后自动调用）。
- 2025 Text 4：LIziak112 缺 “One of S. R. Ranganathan’s foundational Laws of Library Science is ‘Save the time of the reader.’” 一句（过级鸭和 kaoyan.cn 考试当天 PDF 都有，且后句 “Thus, …” 需要它），已补；“digital replace analog”→“replaces”。kaoyan.cn 当天 PDF 的 Text 2/Text 4 其它段落与 LIziak112、过级鸭、英语真题网都不同，判断为早期回忆版，不采用。
- 注意：TsekaLuk 仓库文件名不可靠（papers/english1_2021.pdf 实为 2015 年卷，solutions/2024 实为 2022）。

## 2026-11-01T07:28-08:00 资料/仓库搜索者：本轮修订

- **答案来源**：所有年份 Q46–52 都写 `answer_source: "expert"`。`source.answer_note` 说明参考译文和范文是专家参考答案（来自 LIziak112），不是考试院公布的标准答案。
- **2021（原卷扫描件 verify2021/xztu.pdf）**
  - LIziak112 和 Echo1LZJY 的 1–40 题、Part B 选项都打乱了。Echo 的乱序与 LIziak 相同，所以不是独立来源。
  - 已按原卷改回：supplements/2021.json 的 `option_order` 和 `partb_order`。答案跟随选项内容：1–40 = CDABAACBACDBCDDBDAACCBCDDBDCCAABDAACBBDA，41–45 = GCEBD。
  - 原文措辞：BY→EY，stem→stern（Q35C），deep-root、focus、Victorian’s，以及完形标点。
  - 写作：email；「at the end」；(10 points)；160-200；「interpret its intended meaning」。
  - 翻译：institution—this。
- **2020**：「traditions: the」，「you," said」。£500 to $5,000 不改。
- **2023**：Text 3 书名归位（The Bench / The President’s Daughter / The Bookseller），first-ever。翻译中的 Al→AI。Q51 题面原为乱序，已按懒笔记顺序改正，加 (10 points)；Q52 加 (20 points)。另：Fantasia/xztu 重排版写作是「You should write about 100 words… Do not use your own name at the end of the notice」，与懒笔记、LIziak 措辞不同，待原卷核。
- **2016**：Q52 题面 l) → 1)。
- **2017**：Q52 加 （图题：“有书”与“读书”）。依据：deyideyi、Fantasia 版式 PDF 都把图题印在图下。
- **2016、2019、2020**：图题印在图片里面（与其只提要求，不如做个榜样／途中／习惯），没有另加。2021–2024 原卷没有图题。2025 是表格。
- **2024**：Q48、Q50 参考译文按用户审阅改（fix_english1_2024.py）。
- **2025**
  - **完形**：按专家要求保留 Mycenaean 一句、In 1967（无逗号）、Gallou、{{14}} the excavation、The team identified 一句。
  - **原卷与当前数据的冲突（待定）**：本轮找到 2025 原卷版式整卷，见 verify2025/yeyulingfeng_ocr.txt 和 p1–p3 预览图。原卷完形是「around 3500 B.C. This area」（没有 Mycenaean 一句）、「In 1967,」、「Gallon」、「14 excavation of」（没有 the）。Text 4 原卷没有 Ranganathan 一句，是「digital replace analog」。
  - **Q52**：表格移到 `tables` 字段（后端约定：`[{caption, header, rows}]`，题面里用 `{{table:0}}` 标位置），并渲染为 images/english1-2025/q52_table.png（fix_english1_2025.py）。题面「160-200 based」「explain its intended meaning」「(20 points)」由原卷、deyideyi、yingyuzhenti、zemengzhou 四方一致确认；懒笔记的措辞是孤例。

## 2026-11-01T07:36:21-08:00 资料/仓库搜索者：来源优先级 + 2025 改以原卷扫描件为准

- **来源优先级（统筹者 + 行业专家定，长期规则）**：官方原卷 > 原卷版式重排 > 多源多数表决。
- **2025 英语一**：以原卷扫描件为底本（verify2025/yeyulingfeng_ocr.txt + yeyulingfeng_p1–p3 预览图；封面「绝密★启用前 / 科目代码 201」）。
  - build_eng1.py 里删掉了与原卷冲突的 6 条 YEAR_FIXES：Mycenaean 一句、1967 后逗号、Gallou、{{14}} the excavation、Text 4 的 Ranganathan 一句、replaces。
  - 原卷误印按原样保留：完形「Chrysanthi Gallon」（应为 Gallou）、Text 4「when digital replace analog」（应为 replaces）。说明写在题目字段 `errata` 里：english1-2025-14、english1-2025-39，由 fix_english1_2025.py 写入。
  - 另按原卷改：Q51「what they’ll Show?」→「show?」，并补「(10 points)」。
  - 与原卷逐句、逐题复核：其余差异都是 OCR 噪声。「the sky, the sea」「Disney+, Peacock」已看预览图，与我们一致。
  - Q52 表格用 `tables` 字段（后端约定 `[{caption, header, rows}]`），题面用 `{{table:0}}` 标位置，PNG 仍放在 images。
- **写作要点编号统一为半角**：2015 Q52、2017 Q52 的「1）2）3）」改为「1) 2) 3)」，2017「3)give」补空格。其余年份 Q51/Q52 没有全角编号。
