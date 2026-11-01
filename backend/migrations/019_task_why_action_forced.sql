-- 每条计划任务自己的「为什么改」（后来的改动不再覆盖前面已确认改动的理由）
ALTER TABLE plan_tasks ADD COLUMN IF NOT EXISTS why_changed text;
-- 开发用强制触发（POST /agent/jobs/run force:true）产生的动作
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS forced boolean NOT NULL DEFAULT false;
