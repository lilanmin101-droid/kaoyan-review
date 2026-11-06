/**
 * 题库导入：
 *   1) 知识点树 knowledge_tree.json（tree + paths）→ knowledge_points
 *   2) 题目 JSON（v0.2 数组）→ questions；题目自身 knowledge_points 为空时，从 --kp-tags 文件补，并记录置信度
 *   3) 校验：知识点路径存在、LaTeX 能被 KaTeX 渲染、答案齐全 → 写 Markdown 报告
 * 不会修改源 JSON。每次运行都重新读取源文件，并按 id upsert（可反复跑）。
 *
 * 用法：node dist/scripts/import-questions.js --tree <knowledge_tree.json> --questions <文件|目录|通配符>[,<…>]
 *        [--kp-tags <tags.json>] [--report <out.md> | --report-dir <dir>] [--dry-run]
 *   --questions 可以是单个文件、目录（自动找 math1_YYYY.json / english1_YYYY.json 等）或通配符（/workspace/kaoyan/tiku/math1_*.json）
 *   知识点标签：每个题目文件旁边的 <名字>_kp_tags.json 会自动使用；--kp-tags 只在导入单个文件时生效
 *   报告：单个文件 + --report 写到指定路径；否则每个文件写 <report-dir>/import_report_<exam>_<year>.md（默认当前目录）
 *   图片：stem/options/sub_questions/images 里引用的图片按题目 JSON 所在目录解析，文件不存在记 image_missing
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import katex from 'katex';
import { loadEnv } from './env';
import { isProofQuestion, resolveScoreByWhole } from '../src/common/grading';
import { parseAt } from '../src/common/time';
import { validateTables } from '../src/common/tables';
import { ENGLISH_PROBLEM_LABELS, ENGLISH_SECTION_KP, ENGLISH_SECTION_NAME, isEnglishExam, normalizeSubtype, passagesFileFor, SpecProblem, validateEnglish1 } from '../src/english/english-spec';

type Problem = { type: string; severity: 'error' | 'warn'; field: string; detail: string };

/** errata：[{printed, correct, note}]，三个都是非空字符串（note 可省略）；不合格的条目不入库 */
export function validateErrata(errata: unknown): Problem[] {
  if (errata == null) return [];
  if (!Array.isArray(errata)) return [{ type: 'errata_invalid', severity: 'error', field: 'errata', detail: 'errata 应为数组' }];
  const out: Problem[] = [];
  errata.forEach((e: any, i: number) => {
    const bad = !e || typeof e !== 'object' || Array.isArray(e) ? '应为对象 {printed, correct, note}'
      : typeof e.printed !== 'string' || !e.printed.trim() ? 'printed 必填（原卷印的样子）'
      : typeof e.correct !== 'string' || !e.correct.trim() ? 'correct 必填（应为）'
      : e.note != null && typeof e.note !== 'string' ? 'note 应为字符串'
      : Object.keys(e).some((k) => !['printed', 'correct', 'note'].includes(k)) ? `多了字段 ${Object.keys(e).filter((k) => !['printed', 'correct', 'note'].includes(k)).join('、')}` : null;
    if (bad) out.push({ type: 'errata_invalid', severity: 'error', field: `errata[${i}]`, detail: bad });
  });
  return out;
}
export const cleanErrata = (errata: unknown) => (Array.isArray(errata) ? errata : []).filter((e: any, i: number, a: any[]) => !validateErrata([e]).length)
;

const PROBLEM_LABELS: Record<string, string> = {
  stem_missing: '题干缺失',
  table_invalid: '表格（tables / {{table:N}}）不对',
  errata_invalid: '原卷误印说明（errata）格式不对：应为 [{printed, correct, note}]',
  sub_scores_on_whole_scored: '整题计分的题给了小问分值（已忽略，按整题计分）',
  kp_missing: '没有知识点标签',
  kp_not_in_tree: '知识点路径不在知识点树里',
  kp_low_confidence: '知识点标签置信度不高（medium/low）',
  latex_error: 'LaTeX 无法被 KaTeX 渲染',
  latex_unbalanced: '公式定界符 $ 不成对',
  answer_missing: '答案缺失',
  answer_incomplete: '答案不完整（含“待补”或只是思路提示）',
  answer_not_in_options: '答案字母不在选项里',
  options_incomplete: '选择题选项不全',
  sub_question_score_missing: '小问缺分值',
  ocr_residue: '疑似 OCR 残片（公式外有成串的数字/符号）',
  ocr_spacing: '疑似 OCR 把汉字拆开了（字间多空格）',
  review_suspect: '源文件校对状态仍是 suspect',
  option_formula_lost: '选项里的公式丢了（只剩散落的数字，多半是分数被拆开）',
  ocr_fragment: '疑似 OCR 碎片（分数被拆成两个数字、悬空的运算符、题干末尾残字、选项里混进图片标记）',
  image_missing: '引用的图片文件不存在',
  answer_overridden_by_review: '答案被校对记录（reviews/*.jsonl）改写，和题目 JSON 不一样',
  ...ENGLISH_PROBLEM_LABELS,
};

/** 题目文件名：<exam>_<year>.json，如 math1_2024.json、english1_2023.json */
export const YEARLY_FILE = /^(math1|math2|math3|english1|english2|politics)_(\d{4})\.json$/;

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

/** 从一段 Markdown 文本里抽出所有公式片段 */
export function extractMath(text: string): { exprs: { tex: string; display: boolean }[]; unbalanced: boolean } {
  const exprs: { tex: string; display: boolean }[] = [];
  let rest = text;
  rest = rest.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => { exprs.push({ tex: t, display: true }); return ' '; });
  rest = rest.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => { exprs.push({ tex: t, display: true }); return ' '; });
  rest = rest.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => { exprs.push({ tex: t, display: false }); return ' '; });
  rest = rest.replace(/(?<!\\)\$([^$]+?)(?<!\\)\$/g, (_, t) => { exprs.push({ tex: t, display: false }); return ' '; });
  const unbalanced = /(?<!\\)\$/.test(rest);
  return { exprs, unbalanced };
}

function checkLatex(field: string, text: unknown, out: Problem[]) {
  if (typeof text !== 'string' || !text) return;
  const { exprs, unbalanced } = extractMath(text);
  if (unbalanced) out.push({ type: 'latex_unbalanced', severity: 'error', field, detail: `文本里有落单的 $：${snippet(text)}` });
  for (const e of exprs) {
    try {
      katex.renderToString(e.tex, { throwOnError: true, displayMode: e.display, strict: 'ignore' });
    } catch (err: any) {
      out.push({ type: 'latex_error', severity: 'error', field, detail: `${String(err.message || err).replace(/\s+/g, ' ').slice(0, 160)} ｜ 公式：\`${snippet(e.tex, 80)}\`` });
    }
  }
}

function snippet(s: string, n = 60) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}


const CJK = '\u4e00-\u9fa5';
const IMAGE_MD = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const IMAGE_HTML = /<img\b[^>]*?src\s*=\s*["']?([^"'\s>]+)[^>]*>/gi;
const IMAGE_PLACEHOLDER = /[\[【［](?:图|圖|图片|figure|image)[^\]】］]{0,10}[\]】］]/gi;

/** 去掉公式和图片标记，只留普通文字 */
function plainText(text: string) {
  return text
    .replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$[^$]+?(?<!\\)\$/g, ' ⟨math⟩ ')
    .replace(IMAGE_MD, ' ⟨img⟩ ')
    .replace(IMAGE_HTML, ' ⟨img⟩ ');
}

