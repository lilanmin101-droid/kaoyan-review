import { z } from 'zod';
import { AgentToolsService, ToolCtx } from './agent-tools.service';
import { TASK_KINDS } from '../plans/plans.service';

// Mastra 的包是 exports 子路径，tsconfig 用的是 node10 解析，这里用 require 引入（运行时 CJS 版本）
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createTool } = require('@mastra/core/tools');

/** 工具名 → SSE step 里给用户看的中文 */
export const TOOL_LABEL: Record<string, string> = {
  getProfile: '正在读你的学习档案',
  getWrongQuestions: '正在翻你的错题本',
  getAnswerHistory: '正在看你最近的作答记录',
  searchQuestions: '正在题库里找合适的题',
  updateDailyPlan: '正在调整学习计划',
  addReviewCard: '正在把题加入复习',
  upsertReminder: '正在写「下次记住」',
  switchPhase: '正在切换复习阶段',
  writeDailyTip: '正在写给你的话',
  markCareless: '正在把这题记成粗心',
  setProactive: '正在调整提醒频率',
};

/** 包一层：工具报错时把错误信息还给模型（让它改参数重试），而不是让整个运行崩掉 */
const safe = (fn: (i: any) => Promise<any>) => async (input: any) => {
  try { return await fn(input ?? {}); } catch (e: any) { return { error: e.message ?? String(e) }; }
};

