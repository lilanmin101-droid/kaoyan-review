/**
 * 讲解预生成 / 现场生成共用：取题（带文章全文）→ explainQuestion（双模型）→ 自动质检 → 入库。
 * - 批量：npm run gen:explanations（scripts/gen-explanations.ts）
 * - 现场：讲解接口发现没有可用讲解、且 AI 已接入时调用 ensureExplanation（同一题同时只生成一次）
 * 质检不过关 → status=needs_review、verified=false（前端「这题讲解待核对」），绝不当作好讲解发出。
 * AI_FAKE=1：确定性假模型（测试专用，model=fake-explainer-v1）；AI_FAKE_EXPLAIN_FAULTS="题id:故障,…" 注入故障测质检。
 */
import { ChatOptions, ChatResult, isConfigured, ProviderId } from './llm';
import { ChatFn, explainQuestion, ExplainResult, generatorMessages, isChoiceType, isEnglishObjective, isOpenEnded, isProof, normChoice, officialAnswer,
  officialSolution, openReviewMessages, proofReviewMessages, PROMPT_VERSION, QuestionRow, verifierMessages } from './explain';

export interface Queryable { query(sql: string, params?: any[]): Promise<{ rows: any[] }> }

export const EXPLAIN_GEN_COLS = 'q.id,q.exam,q.year,q.number,q.type,q.section,q.score::float AS score,q.stem,q.tables,q.errata,q.options,q.answer,q.sub_questions,q.solution,q.knowledge_points,q.review_status,q.review_checked_by,q.passage_id';
const PASSAGE_JSON = `CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id',p.id,'title',p.title,'directions',p.directions,'text',p.text,'tables',p.tables) END AS passage`;

/** 按条件取题（带文章）；where 里用 q. 前缀 */
export async function loadExplainQuestions(db: Queryable, where = 'true', params: any[] = [], order = 'q.exam, q.year, q.number'): Promise<QuestionRow[]> {
  return (await db.query(`SELECT ${EXPLAIN_GEN_COLS}, ${PASSAGE_JSON} FROM questions q LEFT JOIN passages p ON p.id=q.passage_id WHERE ${where} ORDER BY ${order}`, params)).rows;
}