function show(s: string, n = 40) {
  const t = s.replace(/\n+/g, '⏎').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** OCR 碎片：分数被拆成两个裸数字、悬空运算符、题干末尾残字、选项里的图片标记 */
export function findOcrFragments(field: string, text: string): { detail: string }[] {
  const out: { detail: string }[] = [];
  const isOption = field.startsWith('options.');
  const plain = plainText(text);
  const seen = new Set<string>();
  const add = (kind: string, snip: string) => {
    const key = kind + '|' + snip;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ detail: `${kind}：“${show(snip)}”` });
  };
  // 1) 裸数字对：「6⏎⏎1」「17 2」「1 3 .」——分数的分子分母被拆开（排除小问编号、分值、年份等正常写法）
  const pairRe = /(^|[^\d.\w])(\d{1,3})(\s*\n\s*\n?\s*|[ \t]+)(\d{1,3})(?![\d.]*\s*(?:分|题|年|月|日|个|次|小时|分钟|%|％))/g;
  for (const m of plain.matchAll(pairRe)) {
    const before = plain.slice(Math.max(0, (m.index ?? 0) - 4), m.index ?? 0);
    if (/满分\s*$|第\s*$/.test(before)) continue;
    add('数字被拆开（像是丢了分数线）', `${m[2]}${m[3]}${m[4]}`);
  }
  // 2) 悬空运算符 / 公式外的变量表达式：「X Y+」「X Y+2」「2nna」
  for (const line of plain.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const dang = l.match(/(?:^|[\s，,：:])((?:[A-Za-z0-9]{1,3}\s+){1,3}[A-Za-z0-9]{0,3}\s*[+\-−=×÷*/^]\s*\d{0,3})(?=$|[\s，,。.])/);
    if (dang) { add('悬空的运算符（公式被拆坏）', dang[1]); continue; }
    if (/[+\-−=×÷*/^]\s*$/.test(l) && /[A-Za-z0-9]\s*[+\-−=×÷*/^]\s*$/.test(l) && !/[=＝]\s*$/.test(l.replace(/⟨math⟩/g, ''))) {
      add('悬空的运算符（公式被拆坏）', l.slice(-12));
      continue;
    }
    // 选项是没包 $ 的变量表达式（如「2X」「X」），公式没识别出来
    if (isOption && !text.includes('$') && /^[A-Za-z0-9λμσθαβ\s+\-−*/^()]+$/.test(l) && /[A-Za-zλμσθαβ]/.test(l) && !/^[A-Za-z]{4,}/.test(l))
      add('选项里的公式没有用 $ 包起来（可能丢了上下标或分数）', l);
  }
  // 3) 题干末尾残字：最后一段既不是中文/标点，也不是公式或填空横线
  if (field === 'stem' || /\.stem$/.test(field)) {
    const tail = text.replace(/\s+$/, '').match(new RegExp(`(?:[${CJK}，。,：:；;？?！!、）)（(]|\\$|______+)([^${CJK}$]*)$`));
    // 去掉小问编号（1）(2) 和标点后再看还剩什么
    const t = (tail?.[1] ?? '').replace(/[（(]\s*\d{1,2}\s*[)）]/g, ' ').replace(/^[\s，。,.：:；;？?！!、）)]+/, '').trim();
    if (t && /[A-Za-z0-9]/.test(t) && !/^[_\s.。]+$/.test(t) && !IMAGE_MD.test(t) && t.length <= 20) add('题干末尾有残字', t);
    IMAGE_MD.lastIndex = 0;
  }
  // 4) PDF 符号字体的私有区字符（如 U+F0E6 括号片段），渲染出来是方块
  for (const m of text.matchAll(/.{0,6}[\uE000-\uF8FF].{0,6}/g))
    add(`私有区字符 ${[...m[0]].filter((c) => /[\uE000-\uF8FF]/.test(c)).map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase()).join(' ')}（PDF 符号字体残片）`, m[0]);
  // 5) 选项里的图片标记
  if (isOption) {
    for (const re of [IMAGE_MD, IMAGE_HTML, IMAGE_PLACEHOLDER]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) add('选项里混进了图片标记（多半应在题干）', m[0]);
    }
  }
  return out;
}

/** 收集一道题引用的所有图片（相对路径或 URL） */
export function collectImageRefs(q: any): { field: string; ref: string }[] {
  const refs: { field: string; ref: string }[] = [];
  const scan = (field: string, text: unknown) => {
    if (typeof text !== 'string') return;
    for (const re of [IMAGE_MD, IMAGE_HTML]) { re.lastIndex = 0; for (const m of text.matchAll(re)) refs.push({ field, ref: m[1] }); }
  };
  scan('stem', q.stem);
  (q.options || []).forEach((o: any) => scan(`options.${o.key}`, o.content));
  (q.sub_questions || []).forEach((sq: any, i: number) => scan(`sub_questions[${i}].stem`, sq.stem));
  scan('solution', q.solution);
  (q.images || []).forEach((im: any, i: number) => {
    const ref = typeof im === 'string' ? im : im?.path ?? im?.src ?? im?.url ?? im?.file;
    if (ref) refs.push({ field: `images[${i}]`, ref });
  });
  return refs;
}

