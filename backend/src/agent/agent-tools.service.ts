import { UserTimeService } from '../common/user-time.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createEmptyCard } from 'ts-fsrs';
import { DbService } from '../db/db.service';
import { PlansService, TASK_KINDS } from '../plans/plans.service';
import { addDays, dayLabel, studyDaySql, toPlaceholders } from '../common/time';
import { clockNow } from '../common/clock';
import { minutesUntilQuietEnds, quietHours } from '../common/reminders';
import { AgentActionsService } from './agent.service';

export type Trigger = 'command' | 'nightly' | 'after_exam' | 'weekly' | 'phase_check' | 'event' | 'midday' | 'confirm';
export const PHASES = ['foundation', 'intensive', 'sprint'] as const;
export const PHASE_CN: Record<string, string> = { foundation: '基础', intensive: '强化', sprint: '冲刺' };

/** 一次 Agent 运行的上下文：谁、哪次命令、什么触发，以及新动作产生时的回调（SSE 推 action 用） */
export interface ToolCtx {
  userId: string;
  commandId: string | null;
  /** 操作日志分组：同一次命令 / 确认 / 定时任务的动作在「教练改过的」里合成一条，一次撤回整组（默认 = commandId） */
  groupId?: string | null;
  trigger: Trigger;
  onAction?: (a: any) => void | Promise<void>;
  /** 用户原话（命令栏）。用来判断用户有没有明确说要排到别的日子 */
  commandText?: string;
  /** 工具想对用户说一句（例如「已经有了，没有重复添加」），命令栏把它当 step 推给前端 */
  onStep?: (text: string, tool?: string) => void | Promise<void>;
  /** 本次命令里因为去重而跳过的任务 */
  deduped?: string[];
  /** 本次命令改了某任务的数量（「加两道」3→5、「今天重做 5 道」3→5） */
  quantity?: { from: number; to: number; mode: 'add' | 'set'; task_id: string; title: string };
  /** coach_frequency=ask 时教练主动跑的任务：写类工具只「试算」（事务回滚），记成建议，等用户确认后再按 input 重放 */
  propose?: boolean;
  /** 开发用强制触发（POST /agent/jobs/run force=true）：消息立刻送达，不按免打扰排队 */
  deliverNow?: boolean;
  proposals?: { tool: string; input: any; summaries: string[] }[];
}

const ROLLBACK = Symbol('propose-rollback');
/** propose 模式下只试算、不落库的写工具（writeDailyTip / setProactive 照常写：消息本身和少打扰不算「改你的东西」） */
const PROPOSABLE = ['updateDailyPlan', 'addReviewCard', 'upsertReminder', 'switchPhase', 'markCareless'];

/** 任务的数量：题目 id 个数 → payload.count → 标题里的「N 道」 */
export function taskQuantity(x: any): number {
  if (Array.isArray(x?.payload?.question_ids)) return new Set(x.payload.question_ids).size;
  return Number(x?.payload?.count) || Number(/(\d+)\s*[道题个]/.exec(x?.title ?? '')?.[1]) || 0;
}
/** add：在现有数量上加 n；set：设成 n */
export function nextQuantity(from: number, mode: 'add' | 'set', n: number) { return mode === 'add' ? from + n : n; }

/** 去重键：意图（加计划任务）+ 目标日期 + 任务类型 + 目标（题目集合 / 标题）+ 数量 */
export function planDedupeKey(date: string, t: { kind: string; title: string; payload?: any }) {
  const ids = Array.isArray(t.payload?.question_ids) ? [...new Set<string>(t.payload.question_ids)].sort() : null;
  const qty = ids ? ids.length : Number(t.payload?.count ?? 0) || null;
  return `plan_add|${date}|${t.kind}|${ids ? ids.join(',') : t.title.trim()}|${qty ?? ''}`;
}

/** 用户原话里明确提到了「今天以外」的日子（明天、后天、周六、11-07、8 号……） */
export const EXPLICIT_DAY_RE = /明天|明日|明早|明晚|后天|下周|下星期|周[一二三四五六日天末]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|\d{1,2}\s*[月\-/.]\s*\d{1,2}|\d{1,2}\s*[号日]|[一二三四五六七八九十]+\s*[号日]/;
/** why_changed 里写明是「挪/顺延」（从今天放不下的任务挪过去） */
const DEFER_RE = /挪到|顺延|推迟|移到|推到|放不下/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Agent 工具的真实实现（Mastra 工具和模拟模式共用同一套）。
 * 规则：写操作全部记 agent_actions（summary/target/reason/before/after），都能撤回；
 * 不删除作答记录和笔记（answer_records 有 append-only 触发器；wrong_questions.note 不碰）。
 */
@Injectable()
export class AgentToolsService {
  constructor(private db: DbService, private plans: PlansService, private actions: AgentActionsService, private time: UserTimeService) {}

  /** 用户时区：统一走 UserTimeService（settings.timezone → X-Timezone → APP_TZ） */
  private async userTz(userId: string) { return this.time.tz(userId); }
  private async emit(ctx: ToolCtx, a: any) {
    if (ctx.propose && PROPOSABLE.includes(a?.tool)) { const p = ctx.proposals?.[ctx.proposals.length - 1]; if (p && a?.summary) p.summaries.push(a.summary); return; }
    if (ctx.onAction) await ctx.onAction(a);
  }

  /** 写类工具的事务。propose 模式：照常算一遍（拿到 summary 给用户看），然后整笔回滚，只记一条建议 {tool, input} */
  private async writeTx<T>(ctx: ToolCtx, tool: string, input: any, fn: (c: any) => Promise<T>): Promise<T> {
    if (!ctx.propose) return this.db.tx(fn);
    (ctx.proposals ??= []).push({ tool, input, summaries: [] });
    let out: T;
    try { await this.db.tx(async (c) => { out = await fn(c); throw ROLLBACK; }); } catch (e) { if (e !== ROLLBACK) throw e; }
    return out!;
  }

