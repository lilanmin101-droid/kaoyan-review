import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { PlansService } from '../plans/plans.service';
import { undoExtraKinds } from './agent-undo';
import { UserTimeService } from '../common/user-time.service';
import { placeholdersDeep, toPlaceholders } from '../common/time';

export interface ActionInput {
  commandId?: string | null;
  /** 同组的动作一次撤回；不给就用 commandId，两者都没有 = 单独一条 */
  groupId?: string | null;
  trigger?: string;
  tool: string;
  summary: string;
  reason: string;
  target: { kind: string; id: string | null };
  before: any;
  after: any;
  undoable?: boolean;
  /** 去重键（意图 + 目标日期 + 任务），见 AgentToolsService.planDedupeKey */
  dedupeKey?: string | null;
}

/** 操作日志 + 撤回。Agent 的所有写操作都必须走 log()，首页的改动记录和撤回都靠它。 */
@Injectable()
export class AgentActionsService {
  constructor(private db: DbService, private plans: PlansService, private time: UserTimeService) {}

  static toApi(r: any) {
    return {
      id: r.id, command_id: r.command_id, group_id: r.group_id ?? null, trigger: r.trigger, tool: r.tool, summary: r.summary, reason: r.reason,
      target: { kind: r.target_kind, id: r.target_id }, before: r.before, after: r.after,
      undoable: r.undoable && !r.undone_at, undone_at: r.undone_at, created_at: r.created_at, forced: !!r.forced,
    };
  }

