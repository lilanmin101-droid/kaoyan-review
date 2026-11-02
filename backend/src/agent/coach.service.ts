import { CoachAnswers, questionKind } from './coach-answers';
import { randomUUID } from 'crypto';
import { UserTimeService } from '../common/user-time.service';
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { addDays, DAY_START_HOUR, dayLabel as dayLabelOf, daySpanLabel, studyDaySql, weekOf, weekOpenLabel } from '../common/time';
import { aiMode, mastraModel, mastraProviderOptions } from '../ai/llm';
import { AgentToolsService, PHASE_CN, ToolCtx, Trigger } from './agent-tools.service';
import { PlansService } from '../plans/plans.service';
import { buildMastraTools, TOOL_LABEL } from './mastra-tools';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Agent } = require('@mastra/core/agent');

export interface CommandOpts { question_id?: string }

/** 「别管我」一类：少打扰 */
export const BACKOFF_RE = /别管我|别催|别烦我|少提醒|别提醒|不要提醒|不用提醒|别发了|不要再发|安静点/;
/** 「这题我会，是手滑」一类：记粗心 */
export const CARELESS_RE = /手滑|粗心|马虎|看错了|抄错了|笔误/;

const CN_NUM: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
/** 「只有一小时」「40 分钟」「一个半小时」→ 分钟数；没提时间返回 null */
const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 中文数字（一…九十九，含「两」）或阿拉伯数字 → number */
export function parseCnNumber(x: string): number | null {
  if (/^\d+$/.test(x)) return Number(x);
  if (!/^[零一两二三四五六七八九十]+$/.test(x)) return null;
  if (!x.includes('十')) return x.length === 1 ? CN_DIGIT[x] : null;
  const [a, b] = x.split('十');
  return (a ? CN_DIGIT[a] ?? NaN : 1) * 10 + (b ? CN_DIGIT[b] ?? NaN : 0) || null;
}
/** 「一道」「两道错题」「3 题」「加道」（量词前省略数字 = 1）→ 题数；没说数量返回 null */
export function parseCount(t: string): number | null {
  const m = /(\d+|[零一两二三四五六七八九十]+)\s*(?:道|题|个(?=错?题))/.exec(t);
  if (m) { const v = parseCnNumber(m[1]); if (v != null && v > 0) return Math.min(v, 50); }
  if (/(?:加|来|排|做|给我)\s*道/.test(t)) return 1;
  return null;
}

/**
 * 修饰「错题」的时间词 = 按做错的日子筛错题（不是排到那天）：「昨天的错题」「上周的错题」「今天做错的题」「最近三天的错题」。
 * 返回筛选区间（用户时区的本地日期）和原文片段；排计划用的「明天 / 后天排」不在这里。
 */
