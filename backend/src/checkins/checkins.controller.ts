import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { UserTimeService } from '../common/user-time.service';
import { relativeDay } from '../common/time';

@Controller('checkins')
@UseGuards(JwtGuard)
export class CheckinsController {
  constructor(private db: DbService, private time: UserTimeService) {}

  /** 每日打卡（同一天重复提交会覆盖） */
  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() b: { day?: string; minutes?: number; mood?: string; note?: string }) {
    const day = b?.day ?? await this.time.today(u.id);
    const r = await this.db.one(
      `INSERT INTO checkins(user_id,day,minutes,mood,note) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (user_id,day) DO UPDATE SET minutes=EXCLUDED.minutes, mood=EXCLUDED.mood, note=EXCLUDED.note RETURNING id, to_char(day,'YYYY-MM-DD') AS day, minutes, mood, note, created_at`,
      [u.id, day, b?.minutes ?? 0, b?.mood ?? null, b?.note ?? null]);
    const streak = await this.db.one(
      `WITH d AS (SELECT day, day - (row_number() OVER (ORDER BY day))::int AS g FROM checkins WHERE user_id=$1)
       SELECT count(*)::int n FROM d WHERE g = (SELECT g FROM d WHERE day=$2)`, [u.id, day]);
    return { ...r, streak_days: streak?.n ?? 1 };
  }

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('from') from?: string) {
    const today = await this.time.today(u.id);
    return { items: (await this.db.query(`SELECT to_char(day,'YYYY-MM-DD') AS day, minutes, mood, note FROM checkins WHERE user_id=$1 AND day >= COALESCE($2::date, $3::date - 60) ORDER BY day`, [u.id, from ?? null, today])).rows
      .map((r: any) => ({ ...r, relative_day: relativeDay(r.day, today) })), study_date: today }; // 打卡按学习日（04:00 换天）
  }
}