// ───────────── 质检 ─────────────
export interface Quality { ok: boolean; failures: { code: string; detail: string }[]; warnings: { code: string; detail: string }[]; checked_at: string }
export const LENGTH_BOUNDS = {
  english_objective: { min: 120, max: 5000 },
  open: { min: 200, max: 10000 },
  math: { min: 80, max: 9000 },
  step_max: 3000,
  steps: { min: 2, max: 10 },
};
const BAD_TEXT = /(^|[^A-Za-z])(null|undefined|NaN)(?![A-Za-z])|\[object Object\]/;
/** 证据句比对用的归一化：去完形空位 {{n}} / （n） / 下划线，统一引号和空白，小写 */
export const normEvidence = (s: string) => String(s ?? '')
  .replace(/\{\{\d+\}\}|（\d+）|\(\d+\)|_{2,}/g, ' ')
  .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, '-')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const paragraphsOf = (text: string) => String(text ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

/** 文本里「说成答案」的字母（排除「不选 A」这类否定） */
export function assertedLetters(text: string): string[] {
  const out: string[] = [];
  const re = /(?<![不别勿误错])(?:正确答案|正确选项|答案|故选|应选|所以选|因此选|选)\s*(?:是|为|应为|应是)?\s*[:：]?\s*[（(]?\s*([A-G])(?![A-Za-z])/g;
  for (const m of String(text).matchAll(re)) out.push(m[1].toUpperCase());
  return [...new Set(out)];
}

export function qualityCheck(q: QuestionRow, r: Pick<ExplainResult, 'steps' | 'full_text' | 'final_answer'> & { generated?: any }): Quality {
  const failures: Quality['failures'] = [], warnings: Quality['warnings'] = [];
  const fail = (code: string, detail: string) => failures.push({ code, detail });
  const warn = (code: string, detail: string) => warnings.push({ code, detail });
  const steps = r.steps ?? [];
  const full = [r.full_text ?? '', ...steps.map((s) => `${s.title ?? ''} ${s.text ?? ''}`)].join('\n');
  // 1. 空 / null / NaN
  if (steps.length < LENGTH_BOUNDS.steps.min || steps.length > LENGTH_BOUNDS.steps.max) fail('step_count', `步数 ${steps.length}（要求 ${LENGTH_BOUNDS.steps.min}–${LENGTH_BOUNDS.steps.max}）`);
  steps.forEach((s, i) => {
    const t = String(s.text ?? '');
    if (!t.trim()) fail('empty_step', `第 ${i + 1} 步为空`);
    if (t.length > LENGTH_BOUNDS.step_max) fail('step_too_long', `第 ${i + 1} 步 ${t.length} 字（上限 ${LENGTH_BOUNDS.step_max}）`);
  });
  const bad = full.match(BAD_TEXT);
  if (bad) fail('bad_text', `讲解里出现「${bad[0].trim()}」`);
  if (String(r.final_answer?.primary ?? '').match(BAD_TEXT) || !String(r.final_answer?.primary ?? '').trim()) fail('bad_final_answer', `final_answer=${JSON.stringify(r.final_answer?.primary ?? null)}`);
  // 2. 长度
  const kind = isOpenEnded(q) ? 'open' : isEnglishObjective(q) ? 'english_objective' : 'math';
  const b = LENGTH_BOUNDS[kind];
  const len = steps.reduce((n, s) => n + String(s.text ?? '').length, 0);
  if (len < b.min) fail('too_short', `讲解共 ${len} 字（${kind} 下限 ${b.min}）`);
  if (len > b.max) fail('too_long', `讲解共 ${len} 字（${kind} 上限 ${b.max}）`);
  // 3. 选择题：答案字母必须和题库一致
  if (isChoiceType(q.type)) {
    const official = normChoice((q.answer ?? []).join(''));
    const fin = normChoice(r.final_answer?.primary ?? '');
    if (!official) warn('no_official_answer', '题库没有标准答案，无法核对字母');
    else {
      if (fin !== official) fail('final_answer_mismatch', `final_answer ${fin || '空'} ≠ 题库 ${official}`);
      const said = assertedLetters(full);
      const wrong = said.filter((l) => !official.includes(l));
      if (wrong.length) fail('answer_letter_conflict', `讲解里把 ${wrong.join('、')} 说成答案（题库 ${official}）`);
      if (!said.length && !official.split('').every((l) => new RegExp(`(?<![A-Za-z])${l}(?![A-Za-z])`).test(full))) fail('answer_letter_missing', `讲解里没有出现正确选项 ${official}`);
    }
  }
  // 4. 英语客观题：证据句必须真在原文里
  if (isEnglishObjective(q)) {
    const ev = r.generated?.evidence;
    const src = q.passage?.text ?? q.stem;
    if (!ev || !String(ev.quote ?? '').trim()) fail('evidence_missing', '没有给出原文证据句');
    else {
      const nq = normEvidence(ev.quote);
      if (nq.length < 8 || !normEvidence(src).includes(nq)) fail('evidence_not_in_passage', `证据句不在原文里：「${String(ev.quote).slice(0, 80)}」`);
      else if (ev.paragraph) {
        const paras = paragraphsOf(src);
        const p = Number(ev.paragraph);
        if (!(p >= 1 && p <= paras.length) || !normEvidence(paras[p - 1]).includes(nq)) warn('evidence_paragraph_mismatch', `证据句不在第 ${ev.paragraph} 段`);
      }
      if (!ev.location && !/第\s*\d+\s*段/.test(full)) warn('evidence_location_missing', '讲解里没写证据句位置（第几段第几句）');
    }
  }
  // 5. 原卷误印：讲解提到误印原文时应写「原卷如此」
  for (const e of (q.errata ?? [])) {
    if (e?.printed && full.includes(e.printed) && !full.includes('原卷如此')) warn('errata_not_marked', `提到原卷误印「${e.printed}」但没写「原卷如此」`);
  }
  return { ok: failures.length === 0, failures, warnings, checked_at: new Date().toISOString() };
}

// ───────────── 生成 + 入库 ─────────────
export interface GenOutcome { result: ExplainResult & { generated: any }; quality: Quality; status: 'published' | 'needs_review'; verified: boolean }

export async function generateChecked(q: QuestionRow, call?: ChatFn): Promise<GenOutcome> {
  const result = await explainQuestion(q, call ?? (aiFake() ? fakeChatFor(q) : undefined));
  const quality = qualityCheck(q, result);
  const verified = result.verified && quality.ok;
  return { result, quality, status: verified ? 'published' : 'needs_review', verified };
}

export async function storeExplanation(db: Queryable, q: QuestionRow, o: GenOutcome, origin: 'batch' | 'on_demand') {
  const r = o.result;
  const usage = r.verify_detail?.usage ?? {};
  for (let attempt = 0; ; attempt++) {
    try {
      return (await db.query(
        `INSERT INTO ai_explanations(question_id,version,model,steps,full_text,final_answer,verified,verify_detail,citations,status,prompt_version,quality,origin,usage)
         VALUES($1,(SELECT COALESCE(max(version),0)+1 FROM ai_explanations WHERE question_id=$1),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, version, status, verified, created_at`,
        [q.id, r.model, JSON.stringify(r.steps), r.full_text, JSON.stringify(r.final_answer), o.verified, JSON.stringify(r.verify_detail), JSON.stringify(r.citations),
          o.status, PROMPT_VERSION, JSON.stringify(o.quality), origin, JSON.stringify(usage)])).rows[0];
    } catch (e: any) {
      if (e.code === '23505' && attempt < 3) continue; // 同一题并发写版本号撞了，重试
      throw e;
    }
  }
}

export const aiFake = () => process.env.AI_FAKE === '1';
/** 能不能生成讲解：AI_FAKE，或两个 Key 都在（生成 DeepSeek + 核对通义千问） */
export const canGenerate = () => aiFake() || (isConfigured('deepseek') && isConfigured('qwen'));

const inflight = new Map<string, Promise<any>>();
const HAVE_SQL = `SELECT 1 FROM ai_explanations WHERE question_id=$1 AND ((status='published' AND verified) OR (status IN ('needs_review','pending_review') AND prompt_version=$2)) LIMIT 1`;
/** 这题现在会不会现场生成（讲解接口据此决定要不要推 progress 事件） */
export async function willGenerate(db: Queryable, id: string) {
  if (process.env.EXPLAIN_ON_DEMAND === '0' || !canGenerate()) return false;
  if (inflight.has(id)) return true;
  return !(await db.query(HAVE_SQL, [id, PROMPT_VERSION])).rows[0];
}
/**
 * 讲解接口现场生成（回退路径）：已有已核对讲解 / 官方或专家解析 / 当前提示词版本的待核对版本 → 不生成。
 * EXPLAIN_ON_DEMAND=0 关闭。返回新写入的行（或 null）。
 */
export async function ensureExplanation(db: Queryable, id: string): Promise<{ id: string; status: string; verified: boolean } | null> {
  if (process.env.EXPLAIN_ON_DEMAND === '0' || !canGenerate()) return null;
  if (inflight.has(id)) return inflight.get(id)!;
  const job = (async () => {
    const [q] = await loadExplainQuestions(db, 'q.id=$1', [id]);
    if (!q || officialSolution(q)) return null;
    const have = (await db.query(HAVE_SQL, [id, PROMPT_VERSION])).rows[0];
    if (have) return null;
    const o = await generateChecked(q);
    return storeExplanation(db, q, o, 'on_demand');
  })().finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

// ───────────── 成本估算 ─────────────
/** DeepSeek 官方换算：1 个中文字符 ≈ 0.6 token，1 个英文字符 ≈ 0.3 token */
export function estimateTokens(text: string) {
  let cjk = 0, other = 0;
  for (const ch of String(text)) { if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk++; else other++; }
  return Math.ceil(cjk * 0.6 + other * 0.3);
}
/** 每道题预计输出（含思考链）token：按题型估 */
export function expectedOutput(q: QuestionRow) {
  if (isOpenEnded(q)) return q.type === 'translation' ? { thinking: 1200, answer: 900 } : { thinking: 1500, answer: 1600 };
  if (isEnglishObjective(q)) return { thinking: 1500, answer: 700 };
  if (q.type === 'essay') return { thinking: 5000, answer: 1600 };
  return { thinking: 2500, answer: 800 };
}
export function estimateQuestion(q: QuestionRow) {
  const msgText = (m: { content: string }[]) => m.map((x) => x.content).join('\n');
  const out = expectedOutput(q);
  const genIn = estimateTokens(msgText(generatorMessages(q)));
  const review = isProof(q) || isOpenEnded(q);
  const verIn = review
    ? estimateTokens(msgText((isOpenEnded(q) ? openReviewMessages : proofReviewMessages)(q, []))) + out.answer
    : estimateTokens(msgText(verifierMessages(q)));
  const judge = !review && !isChoiceType(q.type) && !!officialAnswer(q); // 非选择题答案文本不同时让验证模型判等（按最坏每题 2 次）
  const judgeIn = judge ? 2 * (estimateTokens(msgText(verifierMessages(q))) + 100) : 0;
  return {
    deepseek: { input: genIn, output: out.thinking + out.answer },
    qwen: { input: verIn + judgeIn, output: (review ? 400 : 300) + (judge ? 2 * 60 : 0) },
  };
}
/** 单价（美元 / 百万 token），可用环境变量覆盖；默认 2026-11 官网价：deepseek-flash 高峰 / 低峰，qwen-max 北京 */
export function prices() {
  const n = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
  return {
    deepseek_peak: { input: n('DEEPSEEK_PRICE_IN', 0.30), output: n('DEEPSEEK_PRICE_OUT', 1.20) },
    deepseek_offpeak: { input: n('DEEPSEEK_PRICE_IN_OFFPEAK', 0.15), output: n('DEEPSEEK_PRICE_OUT_OFFPEAK', 0.60) },
    qwen: { input: n('QWEN_PRICE_IN', 0.345), output: n('QWEN_PRICE_OUT', 1.377) },
  };
}

// ───────────── AI_FAKE 假模型（测试专用） ─────────────
const faults = (): Record<string, string> => Object.fromEntries(String(process.env.AI_FAKE_EXPLAIN_FAULTS ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  .map((x) => { const i = x.lastIndexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; }));
const sentencesOf = (p: string) => p.split(/(?<=[.!?])\s+(?=[A-Z“"‘'({])/).map((s) => s.trim()).filter(Boolean);

/** 给假模型挑证据句：完形 / 新题型找含 {{题号}} 的句子，其余取文章第一段第一句 */
function fakeEvidence(q: QuestionRow) {
  const paras = paragraphsOf(q.passage?.text ?? q.stem);
  const mark = `{{${q.number}}}`;
  let pi = paras.findIndex((p) => p.includes(mark));
  if (pi < 0) pi = 0;
  const ss = sentencesOf(paras[pi] ?? '');
  let si = ss.findIndex((s) => s.includes(mark));
  if (si >= 0 && normEvidence(ss[si]).length < 8) {
    // 新题型整句 / 整段空：取空前后的句子（同段相邻句，否则上一段最后一句 / 下一段第一句）
    if (ss[si + 1]) si = si + 1; else if (ss[si - 1]) si = si - 1;
    else {
      const prev = paras[pi - 1] ? sentencesOf(paras[pi - 1]) : [], next = paras[pi + 1] ? sentencesOf(paras[pi + 1]) : [];
      if (prev.length) { pi = pi - 1; ss.splice(0, ss.length, ...prev); si = prev.length - 1; } else if (next.length) { pi = pi + 1; ss.splice(0, ss.length, ...next); si = 0; }
    }
  }
  if (si < 0) si = ss.findIndex((s) => normEvidence(s).length >= 8);
  if (si < 0) si = 0;
  return { paragraph: pi + 1, sentence_index: si + 1, location: `第${pi + 1}段第${si + 1}句`, quote: ss[si] ?? paras[pi] ?? '' };
}

export function fakeChatFor(q: QuestionRow): ChatFn {
  const fault = faults()[q.id];
  const letters = 'ABCDEFG';
  const off = officialAnswer(q);
  const offLetter = normChoice((q.answer ?? []).join(''));
  const other = letters.split('').find((l) => !offLetter.includes(l) && (q.options ?? []).some((o) => o.key === l)) ?? 'A';
  const res = (p: ProviderId, text: string, inTok: number, outTok: number): ChatResult =>
    ({ provider: p, model: p === 'deepseek' ? 'fake-explainer-v1' : 'fake-verifier-v1', text, ms: 1, usage: { prompt_tokens: inTok, completion_tokens: outTok } });
  return async (p: ProviderId, o: ChatOptions, role) => {
    const inTok = estimateTokens(o.messages.map((m) => m.content).join('\n'));
    if (fault === 'error' && role === 'generate') throw new Error('AI_FAKE 注入的生成失败');
    if (role === 'generate') {
      const choice = isChoiceType(q.type) && !!offLetter;
      const ans = choice ? (fault === 'wrong_letter' ? other : offLetter) : off || '（略）';
      const ev = isEnglishObjective(q) ? fakeEvidence(q) : null;
      if (ev && fault === 'bad_evidence') ev.quote = 'This sentence does not appear anywhere in the original passage at all.';
      const steps = fault === 'short' ? [{ n: 1, title: '答案', text: `答案：${ans}` }] : [
        { n: 1, title: '读题', text: `先看题干在问什么：${String(q.stem).replace(/\{\{\d+\}\}/g, '____').slice(0, 60)}……弄清考查点（${(q.knowledge_points ?? []).join('、') || q.section || q.type}）。` },
        ev ? { n: 2, title: '定位原文', text: `定位：${ev.location}。原文：“${ev.quote}” 这句话直接对应题干。` }
          : { n: 2, title: '思路', text: '先把条件整理清楚，确定用哪个方法，再一步步推下去，每一步都检查条件是否满足。' },
        { n: 3, title: choice ? '排除干扰项' : '展开', text: choice ? `逐个看选项：${(q.options ?? []).filter((x) => !offLetter.includes(x.key)).map((x) => `${x.key} 与原文不符`).join('；')}。` : '按上一步的思路展开推导 / 分析，注意易错点。' },
        { n: 4, title: '结论', text: fault === 'nan' ? '所以结果是 NaN。' : fault === 'conflict' ? `综上，答案：${other}。` : choice ? `综上，答案：${ans}。` : `综上，参考答案：${ans}`.slice(0, 2000) },
      ];
      return res(p, JSON.stringify({ steps, final_answer: ans, ...(ev ? { evidence: ev } : {}), key_points: ['（假模型）'] }), inTok, 900);
    }
    if (role === 'verify') return res(p, JSON.stringify({ final_answer: fault === 'disagree' ? other : (offLetter || off), brief: '（假模型）' }), inTok, 60);
    if (role === 'judge') return res(p, JSON.stringify({ equivalent: fault !== 'disagree', why: '（假模型）' }), inTok, 20);
    return res(p, JSON.stringify({ valid: fault !== 'disagree', issues: fault === 'disagree' ? ['（假模型）审核不通过'] : [] }), inTok, 40);
  };
}
