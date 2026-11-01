import { UserTimeService } from '../common/user-time.service';
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import { DbService } from '../db/db.service';
import { fromSelfRating, gradeObjective, maxPointsFor, pointsFor } from '../common/grading';
import { localHour } from '../common/time';

export interface AnswerInput {
  question_id: string;
  answer?: string[];
  self_rating?: 'full' | 'approach_ok_calc_wrong' | 'no_idea' | null;
  time_spent_seconds?: number | null;
  thought_text?: string | null;
  sub_number?: number | null;
  client_id?: string | null;
  answered_at?: string | null;
  exam_id?: string | null;
}

const scheduler = fsrs();

/** 一次作答落库后的连带更新：作答记录（只追加）、错题本、掌握度、错因、时段习惯 */
@Injectable()
export class LearningService {
  constructor(private db: DbService, private time: UserTimeService) {}

  async recordAnswer(c: PoolClient, userId: string, a: AnswerInput, device?: string) {
    const q = (await c.query('SELECT id,type,answer,knowledge_points,score::float score,score_by_whole,sub_questions FROM questions WHERE id=$1', [a.question_id])).rows[0];
    if (!q) return { error: 'question_not_found', question_id: a.question_id };
    // 离线重发去重
    if (a.client_id) {
      const dup = (await c.query('SELECT *, points::float points, max_points::float max_points FROM answer_records WHERE user_id=$1 AND client_id=$2', [userId, a.client_id])).rows[0];
      if (dup) return { ...dup, duplicate: true };
    }
    const objective = gradeObjective(q.type, q.answer, a.answer ?? []);
    const isCorrect = objective ?? fromSelfRating(a.self_rating);
    // 证明题只按整题计分：带了 sub_number 也按整题记
    const subIgnored = q.score_by_whole && a.sub_number != null;
    const subNumber = subIgnored ? null : a.sub_number ?? null;
    const maxPoints = maxPointsFor(q, subNumber);
    const points = pointsFor(maxPoints, objective, a.self_rating);
    const answeredAt = a.answered_at ? new Date(a.answered_at) : new Date();
    const rec = (await c.query(
      `INSERT INTO answer_records(user_id,question_id,exam_id,sub_number,answer,is_correct,self_rating,time_spent_seconds,thought_text,client_id,device,answered_at,points,max_points)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *, points::float points, max_points::float max_points`,
      [userId, a.question_id, a.exam_id ?? null, subNumber, JSON.stringify(a.answer ?? []), isCorrect, a.self_rating ?? null,
        a.time_spent_seconds ?? null, a.thought_text ?? null, a.client_id ?? null, device ?? null, answeredAt, points, maxPoints])).rows[0];
    if (subIgnored) rec.sub_number_ignored = true;
    await this.db.recordChange(c, userId, 'answer_record', rec.id, 'upsert', rec, device);

    // 错题本（不删除）：做错 → active、wrong_count+1；做对/自评全对 → active 变 mastered 并排一次 FSRS 复习；
    // mastered 到期后再做对 → archived；任何时候再做错 → 回到 active
    let wrong: any = null;
    if (isCorrect === false) {
      const card = scheduler.next(createEmptyCard(answeredAt), answeredAt, Rating.Again).card;
      const calcErr = a.self_rating === 'approach_ok_calc_wrong' ? 'calc' : null;
      wrong = (await c.query(
        `INSERT INTO wrong_questions(user_id,question_id,first_wrong_at,last_wrong_at,error_type,error_type_by,fsrs_card,due_at)
         VALUES($1,$2,$3,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id,question_id) DO UPDATE SET last_wrong_at=EXCLUDED.last_wrong_at, wrong_count=wrong_questions.wrong_count+1,
           status='active', mastered_at=NULL, archived_at=NULL, correct_streak=0,
           error_type=COALESCE(wrong_questions.error_type, EXCLUDED.error_type), error_type_by=COALESCE(wrong_questions.error_type_by, EXCLUDED.error_type_by),
           fsrs_card=EXCLUDED.fsrs_card, due_at=EXCLUDED.due_at, updated_at=now()
         RETURNING *`,
        [userId, a.question_id, answeredAt, calcErr, calcErr ? 'user' : null, JSON.stringify(card), card.due])).rows[0];
      await this.db.recordChange(c, userId, 'wrong_question', wrong.id, 'upsert', wrong, device);
    } else if (isCorrect === true) {
      wrong = await this.markCorrect(c, userId, q, subNumber, answeredAt, device);
    }

    // 掌握度（简单平滑：总体正确率与最近正确率的 EMA 各占一半）
    if (isCorrect !== null) {
      for (const kp of q.knowledge_points as string[]) {
        await c.query(
          `INSERT INTO mastery(user_id,kp_path,attempts,correct,recent_acc,score,last_practiced_at)
           VALUES($1,$2,1,$3,$4,$4,$5)
           ON CONFLICT (user_id,kp_path) DO UPDATE SET
             attempts=mastery.attempts+1, correct=mastery.correct+$3,
             recent_acc=round(0.7*COALESCE(mastery.recent_acc,0.5)+0.3*$4,3),
             score=round(0.5*((mastery.correct+$3)::numeric/(mastery.attempts+1)) + 0.5*(0.7*COALESCE(mastery.recent_acc,0.5)+0.3*$4),3),
             last_practiced_at=GREATEST(mastery.last_practiced_at,$5), updated_at=now()`,
          [userId, kp, isCorrect ? 1 : 0, isCorrect ? 1 : 0, answeredAt]);
        if (a.self_rating === 'approach_ok_calc_wrong') {
          await c.query(`INSERT INTO error_profile(user_id,kp_path,calc) VALUES($1,$2,1)
            ON CONFLICT (user_id,kp_path) DO UPDATE SET calc=error_profile.calc+1, updated_at=now()`, [userId, kp]);
        }
      }
      // 时段习惯
      const hour = localHour(answeredAt, await this.time.tz(userId)); // 用户时区的钟点
      await c.query(
        `INSERT INTO habits(user_id,hour_bucket,acc,avg_seconds,samples) VALUES($1,$2,$3,$4,1)
         ON CONFLICT (user_id,hour_bucket) DO UPDATE SET
           acc=round((habits.acc*habits.samples+$3)/(habits.samples+1),3),
           avg_seconds=CASE WHEN $4::numeric IS NULL THEN habits.avg_seconds ELSE round((COALESCE(habits.avg_seconds,$4)*habits.samples+$4)/(habits.samples+1),1) END,
           samples=habits.samples+1, updated_at=now()`,
        [userId, hour, isCorrect ? 1 : 0, a.time_spent_seconds ?? null]);
    }
    return { ...rec, wrong_question_id: wrong?.id ?? null, wrong_question_status: wrong?.status ?? null, correct_answer: q.answer };
  }

