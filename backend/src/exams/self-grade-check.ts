import { countFor } from '../english/ai-grader';
import { gradingKind } from '../english/english-spec';

/** 英语翻译 / 作文自评的字数线（统筹者定）：小作文 < 50 词、大作文 < 80 词、翻译 < 参考译文字数的 30%（翻译是英译汉：汉字 + 英文词，作答和参考译文同一个数法） */
export const SELF_GRADE_MIN_WORDS: Record<string, number> = { writing_a: 50, writing_b: 80 };
export const TRANSLATION_MIN_RATIO = 0.3;

export interface SelfGradeCheck { kind: 'translation' | 'writing_a' | 'writing_b'; unanswered: boolean; word_count: number; min_words: number }

/** 不是英语翻译 / 作文 → null。没作答（空或只有空白）→ unanswered=true */
export function selfGradeCheck(q: { exam?: string; section?: string | null; type?: string; answer?: string[] | null }, answer: any): SelfGradeCheck | null {
  const kind = gradingKind(q as any);
  if (!kind) return null;
  const text = (Array.isArray(answer) ? answer : [answer]).filter((x: any) => x != null).map(String).join('\n').trim();
  const ref = (q.answer ?? []).map((x) => String(x ?? '')).join('\n');
  const min = kind === 'translation' ? Math.ceil(countFor(kind, ref) * TRANSLATION_MIN_RATIO) : SELF_GRADE_MIN_WORDS[kind];
  return { kind, unanswered: text === '', word_count: countFor(kind, text), min_words: min };
}

/**
 * 读成绩 / 错题时的字数字段：按存下的作答和自评档重算（老成绩没有这些字段；2c68743 起存下的翻译 min_words 曾按英文词数算成 0，一律以重算为准）。
 * 分数不重算。不是英语翻译 / 作文 → null。
 */
export function selfGradeFields(q: Parameters<typeof selfGradeCheck>[0], answer: any, selfRating: string | null | undefined) {
  const chk = selfGradeCheck(q, answer ?? []);
  if (!chk) return null;
  const r = selfRating ?? null;
  return { word_count: chk.word_count, min_words: chk.min_words, unanswered: chk.unanswered,
    self_grade_flags: !chk.unanswered && r && r !== 'no_idea' && chk.word_count < chk.min_words ? ['word_count_low'] : [] as string[] };
}
