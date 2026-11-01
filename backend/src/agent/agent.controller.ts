import { proposalView } from './proposal-view';
/** 过期是读时算的：顶层 status 和 proposal.status 都给 expired（前端看 proposal.status），库里不改 */
const withView = (i: any, v: any) => ({ ...i, ...v, proposal: v.status === 'expired' ? { ...i.proposal, status: 'expired' } : i.proposal });
import { clause, parseCount, questionKind } from './coach.service';
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { clockNow } from '../common/clock';
import { appendNote, dayLabel, placeholdersDeep, relativeDay, renderDates, renderDeep, wantsEarlyNote } from '../common/time';
import { UserTimeService } from '../common/user-time.service';
import { AgentToolsService } from './agent-tools.service';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { openSse } from '../common/sse';
import { AgentActionsService } from './agent.service';
import { CoachService } from './coach.service';
import { JobsService, JOB_NAMES } from './jobs.service';

/**
 * 教练 Agent（Mastra + DeepSeek 工具调用）。没有 DEEPSEEK_API_KEY 时走模拟：不调模型，但会真实写一条可撤回的计划改动。
 * SSE 事件：step（一句中文，说明它在做什么）、action（新建的 agent_action）、done、error
 */
/** 去重窗口（秒）：同一用户 + 同一意图 + 同一目标日期 + 同一任务，在这段时间内执行过就不再执行 */
export const DEDUPE_SECONDS = Number(process.env.AGENT_DEDUPE_SECONDS || 60);
/** 只用来记日志/排查（去重不看原句，看意图键 dedupe_key） */
export const normalizeCommand = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

@Controller('agent')
@UseGuards(JwtGuard)
export class AgentController {
  constructor(private actions: AgentActionsService, private coach: CoachService, private jobs: JobsService, private db: DbService, private tools: AgentToolsService, private time: UserTimeService) {}

  /** 同一用户的命令排队执行（连点两次时第二条等第一条写完再判断「已经有了」） */
  private queues = new Map<string, Promise<unknown>>();
  private serial<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(userId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.queues.set(userId, tail);
    void tail.then(() => { if (this.queues.get(userId) === tail) this.queues.delete(userId); });
    return run;
  }