  /**
   * 这道题「现在算做对了吗」：整题作答/自评对了就算；按小问自评的计算题要每个小问最新一条都是全对。
   * 算对了再推进错题本状态：active → mastered（排一次复习 due_at）；mastered 且已到期 → archived；其余不变。
   */
  /**
   * AI 批改（翻译 / 作文）出分后的连带更新：得分率 < 60% 进错题本（同做错），否则按做对处理；掌握度按得分率更新。
   * answer_records 只追加不能改，所以分数存在 answer_gradings，这里只做错题本 + 掌握度。
   */
  async applyGradedOutcome(c: PoolClient, userId: string, questionId: string, ratio: number, at: Date, device?: string) {
    const q = (await c.query('SELECT id,type,answer,knowledge_points,score::float score,score_by_whole,sub_questions FROM questions WHERE id=$1', [questionId])).rows[0];
    if (!q) return { wrong: null, isCorrect: null };
    const isCorrect = ratio >= 0.6;
    let wrong: any = null;
    if (!isCorrect) {
      const card = scheduler.next(createEmptyCard(at), at, Rating.Again).card;
      wrong = (await c.query(
        `INSERT INTO wrong_questions(user_id,question_id,first_wrong_at,last_wrong_at,fsrs_card,due_at)
         VALUES($1,$2,$3,$3,$4,$5)
         ON CONFLICT (user_id,question_id) DO UPDATE SET last_wrong_at=EXCLUDED.last_wrong_at, wrong_count=wrong_questions.wrong_count+1,
           status='active', mastered_at=NULL, archived_at=NULL, correct_streak=0, fsrs_card=EXCLUDED.fsrs_card, due_at=EXCLUDED.due_at, updated_at=now()
         RETURNING *`,
        [userId, questionId, at, JSON.stringify(card), card.due])).rows[0];
      await this.db.recordChange(c, userId, 'wrong_question', wrong.id, 'upsert', wrong, device);
    } else {
      wrong = await this.markCorrect(c, userId, q, null, at, device);
    }
    const acc = Math.max(0, Math.min(1, Math.round(ratio * 1000) / 1000));
    for (const kp of q.knowledge_points as string[]) {
      await c.query(
        `INSERT INTO mastery(user_id,kp_path,attempts,correct,recent_acc,score,last_practiced_at)
         VALUES($1,$2,1,$3,$4,$4,$5)
         ON CONFLICT (user_id,kp_path) DO UPDATE SET
           attempts=mastery.attempts+1, correct=mastery.correct+$3,
           recent_acc=round(0.7*COALESCE(mastery.recent_acc,0.5)+0.3*$4,3),
           score=round(0.5*((mastery.correct+$3)::numeric/(mastery.attempts+1)) + 0.5*(0.7*COALESCE(mastery.recent_acc,0.5)+0.3*$4),3),
           last_practiced_at=GREATEST(mastery.last_practiced_at,$5), updated_at=now()`,
        [userId, kp, isCorrect ? 1 : 0, acc, at]);
    }
    return { wrong, isCorrect };
  }

