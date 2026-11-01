/** 客观题判分：选择题比字母集合，填空题比规整后的 LaTeX/文本 */
export function normalizeAnswer(s: string): string {
  return String(s)
    .replace(/\$/g, '')
    .replace(/\\dfrac|\\tfrac/g, '\\frac')
    .replace(/\\left|\\right|\\,|\\!|\\;|\\ /g, '')
    .replace(/\\geqslant/g, '\\geq').replace(/\\leqslant/g, '\\leq')
    .replace(/[{}\s]/g, '')
    .replace(/[。.．]+$/, '')
    .toLowerCase();
}

export function gradeObjective(type: string, correct: string[], given: string[]): boolean | null {
  if (!correct?.length) return null;
  if (/choice/.test(type) || type === 'match') { // match = 英语阅读 B，一个字母
    const a = [...new Set(correct.map((x) => x.trim().toUpperCase()))].sort().join(',');
    const b = [...new Set((given || []).map((x) => String(x).trim().toUpperCase()))].sort().join(',');
    return a === b;
  }
  if (type === 'fill_blank') {
    if (!given?.length) return false;
    return correct.length === given.length && correct.every((c, i) => normalizeAnswer(c) === normalizeAnswer(given[i]));
  }
  return null; // 解答题：靠自评或后续 AI 批改
}

export function fromSelfRating(r?: string | null): boolean | null {
  if (r === 'full') return true;
  if (r === 'approach_ok_calc_wrong' || r === 'no_idea') return false;
  return null;
}

// ───────────── 分值与自评计分（统筹者定的规则） ─────────────
// - 计算题：小问没分值时按整题平均拆（0.5 取整，标 score_estimated），自评按小问算
// - 计分方式优先级（统筹者定，见 resolveScoreByWhole）：kp_tags 明写 score_by_whole=true → 整题；kp_tags 明写 sub_scores → 按小问；
//   kp_tags 明写 score_by_whole=false → 按小问；题目 JSON 自带 score_by_whole → 用它；都没写 → 自动识别：证明题整题计分
// - 整题计分：不拆分，小问分值留空，score_by_whole=true，自评只按整题算
// - 自评：全对 = 满分，思路对但算错 = 一半，没思路 = 0

const PROOF_RE = /证明|求证/;
const PROOF_ANSWER_RE = /^\s*[（(]?\d*[)）]?\s*证明|证明题|证明见|证毕|得证/;

/** 这道题是否整题按证明题计分（多小问时须每问都是证明）。看 type、题干、小问题干、答案。选择/填空题永远不是 */
export function isProofQuestion(q: { type?: string; stem?: string; answer?: any; sub_questions?: any[] }): boolean {
  if (/choice|fill/.test(q.type ?? '') || q.type === 'match') return false;
  if (/proof/.test(q.type ?? '')) return true;
  const ans = (a: any) => (Array.isArray(a) ? a : a == null ? [] : [a]).map(String);
  const subs = q.sub_questions ?? [];
  // 有多个小问：只有每一问都是证明才整题计分；混合题按小问分开计分（统筹者/行业专家定的口径）
  if (subs.length >= 2) return subs.every((s: any) => PROOF_RE.test(s?.stem ?? '') || ans(s?.answer).some((a) => PROOF_ANSWER_RE.test(a)));
  if (PROOF_RE.test(q.stem ?? '')) return true;
  if (ans(q.answer).some((a) => PROOF_ANSWER_RE.test(a))) return true;
  return subs.some((s: any) => PROOF_RE.test(s?.stem ?? '') || ans(s?.answer).some((a) => PROOF_ANSWER_RE.test(a)));
}

export type ScoreModeSource = 'kp_tags.score_by_whole' | 'kp_tags.sub_scores' | 'question_json' | 'auto_proof';
/** 定一道题是整题计分还是按小问计分。kp_tags（行业专家）明写的优先，都没写才按证明题自动识别 */
export function resolveScoreByWhole(o: { tagScoreByWhole?: boolean | null; tagSubScores?: any; jsonScoreByWhole?: any; q: any }): { score_by_whole: boolean; source: ScoreModeSource } {
  if (o.tagScoreByWhole === true) return { score_by_whole: true, source: 'kp_tags.score_by_whole' };
  if (o.tagSubScores != null) return { score_by_whole: false, source: 'kp_tags.sub_scores' };
  if (o.tagScoreByWhole === false) return { score_by_whole: false, source: 'kp_tags.score_by_whole' };
  if (typeof o.jsonScoreByWhole === 'boolean') return { score_by_whole: o.jsonScoreByWhole, source: 'question_json' };
  return { score_by_whole: isProofQuestion(o.q), source: 'auto_proof' };
}

/** 题目对象顶层 sub_scores：按 sub_questions[].score 排出来；没有小问或整题计分（score_by_whole=true）→ null（不返回 [null]）。p = 表别名前缀，如 'q.' */
export const subScoresSql = (p = '') =>
  `CASE WHEN jsonb_array_length(COALESCE(${p}sub_questions,'[]'::jsonb))=0 OR ${p}score_by_whole IS TRUE THEN NULL ELSE (SELECT jsonb_agg(s->'score' ORDER BY i) FROM jsonb_array_elements(${p}sub_questions) WITH ORDINALITY t(s,i)) END AS sub_scores`;

export const RATING_FRACTION: Record<string, number> = { full: 1, approach_ok_calc_wrong: 0.5, no_idea: 0 };

/** 这次作答的满分：带 sub_number 且题目按小问计分时取小问分值，否则取整题分值 */
export function maxPointsFor(q: { score?: number | null; score_by_whole?: boolean; sub_questions?: any[] }, subNumber?: number | null): number | null {
  if (subNumber != null && !q.score_by_whole) {
    const s = (q.sub_questions ?? []).find((x: any) => Number(x?.number) === Number(subNumber));
    if (s?.score != null) return Number(s.score);
  }
  return q.score == null ? null : Number(q.score);
}

/** 得分：客观题对=满分错=0；主观题按自评比例；都没有返回 null（待自评） */
export function pointsFor(max: number | null, objective: boolean | null, rating?: string | null): number | null {
  if (max == null) return null;
  if (objective != null) return objective ? max : 0;
  if (rating && rating in RATING_FRACTION) return Math.round(max * RATING_FRACTION[rating] * 2) / 2;
  return null;
}