  // ───────────── 只读 ─────────────

  async getProfile(ctx: ToolCtx) {
    const today = await this.time.today(ctx.userId); // 学习日（04:00 换天）
    const u = await this.db.one(`SELECT username, display_name, to_char(exam_date,'YYYY-MM-DD') exam_date, phase,
        settings->'target_score' target_score, settings->'target_scores' target_scores, settings->>'target_school' target_school FROM users WHERE id=$1`, [ctx.userId]);
    if (!u) throw new NotFoundException('用户不存在');
    const { target_score, target_scores, target_school, ...user } = u;
    const daysLeft = u.exam_date ? Math.round((Date.parse(u.exam_date) - Date.parse(today)) / 86400000) : null;
    const weakest = (await this.db.query(
      `SELECT kp_path, score::float, recent_acc::float, attempts, correct, last_practiced_at FROM mastery
        WHERE user_id=$1 AND score IS NOT NULL AND score < 0.7 ORDER BY score ASC, attempts DESC LIMIT 10`, [ctx.userId])).rows;
    const errors = (await this.db.query(
      `SELECT kp_path, concept, calc, reading, method, concept+calc+reading+method total FROM error_profile
        WHERE user_id=$1 ORDER BY concept+calc+reading+method DESC LIMIT 10`, [ctx.userId])).rows;
    const habits = (await this.db.query(
      `SELECT hour_bucket, acc::float, avg_seconds::float, samples FROM habits WHERE user_id=$1 AND samples>=3 ORDER BY acc DESC NULLS LAST LIMIT 5`, [ctx.userId])).rows;
    const goals = (await this.db.query(
      `SELECT id, text, subtasks, status, phase, to_char(due_date,'YYYY-MM-DD') due_date FROM goals WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 5`, [ctx.userId])).rows;
    const stats = await this.db.one(
      `SELECT (SELECT count(*)::int FROM wrong_questions WHERE user_id=$1 AND status='active') wrong_active,
              (SELECT count(*)::int FROM wrong_questions WHERE user_id=$1 AND status='active' AND due_at <= now()) wrong_due,
              (SELECT count(*)::int FROM answer_records WHERE user_id=$1 AND answered_at > now()-interval '7 days') answers_7d,
              (SELECT round(avg(CASE WHEN is_correct THEN 1 ELSE 0 END)::numeric,3)::float FROM answer_records WHERE user_id=$1 AND is_correct IS NOT NULL AND answered_at > now()-interval '7 days') acc_7d`,
      [ctx.userId]);
    // 最近交卷的模考 / 真题套卷（分数原样给，Agent 引用分数时以这里为准）
    const tz = await this.time.tz(ctx.userId);
    const recentExams = (await this.db.query(
      `SELECT id, kind, exam, year, title, to_char(submitted_at AT TIME ZONE $2,'YYYY-MM-DD') date,
              (result->>'score')::float score, (result->>'max_score')::float max_score
         FROM exams WHERE user_id=$1 AND status='submitted' ORDER BY submitted_at DESC LIMIT 8`, [ctx.userId, tz])).rows;
    const targets = { total: target_score ?? null, by_subject: target_scores ?? null, school: target_school ?? null };
    return { today, user: { ...user, days_left: daysLeft, phase_cn: PHASE_CN[u.phase] }, targets, weakest_kps: weakest, error_profile: errors, best_hours: habits, active_goals: goals, recent_exams: recentExams, stats };
  }

  /** wrong_from / wrong_to（YYYY-MM-DD，按用户时区）：只要这段日子里做错的题（首次或最近一次做错落在这段时间）——「昨天的错题」「上周的错题」 */
  async getWrongQuestions(ctx: ToolCtx, i: { limit?: number; kp_prefix?: string; due_only?: boolean; wrong_from?: string; wrong_to?: string } = {}) {
    const p: any[] = [ctx.userId];
    let w = `w.user_id=$1 AND w.status='active'`;
    if (i.wrong_from && DATE_RE.test(i.wrong_from)) {
      const to = i.wrong_to && DATE_RE.test(i.wrong_to) ? i.wrong_to : i.wrong_from;
      p.push(await this.userTz(ctx.userId), i.wrong_from, to);
      const tz = `$${p.length - 2}`, f = `$${p.length - 1}::date`, t = `$${p.length}::date`;
      w += ` AND (${studyDaySql('w.last_wrong_at', tz)} BETWEEN ${f} AND ${t} OR ${studyDaySql('w.first_wrong_at', tz)} BETWEEN ${f} AND ${t})`; // 按学习日（凌晨 4 点前做错的算前一天）
    }
    if (i.kp_prefix) { p.push(i.kp_prefix + '%'); w += ` AND EXISTS (SELECT 1 FROM unnest(q.knowledge_points) k WHERE k LIKE $${p.length})`; }
    if (i.due_only) w += ' AND w.due_at <= now()';
    const rows = (await this.db.query(
      `SELECT w.id wrong_question_id, w.question_id, q.exam, q.year, q.number, q.type, q.knowledge_points, w.error_type, w.wrong_count,
              w.due_at, w.last_wrong_at, w.first_wrong_at, left(q.stem, 80) stem_preview
         FROM wrong_questions w JOIN questions q ON q.id=w.question_id
        WHERE ${w} ORDER BY w.due_at NULLS LAST, w.last_wrong_at DESC LIMIT ${Math.min(Math.max(Number(i.limit) || 10, 1), 50)}`, p)).rows;
    return { count: rows.length, items: rows };
  }

