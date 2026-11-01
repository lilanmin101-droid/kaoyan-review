/**
 * 英语主观题 AI 批改（翻译 / 小作文 / 大作文），按 /workspace/kaoyan/tiku/explanation_review_standard_en.md：
 * - 翻译：每句 2 分，拆 2–4 个意义点（每点 0.5–1 分）；漏译/错译扣该点分，用词或语序不当每处 0.5；得分 0/0.5/1/1.5/2
 * - 小作文（10 分）/ 大作文（20 分）：五档评分，先定档再给分；字数不足（小作文 <100 词、大作文 <160 词）扣 1–2 分；
 *   小作文格式不对扣 1 分；署真实姓名（不是 Li Ming）扣分
 * - 输出 JSON：{band, score, max_score, points_hit[], errors[{span,type,fix}], suggestions[], model}，用 zod 校验
 * - 双模型（DeepSeek 主评、通义千问复评）：作文相差 > 1 档、翻译相差 > 1 分 → disagreement
 * - AI_FAKE=1：确定性的假模型，只给测试用（model = fake-grader-v1），线上绝不打开
 */
import { z } from 'zod';

export type GradeKind = 'translation' | 'writing_a' | 'writing_b';
export const MAX_SCORE: Record<GradeKind, number> = { translation: 2, writing_a: 10, writing_b: 20 };
export const MIN_WORDS: Partial<Record<GradeKind, number>> = { writing_a: 100, writing_b: 160 };
export const PENDING_GRADE_TEXT = '批改生成中';
export const FAILED_GRADE_TEXT = '批改暂时失败，稍后重试';
export const BAND_NAMES = ['零档', '第一档', '第二档', '第三档', '第四档', '第五档'];

/** 五档分数范围（档 1–5；0 档 = 空白/完全离题 0 分） */
export const BANDS: Record<'writing_a' | 'writing_b', Record<number, [number, number]>> = {
  writing_b: { 0: [0, 0], 1: [1, 4], 2: [5, 8], 3: [9, 12], 4: [13, 16], 5: [17, 20] },
  writing_a: { 0: [0, 0], 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9, 10] },
};
export function bandForScore(kind: GradeKind, score: number): number | null {
  if (kind === 'translation') return null;
  const t = BANDS[kind];
  for (const b of [5, 4, 3, 2, 1, 0]) if (score >= t[b][0]) return b;
  return 0;
}

export const ERROR_TYPES = ['grammar', 'vocab', 'spelling', 'logic', 'off_topic'] as const;
export const GradeSchema = z.object({
  band: z.number().int().min(0).max(5).nullable(),
  score: z.number().min(0),
  max_score: z.number().positive(),
  band_reason: z.string().default(''),
  points_hit: z.array(z.string()).default([]),
  points_missed: z.array(z.string()).default([]),
  errors: z.array(z.object({ span: z.string(), type: z.enum(ERROR_TYPES), fix: z.string() })).default([]),
  suggestions: z.array(z.string()).default([]),
  word_count: z.number().int().min(0).optional(),
  model: z.string(),
});
export type GradeResult = z.infer<typeof GradeSchema>;

/** 模型原始输出 → 校验 + 规范化（分数夹到 [0,max]、0.5 步长；作文档位和分数对齐） */
export function normalizeGrade(raw: any, kind: GradeKind, model: string, wordCount?: number): GradeResult {
  const max = MAX_SCORE[kind];
  const pre = { ...raw, max_score: max, model, word_count: wordCount };
  // 模型常把 band 写成「第四档」/「4」字符串、错误类型写大写，先宽松转一下再严格校验
  if (typeof pre.band === 'string') { const m = /[0-5]/.exec(pre.band) ?? null; const cn = BAND_NAMES.findIndex((b) => pre.band.includes(b.slice(1))); pre.band = m ? Number(m[0]) : cn >= 0 ? cn : null; }
  if (typeof pre.score === 'string') pre.score = Number(pre.score);
  if (Array.isArray(pre.errors)) pre.errors = pre.errors.map((e: any) => ({ span: String(e?.span ?? ''), type: String(e?.type ?? '').toLowerCase(), fix: String(e?.fix ?? '') }))
    .map((e: any) => (ERROR_TYPES.includes(e.type) ? e : { ...e, type: /spell|拼写/.test(e.type) ? 'spelling' : /vocab|word|用词|词汇/.test(e.type) ? 'vocab' : /topic|离题/.test(e.type) ? 'off_topic' : /logic|逻辑|coher/.test(e.type) ? 'logic' : 'grammar' }));
  if (kind === 'translation') pre.band = null;
  const g = GradeSchema.parse(pre);
  let score = Math.round(Math.min(max, Math.max(0, g.score)) * 2) / 2;
  let band = g.band;
  if (kind !== 'translation') {
    const want = bandForScore(kind, score)!;
    if (band == null || band !== want) band = want; // 以分数为准，档位跟着分数走（模型偶尔档位和分数对不上）
  }
  return { ...g, score, band };
}

