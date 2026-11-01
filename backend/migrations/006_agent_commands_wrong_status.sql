-- 命令栏去重：同一用户 1 分钟内重复发同一句话（规范化后相同）只执行一次，第二次回放第一次的结果
CREATE TABLE IF NOT EXISTS agent_commands (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        text NOT NULL,
  norm_text   text NOT NULL,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
  events      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- 回放用：[{event,data}]
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_commands_user_norm ON agent_commands(user_id, norm_text, created_at DESC);

-- 错题本状态流转：active →（做对/自评全对）mastered + 排复习 → 到期再做对 archived；任何时候做错 → active
ALTER TABLE wrong_questions ADD COLUMN IF NOT EXISTS mastered_at timestamptz;
ALTER TABLE wrong_questions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE wrong_questions ADD COLUMN IF NOT EXISTS correct_streak int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS wrong_questions_user_status ON wrong_questions(user_id, status, due_at);

-- 错因加「粗心/手滑」（careless）：「这题我会，是手滑」→ 记粗心，不降掌握度
ALTER TABLE wrong_questions DROP CONSTRAINT IF EXISTS wrong_questions_error_type_check;
ALTER TABLE wrong_questions ADD CONSTRAINT wrong_questions_error_type_check CHECK (error_type IN ('concept','calc','reading','method','careless'));

-- 主动消息（夜间复盘/周报）：只给一条明天最重要的事（headline），细节折叠（details）；记送达/已读，用于自动减少打扰
ALTER TABLE daily_tips ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE daily_tips ADD COLUMN IF NOT EXISTS details text;
ALTER TABLE daily_tips ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE daily_tips ADD COLUMN IF NOT EXISTS seen_at timestamptz;

-- 主动提醒频率：normal = 每晚复盘；reduced = 每 N 天一次（周报照常）。改动都记 agent_actions（target_kind=proactive），可撤回
ALTER TABLE users ADD COLUMN IF NOT EXISTS proactive jsonb NOT NULL DEFAULT '{"mode":"normal","nightly_every_days":1}'::jsonb;
