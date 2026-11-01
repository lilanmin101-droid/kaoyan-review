-- 022：命令去重按「有效的现在」（X-Debug-Now 也算）和学习日：只在同一学习日、60 秒内才算重复；换了学习日一律重新执行
ALTER TABLE agent_commands ADD COLUMN IF NOT EXISTS eff_at timestamptz;
ALTER TABLE agent_commands ADD COLUMN IF NOT EXISTS study_date date;
