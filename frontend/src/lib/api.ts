import { toast } from './toast'
import { ref } from 'vue'
// 统一请求层：带登录令牌和设备标记，401 时清掉令牌回到登录
const BASE = '/api/v1'
export const device = matchMedia('(max-width: 760px)').matches ? 'phone' : 'desktop'
export const token = { get: () => localStorage.getItem('token'), set: (t: string | null) => { if (t) localStorage.setItem('token', t); else { localStorage.removeItem('token'); navigator.serviceWorker?.controller?.postMessage('clear-api') } } }
export class ApiError extends Error { status: number; field?: string; code?: string; constructor(msg: string, status: number, field?: string, code?: string) { super(msg); this.status = status; this.field = field; this.code = code } }
// 前端不算「今天」，只把浏览器时区报给后端（如 America/Los_Angeles），日期由后端按账号时区算
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return '' } })()
function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', 'X-Device': device, ...(TZ ? { 'X-Timezone': TZ } : {}), ...extra }
  const t = token.get(); if (t) h.authorization = `Bearer ${t}`
  return h
}
// 断网提示：浏览器报离线，或接口是 service worker 从缓存给的
export const offline = ref(!navigator.onLine)
addEventListener('online', () => { offline.value = false }); addEventListener('offline', () => { offline.value = true })
export async function api<T = any>(path: string, init: RequestInit = {}, opts: { noReload?: boolean } = {}): Promise<T> {
  let r: Response
  try { r = await fetch(BASE + path, { ...init, headers: headers(init.headers as any) }) }
  catch { offline.value = true; throw new ApiError('现在没网，连上再试', 0, undefined, 'offline') }
  offline.value = r.headers.get('x-sw-cache') === '1'
  if (r.status === 401 && !opts.noReload) { token.set(null); location.reload() }
  if (!r.ok) {
    const j = await r.json().catch(() => ({})), m = j.message
    throw new ApiError(Array.isArray(m) ? m.join('；') : m ?? `请求失败 ${r.status}`, r.status, j.field, j.code)
  }
  return r.json()
}
// SSE（POST）：按整步回调每个事件
export async function sse(path: string, body: unknown, on: (ev: any) => void) {
  const r = await fetch(BASE + path, { method: 'POST', headers: headers({ accept: 'text/event-stream' }), body: JSON.stringify(body ?? {}) })
  if (!r.ok || !r.body) throw new ApiError(`请求失败 ${r.status}`, r.status)
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    const { value, done } = await rd.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      if (data) try { on(JSON.parse(data)) } catch { /* 忽略坏行 */ }
    }
  }
}
// 导出要等后端生成，点下去先给个「生成中」，按钮也跟着变；同一个导出生成中再点不重复发
export const downloading = ref<string | null>(null)
export async function download(path: string, filename: string) {
  if (downloading.value === path) return
  downloading.value = path; toast('正在生成，稍等几秒…')
  try {
    const r = await fetch(BASE + path, { headers: headers() })
    if (!r.ok) throw new ApiError(`导出失败 ${r.status}`, r.status)
    const url = URL.createObjectURL(await r.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: filename }); a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } finally { downloading.value = null }
}
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
