import { BadRequestException, Body, Controller, Get, Query, Post, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { LearningService } from '../mastery/learning.service';

/**
 * 两端同步（电脑 ↔ 手机）：
 * - GET  /sync?cursor=N&device=xxx  拉取 cursor 之后的变更（默认排除自己设备推上来的）
 * - POST /sync                      推送离线期间的本地变更，逐条返回是否生效
 * 冲突策略：作答记录只追加（client_id 去重）；其他实体按字段「后写为准」。
 */
@Controller('sync')
@UseGuards(JwtGuard)
export class SyncController {
  constructor(private db: DbService, private learning: LearningService) {}

  @Get()
  async pull(@CurrentUser() u: AuthUser, @Query('cursor') cursor = '0', @Query('device') device?: string, @Query('limit') limit = '500') {
    const lim = Math.min(Number(limit) || 500, 2000);
    const rows = (await this.db.query(
      `SELECT id, entity, entity_id, op, data, device, changed_at FROM sync_changes
        WHERE user_id=$1 AND id > $2 AND ($3::text IS NULL OR device IS DISTINCT FROM $3) ORDER BY id LIMIT $4`,
      [u.id, Number(cursor) || 0, device ?? null, lim + 1])).rows;
    const more = rows.length > lim;
    const items = rows.slice(0, lim);
    const last = (await this.db.one('SELECT COALESCE(max(id),0)::bigint m FROM sync_changes WHERE user_id=$1', [u.id]))!.m;
    return { changes: items.map((r) => ({ ...r, id: Number(r.id) })), next_cursor: more ? Number(items[items.length - 1].id) : Number(last), has_more: more };
  }

  @Post()
  async push(@CurrentUser() u: AuthUser, @Body() b: { device: string; changes: { entity: string; op?: string; client_id?: string; entity_id?: string; data: any }[] }) {
    if (!b?.device) throw new BadRequestException('缺少 device');
    const results: any[] = [];
    for (const ch of b.changes ?? []) {
      try {
        if (ch.entity === 'answer_record') {
          const r = await this.db.tx((c) => this.learning.recordAnswer(c, u.id, { ...ch.data, client_id: ch.client_id ?? ch.data?.client_id }, b.device));
          results.push({ client_id: ch.client_id, status: (r as any).error ? 'rejected' : (r as any).duplicate ? 'duplicate' : 'applied', entity_id: (r as any).id, error: (r as any).error });
        } else if (ch.entity === 'plan_task') {
          const r = await this.db.one(
            `UPDATE plan_tasks t SET status=COALESCE($3,t.status), completed_at=CASE WHEN $3='done' THEN COALESCE($4::timestamptz, now()) ELSE t.completed_at END, updated_at=now()
               FROM study_plans p WHERE t.id=$1 AND t.plan_id=p.id AND p.user_id=$2 RETURNING t.*`, [ch.entity_id, u.id, ch.data?.status ?? null, ch.data?.completed_at ?? null]);
          if (r) await this.db.recordChange(this.db.pool, u.id, 'plan_task', r.id, 'upsert', r, b.device);
          results.push({ client_id: ch.client_id, entity_id: ch.entity_id, status: r ? 'applied' : 'rejected', error: r ? undefined : 'not_found' });
        } else if (ch.entity === 'wrong_question') {
          const r = await this.db.one(
            `UPDATE wrong_questions SET note=COALESCE($3,note), error_type=COALESCE($4,error_type), status=COALESCE($5,status), updated_at=now()
              WHERE id=$1 AND user_id=$2 RETURNING *`, [ch.entity_id, u.id, ch.data?.note ?? null, ch.data?.error_type ?? null, ch.data?.status ?? null]);
          if (r) await this.db.recordChange(this.db.pool, u.id, 'wrong_question', r.id, 'upsert', r, b.device);
          results.push({ client_id: ch.client_id, entity_id: ch.entity_id, status: r ? 'applied' : 'rejected', error: r ? undefined : 'not_found' });
        } else {
          results.push({ client_id: ch.client_id, status: 'rejected', error: `unsupported entity ${ch.entity}（单词复习请直接调 POST /words/{id}/review）` });
        }
      } catch (e: any) {
        results.push({ client_id: ch.client_id, status: 'rejected', error: e.message });
      }
    }
    const last = (await this.db.one('SELECT COALESCE(max(id),0)::bigint m FROM sync_changes WHERE user_id=$1', [u.id]))!.m;
    return { results, cursor: Number(last) };
  }
}
