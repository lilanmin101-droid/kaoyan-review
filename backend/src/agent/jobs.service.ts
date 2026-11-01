import { proposalExpired, proposalTargetDate, proposalView } from './proposal-view';
import { randomUUID } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DbService } from '../db/db.service';
import { appTz, dayLabel } from '../common/time';
import { UserTimeService } from '../common/user-time.service';
import { coachFrequency, LESS_EVERY_DAYS } from '../common/reminders';
import { aiMode } from '../ai/llm';
import { AgentToolsService, PHASE_CN, ToolCtx } from './agent-tools.service';
import { CoachService, dayGreeting, laterToday, RunResult } from './coach.service';

export const JOB_NAMES = ['nightly', 'weekly', 'phase_check', 'midday'] as const;
export type JobName = (typeof JOB_NAMES)[number];

/**
 * cron 表达式（秒 分 时 日 月 周）。默认每小时触发一次，再按「每个用户自己的时区」挑到点的用户
 * （用户 23:00 → 夜间复盘，周日 21:30 → 周报，04:10 → 阶段检查：学习日 04:00 换天，换天后再算距考试天数）；设置了 JOB_*_CRON 就按 APP_TZ 给所有人跑。
 */
const LOCAL_AT: Record<JobName, { hour: number; minute: number; weekday?: number }> = { nightly: { hour: 23, minute: 0 }, weekly: { hour: 21, minute: 30, weekday: 0 }, phase_check: { hour: 4, minute: 10 }, midday: { hour: 12, minute: 30 } };
/** 能改东西的写类工具（coach_frequency=ask 时只记建议，确认后按 input 重放） */
const CONFIRMABLE = ['updateDailyPlan', 'addReviewCard', 'upsertReminder', 'switchPhase'] as const;
const SCHEDULE: Record<JobName, { cron: string; desc: string; perUserTz: boolean }> = {
  nightly: { cron: process.env.JOB_NIGHTLY_CRON || '0 0 * * * *', perUserTz: !process.env.JOB_NIGHTLY_CRON, desc: '每晚 23:00（用户时区）当日复盘 + 生成明日任务' },
  weekly: { cron: process.env.JOB_WEEKLY_CRON || '0 30 * * * *', perUserTz: !process.env.JOB_WEEKLY_CRON, desc: '每周日 21:30（用户时区）周报 + 下周一计划' },
  phase_check: { cron: process.env.JOB_PHASE_CRON || '0 10 * * * *', perUserTz: !process.env.JOB_PHASE_CRON, desc: '每天 04:10（用户时区，学习日 04:00 换天后）按距考试天数检查阶段切换' },
  midday: { cron: process.env.JOB_MIDDAY_CRON || '0 30 * * * *', perUserTz: !process.env.JOB_MIDDAY_CRON, desc: '每天 12:30（用户时区）中午进度提醒，只发给 coach_frequency=more 的用户' },
};

/**
 * 建议去重用的「已经有了」集合，窗口 = 今天起 7 天（DEDUPE_DAYS）：窗口内计划里已有的任务、今天所有建议（含已忽略）、
 * 最近的待确认 / 已确认建议里目标日在窗口内的改动。计划任务按 类型|目标 比（不分哪天：11-02 排过的 11-01 不再提）；
 * 重做错题按题目集合（全被已有的覆盖就算重复）；演示热身（payload.demo）一次就够。
 */
export const DEDUPE_DAYS = 7;
/** 为什么算「已经有了」：planned = 计划里有 / 已确认，pending = 还有一条待确认的建议，dismissed = 你忽略过 */
export type SeenSrc = 'planned' | 'pending' | 'dismissed';
const SRC_RANK: Record<SeenSrc, number> = { dismissed: 1, pending: 2, planned: 3 };
export type Seen = { keys: Set<string>; redo: Map<string, Set<string>>; demo: boolean; from?: string; to?: string; src: Map<string, SeenSrc> };
export const newSeen = (from?: string, to?: string): Seen => ({ keys: new Set(), redo: new Map(), demo: false, from, to, src: new Map() });
const mark = (seen: Seen, k: string, src: SeenSrc) => { const o = seen.src.get(k); if (!o || SRC_RANK[src] > SRC_RANK[o]) seen.src.set(k, src); };
const inWindow = (seen: Seen, date: string) => (!seen.from || date >= seen.from) && (!seen.to || date <= seen.to);
const stable = (x: any): string => Array.isArray(x) ? `[${x.map(stable).join(',')}]` : x && typeof x === 'object'
  ? `{${Object.keys(x).filter((k) => !['reason', 'why', 'why_changed'].includes(k)).sort().map((k) => `${k}:${stable(x[k])}`).join(',')}}` : JSON.stringify(x);
