/**
 * 英语一试卷结构（统筹者/行业专家定的格式，满分 100）：
 *   use_of_english 1–20（20×0.5=10）、reading_a 21–40（20×2=40）、reading_b 41–45（5×2=10，type=match，选项个数按题型：七选五 7、小标题按文件、排序 7/8、匹配 7，答案一个字母）、
 *   translation 46–50（5×2=10，五道划线句各一题，共用一个 passage_id，answer=参考译文）、writing_a 51（10，essay）、writing_b 52（20，essay）
 * 纯函数：导入脚本、接口、测试共用。english2（15 分段落翻译）以后再加。
 */
export type EnglishSection = 'use_of_english' | 'reading_a' | 'reading_b' | 'translation' | 'writing_a' | 'writing_b';

export interface SectionSpec {
  key: EnglishSection; name: string; from: number; to: number; score: number; types: string[];
  needsPassage: boolean; optionKeys?: string[];
}

export const ENGLISH1_SECTIONS: SectionSpec[] = [
  { key: 'use_of_english', name: '完形填空', from: 1, to: 20, score: 0.5, types: ['choice', 'single_choice'], needsPassage: true, optionKeys: ['A', 'B', 'C', 'D'] },
  { key: 'reading_a', name: '阅读理解 A', from: 21, to: 40, score: 2, types: ['choice', 'single_choice'], needsPassage: true, optionKeys: ['A', 'B', 'C', 'D'] },
  { key: 'reading_b', name: '阅读理解 B（新题型）', from: 41, to: 45, score: 2, types: ['match'], needsPassage: true, optionKeys: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
  { key: 'translation', name: '翻译', from: 46, to: 50, score: 2, types: ['translation'], needsPassage: true },
  { key: 'writing_a', name: '写作 A（小作文）', from: 51, to: 51, score: 10, types: ['essay'], needsPassage: false },
  { key: 'writing_b', name: '写作 B（大作文）', from: 52, to: 52, score: 20, types: ['essay'], needsPassage: false },
];
export const ENGLISH1_TOTAL = 100;
export const ENGLISH1_COUNT = 52;
export const ENGLISH1_MINUTES = 180;
export const ENGLISH_SECTION_KEYS = ENGLISH1_SECTIONS.map((s) => s.key) as string[];
export const ENGLISH_SECTION_NAME: Record<string, string> = Object.fromEntries(ENGLISH1_SECTIONS.map((s) => [s.key, s.name]));

/** 每部分对应知识点树里的「章」节点（没标细知识点时用） */
export const ENGLISH_SECTION_KP: Record<string, string> = {
  use_of_english: '英语/完形填空', reading_a: '英语/阅读理解A', reading_b: '英语/阅读理解B（新题型）', translation: '英语/翻译', writing_a: '英语/写作', writing_b: '英语/写作',
};
export const isEnglishExam = (exam?: string | null) => /^english[12]$/.test(exam ?? '');
export const sectionSpec = (key?: string | null) => ENGLISH1_SECTIONS.find((s) => s.key === key);
/** 需要 AI 批改的主观题种类：translation / writing_a / writing_b；其余 null */
export function gradingKind(q: { exam?: string; section?: string | null; type?: string }): 'translation' | 'writing_a' | 'writing_b' | null {
  if (q.type === 'translation' || q.section === 'translation') return 'translation';
  if (q.type === 'essay' && (q.section === 'writing_a' || q.section === 'writing_b')) return q.section;
  return null;
}

/** 阅读 B 题型：gap_fill 七选五 / headings 小标题 / ordering 排序 / matching 匹配；heading_matching 是 headings 的别名 */
export const READING_B_SUBTYPES = ['gap_fill', 'headings', 'ordering', 'matching'] as const;
const SUBTYPE_ALIAS: Record<string, string> = { heading_matching: 'headings', heading: 'headings', gapfill: 'gap_fill', gap_filling: 'gap_fill', order: 'ordering', match: 'matching' };
export function normalizeSubtype(x: any): string | null {
  if (x == null || String(x).trim() === '') return null;
  const k = String(x).trim().toLowerCase();
  return SUBTYPE_ALIAS[k] ?? k;
}
/** 各题型允许的选项个数（headings 按文件实际给的，5–8 都接受） */
const SUBTYPE_OPTION_COUNTS: Record<string, number[]> = { gap_fill: [7], headings: [5, 6, 7, 8], ordering: [7, 8], matching: [7] };
/** 有 {{n}} 空位的阅读 B 题型（41–45 的空在文章里） */
export const READING_B_BLANK_SUBTYPES = ['gap_fill', 'headings'];

export type SpecProblem = { type: string; severity: 'error' | 'warn'; id: string | null; field: string; detail: string };

export const ENGLISH_PROBLEM_LABELS: Record<string, string> = {
  en_section_invalid: 'section 不是规定的六种之一',
  en_number_section: '题号和 section 对不上（1–20 完形、21–40 阅读 A、41–45 阅读 B、46–50 翻译、51 小作文、52 大作文）',
  en_type_invalid: 'type 和 section 对不上',
  en_score_invalid: '分值和规定不一致',
  en_count_invalid: '这一部分的题数不对',
  en_total_invalid: '全卷总分不是 100',
  en_number_missing: '缺题号',
  en_number_duplicate: '题号重复',
  en_id_invalid: 'id 格式应为 english1-<年>-NN',
  en_passage_missing: '题目没有 passage_id',
  en_passage_unknown: 'passage_id 在文章文件里找不到',
  en_passage_section: '题目和所挂文章的 section 不一致',
  en_options_invalid: '选项字母不对',
  en_answer_invalid: '答案格式不对',
  en_reference_missing: '翻译题缺参考译文（answer）',
  en_passages_file_missing: '没有文章文件 english1_<年>_passages.json',
  en_passages_file_bad: '文章文件不是合法的 JSON 数组',
  en_passage_invalid: '文章字段不全或格式不对',
  en_passage_duplicate: '文章 id 重复',
  en_passage_unused: '文章没有被任何题目引用',
  en_translation_passage_split: '五道翻译题应共用同一篇文章',
  en_marker_no_question: '文章里的标记（{{n}} / <u data-q>）对不上题目',
  en_marker_missing: '题目在文章里没有对应标记',
  en_marker_duplicate: '文章里同一个标记出现了多次',
  en_marker_wrong_section: '标记出现在不该出现的部分',
  en_marker_stem_mismatch: '翻译题 stem 和划线句不一致',
};

/** 校验一年英语一题目 + 文章（不碰数据库） */
export function validateEnglish1(year: number, questions: any[], passages: any[] | null, opts: { passagesFileExists: boolean; passagesParseError?: string } = { passagesFileExists: true }): SpecProblem[] {
  const out: SpecProblem[] = [];
  const add = (type: string, severity: 'error' | 'warn', id: string | null, field: string, detail: string) => out.push({ type, severity, id, field, detail });
  if (!opts.passagesFileExists) add('en_passages_file_missing', 'error', null, 'passages', `english1_${year}_passages.json 不存在，所有 passage_id 都挂不上`);
  if (opts.passagesParseError) add('en_passages_file_bad', 'error', null, 'passages', opts.passagesParseError);
  const pById = new Map<string, any>();
  for (const [i, p] of (passages ?? []).entries()) {
    const pid = typeof p?.id === 'string' ? p.id : null;
    if (!pid || !p.text || typeof p.text !== 'string' || !p.text.trim()) { add('en_passage_invalid', 'error', pid, `passages[${i}]`, `${pid ?? '(无 id)'}：缺 id 或 text`); if (!pid) continue; }
    if (pid && !new RegExp(`^english1-${year}-P-[A-Za-z0-9_-]+$`).test(pid)) add('en_passage_invalid', 'warn', pid, `passages[${i}].id`, `${pid}：id 建议写成 english1-${year}-P-<名字>`);
    if (!ENGLISH_SECTION_KEYS.includes(p?.section)) add('en_passage_invalid', 'error', pid, `passages[${i}].section`, `${pid}：section=${JSON.stringify(p?.section)}`);
    if (p?.images != null && !Array.isArray(p.images)) add('en_passage_invalid', 'error', pid, `passages[${i}].images`, `${pid}：images 应为数组`);
    if (p?.section === 'reading_b') {
      const st = normalizeSubtype(p.subtype);
      if (st && !(READING_B_SUBTYPES as readonly string[]).includes(st)) add('en_passage_invalid', 'warn', pid, `passages[${i}].subtype`, `${pid}：subtype=${JSON.stringify(p.subtype)}，应为 ${READING_B_SUBTYPES.join(' / ')}（heading_matching 当作 headings）`);
    }
    if (pById.has(pid)) add('en_passage_duplicate', 'error', pid, `passages[${i}].id`, pid);
    pById.set(pid, p);
  }
  const seenNo = new Map<number, string>();
  const used = new Set<string>();
  let total = 0;
  for (const q of questions) {
    const id = q?.id ?? null;
    const n = Number(q?.number);
    if (!new RegExp(`^english1-${year}-\\d{2}$`).test(id ?? '') || Number(String(id).slice(-2)) !== n) add('en_id_invalid', 'error', id, 'id', `${id}（number=${q?.number}）`);
    if (seenNo.has(n)) add('en_number_duplicate', 'error', id, 'number', `第 ${n} 题同时是 ${seenNo.get(n)} 和 ${id}`);
    seenNo.set(n, id);
    total += Number(q?.score) || 0;
    const sec = sectionSpec(q?.section);
    if (!sec) { add('en_section_invalid', 'error', id, 'section', JSON.stringify(q?.section)); continue; }
    if (n < sec.from || n > sec.to) add('en_number_section', 'error', id, 'number', `第 ${n} 题标成了 ${sec.key}（${sec.key} 是第 ${sec.from}–${sec.to} 题）`);
    if (!sec.types.includes(q.type)) add('en_type_invalid', 'error', id, 'type', `${sec.key} 的 type 应为 ${sec.types.join('/')}，现在是 ${JSON.stringify(q.type)}`);
    if (Number(q.score) !== sec.score) add('en_score_invalid', 'error', id, 'score', `${sec.key} 每题 ${sec.score} 分，现在是 ${JSON.stringify(q.score)}`);
    const ans: any[] = Array.isArray(q.answer) ? q.answer.filter((a: any) => a != null && String(a).trim()) : [];
    if (sec.optionKeys) {
      const keys = (q.options ?? []).map((o: any) => o?.key);
      const empty = (q.options ?? []).filter((o: any) => !String(o?.content ?? '').trim()).map((o: any) => o?.key);
      if (sec.key === 'reading_b') {
        // 阅读 B：选项个数按题型（七选五 7、小标题按文件、排序 7 或 8、匹配 7）；字母必须从 A 起连续；答案只要在给出的选项里
        const pass = q.passage_id ? pById.get(q.passage_id) : null;
        const st = normalizeSubtype(pass?.subtype);
        const passKeys = Array.isArray(pass?.options) ? pass.options.map((o: any) => o?.key) : [];
        if (!keys.length && passKeys.length) keys.push(...passKeys);
        const expectSeq = 'ABCDEFGH'.slice(0, keys.length).split('');
        if (JSON.stringify([...keys].sort()) !== JSON.stringify(expectSeq) || keys.length > 8) add('en_options_invalid', 'error', id, 'options', `阅读 B 选项应是从 A 起连续的字母（最多 H），现在是 ${keys.join('、') || '空'}`);
        const allowed = st ? SUBTYPE_OPTION_COUNTS[st] : [5, 6, 7, 8];
        if (keys.length && allowed && !allowed.includes(keys.length)) add('en_options_invalid', 'warn', id, 'options', `阅读 B（${st ?? '未标题型'}）一般 ${allowed.join(' 或 ')} 个选项，这题有 ${keys.length} 个`);
      } else if (JSON.stringify([...keys].sort()) !== JSON.stringify(sec.optionKeys)) add('en_options_invalid', 'error', id, 'options', `应为 A、B、C、D 四个选项，现在是 ${keys.join('、') || '空'}`);
      if (empty.length) add('en_options_invalid', 'error', id, 'options', `选项 ${empty.join('、')} 内容为空`);
      if (ans.length !== 1 || !/^[A-H]$/.test(String(ans[0]).trim())) add('en_answer_invalid', 'error', id, 'answer', `答案应是一个选项字母（${(keys.length ? keys : sec.optionKeys).join("")} 之一），现在是 ${JSON.stringify(q.answer)}`);
      else if (keys.length && !keys.includes(String(ans[0]).trim())) add('en_answer_invalid', 'error', id, 'answer', `答案 ${ans[0]} 不在选项里`);
    }
    if (sec.key === 'translation' && !ans.some((a) => String(a).trim().length >= 2)) add('en_reference_missing', 'error', id, 'answer', '翻译题 answer 要放参考译文');
    if (sec.key.startsWith('writing') && !ans.length) add('en_answer_invalid', 'warn', id, 'answer', '作文没有范文（answer 为空），AI 批改照常，但讲解页没有范文');
    const pid = q.passage_id;
    if (!pid) { if (sec.needsPassage) add('en_passage_missing', 'error', id, 'passage_id', `${sec.key} 的题必须挂文章`); }
    else {
      used.add(pid);
      const p = pById.get(pid);
      if (!p) add('en_passage_unknown', 'error', id, 'passage_id', `${pid} 不在 english1_${year}_passages.json 里`);
      else if (p.section !== q.section) add('en_passage_section', 'error', id, 'passage_id', `题目 section=${q.section}，文章 ${pid} 的 section=${p.section}`);
    }
  }
  for (const sec of ENGLISH1_SECTIONS) {
    const got = questions.filter((q) => q?.section === sec.key).length;
    const want = sec.to - sec.from + 1;
    if (got !== want) add('en_count_invalid', 'error', null, sec.key, `${sec.key} 应有 ${want} 题，现在 ${got} 题`);
  }
  const missing: number[] = [];
  for (let n = 1; n <= ENGLISH1_COUNT; n++) if (!seenNo.has(n)) missing.push(n);
  if (missing.length) add('en_number_missing', 'error', null, 'number', `缺第 ${missing.join('、')} 题`);
  if (Math.abs(total - ENGLISH1_TOTAL) > 1e-9) add('en_total_invalid', 'error', null, 'score', `全卷合计 ${total} 分，应为 ${ENGLISH1_TOTAL}`);
  const tp = new Set(questions.filter((q) => q?.section === 'translation' && q.passage_id).map((q) => q.passage_id));
  if (tp.size > 1) add('en_translation_passage_split', 'warn', null, 'passage_id', `翻译题挂了 ${tp.size} 篇文章：${[...tp].join('、')}`);
  for (const pid of pById.keys()) if (pid && !used.has(pid)) add('en_passage_unused', 'warn', pid, 'passages', pid);
  if (passages?.length) out.push(...validateMarkers(questions, passages));
  return out;
}

export interface PassageMarkers {
  /** 完形空位 {{n}}：start/end 是在原始 text 里的字符位置（含花括号） */
  blanks: { number: number; start: number; end: number }[];
  /** 翻译划线句 <u data-q="n">…</u>：text 是去掉标签的句子，start/end 是整个标签在原始 text 里的位置 */
  underlines: { number: number; text: string; start: number; end: number }[];
}
/** 解析文章里的标记，前端不用自己写正则 */
export function passageMarkers(text: string): PassageMarkers {
  const blanks: PassageMarkers['blanks'] = [];
  const underlines: PassageMarkers['underlines'] = [];
  for (const m of String(text ?? '').matchAll(/\{\{(\d+)\}\}/g)) blanks.push({ number: Number(m[1]), start: m.index!, end: m.index! + m[0].length });
  for (const m of String(text ?? '').matchAll(/<u\s+data-q=["'](\d+)["']\s*>([\s\S]*?)<\/u>/g)) underlines.push({ number: Number(m[1]), text: m[2], start: m.index!, end: m.index! + m[0].length });
  return { blanks, underlines };
}
const normSentence = (x: string) => String(x ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** 标记和题目互相对应：每个 {{n}} / <u data-q=n> 都有第 n 题且挂在这篇文章上；反过来每道完形 / 翻译题都在自己文章里有标记 */
export function validateMarkers(questions: any[], passages: any[]): SpecProblem[] {
  const out: SpecProblem[] = [];
  const add = (type: string, severity: 'error' | 'warn', id: string | null, field: string, detail: string) => out.push({ type, severity, id, field, detail });
  const byNo = new Map<number, any>(questions.map((q) => [Number(q?.number), q]));
  const marked = new Map<number, { pid: string; kind: 'blank' | 'underline'; text?: string }[]>();
  for (const p of passages) {
    if (!p?.id || typeof p.text !== 'string') continue;
    const mk = passageMarkers(p.text);
    const all = [...mk.blanks.map((b) => ({ n: b.number, kind: 'blank' as const, text: undefined as string | undefined })), ...mk.underlines.map((u) => ({ n: u.number, kind: 'underline' as const, text: u.text }))];
    const blanksOk = p.section === 'use_of_english' || (p.section === 'reading_b' && READING_B_BLANK_SUBTYPES.includes(normalizeSubtype(p.subtype) ?? ''));
    if (mk.blanks.length && !blanksOk) add('en_marker_wrong_section', 'warn', p.id, 'text', `${p.id}（${p.section}）里有 {{n}} 空位标记`);
    if (mk.underlines.length && p.section !== 'translation') add('en_marker_wrong_section', 'warn', p.id, 'text', `${p.id}（${p.section}）里有 <u data-q> 划线标记`);
    const seen = new Set<string>();
    for (const m of all) {
      const tag = m.kind === 'blank' ? `{{${m.n}}}` : `<u data-q="${m.n}">`;
      if (seen.has(tag)) add('en_marker_duplicate', 'error', p.id, 'text', `${p.id} 里 ${tag} 出现了不止一次`);
      seen.add(tag);
      marked.set(m.n, [...(marked.get(m.n) ?? []), { pid: p.id, kind: m.kind, text: m.text }]);
      const q = byNo.get(m.n);
      if (!q) { add('en_marker_no_question', 'error', p.id, 'text', `${p.id} 里的 ${tag} 没有对应的第 ${m.n} 题`); continue; }
      if (q.passage_id !== p.id) add('en_marker_no_question', 'error', q.id ?? p.id, 'passage_id', `${p.id} 里有 ${tag}，但第 ${m.n} 题的 passage_id 是 ${JSON.stringify(q.passage_id)}`);
      if (m.kind === 'underline' && q.section === 'translation' && normSentence(q.stem) !== normSentence(m.text!))
        add('en_marker_stem_mismatch', 'warn', q.id, 'stem', `第 ${m.n} 题 stem 和文章里的划线句不一致`);
    }
  }
  for (const q of questions) {
    const need = q?.section === 'use_of_english' ? 'blank' : q?.section === 'translation' ? 'underline' : null;
    if (!need || !q.passage_id) continue;
    const ms = (marked.get(Number(q.number)) ?? []).filter((m) => m.pid === q.passage_id && m.kind === need);
    if (!ms.length) add('en_marker_missing', 'error', q.id, 'passage_id', `文章 ${q.passage_id} 里找不到第 ${q.number} 题的${need === 'blank' ? ` {{${q.number}}} 空位` : ` <u data-q="${q.number}"> 划线句`}`);
  }
  return out;
}

export function passagesFileFor(qFile: string) {
  return qFile.replace(/\.json$/, '_passages.json');
}
