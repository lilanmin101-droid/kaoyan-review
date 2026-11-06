import { DbService } from '../db/db.service';
import { UserTimeService } from '../common/user-time.service';
import { PlansService } from '../plans/plans.service';
import { addDays, dayLabel, studyDaySql, weekOf, weekOpenLabel } from '../common/time';
import { clockNow } from '../common/clock';

/**
 * 问题（不是命令）：「那今天的单词还背吗」「今天还要做什么」「错题还剩几道」「离考试还有几天」「我这周进度怎么样」。
 * 用学生的真实数据直接回答（做不做、做多少），结合这个学习日前面说过的时间预算（「今天只有一小时」）给一句建议。只读，不改任何东西。
 */
export type QuestionKind = 'words' | 'todo' | 'wrong_left' | 'exam_days' | 'week' | 'general';

const Q_MARK = /[吗么呢嘛？?]|几|多少|怎么样|怎样|如何|啥|什么|哪些|哪个|还要|还剩|还有|要不要|该不该|需不需要|用不用|是不是|有没有|够不够/;
/** 祈使 / 改动的说法：有这些就当命令（「要不要 / 该不该」这类问法除外） */
const CMD_MARK = /加|排|改|删|减|挪|换|设|跳过|帮我|给我|安排|只有|只剩|别管|手滑|粗心|取消|撤|清空|重做|练|来\s*\d|来[一两二三四五六七八九十]/;
const ASK_OPINION = /要不要|该不该|需不需要|用不用|还背吗|还做吗|还练吗|还学吗/;

export function questionKind(text: string): QuestionKind | null {
  const t = text.trim();
  if (!Q_MARK.test(t)) return null;
  if (CMD_MARK.test(t) && !ASK_OPINION.test(t)) return null;
  if (/单词|词汇|背词|背单词|背吗|生词|新词/.test(t)) return 'words';
  if (/错题/.test(t)) return 'wrong_left';
  if (/考试|考研|初试|倒计时/.test(t) && /几天|多少天|多久|还有|几个月/.test(t)) return 'exam_days';
  if (/这周|本周|这星期|这礼拜|进度|最近学得/.test(t)) return 'week';
  if (/还要做|做什么|干什么|干嘛|先干|先做|计划|任务|学什么|还剩什么|还有什么/.test(t)) return 'todo';
  return 'general';
}

const REVIEW_SEC = 20, NEW_MIN = 1; // 复习一个词约 20 秒，新词约 1 分钟
const wordMinutes = (review: number, fresh: number) => Math.ceil((review * REVIEW_SEC) / 60) + fresh * NEW_MIN;

export class CoachAnswers {
  constructor(private db: DbService, private time: UserTimeService, private plans: PlansService) {}

  /** 这个学习日前面说过的时间预算（同一学习日最近一句带「N 小时 / N 分钟」的命令），没说过 → null */
  async budgetToday(userId: string, today: string, parse: (t: string) => number | null, current?: string): Promise<{ minutes: number; text: string } | null> {
    if (current && parse(current)) return { minutes: parse(current)!, text: current };
    const rows = (await this.db.query(
      `SELECT text FROM agent_commands WHERE user_id=$1 AND study_date=$2::date AND status='done' ORDER BY eff_at DESC NULLS LAST LIMIT 30`, [userId, today])).rows;
    for (const r of rows) { const m = parse(r.text); if (m) return { minutes: m, text: r.text }; }
    return null;
  }

  /** 和 GET /words/today 同一口径的剩余数（只读，不写当天快照） */
  async wordsLeft(userId: string) {
    const day = await this.time.day(userId);
    const r = (await this.db.one(
      `SELECT count(*) FILTER (WHERE due_at <= $3 AND (last_review_at IS NULL OR last_review_at < $2))::int AS review,
              count(*) FILTER (WHERE (review_log->0->>'at')::timestamptz >= $2)::int AS new_done,
              count(*) FILTER (WHERE last_review_at >= $2)::int AS reviewed
         FROM word_progress WHERE user_id=$1`, [userId, day.start, new Date()]))!;
    const want = Math.max(0, 20 - r.new_done);
    const avail = want ? (await this.db.one(
      `SELECT count(*)::int n FROM (SELECT 1 FROM words w WHERE NOT EXISTS (SELECT 1 FROM word_progress wp WHERE wp.user_id=$1 AND wp.word_id=w.id)
          AND NOT w.needs_definition AND (w.added_at IS NULL OR w.added_at < $2) AND NOT w.basic LIMIT $3) x`, [userId, day.start, want]))!.n : 0;
    return { review: Math.min(100, r.review), fresh: avail, newDone: r.new_done, reviewed: r.reviewed };
  }

  async openTasks(userId: string, date: string) {
    const plan = await this.plans.getPlan(userId, date);
    const tasks = plan?.tasks ?? [];
    return { open: tasks.filter((x: any) => ['todo', 'doing'].includes(x.status)), done: tasks.filter((x: any) => x.status === 'done') };
  }

