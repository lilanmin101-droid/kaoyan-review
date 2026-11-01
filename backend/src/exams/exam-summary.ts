import { ENGLISH_SECTION_KEYS, ENGLISH_SECTION_NAME, EnglishSection } from '../english/english-spec';

/**
 * 模考成绩汇总（纯函数，交卷 / 自评后都用它重算）：
 * 总分、分题型小计（选择/填空/解答）、分科得分率（高数/线代/概率）、按知识点的丢分、复盘结论、教练一句话。
 */

export type SubScoresSource = 'official' | 'estimated' | 'even_split';
export type SelfRating = 'full' | 'approach_ok_calc_wrong' | 'no_idea';
export const RATINGS: SelfRating[] = ['full', 'approach_ok_calc_wrong', 'no_idea'];

export interface SubScore { sub_number: number; score: number | null; score_estimated: boolean; self_rating: SelfRating | null; got: number | null }
export interface PerQuestion {
  question_id: string; number: number; type: string; section: string; objective: boolean;
  score: number; score_by_whole: boolean; score_estimated: boolean;
  sub_scores_source?: SubScoresSource | null; // 小问分值来源：official 题目自带 / estimated 行业专家估（非官方）/ even_split 按整题平均拆；没有小问分值为 null
  subject: SubjectKey | null; knowledge_points: string[];
  answered: boolean; answer: string[]; time_spent_seconds: number;
  correct_answer?: string[];           // 标准答案（客观题前端要展示）；answer 是考生作答
  reference_answer?: string | null;    // 主观题参考答案（翻译参考译文 / 写作范文 / 解答题答案）；客观题 null
  is_correct: boolean | null;          // null = 还没自评完
  got: number | null;                  // 已自评部分的得分；完全没自评为 null
  self_rating?: SelfRating | null;     // 整题自评（证明题 / 没有小问的解答题）
  sub_scores?: SubScore[];             // 计算题按小问自评
  wrong_question_id?: string | null;
  // 英语翻译 / 作文（统筹者定）：unanswered=true → 一律 0 分；submitted_self_rating = 没作答时提交上来的档（被改成 no_idea）
  unanswered?: boolean; submitted_self_rating?: SelfRating;
  word_count?: number; min_words?: number; self_grade_flags?: string[]; // 字数低于线但评了「基本到位 / 大概一半」→ ["word_count_low"]
}

export type SubjectKey = 'calculus' | 'linear_algebra' | 'probability' | EnglishSection; // 英语卷的「分科」就是六个部分
export const SUBJECTS: { key: SubjectKey; name: string; prefix: string }[] = [
  { key: 'calculus', name: '高数', prefix: '高等数学' },
  { key: 'linear_algebra', name: '线代', prefix: '线性代数' },
  { key: 'probability', name: '概率', prefix: '概率论与数理统计' },
];
/** 按第一个知识点标签的一级路径归科 */
export function subjectOf(kps: string[] | null | undefined): SubjectKey | null {
  const first = (kps ?? [])[0];
  if (!first) return null;
  return SUBJECTS.find((s) => first.split('/')[0] === s.prefix)?.key ?? null;
}

export const SECTION_ORDER = ['选择题', '填空题', '解答题', ...ENGLISH_SECTION_KEYS];
export function sectionOf(q: { section?: string | null; type: string }) {
  if (q.section && SECTION_ORDER.includes(q.section)) return q.section;
  if (/choice/.test(q.type)) return '选择题';
  if (/fill/.test(q.type)) return '填空题';
  return '解答题';
}

const half = (x: number) => Math.round(x * 2) / 2;
const r1 = (x: number) => Math.round(x * 10) / 10;
const rate = (got: number, max: number) => (max ? Math.round((got / max) * 1000) / 1000 : null);
const pct = (x: number | null) => (x == null ? '-' : `${Math.round(x * 100)}%`);

/** 一道题「已自评/已判分」部分的满分和得分（待自评的部分不计入丢分） */
function graded(p: PerQuestion): { max: number; got: number; pendingMax: number } {
  if (p.objective) return { max: p.score, got: p.got ?? 0, pendingMax: 0 };
  if (p.sub_scores?.length) {
    let max = 0, got = 0, pendingMax = 0;
    for (const s of p.sub_scores) {
      if (s.self_rating) { max += s.score ?? 0; got += s.got ?? 0; } else pendingMax += s.score ?? 0;
    }
    return { max, got, pendingMax };
  }
  return p.self_rating ? { max: p.score, got: p.got ?? 0, pendingMax: 0 } : { max: 0, got: 0, pendingMax: p.score };
}

