/**
 * npm run eval:agent —— 教练 Agent 评测（对正在跑的后端 :3000，HTTP 真实调用）。
 *  1) 先跑单测（scripts/test-unit.ts）
 *  2) 内置用例：第 6 轮回归（时区、去重/数量、单词总数）+ 用户三条硬要求（一条主动消息、少打扰、手滑）等，全部自动判
 *  3) 行业专家用例 eval/agent_cases.jsonl（没有这个文件就跳过）：能映射成数据检查的断言自动判，其余列出来人工打分
 * 结果写到 eval/report-<时间>.md 和 .json。内置用例或单测失败 → 退出码 1；专家用例的自动判失败只报告（加 --strict 也算失败）。
 * 环境变量：BASE（默认 http://localhost:3000/api/v1）、EVAL_TZ（默认依次跑 America/Los_Angeles 和 Asia/Shanghai）
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { loadEnv } from './env';
import { runUnitTests } from './test-unit';
import { badDayLabels, renderDates, weekOf, weekOpenLabel } from '../src/common/time';
const TEST_PW = process.env.TEST_PW || require('crypto').randomBytes(12).toString('hex'); // 测试号密码：不写死在仓库里
/** 学生文字里不该有的标点连用（和 src/agent/coach.service.ts badPunct 一致） */
const BAD_PUNCT = /[。，；、：][。，；、]|[！？][，；、]|，[！？]/;
loadEnv();

const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 3000}/api/v1`;
const ROOT = path.resolve(__dirname, '../..');
const CASES_FILE = path.join(ROOT, 'eval/agent_cases.jsonl');
const STRICT = process.argv.includes('--strict');
const TZS = (process.env.EVAL_TZ || 'America/Los_Angeles,Asia/Shanghai').split(',');

type Check = { assertion: string; kind: 'expect' | 'must_not'; status: 'pass' | 'fail' | 'manual'; detail?: string };
/** 多轮用例的一轮：now_local（带不带时区偏移都行，不带就按用例时区算）+ 这一轮的话 + 可选的本轮断言 */
interface Turn { now_local?: string; input: string; expect?: string[]; must_not?: string[] }
interface Case { id: string; scenario: string; setup?: any; input: string; turns?: Turn[]; expect: string[]; must_not: string[]; source: 'builtin' | 'file'; tz?: string;
  run?: (s: Session) => Promise<Check[]> }

// ───────────── HTTP 小工具 ─────────────
class Session {
  token = ''; userId = ''; transcript: string[] = [];
  /** X-Debug-Now：模拟「现在」（只在非生产环境生效），测凌晨日界 */
  debugNow: string | null = null;
  constructor(public tz: string) {}
  h(): Record<string, string> { return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', 'x-timezone': this.tz, ...(this.debugNow ? { 'x-debug-now': this.debugNow } : {}) }; }
  async init() {
    const username = `eval_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await fetch(`${BASE}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-timezone': this.tz }, body: JSON.stringify({ username, password: TEST_PW }) });
    const r: any = await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: TEST_PW }) })).json();
    this.token = r.access_token; this.userId = r.user.id;
    return this;
  }
  async get(p: string) { const r = await fetch(`${BASE}${p}`, { headers: this.h() }); if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${await r.text()}`); return r.json() as any; }
  async send(method: string, p: string, body?: any) {
    const r = await fetch(`${BASE}${p}`, { method, headers: this.h(), body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null } as any;
  }
  /** 命令栏：收齐 SSE 事件 */
  async command(text: string, extra: any = {}) {
    const r = await fetch(`${BASE}/agent/commands`, { method: 'POST', headers: this.h(), body: JSON.stringify({ text, ...extra }) });
    const raw = await r.text();
    const evs = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
    const run = { text, steps: evs.filter((e) => e.type === 'step').map((e) => e.text as string), actions: evs.filter((e) => e.type === 'action').map((e) => e.action),
      done: evs.find((e) => e.type === 'done') ?? null, error: evs.find((e) => e.type === 'error') ?? null } as any;
    this.transcript.push(`> ${text}`, ...run.steps.map((s) => `  · ${s}`), ...run.actions.map((a) => `  ✎ ${a.summary} —— ${a.reason ?? ''}`), `  = ${run.done?.reply ?? run.error?.message ?? ''}`);
    return run;
  }
  async job(job: 'nightly' | 'weekly', respect = true) {
    const r = await this.send('POST', `/agent/jobs/${job}/run${respect ? '?respect_backoff=1' : ''}`);
    this.transcript.push(`> [定时 ${job}]`, `  = ${r.body?.skipped ? `跳过：${r.body.reason}` : r.body?.reply ?? r.body?.summary ?? ''}`, ...(r.body?.actions ?? []).map((a: any) => `  ✎ ${a.summary} —— ${a.reason ?? ''}`));
    return r.body;
  }
  async wrong(q: string) { // 做错一题（客观题随便选个错的，主观题自评不会）
    let r = await this.send('POST', '/answers', { question_id: q, answer: ['Z'] });
    if (r.status >= 400 || r.body?.is_correct !== false) r = await this.send('POST', '/answers', { question_id: q, self_rating: 'no_idea' });
    return r.status < 400;
  }
}