function checkImages(q: any, baseDir: string, out: Problem[]) {
  for (const { field, ref } of collectImageRefs(q)) {
    if (/^(https?:|data:)/i.test(ref)) continue;
    const file = path.resolve(baseDir, decodeURIComponent(ref.split(/[?#]/)[0]));
    if (!fs.existsSync(file)) out.push({ type: 'image_missing', severity: 'error', field, detail: `${ref} → ${file} 不存在` });
  }
}

/** 小问缺分值：只有按小问计分的题才提醒（整题计分的题小问本来就不给分）。q.score_by_whole 已由 resolveScoreByWhole 定好；没定时按证明题自动识别 */
export function subScoreMissingProblems(q: any): Problem[] {
  const whole = typeof q.score_by_whole === 'boolean' ? q.score_by_whole : isProofQuestion(q);
  if (whole) return [];
  return (q.sub_questions || []).flatMap((s: any, i: number) => (s?.score == null
    ? [{ type: 'sub_question_score_missing', severity: 'warn', field: `sub_questions[${i}]`, detail: '小问没有分值，入库时按整题分值平均估算（score_estimated）' } as Problem] : []));
}

function validate(q: any, kpSet: Set<string>, kpConfidence: string | null, baseDir: string): Problem[] {
  const p: Problem[] = [];
  if (!q.stem || !String(q.stem).trim()) p.push({ type: 'stem_missing', severity: 'error', field: 'stem', detail: '题干为空' });
  // OCR 痕迹（只做提醒；英语卷不跑这套，它是按中文 + 数学公式 OCR 调的，英文正文会误报）
  const english = isEnglishExam(q.exam);
  for (const [field, text] of english ? [] : [['stem', q.stem], ...(q.options || []).map((o: any) => [`options.${o.key}`, o.content])] as [string, string][]) {
    if (typeof text !== 'string') continue;
    const outside = text.replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, ' ');
    if (field.startsWith('options.') && !text.includes('$') && /^[\s\d.\-−]+$/.test(text) && (/\s/.test(text.trim()) || /\.$/.test(text.trim()))) {
      p.push({ type: 'option_formula_lost', severity: 'error', field, detail: `选项内容只有“${text.replace(/\n+/g, '⏎')}”` });
      continue;
    }
    for (const line of outside.split('\n')) {
      if (/^\s*[（(]\d+[)）]\s*$/.test(line)) continue; // 小问编号（1）
      if (/^[\s\d\-−+=()（）,，.·]{3,}$/.test(line) && /\d/.test(line) && line.trim().length >= 3)
        p.push({ type: 'ocr_residue', severity: 'warn', field, detail: `“${line.trim()}”` });
    }
    const m = outside.match(/(?:[\u4e00-\u9fa5] ){3,}[\u4e00-\u9fa5]/);
    if (m) p.push({ type: 'ocr_spacing', severity: 'warn', field, detail: `“${m[0]}”` });
  }
  const textFields: [string, unknown][] = [['stem', q.stem], ...(q.options || []).map((o: any) => [`options.${o.key}`, o.content] as [string, unknown]),
    ...(q.sub_questions || []).map((sq: any, i: number) => [`sub_questions[${i}].stem`, sq.stem] as [string, unknown])];
  for (const [field, text] of english ? [] : textFields) {
    if (typeof text !== 'string') continue;
    for (const f of findOcrFragments(field, text)) p.push({ type: 'ocr_fragment', severity: 'warn', field, detail: f.detail });
  }
  // 同一题里别的选项已经有拆开的数字时，只剩裸数字的选项（如「136」「72」）多半也是分数丢了分数线
  if (p.some((x) => x.type === 'ocr_fragment' && x.field.startsWith('options.') && x.detail.startsWith('数字被拆开')) || p.some((x) => x.type === 'option_formula_lost')) {
    for (const o of q.options || []) {
      const c = String(o.content ?? '').trim();
      const field = `options.${o.key}`;
      if (/^\d{2,4}$/.test(c) && !p.some((x) => x.field === field && (x.type === 'ocr_fragment' || x.type === 'option_formula_lost')))
        p.push({ type: 'ocr_fragment', severity: 'warn', field, detail: `只剩裸数字（同题其他选项的分数被拆开，这个多半也是）：“${c}”` });
    }
  }
  checkImages(q, baseDir, p);
  if (q.review?.status === 'suspect') p.push({ type: 'review_suspect', severity: 'warn', field: 'review.status', detail: (q.review.notes || []).map((n: string) => snippet(n, 80)).join('；') || '无备注' });
  // 知识点
  const kps: string[] = q.knowledge_points || [];
  if (!kps.length) p.push({ type: 'kp_missing', severity: 'error', field: 'knowledge_points', detail: kpConfidence === 'none' ? '标签文件里标为 none（题干缺失暂无法标注）' : '题目和标签文件里都没有知识点' });
  for (const k of kps) if (!kpSet.has(k)) p.push({ type: 'kp_not_in_tree', severity: 'error', field: 'knowledge_points', detail: k });
  if (kps.length && kpConfidence && ['medium', 'low'].includes(kpConfidence))
    p.push({ type: 'kp_low_confidence', severity: 'warn', field: 'knowledge_points', detail: `置信度 ${kpConfidence}，题干修好后需复核` });
  // LaTeX
  checkLatex('stem', q.stem, p);
  (q.options || []).forEach((o: any) => checkLatex(`options.${o.key}`, o.content, p));
  (Array.isArray(q.answer) ? q.answer : []).forEach((a: any, i: number) => checkLatex(`answer[${i}]`, a, p));
  (q.sub_questions || []).forEach((s: any, i: number) => {
    checkLatex(`sub_questions[${i}].stem`, s.stem, p);
    (s.answer || []).forEach((a: any, j: number) => checkLatex(`sub_questions[${i}].answer[${j}]`, a, p));
  });
  p.push(...subScoreMissingProblems(q));
  checkLatex('solution', q.solution, p);
  // 表格：结构 + {{table:N}} 标记互相对应（N 是下标，从 0 开始）
  p.push(...validateTables(q.tables, [['stem', q.stem], ...(q.sub_questions || []).map((s: any, i: number) => [`sub_questions[${i}].stem`, s?.stem] as [string, unknown])]));
  p.push(...validateErrata(q.errata));
  // 答案
  const ans: any[] = Array.isArray(q.answer) ? q.answer.filter((a: any) => a != null && String(a).trim() !== '') : [];
  const subHasAns = (q.sub_questions || []).some((s: any) => (s.answer || []).length);
  if (!ans.length && !subHasAns) p.push({ type: 'answer_missing', severity: 'error', field: 'answer', detail: '没有答案' });
  for (const a of ans) {
    if (/待补|思路|使用.*公式.*展开\.?$/.test(String(a))) p.push({ type: 'answer_incomplete', severity: 'error', field: 'answer', detail: snippet(String(a), 80) });
  }
  if (/choice/.test(q.type)) {
    const keys = new Set((q.options || []).map((o: any) => o.key));
    const want = ['A', 'B', 'C', 'D'];
    const missing = want.filter((k) => !keys.has(k));
    const empty = (q.options || []).filter((o: any) => !String(o.content || '').trim()).map((o: any) => o.key);
    if (missing.length || empty.length) p.push({ type: 'options_incomplete', severity: 'error', field: 'options', detail: `缺少选项 ${[...missing, ...empty].join('、')}` });
    for (const a of ans) if (!keys.has(a)) p.push({ type: 'answer_not_in_options', severity: 'error', field: 'answer', detail: `答案 ${a} 不在选项里` });
  }
  return p;
}


// ───────────────────────── 校对记录 reviews/<exam>_<year>.jsonl ─────────────────────────
export type ReviewRecord = { id: string; status: 'confirmed' | 'pending' | 'suspect'; by: string; note?: string; at: string; answer?: string[]; line: number; atMs: number; fix_request?: string };
export type ReviewIssue = { line: number; kind: 'bad_line' | 'unknown_id' | 'legacy_fields' | 'future_at'; detail: string };
/**
 * 小问分值（只改入库副本，题库源文件不动）：
 * - 证明题（isProofQuestion：任一小问是证明 / 整题是证明）不拆，缺的小问分值留 null，题目 score_by_whole=true，自评只按整题算
 * - 计算题：缺分值的小问按整题分值平均拆开（0.5 取整，余数给第一问），标 score_estimated=true
 */
export function scorePlan(q: any): { subs: any[]; score_by_whole: boolean; score_estimated: boolean } {
  const subs = (q.sub_questions ?? []).map((x: any) => ({ ...x }));
  const byWhole = typeof q.score_by_whole === 'boolean' ? q.score_by_whole : isProofQuestion(q);
  const missing = subs.filter((x: any) => x.score == null);
  if (byWhole) return { subs: subs.map((x: any) => ({ ...x, score: null, score_estimated: false })), score_by_whole: true, score_estimated: false }; // 整题计分：小问分值一律忽略
  if (!missing.length || q.score == null) return { subs, score_by_whole: byWhole, score_estimated: false };
  const known = subs.reduce((a: number, x: any) => a + (x.score ?? 0), 0);
  const each = Math.round(((Number(q.score) - known) / missing.length) * 2) / 2;
  missing.forEach((x: any, i: number) => { x.score = i === 0 ? Number(q.score) - known - each * (missing.length - 1) : each; x.score_estimated = true; }); // 余数给第一问
  return { subs, score_by_whole: false, score_estimated: true };
}

/** 小问分值来源：official = 题目文件自带；estimated = kp_tags 里行业专家估的（非官方，可在条目里写 sub_scores_source 改）；even_split = 缺分值按整题平均拆 */
export type SubScoresSource = 'official' | 'estimated' | 'even_split';
const SUB_SCORES_SOURCES: SubScoresSource[] = ['official', 'estimated', 'even_split'];
/** kp_tags 来源：条目自己写的 > 文件顶层 sub_scores_source > 'estimated'；不认识的值按 'estimated' */
export function subScoresSourceOf(entry?: any, top?: any): SubScoresSource {
  for (const v of [entry, top]) if (typeof v === 'string' && (SUB_SCORES_SOURCES as string[]).includes(v)) return v as SubScoresSource;
  return 'estimated';
}
/** 整题的来源：有平均拆的 → even_split；否则有 kp_tags 补的 → 它的来源；全部题目文件自带 → official；没有小问分值（证明题整题计分 / 没小问）→ null */
export function subScoresSourceFor(subs: any[], rawSubs: any[], tagSource?: SubScoresSource): SubScoresSource | null {
  const src = subs.map((x, i) => (x.score == null ? null : x.score_estimated ? 'even_split' : rawSubs[i]?.score == null ? tagSource ?? 'estimated' : 'official')).filter(Boolean) as SubScoresSource[];
  if (!src.length) return null;
  return src.includes('even_split') ? 'even_split' : src.includes('estimated') ? 'estimated' : 'official';
}

const REVIEW_STATUSES = ['confirmed', 'pending', 'suspect'];

// parseAt（DST 安全，裸时间按太平洋时间）移到 src/common/time.ts，讲解核对记录也用它

export function reviewsFileFor(qFile: string) {
  return path.join(path.dirname(qFile), 'reviews', path.basename(qFile).replace(/\.json$/, '.jsonl'));
}

/** 读校对记录：坏行、未知 id 只记下来，不中断导入。兼容早期字段名（reviewer/date/exam+year+number/fix_request），并提示改成新格式 */
export function loadReviews(file: string, knownIds: Set<string>, fileExam?: string, fileYear?: number) {
  const records: ReviewRecord[] = [];
  const issues: ReviewIssue[] = [];
  let lines = 0;
  if (!fs.existsSync(file)) return { exists: false, records, issues, lines };
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || raw.trim().startsWith('//')) return;
    lines++;
    let o: any;
    try { o = JSON.parse(raw); } catch (e: any) { issues.push({ line, kind: 'bad_line', detail: `不是合法 JSON：${String(e.message).slice(0, 80)}` }); return; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) { issues.push({ line, kind: 'bad_line', detail: '每行必须是一个 JSON 对象' }); return; }
    const legacy: string[] = [];
    let id = o.id;
    if (!id && o.number != null) {
      const exam = o.exam ?? fileExam, year = o.year ?? fileYear;
      if (exam && year) { id = `${exam}-${year}-${String(o.number).padStart(2, '0')}`; legacy.push('exam/year/number → id'); }
    }
    let by = o.by;
    if (by == null && o.reviewer != null) { by = o.reviewer; legacy.push('reviewer → by'); }
    let at = o.at;
    if (at == null && o.date != null) { at = o.date; legacy.push('date → at'); }
    if (o.fix_request != null) legacy.push('fix_request（并入 note）');
    const errs: string[] = [];
    if (typeof id !== 'string' || !id) errs.push('缺少 id');
    const STATUS_ALIAS: Record<string, string> = { needs_fix: "suspect", fix: "suspect", ok: "confirmed" };
    if (typeof o.status === "string" && STATUS_ALIAS[o.status]) o.status = STATUS_ALIAS[o.status];
    if (!REVIEW_STATUSES.includes(o.status)) errs.push(`status 必须是 ${REVIEW_STATUSES.join('/')}（现在是 ${JSON.stringify(o.status)}）`);
    if (typeof by !== 'string' || !by.trim()) errs.push('缺少 by');
    const atMs = typeof at === 'string' ? parseAt(at) : NaN;
    if (Number.isNaN(atMs)) errs.push(`at 不是合法时间（${JSON.stringify(at)}），要像 2026-11-01T04:15`);
    if (o.note != null && typeof o.note !== 'string') errs.push('note 必须是字符串');
    if (o.answer != null && !(Array.isArray(o.answer) && o.answer.length && o.answer.every((a: any) => typeof a === 'string'))) errs.push('answer 必须是非空字符串数组');
    if (errs.length) { issues.push({ line, kind: 'bad_line', detail: `${id ?? '(无 id)'}：${errs.join('；')}` }); return; }
    if (!knownIds.has(id)) { issues.push({ line, kind: 'unknown_id', detail: `${id} 不在题目文件里` }); return; }
    if (atMs > Date.now() + 10 * 60_000) issues.push({ line, kind: 'future_at', detail: `${id}：at=${at} 比现在晚，多半是时区写错了（北京时间要写 +08:00），排序可能不对` });
    if (legacy.length) issues.push({ line, kind: 'legacy_fields', detail: `${id}：用了旧字段名，已按新格式理解（${legacy.join('，')}）` });
    records.push({ id, status: o.status, by: by.trim(), note: o.note, at, answer: o.answer, line, atMs, fix_request: o.fix_request });
  });
  return { exists: true, records, issues, lines };
}

