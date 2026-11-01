/**
 * 批量预生成讲解并入库：npm run gen:explanations -- [--subject english1|math1] [--year 2022 | 2015-2025] [--dry-run] [--force]
 *   [--concurrency 3] [--rpm 30] [--limit N] [--ids a,b] [--retry-failed] [--include-official] [--report path]
 * - 选题：review_status=confirmed，没有「已核对」AI 讲解，也没有官方 / 专家解析（--include-official 连这些也生成）
 * - 已有当前提示词版本（PROMPT_VERSION）的讲解（通过或待核对）→ 跳过；--retry-failed 重做待核对的；--force 全部重做
 * - 出错（网络 / 429 / 解析失败）的题不写库，下次运行自动续上 → 幂等、可断点续跑；Ctrl-C 等在途的题做完再停
 * - 顺序：english1 2015–2025 → math1；质检不过关的存为 needs_review（前端「这题讲解待核对」），不会当好讲解发出
 * - --dry-run：只统计要生成多少题、估算 token 和费用，不调模型不写库
 * - 没有 Key（且没开 AI_FAKE=1）时等同 --dry-run
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { loadEnv } from './env';
import { aiStatus, isConfigured, providers, resolveDeepseekModel } from '../src/ai/llm';
import { ChatFn, officialSolution, PROMPT_VERSION, QuestionRow } from '../src/ai/explain';
import { aiFake, estimateQuestion, fakeChatFor, generateChecked, loadExplainQuestions, prices, storeExplanation } from '../src/ai/explanation-gen';
import { chat } from '../src/ai/llm';

function args(argv = process.argv.slice(2)) {
  const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const yr = get('year');
  let years: [number, number] | undefined;
  if (yr) { const m = yr.match(/^(\d{4})(?:-(\d{4}))?$/); if (!m) throw new Error(`--year 格式：2022 或 2015-2025，收到 ${yr}`); years = [Number(m[1]), Number(m[2] ?? m[1])]; }
  return {
    subject: get('subject') ?? get('exam'), years, ids: get('ids')?.split(',').map((s) => s.trim()).filter(Boolean),
    limit: get('limit') ? Number(get('limit')) : undefined, force: argv.includes('--force'), dry: argv.includes('--dry-run'),
    retryFailed: argv.includes('--retry-failed'), includeOfficial: argv.includes('--include-official'),
    concurrency: Math.max(1, Number(get('concurrency') ?? 3)), rpm: Math.max(1, Number(get('rpm') ?? 30)), report: get('report'),
  };
}

/** 简单的滑动窗口限速：每分钟最多 rpm 次模型调用（所有并发共享） */
function rateLimiter(rpm: number) {
  const stamps: number[] = [];
  return async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= 60_000) stamps.shift();
      if (stamps.length < rpm) { stamps.push(now); return; }
      await new Promise((r) => setTimeout(r, 60_000 - (now - stamps[0]) + 5));
    }
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (e: any) => /\b(429|5\d\d)\b|ETIMEDOUT|ECONNRESET|fetch failed|aborted|timeout/i.test(String(e?.message ?? e));

