import { subScoresSql } from '../common/grading';
import { aiMode } from '../ai/llm';
import { ensureExplanation, willGenerate } from '../ai/explanation-gen';
import { referenceAnswer } from './reference-answer';
import { AI_VERIFIED_LABEL, explanationInfo, followup as aiFollowup, officialSolution, PENDING_NOTICE, PENDING_TEXT } from '../ai/explain';
import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { openSse, sleep } from '../common/sse';
import { assetBaseFor } from '../common/assets';
import { isEnglishExam } from '../english/english-spec';
import { groupByPassage, loadPassages } from './passages';

/** 每道题带上 asset_base：前端把 Markdown 里的相对图片路径拼到它后面 */
const withAssets = (q: any) => (q ? { ...q, asset_base: assetBaseFor(q.source) } : q);

const BASE_COLS = `id,schema_version,exam,year,number,section,type,score::float AS score,score_estimated,score_by_whole,sub_scores_source,${subScoresSql()},stem,tables,errata,images,options,sub_questions,knowledge_points,source,passage_id,
  json_build_object('status',review_status,'notes',review_notes,'checked_by',review_checked_by) AS review, kp_confidence, import_problems`;

/** AI 还没接（没有 Key），讲解/提示先返回模拟数据，字段与以后真实返回一致 */
const HINT_PENDING_TEXT = '思路生成中';
const EXPLAIN_COLS = 'id,exam,year,number,type,section,score::float,stem,tables,errata,options,answer,sub_questions,solution,knowledge_points,review_status,review_checked_by';
type ExplainBody = { selectedText?: string; step?: number; mode?: 'full' | 'why_wrong' | 'followup'; chosen_option?: string };
const fmtSteps = (steps: any[]) => steps.map((s: any) => ({ n: s.n, text: s.title ? `${s.title}：${s.text}` : s.text }));

@Controller('questions')
@UseGuards(JwtGuard)
export class QuestionsController {
  constructor(private db: DbService) {}

  @Get()
  async list(
    @Query('exam') exam?: string, @Query('year') year?: string, @Query('type') type?: string, @Query('section') section?: string,
    @Query('kp') kp?: string, @Query('review_status') reviewStatus?: string, @Query('q') text?: string,
    @Query('include_answer') includeAnswer?: string, @Query('page') page = '1', @Query('page_size') pageSize?: string,
    @Query('include_unreviewed') includeUnreviewed?: string,
  ) {
    const where: string[] = [];
    const p: any[] = [];
    const add = (sql: string, v: any) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
    // 默认只给已核对（confirmed）的题；还在清洗/核对的年份要 ?include_unreviewed=1 或明确传 review_status
    const unreviewed = ['1', 'true'].includes(String(includeUnreviewed ?? ''));
    if (!reviewStatus && !unreviewed) where.push(`review_status = 'confirmed'`);
    if (exam) add('exam = ?', exam);
    if (year) add('year = ?', Number(year));
    if (type) add('type = ?', type);
    if (section) add('section = ?', section);
    if (reviewStatus) add('review_status = ?', reviewStatus);
    if (kp) add(`EXISTS (SELECT 1 FROM unnest(knowledge_points) k WHERE k = ? OR k LIKE ${'$' + (p.length + 2)})`, kp);
    if (kp) p.push(`${kp}/%`);
    if (text) add('stem ILIKE ?', `%${text}%`);
    // 英语卷一年 52 题、按文章分组，默认一页给 100（整卷一次拿全）
    const english = isEnglishExam(exam);
    const size = Math.min(Math.max(Number(pageSize) || (english ? 100 : 20), 1), 100);
    const pg = Math.max(Number(page) || 1, 1);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const cols = includeAnswer === 'true' ? `${BASE_COLS}, answer, solution` : BASE_COLS;
    const total = (await this.db.one(`SELECT count(*)::int n FROM questions ${w}`, p))!.n;
    const items = (await this.db.query(`SELECT ${cols} FROM questions ${w} ORDER BY exam, year DESC, number LIMIT ${size} OFFSET ${(pg - 1) * size}`, p)).rows;
    if (!english) return { items: items.map(withAssets), page: pg, page_size: size, total };
    // 英语：额外给 groups（按文章分组，每组带完整文章 + 标记元数据），items 不变
    const passages = await loadPassages(this.db, items.map((q: any) => q.passage_id));
    const qs = items.map(withAssets);
    return { items: qs, groups: groupByPassage(qs, passages), page: pg, page_size: size, total };
  }

