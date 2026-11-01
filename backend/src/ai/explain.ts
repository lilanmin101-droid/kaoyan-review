import { EXPERT_LABEL, expertExplanations } from './expert-explanations';
import { latestReview } from './explanation-reviews';
/**
 * 可信讲解：生成（DeepSeek）+ 交叉验证（通义千问独立解答）+ 与题库答案比对。
 * 规则（agent-architecture.md §4）：讲解必须带出处；双模型不一致时状态 needs_review，前端显示「这题讲解待核对」。
 * 纯函数 + llm.ts，脚本（npm run ai:explain）和接口都能用。
 */
import { chat, ChatMessage, ChatOptions, ChatResult, parseJsonLoose, ProviderId, providers } from './llm';
import { withTablesText } from '../common/tables';
import { ClozeRecurrence, clozeRecurrence } from './cloze-recurrence';

export const PENDING_NOTICE = '这题讲解待核对';

export interface QuestionRow {
  id: string; exam: string; year: number; number: number; type: string; section?: string; score?: number;
  stem: string; tables?: any; options: { key: string; content: string }[]; answer: string[]; sub_questions: any[];
  solution: string | null; knowledge_points: string[];
  review_status?: string; review_checked_by?: string[];
  errata?: { printed?: string; correct?: string; note?: string }[];
  passage_id?: string | null;
  /** 英语题所在文章（完形 / 阅读 / 新题型 / 翻译原文）；讲解提示词里带全文，证据句要从这里摘 */
  passage?: { id?: string; title?: string | null; directions?: string | null; text: string; tables?: any } | null;
  /** 完形「上下文复现」专家标注；不给就按题号读 kp_tags.json 的 evidence（单测可显式注入 / 置 null） */
  recurrence?: ClozeRecurrence | null;
}

/** 提示词版本：改了 generatorMessages / questionText / 质检规则就加一（gen:explanations 按它判断是否已生成）
 * v3：完形允许以空格所在句为证据；完形提示带行业专家标的「上下文复现」并要求讲解点出（质检核对） */
export const PROMPT_VERSION = 'explain-v3';
export const isCloze = (q: Pick<QuestionRow, 'exam' | 'section'>) => q.exam.startsWith('english') && q.section === 'use_of_english';

/** 英语客观题（完形、阅读 A、新题型）：讲解要给出原文证据句位置 */
export const isEnglishObjective = (q: QuestionRow) => q.exam.startsWith('english') && ['choice', 'match', 'single_choice', 'multi_choice'].includes(q.type);
/** 开放题（翻译、作文）：没有唯一答案，不做答案比对，改为对照参考译文/范文审核 */
export const isOpenEnded = (q: QuestionRow) => q.exam.startsWith('english') && ['translation', 'essay'].includes(q.type);

export const PENDING_TEXT = '讲解生成中';

export interface OfficialSolution {
  kind: 'expert' | 'solution' | 'proof';
  label: string;               // 给前端显示的出处：「行业专家参考解答（非官方解析）」「官方解析」「官方解析（未核对）」「题库参考证明（…核对）」
  verified: boolean;           // 讲解核对记录（reviews/explanations_<exam>_<year>.jsonl）最新一条是 pass / pass_minor
  review: { verdict: string; by?: string; at?: string; note?: string } | null;
  text: string;                // 完整 Markdown
  steps: { n: number; text: string }[];
}

/** 把一段 Markdown 解析按空行切成步骤（太短的段落并到前一步） */
function splitSteps(md: string): { n: number; text: string }[] {
  const parts = md.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && (p.length < 25 || /^\$\$/.test(p))) out[out.length - 1] += '\n\n' + p;
    else out.push(p);
  }
  return out.map((text, i) => ({ n: i + 1, text }));
}

/**
 * 题库里的「官方」讲解来源（没有 AI Key 时讲解接口只用它，不出示例内容）：
 * 0. /workspace/kaoyan/tiku/explanations/*_expert.jsonl 里行业专家写的分步参考讲解（kind=expert，接口 source=expert）
 * 1. questions.solution（原卷/官方解析，导入时来自题目 JSON 的 solution 字段）
 * 2. 证明题：题库答案本身就是完整证明，且该题已由校对人确认（review_status=confirmed）时，按小问逐步给出，出处写明核对人
 * 其他情况返回 null（前端显示「讲解生成中」）
 */
export const OFFICIAL_LABEL = '官方解析';
export const OFFICIAL_UNVERIFIED_LABEL = '官方解析（未核对）';

