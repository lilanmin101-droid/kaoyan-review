-- 024：非连续作答（累计暂停 > 15 分钟或跨了 04:00 学习日，不计入模考趋势）+ 自动交卷原因（time_up / paused_too_long）
ALTER TABLE exams ADD COLUMN IF NOT EXISTS non_continuous boolean;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS auto_submit_reason text;
UPDATE exams SET auto_submit_reason='time_up' WHERE auto_submitted AND auto_submit_reason IS NULL;
-- 已交卷的老场次：按暂停记录和开考 / 交卷的学习日（用户时区、04:00 换日）补上
UPDATE exams e SET non_continuous = (
    COALESCE((SELECT sum(EXTRACT(EPOCH FROM (COALESCE((p->>'end')::timestamptz, e.submitted_at) - (p->>'start')::timestamptz))) FROM jsonb_array_elements(e.pause_log) p), 0) > 900
    OR ((e.started_at AT TIME ZONE COALESCE(u.settings->>'timezone', 'Asia/Shanghai')) - interval '4 hours')::date
       <> ((e.submitted_at AT TIME ZONE COALESCE(u.settings->>'timezone', 'Asia/Shanghai')) - interval '4 hours')::date)
  FROM users u WHERE u.id=e.user_id AND e.status='submitted' AND e.non_continuous IS NULL AND e.submitted_at IS NOT NULL;