export type AppliedReview = { id: string; from: string; to: string; by: string[]; records: number; latestAt: string; answerFrom?: any[]; answerTo?: string[]; answerChanged: boolean };

/** 把校对记录叠加到题目上（只改内存里的副本）：
 *  - status 取 at 最新的一条（同一时间取文件里靠后的）
 *  - 所有 note（和 fix_request）按时间顺序追加到 review.notes
 *  - checked_by = 原有 ∪ 所有 by
 *  - answer 只看最新的那一条（同上排序）：它带 answer 才改写；不带就用题目文件里的答案，更早记录里的 answer 一律作废 */
export function applyReviews(q: any, recs: ReviewRecord[]): AppliedReview | null {
  if (!recs.length) return null;
  const sorted = [...recs].sort((a, b) => a.atMs - b.atMs || a.line - b.line);
  const latest = sorted[sorted.length - 1];
  const from = q.review?.status ?? 'pending';
  const notes = [...(q.review?.notes ?? [])];
  for (const r of sorted) {
    if (r.note) notes.push(`${r.by}（${r.at}）：${r.note}`);
    if (r.fix_request) notes.push(`${r.by}（${r.at}）修改请求：${r.fix_request}`);
  }
  const checked = [...new Set([...(q.review?.checked_by ?? []), ...sorted.map((r) => r.by)])];
  q.review = { ...(q.review ?? {}), status: latest.status, notes, checked_by: checked };
  const ansRec = latest.answer ? latest : undefined;
  let answerChanged = false;
  let answerFrom: any[] | undefined;
  if (ansRec) {
    answerFrom = q.answer;
    const norm = (a: any) => JSON.stringify((Array.isArray(a) ? a : [a]).map((x: any) => String(x).replace(/\s+/g, '')));
    answerChanged = norm(q.answer ?? []) !== norm(ansRec.answer);
    q.answer = ansRec.answer;
  }
  return { id: q.id, from, to: latest.status, by: [...new Set(sorted.map((r) => r.by))], records: sorted.length, latestAt: latest.at, answerFrom, answerTo: ansRec?.answer, answerChanged };
}

/** --questions 支持：文件、目录、通配符（* ?），逗号分隔多个 */
export function expandQuestionFiles(spec: string): string[] {
  const files: string[] = [];
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (/[*?]/.test(part)) {
      const dir = path.dirname(part);
      const re = new RegExp('^' + path.basename(part).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      if (!fs.existsSync(dir)) throw new Error(`目录不存在：${dir}`);
      for (const f of fs.readdirSync(dir).sort()) if (re.test(f) && YEARLY_FILE.test(f)) files.push(path.join(dir, f));
    } else if (fs.existsSync(part) && fs.statSync(part).isDirectory()) {
      for (const f of fs.readdirSync(part).sort()) if (YEARLY_FILE.test(f)) files.push(path.join(part, f));
    } else if (fs.existsSync(part)) {
      files.push(part);
    } else throw new Error(`找不到题目文件：${part}`);
  }
  return [...new Set(files.map((f) => path.resolve(f)))];
}

/** 解析 solution：字符串原样存；数组/对象拼成 Markdown */
function normalizeSolution(sol: unknown): string | null {
  if (sol == null) return null;
  if (typeof sol === 'string') return sol.trim() ? sol : null;
  if (Array.isArray(sol)) {
    const parts = sol.map((x) => (typeof x === 'string' ? x : x?.text ?? x?.content ?? JSON.stringify(x))).filter(Boolean);
    return parts.length ? parts.join('\n\n') : null;
  }
  if (typeof sol === 'object') {
    const o = sol as any;
    return o.text ?? o.content ?? o.markdown ?? JSON.stringify(o);
  }
  return String(sol);
}

type KpTree = { tree: any; nodes: { path: string; name: string; parent: string | null; level: number; order: number }[]; leafPaths: Set<string>; declared: string[]; treeMismatch: string[]; kpSet: Set<string> };

