// 监听 tiku/ 下的题库、标签、reviews、讲解、vocab/ 真题词汇文件，变化后防抖 5 秒自动 import:all
// 结果写进 import_reports/watch.log；最近一次在 import_reports/watch_last.md：开头是按科目/年份的汇总表（题数、文章数、confirmed/pending/suspect、导入问题、✅/❌），后面是完整日志
// 每个文件的详细报告：import_reports/import_report_<exam>_<year>.md
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const TIKU = process.env.TIKU_DIR || require('path').resolve(__dirname, '../../tiku');
const OUT = path.join(__dirname, '..', 'import_reports'); fs.mkdirSync(OUT, { recursive: true });
const relevant = (f) => f && /\.(json|jsonl)$/.test(f) && !/\.bak|question_schema|knowledge_tree/.test(f);
let timer = null, running = false, again = false, changed = new Set();
const ts = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' }) + ' PT';
function run() {
  if (running) { again = true; return; }
  running = true; const files = [...changed]; changed.clear();
  const p = spawn('npm', ['run', 'import:all'], { cwd: path.join(__dirname, '..') }); let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => {
    let cur = ''; const warn = []; for (const l of out.split('\n')) { const m = /^(\S+\.json):/.exec(l); if (m) cur = m[1]; if ((/⚠️|latex_error|Error|错误|坏行/.test(l) || /bad_lines: [1-9]/.test(l)) && !warn.includes((cur ? cur + '：' : '') + l.trim().replace(/,$/, ''))) warn.push((cur ? cur + '：' : '') + l.trim().replace(/,$/, '')); }
    const summary = `## ${ts()} 自动导入 ${code === 0 ? '成功' : '失败 (exit ' + code + ')'}\n- 触发文件：${files.join('、')}\n${warn.length ? warn.map((l) => '- ' + l.trim()).join('\n') : '- 没有警告'}\n`;
    fs.appendFileSync(path.join(OUT, 'watch.log'), summary + '\n');
    const finish = (table) => {
      fs.writeFileSync(path.join(OUT, 'watch_last.md'), summary + '\n' + table + '\n## 完整日志\n\n```\n' + out + '\n```\n');
      console.log(summary); running = false; if (again) { again = false; run(); }
    };
    // 真题词汇（import:vocab）几行摘要接在表后面
    const vi = out.split('\n').findIndex((l) => l.startsWith('import:vocab'));
    const vocab = vi < 0 ? '' : `\n## 真题词汇（import:vocab，详见 [import_report_vocab.md](import_report_vocab.md)）\n\n${out.split('\n').slice(vi, vi + 6).filter((l, i) => i === 0 || /^\s/.test(l)).map((l) => '- ' + l.trim()).join('\n')}\n`;
    summaryTable(out).then((t) => finish(t + vocab), (e) => finish(`（汇总表生成失败：${e?.message ?? e}）\n` + vocab));
  });
}

