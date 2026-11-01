-- 操作日志分组：一次命令 / 一次确认的建议 / 一次定时任务产生的多条 agent_actions 在「教练改过的」里显示成一条，一次撤回整组
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS group_id uuid;
UPDATE agent_actions SET group_id = command_id WHERE group_id IS NULL AND command_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_actions_group_idx ON agent_actions(user_id, group_id);
-- 同一事务里的多条动作 created_at 相同（now() = 事务开始时间），撤回时用 seq 保证严格倒序
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS seq bigserial;