  /** 题库里有哪些卷子：每个 exam/year 按核对状态计数；ready = 整卷都已 confirmed（年份切换只显示 ready 的） */
  @Get('years')
  async years(@Query('exam') exam?: string) {
    const rows = (await this.db.query(
      `SELECT exam, year, count(*)::int total,
              count(*) FILTER (WHERE review_status='confirmed')::int confirmed,
              count(*) FILTER (WHERE review_status='pending')::int pending,
              count(*) FILTER (WHERE review_status='suspect')::int suspect,
              sum(score)::float max_score
         FROM questions ${exam ? 'WHERE exam=$1' : ''} GROUP BY exam, year ORDER BY exam, year DESC`, exam ? [exam] : [])).rows;
    const items = rows.map((r: any) => ({ ...r, ready: r.total > 0 && r.confirmed === r.total }));
    return { items, ready: items.filter((i: any) => i.ready).map((i: any) => ({ exam: i.exam, year: i.year })) };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Query('include_answer') includeAnswer?: string) {
    const cols = includeAnswer === 'true' ? `${BASE_COLS}, answer, solution` : BASE_COLS;
    const q = await this.db.one(`SELECT ${cols} FROM questions WHERE id=$1`, [id]);
    if (!q) throw new NotFoundException('题目不存在');
    // 讲解出处 + 是否已核对（不含讲解正文；正文走 /explain、/hint）
    const full = await this.db.one(`SELECT ${EXPLAIN_COLS} FROM questions WHERE id=$1`, [id]);
    const st = await this.explanationState(id);
    const passage = q.passage_id ? (await loadPassages(this.db, [q.passage_id])).get(q.passage_id) ?? null : null;
    // reference_answer：主观题参考答案（翻译参考译文 / 写作范文），和 answer 一样只在 include_answer=true 时给，否则 null（考试中不泄露）
    return { ...withAssets(q), passage, explanation: explanationInfo(full, st.status === 'verified' ? st.exp!.id : null), reference_answer: includeAnswer === 'true' ? referenceAnswer(full) : null };
  }

  /** 最新的已校验讲解；没有的话看有没有待核对的版本 */
  private async explanationState(id: string) {
    const verified = await this.db.one(
      `SELECT id, steps, citations, version FROM ai_explanations WHERE question_id=$1 AND status='published' AND verified ORDER BY version DESC LIMIT 1`, [id]);
    if (verified) return { status: 'verified' as const, exp: verified };
    const pending = await this.db.one(
      `SELECT id FROM ai_explanations WHERE question_id=$1 AND status IN ('needs_review','pending_review') ORDER BY version DESC LIMIT 1`, [id]);
    // 有待核对版本，或者 AI 已接入但这题还没生成（不现场生成未核对的讲解）→ 待核对；否则是开发期模拟
    if (pending || aiMode() === 'ai') return { status: 'pending_review' as const, exp: null, pendingId: pending?.id ?? null };
    return { status: 'mock' as const, exp: null };
  }