const taskTarget = (t: any) => { const p = t.payload ?? {}; return p.kp_path ?? (p.count != null ? `count:${p.count}` : t.title ?? ''); };
export function addSeenTask(seen: Seen, date: string, t: any, src: SeenSrc = 'planned') {
  const p = t.payload ?? {};
  if (!inWindow(seen, date)) return;
  if (p.demo) { seen.demo = true; mark(seen, 'demo', src); return; }
  if (t.kind === 'redo_wrong' && Array.isArray(p.question_ids)) {
    const k = 'redo'; const set = seen.redo.get(k) ?? new Set<string>();
    p.question_ids.forEach((q: string) => { set.add(q); mark(seen, `redo:${q}`, src); }); seen.redo.set(k, set); return;
  }
  const k = `${t.kind}|${taskTarget(t)}`;
  seen.keys.add(k); mark(seen, k, src);
}
export function addSeenItem(seen: Seen, it: { tool: string; input: any }, src: SeenSrc = 'planned') {
  if (it.tool === 'updateDailyPlan' && it.input?.date) for (const t of it.input.add_tasks ?? []) addSeenTask(seen, it.input.date, t, src);
  else { const k = `${it.tool}|${stable(it.input)}`; seen.keys.add(k); mark(seen, k, src); }
}
/** 重复的改动是因为什么（可能几种都有）；不重复 → 空 */
export function dupSources(seen: Seen, it: { tool: string; input: any }): SeenSrc[] {
  if (!isDupItem(seen, it)) return [];
  const out = new Set<SeenSrc>();
  const add = (k: string) => out.add(seen.src.get(k) ?? 'planned');
  if (it.tool !== 'updateDailyPlan') add(`${it.tool}|${stable(it.input)}`);
  else for (const t of it.input?.add_tasks ?? []) {
    const p = t.payload ?? {};
    if (p.demo) add('demo');
    else if (t.kind === 'redo_wrong' && Array.isArray(p.question_ids)) p.question_ids.forEach((q: string) => add(`redo:${q}`));
    else add(`${t.kind}|${taskTarget(t)}`);
  }
  return [...out];
}
/** 没出建议时说清原因：忽略过的 / 计划里已有的 / 还在等确认的分开说；什么改动都没想出来才是「该有的都有了」 */
export function skipReason(why: SeenSrc[][]): { code: 'dismissed' | 'planned' | 'pending' | 'mixed' | 'nothing'; text: string } {
  const n = { dismissed: 0, planned: 0, pending: 0 } as Record<SeenSrc, number>;
  // 一处改动同时有几种原因时，按 忽略过 > 等确认 > 计划里有 算一种（学生最关心「我忽略的会不会又冒出来」）
  for (const w of why) if (w.length) n[w.includes('dismissed') ? 'dismissed' : w.includes('pending') ? 'pending' : 'planned']++;
  const kinds = (Object.keys(n) as SeenSrc[]).filter((k) => n[k]);
  const pre = '没有新的建议：';
  if (!kinds.length) return { code: 'nothing', text: `${pre}计划里该有的都有了，这次不打扰你` };
  if (kinds.length === 1) {
    const k = kinds[0], c = n[k];
    return { code: k, text: pre + (k === 'dismissed' ? `${c > 1 ? `这 ${c} 条` : '这条'}你已经忽略过了，不再提`
      : k === 'pending' ? `同样的建议还在等你确认，不重复提` : `想做的${c > 1 ? ` ${c} 处` : ''}改动计划里已经有了，不重复提`) };
  }
  const parts = [n.dismissed && `${n.dismissed} 条你已经忽略过了`, n.pending && `${n.pending} 条还在等你确认`, n.planned && `${n.planned} 条计划里已经有了`].filter(Boolean);
  return { code: 'mixed', text: `${pre}${parts.join('，')}，都不再提` };
}
/** 这条改动是不是已经有了（全部 add_tasks 都重复、也没有别的改动） */
export function isDupItem(seen: Seen, it: { tool: string; input: any }) {
  if (it.tool !== 'updateDailyPlan') return seen.keys.has(`${it.tool}|${stable(it.input)}`);
  const adds = it.input?.add_tasks ?? [];
  if (!adds.length || (it.input?.update_tasks ?? []).length) return false;
  return adds.every((t: any) => {
    const p = t.payload ?? {};
    if (p.demo) return seen.demo;
    if (t.kind === 'redo_wrong' && Array.isArray(p.question_ids)) { const set = seen.redo.get('redo'); return !!set && p.question_ids.every((q: string) => set.has(q)); }
    return seen.keys.has(`${t.kind}|${taskTarget(t)}`);
  });
}

