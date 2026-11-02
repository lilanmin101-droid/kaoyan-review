/**
 * 真题词汇 → words 表（npm run import:vocab [-- --file <json>] [--ecdict <csv>] [--min-freq 3] [--dry-run] [--report <md>]）
 *
 * 输入：/workspace/kaoyan/tiku/vocab/english1_exam_vocab.json（{meta, words:[{word, frequency, years, forms, in_word_bank, ecdict_tags, level, examples:[{sentence, year, question_id, passage_id}]}]}）
 * 1) 已有单词（按词元 word 不区分大小写匹配；词元没匹配上时再试它的词形 forms）：
 *    frequency ← 真题出现次数，exam_years ← 出现年份，examples ← 保留原有例句，再补真题例句（每词最多 5 条，优先补没有的年份，同句去重）
 * 2) 补词：词库里没有、真题出现 ≥ --min-freq（默认 3）次的词，去掉专有名词，source='exam' 入库；
 *    中文释义 / 音标 / 词性 / 词频排名取本地 ECDICT；没有中文释义的 needs_definition=true，不进学习队列
 *    ECDICT 路径：--ecdict > ECDICT_CSV > 本 worktree 的 data/ecdict/ecdict.csv > 主仓库（git rev-parse --git-common-dir 的上一级）的 data/ecdict/ecdict.csv
 * 3) 补释义：词库里释义为空的词（比如上次没找到 ECDICT 时补进来的），这次 ECDICT 里有就填上释义（音标 / 词性 / 词频排名为空的也一起填），
 *    needs_definition 改回 false；已有释义的一律不覆盖
 *    新词 added_at=now()：当天新增的词不进当天的「今日单词」，不打乱已排好的每日快照
 * 专有名词判断：真题原文（题干、选项、文章）里这个词的所有出现都是句中大写、从没小写出现过；或 ECDICT 只收了大写词条；或释义以 [人名]/[地名] 开头
 * 幂等：重复跑结果一样；不删词、不动学习进度；词库里有但真题没出现的词不改
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Client } from 'pg';
import { execFileSync } from 'child_process';
import { loadEnv } from './env';

const TIKU = process.env.TIKU_DIR || '/workspace/kaoyan/tiku';
const MAX_EXAMPLES = 5;
type Ex = { sentence: string; year: number | null; question_id: string | null; passage_id: string | null };
type V = { word: string; frequency: number; years: number[]; forms?: Record<string, number>; in_word_bank?: boolean; ecdict_tags?: string[]; level?: string; examples?: any[] };

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function parseCsvLine(line: string): string[] | null {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  if (q) return null;
  out.push(cur); return out;
}

/** ECDICT 在哪：--ecdict > ECDICT_CSV > 本 worktree data/ecdict > 主仓库 data/ecdict（worktree 里 data/ecdict 不在 git 里，常常只有主仓库有） */
export function resolveEcdict(explicit?: string): { file: string | null; tried: string[] } {
  const tried: string[] = [];
  const pick = (f?: string | null) => { if (!f) return null; const abs = path.resolve(f); if (!tried.includes(abs)) tried.push(abs); return fs.existsSync(abs) ? abs : null; };
  if (explicit) return { file: pick(explicit), tried }; // 明确指定的找不到就算找不到，不偷偷换别的
  if (process.env.ECDICT_CSV) return { file: pick(process.env.ECDICT_CSV), tried };
  const here = pick(path.resolve(__dirname, '../../../data/ecdict/ecdict.csv'));
  if (here) return { file: here, tried };
  try {
    const repo = path.resolve(__dirname, '../../..');
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const main = path.dirname(path.resolve(repo, common));
    const f = pick(path.join(main, 'data/ecdict/ecdict.csv'));
    if (f) return { file: f, tried };
  } catch { /* 不是 git 仓库（比如 Docker 镜像）就算了 */ }
  return { file: null, tried };
}

