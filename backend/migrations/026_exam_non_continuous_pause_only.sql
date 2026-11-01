-- 026（第 16 轮，统筹者定）：非连续作答只看累计暂停 > 15 分钟，跨 04:00 学习日不再算（整场归开考那天的学习日）。
-- 已交卷的场次全部重算：暂停秒数优先用交卷时存下的 result.paused_seconds，没有就按 pause_log 现算；暂停超过 24 小时自动交卷的一律算非连续
UPDATE exams e SET non_continuous = x.nc,
       result = CASE WHEN e.result IS NULL THEN NULL ELSE jsonb_set(e.result, '{non_continuous}', to_jsonb(x.nc)) END
  FROM (
    SELECT id, (auto_submit_reason = 'paused_too_long') IS TRUE OR COALESCE(
             (result->>'paused_seconds')::numeric,
             (SELECT sum(EXTRACT(EPOCH FROM (COALESCE((p->>'end')::timestamptz, submitted_at) - (p->>'start')::timestamptz))) FROM jsonb_array_elements(COALESCE(pause_log, '[]'::jsonb)) p),
             0) > 900 AS nc
      FROM exams WHERE status = 'submitted'
  ) x
 WHERE x.id = e.id AND e.non_continuous IS DISTINCT FROM x.nc;
