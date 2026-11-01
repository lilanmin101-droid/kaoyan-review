// 新版本：新的 service worker 装好后先等着，学生点「更新」才切换并刷新
import { ref } from 'vue'
export const updReady = ref(false)
let waiting: ServiceWorker | null = null
// 最近 2 分钟在选项、输入框上动过，就算作答中，先不弹
export const lastInput = ref(0)
export function installUpdate() {
  if (!('serviceWorker' in navigator)) return
  const mark = (e: Event) => { const t = e.target as HTMLElement | null; if (t?.closest?.('input,textarea,.op,.opts,.chips,.rates')) lastInput.value = Date.now() }
  addEventListener('pointerdown', mark, true); addEventListener('input', mark, true)
  addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('./sw.js').catch(() => null); if (!reg) return
    const found = (w: ServiceWorker | null) => { if (w && navigator.serviceWorker.controller) { waiting = w; updReady.value = true } }
    found(reg.waiting)
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed') found(w) }) })
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && waiting) { reloading = true; location.reload() } })
    const check = () => reg.update().catch(() => {})
    setInterval(check, 30 * 60 * 1000); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  })
}
export function applyUpdate() { if (waiting) waiting.postMessage('skip-waiting'); else location.reload() }
