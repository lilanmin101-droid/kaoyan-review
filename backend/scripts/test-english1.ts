/**
 * 英语一端到端测试：npm run test:english1（scripts/test-english1.sh 建独立测试库 kaoyan_e1test、导入夹具 + 真实 2024、
 * 用 AI_FAKE=1 在 3100 端口起一个测试后端，再跑本脚本）。也可单独跑：BASE=http://127.0.0.1:3100/api/v1 node dist/scripts/test-english1.js
 */
import { gradeObjective } from '../src/common/grading';
import { normalizeSubtype, passageMarkers, validateEnglish1 } from '../src/english/english-spec';
import { bandForScore, disagrees, fakeGrade, normalizeGrade } from '../src/english/ai-grader';
import { tableMarkers, validateTables, withTablesText } from '../src/common/tables';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE || 'http://127.0.0.1:3100/api/v1';
let fails = 0, passes = 0;
function ok(cond: any, name: string, extra?: any) {
  if (cond) { passes++; console.log(`ok   ${name}`); } else { fails++; console.log(`FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); }
}
const FIX = path.resolve(__dirname, '../../test/fixtures');

function unit() {
  console.log('== unit');
  ok(gradeObjective('match', ['E'], ['e']) === true && gradeObjective('match', ['E'], ['F']) === false && gradeObjective('match', ['E'], []) === false, 'match 按一个字母判分');
  ok(gradeObjective('choice', ['D'], ['D']) === true, 'english choice 判分');
  const mk = passageMarkers('a {{1}} b {{2}} <u data-q="46">Hello world.</u>');
  ok(mk.blanks.map((b) => b.number).join() === '1,2' && mk.underlines[0].number === 46 && mk.underlines[0].text === 'Hello world.', 'passageMarkers 解析 {{n}} 和 <u data-q>');
  const good = JSON.parse(fs.readFileSync(path.join(FIX, 'english1_2099.json'), 'utf8'));
  const gp = JSON.parse(fs.readFileSync(path.join(FIX, 'english1_2099_passages.json'), 'utf8'));
  ok(validateEnglish1(2099, good, gp).filter((p) => p.severity === 'error').length === 0, '夹具 2099 结构校验 0 错误', validateEnglish1(2099, good, gp));
  const bad = JSON.parse(fs.readFileSync(path.join(FIX, 'english1_2098.json'), 'utf8'));
  const bp = JSON.parse(fs.readFileSync(path.join(FIX, 'english1_2098_passages.json'), 'utf8'));
  const types = new Set(validateEnglish1(2098, bad, bp).filter((p) => p.severity === 'error').map((p) => p.type));
  for (const t of ['en_score_invalid', 'en_total_invalid', 'en_options_invalid', 'en_answer_invalid', 'en_passage_unknown', 'en_passage_section', 'en_number_missing', 'en_count_invalid', 'en_passage_duplicate', 'en_marker_no_question', 'en_marker_missing'])
    ok(types.has(t), `坏夹具 2098 报出 ${t}`);
  // 阅读 B 各题型：选项个数按题型、七选五 / 小标题文章里的 {{41}}–{{45}} 合法
  const clone = (x: any) => JSON.parse(JSON.stringify(x));
  const errsOf = (qs: any[], ps: any[]) => validateEnglish1(2099, qs, ps).filter((p) => p.severity === 'error');
  ok(normalizeSubtype('heading_matching') === 'headings' && normalizeSubtype('Gap_Fill') === 'gap_fill' && normalizeSubtype(null) === null, 'subtype 别名：heading_matching → headings');
  { const q2 = clone(good), p2 = clone(gp); const pb = p2.find((p: any) => p.section === 'reading_b');
    pb.subtype = 'heading_matching'; pb.text = [41, 42, 43, 44, 45].map((n) => `{{${n}}}\nParagraph ${n} text.`).join('\n\n');
    const all = validateEnglish1(2099, q2, p2);
    ok(all.filter((p) => p.severity === 'error' || p.type === 'en_marker_wrong_section').length === 0, '小标题（heading_matching 别名）文章里 {{41}}–{{45}} 不报错', all); }
  { const q2 = clone(good), p2 = clone(gp); const pb = p2.find((p: any) => p.section === 'reading_b');
    pb.subtype = 'gap_fill'; pb.text = 'Intro. {{41}} Middle. {{42}} {{43}} {{44}} {{45}} End.';
    ok(errsOf(q2, p2).length === 0 && !validateEnglish1(2099, q2, p2).some((p) => p.type === 'en_marker_wrong_section'), '七选五文章里的 {{41}}–{{45}} 合法'); }
  { const q2 = clone(good), p2 = clone(gp); p2.find((p: any) => p.section === 'reading_b').subtype = 'ordering';
    for (const q of q2.filter((q: any) => q.section === 'reading_b')) q.options.push({ key: 'H', content: 'Eighth paragraph.' });
    q2[44].answer = ['H'];
    const all = validateEnglish1(2099, q2, p2);
    ok(errsOf(q2, p2).length === 0 && !all.some((p) => p.type === 'en_options_invalid'), '排序题 A–H 八个选项、答案 H 不报错', all); }
  { const q2 = clone(good), p2 = clone(gp); p2.find((p: any) => p.section === 'reading_b').subtype = 'matching';
    for (const q of q2.filter((q: any) => q.section === 'reading_b')) q.options.push({ key: 'H', content: 'x' });
    ok(validateEnglish1(2099, q2, p2).some((p) => p.type === 'en_options_invalid' && p.severity === 'warn'), '匹配题 8 个选项 → 警告'); }
  { const q2 = clone(good), p2 = clone(gp); const pb = p2.find((p: any) => p.section === 'reading_b'); pb.subtype = 'matching'; pb.text += ' {{41}}';
    ok(validateEnglish1(2099, q2, p2).some((p) => p.type === 'en_marker_wrong_section'), '匹配题文章里出现 {{41}} → 警告'); }
  for (let y = 2015; y <= 2025; y++) {
    const f = `/workspace/kaoyan/tiku/english1_${y}.json`;
    if (!fs.existsSync(f)) continue;
    const rq = JSON.parse(fs.readFileSync(f, 'utf8')), rp = JSON.parse(fs.readFileSync(f.replace('.json', '_passages.json'), 'utf8'));
    const all = validateEnglish1(y, rq, rp);
    ok(all.filter((p) => p.severity === 'error' || /en_options_invalid|en_marker_wrong_section/.test(p.type)).length === 0, `真实 english1_${y}：无结构错误、无选项/标记误报`, all.filter((p) => p.severity === 'error' || /en_options|en_marker_wrong/.test(p.type)));
  }
  const real = '/workspace/kaoyan/tiku/english1_2024.json';
  if (fs.existsSync(real)) {
    const rq = JSON.parse(fs.readFileSync(real, 'utf8')), rp = JSON.parse(fs.readFileSync(real.replace('.json', '_passages.json'), 'utf8'));
    const errs = validateEnglish1(2024, rq, rp).filter((p) => p.severity === 'error');
    ok(rq.length === 52 && rp.length === 7 && errs.length === 0, '真实 english1_2024：52 题 7 篇 0 结构错误', errs);
  }
  // 表格
  { const T = [{ header: ['A', 'B'], rows: [['1', '2']] }];
    ok(validateTables(T, [['stem', 'x {{table:0}} y']]).length === 0 && validateTables(undefined, [['stem', 'plain']]).length === 0, '表格：合法 / 没有表格都 0 问题');
    const bad = validateTables([{ header: ['a', 'b'], rows: [['1', '2', '3']] }, { rows: [] }, { header: [], rows: [[1]] }], [['stem', '{{table:0}} {{table:5}}']]);
    const d = bad.map((p) => p.detail).join(' / ');
    ok(bad.every((p) => p.type === 'table_invalid') && /3 格，表头有 2 列/.test(d) && /rows 为空/.test(d) && /\{\{table:5\}\} 没有对应/.test(d) && /tables\[1\]）没有在正文里/.test(d) && /tables\[2\]）没有在正文里/.test(d) && /表格 3 的 header/.test(d) && /不是字符串/.test(d), '表格：列数不对 / 空行 / 多余标记 / 未引用 / 非字符串都报 table_invalid', bad);
    ok(validateTables({}, []).some((p) => p.severity === 'error'), 'tables 不是数组 → 错误');
    ok(passageMarkers('a {{1}} {{table:0}} b').blanks.length === 1 && tableMarkers('a {{1}} {{table:2}}').map((m) => m.n).join() === '2', '{{table:N}} 不算完形空位');
    const md = withTablesText('Look:\n{{table:0}}\nDone', [{ caption: 'Cap', header: ['A', 'B'], rows: [['1', 'x|y']], note: 'N' }]);
    ok(md.includes('表：Cap') && md.includes('| A | B |') && md.includes('| 1 | x\\|y |') && md.includes('注：N') && !md.includes('{{table'), '给模型的题干：表格转 Markdown', md); }
  { const f = '/workspace/kaoyan/tiku/english1_2025.json';
    if (fs.existsSync(f)) { const q52 = JSON.parse(fs.readFileSync(f, 'utf8')).find((q: any) => q.number === 52);
      if (q52?.tables) ok(validateTables(q52.tables, [['stem', q52.stem]]).length === 0 && withTablesText(q52.stem, q52.tables).includes('| 2014 |'), '真实 english1_2025 第 52 题表格合法（{{table:0}}）', validateTables(q52.tables, [['stem', q52.stem]])); } }
  // 档位/分数
  ok(bandForScore('writing_b', 17) === 5 && bandForScore('writing_b', 16) === 4 && bandForScore('writing_b', 4) === 1 && bandForScore('writing_a', 7) === 4 && bandForScore('writing_a', 0) === 0, '五档分数范围');
  const n = normalizeGrade({ band: '第五档', score: 14.3, errors: [{ span: 'x', type: 'Spelling', fix: 'y' }] }, 'writing_b', 'm');
  ok(n.score === 14.5 && n.band === 4 && n.errors[0].type === 'spelling', 'normalizeGrade：0.5 步长、档位跟分数走、错误类型规范化', n);
  ok(normalizeGrade({ score: 3 }, 'translation', 'm').score === 2, '翻译分数夹到 2');
  let threw = false; try { normalizeGrade({ score: 'abc' }, 'translation', 'm'); } catch { threw = true; }
  ok(threw, '不合格输出被 schema 拒绝');
  const q = { stem: 'x', answer: ['如今许多人在家办公，这为他们节省了时间。'] };
  const a1 = fakeGrade('translation', q, '如今很多人在家办公，这为他们节省了时间。'), a2 = fakeGrade('translation', q, '如今很多人在家办公，这为他们节省了时间。');
  ok(JSON.stringify(a1) === JSON.stringify(a2) && a1.score === 2, '假模型确定性 + 正确译文满分', a1);
  ok(fakeGrade('translation', q, '').score === 0, '空译文 0 分');
  ok(disagrees('writing_b', { band: 4 } as any, { band: 2, score: 8 }) && !disagrees('writing_b', { band: 4 } as any, { band: 3, score: 12 }), '相差 > 1 档才算不一致');
}

async function http() {
  console.log(`== http ${BASE}`);
  const U = `e1_${Date.now()}`;
  await fetch(`${BASE}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: U, password: 'secret123' }) });
  const tok = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: U, password: 'secret123' }) })).json() as any).access_token;
  const H = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  const get = async (p: string) => { const r = await fetch(`${BASE}${p}`, { headers: H }); return { status: r.status, body: await r.json().catch(() => null) as any }; };
  const post = async (p: string, b: any = {}, method = 'POST') => { const r = await fetch(`${BASE}${p}`, { method, headers: H, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) as any }; };

  // 题目按文章分组（夹具 2099，已 confirmed）
  const l = await get('/questions?exam=english1&year=2099');
  ok(l.status === 200 && l.body.total === 52 && l.body.items.length === 52 && l.body.page_size === 100, '英语整卷一次拿全 52 题', l.body?.total);
  const g = l.body.groups ?? [];
  ok(g.length === 9 && g[0].passage?.id === 'english1-2099-P-cloze' && g[0].questions.length === 20 && g[0].passage.blanks.length === 20 && g[0].passage.blanks[0].question_id === 'english1-2099-01', 'groups：完形一组 20 题 + blanks 元数据', g.map((x: any) => [x.passage_id, x.questions.length]));
  const tr = g.find((x: any) => x.section === 'translation');
  ok(tr?.questions.length === 5 && tr.passage.underlines.length === 5 && tr.passage.underlines[0].question_id === 'english1-2099-46', '翻译一组 5 题 + underlines 元数据');
  const sec = await get('/questions?exam=english1&year=2099&section=reading_a');
  ok(sec.body.groups?.length === 4 && sec.body.groups.every((x: any) => x.questions.length === 5), '按 section 过滤：阅读 A 4 篇各 5 题');
  const one = await get('/questions/english1-2099-21');
  ok(one.body.passage_id === 'english1-2099-P-text1' && one.body.passage?.text && one.body.passage.question_ids.length === 5, 'GET /questions/{id} 带 passage');
  const ps = await get('/passages/english1-2099-P-partb');
  ok(ps.status === 200 && ps.body.section === 'reading_b' && ps.body.question_numbers.join() === '41,42,43,44,45', 'GET /passages/{id}');
  // 表格原样返回
  const canon = (x: any): any => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x;
  const same = (a: any, b: any) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const fx = JSON.parse(fs.readFileSync(path.join(FIX, 'english1_2099.json'), 'utf8'));
  const t52 = await get('/questions/english1-2099-52');
  ok(same(t52.body.tables, fx[51].tables) && t52.body.stem.includes('{{table:0}}'), 'GET /questions/{id} 原样返回 tables', t52.body?.tables);
  ok(same(l.body.items.find((q: any) => q.number === 52)?.tables, fx[51].tables) && Array.isArray(l.body.items[0].tables) && l.body.items[0].tables.length === 0, 'GET /questions 列表带 tables（没有为 []）');
  const pc = await get('/passages/english1-2099-P-cloze');
  ok(pc.body.tables?.length === 1 && pc.body.blanks.length === 20, '文章带 tables，{{table:0}} 不算空位（仍 20 个 blank）', [pc.body.tables, pc.body.blanks?.length]);
  const mt = await get('/questions/math1-2099-01?include_unreviewed=1');
  ok(mt.body.tables?.[0]?.header?.length === 4, '数学题表格原样返回', mt.body?.tables);
  const b51 = await get('/questions/english1-2098-51?include_unreviewed=1');
  const tp = (b51.body?.import_problems ?? []).filter((p: any) => p.type === 'table_invalid');
  ok(tp.length >= 4 && tp.some((p: any) => p.severity === 'error'), '坏夹具 2098 第 51 题入库带 table_invalid', b51.body?.import_problems);
  const rep98 = fs.existsSync('/tmp/e1test-reports/import_report_english1_2098.md') ? fs.readFileSync('/tmp/e1test-reports/import_report_english1_2098.md', 'utf8') : '';
  ok(rep98.includes('table_invalid') && rep98.includes('{{table:3}}'), '导入报告列出 table_invalid');
  const mp = (mt.body?.import_problems ?? []).map((p: any) => p.type);
  ok(!mp.some((t: string) => /ocr|latex|table/.test(t)), '数学表格题没有 OCR / LaTeX / 表格误报', mp);
  // 整题计分：kp_tags 的 sub_scores 被忽略 + 报告提醒；按小问计分的照常套用
  const w2 = (await get('/questions/math1-2099-02?include_unreviewed=1')).body, w3 = (await get('/questions/math1-2099-03?include_unreviewed=1')).body;
  ok(w2?.score_by_whole === true && w2.sub_questions.every((x: any) => x.score === null) && (w2.import_problems ?? []).some((p: any) => p.type === 'sub_scores_on_whole_scored' && p.severity === 'warn'), '整题计分的题忽略 sub_scores，入库带 sub_scores_on_whole_scored 提醒', w2);
  ok(w3?.score_by_whole === false && w3.sub_questions.map((x: any) => x.score).join() === '5,7' && !(w3.import_problems ?? []).some((p: any) => p.type === 'sub_scores_on_whole_scored'), '按小问计分的题套用 sub_scores（5+7）', w3);
  const repM = fs.existsSync('/tmp/e1test-reports/import_report_math1_2099.md') ? fs.readFileSync('/tmp/e1test-reports/import_report_math1_2099.md', 'utf8') : '';
  ok(repM.includes('sub_scores_on_whole_scored') && repM.includes('math1-2099-02'), '导入报告列出 sub_scores_on_whole_scored');
  const pl = await get('/passages?exam=english1&year=2024');
  ok(pl.body.items?.length === 7 && pl.body.items.find((p: any) => p.section === 'reading_b')?.options?.length === 7, 'GET /passages?exam&year：2024 7 篇，Part B 带 A–G 选项', pl.body.items?.length);
  const real = await get('/questions?exam=english1&year=2024&include_unreviewed=1');
  ok(real.body.total === 52 && real.body.items.reduce((s: number, q: any) => s + q.score, 0) === 100 && real.body.items.filter((q: any) => q.passage_id).length === 50, '真实 2024：52 题、100 分、50 题挂文章');
  const cl = real.body.groups.find((x: any) => x.section === 'use_of_english');
  ok(cl?.passage.blanks.length === 20 && cl.passage.blanks.every((b: any) => b.question_id), '真实 2024 完形 20 个空位都对上题目');

  // 模考：真实 2024（未全部核对 → 422；include_unreviewed 可以开）
  // 真实 2024 核对完以后会直接 201：放弃这场，改用一直是 pending 的坏夹具 2098 测 422
  let r422 = await post('/exams', { exam: 'english1', year: 2024 });
  if (r422.status === 201) { await post(`/exams/${r422.body.id}/abandon`, {}); r422 = await post('/exams', { exam: 'english1', year: 2098 }); }
  ok(r422.status === 422 && r422.body.code === 'paper_incomplete', '未核对完的卷子 422 paper_incomplete', r422.status);
  const ex = await post('/exams', { exam: 'english1', year: 2024, include_unreviewed: true });
  ok(ex.status === 201 && ex.body.question_ids?.length === 52 && ex.body.duration_seconds === 180 * 60, '英语一模考：52 题、180 分钟', [ex.status, ex.body?.question_ids?.length, ex.body?.duration_seconds]);
  const qs = real.body.items as any[];
  const ans = (await Promise.all(qs.map((q) => get(`/questions/${q.id}?include_answer=true`)))).map((r) => r.body);
  // 41–45 题：41、42 答对，43 答错，44 留空，45 小写也算对；1–40 全对
  const answers = ans.filter((q) => q.number <= 45).map((q) => {
    let a = q.answer;
    if (q.number === 43) a = [q.answer[0] === 'A' ? 'B' : 'A'];
    if (q.number === 44) a = [];
    if (q.number === 45) a = [String(q.answer[0]).toLowerCase()];
    return { question_id: q.id, answer: a };
  });
  answers.push({ question_id: 'english1-2024-46', answer: ['它们有时会走六十多英里找食物和水。'] });
  const pr = await post(`/exams/${ex.body.id}/progress`, { idempotency_key: 'p1', client_seq: 1, answers }, 'PUT');
  ok(pr.status === 200, '保存模考进度', pr.body);
  const sub = await post(`/exams/${ex.body.id}/submit`, { idempotency_key: 'e1' });
  const res = sub.body?.result;
  const per = (res?.per_question ?? []) as any[];
  const pb = per.filter((p) => p.number >= 41 && p.number <= 45);
  ok(pb.length === 5 && pb.every((p) => p.objective) && pb.map((p) => p.is_correct).join() === 'true,true,false,false,true', '41–45 题客观判分（match）', pb.map((p) => [p.number, p.objective, p.is_correct, p.got]));
  ok(res?.max_score === 100, '模考满分 100', res?.max_score);
  const sk = (res?.sections ?? []).map((s: any) => s.section).join();
  ok(sk === 'use_of_english,reading_a,reading_b,translation,writing_a,writing_b', '分部分小计六个部分', res?.sections);
  const rb = res.sections.find((s: any) => s.section === 'reading_b');
  ok(rb.score === 6 && rb.max_score === 10 && rb.name.includes('阅读理解 B'), '阅读 B 小计 6/10', rb);
  ok(res.sections.find((s: any) => s.section === 'reading_a').score === 40 && res.sections.find((s: any) => s.section === 'use_of_english').score === 10, '完形 10/10、阅读 A 40/40');
  ok((res.subjects ?? []).length === 6 && res.subjects[0].subject === 'use_of_english', '「分科」= 六个部分', res.subjects);
  // 第 12 轮 A：翻译 / 作文没作答的直接 0 分（unanswered），不再待自评；只有作答了的第 46 题待自评
  ok(JSON.stringify(res.pending_self_rating) === '["english1-2024-46"]', '翻译 / 作文只有作答的第 46 题待自评', res.pending_self_rating);
  const un = per.filter((p) => p.number >= 47 && p.number <= 52);
  ok(un.length === 6 && un.every((p) => p.unanswered === true && p.got === 0 && p.self_rating === 'no_idea'), '没作答的 47–52 题：unanswered、0 分', un.map((p) => [p.number, p.unanswered, p.got, p.self_rating]));

  // AI 批改（AI_FAKE=1）
  const a1 = await post('/answers', { question_id: 'english1-2099-46', answer: ['如今很多人在家办公，这为他们节省了时间。'] });
  ok(a1.status === 201 && a1.body.is_correct === null, 'POST /answers 存翻译文本（is_correct=null）', a1.body);
  const g0 = await get(`/answers/${a1.body.id}/grade`);
  ok(g0.body.status === 'not_requested', 'GET grade：还没批', g0.body);
  const g1 = await post(`/answers/${a1.body.id}/grade`);
  ok(g1.body.status === 'done' && g1.body.score === 2 && g1.body.max_score === 2 && g1.body.result.model === 'fake-grader-v1' && g1.body.cross_check?.model === 'fake-qwen-v1' && g1.body.disagreement === false, '翻译批改 2/2，双模型一致', g1.body);
  ok(g1.body.counted === true && g1.body.wrong_question_id === null, '得分 ≥60%：不进错题本');
  const g1b = await post(`/answers/${a1.body.id}/grade`);
  ok(g1b.body.id === g1.body.id && g1b.body.attempts === 1, '重复 POST grade 幂等（直接返回已有结果）', g1b.body);
  const a2 = await post('/answers', { question_id: 'english1-2099-47', answer: ['我不知道'] });
  const g2 = await post(`/answers/${a2.body.id}/grade`);
  ok(g2.body.status === 'done' && g2.body.score < 1.2 && g2.body.wrong_question_id, '翻译低分（<60%）进错题本', g2.body);
  const wq = await get('/wrong-questions?status=active');
  ok((wq.body.items ?? []).some((w: any) => w.question_id === 'english1-2099-47'), '错题本里有第 47 题', wq.body?.items?.map((w: any) => w.question_id));
  const essay = 'Dear Tom,\n\nI am writing to invite you to a city walk this Saturday. ' + 'We will walk along the river, visit the old market and taste local food together. '.repeat(6) + 'I beleive you will enjoy it.\n\nYours,\nLi Ming';
  const a3 = await post('/answers', { question_id: 'english1-2099-51', answer: [essay] });
  const g3 = await post(`/answers/${a3.body.id}/grade`);
  const r3 = g3.body.result;
  ok(g3.body.status === 'done' && g3.body.max_score === 10 && r3.band >= 0 && r3.band <= 5 && Array.isArray(r3.points_hit) && r3.errors.some((e: any) => e.type === 'spelling' && e.span === 'beleive'), '小作文批改：档位 + 拼写错误', g3.body);
  // SSE
  const a4 = await post('/answers', { question_id: 'english1-2099-52', answer: ['Short essay about a garden.'] });
  const sse = await (await fetch(`${BASE}/answers/${a4.body.id}/grade/stream`, { method: 'POST', headers: H, body: '{}' })).text();
  const evs = [...sse.matchAll(/^event: (\w+)/gm)].map((m) => m[1]);
  ok(evs.join() === 'meta,progress,progress,result,done', 'SSE 事件顺序 meta→progress→progress→result→done', evs);
  const done = JSON.parse(/event: done\ndata: (.*)/.exec(sse)![1]);
  ok(done.status === 'done' && done.max_score === 20 && done.band <= 2, '大作文字数太少：低档', done);
  const lat = await get('/answers?question_ids=english1-2099-52');
  ok(lat.body.items[0].grading_status === 'done' && lat.body.items[0].grading_max_score === 20, 'GET /answers 带 grading_*', lat.body.items[0]);
  const bad = await post(`/answers/${(await post('/answers', { question_id: 'english1-2099-01', answer: ['A'] })).body.id}/grade`);
  ok(bad.status === 400 && bad.body.code === 'not_gradable', '客观题不能 AI 批改：400 not_gradable', bad.body);
  const m = await get('/mastery/tree');
  ok(JSON.stringify(m.body).includes('英语/翻译'), '掌握度里有 英语/翻译', undefined);
}