/** 只取需要的词条（小写精确 + 大写变体），ECDICT 77 万行流式读一遍 */
async function ecdictLookup(file: string, want: Set<string>) {
  const hit = new Map<string, Record<string, string>>(), capHit = new Map<string, Record<string, string>>(); const capOnly = new Set<string>();
  if (!fs.existsSync(file)) return { hit, capOnly, missing: true };
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let header: string[] | null = null, buf = ''; const caps = new Set<string>();
  for await (const line of rl) {
    buf = buf ? `${buf}\n${line}` : line;
    const f = parseCsvLine(buf); if (!f) continue; buf = '';
    if (!header) { header = f.map((h) => h.replace(/^\uFEFF/, '').trim()); continue; }
    const w = f[0] ?? ''; const lw = w.toLowerCase();
    if (!want.has(lw)) continue;
    const r: Record<string, string> = {}; header.forEach((h, i) => (r[h] = f[i] ?? ''));
    if (w === lw) hit.set(lw, r); else { caps.add(lw); if (!capHit.has(lw) || /^[A-Z][a-z]/.test(w)) capHit.set(lw, r); }
  }
  for (const c of caps) if (!hit.has(c)) { capOnly.add(c); hit.set(c, capHit.get(c)!); } // 只有大写词条（North / Creator）：释义照用，是不是专有名词看原文大小写
  return { hit, capOnly, missing: false };
}

