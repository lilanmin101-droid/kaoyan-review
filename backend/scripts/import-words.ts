/**
 * 导入 ECDICT 词库（https://github.com/skywind3000/ECDICT ，MIT）到 words 表。
 *
 *   npm run import:words -- <ecdict.csv | stardict.db> [--tags ky] [--all] [--limit N] [--dry-run]
 *
 * - 默认只导入 tag 含 ky（考研）的词；--tags ky,cet6 可换；--all 全部导入（77 万条，不建议）
 * - upsert（按 word 唯一）：音标/释义/词性/词频排名 frq_rank 用 ECDICT 覆盖；frequency（真题出现次数）和 examples 保留原值（新词 examples 为 NULL）；tags 取并集（加上 ecdict 和 ECDICT 自带的 tag）
 * - 今日新词按 frequency DESC, frq_rank ASC NULLS LAST, id 排，即先出常见词
 * - CSV 的 translation 字段里换行写成字面量 \n，这里还原成真换行；.db 用 Node 自带的 node:sqlite 读
 * - 不删除任何已有单词和学习进度
 */
import * as fs from 'fs';
import * as readline from 'readline';
import { Client } from 'pg';
import { loadEnv } from './env';

type Row = Record<string, string>;
const COLS = ['word', 'phonetic', 'definition', 'translation', 'pos', 'collins', 'oxford', 'tag', 'bnc', 'frq', 'exchange', 'detail', 'audio'];

function parseCsvLine(line: string): string[] | null {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (q) return null; // 引号没闭合：这一行还没完
  out.push(cur);
  return out;
}

async function* readCsv(file: string): AsyncGenerator<Row> {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let header: string[] | null = null, buf = '';
  for await (const line of rl) {
    buf = buf ? `${buf}\n${line}` : line;
    const f = parseCsvLine(buf);
    if (!f) continue;
    buf = '';
    if (!header) { header = f.map((h) => h.replace(/^\uFEFF/, '').trim()); continue; }
    const r: Row = {};
    header.forEach((h, i) => (r[h] = f[i] ?? ''));
    yield r;
  }
}

async function* readDb(file: string): AsyncGenerator<Row> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  const table = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('stardict','ecdict')").get() as any)?.name ?? 'stardict';
  for (const r of db.prepare(`SELECT ${COLS.join(',')} FROM ${table}`).iterate() as Iterable<any>) {
    const o: Row = {};
    for (const c of COLS) o[c] = r[c] == null ? '' : String(r[c]);
    yield o;
  }
  db.close();
}

const posOf = (tr: string) => {
  const ps = new Set<string>();
  for (const l of tr.split('\n')) { const m = /^\s*([a-z]+)\.\s/.exec(l); if (m) ps.add(`${m[1]}.`); }
  return ps.size ? [...ps].join(' ') : null;
};

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && !['--tags', '--limit'].includes(args[i - 1] ?? ''));
  if (!file) { console.error('用法：npm run import:words -- <ecdict.csv | stardict.db> [--tags ky] [--all] [--limit N] [--dry-run]'); process.exit(2); }
  if (!fs.existsSync(file)) { console.error(`找不到文件：${file}`); process.exit(2); }
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const all = args.includes('--all'), dry = args.includes('--dry-run');
  const want = (opt('--tags') ?? 'ky').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = Number(opt('--limit')) || Infinity;

  const picked: { word: string; ph: string | null; def: string | null; pos: string | null; tags: string[]; frq: number }[] = [];
  let scanned = 0;
  const src = file.endsWith('.db') || file.endsWith('.sqlite') ? readDb(file) : readCsv(file);
  for await (const r of src) {
    scanned++;
    const word = (r.word ?? '').trim();
    if (!word) continue;
    const tags = (r.tag ?? '').split(/\s+/).filter(Boolean);
    if (!all && !tags.some((t) => want.includes(t))) continue;
    const tr = (r.translation ?? '').replace(/\\n/g, '\n').replace(/\\r/g, '').trim();
    const def = tr || (r.definition ?? '').replace(/\\n/g, '\n').trim() || null;
    picked.push({ word, ph: r.phonetic?.trim() ? `/${r.phonetic.trim()}/` : null, def, pos: posOf(tr), tags: ['ecdict', ...tags], frq: Number(r.frq) || 0 });
  }
  picked.sort((a, b) => (a.frq || 1e9) - (b.frq || 1e9));
  const rows = picked.slice(0, limit === Infinity ? undefined : limit);
  console.log(`扫描 ${scanned} 条，选中 ${picked.length} 条（${all ? '全部' : `tag ∈ ${want.join(',')}`}），本次处理 ${rows.length} 条${dry ? '（dry-run，不写库）' : ''}`);
  if (dry) { console.log(rows.slice(0, 5)); return; }

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const before = (await c.query('SELECT count(*)::int n FROM words')).rows[0].n;
  let inserted = 0, updated = 0;
  try {
    for (let i = 0; i < rows.length; i += 1000) {
      const b = rows.slice(i, i + 1000);
      const r = await c.query(
        `INSERT INTO words(word, phonetic_uk, phonetic_us, definition_cn, pos, tags, frq_rank, examples)
         SELECT t.word, t.ph, t.ph, t.def, t.pos, ARRAY(SELECT json_array_elements_text(t.tags)), NULLIF(t.frq, 0), NULL
           FROM json_to_recordset($1::json) AS t(word text, ph text, def text, pos text, tags json, frq int, ord int) ORDER BY t.ord
         ON CONFLICT (word) DO UPDATE SET
           phonetic_uk = COALESCE(EXCLUDED.phonetic_uk, words.phonetic_uk),
           phonetic_us = COALESCE(EXCLUDED.phonetic_us, words.phonetic_us),
           frq_rank = EXCLUDED.frq_rank,
           definition_cn = COALESCE(EXCLUDED.definition_cn, words.definition_cn),
           pos = COALESCE(EXCLUDED.pos, words.pos),
           tags = ARRAY(SELECT DISTINCT unnest(words.tags || EXCLUDED.tags) ORDER BY 1)
         RETURNING (xmax = 0) AS inserted`,
        [JSON.stringify(b.map((x, k) => ({ ...x, ord: i + k })))]);
      for (const x of r.rows) x.inserted ? inserted++ : updated++;
      process.stdout.write(`\r已写入 ${Math.min(i + 1000, rows.length)}/${rows.length}`);
    }
  } finally {
    const after = (await c.query('SELECT count(*)::int n FROM words')).rows[0].n;
    console.log(`\n新增 ${inserted}，更新 ${updated}；words 表 ${before} → ${after} 条`);
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
