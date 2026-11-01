import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';

/** 批量埋点：只留自己复盘用的（做题、正确率、停留时长等）。client_id 去重，可以放心重发。 */
@Controller('events')
@UseGuards(JwtGuard)
export class EventsController {
  constructor(private db: DbService) {}

  @Post()
  @HttpCode(202)
  async batch(@CurrentUser() u: AuthUser, @Body() b: { device?: string; events: { client_id?: string; name: string; props?: any; occurred_at?: string }[] }) {
    const evs = b?.events ?? [];
    if (!Array.isArray(evs) || evs.length > 500) throw new BadRequestException('events 必须是数组，最多 500 条');
    let accepted = 0;
    for (const e of evs) {
      if (!e?.name) continue;
      const r = await this.db.query(
        `INSERT INTO events(user_id,client_id,name,props,device,occurred_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,client_id) DO NOTHING`,
        [u.id, e.client_id ?? null, e.name, JSON.stringify(e.props ?? {}), b.device ?? null, e.occurred_at ? new Date(e.occurred_at) : new Date()]);
      accepted += r.rowCount ?? 0;
    }
    return { received: evs.length, accepted, duplicates: evs.length - accepted };
  }
}
