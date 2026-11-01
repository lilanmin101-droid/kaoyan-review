/**
 * npm run eval:grading —— 英语翻译 / 作文 AI 批改评测（直接调批改服务 gradeWithModel，不走 HTTP）。
 * 用例：eval/grading_cases.jsonl（行业专家写，格式见 eval/grading_cases.README.md）；--cases <file> 可换文件。
 * DeepSeek（主评）和通义千问（复评）各自独立批每一条，分别统计、并排对照，再列出两个模型差太多的用例。
 * - 两个 Key 都没有（也没开 AI_FAKE=1）：打印 "skipped: no key"，退出码 0
 * - 只有一个 Key：只跑那一个，另一个在报告里标 skipped
 * - AI_FAKE=1：两个都用确定性假模型，端到端自检（报告标明是假模型）
 * - 坏行（JSON 解析失败 / 缺字段 / 题目找不到）不中断，写进报告「无法使用的行」
 * 报告：eval/grading-report-<时间>.md 和 .json。--strict：有用例不通过时退出码 1。
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { loadEnv } from './env';
loadEnv();
import { isConfigured } from '../src/ai/llm';
import { gradeWithModel, aiFake } from '../src/answers/grading.service';
import { countWords, GradeKind, GradeResult, MAX_SCORE } from '../src/english/ai-grader';

const ROOT = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const CASES_FILE = path.resolve(arg('--cases') ?? path.join(ROOT, 'eval/grading_cases.jsonl'));
const STRICT = argv.includes('--strict');
const MODELS = ['deepseek', 'qwen'] as const;
type Model = typeof MODELS[number];
const LABEL: Record<Model, string> = { deepseek: 'DeepSeek', qwen: '通义千问' };
const KINDS: GradeKind[] = ['translation', 'writing_a', 'writing_b'];
const DEFAULT_TOL: Record<GradeKind, number> = { translation: 0.5, writing_a: 1, writing_b: 2 };

interface Case {
  id: string; kind: GradeKind; answer_text: string; question_id?: string;
  question?: { stem: string; answer?: string[]; passage_text?: string | null };
  expected: { score: number; score_range?: [number, number]; band?: number | null; points_hit_must?: string[]; points_missed_must?: string[]; errors_must?: { span: string; type?: string }[] };
  check?: { score_tolerance?: number; band_must_be_within?: number | null };
  note?: string; line: number;
}
interface Bad { line: number; id?: string; reason: string }

// ───────────── 模糊匹配：要点是意思，不要求逐字一样 ─────────────
const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[（(][^）)]*[）)]/g, (m) => m).replace(/[\s\p{P}\p{S}]+/gu, '');
const bigrams = (s: string) => { const t = norm(s); const o = new Set<string>(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
const enWords = (s: string) => new Set((String(s).toLowerCase().match(/[a-z]{3,}|\d+/g) ?? []));
/** want 这一点在 got 的某一条里算「说到了」：中文按二字组覆盖 ≥50%，英文/数字按词覆盖 ≥50%，或者互相包含 */
export function pointMatches(want: string, got: string[]): boolean {
  const w = norm(want); if (!w) return false;
  const wb = bigrams(want), ww = enWords(want);
  return got.some((g) => {
    const gn = norm(g); if (!gn) return false;
    if (gn.includes(w) || w.includes(gn) && gn.length >= 2) return true;
    const gb = bigrams(g), gw = enWords(g);
    const rb = wb.size ? [...wb].filter((x) => gb.has(x)).length / wb.size : 0;
    const rw = ww.size ? [...ww].filter((x) => gw.has(x)).length / ww.size : 0;
    return Math.max(rb, rw) >= 0.5;
  });
}
const spanMatches = (want: string, errs: { span: string }[]) => { const w = norm(want); return errs.some((e) => { const s = norm(e.span); return !!s && !!w && (s.includes(w) || w.includes(s)); }); };

