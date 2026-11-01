import { assetBaseFor } from '../common/assets';
import { ENGLISH_SECTION_NAME, passageMarkers } from '../english/english-spec';
import { DbService } from '../db/db.service';

export const PASSAGE_COLS = `id, exam, year, section, title, directions, text, tables, images, options, subtype, source, sort_order, import_problems, updated_at`;

/**
 * 给前端的文章：原文 + 标记元数据（前端不用自己写正则）
 * - blanks：完形空位 {{n}}，[{number, question_id, start, end}]（start/end 是 text 里的字符位置，含花括号）
 * - underlines：翻译划线句 <u data-q="n">…</u>，[{number, question_id, text, start, end}]
 * - paragraphs：text 按空行切开的段落
 */
export function serializePassage(p: any, qs: { id: string; number: number }[] = []) {
  if (!p) return null;
  const byNo = new Map(qs.map((q) => [Number(q.number), q.id]));
  const mk = passageMarkers(p.text ?? '');
  const { source, sort_order, ...rest } = p;
  return {
    ...rest,
    section_name: ENGLISH_SECTION_NAME[p.section] ?? p.section,
    paragraphs: String(p.text ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean),
    blanks: mk.blanks.map((b) => ({ ...b, question_id: byNo.get(b.number) ?? null })),
    underlines: mk.underlines.map((u) => ({ ...u, question_id: byNo.get(u.number) ?? null })),
    question_ids: [...qs].sort((a, b) => a.number - b.number).map((q) => q.id),
    question_numbers: [...qs].map((q) => Number(q.number)).sort((a, b) => a - b),
    asset_base: assetBaseFor(source),
  };
}

/** 按 id 批量取文章（带引用它的题号） */
export async function loadPassages(db: DbService, ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map<string, any>();
  const rows = (await db.query(`SELECT ${PASSAGE_COLS} FROM passages WHERE id = ANY($1) ORDER BY sort_order`, [uniq])).rows;
  const qs = (await db.query(`SELECT id, number, passage_id FROM questions WHERE passage_id = ANY($1)`, [uniq])).rows;
  return new Map(rows.map((p: any) => [p.id, serializePassage(p, qs.filter((q: any) => q.passage_id === p.id))]));
}

/** 题目列表按文章分组（保持题号顺序；写作这类没有文章的题，每题单独一组 passage=null） */
export function groupByPassage(items: any[], passages: Map<string, any>) {
  const groups: { passage_id: string | null; section: string | null; section_name: string | null; passage: any; questions: any[] }[] = [];
  const at = new Map<string, number>();
  for (const q of items) {
    const pid = q.passage_id ?? null;
    if (pid && at.has(pid)) { groups[at.get(pid)!].questions.push(q); continue; }
    if (pid) at.set(pid, groups.length);
    groups.push({ passage_id: pid, section: q.section ?? null, section_name: ENGLISH_SECTION_NAME[q.section] ?? q.section ?? null, passage: pid ? passages.get(pid) ?? null : null, questions: [q] });
  }
  return groups;
}
