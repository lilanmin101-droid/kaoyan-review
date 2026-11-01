// 英语原文切成段：{{n}} 是完形空位，<u data-q="n">…</u> 是翻译划线句
export type Seg = { t: 'x'; v: string } | { t: 'blank'; n: number } | { t: 'u'; n: number; v: string } | { t: 'br' }
// 源文本里有排版时的硬换行（行尾断在句中、下一行小写开头），这种接成一行，免得段落参差
export const unwrap = (t: string) => t.replace(/([^\n])\n(?=[a-z(“"'‘])/g, '$1 ')
export function parseParas(txt: string): Seg[][] {
  return unwrap(txt ?? '').split(/\n\s*\n/).map(p => {
    const out: Seg[] = []
    for (const m of p.matchAll(/\{\{(\d+)\}\}|<u data-q="(\d+)">([\s\S]*?)<\/u>|([^{<]+|[{<])/g)) {
      if (m[1]) out.push({ t: 'blank', n: +m[1] })
      else if (m[2]) out.push({ t: 'u', n: +m[2], v: m[3] })
      else m[4].split('\n').forEach((s, i) => { if (i) out.push({ t: 'br' }); if (s) out.push({ t: 'x', v: s }) })
    }
    return out
  })
}
export const enWords = (s = '') => (s.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length
