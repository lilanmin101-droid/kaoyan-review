import { BadRequestException, Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from './jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { UserTimeService } from '../common/user-time.service';
import { DAY_START_HOUR } from '../common/time';
import { coachFrequency, daysBetween, quietHours, UserInputError, validateSettingsPatch } from '../common/reminders';
import { MeStatsService } from './me-stats.service';

@Controller('me')
@UseGuards(JwtGuard)
export class MeController {
  constructor(private db: DbService, private time: UserTimeService, private stats: MeStatsService) {}

  @Get('settings')
  async get(@CurrentUser() u: AuthUser) {
    const r = await this.db.one(`SELECT COALESCE(settings,'{}'::jsonb) settings, to_char(exam_date,'YYYY-MM-DD') exam_date, proactive FROM users WHERE id=$1`, [u.id]);
    const now = await this.time.now(u.id);
    const settings = r?.settings ?? {};
    const examDate = settings.exam_date ?? r?.exam_date ?? null;
    const p = r?.proactive ?? { mode: 'normal', nightly_every_days: 1 };
    return {
      settings, timezone: now.tz, today: now.date,
      // 以下是后端算出来的只读值，前端展示用；改设置只认 settings 里的平铺字段
      effective: {
        coach_frequency: coachFrequency(settings), quiet_hours: quietHours(settings),
        // 学习日：当地 04:00 换天（凌晨 0–4 点还是前一天）。前端不要自己算日界，「今天」就用 study_date
        study_date: now.date, day_start_hour: DAY_START_HOUR, calendar_date: now.calendar_date, local_time: now.time,
        days_to_exam: examDate ? daysBetween(now.date, examDate) : null,
        auto_reduced: p.mode === 'reduced', auto_reduced_every_days: p.mode === 'reduced' ? Number(p.nightly_every_days || 3) : null,
      },
    };
  }

  /**
   * 部分更新（平铺字段，合并进 users.settings，null 清空）：timezone / target_school / target_score / exam_date / coach_frequency / quiet_hours。
   * exam_date 同步写 users.exam_date（阶段检查、plans/today 的 days_to_exam 用）。显式选回 normal / more 会解除自动少打扰。
   */
  @Patch('settings')
  async patch(@CurrentUser() u: AuthUser, @Body() b: any) {
    let patch: Record<string, any>;
    try { patch = validateSettingsPatch(b); } catch (e: any) { throw new BadRequestException(e instanceof UserInputError ? e.body() : { message: '设置没保存成功，请重试', field: null, code: 'invalid_body' }); }
    const { timezone, ...rest } = patch;
    await this.db.tx(async (c) => {
      if (Object.keys(rest).length) {
        await c.query(`UPDATE users SET settings = COALESCE(settings,'{}'::jsonb) || $2::jsonb, updated_at=now() WHERE id=$1`, [u.id, JSON.stringify(rest)]);
      }
      if ('exam_date' in rest) await c.query(`UPDATE users SET exam_date=$2::date WHERE id=$1`, [u.id, rest.exam_date]);
      if (rest.coach_frequency === 'normal' || rest.coach_frequency === 'more') {
        await c.query(`UPDATE users SET proactive='{"mode":"normal","nightly_every_days":1}'::jsonb WHERE id=$1 AND proactive->>'mode'='reduced'`, [u.id]);
      }
    });
    if (timezone !== undefined) await this.time.setTz(u.id, timezone);
    return this.get(u);
  }

  /** 学习统计（「我的」页）：按用户时区算日界；days = 序列长度（默认 30，最多 90），另外总返回 last_7 */
  @Get('stats')
  async getStats(@CurrentUser() u: AuthUser, @Query('days') days?: string) {
    const n = days === undefined ? 30 : Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 90) throw new BadRequestException(new UserInputError('统计天数要在 1–90 天之间', 'days', 'invalid_days').body());
    return this.stats.stats(u.id, n);
  }
}
