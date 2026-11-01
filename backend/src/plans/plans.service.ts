import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

export const TASK_KINDS = ['practice', 'redo_wrong', 'variant', 'mock_exam', 'words', 'review_cards', 'feynman', 'essay', 'custom'];

/**
 * 计划的「为什么改」：每条任务记自己的理由（plan_tasks.why_changed），这里把还在计划里的（没跳过的）理由按最近改动在前拼起来，
 * 后来的改动不会把前面已确认改动的理由覆盖掉。老数据任务上没有理由 → 用计划上的那一句。
 */
export function composeWhy(planWhy: string | null, tasks: { why_changed?: string | null; status?: string; updated_at?: any; changed_by_agent?: boolean }[]) {
  return whyOf(planWhy, tasks).all;
}
/**
 * 这一天计划的「为什么改」只看这一天的任务：all = 没跳过的任务各自的理由（新的在前）拼起来，latest = 最近一条。
 * 都没有理由 → null（别的日子的改动不算进来）。老数据（任务没有自己的 why_changed、但有教练改过的任务）才退回计划上那句。
 */
export function whyOf(planWhy: string | null, tasks: { why_changed?: string | null; status?: string; updated_at?: any; changed_by_agent?: boolean }[]) {
  const live = tasks.filter((t) => t.status !== 'skipped');
  const whys = [...live].filter((t) => t.why_changed)
    .sort((a, b) => +new Date(b.updated_at ?? 0) - +new Date(a.updated_at ?? 0)).map((t) => t.why_changed!.trim());
  const end = (x: string) => (/[。！？.!?]$/.test(x) ? x : `${x}。`);
  if (!whys.length) {
    const legacy = planWhy && live.some((t) => t.changed_by_agent && t.why_changed == null) ? planWhy : null;
    return { all: legacy, latest: legacy };
  }
  const uniq = [...new Set(whys)];
  return { all: uniq.map(end).join(''), latest: whys[0] };
}

@Injectable()
export class PlansService {
  constructor(private db: DbService) {}

  async getPlan(userId: string, date: string, c?: PoolClient) {
    const q = c ?? this.db.pool;
    const plan = (await q.query(`SELECT id, to_char(plan_date,'YYYY-MM-DD') plan_date, title, why_changed, changed_by_agent, updated_at FROM study_plans WHERE user_id=$1 AND plan_date=$2`, [userId, date])).rows[0];
    if (!plan) return null;
    const tasks = (await q.query(`SELECT * FROM plan_tasks WHERE plan_id=$1 ORDER BY sort_order, id`, [plan.id])).rows;
    const w = whyOf(plan.why_changed, tasks);
    return { ...plan, why_changed: w.all, why_changed_latest: w.latest, tasks, progress: { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length } };
  }

  async ensurePlan(c: PoolClient, userId: string, date: string) {
    return (await c.query(
      `INSERT INTO study_plans(user_id,plan_date) VALUES($1,$2) ON CONFLICT (user_id,plan_date) DO UPDATE SET updated_at=now() RETURNING id`, [userId, date])).rows[0].id as string;
  }

  /** 用户手动建/覆盖某天的计划（覆盖时用户自己的改动不算 Agent 改动） */
  async upsertPlan(userId: string, b: { plan_date: string; title?: string; tasks?: any[] }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b?.plan_date ?? '')) throw new BadRequestException('plan_date 格式 YYYY-MM-DD');
    for (const t of b.tasks ?? []) if (!TASK_KINDS.includes(t.kind)) throw new BadRequestException(`kind 只能是 ${TASK_KINDS.join('/')}`);
    return this.db.tx(async (c) => {
      const id = await this.ensurePlan(c, userId, b.plan_date);
      await c.query(`UPDATE study_plans SET title=COALESCE($2,title), changed_by_agent=false, why_changed=NULL WHERE id=$1`, [id, b.title ?? null]);
      if (b.tasks) {
        await c.query(`DELETE FROM plan_tasks WHERE plan_id=$1`, [id]);
        let i = 0;
        for (const t of b.tasks) await c.query(
          `INSERT INTO plan_tasks(plan_id,kind,title,payload,sort_order,estimated_minutes,status) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [id, t.kind, t.title, JSON.stringify(t.payload ?? {}), t.sort_order ?? i++, t.estimated_minutes ?? null, t.status ?? 'todo']);
      }
      const plan = await this.getPlan(userId, b.plan_date, c);
      await this.db.recordChange(c, userId, 'study_plan', id, 'upsert', plan);
      return plan;
    });
  }
}