  private async markCorrect(c: PoolClient, userId: string, q: any, subNumber: number | null, at: Date, device?: string) {
    const w = (await c.query('SELECT * FROM wrong_questions WHERE user_id=$1 AND question_id=$2 FOR UPDATE', [userId, q.id])).rows[0];
    if (!w || w.status === 'archived') return null;
    if (subNumber != null) {
      const subs = ((q.sub_questions ?? []) as any[]).map((s) => Number(s.number));
      const latest = (await c.query(
        `SELECT DISTINCT ON (sub_number) sub_number, is_correct FROM answer_records
          WHERE user_id=$1 AND question_id=$2 AND sub_number IS NOT NULL ORDER BY sub_number, answered_at DESC, created_at DESC`, [userId, q.id])).rows;
      const ok = new Map(latest.map((r: any) => [Number(r.sub_number), r.is_correct]));
      if (!subs.length || subs.some((n) => ok.get(n) !== true)) return null;
    }
    let next: any;
    if (w.status === 'active') {
      const base = w.fsrs_card ? { ...w.fsrs_card, due: new Date(w.fsrs_card.due), last_review: w.fsrs_card.last_review ? new Date(w.fsrs_card.last_review) : undefined } : createEmptyCard(at);
      let card = scheduler.next(base, at, Rating.Good).card;
      // 复习至少隔 1 天，免得刚做对就又冒出来
      if (card.due.getTime() < at.getTime() + 86400000) card = { ...card, due: new Date(at.getTime() + 86400000) };
      next = (await c.query(
        `UPDATE wrong_questions SET status='mastered', mastered_at=$2, correct_streak=correct_streak+1, fsrs_card=$3, due_at=$4, updated_at=now() WHERE id=$1 RETURNING *`,
        [w.id, at, JSON.stringify(card), card.due])).rows[0];
    } else if (w.status === 'mastered' && w.due_at && new Date(w.due_at).getTime() < (await this.time.day(userId, at)).end.getTime()) {
      // 到期（复习时间落在用户今天之内，按用户时区）再做对 → archived
      next = (await c.query(
        `UPDATE wrong_questions SET status='archived', archived_at=$2, correct_streak=correct_streak+1, updated_at=now() WHERE id=$1 RETURNING *`, [w.id, at])).rows[0];
    } else return null;
    await this.db.recordChange(c, userId, 'wrong_question', next.id, 'upsert', next, device);
    return next;
  }
}