  /** 分步提示：step 从 1 开始，只放出前 step 步。优先已校验的 AI 讲解，其次题库官方解析/参考证明，都没有时 hints=[]、status=pending、text「思路生成中」（不给示例内容） */
  @Get(':id/hint')
  async hint(@Param('id') id: string, @Query('step') stepStr = '1') {
    const q = await this.db.one(`SELECT ${EXPLAIN_COLS} FROM questions WHERE id=$1`, [id]);
    if (!q) throw new NotFoundException('题目不存在');
    const st = await this.explanationState(id);
    const official = officialSolution(q);
    let steps: any[];
    let status: string, source: string;
    let verified = false;
    if (st.status === 'verified') { steps = fmtSteps(st.exp!.steps); status = 'verified'; source = 'ai'; verified = true; }
    else if (official) { steps = official.steps; status = source = official.kind === 'expert' ? 'expert' : 'official'; verified = official.verified; }
    else { steps = []; status = st.status === 'pending_review' && st.pendingId ? 'pending_review' : 'pending'; source = 'pending'; }
    const step = steps.length ? Math.min(Math.max(Number(stepStr) || 1, 1), steps.length) : 0;
    const notice = status === 'pending' ? HINT_PENDING_TEXT : status === 'pending_review' ? PENDING_NOTICE : null;
    return {
      question_id: id, step, total_steps: steps.length, has_more: step < steps.length,
      hints: steps.slice(0, step), status, source, verified, source_label: source === 'official' || source === 'expert' ? official!.label : source === 'ai' ? AI_VERIFIED_LABEL : null,
      review: (source === 'official' || source === 'expert') ? official!.review : null,
      notice, text: notice,
      explanation_id: st.exp?.id ?? null,
      citation: { year: q.year, number: q.number, knowledge_points: q.knowledge_points },
    };
  }

  /**
   * 讲解 / 划词追问（SSE，POST 或 GET 都行；GET 用 query 传参数，方便 EventSource）。事件：meta、step（整步推出）、citation、done。
   * 来源（done.source）：
   * - ai：已通过双模型核对的 AI 讲解（或有 Key 时基于它/官方解析的追问回答）
   * - expert：行业专家分步参考讲解（/workspace/kaoyan/tiku/explanations/*_expert.jsonl）
   * - official：questions.solution 官方解析 / 已核对的证明题题库证明（没有 AI Key 时只会是 expert/official/pending，不出示例内容）
   * - pending：都没有 → 不推 step，done.status=pending、text「讲解生成中」（有待核对的 AI 版本时 status=pending_review、「这题讲解待核对」）
   */
  @Post(':id/explain')
  explainPost(@Param('id') id: string, @Body() b: ExplainBody, @CurrentUser() u: AuthUser, @Res() res: Response) {
    return this.explain(id, b ?? {}, u, res);
  }

  @Get(':id/explain')
  explainGet(@Param('id') id: string, @Query() qs: any, @CurrentUser() u: AuthUser, @Res() res: Response) {
    return this.explain(id, { selectedText: qs.selectedText, step: qs.step ? Number(qs.step) : undefined, mode: qs.mode, chosen_option: qs.chosen_option }, u, res);
  }