/** 试算出来的 action summary（过去时「加了…」）→ 建议文案（「想…」，还没执行）。附带的「更新了计划的说明」不单独列 */
export function intentSummary(summaries: string[]) {
  const main = summaries.filter((x) => !/^更新了 \S+ 计划的说明$/.test(x));
  const one = (x: string) => {
    let m: RegExpMatchArray | null;
    if ((m = x.match(/^在 (\S+) 的计划里加了「(.+)」$/))) return `想在 ${m[1]} 的计划里加「${m[2]}」`;
    if ((m = x.match(/^(\S+)「(.+)」已从 (\d+) 道(加到|改为) (\d+) 道$/))) return `想把 ${m[1]} 的「${m[2]}」从 ${m[3]} 道${m[4]} ${m[5]} 道`;
    if ((m = x.match(/^(\S+)：先跳过「(.+)」$/))) return `想先跳过 ${m[1]} 的「${m[2]}」`;
    if ((m = x.match(/^(\S+)：调整了「(.+)」$/))) return `想调整 ${m[1]} 的「${m[2]}」`;
    if ((m = x.match(/^(\S+) 已有「(.+?)」，(恢复成待做|更新为「.+」)/))) return `想把 ${m[1]} 的「${m[2]}」${m[3]}`;
    if ((m = x.match(/^(\S+) 恢复「(.+)」$/))) return `想恢复 ${m[1]} 的「${m[2]}」`;
    if ((m = x.match(/^把 (.+)$/))) return `想把 ${m[1]}`;
    if ((m = x.match(/^(改了|写了) (.+)$/))) return `想${m[1][0]} ${m[2]}`;
    if ((m = x.match(/^复习阶段从(.+)$/))) return `想把复习阶段从${m[1]}`;
    if ((m = x.match(/^(.+) 记为「粗心」/))) return `想把 ${m[1]} 记为「粗心」`;
    if ((m = x.match(/^更新了 (\S+) 计划的说明$/))) return `想更新 ${m[1]} 计划的说明`;
    return `想：${x}`;
  };
  return (main.length ? main : summaries).map(one).join('；');
}

export const FORCED_MARK = '（测试触发）';
/**
 * 定时消息 / 建议的 reason：按用户真实设置写，不冒用别的频率的文案。
 * forced（开发用强制触发）一律写中性说明 +「（测试触发）」，不提提醒频率。
 */
export function jobReason(job: JobName | 'proposal', s: { freq: string; reducedEvery?: number | null; forced?: boolean }) {
  if (s.forced) return ({ nightly: '当日复盘', weekly: '本周周报', midday: '看一眼今天的进度', phase_check: '按距考试天数检查复习阶段', proposal: '教练只提建议，确认后才改' } as Record<string, string>)[job] + FORCED_MARK;
  switch (job) {
    case 'nightly': return s.reducedEvery ? `少打扰模式：每 ${s.reducedEvery} 天自动复盘一次` : s.freq === 'less' ? `提醒频率选了「少」：每 ${LESS_EVERY_DAYS} 天自动复盘一次` : '每晚 23:00 自动复盘';
    case 'weekly': return '每周日 21:30 自动周报';
    case 'midday': return s.freq === 'more' ? '提醒频率选了「多」：中午看一眼进度' : '中午看一眼今天的进度';
    case 'phase_check': return '按距考试天数检查复习阶段';
    default: return s.freq === 'ask' ? '你选了「先问我」：教练只提建议，确认后才改' : '教练只提建议，确认后才改';
  }
}

/** 距考试天数 → 阶段（只往前切，不自动回退） */
export function phaseFor(daysLeft: number) {
  const sprint = Number(process.env.PHASE_SPRINT_DAYS || 30);
  const intensive = Number(process.env.PHASE_INTENSIVE_DAYS || 180);
  return daysLeft <= sprint ? 'sprint' : daysLeft <= intensive ? 'intensive' : 'foundation';
}
const ORDER = ['foundation', 'intensive', 'sprint'];

@Injectable()
export class JobsService implements OnModuleInit {
  private log = new Logger('Jobs');
  constructor(private db: DbService, private registry: SchedulerRegistry, private coach: CoachService, private tools: AgentToolsService, private time: UserTimeService) {}

  enabled() { return !['0', 'false', 'no'].includes(String(process.env.JOBS_ENABLED ?? '1').toLowerCase()); }