let db: Client;
const pass = (assertion: string, kind: Check['kind'], ok: boolean, detail?: string): Check => ({ assertion, kind, status: ok ? 'pass' : 'fail', detail });
const today = (s: Session) => s.get('/me/settings').then((d) => d.today as string);
/** 账号时区的 date HH:MM 对应的绝对时间（ISO），给 X-Debug-Now 用 */
function localIso(s: Session, date: string, hhmm: string) {
  const probe = new Date(`${date}T${hhmm}:00Z`);
  const off = (Date.parse(probe.toLocaleString('en-US', { timeZone: s.tz })) - Date.parse(probe.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000;
  return new Date(probe.getTime() - off * 60000).toISOString();
}
const addDays = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
/** 「今天（11-02）」这类标签和日期对得上（按学习日：04:00 换天）；s.debugNow 下也按那一刻的学习日算 */
async function labelCheck(s: Session, texts: any[], day?: string) {
  const d = day ?? await today(s);
  const bad = texts.filter((x) => typeof x === 'string').flatMap((x: string) => badDayLabels(x, d).map((b) => `${b} ← ${x.slice(0, 60)}`));
  return pass(`今天 / 明天标签和日期一致（学习日 ${d}）`, 'must_not', bad.length === 0, bad.join(' | ').slice(0, 300));
}
const planTasks = async (s: Session, d: string) => ((await s.get(`/plans?from=${d}&to=${d}`)).items[0]?.tasks ?? []) as any[];

// ───────────── 内置用例 ─────────────
const BUILTIN: Case[] = [
  {
    id: 'r6-tz', scenario: '第 6 轮：「今天」按账号时区算（X-Timezone 写进 settings），桌面/手机一致', input: '今天只有一小时', source: 'builtin',
    expect: ['X-Timezone 写进 users.settings.timezone', '/plans/today、/words/today、命令 done.date 都是该时区的今天', 'step 写明真实日期', '换一个客户端不带头也是同一天'], must_not: ['写进别的日期'],
    run: async (s) => {
      const st = await s.get('/me/settings');
      // 学习日：当地 04:00 换天（凌晨 0–4 点还是前一天）= 当地时间往前推 4 小时的日期
      const want = new Intl.DateTimeFormat('en-CA', { timeZone: s.tz }).format(new Date(Date.now() - 4 * 3600000));
      const run = await s.command('今天只有一小时');
      const plans = await s.get('/plans/today'), words = await s.get('/words/today');
      // 另一个「设备」：不带 X-Timezone，也必须拿到同一天（按库里的 settings.timezone）
      const other = await (await fetch(`${BASE}/plans/today`, { headers: { authorization: `Bearer ${s.token}` } })).json() as any;
      const label = `今天（${want.slice(5)}）`;
      return [
        pass('settings.timezone = X-Timezone', 'expect', st.settings.timezone === s.tz && st.today === want, JSON.stringify(st)),
        pass('plans/today、words/today、done.date = 账号时区今天', 'expect', plans.date === want && words.date === want && run.done?.date === want, `${plans.date} ${words.date} ${run.done?.date} want ${want}`),
        pass('step 写明真实日期', 'expect', run.steps.some((x) => x.includes(label)), run.steps.join(' | ')),
        pass('不带头的另一端也是同一天', 'expect', other.date === want, other.date),
        pass('没写进别的日期', 'must_not', run.actions.every((a) => !a.summary.includes(addDays(want, 1).slice(5))), run.actions.map((a) => a.summary).join(' | ')),
      ];
    },
  },
  {
    id: 'r6-dedupe-qty', scenario: '第 6 轮：同一句话 60 秒内只执行一次；「一道」=1、「两道」=2、数字照用，没说数量默认 3', input: '帮我加一道重做错题 ×2', source: 'builtin',
    expect: ['第一次加「重做 1 道错题」', '同一句第二次不新增，step 说已经有了，done.deduped=true', '换种说法带「加」（加道重做错题）= 叠加 1→2，仍是一条任务', '没说数量默认 3'], must_not: ['出现两条同类错题任务'],
    run: async (s) => {
      for (const q of ['math1-2024-01', 'math1-2024-02', 'math1-2024-03', 'math1-2024-04']) await s.wrong(q);
      const d = await today(s);
      const r1 = await s.command('帮我加一道重做错题');
      const r2 = await s.command('帮我加一道重做错题');
      const t1 = (await planTasks(s, d)).filter((t) => t.kind === 'redo_wrong' && t.status !== 'skipped');
      const r3 = await s.command('帮我加道重做错题');
      const t1b = (await planTasks(s, d)).filter((t) => t.kind === 'redo_wrong' && t.status !== 'skipped');
      // 另一个用户：「两道」=2；第三个用户：没说数量 → 3；「12 道」但只有 4 道错题 → 排 4 道并说明
      const s2 = await new Session(s.tz).init(); for (const q of ['math1-2024-01', 'math1-2024-02', 'math1-2024-03', 'math1-2024-04']) await s2.wrong(q);
      await s2.command('加两道错题重做');
      const t2 = (await planTasks(s2, d)).filter((t) => t.kind === 'redo_wrong');
      const s3 = await new Session(s.tz).init(); for (const q of ['math1-2024-01', 'math1-2024-02', 'math1-2024-03', 'math1-2024-04']) await s3.wrong(q);
      await s3.command('先清错题');
      const t3 = (await planTasks(s3, d)).filter((t) => t.kind === 'redo_wrong');
      const r4 = await s3.command('重做 12 道错题');
      return [
        pass('「一道」→ 重做 1 道错题', 'expect', r1.actions.some((a) => a.summary.includes('重做 1 道错题')) && t1[0]?.payload?.question_ids?.length === 1, r1.actions.map((a) => a.summary).join(' | ')),
        pass('同一句第二次：不新增，step 说已经有了，deduped', 'expect', r2.actions.length === 0 && r2.done?.deduped === true && r2.steps.some((x) => x.includes('已经有')), r2.steps.join(' | ')),
        pass('换种说法带「加」→ 叠加 1→2', 'expect', r3.done?.quantity_from === 1 && r3.done?.quantity_to === 2 && r3.steps.some((x) => x.includes('已从 1 道加到 2 道')), r3.steps.join(' | ')),
        pass('只有一条错题任务', 'must_not', t1.length === 1 && t1b.length === 1, t1b.map((t) => t.title).join(',')),
        pass('「两道」→ 2 道', 'expect', t2.length === 1 && t2[0].payload.question_ids.length === 2 && t2[0].title === '重做 2 道错题', t2.map((t) => t.title).join(',')),
        pass('没说数量 → 默认 3 道', 'expect', t3.length === 1 && t3[0].payload.question_ids.length === 3, t3.map((t) => t.title).join(',')),
        pass('要 12 道只有 4 道：照实说', 'expect', r4.steps.some((x) => x.includes('12 道') && x.includes('只有 4 道')), r4.steps.join(' | ')),
      ];
    },
  },
  {
    id: 'r6-words', scenario: '第 6 轮：单词「今日第 n / 总数」总数当天冻结，「记住了」+ F5 不减', input: '/words/today → 记住了 ×2、没记住 ×1 → F5', source: 'builtin',
    expect: ['scheduled_today 当天不变', 'position = done_today + 1'], must_not: ['总数减少'],
    run: async (s) => {
      const w0 = await s.get('/words/today');
      const ids = w0.new.slice(0, 3).map((w: any) => w.id);
      await s.send('POST', `/words/${ids[0]}/review`, { rating: 'easy' });
      await s.send('POST', `/words/${ids[1]}/review`, { rating: 'good' });
      await s.send('POST', `/words/${ids[2]}/review`, { rating: 'again' });
      const w1 = await s.get('/words/today');
      // 「没记住」的词到期后（模拟：把 due_at 拨到现在）进 relearn，不算进总数
      await db.query(`UPDATE word_progress SET due_at=now()-interval '1 second' WHERE user_id=$1 AND word_id=$2`, [s.userId, ids[2]]);
      const w2 = await s.get('/words/today');
      return [
        pass('首次 position=1', 'expect', w0.counts.position === 1 && w0.counts.done_today === 0, JSON.stringify(w0.counts)),
        pass('F5 后总数不变、position=4', 'expect', w1.counts.scheduled_today === w0.counts.scheduled_today && w1.counts.position === 4, `${w0.counts.scheduled_today} → ${JSON.stringify(w1.counts)}`),
        pass('重学词进 relearn，总数仍不变', 'expect', w2.counts.scheduled_today === w0.counts.scheduled_today && w2.counts.relearn === 1 && w2.counts.position === 4, JSON.stringify(w2.counts)),
        pass('总数没减少', 'must_not', w1.counts.scheduled_today >= w0.counts.scheduled_today && w2.counts.scheduled_today >= w0.counts.scheduled_today),
      ];
    },
  },
  {
    id: 'qty-semantics', scenario: '数量语义：同句 60 秒内=重复；带「加/再/多/补」= 叠加；只说数量 = 设定；每次改数量可一键撤回到原数量', input: '重做 3 道 → 加两道 ×2 → 今天重做 5 道 → 再来 2 道 → 今天重做 4 道 → 撤回', source: 'builtin',
    expect: ['加两道：3→5，step「已从 3 道加到 5 道」，done.quantity_from/to', '同句重发：deduped，step「刚才已从 3 道加到 5 道」，问要不要再加', '今天重做 5 道（已是 5）：已经有，deduped', '再来 2 道：5→7', '今天重做 4 道：7→4（设定不叠加）', '撤回 7→4 → 回到 7（HTTP 撤回）', '撤回后同一句重新执行'], must_not: ['重复句叠加', '设定变成叠加', '出现第二条错题任务'],
    run: async (s) => {
      for (const q of ['01', '02', '03', '04', '05', '06', '07', '08']) await s.wrong(`math1-2024-${q}`);
      const d = await today(s);
      const q = () => redoQty(s, d);
      const n = async () => (await planTasks(s, d)).filter((t) => t.kind === 'redo_wrong' && t.status !== 'skipped').length;
      const r0 = await s.command('重做 3 道错题'); const q0 = await q();
      const r1 = await s.command('加两道重做错题'); const q1 = await q();
      const r2 = await s.command('加两道重做错题'); const q2 = await q();
      const r3 = await s.command('今天重做 5 道错题'); const q3 = await q();
      const r4 = await s.command('再来 2 道错题'); const q4 = await q();
      const r5 = await s.command('今天重做 4 道错题'); const q5 = await q();
      const act = r5.actions.find((a: any) => a.target?.kind === 'plan_task');
      const u = act ? await s.send('POST', `/agent/actions/${act.id}/undo`) : { status: 0 };
      const q6 = await q();
      const r7 = await s.command('今天重做 4 道错题'); const q7 = await q();
      const st = (r: any) => r.steps.join(' | ');
      return [
        pass('重做 3 道 → 3', 'expect', q0 === 3 && r0.done?.quantity_to === 3, `${q0} ${JSON.stringify(r0.done)}`),
        pass('加两道：3→5 + step', 'expect', q1 === 5 && r1.done?.quantity_from === 3 && r1.done?.quantity_to === 5 && st(r1).includes('已从 3 道加到 5 道'), `${q1} ${st(r1)}`),
        pass('同句重发：deduped + 刚才已从 3 道加到 5 道 + 问再加', 'expect', q2 === 5 && r2.done?.deduped === true && r2.actions.length === 0 && st(r2).includes('刚才已从 3 道加到 5 道') && st(r2).includes('再加'), st(r2)),
        pass('今天重做 5 道（已是 5）：已经有，deduped', 'expect', q3 === 5 && r3.done?.deduped === true && st(r3).includes(`今天（${d.slice(5)}）的计划里已经有「重做 5 道错题」`), st(r3)),
        pass('再来 2 道：5→7', 'expect', q4 === 7 && r4.done?.quantity_from === 5 && r4.done?.quantity_to === 7, `${q4} ${st(r4)}`),
        pass('今天重做 4 道：7→4 + step「已从 7 道改为 4 道」', 'expect', q5 === 4 && st(r5).includes('已从 7 道改为 4 道'), `${q5} ${st(r5)}`),
        pass('改数量的 action 记了原数量（before）', 'expect', !!act && act.before?.payload?.question_ids?.length === 7 && act.after?.quantity_from === 7 && act.after?.quantity_to === 4, JSON.stringify(act?.after ?? null).slice(0, 120)),
        pass('HTTP 撤回 → 回到 7', 'expect', u.status === 200 && q6 === 7, `${u.status} ${q6}`),
        pass('撤回后同一句重新执行', 'expect', r7.done?.deduped === false && q7 === 4, `${q7} ${st(r7)}`),
        pass('重复句没有叠加', 'must_not', q2 === 5),
        pass('设定没有变成叠加', 'must_not', q3 === 5 && q5 === 4),
        pass('始终只有一条错题任务', 'must_not', (await n()) === 1),
      ];
    },
  },
  {
    id: 'tz-midnight', scenario: '凌晨 00:30（账号时区）说「今天只有一小时」→ 学习日 04:00 才换天，所以还是前一天（日历昨天）的计划，并说明一句', input: '今天只有一小时（X-Debug-Now 次日 00:30）', source: 'builtin',
    expect: ['done.date = 学习日（凌晨 4 点前算前一天）', 'step 说现在几点、按今天（MM-DD）排', '回复说一次「凌晨 4 点前还算 MM-DD 这一天」'], must_not: ['按服务器/北京时间算成别的日期'],
    run: async (s) => {
      const real = await today(s);
      const tomorrow = addDays(real, 1);
      // 账号时区「明天 00:30」对应的绝对时间
      const probe = new Date(`${tomorrow}T00:30:00Z`);
      const off = (Date.parse(new Date(probe).toLocaleString('en-US', { timeZone: s.tz })) - Date.parse(probe.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000;
      s.debugNow = new Date(probe.getTime() - off * 60000).toISOString();
      const st = await s.get('/me/settings');
      const r = await s.command('今天只有一小时');
      s.debugNow = null;
      return [
        pass('settings.today = 学习日（还没到 04:00，仍是前一天）', 'expect', st.today === real && st.effective?.study_date === real && st.effective?.calendar_date === tomorrow, `${st.today}/${st.effective?.study_date}/${st.effective?.calendar_date} want ${real}/${tomorrow}`),
        pass('done.date = 学习日', 'expect', r.done?.date === real, `${r.done?.date} want ${real}`),
        pass('step 说现在几点、按今天（MM-DD）排', 'expect', r.steps.some((x: string) => x.includes('00:30') && x.includes(`今天（${real.slice(5)}）`)), r.steps.join(' | ')),
        pass('回复说一次「凌晨 4 点前还算 MM-DD 这一天」', 'expect', (r.done?.reply ?? '').split(`凌晨 4 点前还算 ${real.slice(5)} 这一天`).length === 2, r.done?.reply),
        pass('没有写到别的日期', 'must_not', r.actions.every((a: any) => a.summary.includes(real.slice(5))), r.actions.map((a: any) => a.summary).join(' | ')),
      ];
    },
  },
  {
    id: 'settings-quiet-hours', scenario: '「我的」免打扰 quiet_hours 22:30–08:00：23:00 的夜间复盘照常生成，但不在时段里出现，排到 08:00 才送达', input: 'PATCH quiet_hours + 夜间复盘（X-Debug-Now 23:00 / 07:59 / 08:00）', source: 'builtin',
    expect: ['时段里 /agent/messages 看不到，queued=1', 'next_delivery_at = 时段结束', '08:00 之后出现', 'plans/today 的 tips 在时段里也不出现'], must_not: ['免打扰时段里推送'],
    run: async (s) => {
      const d = await today(s);
      await s.send('PATCH', '/me/settings', { quiet_hours: { start: '22:30', end: '08:00' } });
      await s.wrong('math1-2024-01');
      s.debugNow = localIso(s, d, '23:00');
      const r = await s.send('POST', '/agent/jobs/nightly/run?respect_backoff=1');
      const m1 = await s.get('/agent/messages');
      const t1 = await s.get('/plans/today');
      s.debugNow = localIso(s, addDays(d, 1), '07:59');
      const m2 = await s.get('/agent/messages');
      s.debugNow = localIso(s, addDays(d, 1), '08:00');
      const m3 = await s.get('/agent/messages');
      s.debugNow = null;
      const want = localIso(s, addDays(d, 1), '08:00');
      return [
        pass('复盘照常生成', 'expect', r.body?.skipped === false, JSON.stringify(r.body).slice(0, 200)),
        pass('23:00 看不到，queued=1', 'expect', !m1.items.some((i: any) => i.kind === 'review') && m1.queued === 1, JSON.stringify({ items: m1.items.length, queued: m1.queued })),
        pass('next_delivery_at = 次日 08:00（账号时区）', 'expect', Date.parse(m1.next_delivery_at) === Date.parse(want), `${m1.next_delivery_at} want ${want}`),
        pass('plans/today 23:00 不出现复盘', 'must_not', !t1.tips.review, JSON.stringify(t1.tips.review)),
        pass('07:59 仍看不到', 'must_not', !m2.items.some((i: any) => i.kind === 'review'), String(m2.items.length)),
        pass('08:00 出现', 'expect', m3.items.some((i: any) => i.kind === 'review') && m3.queued === 0, JSON.stringify(m3.items.map((i: any) => i.kind))),
      ];
    },
  },
  {
    id: 'settings-ask', scenario: '「我的」coach_frequency=ask：夜间复盘只提建议、不改计划；确认后才改、可撤回；忽略就不改', input: 'PATCH coach_frequency=ask + 夜间复盘 + confirm', source: 'builtin',
    expect: ['复盘消息照常', '明天计划没变', '有一条 pending 的 proposal 消息', 'confirm 后明天计划有任务', 'confirm 的 action 可撤回', '再 confirm → 409', 'dismiss 不改'], must_not: ['ask 模式自动改计划'],
    run: async (s) => {
      const d = await today(s), tm = addDays(d, 1);
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask' });
      await s.wrong('math1-2024-01');
      const r = await s.send('POST', '/agent/jobs/nightly/run?respect_backoff=1');
      const before = await planTasks(s, tm);
      const msgs = await s.get('/agent/messages');
      const pm = msgs.items.find((i: any) => i.kind === 'proposal');
      const c = pm ? await s.send('POST', `/agent/messages/${pm.id}/confirm`, {}) : { status: 0, body: null };
      const after = await planTasks(s, tm);
      const again = pm ? await s.send('POST', `/agent/messages/${pm.id}/confirm`, {}) : { status: 0 };
      const aid = c.body?.actions?.[0]?.id;
      const u = aid ? await s.send('POST', `/agent/actions/${aid}/undo`) : { status: 0 };
      const undone = await planTasks(s, tm);
      // dismiss：另一个账号的同一流程
      const s2 = await new Session(s.tz).init();
      await s2.send('PATCH', '/me/settings', { coach_frequency: 'ask' }); await s2.wrong('math1-2024-01');
      await s2.send('POST', '/agent/jobs/nightly/run?respect_backoff=1');
      const pm2 = (await s2.get('/agent/messages')).items.find((i: any) => i.kind === 'proposal');
      const dm = pm2 ? await s2.send('POST', `/agent/messages/${pm2.id}/dismiss`) : { status: 0, body: null };
      const after2 = await planTasks(s2, tm);
      s.transcript.push(`  · 建议：${pm?.headline ?? '（无）'}`, `  · confirm → ${c.status} ${(c.body?.actions ?? []).map((a: any) => a.summary).join('；')}`);
      return [
        pass('复盘消息照常', 'expect', r.body?.skipped === false && msgs.items.some((i: any) => i.kind === 'review'), JSON.stringify(msgs.items.map((i: any) => i.kind))),
        pass('ask 模式不自动改明天计划', 'must_not', before.length === 0 && (r.body?.actions ?? []).every((a: any) => a.tool === 'writeDailyTip'), JSON.stringify(before.map((t: any) => t.title))),
        pass('有 pending 的 proposal（带建议内容）', 'expect', pm?.proposal?.status === 'pending' && pm.proposal.items[0]?.tool === 'updateDailyPlan' && /确认/.test(pm.headline), pm?.headline),
        pass('confirm 后明天计划有任务', 'expect', c.status === 200 && after.some((t: any) => t.kind === 'redo_wrong'), `${c.status} ${JSON.stringify(after.map((t: any) => t.title))}`),
        pass('confirm 的改动 trigger=confirm 且可撤回', 'expect', c.body?.actions?.[0]?.trigger === 'confirm' && u.status < 300 && !undone.some((t: any) => t.kind === 'redo_wrong'), `${c.body?.actions?.[0]?.trigger} undo=${u.status}`),
        pass('重复 confirm → 409', 'expect', again.status === 409, String(again.status)),
        pass('dismiss 不改计划', 'expect', dm.status === 200 && dm.body?.proposal?.status === 'dismissed' && after2.length === 0, `${dm.status} ${after2.length}`),
      ];
    },
  },
  {
    id: 'settings-less-more', scenario: '「我的」coach_frequency=less：复盘每 3 天一次（周报照常）；more：多一条中午提醒；「别管我」叠加在上面', input: 'PATCH coach_frequency=less / more', source: 'builtin',
    expect: ['less：第二天跳过、第三天发', 'less：周报照常', 'more：中午提醒发出', 'normal：中午提醒不发', 'more + 别管我 → 中午提醒也不发'], must_not: ['less 每天都发'],
    run: async (s) => {
      const d = await today(s);
      await s.send('PATCH', '/me/settings', { coach_frequency: 'less' });
      s.debugNow = localIso(s, d, '23:00');
      const n0 = await s.send('POST', '/agent/jobs/nightly/run?respect_backoff=1');
      s.debugNow = localIso(s, addDays(d, 1), '23:00');
      const n1 = await s.send('POST', '/agent/jobs/nightly/run?respect_backoff=1');
      const w1 = await s.send('POST', '/agent/jobs/weekly/run?respect_backoff=1');
      s.debugNow = localIso(s, addDays(d, 3), '23:00');
      const n3 = await s.send('POST', '/agent/jobs/nightly/run?respect_backoff=1');
      s.debugNow = null;
      const s2 = await new Session(s.tz).init();
      const m0 = await s2.send('POST', '/agent/jobs/midday/run?respect_backoff=1');
      await s2.send('PATCH', '/me/settings', { coach_frequency: 'more' });
      const m1 = await s2.send('POST', '/agent/jobs/midday/run?respect_backoff=1');
      const nudge = (await s2.get('/agent/messages')).items.find((i: any) => i.kind === 'nudge');
      await s2.command('别管我');
      const m2 = await s2.send('POST', '/agent/jobs/midday/run?respect_backoff=1');
      s.transcript.push(`  · less d+1：${n1.body?.reason}`, `  · more 中午：${nudge?.headline}`, `  · more+别管我：${m2.body?.reason}`);
      return [
        pass('less：第一天发', 'expect', n0.body?.skipped === false, JSON.stringify(n0.body).slice(0, 150)),
        pass('less：第二天跳过（每 3 天）', 'must_not', n1.body?.skipped === true && /3 天/.test(n1.body.reason), n1.body?.reason),
        pass('less：周报照常', 'expect', w1.body?.skipped === false, w1.body?.reason),
        pass('less：第三天发', 'expect', n3.body?.skipped === false, n3.body?.reason),
        pass('normal：中午提醒不发', 'expect', m0.body?.skipped === true, m0.body?.reason),
        pass('more：中午提醒发出', 'expect', m1.body?.skipped === false && !!nudge?.headline, nudge?.headline),
        pass('more + 别管我 → 中午提醒不发', 'expect', m2.body?.skipped === true && /少打扰/.test(m2.body.reason), m2.body?.reason),
      ];
    },
  },
  {
    id: 'settings-validate', scenario: '「我的」设置字段名 / 校验 / 部分更新 / exam_date 驱动 plans/today.days_to_exam', input: 'PATCH /me/settings', source: 'builtin',
    expect: ['平铺字段原样在 settings 下', '部分更新不丢别的字段', '非法值 400', 'days_to_exam'], must_not: ['静默忽略拼错的字段'],
    run: async (s) => {
      const d = await today(s);
      const exam = addDays(d, 48);
      const a = await s.send('PATCH', '/me/settings', { target_school: '浙江大学', target_score: 400, exam_date: exam, coach_frequency: 'normal', quiet_hours: { start: '23:00', end: '07:00' } });
      const b = await s.send('PATCH', '/me/settings', { target_score: 410 });
      const bads = await Promise.all([{ target_score: 501 }, { exam_date: '2026-02-30' }, { coach_frequency: 'low' }, { quiet_hours: { start: '7', end: '8' } }, { targetScore: 400 }].map((x) => s.send('PATCH', '/me/settings', x)));
      const t = await s.get('/plans/today');
      const st = b.body?.settings ?? {};
      return [
        pass('平铺字段原样返回', 'expect', a.status === 200 && a.body.settings.target_school === '浙江大学' && a.body.settings.coach_frequency === 'normal' && a.body.settings.quiet_hours?.start === '23:00', JSON.stringify(a.body?.settings)),
        pass('部分更新只改 target_score', 'expect', st.target_score === 410 && st.target_school === '浙江大学' && st.exam_date === exam && st.timezone === s.tz, JSON.stringify(st)),
        pass('非法值 / 拼错字段 → 400', 'must_not', bads.every((x) => x.status === 400), bads.map((x) => `${x.status}:${x.body?.message}`).join(' | ')),
        pass('400 文案给学生看：无字段名 / null，带 field + code', 'expect', bads.every((x) => typeof x.body?.message === 'string' && !/[a-z_]{3,}|null/i.test(x.body.message) && typeof x.body?.code === 'string' && 'field' in x.body)
          && bads[0].body.message === '目标分填 0–500 之间的整数' && bads[1].body.message === '考试日期格式不对' && bads[3].body.message === '免打扰时间要写成 23:00 这样' && bads[4].body.field === 'targetScore',
          bads.map((x) => `${x.body?.code}/${x.body?.field}:${x.body?.message}`).join(' | ')),
        pass('plans/today.days_to_exam = 48', 'expect', t.days_to_exam === 48 && t.exam_date === exam, `${t.days_to_exam} ${t.exam_date}`),
      ];
    },
  },
  {
    id: 'action-group-one-undo', scenario: '一句命令改了计划 + 计划说明：「教练改过的」只显示一条，一次撤回把任务和说明都恢复', input: '今天重做 2 道错题', source: 'builtin',
    expect: ['一条命令 = 一条记录（action_count=2）', '撤回一次 → 任务和说明都恢复', '整组已撤回再撤 409', '确认的建议也是一条、一次撤回', 'flat=1 仍是旧的一动作一行'], must_not: ['要撤两次'],
    run: async (s) => {
      for (const q of ['01', '02', '03']) await s.wrong(`math1-2024-${q}`);
      const d = await today(s);
      const plan0 = await s.get('/plans/today');
      const r = await s.command('今天重做 2 道错题');
      const list = (await s.get('/agent/actions')).items;
      const flat = (await s.get('/agent/actions?flat=1')).items;
      const e = list[0];
      const mid = await s.get('/plans/today');
      const u = e ? await s.send('POST', `/agent/actions/${e.id}/undo`) : { status: 0, body: null };
      const after = await s.get('/plans/today');
      const other = e?.actions?.find((a: any) => a.id !== e.id);
      const u2 = other ? await s.send('POST', `/agent/actions/${other.id}/undo`) : { status: 0 };
      const list2 = (await s.get('/agent/actions?include_undone=false')).items;
      // 确认的建议（ask + 开发触发）也合成一条
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask' });
      const j = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      const c = j.body?.proposal ? await s.send('POST', `/agent/messages/${j.body.proposal.message_id}/confirm`, {}) : { status: 0, body: null };
      const cl = (await s.get('/agent/actions')).items.filter((x: any) => x.trigger === 'confirm');
      const tm = addDays(d, 1);
      const tBefore = (await planTasks(s, tm)).length;
      const cu = cl[0] ? await s.send('POST', `/agent/actions/${cl[0].actions[cl[0].actions.length - 1].id}/undo`) : { status: 0, body: null };
      const tAfter = (await planTasks(s, tm)).length;
      return [
        pass('一条命令 = 一条记录', 'expect', r.actions.length === 2 && list.length === 1 && e.action_count === 2 && e.target.kind === 'plan_task' && !/计划的说明/.test(e.summary) && flat.length === 2, `${list.length} 条 / ${e?.action_count} 动作 / ${e?.summary} / flat ${flat.length}`),
        pass('命令后计划和说明都改了', 'expect', mid.plan.tasks.length === plan0.plan.tasks.length + 1 && !!mid.plan.why_changed && mid.last_agent_action?.id === e?.id && !/计划的说明/.test(mid.last_agent_action?.summary ?? ''), `${mid.plan.tasks.length} ${mid.plan.why_changed} ${mid.last_agent_action?.summary}`),
        pass('撤回一次 → 任务和说明都恢复', 'expect', u.status === 200 && u.body?.undone_action_ids?.length === 2 && after.plan.tasks.length === plan0.plan.tasks.length && after.plan.why_changed === (plan0.plan.why_changed ?? null) && list2.length === 0,
          `${u.status} ${u.body?.undone_action_ids?.length} tasks ${after.plan.tasks.length} why ${after.plan.why_changed} live ${list2.length}`),
        pass('组里另一条再撤 → 409', 'must_not', u2.status === 409, String(u2.status)),
        pass('确认的建议：一条记录、一次撤回', 'expect', c.status === 200 && cl.length === 1 && cl[0].action_count === c.body?.actions?.length && tBefore > tAfter && cu.status === 200 && cu.body?.undone_action_ids?.length === cl[0].action_count,
          `${c.status} ${cl.length}/${cl[0]?.action_count} tasks ${tBefore}→${tAfter} ${cu.status}`),
      ];
    },
  },
  {
    id: 'dev-force-proposal', scenario: '没有 API Key 也能看到「先问我」的建议：POST /agent/jobs/run {job, force:true}', input: 'POST /agent/jobs/run', source: 'builtin',
    expect: ['新账号（没数据）也有一条 pending 建议（演示改动）', '有错题时按数据建议重做', '立刻送达（不按免打扰排队）', '没确认前计划不变'], must_not: ['调模型'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      const d = await today(s);
      const a = await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true });
      const m = await s.get('/agent/messages');
      const pm = m.items.find((i: any) => i.kind === 'proposal');
      const t0 = (await planTasks(s, d)).length;
      await s.wrong('math1-2024-01');
      const b = await s.send('POST', '/agent/jobs/run', { job: 'weekly', force: true });
      const bad = await s.send('POST', '/agent/jobs/run', { job: 'x', force: true });
      return [
        pass('没数据也有 pending 建议', 'expect', a.status === 200 && ['mock', 'rule'].includes(a.body.mode) && a.body.proposal?.items?.length >= 1 && pm?.proposal?.status === 'pending', JSON.stringify(a.body?.proposal?.items?.map((x: any) => x.summary))),
        pass('立刻送达', 'expect', !!pm && m.queued === 0, `queued ${m.queued}`),
        pass('没确认前计划不变', 'must_not', t0 === 0, String(t0)),
        pass('有错题 → 建议重做', 'expect', b.status === 200 && (b.body.proposal?.items ?? []).some((x: any) => x.input?.add_tasks?.[0]?.kind === 'redo_wrong'), JSON.stringify(b.body?.proposal?.items?.map((x: any) => x.summary))),
        pass('job 不对 → 400 带 code', 'expect', bad.status === 400 && bad.body?.code === 'invalid_job', `${bad.status} ${bad.body?.code}`),
      ];
    },
  },
  {
    id: 'r8-proposal-new-per-run', scenario: '第 8 轮：「先问我」每次任务运行一条新建议；已确认的不会被翻回 pending；确认后标题变过去时', input: 'nightly → 确认 → 做错 → midday → 做错 → weekly', source: 'builtin',
    expect: ['3 条不同的建议消息', '第一条保持 confirmed，标题变「已在…加了…」', '每条只能确认一次（第二次 409 already_decided）', '待确认的文案是「想…」', '忽略后「已忽略，计划没改」', '建议消息的 action 和本次任务同组'], must_not: ['往已确认的建议里塞新改动', '确认后还说「等你确认」'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      const ids: string[] = [];
      const n1 = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      ids.push(n1.body?.proposal?.message_id);
      const c1 = await s.send('POST', `/agent/messages/${ids[0]}/confirm`, {});
      await s.wrong('math1-2024-01');
      ids.push((await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true })).body?.proposal?.message_id);
      await s.wrong('math1-2024-05');
      ids.push((await s.send('POST', '/agent/jobs/run', { job: 'weekly', force: true })).body?.proposal?.message_id);
      const m = await s.get('/agent/messages');
      const props = m.items.filter((i: any) => i.kind === 'proposal');
      const first = props.find((i: any) => i.id === ids[0]);
      const pend = props.filter((i: any) => i.id !== ids[0]).map((p: any) => p.headline);
      const c1again = await s.send('POST', `/agent/messages/${ids[0]}/confirm`, {});
      const c2 = await s.send('POST', `/agent/messages/${ids[1]}/confirm`, {});
      const c2again = await s.send('POST', `/agent/messages/${ids[1]}/dismiss`, {});
      const c3 = await s.send('POST', `/agent/messages/${ids[2]}/dismiss`, {});
      const after = (await s.get('/agent/messages')).items.filter((i: any) => i.kind === 'proposal');
      const third = after.find((i: any) => i.id === ids[2]);
      const acts = (await s.get('/agent/actions?flat=true')).items as any[];
      const tipActs = acts.filter((a: any) => a.tool === 'writeDailyTip' && /教练建议/.test(a.summary));
      return [
        pass('3 条不同的建议消息', 'expect', new Set(ids.filter(Boolean)).size === 3 && props.length === 3, JSON.stringify(ids)),
        pass('第一条 confirmed，标题过去时', 'expect', c1.status === 200 && first?.proposal?.status === 'confirmed' && first?.proposal?.items?.length === 1 && /^已在 ?\S+? ?的计划里加了「/.test(first?.headline) && c1.body?.message?.headline === first?.headline, `${first?.proposal?.status} ${first?.headline}`),
        pass('确认后不说「等你确认 / 还没执行」', 'must_not', !/等你确认|还没执行/.test(`${first?.headline}${first?.details}`), `${first?.details}`),
        pass('重复确认 → 409 already_decided + 中文提示', 'expect', c1again.status === 409 && c1again.body?.code === 'already_decided' && c1again.body?.message === '这条建议已经处理过了' && 'field' in c1again.body, JSON.stringify(c1again.body).slice(0, 160)),
        pass('后两条各确认/忽略一次', 'expect', c2.status === 200 && c2again.status === 409 && c3.status === 200, `${c2.status} ${c2again.status} ${c3.status}`),
        pass('待确认文案是「想…」', 'expect', pend.length === 2 && pend.every((h: string) => /^教练想做 1 处改动/.test(h) && /想在|想把|想更新|想调整|想先/.test(h.split('：')[1] ?? '') && !/加了/.test(h)), JSON.stringify(pend)),
        pass('忽略后「已忽略，计划没改」', 'expect', third?.headline === '已忽略，计划没改' && !/等你确认/.test(third?.details ?? ''), `${third?.headline} | ${third?.details}`),
        pass('建议消息的 action 有 group_id（和本次任务同组）', 'expect', tipActs.length === 3 && tipActs.every((a: any) => a.group_id && acts.some((b: any) => b.id !== a.id && b.group_id === a.group_id)), JSON.stringify(tipActs.map((a: any) => a.group_id))),
        pass('没有往已确认的建议里塞新改动', 'must_not', first?.proposal?.items?.length === 1 && first?.proposal?.status === 'confirmed'),
      ];
    },
  },
  {
    id: 'r13-proposal-expired', scenario: '第 13 轮复测：待确认建议的目标日过了（X-Debug-Now 8 天后）→ 读成 expired、标题「已过期，计划没动。原本想…」，确认 409 proposal_expired 且什么都不改', input: 'nightly(ask) → X-Debug-Now +8 天读消息 → confirm', source: 'builtin',
    expect: ['当天读还是 pending', '8 天后读 status=expired（顶层和 proposal.status）', '标题以「已过期」开头，不说「等你确认」', '确认 → 409 proposal_expired + 中文 message', '目标日计划没变'], must_not: ['过期后还能确认执行'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask' });
      const d = await today(s);
      const n1 = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      const id = n1.body?.proposal?.message_id;
      const target = n1.body?.proposal?.items?.[0]?.input?.date ?? addDays(d, 1);
      const now0 = (await s.get('/agent/messages')).items.find((i: any) => i.id === id);
      const planBefore = (await s.get(`/plans?from=${target}&to=${target}`)).items?.[0];
      s.debugNow = localIso(s, addDays(d, 8), '10:00');
      const later = (await s.get('/agent/messages')).items.find((i: any) => i.id === id);
      const c = await s.send('POST', `/agent/messages/${id}/confirm`, {});
      s.debugNow = null;
      const planAfter = (await s.get(`/plans?from=${target}&to=${target}`)).items?.[0];
      const n = (p: any) => (p?.tasks ?? []).length;
      const row = (await db.query(`SELECT proposal->>'status' st FROM daily_tips WHERE id=$1`, [id])).rows[0];
      return [
        pass('当天读 pending', 'expect', now0?.status === 'pending' && now0?.proposal?.status === 'pending', `${now0?.status}`),
        pass('8 天后 expired', 'expect', later?.status === 'expired' && later?.proposal?.status === 'expired' && later?.target_date === target, `${later?.status} ${later?.proposal?.status} ${later?.target_date}`),
        pass('标题「已过期，计划没动。原本想…」', 'expect', /^已过期，计划没动。原本想/.test(later?.headline ?? '') && !/等你确认|还没执行|\{\{/.test(`${later?.headline}${later?.details}`), `${later?.headline} | ${later?.details}`),
        pass('确认 → 409 proposal_expired', 'expect', c.status === 409 && c.body?.code === 'proposal_expired' && /过期/.test(c.body?.message ?? '') && c.body?.proposal?.status === 'expired', JSON.stringify(c.body).slice(0, 200)),
        pass('目标日计划没变、库里没改', 'expect', n(planBefore) === n(planAfter) && row?.st === 'pending', `${n(planBefore)} → ${n(planAfter)} ${row?.st}`),
        pass('过期后不能确认执行', 'must_not', c.status !== 200),
      ];
    },
  },
  {
    id: 'r8-proposal-dedupe', scenario: '第 8 轮：建议去重——已确认 / 计划里已有的不再提，热身排过一次不再提；老数据读时也显示过去时', input: 'nightly → 确认 → midday → weekly', source: 'builtin',
    expect: ['midday / weekly 不再出建议，结果里说原因', '消息里只有 1 条建议', '库里老的已确认建议读出来是过去时'], must_not: ['再提一次热身'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      const d = await today(s);
      const n1 = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      await s.send('POST', `/agent/messages/${n1.body?.proposal?.message_id}/confirm`, {});
      const mid = await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true });
      const wk = await s.send('POST', '/agent/jobs/run', { job: 'weekly', force: true });
      const props = (await s.get('/agent/messages')).items.filter((i: any) => i.kind === 'proposal');
      // 老数据：库里标题还是「等你确认」的已确认建议
      await db.query(`INSERT INTO daily_tips(user_id,tip_date,kind,text,headline,details,source,delivered_at,proposal) VALUES($1,$2,'proposal',$3,$3,$4,'agent',now()-interval '1 minute',$5::jsonb)`,
        [s.userId, addDays(d, -1), '教练想做 1 处改动，等你确认后才执行：在 10-31 的计划里加了「重做 1 道错题」', '这些改动还没执行。',
          JSON.stringify({ status: 'confirmed', items: [{ tool: 'updateDailyPlan', input: {}, summary: '在 10-31 的计划里加了「重做 1 道错题」' }], applied_items: [0] })]);
      const old = (await s.get('/agent/messages')).items.find((i: any) => i.kind === 'proposal' && i.date === addDays(d, -1));
      return [
        pass('midday / weekly 不再出建议，说原因', 'expect', mid.body?.proposal === null && /没有新的建议/.test(mid.body?.proposal_skipped ?? '') && wk.body?.proposal === null && !!wk.body?.proposal_skipped, `${mid.body?.proposal_skipped} | ${wk.body?.proposal_skipped}`),
        pass('只有 1 条建议', 'expect', props.length === 1, String(props.length)),
        pass('没有再提热身', 'must_not', props.length === 1),
        pass('老数据读时过去时', 'expect', old?.headline === '已在 10-31 的计划里加了「重做 1 道错题」' && !/还没执行/.test(old?.details ?? ''), `${old?.headline} | ${old?.details}`),
      ];
    },
  },
  {
    id: 'r8-wrong-filter', scenario: '第 8 轮：「昨天的错题」= 按做错的日子筛题（用户时区），「明天 / 后天排」才是排的日子；筛不到就直说、不改计划', input: '昨天的错题帮我排 1 道', source: 'builtin',
    expect: ['昨天的错题 → 排今天，用的是昨天做错的那道', '今天做错的题明天排 → 排明天，用今天做错的那道', '上周的错题（没有）→ 直说、问要不要换，不改计划', '「昨天加 1 道错题」仍是排期：排今天并说明'], must_not: ['排到昨天', '筛不到时偷偷换题'],
    run: async (s) => {
      const d = await today(s);
      await s.wrong('math1-2024-01'); await s.wrong('math1-2024-05');
      const y = localIso(s, addDays(d, -1), '12:00');
      await db.query(`UPDATE wrong_questions SET first_wrong_at=$3, last_wrong_at=$3 WHERE user_id=$1 AND question_id=$2`, [s.userId, 'math1-2024-01', y]);
      const r1 = await s.command('昨天的错题帮我排 1 道');
      const t1 = (await planTasks(s, d)).filter((x: any) => x.kind === 'redo_wrong');
      const yPlan = await planTasks(s, addDays(d, -1));
      const r2 = await s.command('今天做错的题明天帮我排 1 道');
      const t2 = (await planTasks(s, addDays(d, 1))).filter((x: any) => x.kind === 'redo_wrong');
      const before = (await planTasks(s, d)).length;
      const r3 = await s.command('上周的错题帮我排 2 道');
      const after = (await planTasks(s, d)).length;
      const r4 = await s.command('后天加 1 道错题');
      const monday = new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
      const rep = (r: any) => r.done?.reply ?? '';
      const ids = (ts: any[]) => ts.flatMap((x: any) => x.payload?.question_ids ?? []);
      return [
        pass('昨天的错题 → 今天排，题是昨天错的', 'expect', ids(t1).includes('math1-2024-01') && !ids(t1).includes('math1-2024-05') && /昨天/.test(rep(r1)) && r1.done?.date === d, `${rep(r1)} | ${JSON.stringify(ids(t1))}`),
        pass('没有排到昨天', 'must_not', yPlan.length === 0, String(yPlan.length)),
        pass('今天做错的 → 明天排，题是今天错的', 'expect', ids(t2).includes('math1-2024-05') && !ids(t2).includes('math1-2024-01') && /今天/.test(rep(r2)), `${rep(r2)} | ${JSON.stringify(ids(t2))}`),
        // 今天是周一时「昨天」就在上周里（上周确实有错题），这条只在周二到周日检查
        pass('上周没有 → 直说并问，不改计划', 'expect', monday || (/上周（.+）没有做错的题/.test(rep(r3)) && /要换一下吗|回「/.test(rep(r3)) && r3.actions.length === 0 && before === after), `${monday ? '（今天周一，跳过）' : ''}${rep(r3)}`),
        pass('筛不到时没偷偷换题', 'must_not', monday || r3.actions.length === 0),
        pass('「后天加 1 道错题」照常排后天', 'expect', r4.done?.date === addDays(d, 2) && r4.actions.length >= 1, `${rep(r4)} ${r4.done?.date}`),
      ];
    },
  },
  {
    id: 'r15-offline-upload', scenario: '第 15 轮：离线题包补传——昨晚断网做的题（answered_at=昨天 21:00、source=offline_pack）今天联网补传，教练按做题那天算；重发不重复计', input: '补传 3 题（2 错）×2 → 昨天的错题帮我排 1 道', source: 'builtin',
    expect: ['补传的作答按 answered_at 记到昨天（学习日）', '重发全 duplicate，作答条数不变', '「昨天的错题」能筛到补传的错题并排进今天', '错题本 / 统计和在线做一样'], must_not: ['补传的题被当成今天做的', '重发后作答或错题次数翻倍'],
    run: async (s) => {
      const d = await today(s), y = addDays(d, -1);
      const pack = await s.get('/offline/pack');
      const at = localIso(s, y, '21:00');
      const items = [
        { question_id: 'math1-2024-01', answer: ['Z'] }, { question_id: 'math1-2024-05', answer: ['Z'] }, { question_id: 'math1-2024-17', self_rating: 'full' },
      ].map((x, k) => ({ ...x, client_id: `eval-off-${s.userId.slice(0, 8)}-${k}`, answered_at: at, source: 'offline_pack', pack_version: pack.version }));
      const r1 = await s.send('POST', '/answers', { items });
      const r2 = await s.send('POST', '/answers', { items });
      const rows = (await db.query(`SELECT source, pack_version, to_char(answered_at AT TIME ZONE $2 - interval '4 hours','YYYY-MM-DD') sd FROM answer_records WHERE user_id=$1`, [s.userId, s.tz])).rows;
      const wq = (await db.query(`SELECT question_id, wrong_count FROM wrong_questions WHERE user_id=$1 ORDER BY question_id`, [s.userId])).rows;
      const stats = await s.get('/me/stats');
      const r = await s.command('昨天的错题帮我排 1 道');
      const t = (await planTasks(s, d)).filter((x: any) => x.kind === 'redo_wrong').flatMap((x: any) => x.payload?.question_ids ?? []);
      const rep = r.done?.reply ?? '';
      return [
        pass('补传 3 条 recorded，学习日 = 昨天', 'expect', r1.body?.items?.every((i: any) => i.status === 'recorded' && i.study_date === y) && rows.length === 3 && rows.every((x: any) => x.sd === y && x.source === 'offline_pack' && x.pack_version === pack.version), JSON.stringify(rows)),
        pass('重发全 duplicate', 'expect', r2.body?.items?.every((i: any) => i.status === 'duplicate' && i.duplicate === true) && r2.body.items.map((i: any) => i.id).join() === r1.body.items.map((i: any) => i.id).join()),
        pass('错题本 2 道、各 1 次；统计 3 次作答', 'expect', wq.length === 2 && wq.every((w: any) => w.wrong_count === 1) && stats.attempts === 3, `${JSON.stringify(wq)} attempts=${stats.attempts}`),
        pass('「昨天的错题」筛到补传的错题、排今天', 'expect', t.some((q: string) => ['math1-2024-01', 'math1-2024-05'].includes(q)) && r.done?.date === d && /昨天/.test(rep), `${rep} | ${JSON.stringify(t)}`),
        pass('没把补传的题算成今天', 'must_not', rows.every((x: any) => x.sd !== d)),
        pass('重发没翻倍', 'must_not', rows.length === 3 && wq.every((w: any) => w.wrong_count === 1)),
      ];
    },
  },
  {
    id: 'r8-mismatch-explained', scenario: '第 8 轮：执行和说的不一样（没错题 / 错题不够 / 日期已过 / 超上限 / 没得加）→ 回复里一句话说清原因和改成了什么', input: '明天加 10 道错题 …', source: 'builtin',
    expect: ['没错题 → 「你现在没有错题，先排了 10 道基础题」，题数=10', '不够 N 道 → 「只有 k 道，先排了这 k 道」', '说昨天 → 排今天并说明', '超过上限 → 说明封顶', '没得加 → 说明为什么没改'], must_not: ['只回「已改计划」不解释'],
    run: async (s) => {
      const d = await today(s);
      const r1 = await s.command('明天加 10 道错题');
      const t1 = (await planTasks(s, addDays(d, 1))).find((x: any) => x.kind === 'practice');
      const r1b = await s.command('后天练 30 道错题');
      await s.wrong('math1-2024-01'); await s.wrong('math1-2024-05');
      const r2 = await s.command('后天重做 5 道错题');
      const r3 = await s.command('后天再加 4 道错题');
      const why2 = ((await s.get(`/plans?from=${addDays(d, 2)}&to=${addDays(d, 2)}`)).items[0]?.tasks ?? []).find((x: any) => x.kind === 'redo_wrong')?.why_changed ?? ''; // 那条重做任务自己的理由（计划的 why_changed 现在是各任务理由拼起来的）
      const r4 = await s.command('昨天加 1 道错题');
      const t4 = (await planTasks(s, d)).filter((x: any) => x.kind === 'redo_wrong');
      const rep = (r: any) => r.done?.reply ?? '';
      return [
        pass('没错题 → 说明并按 10 道排', 'expect', /你现在没有错题，先排了 10 道基础题/.test(rep(r1)) && t1?.payload?.count === 10 && /没有错题/.test(r1.done?.summary ?? ''), `${rep(r1)} | ${t1?.title}`),
        pass('超过 20 → 说明封顶', 'expect', /最多排 20 道/.test(rep(r1b)), rep(r1b)),
        pass('不够 5 道 → 说明只有 2 道', 'expect', /只有 2 道，先排了这 2 道/.test(rep(r2)), rep(r2)),
        pass('why_changed 写实际做的（和回复同一句），不复述原话', 'expect', /只有 2 道，先排了这 2 道/.test(why2) && !/5 道错题」/.test(why2) && rep(r2).includes(why2.trim()), why2),
        pass('没得加 → 说明为什么没改', 'expect', /已经都排进/.test(rep(r3)) && r3.actions.length === 0, rep(r3)),
        pass('说昨天 → 排到今天并说明', 'expect', /昨天已经过去了，排到了今天/.test(rep(r4)) && t4.length >= 1, rep(r4)),
        pass('不是只回「已改计划」', 'must_not', [r1, r2, r4].every((r) => /。.+。$/.test(rep(r)))),
      ];
    },
  },
  {
    id: 'r8-error-shape', scenario: '第 8 轮：404 / 409 统一 {statusCode,error,message,field,code}，message 学生看得懂', input: '重复撤回 / 不存在的操作', source: 'builtin',
    expect: ['重复撤回 409 already_undone「这条已经撤回过了」', '不存在 404 带 code', '未知路由 404 中文'], must_not: ['英文报错'],
    run: async (s) => {
      const r = await s.command('明天加 1 道题');
      const id = r.actions[0]?.id;
      const u1 = await s.send('POST', `/agent/actions/${id}/undo`);
      const u2 = await s.send('POST', `/agent/actions/${id}/undo`);
      const nf = await s.send('POST', `/agent/actions/00000000-0000-0000-0000-000000000000/undo`);
      const bad = await s.send('POST', `/agent/actions/not-a-uuid/undo`);
      const route = await s.send('GET', '/no-such-route');
      const shape = (b: any) => b && ['statusCode', 'error', 'message', 'field', 'code'].every((k) => k in b) && /[\u4e00-\u9fff]/.test(b.message);
      return [
        pass('重复撤回 409 already_undone', 'expect', u1.status === 200 && u2.status === 409 && u2.body?.code === 'already_undone' && u2.body?.message === '这条已经撤回过了' && shape(u2.body), JSON.stringify(u2.body)),
        pass('不存在 404 带 code', 'expect', nf.status === 404 && nf.body?.code === 'action_not_found' && shape(nf.body) && bad.status === 404 && shape(bad.body), JSON.stringify(nf.body)),
        pass('未知路由 404 中文', 'expect', route.status === 404 && shape(route.body) && route.body.code === 'not_found', JSON.stringify(route.body)),
        pass('没有英文报错', 'must_not', [u2, nf, bad, route].every((x) => shape(x.body))),
      ];
    },
  },
  {
    id: 'r8-register-tz', scenario: '第 8 轮：注册时读 X-Timezone（→ body.timezone → Asia/Shanghai）', input: 'POST /auth/register', source: 'builtin',
    expect: ['带 X-Timezone → 存它', '只带 body.timezone → 存它', '都没有 / 不合法 → Asia/Shanghai'], must_not: ['忽略 X-Timezone'],
    run: async () => {
      const reg = async (headers: any, body: any) => {
        const username = `eval_tz_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const r: any = await (await fetch(`${BASE}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ username, password: TEST_PW, ...body }) })).json();
        const me: any = await (await fetch(`${BASE}/me/settings`, { headers: { authorization: `Bearer ${r.access_token}` } })).json();
        return me.timezone ?? me.settings?.timezone;
      };
      const a = await reg({ 'x-timezone': 'America/Los_Angeles' }, { timezone: 'Europe/London' });
      const b = await reg({}, { timezone: 'Europe/London' });
      const c = await reg({ 'x-timezone': 'Not/AZone' }, {});
      return [
        pass('X-Timezone 优先', 'expect', a === 'America/Los_Angeles', a),
        pass('body.timezone 其次', 'expect', b === 'Europe/London', b),
        pass('不合法 → Asia/Shanghai', 'expect', c === 'Asia/Shanghai', c),
        pass('没有忽略 X-Timezone', 'must_not', a === 'America/Los_Angeles'),
      ];
    },
  },
  {
    id: 'r8-dedupe-window', scenario: '第 8 轮复测：去重窗口 = 今天起 7 天——明天已确认的改动，今天（midday）不再提', input: '做错 → nightly 确认 → midday → weekly', source: 'builtin',
    expect: ['midday 不再提已排进明天的重做', 'weekly 不再提今天 / 明天已排的同一知识点练习和重做'], must_not: ['跨天重复提同一条改动'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      await s.wrong('math1-2024-01');
      const n1 = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      await s.send('POST', `/agent/messages/${n1.body?.proposal?.message_id}/confirm`, {});
      const mid = await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true });
      if (mid.body?.proposal?.message_id) await s.send('POST', `/agent/messages/${mid.body.proposal.message_id}/confirm`, {});
      const wk = await s.send('POST', '/agent/jobs/run', { job: 'weekly', force: true });
      const adds = (r: any) => (r.body?.proposal?.items ?? []).flatMap((x: any) => x.input?.add_tasks ?? []);
      const key = (t: any) => t.payload?.demo ? 'demo' : t.kind === 'redo_wrong' ? `redo:${(t.payload?.question_ids ?? []).sort().join(',')}` : `${t.kind}:${t.payload?.kp_path ?? t.title}`;
      const k1 = adds(n1).map(key), k2 = adds(mid).map(key), k3 = adds(wk).map(key);
      return [
        pass('midday 不重复 nightly 已确认的（明天的）改动', 'expect', !!n1.body?.proposal && k2.every((k: string) => !k1.includes(k)), `${JSON.stringify(k1)} → ${JSON.stringify(k2)} ${mid.body?.proposal_skipped ?? ''}`),
        pass('weekly 不重复前两次的改动', 'expect', k3.every((k: string) => !k1.includes(k) && !k2.includes(k)), `${JSON.stringify(k3)} ${wk.body?.proposal_skipped ?? ''}`),
        pass('没有跨天重复提', 'must_not', new Set([...k1, ...k2, ...k3]).size === k1.length + k2.length + k3.length),
      ];
    },
  },
  {
    id: 'r8-forced-copy', scenario: '第 8 轮复测：测试触发的文案按真实设置写、标「（测试触发）」，不冒用「提醒频率选了「多」」；时间词按用户当地时间', input: '先问我 + 07:40 强制 midday', source: 'builtin',
    expect: ['历史里 reason 不提提醒频率', 'summary 带「（测试触发）」、forced=true', '本地 07:40 不说「下午」', '确认后 message.status=confirmed'], must_not: ['提醒频率选了「多」'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      const d = await today(s);
      s.debugNow = localIso(s, d, '07:40');
      await s.wrong('math1-2024-01');
      const mid = await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true });
      const before = (await s.get('/agent/messages')).items.find((i: any) => i.id === mid.body?.proposal?.message_id);
      const c = await s.send('POST', `/agent/messages/${mid.body?.proposal?.message_id}/confirm`, {});
      const after = (await s.get('/agent/messages')).items.find((i: any) => i.id === mid.body?.proposal?.message_id);
      const acts = ((await s.get('/agent/actions?flat=true')).items as any[]).filter((a: any) => a.trigger === 'midday');
      const why = JSON.stringify(mid.body?.proposal?.items?.map((x: any) => x.input?.why_changed));
      s.debugNow = null;
      return [
        pass('结果 forced=true，summary 带（测试触发）', 'expect', mid.body?.forced === true && /（测试触发）$/.test(mid.body?.summary ?? ''), `${mid.body?.forced} ${mid.body?.summary}`),
        pass('历史：每条都 forced、带（测试触发）', 'expect', acts.length > 0 && acts.every((a: any) => a.forced === true && /（测试触发）$/.test(a.summary)), JSON.stringify(acts.map((a: any) => [a.summary, a.reason]))),
        pass('reason 不提提醒频率', 'must_not', acts.every((a: any) => !/提醒频率/.test(a.reason)) && !/提醒频率选了「多」/.test(JSON.stringify(mid.body)), JSON.stringify(acts.map((a: any) => a.reason))),
        pass('07:40 不说「下午」', 'expect', !/下午/.test(why + (mid.body?.reply ?? '')) && /今天先重做/.test(why), why),
        pass('message.status：pending → confirmed', 'expect', before?.status === 'pending' && c.body?.message?.status === 'confirmed' && after?.status === 'confirmed', `${before?.status} ${c.body?.message?.status} ${after?.status}`),
      ];
    },
  },
  {
    id: 'r8-why-per-task', scenario: '第 8 轮复测：后来的改动不覆盖前面已确认改动的理由（why_changed 按任务记）', input: 'nightly 确认热身 → 做错 → 今天做错的明天排 1 道', source: 'builtin',
    expect: ['明天的 why_changed 同时有热身和重做两条理由', '每条任务有自己的 why_changed'], must_not: ['热身的理由被覆盖'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      const d = await today(s), t = addDays(d, 1);
      const n1 = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      await s.send('POST', `/agent/messages/${n1.body?.proposal?.message_id}/confirm`, {});
      await s.wrong('math1-2024-05');
      await s.send('PATCH', '/me/settings', { coach_frequency: 'normal' });
      const r = await s.command('今天做错的题明天帮我排 1 道');
      const plan = (await s.get(`/plans?from=${t}&to=${t}`)).items[0];
      const warm = plan?.tasks?.find((x: any) => x.payload?.demo), redo = plan?.tasks?.find((x: any) => x.kind === 'redo_wrong');
      return [
        pass('热身和重做各有理由', 'expect', !!warm?.why_changed && !!redo?.why_changed && warm.why_changed !== redo.why_changed, `${warm?.why_changed} | ${redo?.why_changed}`),
        pass('计划 why_changed 两条都在', 'expect', (plan?.why_changed ?? '').includes(warm?.why_changed ?? '∅') && (plan?.why_changed ?? '').includes(redo?.why_changed ?? '∅'), `${plan?.why_changed} | ${r.done?.reply}`),
        pass('热身理由没被覆盖', 'must_not', /热身/.test(plan?.why_changed ?? '')),
      ];
    },
  },
  {
    id: 'r8-no-null-text', scenario: '第 8 轮复测：没有数据时学生看到的文字里不出现 null / undefined / NaN（周报「约 null 分钟」）', input: '新账号 weekly / nightly / midday / 命令', source: 'builtin',
    expect: ['周报写「还没有学习时长记录」', '所有消息、计划说明、历史里没有 null / undefined / NaN'], must_not: ['约 null 分钟'],
    run: async (s) => {
      const wk = await s.send('POST', '/agent/jobs/run', { job: 'weekly', force: true });
      await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true });
      await s.command('今天只有一小时');
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask' });
      await s.send('POST', '/agent/jobs/run', { job: 'weekly', force: true });
      const d0 = await today(s);
      const rows = (await db.query(
        `SELECT text x FROM daily_tips WHERE user_id=$1 UNION ALL SELECT headline FROM daily_tips WHERE user_id=$1 UNION ALL SELECT details FROM daily_tips WHERE user_id=$1
         UNION ALL SELECT why_changed FROM study_plans WHERE user_id=$1 UNION ALL SELECT t.title FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id WHERE p.user_id=$1
         UNION ALL SELECT t.why_changed FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id WHERE p.user_id=$1
         UNION ALL SELECT summary FROM agent_actions WHERE user_id=$1 UNION ALL SELECT reason FROM agent_actions WHERE user_id=$1 UNION ALL SELECT result->>'reply' FROM agent_commands WHERE user_id=$1`, [s.userId])).rows.map((r: any) => r.x).filter(Boolean);
      const msgs = (await s.get('/agent/messages')).items.flatMap((i: any) => [i.headline, i.details]);
      const leak = [...rows, ...msgs].filter((x: any) => typeof x === 'string' && (/\b(null|undefined|NaN)\b|\[object Object\]/.test(x) || BAD_PUNCT.test(x)));
      const weekly = (await s.get('/agent/messages')).items.find((i: any) => i.kind === 'weekly');
      return [
        pass('周报写「还没有学习时长记录」', 'expect', /还没有学习时长记录/.test(weekly?.details ?? ''), weekly?.details),
        pass('没有 null / undefined / NaN / 标点连用', 'must_not', leak.length === 0 && !/约 null/.test(JSON.stringify(wk.body)), JSON.stringify(leak).slice(0, 300)),
        // 库里存的是 {{date:…}} 占位符，按今天渲染后再查；接口读出来的 msgs 原样查（占位符漏出来也算错）
        await labelCheck(s, [...rows.map((x: any) => renderDates(x, d0)), ...msgs], d0),
      ];
    },
  },
  {
    id: 'r9-cmd-redo-after-wrong', scenario: '第 9 轮复测 B1：同一句话间隔很短，但中间做错了题（数据变了）→ 重新执行；数据没变才算重复', input: '今天做错的明天排 1 道 ×3（中间做错 1 题）', source: 'builtin',
    expect: ['做错后再说一遍会真的排上重做', '数据没变时第三遍才算重复', '回复里没有「。，」之类的标点连用'], must_not: ['数据变了还说「这次没有重复执行」'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      const d = await today(s), t = addDays(d, 1);
      const c1 = await s.command('今天做错的明天排 1 道');
      await s.wrong('math1-2024-05');
      const c2 = await s.command('今天做错的明天排 1 道');
      const c3 = await s.command('今天做错的明天排 1 道');
      const plan = (await s.get(`/plans?from=${t}&to=${t}`)).items[0];
      const redo = plan?.tasks?.find((x: any) => x.kind === 'redo_wrong' && (x.payload?.question_ids ?? []).includes('math1-2024-05'));
      const replies = [c1, c2, c3].map((c) => c.done?.reply ?? '');
      return [
        pass('做错后再说：重新执行，明天排上了这道', 'expect', c2.done?.deduped !== true && !!redo, `${c2.done?.deduped} ${c2.done?.reply} | ${redo?.title}`),
        pass('数据没变的第三遍：算重复', 'expect', c3.done?.deduped === true, `${c3.done?.deduped} ${c3.done?.reply}`),
        pass('回复没有标点连用 / 漏值', 'must_not', replies.every((x) => !BAD_PUNCT.test(x) && !/\b(null|undefined|NaN)\b/.test(x)), JSON.stringify(replies)),
        pass('数据变了不说「没有重复执行」', 'must_not', !/没有重复执行/.test(replies[1]), replies[1]),
        pass('第三遍说「明天（MM-DD）的计划里已经有」，不说今天', 'expect', replies[2].includes(`明天（${t.slice(5)}）`) && !replies[2].includes(`今天（${t.slice(5)}）`), replies[2]),
        await labelCheck(s, [c1, c2, c3].flatMap((c) => [c.done?.reply, ...(c.steps ?? [])])),
      ];
    },
  },
  {
    id: 'r9-plan-why-own-date', scenario: '第 9 轮复测 B2：今天的计划空着时，why_changed 不能显示明天那条改动的原因；why_changed / why_changed_latest 只看这一天的任务', input: '今天做错的明天排 1 道', source: 'builtin',
    expect: ['今天 why_changed / why_changed_latest 都是 null', '明天的 why_changed_latest 有值且包含在 why_changed 里'], must_not: ['别的日子的原因出现在今天'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      await s.wrong('math1-2024-05');
      await s.command('今天做错的明天排 1 道');
      const td = await s.get('/plans/today');
      const tm = (await s.get(`/plans?from=${t}&to=${t}`)).items[0];
      const todayTasks = td.plan?.tasks ?? [];
      return [
        pass('今天（空计划）why 都是 null', 'expect', todayTasks.length > 0 || (td.why_changed === null && (td.plan?.why_changed ?? null) === null && (td.plan?.why_changed_latest ?? null) === null && (td.why_changed_latest ?? null) === null),
          `${todayTasks.length} 项 | ${td.why_changed} | ${td.plan?.why_changed_latest}`),
        pass('明天 latest 有值且一致', 'expect', !!tm?.why_changed_latest && (tm?.why_changed ?? '').includes(tm.why_changed_latest), `${tm?.why_changed} | ${tm?.why_changed_latest}`),
        pass('别的日子的原因没出现在今天', 'must_not', !todayTasks.length ? !td.why_changed : true, td.why_changed),
      ];
    },
  },
  {
    id: 'r9-dismissed-skip', scenario: '第 9 轮复测 B3：忽略过的建议不再提，并且说「这条你已经忽略过了」，不说「计划里该有的都有了」', input: '先问我：每次 force midday 都忽略，直到没有新建议；再 force weekly', source: 'builtin',
    expect: ['最后一次 midday 说「已经忽略过了」', 'weekly 也说忽略过（或混合原因里带忽略过）', 'proposal_skipped_reason 有值'], must_not: ['全是忽略过的还说「计划里该有的都有了」'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      await s.wrong('math1-2024-01');
      let mid: any = null; let n = 0;
      for (; n < 5; n++) {
        mid = await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true });
        if (!mid.body?.proposal?.message_id) break;
        await s.send('POST', `/agent/messages/${mid.body.proposal.message_id}/dismiss`, {});
      }
      const wk = await s.send('POST', '/agent/jobs/run', { job: 'weekly', force: true });
      return [
        pass('midday 说「已经忽略过了」', 'expect', mid.body?.proposal == null && mid.body?.proposal_skipped_reason === 'dismissed' && /这条你已经忽略过了，不再提|这 \d+ 条你已经忽略过了/.test(mid.body?.proposal_skipped ?? ''), `忽略 ${n} 次后：${mid.body?.proposal_skipped_reason} ${mid.body?.proposal_skipped}`),
        pass('weekly 原因带「忽略过」', 'expect', wk.body?.proposal == null && ['dismissed', 'mixed'].includes(wk.body?.proposal_skipped_reason) && /忽略过了/.test(wk.body?.proposal_skipped ?? ''), `${wk.body?.proposal_skipped_reason} ${wk.body?.proposal_skipped} ${wk.body?.proposal ? JSON.stringify(wk.body.proposal.items?.map((x: any) => x.summary)) : ''}`),
        pass('不说「计划里该有的都有了」', 'must_not', !/该有的都有了/.test(`${mid.body?.proposal_skipped}${wk.body?.proposal_skipped}`)),
      ];
    },
  },
  {
    id: 'r9-forced-local-time', scenario: '第 9 轮复测 B5：测试触发的中午提醒按当地时间说（23:53 不说「中午了」）；整题计分的题顶层 sub_scores=null', input: '23:53 / 12:10 强制 midday；GET math1-2018-19', source: 'builtin',
    expect: ['23:53 说「晚上好」', '12:10 说「中午了」', '整题计分 sub_scores=null，按小问的是分值数组'], must_not: ['半夜说「中午了」', 'sub_scores=[null]'],
    run: async (s) => {
      const d = await today(s);
      s.debugNow = localIso(s, d, '23:53');
      const late = await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true });
      s.debugNow = localIso(s, d, '12:10');
      const noon = await s.send('POST', '/agent/jobs/run', { job: 'midday', force: true });
      s.debugNow = null;
      const whole = await s.get('/questions/math1-2018-19'), subs = await s.get('/questions/math1-2019-22');
      const all = JSON.stringify([late.body?.summary, late.body?.actions?.map((a: any) => [a.summary, a.reason])]);
      return [
        pass('23:53 不说中午、说晚上好', 'must_not', !/中午/.test(all) && /晚上好/.test(late.body?.summary ?? ''), all),
        pass('12:10 说「中午了」', 'expect', /中午了/.test(noon.body?.summary ?? ''), noon.body?.summary),
        pass('整题计分 sub_scores=null；按小问是数组', 'expect', whole.score_by_whole === true && whole.sub_scores === null && Array.isArray(subs.sub_scores) && subs.sub_scores.length === 3 && subs.sub_scores.every((x: any) => typeof x === 'number'),
          `${JSON.stringify(whole.sub_scores)} | ${JSON.stringify(subs.sub_scores)}`),
      ];
    },
  },
  {
    id: 'r10-confirmed-planned', scenario: '第 10 轮复测 N2：确认过的建议已经进了计划，再强制夜间复盘说「计划里已经有了」（planned），不说「该有的都有了」（nothing）', input: '先问我：force nightly → 确认，重复到没有新建议', source: 'builtin',
    expect: ['最后一次 proposal_skipped_reason=planned', '文案「计划里已经有了」'], must_not: ['reason=nothing'],
    run: async (s) => {
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      await s.wrong('math1-2024-01');
      let j: any = null; let n = 0;
      for (; n < 6; n++) {
        j = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
        if (!j.body?.proposal?.message_id) break;
        await s.send('POST', `/agent/messages/${j.body.proposal.message_id}/confirm`, {});
      }
      return [
        pass('确认后再触发：reason=planned', 'expect', n > 0 && j.body?.proposal == null && j.body?.proposal_skipped_reason === 'planned' && /计划里已经有了/.test(j.body?.proposal_skipped ?? ''), `确认 ${n} 次后：${j.body?.proposal_skipped_reason} ${j.body?.proposal_skipped}`),
        pass('不说 nothing', 'must_not', j.body?.proposal_skipped_reason !== 'nothing'),
      ];
    },
  },
  {
    id: 'r10-crossover-nightly', scenario: '第 10 轮复测 N3：凌晨 00:04（账号时区）强制夜间复盘 → 学习日还是前一天，建议排到日历「今天」、说「明天（MM-DD）」', input: 'X-Debug-Now 次日 00:04；先问我 force nightly', source: 'builtin',
    expect: ['settings.today / study_date = 前一天，calendar_date = 当天', '复盘消息日期 = 学习日', '建议的目标日 = 学习日 + 1', '文字「明天（MM-DD）」'], must_not: ['00:04 就按新的一天算，建议排到后天'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '00:01' } });
      await s.wrong('math1-2024-01');
      s.debugNow = localIso(s, t, '00:04');
      const st = await s.get('/me/settings');
      const pt = await s.get('/plans/today');
      const j = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      const msgs = (await s.get('/agent/messages')).items;
      const review = msgs.find((m: any) => m.kind === 'review');
      const lc = await labelCheck(s, [review?.headline, review?.details, ...(j.body?.proposal?.items ?? []).map((x: any) => x.summary), ...msgs.flatMap((m: any) => [m.headline, m.details])]);
      s.debugNow = null;
      const dates = (j.body?.proposal?.items ?? []).map((x: any) => x.input?.date);
      return [
        pass('settings：today=study_date=前一天，calendar_date=当天', 'expect', st.today === d && st.effective?.study_date === d && st.effective?.calendar_date === t && st.effective?.day_start_hour === 4,
          `${st.today} ${st.effective?.study_date} ${st.effective?.calendar_date} want ${d}/${t}`),
        pass('plans/today：study_date=前一天、relative_day=今天', 'expect', pt.date === d && pt.study_date === d && pt.relative_day === '今天', `${pt.date} ${pt.study_date} ${pt.relative_day}`),
        pass('复盘消息记在学习日、说「明天（MM-DD）」', 'expect', review?.date === d && review?.relative_day === '今天' && (review?.headline ?? '').includes(`明天（${t.slice(5)}）`), `${review?.date} ${review?.relative_day} ${review?.headline}`),
        pass('建议排到学习日 + 1', 'expect', dates.length > 0 && dates.every((x: string) => x === t), `${JSON.stringify(dates)} want ${t}`),
        lc,
      ];
    },
  },
  {
    id: 'r10-crossover-command', scenario: '第 10 轮复测 N1/N3：凌晨 02:00 说「今天做错的明天排 1 道」×3 → 今天=前一天，排到日历当天；第三遍说「明天（MM-DD）的计划里已经有」', input: 'X-Debug-Now 次日 02:00：今天做错的明天排 1 道 ×3', source: 'builtin',
    expect: ['筛的是学习日（前一天）做错的', '排到学习日 + 1', '回复「明天（MM-DD）」'], must_not: ['02:00 把日历今天说成「今天」'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      await s.wrong('math1-2024-05');
      s.debugNow = localIso(s, t, '02:00');
      const cs: any[] = [];
      for (let k = 0; k < 3; k++) cs.push(await s.command('今天做错的明天排 1 道'));
      const lc = await labelCheck(s, cs.flatMap((c) => [c.done?.reply, ...(c.steps ?? [])]));
      const wq = await s.get('/wrong-questions?status=all');
      s.debugNow = null;
      const tasks = await planTasks(s, t);
      const replies = cs.map((c) => c.done?.reply ?? '');
      const wi = (wq.items ?? []).find((x: any) => x.question_id === 'math1-2024-05');
      return [
        pass('排到学习日 + 1（日历当天）', 'expect', cs[0].done?.date === t && tasks.some((x: any) => x.kind === 'redo_wrong' && (x.payload?.question_ids ?? []).includes('math1-2024-05')), `${cs[0].done?.date} want ${t}`),
        pass('第一遍回复说明凌晨 4 点前还算前一天，后两遍不再说（每个学习日一次）', 'expect', replies[0].includes(`凌晨 4 点前还算 ${d.slice(5)} 这一天`) && !/凌晨 4 点前还算/.test(replies[1] + replies[2]) && (cs[0].steps ?? []).some((x: string) => x.includes('02:00')), replies.join(' | ')),
        pass('第三遍「明天（MM-DD）的计划里已经有」', 'expect', replies[2].includes(`明天（${t.slice(5)}）的计划里已经有`), replies[2]),
        pass('错题带 due_date / due_relative_day', 'expect', !!wi && 'due_date' in wi && 'due_relative_day' in wi, JSON.stringify(wi && { due_date: wi.due_date, rel: wi.due_relative_day })),
        lc,
      ];
    },
  },
  {
    id: 'r10-monday-0200', scenario: '第 10 轮复测 N3：周一 02:00 还算周日 → 「这周的错题」是上周一到这个周日，「上周」再往前一周；日期标签对得上', input: 'X-Debug-Now 下个周一 02:00：这周的错题排 1 道 / 上周的错题排 1 道', source: 'builtin',
    expect: ['today = 周日', '这周 = 周一–周日（学习日所在周）', '上周 = 再往前 7 天'], must_not: ['02:00 就算新的一周'],
    run: async (s) => {
      const d = await today(s);
      const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // 周一=0
      const mon = addDays(d, 7 - dow), sun = addDays(mon, -1);
      await s.wrong('math1-2024-01');
      s.debugNow = localIso(s, mon, '02:00');
      const st = await s.get('/me/settings');
      const a = await s.command('这周的错题排 1 道');
      const b = await s.command('上周的错题排 1 道');
      const lc = await labelCheck(s, [a, b].flatMap((c) => [c.done?.reply, ...(c.steps ?? [])]));
      s.debugNow = null;
      const all = (c: any) => [c.done?.reply, ...(c.steps ?? [])].join(' | ');
      const wk = `${addDays(sun, -6).slice(5)}–${sun.slice(5)}`, lw = `${addDays(sun, -13).slice(5)}–${addDays(sun, -7).slice(5)}`;
      return [
        pass('周一 02:00 today = 周日', 'expect', st.today === sun, `${st.today} want ${sun}`),
        pass(`这周 = ${wk}`, 'expect', all(a).includes(`这周（${wk}）`), all(a)),
        pass(`上周 = ${lw}`, 'expect', all(b).includes(`上周（${lw}）`), all(b)),
        pass('排到周日（学习日），不是周一', 'expect', a.done?.date === sun, `${a.done?.date} want ${sun}`),
        lc,
      ];
    },
  },
  {
    id: 'hard-1-one-action', scenario: '用户硬要求 1：主动消息只给明天一件事，细节折叠', input: '（夜间复盘）', source: 'builtin',
    expect: ['headline 一句话 ≤40 字', 'details 单独给（默认折叠）'], must_not: ['一屏建议'],
    run: async (s) => {
      await s.wrong('math1-2024-01'); await s.wrong('math1-2024-05');
      await s.job('nightly', false);
      const m = (await s.get('/agent/messages')).items[0];
      return [
        pass('headline 一句话 ≤40 字', 'expect', !!m && m.headline.length <= 40 && !/\n/.test(m.headline) && (m.headline.match(/[。！]/g) ?? []).length <= 1, m?.headline),
        pass('details 单独给', 'expect', !!m?.details, m?.details),
        pass('不是一屏建议', 'must_not', !!m && m.headline.length <= 40),
      ];
    },
  },
  {
    id: 'hard-2-backoff', scenario: '用户硬要求 2：「别管我」/连续 2 次没看 → 少打扰（可撤回）；再互动 → 恢复；从不加码', input: '别管我', source: 'builtin',
    expect: ['「别管我」→ reduced，每 3 天', '记一条可撤回的 action', '主动来找 → 恢复', '连续两次没看 → 自动 reduced', '看了 → 恢复'], must_not: ['提高频率'],
    run: async (s) => {
      const r = await s.command('别管我');
      const m1 = await s.get('/agent/messages');
      await s.command('今天只有一小时');
      const m2 = await s.get('/agent/messages');
      // 连续两天没看：两条已送达未读的复盘
      const d = await today(s);
      for (const k of [2, 1]) await db.query(`INSERT INTO daily_tips(user_id,tip_date,kind,text,headline,source,delivered_at) VALUES($1,$2,'review','明天先重做 1 道错题。','明天先重做 1 道错题。','eval',now()) ON CONFLICT DO NOTHING`, [s.userId, addDays(d, -k)]);
      const j = await s.job('nightly', true);
      const m3 = await s.get('/agent/messages');
      const seen = await s.send('POST', `/agent/messages/${m3.items[0].id}/seen`);
      const m4 = await s.get('/agent/messages');
      return [
        pass('「别管我」→ reduced 每 3 天', 'expect', m1.proactive?.mode === 'reduced' && m1.proactive?.nightly_every_days === 3, JSON.stringify(m1.proactive)),
        pass('记一条可撤回的 action', 'expect', r.actions.length === 1 && r.actions[0].tool === 'setProactive' && r.actions[0].undoable),
        pass('主动来找 → 恢复', 'expect', m2.proactive?.mode === 'normal', JSON.stringify(m2.proactive)),
        pass('连续两次没看 → 自动 reduced（这次跳过）', 'expect', j.skipped === true && m3.proactive?.mode === 'reduced', JSON.stringify(j)),
        pass('看了 → 恢复', 'expect', seen.body?.proactive_restored === true && m4.proactive?.mode === 'normal', JSON.stringify(seen.body)),
        pass('从不提高频率', 'must_not', [m1, m2, m3, m4].every((m) => Number(m.proactive?.nightly_every_days ?? 1) >= 1)),
      ];
    },
  },
  {
    id: 'hard-3-careless', scenario: '用户硬要求 3：「这题我会，是手滑」→ 记粗心，不扣掌握度，可撤回', input: '这题我会，是手滑', source: 'builtin',
    expect: ['error_type=careless', '掌握度不低于做错前', '可撤回'], must_not: ['掌握度被扣'],
    run: async (s) => {
      const kp = async () => (await db.query(`SELECT COALESCE(sum(score),0)::float s FROM mastery WHERE user_id=$1`, [s.userId])).rows[0].s;
      await s.send('POST', '/answers', { question_id: 'math1-2024-01', answer: ['A'] }); // 先有一点掌握度
      await s.send('POST', '/answers', { question_id: 'math1-2024-01', answer: ['B'] });
      await s.wrong('math1-2024-01');
      const afterWrong = await kp();
      const r = await s.command('这题我会，是手滑', { question_id: 'math1-2024-01' });
      const w = (await s.get('/wrong-questions?status=all')).items.find((x: any) => x.question_id === 'math1-2024-01');
      const afterCareless = await kp();
      const u = r.actions[0] ? await s.send('POST', `/agent/actions/${r.actions[0].id}/undo`) : { status: 0 };
      return [
        pass('error_type=careless', 'expect', w?.error_type === 'careless', w?.error_type),
        pass('掌握度回升（不按做错扣）', 'expect', afterCareless > afterWrong, `${afterWrong} → ${afterCareless}`),
        pass('可撤回', 'expect', u.status === 200 || u.status === 201, String(u.status)),
        pass('掌握度没被扣', 'must_not', afterCareless >= afterWrong),
      ];
    },
  },
  {
    id: 'r11-early-note-once', scenario: '第 11 轮：「凌晨 4 点前还算 MM-DD 这一天」每个学习日每个用户只说一次（第一句涉及今天的回复）；04:00 以后不说；下一个学习日凌晨再说一次；夜间复盘先说了，命令就不再说',
    input: '00:30 今天只有一小时 → 00:40 今天再加一道错题 → 01:10 那今天的单词还背吗 → 04:30 今天只有四十分钟 → 次日 00:30 今天只有半小时', source: 'builtin',
    expect: ['第 1 句回复带这句（MM-DD = 学习日）', '第 2、3 句不带', '04:30 不带', '下一个学习日凌晨第一句再带一次', '复盘先说了 → 同一学习日的命令不再说'], must_not: ['同一学习日说两次'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      await s.wrong('math1-2024-03');
      const at = async (day: string, hhmm: string, text: string) => { s.debugNow = localIso(s, day, hhmm); return s.command(text); };
      const c1 = await at(t, '00:30', '今天只有一小时');
      const c2 = await at(t, '00:40', '今天再加一道错题');
      const c3 = await at(t, '01:10', '那今天的单词还背吗');
      const c5 = await at(t, '04:30', '今天只有四十分钟'); // 换个说法：同一句 60 秒内会被当重复
      const c4 = await at(addDays(t, 1), '00:30', '今天只有半小时');
      const r = (c: any) => String(c.done?.reply ?? '');
      const raw = (await db.query(`SELECT early_note_day::text d FROM users WHERE id=$1`, [s.userId])).rows[0]?.d;
      // 另一个账号：凌晨先跑夜间复盘（复盘文案里说），同一学习日的命令就不再说
      const s2 = await new Session(s.tz).init();
      await s2.send('PATCH', '/me/settings', { quiet_hours: { start: '05:00', end: '05:01' } });
      s2.debugNow = localIso(s2, t, '00:20');
      const j = await s2.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      const m = (await s2.get('/agent/messages')).items.find((x: any) => x.kind === 'review');
      s2.debugNow = localIso(s2, t, '00:30');
      const c6 = await s2.command('今天只有一小时');
      s.debugNow = null; s2.debugNow = null;
      const note = (x: string) => `凌晨 4 点前还算 ${x.slice(5)} 这一天`;
      return [
        pass('第 1 句回复带这句（MM-DD = 学习日）', 'expect', r(c1).split(note(d)).length === 2, r(c1)),
        pass('第 2、3 句不带', 'expect', !/凌晨 4 点前还算/.test(r(c2) + r(c3) + [...c2.steps, ...c3.steps].join('')) && !!r(c2) && !!r(c3), `${r(c2)} | ${r(c3)}`),
        pass('04:30 不带', 'expect', !/凌晨 4 点前还算/.test(r(c5)) && c5.done?.date === t, `${c5.done?.date} ${r(c5)}`),
        pass('下一个学习日凌晨第一句再带一次', 'expect', r(c4).split(note(t)).length === 2 && c4.done?.date === t, r(c4)),
        pass('记下说过的学习日（users.early_note_day）', 'expect', raw === t, raw),
        pass('复盘先说了 → 同一学习日的命令不再说', 'expect', j.status === 200 && `${m?.headline ?? ''}${m?.details ?? ''}`.includes(note(d)) && !/凌晨 4 点前还算/.test(String(c6.done?.reply ?? '')), `${j.status} ${m?.details} | ${c6.done?.reply}`),
        pass('同一学习日说两次', 'must_not', [c1, c2, c3].map(r).join('').split('凌晨 4 点前还算').length === 2),
      ];
    },
  },
  {
    id: 'r14-week-countdown-tense', scenario: '第 14 轮：旧周报 8 天后再读，「本周（range）」→「那周（range）」，「距考试 N 天」→「当时距考试 N 天」；当天读不变',
    input: 'weekly（force）→ 当天读 → X-Debug-Now +8 天再读', source: 'builtin',
    expect: ['库里是 {{week}} / {{countdown}} 占位符', '当天读：本周（MM-DD 起）、距考试 N 天', '8 天后读：那周（range）、当时距考试 N 天'], must_not: ['8 天后还写本周 / 距考试（没加当时）'],
    run: async (s) => {
      const d = await today(s);
      await s.send('PATCH', '/me/settings', { exam_date: addDays(d, 47) });
      await s.send('POST', '/agent/jobs/run', { job: 'weekly', force: true });
      const raw = (await db.query(`SELECT id, details FROM daily_tips WHERE user_id=$1 AND kind='weekly' ORDER BY created_at DESC LIMIT 1`, [s.userId])).rows[0];
      const pick = async () => (await s.get('/agent/messages')).items.find((x: any) => x.id === raw?.id)?.details ?? '';
      const t0 = await pick();
      s.debugNow = localIso(s, addDays(d, 8), '12:00');
      const t8 = await pick();
      s.debugNow = null;
      const bad8 = badDayLabels(t8, addDays(d, 8), d);
      return [
        pass('库里是 {{week}} / {{countdown}} 占位符', 'expect', /\{\{week:\d{4}-\d{2}-\d{2}\|本周\}\}/.test(raw?.details ?? '') && /\{\{countdown:\d+\|asof=/.test(raw?.details ?? ''), raw?.details),
        pass('当天读：本周（MM-DD 起）、距考试 N 天', 'expect', /^本周（\d{2}-\d{2} 起）/.test(t0) && /(?<!当时)距考试 \d+ 天/.test(t0) && !badDayLabels(t0, d, d).length, t0),
        pass('8 天后读：那周（range）、当时距考试 N 天', 'expect', /^那周（\d{2}-\d{2}–\d{2}-\d{2}）/.test(t8) && /当时距考试 \d+ 天/.test(t8), t8),
        pass('8 天后还写本周 / 距考试（没加当时）', 'must_not', bad8.length === 0, bad8.join(',')),
      ];
    },
  },
  {
    id: 'r14-exam-wall-clock', scenario: '第 14 轮：模考按墙上时钟；不发心跳 30 分钟后剩 150 分钟；181 分钟后读 → 自动交卷（auto_submitted），心跳 409 exam_auto_submitted',
    input: '开考（180 分钟）→ +30 分钟读 → +181 分钟读 → 心跳', source: 'builtin',
    expect: ['30 分钟后剩 150 分钟', '到点自动交卷', '之后心跳 409 exam_auto_submitted'], must_not: [],
    run: async (s) => {
      const d = await today(s);
      const t0 = new Date(Date.parse(localIso(s, addDays(d, 2), '09:00')));
      const at = (m: number) => new Date(t0.getTime() + m * 60000).toISOString();
      s.debugNow = at(0);
      const e = await s.send('POST', '/exams', { question_ids: ['math1-2024-17'], duration_minutes: 180, include_unreviewed: true, kind: 'paper' });
      const id = e.body?.id;
      s.debugNow = at(30); const v30 = await s.get(`/exams/${id}`);
      s.debugNow = at(181); const v181 = await s.get(`/exams/${id}`);
      const hb = await s.send('PUT', `/exams/${id}/progress`, { idempotency_key: 'late', client_seq: 1 });
      s.debugNow = null;
      return [
        pass('30 分钟后剩 150 分钟', 'expect', v30?.remaining_seconds === 9000, JSON.stringify({ r: v30?.remaining_seconds })),
        pass('到点自动交卷', 'expect', v181?.status === 'submitted' && v181?.auto_submitted === true && v181?.result?.auto_submitted === true, `${v181?.status} ${v181?.auto_submitted}`),
        pass('之后心跳 409 exam_auto_submitted', 'expect', hb.status === 409 && hb.body?.code === 'exam_auto_submitted' && hb.body?.exam_id === id, `${hb.status} ${JSON.stringify(hb.body)}`),
      ];
    },
  },
  {
    id: 'r11-date-render', scenario: '第 11 轮 M1：存库是 {{date:YYYY-MM-DD}}，读时按读者当时的学习日渲染：建议第二天再读 明天→今天；8 天前的记录显示「MM-DD（周X）」',
    input: 'nightly（先问我）→ 读 → X-Debug-Now +1 天再读 → 确认 → +8 天读改动记录', source: 'builtin',
    expect: ['库里是占位符', '当天读：明天（MM-DD）', '第二天读：今天（MM-DD），不再说明天', '确认后标题按读的那天说', '8 天后改动记录：MM-DD（周X）'], must_not: ['存库的是「明天」这种会过期的叫法'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      const wd = (x: string) => `周${'日一二三四五六'[new Date(`${x}T12:00:00Z`).getUTCDay()]}`;
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      const n = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      const id = n.body?.proposal?.message_id;
      const raw = (await db.query(`SELECT text, proposal FROM daily_tips WHERE id=$1`, [id])).rows[0];
      const h0 = (await s.get('/agent/messages')).items.find((x: any) => x.id === id)?.headline ?? '';
      s.debugNow = localIso(s, t, '12:00');
      const h1 = (await s.get('/agent/messages')).items.find((x: any) => x.id === id)?.headline ?? '';
      const c = await s.send('POST', `/agent/messages/${id}/confirm`, {});
      const h2 = (await s.get('/agent/messages')).items.find((x: any) => x.id === id)?.headline ?? '';
      s.debugNow = localIso(s, addDays(d, 8), '12:00');
      const acts = (await s.get('/agent/actions?flat=true')).items as any[];
      const h8 = (await s.get('/agent/messages')).items.find((x: any) => x.id === id)?.headline ?? '';
      s.debugNow = null;
      const tip = acts.find((a: any) => a.tool === 'writeDailyTip');
      const plan = acts.find((a: any) => a.tool === 'updateDailyPlan' && /加了/.test(a.summary));
      return [
        pass('库里是占位符', 'expect', JSON.stringify(raw?.proposal ?? '').includes(`{{date:${t}}}`), JSON.stringify(raw?.proposal?.items?.map((x: any) => x.summary))),
        pass('当天读：明天（MM-DD）', 'expect', h0.includes(`明天（${t.slice(5)}）`), h0),
        pass('第二天读：今天（MM-DD），不再说明天', 'expect', h1.includes(`今天（${t.slice(5)}）`) && !h1.includes('明天（'), h1),
        pass('确认后标题按读的那天说', 'expect', c.status === 200 && /^已在今天（\d{2}-\d{2}）的计划里加了「/.test(h2) && h2.includes(t.slice(5)), `${c.status} ${h2}`),
        pass('8 天后改动记录：MM-DD（周X）', 'expect', !!tip && tip.summary.includes(`${d.slice(5)}（${wd(d)}）`) && !!plan && plan.summary.includes(`${t.slice(5)}（${wd(t)}）`) && h8.includes(`${t.slice(5)}（${wd(t)}）`), `${tip?.summary} | ${plan?.summary} | ${h8}`),
        pass('存库的是「明天」这种会过期的叫法', 'must_not', !/明天（|今天（/.test(JSON.stringify(raw?.proposal ?? '') + (raw?.text ?? '')), raw?.text),
      ];
    },
  },
  {
    id: 'r11-quotes', scenario: '第 11 轮 M2：渲染层统一引号层级——外层「」、里层『』、更深的去掉引号', input: '库里写「已在 {{date:明天}} 的计划里加了「练 3 道「变限积分」」」→ GET /agent/messages', source: 'builtin',
    expect: ['「已在明天（MM-DD）的计划里加了『练 3 道变限积分』」'], must_not: ['「」套「」'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      const txt = `「已在 {{date:${t}}} 的计划里加了「练 3 道「变限积分」」」`;
      await db.query(`INSERT INTO daily_tips(user_id,tip_date,kind,text,headline,source,delivered_at) VALUES($1,$2,'review',$3,$3,'eval',now())`, [s.userId, d, txt]);
      const m = (await s.get('/agent/messages')).items.find((x: any) => x.kind === 'review');
      const want = `「已在明天（${t.slice(5)}）的计划里加了『练 3 道变限积分』」`;
      return [
        pass(want, 'expect', m?.headline === want, m?.headline),
        pass('「」套「」', 'must_not', !/「[^」]*「/.test(m?.headline ?? '')),
      ];
    },
  },
  {
    id: 'r12-questions', scenario: '第 12 轮：问题（不是命令）用真实数据直接回答，什么都不改：单词背不背 / 今天还要做什么 / 错题还剩几道 / 离考试还有几天 / 这周进度',
    input: '「那今天的单词还背吗」「今天还要做什么」「错题还剩几道」「离考试还有几天」「我这周进度怎么样」', source: 'builtin',
    expect: ['单词：剩余数和 /words/today 一致，说背不背', '今天还要做什么：列出计划里没做的任务和总分钟', '错题还剩几道：和错题本 active 数一致', '离考试还有几天：按学习日算的天数', '这周进度：题数和正确率是真实的', '同一个问题连问两次都回答（不去重）'],
    must_not: ['问题改了计划 / 写了改动记录', '回答成「计划里已经有…」'],
    run: async (s) => {
      const d = await today(s);
      await s.wrong('math1-2024-01'); await s.wrong('math1-2024-02');
      await s.send('POST', '/plans', { plan_date: d, tasks: [{ kind: 'practice', title: '练 5 道极限', estimated_minutes: 25 }, { kind: 'redo_wrong', title: '重做 2 道错题', payload: { question_ids: ['math1-2024-01', 'math1-2024-02'] }, estimated_minutes: 16 }] });
      const exam = addDays(d, 47);
      await s.send('PATCH', '/me/settings', { exam_date: exam });
      const acts0 = (await db.query(`SELECT count(*)::int n FROM agent_actions WHERE user_id=$1`, [s.userId])).rows[0].n;
      const plan0 = JSON.stringify((await planTasks(s, d)).map((t: any) => [t.id, t.status, t.estimated_minutes, t.payload]));
      const w = await s.get('/words/today');
      const qa = async (t: string) => s.command(t);
      const q1 = await qa('那今天的单词还背吗'), q2 = await qa('今天还要做什么'), q3 = await qa('错题还剩几道'), q4 = await qa('离考试还有几天'), q5 = await qa('我这周进度怎么样'), q6 = await qa('错题还剩几道');
      const r = (c: any) => String(c.done?.reply ?? '');
      const active = (await s.get('/wrong-questions?status=active')).items.length;
      const ans = (await db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE is_correct)::int c FROM answer_records WHERE user_id=$1`, [s.userId])).rows[0];
      const acts1 = (await db.query(`SELECT count(*)::int n FROM agent_actions WHERE user_id=$1`, [s.userId])).rows[0].n;
      const plan1 = JSON.stringify((await planTasks(s, d)).map((t: any) => [t.id, t.status, t.estimated_minutes, t.payload]));
      const all = [q1, q2, q3, q4, q5, q6];
      const n = w.counts.review + w.counts.new, mm = d.slice(5);
      return [
        pass('单词：剩余数和 /words/today 一致，说背不背', 'expect', q1.done?.question_kind === 'words' && r(q1).includes(`今天（${mm}）单词还剩 ${n} 个`) && /^要背|^可以背|先不背/.test(r(q1)), r(q1)),
        pass('今天还要做什么：列出计划里没做的任务和总分钟', 'expect', q2.done?.question_kind === 'todo' && r(q2).includes('还要做 2 项，共约 41 分钟') && r(q2).includes('练 5 道极限（25 分钟）'), r(q2)),
        pass('错题还剩几道：和错题本 active 数一致', 'expect', q3.done?.question_kind === 'wrong_left' && r(q3).startsWith(`错题还剩 ${active} 道`) && r(q3).includes('已经排了 2 道重做'), r(q3)),
        pass('离考试还有几天：按学习日算的天数', 'expect', q4.done?.question_kind === 'exam_days' && r(q4).includes(`还有 47 天`) && r(q4).includes(exam), r(q4)),
        pass('这周进度：题数和正确率是真实的', 'expect', q5.done?.question_kind === 'week' && r(q5).includes(`这周（${weekOpenLabel(weekOf(d).from)}）`) && r(q5).includes(`做了 ${ans.n} 题，正确率 ${Math.round((100 * ans.c) / ans.n)}%`) && !/这周（\d{2}-\d{2}）/.test(r(q5)), r(q5)),
        pass('同一个问题连问两次都回答（不去重）', 'expect', q6.done?.deduped === false && r(q6) === r(q3), r(q6)),
        pass('问题改了计划 / 写了改动记录', 'must_not', acts1 === acts0 && plan1 === plan0 && all.every((c) => c.done?.action_count === 0 && !(c.actions ?? []).length), `${acts0}→${acts1}`),
        pass('回答成「计划里已经有…」', 'must_not', all.every((c) => !/计划里已经有/.test(r(c)) && !badDayLabels(r(c), d).length)),
      ];
    },
  },
  {
    id: 'r12-question-budget', scenario: '第 12 轮：多轮对话——先说「今天只有半小时」，再问单词 / 今天还要做什么，回答按 30 分钟预算给建议；下一个学习日不再沿用',
    input: '今天只有半小时 → 那今天的单词还背吗 → 今天还要做什么 → （04:30 次日）那今天的单词还背吗', source: 'builtin',
    expect: ['单词回答提到 30 分钟预算并给结论', '待办回答提到 30 分钟', '换了学习日不沿用昨天的预算'], must_not: ['问题改了计划'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      await s.wrong('math1-2024-03');
      await s.send('POST', '/plans', { plan_date: d, tasks: [{ kind: 'practice', title: '练 5 道极限', estimated_minutes: 25 }, { kind: 'practice', title: '练 3 道级数', estimated_minutes: 20 }] });
      const c1 = await s.command('今天只有半小时');
      const a0 = (await db.query(`SELECT count(*)::int n FROM agent_actions WHERE user_id=$1`, [s.userId])).rows[0].n;
      const q1 = await s.command('那今天的单词还背吗'), q2 = await s.command('今天还要做什么');
      const a1 = (await db.query(`SELECT count(*)::int n FROM agent_actions WHERE user_id=$1`, [s.userId])).rows[0].n;
      s.debugNow = localIso(s, t, '04:30');
      const q3 = await s.command('那今天的单词还背吗');
      s.debugNow = null;
      const r = (c: any) => String(c.done?.reply ?? '');
      return [
        pass('单词回答提到 30 分钟预算并给结论', 'expect', !!c1.done && /只有 30 分钟/.test(r(q1)) && /都背|只背|先不背|挪到明天|减到|可以背/.test(r(q1)) && r(q1).includes(`今天（${d.slice(5)}）`), r(q1)),
        pass('待办回答提到 30 分钟', 'expect', /只有 30 分钟/.test(r(q2)), r(q2)),
        pass('换了学习日不沿用昨天的预算', 'expect', q3.done?.date === t && !/只有 30 分钟/.test(r(q3)) && r(q3).includes(`今天（${t.slice(5)}）`), r(q3)),
        pass('问题改了计划', 'must_not', a1 === a0),
      ];
    },
  },
  {
    id: 'r12-dedupe-studyday', scenario: '第 12 轮 P4：同一句话只在同一学习日、按有效的「现在」（X-Debug-Now）60 秒内才算重复；换了学习日一律重新执行',
    input: '00:30 今天只有一小时 → 00:30:20 同一句 → 04:30 同一句（新学习日）→ 次日 00:30 同一句', source: 'builtin',
    expect: ['00:30:20 同一句 = 重复', '04:30（新学习日）重新执行，按新学习日', '同一学习日隔 1 小时（有效时间）不算重复'], must_not: ['跨学习日说「刚刚说过同样的话」'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      await s.wrong('math1-2024-04');
      const at = async (day: string, hhmm: string, text = '今天只有一小时') => { s.debugNow = localIso(s, day, hhmm); return s.command(text); };
      const c1 = await at(t, '00:30');
      s.debugNow = new Date(Date.parse(localIso(s, t, '00:30')) + 20000).toISOString();
      const c2 = await s.command('今天只有一小时');
      const c3 = await at(t, '04:30');
      const c4 = await at(t, '05:31');
      s.debugNow = null;
      const r = (c: any) => String(c.done?.reply ?? c.steps?.join('') ?? '');
      return [
        pass('00:30:20 同一句 = 重复', 'expect', c2.done?.deduped === true, `${s.debugNow} ${r(c2)}`),
        pass('04:30（新学习日）重新执行，按新学习日', 'expect', c1.done?.date === d && c3.done?.deduped === false && c3.done?.date === t && !/刚刚说过/.test(r(c3)), `${c1.done?.date} ${c3.done?.date} ${r(c3)}`),
        pass('同一学习日隔 1 小时（有效时间）不算重复', 'expect', c4.done?.date === t && !/刚刚说过/.test(r(c4)), r(c4)),
        pass('跨学习日说「刚刚说过同样的话」', 'must_not', !/刚刚说过/.test(r(c3))),
      ];
    },
  },
  {
    id: 'r12-render-tense', scenario: '第 12 轮 P1 / P3：渲染后日期两边没有空格；往后看的说法过了那天读成「MM-DD（周X）当天计划…」；P2：改动记录 before/after 存占位符、读时渲染',
    input: 'nightly（先问我）→ 确认 → +8 天读复盘 / 改动记录', source: 'builtin',
    expect: ['当天读：明天（MM-DD）先…', '8 天后读：MM-DD（周X）当天计划…', '日期后面没有空格', 'before/after 库里是占位符、读出来是渲染好的'], must_not: ['漏出占位符'],
    run: async (s) => {
      const d = await today(s), t = addDays(d, 1);
      const wd = (x: string) => `周${'日一二三四五六'[new Date(`${x}T12:00:00Z`).getUTCDay()]}`;
      await s.wrong('math1-2024-05');
      await s.send('PATCH', '/me/settings', { coach_frequency: 'ask', quiet_hours: { start: '00:00', end: '23:59' } });
      const n = await s.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      const id = n.body?.proposal?.message_id;
      await s.send('POST', `/agent/messages/${id}/confirm`, {});
      // 直接发的复盘（不先问）：headline「明天（MM-DD）先…」
      const s2 = await new Session(s.tz).init();
      await s2.wrong('math1-2024-05');
      await s2.send('PATCH', '/me/settings', { quiet_hours: { start: '05:00', end: '05:01' } });
      await s2.send('POST', '/agent/jobs/run', { job: 'nightly', force: true });
      const h0 = (await s2.get('/agent/messages')).items.find((x: any) => x.kind === 'review')?.headline ?? '';
      s2.debugNow = localIso(s2, addDays(d, 8), '12:00');
      const h8 = (await s2.get('/agent/messages')).items.find((x: any) => x.kind === 'review')?.headline ?? '';
      await db.query(`INSERT INTO daily_tips(user_id,tip_date,kind,text,headline,source,delivered_at) VALUES($1,$2,'review',$3,$3,'eval',now())`, [s.userId, addDays(d, -1), `想在 {{date:${t}}} 的计划里加「练 3 道」`]);
      const raw = (await db.query(`SELECT before::text b, after::text a FROM agent_actions WHERE user_id=$1`, [s.userId])).rows.map((x: any) => `${x.b} ${x.a}`).join(' ');
      s.debugNow = localIso(s, addDays(d, 8), '12:00');
      const msgs = (await s.get('/agent/messages')).items as any[];
      const acts = (await s.get('/agent/actions?flat=true')).items as any[];
      s.debugNow = null;
      const ins = msgs.find((x: any) => x.source === 'eval' || /练 3 道/.test(x.headline ?? ''))?.headline ?? '';
      const text = JSON.stringify(msgs) + JSON.stringify(acts);
      const bare = raw.match(/(?<![\d{:\-]|还算 )(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?![\d\-])/g) ?? [];
      return [
        pass('当天读：明天（MM-DD）先…', 'expect', h0.startsWith(`明天（${t.slice(5)}）先`), h0),
        pass('8 天后读：MM-DD（周X）当天计划…', 'expect', h8.startsWith(`${t.slice(5)}（${wd(t)}）当天计划`) && !/当天计划先/.test(h8), h8),
        pass('日期后面没有空格', 'expect', ins.includes(`想在${t.slice(5)}（${wd(t)}）的计划`) && !/）[ \u3000]+[\u4e00-\u9fff]/.test(text), ins),
        pass('before/after 库里是占位符、读出来是渲染好的', 'expect', raw.includes('{{date:') && !bare.length && acts.some((a: any) => JSON.stringify([a.before, a.after]).includes(`${t.slice(5)}（${wd(t)}）`)), bare.join(',') || raw.slice(0, 200)),
        pass('漏出占位符', 'must_not', !text.includes('{{date:')),
      ];
    },
  },
  {
    id: 'r12-self-grade', scenario: '第 12 轮 A / B：英语翻译 / 作文自评——没作答一律 0 分（unanswered）；字数低于线但评了基本到位 / 大概一半照记并标 word_count_low',
    input: '模考 46（翻译）空着、51（小作文）写 12 词、52（大作文）写 90 词 → 交卷时都评 full → 再自评 46=full', source: 'builtin',
    expect: ['没作答：0 分、unanswered=true、self_rating=no_idea', '小作文 12 词评 full：照记满分、self_grade_flags=["word_count_low"]、word_count=12', '大作文 90 词：没有标记', '交卷后再评没作答的题仍是 0 分', '错题本带 self_grade_flags'], must_not: ['没作答的题得分'],
    run: async (s) => {
      const ids = ['english1-2024-46', 'english1-2024-51', 'english1-2024-52'];
      const e = await s.send('POST', '/exams', { question_ids: ids, title: 'eval 英语自评' });
      const eid = e.body?.id;
      const words = (k: number) => Array.from({ length: k }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ');
      await s.send('PUT', `/exams/${eid}/progress`, { idempotency_key: `eval-${eid}`, client_seq: 1, answers: [{ question_id: ids[0], answer: ['   '] }, { question_id: ids[1], answer: [words(12)] }, { question_id: ids[2], answer: [words(90)] }] });
      const sub = await s.send('POST', `/exams/${eid}/submit`, { idempotency_key: `eval-sub-${eid}`, self_ratings: { [ids[0]]: 'full', [ids[1]]: 'full', [ids[2]]: 'full' } });
      const per = (sub.body?.result?.per_question ?? []) as any[];
      const p = (id: string) => per.find((x) => x.question_id === id) ?? {};
      const re = await s.send('POST', `/exams/${eid}/self-ratings`, { idempotency_key: `eval-re-${eid}`, self_ratings: { [ids[0]]: 'approach_ok_calc_wrong', [ids[1]]: 'approach_ok_calc_wrong' } });
      const per2 = (re.body?.result?.per_question ?? []) as any[];
      const p2 = (id: string) => per2.find((x) => x.question_id === id) ?? {};
      const wq = ((await s.get(`/wrong-questions?exam_id=${eid}`)).items ?? []) as any[];
      const w51 = wq.find((x: any) => x.question_id === ids[1]);
      return [
        pass('没作答：0 分、unanswered=true、self_rating=no_idea', 'expect', sub.status === 200 && p(ids[0]).got === 0 && p(ids[0]).unanswered === true && p(ids[0]).self_rating === 'no_idea' && p(ids[0]).submitted_self_rating === 'full', JSON.stringify(p(ids[0])).slice(0, 300)),
        pass('小作文 12 词评 full：照记满分、self_grade_flags=["word_count_low"]、word_count=12', 'expect', p(ids[1]).got === p(ids[1]).score && JSON.stringify(p(ids[1]).self_grade_flags) === '["word_count_low"]' && p(ids[1]).word_count === 12 && p(ids[1]).min_words === 50, JSON.stringify({ got: p(ids[1]).got, f: p(ids[1]).self_grade_flags, w: p(ids[1]).word_count })),
        pass('大作文 90 词：没有标记', 'expect', JSON.stringify(p(ids[2]).self_grade_flags) === '[]' && p(ids[2]).word_count === 90 && p(ids[2]).min_words === 80),
        pass('交卷后再评没作答的题仍是 0 分', 'expect', re.status === 200 && p2(ids[0]).got === 0 && p2(ids[0]).unanswered === true && JSON.stringify(p2(ids[1]).self_grade_flags) === '["word_count_low"]', `${re.status} ${JSON.stringify(p2(ids[0])).slice(0, 200)}`),
        pass('错题本带 self_grade_flags', 'expect', !!w51 && JSON.stringify(w51.self_grade_flags) === '["word_count_low"]' && w51.word_count === 12, JSON.stringify(w51 && { f: w51.self_grade_flags, w: w51.word_count })),
        pass('没作答的题得分', 'must_not', p(ids[0]).got === 0 && p2(ids[0]).got === 0),
      ];
    },
  },
];

// ───────────── 专家用例：setup 落库 + 断言映射 ─────────────
function taskKind(name: string) { return /错题/.test(name) ? 'redo_wrong' : /词/.test(name) ? 'words' : 'practice'; }
/** plan_today 里的 {task, count}：错题任务按 count 挑真实错题（错题本先备够） */
async function seedPlan(s: Session, d: string, list: any[], countOverride?: number) {
  const pool = ['math1-2024-01', 'math1-2024-02', 'math1-2024-03', 'math1-2024-04', 'math1-2024-05', 'math1-2024-06', 'math1-2024-07', 'math1-2024-08', 'math1-2024-09', 'math1-2024-10', 'math1-2024-11', 'math1-2024-12'];
  const tasks = list.map((t: any) => {
    const kind = taskKind(t.task);
    const n = countOverride ?? t.count;
    if (kind === 'redo_wrong' && n) return { kind, title: `重做 ${n} 道错题`, payload: { question_ids: pool.slice(0, n) }, estimated_minutes: n * 8 };
    return { kind, title: n ? `${t.task} ${n} 道` : t.task, payload: n ? { count: n } : {}, estimated_minutes: t.min };
  });
  await s.send('POST', '/plans', { plan_date: d, tasks });
}
const redoQty = async (s: Session, d: string) => { const t = (await planTasks(s, d)).filter((x) => x.kind === 'redo_wrong' && x.status !== 'skipped'); return t.length ? (t[0].payload?.question_ids?.length ?? 0) : 0; };

/** now_local → X-Debug-Now：带偏移 / Z 的原样用；「2026-11-02T00:30」这种按账号时区换算 */
function debugNowFor(s: Session, nowLocal: string) {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(nowLocal)) return nowLocal;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(nowLocal);
  return m ? localIso(s, m[1], m[2]) : nowLocal;
}
async function applySetup(s: Session, setup: any, firstTurn?: Turn) {
  const nl = firstTurn?.now_local ?? setup?.now_local;
  if (nl) s.debugNow = debugNowFor(s, nl);
  const d = await today(s);
  const notes: string[] = [];
  // 错题任务要真实的错题：按 plan_today 里最大的 count 多备 4 道
  const maxCount = Math.max(0, ...(setup?.plan_today ?? []).map((t: any) => Number(t.count) || 0));
  if (maxCount) for (const q of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].slice(0, Math.min(12, maxCount + 4))) await s.wrong(`math1-2024-${q}`);
  if (setup?.plan_today && setup?.last_command?.text) {
    // 「上一句」：先按 result「3→5」的起点排计划，真的发一次上一句，再核对计划是不是 setup 写的样子
    const m = /(\d+)\s*→\s*(\d+)/.exec(setup.last_command.result ?? '');
    if (m) await seedPlan(s, d, setup.plan_today, Number(m[1]));
    await s.command(setup.last_command.text);
    const want = Number(setup.plan_today.find((t: any) => t.count)?.count ?? 0);
    if (want && (await redoQty(s, d)) !== want) { await seedPlan(s, d, setup.plan_today); notes.push('上一句执行后的计划和 setup 不一致，按 setup 重排'); }
  } else if (setup?.plan_today) await seedPlan(s, d, setup.plan_today);
  if (setup?.plan_tomorrow) await s.send('POST', '/plans', { plan_date: addDays(d, 1), tasks: setup.plan_tomorrow.map((t: any) => ({ kind: taskKind(t.task), title: t.task, estimated_minutes: t.min })) });
  const qs = [setup?.last_wrong?.q, ...(setup?.wrong_book ?? []).map((x: any) => x.q), ...(setup?.recent_attempts ?? []).filter((x: any) => !x.ok).map((x: any) => x.q)].filter(Boolean);
  for (const q of qs) if (!(await s.wrong(q))) notes.push(`题 ${q} 不在题库，没落库`);
  if (setup?.wrong_book_count && !qs.length) for (const q of ['math1-2024-01', 'math1-2024-02', 'math1-2024-03']) await s.wrong(q);
  // 没打开的主动消息：最近 N 条按「昨天、前天…」落库（setup 里的日期是专家写用例时的，按真实今天平移）
  const nudges = (setup?.unread_nudges ?? []) as any[];
  for (let k = 1; k <= nudges.length; k++)
    await db.query(`INSERT INTO daily_tips(user_id,tip_date,kind,text,headline,source,delivered_at) VALUES($1,$2,'review','明天先做错题。','明天先做错题。','eval',now()) ON CONFLICT DO NOTHING`, [s.userId, addDays(d, -k)]);
  if (setup?.last_command?.text && !setup?.plan_today) await s.command(setup.last_command.text);
  if (setup?.today && setup.today !== d) notes.push(`setup.today=${setup.today} 按真实今天 ${d} 跑`);
  if (setup?.now_local) notes.push(`X-Debug-Now=${setup.now_local}，账号时区 ${s.tz} 的今天 = ${d}`);
  return notes;
}

interface Ctx { s: Session; run: any; job: any; d: string; before: any; after: any; setup?: any; turns?: any[]; hour?: number; words?: any }
const runSteps = (c: Ctx) => (c.run?.steps ?? []).join(' | ');
type Mapper = { re: RegExp; kind: 'expect' | 'must_not'; check: (c: Ctx, a: string) => boolean | null };
const plansActs = (c: Ctx) => (c.run?.actions ?? c.job?.actions ?? []).filter((a: any) => a.tool === 'updateDailyPlan');
const NOTE_RE = /凌晨 4 点前还算/;
const replyOf = (r: any) => String(r?.done?.reply ?? '');
const textOf = (r: any) => [replyOf(r), ...(r?.steps ?? []), ...(r?.actions ?? []).map((a: any) => `${a.summary} ${a.reason ?? ''}`)].join(' | ');
const allRuns = (c: Ctx) => c.turns ?? (c.run ? [c.run] : []);
/** 计划改动只碰 mmdd 那天（挪 / 顺延出去的除外） */
const onlyDay = (c: Ctx, runs: any[], mmdd: string) => runs.every((r) => (r.done?.date == null || r.done.date.slice(5) === mmdd)
  && (r.actions ?? []).filter((a: any) => a.tool === 'updateDailyPlan').every((a: any) => a.summary.includes(mmdd) || /挪|顺延/.test(`${a.summary}${a.reason ?? ''}`)));
/** 问题的回答（round12）：正面回答背不背 / 背多少，数量和 GET /words/today 一致，不改任何东西 */
const WORDS_ANSWER_RE = /要背|都背|只背|背完|可以背|先不背|挪到明天|减到 ?\d+ ?个/;
const wordsAnswerOk = (r: any, mmdd: string, words: any) => {
  const t = replyOf(r); const n = words?.counts ? words.counts.review + words.counts.new : null;
  return !r?.error && (r.actions ?? []).length === 0 && r.done?.action_count === 0 && t.includes(`今天（${mmdd}）`) && WORDS_ANSWER_RE.test(t)
    && (n == null || new RegExp(`单词还剩 ${n} 个|单词已经背完`).test(t)) && (n == null || !n || t.includes(`复习 ${words.counts.review} 个、新词 ${words.counts.new} 个`));
};
const MAPPERS: Mapper[] = [
  // 问题意图（coach-38 第 2 轮）
  { kind: 'expect', re: /^第 ?2 ?次回复正面回答「背不背、背多少」：给出今天（(\d{2}-\d{2})）单词的剩余数量，并按(一小时|\d+ ?分钟)的总预算说明背还是挪到明天/, check: (c, a) => {
    const mmdd = /今天（(\d{2}-\d{2})）/.exec(a)![1]; const r = allRuns(c)[1];
    return !!r && wordsAnswerOk(r, mmdd, c.words) && /只有 ?60 ?分钟/.test(replyOf(r)) && /背完|只背|挪到明天|减到/.test(replyOf(r)); } },
  { kind: 'must_not', re: /^第 ?2 ?次回复只说「计划里已经有…」而不回答背不背/, check: (c) => {
    const r = allRuns(c)[1]; const t = replyOf(r);
    return !!r && !/^[^。]{0,30}计划里已经有/.test(t) && WORDS_ANSWER_RE.test(t) && r.done?.deduped !== true; } },
  // 凌晨换日（coach-33 / 37 / 38）
  { kind: 'expect', re: /^第 ?1 ?次回复：改 ?(\d{2}-\d{2}) ?的计划，并说一次「凌晨 4 点前还算 ?(\d{2}-\d{2}) ?这一天」/, check: (c, a) => {
    const m = /改 ?(\d{2}-\d{2}) ?的计划.*还算 ?(\d{2}-\d{2})/.exec(a)!; const r = allRuns(c)[0];
    return !!r && r.done?.date?.slice(5) === m[1] && plansActs({ ...c, run: r, job: null }).length > 0 && replyOf(r).split(`凌晨 4 点前还算 ${m[2]} 这一天`).length === 2; } },
  { kind: 'expect', re: /^第 ?2、3 ?次回复：仍按今天（(\d{2}-\d{2})）处理，但不再出现这句说明/, check: (c, a) => {
    const mmdd = /今天（(\d{2}-\d{2})）/.exec(a)![1]; const rs = allRuns(c).slice(1);
    return rs.length >= 2 && rs.every((r) => !r.error && !NOTE_RE.test(textOf(r))) && onlyDay(c, rs, mmdd) && rs.every((r) => r.done?.date == null || r.done.date.slice(5) === mmdd); } },
  { kind: 'expect', re: /^\d+ ?次回复里的日期都写成「今天（(\d{2}-\d{2})）」/, check: (c, a) => {
    const mmdd = /今天（(\d{2}-\d{2})）/.exec(a)![1];
    // 每次回复都带「今天（MM-DD）」；出现的其他相对叫法也得和学习日对得上（不把日历日 11-02 叫今天）
    return allRuns(c).every((r) => replyOf(r).includes(`今天（${mmdd}）`) && !new RegExp(`今天（(?!${mmdd})\\d{2}-\\d{2}）`).test(textOf(r))); } },
  { kind: 'must_not', re: /^第 ?2 ?或第 ?3 ?次回复里再次出现「凌晨 4 点前还算」/, check: (c) => allRuns(c).slice(1).every((r) => !NOTE_RE.test(textOf(r))) },
  { kind: 'must_not', re: /^任何一次按 ?(\d{2}-\d{2}) ?处理/, check: (c, a) => {
    const bad = /(\d{2}-\d{2})/.exec(a)![1];
    return allRuns(c).every((r) => r.done?.date?.slice(5) !== bad && !textOf(r).includes(`今天（${bad}）`) && (r.actions ?? []).filter((x: any) => x.tool === 'updateDailyPlan').every((x: any) => !x.summary.includes(bad) || /挪|顺延/.test(`${x.summary}${x.reason ?? ''}`))); } },
  { kind: 'expect', re: /改的是 ?(\d{2}-\d{2}) ?的计划，压到 ?1 ?小时内并说明删掉了什么/, check: (c, a) => {
    const mmdd = /改的是 ?(\d{2}-\d{2})/.exec(a)![1];
    // 4:00 以后不该再说「凌晨 4 点前还算」
    return c.run?.done?.date?.slice(5) === mmdd && c.d.slice(5) === mmdd && c.after.todayMinutes <= 60 && onlyDay(c, [c.run], mmdd)
      && /只有 ?\d+ ?分钟/.test(runSteps(c)) && (c.hour == null || c.hour < 4 || !NOTE_RE.test(replyOf(c.run))); } },
  { kind: 'expect', re: /回复里用一句话说明「凌晨 4 点前还算 ?(\d{2}-\d{2}) ?这一天」，日期写成「今天（(\d{2}-\d{2})）」/, check: (c, a) => {
    const m = /还算 ?(\d{2}-\d{2}) ?这一天」，日期写成「今天（(\d{2}-\d{2})）」/.exec(a)!; const r = replyOf(c.run);
    return r.split(`凌晨 4 点前还算 ${m[1]} 这一天`).length === 2 && r.includes(`今天（${m[2]}）`); } },
  { kind: 'must_not', re: /^改到 ?\d{2}-\d{2}(（[^）]*）)?( ?或 ?\d{2}-\d{2}(（[^）]*）)?)*$/, check: (c, a) => {
    const bad = a.replace(/（[^）]*）/g, '').match(/\d{2}-\d{2}/g)!;
    return !bad.includes(c.run?.done?.date?.slice(5)) && plansActs(c).every((x: any) => !bad.some((b) => x.summary.includes(b)) || /挪|顺延/.test(`${x.summary}${x.reason ?? ''}`)); } },
  { kind: 'must_not', re: /把「今天」写成日历日 ?(\d{2}-\d{2})/, check: (c, a) => { const bad = /(\d{2}-\d{2})/.exec(a)![1]; return allRuns(c).every((r) => !textOf(r).includes(`今天（${bad}）`)); } },
  { kind: 'expect', re: /只修改今天/, check: (c) => plansActs(c).length > 0 && plansActs(c).every((a: any) => a.summary.includes(c.d.slice(5)) || /挪|顺延/.test(a.reason ?? '')) },
  { kind: 'expect', re: /总时长压到 ?(\d+) ?分钟以内/, check: (c, a) => c.after.todayMinutes <= Number(/(\d+) ?分钟/.exec(a)![1]) },
  { kind: 'expect', re: /写明去向/, check: (c) => (c.run?.steps ?? []).some((x: string) => /挪到|顺延|待办/.test(x)) || !c.after.skipped },
  { kind: 'expect', re: /撤销日志|一键撤回|可撤回|可以撤回|并且可以撤回/, check: (c) => { const a = c.run?.actions ?? c.job?.actions ?? []; return a.length > 0 && a.every((x: any) => x.undoable); } },
  { kind: 'expect', re: /只执行一次/, check: (c) => c.after.redoCount <= 1 && (c.run?.actions ?? []).length === 0 },
  { kind: 'expect', re: /粗心/, check: (c) => c.after.careless },
  { kind: 'expect', re: /掌握度不下调/, check: (c) => c.after.masterySum >= c.before.masterySum },
  { kind: 'expect', re: /降低(主动)?提醒频率|降频/, check: (c) => c.after.proactive?.mode === 'reduced' },
  { kind: 'expect', re: /记录里写明降频原因|写进记录/, check: (c) => (c.run?.actions ?? c.job?.actions ?? []).some((a: any) => a.tool === 'setProactive' && a.reason) },
  { kind: 'expect', re: /本次最多发 ?1 条|只发 ?1 条/, check: (c) => c.after.newMessages <= 1 },
  { kind: 'expect', re: /只说明天最该做的一件事|只给一件最该做的事/, check: (c) => c.after.lastHeadline == null ? null : c.after.lastHeadline.length <= 40 },
  { kind: 'must_not', re: /排进明天或之后的日期却不说明/, check: (c) => plansActs(c).every((a: any) => a.summary.includes(c.d.slice(5)) || /挪|顺延|明天/.test(`${a.reason}${(c.run?.steps ?? []).join('')}`)) },
  { kind: 'must_not', re: /删除任何|物理删除|删除积压|删除计划或数据|改动错题本的作答记录/, check: (c) => c.after.answers >= c.before.answers && c.after.wrongAll >= c.before.wrongAll && c.after.tasksAll >= c.before.tasksAll },
  { kind: 'must_not', re: /再新增一条重复/, check: (c) => c.after.redoCount <= Math.max(1, c.before.redoCount) },
  { kind: 'must_not', re: /原频率或更高频率|发送多条/, check: (c) => c.after.proactive?.mode === 'reduced' || c.after.newMessages <= 1 },
  { kind: 'must_not', re: /大幅降低掌握度|标成未掌握/, check: (c) => c.after.masterySum >= c.before.masterySum },
  { kind: 'must_not', re: /自行发送任何外部消息/, check: () => true }, // 后端没有任何外发通道
  { kind: 'must_not', re: /没有确认就擅自改计划|在学生回答之前不改动计划/, check: (c) => plansActs(c).length === 0 },
  // 数量语义（coach-31…36）
  { kind: 'expect', re: /从 ?(\d+) ?道改成 ?(\d+) ?道/, check: (c, a) => { const m = /从 ?(\d+) ?道改成 ?(\d+) ?道/.exec(a)!; return c.before.redoQty === Number(m[1]) && c.after.redoQty === Number(m[2]) && c.after.redoCount === 1 && new RegExp(`已从 ${m[1]} 道(加到|改为) ${m[2]} 道`).test(runSteps(c)); } },
  { kind: 'expect', re: /数量设成 ?(\d+) ?道.*提示「已从 ?(\d+) ?道改为 ?(\d+) ?道」.*撤销/, check: (c, a) => { const m = /设成 ?(\d+) ?道/.exec(a)!; const from = c.before.redoQty; return c.after.redoQty === Number(m[1]) && runSteps(c).includes(`已从 ${from} 道改为 ${m[1]} 道`) && plansActs(c).every((x: any) => x.undoable); } },
  { kind: 'expect', re: /不新建第二条/, check: (c) => c.after.redoCount === 1 },
  { kind: 'expect', re: /识别为重复，提示今天.*已经有「重做错题 ?(\d+) ?道」/, check: (c, a) => { const n = Number(/重做错题 ?(\d+) ?道/.exec(a)![1]); return c.run?.done?.deduped === true && (c.run?.actions ?? []).length === 0 && runSteps(c).includes(`今天（${c.d.slice(5)}）的计划里已经有「重做 ${n} 道错题」`) && /再加/.test(runSteps(c)) && c.after.redoQty === n; } },
  { kind: 'expect', re: /提示今天.*已经有「重做错题 ?(\d+) ?道」，不做改动/, check: (c, a) => { const n = Number(/重做错题 ?(\d+) ?道/.exec(a)![1]); return c.run?.done?.deduped === true && (c.run?.actions ?? []).length === 0 && runSteps(c).includes(`今天（${c.d.slice(5)}）的计划里已经有「重做 ${n} 道错题」`) && c.after.redoQty === n; } },
  { kind: 'expect', re: /识别为重复，提示刚才已经从 ?(\d+) ?道加到 ?(\d+) ?道/, check: (c, a) => { const m = /从 ?(\d+) ?道加到 ?(\d+) ?道/.exec(a)!; return c.run?.done?.deduped === true && runSteps(c).includes(`刚才已从 ${m[1]} 道加到 ${m[2]} 道`) && /再加/.test(runSteps(c)) && c.after.redoQty === Number(m[2]); } },
  { kind: 'expect', re: /改的是 ?\d{2}-\d{2} ?的计划（账号时区的当天），压到 ?1 ?小时内/, check: (c) => c.run?.done?.date === c.d && (!c.setup?.today || c.d === c.setup.today) && c.after.todayMinutes <= 60 && plansActs(c).every((a: any) => a.summary.includes(c.d.slice(5)) || /挪/.test(a.reason ?? '')) },
  { kind: 'expect', re: /默认按 ?\d{2}-\d{2} ?处理/, check: (c) => c.run?.done?.date === c.d && /昨晚/.test(runSteps(c)) },
  { kind: 'must_not', re: /当成重复(指令)?拒绝/, check: (c) => c.run?.done?.deduped === false && plansActs(c).length > 0 },
  { kind: 'must_not', re: /新加一条 ?\d+ ?道的任务|新建第二条任务|^新建任务$/, check: (c) => c.after.redoCount <= 1 },
  { kind: 'must_not', re: /改到明天的计划|改到 ?\d{2}-\d{2}$/, check: (c) => c.run?.done?.date === c.d && plansActs(c).every((a: any) => !a.summary.includes(addDays(c.d, 1).slice(5)) || /挪/.test(a.reason ?? '')) },
  { kind: 'must_not', re: /按北京时间或服务器时区算(成别的)?日期/, check: (c) => c.run?.done?.date === c.d && (!c.setup?.today || c.d === c.setup.today) },
  { kind: 'must_not', re: /不提示就(直接变成|加到) ?(\d+) ?道/, check: (c) => c.after.redoQty === c.before.redoQty && c.run?.done?.deduped === true && /已经有|已从/.test(runSteps(c)) },
  { kind: 'must_not', re: /叠加成 ?(\d+) ?道|改成 ?(\d+) ?道$/, check: (c, a) => c.after.redoQty !== Number(/(\d+) ?道/.exec(a)![1]) },
];
async function snapshot(s: Session, d: string) {
  const q = async (sql: string) => (await db.query(sql, [s.userId])).rows[0];
  const tasks = await planTasks(s, d);
  const msgs = await s.get('/agent/messages');
  return {
    answers: (await q(`SELECT count(*)::int n FROM answer_records WHERE user_id=$1`)).n,
    wrongAll: (await q(`SELECT count(*)::int n FROM wrong_questions WHERE user_id=$1`)).n,
    careless: !!(await q(`SELECT 1 x FROM wrong_questions WHERE user_id=$1 AND error_type='careless'`)),
    masterySum: (await q(`SELECT COALESCE(sum(score),0)::float s FROM mastery WHERE user_id=$1`)).s,
    tasksAll: (await q(`SELECT count(*)::int n FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id WHERE p.user_id=$1`)).n,
    redoCount: tasks.filter((t) => t.kind === 'redo_wrong' && t.status !== 'skipped').length,
    redoQty: (() => { const t = tasks.find((x) => x.kind === 'redo_wrong' && x.status !== 'skipped'); return t ? (t.payload?.question_ids?.length ?? 0) : 0; })(),
    todayMinutes: tasks.filter((t) => ['todo', 'doing'].includes(t.status)).reduce((m, t) => m + (t.estimated_minutes ?? 0), 0),
    skipped: tasks.some((t) => t.status === 'skipped'),
    proactive: msgs.proactive, messages: msgs.items.length, lastHeadline: msgs.items[0]?.headline ?? null,
  };
}
async function runFileCase(c: Case, tz: string): Promise<{ checks: Check[]; transcript: string[]; notes: string[] }> {
  const s = await new Session(c.setup?.timezone || tz).init();
  const turns: Turn[] | null = Array.isArray(c.turns) && c.turns.length ? c.turns : null;
  const notes = await applySetup(s, c.setup, turns?.[0]);
  const d = await today(s);
  const before = await snapshot(s, d);
  const hourOf = async () => Number(((await s.get('/me/settings')).effective?.local_time ?? '').slice(0, 2));
  let run: any = null, job: any = null, hour = await hourOf();
  const checks: Check[] = [];
  const judge = (ctx: Ctx, exp: string[], mn: string[], prefix = '') => {
    for (const [kind, list] of [['expect', exp], ['must_not', mn]] as const) for (const a of list ?? []) {
      const m = MAPPERS.find((x) => x.kind === kind && x.re.test(a));
      const v = m ? m.check(ctx, a) : null;
      checks.push(v == null ? { assertion: prefix + a, kind, status: 'manual' } : { assertion: prefix + a, kind, status: v ? 'pass' : 'fail' });
    }
  };
  const turnRuns: any[] = [];
  if (turns) {
    // 多轮：同一个新账号上按顺序发，每轮自己的 X-Debug-Now；有本轮断言的按本轮判，用例级断言对整段对话判（ctx.turns 里每轮的结果都在）
    for (const [k, t] of turns.entries()) {
      if (t.now_local) s.debugNow = debugNowFor(s, t.now_local);
      s.transcript.push(`# 第 ${k + 1} 轮 X-Debug-Now=${s.debugNow ?? '（真实时间）'}`);
      const r = await s.command(t.input, { question_id: c.setup?.current_q ?? c.setup?.last_wrong?.q });
      turnRuns.push({ ...r, now: s.debugNow, hour: await hourOf() });
    }
    run = turnRuns[turnRuns.length - 1]; hour = run.hour;
  } else if (/^（无输入/.test(c.input)) job = await s.job(/周报/.test(c.input) ? 'weekly' : 'nightly', true);
  else run = await s.command(c.input.replace(/（.*?再次发送）$/, ''), { question_id: c.setup?.current_q ?? c.setup?.last_wrong?.q });
  const after: any = await snapshot(s, d); after.newMessages = after.messages - before.messages;
  const words = await s.get('/words/today').catch(() => null); // 问题回答里的单词数要和 /words/today 一致
  const ctx: Ctx = { s, run, job, d, before, after, setup: c.setup, turns: turns ? turnRuns : undefined, hour, words };
  if (turns) turns.forEach((t, k) => { if (t.expect?.length || t.must_not?.length) judge({ ...ctx, run: turnRuns[k], hour: turnRuns[k].hour, turns: [turnRuns[k]] }, t.expect ?? [], t.must_not ?? [], `第 ${k + 1} 轮：`); });
  judge(ctx, c.expect, c.must_not);
  s.debugNow = null;
  return { checks, transcript: s.transcript, notes };
}

async function main() {
  const unit = runUnitTests();
  db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) { console.error(`后端没在跑：${BASE}/health`); process.exit(2); }
  const fileCases: Case[] = fs.existsSync(CASES_FILE)
    ? fs.readFileSync(CASES_FILE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => ({ ...JSON.parse(l), source: 'file' as const }))
    : [];
  if (!fileCases.length) console.log(`（没有 ${path.relative(ROOT, CASES_FILE)}，跳过专家用例）`);
  const results: any[] = [];
  const only = process.env.EVAL_ONLY ? new RegExp(process.env.EVAL_ONLY) : null; // 调试用：只跑 id 匹配的用例
  for (const tz of TZS) for (const c of BUILTIN.filter((x) => !only || only.test(x.id))) {
    const s = await new Session(tz).init();
    let checks: Check[];
    try { checks = await c.run!(s); } catch (e: any) { checks = [{ assertion: '用例跑完', kind: 'expect', status: 'fail', detail: e.message }]; }
    results.push({ id: c.id, tz, source: 'builtin', scenario: c.scenario, checks, transcript: s.transcript });
    console.log(`${checks.every((x) => x.status === 'pass') ? 'PASS' : 'FAIL'} [${tz}] ${c.id} ${c.scenario}`);
    for (const x of checks.filter((x) => x.status !== 'pass')) console.log(`     ✗ ${x.assertion} ${x.detail ?? ''}`);
  }
  for (const c of fileCases.filter((x: any) => !only || only.test(x.id))) {
    const tz = c.setup?.timezone || TZS[0];
    let r: any;
    try { r = await runFileCase(c, tz); } catch (e: any) { r = { checks: [{ assertion: '用例跑完', kind: 'expect', status: 'fail', detail: e.message }], transcript: [], notes: [] }; }
    results.push({ id: c.id, tz, source: 'file', scenario: c.scenario, input: c.input, ...r });
    const n = (st: string) => r.checks.filter((x: Check) => x.status === st).length;
    console.log(`${n('fail') ? 'FAIL' : n('manual') ? 'PART' : 'PASS'} [file] ${c.id} ${c.scenario}（自动 ${n('pass')}✓ ${n('fail')}✗，人工 ${n('manual')}）`);
  }
  const all = results.flatMap((r) => r.checks.map((x: Check) => ({ ...x, source: r.source })));
  const cnt = (src: string, st: string) => all.filter((x) => x.source === src && x.status === st).length;
  const summary = { unit, builtin: { pass: cnt('builtin', 'pass'), fail: cnt('builtin', 'fail') }, file: { cases: fileCases.length, pass: cnt('file', 'pass'), fail: cnt('file', 'fail'), manual: cnt('file', 'manual') } };
  // 报告
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(ROOT, 'eval'); fs.mkdirSync(dir, { recursive: true });
  const md = [`# eval:agent 报告 ${new Date().toISOString()}`, '', `后端 ${BASE}（${health.ai}），时区 ${TZS.join('、')}`, '',
    `- 单测：${unit.pass} 通过，${unit.fail} 失败`, `- 内置用例断言：${summary.builtin.pass} 通过，${summary.builtin.fail} 失败`,
    `- 专家用例（${fileCases.length} 个）：自动 ${summary.file.pass} 通过 / ${summary.file.fail} 失败，待人工打分 ${summary.file.manual} 条`, '',
    ...results.flatMap((r) => [`## ${r.id}（${r.source}${r.source === 'builtin' ? ` · ${r.tz}` : ''}）${r.scenario}`, ...(r.notes?.length ? [`> ${r.notes.join('；')}`] : []), '',
      ...r.checks.map((x: Check) => `- [${x.status === 'pass' ? 'x' : ' '}] ${x.kind === 'must_not' ? '不应：' : ''}${x.assertion}${x.status === 'manual' ? ' **（人工打分：通过 / 不通过）**' : x.status === 'fail' ? ' ❌' : ''}${x.detail && x.status === 'fail' ? `\n  - ${x.detail}` : ''}`),
      '', '```', ...r.transcript, '```', ''])].join('\n');
  fs.writeFileSync(path.join(dir, `report-${stamp}.md`), md);
  fs.writeFileSync(path.join(dir, `report-${stamp}.json`), JSON.stringify({ summary, results }, null, 1));
  console.log(`\n单测 ${unit.pass}/${unit.pass + unit.fail}；内置 ${summary.builtin.pass}✓ ${summary.builtin.fail}✗；专家 ${fileCases.length} 例：自动 ${summary.file.pass}✓ ${summary.file.fail}✗，人工 ${summary.file.manual} 条`);
  console.log(`报告：eval/report-${stamp}.md`);
  await db.end();
  process.exitCode = unit.fail || summary.builtin.fail || (STRICT && summary.file.fail) ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
