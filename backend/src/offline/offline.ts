import { createHash } from 'crypto';

/** 离线补传的作答时间最多往回 7 天（统筹者定） */
export const MAX_BACKDATE_DAYS = 7;
export const ANSWER_SOURCES = ['online', 'offline_pack'] as const;
export const BATCH_LIMIT = 200;

/** client_id：推荐 uuid；前端老的 uid()（base36）也收。1–128 位字母数字或 _ . : - */
export const isValidClientId = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(s);

/**
 * 客户端作答时间夹到 [now − 7 天, now]。now = 服务器「现在」（非生产环境跟 X-Debug-Now）。
 * 没带 → now；带了但解析不了 → error。
 */
export function clampAnsweredAt(raw: string | null | undefined, now: Date):
  { at: Date; clamped: null | { from: string; to: string; reason: 'future' | 'too_old' }; error?: 'bad_answered_at' } {
  if (raw == null || raw === '') return { at: now, clamped: null };
  const t = Date.parse(String(raw));
  if (!Number.isFinite(t)) return { at: now, clamped: null, error: 'bad_answered_at' };
  const min = now.getTime() - MAX_BACKDATE_DAYS * 86400000;
  if (t > now.getTime()) return { at: new Date(now), clamped: { from: String(raw), to: now.toISOString(), reason: 'future' } };
  if (t < min) return { at: new Date(min), clamped: { from: String(raw), to: new Date(min).toISOString(), reason: 'too_old' } };
  return { at: new Date(t), clamped: null };
}

/** 稳定的 JSON（键排序），给版本哈希用 */
export function stableJson(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const packVersion = (content: any) => createHash('sha256').update(stableJson(content)).digest('hex').slice(0, 16);

/** 题目 / 文章里要预缓存的图片：images 字段 + Markdown ![](相对路径)，拼上 asset_base；外链和 data: 不要 */
export function assetUrls(base: string, images: any, ...texts: any[]): string[] {
  const out = new Set<string>();
  const add = (p: any) => {
    const s = String(p ?? '').trim();
    if (!s || /^(https?:|data:)/i.test(s)) return;
    out.add(s.startsWith('/api/v1/assets/') ? s : base + s.replace(/^\.?\//, ''));
  };
  for (const im of Array.isArray(images) ? images : []) add(typeof im === 'string' ? im : im?.src ?? im?.path);
  const walk = (t: any) => {
    if (typeof t === 'string') for (const m of t.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g)) add(m[1]);
    else if (Array.isArray(t)) t.forEach(walk);
    else if (t && typeof t === 'object') Object.values(t).forEach(walk);
  };
  texts.forEach(walk);
  return [...out];
}

/** 当地下一个 04:00（题包过期时间）由调用方用 startOfStudyDay(addDays(today,1)) 算；这里只把讲解步骤拼成纯文本 */
export const stepsText = (steps: { text: string }[] | null | undefined) => (steps?.length ? steps.map((s) => s.text).join('\n\n') : null);