  async getAnswerHistory(ctx: ToolCtx, i: { days?: number; kp_prefix?: string; limit?: number } = {}) {
    const days = Math.min(Math.max(Number(i.days) || 7, 1), 90);
    const p: any[] = [ctx.userId, days];
    let w = `a.user_id=$1 AND a.answered_at > now() - ($2 || ' days')::interval`;
    if (i.kp_prefix) { p.push(i.kp_prefix + '%'); w += ` AND EXISTS (SELECT 1 FROM unnest(q.knowledge_points) k WHERE k LIKE $${p.length})`; }
    const tz = await this.time.tz(ctx.userId);
    p.push(tz);
    const byDay = (await this.db.query(
      `SELECT to_char(${studyDaySql('a.answered_at', `$${p.length}`)},'YYYY-MM-DD') day, count(*)::int n,
              sum(CASE WHEN a.is_correct THEN 1 ELSE 0 END)::int correct, sum(COALESCE(a.time_spent_seconds,0))::int seconds
         FROM answer_records a JOIN questions q ON q.id=a.question_id WHERE ${w} GROUP BY 1 ORDER BY 1`, p)).rows;
    const recent = (await this.db.query(
      `SELECT a.question_id, a.sub_number, q.year, q.number, q.knowledge_points, a.answer, a.is_correct, a.self_rating, a.time_spent_seconds, a.thought_text, a.answered_at
         FROM answer_records a JOIN questions q ON q.id=a.question_id WHERE ${w}
        ORDER BY a.answered_at DESC LIMIT ${Math.min(Math.max(Number(i.limit) || 30, 1), 100)}`, p.slice(0, -1))).rows;
    return { days, by_day: byDay, recent };
  }

  /** 按知识点路径（前缀/包含）+ 年份/题号/题型找题。没有 pgvector，不做语义检索。 */
  async searchQuestions(_ctx: ToolCtx, i: { kp?: string; exam?: string; year?: number; number?: number; type?: string; limit?: number }) {
    const p: any[] = [];
    const w: string[] = [`q.review_status = 'confirmed'`]; // 没核对完的题不给 Agent 推荐
    if (i.kp) { p.push('%' + i.kp + '%'); w.push(`EXISTS (SELECT 1 FROM unnest(q.knowledge_points) k WHERE k ILIKE $${p.length})`); }
    if (i.exam) { p.push(i.exam); w.push(`q.exam=$${p.length}`); }
    if (i.year) { p.push(Number(i.year)); w.push(`q.year=$${p.length}`); }
    if (i.number) { p.push(Number(i.number)); w.push(`q.number=$${p.length}`); }
    if (i.type) { p.push(i.type); w.push(`q.type=$${p.length}`); }
    const rows = (await this.db.query(
      `SELECT q.id, q.exam, q.year, q.number, q.type, q.section, q.score::float, q.knowledge_points, q.review_status, left(q.stem, 100) stem_preview
         FROM questions q WHERE ${w.join(' AND ')} ORDER BY q.year DESC, q.exam, q.number LIMIT ${Math.min(Math.max(Number(i.limit) || 10, 1), 50)}`, p)).rows;
    return { count: rows.length, items: rows };
  }

  // ───────────── 写操作（都记 agent_actions，可撤回） ─────────────

