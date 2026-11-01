import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { earlyNote, localDate, localHour, startOfStudyDay, studyDate, studyDayEnd } from './time';
import { clockNow } from './clock';

/** 合法的 IANA 时区（Asia/Shanghai、America/Los_Angeles、UTC…），用 Intl 校验 */
export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0); return true; } catch { return false; }
}

/**
 * 全后端唯一的「用户今天」口径。时区优先级：users.settings.timezone → 本次请求的 X-Timezone → APP_TZ（默认 Asia/Shanghai）。
 * 任何日界（命令栏、计划、单词、复盘、统计、打卡）都从这里拿，不用进程本地时区。
 */
@Injectable()
export class UserTimeService {
  private log = new Logger('UserTime');
  /** 已经写进库的 X-Timezone（避免每个请求都写库） */
  private persisted = new Map<string, string>();
  constructor(private db: DbService) {}

  async tz(userId: string, headerTz?: string | null): Promise<string> {
    const saved = (await this.db.one(`SELECT settings->>'timezone' tz FROM users WHERE id=$1`, [userId]))?.tz;
    if (isValidTz(saved)) return saved;
    if (isValidTz(headerTz)) return headerTz;
    return process.env.APP_TZ || 'Asia/Shanghai';
  }
  /**
   * 「凌晨 4 点前还算 MM-DD 这一天。」每个学习日每个用户只说一次：现在是当地 0–4 点、且这个学习日还没说过 → 记下（users.early_note_day）并返回这句；否则 null。
   * 只在确实要说的时候调（回复涉及今天 / 明天 / 昨天），调了就算说过。
   */
  async earlyNoteOnce(userId: string): Promise<string | null> {
    const n = await this.now(userId);
    const note = earlyNote(n.hour, n.date);
    if (!note) return null;
    const r = await this.db.one(`UPDATE users SET early_note_day=$2::date WHERE id=$1 AND early_note_day IS DISTINCT FROM $2::date RETURNING id`, [userId, n.date]);
    return r ? note : null;
  }
  /** 用户的学习日（当地 04:00 换天，见 common/time.ts studyDate）：凌晨 0–4 点还是前一天 */
  async today(userId: string, headerTz?: string | null) { return studyDate(clockNow(), await this.tz(userId, headerTz)); }
  /** 用户这个学习日的起止时刻 [当地 04:00, 次日 04:00)：到期复习、单词「今天已做」、打卡等都用这个日界 */
  async day(userId: string, at = clockNow()) {
    const tz = await this.tz(userId);
    const date = studyDate(at, tz);
    return { tz, date, start: startOfStudyDay(date, tz), end: studyDayEnd(at, tz) };
  }
  async hour(userId: string, headerTz?: string | null) { return localHour(clockNow(), await this.tz(userId, headerTz)); }
  async now(userId: string) {
    const tz = await this.tz(userId);
    const d = clockNow();
    // date = 学习日（凌晨 4 点前是前一天）；calendar_date = 当地日历日；hour / time 是当地真实钟点
    return { tz, date: studyDate(d, tz), calendar_date: localDate(d, tz), hour: localHour(d, tz), time: new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d),
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)) };
  }

  /** 客户端每个请求带 X-Timezone：合法且和库里不同就写回 users.settings.timezone */
  async rememberHeader(userId: string, headerTz: unknown) {
    if (!isValidTz(headerTz) || this.persisted.get(userId) === headerTz) return;
    await this.setTz(userId, headerTz);
  }

  async setTz(userId: string, tz: string) {
    const r = await this.db.one(
      `UPDATE users SET settings = COALESCE(settings,'{}'::jsonb) || jsonb_build_object('timezone', $2::text)
        WHERE id=$1 AND (settings->>'timezone') IS DISTINCT FROM $2 RETURNING id`, [userId, tz]);
    if (r) this.log.log(`user ${userId} timezone → ${tz}`);
    this.persisted.set(userId, tz);
    return !!r;
  }
}
