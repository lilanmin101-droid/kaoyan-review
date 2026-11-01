import { BadRequestException, Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { AnswerInput, LearningService } from '../mastery/learning.service';

const RATINGS = ['full', 'approach_ok_calc_wrong', 'no_idea'];

@Controller('answers')
@UseGuards(JwtGuard)
export class AnswersController {
  constructor(private db: DbService, private learning: LearningService) {}

  /** 提交作答（单条或 {items:[...]} 批量）。作答记录只追加；带 client_id 的重发不会重复。 */
  @Post()
  async create(@Body() b: AnswerInput | { items: AnswerInput[] }, @CurrentUser() u: AuthUser, @Headers('x-device') device?: string) {
    const items: AnswerInput[] = (b as any)?.items ?? [b];
    if (!items.length || items.some((i) => !i?.question_id)) throw new BadRequestException('缺少 question_id');
    for (const i of items) if (i.self_rating && !RATINGS.includes(i.self_rating)) throw new BadRequestException(`self_rating 只能是 ${RATINGS.join('/')}`);
    const results = await this.db.tx(async (c) => {
      const out: any[] = [];
      for (const i of items) out.push(await this.learning.recordAnswer(c, u.id, i, device));
      return out;
    });
    return (b as any)?.items ? { items: results } : results[0];
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