const STANDARD_TRANSLATION = `你是考研英语一阅卷老师，批改一句英译汉（满分 2 分）。
评分规则（严格执行）：
1. 先把原句拆成 2–4 个意义点（每点 0.5–1 分，合计 2 分），对照参考译文逐点判断考生译文是否译出。
2. 漏译或错译一个意义点，扣该点的分；用词不当或语序不当，每处扣 0.5 分；整句意思完全不对得 0 分。
3. 得分只能是 0、0.5、1、1.5、2。不要因为与参考译文措辞不同而扣分，意思对就给分。`;
const STANDARD_WRITING = (kind: 'writing_a' | 'writing_b') => {
  const t = BANDS[kind];
  const max = MAX_SCORE[kind];
  return `你是考研英语一阅卷老师，批改${kind === 'writing_a' ? '小作文（应用文，满分 10 分）' : '大作文（图画/图表作文，满分 20 分）'}。
评分规则（严格执行，先定档再给分）：
- 第五档 ${t[5][0]}–${t[5][1]} 分：完成任务全部要求，内容切题、要点齐全，语法结构和词汇丰富准确，衔接自然，格式与语域恰当。
- 第四档 ${t[4][0]}–${t[4][1]} 分：基本完成任务，要点基本齐全，语法词汇较丰富，少量错误不影响理解。
- 第三档 ${t[3][0]}–${t[3][1]} 分：基本完成任务，漏掉一两个次要要点，有一些错误但不严重影响理解。
- 第二档 ${t[2][0]}–${t[2][1]} 分：未能按要求完成任务，漏掉或未能有效阐述要点，错误较多影响理解。
- 第一档 ${t[1][0]}–${t[1][1]} 分：明显未完成任务，内容与题目要求关系不大，错误很多。
- 0 分：空白、只写了几个词、或完全离题。
扣分：字数少于 ${MIN_WORDS[kind]} 词扣 1–2 分；${kind === 'writing_a' ? '书信/通知格式不对扣 1 分；署了真实姓名（不是题目要求的 Li Ming）要扣分；' : ''}不要因为风格偏好扣分。
满分 ${max} 分。`;
};

/** 给模型的消息（system：评分标准；user：题目 + 参考 + 考生答案 + 输出格式） */
export function buildGradeMessages(kind: GradeKind, q: { stem: string; answer?: string[]; passage_text?: string | null }, studentText: string, wordCount: number) {
  const sys = kind === 'translation' ? STANDARD_TRANSLATION : STANDARD_WRITING(kind);
  const format = `只输出一个 JSON 对象，不要其它文字：
{"band": ${kind === 'translation' ? 'null' : '0-5 的整数（档位）'}, "score": 分数（0.5 的倍数）, "band_reason": "${kind === 'translation' ? '扣分理由' : '定档理由（对照档位描述）'}",
 "points_hit": ["${kind === 'translation' ? '译出的意义点' : '覆盖到的要点'}"], "points_missed": ["漏掉/错误的意义点或要点"],
 "errors": [{"span": "考生原文里出错的片段（逐字摘抄）", "type": "grammar|vocab|spelling|logic|off_topic", "fix": "改法"}],
 "suggestions": ["${kind === 'translation' ? '1–2 条更好的译法' : '2–3 句升级表达：原句 → 改写'}"]}`;
  const user = [
    `【题目】\n${q.stem}`,
    kind === 'translation' && q.answer?.[0] ? `【参考译文（非官方）】\n${q.answer[0]}` : '',
    kind !== 'translation' && q.answer?.[0] ? `【参考范文（非官方，仅供参考，不要求考生和它一样）】\n${q.answer[0].slice(0, 2500)}` : '',
    kind !== 'translation' ? `【考生作文词数】${wordCount}` : '',
    `【考生答案】\n${studentText}`,
    format,
  ].filter(Boolean).join('\n\n');
  return [{ role: 'system' as const, content: sys }, { role: 'user' as const, content: user }];
}