// ───────────── 读用例 ─────────────
function readCases(file: string): { cases: Case[]; bad: Bad[] } {
  const cases: Case[] = [], bad: Bad[] = [];
  const seen = new Set<string>();
  fs.readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = i + 1, l = raw.trim();
    if (!l || l.startsWith('//') || l.startsWith('#')) return;
    let d: any;
    try { d = JSON.parse(l); } catch (e: any) { bad.push({ line, reason: `JSON 解析失败：${String(e.message).slice(0, 120)}` }); return; }
    const why: string[] = [];
    if (!d || typeof d !== 'object' || Array.isArray(d)) { bad.push({ line, reason: '不是 JSON 对象' }); return; }
    if (typeof d.id !== 'string' || !d.id) why.push('缺 id');
    else if (seen.has(d.id)) why.push(`id 重复（${d.id}）`);
    if (!KINDS.includes(d.kind)) why.push(`kind 必须是 ${KINDS.join('/')}（现在是 ${JSON.stringify(d.kind)}）`);
    if (typeof d.answer_text !== 'string') why.push('缺 answer_text（字符串，可以是空串）');
    if (!d.question_id && !d.question?.stem) why.push('要么给 question_id，要么给 question.stem');
    const ex = d.expected;
    if (!ex || typeof ex.score !== 'number' || !isFinite(ex.score)) why.push('缺 expected.score（数字）');
    else if (KINDS.includes(d.kind) && (ex.score < 0 || ex.score > MAX_SCORE[d.kind as GradeKind])) why.push(`expected.score 超出 0–${MAX_SCORE[d.kind as GradeKind]}`);
    if (ex?.score_range != null && !(Array.isArray(ex.score_range) && ex.score_range.length === 2 && ex.score_range.every((x: any) => typeof x === 'number') && ex.score_range[0] <= ex.score_range[1])) why.push('expected.score_range 要是 [低, 高]');
    if (d.kind !== 'translation' && ex && ex.band != null && !(Number.isInteger(ex.band) && ex.band >= 0 && ex.band <= 5)) why.push('expected.band 要是 0–5 的整数');
    for (const k of ['points_hit_must', 'points_missed_must']) if (ex?.[k] != null && !(Array.isArray(ex[k]) && ex[k].every((x: any) => typeof x === 'string'))) why.push(`expected.${k} 要是字符串数组`);
    if (ex?.errors_must != null && !(Array.isArray(ex.errors_must) && ex.errors_must.every((x: any) => x && typeof x.span === 'string'))) why.push('expected.errors_must 要是 [{span,type}]');
    if (why.length) { bad.push({ line, id: d?.id, reason: why.join('；') }); return; }
    seen.add(d.id);
    cases.push({ ...d, line });
  });
  return { cases, bad };
}

// ───────────── 单条判分 ─────────────
interface One { status: 'ok' | 'error' | 'skipped'; error?: string; score?: number; band?: number | null; ms?: number; model?: string;
  score_err?: number; band_exact?: boolean | null; band_within?: boolean | null; in_range?: boolean; hit_recall?: number | null; hit_found?: string[]; hit_lost?: string[];
  missed_ok?: number | null; err_recall?: number | null; pass?: boolean; fails?: string[]; result?: GradeResult }

function judge(c: Case, r: GradeResult): One {
  const ex = c.expected, tol = c.check?.score_tolerance ?? DEFAULT_TOL[c.kind];
  const bandTol = c.check?.band_must_be_within ?? 1;
  const score_err = Math.abs(r.score - ex.score);
  const [lo, hi] = ex.score_range ?? [ex.score, ex.score];
  const in_range = r.score >= lo - 1e-9 && r.score <= hi + 1e-9;
  const hasBand = c.kind !== 'translation' && ex.band != null;
  const band_exact = hasBand ? r.band === ex.band : null;
  const band_within = hasBand ? r.band != null && Math.abs(r.band - (ex.band as number)) <= 1 : null;
  const must = ex.points_hit_must ?? [];
  const hit_found = must.filter((p) => pointMatches(p, r.points_hit));
  const hit_recall = must.length ? hit_found.length / must.length : null;
  const mm = ex.points_missed_must ?? [];
  const missed_ok = mm.length ? mm.filter((p) => !pointMatches(p, r.points_hit)).length / mm.length : null; // 该漏的没被算成「答到了」
  const em = ex.errors_must ?? [];
  const err_recall = em.length ? em.filter((e) => spanMatches(e.span, r.errors)).length / em.length : null;
  const fails: string[] = [];
  if (!(score_err <= tol + 1e-9 || in_range)) fails.push(`分数 ${r.score}，期望 ${ex.score}${ex.score_range ? `（${lo}–${hi}）` : ''}±${tol}`);
  if (hasBand && r.band != null && Math.abs(r.band - (ex.band as number)) > bandTol) fails.push(`档位 ${r.band}，期望 ${ex.band}±${bandTol}`);
  return { status: 'ok', score: r.score, band: r.band, model: r.model, score_err, band_exact, band_within, in_range, hit_recall, hit_found, hit_lost: must.filter((p) => !hit_found.includes(p)),
    missed_ok, err_recall, pass: fails.length === 0, fails, result: r };
}