  onModuleInit() {
    if (!this.enabled()) { this.log.log('定时任务已关闭（JOBS_ENABLED=0）'); return; }
    for (const name of JOB_NAMES) {
      const job = CronJob.from({ cronTime: SCHEDULE[name].cron, timeZone: appTz(), onTick: () => { void this.runAll(name); }, start: true });
      this.registry.addCronJob(`kaoyan:${name}`, job as any);
    }
    this.log.log(`定时任务已启动（时区 ${appTz()}，模式 ${aiMode()}）：${JOB_NAMES.map((n) => `${n}=${SCHEDULE[n].cron}`).join('，')}`);
  }

  describe() {
    return {
      enabled: this.enabled(), timezone: appTz(), per_user_timezone: true, mode: aiMode(),
      jobs: JOB_NAMES.map((n) => {
        let next: string | null = null;
        try { next = (this.registry.getCronJob(`kaoyan:${n}`) as any).nextDate().toISO(); } catch { /* 未启动 */ }
        return { name: n, cron: SCHEDULE[n].cron, description: SCHEDULE[n].desc, next_run_at: next };
      }),
    };
  }

  /** 给所有用户跑一遍（同一天同一任务每人只跑一次） */
  async runAll(job: JobName) {
    const users = (await this.db.query('SELECT id FROM users ORDER BY created_at')).rows;
    let ok = 0, fail = 0, skipped = 0;
    for (const u of users) {
      try {
        if (SCHEDULE[job].perUserTz) {
          const n = await this.time.now(u.id), at = LOCAL_AT[job];
          if (n.hour !== at.hour || (at.weekday != null && n.weekday !== at.weekday)) continue; // 这个用户还没到点（免打扰不改运行时间，只把消息排到时段结束再送达）
        }
        const r = await this.runForUser(job, u.id, false);
        if (r.skipped) skipped++; else ok++;
      } catch (e: any) { fail++; this.log.error(`${job} ${u.id}: ${e.message}`); }
    }
    this.log.log(`${job}: ok=${ok} skipped=${skipped} failed=${fail}`);
  }

  /**
   * 少打扰：夜间复盘前检查。连续 2 次复盘都没打开（seen_at 为空）→ 自动改成每 3 天一次（记可撤回的 agent_action）；
   * 已是少打扰模式 → 距上次复盘不到 N 天就跳过。周报不受影响。只会调低，不会加码。
   */
  async proactiveGate(userId: string): Promise<{ skip: boolean; reason?: string; actions: any[] }> {
    const collected: any[] = [];
    const ctx: ToolCtx = { userId, commandId: null, trigger: 'nightly', onAction: (a) => { collected.push(a); } };
    let p = (await this.db.one('SELECT proactive FROM users WHERE id=$1', [userId]))?.proactive ?? { mode: 'normal', nightly_every_days: 1 };
    const last = (await this.db.query(
      `SELECT to_char(tip_date,'YYYY-MM-DD') d, seen_at FROM daily_tips WHERE user_id=$1 AND kind='review' AND delivered_at IS NOT NULL ORDER BY tip_date DESC LIMIT 2`, [userId])).rows;
    if (p.mode !== 'reduced' && last.length === 2 && last.every((r: any) => !r.seen_at)) {
      await this.tools.setProactive(ctx, { mode: 'reduced', every_days: 3, reason: `${last.map((r: any) => r.d.slice(5)).reverse().join('、')}这两次复盘你都没打开，先少打扰：改成每 3 天一次，周报照常`, cause: 'ignored' });
      p = { mode: 'reduced', nightly_every_days: 3 };
    }
    if (p.mode === 'reduced' && last.length) {
      const gap = Math.round((Date.parse(await this.time.today(userId)) - Date.parse(last[0].d)) / 86400000);
      if (gap < Number(p.nightly_every_days || 3)) return { skip: true, reason: `少打扰模式：每 ${p.nightly_every_days} 天复盘一次，上次是 ${last[0].d}`, actions: collected };
    }
    return { skip: false, actions: collected };
  }

  private async settings(userId: string) {
    return (await this.db.one(`SELECT settings FROM users WHERE id=$1`, [userId]))?.settings ?? {};
  }

