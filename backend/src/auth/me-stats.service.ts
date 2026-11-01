import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { UserTimeService } from '../common/user-time.service';
import { addDays, studyDaySql } from '../common/time';

/**
 * 「我的」页统计。一天算「学了」= 那天（用户时区）有作答 / 背单词（review_log）/ 打卡分钟 > 0 任意一项。
 * 连续天数：从今天往回数；今天还没学就从昨天开始数（streak_includes_today = false），这样早上打开不会显示断了。
 */
export function streakOf(studied: Set<string>, today: string) {
  let d = studied.has(today) ? today : addDays(today, -1);
  const includesToday = studied.has(today);
  let n = 0;
  while (studied.has(d)) { n++; d = addDays(d, -1); }
  return { streak: n, includes_today: includesToday };
}

@Injectable()
export class MeStatsService {
  constructor(private db: DbService, private time: UserTimeService) {}

  async stats(userId: string, days: number) {
    const tz = await this.time.tz(userId);
    const today = await this.time.today(userId);
    const [ans, words, checks, totals, wordTotals, subj, wrong] = await Promise.all([
      this.db.query(
        `SELECT to_char(${studyDaySql('answered_at', '$2')},'YYYY-MM-DD') d, count(*)::int n, -- 按学習日分天（凌晨 4 点前算前一天）
                count(*) FILTER (WHERE is_correct IS NOT NULL)::int judged, count(*) FILTER (WHERE is_correct)::int correct,
                count(DISTINCT question_id)::int questions, COALESCE(sum(time_spent_seconds),0)::int seconds
           FROM answer_records WHERE user_id=$1 GROUP BY 1`, [userId, tz]),
      this.db.query(
        `SELECT to_char(${studyDaySql("(e->>'at')::timestamptz", '$2')},'YYYY-MM-DD') d, count(*)::int n,
                count(*) FILTER (WHERE e = wp.review_log->0)::int new_words
           FROM word_progress wp, jsonb_array_elements(wp.review_log) e
          WHERE wp.user_id=$1 AND e ? 'at' GROUP BY 1`, [userId, tz]),
      this.db.query(`SELECT to_char(day,'YYYY-MM-DD') d, minutes FROM checkins WHERE user_id=$1 AND minutes > 0`, [userId]),
      this.db.one(
        `SELECT count(*)::int attempts, count(*) FILTER (WHERE is_correct IS NOT NULL)::int judged, count(*) FILTER (WHERE is_correct)::int correct,
                count(DISTINCT question_id)::int questions, COALESCE(sum(time_spent_seconds),0)::int seconds
           FROM answer_records WHERE user_id=$1`, [userId]),
      this.db.one(
        `SELECT count(*) FILTER (WHERE reps > 0)::int learned, count(*) FILTER (WHERE state = 2 AND lapses = 0 AND reps >= 3)::int solid,
                count(*) FILTER (WHERE due_at <= now() AND reps > 0)::int due FROM word_progress WHERE user_id=$1`, [userId]),
      this.db.query(
        `SELECT r.name subject, r.path,
                count(k.path)::int total_points, count(m.kp_path)::int practiced_points,
                round(avg(m.score)::numeric, 3)::float score, COALESCE(sum(m.attempts),0)::int attempts, COALESCE(sum(m.correct),0)::int correct
           FROM knowledge_points r
           JOIN knowledge_points k ON k.level = 3 AND split_part(k.path,'/',1) = r.path
           LEFT JOIN mastery m ON m.kp_path = k.path AND m.user_id = $1
          WHERE r.level = 1 GROUP BY r.name, r.path, r.sort_order ORDER BY r.sort_order`, [userId]),
      this.db.one(`SELECT count(*) FILTER (WHERE status='active')::int active, count(*) FILTER (WHERE status='mastered')::int mastered FROM wrong_questions WHERE user_id=$1`, [userId]),
    ]);
    const byDay = new Map<string, any>();
    const day = (d: string) => byDay.get(d) ?? (byDay.set(d, { date: d, answers: 0, judged: 0, correct: 0, questions: 0, study_seconds: 0, words_reviewed: 0, new_words: 0, checkin_minutes: 0 }), byDay.get(d));
    for (const r of ans.rows) Object.assign(day(r.d), { answers: r.n, judged: r.judged, correct: r.correct, questions: r.questions, study_seconds: r.seconds });
    for (const r of words.rows) Object.assign(day(r.d), { words_reviewed: r.n, new_words: r.new_words });
    for (const r of checks.rows) day(r.d).checkin_minutes = r.minutes;
    const studied = new Set([...byDay.values()].filter((x) => x.answers || x.words_reviewed || x.checkin_minutes).map((x) => x.date));
    const series = (n: number) => Array.from({ length: n }, (_, i) => {
      const d = addDays(today, i - (n - 1));
      const x = byDay.get(d) ?? { date: d, answers: 0, judged: 0, correct: 0, questions: 0, study_seconds: 0, words_reviewed: 0, new_words: 0, checkin_minutes: 0 };
      return { ...x, accuracy: x.judged ? Math.round((x.correct / x.judged) * 1000) / 1000 : null, studied: studied.has(d) };
    });
    const sum = (rows: any[]) => {
      const judged = rows.reduce((a, r) => a + r.judged, 0), correct = rows.reduce((a, r) => a + r.correct, 0);
      return { days_studied: rows.filter((r) => r.studied).length, answers: rows.reduce((a, r) => a + r.answers, 0), accuracy: judged ? Math.round((correct / judged) * 1000) / 1000 : null, words_reviewed: rows.reduce((a, r) => a + r.words_reviewed, 0) };
    };
    const s = streakOf(studied, today);
    let best = 0, run = 0, prev: string | null = null;
    for (const d of [...studied].sort()) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    const last7 = series(7), lastN = series(days);
    return {
      timezone: tz, today,
      days_studied: studied.size, streak_days: s.streak, streak_includes_today: s.includes_today, best_streak_days: best,
      first_study_date: [...studied].sort()[0] ?? null,
      questions_done: totals.questions, attempts: totals.attempts, judged_attempts: totals.judged, correct_attempts: totals.correct,
      accuracy: totals.judged ? Math.round((totals.correct / totals.judged) * 1000) / 1000 : null,
      study_minutes: Math.round(totals.seconds / 60),
      words: { learned: wordTotals.learned, solid: wordTotals.solid, due: wordTotals.due },
      wrong_questions: wrong,
      subjects: subj.rows.map((r: any) => ({ subject: r.subject, path: r.path, score: r.score, practiced_points: r.practiced_points, total_points: r.total_points, attempts: r.attempts, accuracy: r.attempts ? Math.round((r.correct / r.attempts) * 1000) / 1000 : null })),
      last_7: { summary: sum(last7), series: last7 },
      [`last_${days}`]: { summary: sum(lastN), series: lastN },
    };
  }
}
