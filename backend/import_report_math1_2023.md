# 题库导入报告 · math1_2023.json

生成时间：2026/11/1 07:18:01（太平洋时间）

- 源文件：`/workspace/tiku/math1_2023.json`（只读，未修改；文件修改时间 2026/11/1 06:27:05 太平洋时间）
- 知识点树：`/workspace/tiku/knowledge_tree.json`，4 个科目 / 29 章 / 144 个知识点（paths 字段 144 条），tree 与 paths 一致
- 知识点标签补充：`/workspace/tiku/math1_2023_kp_tags.json`，22 题从这里取了标签
- 题目：22 道已导入；没有错误级问题的 22 道，有错误级问题的 0 道
- 带解析（solution）的：22 道
- 图片：引用 0 处，缺失 0 处（按 `/workspace/tiku` 解析；后端经 `/api/v1/assets/<相对路径>` 提供）
- 校对状态（源文件）：confirmed 0，pending 22，suspect 0
- **校对状态（叠加校对记录后，入库）：confirmed 22，pending 0，suspect 0**

## 校对记录

- 文件：`/workspace/tiku/reviews/math1_2023.jsonl`（只读），有效记录 37 条 / 共 37 行
- 用上的题：22 道；状态有变化 22 道；答案被改写 1 道（另有 15 道记录里的答案与题目 JSON 一致）
- 坏行 0 行，未知 id 0 行，用了旧字段名 7 行，时间比现在晚 0 行

| 题号 | 状态（源文件 → 入库） | 校对人 | 记录数 | 最新时间 | 答案 |
|---|---|---|---|---|---|
| 1 | pending → **confirmed** | 用户 | 2 | 2026-11-01T05:10-08:00 | 一致 |
| 2 | pending → **confirmed** | 用户 | 2 | 2026-11-01T05:10-08:00 | 一致 |
| 3 | pending → **confirmed** | 用户、资料/仓库搜索者 | 3 | 2026-11-01T05:10-08:00 | 一致 |
| 4 | pending → **confirmed** | 用户、资料/仓库搜索者 | 3 | 2026-11-01T05:10-08:00 | 一致 |
| 5 | pending → **confirmed** | 用户 | 2 | 2026-11-01T05:10-08:00 | 一致 |
| 6 | pending → **confirmed** | 用户 | 1 | 2026-11-01T04:40:00-08:00 | 一致 |
| 7 | pending → **confirmed** | 用户、资料/仓库搜索者 | 2 | 2026-11-01T05:05:00-08:00 | 一致 |
| 8 | pending → **confirmed** | 用户 | 1 | 2026-11-01T05:00-08:00 | 一致 |
| 9 | pending → **confirmed** | 用户、资料/仓库搜索者 | 3 | 2026-11-01T05:10-08:00 | 一致 |
| 10 | pending → **confirmed** | 用户、资料/仓库搜索者 | 2 | 2026-11-01T05:02:00-08:00 | 一致 |
| 11 | pending → **confirmed** | 用户 | 1 | 2026-11-01T05:00-08:00 | 一致 |
| 12 | pending → **confirmed** | 用户 | 1 | 2026-11-01T05:00-08:00 | 一致 |
| 13 | pending → **confirmed** | 用户 | 1 | 2026-11-01T05:00-08:00 | 一致 |
| 14 | pending → **confirmed** | 用户 | 1 | 2026-11-01T05:00-08:00 | 一致 |
| 15 | pending → **confirmed** | 用户 | 2 | 2026-11-01T05:10-08:00 | ⚠️ 改写为 11/9 |
| 16 | pending → **confirmed** | 用户 | 1 | 2026-11-01T05:00-08:00 | 一致 |
| 17 | pending → **confirmed** | 行业专家 | 1 | 2026-11-01T04:55-08:00 | — |
| 18 | pending → **confirmed** | 行业专家 | 1 | 2026-11-01T04:55-08:00 | — |
| 19 | pending → **confirmed** | 行业专家 | 2 | 2026-11-01T05:05-08:00 | — |
| 20 | pending → **confirmed** | 行业专家 | 2 | 2026-11-01T05:05-08:00 | — |
| 21 | pending → **confirmed** | 行业专家 | 2 | 2026-11-01T05:05-08:00 | — |
| 22 | pending → **confirmed** | 行业专家 | 1 | 2026-11-01T04:55-08:00 | — |