  async answer(userId: string, kind: QuestionKind, text: string, parse: (t: string) => number | null): Promise<{ reply: string; steps: string[] }> {
    const today = await this.time.today(userId);
    const T = dayLabel(today, today), N = dayLabel(addDays(today, 1), today);
    const budget = await this.budgetToday(userId, today, parse, text);
    const steps: string[] = [];
    const { open, done } = await this.openTasks(userId, today);
    const mins = (xs: any[]) => xs.reduce((m, x) => m + (x.estimated_minutes ?? 30), 0);
    const bText = budget ? `你说${T}只有 ${budget.minutes} 分钟` : '';
    if (budget) steps.push(`这个学习日你说过「${budget.text.slice(0, 20)}」，按 ${budget.minutes} 分钟算`);

    if (kind === 'words') {
      steps.push('正在看今天的单词');
      const w = await this.wordsLeft(userId);
      const total = w.review + w.fresh;
      const MIN_NEW = Math.min(5, w.fresh);
      const need = wordMinutes(w.review, w.fresh), rMin = wordMinutes(w.review, 0);
      const cnt = `${T}单词还剩 ${total} 个（复习 ${w.review} 个、新词 ${w.fresh} 个，约 ${need} 分钟）`;
      if (!total) return { steps, reply: `不用背了：${T}的单词已经背完（复习了 ${w.reviewed} 个、新学 ${w.newDone} 个）。` };
      if (!budget) return { steps, reply: `要背。${cnt}，先复习到期的，再学新词。` };
      const other = open.filter((x: any) => x.kind !== 'words');
      const used = mins(other), left = budget.minutes - used;
      const planPart = other.length ? `计划里其他任务约 ${used} 分钟，还剩 ${Math.max(0, left)} 分钟` : '计划里还没有别的任务';
      if (need <= left) return { steps, reply: `要背，${total} 个都背：${cnt}；${bText}，${planPart}，放得下，${T}背完。` };
      if (w.review && rMin <= left) {
        const k0 = Math.floor((left - rMin) / NEW_MIN), k = k0 >= MIN_NEW ? Math.min(w.fresh, k0) : 0; // 新词少于 5 个不值得开头，整批挪走
        return { steps, reply: `要背，但只背复习的 ${w.review} 个（约 ${rMin} 分钟，到期不复习容易忘）：${cnt}；${bText}，${planPart}，放不下全部。`
          + (k ? `新词减到 ${k} 个，剩下 ${w.fresh - k} 个挪到${N}。` : `${w.fresh} 个新词挪到${N}。`) };
      }
      if (!w.review && Math.floor(left / NEW_MIN) >= MIN_NEW) {
        const k = Math.min(w.fresh, Math.floor(left / NEW_MIN));
        return { steps, reply: `可以背 ${k} 个：${cnt}；${bText}，${planPart}，新词减到 ${k} 个，剩下 ${w.fresh - k} 个挪到${N}。` };
      }
      return { steps, reply: `${T}先不背了，挪到${N}：${cnt}；${bText}，${left > 0 ? `${planPart}，不够背一批新词` : `${planPart.replace(/，还剩 -?\d+ 分钟/, '')}，已经排满`}。${w.review ? `实在有空，只把最急的 ${Math.min(w.review, 15)} 个复习过一遍（约 5 分钟）。` : ''}` };
    }

    if (kind === 'todo') {
      steps.push('正在看今天的计划');
      const w = await this.wordsLeft(userId);
      const wordsLine = w.review + w.fresh && !open.some((x: any) => x.kind === 'words') ? `另外单词还剩 ${w.review + w.fresh} 个（约 ${wordMinutes(w.review, w.fresh)} 分钟）。` : '';
      if (!open.length) return { steps, reply: `${T}${done.length ? `的 ${done.length} 项都做完了` : '还没排任务'}。${wordsLine}${done.length ? '有空就复习一下错题。' : '回一句「今天只有一小时」，我按时间帮你排。'}` };
      const list = open.map((x: any) => `${x.title}（${x.estimated_minutes ?? 30} 分钟）`).join('、');
      let tip = '';
      const total = mins(open);
      if (budget && total > budget.minutes) {
        let acc = 0; const keep = open.filter((x: any) => (acc += x.estimated_minutes ?? 30) <= budget.minutes);
        tip = `${bText}，先做「${(keep.length ? keep : open.slice(0, 1)).map((x: any) => x.title).join('」「')}」，其余的挪到${N}（回「${T.slice(0, 2)}只有 ${budget.minutes} 分钟」我来挪）。`;
      } else if (budget) tip = `${bText}，放得下，按顺序做就行。`;
      else tip = `先做「${open[0].title}」。`;
      return { steps, reply: `${T}还要做 ${open.length} 项，共约 ${total} 分钟：${list}${done.length ? `；已完成 ${done.length} 项` : ''}。${wordsLine}${tip}` };
    }

    if (kind === 'wrong_left') {
      steps.push('正在翻你的错题本');
      const r = (await this.db.one(
        `SELECT count(*) FILTER (WHERE status='active')::int active, count(*) FILTER (WHERE status='mastered' AND due_at < $2)::int due
           FROM wrong_questions WHERE user_id=$1`, [userId, clockNow()]))!;
      const inPlan = open.filter((x: any) => x.kind === 'redo_wrong').reduce((n: number, x: any) => n + (x.payload?.question_ids?.length ?? 0), 0);
      const left = r.active + r.due;
      if (!left) return { steps, reply: `错题本清空了：没有没掌握的错题，也没有到复习时间的。${T}可以做几道新题摸底。` };
      const per = 8;
      let tip = inPlan ? `${T}的计划里已经排了 ${inPlan} 道重做。` : `${T}的计划里还没排重做。`;
      if (budget) {
        const room = Math.max(0, budget.minutes - mins(open));
        const k = Math.min(left - inPlan, Math.floor(room / per));
        tip += k > 0 ? `${bText}，计划外还能再重做 ${k} 道（每道约 ${per} 分钟），其余的留到${N}。` : `${bText}，计划已经排满，其余的留到${N}。`;
      } else if (!inPlan) tip += `建议先重做 ${Math.min(3, left)} 道（约 ${Math.min(3, left) * per} 分钟）。`;
      return { steps, reply: `错题还剩 ${left} 道：没掌握的 ${r.active} 道${r.due ? `，已掌握但到了复习时间的 ${r.due} 道` : ''}。${tip}` };
    }

    if (kind === 'exam_days') {
      const u = await this.db.one(`SELECT to_char(exam_date,'YYYY-MM-DD') exam_date, phase FROM users WHERE id=$1`, [userId]);
      if (!u?.exam_date) return { steps, reply: '还没设考试日期。在设置里填上考试日期（比如 2026-12-19），我就按天倒数、按阶段排计划。' };
      const n = Math.round((Date.parse(u.exam_date) - Date.parse(today)) / 86400000);
      const wd = '日一二三四五六'[new Date(`${u.exam_date}T12:00:00Z`).getUTCDay()];
      if (n < 0) return { steps, reply: `考试日期 ${u.exam_date}（周${wd}）已经过去了，要换成新的考试日期吗？在设置里改一下就行。` };
      const tip = n <= 14 ? '最后两周：每天一套真题限时 + 回看错题，不再开新内容。' : n <= 60 ? '这一段以真题和错题为主，每周至少一套完整模考。' : '时间还够，先把基础和错题清干净，再上真题。';
      return { steps, reply: `离考试（${u.exam_date}，周${wd}）还有 ${n} 天，从${T}算。${budget ? `${bText}，就先把${T}的计划做完。` : ''}${tip}` };
    }

    if (kind === 'week') {
      const tz = await this.time.tz(userId);
      const wk = weekOf(today), from = wk.from;
      const stat = async (a: string, b: string) => (await this.db.one(
        `SELECT count(*)::int n, COALESCE(sum(CASE WHEN is_correct THEN 1 ELSE 0 END),0)::int correct,
                count(DISTINCT ${studyDaySql('answered_at', '$4')})::int days, COALESCE(round(sum(COALESCE(time_spent_seconds,0))/60.0),0)::int minutes
           FROM answer_records WHERE user_id=$1 AND ${studyDaySql('answered_at', '$4')} BETWEEN $2::date AND $3::date`, [userId, a, b, tz]))!;
      const s = await stat(from, today), p = await stat(addDays(from, -7), addDays(today, -7));
      const elapsed = Math.round((Date.parse(today) - Date.parse(from)) / 86400000) + 1;
      const range = weekOpenLabel(wk.from); // 进行中的这周：「这周（11-02 起）」，不写成单日
      if (!s.n) return { steps, reply: `这周（${range}）还没有作答记录${p.n ? `；上周同期做了 ${p.n} 题` : ''}。${budget ? `${bText}，就从计划里第一项开始。` : '今天先做 5 道题把节奏找回来。'}` };
      const acc = Math.round((100 * s.correct) / s.n);
      const cmp = p.n ? `，上周同期 ${p.n} 题${p.n ? `、正确率 ${Math.round((100 * p.correct) / p.n)}%` : ''}` : '';
      const tip = acc < 60 ? '正确率偏低，先把错题重做一遍再刷新题。' : s.days < elapsed ? `这周 ${elapsed} 天里学了 ${s.days} 天，先把每天的节奏稳住。` : '节奏不错，保持。';
      return { steps, reply: `这周（${range}）做了 ${s.n} 题，正确率 ${acc}%，学了 ${s.days} 天、${s.minutes ? `约 ${s.minutes} 分钟` : '还没有时长记录'}${cmp}。${tip}` };
    }

    // 其他问题：说清楚现在的情况，不改计划
    const total = mins(open);
    return { steps, reply: `${T}还有 ${open.length} 项没做（约 ${total} 分钟）${budget ? `，${bText}` : ''}。想让我改计划就直接说怎么改，比如「今天只有一小时」。` };
  }
}
