import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DbService } from '../db/db.service';
import { Interval } from './exam-clock';

/** 后端开机 / 心跳记录（每 15 秒一次，开机时一次）：把各次运行区间并起来，中间的空洞 = 后端停机，模考补时 */
export const UPTIME_BEAT_MS = 15_000;
@Injectable()
export class UptimeService implements OnModuleInit, OnApplicationShutdown {
  private log = new Logger('Uptime');
  readonly bootId = randomUUID();
  private timer?: NodeJS.Timeout;
  private cache?: { at: number; gaps: Interval[] };
  constructor(private db: DbService) {}
  async onModuleInit() {
    try {
      await this.db.query(`INSERT INTO server_uptime(boot_id, started_at, last_beat_at, port) VALUES($1, now(), now(), $2)`, [this.bootId, Number(process.env.PORT) || null]);
      this.timer = setInterval(() => this.beat(), UPTIME_BEAT_MS); this.timer.unref();
    } catch (e: any) { this.log.warn(`uptime log unavailable: ${e?.message}`); }
  }
  async beat() { try { await this.db.query(`UPDATE server_uptime SET last_beat_at=now() WHERE boot_id=$1`, [this.bootId]); } catch { /* 下次再记 */ } }
  async onApplicationShutdown() { if (this.timer) clearInterval(this.timer); await this.beat(); }
  /** 停机区间（真实时间，毫秒）：运行区间并集之间的空洞；最后一段之后算「现在在跑」 */
  async gaps(): Promise<Interval[]> {
    if (this.cache && Date.now() - this.cache.at < UPTIME_BEAT_MS) return this.cache.gaps;
    let rows: any[] = [];
    try { rows = (await this.db.query(`SELECT started_at, last_beat_at FROM server_uptime ORDER BY started_at`)).rows; } catch { return []; }
    const out: Interval[] = [];
    let covered = -Infinity;
    for (const r of rows) {
      const s = new Date(r.started_at).getTime(), e = new Date(r.last_beat_at).getTime();
      if (covered > -Infinity && s - covered > UPTIME_BEAT_MS * 2) out.push([covered, s]); // 少于两次心跳的抖动不算停机
      covered = Math.max(covered, e);
    }
    this.cache = { at: Date.now(), gaps: out };
    return out;
  }
}
