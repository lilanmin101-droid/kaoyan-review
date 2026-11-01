/**
 * 预取单词发音到本地缓存（之后播放不再联网）：
 *   npm run audio:prefetch -- --limit 200 [--accent us|uk|both] [--user <username>] [--concurrency 3]
 * 取词顺序：指定 --user 时先取该用户今天到期复习的词，再按新词顺序（frequency DESC, frq_rank ASC）补足 limit；已缓存的跳过。
 */
import { Client } from 'pg';
import { loadEnv } from './env';
import { ACCENTS, Accent, AUDIO_DIR, audioPath, ensureAudio } from '../src/words/audio';
import * as fs from 'fs';

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  loadEnv();
  const limit = Number(arg('limit', '200'));
  const acc = arg('accent', 'both')!;
  const accents: Accent[] = acc === 'both' ? ACCENTS : [acc as Accent];
  if (!accents.every((a) => ACCENTS.includes(a))) throw new Error('--accent 只能是 us / uk / both');
  const conc = Math.max(1, Math.min(Number(arg('concurrency', '3')), 8));
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const user = arg('user');
  const words: { id: number; word: string }[] = [];
  if (user) {
    words.push(...(await db.query(
      `SELECT w.id, w.word FROM word_progress wp JOIN words w ON w.id=wp.word_id JOIN users u ON u.id=wp.user_id
        WHERE u.username=$1 AND wp.due_at <= now() + interval '1 day' ORDER BY wp.due_at LIMIT $2`, [user, limit])).rows);
  }
  const seen = new Set(words.map((w) => w.id));
  if (words.length < limit) {
    for (const r of (await db.query(`SELECT id, word FROM words ORDER BY frequency DESC, frq_rank ASC NULLS LAST, id LIMIT $1`, [limit * 2])).rows)
      if (!seen.has(r.id) && words.length < limit) { words.push(r); seen.add(r.id); }
  }
  await db.end();
  const jobs = words.flatMap((w) => accents.map((a) => ({ ...w, accent: a })));
  let hit = 0, fetched = 0, failed = 0;
  const fails: string[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      if (fs.existsSync(audioPath(j.word, j.accent))) { hit++; continue; }
      try { await ensureAudio(j.word, j.accent); fetched++; await new Promise((r) => setTimeout(r, 150)); }
      catch (e: any) { failed++; if (fails.length < 10) fails.push(`${j.word}/${j.accent}: ${e.message}`); }
    }
  }));
  console.log(`audio:prefetch ${words.length} 个词 × ${accents.join('+')}：已有 ${hit}，新取 ${fetched}，失败 ${failed}（缓存目录 ${AUDIO_DIR}）`);
  for (const f of fails) console.log('  失败', f);
}
main().catch((e) => { console.error(e); process.exit(1); });