旧字段名（已兼容，建议改成 id/by/at）：7 行，涉及 fix_request（并入 note）；行号 3、13、14、15、16、17、24

## 按问题类型汇总

| 类型 | 说明 | 级别 | 出现次数 | 涉及题数 | 题号 |
|---|---|---|---|---|---|
| `sub_question_score_missing` | 小问缺分值 | 提醒 | 9 | 4 | 17、20、21、22 |
| `answer_overridden_by_review` | 答案被校对记录（reviews/*.jsonl）改写，和题目 JSON 不一样 | 提醒 | 1 | 1 | 15 |

## 逐题明细

| 题号 | 题型 | 校对状态 | 知识点（来源/置信度） | 解析 | 问题 |
|---|---|---|---|---|---|
| 1 | single_choice | confirmed | 渐近线、未定式极限（洛必达、泰勒）（标签文件/high） | 有 | ✅ 无 |
| 2 | single_choice | confirmed | 常系数线性微分方程（标签文件/high） | 有 | ✅ 无 |
| 3 | single_choice | confirmed | 求导法则（复合、隐函数、参数方程、反函数）、高阶导数、导数与微分的概念（标签文件/high） | 有 | ✅ 无 |
| 4 | single_choice | confirmed | 常数项级数的敛散性（标签文件/high） | 有 | ✅ 无 |
| 5 | single_choice | confirmed | 矩阵的秩、分块矩阵（标签文件/high） | 有 | ✅ 无 |
| 6 | single_choice | confirmed | 矩阵的相似对角化（标签文件/high） | 有 | ✅ 无 |
| 7 | single_choice | confirmed | 线性组合与线性表示、齐次方程组的解（标签文件/high） | 有 | ✅ 无 |
| 8 | single_choice | confirmed | 离散型随机变量与常见分布、数学期望（标签文件/high） | 有 | ✅ 无 |
| 9 | single_choice | confirmed | 卡方分布、t分布、F分布、正态总体的抽样分布（标签文件/high） | 有 | ✅ 无 |
| 10 | single_choice | confirmed | 估计量的评选标准、数学期望（标签文件/high） | 有 | ✅ 无 |
| 11 | fill_blank | confirmed | 无穷小与无穷大及其比较、未定式极限（洛必达、泰勒）（标签文件/high） | 有 | ✅ 无 |
| 12 | fill_blank | confirmed | 空间曲线的切线与曲面的切平面（标签文件/high） | 有 | ✅ 无 |
| 13 | fill_blank | confirmed | 傅里叶级数（标签文件/high） | 有 | ✅ 无 |
| 14 | fill_blank | confirmed | 定积分的概念与性质（标签文件/high） | 有 | ✅ 无 |
| 15 | fill_blank | confirmed | 线性组合与线性表示、非齐次方程组的解（标签文件/high） | 有 | ⚠️ 答案被校对记录（reviews/*.jsonl）改写，和题目 JSON 不一样（answer） |
| 16 | fill_blank | confirmed | 二维离散型分布、随机变量的独立性（标签文件/high） | 有 | ✅ 无 |
| 17 | essay | confirmed | 微分方程的应用、一阶微分方程、最值与应用、变限积分（标签文件/high） | 有 | ⚠️ 小问缺分值（sub_questions[0]）<br>⚠️ 小问缺分值（sub_questions[1]） |
| 18 | essay | confirmed | 多元函数极值与条件极值（标签文件/high） | 有 | ✅ 无 |
| 19 | essay | confirmed | 第二类曲面积分与高斯公式、三重积分（标签文件/high） | 有 | ✅ 无 |
| 20 | essay | confirmed | 泰勒公式、闭区间上连续函数的性质（标签文件/high） | 有 | ⚠️ 小问缺分值（sub_questions[0]）<br>⚠️ 小问缺分值（sub_questions[1]） |
| 21 | essay | confirmed | 化二次型为标准形、惯性定理与规范形、相似矩阵（标签文件/high） | 有 | ⚠️ 小问缺分值（sub_questions[0]）<br>⚠️ 小问缺分值（sub_questions[1]） |
| 22 | essay | confirmed | 方差、边缘分布与条件分布、随机变量的独立性、两个随机变量函数的分布（标签文件/high） | 有 | ⚠️ 小问缺分值（sub_questions[0]）<br>⚠️ 小问缺分值（sub_questions[1]）<br>⚠️ 小问缺分值（sub_questions[2]） |

## 问题详情

### 第 15 题 `math1-2023-15`（confirmed）
- ⚠️ **答案被校对记录（reviews/*.jsonl）改写，和题目 JSON 不一样** · `answer`：["$\\frac{11}{9}$"] → ["11/9"]（用户）
- 源文件里的校对备注：用户（2026-11-01T05:00-08:00）：四个向量跟原卷一致，OCR 残留的「+k4α4」「β=3」已经去掉。α1、α2、α3 两两正交，k1=1/3、k2=-1、k3=-1/3，平方和 11/9，答案对。题干在「γ=k1α1+…；用户（2026-11-01T05:00-08:00）修改请求：题干里删掉「k_{3}\alpha_{3}$ ,」后面的「\n\n」，直接接「若」；用户（2026-11-01T05:10-08:00）：复查：fix_request 已按要求改好，题干完整，确认。

### 第 17 题 `math1-2023-17`（confirmed）
- ⚠️ **小问缺分值** · `sub_questions[0]`：小问没有分值，入库时按整题分值平均估算（score_estimated）
- ⚠️ **小问缺分值** · `sub_questions[1]`：小问没有分值，入库时按整题分值平均估算（score_estimated）
- 源文件里的校对备注：行业专家（2026-11-01T04:55-08:00）：答案与官方一致：y=x(2-ln x)，最大值 e^4/4-5/4，SymPy 已验。

### 第 20 题 `math1-2023-20`（confirmed）
- ⚠️ **小问缺分值** · `sub_questions[0]`：小问没有分值；证明题不拆分，按整题计分（score_by_whole）
- ⚠️ **小问缺分值** · `sub_questions[1]`：小问没有分值；证明题不拆分，按整题计分（score_by_whole）
- 源文件里的校对备注：行业专家（2026-11-01T04:55-08:00）：题干（1）「若 f(x)=0」应为「若 f(0)=0」。解析（II）里 γ 应介于 x0 与 x 之间，γ1∈(-a,x0)、γ2∈(x0,a)，原文写成 0；M 的定义括号错位，应…；行业专家（2026-11-01T05:05-08:00）：第（I）问条件已改为 f(0)=0，解析中 γ 的范围已改为介于 x0 与 x 之间，确认。

### 第 21 题 `math1-2023-21`（confirmed）
- ⚠️ **小问缺分值** · `sub_questions[0]`：小问没有分值，入库时按整题分值平均估算（score_estimated）
- ⚠️ **小问缺分值** · `sub_questions[1]`：小问没有分值，入库时按整题分值平均估算（score_estimated）
- 源文件里的校对备注：行业专家（2026-11-01T04:55-08:00）：解析第一行把 2x3^2 抄成 x3^2（配方结果是对的）。P=[[1,-1,1],[0,1,0],[0,0,1]] 已验，tr(A)=5≠tr(B)=3 的结论正确。；行业专家（2026-11-01T05:05-08:00）：解析第一行已改回 2x3^2，确认。

### 第 22 题 `math1-2023-22`（confirmed）
- ⚠️ **小问缺分值** · `sub_questions[0]`：小问没有分值，入库时按整题分值平均估算（score_estimated）
- ⚠️ **小问缺分值** · `sub_questions[1]`：小问没有分值，入库时按整题分值平均估算（score_estimated）
- ⚠️ **小问缺分值** · `sub_questions[2]`：小问没有分值，入库时按整题分值平均估算（score_estimated）
- 源文件里的校对备注：行业专家（2026-11-01T04:55-08:00）：D(X)=D(Y)=1/3，边缘密度和 f_Z(z)=2z（0<z<1）均已验。
