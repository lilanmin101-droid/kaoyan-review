// 隧道用的单一源站（不依赖第三方包）：静态托管 frontend/dist + 把 /api/ 转发到隧道专用后端（默认 127.0.0.1:3001）。
// PWA 需要同源的 /api，所以手机上打开的 https 地址只指向这一个端口。
//   ORIGIN_PORT=8080 ORIGIN_HOST=127.0.0.1 API_UPSTREAM=http://127.0.0.1:3001 DIST=../frontend/dist node tunnel-origin.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ORIGIN_PORT || 8080);
const HOST = process.env.ORIGIN_HOST || '127.0.0.1';
const DIST = path.resolve(process.env.DIST || path.join(here, '../frontend/dist'));
const UP = new URL(process.env.API_UPSTREAM || 'http://127.0.0.1:3001');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
};
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
// 不往上游转发的请求头：调试时钟（后端也会忽略，这里再挡一层）和逐跳头
const DROP = new Set(['x-debug-now', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC }); return res.end('not found'); }
    const base = path.basename(file);
    const cache = base === 'sw.js' || base === 'index.html' || base.endsWith('.webmanifest') ? 'no-cache'
      : file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    const h = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache, ...SEC };
    if (base === 'sw.js') h['Service-Worker-Allowed'] = '/';
    res.writeHead(200, h);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function proxy(req, res) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP.has(k.toLowerCase())) headers[k] = v;
  headers.host = UP.host;
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';
  const up = http.request({ hostname: UP.hostname, port: UP.port, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode || 502, { ...r.headers, ...SEC });
    r.pipe(res); // SSE 也直接流过去
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ statusCode: 502, message: '后端没响应，稍后再试' })); });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC); return res.end(); }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400, SEC); return res.end(); }
  const file = path.resolve(DIST, '.' + path.posix.normalize(p));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) { res.writeHead(403, SEC); return res.end(); }
  if (p === '/' || p.endsWith('/')) return sendFile(req, res, path.join(DIST, 'index.html'));
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return sendFile(req, res, file);
    // 没有扩展名的路径按 SPA 回退到 index.html（前端用 hash 路由，这里只是兜底）
    if (!path.extname(p)) return sendFile(req, res, path.join(DIST, 'index.html'));
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC }); res.end('not found');
  });
});
server.listen(PORT, HOST, () => console.log(`tunnel origin http://${HOST}:${PORT} → dist=${DIST}, /api → ${UP.origin}`));
for (const s of ['SIGTERM', 'SIGINT']) process.once(s, () => server.close(() => process.exit(0)));