  /**
   * 改某天计划：加任务 / 改任务（标题、顺序、时长、跳过）/ 写「为什么改」。
   * 不删任务：不需要的任务标成 skipped（用户还能看到 Agent 改了什么）。
   */
  async updateDailyPlan(ctx: ToolCtx, i: {
    date?: string; why_changed: string;
    /** mode+quantity：数量语义。add = 在同类任务上加 quantity（没有就新建）；set = 设成 quantity（已经是就不动）。payload.question_ids 是候选题（按优先级） */
    add_tasks?: { kind: string; title: string; payload?: any; estimated_minutes?: number; position?: 'top' | 'bottom'; mode?: 'add' | 'set'; quantity?: number }[];
    update_tasks?: { id: string; title?: string; sort_order?: number; estimated_minutes?: number; status?: 'todo' | 'skipped' }[];
  }) {
    // 「今天」只在 UserTimeService 里按用户时区算（晚上也一样），不用进程本地时区；排到别的日子必须显式传 date
    const today = await this.time.today(ctx.userId);
    let date = i.date || today;
    if (!DATE_RE.test(date)) throw new BadRequestException('date 格式 YYYY-MM-DD');
    // 命令栏：用户没明确说别的日子、也不是「放不下挪过去」，模型给的 date 一律改回今天（防止晚上被排进明天）
    let dateOverridden: string | null = null;
    if (ctx.trigger === 'command' && ctx.commandText != null && date !== today && !EXPLICIT_DAY_RE.test(ctx.commandText) && !DEFER_RE.test(i.why_changed ?? '')) {
      dateOverridden = date; date = today;
    }
    if (!i.why_changed?.trim()) throw new BadRequestException('why_changed 必填：要告诉用户为什么改');
    if (!i.add_tasks?.length && !i.update_tasks?.length) throw new BadRequestException('add_tasks / update_tasks 至少一个');
    for (const t of i.add_tasks ?? []) if (!TASK_KINDS.includes(t.kind)) throw new BadRequestException(`kind 只能是 ${TASK_KINDS.join('/')}`);
    const why = toPlaceholders(i.why_changed.trim(), today) as string; // 存库用日期占位符，读时按学习日渲染
    const created = await this.writeTx(ctx, 'updateDailyPlan', { ...i, date }, async (c: any) => {
      const out: any[] = [];
      const planId = await this.plans.ensurePlan(c, ctx.userId, date);
      const unchanged: string[] = [];
      const notes: string[] = [];
      for (const t of i.add_tasks ?? []) {
        if (t.mode && t.quantity != null) {
          const r = await this.applyQuantity(c, ctx, planId, date, why, t as any);
          if (r.unchanged) unchanged.push(r.unchanged);
          if (r.note) notes.push(r.note);
          if (r.action) out.push(r.action);
          continue;
        }
        const key = planDedupeKey(date, t);
        // 去重 1：同一意图键 60 秒内执行过（没撤回）→ 不再执行
        const recent = (await c.query(
          `SELECT summary FROM agent_actions WHERE user_id=$1 AND dedupe_key=$2 AND undone_at IS NULL AND created_at > now() - make_interval(secs => $3) LIMIT 1`,
          [ctx.userId, key, Number(process.env.AGENT_DEDUPE_SECONDS || 60)])).rows[0];
        if (recent) { unchanged.push(t.title); continue; }
        // 去重 2 / 幂等：同一天已有等价任务（同类型 + 同题目集合 / 同标题）就不再加；redo_wrong 每天只留一条，题目合并进去
        const ids = Array.isArray(t.payload?.question_ids) ? [...new Set<string>(t.payload.question_ids)].sort() : null;
        const existing = (await c.query(
          `SELECT * FROM plan_tasks WHERE plan_id=$1 AND kind=$2 AND status IN ('todo','doing','skipped') ORDER BY (status='skipped'), sort_order FOR UPDATE`, [planId, t.kind])).rows;
        const sameIds = (x: any) => ids != null && Array.isArray(x.payload?.question_ids) && JSON.stringify([...new Set<string>(x.payload.question_ids)].sort()) === JSON.stringify(ids);
        const match = existing.find((x: any) => sameIds(x) || (ids == null && x.title === t.title)) ?? (t.kind === 'redo_wrong' && ids ? existing.find((x: any) => x.status !== 'skipped') : undefined);
        if (match) {
          const merged = ids && Array.isArray(match.payload?.question_ids) ? [...new Set<string>([...match.payload.question_ids, ...ids])] : ids;
          const sameSet = (a: any, b: any) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
          const sameContent = (sameIds(match) || (ids == null && match.title === t.title) || sameSet(merged, match.payload?.question_ids)) && match.status !== 'skipped';
          if (sameContent) { unchanged.push(match.title); continue; }
          const title = t.kind === 'redo_wrong' && merged ? `重做 ${merged.length} 道错题` : t.title;
          const payload = merged ? { ...(match.payload ?? {}), ...(t.payload ?? {}), question_ids: merged } : (t.payload ?? match.payload ?? {});
          const minutes = t.kind === 'redo_wrong' && merged ? merged.length * 8 : t.estimated_minutes ?? match.estimated_minutes;
          const after = (await c.query(
            `UPDATE plan_tasks SET title=$2, payload=$3, estimated_minutes=$4, status=CASE WHEN status='skipped' THEN 'todo' ELSE status END, changed_by_agent=true, updated_at=now() WHERE id=$1 RETURNING *`,
            [match.id, title, JSON.stringify(payload), minutes ?? null])).rows[0];
          const a = await this.actions.log(c, ctx.userId, {
            commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'updateDailyPlan',
            summary: `${date.slice(5)} 已有「${match.title}」，${match.status === 'skipped' ? '恢复成待做' : `更新为「${title}」`}（没有重复添加）`, reason: why,
            target: { kind: 'plan_task', id: match.id }, before: match, after, dedupeKey: key });
          await c.query('UPDATE plan_tasks SET agent_action_id=$2, why_changed=$3 WHERE id=$1', [match.id, a.id, why]);
          await this.db.recordChange(c, ctx.userId, 'plan_task', match.id, 'upsert', after);
          out.push(a);
          continue;
        }
        const pos = t.position === 'bottom' ? `(SELECT COALESCE(max(sort_order),0)+1 FROM plan_tasks WHERE plan_id=$1)` : `(SELECT COALESCE(min(sort_order),0)-1 FROM plan_tasks WHERE plan_id=$1)`;
        const task = (await c.query(
          `INSERT INTO plan_tasks(plan_id,kind,title,payload,sort_order,estimated_minutes,changed_by_agent) VALUES($1,$2,$3,$4,${pos},$5,true) RETURNING *`,
          [planId, t.kind, t.title, JSON.stringify(t.payload ?? {}), t.estimated_minutes ?? null])).rows[0];
        const a = await this.actions.log(c, ctx.userId, {
          commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'updateDailyPlan',
          summary: `在 ${date.slice(5)} 的计划里加了「${t.title}」`, reason: why,
          target: { kind: 'plan_task', id: task.id }, before: null, after: task, dedupeKey: key });
        await c.query('UPDATE plan_tasks SET agent_action_id=$2, why_changed=$3 WHERE id=$1', [task.id, a.id, why]);
        await this.db.recordChange(c, ctx.userId, 'plan_task', task.id, 'upsert', task);
        out.push(a);
      }
      for (const t of i.update_tasks ?? []) {
        const before = (await c.query(`SELECT * FROM plan_tasks WHERE id=$1 AND plan_id=$2 FOR UPDATE`, [t.id, planId])).rows[0];
        if (!before) throw new BadRequestException(`任务 ${t.id} 不在 ${date} 的计划里`);
        if (t.status && !['todo', 'skipped'].includes(t.status)) throw new BadRequestException('Agent 只能把任务改成 todo 或 skipped');
        const after = (await c.query(
          `UPDATE plan_tasks SET title=COALESCE($2,title), sort_order=COALESCE($3,sort_order), estimated_minutes=COALESCE($4,estimated_minutes),
             status=COALESCE($5,status), changed_by_agent=true, updated_at=now() WHERE id=$1 RETURNING *`,
          [t.id, t.title ?? null, t.sort_order ?? null, t.estimated_minutes ?? null, t.status ?? null])).rows[0];
        const what = t.status === 'skipped' ? `先跳过「${before.title}」` : `调整了「${before.title}」`;
        const a = await this.actions.log(c, ctx.userId, {
          commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'updateDailyPlan', summary: `${date.slice(5)}：${what}`, reason: why,
          target: { kind: 'plan_task', id: t.id }, before, after });
        await c.query('UPDATE plan_tasks SET agent_action_id=$2, why_changed=$3 WHERE id=$1', [t.id, a.id, why]);
        await this.db.recordChange(c, ctx.userId, 'plan_task', t.id, 'upsert', after);
        out.push(a);
      }
      if (!out.length) return { out, unchanged, notes };
      // 首页第一行「为什么改」：也记一条（撤回时恢复原说明）
      const planBefore = (await c.query('SELECT why_changed, changed_by_agent FROM study_plans WHERE id=$1', [planId])).rows[0];
      await c.query('UPDATE study_plans SET why_changed=$2, changed_by_agent=true, updated_at=now() WHERE id=$1', [planId, why]);
      if (planBefore.why_changed !== why) {
        out.push(await this.actions.log(c, ctx.userId, {
          commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'updateDailyPlan', summary: `更新了 ${date.slice(5)} 计划的说明`, reason: why,
          target: { kind: 'plan', id: planId }, before: planBefore, after: { why_changed: why, changed_by_agent: true } }));
      }
      return { out, unchanged, notes };
    });
    for (const n of created.notes) if (ctx.onStep) await ctx.onStep(n, 'updateDailyPlan');
    for (const a of created.out) await this.emit(ctx, a);
    if (ctx.quantity && ctx.quantity.from > 0 && ctx.onStep)
      await ctx.onStep(`${dayLabel(date, today)}的「${ctx.quantity.title.replace(/\s*\d+\s*道/, '')}」已从 ${ctx.quantity.from} 道${ctx.quantity.mode === 'add' ? '加到' : '改为'} ${ctx.quantity.to} 道`, 'updateDailyPlan');
    if (created.unchanged.length) {
      (ctx.deduped ??= []).push(...created.unchanged);
      if (ctx.onStep) await ctx.onStep(`${dayLabel(date, today)}的计划里已经有「${created.unchanged.join('」「')}」，没有重复添加`, 'updateDailyPlan');
    }
    if (dateOverridden && ctx.onStep) await ctx.onStep(`你没说要排到 ${dateOverridden}，按${dayLabel(date, today)}改`, 'updateDailyPlan');
    return { date, actions: created.out.map((a: any) => ({ id: a.id, summary: a.summary })), unchanged: created.unchanged,
      ...(ctx.quantity ? { quantity_from: ctx.quantity.from, quantity_to: ctx.quantity.to } : {}), ...(dateOverridden ? { date_overridden_from: dateOverridden } : {}) };
  }