export function summarize(per: PerQuestion[], ctx: { title: string; duration_seconds: number; elapsed_seconds: number }) {
  const maxScore = per.reduce((s, p) => s + (p.score || 0), 0);
  const score = half(per.reduce((s, p) => s + (p.got ?? 0), 0));
  const pending = per.filter((p) => p.is_correct === null);
  const pendingPoints = half(per.reduce((s, p) => s + graded(p).pendingMax, 0));

  const sections = SECTION_ORDER.map((name) => {
    const ps = per.filter((p) => p.section === name);
    return {
      section: name, name: ENGLISH_SECTION_NAME[name] ?? name, count: ps.length, max_score: ps.reduce((s, p) => s + p.score, 0), score: half(ps.reduce((s, p) => s + (p.got ?? 0), 0)),
      correct: ps.filter((p) => p.is_correct === true).length, wrong: ps.filter((p) => p.is_correct === false).length, pending: ps.filter((p) => p.is_correct === null).length,
      pending_points: half(ps.reduce((s, p) => s + graded(p).pendingMax, 0)),
    };
  }).filter((s) => s.count);

  const english = per.some((p) => ENGLISH_SECTION_KEYS.includes(p.section));
  const subjectDefs: { key: SubjectKey; name: string }[] = english
    ? ENGLISH_SECTION_KEYS.map((k) => ({ key: k as SubjectKey, name: ENGLISH_SECTION_NAME[k] }))
    : SUBJECTS;
  const subjects = subjectDefs.map((sj) => {
    const ps = per.filter((p) => (english ? p.section : p.subject) === sj.key);
    const max = ps.reduce((s, p) => s + p.score, 0);
    const got = half(ps.reduce((s, p) => s + (p.got ?? 0), 0));
    const pend = half(ps.reduce((s, p) => s + graded(p).pendingMax, 0));
    const lost = half(ps.reduce((s, p) => { const g = graded(p); return s + (g.max - g.got); }, 0));
    // rate：得分 / 满分（待自评按 0）；graded_rate：只看已判分/已自评部分（结论和教练句用它，没评的不算丢分）
    return { subject: sj.key, name: sj.name, question_count: ps.length, max_score: max, score: got, rate: rate(got, max), graded_max: half(max - pend), graded_rate: rate(got, max - pend), lost, pending_points: pend };
  }).filter((s) => s.question_count);

  // 丢分按知识点：一道题丢的分平均摊到它的每个知识点标签上
  const kpMap = new Map<string, { kp_path: string; name: string; subject: SubjectKey | null; lost: number; question_numbers: number[] }>();
  for (const p of per) {
    const g = graded(p);
    const lost = g.max - g.got;
    if (lost <= 0) continue;
    const kps = p.knowledge_points?.length ? p.knowledge_points : ['未标知识点'];
    for (const kp of kps) {
      const e = kpMap.get(kp) ?? { kp_path: kp, name: kp.split('/').pop()!, subject: subjectOf([kp]), lost: 0, question_numbers: [] };
      e.lost += lost / kps.length;
      if (!e.question_numbers.includes(p.number)) e.question_numbers.push(p.number);
      kpMap.set(kp, e);
    }
  }
  const lostByKp = [...kpMap.values()].map((e) => ({ ...e, lost: r1(e.lost) })).sort((a, b) => b.lost - a.lost || a.question_numbers[0] - b.question_numbers[0]);

  // 复盘结论（先给结论）
  const conclusions: string[] = [];
  conclusions.push(`得分 ${score}/${maxScore}${pendingPoints ? `（还有 ${pendingPoints} 分待自评）` : ''}，用时 ${Math.round(ctx.elapsed_seconds / 60)} 分钟。`);
  const gradedSubjects = subjects.filter((s) => s.max_score - s.pending_points > 0);
  if (gradedSubjects.length >= 2) {
    const weak = [...gradedSubjects].sort((a, b) => (a.graded_rate ?? 1) - (b.graded_rate ?? 1))[0];
    conclusions.push(`${weak.name}得分率最低（${pendingPoints ? `已评部分 ${pct(weak.graded_rate)}` : pct(weak.graded_rate)}，丢 ${weak.lost} 分${weak.pending_points ? `，另有 ${weak.pending_points} 分待自评` : ''}）。`);
  }
  if (lostByKp.length) conclusions.push(`丢分最多的知识点：${lostByKp.slice(0, 3).map((k) => `${k.name}（${k.lost} 分）`).join('、')}。`);
  if (maxScore) {
    const overtime = per.filter((p) => p.time_spent_seconds)
      .map((p) => ({ ...p, expected: Math.round((p.score / maxScore) * ctx.duration_seconds) }))
      .filter((p) => p.time_spent_seconds > p.expected * 1.5 && p.time_spent_seconds - p.expected >= 300)
      .sort((x, y) => (y.time_spent_seconds - y.expected) - (x.time_spent_seconds - x.expected));
    for (const p of overtime.slice(0, 3)) conclusions.push(`第 ${p.number} 题多花了 ${Math.round((p.time_spent_seconds - p.expected) / 60)} 分钟${p.is_correct === false ? '，而且没做对' : ''}，下次先跳过，最后再回来。`);
  }
  const unanswered = per.filter((p) => p.objective && !p.answered).map((p) => p.number);
  if (unanswered.length) conclusions.push(unanswered.length > 5 ? `有 ${unanswered.length} 道客观题没作答。` : `第 ${unanswered.join('、')} 题没作答。`);
  if (pending.length) conclusions.push(`第 ${pending.map((p) => p.number).join('、')} 题还没自评，自评完才算出最终分数。`);

  return {
    score, max_score: maxScore, score_rate: rate(score, maxScore), pending_points: pendingPoints,
    elapsed_seconds: ctx.elapsed_seconds, duration_seconds: ctx.duration_seconds,
    sections, subjects, lost_by_kp: lostByKp, conclusions,
    pending_self_rating: pending.map((p) => p.question_id),
    wrong_question_ids: per.filter((p) => p.is_correct === false || (p.sub_scores ?? []).some((s) => s.self_rating && s.self_rating !== 'full')).map((p) => p.question_id),
    per_question: per,
  };
}