// ───────────── 汇总 ─────────────
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null, d = 2) => (x == null ? '—' : x.toFixed(d));
function summarize(rows: One[]) {
  const ok = rows.filter((r) => r.status === 'ok');
  const bands = ok.filter((r) => r.band_exact != null);
  const hitRows = ok.filter((r) => r.hit_recall != null);
  const lost = hitRows.reduce((a, r) => a + (r.hit_lost?.length ?? 0), 0), found = hitRows.reduce((a, r) => a + (r.hit_found?.length ?? 0), 0);
  return {
    n: rows.length, graded: ok.length, errors: rows.filter((r) => r.status === 'error').length,
    pass_rate: ok.length ? ok.filter((r) => r.pass).length / ok.length : null,
    band_exact: bands.length ? bands.filter((r) => r.band_exact).length / bands.length : null,
    band_within1: bands.length ? bands.filter((r) => r.band_within).length / bands.length : null,
    mae: mean(ok.map((r) => r.score_err!)),
    in_range: ok.length ? ok.filter((r) => r.in_range).length / ok.length : null,
    hit_recall: found + lost ? found / (found + lost) : null, // 按要点数微平均
    missed_ok: mean(ok.filter((r) => r.missed_ok != null).map((r) => r.missed_ok!)),
    err_recall: mean(ok.filter((r) => r.err_recall != null).map((r) => r.err_recall!)),
    mean_ms: mean(ok.map((r) => r.ms ?? 0)),
  };
}

async function loadQuestions(cases: Case[], bad: Bad[]): Promise<Case[]> {
  const ids = [...new Set(cases.filter((c) => !c.question?.stem && c.question_id).map((c) => c.question_id!))];
  const qmap = new Map<string, any>();
  if (ids.length) {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await db.connect();
      const r = await db.query(`SELECT q.id, q.stem, q.answer, p.text AS passage_text FROM questions q LEFT JOIN passages p ON p.id=q.passage_id WHERE q.id = ANY($1)`, [ids]);
      for (const row of r.rows) qmap.set(row.id, row);
    } catch (e: any) { console.warn(`[eval:grading] 读题库失败（${e.message}），只能用带 question.stem 的用例`); }
    finally { await db.end().catch(() => {}); }
  }
  return cases.filter((c) => {
    if (c.question?.stem) return true;
    const q = qmap.get(c.question_id!);
    if (!q) { bad.push({ line: c.line, id: c.id, reason: `题库里找不到 ${c.question_id}（先导入，或在用例里写 question.stem）` }); return false; }
    c.question = { stem: q.stem, answer: q.answer ?? [], passage_text: q.passage_text ?? null };
    return true;
  });
}

