-- 003：AI / Agent 层
-- 讲解：双模型不一致时状态为 needs_review（前端显示「这题讲解待核对」）
ALTER TABLE ai_explanations DROP CONSTRAINT IF EXISTS ai_explanations_status_check;
ALTER TABLE ai_explanations ADD CONSTRAINT ai_explanations_status_check
  CHECK (status IN ('draft','published','pending_review','needs_review','rejected'));
CREATE INDEX IF NOT EXISTS ai_explanations_q_idx ON ai_explanations(question_id, version DESC);

-- 复习阶段（switchPhase 写这里；goals.phase 仍保留给目标本身）
ALTER TABLE users ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'foundation'
  CHECK (phase IN ('foundation','intensive','sprint'));

-- 每日一句 / 复盘 / 周报（writeDailyTip、夜间复盘、周报都写这里）
CREATE TABLE IF NOT EXISTS daily_tips (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tip_date   date NOT NULL,
  kind       text NOT NULL DEFAULT 'tip' CHECK (kind IN ('tip','review','weekly')),
  text       text NOT NULL,
  source     text NOT NULL DEFAULT 'agent',   -- agent / mock / user
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tip_date, kind)
);

-- 定时任务运行记录（防重复执行 + 排错）
CREATE TABLE IF NOT EXISTS job_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job         text NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  run_key     text NOT NULL,          -- job:user:日期，同一天同一任务只跑一次（手动触发不受限）
  mode        text NOT NULL,          -- ai / mock
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  detail      jsonb NOT NULL DEFAULT '{}',
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS job_runs_key_idx ON job_runs(run_key);