function loadTree(treeFile: string): KpTree {
  const tree = JSON.parse(fs.readFileSync(treeFile, 'utf8'));
  const nodes: KpTree['nodes'] = [];
  let order = 0;
  for (const [subject, chapters] of Object.entries<any>(tree.tree)) {
    nodes.push({ path: subject, name: subject, parent: null, level: 1, order: order++ });
    for (const [chapter, points] of Object.entries<any>(chapters)) {
      const cp = `${subject}/${chapter}`;
      nodes.push({ path: cp, name: chapter, parent: subject, level: 2, order: order++ });
      for (const pt of points as string[]) nodes.push({ path: `${cp}/${pt}`, name: pt, parent: cp, level: 3, order: order++ });
    }
  }
  const leafPaths = new Set(nodes.filter((n) => n.level === 3).map((n) => n.path));
  const declared: string[] = tree.paths || [];
  const treeMismatch = [...declared.filter((p) => !leafPaths.has(p)).map((p) => `paths 里有、tree 里没有：${p}`),
    ...[...leafPaths].filter((p) => !declared.includes(p)).map((p) => `tree 里有、paths 里没有：${p}`)];
  return { tree, nodes, leafPaths, declared, treeMismatch, kpSet: new Set([...leafPaths, ...declared]) };
}

function findTagsFile(qFile: string, explicit: string | undefined, single: boolean): string | null {
  if (explicit && single) return fs.existsSync(explicit) ? explicit : null;
  const auto = qFile.replace(/\.json$/, '_kp_tags.json');
  if (fs.existsSync(auto)) return auto;
  if (explicit && fs.existsSync(explicit)) {
    // 多文件时，只有 tags 文件声明的 source 与题目文件同名才用
    const t = JSON.parse(fs.readFileSync(explicit, 'utf8'));
    if (t.source && path.basename(t.source) === path.basename(qFile)) return explicit;
  }
  return null;
}

