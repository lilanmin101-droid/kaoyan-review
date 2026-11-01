/** 时区：传入的用户时区（来自 UserTimeService：users.settings.timezone → X-Timezone）> APP_TZ > Asia/Shanghai。
 * 业务代码不要直接调 localDate()（不带 tz）算「用户今天」，用 UserTimeService.today(userId)。 */
export const appTz = (userTz?: string | null) => userTz || process.env.APP_TZ || 'Asia/Shanghai';
export function localDate(d = new Date(), tz?: string | null) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: appTz(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function localHour(d = new Date(), tz?: string | null) {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: appTz(tz) }).format(d));
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 不带时区的 at（如 2026-11-01T04:15、2026-11-01）按太平洋时间理解 */
export function parseAt(at: string): number {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(at)) return Date.parse(at);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(at.trim());
  if (!m) return NaN;
  const [y, mo, d, h = '0', mi = '0', se = '0'] = m.slice(1);
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  // 算出太平洋时间在这一刻的偏移
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const offsetAt = (ms: number) => {
    const parts = fmt.formatToParts(new Date(ms));
    const g = (t: string) => Number(parts.find((x) => x.type === t)!.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms;
  };
  // 两轮求偏移：夏令时切换当天（如 11 月第一个周日）第一轮会取错
  const guess = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(guess);
}


/** tz 在 ms 这一刻相对 UTC 的偏移（毫秒） */
export function tzOffsetMs(ms: number, tz?: string | null) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: appTz(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((x) => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}

/** 某时区里 date（YYYY-MM-DD）这一天 hour:00（默认 00:00）对应的时刻 */
export function startOfLocalDay(date: string, tz?: string | null, hour = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hour);
  const t1 = asUtc - tzOffsetMs(asUtc, tz);
  return new Date(asUtc - tzOffsetMs(t1, tz)); // 两轮：夏令时切换当天第一轮会偏
}

/**
 * 学习日：每天从用户当地 04:00 开始（DAY_START_HOUR）。凌晨 0:00–3:59 还算前一天——「今天 / 明天」、排计划、复盘、建议、
 * 单词今日、打卡、错题到期、统计按天分组、距考试天数都按学习日算；原始作答时间（answered_at 等）不改。
 * 全后端只从这里（经 UserTimeService.today / day）拿「今天」。
 */