  /**
   * 「我的」页的 coach_frequency：less → 夜间复盘每 3 天一次；more → 多一条中午提醒（其余频率不发中午提醒）。
   * 「别管我」/ 没打开的自动少打扰（proactiveGate）叠加在上面，少打扰时中午提醒也不发。免打扰不在这里拦，而是把消息 delivered_at 排到时段结束。
   */
  async reminderGate(job: JobName, userId: string): Promise<{ skip: boolean; reason?: string }> {
    const freq = coachFrequency(await this.settings(userId));
    if (job === 'midday') {
      if (freq !== 'more') return { skip: true, reason: `中午提醒只在提醒频率选「多」（coach_frequency=more）时发，现在是 ${freq}` };
      const p = (await this.db.one('SELECT proactive FROM users WHERE id=$1', [userId]))?.proactive;
      if (p?.mode === 'reduced') return { skip: true, reason: '少打扰模式中，中午提醒先不发' };
    }
    if (job === 'nightly' && freq === 'less') {
      const last = await this.db.one(`SELECT to_char(tip_date,'YYYY-MM-DD') d FROM daily_tips WHERE user_id=$1 AND kind='review' AND delivered_at IS NOT NULL ORDER BY tip_date DESC LIMIT 1`, [userId]);
      if (last) {
        const gap = Math.round((Date.parse(await this.time.today(userId)) - Date.parse(last.d)) / 86400000);
        if (gap < LESS_EVERY_DAYS) return { skip: true, reason: `提醒频率是「少」：每 ${LESS_EVERY_DAYS} 天复盘一次，上次是 ${last.d}` };
      }
    }
    return { skip: false };
  }

  /** 窗口（今天起 DEDUPE_DAYS 天）内：今天所有建议 + 最近待确认 / 已确认的建议 + 计划任务（不含已跳过的）→ Seen */
  private async loadSeen(userId: string): Promise<Seen> {
    const today = await this.time.today(userId);
    const to = new Date(Date.parse(today) + DEDUPE_DAYS * 86400000).toISOString().slice(0, 10);
    const seen = newSeen(today, to);
    const props = (await this.db.query(
      `SELECT proposal FROM daily_tips WHERE user_id=$1 AND kind='proposal' AND proposal IS NOT NULL
        AND (tip_date=$2::date OR (tip_date >= $2::date - $3::int AND proposal->>'status' IN ('pending','confirmed')))`, [userId, today, DEDUPE_DAYS])).rows;
    for (const r of props) {
      const st = r.proposal.status;
      // 确认过的：确认执行的那几处算「计划里有」，没选的算忽略
      const applied: number[] | null = Array.isArray(r.proposal.applied_items) ? r.proposal.applied_items : null;
      (r.proposal.items ?? []).forEach((it: any, i: number) => addSeenItem(seen, it,
        st === 'pending' ? 'pending' : st === 'confirmed' ? (!applied || applied.includes(i) ? 'planned' : 'dismissed') : 'dismissed'));
    }
    const tasks = (await this.db.query(
      `SELECT to_char(p.plan_date,'YYYY-MM-DD') date, t.kind, t.title, t.payload FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id
        WHERE p.user_id=$1 AND p.plan_date BETWEEN $2::date AND $3::date AND t.status<>'skipped'`, [userId, today, to])).rows;
    for (const t of tasks) addSeenTask(seen, t.date, t);
    return seen;
  }

  /** 去掉已经有了的改动（就地改 proposals），返回去掉了几条 */
  private dropDup(proposals: { tool: string; input: any; summaries: string[] }[], seen: Seen, why: SeenSrc[][] = []) {
    let dropped = 0;
    for (let k = proposals.length - 1; k >= 0; k--) {
      const p = proposals[k];
      if (!(CONFIRMABLE as readonly string[]).includes(p.tool)) continue;
      // 算了一遍但什么都没改（summaries 空）= 目标日计划里已经有了（含刚确认执行进计划的）→ 算「计划里有」，不是「没想出改动」
      if (!p.summaries.length) { why.push(['planned']); continue; }
      if (isDupItem(seen, p)) { why.push(dupSources(seen, p)); proposals.splice(k, 1); dropped++; }
    }
    for (const p of proposals) if ((CONFIRMABLE as readonly string[]).includes(p.tool) && p.summaries.length) addSeenItem(seen, p); // 同一次里也不重复
    return dropped;
  }

  /**
   * coach_frequency=ask：把这次任务想做的改动记成一条「新的」待确认建议消息（kind=proposal）。
   * 每次任务运行都新建一条，不合并、不改已有的（已确认 / 已忽略的建议永远不会被翻回 pending）。
   * 文案用「想…」（还没执行）；确认后执行时的 action summary 才是「加了…」。
   */
  private async saveProposals(userId: string, job: JobName, proposals: { tool: string; input: any; summaries: string[] }[], deliverNow = false, groupId?: string, forced = false) {
    const items = proposals.filter((p) => p.summaries.length && (CONFIRMABLE as readonly string[]).includes(p.tool))
      .map((p) => ({ tool: p.tool, input: p.input, summary: intentSummary(p.summaries), job }));
    if (!items.length) return null;
    const today = await this.time.today(userId);
    const ctx: ToolCtx = { userId, commandId: null, groupId: groupId ?? randomUUID(), trigger: job === 'midday' ? 'midday' : job, onAction: () => {}, deliverNow };
    const proposal = { status: 'pending', items, created_at: new Date().toISOString(), ...(forced ? { forced: true } : {}) };
    const r = await this.tools.writeDailyTip(ctx, { kind: 'proposal', date: today, source: 'agent', reason: jobReason('proposal', { freq: 'ask', forced }),
      text: `教练想做 ${items.length} 处改动，等你确认后才执行：${items.map((x) => x.summary).join('；')}`.slice(0, 300),
      details: forced ? '这是测试触发的建议，这些改动还没执行。点确认才会改；不需要就忽略。' : '你在「我的」里选了「先问我」，这些改动还没执行。点确认才会改；不需要就忽略。', proposal });
    return { message_id: r.tip_id, items };
  }