export function officialSolution(q: QuestionRow): OfficialSolution | null {
  const ex = expertExplanations().get(q.id);
  const hasSolution = !!(q.solution && q.solution.trim());
  const ctx = { hasExpert: !!ex, hasSolution };
  const rv = (kind: 'expert' | 'official_solution') => {
    const r = latestReview(q.id, kind, ctx);
    return { verified: !!r?.pass, review: r ? { verdict: r.verdict, by: r.by, at: r.at, note: r.note } : null };
  };
  // 优先级 expert > official：官方解析核对没通过但有专家讲解的题，直接用专家讲解
  if (ex) {
    const steps = ex.steps.map((text, i) => ({ n: i + 1, text }));
    if (ex.remember) steps.push({ n: steps.length + 1, text: `**下次记住**：${ex.remember}` });
    const label = EXPERT_LABEL;
    return { kind: 'expert', label, text: steps.map((s) => s.text).join('\n\n'), steps, ...rv('expert') };
  }
  if (hasSolution) {
    const r = rv('official_solution');
    return { kind: 'solution', label: r.verified ? OFFICIAL_LABEL : OFFICIAL_UNVERIFIED_LABEL, text: q.solution!.trim(), steps: splitSteps(q.solution!), ...r };
  }
  if (isProof(q) && q.review_status === 'confirmed') {
    const subs = (q.sub_questions ?? []) as any[];
    const bySub = subs.length && subs.every((s) => (s.answer ?? []).some((a: string) => String(a).trim()));
    const steps = bySub
      ? subs.map((s, i) => ({ n: i + 1, text: `**（${s.number}）** ${(s.answer as string[]).join('\n\n')}` }))
      : (q.answer ?? []).filter((a) => String(a).trim()).map((a, i) => ({ n: i + 1, text: String(a) }));
    if (!steps.length) return null;
    const by = (q.review_checked_by ?? []).filter(Boolean);
    return { kind: 'proof', label: `题库参考证明${by.length ? `（${by.join('、')}核对）` : ''}`, text: steps.map((s) => s.text).join('\n\n'), steps,
      verified: true, review: { verdict: 'confirmed', by: by.join('、') || undefined } };
  }
  return null;
}

const CHOICE_TYPES = new Set(['single_choice', 'multi_choice', 'choice', 'match']);
export const isChoiceType = (t: string) => CHOICE_TYPES.has(t);

export function officialAnswer(q: QuestionRow): string {
  const main = (q.answer ?? []).filter((a) => String(a).trim()).join('；');
  if (main) return main;
  const subs = (q.sub_questions ?? []).filter((s: any) => (s.answer ?? []).length)
    .map((s: any) => `（${s.number}）${(s.answer as string[]).join('；')}`);
  return subs.join('　');
}

