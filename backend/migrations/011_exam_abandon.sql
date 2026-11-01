-- 考场模式：放弃一场模考（status=abandoned，保留进度，不判分）
ALTER TABLE exams ADD COLUMN IF NOT EXISTS abandoned_at timestamptz;
