import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { loadEnv } from './env';

/** SQL 迁移：按文件名顺序执行 migrations/*.sql，记录在 schema_migrations。002_pgvector 在扩展不可用时跳过。 */
async function main() {
  loadEnv();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.resolve(__dirname, '../../migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) { console.log(`skip  ${f} (already applied)`); continue; }
    if (f.includes('pgvector')) {
      const r = await client.query(`SELECT 1 FROM pg_available_extensions WHERE name='vector'`);
      if (!r.rowCount) { console.warn(`skip  ${f} (pgvector not installed on this server; will apply once available)`); continue; }
    }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log(`apply ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
