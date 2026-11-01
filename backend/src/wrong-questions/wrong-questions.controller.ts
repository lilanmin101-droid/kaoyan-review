import { subScoresSql } from '../common/grading';
import { referenceAnswer } from '../questions/reference-answer';
import { UserTimeService } from '../common/user-time.service';
import { relativeDay, studyDate } from '../common/time';
import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Patch, Query, Res, UseGuards } from '@nestjs/common';
import { assetBaseFor } from '../common/assets';
import type { Response } from 'express';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { htmlToPdf, prerenderWrongExport, registerWrongExportBuilder, wrongQuestionsHtml } from './pdf';
import { explanationInfo } from '../ai/explain';

const ERROR_TYPES = ['concept', 'calc', 'reading', 'method', 'careless'];
/** 列表筛选：active（默认）| mastered | archived | due（已掌握且到了复习时间）| all */
const STATUS_FILTERS = ['active', 'mastered', 'archived', 'due', 'all'];
const STATUSES = ['active', 'mastered', 'archived'];

@Controller('wrong-questions')
@UseGuards(JwtGuard)
export class WrongQuestionsController {
  constructor(private db: DbService, private time: UserTimeService) {
    registerWrongExportBuilder((userId, f) => this.exportHtml(userId, f));
  }

  /** 导出 PDF 用的 HTML（导出接口和后台预渲染共用，保证缓存命中时内容一模一样） */
  async exportHtml(userId: string, f: any) {
    const items = await this.fetch(userId, f);
    return wrongQuestionsHtml(items, { title: `错题重做 · ${await this.time.today(userId)} · ${items.length} 题`, withAnswer: f.with_answer === 'true' });
  }

