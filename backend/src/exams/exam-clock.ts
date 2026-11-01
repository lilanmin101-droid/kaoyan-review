/**
 * 模考计时（第 14 轮，统筹者定）：按墙上时钟走，离开 / 锁屏 / 断网照样计时。
 * elapsed = clock_baseline_seconds + (now - clock_origin) - 明确暂停的时长 - 后端停机补时 - 这场请求 5xx 补时。
 * 心跳只同步答案，不再参与计时（去掉了「两次保存之间最多计 120 秒」）。
 */
export type Interval = [number, number];
export interface PauseEntry { start: string; end: string | null; legacy?: boolean }
export interface ClockInput {
  duration_seconds: number; started_at: string | Date; clock_origin?: string | Date | null; clock_baseline_seconds?: number | null;
  pause_log?: PauseEntry[] | null; error_credit_seconds?: number | null;
}
const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
export function examClock(r: ClockInput, nowMs: number, gaps: Interval[] = []) {
  const origin = new Date(r.clock_origin ?? r.started_at).getTime();
  const end = Math.max(nowMs, origin);
  const log = r.pause_log ?? [];
  const pauses: Interval[] = log.map((p) => [Date.parse(p.start), p.end ? Date.parse(p.end) : end] as Interval)
    .map(([a, b]) => [Math.max(a, origin), Math.min(b, end)] as Interval).filter(([a, b]) => b > a);
  const pausedMs = pauses.reduce((t, p) => t + (p[1] - p[0]), 0);
  // 停机补时：停机区间 ∩ [origin, now]，再扣掉和暂停重叠的部分（不重复补）
  let outageMs = 0;
  for (const g of gaps) { outageMs += overlap(g, [origin, end]); for (const p of pauses) outageMs -= overlap(g, p); }
  outageMs = Math.max(0, outageMs);
  const outage = Math.floor(outageMs / 1000), errCredit = r.error_credit_seconds ?? 0;
  const elapsed = Math.max(0, Math.floor((r.clock_baseline_seconds ?? 0) + (end - origin - pausedMs) / 1000 - outage - errCredit));
  return {
    elapsed_seconds: elapsed, remaining_seconds: Math.max(r.duration_seconds - elapsed, 0),
    pause_count: log.length, paused_seconds: Math.floor(pausedMs / 1000), paused_now: log.some((p) => !p.end),
    server_credit_seconds: outage + errCredit,
  };
}
export const pauseNote = (count: number, seconds: number) => (count ? `中途暂停 ${count} 次，共 ${Math.round(seconds / 60)} 分钟` : null);
