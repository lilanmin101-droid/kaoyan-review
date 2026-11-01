import { Client } from 'pg';
import { loadEnv } from './env';
import { addDays, datePh, placeholdersDeep, studyDate, toPlaceholders } from '../src/common/time';

/**
 * 存量文字里的日期 → 占位符 {{date:YYYY-MM-DD}}（读时按读者学习日渲染）。幂等：占位符不会再被匹配。
 * 参考日 = 写那条记录时用户的学习日（created_at 按用户时区、04:00 换日），用来给 MM-DD 补年份。
 * 往后看的说法（日期后面紧跟「先」）记成 {{date:…|plan}}（已经是占位符的也补上）。
 * 范围：agent_actions.summary/reason/before/after、daily_tips.text/headline/details/proposal.items[].summary、study_plans / plan_tasks.why_changed、agent_commands.events/result。
 */
async function main() {
  loadEnv();
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const tzOf = new Map<string, string>();
  for (const r of (await c.query(`SELECT id, settings->>'timezone' tz FROM users`)).rows) tzOf.set(r.id, r.tz || process.env.APP_TZ || 'Asia/Shanghai');
  const ref = (uid: string, at: Date | null) => studyDate(at ?? new Date(), tzOf.get(uid) ?? 'Asia/Shanghai');
  const n: Record<string, number> = {};
  const bump = (k: string) => { n[k] = (n[k] ?? 0) + 1; };
  await c.query('BEGIN');
  for (const r of (await c.query(`SELECT id, user_id, created_at, summary, reason, before, after FROM agent_actions`)).rows) {
    const d = ref(r.user_id, r.created_at); const s = toPlaceholders(r.summary, d), w = toPlaceholders(r.reason, d);
    const b = placeholdersDeep(r.before, d), a = placeholdersDeep(r.after, d);
    if (s !== r.summary || w !== r.reason) { await c.query('UPDATE agent_actions SET summary=$2, reason=$3 WHERE id=$1', [r.id, s, w]); bump('agent_actions'); }
    if (JSON.stringify(b) !== JSON.stringify(r.before) || JSON.stringify(a) !== JSON.stringify(r.after)) {
      await c.query('UPDATE agent_actions SET before=$2, after=$3 WHERE id=$1', [r.id, b == null ? null : JSON.stringify(b), a == null ? null : JSON.stringify(a)]); bump('agent_actions.before_after');
    }
  }
  for (const r of (await c.query(`SELECT id, user_id, kind, created_at, tip_date::text AS tip_date, text, headline, details, proposal FROM daily_tips`)).rows) {
    const d = r.tip_date ?? ref(r.user_id, r.created_at); // 消息自己的学习日（调试时间写的也对得上）
    // 第 17 轮：很早的每日复盘写的是裸「今天还没有作答记录」「明天从…开始」→ 先换成那条复盘自己的日期，再走占位符（含「还没有」时态）
    const bare = (t: string | null) => (r.kind === 'review' && r.tip_date && t ? t.replace(/(^|。)今天(?!（)/g, `$1${datePh(r.tip_date)}`).replace(/(^|。)明天(?!（)/g, `$1${datePh(addDays(r.tip_date, 1))}`) : t);
    const v = { text: toPlaceholders(bare(r.text), d), headline: toPlaceholders(bare(r.headline), d), details: toPlaceholders(bare(r.details), d), proposal: r.proposal?.items ? { ...r.proposal, items: placeholdersDeep(r.proposal.items, d) } : r.proposal };
    if (JSON.stringify(v) !== JSON.stringify({ text: r.text, headline: r.headline, details: r.details, proposal: r.proposal })) {
      await c.query('UPDATE daily_tips SET text=$2, headline=$3, details=$4, proposal=$5 WHERE id=$1', [r.id, v.text, v.headline, v.details, v.proposal == null ? null : JSON.stringify(v.proposal)]); bump('daily_tips');
    }
  }
  for (const r of (await c.query(`SELECT id, user_id, updated_at, why_changed FROM study_plans WHERE why_changed IS NOT NULL`)).rows) {
    const w = toPlaceholders(r.why_changed, ref(r.user_id, r.updated_at));
    if (w !== r.why_changed) { await c.query('UPDATE study_plans SET why_changed=$2 WHERE id=$1', [r.id, w]); bump('study_plans'); }
  }
  for (const r of (await c.query(`SELECT t.id, p.user_id, t.updated_at, t.why_changed FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id WHERE t.why_changed IS NOT NULL`)).rows) {
    const w = toPlaceholders(r.why_changed, ref(r.user_id, r.updated_at));
    if (w !== r.why_changed) { await c.query('UPDATE plan_tasks SET why_changed=$2 WHERE id=$1', [r.id, w]); bump('plan_tasks'); }
  }
  for (const r of (await c.query(`SELECT id, user_id, created_at, events, result FROM agent_commands`)).rows) {
    const d = ref(r.user_id, r.created_at); const e = placeholdersDeep(r.events, d), x = placeholdersDeep(r.result, d);
    if (JSON.stringify(e) !== JSON.stringify(r.events) || JSON.stringify(x) !== JSON.stringify(r.result)) {
      await c.query('UPDATE agent_commands SET events=$2, result=$3 WHERE id=$1', [r.id, e == null ? null : JSON.stringify(e), x == null ? null : JSON.stringify(x)]); bump('agent_commands');
    }
  }
  // 第 14 轮：daily_tips 的倒计时「当时」以消息自己的学习日（tip_date）为准
  const fx = await c.query(`UPDATE daily_tips SET text=regexp_replace(text, '\\|asof=\\d{4}-\\d{2}-\\d{2}', '|asof=' || tip_date::text, 'g'),
      details=regexp_replace(details, '\\|asof=\\d{4}-\\d{2}-\\d{2}', '|asof=' || tip_date::text, 'g'), headline=regexp_replace(headline, '\\|asof=\\d{4}-\\d{2}-\\d{2}', '|asof=' || tip_date::text, 'g')
    WHERE (coalesce(text,'') || coalesce(details,'') || coalesce(headline,'')) ~ '\\{\\{countdown:\\d+\\|asof=' AND (coalesce(text,'') || coalesce(details,'') || coalesce(headline,'')) !~ ('asof=' || tip_date::text)`);
  if (fx.rowCount) n['daily_tips.countdown_asof'] = fx.rowCount;
  await c.query('COMMIT');
  console.log('date placeholders:', JSON.stringify(n));
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