/** 为一次运行构造工具（闭包里带着 userId / commandId，模型无法越权操作别人的数据） */
export function buildMastraTools(svc: AgentToolsService, ctx: ToolCtx) {
  const kind = z.enum(TASK_KINDS as [string, ...string[]]);
  return {
    getProfile: createTool({
      id: 'getProfile',
      description: '读取学习档案：考试日期与剩余天数、当前阶段、最弱的知识点、错因统计、高效时段、目标、近 7 天作答统计。做任何计划调整前先调用。',
      inputSchema: z.object({}),
      execute: safe(() => svc.getProfile(ctx)),
    }),
    getWrongQuestions: createTool({
      id: 'getWrongQuestions',
      description: '读取错题本里未掌握的错题（按到期时间排序）。可按知识点路径前缀过滤，如「高等数学/函数、极限、连续」。',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional(),
        kp_prefix: z.string().optional().describe('知识点路径前缀'),
        due_only: z.boolean().optional().describe('只看已到复习时间的'),
        wrong_from: z.string().optional().describe('YYYY-MM-DD（用户时区）：只要这天起做错的题。「昨天的错题」「上周的错题」用它筛，不是排到那天'),
        wrong_to: z.string().optional().describe('YYYY-MM-DD：筛选截止日（含），不给 = 同 wrong_from'),
      }),
      execute: safe((i) => svc.getWrongQuestions(ctx, i)),
    }),
    getAnswerHistory: createTool({
      id: 'getAnswerHistory',
      description: '读取最近 N 天的作答：按天汇总（题数、对题数、用时）和最近的作答明细。',
      inputSchema: z.object({
        days: z.number().int().min(1).max(90).optional(),
        kp_prefix: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: safe((i) => svc.getAnswerHistory(ctx, i)),
    }),
    searchQuestions: createTool({
      id: 'searchQuestions',
      description: '在真题库里按知识点（路径中的任意片段，如「极限」「二重积分」）、卷种（math1/math2/math3/english1/english2/politics）、年份、题号、题型找题。',
      inputSchema: z.object({
        kp: z.string().optional(),
        exam: z.string().optional(),
        year: z.number().int().optional(),
        number: z.number().int().optional(),
        type: z.string().optional().describe('single_choice / fill_blank / essay ...'),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: safe((i) => svc.searchQuestions(ctx, i)),
    }),
    updateDailyPlan: createTool({
      id: 'updateDailyPlan',
      description: '修改某天的学习计划：加任务、调整任务（标题/顺序/时长/跳过）。不能删除任务。必须写 why_changed（一句话告诉用户为什么改，会显示在首页第一行）。每个改动都会记录并可撤回。',
      inputSchema: z.object({
        date: z.string().optional().describe('YYYY-MM-DD，默认今天（按用户时区）。只有用户明确说明天/后天，或把今天放不下的任务挪走时才填别的日期，并在 why_changed 里写明'),
        why_changed: z.string().min(2),
        add_tasks: z.array(z.object({
          kind,
          title: z.string(),
          payload: z.record(z.string(), z.any()).optional().describe('如 {question_ids:[...]} 或 {kp:"...", count:5}'),
          estimated_minutes: z.number().int().optional(),
          position: z.enum(['top', 'bottom']).optional(),
          mode: z.enum(['add', 'set']).optional().describe('数量语义：用户说「加/再/多/补 N 道」用 add（在今天已有的同类任务上加 N）；只说「今天重做 N 道」用 set（设成 N）。配合 quantity 用，payload.question_ids 给候选题'),
          quantity: z.number().int().min(1).max(50).optional().describe('用户说的数量，一道=1、两道=2；没说默认 3'),
        })).optional(),
        update_tasks: z.array(z.object({
          id: z.string(),
          title: z.string().optional(),
          sort_order: z.number().int().optional(),
          estimated_minutes: z.number().int().optional(),
          status: z.enum(['todo', 'skipped']).optional(),
        })).optional(),
      }),
      execute: safe((i) => svc.updateDailyPlan(ctx, i)),
    }),
    addReviewCard: createTool({
      id: 'addReviewCard',
      description: '把一道题加入（或提前）复习队列。',
      inputSchema: z.object({ question_id: z.string(), reason: z.string(), due: z.enum(['now', 'tomorrow']).optional() }),
      execute: safe((i) => svc.addReviewCard(ctx, i)),
    }),
    upsertReminder: createTool({
      id: 'upsertReminder',
      description: '给一道题写/改「下次记住」：一句话、可操作，如「看到 0·∞ 先化成分式」。',
      inputSchema: z.object({ question_id: z.string(), text: z.string().max(80), reason: z.string() }),
      execute: safe((i) => svc.upsertReminder(ctx, i)),
    }),
    switchPhase: createTool({
      id: 'switchPhase',
      description: '切换复习阶段：foundation 基础 / intensive 强化 / sprint 冲刺。',
      inputSchema: z.object({ phase: z.enum(['foundation', 'intensive', 'sprint']), reason: z.string() }),
      execute: safe((i) => svc.switchPhase(ctx, i)),
    }),
    writeDailyTip: createTool({
      id: 'writeDailyTip',
      description: '写首页的一段话：tip 今日一句（≤60 字）/ review 今日复盘 / weekly 本周周报。review/weekly 是主动消息：text 只写一件明天最重要的事（一句话，≤40 字），其余细节放 details（前端默认折叠）。',
      inputSchema: z.object({
        text: z.string(), kind: z.enum(['tip', 'review', 'weekly']).optional(),
        date: z.string().optional().describe('YYYY-MM-DD，默认今天'), reason: z.string().optional(),
        details: z.string().optional().describe('折叠的细节（数据、其他建议），可不填'),
      }),
      execute: safe((i) => svc.writeDailyTip(ctx, i)),
    }),
    markCareless: createTool({
      id: 'markCareless',
      description: '用户说某道错题「我会，是手滑/粗心」时用：错因记为 careless，并退回这次做错对掌握度的扣分。不传 question_id 就用最近一道做错的题。',
      inputSchema: z.object({ question_id: z.string().optional(), reason: z.string().optional() }),
      execute: safe((i) => svc.markCareless(ctx, i)),
    }),
    setProactive: createTool({
      id: 'setProactive',
      description: '调整主动提醒频率。用户说「别管我/别催了/少提醒」时 mode=reduced（每晚复盘改成每 every_days 天一次，周报照常）；用户重新要你帮忙时 mode=normal。只能调低或恢复，不能更频繁。',
      inputSchema: z.object({ mode: z.enum(['normal', 'reduced']), every_days: z.number().int().min(2).max(7).optional(), reason: z.string() }),
      execute: safe((i) => svc.setProactive(ctx, { ...i, cause: 'command' })),
    }),
  };
}
