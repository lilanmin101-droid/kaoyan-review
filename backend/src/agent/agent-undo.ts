import { PoolClient } from 'pg';

/** 撤回新增目标类型（agent.service.ts 的 undo 调用） */
export async function undoExtraKinds(c: PoolClient, a: any): Promise<boolean> {
  switch (a.target_kind) {
    case 'user_phase':
      await c.query('UPDATE users SET phase=$2, updated_at=now() WHERE id=$1', [a.target_id, a.before?.phase ?? 'foundation']);
      return true;
    case 'daily_tip':
      if (a.before == null) await c.query('DELETE FROM daily_tips WHERE id=$1', [a.target_id]);
      else await c.query('UPDATE daily_tips SET text=$2, source=$3, updated_at=now() WHERE id=$1', [a.target_id, a.before.text, a.before.source ?? 'agent']);
      return true;
    case 'careless_mark':
      // 恢复错因和掌握度原值
      await c.query('UPDATE wrong_questions SET error_type=$2, error_type_by=$3, updated_at=now() WHERE id=$1', [a.target_id, a.before?.wrong?.error_type ?? null, a.before?.wrong?.error_type_by ?? null]);
      for (const m of a.before?.mastery ?? []) await c.query(
        'UPDATE mastery SET attempts=$3, correct=$4, recent_acc=$5, score=$6, updated_at=now() WHERE user_id=$1 AND kp_path=$2',
        [m.user_id, m.kp_path, m.attempts, m.correct, m.recent_acc, m.score]);
      return true;
    case 'proactive':
      await c.query('UPDATE users SET proactive=$2, updated_at=now() WHERE id=$1', [a.target_id, JSON.stringify(a.before?.proactive ?? { mode: 'normal', nightly_every_days: 1 })]);
      return true;
    default:
      return false;
  }
}
