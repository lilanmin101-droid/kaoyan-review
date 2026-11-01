// 研习 PWA：外壳和静态资源可离线；GET 接口联网优先，断网时用上次的结果（按账号分开存）
const V = 'v1', SHELL = 'shell-' + V, ASSETS = 'assets-' + V, API = 'api-' + V
const BASE = new URL('./', self.location).href
const STATIC = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-64.png']
self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(SHELL)
  const html = await (await fetch(BASE, { cache: 'no-store' })).text()
  await c.put(BASE + 'index.html', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  await c.addAll(STATIC.slice(1).map(p => BASE + p)).catch(() => {})
  const a = await caches.open(ASSETS), urls = [...new Set(html.match(/assets\/[^"' )]+\.(?:js|css)/g) ?? [])]
  await Promise.all(urls.map(u => a.add(BASE + u).catch(() => {})))
  self.skipWaiting()
})()))
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![SHELL, ASSETS, API].includes(k)) await caches.delete(k)
  await self.clients.claim()
})()))
self.addEventListener('message', e => { if (e.data === 'clear-api') e.waitUntil(caches.delete(API)) })
const keyOf = req => { const a = req.headers.get('authorization') ?? ''; return req.url + (req.url.includes('?') ? '&' : '?') + '__u=' + a.slice(-16) }
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await withTimeout(fetch(req), 4000)
        if (r.ok) (await caches.open(SHELL)).put(BASE + 'index.html', r.clone())
        return r
      } catch { return (await caches.match(BASE + 'index.html')) ?? Response.error() }
    })())
    return
  }
  if (url.pathname.includes('/api/')) {
    if (/\/export|\/download|stream/.test(url.pathname) || req.headers.get('accept')?.includes('text/event-stream')) return
    e.respondWith((async () => {
      const c = await caches.open(API), k = keyOf(req)
      try {
        const r = await fetch(req)
        if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) c.put(k, r.clone())
        return r
      } catch (err) {
        const hit = await c.match(k)
        if (!hit) throw err
        const h = new Headers(hit.headers); h.set('x-sw-cache', '1')
        return new Response(await hit.blob(), { status: hit.status, headers: h })
      }
    })())
    return
  }
  if (url.href.startsWith(BASE + 'assets/') || /\.(png|svg|woff2?|webmanifest)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req); if (hit) return hit
      const r = await fetch(req)
      if (r.ok) (await caches.open(ASSETS)).put(req, r.clone())
      return r
    })())
  }
})