  /** 用户确认 / 忽略教练的建议（POST /agent/messages/:id/confirm | dismiss）。confirm 可只选部分 items（下标） */
  async decideProposal(userId: string, messageId: string, decision: 'confirm' | 'dismiss', pick?: number[]) {
    const row = await this.db.one(`SELECT id, proposal, to_char(tip_date,'YYYY-MM-DD') date FROM daily_tips WHERE id=$1 AND user_id=$2 AND kind='proposal'`, [messageId, userId]);
    if (!row?.proposal) return { status: 404 as const };
    const pr = row.proposal;
    if (pr.status !== 'pending') return { status: 409 as const, proposal: pr };
    // 目标日已经过了（按读者此刻的学习日，X-Debug-Now 也算）→ 过期：确认返回 409 proposal_expired，什么都不改；忽略照常可以
    if (decision === 'confirm' && proposalExpired(pr, row.date, await this.time.today(userId))) return { status: 410 as const, proposal: pr, target_date: proposalTargetDate(pr, row.date) };
    const chosen: number[] = decision === 'dismiss' ? [] : pick?.length ? pick : pr.items.map((_: any, k: number) => k);
    if (chosen.some((k) => !Number.isInteger(k) || k < 0 || k >= pr.items.length)) return { status: 400 as const, proposal: pr };
    const collected: any[] = [];
    const ctx: ToolCtx = { userId, commandId: null, groupId: randomUUID(), trigger: 'confirm', onAction: (a) => { collected.push(a); } };
    for (const k of chosen) {
      const it = pr.items[k];
      if (!(CONFIRMABLE as readonly string[]).includes(it.tool)) continue;
      await (this.tools as any)[it.tool](ctx, it.input);
    }
    const next = { ...pr, status: decision === 'dismiss' ? 'dismissed' : 'confirmed', decided_at: new Date().toISOString(), applied_items: chosen, action_ids: collected.map((a) => a.id) };
    const v = proposalView(next);
    await this.db.query(`UPDATE daily_tips SET proposal=$2::jsonb, headline=$3, text=$3, details=$4, seen_at=COALESCE(seen_at, now()), updated_at=now() WHERE id=$1`, [row.id, JSON.stringify(next), v.headline, v.details]);
    return { status: 200 as const, proposal: next, actions: collected, message: { id: row.id, ...v } };
  }

  /** 中午提醒（coach_frequency=more）：规则版，一句话说今天计划进度 */
  private async midday(userId: string, deliverNow = false, groupId: string = randomUUID(), reason = '中午看一眼今天的进度'): Promise<RunResult> {
    const collected: any[] = [];
    const ctx: ToolCtx = { userId, commandId: null, groupId, trigger: 'midday', onAction: (a) => { collected.push(a); }, deliverNow };
    const today = await this.time.today(userId);
    const t = (await this.db.query(
      `SELECT t.title, t.status FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id WHERE p.user_id=$1 AND p.plan_date=$2 AND t.status<>'skipped' ORDER BY t.sort_order`, [userId, today])).rows;
    const done = t.filter((x: any) => x.status === 'done').length, left = t.filter((x: any) => x.status !== 'done');
    const hour = (await this.time.now(userId)).hour; // 按用户当地时间说（测试触发可能在半夜跑，不按任务名说「中午」）
    const text = !t.length ? `${dayGreeting(hour)}，今天还没排计划。回一句「今天只有一小时」，我帮你排。`
      : !left.length ? `今天 ${t.length} 项都做完了，接下来可以复习一下错题。`
      : `今天计划 ${t.length} 项，做完 ${done} 项，${laterToday(hour)}先做「${left[0].title}」。`;
    const en = await this.time.earlyNoteOnce(userId); // 凌晨 0–4 点跑：说明还算前一天（每个学习日只说一次）
    await this.tools.writeDailyTip(ctx, { kind: 'nudge', date: today, text, reason, source: 'mock', ...(en ? { details: en } : {}) });
    return { mode: 'mock', summary: text, reply: text, actions: collected, steps: 0 };
  }

