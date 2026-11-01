import * as fs from 'fs';
import { ASSETS_DIR } from '../common/assets';
import katex from 'katex';
import { officialSolution } from '../ai/explain';

const KATEX_CSS = require.resolve('katex/dist/katex.min.css');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

export function esc(s: string) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]); }

/** Markdown 里的 $…$ / $$…$$ 用 KaTeX 渲染成 HTML，渲染失败就原样显示 */
export function renderMath(text: string, imageBase: string = ASSETS_DIR) {
  if (!text) return '';
  const k = (t: string, display: boolean) => { try { return katex.renderToString(t, { displayMode: display, throwOnError: true }); } catch { return `<code>${esc(t)}</code>`; } };
  // 逐段处理：公式交给 KaTeX，普通文字转义并把换行变成 <br>（KaTeX 输出的 SVG 路径里也有换行，不能整体替换）
  return text.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g).map((seg) => {
    if (seg.startsWith('$$') && seg.endsWith('$$') && seg.length > 4) return k(seg.slice(2, -2), true);
    if (seg.startsWith('$') && seg.endsWith('$') && seg.length > 2) return k(seg.slice(1, -1), false);
    // Markdown 图片 → 本地文件（PDF 是用 file:// 打开的）
    return seg.split(/(!\[[^\]]*\]\([^)\s]+\))/g).map((part) => {
      const m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
      if (!m) return esc(part).replace(/\n/g, '<br>');
      const src = /^(https?:|data:)/.test(m[2]) ? m[2] : 'file://' + require('path').resolve(imageBase, m[2]);
      return `<img src="${esc(src)}" alt="${esc(m[1])}" style="max-width:70%;max-height:220px;display:block;margin:6px 0">`;
    }).join('');
  }).join('');
}

/** 附答案时附上讲解（行业专家 / 官方解析），标明出处和是否已核对 */
/** 题干：{{table:N}} 换成 HTML 表格，其余照 renderMath */
export function renderStem(q: { stem?: string; tables?: any; assets_dir?: string }) {
  const list: any[] = Array.isArray(q.tables) ? q.tables : [];
  return String(q.stem ?? '').split(/(\{\{table:\d+\}\})/g).map((seg) => {
    const m = /^\{\{table:(\d+)\}\}$/.exec(seg);
    const t = m ? list[Number(m[1])] : null;
    if (!m) return renderMath(seg, q.assets_dir);
    if (!t || !Array.isArray(t.rows)) return esc(seg);
    const td = (c: any, tag: string) => `<${tag} style="border:1px solid #999;padding:2px 8px">${renderMath(String(c ?? ''), q.assets_dir)}</${tag}>`;
    return `<table style="border-collapse:collapse;margin:6px 0">${t.caption ? `<caption>${renderMath(t.caption, q.assets_dir)}</caption>` : ''}`
      + `${Array.isArray(t.header) && t.header.length ? `<tr>${t.header.map((c: any) => td(c, 'th')).join('')}</tr>` : ''}`
      + `${t.rows.map((r: any) => `<tr>${(Array.isArray(r) ? r : []).map((c: any) => td(c, 'td')).join('')}</tr>`).join('')}</table>`
      + `${t.note ? `<div style="font-size:90%">${renderMath(t.note, q.assets_dir)}</div>` : ''}`;
  }).join('');
}

export function explanationBlock(q: any) {
  const o = officialSolution({ ...q, id: q.question_id ?? q.id });
  if (!o) return '';
  const tag = o.kind === 'solution' ? '' : o.verified ? ' · 已核对' : ' · 未核对';
  return `<div class="expert"><div class="expert-label">${esc(o.label + tag)}</div><ol>${o.steps.map((s) => `<li>${renderMath(s.text.replace(/^\*\*下次记住\*\*：/, '下次记住：'))}</li>`).join('')}</ol></div>`;
}