  private async explain(id: string, b: ExplainBody, u: AuthUser, res: Response) {
    const q = await this.db.one(`SELECT ${EXPLAIN_COLS} FROM questions WHERE id=$1`, [id]);
    if (!q) throw new NotFoundException('题目不存在');
    let st = await this.explanationState(id);
    const official = officialSolution(q);
    const mode = b.selectedText ? 'followup' : (b.mode ?? 'full');
    const sse = openSse(res);
    try {
      // 先用库里预生成的讲解（npm run gen:explanations）；没有、也没有官方/专家解析时，AI 已接入（两个 Key 或 AI_FAKE=1）就现场生成一次并入库。
      // 同一题同时只生成一次；当前提示词版本已有待核对版本则不再生成；质检/核对不过关 → 仍是「这题讲解待核对」
      if (st.status !== 'verified' && !official && await willGenerate(this.db, id).catch(() => false)) {
        try {
          const gen = ensureExplanation(this.db, id);
          let ticking = true;
          const tick = setInterval(() => ticking && sse.send('progress', { stage: 'generating', text: PENDING_TEXT }), 5000);
          sse.send('progress', { stage: 'generating', text: PENDING_TEXT });
          try { if (await gen) st = await this.explanationState(id); } finally { ticking = false; clearInterval(tick); }
        } catch (e: any) {
          console.error(`[explain] 现场生成 ${id} 失败：${e.message}`);
        }
      }
      let steps: { n: number; text: string }[] = [];
      let source: 'ai' | 'official' | 'expert' | 'pending';
      let status: 'verified' | 'official' | 'expert' | 'pending' | 'pending_review';
      const bankSource = official?.kind === 'expert' ? 'expert' as const : 'official' as const;
      const base = st.status === 'verified' ? st.exp!.steps : official?.steps ?? null;
      if (!base) {
        source = 'pending';
        status = st.status === 'pending_review' && st.pendingId ? 'pending_review' : 'pending';
      } else if (mode !== 'full' && aiMode() === 'ai') {
        steps = [{ n: 1, text: await aiFollowup(q, base, { ...b, mode }) }];
        source = 'ai';
        status = st.status === 'verified' ? 'verified' : bankSource;
      } else {
        // 完整讲解；没有 Key 时的追问也只给官方解析（不编示例回答）
        steps = st.status === 'verified' ? fmtSteps(st.exp!.steps) : official!.steps;
        source = st.status === 'verified' ? 'ai' : bankSource;
        status = st.status === 'verified' ? 'verified' : bankSource;
      }
      const sourceLabel = source === 'official' || source === 'expert' ? official!.label : source === 'ai' ? (st.status === 'verified' ? AI_VERIFIED_LABEL : `AI 基于${official!.label}作答`) : null;
      // verified：已核对发布的 AI 讲解原文 = true；专家/官方原文看讲解核对记录最新一条（pass/pass_minor）；AI 现场追问回答、pending = false
      const verified = mode === 'full' || aiMode() !== 'ai'
        ? (source === 'ai' ? st.status === 'verified' : (source === 'official' || source === 'expert') ? official!.verified : false)
        : false;
      const review = (source === 'official' || source === 'expert') ? official!.review : null;
      const notice = status === 'pending' ? PENDING_TEXT : status === 'pending_review' ? PENDING_NOTICE : null;
      sse.send('meta', { question_id: id, mock: false, mode, source, verified, source_label: sourceLabel, user_id: u.id, explanation_id: st.exp?.id ?? null });
      for (const s of steps) { await sleep(120); sse.send('step', s); }
      sse.send('citation', { year: q.year, number: q.number, knowledge_points: q.knowledge_points, exam: q.exam, source_label: sourceLabel });
      sse.send('done', { verified, status, source, source_label: sourceLabel, review, notice, text: notice, explanation_id: st.exp?.id ?? null });
    } catch (e: any) {
      sse.send('error', { message: e.message });
    }
    sse.end();
  }

  /** 讲解反馈：没讲清 / 讲错了 */
  @Post(':id/explain/feedback')
  async feedback(@Param('id') id: string, @Body() b: { kind: 'unclear' | 'wrong'; note?: string; explanation_id?: string }, @CurrentUser() u: AuthUser) {
    const exp = b?.explanation_id ? await this.db.one('SELECT id FROM ai_explanations WHERE id=$1', [b.explanation_id]) : null;
    if (exp) await this.db.query(`UPDATE ai_explanations SET feedback = feedback || $2::jsonb, status = CASE WHEN $3='wrong' THEN 'pending_review' ELSE status END WHERE id=$1`,
      [exp.id, JSON.stringify([{ user_id: u.id, kind: b.kind, note: b.note ?? null, at: new Date() }]), b.kind]);
    return { question_id: id, accepted: true, next: b?.kind === 'wrong' ? 'queued_for_review' : 'will_reexplain' };
  }
}