  /** 数量语义（见 add_tasks.mode）：每次改数量都记一条 action，before 是原任务（撤回恢复原数量） */
  private async applyQuantity(c: any, ctx: ToolCtx, planId: string, date: string, why: string,
    t: { kind: string; title: string; payload?: any; estimated_minutes?: number; position?: 'top' | 'bottom'; mode: 'add' | 'set'; quantity: number }) {
    const n = Math.max(1, Math.min(50, Math.round(Number(t.quantity) || 0)));
    const match = (await c.query(
      `SELECT * FROM plan_tasks WHERE plan_id=$1 AND kind=$2 AND status IN ('todo','doing','skipped') ORDER BY (status='skipped'), sort_order LIMIT 1 FOR UPDATE`, [planId, t.kind])).rows[0];
    const live = match && match.status !== 'skipped' ? match : null;
    const from = live ? taskQuantity(live) : 0;
    let to = nextQuantity(from, t.mode, n);
    const want = to;
    const cands: string[] | null = Array.isArray(t.payload?.question_ids) ? t.payload.question_ids : null;
    let payload: any;
    let note: string | null = null;
    if (cands) {
      const have: string[] = Array.isArray(live?.payload?.question_ids) ? live.payload.question_ids : [];
      const ids = [...new Set<string>([...have, ...cands])].slice(0, to);
      if (ids.length < to) {
        note = t.mode === 'add' && from > 0
          ? `要加到 ${to} 道，错题本里该重做的只有 ${ids.length} 道，先排到 ${ids.length} 道`
          : `你说要 ${want} 道，错题本里该重做的只有 ${ids.length} 道，先排这 ${ids.length} 道`;
        to = ids.length;
      }
      payload = { ...(match?.payload ?? {}), ...(t.payload ?? {}), question_ids: ids };
    } else payload = { ...(match?.payload ?? {}), ...(t.payload ?? {}), count: to };
    const title = t.kind === 'redo_wrong' ? `重做 ${to} 道错题` : /\d+\s*[道题个]/.test(t.title) ? t.title.replace(/\d+(\s*[道题个])/, `${to}$1`) : `${t.title}（${to}）`;
    const minutes = t.kind === 'redo_wrong' ? to * 8 : t.estimated_minutes ?? match?.estimated_minutes ?? null;
    if (to === 0) return { note: note ?? '错题本里还没有该重做的错题' };
    if (live && to === from) {
      if (t.mode === 'add') return { note: `错题本里没有更多该重做的错题了，${date.slice(5)} 还是「${live.title}」` };
      return { unchanged: live.title as string, note };
    }
    const key = `plan_qty|${date}|${t.kind}|${to}`;
    if (match) {
      const after = (await c.query(
        `UPDATE plan_tasks SET title=$2, payload=$3, estimated_minutes=$4, status=CASE WHEN status='skipped' THEN 'todo' ELSE status END, changed_by_agent=true, updated_at=now() WHERE id=$1 RETURNING *`,
        [match.id, title, JSON.stringify(payload), minutes])).rows[0];
      const verb = t.mode === 'add' ? '加到' : '改为';
      const a = await this.actions.log(c, ctx.userId, {
        commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'updateDailyPlan',
        summary: live ? `${date.slice(5)}「${t.kind === 'redo_wrong' ? '重做错题' : match.title}」已从 ${from} 道${verb} ${to} 道` : `${date.slice(5)} 恢复「${title}」`, reason: why,
        target: { kind: 'plan_task', id: match.id }, before: match, after: { ...after, quantity_from: from, quantity_to: to }, dedupeKey: key });
      await c.query('UPDATE plan_tasks SET agent_action_id=$2, why_changed=$3 WHERE id=$1', [match.id, a.id, why]);
      await this.db.recordChange(c, ctx.userId, 'plan_task', match.id, 'upsert', after);
      ctx.quantity = { from, to, mode: t.mode, task_id: match.id, title };
      return { action: a, note };
    }
    const pos = t.position === 'bottom' ? `(SELECT COALESCE(max(sort_order),0)+1 FROM plan_tasks WHERE plan_id=$1)` : `(SELECT COALESCE(min(sort_order),0)-1 FROM plan_tasks WHERE plan_id=$1)`;
    const task = (await c.query(
      `INSERT INTO plan_tasks(plan_id,kind,title,payload,sort_order,estimated_minutes,changed_by_agent) VALUES($1,$2,$3,$4,${pos},$5,true) RETURNING *`,
      [planId, t.kind, title, JSON.stringify(payload), minutes])).rows[0];
    const a = await this.actions.log(c, ctx.userId, {
      commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'updateDailyPlan',
      summary: `在 ${date.slice(5)} 的计划里加了「${title}」`, reason: why,
      target: { kind: 'plan_task', id: task.id }, before: null, after: { ...task, quantity_from: 0, quantity_to: to }, dedupeKey: key });
    await c.query('UPDATE plan_tasks SET agent_action_id=$2, why_changed=$3 WHERE id=$1', [task.id, a.id, why]);
    await this.db.recordChange(c, ctx.userId, 'plan_task', task.id, 'upsert', task);
    ctx.quantity = { from: 0, to, mode: t.mode, task_id: task.id, title };
    return { action: a, note };
  }