  private async fetch(userId: string, f: { status?: string; error_type?: string; kp?: string; exam?: string; due?: string; ids?: string; source?: string; exam_id?: string }) {
    // 「到期」= 复习时间落在用户今天结束之前（按用户时区的日界）
    const day = await this.time.day(userId), end = day.end;
    const p: any[] = [userId, end];
    const w = ['w.user_id=$1'];
    const add = (sql: string, v: any) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
    const st = f.status ?? 'active';
    if (!STATUS_FILTERS.includes(st)) throw new BadRequestException(`status 只能是 ${STATUS_FILTERS.join('/')}`);
    if (st === 'due') w.push(`w.status='mastered' AND w.due_at < $2`);
    else if (st !== 'all') add('w.status = ?', st);
    if (f.error_type) add('w.error_type = ?', f.error_type);
    if (f.exam) add('q.exam = ?', f.exam);
    if (f.kp) add(`EXISTS (SELECT 1 FROM unnest(q.knowledge_points) k WHERE k LIKE ?)`, `${f.kp}%`);
    if (f.due === 'true') w.push('w.due_at < $2');
    if (f.ids) add('w.id = ANY(?)', f.ids.split(','));
    // 来源：practice | exam；exam_id = 某场模考进来的错题
    if (f.source) { if (!['practice', 'exam'].includes(f.source)) throw new BadRequestException('source 只能是 practice/exam'); add('w.source = ?', f.source); }
    if (f.exam_id) { if (!/^[0-9a-f-]{36}$/i.test(f.exam_id)) throw new BadRequestException('exam_id 格式不对'); add('w.source_exam_id = ?::uuid', f.exam_id); }
    return (await this.db.query(
      `SELECT w.id, w.question_id, w.first_wrong_at, w.last_wrong_at, w.wrong_count, w.error_type, w.error_type_by, w.note, w.status, w.due_at, w.mastered_at, w.archived_at, w.source, w.source_exam_id,
              (w.status='mastered' AND w.due_at < $2) AS review_due,
              q.exam, q.year, q.number, q.type, q.score::float score, q.score_estimated, q.score_by_whole, q.sub_scores_source, ${subScoresSql('q.')}, q.section, q.stem, q.tables, q.errata, q.images, q.options, q.answer, q.sub_questions, q.knowledge_points, q.source->>'assets_dir' AS assets_dir,
              q.id AS qid, q.solution, q.review_status, q.review_checked_by,
              (SELECT e.id FROM ai_explanations e WHERE e.question_id=q.id AND e.status='published' AND e.verified ORDER BY e.version DESC LIMIT 1) AS ai_verified_id,
              r.text AS reminder
         FROM wrong_questions w JOIN questions q ON q.id=w.question_id
         LEFT JOIN reminders r ON r.user_id=w.user_id AND r.question_id=w.question_id
        WHERE ${w.join(' AND ')} ORDER BY w.last_wrong_at DESC`, p)).rows
      // 讲解出处 + 是否已核对（verified）
      // due_date / due_relative_day：复习时间落在哪个学习日、相对今天怎么叫（前端不自己算日界）
      .map((r: any) => { const dd = r.due_at ? studyDate(new Date(r.due_at), day.tz) : null; return { ...r, due_date: dd, due_relative_day: relativeDay(dd, day.date), explanation: explanationInfo({ ...r, id: r.qid }, r.ai_verified_id), reference_answer: referenceAnswer(r) }; });
  }

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query() f: any) {
    const items = await this.fetch(u.id, f);
    prerenderWrongExport(u.id); // 错题本页的「导出 PDF」（默认筛选）先在后台渲染好
    const by_error_type = ERROR_TYPES.reduce((o, t) => ({ ...o, [t]: items.filter((i) => i.error_type === t).length }), { unclassified: items.filter((i) => !i.error_type).length } as any);
    const out = items.map(({ assets_dir, qid, solution, review_status, review_checked_by, ai_verified_id, ...i }: any) => ({ ...i, asset_base: assetBaseFor({ assets_dir }) }));
    // 各状态数量（前端折叠的「已掌握」区、「到期复习」角标用）
    const cnt = (await this.db.one(
      `SELECT count(*) FILTER (WHERE status='active')::int active, count(*) FILTER (WHERE status='mastered')::int mastered,
              count(*) FILTER (WHERE status='archived')::int archived, count(*) FILTER (WHERE status='mastered' AND due_at < $2)::int due,
              count(*)::int "all" FROM wrong_questions WHERE user_id=$1`, [u.id, (await this.time.day(u.id)).end]))!;
    return { items: out, total: items.length, status: f.status ?? 'active', counts: cnt, by_error_type };
  }

  /** 错题导出 PDF（KaTeX 排版 + 本机 Chrome 打印），with_answer=true 时附答案 */
  @Get('export.pdf')
  async export(@CurrentUser() u: AuthUser, @Query() f: any, @Res() res: Response) {
    const html = await this.exportHtml(u.id, f);
    if (f.format === 'html') { res.type('html').send(html); return; }
    const pdf = await htmlToPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="wrong-questions.pdf"`);
    res.send(pdf);
  }

  /** 手动改错因 / 笔记 / 状态（Agent 判的错因用户可以一键改） */
  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { error_type?: string; note?: string; status?: string }, @Headers('x-device') device?: string) {
    if (b.error_type && !ERROR_TYPES.includes(b.error_type)) throw new BadRequestException(`error_type 只能是 ${ERROR_TYPES.join('/')}`);
    if (b.status && !STATUSES.includes(b.status)) throw new BadRequestException(`status 只能是 ${STATUSES.join('/')}`);
    // 手动标「已掌握」也排一次复习（至少 1 天后），放回 active 就清掉掌握时间
    if (b.status) await this.db.query(
      `UPDATE wrong_questions SET mastered_at=CASE WHEN $3='mastered' THEN COALESCE(CASE WHEN status='mastered' THEN mastered_at END, now()) ELSE mastered_at END,
         due_at=CASE WHEN $3='mastered' AND status<>'mastered' THEN GREATEST(COALESCE(due_at, now()), now()+interval '1 day') ELSE due_at END,
         archived_at=CASE WHEN $3='archived' THEN now() ELSE archived_at END WHERE id=$1 AND user_id=$2`, [id, u.id, b.status]);
    const r = await this.db.one(
      `UPDATE wrong_questions SET error_type=COALESCE($3,error_type), error_type_by=CASE WHEN $3::text IS NULL THEN error_type_by ELSE 'user' END,
         note=COALESCE($4,note), status=COALESCE($5,status), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,
      [id, u.id, b.error_type ?? null, b.note ?? null, b.status ?? null]);
    if (!r) throw new NotFoundException('错题不存在');
    await this.db.recordChange(this.db.pool, u.id, 'wrong_question', r.id, 'upsert', r, device);
    return r;
  }
}