  /**
   * 开发用强制触发（POST /agent/jobs/run {job, force:true}）：不看少打扰 / 频率 / 「今天已跑过」，强制走规则版（不调模型），消息立刻送达。
   * coach_frequency=ask 时保证至少有一条待确认的改动：按数据找不到可改的，就给一个固定的演示改动（见 demoTweak）。
   */
  async devRun(job: JobName, userId: string) {
    return this.runForUser(job, userId, true, false, { force: true });
  }

  /** ask 模式下规则版没想出改动时的演示建议：到期 / 在册错题 → 重做；最弱知识点 → 练 3 道；都没有 → 5 道基础题热身。用 propose ctx 试算，记成真实的建议 */
  private async demoTweak(userId: string, job: JobName, proposals: any[], seen: Seen, skipWhy: SeenSrc[][] = []) {
    const ctx: ToolCtx = { userId, commandId: null, trigger: job === 'midday' ? 'midday' : job, onAction: () => {}, propose: true, proposals };
    const today = await this.time.today(userId);
    const date = job === 'midday' ? today : new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    const p = await this.tools.getProfile(ctx);
    const later = laterToday((await this.time.now(userId)).hour); // 按用户当地时间说「今天 / 今天下午 / 今晚」
    const wrong = (await this.tools.getWrongQuestions(ctx, { limit: 3 })).items;
    const cands: any[] = [];
    if (wrong.length) cands.push({ kind: 'redo_wrong', title: `重做 ${wrong.length} 道错题`, payload: { question_ids: wrong.map((w: any) => w.question_id) }, estimated_minutes: wrong.length * 8,
      why: `错题本里还有 ${p.stats?.wrong_active ?? wrong.length} 道没掌握，${date === today ? later : dayLabel(date, today)}先重做 ${wrong.length} 道。` });
    const kp = p.weakest_kps?.[0]?.kp_path;
    if (kp) cands.push({ kind: 'practice', title: `练 3 道「${kp.split('/').pop()}」`, payload: { kp_path: kp }, estimated_minutes: 20,
      why: `「${kp.split('/').pop()}」是你目前最弱的知识点（掌握度 ${Math.round(100 * (p.weakest_kps[0].score ?? 0))}%），加 3 道针对练习。` });
    cands.push({ kind: 'practice', title: '做 5 道基础题热身', payload: { demo: true }, estimated_minutes: 25, why: '演示建议：还没有足够的作答数据，先加 5 道基础题热身。' });
    for (const c of cands) {
      const n = proposals.length;
      const { why, ...task } = c;
      await this.tools.updateDailyPlan(ctx, { date, why_changed: why, add_tasks: [task] });
      const last = proposals[proposals.length - 1];
      if (proposals.length > n && last.summaries.length && !isDupItem(seen, last)) return;
      if (proposals.length > n) skipWhy.push(last.summaries.length ? dupSources(seen, last) : ['planned']); // 没改动 = 计划里已有（确认过的建议已经进了计划）
      proposals.splice(n); // 已有同样的任务（计划里有 / 今天已经建议过）→ 换下一个
    }
  }

