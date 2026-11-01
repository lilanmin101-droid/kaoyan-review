#!/usr/bin/env node
/*
 * Mock 服务：读取 ../openapi.yaml，按每个接口的 example 返回数据。
 * - 端口：MOCK_PORT（默认 4010），前缀 /api/v1
 * - 不校验 token（带不带都行），方便前端先联调
 * - SSE 接口（/agent/commands、/questions/{id}/explain，讲解 POST/GET 都有；有行业专家讲解的题给 expert，其余 pending）按 example 逐条推送，每条间隔 MOCK_SSE_DELAY ms（默认 400）
 * - 可以用 ?__example=<名字> 选 examples 里的某一个；?__status=409 返回该状态码的 example
 * 启动：npm run mock
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const yaml = require('js-yaml');

const PORT = Number(process.env.MOCK_PORT || 4010);
const DELAY = Number(process.env.MOCK_SSE_DELAY || 400);
const SPEC_PATH = path.join(__dirname, '..', 'openapi.yaml');
const PREFIX = '/api/v1';

let spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));

function resolveRef(ref) {
  const parts = ref.replace(/^#\//, '').split('/');
  let cur = spec;
  for (const p of parts) cur = cur?.[p.replace(/~1/g, '/').replace(/~0/g, '~')];
  return cur;
}
// 把 example 里的 $ref 展开（example 之间互相引用）
function deref(v, depth = 0) {
  if (depth > 20) return v;
  if (Array.isArray(v)) return v.map((x) => deref(x, depth + 1));
  if (v && typeof v === 'object') {
    if (typeof v.$ref === 'string' && Object.keys(v).length === 1) return deref(resolveRef(v.$ref), depth + 1);
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = deref(x, depth + 1);
    return out;
  }
  return v;
}

function pickResponse(op, wantStatus) {
  const responses = op.responses || {};
  const codes = Object.keys(responses);
  const code = wantStatus && responses[wantStatus] ? wantStatus : codes.find((c) => /^2/.test(c)) || codes[0];
  let resp = responses[code];
  if (resp?.$ref) resp = resolveRef(resp.$ref);
  return { code: Number(code) || 200, resp };
}

function exampleOf(media, name) {
  if (!media) return undefined;
  if (media.example !== undefined) {
    if (!name || !media.examples) return deref(media.example);
  }
  if (media.examples) {
    const keys = Object.keys(media.examples);
    const key = name && media.examples[name] ? name : keys[0];
    const ex = deref(media.examples[key]);
    return ex?.value !== undefined ? ex.value : ex;
  }
  return media.example !== undefined ? deref(media.example) : undefined;
}

// 和后端一致：有行业专家讲解的题（读 $ASSETS_DIR/explanations/*_expert.jsonl 里的 id，每次请求重新读）讲解/思路 source=expert，其余 pending
function expertEntry(id) {
  const fs = require('fs'), path = require('path');
  const dir = path.join(process.env.ASSETS_DIR || '/workspace/tiku', 'explanations');
  let found = null;
  try {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('_expert.jsonl')).sort())
      for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try { const d = JSON.parse(l); if (d.id === id && Array.isArray(d.steps) && d.steps.length) found = d; } catch {}
      }
  } catch {}
  if (!found) return null;
  const steps = found.steps.map((text, i) => ({ n: i + 1, text: typeof text === 'string' ? text : text.text }));
  if (found.remember) steps.push({ n: steps.length + 1, text: `**下次记住**：${found.remember}` });
  return steps;
}
const EXPERT_IDS = { test: (id) => !!bankExplanation(id) }; // 有专家讲解或官方解析
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const uuid = () => require('crypto').randomUUID();

// 把 SSE example 文本拆成 [{event, data}]
function parseSse(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((block) => {
      const ev = /event:\s*(.+)/.exec(block)?.[1]?.trim();
      const data = /data:\s*(.+)/.exec(block)?.[1]?.trim();
      return ev && data ? { event: ev, data: JSON.parse(data) } : null;
    })
    .filter(Boolean);
}

async function streamSse(res, events) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  for (const e of events) {
    res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    await sleep(DELAY);
  }
  res.end();
}

// 最小 PDF（错题导出用）
function tinyPdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = 'BT /F1 18 Tf 72 770 Td (Mock: wrong questions export) Tj ET';
  objs[3] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// 题库原题（只读）
function bankQuestion(id) {
  const m = /^([a-z0-9]+)-(\d{4})-/.exec(id || '');
  if (!m) return null;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(process.env.ASSETS_DIR || '/workspace/tiku', `${m[1]}_${m[2]}.json`), 'utf8'));
    return (Array.isArray(d) ? d : d.questions || d.items || []).find((x) => x.id === id) || null;
  } catch { return null; }
}
// 讲解出处 + 核对状态：直接复用后端编译好的逻辑（专家 > 官方解析；verified 看 reviews/explanations_*.jsonl 最新一条）
let explainLib = null;
try { explainLib = require('../dist/src/ai/explain'); } catch { /* 没编译时退回只认专家讲解 */ }
function bankExplanation(id) {
  const q = bankQuestion(id);
  if (explainLib && q) {
    const o = explainLib.officialSolution({ review_status: q.review?.status, review_checked_by: q.review?.checked_by, ...q });
    if (!o) return null;
    return { source: o.kind === 'expert' ? 'expert' : 'official', label: o.label, steps: o.steps, verified: o.verified, review: o.review };
  }
  const steps = expertEntry(id);
  return steps ? { source: 'expert', label: '行业专家参考解答（非官方解析）', steps, verified: false, review: null } : null;
}
// 主观题参考答案（和后端 src/questions/reference-answer.ts 一致）：翻译参考译文 / 写作范文 / 解答题答案，取自题库 answer；客观题 null
function referenceAnswerFor(id, type) {
  const q = bankQuestion(id);
  const t = type || q?.type || '';
  if (!q || /choice|fill/.test(t) || t === 'match') return null;
  const s = (Array.isArray(q.answer) ? q.answer : q.answer != null ? [q.answer] : []).map((x) => String(x ?? '').trim()).filter(Boolean).join('\n\n');
  return s || null;
}
function withReferenceAnswers(body) {
  if (body && typeof body === 'object' && Array.isArray(body.result?.per_question)) body.result.per_question = body.result.per_question.map((p) => ({ ...p, reference_answer: referenceAnswerFor(p.question_id, p.type) }));
  return body;
}
function explanationInfoFor(id) {
  const e = bankExplanation(id);
  return e ? { source: e.source, source_label: e.label, verified: e.verified, review: e.review, explanation_id: null }
    : { source: 'pending', source_label: null, verified: false, review: null, explanation_id: null };
}

