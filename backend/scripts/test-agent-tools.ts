/**
 * npm run test:tools —— 直接调用 Agent 的每个写工具，再逐条撤回，检查数据恢复原样（模拟模式，不调模型）。
 * 会新建一个临时用户（不产生作答记录），结束时删除这个用户（级联删掉它的全部测试数据）。
 */
import 'reflect-metadata';
import { loadEnv } from './env';
loadEnv();
process.env.JOBS_ENABLED = '0';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { AgentToolsService, ToolCtx } from '../src/agent/agent-tools.service';
import { AgentActionsService } from '../src/agent/agent.service';
import { addDays, localDate } from '../src/common/time';

function assert(c: any, msg: string) { if (!c) { console.error('FAIL', msg); process.exitCode = 1; throw new Error(msg); } console.log('ok  ', msg); }

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get(DbService), tools = app.get(AgentToolsService), actions = app.get(AgentActionsService);
  const user = await db.one(`INSERT INTO users(username,password_hash) VALUES($1,'x') RETURNING id`, [`tooltest_${Date.now()}`]);
  const uid = user!.id;
  const got: any[] = [];
  const ctx: ToolCtx = { userId: uid, commandId: null, trigger: 'command', onAction: (a) => { got.push(a); } };
  try {
    const p = await tools.getProfile(ctx);
    assert(p.user.phase === 'foundation' && p.stats.wrong_active === 0, 'getProfile');
    const s = await tools.searchQuestions(ctx, { kp: '极限', exam: 'math1', year: 2024 });
    assert(s.count > 0 && s.items.every((i: any) => i.knowledge_points.some((k: string) => k.includes('极限'))), `searchQuestions kp=极限 → ${s.count} 题`);
    const s2 = await tools.searchQuestions(ctx, { exam: 'math1', year: 2024, number: 5 });
    assert(s2.count === 1 && s2.items[0].id === 'math1-2024-05', 'searchQuestions year+number');

    // 用户自己写的错题笔记：撤回不能动它
    const ansBefore = (await db.one(`SELECT count(*)::int n, max(created_at) m FROM answer_records`))!;
    await db.query(`INSERT INTO wrong_questions(user_id,question_id,note,due_at) VALUES($1,'math1-2024-02','我的笔记：符号看错',now()+interval '5 days')`, [uid]);

    const tomorrow = addDays(localDate(), 1);
    await tools.updateDailyPlan(ctx, { date: tomorrow, why_changed: '测试', add_tasks: [{ kind: 'practice', title: '测试任务', estimated_minutes: 10 }] });
    const task = got.find((a) => a.target.kind === 'plan_task');
    await tools.updateDailyPlan(ctx, { date: tomorrow, why_changed: '测试2', update_tasks: [{ id: task.target.id, status: 'skipped', title: '改过的标题' }] });
    await tools.addReviewCard(ctx, { question_id: 'math1-2024-02', reason: '测试提前' });
    await tools.addReviewCard(ctx, { question_id: 'math1-2024-03', reason: '测试新增' });
    await tools.upsertReminder(ctx, { question_id: 'math1-2024-03', text: '先化成分式', reason: '测试' });
    await tools.upsertReminder(ctx, { question_id: 'math1-2024-03', text: '先化成分式再洛必达', reason: '测试改' });
    await tools.switchPhase(ctx, { phase: 'intensive', reason: '测试' });
    await tools.writeDailyTip(ctx, { text: '今天先把极限过一遍', reason: '测试' });
    await tools.writeDailyTip(ctx, { text: '改一下今日一句', reason: '测试' });
    assert(got.length >= 10 && got.every((a) => a.summary && a.reason && a.target?.kind), `写工具产生 ${got.length} 条 agent_actions，都有 summary/reason/target`);
    let bad = 0;
    try { await tools.updateDailyPlan(ctx, { why_changed: 'x', update_tasks: [{ id: task.target.id, status: 'done' as any }] }); } catch { bad++; }
    try { await tools.switchPhase(ctx, { phase: 'final', reason: 'x' }); } catch { bad++; }
    assert(bad === 2, '非法参数被拒绝（Agent 不能把任务标 done、不能写未知阶段）');

    // 倒序全部撤回
    for (const a of [...got].reverse()) await actions.undo(uid, a.id);
    const plan = await db.one(`SELECT p.why_changed, (SELECT count(*)::int FROM plan_tasks t WHERE t.plan_id=p.id) n FROM study_plans p WHERE user_id=$1 AND plan_date=$2`, [uid, tomorrow]);
    assert(plan!.n === 0 && plan!.why_changed === null, '计划恢复原样（新加任务撤掉、说明清空）');
    const w2 = await db.one(`SELECT note, status, due_at > now()+interval '4 days' later FROM wrong_questions WHERE user_id=$1 AND question_id='math1-2024-02'`, [uid]);
    assert(w2 && w2.note === '我的笔记：符号看错' && w2.later, '已有错题：到期时间恢复、笔记保留');
    const w3 = await db.one(`SELECT 1 FROM wrong_questions WHERE user_id=$1 AND question_id='math1-2024-03'`, [uid]);
    assert(!w3, 'addReviewCard 新建的卡片撤回后移除');
    const r = await db.one(`SELECT 1 FROM reminders WHERE user_id=$1`, [uid]);
    assert(!r, 'reminder 撤回（先改回原文，再撤掉新增）');
    const u = await db.one(`SELECT phase FROM users WHERE id=$1`, [uid]);
    assert(u!.phase === 'foundation', '阶段恢复');
    const t = await db.one(`SELECT 1 FROM daily_tips WHERE user_id=$1`, [uid]);
    assert(!t, '今日一句撤回');
    const ans = (await db.one(`SELECT count(*)::int n, max(created_at) m FROM answer_records`))!;
    assert(ans.n === ansBefore.n && String(ans.m) === String(ansBefore.m), '作答记录没被动过');
    try { await actions.undo(uid, got[0].id); assert(false, '二次撤回应 409'); } catch (e: any) { assert(e.status === 409, '二次撤回 409'); }
  } finally {
    // 测试用户没有作答记录，可以直接删（级联删掉它的计划、错题、日志等测试数据）
    await db.query('DELETE FROM users WHERE id=$1', [uid]);
    await app.close();
  }
  console.log(process.exitCode ? 'TOOLS FAILED' : 'TOOLS OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