async function importFile(client: Client | null, kt: KpTree, ctx: { treeFile: string; qFile: string; tagsFile: string | null; reportFile: string; dry: boolean }) {
  const { qFile, tagsFile, reportFile, dry, treeFile } = ctx;
  const { nodes, leafPaths, declared, treeMismatch, kpSet } = kt;
  const baseDir = path.dirname(qFile);
  // 每次都重新读源文件（只读）
  const questions: any[] = JSON.parse(fs.readFileSync(qFile, 'utf8'));
  const stat = fs.statSync(qFile);
  // 英语一：同目录的 english1_<年>_passages.json（文章），按结构规则校验
  const ymE = YEARLY_FILE.exec(path.basename(qFile));
  const english = ymE?.[1] === 'english1';
  const passagesFile = english ? passagesFileFor(qFile) : null;
  let passages: any[] = [];
  let enProblems: SpecProblem[] = [];
  if (english) {
    const exists = fs.existsSync(passagesFile!);
    let parseError: string | undefined;
    if (exists) {
      try { const j = JSON.parse(fs.readFileSync(passagesFile!, 'utf8')); if (Array.isArray(j)) passages = j; else parseError = '顶层应为数组'; }
      catch (e: any) { parseError = `不是合法 JSON：${String(e.message).slice(0, 120)}`; }
    }
    enProblems = validateEnglish1(Number(ymE![2]), questions, passages, { passagesFileExists: exists, passagesParseError: parseError });
    for (const [i, p] of passages.entries()) {
      if (!p?.id) continue;
      const imgs: Problem[] = [];
      checkImages({ images: Array.isArray(p.images) ? p.images : [], stem: String(p.text ?? '') }, baseDir, imgs);
      for (const x of imgs) enProblems.push({ ...x, id: p.id, field: `passages[${i}].${x.field}` });
      for (const x of validateTables(p.tables, [['text', p.text]])) enProblems.push({ ...x, id: p.id, field: `passages[${i}].${x.field}` });
    }
  }
  const passageIds = new Set(passages.filter((p) => p?.id && p?.text).map((p) => p.id));
  const tags = tagsFile ? JSON.parse(fs.readFileSync(tagsFile, 'utf8')) : null;
  const tagByNumber = new Map<number, { knowledge_points: string[]; confidence: string }>();
  // 顶层也可写：score_by_whole: ["math1-2019-19", ...]，sub_scores: { "math1-2019-22": [4, 3.5, 3.5] }
  const numOf = (id: string) => Number(/-(\d+)$/.exec(id)?.[1]);
  const topSbw = new Set<number>(Array.isArray(tags?.score_by_whole) ? tags.score_by_whole.map(numOf) : []);
  // sub_scores 每项可写数组 [4, 3.5, 3.5]，或 { scores: [...], sub_scores_source: 'official' | 'estimated' }；没写来源默认 'estimated'（行业专家估的，非官方）
  const topSubSrc = new Map<number, SubScoresSource>();
  const topSub = new Map<number, number[]>(tags?.sub_scores && typeof tags.sub_scores === 'object' ? Object.entries(tags.sub_scores).map(([k, v]: [string, any]) => {
    topSubSrc.set(numOf(k), subScoresSourceOf(Array.isArray(v) ? undefined : v?.sub_scores_source, tags?.sub_scores_source));
    return [numOf(k), (Array.isArray(v) ? v : v?.scores ?? v?.sub_scores) as number[]];
  }) : []);
  if (Array.isArray(tags?.tags)) for (const t of tags.tags) tagByNumber.set(t.number, t);
  else if (tags?.tags && typeof tags.tags === 'object') {
    // 兼容 { "<question id>": [路径...] } 格式
    for (const [id, kps] of Object.entries(tags.tags as Record<string, any>)) {
      const n = Number(/-(\d+)$/.exec(id)?.[1]);
      const kp = Array.isArray(kps) ? kps : kps?.knowledge_points;
      if (n && Array.isArray(kp)) tagByNumber.set(n, { knowledge_points: kp, confidence: kps?.confidence ?? 'high', ...(typeof kps?.score_by_whole === 'boolean' ? { score_by_whole: kps.score_by_whole } : {}) } as any);
    }
  }

  // 校对记录（reviews/<exam>_<year>.jsonl）：只读，叠加到内存副本上
  const ym = YEARLY_FILE.exec(path.basename(qFile));
  const reviewsFile = reviewsFileFor(qFile);
  const rv = loadReviews(reviewsFile, new Set(questions.map((x) => x.id)), ym?.[1], ym ? Number(ym[2]) : undefined);
  const recsById = new Map<string, ReviewRecord[]>();
  for (const r of rv.records) (recsById.get(r.id) ?? recsById.set(r.id, []).get(r.id)!).push(r);
  const sourceStatus = (x: any) => x.review?.status ?? 'pending';
  const applied: AppliedReview[] = [];

  const results = questions.map((raw) => {
    const q = { ...raw, solution: normalizeSolution(raw.solution), review: raw.review ? { ...raw.review } : undefined };
    const ap = applyReviews(q, recsById.get(q.id) ?? []);
    if (ap) applied.push(ap);
    let kpSource = 'question_json';
    let kpConfidence: string | null = raw.kp_confidence ?? null;
    // 计分方式：kp_tags 明写的 score_by_whole / sub_scores 优先，都没写才按证明题自动识别（resolveScoreByWhole）
    const tagEntrySbw = (tagByNumber.get(q.number) as any)?.score_by_whole;
    const tagSbw = topSbw.has(q.number) ? true : typeof tagEntrySbw === 'boolean' ? tagEntrySbw : undefined;
    const ss = topSub.get(q.number);
    const mode = resolveScoreByWhole({ tagScoreByWhole: tagSbw, tagSubScores: ss, jsonScoreByWhole: (raw as any).score_by_whole, q });
    (q as any).score_by_whole = mode.score_by_whole;
    // 规则：整题计分只按整题算，标签文件 / 题目 JSON 里的小问分值都忽略，报告里提醒
    const wholeScored = mode.score_by_whole;
    const why = { 'kp_tags.score_by_whole': 'kp_tags 标了 score_by_whole', 'kp_tags.sub_scores': '', question_json: '题目 JSON 写了 score_by_whole', auto_proof: '没在 kp_tags 写计分方式，自动识别为证明题' }[mode.source];
    const wholeWarn: Problem[] = [];
    if (wholeScored) {
      const nSubs = (q.sub_questions ?? []).length;
      const jsonSubs = (q.sub_questions ?? []).map((x: any) => x?.score).filter((x: any) => x != null);
      const single = !ss && nSubs === 1 && jsonSubs.length === 1;
      if (ss || jsonSubs.length)
        wholeWarn.push({ type: 'sub_scores_on_whole_scored', severity: 'warn', field: ss ? 'kp_tags.sub_scores' : 'sub_questions[].score',
          detail: `${q.id} 是整题计分（${why}），` + (ss ? `标签文件 sub_scores=${JSON.stringify(ss)}`
            : single ? `题目 JSON 只有 1 个小问且写了分值 [${jsonSubs[0]}]${Number(jsonSubs[0]) === Number(q.score) ? '（就是整题分）' : `（整题 ${q.score} 分）`}，和整题计分冲突，请把这个小问分值清掉`
            : `题目 JSON 小问分值 ${JSON.stringify(jsonSubs)}`) + '；已忽略，自评只按整题算' });
    }
    if (wholeScored) { /* 不套用 sub_scores */ }
    else if (Array.isArray(ss) && ss.length === (q.sub_questions ?? []).length && Math.abs(ss.reduce((a, b) => a + b, 0) - Number(q.score)) < 1e-9) {
      q.sub_questions = q.sub_questions.map((x: any, i: number) => (x.score == null ? { ...x, score: ss[i] } : x));
    } else if (ss) console.warn(`  ⚠️ ${q.id}：sub_scores 个数或总和和题目对不上，已忽略`);
    // 标签文件（行业专家维护）优先于题目 JSON 里自带的知识点
    if (tagByNumber.has(q.number) && tagByNumber.get(q.number)!.knowledge_points?.length) {
      const t = tagByNumber.get(q.number)!;
      q.knowledge_points = t.knowledge_points || [];
      kpSource = 'kp_tags_file';
      kpConfidence = t.confidence ?? null;
    }
    if (kpConfidence && typeof kpConfidence === 'object') kpConfidence = JSON.stringify(kpConfidence);
    // 英语：没标知识点的题先挂到所在部分的「章」节点（如 英语/完形填空），掌握度能按部分统计；报告里仍提醒补细标签
    let enFallback: string | null = null;
    if (english && !q.knowledge_points?.length && ENGLISH_SECTION_KP[q.section] && kpSet.has(ENGLISH_SECTION_KP[q.section])) {
      enFallback = ENGLISH_SECTION_KP[q.section];
    }
    const problems = [...validate(q, kpSet, kpConfidence, baseDir), ...wholeWarn];
    if (enFallback) {
      for (const x of problems) if (x.type === 'kp_missing') { x.severity = 'warn'; x.detail = `没有细知识点，暂挂到「${enFallback}」`; }
      q.knowledge_points = [enFallback];
      kpSource = 'section_default';
    }
    if (english) for (const ep of enProblems.filter((x) => x.id === q.id)) problems.push({ type: ep.type, severity: ep.severity, field: ep.field, detail: ep.detail });
    if (ap?.answerChanged)
      problems.push({ type: 'answer_overridden_by_review', severity: 'warn', field: 'answer', detail: `${JSON.stringify(ap.answerFrom ?? [])} → ${JSON.stringify(ap.answerTo)}（${ap.by.join('、')}）` });
    return { q, kpSource, kpConfidence, problems };
  });

  if (client && english) {
    for (const [i, p] of passages.entries()) {
      if (!p?.id || !p?.text) continue;
      const probs = enProblems.filter((x) => x.id === p.id);
      await client.query(
        `INSERT INTO passages(id,exam,year,section,title,text,images,source,sort_order,import_problems,directions,options,subtype,tables,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
         ON CONFLICT (id) DO UPDATE SET exam=EXCLUDED.exam,year=EXCLUDED.year,section=EXCLUDED.section,title=EXCLUDED.title,text=EXCLUDED.text,directions=EXCLUDED.directions,
           options=EXCLUDED.options,subtype=EXCLUDED.subtype,tables=EXCLUDED.tables,
           images=EXCLUDED.images,source=EXCLUDED.source,sort_order=EXCLUDED.sort_order,import_problems=EXCLUDED.import_problems,updated_at=now()`,
        [p.id, 'english1', Number(ymE![2]), String(p.section ?? ''), p.title ?? null, p.text, JSON.stringify(p.images ?? []),
          JSON.stringify({ ...(p.source ?? {}), import_file: passagesFile, assets_dir: baseDir }), i, JSON.stringify(probs), p.directions ?? null, JSON.stringify(Array.isArray(p.options) ? p.options : []), normalizeSubtype(p.subtype), JSON.stringify(Array.isArray(p.tables) ? p.tables : [])]);
    }
  }
  if (client) {
    for (const { q, kpSource, kpConfidence, problems } of results) {
      const source = { ...(q.source ?? {}), import_file: qFile, assets_dir: baseDir };
      await client.query(
        `INSERT INTO questions(id,schema_version,exam,year,number,section,type,score,stem,images,options,answer,sub_questions,solution,
           knowledge_points,source,review_status,review_notes,review_checked_by,kp_confidence,kp_source,import_problems,score_by_whole,score_estimated,passage_id,tables,errata,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,now())
         ON CONFLICT (id) DO UPDATE SET schema_version=EXCLUDED.schema_version,exam=EXCLUDED.exam,year=EXCLUDED.year,number=EXCLUDED.number,
           section=EXCLUDED.section,type=EXCLUDED.type,score=EXCLUDED.score,stem=EXCLUDED.stem,images=EXCLUDED.images,options=EXCLUDED.options,
           answer=EXCLUDED.answer,sub_questions=EXCLUDED.sub_questions,solution=EXCLUDED.solution,knowledge_points=EXCLUDED.knowledge_points,
           source=EXCLUDED.source,review_status=EXCLUDED.review_status,review_notes=EXCLUDED.review_notes,review_checked_by=EXCLUDED.review_checked_by,
           kp_confidence=EXCLUDED.kp_confidence,kp_source=EXCLUDED.kp_source,import_problems=EXCLUDED.import_problems,
           score_by_whole=EXCLUDED.score_by_whole,score_estimated=EXCLUDED.score_estimated,passage_id=EXCLUDED.passage_id,tables=EXCLUDED.tables,errata=EXCLUDED.errata,updated_at=now()`,
        [q.id, q.schema_version, q.exam, q.year, q.number, q.section, q.type, q.score, q.stem ?? '',
          JSON.stringify(q.images ?? []), JSON.stringify(q.options ?? []), JSON.stringify(q.answer ?? []), JSON.stringify(scorePlan(q).subs),
          q.solution, (q.knowledge_points ?? []).filter((k: string) => kpSet.has(k)), JSON.stringify(source),
          q.review?.status ?? 'pending', JSON.stringify(q.review?.notes ?? []), JSON.stringify(q.review?.checked_by ?? []),
          kpConfidence, kpSource, JSON.stringify(problems), scorePlan(q).score_by_whole, scorePlan(q).score_estimated,
          english && q.passage_id && passageIds.has(q.passage_id) ? q.passage_id : null,
          JSON.stringify(Array.isArray(q.tables) ? q.tables : []), JSON.stringify(cleanErrata(q.errata))]);
      const raw = questions.find((x: any) => x.id === q.id);
      const sss = subScoresSourceFor(scorePlan(q).subs, raw?.sub_questions ?? [], topSubSrc.get(q.number));
      await client.query('UPDATE questions SET sub_scores_source=$2 WHERE id=$1 AND sub_scores_source IS DISTINCT FROM $2', [q.id, sss]);
    }
  }

  // 报告
  const counts: Record<string, number> = {};
  const qCounts: Record<string, Set<string>> = {};
  for (const r of results) for (const p of r.problems) {
    counts[p.type] = (counts[p.type] || 0) + 1;
    (qCounts[p.type] ??= new Set()).add(r.q.id);
  }
  const clean = results.filter((r) => !r.problems.some((p) => p.severity === 'error'));
  const imgRefs = results.flatMap((r) => collectImageRefs(r.q).map((x) => ({ ...x, q: r.q })));
  const L: string[] = [];
  L.push(`# 题库导入报告 · ${path.basename(qFile)}`, '');
  L.push(`生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'America/Los_Angeles' })}（太平洋时间）${dry ? '　｜　**dry-run，未写数据库**' : ''}`, '');
  L.push(`- 源文件：\`${qFile}\`（只读，未修改；文件修改时间 ${stat.mtime.toLocaleString('zh-CN', { timeZone: 'America/Los_Angeles' })} 太平洋时间）`);
  L.push(`- 知识点树：\`${treeFile}\`，${nodes.filter((n) => n.level === 1).length} 个科目 / ${nodes.filter((n) => n.level === 2).length} 章 / ${leafPaths.size} 个知识点（paths 字段 ${declared.length} 条）${treeMismatch.length ? `，**tree 与 paths 不一致 ${treeMismatch.length} 处**` : '，tree 与 paths 一致'}`);
  L.push(`- 知识点标签补充：\`${tagsFile ?? '无'}\`，${results.filter((r) => r.kpSource === 'kp_tags_file').length} 题从这里取了标签`);
  L.push(`- 题目：${results.length} 道已导入；没有错误级问题的 ${clean.length} 道，有错误级问题的 ${results.length - clean.length} 道`);
  L.push(`- 带解析（solution）的：${results.filter((r) => r.q.solution).length} 道`);
  L.push(`- 图片：引用 ${imgRefs.length} 处，缺失 ${counts.image_missing ?? 0} 处（按 \`${baseDir}\` 解析；后端经 \`/api/v1/assets/<相对路径>\` 提供）`);
  const statusCount = (get: (x: any) => string, list: any[]) => ['confirmed', 'pending', 'suspect'].map((st) => `${st} ${list.filter((x) => get(x) === st).length}`).join('，');
  L.push(`- 校对状态（源文件）：${statusCount(sourceStatus, questions)}`);
  L.push(`- **校对状态（叠加校对记录后，入库）：${statusCount((r) => r.q.review?.status ?? 'pending', results)}**`, '');
  for (const m of treeMismatch) L.push(`  - ${m}`);
  // 校对记录汇总
  L.push('## 校对记录', '');
  if (!rv.exists) L.push(`- 没有校对记录文件 \`${reviewsFile}\`，状态全部按源文件。`, '');
  else {
    const changedAns = applied.filter((a) => a.answerChanged).length;
    const sameAns = applied.filter((a) => a.answerTo && !a.answerChanged).length;
    L.push(`- 文件：\`${reviewsFile}\`（只读），有效记录 ${rv.records.length} 条 / 共 ${rv.lines} 行`);
    L.push(`- 用上的题：${applied.length} 道；状态有变化 ${applied.filter((a) => a.from !== a.to).length} 道；答案被改写 ${changedAns} 道（另有 ${sameAns} 道记录里的答案与题目 JSON 一致）`);
    const bad = rv.issues.filter((x) => x.kind === 'bad_line'), unk = rv.issues.filter((x) => x.kind === 'unknown_id'), leg = rv.issues.filter((x) => x.kind === 'legacy_fields');
    const fut = rv.issues.filter((x) => x.kind === 'future_at');
    L.push(`- 坏行 ${bad.length} 行，未知 id ${unk.length} 行，用了旧字段名 ${leg.length} 行，时间比现在晚 ${fut.length} 行`, '');
    for (const f of fut) L.push(`  - ⚠️ 第 ${f.line} 行：${f.detail}`);
    if (fut.length) { L.push(''); console.warn(`  ⚠️ ${path.basename(reviewsFile)}：${fut.length} 行 at 比现在晚，检查时区（北京时间写 +08:00）`); }
    if (applied.length) {
      L.push('| 题号 | 状态（源文件 → 入库） | 校对人 | 记录数 | 最新时间 | 答案 |', '|---|---|---|---|---|---|');
      for (const a of applied.sort((x, y) => x.id.localeCompare(y.id))) {
        const n = Number(a.id.split('-').pop());
        const ans = a.answerChanged ? `⚠️ 改写为 ${a.answerTo!.join('；').replace(/\|/g, '\\|')}` : a.answerTo ? '一致' : '—';
        L.push(`| ${n} | ${a.from === a.to ? a.to : `${a.from} → **${a.to}**`} | ${a.by.join('、')} | ${a.records} | ${a.latestAt} | ${ans} |`);
      }
      L.push('');
    }
    if (bad.length || unk.length) {
      L.push('坏行 / 未知 id（没有生效）：', '');
      for (const x of [...bad, ...unk]) L.push(`- 第 ${x.line} 行（${x.kind === 'bad_line' ? '坏行' : '未知 id'}）：${x.detail.replace(/\|/g, '\\|')}`);
      L.push('');
    }
    if (leg.length) {
      const fields = [...new Set(leg.flatMap((x) => (/（(.+)）$/.exec(x.detail)?.[1] ?? '').split('，')))].filter(Boolean);
      L.push(`旧字段名（已兼容，建议改成 id/by/at）：${leg.length} 行，涉及 ${fields.join('、')}；行号 ${leg.map((x) => x.line).join('、')}`, '');
    }
  }
  if (english) {
    const fileLevel = enProblems.filter((x) => !x.id || !questions.some((q) => q.id === x.id));
    const errs = enProblems.filter((x) => x.severity === 'error');
    L.push('## 英语一结构校验', '');
    L.push(`- 文章文件：\`${passagesFile}\`${fs.existsSync(passagesFile!) ? `，${passages.length} 篇` : '（**不存在**）'}`);
    L.push(`- 规则：1–20 完形（0.5）、21–40 阅读 A（2）、41–45 阅读 B（2，match；选项个数按题型，答案在给出的选项里）、46–50 翻译（2，五句共用一篇文章）、51 小作文（10）、52 大作文（20），合计 100`);
    const tot = questions.reduce((a, q) => a + (Number(q.score) || 0), 0);
    L.push(`- 本卷：${questions.length} 题，合计 ${tot} 分；结构错误 ${errs.length} 处，提醒 ${enProblems.length - errs.length} 处`, '');
    L.push('| 部分 | 题数 | 分值合计 | 挂了文章的题 |', '|---|---|---|---|');
    for (const [k, name] of Object.entries(ENGLISH_SECTION_NAME)) {
      const qs = questions.filter((q) => q.section === k);
      L.push(`| ${name}（\`${k}\`） | ${qs.length} | ${qs.reduce((a, q) => a + (Number(q.score) || 0), 0)} | ${qs.filter((q) => q.passage_id && passageIds.has(q.passage_id)).length} |`);
    }
    L.push('');
    if (passages.length) {
      L.push('| 文章 | section | 标题 | 字数（词） | 引用它的题 |', '|---|---|---|---|---|');
      for (const p of passages) {
        const nums = questions.filter((q) => q.passage_id === p?.id).map((q) => q.number).join('、') || '—';
        L.push(`| \`${p?.id}\` | ${p?.section} | ${String(p?.title ?? '').replace(/\|/g, '\\|') || '—'} | ${String(p?.text ?? '').split(/\s+/).filter(Boolean).length} | ${nums} |`);
      }
      L.push('');
    }
    if (fileLevel.length) {
      L.push('整卷 / 文章层面的问题：', '');
      for (const x of fileLevel) L.push(`- ${x.severity === 'error' ? '❌' : '⚠️'} **${PROBLEM_LABELS[x.type] ?? x.type}** · \`${x.field}\`：${x.detail.replace(/\|/g, '\\|')}`);
      L.push('');
    }
    for (const x of errs) if (!x.id) console.warn(`  ⚠️ ${path.basename(qFile)} 结构错误：${x.detail}`);
  }
  L.push('## 按问题类型汇总', '', '| 类型 | 说明 | 级别 | 出现次数 | 涉及题数 | 题号 |', '|---|---|---|---|---|---|');
  for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const sev = results.flatMap((r) => r.problems).find((p) => p.type === t)!.severity;
    const ids = [...qCounts[t]].map((id) => Number(id.split('-').pop())).sort((a, b) => a - b).join('、');
    L.push(`| \`${t}\` | ${PROBLEM_LABELS[t] ?? t} | ${sev === 'error' ? '错误' : '提醒'} | ${c} | ${qCounts[t].size} | ${ids} |`);
  }
  if (!Object.keys(counts).length) L.push('| — | 没有发现问题 | — | 0 | 0 | — |');
  if (imgRefs.length) {
    L.push('', '## 图片', '', '| 题号 | 位置 | 引用 | 文件存在 |', '|---|---|---|---|');
    for (const r of imgRefs) {
      const ok = /^(https?:|data:)/i.test(r.ref) ? '外链（未检查）' : fs.existsSync(path.resolve(baseDir, r.ref)) ? '✅' : '❌';
      L.push(`| ${r.q.number} | \`${r.field}\` | \`${r.ref}\` | ${ok} |`);
    }
  }
  L.push('', '## 逐题明细', '');
  L.push('| 题号 | 题型 | 校对状态 | 知识点（来源/置信度） | 解析 | 问题 |', '|---|---|---|---|---|---|');
  for (const r of results) {
    const kp = (r.q.knowledge_points || []).map((k: string) => k.split('/').slice(-1)[0]).join('、') || '—';
    const src = r.kpSource === 'kp_tags_file' ? `标签文件/${r.kpConfidence ?? '?'}` : `题目自带${r.kpConfidence ? '/' + r.kpConfidence : ''}`;
    const probs = r.problems.length ? r.problems.map((p) => `${p.severity === 'error' ? '❌' : '⚠️'} ${p.type === 'ocr_fragment' ? 'OCR 碎片：' + p.detail.replace(/\|/g, '\\|') : PROBLEM_LABELS[p.type] ?? p.type}（${p.field}）`).join('<br>') : '✅ 无';
    L.push(`| ${r.q.number} | ${r.q.type} | ${r.q.review?.status ?? 'pending'} | ${kp}（${src}） | ${r.q.solution ? '有' : '—'} | ${probs} |`);
  }
  L.push('', '## 问题详情', '');
  for (const r of results.filter((x) => x.problems.length)) {
    L.push(`### 第 ${r.q.number} 题 \`${r.q.id}\`（${r.q.review?.status ?? 'pending'}）`);
    for (const p of r.problems) L.push(`- ${p.severity === 'error' ? '❌' : '⚠️'} **${PROBLEM_LABELS[p.type] ?? p.type}** · \`${p.field}\`：${p.detail.replace(/\|/g, '\\|')}`);
    if (r.q.review?.notes?.length) L.push(`- 源文件里的校对备注：${r.q.review.notes.map((n: string) => snippet(n, 120)).join('；')}`);
    L.push('');
  }
  fs.writeFileSync(reportFile, L.join('\n'));
  const finalStatus: Record<string, number> = {};
  for (const r of results) finalStatus[r.q.review?.status ?? 'pending'] = (finalStatus[r.q.review?.status ?? 'pending'] || 0) + 1;
  const reviewSummary = rv.exists
    ? { file: reviewsFile, records: rv.records.length, applied_questions: applied.length, answer_overridden: applied.filter((a) => a.answerChanged).length,
        bad_lines: rv.issues.filter((x) => x.kind === 'bad_line').length, unknown_ids: rv.issues.filter((x) => x.kind === 'unknown_id').length,
        legacy_lines: rv.issues.filter((x) => x.kind === 'legacy_fields').length, future_at_lines: rv.issues.filter((x) => x.kind === 'future_at').length, final_status: finalStatus }
    : { file: reviewsFile, exists: false, final_status: finalStatus };
  const englishSummary = english ? { passages_file: passagesFile, passages: passages.length, structure_errors: enProblems.filter((x) => x.severity === 'error').length,
    structure_warnings: enProblems.filter((x) => x.severity === 'warn').length, file_level: enProblems.filter((x) => !x.id).map((x) => `${x.type}: ${x.detail}`) } : null;
  return { results, counts, reportFile, reviewSummary, englishSummary };
}

