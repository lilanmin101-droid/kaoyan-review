import { UserTimeService } from '../common/user-time.service';
import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { createEmptyCard, fsrs, Grade, Rating } from 'ts-fsrs';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { withAudioUrls } from './audio';

const f = fsrs({ enable_fuzz: true });
/** 真题数据：没出现过的词 frequency=0、exam_years=[]、examples=[]；例句统一 {sentence, year, question_id, passage_id} */
const wordOut = (w: any) => withAudioUrls({
  ...w, basic: !!w.basic, frequency: w.frequency ?? 0, exam_years: w.exam_years ?? [],
  examples: (Array.isArray(w.examples) ? w.examples : []).map((e: any) => ({ ...e, sentence: e.sentence, year: e.year ?? null, question_id: e.question_id ?? null, passage_id: e.passage_id ?? null })),
});
const RATING: Record<string, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };

@Controller('words')
@UseGuards(JwtGuard)
export class WordsController {
  constructor(private db: DbService, private time: UserTimeService) {}

  /** 今日单词：先到期复习的，再按真题词频（frequency）、ECDICT 词频排名（frq_rank）补新词；基础词（basic）默认不进新词，include_basic=1 才带 */
  @Get('today')
  async today(@CurrentUser() u: AuthUser, @Query('new_limit') newLimit = '20', @Query('review_limit') reviewLimit = '100', @Query('include_basic') includeBasic?: string) {
    // 今天的日界：统一按用户时区（UserTimeService：settings.timezone → X-Timezone → APP_TZ），不用进程本地时区
    const day = await this.time.day(u.id);
    // 到期复习：今天还没复习过的才算进「今日排到的词」；今天已经复习过又到期的（按了「没记住」的重学词）单独放 relearn
    const due = (await this.db.query(
      `SELECT w.*, wp.due_at, wp.state, wp.reps, wp.lapses, wp.context, (wp.last_review_at IS NOT NULL AND wp.last_review_at >= $3) AS done_today
         FROM word_progress wp JOIN words w ON w.id=wp.word_id
        WHERE wp.user_id=$1 AND wp.due_at <= now() ORDER BY wp.due_at LIMIT $2`, [u.id, Number(reviewLimit) || 100, day.start])).rows;
    const review = due.filter((r) => !r.done_today), relearn = due.filter((r) => r.done_today);
    // 今天已学的新词数和复习过的词数（按词去重），多端共用同一份进度
    const done = (await this.db.one(
      `SELECT count(*) FILTER (WHERE (review_log->0->>'at')::timestamptz >= $2)::int AS new_done,
              count(*) FILTER (WHERE last_review_at >= $2)::int AS reviewed
         FROM word_progress WHERE user_id=$1`, [u.id, day.start]));
    const newTarget = Number(newLimit) || 20;
    const remainingNew = Math.max(0, newTarget - done.new_done);
    const fresh = remainingNew === 0 ? [] : (await this.db.query(
      `SELECT w.* FROM words w WHERE NOT EXISTS (SELECT 1 FROM word_progress wp WHERE wp.user_id=$1 AND wp.word_id=w.id)
          AND NOT w.needs_definition AND (w.added_at IS NULL OR w.added_at < $3) AND ($4::boolean OR NOT w.basic)
        ORDER BY w.frequency DESC, w.frq_rank ASC NULLS LAST, w.id LIMIT $2`, [u.id, remainingNew, day.start, ['1', 'true'].includes(String(includeBasic))])).rows;
    // 口径：总数 = 用户今天第一次打开时排到的词数（已做 + 还剩），当天冻结、之后不减；当前是第 done_today + 1 个
    const remaining = review.length + fresh.length;
    await this.db.query(
      `INSERT INTO word_day_snapshots(user_id,day,scheduled,tz) VALUES($1,$2,$3,$4) ON CONFLICT (user_id,day) DO NOTHING`,
      [u.id, day.date, done.reviewed + remaining, day.tz]);
    const snap = (await this.db.one(`SELECT scheduled FROM word_day_snapshots WHERE user_id=$1 AND day=$2`, [u.id, day.date]))!;
    return {
      date: day.date, study_date: day.date, relative_day: '今天', timezone: day.tz, // 学习日（04:00 换天）
      expires_at: day.end.toISOString(), // 第 17 轮：这份「今天」的单词到用户时区下一个 04:00 过期（同离线题包）
      review: review.map(wordOut), new: fresh.map(wordOut), relearn: relearn.map(wordOut),
      counts: {
        review: review.length, new: fresh.length, relearn: relearn.length, new_target: newTarget,
        new_done_today: done.new_done, reviewed_today: done.reviewed,
        done_today: done.reviewed, remaining, scheduled_today: snap.scheduled, position: done.reviewed + 1,
      },
    };
  }

  /** 复习打分：rating = again/hard/good/easy，用 ts-fsrs 排下次复习 */
  @Post(':id/review')
  async review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { rating: string; reviewed_at?: string; context?: any }, @Headers('x-device') device?: string) {
    const grade = RATING[b?.rating];
    if (!grade) throw new BadRequestException('rating 只能是 again/hard/good/easy');
    const word = await this.db.one('SELECT id FROM words WHERE id=$1', [Number(id)]);
    if (!word) throw new NotFoundException('单词不存在');
    const now = b.reviewed_at ? new Date(b.reviewed_at) : new Date();
    const cur = await this.db.one('SELECT fsrs_card, review_log FROM word_progress WHERE user_id=$1 AND word_id=$2', [u.id, word.id]);
    const card = cur ? { ...cur.fsrs_card, due: new Date(cur.fsrs_card.due), last_review: cur.fsrs_card.last_review ? new Date(cur.fsrs_card.last_review) : undefined } : createEmptyCard(now);
    const { card: next, log } = f.next(card, now, grade);
    const r = await this.db.one(
      `INSERT INTO word_progress(user_id,word_id,fsrs_card,due_at,state,reps,lapses,context,last_review_at,review_log)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id,word_id) DO UPDATE SET fsrs_card=EXCLUDED.fsrs_card, due_at=EXCLUDED.due_at, state=EXCLUDED.state, reps=EXCLUDED.reps,
         lapses=EXCLUDED.lapses, context=COALESCE(EXCLUDED.context, word_progress.context), last_review_at=EXCLUDED.last_review_at,
         review_log=word_progress.review_log || EXCLUDED.review_log, updated_at=now()
       RETURNING word_id, due_at, state, reps, lapses, last_review_at`,
      [u.id, word.id, JSON.stringify(next), next.due, next.state, next.reps, next.lapses, b.context ? JSON.stringify(b.context) : null, now,
        JSON.stringify([{ rating: b.rating, at: now, scheduled_days: log.scheduled_days }])]);
    await this.db.recordChange(this.db.pool, u.id, 'word_progress', String(word.id), 'upsert', r, device);
    return { ...r, next_due_in_days: Math.round(((next.due.getTime() - now.getTime()) / 86400000) * 10) / 10 };
  }
}
