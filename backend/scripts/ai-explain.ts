/**
 * 批量生成可信讲解：npm run ai:explain -- --exam math1 --year 2024 [--ids math1-2024-01,...] [--force] [--limit N] [--dry-run]
 * - 只处理 review_status=confirmed 的题
 * - DeepSeek（DEEPSEEK_REASONER_MODEL）生成分步讲解；有 solution 时以它为底稿
 * - 通义千问（QWEN_MODEL）独立解答，和题库答案三方比对：一致 → published+verified；不一致 → needs_review（前端「这题讲解待核对」）
 * - 每次写新版本（version+1），旧版本保留；已有 published/needs_review 的题默认跳过（--force 重做）
 * - 没有 Key 时只报告并退出（不写库）
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { loadEnv } from './env';
import { aiStatus, isConfigured } from '../src/ai/llm';
import { explainQuestion, officialAnswer, officialSolution, QuestionRow } from '../src/ai/explain';

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  return { exam: get('exam'), year: get('year') ? Number(get('year')) : undefined, ids: get('ids')?.split(',').map((s) => s.trim()).filter(Boolean),
    limit: get('limit') ? Number(get('limit')) : undefined, force: a.includes('--force'), dry: a.includes('--dry-run'), concurrency: Number(get('concurrency') ?? 2),
    report: get('report') };
}

async function main() {
  loadEnv();
  const o = args();
  if (!o.exam && !o.ids?.length) { console.error('用法：npm run ai:explain -- --exam math1 --year 2024 [--ids ...] [--force] [--limit N] [--dry-run]'); process.exit(2); }
  const st = aiStatus();
  const missing = st.providers.filter((p) => !p.configured).map((p) => p.key_env);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const p: any[] = [];
  const w = [`review_status='confirmed'`];
  if (o.exam) { p.push(o.exam); w.push(`exam=$${p.length}`); }
  if (o.year) { p.push(o.year); w.push(`year=$${p.length}`); }
  if (o.ids?.length) { p.push(o.ids); w.push(`id = ANY($${p.length}::text[])`); }
  const qs: (QuestionRow & { existing: string | null })[] = (await db.query(
    `SELECT q.id, q.exam, q.year, q.number, q.type, q.section, q.score::float, q.stem, q.options, q.answer, q.sub_questions, q.solution, q.knowledge_points, q.review_status, q.review_checked_by,
            (SELECT status FROM ai_explanations e WHERE e.question_id=q.id ORDER BY version DESC LIMIT 1) existing
       FROM questions q WHERE ${w.join(' AND ')} ORDER BY exam, year, number ${o.limit ? `LIMIT ${o.limit}` : ''}`, p)).rows;
  const total = (await db.query(`SELECT count(*)::int n FROM questions WHERE ${w.slice(1).join(' AND ') || 'true'}`, p)).rows[0].n;
  console.log(`题目：${qs.length} 道 confirmed（筛选范围内共 ${total} 道）；有官方解析/参考证明 ${qs.filter((q) => officialSolution(q)).length} 道；无标准答案 ${qs.filter((q) => !officialAnswer(q)).length} 道`);
  if (missing.length) {
    console.log(`跳过：${missing.join('、')} 未配置（讲解需要 DeepSeek 生成 + 通义千问交叉验证两个 Key）。未写数据库。`);
    await db.end();
    return;
  }
  const todo = qs.filter((q) => o.force || !q.existing || !['published', 'needs_review'].includes(q.existing));
  console.log(`待生成 ${todo.length} 道（已有讲解跳过 ${qs.length - todo.length} 道${o.force ? '' : '，--force 可重做'}）${o.dry ? '　｜　dry-run，不写库' : ''}`);
  const rows: any[] = [];
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const q = todo[next++];
      const t0 = Date.now();
      try {
        const r = await explainQuestion(q);
        if (!o.dry) {
          await db.query(
            `INSERT INTO ai_explanations(question_id,version,model,steps,full_text,final_answer,verified,verify_detail,citations,status)
             VALUES($1,(SELECT COALESCE(max(version),0)+1 FROM ai_explanations WHERE question_id=$1),$2,$3,$4,$5,$6,$7,$8,$9)`,
            [q.id, r.model, JSON.stringify(r.steps), r.full_text, JSON.stringify(r.final_answer), r.verified, JSON.stringify(r.verify_detail), JSON.stringify(r.citations), r.status]);
        }
        rows.push({ id: q.id, number: q.number, status: r.status, steps: r.steps.length, ...r.final_answer, reasons: r.verify_detail.reasons.join('；'), base: officialSolution(q)?.label ?? '无（模型从头讲）', s: ((Date.now() - t0) / 1000).toFixed(1) });
        console.log(`${q.id}  ${r.status === 'published' ? '✓ verified' : '✗ needs_review'}  ${r.steps.length} 步  ${r.verify_detail.reasons.join('；')}`);
      } catch (e: any) {
        rows.push({ id: q.id, number: q.number, status: 'error', reasons: e.message });
        console.log(`${q.id}  ! error  ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  rows.sort((a, b) => a.number - b.number);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const summary = `published(verified) ${count('published')}，needs_review ${count('needs_review')}，error ${count('error')}`;
  console.log(`完成：${summary}`);
  const reportPath = path.resolve(o.report ?? `ai_explain_report_${o.exam ?? 'ids'}_${o.year ?? 'all'}.md`);
  const esc = (s: any) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  fs.writeFileSync(reportPath, [
    `# 讲解生成报告 ${o.exam ?? ''} ${o.year ?? ''}`, '',
    `生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'America/Los_Angeles' })}（太平洋时间）${o.dry ? '　｜　dry-run，未写库' : ''}`,
    `模型：${st.providers.map((p) => `${p.label} ${p.id === 'deepseek' ? p.models.reasoner : p.models.chat}`).join(' / ')}`, '',
    `结果：${summary}`, '',
    '| 题 | 状态 | 步数 | 题库答案 | 讲解模型 | 验证模型 | 底稿 | 说明 |', '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.number} | ${r.status} | ${r.steps ?? ''} | ${esc(r.official)} | ${esc(r.primary)} | ${esc(r.verifier)} | ${r.base ?? ''} | ${esc(r.reasons)} |`), '',
  ].join('\n'));
  console.log(`报告：${reportPath}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
