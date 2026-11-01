/**
 * 主观题参考答案（reference_answer）：翻译 = 参考译文，写作 = 范文，其他解答题 = 题库答案；取自 questions.answer（多段用空行拼接）。
 * 客观题（选择 / 填空 / 阅读 B 匹配）返回 null —— 它们用 correct_answer。
 */
export const isObjectiveType = (type: string) => /choice|fill/.test(type) || type === 'match';
export function referenceAnswer(q: { type: string; answer?: string[] | null } | null | undefined): string | null {
  if (!q || isObjectiveType(q.type)) return null;
  const s = (q.answer ?? []).map((x) => String(x ?? '').trim()).filter(Boolean).join('\n\n');
  return s || null;
}