  /** 把一道题加入复习卡片（错题本 FSRS 队列）；已有则改为到期 */
  async addReviewCard(ctx: ToolCtx, i: { question_id: string; reason: string; due?: 'now' | 'tomorrow' }) {
    if (!i.reason?.trim()) throw new BadRequestException('reason 必填');
    const q = await this.db.one('SELECT id, year, number FROM questions WHERE id=$1', [i.question_id]);
    if (!q) throw new BadRequestException(`题目 ${i.question_id} 不存在`);
    // 「明天」= 下一个学习日开始（当地 04:00），不是 now+24h（凌晨排的话 +24h 还落在今天这个学习日里）
    const day = await this.time.day(ctx.userId);
    const due = i.due === 'tomorrow' ? new Date(day.end) : new Date();
    const a = await this.writeTx(ctx, 'addReviewCard', i, async (c: any) => {
      const before = (await c.query('SELECT * FROM wrong_questions WHERE user_id=$1 AND question_id=$2 FOR UPDATE', [ctx.userId, q.id])).rows[0] ?? null;
      const after = before
        ? (await c.query(`UPDATE wrong_questions SET status='active', due_at=$2, updated_at=now() WHERE id=$1 RETURNING *`, [before.id, due])).rows[0]
        : (await c.query(
          `INSERT INTO wrong_questions(user_id,question_id,wrong_count,fsrs_card,due_at) VALUES($1,$2,0,$3,$4) RETURNING *`,
          [ctx.userId, q.id, JSON.stringify(createEmptyCard(due)), due])).rows[0];
      await this.db.recordChange(c, ctx.userId, 'wrong_question', after.id, 'upsert', after);
      return this.actions.log(c, ctx.userId, {
        commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'addReviewCard',
        summary: `把 ${q.year} 年第 ${q.number} 题${before ? '提前到' : '加进'}${dayLabel(i.due === 'tomorrow' ? addDays(day.date, 1) : day.date, day.date)}的复习`, reason: i.reason.trim(),
        target: { kind: 'wrong_question', id: after.id }, before, after });
    });
    await this.emit(ctx, a);
    return { action_id: a.id, summary: a.summary };
  }

  /** 每道错题的「下次记住」一句话 */
  async upsertReminder(ctx: ToolCtx, i: { question_id: string; text: string; reason: string }) {
    if (!i.text?.trim() || !i.reason?.trim()) throw new BadRequestException('text 和 reason 必填');
    const q = await this.db.one('SELECT id, year, number FROM questions WHERE id=$1', [i.question_id]);
    if (!q) throw new BadRequestException(`题目 ${i.question_id} 不存在`);
    const a = await this.writeTx(ctx, 'upsertReminder', i, async (c: any) => {
      const before = (await c.query('SELECT * FROM reminders WHERE user_id=$1 AND question_id=$2 FOR UPDATE', [ctx.userId, q.id])).rows[0] ?? null;
      const after = (await c.query(
        `INSERT INTO reminders(user_id,question_id,text,created_by) VALUES($1,$2,$3,'agent')
         ON CONFLICT (user_id,question_id) DO UPDATE SET text=EXCLUDED.text, updated_at=now() RETURNING *`,
        [ctx.userId, q.id, i.text.trim()])).rows[0];
      await this.db.recordChange(c, ctx.userId, 'reminder', after.id, 'upsert', after);
      return this.actions.log(c, ctx.userId, {
        commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'upsertReminder',
        summary: `${before ? '改了' : '写了'} ${q.year} 年第 ${q.number} 题的「下次记住」`, reason: i.reason.trim(),
        target: { kind: 'reminder', id: after.id }, before, after });
    });
    await this.emit(ctx, a);
    return { action_id: a.id, summary: a.summary };
  }

