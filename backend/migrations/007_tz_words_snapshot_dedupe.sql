-- 单词「今日第 n / 总数」：每个用户每天第一次打开 /words/today 时冻结当天排到的总数（之后不减）
CREATE TABLE IF NOT EXISTS word_day_snapshots (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  scheduled int NOT NULL,
  tz text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
-- 命令栏去重：同一用户 + 同一意图 + 同一目标日期 + 同一任务（类型 + 目标/数量）
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE INDEX IF NOT EXISTS agent_actions_dedupe_idx ON agent_actions(user_id, dedupe_key, created_at DESC) WHERE dedupe_key IS NOT NULL;