async function main() {
  loadEnv();
  const treeFile = arg('tree', '/workspace/kaoyan/tiku/knowledge_tree.json')!;
  const qSpec = arg('questions', '/workspace/kaoyan/tiku/math1_2024.json')!;
  const tagsArg = arg('kp-tags');
  const reportArg = arg('report');
  const reportDir = path.resolve(arg('report-dir', '.')!);
  fs.mkdirSync(reportDir, { recursive: true }); // 报告目录不存在时先建，免得整份文件因写报告失败而回滚
  const dry = process.argv.includes('--dry-run');

  const files = expandQuestionFiles(qSpec);
  if (!files.length) throw new Error(`没找到题目文件：${qSpec}（文件名要像 math1_2024.json）`);
  const single = files.length === 1;
  const kt = loadTree(treeFile);

  let client: Client | null = null;
  if (!dry) {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    for (const n of kt.nodes) {
      await client.query(
        `INSERT INTO knowledge_points(path,name,parent_path,level,sort_order,tree_version) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (path) DO UPDATE SET name=EXCLUDED.name,parent_path=EXCLUDED.parent_path,level=EXCLUDED.level,sort_order=EXCLUDED.sort_order,tree_version=EXCLUDED.tree_version`,
        [n.path, n.name, n.parent, n.level, n.order, kt.tree.schema_version ?? null]);
    }
  }
  try {
    const all: Record<string, number> = {};
    const failed: string[] = [];
    for (const qFile of files) {
      const m = YEARLY_FILE.exec(path.basename(qFile));
      const reportFile = single && reportArg ? path.resolve(reportArg)
        : path.join(reportDir, m ? `import_report_${m[1]}_${m[2]}.md` : `import_report_${path.basename(qFile, '.json')}.md`);
      const tagsFile = findTagsFile(qFile, tagsArg, single);
      // 每个文件一个 savepoint：一个文件出错（比如表结构没迁移）只回滚它自己，其他年份照常导入，最后再以非 0 退出
      let r: Awaited<ReturnType<typeof importFile>>;
      if (client) await client.query('SAVEPOINT import_file');
      try {
        r = await importFile(client, kt, { treeFile, qFile, tagsFile, reportFile, dry });
        if (client) await client.query('RELEASE SAVEPOINT import_file');
      } catch (e: any) {
        if (client) await client.query('ROLLBACK TO SAVEPOINT import_file');
        failed.push(path.basename(qFile));
        console.error(`❌ ${path.basename(qFile)}: Error ${e?.message ?? e}（这个文件没导入，其他文件继续）`);
        continue;
      }
      for (const [k, v] of Object.entries(r.counts)) all[k] = (all[k] || 0) + v;
      console.log(`${path.basename(qFile)}: ${r.results.length} questions, ${r.results.filter((x) => x.q.solution).length} with solution → ${r.reportFile}`);
      console.log('  problem counts:', r.counts);
      console.log('  reviews:', r.reviewSummary);
      if (r.englishSummary) console.log('  english1:', r.englishSummary);
    }
    if (client) await client.query('COMMIT');
    console.log(`done: ${files.length} file(s), ${kt.nodes.length} kp nodes (${kt.leafPaths.size} leaves)${dry ? ' [dry-run]' : ''}`);
    if (files.length > 1) console.log('total problem counts:', all);
    if (failed.length) { console.error(`❌ 导入失败 ${failed.length} 个文件（错误）：${failed.join('、')}`); process.exitCode = 1; }
  } catch (e) {
    if (client) await client.query('ROLLBACK');
    throw e;
  } finally {
    if (client) await client.end();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