// 计分字段和后端一致：证明题 score_by_whole=true（小问分值留 null），计算题缺的小问分值平均估算并标 score_estimated
function withSubScores(o) {
  const subs = Array.isArray(o.sub_questions) ? o.sub_questions : [];
  return { ...o, sub_scores: o.score_by_whole || !subs.length ? null : subs.map((x) => x.score ?? null) };
}
function scoreFieldsFor(id) {
  const m = /^([a-z0-9]+)-(\d{4})-/.exec(id || '');
  if (!m) return { score_estimated: false, score_by_whole: false };
  try {
    const d = JSON.parse(fs.readFileSync(path.join(process.env.ASSETS_DIR || '/workspace/tiku', `${m[1]}_${m[2]}.json`), 'utf8'));
    const q = (Array.isArray(d) ? d : d.questions || d.items || []).find((x) => x.id === id);
    if (!q) return { score_estimated: false, score_by_whole: false };
    let isProof = () => false;
    try { isProof = require('../dist/src/common/grading').isProofQuestion; } catch { /* 没编译时不判 */ }
    const subs = (q.sub_questions || []).map((x) => ({ ...x }));
    if (isProof(q)) return { score: q.score, sub_questions: subs, score_estimated: false, score_by_whole: true };
    const missing = subs.filter((x) => x.score == null);
    if (!missing.length || q.score == null) return { score: q.score, sub_questions: subs, score_estimated: false, score_by_whole: false };
    const known = subs.reduce((a, x) => a + (x.score || 0), 0);
    const each = Math.round(((q.score - known) / missing.length) * 2) / 2;
    missing.forEach((x, i) => { x.score = i === missing.length - 1 ? q.score - known - each * (missing.length - 1) : each; x.score_estimated = true; });
    return { score: q.score, sub_questions: subs, score_estimated: true, score_by_whole: false };
  } catch { return { score_estimated: false, score_by_whole: false }; }
}