export function questionText(q: QuestionRow) {
  const L: string[] = [];
  if (q.passage?.text) {
    // 段落编号（按空行切），讲解里的「第 n 段」以此为准
    const paras = withTablesText(q.passage.text, q.passage.tables).replace(/\r/g, '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    L.push(`【文章】${q.passage.title ?? ''}${q.passage.directions ? `\n${q.passage.directions}` : ''}`, ...paras.map((t, i) => `[第${i + 1}段] ${t}`), '');
  }
  L.push(`【题目】${q.year} 年 ${q.exam} 第 ${q.number} 题（${q.section ?? q.type}${q.score ? `，${q.score} 分` : ''}）`, withTablesText(q.stem, q.tables));
  if (q.options?.length) L.push('【选项】', ...q.options.map((o) => `${o.key}. ${o.content}`));
  if (q.sub_questions?.length) L.push('【小问】', ...q.sub_questions.map((s: any) => `（${s.number}）${s.stem ?? ''}`));
  const errata = (q.errata ?? []).filter((e) => e && (e.note || e.printed));
  if (errata.length) L.push('【原卷误印（题面按原卷保留，讲解涉及时写「原卷如此」并说明正确写法）】', ...errata.map((e) => `- ${e.note ?? `原卷印作「${e.printed}」，应为「${e.correct}」`}`));
  return L.join('\n');
}

export function citationFor(q: QuestionRow, basis: 'official_solution' | 'model') {
  return [{ exam: q.exam, year: q.year, number: q.number, question_id: q.id, knowledge_points: q.knowledge_points,
    basis: basis === 'official_solution' ? `以${officialSolution(q)?.label ?? OFFICIAL_LABEL}为底稿` : '模型生成，经双模型与题库答案核对' }];
}

/** 第一步：DeepSeek 生成分步讲解（有官方解析时以它为底稿，不另起炉灶） */
export function generatorMessages(q: QuestionRow): ChatMessage[] {
  const ans = officialAnswer(q);
  const english = q.exam.startsWith('english');
  const fmt = isEnglishObjective(q)
    ? '输出 JSON：{"steps":[{"n":1,"title":"一句话小目标","text":"这一步的讲解"}],"final_answer":"正确选项字母","evidence":{"paragraph":段落序号(数字),"sentence_index":该段第几句(数字),"location":"第2段第3句","quote":"从【文章】原样摘录的证据句（英文原句，一字不改）"},"key_points":["易错点/干扰项为什么错"]}'
    : isOpenEnded(q)
      ? '输出 JSON：{"steps":[{"n":1,"title":"一句话小目标","text":"这一步的讲解"}],"final_answer":"参考译文 / 范文要点（以【参考答案】为准）","key_points":["易错点"]}'
      : '输出 JSON：{"steps":[{"n":1,"title":"一句话小目标","text":"这一步的讲解"}],"final_answer":"你算出的最终答案（选择题只写字母）","key_points":["易错点"]}';
  const rec = isCloze(q) ? clozeRecurrence(q) : null;
  const evRule = isCloze(q)
    ? '完形：证据句可以就是空格所在的那句（固定搭配、语法题的依据往往就在本句），quote 摘这句时空格写成 ____ 或填入答案都可以；有上下文复现 / 呼应时优先点出复现的词句'
    : '新题型空位本身不算证据，要摘空位前后的句子';
  const extra = isEnglishObjective(q)
    ? `英语客观题：必须定位原文证据句（${evRule}；evidence.quote 原样摘录，paragraph/sentence_index 按【文章】里的 [第n段] 编号和句号计数）；讲解里写明「定位：第x段第y句」，逐个说明干扰项错在哪；最后一步写「答案：X」，全文不要把其他字母说成答案。`
      + (rec ? `\n\n【上下文复现（行业专家标注）】${rec.note}\n讲解里必须点出这处复现：把原文里复现 / 呼应的词句原样引出来（英文），说明它和答案 ${rec.answer_term || '这个词'} 的关系；可以放在定位那一步，或在 evidence.quote 里摘含复现词句的那句。` : '')
    : isOpenEnded(q)
      ? (q.type === 'translation' ? '翻译题：拆句子结构（主干、从句、非谓语），讲关键词的译法，最后给出参考译文（以【参考答案】为准）。' : '写作题：审题（体裁、对象、要点）、结构与段落安排、可用句型，最后给出范文要点（以【参考答案】为准）。')
      : '';
  return [
    { role: 'system', content: `你是考研数学/英语/政治的讲题老师。任务：讲解。用中文把题目拆成 3–7 步讲清楚，每步一个小目标${english ? '，引用英文原文时保留原文' : '，数学公式用 $...$（KaTeX）'}。只输出 JSON，不要多余文字。` },
    { role: 'user', content: [
      questionText(q),
      `【参考答案】${ans || '（题库未给出）'}`,
      officialSolution(q) ? `【${officialSolution(q)!.label}（底稿，以它为准，在它基础上展开讲清楚，不要改变结论）】\n${officialSolution(q)!.text}` : '',
      `【知识点】${(q.knowledge_points ?? []).join('；') || '未标注'}`,
      fmt,
      extra,
      '要求：前几步只给方向不直接给答案（这些步会作为分步提示逐步放出）；最后一步给出结论；如果你算出的答案和参考答案不同，final_answer 写你自己算出的，不要迁就。',
    ].filter(Boolean).join('\n\n') },
  ];
}

/** 第二步：通义千问独立解答（看不到参考答案和解析） */
export function verifierMessages(q: QuestionRow): ChatMessage[] {
  return [
    { role: 'system', content: '你是严谨的解题者。任务：独立解答。认真计算后只输出 JSON。' },
    { role: 'user', content: `${questionText(q)}\n\n输出 JSON：{"final_answer":"最终答案（选择题只写字母；多小问按（1）…（2）…）","brief":"关键步骤，100 字以内"}` },
  ];
}

export function judgeMessages(q: QuestionRow, a: string, b: string): ChatMessage[] {
  return [
    { role: 'system', content: '任务：判断等价。判断两个答案在数学/语义上是否等价（允许形式不同，如 1/2 与 0.5、化简前后）。只输出 JSON。' },
    { role: 'user', content: `${questionText(q)}\n\n【答案A】${a}\n【答案B】${b}\n\n输出 JSON：{"equivalent":true 或 false,"why":"一句话"}` },
  ];
}

export const normChoice = (s: string) => (String(s).toUpperCase().match(/[A-G]/g) ?? []).filter((v, i, arr) => arr.indexOf(v) === i).sort().join('');
const normText = (s: string) => String(s).replace(/\s|\$|\\[,;!]|\\left|\\right|。|，|,/g, '').replace(/\\dfrac|\\tfrac/g, '\\frac').toLowerCase();

/** 答案比对：选择题按字母集合；其他先做文本归一化，不同再让验证模型判等 */
export async function sameAnswer(q: QuestionRow, a: string, b: string, call: ChatFn = defaultChat): Promise<{ equal: boolean; how: string; why?: string }> {
  if (!a || !b) return { equal: false, how: 'missing' };
  if (CHOICE_TYPES.has(q.type)) {
    const x = normChoice(a), y = normChoice(b);
    return { equal: !!x && x === y, how: 'choice', why: `${x} vs ${y}` };
  }
  if (normText(a) === normText(b)) return { equal: true, how: 'text' };
  const r = await call('qwen', { messages: judgeMessages(q, a, b), json: true, temperature: 0, maxTokens: 300 }, 'judge');
  const j = parseJsonLoose<{ equivalent: boolean; why?: string }>(r.text);
  return { equal: j.equivalent === true, how: 'judge', why: j.why };
}

export interface ExplainResult {
  steps: { n: number; title?: string; text: string }[];
  full_text: string;
  final_answer: { official: string; primary: string; verifier: string };
  verified: boolean;
  status: 'published' | 'needs_review';
  verify_detail: any;
  citations: any[];
  model: string;
}

/** 证明题（题干要求证明、标准答案是一整段证明）：没法比「最终答案」，改为让验证模型逐步审核讲解 */
export function isProof(q: QuestionRow) {
  return /证明/.test(q.stem + (q.sub_questions ?? []).map((s: any) => s.stem ?? '').join('')) && officialAnswer(q).length > 150;
}

export function proofReviewMessages(q: QuestionRow, steps: any[]): ChatMessage[] {
  return [
    { role: 'system', content: '你是严谨的数学审稿人。任务：审核证明。对照标准答案，逐步检查讲解有没有错误、跳步或循环论证。只输出 JSON。' },
    { role: 'user', content: `${questionText(q)}\n\n【标准答案】${officialAnswer(q)}\n\n【待审核讲解】\n${steps.map((s: any) => `${s.n}. ${s.title ?? ''} ${s.text}`).join('\n')}\n\n输出 JSON：{"valid":true 或 false,"issues":["问题描述（第几步）"]}` },
  ];
}

/** 开放题（翻译 / 作文）：对照参考译文 / 范文审核讲解 */
export function openReviewMessages(q: QuestionRow, steps: any[]): ChatMessage[] {
  return [
    { role: 'system', content: '你是严谨的考研英语阅卷老师。任务：审核讲解。对照参考答案，检查讲解有没有语法分析错误、译法错误、与参考答案矛盾或编造原文。只输出 JSON。' },
    { role: 'user', content: `${questionText(q)}\n\n【参考答案】${officialAnswer(q)}\n\n【待审核讲解】\n${steps.map((s: any) => `${s.n}. ${s.title ?? ''} ${s.text}`).join('\n')}\n\n输出 JSON：{"valid":true 或 false,"issues":["问题描述（第几步）"]}` },
  ];
}

/** 模型调用函数（gen:explanations 注入限速 / AI_FAKE 假模型；默认直接调 llm.chat） */
export type ChatFn = (p: ProviderId, o: ChatOptions, role: 'generate' | 'verify' | 'judge' | 'review') => Promise<ChatResult>;
const defaultChat: ChatFn = (p, o) => chat(p, o);

/** 整条流水线：生成 → 独立解答 → 三方比对（证明题 / 开放题：生成 → 审核） */
export async function explainQuestion(q: QuestionRow, call: ChatFn = defaultChat): Promise<ExplainResult & { generated: any }> {
  const ps = providers();
  const gen = await call('deepseek', { model: ps.deepseek.models.reasoner, thinking: true, messages: generatorMessages(q), maxTokens: 6000 }, 'generate');
  const g = parseJsonLoose<{ steps: any[]; final_answer: string; key_points?: string[] }>(gen.text);
  const steps = (g.steps ?? []).map((s: any, i: number) => ({ n: i + 1, title: s.title ? String(s.title) : undefined, text: String(s.text ?? s.content ?? '') }))
    .filter((s) => s.text.trim());
  if (!steps.length) throw new Error('生成的讲解没有步骤');
  const official = officialAnswer(q);
  const primary = String(g.final_answer ?? '').trim();
  const reasons: string[] = [];
  let checks: any = {};
  let verifier = '';
  let ver: any;
  let verifierBrief: string | null = null;
  if (isProof(q) || isOpenEnded(q)) {
    const open = isOpenEnded(q);
    ver = await call('qwen', { messages: open ? openReviewMessages(q, steps) : proofReviewMessages(q, steps), json: true, temperature: 0, maxTokens: 2000 }, 'review');
    const v = parseJsonLoose<{ valid: boolean; issues?: string[] }>(ver.text);
    const what = open ? '讲解' : '证明';
    verifier = v.valid === true ? `${what}审核通过` : `${what}审核未通过`;
    checks = { mode: open ? 'open_review' : 'proof_review', valid: v.valid === true, issues: v.issues ?? [] };
    if (v.valid !== true) reasons.push(`验证模型审核${what}未通过：${(v.issues ?? []).join('；') || '未说明'}`);
  } else {
    ver = await call('qwen', { messages: verifierMessages(q), json: true, temperature: 0, maxTokens: 2000 }, 'verify');
    const v = parseJsonLoose<{ final_answer: string; brief?: string }>(ver.text);
    verifier = String(v.final_answer ?? '').trim();
    verifierBrief = v.brief ?? null;
    if (!official) reasons.push('题库没有标准答案，无法三方核对');
    else {
      const [pg, vg] = await Promise.all([sameAnswer(q, primary, official, call), sameAnswer(q, verifier, official, call)]);
      checks = { mode: 'answer_match', primary_vs_official: pg, verifier_vs_official: vg };
      if (!pg.equal) reasons.push(`讲解模型答案（${primary || '空'}）与题库答案（${official}）不一致`);
      if (!vg.equal) reasons.push(`验证模型答案（${verifier || '空'}）与题库答案（${official}）不一致`);
    }
  }
  const verified = reasons.length === 0;
  const full = steps.map((s) => `**${s.n}. ${s.title ?? ''}**\n${s.text}`).join('\n\n');
  return {
    steps, full_text: full,
    final_answer: { official, primary, verifier },
    verified, status: verified ? 'published' : 'needs_review',
    generated: g,
    verify_detail: {
      reasons, checks, key_points: g.key_points ?? [], evidence: (g as any).evidence ?? null, verifier_brief: verifierBrief, used_official_solution: officialSolution(q)?.label ?? null,
      models: { primary: gen.model, verifier: ver.model }, ms: { primary: gen.ms, verifier: ver.ms }, usage: { primary: gen.usage, verifier: ver.usage },
    },
    citations: citationFor(q, officialSolution(q) ? 'official_solution' : 'model'),
    model: `${gen.model}+${ver.model}`,
  };
}

/** 划词追问 / 为什么错：只基于已校验讲解回答 */
export async function followup(q: QuestionRow, steps: any[], o: { selectedText?: string; step?: number; chosen_option?: string; mode?: string }) {
  const ctx = steps.map((s: any) => `${s.n}. ${s.title ? s.title + '：' : ''}${s.text}`).join('\n');
  const ask = o.mode === 'why_wrong' && o.chosen_option
    ? `我选了 ${o.chosen_option}，为什么错？指出这个选项错在哪一步、常见的错误想法是什么。`
    : `我没看懂${o.step ? `第 ${o.step} 步里` : ''}这句：「${(o.selectedText ?? '').slice(0, 300)}」。请解释它为什么成立。`;
  const r = await chat('deepseek', {
    messages: [
      { role: 'system', content: '你是讲题老师。只依据给出的「已核对讲解」回答，不引入新的结论；中文，3–6 句，公式用 $...$。如果问题超出讲解范围，直说。' },
      { role: 'user', content: `${questionText(q)}\n\n【题库答案】${officialAnswer(q)}\n\n【已核对讲解】\n${ctx}\n\n【学生的问题】${ask}` },
    ],
    temperature: 0.3, maxTokens: 800,
  });
  return r.text.trim();
}

export const AI_VERIFIED_LABEL = 'AI 讲解（双模型核对）';

/** 题目讲解的出处信息（/questions/{id}、/wrong-questions、PDF 用）：aiVerifiedId = 已核对发布的 AI 讲解 id（有就优先） */
export function explanationInfo(q: QuestionRow, aiVerifiedId?: string | null) {
  if (aiVerifiedId) return { source: 'ai' as const, source_label: AI_VERIFIED_LABEL, verified: true, review: null, explanation_id: aiVerifiedId };
  const o = officialSolution(q);
  if (!o) return { source: 'pending' as const, source_label: null, verified: false, review: null, explanation_id: null };
  return { source: o.kind === 'expert' ? 'expert' as const : 'official' as const, source_label: o.label, verified: o.verified, review: o.review, explanation_id: null };
}
