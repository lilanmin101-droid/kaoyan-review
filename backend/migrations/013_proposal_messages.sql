-- 「先问我」的建议：每次定时任务一条新消息（不再按天合并、不改已确认 / 已忽略的建议）。其它 kind 仍是一天一条。
ALTER TABLE daily_tips DROP CONSTRAINT IF EXISTS daily_tips_user_id_tip_date_kind_key;
CREATE UNIQUE INDEX IF NOT EXISTS daily_tips_one_per_day ON daily_tips(user_id, tip_date, kind) WHERE kind <> 'proposal';
