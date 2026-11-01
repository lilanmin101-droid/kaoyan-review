-- 023：整卷模考按墙上时钟计时（统筹者定）。elapsed = clock_baseline_seconds + (now - clock_origin) - 暂停 - 服务端故障补时
-- 暂停只认明确的「暂停」：pause_log [{start,end}]；学生断网 / 锁屏不补时；后端停机（server_uptime 间隙）和这场请求 5xx 才补。
ALTER TABLE exams ADD COLUMN IF NOT EXISTS clock_origin timestamptz;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS clock_baseline_seconds int NOT NULL DEFAULT 0;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS pause_log jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS error_credit_seconds int NOT NULL DEFAULT 0;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS error_since timestamptz;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS auto_submitted boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS server_uptime (
  boot_id uuid PRIMARY KEY, started_at timestamptz NOT NULL, last_beat_at timestamptz NOT NULL, port int
);
-- 老场次：已经计过的时间当基线，从上线这一刻起按墙上时钟走（不会突然过期）；已暂停的从现在起算一次暂停
UPDATE exams e SET clock_origin = now(),
  clock_baseline_seconds = COALESCE(p.elapsed_seconds, 0) + CASE WHEN e.status='in_progress' AND p.last_tick_at IS NOT NULL THEN LEAST(GREATEST(EXTRACT(EPOCH FROM now() - p.last_tick_at)::int, 0), 120) ELSE 0 END,
  pause_log = CASE WHEN e.status='paused' THEN jsonb_build_array(jsonb_build_object('start', now(), 'end', NULL, 'legacy', true)) ELSE '[]'::jsonb END
  FROM exam_progress p WHERE p.exam_id=e.id AND e.status IN ('in_progress','paused') AND e.clock_origin IS NULL;
UPDATE exams SET clock_origin = started_at WHERE clock_origin IS NULL;