async function main() {
  const fake = aiFake();
  const avail: Record<Model, boolean> = { deepseek: fake || isConfigured('deepseek'), qwen: fake || isConfigured('qwen') };
  if (!avail.deepseek && !avail.qwen) {
    console.log('eval:grading skipped: no key（DEEPSEEK_API_KEY / DASHSCOPE_API_KEY 都没配；自检用 AI_FAKE=1 npm run eval:grading）');
    return 0;
  }
  if (!fs.existsSync(CASES_FILE)) { console.log(`eval:grading skipped: 没有用例文件 ${path.relative(ROOT, CASES_FILE)}（格式见 eval/grading_cases.README.md）`); return 0; }
  const { cases: parsed, bad } = readCases(CASES_FILE);
  const cases = await loadQuestions(parsed, bad);
  bad.sort((a, b) => a.line - b.line);
  const models = MODELS.filter((m) => avail[m]);
  console.log(`eval:grading  ${cases.length} 条可用 / ${bad.length} 条坏行  模型：${MODELS.map((m) => `${LABEL[m]}${avail[m] ? '' : '(skipped)'}`).join('，')}${fake ? '  [AI_FAKE=1 假模型自检]' : ''}`);

  const res: Record<string, Partial<Record<Model, One>>> = {};
  const CONC = Number(process.env.EVAL_CONCURRENCY || 3);
  const jobs = cases.flatMap((c) => MODELS.map((m) => ({ c, m })));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, async () => {
    while (next < jobs.length) {
      const { c, m } = jobs[next++];
      (res[c.id] ??= {});
      if (!avail[m]) { res[c.id][m] = { status: 'skipped' }; continue; }
      const t = Date.now();
      try {
        const r = await gradeWithModel(m, c.kind, c.question!, c.answer_text, countWords(c.answer_text));
        res[c.id][m] = { ...judge(c, r), ms: Date.now() - t };
      } catch (e: any) { res[c.id][m] = { status: 'error', error: String(e?.message ?? e).slice(0, 300), ms: Date.now() - t }; }
      const o = res[c.id][m]!;
      console.log(`  ${c.id.padEnd(14)} ${LABEL[m].padEnd(8)} ${o.status === 'ok' ? `${o.pass ? '✓' : '✗'} score ${o.score}${o.band != null ? ` band ${o.band}` : ''} (期望 ${c.expected.score}${c.expected.band != null ? `/${c.expected.band}` : ''})` : `ERROR ${o.error}`}`);
    }
  }));

  // 汇总：每个模型分别算，再按题型拆
  const sum = (m: Model, kind?: GradeKind) => summarize(cases.filter((c) => !kind || c.kind === kind).map((c) => res[c.id][m]!));
  const overall = Object.fromEntries(models.map((m) => [m, sum(m)])) as Record<Model, ReturnType<typeof summarize>>;
  // 两个模型的分歧：线上复评规则（作文 >1 档、翻译 >1 分）+ 本条容差（分差 > score_tolerance）
  const both = cases.filter((c) => res[c.id].deepseek?.status === 'ok' && res[c.id].qwen?.status === 'ok');
  const diverge = both.map((c) => {
    const a = res[c.id].deepseek!, b = res[c.id].qwen!, tol = c.check?.score_tolerance ?? DEFAULT_TOL[c.kind];
    const dScore = Math.abs(a.score! - b.score!), dBand = a.band != null && b.band != null ? Math.abs(a.band - b.band) : null;
    const prodRule = c.kind === 'translation' ? dScore > 1 : (dBand ?? 0) > 1; // = ai-grader.disagrees()
    const why = [dScore > tol + 1e-9 ? `分差 ${dScore} > 容差 ${tol}` : '', dBand != null && dBand > 1 ? `档差 ${dBand} > 1` : '', prodRule && !(dScore > tol) && !(dBand != null && dBand > 1) ? '线上复评规则判分歧' : ''].filter(Boolean);
    return { c, a, b, dScore, dBand, prodRule, flagged: why.length > 0, why };
  });
  const flagged = diverge.filter((d) => d.flagged);
  const crossRate = both.length ? diverge.filter((d) => d.prodRule).length / both.length : null;
  const flagRate = both.length ? flagged.length / both.length : null;

  // ───────────── 报告 ─────────────
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(ROOT, `eval/grading-report-${ts}.md`);
  const L: string[] = [];
  const localTime = new Date().toLocaleString('zh-CN', { timeZone: 'America/Los_Angeles', hour12: false }) + '（America/Los_Angeles）';
  L.push(`# AI 批改评测报告`, '', `- 时间：${localTime}`, `- 用例：\`${path.relative(ROOT, CASES_FILE)}\`，可用 ${cases.length} 条（翻译 ${cases.filter((c) => c.kind === 'translation').length}、小作文 ${cases.filter((c) => c.kind === 'writing_a').length}、大作文 ${cases.filter((c) => c.kind === 'writing_b').length}），坏行 ${bad.length} 条`,
    `- 模型：${MODELS.map((m) => `${LABEL[m]} ${avail[m] ? `✓${fake ? '（AI_FAKE 假模型）' : ''}` : '**skipped（没有 Key）**'}`).join('；')}`,
    ...(fake ? ['- ⚠️ AI_FAKE=1：这是假模型的端到端自检，数字不代表真实批改质量'] : []),
    `- 通过标准：分数在 score_range 内或与 expected.score 相差 ≤ score_tolerance（缺省：翻译 0.5、小作文 1、大作文 2），且作文档位相差 ≤ band_must_be_within（缺省 1）`, '');
  L.push('## 总体指标（两个模型分别统计）', '', `| 指标 | ${MODELS.map((m) => LABEL[m]).join(' | ')} |`, `|---|${MODELS.map(() => '---').join('|')}|`);
  const cell = (m: Model, f: (s: ReturnType<typeof summarize>) => string) => (avail[m] ? f(overall[m]) : 'skipped');
  const rowsDef: [string, (s: ReturnType<typeof summarize>) => string][] = [
    ['通过率', (s) => `${pct(s.pass_rate)}（${s.graded} 条出分${s.errors ? `，${s.errors} 条报错` : ''}）`],
    ['档位完全一致（作文）', (s) => pct(s.band_exact)], ['档位 ±1 以内（作文）', (s) => pct(s.band_within1)],
    ['平均分数绝对误差', (s) => num(s.mae)], ['分数落在 score_range', (s) => pct(s.in_range)],
    ['points_hit 召回（按要点）', (s) => pct(s.hit_recall)], ['该漏的要点没被算成答到', (s) => pct(s.missed_ok)],
    ['errors_must 找到率', (s) => pct(s.err_recall)], ['平均耗时', (s) => (s.mean_ms == null ? '—' : `${Math.round(s.mean_ms)} ms`)],
  ];
  for (const [name, f] of rowsDef) L.push(`| ${name} | ${MODELS.map((m) => cell(m, f)).join(' | ')} |`);
  L.push(`| 交叉复评分歧率（线上规则：作文 >1 档 / 翻译 >1 分） | ${both.length ? `${pct(crossRate)}（${diverge.filter((d) => d.prodRule).length}/${both.length}）` : '—（要两个模型都出分）'} ||`);
  L.push(`| 两模型差超容差或 >1 档 | ${both.length ? `${pct(flagRate)}（${flagged.length}/${both.length}）` : '—'} ||`, '');
  L.push('### 按题型', '', `| 题型 | 条数 | ${MODELS.map((m) => `${LABEL[m]} 通过率 / MAE / 档±1 / 召回`).join(' | ')} |`, `|---|---|${MODELS.map(() => '---').join('|')}|`);
  for (const k of KINDS) {
    const n = cases.filter((c) => c.kind === k).length; if (!n) continue;
    L.push(`| ${({ translation: '翻译', writing_a: '小作文', writing_b: '大作文' } as any)[k]} | ${n} | ${MODELS.map((m) => { if (!avail[m]) return 'skipped'; const s = sum(m, k); return `${pct(s.pass_rate)} / ${num(s.mae)} / ${pct(s.band_within1)} / ${pct(s.hit_recall)}`; }).join(' | ')} |`);
  }
  L.push('', '## 每条用例（并排）', '', `| 用例 | 题型 | 期望 分/档 | ${MODELS.map((m) => `${LABEL[m]} 分/档`).join(' | ')} | ${MODELS.map((m) => `${LABEL[m]} 召回`).join(' | ')} | ${MODELS.map((m) => `${LABEL[m]} 结果`).join(' | ')} |`,
    `|---|---|---|${MODELS.map(() => '---').join('|')}|${MODELS.map(() => '---').join('|')}|${MODELS.map(() => '---').join('|')}|`);
  const sb = (o?: One) => (!o || o.status === 'skipped' ? 'skipped' : o.status === 'error' ? 'ERROR' : `${o.score}${o.band != null ? ` / ${o.band}` : ''}`);
  for (const c of cases) {
    const r = res[c.id];
    L.push(`| ${c.id} | ${c.kind} | ${c.expected.score}${c.expected.band != null ? ` / ${c.expected.band}` : ''} | ${MODELS.map((m) => sb(r[m])).join(' | ')} | ${MODELS.map((m) => (r[m]?.status === 'ok' ? pct(r[m]!.hit_recall ?? null) : '—')).join(' | ')} | ${MODELS.map((m) => { const o = r[m]; return !o || o.status === 'skipped' ? 'skipped' : o.status === 'error' ? `报错：${o.error!.replace(/\|/g, '/').slice(0, 80)}` : o.pass ? '✓' : `✗ ${o.fails!.join('；')}`; }).join(' | ')} |`);
  }
  L.push('', '## 两个模型分歧的用例（分差 > 容差，或档差 > 1）', '');
  if (!both.length) L.push(`（只有 ${models.map((m) => LABEL[m]).join('')} 出分，${MODELS.filter((m) => !avail[m]).map((m) => LABEL[m]).join('')} skipped，没法对比）`);
  else if (!flagged.length) L.push('没有。');
  else {
    L.push('| 用例 | 题型 | 期望 | DeepSeek | 通义千问 | 分差 | 档差 | 原因 | 线上会标「需人工复核」 |', '|---|---|---|---|---|---|---|---|---|');
    for (const d of flagged) L.push(`| ${d.c.id} | ${d.c.kind} | ${d.c.expected.score}${d.c.expected.band != null ? ` / ${d.c.expected.band}` : ''} | ${sb(d.a)} | ${sb(d.b)} | ${d.dScore} | ${d.dBand ?? '—'} | ${d.why.join('；')} | ${d.prodRule ? '是' : '否'} |`);
  }
  const failing = cases.flatMap((c) => models.filter((m) => res[c.id][m]?.status === 'ok' && !res[c.id][m]!.pass).map((m) => ({ c, m, o: res[c.id][m]! })));
  if (failing.length) {
    L.push('', '## 没通过的明细', '');
    for (const { c, m, o } of failing) {
      L.push(`### ${c.id} · ${LABEL[m]}`, '', `- ${o.fails!.join('；')}`, ...(c.note ? [`- 专家说明：${c.note}`] : []), ...(o.hit_lost?.length ? [`- 没认出的要点：${o.hit_lost.join('、')}`] : []),
        `- 模型理由：${(o.result?.band_reason ?? '').replace(/\n/g, ' ').slice(0, 300)}`, `- 模型 points_hit：${(o.result?.points_hit ?? []).join('、') || '（空）'}`, '');
    }
  }
  if (bad.length) { L.push('', '## 无法使用的行', '', '| 行号 | id | 原因 |', '|---|---|---|'); for (const b of bad) L.push(`| ${b.line} | ${b.id ?? '—'} | ${b.reason.replace(/\|/g, '/')} |`); }
  fs.writeFileSync(out, L.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
  fs.writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify({ at: new Date().toISOString(), fake, models: avail, overall, cross_disagreement_rate: crossRate, flagged_rate: flagRate,
    flagged: flagged.map((d) => ({ id: d.c.id, deepseek: { score: d.a.score, band: d.a.band }, qwen: { score: d.b.score, band: d.b.band }, why: d.why })),
    cases: cases.map((c) => ({ id: c.id, kind: c.kind, expected: c.expected, ...Object.fromEntries(MODELS.map((m) => { const { result, ...o } = res[c.id][m] ?? ({} as any); return [m, { ...o, points_hit: result?.points_hit, errors: result?.errors }]; })) })),
    bad }, null, 2));

  console.log('');
  for (const m of MODELS) console.log(avail[m] ? `${LABEL[m]}: 通过 ${pct(overall[m].pass_rate)}  档位一致 ${pct(overall[m].band_exact)}  ±1 ${pct(overall[m].band_within1)}  MAE ${num(overall[m].mae)}  要点召回 ${pct(overall[m].hit_recall)}${overall[m].errors ? `  报错 ${overall[m].errors}` : ''}` : `${LABEL[m]}: skipped（没有 Key）`);
  console.log(`交叉复评分歧率 ${pct(crossRate)}；两模型差超容差 ${flagged.length} 条${bad.length ? `；坏行 ${bad.length} 条（见报告）` : ''}`);
  console.log(`报告：${path.relative(ROOT, out)}`);
  return STRICT && (failing.length || models.some((m) => overall[m].errors)) ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error('[eval:grading] 运行失败：', e?.stack ?? e); process.exit(2); });
