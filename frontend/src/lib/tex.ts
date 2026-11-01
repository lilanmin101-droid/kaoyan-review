import katex from 'katex'
// 把含 $...$ / $$...$$ 的题干渲染成 HTML；渲染失败的公式原样标红，并记录下来
export function renderTex(src: string, onError?: (tex: string) => void): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
  const toks: { k: 't' | 'd' | 'i'; v: string }[] = []
  for (const m of src.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$|([^$]+)/g))
    toks.push(m[1] !== undefined ? { k: 'd', v: m[1] } : m[2] !== undefined ? { k: 'i', v: m[2] } : { k: 't', v: m[3] })
  return toks.map((t, j) => {
    if (t.k === 't') {
      let s = t.v
      // 独立公式本身占一行，紧挨着它的换行去掉，免得上下空出一大块
      if (toks[j - 1]?.k === 'd') s = s.replace(/^\s+/, '')
      if (toks[j + 1]?.k === 'd') s = s.replace(/\s+$/, '')
      return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    }
    try {
      const html = katex.renderToString(t.v, { displayMode: t.k === 'd', throwOnError: true })
      // 行内的矩阵、分段函数会撑高整行：单独包一层，上下留等距空白
      return t.k === 'i' && /\\begin\{/.test(t.v) ? `<span class="tall">${html}</span>` : html
    } catch { onError?.(t.v); return `<span class="tex-err">${esc(t.v)}</span>` }
  }).join('')
}

// 题干里的 {{table:n}} 换成表格（tables[n] = {caption, header, rows}），其余部分照常渲染公式
export type StemTable = { caption?: string; header?: string[]; rows: (string | number)[][] }
export function renderStem(src: string, tables?: StemTable[] | null, onError?: (tex: string) => void, plain = false): string {
  if (!src) return ''
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const used = new Set<number>()
  const tbl = (i: number) => {
    const t = tables?.[i]; if (!t) return `<span class="tex-err">[表格 ${i + 1} 缺失]</span>`
    used.add(i)
    return `<div class="stbl"><table>${t.caption ? `<caption>${esc(t.caption)}</caption>` : ''}${t.header?.length ? `<thead><tr>${t.header.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  }
  const parts = src.split(/\{\{table:(\d+)\}\}/)
  let html = parts.map((p, i) => i % 2 ? tbl(+p) : plain ? esc(p.replace(/^\n+/, i ? '' : '$&').replace(/\n+$/, i < parts.length - 1 ? '' : '$&')).replace(/\n/g, '<br>') : renderTex(p.replace(/^\n+/, i ? '' : '$&').replace(/\n+$/, i < parts.length - 1 ? '' : '$&'), onError)).join('')
  // 题干没写占位符、但带了表格：放在末尾
  tables?.forEach((_, i) => { if (!used.has(i)) html += tbl(i) })
  return html
}
