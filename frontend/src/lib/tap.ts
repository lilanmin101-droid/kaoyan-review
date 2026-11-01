// 统一点选：所有可点的东西（选项、自评、按钮、链接、题号）都走这里
// - 按下立刻加 .tap-down（视觉反馈），不等 click
// - 抬起就触发，用按下时的那个元素：中间输入框失焦、保存提示把页面挤动了也不会落空
// - 手机去掉点击延迟；滑动（移动 > 10px 或浏览器接管滚动）不算点
// - 浏览器随后补发的原生 click 吞掉，避免点两次
const SEL = '.bigbtn,.o,.chip,.next,.link,.cell,.flag,.more,.hrow,.seg span,.tabs a,.nav a,[data-tap],.acts span,.tap'
const SKIP = 'input,textarea,select,label,[contenteditable],.no-tap'
let down: { el: HTMLElement; x: number; y: number; id: number } | null = null
let swallowUntil = 0
export function installTap() {
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !(e.target instanceof Element)) return
    if (e.target.closest(SKIP)) return
    const el = e.target.closest(SEL) as HTMLElement | null
    if (!el) { down = null; return }
    down = { el, x: e.clientX, y: e.clientY, id: e.pointerId }
    el.classList.add('tap-down')
  }, { capture: true, passive: true })
  const clear = () => { const el = down?.el; down = null; if (el) setTimeout(() => el.classList.remove('tap-down'), 120) }
  document.addEventListener('pointermove', e => {
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) clear()
  }, { capture: true, passive: true })
  document.addEventListener('pointercancel', clear, { capture: true })
  document.addEventListener('pointerup', e => {
    if (!down || e.pointerId !== down.id) return
    const el = down.el; clear()
    if (!el.isConnected) return
    swallowUntil = Date.now() + 700
    el.click() // 合成 click，Vue 的 @click 照常收到
  }, { capture: true })
  document.addEventListener('click', e => {
    // 原生 click（isTrusted）在我们已经触发过之后到来：吞掉；键盘回车/空格的 click（detail 0）照常放行
    if (e.isTrusted && e.detail !== 0 && Date.now() < swallowUntil) { e.stopImmediatePropagation(); e.preventDefault(); swallowUntil = 0 }
  }, { capture: true })
}