  /** 切换复习阶段（基础/强化/冲刺） */
  async switchPhase(ctx: ToolCtx, i: { phase: string; reason: string }) {
    if (!PHASES.includes(i.phase as any)) throw new BadRequestException(`phase 只能是 ${PHASES.join('/')}`);
    if (!i.reason?.trim()) throw new BadRequestException('reason 必填');
    const res = await this.writeTx(ctx, 'switchPhase', i, async (c: any) => {
      const before = (await c.query('SELECT phase FROM users WHERE id=$1 FOR UPDATE', [ctx.userId])).rows[0];
      if (before.phase === i.phase) return null;
      await c.query('UPDATE users SET phase=$2, updated_at=now() WHERE id=$1', [ctx.userId, i.phase]);
      await this.db.recordChange(c, ctx.userId, 'user_phase', ctx.userId, 'upsert', { phase: i.phase });
      return this.actions.log(c, ctx.userId, {
        commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'switchPhase',
        summary: `复习阶段从「${PHASE_CN[before.phase]}」切到「${PHASE_CN[i.phase]}」`, reason: i.reason.trim(),
        target: { kind: 'user_phase', id: ctx.userId }, before: { phase: before.phase }, after: { phase: i.phase } });
    });
    if (!res) return { changed: false, phase: i.phase };
    await this.emit(ctx, res);
    return { changed: true, action_id: res.id, summary: res.summary };
  }

  /** 主动消息什么时候算「送达」：现在不在用户的免打扰（settings.quiet_hours，用户时区）→ 现在；在 → 排到时段结束那一刻 */
  async deliverAt(userId: string): Promise<Date> {
    const now = clockNow();
    const settings = (await this.db.one('SELECT settings FROM users WHERE id=$1', [userId]))?.settings;
    const q = quietHours(settings);
    if (!q) return now;
    const tz = await this.userTz(userId);
    const [hh, mm] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
    const wait = minutesUntilQuietEnds(hh * 60 + mm, q);
    return new Date(Math.floor(now.getTime() / 60000) * 60000 + wait * 60000);
  }

  /** 首页「今日一句」/ 夜间复盘 / 周报 */
  async writeDailyTip(ctx: ToolCtx, i: { text: string; date?: string; kind?: 'tip' | 'review' | 'weekly' | 'exam_review' | 'nudge' | 'proposal'; reason?: string; source?: string; details?: string; proposal?: any }) {
    const ref = await this.time.today(ctx.userId);
    const text = toPlaceholders(i.text?.trim(), ref) as string; // 日期存成占位符，读时按读者的学习日渲染
    if (!text) throw new BadRequestException('text 必填');
    i = { ...i, details: toPlaceholders(i.details, ref) ?? undefined, ...(i.proposal?.items ? { proposal: { ...i.proposal, items: i.proposal.items.map((x: any) => ({ ...x, summary: toPlaceholders(x.summary, ref) })) } } : {}) };
    const kind = i.kind ?? 'tip';
    if (!['tip', 'review', 'weekly', 'exam_review', 'nudge', 'proposal'].includes(kind)) throw new BadRequestException('kind 只能是 tip/review/weekly/exam_review/nudge/proposal');
    const date = i.date || (await this.time.today(ctx.userId));
    if (!DATE_RE.test(date)) throw new BadRequestException('date 格式 YYYY-MM-DD');
    const label = ({ tip: '今日一句', review: '今日复盘', weekly: '本周周报', exam_review: '模考复盘', nudge: '进度提醒', proposal: '教练建议' } as Record<string, string>)[kind];
    const a = await this.db.tx(async (c) => {
      const deliver = (ctx.deliverNow ? clockNow() : await this.deliverAt(ctx.userId)).toISOString();
      // 建议（kind=proposal）每次都是一条新消息，不覆盖当天已有的（已确认 / 已忽略的建议永远不再改）
      if (kind === 'proposal') {
        const after = (await c.query(
          `INSERT INTO daily_tips(user_id,tip_date,kind,text,source,headline,details,delivered_at,proposal) VALUES($1,$2,'proposal',$3,$4,$3,$5,$6::timestamptz,$7::jsonb) RETURNING *`,
          [ctx.userId, date, text, i.source ?? 'agent', i.details?.trim() || null, deliver, i.proposal == null ? null : JSON.stringify(i.proposal)])).rows[0];
        await this.db.recordChange(c, ctx.userId, 'daily_tip', after.id, 'upsert', after);
        return this.actions.log(c, ctx.userId, {
          commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'writeDailyTip',
          summary: `写了 ${date.slice(5)} 的${label}`, reason: i.reason?.trim() || label, target: { kind: 'daily_tip', id: after.id }, before: null, after });
      }
      const before = (await c.query('SELECT * FROM daily_tips WHERE user_id=$1 AND tip_date=$2 AND kind=$3 FOR UPDATE', [ctx.userId, date, kind])).rows[0] ?? null;
      const after = (await c.query(
        `INSERT INTO daily_tips(user_id,tip_date,kind,text,source,headline,details,delivered_at) VALUES($1,$2,$3,$4,$5,$4,$6,CASE WHEN $3='tip' THEN NULL ELSE $7::timestamptz END)
         ON CONFLICT (user_id,tip_date,kind) WHERE kind <> 'proposal' DO UPDATE SET text=EXCLUDED.text, source=EXCLUDED.source, headline=EXCLUDED.headline, details=EXCLUDED.details,
           delivered_at=COALESCE(EXCLUDED.delivered_at, daily_tips.delivered_at), updated_at=now() RETURNING *`,
        [ctx.userId, date, kind, text, i.source ?? 'agent', i.details?.trim() || null, deliver])).rows[0];
      await this.db.recordChange(c, ctx.userId, 'daily_tip', after.id, 'upsert', after);
      return this.actions.log(c, ctx.userId, {
        commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'writeDailyTip',
        summary: `${before ? '更新' : '写'}了 ${date.slice(5)} 的${label}`, reason: i.reason?.trim() || label,
        target: { kind: 'daily_tip', id: after.id }, before, after });
    });
    await this.emit(ctx, a);
    return { action_id: a.id, summary: a.summary, date, kind, tip_id: a.target.id as string };
  }