/** PHASE=pending：没有 Key、没开 AI_FAKE → 只能 pending「批改生成中」，绝不出分；PHASE=disagree：AI_FAKE_DISAGREE=1 → 双模型差 2 档要标 disagreement */
async function phase(kind: string) {
  console.log(`== phase ${kind} ${BASE}`);
  const U = `e1${kind}_${Date.now()}`;
  await fetch(`${BASE}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: U, password: 'secret123' }) });
  const tok = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: U, password: 'secret123' }) })).json() as any).access_token;
  const H = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  const post = async (p: string, b: any = {}) => { const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) as any }; };
  const essay = 'The table describes how people spend weekends: gardening rose from 12 to 31 percent while shopping fell, and its meaning deserves comments. '.repeat(10);
  const a = await post('/answers', { question_id: 'english1-2099-52', answer: [essay] });
  const g = await post(`/answers/${a.body.id}/grade`);
  if (kind === 'pending') {
    ok(g.body.status === 'pending' && g.body.text === '批改生成中' && g.body.score === null && g.body.result === null && g.body.band === null, '没 Key：pending「批改生成中」，不给分', g.body);
    const sse = await (await fetch(`${BASE}/answers/${a.body.id}/grade/stream`, { method: 'POST', headers: H, body: '{}' })).text();
    ok(/event: done\ndata: .*"status":"pending".*批改生成中/.test(sse) && !/event: result/.test(sse), 'SSE 没 Key：done pending，无 result', sse);
  } else {
    ok(g.body.status === 'done' && g.body.disagreement === true && g.body.needs_review === true && Math.abs(g.body.band - g.body.cross_check.band) === 2, '双模型差 2 档 → disagreement', g.body);
  }
}

(async () => {
  unit();
  if (process.env.PHASE) await phase(process.env.PHASE);
  else if (process.env.SKIP_HTTP !== '1') await http();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