/** 真题原文（题干 / 选项 / 文章，不含解析、参考译文、范文）里每个词形的出现：小写几次、句中大写几次 */
function caseStats() {
  const texts: { t: string; year: number }[] = [];
  let year = 0;
  const push = (v: any) => { if (typeof v === 'string') texts.push({ t: v, year }); else if (Array.isArray(v)) v.forEach(push); else if (v && typeof v === 'object') for (const k of ['text', 'label', 'content', 'stem']) push(v[k]); };
  for (const f of fs.readdirSync(TIKU).filter((x) => /^english1_\d{4}(_passages)?\.json$/.test(x))) {
    const d = JSON.parse(fs.readFileSync(path.join(TIKU, f), 'utf8'));
    year = Number(/\d{4}/.exec(f)![0]);
    for (const x of Array.isArray(d) ? d : d.questions ?? d.passages ?? []) { push(x.text); push(x.stem); push(x.options); push(x.directions); push(x.title); }
  }
  const lower = new Map<string, number>(), midCap = new Map<string, number>(), years = new Map<string, Set<number>>();
  const re = /([.!?:;"“”'‘’(\[—–-]\s*|^\s*|\n\s*)?\b([A-Za-z][A-Za-z'-]*)\b/g;
  for (const { t, year: y } of texts) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const w = m[2], lw = w.toLowerCase();
      (years.get(lw) ?? years.set(lw, new Set()).get(lw)!).add(y);
      if (w === lw) lower.set(lw, (lower.get(lw) ?? 0) + 1);
      else if (!m[1] && /^[A-Z][a-z'-]*$/.test(w)) midCap.set(lw, (midCap.get(lw) ?? 0) + 1); // 句中首字母大写（不在句首 / 引号 / 括号后）
    }
  }
  return { lower, midCap, years };
}

export function mergeExamples(existing: any[] | null, add: any[]): Ex[] {
  const out: Ex[] = []; const seen = new Set<string>();
  for (const e of existing ?? []) {
    if (!e?.sentence || seen.has(norm(e.sentence))) continue;
    seen.add(norm(e.sentence)); out.push({ ...e, passage_id: e.passage_id ?? null });
  }
  const cand = add.filter((e) => e?.sentence && !seen.has(norm(e.sentence)))
    .map((e) => ({ sentence: String(e.sentence), year: e.year ?? null, question_id: e.question_id ?? null, passage_id: e.passage_id ?? null }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  while (out.length < MAX_EXAMPLES && cand.length) {
    const years = new Set(out.map((e) => e.year));
    const i = Math.max(0, cand.findIndex((e) => !years.has(e.year))); // 先补没有的年份
    const [e] = cand.splice(i, 1);
    if (seen.has(norm(e.sentence))) continue;
    seen.add(norm(e.sentence)); out.push(e);
  }
  return out.slice(0, Math.max(MAX_EXAMPLES, (existing ?? []).length));
}

/** 源文件词形还原的已知误判：number 被当成 numb 的比较级。把这些词形挪回它自己的词条（次数、年份、例句一起挪） */
const LEMMA_FIXES: Record<string, string[]> = { numb: ['number'] };
export function fixLemmas(list: V[], yearsOf?: Map<string, Set<number>>): V[] {
  const by = new Map(list.map((v) => [v.word.toLowerCase(), v]));
  for (const [lemma, forms] of Object.entries(LEMMA_FIXES)) {
    const v = by.get(lemma); if (!v?.forms) continue;
    for (const f of forms) {
      const n = Number(v.forms[f]) || 0; if (!n) continue;
      const re = new RegExp(`\\b${f}\\b`, 'i');
      const moved = (v.examples ?? []).filter((e: any) => re.test(e?.sentence ?? ''));
      const t: V = by.get(f) ?? (() => { const x: V = { word: f, frequency: 0, years: [], forms: {}, examples: [] }; list.push(x); by.set(f, x); return x; })();
      t.frequency = (Number(t.frequency) || 0) + n; t.forms = { ...(t.forms ?? {}), [f]: (Number(t.forms?.[f]) || 0) + n };
      t.years = [...new Set([...(t.years ?? []), ...(yearsOf?.get(f) ?? moved.map((e: any) => e.year))])].sort();
      t.examples = [...(t.examples ?? []), ...moved];
      v.frequency = Math.max(0, (Number(v.frequency) || 0) - n); delete v.forms[f];
      v.examples = (v.examples ?? []).filter((e: any) => !moved.includes(e));
      (v as any).dropExamples = [...((v as any).dropExamples ?? []), re]; // 词库里之前导进去的含这个词形的例句也去掉
    }
  }
  for (const v of list) if (!(Number(v.frequency) > 0)) { v.years = []; v.examples = []; } // 挪空了：词库里这个词清成 0（不删词）
  return list;
}

const BASIC_RANK = Number(process.env.BASIC_RANK || 1500);
/** 基础词：中考/高考词（zk/gk）但不是考研词（ky），或最常见的约 1500 词（ECDICT frq / BNC 排名） */
export function isBasic(tags: string[], frqRank: number | null, bnc: number | null): boolean {
  if ((tags.includes('zk') || tags.includes('gk')) && !tags.includes('ky')) return true;
  return [frqRank, bnc].some((n) => n != null && n > 0 && n <= BASIC_RANK);
}

const posOf = (tr: string) => {
  const ps = new Set<string>();
  for (const l of tr.split('\n')) { const m = /^\s*([a-z]+)\.\s/.exec(l); if (m) ps.add(`${m[1]}.`); }
  return ps.size ? [...ps].join(' ') : null;
};

async function main() {
  loadEnv();
  const file = opt('--file', path.join(TIKU, 'vocab', 'english1_exam_vocab.json'))!;
  const ecRes = resolveEcdict(opt('--ecdict'));
  const ecdict = ecRes.file ?? ecRes.tried[0] ?? 'ecdict.csv';
  if (ecRes.file) console.log(`ECDICT：${ecRes.file}`);
  else console.warn(`⚠️ 没找到 ECDICT（找过：${ecRes.tried.join('、')}）。新补的词会没有中文释义（needs_definition），已有空释义的词也补不上；\n   下载 https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv 放到 data/ecdict/，或用 --ecdict <csv> / ECDICT_CSV 指定后重跑`);
  const minFreq = Number(opt('--min-freq', '3'));
  const dry = args.includes('--dry-run');
  const reportFile = opt('--report', path.resolve(__dirname, '../../import_reports/import_report_vocab.md'))!;
  if (!fs.existsSync(file)) { console.log(`import:vocab 跳过：找不到 ${file}`); return; }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cs = caseStats(), { lower, midCap } = cs;
  const list: V[] = fixLemmas((Array.isArray(raw) ? raw : raw.words ?? []).filter((w: any) => w && typeof w.word === 'string' && w.word.trim()), cs.years);
  const badEntries = (Array.isArray(raw) ? raw : raw.words ?? []).length - list.length;

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const db = (await c.query('SELECT id, word, examples, source FROM words')).rows;
    const byLower = new Map<string, any>(db.map((r) => [r.word.toLowerCase(), r]));
    // 1) 匹配：先按词元，再按词形（同一个词库词只认第一个匹配上的词元）
    const matched = new Map<number, { row: any; v: V; via: 'lemma' | 'form' }>();
    const unmatched: V[] = [];
    for (const v of list) { const r = byLower.get(v.word.trim().toLowerCase()); if (r && !matched.has(r.id)) matched.set(r.id, { row: r, v, via: 'lemma' }); else unmatched.push(v); }
    const stillUnmatched: V[] = [];
    // 词形匹配：词库里收的是屈折形式（housing / found / sophisticated），只记这个词形自己的次数和含这个词形的例句
    for (const v of list) {
      for (const [form, n] of Object.entries(v.forms ?? {})) {
        const r = byLower.get(form.toLowerCase());
        if (!r || matched.has(r.id) || form.toLowerCase() === v.word.toLowerCase()) continue;
        const re = new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        const ex = (v.examples ?? []).filter((e: any) => re.test(e?.sentence ?? ''));
        matched.set(r.id, { row: r, v: { ...v, word: form, frequency: Number(n) || 0, years: [...(cs.years.get(form.toLowerCase()) ?? new Set(ex.map((e: any) => e.year)))] as number[], examples: ex }, via: 'form' });
      }
    }
    for (const v of unmatched) if (!byLower.has(v.word.trim().toLowerCase())) stillUnmatched.push(v);
    const viaLemma = [...matched.values()].filter((m) => m.via === 'lemma').length;
    const matchedEcdict = [...matched.values()].filter((m) => m.row.source !== 'exam').length;

    // 2) 补词候选
    const cand = stillUnmatched.filter((v) => (v.frequency ?? 0) >= minFreq);
    const ec = await ecdictLookup(ecdict, new Set(cand.map((v) => v.word.toLowerCase())));
    const skipped: { word: string; frequency: number; reason: string }[] = [];
    const add: any[] = [];
    for (const v of cand) {
      const lw = v.word.toLowerCase(), forms = [lw, ...Object.keys(v.forms ?? {}).map((f) => f.toLowerCase())];
      const lc = forms.reduce((a, f) => a + (lower.get(f) ?? 0), 0), cap = forms.reduce((a, f) => a + (midCap.get(f) ?? 0), 0);
      const e = ec.hit.get(lw);
      const tr = (e?.translation ?? '').replace(/\\n/g, '\n').replace(/\\r/g, '').trim();
      if (!/^[a-z][a-z'-]*$/.test(lw)) { skipped.push({ word: v.word, frequency: v.frequency, reason: '不是普通单词' }); continue; }
      if (lc === 0 && cap > 0) { skipped.push({ word: v.word, frequency: v.frequency, reason: `专有名词（原文只以句中大写出现 ${cap} 次）` }); continue; }
      if (ec.capOnly.has(lw) && e && e.word === e.word.toUpperCase()) { skipped.push({ word: v.word, frequency: v.frequency, reason: `缩写（ECDICT 只有 ${e.word}）` }); continue; }
      if (/^\s*(n\.\s*)?\[(人名|地名|姓氏)\]/.test(tr) && lc <= cap) { skipped.push({ word: v.word, frequency: v.frequency, reason: 'ECDICT 释义是人名 / 地名' }); continue; }
      const def = tr || null;
      add.push({
        word: lw, ph: e?.phonetic?.trim() ? `/${e.phonetic.trim()}/` : null, def, pos: def ? posOf(def) : null, frq: Number(e?.frq) || null,
        tags: [...new Set(['exam', ...(v.level ? [`exam_${v.level}`] : []), ...(v.ecdict_tags ?? [])])].sort(),
        needs_definition: !def, v,
      });
    }

    const updates = [...matched.values()].map(({ row, v }) => ({
      id: row.id, frequency: Math.max(0, Math.round(Number(v.frequency) || 0)),
      years: [...new Set((v.years ?? []).map(Number).filter(Number.isFinite))].sort(), examples: mergeExamples((row.examples ?? []).filter((e: any) => !((v as any).dropExamples ?? []).some((re: RegExp) => re.test(e?.sentence ?? ''))), v.examples ?? []),
    }));
    const newRows = add.map((a) => ({ ...a, frequency: Math.round(Number(a.v.frequency) || 0), years: [...new Set((a.v.years ?? []).map(Number))].sort(), examples: mergeExamples(null, a.v.examples ?? []), v: undefined }));

    let changed = 0, inserted = 0;
    if (!dry) {
      await c.query('BEGIN');
      for (let i = 0; i < updates.length; i += 500) {
        const r = await c.query(
          `UPDATE words w SET frequency=t.frequency, exam_years=ARRAY(SELECT json_array_elements_text(t.years)::int), examples=t.examples
             FROM json_to_recordset($1::json) AS t(id int, frequency int, years json, examples jsonb)
            WHERE w.id=t.id AND (w.frequency IS DISTINCT FROM t.frequency OR w.exam_years IS DISTINCT FROM ARRAY(SELECT json_array_elements_text(t.years)::int) OR w.examples IS DISTINCT FROM t.examples)`,
          [JSON.stringify(updates.slice(i, i + 500))]);
        changed += r.rowCount ?? 0;
      }
      if (newRows.length) {
        const r = await c.query(
          `INSERT INTO words(word, phonetic_uk, phonetic_us, definition_cn, pos, tags, frq_rank, frequency, exam_years, examples, source, needs_definition, added_at)
           SELECT t.word, t.ph, t.ph, t.def, t.pos, ARRAY(SELECT json_array_elements_text(t.tags)), t.frq, t.frequency,
                  ARRAY(SELECT json_array_elements_text(t.years)::int), t.examples, 'exam', t.needs_definition, now()
             FROM json_to_recordset($1::json) AS t(word text, ph text, def text, pos text, tags json, frq int, frequency int, years json, examples jsonb, needs_definition boolean)
           ON CONFLICT DO NOTHING`, [JSON.stringify(newRows)]);
        inserted = r.rowCount ?? 0;
      }
      await c.query('COMMIT');
    }
    // 3) 基础词 basic：ECDICT 标签有 zk/gk 且没有 ky，或 ECDICT 词频排名 / BNC 排名 ≤ BASIC_RANK（默认 1500）；整表按规则重算（幂等）
    const all = dry ? [] : (await c.query('SELECT id, word, tags, frq_rank, basic, definition_cn, pos, phonetic_uk, phonetic_us FROM words')).rows;
    const ecAll = dry ? null : await ecdictLookup(ecdict, new Set(all.map((r) => r.word.toLowerCase())));
    // 3a) 补释义（在算 basic 之前，basic 要用补上的 frq_rank）：释义为空、ECDICT 有释义的词填上；已有释义的不碰（SQL 里再判一次，防并发改过）
    const fill = ecAll && !ecAll.missing ? all.flatMap((r) => {
      if ((r.definition_cn ?? '').trim()) return [];
      const e = ecAll.hit.get(r.word.toLowerCase()); const def = (e?.translation ?? '').replace(/\\n/g, '\n').replace(/\\r/g, '').trim();
      if (!def) return [];
      const ph = e?.phonetic?.trim() ? `/${e.phonetic.trim()}/` : null;
      return [{ id: r.id, def, pos: posOf(def), ph, frq: Number(e?.frq) || null }];
    }) : [];
    let filled = 0;
    if (fill.length) {
      const r = await c.query(
        `UPDATE words w SET definition_cn=t.def, pos=COALESCE(NULLIF(w.pos,''), t.pos), phonetic_uk=COALESCE(NULLIF(w.phonetic_uk,''), t.ph), phonetic_us=COALESCE(NULLIF(w.phonetic_us,''), t.ph),
                frq_rank=COALESCE(w.frq_rank, t.frq), needs_definition=false
           FROM json_to_recordset($1::json) AS t(id int, def text, pos text, ph text, frq int)
          WHERE w.id=t.id AND COALESCE(btrim(w.definition_cn),'')=''`, [JSON.stringify(fill)]);
      filled = r.rowCount ?? 0; changed += filled;
      const byId = new Map(fill.map((f) => [f.id, f])); for (const row of all) { const f = byId.get(row.id); if (f && row.frq_rank == null) row.frq_rank = f.frq; } // basic 按补上的词频排名算，一次跑完就收敛
    }
    const basicFlags = all.map((r) => ({ id: r.id, basic: isBasic(r.tags ?? [], r.frq_rank, Number(ecAll?.hit.get(r.word.toLowerCase())?.bnc) || null), was: r.basic }));
    const basicChanged = basicFlags.filter((x) => x.basic !== x.was);
    if (basicChanged.length) await c.query(`UPDATE words w SET basic=t.basic FROM json_to_recordset($1::json) AS t(id int, basic boolean) WHERE w.id=t.id`, [JSON.stringify(basicChanged)]);
    const basicCount = basicFlags.filter((x) => x.basic).length;
    changed += basicChanged.length;
    const needDef = newRows.filter((r) => r.needs_definition).length;
    const sum = {
      file, entries: list.length, bad_entries: badEntries, word_bank: db.length,
      matched: matched.size, matched_by_lemma: viaLemma, matched_by_form: matched.size - viaLemma, matched_ecdict_words: matchedEcdict, matched_exam_words: matched.size - matchedEcdict,
      unmatched: stillUnmatched.length, unmatched_below_min_freq: stillUnmatched.length - cand.length,
      candidates: cand.length, added: dry ? 0 : inserted, would_add: newRows.length, skipped_proper_nouns: skipped.length, needs_definition: needDef,
      rows_changed: changed, definitions_filled: filled, basic: basicCount, basic_changed: basicChanged.length, ecdict_missing: ec.missing,
    };
    console.log(`import:vocab${dry ? '（dry-run）' : ''}：真题词元 ${sum.entries} 个；词库 ${sum.word_bank} 词`);
    console.log(`  匹配已有单词 ${sum.matched}（词元 ${sum.matched_by_lemma}，词形 ${sum.matched_by_form}；其中之前补进来的真题词 ${sum.matched_exam_words}），本次有变化 ${changed}`);
    console.log(`  没匹配上 ${sum.unmatched}（出现 <${minFreq} 次 ${sum.unmatched_below_min_freq}，候选补词 ${sum.candidates}）`);
    if (!dry) console.log(`  补释义：之前释义为空、这次从 ECDICT 填上 ${filled} 个（已有释义的不覆盖）${ecAll?.missing ? '；⚠️ 没找到 ECDICT，没法补' : ''}`);
    if (!dry) console.log(`  基础词 basic=${basicCount}（本次改了 ${basicChanged.length}；默认不进今日新词队列）`);
    console.log(`  补词 ${dry ? `将新增 ${newRows.length}` : `新增 ${inserted}`}，跳过专有名词 ${skipped.length}，缺中文释义（needs_definition，不进学习队列）${needDef}${ec.missing ? '；⚠️ 没找到 ECDICT，新词都没有释义' : ''}`);
    if (!dry) {
      const examAll = (await c.query(`SELECT word, frequency, needs_definition FROM words WHERE source='exam' ORDER BY frequency DESC, word`)).rows;
      const L = [`# 真题词汇导入报告`, '', `- 文件：\`${file}\``, `- 时间：${new Date().toISOString()}`, '',
        '| 项 | 数 |', '|---|---|', ...Object.entries(sum).filter(([k]) => !['file'].includes(k)).map(([k, v]) => `| ${k} | ${v} |`), '',
        `## 跳过的专有名词（${skipped.length}）`, '', '| 词 | 次数 | 原因 |', '|---|---|---|', ...skipped.map((s) => `| ${s.word} | ${s.frequency} | ${s.reason} |`), '',
        `## 缺中文释义（${needDef}）`, '', ...newRows.filter((r) => r.needs_definition).map((r) => `- ${r.word}（${r.frequency} 次）`), '',
        `## 本次新增（${inserted}）`, '', newRows.map((r) => `${r.word}(${r.frequency})`).join('、'), '',
        `## 词库里全部真题补词（source=exam，${examAll.length}；needs_definition ${examAll.filter((r: any) => r.needs_definition).length}）`, '',
        examAll.map((r: any) => `${r.word}(${r.frequency}${r.needs_definition ? '，缺释义' : ''})`).join('、')];
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, L.join('\n') + '\n');
      console.log(`  报告：${path.relative(process.cwd(), reportFile)}`);
    }
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