// ───────────── 汇总表：解析 import:all 输出（每个文件的问题数 / 失败）+ 查库（入库后的题数、文章数、校对状态） ─────────────
function parseRun(out) {
  const files = new Map(); let cur = null;
  const num = (o) => { let n = 0; for (const m of String(o).matchAll(/:\s*(\d+)/g)) n += Number(m[1]); return n; };
  for (const l of out.split('\n')) {
    let m = /^(\w+?)_(\d{4})\.json: (\d+) questions/.exec(l);
    if (m) { cur = { exam: m[1], year: Number(m[2]), file_questions: Number(m[3]), problems: 0, problem_keys: [], structure_errors: 0, bad_lines: 0, failed: null }; files.set(`${m[1]}_${m[2]}`, cur); continue; }
    m = /^❌ (\w+?)_(\d{4})\.json: (.*)$/.exec(l);
    if (m) { files.set(`${m[1]}_${m[2]}`, { exam: m[1], year: Number(m[2]), problems: 0, problem_keys: [], structure_errors: 0, bad_lines: 0, failed: m[3].slice(0, 160) }); cur = null; continue; }
    if (!cur) continue;
    m = /^\s+problem counts: (\{.*\})/.exec(l);
    if (m) { cur.problems = num(m[1]); cur.problem_keys = [...m[1].matchAll(/(\w+):\s*\d+/g)].map((x) => x[1]); }
    m = /^\s*structure_errors: (\d+)/.exec(l); if (m) cur.structure_errors = Number(m[1]);
    m = /^\s*bad_lines: (\d+)/.exec(l); if (m) cur.bad_lines = Number(m[1]);
    if (/^done: /.test(l)) cur = null;
  }
  return files;
}
function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try { const m = /^\s*DATABASE_URL\s*=\s*(.*)$/m.exec(fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')); return m && m[1].trim(); } catch { return null; }
}
/** 详细报告里「有错误级问题的 N 道」（problem counts 里也有只是提示的，比如 review_suspect、sub_question_score_missing，不算 ❌） */
function errorLevel(k) {
  try { const m = /[，,]\s*有错误级问题的 (\d+) 道/.exec(fs.readFileSync(path.join(OUT, `import_report_${k}.md`), 'utf8')); return m ? Number(m[1]) : 0; } catch { return 0; }
}
async function summaryTable(out) {
  const files = parseRun(out);
  const db = new Map();
  const url = dbUrl();
  if (url) {
    const { Client } = require('pg'); const c = new Client({ connectionString: url });
    try {
      await c.connect();
      const q = await c.query(`SELECT exam, year, count(*)::int n,
          count(*) FILTER (WHERE review_status='confirmed')::int confirmed, count(*) FILTER (WHERE review_status='pending')::int pending,
          count(*) FILTER (WHERE review_status='suspect')::int suspect
        FROM questions GROUP BY 1,2`);
      for (const r of q.rows) db.set(`${r.exam}_${r.year}`, { ...r });
      const p = await c.query(`SELECT exam, year, count(*)::int n FROM passages GROUP BY 1,2`).catch(() => ({ rows: [] }));
      for (const r of p.rows) { const k = `${r.exam}_${r.year}`; db.set(k, { ...(db.get(k) ?? { exam: r.exam, year: r.year, n: 0, confirmed: 0, pending: 0, suspect: 0 }), passages: r.n }); }
    } finally { await c.end().catch(() => {}); }
  }
  const keys = [...new Set([...files.keys(), ...db.keys()])].sort((a, b) => { const [ea, ya] = a.split(/_(?=\d{4}$)/), [eb, yb] = b.split(/_(?=\d{4}$)/); return ea.localeCompare(eb) || Number(ya) - Number(yb); });
  const rows = keys.map((k) => {
    const f = files.get(k), d = db.get(k) ?? {};
    const [exam, year] = k.split(/_(?=\d{4}$)/);
    const errs = f ? errorLevel(k) + f.structure_errors + f.bad_lines : 0;
    const ok = f && !f.failed && errs === 0;
    const probText = !f ? '本次没导入（库里已有）' : f.failed ? `导入失败：${f.failed}` : f.problems + f.structure_errors + f.bad_lines === 0 ? '0' :
      [errorLevel(k) ? `错误级 ${errorLevel(k)} 道题` : '', f.structure_errors ? `结构错误 ${f.structure_errors}` : '', f.bad_lines ? `校对坏行 ${f.bad_lines}` : '',
        f.problems ? `提示 ${f.problems} 条（${f.problem_keys.join('、')}）` : ''].filter(Boolean).join('；');
    const n = d.n ?? 0;
    const full = n > 0 && d.confirmed === n ? '是' : '否';
    return `| ${exam} | ${year} | ${n} | ${exam.startsWith('english') ? (d.passages ?? 0) : '—'} | ${d.confirmed ?? 0} | ${d.pending ?? 0} | ${d.suspect ?? 0} | ${full} | ${probText.replace(/\|/g, '/')} | [报告](import_report_${k}.md) | ${!f ? '—' : ok ? '✅' : '❌'} |`;
  });
  const bad = keys.filter((k) => { const f = files.get(k); return f && (f.failed || errorLevel(k) + f.structure_errors + f.bad_lines > 0); });
  return `## 按科目 / 年份汇总（入库后）\n\n${bad.length ? `❌ 有错误：${bad.join('、')}` : '✅ 本次导入的文件都没有错误级问题'}。题数和校对状态取自数据库（叠加 reviews 之后）；❌ = 导入失败 / 有错误级问题 / 文章结构错误 / 校对坏行，「提示」不影响导入。\n\n` +
    '| 科目 | 年份 | 题数 | 文章 | confirmed | pending | suspect | 全部 confirmed（可开整卷） | 导入问题 | 详细报告 | 状态 |\n|---|---|---|---|---|---|---|---|---|---|---|\n' + rows.join('\n') + '\n';
}
for (const d of [TIKU, path.join(TIKU, 'reviews'), path.join(TIKU, 'explanations'), path.join(TIKU, 'vocab')]) {
  if (!fs.existsSync(d)) continue;
  fs.watch(d, (ev, f) => { if (!relevant(f)) return; changed.add(path.relative(TIKU, path.join(d, f))); clearTimeout(timer); timer = setTimeout(run, 5000); });
}
console.log(`${ts()} watching ${TIKU}`);
if (process.argv.includes('--once')) { changed.add('（手动 --once）'); run(); }
