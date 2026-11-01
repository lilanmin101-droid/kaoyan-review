import { esc, explanationBlock, katexCss, renderMath, renderStem } from '../wrong-questions/pdf';

const RATING_CN: Record<string, string> = { full: '全对', approach_ok_calc_wrong: '思路对、算错', no_idea: '没思路' };
const pct = (x: number | null | undefined) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const mmss = (s: number) => `${Math.floor((s || 0) / 60)} 分 ${String((s || 0) % 60).padStart(2, '0')} 秒`;

function status(p: any) {
  if (p.is_correct === true) return '<span class="ok">✓</span>';
  if (p.is_correct === null) return '<span class="pend">待自评</span>';
  return '<span class="bad">✗</span>';
}

function ratingText(p: any) {
  if (p.objective) return p.answered ? esc((p.answer || []).join('、')) : '未作答';
  if (p.sub_scores?.length) return p.sub_scores.map((s: any) => `(${s.sub_number}) ${s.self_rating ? RATING_CN[s.self_rating] : '待自评'}`).join('；');
  return p.self_rating ? RATING_CN[p.self_rating] : '待自评';
}

/** 模考成绩报告：总分、分题型、分科、丢分知识点、每题明细、错题（题干 + 答案 + 讲解） */
export function examReportHtml(view: any, wrong: any[], opts: { today: string }) {
  const r = view.result;
  const per: any[] = r.per_question ?? [];
  const head = `
    <h1>${esc(view.title)} · 模考成绩报告</h1>
    <div class="sub">开考 ${esc(view.started_date)}（${esc(view.timezone)}）· 用时 ${Math.round((r.elapsed_seconds || 0) / 60)} / ${Math.round(view.duration_seconds / 60)} 分钟 · 导出于 ${esc(opts.today)}</div>
    <div class="total"><b>${r.score}</b> / ${r.max_score} 分 <span class="rate">得分率 ${pct(r.score_rate)}</span>${r.pending_points ? `<span class="pend">（还有 ${r.pending_points} 分待自评）</span>` : ''}</div>
    ${r.coach?.headline ? `<div class="coach">教练：${esc(r.coach.headline)}</div>` : ''}
    <div class="grid">
      <table><caption>分题型</caption><tr><th>题型</th><th>得分</th><th>对/错/待评</th></tr>
        ${(r.sections || []).map((s: any) => `<tr><td>${s.section}</td><td>${s.score} / ${s.max_score}</td><td>${s.correct} / ${s.wrong} / ${s.pending}</td></tr>`).join('')}</table>
      <table><caption>分科</caption><tr><th>科目</th><th>得分</th><th>得分率</th></tr>
        ${(r.subjects || []).map((s: any) => `<tr><td>${s.name}</td><td>${s.score} / ${s.max_score}</td><td>${pct(s.rate)}</td></tr>`).join('')}</table>
    </div>
    ${(r.lost_by_kp || []).length ? `<table class="kp"><caption>丢分知识点</caption><tr><th>知识点</th><th>丢分</th><th>题号</th></tr>
      ${r.lost_by_kp.slice(0, 12).map((k: any) => `<tr><td>${esc(k.kp_path)}</td><td>${k.lost}</td><td>${k.question_numbers.join('、')}</td></tr>`).join('')}</table>` : ''}
    <ul class="concl">${(r.conclusions || []).map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>`;
  const table = `
    <h2>每题明细</h2>
    <table class="per"><tr><th>题号</th><th>题型</th><th>分值</th><th>得分</th><th>结果</th><th>作答 / 自评</th><th>用时</th></tr>
      ${per.map((p) => `<tr><td>${p.number}</td><td>${p.section}</td><td>${p.score}${p.score_by_whole ? '（整题）' : ''}</td><td>${p.got ?? '-'}</td><td>${status(p)}</td><td>${ratingText(p)}</td><td>${p.time_spent_seconds ? mmss(p.time_spent_seconds) : '-'}</td></tr>`).join('')}
    </table>`;
  const wrongHtml = wrong.length ? `<h2 class="pb">错题（${wrong.length} 道，已加入错题本）</h2>` + wrong.map((q) => {
    const p = per.find((x) => x.question_id === q.id) ?? {};
    return `<section class="q">
      <div class="meta">第 ${q.number} 题 · ${q.score ?? ''} 分 · 得 ${p.got ?? 0} 分 · 你的作答：${ratingText(p)}</div>
      <div class="stem">${renderStem(q)}</div>
      ${(q.options || []).length ? `<ol class="opts">${q.options.map((o: any) => `<li><b>${o.key}.</b> ${renderMath(o.content, q.assets_dir)}</li>`).join('')}</ol>` : ''}
      <div class="ans">答案：${(q.answer || []).map((a: string) => renderMath(a)).join('；')}</div>
      ${explanationBlock(q)}
    </section>`;
  }).join('') : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${katexCss()}
    body{font-family:"Noto Serif CJK SC","Source Han Serif SC",serif;color:#1a1a1a;font-size:10.5pt;line-height:1.6;margin:0}
    h1{font-size:15pt;font-weight:600;border-bottom:1px solid #222;padding-bottom:6px;margin:0 0 4px}h2{font-size:12pt;margin:16px 0 6px}
    .sub{font-size:9pt;color:#666}.total{font-size:12pt;margin:10px 0 4px}.total b{font-size:22pt;color:#b22222}.rate{margin-left:10px;color:#444}.pend{color:#b8860b}
    .coach{color:#b22222;margin:4px 0 8px}.grid{display:flex;gap:16px}.grid table{flex:1}
    table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:6px 0}caption{text-align:left;font-weight:600;padding:2px 0}
    th,td{border:0.5px solid #999;padding:3px 6px;text-align:left}th{background:#f2f2f2}.ok{color:#2e7d32}.bad{color:#b22222}
    .concl{font-size:9.5pt;margin:6px 0;padding-left:18px}.pb{break-before:page}
    .q{border-bottom:0.5px solid #999;padding:10px 0 14px;break-inside:avoid}.meta{font-size:9pt;color:#666;margin-bottom:4px}
    .opts{list-style:none;padding:0;margin:6px 0 0}.ans{color:#b22222;margin-top:6px}.expert{margin-top:6px;font-size:10pt}
    .expert-label{font-size:9pt;color:#666;border-left:2px solid #999;padding-left:6px}.expert ol{margin:4px 0 0;padding-left:20px}
  </style></head><body>${head}${table}${wrongHtml}</body></html>`;
}
