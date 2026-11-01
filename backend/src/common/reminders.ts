/**
 * 「我的」页设置（全部平铺存在 users.settings，GET /me/settings 原样返回在 settings 下；exam_date 同步写 users.exam_date 列，阶段检查 / 倒计时用）：
 *   timezone · target_school · target_score(0–500) · exam_date(YYYY-MM-DD) · coach_frequency(more|normal|less|ask) · quiet_hours {start,end}
 * coach_frequency：normal = 每晚复盘 + 周报；less = 复盘每 3 天一次、周报照常；more = 再加一条中午 12:30 的进度提醒；
 *   ask = 频率同 normal，但教练主动跑的任务只「提建议」不改东西（计划 / 复习卡 / 阶段），等用户 POST /agent/messages/{id}/confirm 才执行。
 *   「别管我」/ 连续 2 次没打开的自动少打扰（users.proactive）叠加在上面：少打扰时 more 的中午提醒也不发。
 * quiet_hours：用户时区的免打扰时段（可跨零点）。时段里产生的主动消息不显示，delivered_at 排到时段结束那一刻。
 * 纯函数，单测直接测。
 */
import { isValidTz } from './user-time.service';

export type CoachFrequency = 'more' | 'normal' | 'less' | 'ask';
export const COACH_FREQUENCIES: CoachFrequency[] = ['more', 'normal', 'less', 'ask'];
export const LESS_EVERY_DAYS = 3;
export interface QuietHours { start: string; end: string }
export const SETTING_KEYS = ['timezone', 'target_school', 'target_score', 'exam_date', 'coach_frequency', 'quiet_hours'] as const;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function toMin(hhmm: string) { const m = HHMM.exec(hhmm)!; return Number(m[1]) * 60 + Number(m[2]); }

export function coachFrequency(settings: any): CoachFrequency {
  return COACH_FREQUENCIES.includes(settings?.coach_frequency) ? settings.coach_frequency : 'normal';
}
export function quietHours(settings: any): QuietHours | null {
  const q = settings?.quiet_hours;
  return q && HHMM.test(q.start ?? '') && HHMM.test(q.end ?? '') && q.start !== q.end ? { start: q.start, end: q.end } : null;
}

/** 本地分钟 t（0–1439）是否在免打扰 [start, end) 里 */
export function inQuiet(t: number, q: QuietHours | null | undefined) {
  if (!q) return false;
  const s = toMin(q.start), e = toMin(q.end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** 在免打扰里 → 距离时段结束还有几分钟（排队到结束）；不在 → 0 */
export function minutesUntilQuietEnds(t: number, q: QuietHours | null | undefined) {
  if (!inQuiet(t, q)) return 0;
  const e = toMin(q!.end);
  return e > t ? e - t : 1440 - t + e;
}

/**
 * 校验 PATCH /me/settings 的 body（平铺字段，部分更新，null 清空）。返回要合并进 settings 的 patch；不合法抛中文 string。
 * 未知字段也 400（防前端拼错字段名被静默忽略）。
 */
/** 给学生看的校验错误：message 是能直接显示的中文（不含字段名 / null），field + code 给前端定位输入框 */
export class UserInputError extends Error {
  constructor(message: string, public field: string | null, public code: string) { super(message); }
  body() { return { statusCode: 400, error: 'Bad Request', message: this.message, field: this.field, code: this.code }; }
}
export const SETTINGS_MESSAGES = {
  invalid_body: '没收到要保存的设置，请重试',
  empty: '没有要保存的改动',
  unknown_field: '有一项设置暂时不支持，请刷新页面后再试',
  invalid_timezone: '时区不对，请从列表里选一个',
  invalid_target_school: '目标院校填 1–80 个字',
  invalid_target_score: '目标分填 0–500 之间的整数',
  invalid_exam_date: '考试日期格式不对',
  invalid_coach_frequency: '教练提醒频率请从「多 / 正常 / 少 / 先问我」里选一个',
  invalid_quiet_hours: '免打扰时间要写成 23:00 这样',
  quiet_hours_same: '免打扰的开始和结束时间不能一样',
} as const;
const bad = (code: keyof typeof SETTINGS_MESSAGES, field: string | null) => new UserInputError(SETTINGS_MESSAGES[code], field, code);

/** PATCH /me/settings 的校验：返回要写进 users.settings 的部分（null = 清空该项）；不合法抛 UserInputError（→ 400 {message, field, code}） */
export function validateSettingsPatch(b: any): Record<string, any> {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('invalid_body', null);
  const keys = Object.keys(b);
  if (!keys.length) throw bad('empty', null);
  const unknown = keys.filter((k) => !(SETTING_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw bad('unknown_field', unknown[0]);
  const out: Record<string, any> = {};
  if ('timezone' in b) {
    if (!isValidTz(b.timezone)) throw bad('invalid_timezone', 'timezone');
    out.timezone = b.timezone;
  }
  if ('target_school' in b) {
    const v = b.target_school;
    if (v !== null && (typeof v !== 'string' || !v.trim() || v.trim().length > 80)) throw bad('invalid_target_school', 'target_school');
    out.target_school = v === null ? null : v.trim();
  }
  if ('target_score' in b) {
    const v = b.target_score;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 500)) throw bad('invalid_target_score', 'target_score');
    out.target_score = v;
  }
  if ('exam_date' in b) {
    const v = b.exam_date;
    if (v !== null && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw bad('invalid_exam_date', 'exam_date');
    out.exam_date = v;
  }
  if ('coach_frequency' in b) {
    if (!COACH_FREQUENCIES.includes(b.coach_frequency)) throw bad('invalid_coach_frequency', 'coach_frequency');
    out.coach_frequency = b.coach_frequency;
  }
  if ('quiet_hours' in b) {
    const v = b.quiet_hours;
    if (v !== null) {
      if (typeof v !== 'object' || Array.isArray(v) || !HHMM.test(v.start ?? '') || !HHMM.test(v.end ?? '')
        || Object.keys(v).some((k) => k !== 'start' && k !== 'end')) throw bad('invalid_quiet_hours', 'quiet_hours');
      if (v.start === v.end) throw bad('quiet_hours_same', 'quiet_hours');
    }
    out.quiet_hours = v === null ? null : { start: v.start, end: v.end };
  }
  return out;
}

export function daysBetween(from: string, to: string) { return Math.round((Date.parse(to) - Date.parse(from)) / 86400000); }
