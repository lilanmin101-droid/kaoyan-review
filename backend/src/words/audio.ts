import * as fs from 'fs';
import * as path from 'path';

/**
 * 单词发音：第一次从有道 dictvoice 取 mp3（type=2 美音，type=1 英音），存到磁盘，之后只读本地文件，不再联网。
 * 缓存目录 AUDIO_DIR（默认 /workspace/kaoyan/data/audio；题库目录 /workspace/kaoyan/tiku 只读，不往里写），
 * 文件 <AUDIO_DIR>/<accent>/<word>.mp3（word 小写、URL 编码，防目录穿越）。
 */
export type Accent = 'us' | 'uk';
export const ACCENTS: Accent[] = ['us', 'uk'];
export const AUDIO_DIR = path.resolve(process.env.AUDIO_DIR || path.join(__dirname, '..', '..', '..', '..', 'data', 'audio'));
const UPSTREAM = process.env.AUDIO_UPSTREAM || 'https://dict.youdao.com/dictvoice';
const TIMEOUT_MS = Number(process.env.AUDIO_TIMEOUT_MS || 8000);

export const audioUrl = (id: number | string, accent: Accent) => `/api/v1/words/${id}/audio?accent=${accent}`;
export const withAudioUrls = <T extends { id: number | string }>(w: T) => ({ ...w, audio_url_us: audioUrl(w.id, 'us'), audio_url_uk: audioUrl(w.id, 'uk') });

export function audioPath(word: string, accent: Accent) {
  const name = encodeURIComponent(word.trim().toLowerCase()).replace(/\./g, '%2E');
  return path.join(AUDIO_DIR, accent, `${name}.mp3`);
}

export class AudioUpstreamError extends Error {
  constructor(message: string, public detail?: any) { super(message); }
}

const inflight = new Map<string, Promise<string>>();

/** 返回本地 mp3 路径；本地没有就去有道取一次（同一个词并发请求只取一次） */
export async function ensureAudio(word: string, accent: Accent): Promise<{ file: string; cached: boolean }> {
  const file = audioPath(word, accent);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return { file, cached: true };
  let p = inflight.get(file);
  if (!p) {
    p = download(word, accent, file).finally(() => inflight.delete(file));
    inflight.set(file, p);
  }
  await p;
  return { file, cached: false };
}

async function download(word: string, accent: Accent, file: string): Promise<string> {
  const url = `${UPSTREAM}?audio=${encodeURIComponent(word.trim())}&type=${accent === 'us' ? 2 : 1}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'Mozilla/5.0 (kaoyan personal study app)' } });
  } catch (e: any) {
    throw new AudioUpstreamError(`有道发音请求失败：${e?.name === 'TimeoutError' ? '超时' : e?.message ?? e}`);
  }
  if (!res.ok) throw new AudioUpstreamError(`有道发音返回 HTTP ${res.status}`, { status: res.status });
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  // 有道对查不到的词有时返回空内容或 HTML，不能当 mp3 缓存
  if (!/audio|mpeg|octet-stream/.test(type) || buf.length < 500) throw new AudioUpstreamError(`有道发音没有返回音频（${type || '无类型'}，${buf.length} 字节）`, { content_type: type, bytes: buf.length });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  return file;
}