/** 教练一句话：引用真实分数，点出拖后腿的科目和丢分最多的知识点 */
export function coachHeadline(s: ReturnType<typeof summarize>, title: string) {
  const head = `${title}模考 ${s.score}/${s.max_score}`;
  if (s.score >= s.max_score) return `${head}，满分，保持这个节奏。`;
  const subs = s.subjects.filter((x) => x.max_score > 0);
  const weak = [...subs].sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1))[0];
  const top = s.lost_by_kp[0];
  const kp = top ? `，丢分最多的是「${top.name}」（${top.lost} 分），先把它补上` : '';
  if (!weak) return `${head}${kp}。`;
  if ((weak.rate ?? 0) >= 0.8) return `${head}，${subs.length === 3 ? '三科' : '各部分'}得分率都在 80% 以上，${weak.name}相对最弱（${pct(weak.rate)}）${kp}。`;
  return `${head}，${weak.name}拖了后腿（得分率 ${pct(weak.rate)}，丢 ${weak.lost} 分）${kp}。`;
}

export function coachDetails(s: ReturnType<typeof summarize>) {
  return [
    `分题型：${s.sections.map((x) => `${x.section} ${x.score}/${x.max_score}`).join('，')}`,
    `分科：${s.subjects.map((x) => `${x.name} ${x.score}/${x.max_score}（${pct(x.rate)}）`).join('，')}`,
    s.lost_by_kp.length ? `丢分知识点：${s.lost_by_kp.slice(0, 5).map((k) => `${k.name} ${k.lost} 分`).join('，')}` : '',
  ].filter(Boolean).join('\n');
}

/** 机判题型（和 submit 判分同一口径）：选择 / 填空 / 英语阅读 B 的 match */
export const isObjectiveType = (type: string | null | undefined) => /choice|fill/.test(type ?? '') || type === 'match';

/**
 * 模考分数拆分（列表 / 详情 / result 同一份），按这场的题现算，不写死满分：
 * - objective_*：机判题（选择 / 填空 / match）。数一 2015–2020 是 56 分、2021 起 80 分；英一 60 分
 * - subjective_*：自评题（数学解答题、英语翻译 / 作文）。subjective_max 数一 94 / 70、英一 40
 *   - subjective_self_raw：全部自评分（含字数太少的），objective_score + subjective_self_raw == score（没有 AI 分时）
 *   - subjective_self_score：去掉 word_count_low 后的自评分，估分 / 趋势用它
 *   - subjective_excluded_points / _count：因 word_count_low 没计入的分和题数（数学没有字数线，恒 0）
 *   - subjective_ai_score：预留给以后 AI 批改，现在 null
 * 这场没有自评题 → subjective_* 全 null；没有机判题 → objective_* 全 null；没交卷 → 只给 *_max，分数类 null
 * paper：没交卷时（没有 per_question）用这场题目的机判 / 自评满分
 */
export function scoreSplit(per: any[] | null | undefined, score: number | null, paper?: { objective_max?: number | null; subjective_max?: number | null } | null) {
  const r2 = (x: number) => Math.round(x * 2) / 2;
  const sum = (xs: any[], f: (p: any) => number) => r2(xs.reduce((t, p) => t + (Number(f(p)) || 0), 0));
  const has = Array.isArray(per) && per.length > 0;
  const obj = has ? per!.filter((p) => p.objective) : [], sub = has ? per!.filter((p) => !p.objective) : [];
  const objMax = has ? sum(obj, (p) => p.score) : Number(paper?.objective_max ?? 0);
  const subMax = has ? sum(sub, (p) => p.score) : Number(paper?.subjective_max ?? 0);
  const graded = has && score != null;
  const low = (p: any) => Array.isArray(p.self_grade_flags) && p.self_grade_flags.includes('word_count_low');
  const hasObj = has ? obj.length > 0 : objMax > 0, hasSub = has ? sub.length > 0 : subMax > 0;
  return {
    objective_score: hasObj && graded ? sum(obj, (p) => p.got) : null,
    objective_max: hasObj ? objMax : null,
    subjective_self_score: hasSub && graded ? sum(sub.filter((p) => !low(p)), (p) => p.got) : null,
    subjective_self_raw: hasSub && graded ? sum(sub, (p) => p.got) : null,
    subjective_excluded_points: hasSub && graded ? sum(sub.filter(low), (p) => p.got) : null,
    subjective_excluded_count: hasSub && graded ? sub.filter(low).length : null,
    subjective_max: hasSub ? subMax : null,
    subjective_ai_score: null as number | null,
  };
}
