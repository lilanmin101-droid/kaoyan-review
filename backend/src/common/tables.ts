/**
 * 题干 / 文章里的结构化表格。
 * 数据：tables: [{ caption?: string, header?: string[], rows: string[][], note?: string }]
 * 引用：正文里写 {{table:N}}，N 是数组下标、从 0 开始（{{table:0}} = tables[0]，和题库数据一致）。和完形空位 {{n}}（纯数字）不冲突。
 */
export interface QuestionTable { caption?: string; header?: string[]; rows: string[][]; note?: string }
export const TABLE_MARKER_RE = /\{\{table:(\d+)\}\}/g;

export function tableMarkers(text: unknown): { n: number; start: number; end: number }[] {
  return [...String(text ?? '').matchAll(TABLE_MARKER_RE)].map((m) => ({ n: Number(m[1]), start: m.index!, end: m.index! + m[0].length }));
}

export type TableProblem = { type: 'table_invalid'; severity: 'error' | 'warn'; field: string; detail: string };

/** 校验表格结构 + 标记互相对应。texts：会引用表格的文本字段 [字段名, 文本] */
export function validateTables(tables: unknown, texts: [string, unknown][]): TableProblem[] {
  const out: TableProblem[] = [];
  const add = (severity: 'error' | 'warn', field: string, detail: string) => out.push({ type: 'table_invalid', severity, field, detail });
  const isStr = (x: unknown) => typeof x === 'string';
  let list: any[] = [];
  if (tables != null) {
    if (!Array.isArray(tables)) { add('error', 'tables', 'tables 应为数组'); }
    else list = tables;
  }
  list.forEach((t, i) => {
    const f = `tables[${i}]`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) { add('error', f, `表格 ${i + 1} 应为对象 {caption?, header?, rows, note?}`); return; }
    if (t.caption != null && !isStr(t.caption)) add('error', `${f}.caption`, `表格 ${i + 1} 的 caption 应为字符串`);
    if (t.note != null && !isStr(t.note)) add('error', `${f}.note`, `表格 ${i + 1} 的 note 应为字符串`);
    let width: number | null = null;
    if (t.header != null) {
      if (!Array.isArray(t.header) || !t.header.length || !t.header.every(isStr)) add('error', `${f}.header`, `表格 ${i + 1} 的 header 应为非空字符串数组`);
      else width = t.header.length;
    }
    if (!Array.isArray(t.rows) || !t.rows.length) { add('error', `${f}.rows`, `表格 ${i + 1} 没有数据行（rows 为空）`); return; }
    t.rows.forEach((r: any, j: number) => {
      if (!Array.isArray(r) || !r.length) { add('error', `${f}.rows[${j}]`, `表格 ${i + 1} 第 ${j + 1} 行应为非空字符串数组`); return; }
      if (!r.every(isStr)) add('error', `${f}.rows[${j}]`, `表格 ${i + 1} 第 ${j + 1} 行有不是字符串的单元格（数字也请写成字符串）`);
      if (width != null && r.length !== width) add('error', `${f}.rows[${j}]`, `表格 ${i + 1} 第 ${j + 1} 行有 ${r.length} 格，表头有 ${width} 列`);
    });
    if (width == null) {
      const w0 = Array.isArray(t.rows[0]) ? t.rows[0].length : 0;
      const ragged = t.rows.findIndex((r: any) => Array.isArray(r) && r.length !== w0);
      if (ragged > 0) add('warn', `${f}.rows`, `表格 ${i + 1} 没有表头，各行列数不一致（第 1 行 ${w0} 格，第 ${ragged + 1} 行 ${t.rows[ragged].length} 格）`);
    }
  });
  const refs = new Map<number, string[]>();
  for (const [field, text] of texts) for (const m of tableMarkers(text)) refs.set(m.n, [...(refs.get(m.n) ?? []), field]);
  for (const [n, fields] of refs) {
    if (n >= list.length) add('error', fields[0], `${fields[0]} 里的 {{table:${n}}} 没有对应的表格（共 ${list.length} 个表格，下标从 0 开始${n === list.length && n > 0 ? `；是不是想写 {{table:${n - 1}}}` : ''}）`);
    else if (fields.length > 1) add('warn', fields[0], `{{table:${n}}} 被引用了 ${fields.length} 次（${fields.join('、')}）`);
  }
  list.forEach((_, i) => { if (!refs.has(i)) add('error', `tables[${i}]`, `表格 ${i + 1}（tables[${i}]）没有在正文里用 {{table:${i}}} 引用`); });
  return out;
}

const cellText = (x: unknown) => String(x ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
/** 给模型看的纯文本：把 {{table:N}} 换成 Markdown 表格（AI 讲解 / 批改提示词用） */
export function tableToMarkdown(t: QuestionTable | undefined | null): string {
  if (!t || !Array.isArray(t.rows)) return '';
  const width = Math.max(t.header?.length ?? 0, ...t.rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  const row = (r: unknown[]) => `| ${Array.from({ length: width }, (_, i) => cellText(r[i])).join(' | ')} |`;
  const L: string[] = [];
  if (t.caption) L.push(`表：${t.caption}`);
  const head = t.header?.length ? t.header : null;
  if (head) L.push(row(head), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
  for (const r of t.rows) L.push(row(Array.isArray(r) ? r : []));
  if (t.note) L.push(`注：${t.note}`);
  return L.join('\n');
}
export function withTablesText(text: string | null | undefined, tables: unknown): string {
  const list = Array.isArray(tables) ? (tables as QuestionTable[]) : [];
  return String(text ?? '').replace(TABLE_MARKER_RE, (m, n) => { const t = list[Number(n)]; return t ? `\n${tableToMarkdown(t)}\n` : m; });
}
