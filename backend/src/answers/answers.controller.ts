import { BadRequestException, Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { AnswerInput, LearningService } from '../mastery/learning.service';
import { ANSWER_SOURCES, BATCH_LIMIT, isValidClientId } from '../offline/offline';

const RATINGS = ['full', 'approach_ok_calc_wrong', 'no_idea'];
const BAD_MSG: Record<string, string> = {
  missing_question_id: '缺少 question_id', bad_self_rating: `self_rating 只能是 ${RATINGS.join('/')}`,
  bad_client_id: 'client_id 要 1–128 位字母数字或 _ . : -（推荐 uuid）', bad_source: `source 只能是 ${ANSWER_SOURCES.join('/')}`, bad_answer: 'answer 要是字符串数组', bad_answered_at: 'answered_at 要是 ISO 时间',
};
/** 一条作答的参数检查：返回 rejected 的原因，没问题 null */
export function checkItem(i: any): string | null {
  if (!i || typeof i !== 'object' || !i.question_id || typeof i.question_id !== 'string') return 'missing_question_id';
  if (i.self_rating && !RATINGS.includes(i.self_rating)) return 'bad_self_rating';
  if (i.client_id != null && !isValidClientId(i.client_id)) return 'bad_client_id';
  if (i.source != null && !(ANSWER_SOURCES as readonly string[]).includes(i.source)) return 'bad_source';
  if (i.answer != null && (!Array.isArray(i.answer) || i.answer.some((x: any) => typeof x !== 'string'))) return 'bad_answer';
  if (i.answered_at != null && i.answered_at !== '' && !Number.isFinite(Date.parse(String(i.answered_at)))) return 'bad_answered_at';
  return null;
}
const rejected = (i: any, reason: string) => ({ status: 'rejected', duplicate: false, reason, client_id: i?.client_id ?? null, question_id: i?.question_id ?? null,
  is_correct: null, score: null, wrong_question_id: null });

@Controller('answers')
@UseGuards(JwtGuard)
export class AnswersController {
  constructor(private db: DbService, private learning: LearningService) {}

  /**
   * 提交作答（单条或 {items:[...]} 批量，最多 200 条）。作答记录只追加；带 client_id 的重发不会重复计分（status=duplicate）。
   * 离线题包补传：source='offline_pack' + pack_version + answered_at（客户端时间，夹到 [现在−7 天, 现在]，「现在」非生产环境跟 X-Debug-Now）。
   * 批量时每条单独一个 savepoint：一条失败（rejected）不影响别的。
   */
  @Post()
  async create(@Body() b: AnswerInput | { items: AnswerInput[] }, @CurrentUser() u: AuthUser, @Headers('x-device') device?: string) {
    const batch = Array.isArray((b as any)?.items);
    const items: AnswerInput[] = batch ? (b as any).items : [b as AnswerInput];
    if (batch && !items.length) throw new BadRequestException('items 不能为空');
    if (items.length > BATCH_LIMIT) throw new BadRequestException(`一次最多 ${BATCH_LIMIT} 条，分几次传`);
    if (!batch) {
      // 单条：参数错直接 400（和以前一样）
      const bad = checkItem(items[0]);
      if (bad) throw new BadRequestException(BAD_MSG[bad] ?? bad);
    }
    const results = await this.db.tx(async (c) => {
      const out: any[] = [];
      for (const [k, i] of items.entries()) {
        const bad = checkItem(i);
        if (bad) { out.push(rejected(i, bad)); continue; }
        const sp = `ans_${k}`;
        await c.query(`SAVEPOINT ${sp}`);
        try {
          let r: any = await this.learning.recordAnswer(c, u.id, i, device);
          await c.query(`RELEASE SAVEPOINT ${sp}`);
          if (r?.error) r = rejected(i, r.error);
          out.push(r);
        } catch (e: any) {
          await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          // 同一个 client_id 并发重发撞了唯一约束：再读一次就是 duplicate
          if (e?.code === '23505' && i.client_id) { out.push(await this.learning.recordAnswer(c, u.id, i, device)); continue; }
          console.error(`[answers] 记录 ${i?.question_id} 失败：${e?.message}`);
          out.push(rejected(i, 'error'));
        }
      }
      return out;
    });
    if (!batch && results[0]?.status === 'rejected' && results[0].reason === 'question_not_found') return { error: 'question_not_found', question_id: items[0].question_id, ...results[0] };
    return batch ? { items: results } : results[0];
  }

  /**
   * 两种用法：
   * - 默认：作答流水（按时间倒序，可按 question_id 过滤）
   * - 带 exam / year / question_ids 任一参数：每题只返回最新一条（大题小问按 sub_number 各一条），刷新后恢复做题进度用
   */
  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('question_id') qid?: string, @Query('limit') limit = '50',
    @Query('exam') exam?: string, @Query('year') year?: string, @Query('question_ids') qids?: string) {
    if (exam || year || qids) {
      const p: any[] = [u.id];
      const w: string[] = ['a.user_id=$1'];
      if (exam) { p.push(exam); w.push(`q.exam=$${p.length}`); }
      if (year) {
        if (!/^\d{4}$/.test(year)) throw new BadRequestException('year 格式 YYYY');
        p.push(Number(year)); w.push(`q.year=$${p.length}`);
      }
      if (qids) {
        const ids = qids.split(',').map((s) => s.trim()).filter(Boolean);
        if (!ids.length) throw new BadRequestException('question_ids 不能为空');
        if (ids.length > 500) throw new BadRequestException('question_ids 一次最多 500 个');
        p.push(ids); w.push(`a.question_id = ANY($${p.length}::text[])`);
      }
      const rows = (await this.db.query(
        `SELECT DISTINCT ON (a.question_id, COALESCE(a.sub_number, 0))
                a.id, a.question_id, a.sub_number, a.answer, a.is_correct, a.self_rating, a.time_spent_seconds, a.answered_at,
                a.points::float points, a.max_points::float max_points,
                g.status grading_status, g.score::float grading_score, g.max_score::float grading_max_score, (g.result->>'band')::int grading_band, g.disagreement grading_disagreement
           FROM answer_records a JOIN questions q ON q.id = a.question_id LEFT JOIN answer_gradings g ON g.answer_id = a.id
          WHERE ${w.join(' AND ')}
          ORDER BY a.question_id, COALESCE(a.sub_number, 0), a.answered_at DESC, a.created_at DESC`, p)).rows;
      return { items: rows, latest: true };
    }
    const p: any[] = [u.id];
    let w = 'user_id=$1';
    if (qid) { p.push(qid); w += ' AND question_id=$2'; }
    return { items: (await this.db.query(`SELECT *, points::float points, max_points::float max_points FROM answer_records WHERE ${w} ORDER BY answered_at DESC LIMIT ${Math.min(Number(limit) || 50, 500)}`, p)).rows };
  }
}