export const countWords = (t: string) => (String(t ?? '').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length;

// ───────────── AI_FAKE=1：确定性假模型（测试专用） ─────────────
const MISSPELL: Record<string, string> = { recieve: 'receive', becuase: 'because', enviroment: 'environment', definately: 'definitely', beleive: 'believe', goverment: 'government', untill: 'until', freind: 'friend', tommorow: 'tomorrow', seperate: 'separate' };
const STOP = new Set('the a an and or of to in on for with is are be your you this that it as at by from about write words should'.split(' '));
const bigrams = (s: string) => { const t = s.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, ''); const out = new Set<string>(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };

export function fakeGrade(kind: GradeKind, q: { stem: string; answer?: string[] }, text: string, variant: 'primary' | 'cross' = 'primary'): any {
  const t = String(text ?? '').trim();
  const errors: any[] = [];
  for (const m of t.matchAll(/[A-Za-z]+/g)) { const fix = MISSPELL[m[0].toLowerCase()]; if (fix) errors.push({ span: m[0], type: 'spelling', fix }); }
  for (const m of t.matchAll(/(^|[\s.!?])i(?=\s)/g)) errors.push({ span: `${m[0].trim()}`, type: 'grammar', fix: 'I（第一人称要大写）' });
  if (kind === 'translation') {
    const ref = q.answer?.[0] ?? '';
    let pts = ref.split(/[，。；：！？、——]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
    while (pts.length > 4) { const [a, b, ...rest] = pts; pts = [a + b, ...rest]; }
    if (!pts.length) pts = [ref];
    const got = bigrams(t);
    const hit: string[] = [], missed: string[] = [];
    for (const p of pts) { const b = [...bigrams(p)]; const r = b.length ? b.filter((x) => got.has(x)).length / b.length : 0; (r >= 0.5 ? hit : missed).push(p); }
    const score = t ? Math.round((2 * hit.length / pts.length) * 2) / 2 : 0;
    if (!t) errors.push({ span: '', type: 'off_topic', fix: '没有作答' });
    return { band: null, score, band_reason: `${pts.length} 个意义点译出 ${hit.length} 个`, points_hit: hit, points_missed: missed, errors, suggestions: missed.length ? [`参考：${ref}`] : [] };
  }
  const words = countWords(t), min = MIN_WORDS[kind]!;
  const keys = [...new Set((q.stem.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)))];
  const low = t.toLowerCase();
  const hitKeys = keys.filter((k) => low.includes(k));
  let band = words === 0 ? 0 : words >= min ? 4 : words >= 0.6 * min ? 3 : words >= 0.3 * min ? 2 : 1;
  if (band >= 3 && keys.length && hitKeys.length === 0) { band = 1; errors.push({ span: t.slice(0, 40), type: 'off_topic', fix: '紧扣题目要求作答' }); }
  if (variant === 'cross' && process.env.AI_FAKE_DISAGREE === '1') band = Math.max(0, band - 2);
  const [lo, hi] = BANDS[kind][band];
  let score = Math.min(hi, lo + Math.min(hitKeys.length, hi - lo));
  if (words > 0 && words < min) score = Math.max(lo, score - 1);
  score = Math.max(band ? lo : 0, score - Math.min(errors.length, 2) * 0.5);
  if (kind === 'writing_a' && words && !/li ming/i.test(t)) errors.push({ span: t.split(/\n/).pop()!.slice(0, 30), type: 'logic', fix: '落款写 Li Ming，不要写真实姓名' });
  return {
    band, score, band_reason: `${words} 词（要求 ≥${min}），覆盖题目关键词 ${hitKeys.length}/${keys.length}`,
    points_hit: hitKeys, points_missed: keys.filter((k) => !hitKeys.includes(k)), errors,
    suggestions: ['把简单句 “It is important.” 升级为 “It is of vital importance that …”', '用 “Not only … but also …” 连接两个论点'],
  };
}

/** 两个模型的结果是否差太多：作文相差 > 1 档，翻译相差 > 1 分（阅卷标准：小作文/翻译 1 分、大作文 2 分为人工复核线） */
export function disagrees(kind: GradeKind, a: GradeResult, b: { band: number | null; score: number }) {
  if (kind === 'translation') return Math.abs(a.score - b.score) > 1;
  return Math.abs((a.band ?? 0) - (b.band ?? 0)) > 1;
}
