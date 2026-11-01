import * as fs from 'fs';
import * as path from 'path';
import { parseAt } from '../common/time';

/**
 * 讲解核对记录（只读）：$REVIEWS_DIR 或 $ASSETS_DIR/reviews 下的 explanations_<exam>_<year>.jsonl。
 * 两种格式都认：
 *   2023：{id, kind: "official_solution"|"expert"|…, result: pass|fail, by, note, at}
 *   2024：{id, verdict: pass|pass_minor|fail, category?, by, at, note?}（没有 kind）
 * 规范化：结果 = result || verdict；pass / pass_minor = 已核对，fail = 未通过。
 * kind 缺省时按题推断：有专家讲解且没有官方解析 → expert，否则 official_solution。
 * 同一 (id, kind) 取 at 最晚的一条（at 用 parseAt，裸时间按太平洋时间；同一时刻取文件里靠后的一行）。
 * 按文件名+mtime+大小缓存，文件改了下次请求自动重读。
 */
export type ReviewKind = 'official_solution' | 'expert' | string;
export interface ExplanationReview { id: string; kind: ReviewKind | null; verdict: string; pass: boolean; by?: string; note?: string; at?: string; atMs: number; seq: number; file: string }

export function reviewsDir() {
  return process.env.REVIEWS_DIR || path.join(process.env.ASSETS_DIR || '/workspace/kaoyan/tiku', 'reviews');
}

function normKind(k: any): ReviewKind | null {
  if (k == null || String(k).trim() === '') return null;
  const s = String(k).trim().toLowerCase();
  if (/expert/.test(s)) return 'expert';
  if (/official|solution/.test(s)) return 'official_solution';
  return s;
}

let cache: { key: string; byId: Map<string, ExplanationReview[]> } | null = null;

export function explanationReviews(): Map<string, ExplanationReview[]> {
  const dir = reviewsDir();
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => /^explanations_.+\.jsonl$/.test(f)).sort(); } catch { files = []; }
  const key = files.map((f) => { try { const st = fs.statSync(path.join(dir, f)); return `${f}:${st.mtimeMs}:${st.size}`; } catch { return f; } }).join('|');
  if (cache && cache.key === key) return cache.byId;
  const byId = new Map<string, ExplanationReview[]>();
  let seq = 0;
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim() || line.trim().startsWith('//')) continue;
      try {
        const d = JSON.parse(line);
        const verdict = String(d.result ?? d.verdict ?? '').trim().toLowerCase();
        if (!d.id || !verdict) continue;
        const atMs = typeof d.at === 'string' ? parseAt(d.at) : NaN;
        const r: ExplanationReview = { id: d.id, kind: normKind(d.kind), verdict, pass: verdict === 'pass' || verdict === 'pass_minor', by: d.by, note: d.note || undefined, at: d.at, atMs: Number.isNaN(atMs) ? -Infinity : atMs, seq: seq++, file: f };
        (byId.get(d.id) ?? byId.set(d.id, []).get(d.id)!).push(r);
      } catch { /* 坏行跳过 */ }
    }
  }
  cache = { key, byId };
  return byId;
}

/** 某题某类讲解的最新核对结论；没有记录返回 null（= 未核对） */
export function latestReview(id: string, kind: 'official_solution' | 'expert', ctx: { hasExpert: boolean; hasSolution: boolean }): ExplanationReview | null {
  const inferred = ctx.hasExpert && !ctx.hasSolution ? 'expert' : 'official_solution';
  const list = (explanationReviews().get(id) ?? []).filter((r) => (r.kind ?? inferred) === kind);
  if (!list.length) return null;
  return list.reduce((a, b) => (b.atMs > a.atMs || (b.atMs === a.atMs && b.seq > a.seq) ? b : a));
}
