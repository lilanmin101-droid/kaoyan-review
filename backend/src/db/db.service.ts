import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX || 20), connectionTimeoutMillis: 10000 });

  constructor() {
    // 空闲连接出错（比如数据库重启）时 pg 会发 'error' 事件；不监听的话整个进程会崩，前端代理就报 502
    this.pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  }

  query<T extends QueryResultRow = any>(sql: string, params: any[] = []) {
    return this.pool.query<T>(sql, params);
  }

  async one<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<T | null> {
    const r = await this.pool.query<T>(sql, params);
    return r.rows[0] ?? null;
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      // ROLLBACK 本身失败（连接已断）不能盖掉原来的错误；坏连接直接销毁
      try { await c.query('ROLLBACK'); } catch (re: any) { console.error('[db] rollback failed:', re.message); }
      throw e;
    } finally {
      c.release();
    }
  }

  /** 记一条同步变更，供其他设备 GET /sync 拉取 */
  async recordChange(c: PoolClient | Pool, userId: string, entity: string, entityId: string, op: 'upsert' | 'delete', data: any, device?: string) {
    await c.query(`INSERT INTO sync_changes(user_id,entity,entity_id,op,data,device) VALUES($1,$2,$3,$4,$5,$6)`,
      [userId, entity, entityId, op, data == null ? null : JSON.stringify(data), device ?? null]);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