  /**
   * 「这题我会，是手滑」：错因记成 careless（粗心），并把这次做错对掌握度的扣分退回去
   * （把那次作答按「做对」重算 correct / recent_acc / score）。记 agent_actions，撤回时错因和掌握度都恢复原样。
   * 幂等：已经是 careless 就不再改。
   */
  async markCareless(ctx: ToolCtx, i: { question_id?: string; reason?: string }) {
    const res = await this.writeTx(ctx, 'markCareless', i, async (c: any) => {
      let qid = i.question_id;
      if (!qid) qid = (await c.query(`SELECT question_id FROM answer_records WHERE user_id=$1 AND is_correct=false ORDER BY answered_at DESC, created_at DESC LIMIT 1`, [ctx.userId])).rows[0]?.question_id;
      if (!qid) throw new BadRequestException('没找到最近做错的题，说一下是哪道题');
      const q = (await c.query('SELECT id, year, number, knowledge_points FROM questions WHERE id=$1', [qid])).rows[0];
      if (!q) throw new BadRequestException(`题目 ${qid} 不存在`);
      const w = (await c.query('SELECT * FROM wrong_questions WHERE user_id=$1 AND question_id=$2 FOR UPDATE', [ctx.userId, q.id])).rows[0];
      if (!w) throw new BadRequestException(`${q.year} 年第 ${q.number} 题不在错题本里`);
      if (w.error_type === 'careless') return { q, already: true, action: null };
      const kps: string[] = q.knowledge_points ?? [];
      const masteryBefore = (await c.query('SELECT * FROM mastery WHERE user_id=$1 AND kp_path = ANY($2)', [ctx.userId, kps])).rows;
      for (const m of masteryBefore) {
        if (m.correct >= m.attempts) continue;
        // 那次做错让 recent_acc 少了 0.3（EMA 权重），按做对补回；总正确率按 correct+1 算
        await c.query(
          `UPDATE mastery SET correct=correct+1, recent_acc=LEAST(1, COALESCE(recent_acc,0.5)+0.3),
             score=round(0.5*((correct+1)::numeric/GREATEST(attempts,1)) + 0.5*LEAST(1, COALESCE(recent_acc,0.5)+0.3),3), updated_at=now()
           WHERE user_id=$1 AND kp_path=$2`, [ctx.userId, m.kp_path]);
      }
      const after = (await c.query(`UPDATE wrong_questions SET error_type='careless', error_type_by='user', updated_at=now() WHERE id=$1 RETURNING *`, [w.id])).rows[0];
      await this.db.recordChange(c, ctx.userId, 'wrong_question', w.id, 'upsert', after);
      const action = await this.actions.log(c, ctx.userId, {
        commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'markCareless',
        summary: `${q.year} 年第 ${q.number} 题记为「粗心」，${kps.length ? '相关知识点的掌握度不扣分' : '不影响掌握度'}`,
        reason: i.reason?.trim() || '你说这题会做，是手滑',
        target: { kind: 'careless_mark', id: w.id }, before: { wrong: w, mastery: masteryBefore }, after: { wrong: after } });
      return { q, already: false, action };
    });
    if (res.action) await this.emit(ctx, res.action);
    return { question_id: res.q.id, already: res.already, action_id: res.action?.id ?? null, summary: res.action?.summary ?? `${res.q.year} 年第 ${res.q.number} 题已经记成粗心了` };
  }

  /**
   * 主动提醒频率：reduced = 夜间复盘每 N 天一次（周报照常）；normal = 每晚。只会调低或恢复，不会比每晚更频繁。
   * 有变化才记一条可撤回的 agent_action。
   */
  async setProactive(ctx: ToolCtx, i: { mode: 'normal' | 'reduced'; every_days?: number; reason: string; cause?: string }) {
    if (!['normal', 'reduced'].includes(i.mode)) throw new BadRequestException('mode 只能是 normal/reduced');
    const every = i.mode === 'normal' ? 1 : Math.min(Math.max(Number(i.every_days) || 3, 2), 7);
    const res = await this.db.tx(async (c) => {
      const before = (await c.query('SELECT proactive FROM users WHERE id=$1 FOR UPDATE', [ctx.userId])).rows[0]?.proactive ?? { mode: 'normal', nightly_every_days: 1 };
      if (before.mode === i.mode && Number(before.nightly_every_days) === every) return null;
      const after = { mode: i.mode, nightly_every_days: every, cause: i.cause ?? null, since: new Date().toISOString() };
      await c.query('UPDATE users SET proactive=$2, updated_at=now() WHERE id=$1', [ctx.userId, JSON.stringify(after)]);
      return this.actions.log(c, ctx.userId, {
        commandId: ctx.commandId, groupId: ctx.groupId, trigger: ctx.trigger, tool: 'setProactive',
        summary: i.mode === 'reduced' ? `少打扰：每晚复盘改成每 ${every} 天一次（周报照常）` : '恢复每晚复盘',
        reason: i.reason, target: { kind: 'proactive', id: ctx.userId }, before: { proactive: before }, after: { proactive: after } });
    });
    if (!res) return { changed: false, mode: i.mode, nightly_every_days: every };
    await this.emit(ctx, res);
    return { changed: true, action_id: res.id, summary: res.summary, mode: i.mode, nightly_every_days: every };
  }
}
