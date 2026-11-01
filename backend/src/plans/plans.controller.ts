import { proposalView } from '../agent/proposal-view';
import { clockNow } from '../common/clock';
import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { addDays, relativeDay, studyDate } from '../common/time';
import { UserTimeService } from '../common/user-time.service';
import { PlansService } from './plans.service';

@Controller('plans')
@UseGuards(JwtGuard)
export class PlansController {
  constructor(private db: DbService, private plans: PlansService, private time: UserTimeService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const f = from ?? await this.time.today(u.id);
    const t = to ?? addDays(f, 6);
    const dates = (await this.db.query(`SELECT to_char(plan_date,'YYYY-MM-DD') d FROM study_plans WHERE user_id=$1 AND plan_date BETWEEN $2 AND $3 ORDER BY plan_date`, [u.id, f, t])).rows;
    const today = await this.time.today(u.id);
    // relative_day：相对学习日的叫法（今天 / 明天 / 昨天 / 后天 / 前天，更远 null），前端直接显示，不自己算日界
    return { from: f, to: t, study_date: today, items: (await Promise.all(dates.map((d) => this.plans.getPlan(u.id, d.d)))).map((p) => p && { ...p, relative_day: relativeDay(p.plan_date, today) }) };
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.plans.upsertPlan(u.id, b); }

  /** 首页：今日任务 + 第一行「为什么改」 */
  @Get('today')
  async today(@CurrentUser() u: AuthUser) {
    const date = await this.time.today(u.id);
    const plan = await this.plans.getPlan(u.id, date);
    const lastAgent = await this.db.one(
      `SELECT id, group_id, summary, reason, created_at FROM agent_actions WHERE user_id=$1 AND target_kind IN ('plan','plan_task') AND undone_at IS NULL ORDER BY created_at DESC, seq DESC LIMIT 1`, [u.id]);
    if (lastAgent?.group_id) {
      // 同一次命令 / 确认的多条动作在首页也只显示一条：主动作的 id，摘要不含附带的「更新了计划的说明」（同 /agent/actions 的分组）
      const g = (await this.db.query(`SELECT id, summary, target_kind FROM agent_actions WHERE user_id=$1 AND group_id=$2 AND undone_at IS NULL ORDER BY seq`, [u.id, lastAgent.group_id])).rows;
      const main = g.filter((x: any) => x.target_kind !== 'plan');
      if (main.length) { lastAgent.id = main[0].id; lastAgent.summary = [...new Set(main.map((x: any) => x.summary))].join('；'); }
    }
    // 今日一句 / 昨晚复盘 / 最近一次周报（Agent 或定时任务写的）
    const tips = (await this.db.query(
      `SELECT DISTINCT ON (kind) id, kind, to_char(tip_date,'YYYY-MM-DD') date, text, COALESCE(headline, text) headline, details, seen_at, source, updated_at, proposal FROM daily_tips
        WHERE user_id=$1 AND tip_date <= $2 AND tip_date > $2::date - CASE kind WHEN 'weekly' THEN 7 WHEN 'review' THEN 2 ELSE 1 END
          AND (delivered_at IS NULL OR delivered_at <= $3)  -- 免打扰时段里写的消息排到时段结束才出现
        ORDER BY kind, tip_date DESC, created_at DESC`, [u.id, date, clockNow()])).rows;
    const pick = (k: string) => {
      const t = tips.find((x) => x.kind === k) ?? null;
      if (!t) return null;
      const { proposal, ...rest } = t;
      if (!(k === 'proposal' && proposal)) return rest;
      const v = proposalView(proposal, t, date); // 建议确认 / 忽略后显示过去时；目标日已过的待确认建议读成 expired
      return { ...rest, ...v, proposal: v.status === 'expired' ? { ...proposal, status: 'expired' } : proposal };
    };
    const urow = await this.db.one(`SELECT phase, COALESCE(settings->>'exam_date', to_char(exam_date,'YYYY-MM-DD')) exam_date FROM users WHERE id=$1`, [u.id]);
    const phase = urow?.phase ?? 'foundation';
    // 考试倒计时：用「我的」里的 exam_date，按用户时区的今天算；没设 = null
    const examDate: string | null = urow?.exam_date ?? null;
    const days_to_exam = examDate ? Math.round((Date.parse(examDate) - Date.parse(date)) / 86400000) : null;
    // 到期复习：已掌握的错题到了 FSRS 复习时间，今天再做一遍（做对 → archived，做错 → 回到错题本）
    const due = (await this.db.query(
      `SELECT w.id wrong_question_id, w.question_id, q.exam, q.year, q.number, w.due_at FROM wrong_questions w JOIN questions q ON q.id=w.question_id
        WHERE w.user_id=$1 AND w.status='mastered' AND w.due_at < $2 ORDER BY w.due_at LIMIT 20`, [u.id, (await this.time.day(u.id)).end])).rows;
    const tz = await this.time.tz(u.id);
    const dueItems = due.map((x: any) => { const dd = studyDate(new Date(x.due_at), tz); return { ...x, due_date: dd, due_relative_day: relativeDay(dd, date) }; });
    return { date, study_date: date, relative_day: '今天', plan: { ...(plan ?? { plan_date: date, tasks: [], progress: { done: 0, total: 0 } }), relative_day: '今天' }, why_changed: plan?.why_changed ?? null, why_changed_latest: plan?.why_changed_latest ?? null, last_agent_action: lastAgent, // 只说今天这页计划的改动；别的日子的改动看 last_agent_action
      review_due: { count: due.length, items: dueItems },
      phase, exam_date: examDate, days_to_exam, tips: { tip: pick('tip'), review: pick('review'), weekly: pick('weekly'), nudge: pick('nudge'), proposal: pick('proposal') } };
  }

  @Patch('tasks/:id')
  async updateTask(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { status?: string }, @Headers('x-device') device?: string) {
    if (b?.status && !['todo', 'doing', 'done', 'skipped'].includes(b.status)) throw new BadRequestException('status 只能是 todo/doing/done/skipped');
    const r = await this.db.one(
      `UPDATE plan_tasks t SET status=COALESCE($3,t.status), completed_at=CASE WHEN $3='done' THEN now() ELSE t.completed_at END, updated_at=now()
         FROM study_plans p WHERE t.id=$1 AND t.plan_id=p.id AND p.user_id=$2 RETURNING t.*`, [id, u.id, b?.status ?? null]);
    if (!r) throw new NotFoundException('任务不存在');
    await this.db.recordChange(this.db.pool, u.id, 'plan_task', r.id, 'upsert', r, device);
    return r;
  }
}