  async log(c: PoolClient, userId: string, a: ActionInput) {
    // 日期存成占位符 {{date:YYYY-MM-DD}}，读的时候按读者当时的学习日渲染成「明天（11-02）」/「11-02（周一）」
    const ref = await this.time.today(userId);
    // before / after 快照（建议文案、计划说明…）也存占位符，读时渲染；ISO 日期、时间戳、题号不受影响
    a = { ...a, summary: toPlaceholders(a.summary, ref) as string, reason: toPlaceholders(a.reason, ref) as string, before: placeholdersDeep(a.before, ref), after: placeholdersDeep(a.after, ref) };
    const r = (await c.query(
      `INSERT INTO agent_actions(user_id,command_id,trigger,tool,summary,reason,target_kind,target_id,before,after,undoable,dedupe_key,group_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [userId, a.commandId ?? null, a.trigger ?? 'command', a.tool, a.summary, a.reason, a.target.kind, a.target.id,
        a.before == null ? null : JSON.stringify(a.before), a.after == null ? null : JSON.stringify(a.after), a.undoable ?? true, a.dedupeKey ?? null, a.groupId ?? a.commandId ?? null])).rows[0];
    return AgentActionsService.toApi(r);
  }

  /**
   * 一组动作 → 「教练改过的」里的一条：id / summary / reason / target 取主动作（改任务优先，「更新了计划的说明」这种附带的不单独显示），
   * actions 是组内全部动作（按发生顺序），action_count 条数。旧数据没有 group_id 的就是单独一条（actions 只有自己）。
   */
  static toEntry(rows: any[]) {
    const all = rows.map(AgentActionsService.toApi);
    const main = all.filter((a) => a.target.kind !== 'plan');
    const primary = main[0] ?? all[0];
    const summaries = [...new Set((main.length ? main : all).map((a) => a.summary))];
    const live = all.filter((a) => !a.undone_at);
    return {
      ...primary,
      summary: summaries.join('；'),
      undoable: live.some((a) => a.undoable),
      undone_at: live.length ? null : all.map((a) => a.undone_at).sort().pop() ?? null,
      created_at: all[0].created_at,
      action_count: all.length,
      actions: all,
    };
  }

  /** 操作日志：默认一组一条（group_id 相同的合并）；flat=true 时按旧格式一条动作一行 */
  async list(userId: string, limit = 30, includeUndone = true, flat = false) {
    if (flat) return (await this.db.query(
      `SELECT * FROM agent_actions WHERE user_id=$1 ${includeUndone ? '' : 'AND undone_at IS NULL'} ORDER BY created_at DESC LIMIT $2`, [userId, limit])).rows.map(AgentActionsService.toApi);
    const rows = (await this.db.query(
      `WITH g AS (SELECT COALESCE(group_id, id) k, max(created_at) m FROM agent_actions WHERE user_id=$1 ${includeUndone ? '' : 'AND undone_at IS NULL'}
                  GROUP BY 1 ORDER BY m DESC LIMIT $2)
       SELECT a.*, g.k grp, g.m FROM agent_actions a JOIN g ON COALESCE(a.group_id, a.id) = g.k
        WHERE a.user_id=$1 ${includeUndone ? '' : 'AND a.undone_at IS NULL'} ORDER BY g.m DESC, g.k, a.seq`, [userId, limit])).rows;
    const out: any[] = []; let cur: any[] = [];
    for (const r of rows) { if (cur.length && cur[0].grp !== r.grp) { out.push(AgentActionsService.toEntry(cur)); cur = []; } cur.push(r); }
    if (cur.length) out.push(AgentActionsService.toEntry(cur));
    return out;
  }

  /** 某条动作所在的那一组（首页「为什么改」用） */
  async entryOf(userId: string, id: string) {
    const rows = (await this.db.query(
      `SELECT * FROM agent_actions WHERE user_id=$1 AND COALESCE(group_id, id) = (SELECT COALESCE(group_id, id) FROM agent_actions WHERE id=$2 AND user_id=$1) ORDER BY seq`, [userId, id])).rows;
    return rows.length ? AgentActionsService.toEntry(rows) : null;
  }

  /**
   * 撤回：传组里任意一条的 id，整组一起撤（倒序、同一个事务，任何一条失败整组都不撤）。
   * 已经单独撤过的组员跳过；不能撤回的组员（undoable=false）保留。返回撤回后的那一条（同 list 的形状）+ undone_action_ids。
   */
  async undo(userId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException({ message: '这条操作不存在，刷新一下再试', code: 'action_not_found' });
    return this.db.tx(async (c) => {
      const a = (await c.query('SELECT * FROM agent_actions WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, userId])).rows[0];
      if (!a) throw new NotFoundException({ message: '这条操作不存在，刷新一下再试', code: 'action_not_found' });
      if (a.undone_at) throw new ConflictException({ message: '这条已经撤回过了', code: 'already_undone' });
      if (!a.undoable) throw new ConflictException({ message: '这条操作不能撤回', code: 'not_undoable' });
      const members = a.group_id
        ? (await c.query(`SELECT * FROM agent_actions WHERE user_id=$1 AND group_id=$2 AND undone_at IS NULL AND undoable ORDER BY seq DESC FOR UPDATE`, [userId, a.group_id])).rows
        : [a];
      const undone: string[] = [];
      for (const m of members) {
        await this.undoOne(c, userId, m);
        await c.query('UPDATE agent_actions SET undone_at=now() WHERE id=$1', [m.id]);
        undone.push(m.id);
      }
      const rows = (await c.query(`SELECT * FROM agent_actions WHERE user_id=$1 AND COALESCE(group_id, id)=$2 ORDER BY seq`, [userId, a.group_id ?? a.id])).rows;
      return { ...AgentActionsService.toEntry(rows), undone_action_ids: undone };
    });
  }

  /** 撤回单条：按 before 恢复；before 为空表示这次是新增，撤回就是把新增的东西拿掉 */
  private async undoOne(c: PoolClient, userId: string, a: any) {
      switch (a.target_kind) {
        case 'plan_task':
          if (a.before == null) await c.query('DELETE FROM plan_tasks WHERE id=$1', [a.target_id]);
          else await c.query(`UPDATE plan_tasks SET title=$2, payload=$3, sort_order=$4, status=$5, estimated_minutes=$6, changed_by_agent=$7, why_changed=$8, updated_at=now() WHERE id=$1`,
            [a.target_id, a.before.title, JSON.stringify(a.before.payload ?? {}), a.before.sort_order, a.before.status, a.before.estimated_minutes, a.before.changed_by_agent ?? false, a.before.why_changed ?? null]);
          await this.db.recordChange(c, userId, 'plan_task', a.target_id, a.before == null ? 'delete' : 'upsert', a.before);
          break;
        case 'plan':
          await c.query(`UPDATE study_plans SET why_changed=$2, changed_by_agent=$3, updated_at=now() WHERE id=$1`,
            [a.target_id, a.before?.why_changed ?? null, a.before?.changed_by_agent ?? false]);
          break;
        case 'wrong_question':
          if (a.before == null) {
            // addReviewCard 新建的卡片：没有笔记就删掉这张卡片；有笔记（用户后来写的）只归档，不删笔记
            const del = await c.query(`DELETE FROM wrong_questions WHERE id=$1 AND note IS NULL AND wrong_count=0`, [a.target_id]);
            if (!del.rowCount) await c.query(`UPDATE wrong_questions SET status='archived', updated_at=now() WHERE id=$1`, [a.target_id]);
            await this.db.recordChange(c, userId, 'wrong_question', a.target_id, del.rowCount ? 'delete' : 'upsert', null);
          } else {
            await c.query(`UPDATE wrong_questions SET status=$2, error_type=$3, error_type_by=$4, due_at=COALESCE($5::timestamptz, due_at), updated_at=now() WHERE id=$1`,
              [a.target_id, a.before?.status ?? 'active', a.before?.error_type ?? null, a.before?.error_type_by ?? null, a.before?.due_at ?? null]);
            await this.db.recordChange(c, userId, 'wrong_question', a.target_id, 'upsert', a.before);
          }
          break;
        case 'reminder':
          if (a.before == null) await c.query('DELETE FROM reminders WHERE id=$1', [a.target_id]);
          else await c.query('UPDATE reminders SET text=$2, updated_at=now() WHERE id=$1', [a.target_id, a.before.text]);
          break;
        case 'goal':
          await c.query(`UPDATE goals SET status=$2, subtasks=$3, phase=$4, updated_at=now() WHERE id=$1`,
            [a.target_id, a.before?.status ?? 'cancelled', JSON.stringify(a.before?.subtasks ?? []), a.before?.phase ?? 'foundation']);
          break;
        default:
          if (!(await undoExtraKinds(c, a))) throw new ConflictException({ message: '这类改动暂时不能撤回', code: 'not_undoable', target_kind: a.target_kind });
      }
  }
}