let stopping = false;
async function main() {
  loadEnv();
  const o = args();
  const fake = aiFake();
  const keys = isConfigured('deepseek') && isConfigured('qwen');
  const dry = o.dry || (!keys && !fake);
  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.min(10, o.concurrency + 1) });
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ai_explanations' AND column_name IN ('prompt_version','quality','origin','usage')`)).rows.length;
  if (cols < 4) { console.error('ai_explanations 缺少 prompt_version / quality / origin / usage 列：先运行 npm run migrate'); process.exit(2); }

  const p: any[] = [];
  const w = [`q.review_status='confirmed'`];
  if (o.subject) { p.push(o.subject); w.push(`q.exam=$${p.length}`); }
  if (o.years) { p.push(o.years[0], o.years[1]); w.push(`q.year BETWEEN $${p.length - 1} AND $${p.length}`); }
  if (o.ids?.length) { p.push(o.ids); w.push(`q.id = ANY($${p.length}::text[])`); }
  const all = await loadExplainQuestions(db, w.join(' AND '), p, `CASE q.exam WHEN 'english1' THEN 0 WHEN 'math1' THEN 1 ELSE 2 END, q.exam, q.year, q.number`);
  const ex = new Map<string, { verified_ai: boolean; current: string | null }>((await db.query(
    `SELECT question_id, bool_or(status='published' AND verified) verified_ai,
            (array_agg(status ORDER BY version DESC) FILTER (WHERE prompt_version=$1))[1] current
       FROM ai_explanations GROUP BY question_id`, [PROMPT_VERSION])).rows.map((r) => [r.question_id, r]));

  const skip = { verified_ai: 0, official: 0, done_current: 0, failed_current: 0 };
  let todo: QuestionRow[] = [];
  for (const q of all) {
    const e = ex.get(q.id);
    if (!o.force) {
      if (e?.verified_ai && !(e.current === 'needs_review' && o.retryFailed)) { skip.verified_ai++; continue; }
      if (!o.includeOfficial && officialSolution(q)) { skip.official++; continue; }
      if (e?.current === 'needs_review' && !o.retryFailed) { skip.failed_current++; continue; }
      if (e?.current && e.current !== 'needs_review') { skip.done_current++; continue; }
    }
    todo.push(q);
  }
  if (o.limit) todo = todo.slice(0, o.limit);

  // 汇总 + 估算
  const by = new Map<string, { n: number; ds_in: number; ds_out: number; qw_in: number; qw_out: number }>();
  const tot = { n: 0, ds_in: 0, ds_out: 0, qw_in: 0, qw_out: 0 };
  for (const q of todo) {
    const k = `${q.exam} ${q.section ?? q.type}`;
    const t = by.get(k) ?? { n: 0, ds_in: 0, ds_out: 0, qw_in: 0, qw_out: 0 };
    const e = estimateQuestion(q);
    for (const x of [t, tot]) { x.n++; x.ds_in += e.deepseek.input; x.ds_out += e.deepseek.output; x.qw_in += e.qwen.input; x.qw_out += e.qwen.output; }
    by.set(k, t);
  }
  const pr = prices();
  const usd = (i: number, out: number, pp: { input: number; output: number }) => (i * pp.input + out * pp.output) / 1e6;
  const ps = providers();
  console.log(`提示词版本 ${PROMPT_VERSION}｜生成模型 ${fake ? 'fake-explainer-v1（AI_FAKE=1）' : `${resolveDeepseekModel(ps.deepseek.models.reasoner, true).model}（思考模式；配置名 ${ps.deepseek.models.reasoner}）`}｜核对模型 ${fake ? 'fake-verifier-v1' : ps.qwen.models.chat}`);
  console.log(`符合条件 ${all.length} 题；跳过：已有核对通过的 AI 讲解 ${skip.verified_ai}、已有官方/专家解析 ${skip.official}、当前版本已生成 ${skip.done_current}、当前版本待核对 ${skip.failed_current}（--retry-failed 重做）`);
  console.log(`要生成 ${todo.length} 题：`);
  for (const [k, t] of by) console.log(`  ${k.padEnd(28)} ${String(t.n).padStart(4)} 题  DeepSeek 入 ${t.ds_in.toLocaleString()} / 出 ${t.ds_out.toLocaleString()} tok`);
  const peak = usd(tot.ds_in, tot.ds_out, pr.deepseek_peak), offp = usd(tot.ds_in, tot.ds_out, pr.deepseek_offpeak), qw = usd(tot.qw_in, tot.qw_out, pr.qwen);
  console.log(`估算 token：DeepSeek 输入 ${tot.ds_in.toLocaleString()}、输出（含思考）${tot.ds_out.toLocaleString()}；通义千问 输入 ${tot.qw_in.toLocaleString()}、输出 ${tot.qw_out.toLocaleString()}`);
  console.log(`估算费用（美元，按缓存未命中）：DeepSeek 高峰 $${peak.toFixed(2)} / 低峰 $${offp.toFixed(2)}；通义千问 $${qw.toFixed(2)}；合计 $${(offp + qw).toFixed(2)}–$${(peak + qw).toFixed(2)}`);
  console.log(`  （单价/百万 token：DeepSeek 高峰 入 $${pr.deepseek_peak.input} 出 $${pr.deepseek_peak.output}，低峰 入 $${pr.deepseek_offpeak.input} 出 $${pr.deepseek_offpeak.output}；千问 入 $${pr.qwen.input} 出 $${pr.qwen.output}；可用 DEEPSEEK_PRICE_* / QWEN_PRICE_* 覆盖）`);
  if (dry) {
    if (!o.dry) console.log(`没有配置 ${aiStatus().providers.filter((x) => !x.configured).map((x) => x.key_env).join('、')}（也没开 AI_FAKE=1）：只做估算，没有写库。`);
    else console.log('--dry-run：没有调用模型，没有写库。');
    await db.end(); return;
  }

  // 生成
  const limit = rateLimiter(o.rpm);
  const call = (q: QuestionRow): ChatFn => {
    const base: ChatFn = fake ? fakeChatFor(q) : (pp, opt) => chat(pp, opt);
    return async (pp, opt, role) => {
      for (let attempt = 0; ; attempt++) {
        await limit();
        try { return await base(pp, opt, role); } catch (e: any) {
          if (attempt >= 3 || !retryable(e)) throw e;
          await sleep(2000 * 2 ** attempt + Math.random() * 500);
        }
      }
    };
  };
  process.on('SIGINT', () => { if (stopping) process.exit(130); stopping = true; console.log('\n收到 Ctrl-C：等在途的题做完就停（再按一次立即退出）'); });
  const res = { published: 0, needs_review: 0, error: 0 };
  const failLines: string[] = [], errLines: string[] = [];
  const t0 = Date.now();
  let i = 0, done = 0;
  const worker = async () => {
    while (!stopping && i < todo.length) {
      const q = todo[i++];
      try {
        const out = await generateChecked(q, call(q));
        await storeExplanation(db, q, out, 'batch');
        res[out.status]++;
        if (out.status === 'needs_review') failLines.push(`- ${q.id}：${[...out.quality.failures.map((f) => `[${f.code}] ${f.detail}`), ...(out.result.verify_detail?.reasons ?? [])].join('；')}`);
      } catch (e: any) {
        res.error++; errLines.push(`- ${q.id}：${String(e?.message ?? e).slice(0, 200)}`);
      }
      done++;
      if (done % 10 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}  通过 ${res.published}  待核对 ${res.needs_review}  出错 ${res.error}  ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, todo.length) }, worker));
  const left = todo.length - done;
  console.log(`完成：通过并发布 ${res.published}，质检/核对未过（needs_review）${res.needs_review}，出错未写库 ${res.error}${left ? `，未开始 ${left}（重跑即续上）` : ''}`);

  const report = o.report ?? path.resolve(__dirname, `../../reports/gen-explanations-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.md`);
  try {
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, [`# 讲解预生成报告（${new Date().toISOString()}）`, '', `提示词版本 ${PROMPT_VERSION}；模型 ${fake ? 'fake' : ps.deepseek.models.reasoner} + ${fake ? 'fake' : ps.qwen.models.chat}`, '',
    `- 要生成 ${todo.length}；通过 ${res.published}；needs_review ${res.needs_review}；出错 ${res.error}；未开始 ${left}`, '',
    '## 待核对（needs_review）', ...(failLines.length ? failLines : ['（无）']), '', '## 出错（未写库，重跑会续上）', ...(errLines.length ? errLines : ['（无）']), ''].join('\n'));
  console.log(`报告：${report}`);
  } catch (e: any) { console.log(`报告没写成（${e.message}）；待核对：\n${failLines.join('\n') || '（无）'}\n出错：\n${errLines.join('\n') || '（无）'}`); }
  await db.end();
  if (res.error) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
export { args as parseGenArgs, rateLimiter };