  /**
   * 命令栏。去重按「意图」不按原句：同一用户 + 同一意图 + 同一目标日期 + 同一任务（类型 + 题目/数量），
   * 60 秒内执行过、或那天的计划里已经有这项任务 → 不再加，step 里说「已经有了」，done.deduped=true。
   * 同一用户的命令串行执行。
   */
  @Post('commands')
  async command(@CurrentUser() u: AuthUser, @Body() b: { text?: string; client_id?: string; question_id?: string }, @Res() res: Response) {
    if (!b?.text?.trim()) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: '先说一句要教练做什么', field: 'text', code: 'empty_text' });
    if (b.text.length > 2000) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: '这段话太长了，最多 2000 字', field: 'text', code: 'text_too_long' });
    const raw = openSse(res);
    const commandId = randomUUID();
    // 发给前端的按此刻学习日渲染（日期占位符 → 今天（11-01）、引号层级）；存库的 events / result 用占位符，以后再读按读者当天渲染
    const today0 = await this.time.today(u.id);
    const sse = { send: (event: string, data: any) => raw.send(event, renderDeep(data, today0, true)), end: () => raw.end() };
    const ph = (v: any) => JSON.stringify(placeholdersDeep(v, today0));
    await this.serial(u.id, async () => {
      const norm = normalizeCommand(b.text!);
      await this.db.query('INSERT INTO agent_commands(id,user_id,text,norm_text,eff_at,study_date) VALUES($1,$2,$3,$4,$5,$6)', [commandId, u.id, b.text, norm, clockNow(), today0]);
      const events: any[] = [];
      try {
        // 同一用户 60 秒内又发了同一句话（规范化后相同）：一律当重复，不执行（哪怕带「加/再」）；上次的改动被撤回了才重新执行
        // 只有「再执行一次结果也一样」才算重复：上次执行完以后错题 / 作答 / 计划 / 提醒 / 阶段都没变（state_fp 相同）；数据变了就重新执行
        const fp = await this.stateFp(u.id);
        // 问题（「那今天的单词还背吗」）不去重：每次都按当时的数据回答
        const dup0 = questionKind(b.text!) ? null : await this.recentSame(u.id, norm, commandId, b.question_id, today0);
        const dup = dup0 && (!dup0.result?.state_fp || dup0.result.state_fp === fp) ? dup0 : null;
        if (dup) {
          const text = await this.earlyNote(u.id, await this.duplicateText(u.id, dup, b.text!), b.text!); // 凌晨 0–4 点补一句「还算前一天」（每个学习日只说一次）
          const step = { command_id: commandId, text };
          events.push({ event: 'step', data: step }); sse.send('step', step);
          const done = { command_id: commandId, summary: text, mock: dup.result?.mock ?? true, reply: text, action_count: 0, deduped: true, duplicate_of: dup.result?.duplicate_of ?? dup.id,
            date: dup.result?.date ?? null, quantity_from: null, quantity_to: null };
          const saved = { ...done, state_fp: fp };
          sse.send('done', done);
          await this.db.query(`UPDATE agent_commands SET status='done', events=$2, result=$3, finished_at=now() WHERE id=$1`, [commandId, ph(events), ph(saved)]);
          return;
        }
        const r = await this.coach.runCommand(u.id, commandId, b.text!, (event, data) => { events.push({ event, data }); sse.send(event, data); }, { question_id: b.question_id });
        r.reply = (await this.earlyNote(u.id, r.reply ?? '', b.text!)) || r.reply; // 凌晨 0–4 点补一句「还算前一天」（每个学习日只说一次）
        const done = { command_id: commandId, summary: r.summary, mock: r.mode === 'mock', reply: r.reply, action_count: r.actions.length, deduped: !!r.deduped, date: r.date ?? null,
          quantity_from: r.quantity_from ?? null, quantity_to: r.quantity_to ?? null, question_id: b.question_id ?? null, ...(r.question_kind ? { question_kind: r.question_kind } : {}) };
        sse.send('done', done);
        // 执行完以后的数据指纹（不发给前端）：下一句同样的话来时比对，数据没变才算重复
        await this.db.query(`UPDATE agent_commands SET status='done', events=$2, result=$3, finished_at=now() WHERE id=$1`, [commandId, ph(events), ph({ ...done, state_fp: await this.stateFp(u.id) })]);
      } catch (e: any) {
        sse.send('error', { command_id: commandId, message: e.message });
        await this.db.query(`UPDATE agent_commands SET status='error', events=$2, result=$3, finished_at=now() WHERE id=$1`, [commandId, ph(events), JSON.stringify({ error: e.message })]).catch(() => {});
      }
    }).catch(() => undefined);
    sse.end();
  }

  /** 命令会读 / 改的数据的指纹：错题本、作答、最近的计划任务、提醒、阶段。同一句话前后指纹一样 → 再执行结果也一样 */
  private async stateFp(userId: string): Promise<string> {
    return (await this.db.one(
      `SELECT md5(concat_ws('|',
         (SELECT string_agg(id::text || ':' || status || ':' || COALESCE(wrong_count,0) || ':' || COALESCE(updated_at::text,''), ',' ORDER BY id) FROM wrong_questions WHERE user_id=$1),
         (SELECT count(*) || ':' || COALESCE(max(created_at)::text,'') FROM answer_records WHERE user_id=$1),
         (SELECT string_agg(t.id::text || ':' || t.status || ':' || t.payload::text || ':' || t.updated_at::text, ',' ORDER BY t.id) FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id
            WHERE p.user_id=$1 AND p.plan_date >= now()::date - 2),
         (SELECT count(*) || ':' || COALESCE(max(updated_at)::text,'') FROM reminders WHERE user_id=$1),
         (SELECT COALESCE(phase,'') FROM users WHERE id=$1),
         (SELECT count(*) || ':' || COALESCE(max(undone_at)::text,'') FROM agent_actions WHERE user_id=$1 AND undone_at IS NOT NULL))) fp`, [userId]))?.fp ?? '';
  }

  /** 60 秒内同一句话、已执行完、改动没被撤回、（在题目上说的）同一道题 → 返回上一次命令 */
  /** 去重只看同一学习日、按「有效的现在」（X-Debug-Now 也算）60 秒内的同一句话；换了学习日一律重新执行 */
  private async recentSame(userId: string, norm: string, selfId: string, questionId: string | undefined, studyDay: string) {
    return this.db.one(
      `SELECT c.id, c.result, extract(epoch FROM $7::timestamptz - c.eff_at)::int secs FROM agent_commands c
        WHERE c.user_id=$1 AND c.norm_text=$2 AND c.id<>$3 AND c.status='done' AND c.study_date = $6::date
          AND c.eff_at > $7::timestamptz - make_interval(secs => $4) AND c.eff_at <= $7::timestamptz + interval '5 seconds'
          AND COALESCE(c.result->>'question_id','') = $5
          AND NOT EXISTS (SELECT 1 FROM agent_actions a WHERE a.command_id=c.id AND a.undone_at IS NOT NULL)
        ORDER BY c.created_at DESC LIMIT 1`,
      [userId, norm, selfId, Number(process.env.AGENT_DEDUPE_SECONDS || 60), questionId ?? '', studyDay, clockNow()]);
  }

  /** 重复提示：说清上次做了什么、现在计划里是什么，问要不要再加 */
  /** 凌晨 0–4 点、回复涉及今天 / 明天 / 昨天、这个学习日还没说过 → 末尾补「凌晨 4 点前还算 MM-DD 这一天。」 */
  private async earlyNote(userId: string, reply: string, command: string) {
    if (!wantsEarlyNote(reply, command)) return reply;
    return appendNote(reply, await this.time.earlyNoteOnce(userId));
  }

  private async duplicateText(userId: string, dup: any, text: string) {
    // 第三次、第四次重复：追到最初真正执行的那条命令
    const orig = dup.result?.duplicate_of ? (await this.db.one('SELECT id, result FROM agent_commands WHERE id=$1', [dup.result.duplicate_of])) ?? dup : dup;
    const r = orig.result ?? {};
    const date = r.date as string | null;
    const parts = [`${dup.secs < 5 ? '刚刚' : `${dup.secs} 秒前`}说过同样的话`];
    if (r.quantity_from > 0 && r.quantity_to != null) parts.push(`刚才已从 ${r.quantity_from} 道${/加|再|多|补/.test(text) ? '加到' : '改为'} ${r.quantity_to} 道`);
    const task = (await this.db.one(
      `SELECT t.title FROM agent_actions a JOIN plan_tasks t ON t.id::text=a.target_id::text WHERE a.command_id=$1 AND a.target_kind='plan_task' ORDER BY a.created_at LIMIT 1`, [orig.id]))?.title;
    if (task && date) parts.push(`${dayLabel(date, await this.time.today(userId))}的计划里已经有「${task}」`); // 相对学习日说今天 / 明天
    else if (r.reply) parts.push(`上次：${clause(renderDates(String(r.reply), await this.time.today(userId))).slice(0, 60)}`);
    const n = parseCount(text);
    const more = /加|再|多|补|错题|题/.test(text) ? `。还要再加的话，回「确认再加${n ? ` ${n} 道` : ''}」` : '';
    return `${parts.map(clause).join('，')}，这次没有重复执行${more}`;
  }

  /** 主动消息（夜间复盘 review / 周报 weekly）：headline 是唯一要展示的一句，details 默认折叠 */
  @Get('messages')
  async messages(@CurrentUser() u: AuthUser, @Query('limit') limit = '20') {
    const today = await this.time.today(u.id);
    const items = (await this.db.query(
      `SELECT id, kind, to_char(tip_date,'YYYY-MM-DD') date, COALESCE(headline, text) headline, details, source, delivered_at, seen_at, proposal
         FROM daily_tips WHERE user_id=$1 AND kind IN ('review','weekly','exam_review','nudge','proposal') AND delivered_at <= $3
        ORDER BY tip_date DESC, kind, created_at DESC LIMIT $2`, [u.id, Math.min(Number(limit) || 20, 100), clockNow()])).rows
      .map((i: any) => (i.kind === 'proposal' && i.proposal ? withView(i, proposalView(i.proposal, i, today)) : { ...i, status: null })) // 确认 / 忽略后标题改成过去时（老数据读时也套）
      .map((i: any) => ({ ...i, relative_day: relativeDay(i.date, today) })); // 消息日期相对学习日的叫法
    // 免打扰时段里产生的消息：delivered_at 在将来，先不给，只告诉前端排着几条、几点送达
    const q = await this.db.one(`SELECT count(*)::int n, min(delivered_at) next_at FROM daily_tips WHERE user_id=$1 AND kind IN ('review','weekly','exam_review','nudge','proposal') AND delivered_at > $2`, [u.id, clockNow()]);
    const p = (await this.db.one('SELECT proactive FROM users WHERE id=$1', [u.id]))?.proactive;
    return { items, unseen: items.filter((i: any) => !i.seen_at).length, queued: q?.n ?? 0, next_delivery_at: q?.next_at ?? null, proactive: p };
  }

  /** 学生打开/看到了这条主动消息。少打扰模式是因为「没打开」自动触发的，看到后恢复每晚复盘（记一条可撤回的 action） */
  /** coach_frequency=ask 时教练的待确认建议：确认（可只选部分 items 下标）→ 按建议执行并记可撤回的 AgentAction（trigger=confirm）；忽略 → 不改 */
  @Post('messages/:id/confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { items?: number[] }) { return this.decide(u, id, 'confirm', b?.items); }

  @Post('messages/:id/dismiss')
  @HttpCode(200)
  async dismiss(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.decide(u, id, 'dismiss'); }

  private async decide(u: AuthUser, id: string, d: 'confirm' | 'dismiss', items?: number[]) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException({ message: '没有这条待确认的建议，刷新一下再试', code: 'proposal_not_found' });
    if (items !== undefined && !Array.isArray(items)) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: '没选中要执行的改动，请刷新后再试', field: 'items', code: 'invalid_items' });
    const r = await this.jobs.decideProposal(u.id, id, d, items);
    if (r.status === 404) throw new NotFoundException({ message: '没有这条待确认的建议，刷新一下再试', code: 'proposal_not_found' });
    if (r.status === 410) throw new ConflictException({ message: '这条建议已经过期了，计划没动；还需要的话直接跟教练说一声', detail: '建议的日子已经过去了，不能再确认', code: 'proposal_expired', target_date: r.target_date, proposal: { ...r.proposal, status: 'expired' } });
    if (r.status === 409) throw new ConflictException({ message: '这条建议已经处理过了', detail: `之前已经${r.proposal.status === 'confirmed' ? '确认' : '忽略'}了，不会重复执行`, code: 'already_decided', proposal: r.proposal });
    if (r.status === 400) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: '选中的改动不存在，请刷新后再试', field: 'items', code: 'invalid_items' });
    return { proposal: r.proposal, actions: r.actions, message: r.message };
  }

  @Post('messages/:id/seen')
  @HttpCode(200)
  async seen(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.db.one(`UPDATE daily_tips SET seen_at=COALESCE(seen_at, now()) WHERE id=$1 AND user_id=$2 RETURNING id, kind, seen_at`, [id, u.id]);
    if (!r) throw new NotFoundException({ message: '这条消息不存在，刷新一下再试', code: 'message_not_found' });
    const p = (await this.db.one('SELECT proactive FROM users WHERE id=$1', [u.id]))?.proactive;
    let restored: any = null;
    if (p?.mode === 'reduced' && p?.cause === 'ignored') {
      restored = await this.tools.setProactive({ userId: u.id, commandId: null, trigger: 'event' }, { mode: 'normal', reason: '你又开始看复盘了，恢复每晚复盘', cause: 're_engaged' });
    }
    return { ...r, proactive_restored: !!restored?.changed };
  }

  @Get('actions')
  async list(@CurrentUser() u: AuthUser, @Query('limit') limit = '30', @Query('include_undone') inc = 'true', @Query('flat') flat?: string) {
    return { items: await this.actions.list(u.id, Math.min(Number(limit) || 30, 200), inc !== 'false', ['1', 'true'].includes(String(flat ?? ''))) };
  }

  @Post('actions/:id/undo')
  @HttpCode(200)
  undo(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.actions.undo(u.id, id); }

  /** 定时任务的排期（时区、下次运行时间） */
  @Get('jobs')
  listJobs() { return this.jobs.describe(); }

  /**
   * 开发 / 测试用：强制给当前用户跑一次定时任务（规则版，不调模型，不看少打扰 / 频率 / 免打扰，消息立刻送达）。
   * coach_frequency=ask 时一定会生成一条待确认的建议（数据里没有可改的就给演示改动）。
   * 只在 NODE_ENV≠production 或 DEV_TOOLS=1 时可用，否则 404。
   */
  @Post('jobs/run')
  @HttpCode(200)
  async devRunJob(@CurrentUser() u: AuthUser, @Body() b: { job?: string; force?: boolean }) {
    const devOn = process.env.NODE_ENV !== 'production' || ['1', 'true'].includes(String(process.env.DEV_TOOLS ?? '').toLowerCase());
    if (!devOn) throw new NotFoundException('Cannot POST /api/v1/agent/jobs/run');
    const job = b?.job ?? 'nightly';
    if (!JOB_NAMES.includes(job as any)) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: `只能触发 ${JOB_NAMES.join(' / ')}`, field: 'job', code: 'invalid_job' });
    if (b?.force === false) return this.jobs.runForUser(job as any, u.id, true, false);
    return { ...(await this.jobs.devRun(job as any, u.id)), dev: true };
  }

  /** 手动给当前用户跑一次定时任务（调试/联调用；不受「一天一次」限制） */
  @Post('jobs/:job/run')
  @HttpCode(200)
  async runJob(@CurrentUser() u: AuthUser, @Param('job') job: string, @Query('respect_backoff') rb?: string) {
    if (!JOB_NAMES.includes(job as any)) throw new BadRequestException(`job 只能是 ${JOB_NAMES.join('/')}`);
    return this.jobs.runForUser(job as any, u.id, true, ['1', 'true'].includes(String(rb ?? '')));
  }
}
