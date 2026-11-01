import * as fs from 'fs';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';

/** 题目图片目录（题目 JSON 所在目录），图片在 Markdown 里写成相对路径，如 images/math1-2024-05-fig1.png */
export const ASSETS_DIR = path.resolve(process.env.ASSETS_DIR || '/workspace/kaoyan/tiku');
export const ASSETS_PREFIX = '/api/v1/assets/';
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

/**
 * GET /api/v1/assets/<相对 ASSETS_DIR 的路径>：只放图片，不需要登录（<img> 带不了 token），禁止 .. 和隐藏文件。
 */
export function assetsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let rel: string;
  try { rel = decodeURIComponent(req.path.replace(/^\/+/, '')); } catch { return res.status(400).json({ statusCode: 400, message: '路径不合法' }); }
  const file = path.resolve(ASSETS_DIR, rel);
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!rel || !file.startsWith(ASSETS_DIR + path.sep) || rel.split('/').some((s) => s.startsWith('.')) || !type)
    return res.status(404).json({ statusCode: 404, message: '没有这张图片', error: 'Not Found' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.status(404).json({ statusCode: 404, message: '没有这张图片', error: 'Not Found' });
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Last-Modified', st.mtime.toUTCString());
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/** 题目里图片相对路径的前缀：题目 JSON 所在目录相对 ASSETS_DIR，例如 /api/v1/assets/ 或 /api/v1/assets/eng1/ */
export function assetBaseFor(source: any): string {
  const dir = source?.assets_dir ? path.resolve(source.assets_dir) : ASSETS_DIR;
  const rel = path.relative(ASSETS_DIR, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return ASSETS_PREFIX;
  return ASSETS_PREFIX + (rel ? rel.split(path.sep).map(encodeURIComponent).join('/') + '/' : '');
}