// 学习日：当地 04:00 换天（和后端 DAY_START_HOUR=4 / studyDate 一致）。Mock 的「今天」固定成 example 里的学习日，相对叫法按它算
const DAY_START_HOUR = 4;
const MOCK_STUDY_DATE = process.env.MOCK_STUDY_DATE || '2026-11-01';
const MOCK_TZ = 'America/Los_Angeles';
function studyDate(at, tz = MOCK_TZ) {
  const d = new Date(new Date(at).getTime() - DAY_START_HOUR * 3600000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}
function relativeDay(date, today = MOCK_STUDY_DATE) {
  if (!date) return null;
  const n = Math.round((Date.parse(`${String(date).slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return { '-2': '前天', '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' }[n] ?? null;
}
// 和后端渲染层一致：存库文字里的 {{date:YYYY-MM-DD}} 按（Mock 的）学习日渲染成「明天（11-02）」/「周三（11-04）」/「11-20（周五）」；/agent、/plans 下整理引号（「」外、『』里、更深去掉）
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function mockDayLabel(d, today = MOCK_STUDY_DATE) {
  const n = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000), rel = relativeDay(d, today), wd = WD[new Date(`${d}T12:00:00Z`).getUTCDay()];
  return rel ? `${rel}（${d.slice(5)}）` : Math.abs(n) <= 6 ? `${wd}（${d.slice(5)}）` : `${d.slice(5)}（${wd}）`;
}
function nestQuotes(t) {
  if (!/[「『][^」』]*[「『]/.test(t)) return t;
  let k = 0, o = '';
  for (const ch of t) { if (ch === '「' || ch === '『') { k++; o += k === 1 ? '「' : k === 2 ? '『' : ''; } else if ((ch === '」' || ch === '』') && k > 0) { o += k === 1 ? '」' : k === 2 ? '』' : ''; k--; } else o += ch; }
  return o;
}
function renderMock(v, quotes) {
  if (typeof v === 'string') { const r = v.replace(/( ?)\{\{date:(\d{4}-\d{2}-\d{2})\}\}( ?)/g, (_m, a, d, b) => { const l = mockDayLabel(d); return /^\d/.test(l) ? a + l + b : l; }); return quotes ? nestQuotes(r) : r; }
  if (Array.isArray(v)) return v.map((x) => renderMock(x, quotes));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, renderMock(x, quotes)]));
  return v;
}
const withDue = (i) => { const dd = i.due_at ? studyDate(i.due_at) : null; return { ...i, due_date: dd, due_relative_day: relativeDay(dd) }; };

// 少量「看起来像真的」的定制：把请求里的值回填到 example
const customize = {
  // 学生看到的日期都带相对叫法（前端不算日界）
  'GET /plans': (body) => ({ ...body, study_date: MOCK_STUDY_DATE, items: (body.items || []).map((p) => ({ ...p, relative_day: relativeDay(p.plan_date) })) }),
  'GET /plans/today': (body) => ({ ...body, study_date: MOCK_STUDY_DATE, relative_day: '今天', plan: body.plan && { ...body.plan, relative_day: '今天' },
    ...(body.review_due ? { review_due: { ...body.review_due, items: (body.review_due.items || []).map(withDue) } } : {}) }),
  'GET /checkins': (body) => ({ ...body, study_date: MOCK_STUDY_DATE, items: (body.items || []).map((c) => ({ ...c, relative_day: relativeDay(c.day) })) }),
  'GET /me/settings': (body) => ({ ...body, today: MOCK_STUDY_DATE, effective: { ...body.effective, study_date: MOCK_STUDY_DATE, day_start_hour: DAY_START_HOUR } }),
  'GET /passages/{id}': (body, req) => ({ ...body, id: req.params.id }),
  'GET /answers/{id}/grade': (body, req) => ({ ...body, answer_id: req.params.id }),
  'POST /answers/{id}/grade': (body, req) => ({ ...body, answer_id: req.params.id }),
  'POST /agent/jobs/{job}/run': (body, req) => ({ ...body, job: req.params.job, actions: (body.actions || []).map((a) => ({ ...a, trigger: req.params.job, id: uuid(), created_at: now() })) }),
  'POST /auth/register': (body, req) => { if (req.body?.username) body.user.username = req.body.username; return body; },
  'POST /auth/login': (body, req) => { if (req.body?.username) body.user.username = req.body.username; return body; },
  'GET /words/today': (body) => ({ ...body, study_date: MOCK_STUDY_DATE, relative_day: '今天', ...Object.fromEntries(['review', 'new'].map((k) => [k, (body[k] || []).map((w) => ({ ...w, audio_url_us: `/api/v1/words/${w.id}/audio?accent=us`, audio_url_uk: `/api/v1/words/${w.id}/audio?accent=uk` }))])) }),
  'GET /wrong-questions': (body) => ({ ...body, items: (body.items || []).map((i) => ({ ...withDue(i), ...scoreFieldsFor(i.question_id), errata: bankQuestion(i.question_id)?.errata ?? i.errata ?? [], explanation: explanationInfoFor(i.question_id), reference_answer: referenceAnswerFor(i.question_id, i.type) })) }),
  // errata：原卷误印说明，和后端一样从题库原样带出（英语一 2025 第 14、39 题有）
  // 顶层 sub_scores：整题计分或没有小问 → null（不返回 [null]），和后端一致
  'GET /questions/{id}': (body, req) => withSubScores({ ...body, id: req.params.id, ...scoreFieldsFor(req.params.id), errata: bankQuestion(req.params.id)?.errata ?? body.errata ?? [], explanation: explanationInfoFor(req.params.id), reference_answer: req.query?.include_answer === 'true' ? referenceAnswerFor(req.params.id) : null }),
  // 建议消息的 status：pending / confirmed / dismissed（其他消息 null）
  'GET /agent/messages': (body) => ({ ...body, items: (body.items || []).map((i) => ({ ...i, relative_day: relativeDay(i.date), status: i.kind === 'proposal' ? (i.proposal?.status ?? 'pending') : null })) }),
  'GET /questions/{id}/hint': (body, req) => {
    // 有专家讲解 / 官方解析的题给真实步骤和核对状态，其余 pending：hints 为空、text「思路生成中」，不给示例思路
    const num = Number(/-(\d+)$/.exec(req.params.id)?.[1]) || body.citation?.number;
    const e = req.query.__example ? null : bankExplanation(req.params.id);
    if (e) {
      const steps = e.steps;
      const step = Math.min(Math.max(1, Number(req.query.step || 1)), steps.length);
      Object.assign(body, { step, total_steps: steps.length, has_more: step < steps.length, hints: steps.slice(0, step),
        status: e.source, source: e.source, verified: e.verified, review: e.review, source_label: e.label, notice: null, text: null });
    }
    return { ...body, question_id: req.params.id, citation: { ...body.citation, number: num } };
  },
  'POST /answers': (body, req) => {
    const one = (a) => ({ ...body, id: uuid(), question_id: a.question_id || body.question_id, answer: a.answer || body.answer, self_rating: a.self_rating || null, client_id: a.client_id || null, answered_at: now() });
    return Array.isArray(req.body?.items) ? { items: req.body.items.map(one) } : one(req.body || {});
  },
  // 带 exam/year/question_ids 时用「每题最新」示例，并按 question_ids 回填
  'GET /answers': (body, req, op) => {
    const q = req.query || {};
    if (!(q.exam || q.year || q.question_ids) || req.query.__example) return body;
    const latest = JSON.parse(JSON.stringify(op?.responses?.['200']?.content?.['application/json']?.examples?.latest?.value || body));
    if (q.question_ids) {
      const ids = String(q.question_ids).split(',').map((s) => s.trim()).filter(Boolean);
      const tpl = latest.items[0];
      latest.items = ids.slice(0, 2).map((id, i) => ({ ...tpl, id: uuid(), question_id: id, is_correct: i === 0 }));
    }
    return latest;
  },
  'PUT /exams/{id}/progress': (body, req) => {
    const b = req.body || {};
    const out = JSON.parse(JSON.stringify(body));
    out.id = req.params.id;
    out.server_time = now();
    if (b.state === 'paused') out.status = 'paused';
    if (b.client_seq) out.progress.last_client_seq = b.client_seq;
    if (b.current_question_id) out.progress.current_question_id = b.current_question_id;
    for (const a of b.answers || []) out.progress.answers[a.question_id] = { answer: a.answer || [], time_spent_seconds: a.time_spent_seconds ?? null, flagged: !!a.flagged, client_seq: b.client_seq, saved_at: now() };
    return out;
  },
  'POST /exams/{id}/abandon': (body, req) => ({ ...body, id: req.params.id, status: 'abandoned', abandoned_at: now(), server_time: now(), result: null }),
  // 交卷后自评：回填 id，按请求里的 self_ratings 改写示例里对应题的自评
  'POST /exams/{id}/self-ratings': (body, req) => {
    const out = { ...body, id: req.params.id, server_time: now(), duplicate: false };
    const sr = req.body?.self_ratings || {};
    if (out.result?.per_question) out.result.per_question = out.result.per_question.map((q) => (q.question_id in sr && typeof sr[q.question_id] === 'string' ? { ...q, self_rating: sr[q.question_id] } : q));
    if (out.result) out.result.self_rated_at = now();
    return out;
  },
  'POST /words/{id}/review': (body, req) => ({ ...body, word_id: Number(req.params.id), last_review_at: now() }),
  'POST /events': (body, req) => { const n = (req.body?.events || []).length; return { received: n, accepted: n, duplicates: 0 }; },
};

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device, X-Timezone, Idempotency-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('X-Mock', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 题目图片：和真后端一样从 ASSETS_DIR（默认 /workspace/tiku）读，不需要登录
const ASSETS_DIR = path.resolve(process.env.ASSETS_DIR || '/workspace/tiku');
const IMG_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
app.use(PREFIX + '/assets', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let rel;
  try { rel = decodeURIComponent(req.path.replace(/^\/+/, '')); } catch { return res.status(400).end(); }
  const file = path.resolve(ASSETS_DIR, rel);
  const type = IMG_TYPES[path.extname(file).toLowerCase()];
  if (!rel || !file.startsWith(ASSETS_DIR + path.sep) || rel.split('/').some((x) => x.startsWith('.')) || !type || !fs.existsSync(file) || !fs.statSync(file).isFile())
    return res.status(404).json({ statusCode: 404, message: '没有这张图片', error: 'Not Found' });
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  fs.createReadStream(file).pipe(res);
});

const routes = [];
for (const [p, item] of Object.entries(spec.paths)) {
  if (p === '/assets/{path}') { routes.push('GET /assets/{path}'); continue; }
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const op = item[method];
    if (!op) continue;
    const expressPath = PREFIX + p.replace(/\{(\w+)\}/g, ':$1');
    const key = `${method.toUpperCase()} ${p}`;
    routes.push(key);
    app[method](expressPath, async (req, res) => {
      const { code, resp } = pickResponse(op, req.query.__status);
      const content = resp?.content || {};
      const type = Object.keys(content)[0];
      if (type === 'text/event-stream') {
        // 讲解：和后端一致，只有有行业专家讲解的题给 expert，其余 pending（不出示例讲解）
        const exName = req.query.__example || (p === '/questions/{id}/explain' ? (EXPERT_IDS.test(req.params.id) ? 'expert' : 'pending') : undefined);
        let events = parseSse(exampleOf(content[type], exName) || '');
        if (p === '/agent/commands') {
          const cid = uuid();
          const text = req.body?.text || '这周把极限练透';
          events = events.map((e) => ({ ...e, data: { ...e.data, command_id: cid } }));
          events[0].data.text = `收到：「${text}」`;
          const act = events.find((e) => e.event === 'action');
          if (act) { act.data.action = { ...act.data.action, id: uuid(), command_id: cid, created_at: now(), reason: `你说「${text}」，这 3 道错题到了复习时间，先重做再刷新题。` }; }
        }
        if (p === '/questions/{id}/explain') {
          const sel = req.body?.selectedText || req.query.selectedText;
          const num = Number(/-(\d+)$/.exec(req.params.id)?.[1]) || null;
          events = events.map((e) => (e.event === 'meta' ? { ...e, data: { ...e.data, question_id: req.params.id, mode: sel ? 'followup' : (req.body?.mode || req.query.mode || 'full') } }
            : e.event === 'citation' && num ? { ...e, data: { ...e.data, number: num } } : e));
        }
        if (p === '/questions/{id}/explain' && exName === 'expert' && !req.query.__example) {
          const e = bankExplanation(req.params.id);
          const steps = e?.steps || [];
          const patch = e ? { source: e.source, verified: e.verified, source_label: e.label } : {};
          events = events.map((ev) => ev.event === 'meta' ? { ...ev, data: { ...ev.data, ...patch } }
            : ev.event === 'citation' ? { ...ev, data: { ...ev.data, source_label: e?.label } }
            : ev.event === 'done' ? { ...ev, data: { ...ev.data, ...patch, status: e?.source, review: e?.review ?? null } } : ev);
          const i0 = events.findIndex((e) => e.event === 'step');
          events = events.filter((e) => e.event !== 'step');
          events.splice(i0 < 0 ? 1 : i0, 0, ...steps.map((s) => ({ event: 'step', data: { type: 'step', ...s } })));
        }
        return streamSse(res, events);
      }
      if (type === 'audio/mpeg') {
        // 单词发音：mock 不联网，给一段 0.4 秒静音 mp3 占位（响应头 X-Mock-Audio 标明）；?__status=502 可模拟上游失败
        res.status(code).setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('X-Mock-Audio', 'silent-placeholder');
        res.setHeader('X-Audio-Cache', 'hit');
        return res.end(fs.readFileSync(path.join(__dirname, 'silence-placeholder.mp3')));
      }
      if (type === 'application/pdf') {
        res.status(code).setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', p === '/exams/{id}/report.pdf'
          ? `attachment; filename="exam-report-2017-math1.pdf"; filename*=UTF-8''${encodeURIComponent('2017 数学一模考成绩报告-2026-11-01.pdf')}`
          : 'inline; filename="wrong-questions.pdf"');
        return res.end(tinyPdf());
      }
      let exName2 = req.query.__example;
      if (!exName2 && key === 'GET /questions/{id}/hint') exName2 = EXPERT_IDS.test(req.params.id) ? 'expert' : 'pending';
      let body = exampleOf(content[type], exName2);
      if (body === undefined) return res.status(code).end();
      body = JSON.parse(JSON.stringify(body));
      if (customize[key] && code < 300) body = customize[key](body, req, op);
      if (code < 300 && body && typeof body === 'object') body = renderMock(body, /^\/(agent|plans)\b/.test(req.path.replace(/^\/api\/v1/, '')));
      if (code < 300) body = withReferenceAnswers(body); // 模考成绩 per_question.reference_answer
      if (code >= 400 && body && typeof body === 'object' && 'statusCode' in body) {
        const msg = { 401: '未登录或登录已过期', 404: '没找到这个内容，可能已经被删掉了，刷新一下再试', 409: '这条已经处理过了，刷新一下看看最新状态' }[code];
        // 404/409 统一 {statusCode,error,message,field,code}（同后端）；example 自带 code 的保留它的 message
        body = { ...body, statusCode: code, ...(msg && !body.code ? { message: msg } : {}), error: { 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 409: 'Conflict' }[code] || body.error,
          ...(code === 404 || code === 409 ? { field: body.field ?? null, code: body.code ?? (code === 404 ? 'not_found' : 'conflict') } : {}) };
      }
      res.status(code).json(body);
    });
  }
}

// /feynman 是 multipart：上面通用路由已经能返回 example，这里不解析文件
app.use((req, res) => res.status(404).json({ statusCode: 404, message: `mock 里没有这个接口：${req.method} ${req.path}`, error: 'Not Found' }));

app.listen(PORT, () => {
  console.log(`[mock] ${routes.length} 个接口，http://localhost:${PORT}${PREFIX}  （spec: ${SPEC_PATH}）`);
});
