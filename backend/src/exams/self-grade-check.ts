import { countWords } from '../english/ai-grader';
import { gradingKind } from '../english/english-spec';

/** 英语翻译 / 作文自评的字数线（统筹者定）：小作文 < 50 词、大作文 < 80 词、翻译 < 参考译文词数的 30% */
export const SELF_GRADE_MIN_WORDS: Record<string, number> = { writing_a: 50, writing_b: 80 };
export const TRANSLATION_MIN_RATIO = 0.3;

export interface SelfGradeCheck { kind: 'translation' | 'writing_a' | 'writing_b'; unanswered: boolean; word_count: number; min_words: number }

/** 不是英语翻译 / 作文 → null。没作答（空或只有空白）→ unanswered=true */
export function selfGradeCheck(q: { exam?: string; section?: string | null; type?: string; answer?: string[] | null }, answer: any): SelfGradeCheck | null {
  const kind = gradingKind(q as any);
  if (!kind) return null;
  const text = (Array.isArray(answer) ? answer : [answer]).filter((x: any) => x != null).map(String).join('\n').trim();
  const ref = (q.answer ?? []).map((x) => String(x ?? '')).join('\n');
  const min = kind === 'translation' ? Math.ceil(countWords(ref) * TRANSLATION_MIN_RATIO) : SELF_GRADE_MIN_WORDS[kind];
  return { kind, unanswered: text === '', word_count: countWords(text), min_words: min };
}