export const DAY_START_HOUR = 4;
export function studyDate(at: Date = new Date(), tz?: string | null) {
  const hour = localHour(at, tz);
  const cal = localDate(at, tz);
  return hour < DAY_START_HOUR ? addDays(cal, -1) : cal;
}
/** 学习日 date 的起点（当地 04:00） */
export const startOfStudyDay = (date: string, tz?: string | null) => startOfLocalDay(date, tz, DAY_START_HOUR);
/** SQL：时间戳列按学习日落到哪一天（date 类型）。tz 是 SQL 里的参数 / 表达式，如 '$2' */
export const studyDaySql = (col: string, tz: string) => `((${col} AT TIME ZONE ${tz}) - interval '${DAY_START_HOUR} hours')::date`;
/** 相对学习日的叫法：今天 / 明天 / 后天 / 昨天 / 前天；更远 → null（前端不自己算日界，直接显示这个） */
export function relativeDay(date: string | null | undefined, today: string): string | null {
  if (!date) return null;
  const n = Math.round((Date.parse(`${date.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return ({ '-2': '前天', '-1': '昨天', '0': '今天', '1': '明天', '2': '后天' } as Record<string, string>)[String(n)] ?? null;
}
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 学生看到的日子：±2 天内「明天（11-02）」；6 天内「周三（11-04）」；再远「11-20（周五）」 */
export function dayLabel(date: string, today: string): string {
  const rel = relativeDay(date, today);
  if (rel) return `${rel}（${date.slice(5, 10)}）`;
  const n = Math.round((Date.parse(`${date.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const wd = WEEKDAY[new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay()];
  if (Math.abs(n) <= 6) return `${wd}（${date.slice(5, 10)}）`;
  return `${date.slice(5, 10)}（${wd}）`; // 更远：日期在前、星期在括号里「11-02（周一）」
}
/** 文字里「今天（11-02）」这类叫法和日子对不对得上（eval / 单测扫描用）：返回对不上的片段 */
export function badDayLabels(text: string, today: string): string[] {
  const out: string[] = [];
  const year = today.slice(0, 4);
  for (const m of text.matchAll(/(今天|明天|后天|昨天|前天)（(\d{2})-(\d{2})）/g)) {
    // 跨年：12 月说 01-0x 是明年
    let y = Number(year); if (today.slice(5, 7) === '12' && m[2] === '01') y++; if (today.slice(5, 7) === '01' && m[2] === '12') y--;
    if (relativeDay(`${y}-${m[2]}-${m[3]}`, today) !== m[1]) out.push(m[0]);
  }
  // 渲染后的日期和后面的字之间多了空格：「11-02（周一） 的计划」
  for (const m of text.matchAll(/(\d{2}-\d{2}）|（周[一二三四五六日]）)[ \u3000]+[\u4e00-\u9fff]/g)) out.push(m[0]);
  // 括号套括号：渲染出来的日期自带（），模板再套一层就成了「建议的日子（11-03（周二））」
  // （[^（）]*（[^）]*））是紧贴着收尾的那种；内层括号后面还有字（「（从今天（11-02）算）」）也算
  for (const m of text.matchAll(/（[^（）]*（[^（）]*）[^（）]*）/g)) out.push(m[0]);
  // 没渲染的占位符漏出来
  for (const m of text.matchAll(/\{\{date:[^}]*\}\}/g)) out.push(m[0]);
  return out;
}

/** 凌晨 0–4 点的说明句：「凌晨 4 点前还算 11-01 这一天。」；04:00 以后 null */
export function earlyNote(hour: number, today: string): string | null {
  return hour < DAY_START_HOUR ? `凌晨 ${DAY_START_HOUR} 点前还算 ${today.slice(5)} 这一天。` : null;
}
/** 回复涉及今天 / 明天 / 昨天（命令原话或回复里有）且在凌晨 0–4 点：末尾补一句说明，一条回复只补一次 */
/** 这句话 / 回复是否涉及「今天 / 明天 / 昨天」（凌晨 0–4 点才需要补「还算前一天」） */
export function wantsEarlyNote(reply: string, command = ''): boolean {
  if (!reply || reply.includes(`凌晨 ${DAY_START_HOUR} 点前还算`)) return false;
  return /今天|明天|昨天|后天|前天|今晚|明早|明晚/.test(`${command}${reply}`);
}
/** 回复末尾补一句（note 为 null 就原样返回） */
export function appendNote(reply: string, note: string | null): string {
  if (!note || !reply) return reply;
  return `${reply}${/[。！？]$/.test(reply) ? '' : '。'}${note}`;
}
/** 纯函数版（不管「每个学习日只说一次」）：单测用 */
export function withEarlyNote(reply: string, hour: number, today: string, command = ''): string {
  return wantsEarlyNote(reply, command) ? appendNote(reply, earlyNote(hour, today)) : reply;
}

// ───────────── 日期占位符：存库写 {{date:2026-11-02}}，读的时候按读者当时的学习日渲染（M1） ─────────────
export const datePh = (date: string) => `{{date:${date.slice(0, 10)}}}`;
/** MM-DD 补年份：取离参考日最近的那一年（跨年时 12 月说 01-02 是明年） */
function withYear(mm: string, dd: string, ref: string) {
  const y = Number(ref.slice(0, 4));
  const cands = [y - 1, y, y + 1].map((k) => `${k}-${mm}-${dd}`);
  return cands.sort((a, b) => Math.abs(Date.parse(a) - Date.parse(ref)) - Math.abs(Date.parse(b) - Date.parse(ref)))[0];
}
const LABEL = '(?:今天|明天|后天|昨天|前天|周[一二三四五六日])';
// 「今天（11-02）」「周三（11-04）」「11-20（周五）」「11-02」→ 占位符；日期区间（10-26–11-01）、「还算 11-01 这一天」、题号 2024-01、完整日期不动
const TO_PH_RE = new RegExp(`${LABEL}（(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])）|(?<![\\w\\-–:/.]|还算 )(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])(?:（周[一二三四五六日]）)?(?![\\w\\-–:/.])`, 'g');
/** 写库前：文字里相对写法 / 裸日期都换成占位符（ref = 写的时候的学习日） */
export function toPlaceholders(text: string | null | undefined, ref: string): string | null | undefined {
  if (!text) return text;
  // 日期后面紧跟「先」（「明天（11-02）先重做…」）是往后看的说法：记成 {{date:…|plan}}，过了那天再读时改成「11-02（周一）当天计划重做…」
  return text
    .replace(TO_PH_RE, (m, m1, d1, m2, d2, off, str) => { const d = withYear(m1 ?? m2, d1 ?? d2, ref); return str[off + m.length] === '先' ? `{{date:${d}|plan}}` : datePh(d); })
    .replace(/\{\{date:(\d{4}-\d{2}-\d{2})\}\}(?=先)/g, '{{date:$1|plan}}');
}
/** 读的时候：占位符 → 相对今天（读者当时的学习日）的叫法 */
/** 占位符还原成存库前的裸日期 MM-DD（快照里本来不存占位符的字段撤回时用：计划任务标题、提醒文字） */
export const bareDates = <T>(s: T): T => (typeof s === 'string' ? (s.replace(/\{\{date:\d{4}-(\d{2}-\d{2})(?:\|plan)?\}\}/g, '$1') as any) : s);
export function renderDates(text: string, today: string): string {
  if (!text.includes('{{date:')) return text;
  // 模板里裸日期两边常有空格（「在 11-02 的计划」）：渲染后两边的空格都去掉（「在11-02（周一）的计划」「在明天（11-02）的计划」）
  // |plan：往后看的说法（后面跟「先…」）。读的时候那天已经过去 → 「11-02（周一）当天计划重做…」（去掉「先」）；今天或以后照常「明天（11-02）先重做…」
  // 兜底：老数据 / 模板里括号里只有占位符（一个或用「、」连起来的几个）——渲染结果自带括号，外层去掉
  // 「建议的日子（{{date:…}}）」→「建议的日子11-03（周二）」；「复盘（{{date:A}}、{{date:B}}）」→「复盘10-30（周五）、10-31（周六）」
  const PH = '\\{\\{date:\\d{4}-\\d{2}-\\d{2}(?:\\|plan)?\\}\\}';
  text = text.replace(new RegExp(`（(${PH}(?:[、，和]${PH})*)）`, 'g'), '$1');
  return text.replace(/[ \u3000]*\{\{date:(\d{4}-\d{2}-\d{2})(\|plan)?\}\}[ \u3000]*(先)?/g, (_m, d, plan, xian) => {
    const l = dayLabel(d, today);
    if (plan && d < today) return `${l}当天计划`;
    return `${l}${xian ?? ''}`;
  });
}
/** 引号层级（M2）：第一层「」、第二层『』，更深的去掉引号只留字 */
export function nestQuotes(text: string): string {
  if (!/[「『][^」』]*[「『]/.test(text)) return text;
  let depth = 0, out = '';
  for (const ch of text) {
    if (ch === '「' || ch === '『') { depth++; out += depth === 1 ? '「' : depth === 2 ? '『' : ''; }
    else if ((ch === '」' || ch === '』') && depth > 0) { out += depth === 1 ? '」' : depth === 2 ? '』' : ''; depth--; }
    else out += ch;
  }
  return out;
}
/** 存库前把对象里的字符串都换成日期占位符（命令的 events / result） */
export function placeholdersDeep(v: any, ref: string): any {
  if (typeof v === 'string') return toPlaceholders(v, ref);
  if (Array.isArray(v)) return v.map((x) => placeholdersDeep(x, ref));
  if (v && typeof v === 'object' && !(v instanceof Date)) { const o: any = {}; for (const k of Object.keys(v)) o[k] = placeholdersDeep(v[k], ref); return o; }
  return v;
}
/** 整个响应里的字符串都过一遍（占位符渲染 + 可选引号层级） */
export function renderDeep(v: any, today: string, quotes = false): any {
  if (typeof v === 'string') { const r = renderDates(v, today); return quotes ? nestQuotes(r) : r; }
  if (Array.isArray(v)) return v.map((x) => renderDeep(x, today, quotes));
  if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = renderDeep(v[k], today, quotes);
    return o;
  }
  return v;
}

/** 自然周（周一到周日）：from / to（YYYY-MM-DD）+ 标签「11-02–11-08」。「这周 / 本周」一律写整周范围 */
export function weekOf(d: string) {
  const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
  const from = addDays(d, -((wd + 6) % 7)), to = addDays(from, 6);
  return { from, to, label: `${from.slice(5)}–${to.slice(5)}` };
}
