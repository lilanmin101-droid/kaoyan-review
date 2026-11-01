-- 009：「我的」页教练设置
-- nudge = coach_frequency=more 时中午的进度提醒；proposal = coach_frequency=ask 时教练的待确认建议（proposal 列存要执行的工具调用）
ALTER TABLE daily_tips DROP CONSTRAINT IF EXISTS daily_tips_kind_check;
ALTER TABLE daily_tips ADD CONSTRAINT daily_tips_kind_check CHECK (kind IN ('tip','review','weekly','exam_review','nudge','proposal'));
ALTER TABLE daily_tips ADD COLUMN IF NOT EXISTS proposal jsonb;
-- 中午提醒 / 用户确认建议后执行，都记 agent_actions
ALTER TABLE agent_actions DROP CONSTRAINT IF EXISTS agent_actions_trigger_check;
ALTER TABLE agent_actions ADD CONSTRAINT agent_actions_trigger_check CHECK (trigger IN ('command','nightly','after_exam','weekly','phase_check','event','midday','confirm'));
-- 免打扰排队：delivered_at 可能在将来
CREATE INDEX IF NOT EXISTS daily_tips_user_delivered_idx ON daily_tips(user_id, delivered_at);