const WRONG_TIME_RE = /(昨天|昨日|前天|今天|今日|这周|本周|上周|最近\s*(\d+|[一二两三四五六七八九十]+)\s*天)\s*(?:的错题|做错的(?:错题|题)?|做错了的(?:题)?|错的题|的题|错题)/;
/** 学习时长：没有记录（null / 0 / NaN）就直说，不把 null 写进学生看到的文字 */
export const minutesText = (m: unknown) => (Number.isFinite(Number(m)) && Number(m) > 0 ? `约 ${Math.round(Number(m))} 分钟` : '还没有学习时长记录');
/** 给学生看的文字里不能出现 null / undefined / NaN（模板漏了值） */
export const hasLeak = (t: unknown) => typeof t === 'string' && /\b(null|undefined|NaN)\b|\[object Object\]/.test(t);
/** 学生看到的文字里不该有的标点连用：「。，」「，。」「。。」「，，」「；。」等（「……」「？！」不算） */
export const badPunct = (t: unknown) => typeof t === 'string' && /[。，；、：][。，；、]|[！？][，；、]|，[！？]/.test(t);
/** 学生文字检查：漏出 null / undefined / NaN，或标点连用 */
export const textProblem = (t: unknown) => (hasLeak(t) ? 'leak' : badPunct(t) ? 'punct' : null);
/** 去掉句尾标点，用来把几句话再用「，」接起来 */
export const clause = (t: string) => t.trim().replace(/[。，；、！？.,;!?\s]+$/u, '');
/** 当地时间的开头称呼（强制触发的中午提醒等不按任务名说「中午」）：0–5 夜深了 / 5–11 早上好 / 11–13 中午了 / 13–18 下午好 / 18–24 晚上好 */
export const dayGreeting = (hour: number) => (hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午了' : hour < 18 ? '下午好' : '晚上好');
/** 「今天剩下的时间」按用户当地时间说：上午 → 今天；11–18 点 → 今天下午；之后 → 今晚 */
export const laterToday = (hour: number) => (hour < 11 ? '今天' : hour < 18 ? '今天下午' : '今晚');

export function parseWrongFilter(t: string, today: string): { from: string; to: string; label: string; phrase: string } | null {
  const m = WRONG_TIME_RE.exec(t);
  if (!m) return null;
  const add = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 周一=0
  const w = m[1].replace(/\s+/g, '');
  const r = /昨/.test(w) ? { from: add(-1), to: add(-1), label: '昨天' }
    : w === '前天' ? { from: add(-2), to: add(-2), label: '前天' }
    : /今/.test(w) ? { from: today, to: today, label: '今天' }
    : w === '上周' ? { from: add(-dow - 7), to: add(-dow - 1), label: '上周' }
    : /这周|本周/.test(w) ? { from: add(-dow), to: today, label: '这周' }
    : (() => { const n = Math.min(Math.max(parseCnNumber(m[2]) ?? 1, 1), 90); return { from: add(-(n - 1)), to: today, label: `最近 ${n} 天` }; })();
  return { ...r, phrase: m[0] };
}

/** 增量词：「加两道」「再来 2 道」「多做几道」「补 3 道」「追加」 */
export const INCR_RE = /加|再|多|补|追加/;
/**
 * 数量语义：有增量词 → add（在已有同类任务上加，默认 3）；只有数量 → set（设成这个数）；都没有 → null（老逻辑：按时间预算 / 到期错题）
 */
export function quantityIntent(t: string): { mode: 'add' | 'set'; quantity: number } | null {
  const q = parseCount(t);
  if (INCR_RE.test(t.replace(/多少|加油|增加了/g, ''))) return { mode: 'add', quantity: q ?? 3 };
  return q != null ? { mode: 'set', quantity: q } : null;
}

export function parseBudgetMinutes(t: string): number | null {
  const m = /(\d+(?:\.\d+)?|[一两二三四五六七八九十半])\s*个?\s*(半)?\s*(小时|钟头|分钟)/.exec(t);
  if (!m) return null;
  const v = /\d/.test(m[1]) ? Number(m[1]) : CN_NUM[m[1]];
  const total = m[3] === '分钟' ? v : (v + (m[2] ? 0.5 : 0)) * 60;
  return total > 0 ? Math.round(total) : null;
}

export { questionKind } from './coach-answers';
export type Emit = (event: 'step' | 'action', data: any) => void | Promise<void>;
export interface RunResult { mode: 'ai' | 'mock' | 'rule'; summary: string; reply: string | null; actions: any[]; steps: number; deduped?: boolean; date?: string;
  quantity_from?: number | null; quantity_to?: number | null; question_kind?: string }

const INSTRUCTIONS = `你是「考研私教」，帮一位准备考研的同学管理复习。说中文，口吻像靠谱的学长：具体、简短、不说空话。
工作方式：
- 学生是在问问题（「…吗」「几道」「怎么样」）而不是让你改东西时：用只读工具查真实数据直接回答（做不做、做多少、一句建议），不要调用任何写工具。
- 先用只读工具（getProfile / getWrongQuestions / getAnswerHistory / searchQuestions）弄清情况，再决定改什么。
- 只用写工具改东西（updateDailyPlan / addReviewCard / upsertReminder / switchPhase / writeDailyTip），每次写操作都要给出具体理由（reason / why_changed），用户会在首页看到并能一键撤回。
- 不能删除作答记录和笔记；不想要的任务用 status=skipped 跳过。
- 题目 id 只能用工具查出来的，不能编。计划日期用 YYYY-MM-DD。
- 一次命令最多做 5 个写操作；用户只是问问题时不要乱改计划。
- 用户说「今天」或没说日期，就改今天的计划（晚上也是今天，updateDailyPlan 不传 date 就是今天）；只有用户明确说明天/后天，或今天放不下要挪的任务，才写到别的日期，并在 why_changed 里写明「挪到明天」。
- 加任务前先看那天的计划有没有同样的任务，有就不要重复加（工具也会自动去重）。
- 实际执行和用户说的不一样时（数量、类型、日期等：没有错题改排基础题、错题不够 N 道、说的日期已经过去、一次排太多被封顶…），回复里必须有一句话说清楚为什么、改成了什么，例如「你现在没有错题，先排了 5 道基础题。」「昨天已经过去了，排到了今天（11-01）。」
- 修饰错题的时间词（「昨天的错题」「上周的错题」「今天做错的题」「最近三天的错题」）是按做错的日子筛题：getWrongQuestions 传 wrong_from / wrong_to，不是把任务排到那天；「明天 / 后天排」才是排计划的日子。筛出来没有题就直说，问要不要换成今天的或全部错题，不要偷偷换，也不改计划。
- updateDailyPlan 的 why_changed 写实际做了什么、为什么（和回复里的说明一致），不要复述原话里没做到的部分。
- 用户说了数量（一道/两道/3 道）就严格按这个数量排，没说才默认 3 道。带「加/再/多/补/追加」= 在今天已有的同类任务上加（updateDailyPlan 的 add_tasks 传 mode=add + quantity）；只说数量（「今天重做 5 道」）= 设成这个数（mode=set），已经是这个数工具会返回 unchanged，直接告诉用户「已经有了」。
- 指令太含糊（如「帮我调一下」）：先问一个问题（给 2–3 个选项），不要改计划。
- 用户说「别管我/别催了」：用 setProactive(mode=reduced) 少打扰，不要劝、不要追问。用户说「这题我会，是手滑」：用 markCareless，不要再给这题讲道理。
- 最后用 1–3 句话告诉用户你做了什么、为什么。`;

/** 定时任务给 Agent 的指令 */
const JOB_PROMPTS: Record<string, (today: string) => string> = {
  nightly: (d) => `现在是 ${d} 晚上 23:00，做当日复盘：1) 看今天的作答和错题；2) 用 writeDailyTip(kind=review)：text 只写一件明天最重要的事（一句话，≤40 字，如「明天先重做 3 道到期错题」），做了多少、错在哪等细节放 details（默认折叠），不要写一屏建议；3) 用 updateDailyPlan 给明天（${addDays(d, 1)}）排任务，优先到期错题和最弱知识点，总时长按以往习惯。`,
  weekly: (d) => `今天是 ${d}（周日），写周报：1) 看最近 7 天作答、错因和掌握度变化；2) 用 writeDailyTip(kind=weekly)：text 只写下周最重要的一件事（一句话，以「下周重点：」开头，例如 下周重点：补「变限积分」。；本周、距考试 N 天照常写，系统会按读的日子改时态），本周数据、进步、问题放 details（≤200 字，默认折叠）；3) 用 updateDailyPlan 调整下周一（${addDays(d, 1)}）的计划。`,
};

@Injectable()
export class CoachService {
  private log = new Logger('Coach');
  private answers: CoachAnswers;
  constructor(private db: DbService, private tools: AgentToolsService, private plans: PlansService, private time: UserTimeService) {
    this.answers = new CoachAnswers(db, time, plans);
  }

  /** 用户命令：有 Key 走 Mastra Agent，否则模拟（真实写一条可撤回的计划改动） */
  async runCommand(userId: string, commandId: string, text: string, emit: Emit, opts: CommandOpts = {}): Promise<RunResult> {
    const ctx = this.ctx(userId, commandId, 'command', emit);
    ctx.commandText = text;
    // 少打扰模式下学生又主动来找教练：恢复每晚复盘（「别管我」本身除外）
    if (!BACKOFF_RE.test(text)) {
      const p = (await this.db.one('SELECT proactive FROM users WHERE id=$1', [userId]))?.proactive;
      if (p?.mode === 'reduced') await this.tools.setProactive(ctx, { mode: 'normal', reason: '你又来找我了，恢复每晚复盘', cause: 're_engaged' });
    }
    // 问题（不是命令）：直接用真实数据回答，什么都不改（「那今天的单词还背吗」「错题还剩几道」…）
    const qk = opts.question_id ? null : questionKind(text);
    if (qk && qk !== 'general') {
      await emit('step', { command_id: ctx.commandId, text: `收到：「${text.trim().slice(0, 50)}」——这是问题，只看数据不改计划` });
      const a = await this.answers.answer(userId, qk, text, parseBudgetMinutes);
      for (const s of a.steps) await emit('step', { command_id: ctx.commandId, text: s });
      return { mode: 'rule', summary: a.reply, reply: a.reply, actions: [], steps: a.steps.length + 1, date: await this.time.today(userId), quantity_from: null, quantity_to: null, question_kind: qk } as RunResult;
    }
    const r = aiMode() === 'ai'
      ? await this.runAgent(ctx, opts.question_id ? `（当前题目：${opts.question_id}）${text}` : text, emit)
      : await this.mockCommand(ctx, text, emit, opts);
    return { ...r, deduped: !!ctx.deduped?.length && !ctx.collected.length, date: r.date ?? (await this.time.today(userId)),
      quantity_from: ctx.quantity?.from ?? null, quantity_to: ctx.quantity?.to ?? null };
  }

  /** 定时任务（夜间复盘 / 周报）：有 Key 走 Agent，否则按规则生成 */
  /** opts.proposals：coach_frequency=ask，写类工具只试算、记进 proposals，不真的改（消息照常写） */
  /** opts.rule：强制走规则版（不调模型，开发触发用）；opts.deliverNow：消息不按免打扰排队 */
  async runJob(userId: string, job: 'nightly' | 'weekly', emit: Emit = () => {}, opts: { proposals?: any[]; rule?: boolean; deliverNow?: boolean; groupId?: string; tipReason?: string } = {}): Promise<RunResult> {
    const ctx = this.ctx(userId, null, job, emit);
    if (opts.groupId) ctx.groupId = opts.groupId;
    if (opts.proposals) { ctx.propose = true; ctx.proposals = opts.proposals; }
    if (opts.deliverNow) ctx.deliverNow = true;
    const today = await this.time.today(userId);
    if (aiMode() === 'ai' && !opts.rule) return this.runAgent(ctx, JOB_PROMPTS[job](today) + (opts.proposals ? '（用户选了「先问我」：你对计划 / 复习卡 / 阶段的改动只会作为建议给用户确认，消息里用「建议…」的口吻，不要说「已经排好」）' : ''), emit);
    return job === 'nightly' ? this.mockNightly(ctx, today, opts.tipReason) : this.mockWeekly(ctx, today, opts.tipReason);
  }

  private ctx(userId: string, commandId: string | null, trigger: Trigger, emit: Emit): ToolCtx & { collected: any[] } {
    const collected: any[] = [];
    return { userId, commandId, groupId: commandId ?? randomUUID(), trigger, collected, deduped: [],
      onAction: async (a) => { collected.push(a); await emit('action', { command_id: commandId, action: a }); },
      onStep: async (text, tool) => { await emit('step', { command_id: commandId, text, ...(tool ? { tool } : {}) }); } };
  }

  private async runAgent(ctx: ToolCtx & { collected: any[] }, prompt: string, emit: Emit): Promise<RunResult> {
    const agent = new Agent({
      id: 'kaoyan-coach', name: '考研私教', instructions: INSTRUCTIONS,
      model: mastraModel('deepseek'), tools: buildMastraTools(this.tools, ctx),
    });
    const n = await this.time.now(ctx.userId);
    const stream = await agent.stream([{ role: 'user', content: `（今天是 ${n.date}，现在 ${n.time}，时区 ${n.tz}）${prompt}` }], { maxSteps: Number(process.env.AGENT_MAX_STEPS || 10), providerOptions: mastraProviderOptions('deepseek') });
    let reply = '';
    let steps = 0;
    for await (const chunk of stream.fullStream as AsyncIterable<any>) {
      const p = chunk.payload ?? chunk;
      if (chunk.type === 'tool-call') {
        steps++;
        await emit('step', { command_id: ctx.commandId, text: TOOL_LABEL[p.toolName] ?? `正在调用 ${p.toolName}`, tool: p.toolName });
      } else if (chunk.type === 'text-delta') {
        reply += p.text ?? p.textDelta ?? '';
      } else if (chunk.type === 'error') {
        throw new Error(`模型调用出错：${p.error?.message ?? JSON.stringify(p.error ?? p).slice(0, 200)}`);
      }
    }
    reply = reply.trim();
    const summary = ctx.collected.length ? ctx.collected.map((a) => a.summary).join('；') : (reply.slice(0, 80) || '看过了，这次不需要改动');
    return { mode: 'ai', summary, reply: reply || null, actions: ctx.collected, steps };
  }

  // ───────────── 模拟模式（没有 Key） ─────────────

  private async mockCommand(ctx: ToolCtx & { collected: any[] }, text: string, emit: Emit, opts: CommandOpts = {}): Promise<RunResult> {
    const t = text.trim();
    const step = (txt: string, tool?: string) => emit('step', { command_id: ctx.commandId, text: txt, ...(tool ? { tool } : {}) });
    await step(`收到：「${t.slice(0, 50)}」`);
    // 执行和用户说的不一样（数量 / 类型 / 日期）时，每处差异一句话说明原因和改成了什么，拼在回复和 summary 末尾
    const notes: string[] = [];
    const done = (reply: string | null, steps: number) => {
      const note = notes.join('');
      const sum = ctx.collected.map((a) => a.summary).join('；');
      return { mode: 'mock' as const, summary: (sum ? `${sum}${note ? `；${note.replace(/。$/, '')}` : ''}` : '') || reply || '看过了，这次不需要改动',
        reply: reply && note && ctx.collected.length ? `${reply}${note}` : reply, actions: ctx.collected, steps, ...(notes.length ? { adjustments: notes } : {}) };
    };

    // 1) 「别管我」：少打扰（夜间复盘改成每 3 天一次，周报照常），可撤回
    if (BACKOFF_RE.test(t)) {
      await step(TOOL_LABEL.setProactive, 'setProactive');
      const r = await this.tools.setProactive(ctx, { mode: 'reduced', every_days: 3, reason: `你说「${t.slice(0, 20)}」，先少打扰你`, cause: 'command' });
      return done(r.changed ? '好，之后每 3 天才发一次复盘，周报照常。想让我帮忙随时说一句。' : '已经是少打扰模式了，不会再加提醒。', 1);
    }
    // 2) 「这题我会，是手滑」：记粗心，不扣掌握度
    if (CARELESS_RE.test(t)) {
      await step(TOOL_LABEL.markCareless, 'markCareless');
      const r = await this.tools.markCareless(ctx, { question_id: opts.question_id, reason: `你说「${t.slice(0, 20)}」` });
      return done(r.already ? r.summary : `记下了：${r.summary}。下次做完这类题留 30 秒回头检查。`, 1);
    }

    // 3) 说得太含糊（「帮我调一下」）：先问一个问题，不动计划
    if (!/错题|练|题|计划|词|时间|小时|分钟|钟头|今天|明天|后天|周|清|排|加|减|少|多|卷/.test(t)) {
      return done('想怎么调？回一个就行：① 时间（今天能学多久）② 科目（数学 / 英语）③ 难度（简单点 / 难一点）。', 0);
    }
    // 4) 改计划：默认改「今天」（按用户时区算，晚上也是今天）；只有明确说了明天/后天才排到那天
    const today = await this.time.today(ctx.userId); // 唯一口径：用户时区的「今天」
    // 「昨天的错题」= 按做错的日子筛题；去掉这段再看排到哪天（「今天做错的题明天重做」→ 筛今天、排明天）
    const wf = parseWrongFilter(t, today);
    const tt = wf ? t.replace(wf.phrase, ' ') : t;
    const offset = /后天/.test(tt) ? 2 : /明天|明日|明早|明晚/.test(tt) ? 1 : 0;
    const date = addDays(today, offset);
    const past = offset === 0 && /(昨天|前天|上周)/.exec(tt)?.[1];
    if (past) notes.push(`${past}已经过去了，排到了今天（${date.slice(5)}）。`);
    const dayName = offset === 0 ? '今天' : offset === 1 ? '明天' : '后天';
    const dayLabel = dayLabelOf(date, today); // 「明天（11-02）」：相对学习日算
    const nextLabel = dayLabelOf(addDays(date, 1), today); // 放不下的挪到哪天（排的是明天时，挪过去的是后天）
    const budget = parseBudgetMinutes(t);

    // 凌晨（0–4 点）还算前一个学习日：说一句，免得以为排错了
    {
      const now = await this.time.now(ctx.userId);
      if (now.hour < DAY_START_HOUR) await step(`现在是 ${now.time}（${now.tz}），还没到 ${DAY_START_HOUR}:00 换日，按${dayLabel}排`); // 「凌晨 4 点前还算…」那句只在回复里说、每个学习日一次
    }
    await step(TOOL_LABEL.getWrongQuestions, 'getWrongQuestions');
    // 用户说了几道就排几道（一道=1、两道=2、数字照用）；没说数量才默认 3 道
    const asked = parseCount(t);
    const intent = quantityIntent(t);
    const range = wf ? daySpanLabel(wf.from, wf.to, wf.label === '这周' || wf.label === '本周') : '';
    const wrong = (await this.tools.getWrongQuestions(ctx, { limit: intent ? 50 : Math.max(asked ?? 0, 3), ...(wf ? { wrong_from: wf.from, wrong_to: wf.to } : {}) })).items;
    const pool = wf ? `${wf.label}做错的` : '错题本里该重做的';
    if (wf) await step(`按做错的日子筛：${wf.label}（${range}）做错的题有 ${wrong.length} 道`);
    // 筛出来一道都没有：直说，问要不要换成今天的 / 全部错题，不偷偷换、不改计划
    if (wf && !wrong.length) {
      const all = (await this.tools.getWrongQuestions(ctx, { limit: 50 })).items.length;
      const todays = wf.label === '今天' ? 0 : (await this.tools.getWrongQuestions(ctx, { limit: 50, wrong_from: today, wrong_to: today })).items.length;
      const k = asked ?? intent?.quantity ?? null, kk = k ? ` ${k} 道` : '';
      const opts = [todays ? `回「排${kk}今天做错的题」用今天的（有 ${todays} 道）` : '', all ? `回「排${kk}错题」从全部错题里挑（有 ${all} 道）` : ''].filter(Boolean);
      return { ...done(`${wf.label}（${range}）没有做错的题，这次没改计划。${opts.length ? `要换一下吗？${opts.join('，或')}。` : '错题本里现在也没有错题，想先做几道基础题的话回「排 5 道基础题」。'}`, 1), date };
    }
    const quote = `你说「${t.slice(0, 30)}」`;
    // 「一道」「两道」「3 题」：按用户说的数量来；没说数量才按时间预算/到期错题数
    const n = intent ? Math.min(wrong.length, intent.quantity) : asked != null ? Math.min(wrong.length, asked) : budget ? Math.min(wrong.length, Math.max(1, Math.floor(budget / 2 / 8))) : Math.min(wrong.length, 3);
    const mentionsWrong = /错题/.test(t);
    if (!intent && asked != null && asked > wrong.length && wrong.length) {
      await step(`你说要 ${asked} 道，错题本里该重做的只有 ${wrong.length} 道，先排这 ${wrong.length} 道`);
      notes.push(`你要 ${asked} 道，${pool}只有 ${wrong.length} 道，先排了这 ${wrong.length} 道。`);
    }
    if (intent && wrong.length && intent.mode === 'set' && intent.quantity > wrong.length)
      notes.push(`你要 ${intent.quantity} 道，${pool}只有 ${wrong.length} 道，先排了这 ${wrong.length} 道。`);
    if (wf) notes.push(`是从${wf.label}（${range}）做错的题里挑的。`);
    // 没有错题：改排基础题。说了数量就按这个数（一次最多 20 道），没说默认 5 道
    const wantBasic = asked ?? intent?.quantity ?? null;
    const basicN = wantBasic ? Math.min(20, wantBasic) : 5;
    if (!wrong.length) {
      if (mentionsWrong || intent) notes.push(`你现在没有错题，先排了 ${basicN} 道基础题。`);
      if (wantBasic && wantBasic > 20) notes.push(`一次最多排 20 道，先排了 20 道。`);
    }
    const main: any = intent && wrong.length
      ? { kind: 'redo_wrong', title: '重做错题', payload: { question_ids: wrong.map((w: any) => w.question_id) }, estimated_minutes: n * 8, mode: intent.mode, quantity: intent.quantity }
      : n
      ? { kind: 'redo_wrong', title: `重做 ${n} 道${wf ? `${wf.label}的` : ''}错题`, payload: { question_ids: wrong.slice(0, n).map((w: any) => w.question_id) }, estimated_minutes: n * 8 }
      : { kind: 'practice', title: `基础练习 ${basicN} 题`, payload: { count: basicN }, estimated_minutes: budget ? Math.min(basicN * 6, budget) : basicN * 6 };

    // 有时间预算：保留排在前面的任务，放不下的明确挪到明天（并在步骤里说清楚）
    const update: any[] = [];
    const deferred: any[] = [];
    if (budget) {
      const plan = await this.plans.getPlan(ctx.userId, date);
      const open = (plan?.tasks ?? []).filter((x: any) => ['todo', 'doing'].includes(x.status));
      const already = open.find((x: any) => x.kind === main.kind && (main.kind !== 'redo_wrong' || x.status !== 'skipped'));
      let used = already ? 0 : main.estimated_minutes;
      for (const x of open) {
        const m = x.estimated_minutes ?? 30;
        if (used + m <= budget) { used += m; continue; }
        update.push({ id: x.id, status: 'skipped' });
        deferred.push(x);
      }
      await step(deferred.length
        ? `${dayLabel}只有 ${budget} 分钟：保留 ${open.length - deferred.length} 项，「${deferred.map((x: any) => x.title).join('」「')}」放不下，挪到${nextLabel}`
        : `${dayLabel}只有 ${budget} 分钟，现有任务放得下，不用挪`, 'updateDailyPlan');
    }
    await step(main.mode ? `${main.mode === 'add' ? `要加 ${main.quantity} 道` : `要排 ${main.quantity} 道`}重做错题，对照${dayLabel}的计划` : n ? `挑了 ${n} 道该重做的错题，准备排进${dayLabel}的计划` : `还没有错题，在${dayLabel}排 ${basicN} 道基础练习`, 'updateDailyPlan');
    const whyBase = budget
      ? `${quote}，${dayName}按 ${budget} 分钟排：先${main.title}${deferred.length ? `，放不下的 ${deferred.length} 项挪到${nextLabel}` : ''}。`
      : main.mode ? `${quote}，按你说的${main.mode === 'add' ? `在原来的基础上再加 ${main.quantity} 道` : `排 ${main.quantity} 道`}错题重做。`
      : n ? `${quote}，这 ${n} 道错题到了复习时间，先重做再刷新题。` : `${quote}，${mentionsWrong || intent ? '现在没有错题，' : ''}先用 ${basicN} 道基础题摸一下底。`;
    // why_changed 写实际做了什么：执行和说的不一样时就用那句说明（和回复同一来源），不复述原话
    const why = notes.length
      ? `${notes.join('')}${deferred.length ? `${dayName}放不下的 ${deferred.length} 项挪到${nextLabel}。` : ''}`
      : whyBase;
    const r = await this.tools.updateDailyPlan(ctx, { date, why_changed: why, add_tasks: [main], update_tasks: update });
    if (deferred.length) {
      const next = addDays(date, 1);
      await this.tools.updateDailyPlan(ctx, {
        date: next, why_changed: `${quote}，${dayName}时间不够，这 ${deferred.length} 项从 ${date.slice(5)} 挪到 ${next.slice(5)}。`,
        add_tasks: deferred.map((x: any) => ({ kind: x.kind, title: x.title, payload: x.payload ?? {}, estimated_minutes: x.estimated_minutes ?? undefined, position: 'bottom' as const })),
      });
    }
    const q = ctx.quantity;
    if (intent?.mode === 'add' && q && wrong.length && q.to - q.from < intent.quantity && q.to > q.from)
      notes.push(`你要再加 ${intent.quantity} 道，错题本里能重做的只够再加 ${q.to - q.from} 道，先加了这些。`);
    const reply = !ctx.collected.length && intent?.mode === 'add' && wrong.length
      ? `你要再加 ${intent.quantity} 道，但错题本里该重做的 ${wrong.length} 道已经都排进${dayLabel}了，没有可以再加的，这次没改。`
      : r.unchanged?.length && !ctx.collected.length
      ? `${dayLabel}的计划里已经有「${r.unchanged.join('」「')}」，没有重复添加。`
      : !ctx.collected.length ? '这次没有改动。'
      : q && q.from > 0 ? `已把${dayLabel}的「重做错题」从 ${q.from} 道${q.mode === 'add' ? '加到' : '改为'} ${q.to} 道${deferred.length ? `；放不下的 ${deferred.length} 项挪到${nextLabel}` : ''}。`
      : `已改${dayLabel}的计划：${q ? q.title : main.title}${deferred.length ? `；放不下的 ${deferred.length} 项挪到${nextLabel}` : ''}。`;
    return { ...done(reply, 2), date };
  }

  private async dayStats(userId: string, from: string, to: string) {
    const tz = await this.time.tz(userId);
    return (await this.db.one(
      `SELECT count(*)::int n, COALESCE(sum(CASE WHEN is_correct THEN 1 ELSE 0 END),0)::int correct, COALESCE(sum(CASE WHEN is_correct=false THEN 1 ELSE 0 END),0)::int wrong,
              COALESCE(round(sum(COALESCE(time_spent_seconds,0))/60.0),0)::int minutes
         FROM answer_records WHERE user_id=$1 AND ${studyDaySql('answered_at', '$4')} BETWEEN $2::date AND $3::date`, [userId, from, to, tz]))!;
  }

  private async mockNightly(ctx: ToolCtx & { collected: any[] }, today: string, reason = '每晚 23:00 自动复盘'): Promise<RunResult> {
    const s = await this.dayStats(ctx.userId, today, today);
    const due = (await this.tools.getWrongQuestions(ctx, { limit: 5 })).items.filter((w: any) => w.due_at && Date.parse(w.due_at) < Date.now() + 86400000 * 1.5);
    // 主动消息只给「明天最重要的一件事」（headline），数据和其他细节放 details（前端默认折叠）
    const tl = dayLabelOf(addDays(today, 1), today); // 「明天（11-02）」：相对学习日（凌晨 0–4 点跑也还是前一天的复盘）
    // 都写成「<日期>先…」：存成 {{date:…|plan}}，过了那天再读渲染成「11-02（周一）当天计划重做…」（时态跟着读的人的学习日走）
    const td = dayLabelOf(today, today);
    const text = due.length ? `${tl}先重做 ${due.length} 道到期错题。` : s.wrong ? `${tl}先把${td}错的 ${s.wrong} 题再做一遍。` : s.n ? `${tl}先按计划推进，做最弱的知识点。` : `${tl}先做一组 5 道基础题。`;
    const en = (await this.time.earlyNoteOnce(ctx.userId)) ?? ''; // 凌晨 0–4 点跑复盘：说明还算前一天（每个学习日只说一次）
    const details = en + (s.n ? `${td}做了 ${s.n} 题，对 ${s.correct} 题${s.wrong ? `、错 ${s.wrong} 题` : ''}，${minutesText(s.minutes)}。` : `${td}还没有作答记录。`);
    await this.tools.writeDailyTip(ctx, { kind: 'review', date: today, text, details, reason, source: 'mock' });
    const tomorrow = addDays(today, 1);
    if (due.length) {
      const plan = await this.db.one(
        `SELECT 1 FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id WHERE p.user_id=$1 AND p.plan_date=$2 AND t.kind='redo_wrong' AND t.changed_by_agent`, [ctx.userId, tomorrow]);
      if (!plan) await this.tools.updateDailyPlan(ctx, {
        date: tomorrow, why_changed: `复盘：有 ${due.length} 道错题到了复习时间，${tl}先重做。`,
        add_tasks: [{ kind: 'redo_wrong', title: `重做 ${due.length} 道到期错题`, payload: { question_ids: due.map((w: any) => w.question_id) }, estimated_minutes: due.length * 8 }],
      });
    }
    return { mode: 'mock', summary: ctx.collected.map((a) => a.summary).join('；'), reply: text, actions: ctx.collected, steps: 0 };
  }

  private async mockWeekly(ctx: ToolCtx & { collected: any[] }, today: string, reason = '每周日 21:30 自动周报'): Promise<RunResult> {
    const wk = weekOf(today); // 本周 = 自然周（周一–周日）；进行中写成「本周（11-02 起）」
    const s = await this.dayStats(ctx.userId, wk.from, today);
    const p = await this.tools.getProfile(ctx);
    const weak = p.weakest_kps.slice(0, 2).map((k: any) => k.kp_path.split('/').pop());
    // 「下周重点：…」存成 {{nextweek:…}}（toPlaceholders 自动换），下周开始后读成「当时定的下周重点：…」
    const head = weak.length ? `下周重点：补「${weak[0]}」。` : s.n ? '下周重点：保持节奏，先清到期错题。' : '下周重点：每天先做 5 道题，把节奏找回来。';
    const text = `本周（${weekOpenLabel(wk.from)}）` + (s.n ? `做了 ${s.n} 题，正确率 ${Math.round((100 * s.correct) / s.n)}%，${minutesText(s.minutes)}。` : '还没有作答记录，也还没有学习时长记录。')
      + (weak.length ? `最需要补的：${weak.join('、')}。` : '')
      + `当前阶段：${PHASE_CN[p.user.phase]}${p.user.days_left != null ? `，距考试 ${p.user.days_left} 天` : ''}。`;
    await this.tools.writeDailyTip(ctx, { kind: 'weekly', date: today, text: head, details: text, reason, source: 'mock' });
    return { mode: 'mock', summary: ctx.collected.map((a) => a.summary).join('；'), reply: head, actions: ctx.collected, steps: 0 };
  }
}
