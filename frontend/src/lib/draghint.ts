// 宽公式第一次出现时提示「← 可左右拖动」；用户拖过一次（或看到过）以后不再出现
const KEY = 'hint:drag'
export function dragHint(root: ParentNode = document) {
  if (localStorage.getItem(KEY) || root.querySelector('.draghint')) return
  const el = [...root.querySelectorAll<HTMLElement>('.katex-display, .tall, .wide')].find(e => e.scrollWidth > e.clientWidth + 4 && e.offsetParent)
  if (!el) return
  const tip = document.createElement('div')
  tip.className = 'draghint'; tip.textContent = '← 公式较宽，可左右拖动'
  el.after(tip)
  const done = () => { localStorage.setItem(KEY, '1'); tip.classList.add('gone'); setTimeout(() => tip.remove(), 400); el.removeEventListener('scroll', done) }
  el.addEventListener('scroll', done, { passive: true })
  // 看到过就算：8 秒后自己淡出，下次不再出现
  // 真正滚到眼前才开始计时，免得没看到就算看过
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); setTimeout(() => { if (tip.isConnected) done() }, 8000) } })
  io.observe(tip)
}