/** KaTeX 样式（字体改成 file:// 绝对路径，PDF 用 file:// 打开时能加载） */
let katexCssCache: string | null = null;
export function katexCss() {
  return (katexCssCache ??= fs.readFileSync(KATEX_CSS, 'utf8').replace(/url\(fonts\//g, `url(file://${require.resolve('katex/dist/katex.min.css').replace(/katex\.min\.css$/, '')}fonts/`));
}

export function wrongQuestionsHtml(items: any[], opts: { title: string; withAnswer: boolean }) {
  const css = katexCss();
  const body = items.map((q, i) => `
    <section class="q">
      <div class="meta">${i + 1}. ${q.year} 年 ${q.exam === 'math1' ? '数一' : q.exam} 第 ${q.number} 题 · ${q.score ?? ''} 分${q.score_by_whole ? '（按整题计分）' : ''} · 错 ${q.wrong_count} 次${q.error_type ? ' · ' + ({ concept: '概念', calc: '计算', reading: '审题', method: '方法' } as any)[q.error_type] : ''}</div>
      <div class="stem">${renderStem(q)}</div>
      ${(q.options || []).length ? `<ol class="opts">${q.options.map((o: any) => `<li><b>${o.key}.</b> ${renderMath(o.content, q.assets_dir)}</li>`).join('')}</ol>` : ''}
      ${q.reminder ? `<div class="remember">下次记住：${renderMath(q.reminder)}</div>` : ''}
      ${opts.withAnswer ? `<div class="ans">答案：${(q.answer || []).map(renderMath).join('；')}</div>${explanationBlock(q)}` : '<div class="blank"></div>'}
    </section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}
    body{font-family:"Noto Serif CJK SC","Source Han Serif SC",serif;color:#1a1a1a;font-size:11pt;line-height:1.7;margin:0}
    h1{font-size:15pt;font-weight:600;border-bottom:1px solid #222;padding-bottom:6px;margin:0 0 12px}
    .q{border-bottom:0.5px solid #999;padding:10px 0 14px;break-inside:avoid}
    .meta{font-size:9pt;color:#666;margin-bottom:4px}.opts{list-style:none;padding:0;margin:6px 0 0}.opts li{margin:2px 0}
    .remember{color:#b22222;font-size:10pt;margin-top:6px}.ans{color:#b22222;margin-top:6px}.expert{margin-top:6px;font-size:10pt}.expert-label{font-size:9pt;color:#666;border-left:2px solid #999;padding-left:6px}.expert ol{margin:4px 0 0;padding-left:20px}.blank{height:120px}
  </style></head><body><h1>${esc(opts.title)}</h1>${body}</body></html>`;
}

// ───────────── PDF 渲染器（常驻 Chrome + 复用标签页 + 结果缓存） ─────────────
// 以前每次导出都 launch Chrome + networkidle0（固定多等 500ms+）+ 生成带结构标签的 PDF，手机上要 ~2.3s。
// 现在：Chrome 常驻（断了自动重启）、空闲标签页复用（CJK/KaTeX 字体在渲染进程里保持热）、
// 等 load + document.fonts.ready + 图片 decode（file:// 资源，结果和 networkidle0 一样）、tagged:false（不生成无障碍结构树，页面内容不变）、
// 同一份 HTML（sha1）直接返回缓存的 PDF。
const PDF_OPTS = { format: 'A4' as const, margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' }, printBackground: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  tagged: false };
let browserP: Promise<any> | null = null;
const idlePages: any[] = [];
const MAX_IDLE = 2;
const cache = new Map<string, Buffer>();
const CACHE_MAX = 24;
const inflight = new Map<string, Promise<Buffer>>();

async function getBrowser() {
  if (!browserP) {
    browserP = (async () => {
      const puppeteer = await import('puppeteer-core');
      const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
      b.on('disconnected', () => { browserP = null; idlePages.length = 0; });
      return b;
    })();
    browserP.catch(() => { browserP = null; });
  }
  return browserP;
}

async function renderPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = idlePages.pop() ?? (await browser.newPage());
  const tmp = require('path').join(require('os').tmpdir(), `kaoyan-pdf-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  let ok = false;
  try {
    fs.writeFileSync(tmp, html);
    // 用 file:// 打开，KaTeX 字体（file:// 链接）和题目图片才能加载
    await page.goto(`file://${tmp}`, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(`document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))))`);
    const pdf = Buffer.from(await page.pdf(PDF_OPTS));
    ok = true;
    return pdf;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
    if (ok && idlePages.length < MAX_IDLE && page.isClosed?.() === false) idlePages.push(page);
    else page.close().catch(() => {});
  }
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const key = require('crypto').createHash('sha1').update(html).digest('hex');
  const hit = process.env.PDF_CACHE === '0' ? undefined : cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  let p = inflight.get(key);
  if (!p) {
    p = renderPdf(html).catch(async (e) => {
      // Chrome 掉了 / 标签页坏了：重启一次再试
      browserP = null; idlePages.length = 0;
      return renderPdf(html).catch(() => { throw e; });
    });
    inflight.set(key, p);
    p.then((buf) => { cache.set(key, buf); while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!); }, () => {}).finally(() => inflight.delete(key));
  }
  return p;
}

// ───────────── 预渲染：成绩页/错题本一打开就在后台把 PDF 渲染进缓存，点「导出」时直接命中 ─────────────
// 只有一个后台任务在跑（不和前台抢 CPU）；同一 key 排队时只保留最新的；同一 key 两次预渲染至少隔 minGapMs（数据变更后传 0）
const preQueue = new Map<string, () => Promise<string | null>>();
const lastPre = new Map<string, number>();
let preBusy = false;
export function prerenderPdf(key: string, build: () => Promise<string | null>, minGapMs = 3000) {
  if (process.env.PDF_PRERENDER === '0' || closing) return;
  const now = Date.now();
  if (minGapMs > 0 && (lastPre.get(key) ?? 0) > now - minGapMs) return;
  lastPre.set(key, now);
  if (lastPre.size > 500) for (const [k, t] of lastPre) if (t < now - 60000) lastPre.delete(k);
  preQueue.delete(key); preQueue.set(key, build);
  void drainPrerender();
}
async function drainPrerender() {
  if (preBusy) return;
  preBusy = true;
  try {
    while (preQueue.size && !closing) {
      const [key, build] = preQueue.entries().next().value!;
      preQueue.delete(key);
      try { const html = await build(); if (html) await htmlToPdf(html); } catch (e: any) { console.warn(`[pdf] prerender ${key} failed:`, e?.message ?? e); }
    }
  } finally { preBusy = false; }
}

/** 错题导出的 HTML 生成器（WrongQuestionsController 注册；考场成绩页用它预渲染「导出错题 PDF」） */
type WrongExportBuilder = (userId: string, f: any) => Promise<string>;
let wrongExportBuilder: WrongExportBuilder | null = null;
export function registerWrongExportBuilder(b: WrongExportBuilder) { wrongExportBuilder = b; }
export function prerenderWrongExport(userId: string, f: Record<string, string> = {}, minGapMs = 3000) {
  const b = wrongExportBuilder; if (!b) return;
  const key = `wrong:${userId}:${JSON.stringify(Object.entries(f).sort())}`;
  prerenderPdf(key, () => b(userId, f), minGapMs);
}

/** 启动后预热：拉起 Chrome，渲染一页含中文 + KaTeX 的小文档，让字体进缓存（失败不影响启动） */
export async function warmPdfRenderer() {
  if (process.env.PDF_WARM === '0') return;
  try {
    await renderPdf(`<!doctype html><html><head><meta charset="utf-8"><style>${katexCss()}body{font-family:"Noto Serif CJK SC","Source Han Serif SC",serif}</style></head><body>预热 ${renderMath('$\\int_0^1 x^2\\,dx=\\frac13$ $$\\sum_{n=1}^\\infty \\frac{1}{n^2}$$')}</body></html>`);
  } catch (e: any) { console.warn('[pdf] warm-up failed:', e?.message ?? e); }
}

let closing = false;
export async function closePdfRenderer() {
  closing = true; preQueue.clear();
  const b = browserP ? await browserP.catch(() => null) : null;
  browserP = null; idlePages.length = 0;
  if (b) await b.close().catch(() => {});
}