  async runForUser(job: JobName, userId: string, manual: boolean, respectBackoff = !manual, dev?: { force: boolean }) {
    const runKey = `${job}:${userId}:${await this.time.today(userId)}`;
    if (job === 'nightly' && respectBackoff) {
      const g = await this.proactiveGate(userId); // 「别管我」/ 两次没打开的少打扰，叠加在提醒频率上面
      if (g.skip) return { job, skipped: true, reason: g.reason, actions: g.actions };
    }
    if (respectBackoff) {
      const g = await this.reminderGate(job, userId);
      if (g.skip) return { job, skipped: true, reason: g.reason, actions: [] };
    }
    if (!manual) {
      const done = await this.db.one(`SELECT 1 FROM job_runs WHERE run_key=$1 AND status IN ('ok','running') AND started_at > now()-interval '2 days'`, [runKey]);
      if (done) return { job, skipped: true, reason: '今天已经跑过' };
    }
    const mode = job === 'phase_check' || dev?.force ? 'rule' : aiMode();
    const run = await this.db.one(`INSERT INTO job_runs(job,user_id,run_key,mode,detail) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [job, userId, manual ? `${runKey}:manual:${Date.now()}` : runKey, mode, JSON.stringify({ manual, ...(dev?.force ? { dev_force: true } : {}) })]);
    try {
      const freq = coachFrequency(await this.settings(userId));
      const propose = freq === 'ask';
      const forced = !!dev?.force;
      const pro = (await this.db.one('SELECT proactive FROM users WHERE id=$1', [userId]))?.proactive;
      const reason = jobReason(job, { freq, forced, reducedEvery: pro?.mode === 'reduced' ? Number(pro.nightly_every_days || 3) : null });
      const proposals: any[] = [];
      const groupId = randomUUID(); // 这次运行的所有动作（复盘消息、改计划、建议消息）同一组
      const r: RunResult = job === 'phase_check' ? await this.phaseCheck(userId, propose ? proposals : undefined, groupId)
        : job === 'midday' ? await this.midday(userId, forced, groupId, reason)
        : await this.coach.runJob(userId, job, undefined, { ...(propose ? { proposals } : {}), rule: forced, deliverNow: forced, groupId, tipReason: reason });
      const has = () => proposals.some((p) => p.summaries.length && (CONFIRMABLE as readonly string[]).includes(p.tool));
      const why: SeenSrc[][] = []; // 每处被去掉的改动是因为什么（忽略过 / 等确认 / 计划里有）
      if (propose) {
        // 去重：今天已经建议过 / 已确认执行 / 目标日计划里已有的改动不再提
        const seen = await this.loadSeen(userId);
        this.dropDup(proposals, seen, why);
        if (dev?.force && !has()) await this.demoTweak(userId, job, proposals, seen, why);
      }
      const proposal = propose ? await this.saveProposals(userId, job, proposals, forced, groupId, forced) : null;
      if (forced) {
        // 测试触发：这次运行的所有动作在「教练改过的」里标「（测试触发）」+ forced=true
        const upd = (await this.db.query(`UPDATE agent_actions SET forced=true, summary=CASE WHEN summary LIKE '%' || $3 THEN summary ELSE summary || $3 END
          WHERE user_id=$1 AND group_id=$2 RETURNING id, summary`, [userId, groupId, FORCED_MARK])).rows;
        const m = new Map(upd.map((x: any) => [x.id, x.summary]));
        for (const a of r.actions) if (m.has(a.id)) { a.summary = m.get(a.id); a.forced = true; }
        if (r.summary && !r.summary.endsWith(FORCED_MARK)) r.summary += FORCED_MARK;
      }
      const sk = propose && !proposal ? skipReason(why) : null;
      const out = { job, skipped: false, forced, mode: r.mode, summary: r.summary, reply: r.reply, actions: r.actions, proposal,
        ...(sk ? { proposal_skipped: sk.text, proposal_skipped_reason: sk.code } : {}) };
      await this.db.query(`UPDATE job_runs SET status='ok', finished_at=now(), detail=detail || $2 WHERE id=$1`,
        [run!.id, JSON.stringify({ summary: r.summary, action_ids: r.actions.map((a) => a.id), forced })]);
      return out;
    } catch (e: any) {
      await this.db.query(`UPDATE job_runs SET status='error', finished_at=now(), detail=detail || $2 WHERE id=$1`, [run!.id, JSON.stringify({ error: e.message })]);
      throw e;
    }
  }

  /** 阶段检查：规则判断，不需要模型 */
  private async phaseCheck(userId: string, proposals?: any[], groupId: string = randomUUID()): Promise<RunResult> {
    const collected: any[] = [];
    const ctx: ToolCtx = { userId, commandId: null, groupId, trigger: 'phase_check', onAction: (a) => { collected.push(a); }, ...(proposals ? { propose: true, proposals } : {}) };
    const u = await this.db.one(`SELECT phase, to_char(exam_date,'YYYY-MM-DD') exam_date FROM users WHERE id=$1`, [userId]);
    if (!u?.exam_date) return { mode: 'rule', summary: '还没设置考试日期，跳过阶段检查', reply: null, actions: [], steps: 0 };
    const days = Math.round((Date.parse(u.exam_date) - Date.parse(await this.time.today(userId))) / 86400000);
    const target = phaseFor(days);
    if (ORDER.indexOf(target) <= ORDER.indexOf(u.phase)) {
      return { mode: 'rule', summary: `距考试 ${days} 天，保持「${PHASE_CN[u.phase]}」阶段`, reply: null, actions: [], steps: 0 };
    }
    await this.tools.switchPhase(ctx, { phase: target, reason: `距考试还有 ${days} 天，按计划进入「${PHASE_CN[target]}」阶段。` });
    if (proposals) return { mode: 'rule', summary: `建议进入「${PHASE_CN[target]}」阶段（等你确认）`, reply: null, actions: [], steps: 0 };
    return { mode: 'rule', summary: collected.map((a) => a.summary).join('；'), reply: null, actions: collected, steps: 0 };
  }
}
