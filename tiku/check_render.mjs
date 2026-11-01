// 题目入库前的渲染与残字检查（前端规则）。用法：node check_render.mjs <题目JSON文件...>
// 输出每道有问题的题和原因；有问题时退出码为 1。
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire('/workspace/kaoyan/frontend/package.json')
const katex = require('katex')
const strip = s => s.replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, ' ')   // 去掉公式，只看正文
let bad = 0
for (const f of process.argv.slice(2)) for (const q of JSON.parse(fs.readFileSync(f))) {
  const why = []
  const parts = [['题干', q.stem ?? ''], ...(q.options ?? []).map(o => [`选项${o.key}`, o.content ?? ''])]
  for (const [where, s] of parts) {
    if ((s.match(/(?<!\\)\$/g) || []).length % 2) why.push(`${where}：$ 不成对`)
    for (const m of s.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g)) {
      try { katex.renderToString(m[1] ?? m[2], { throwOnError: true }) } catch { why.push(`${where}：公式渲染失败 ${(m[1] ?? m[2]).slice(0, 30)}`) }
    }
    const t = strip(s)
    if (/!\[[^\]]*\]\(/.test(s) && where !== '题干') why.push(`${where}：混进了图片标记`)
    if (/\n\s*\n\s*\d+\s*$/.test(s)) why.push(`${where}：末尾有分数丢失后的残数字（如「6\\n\\n1」）`)
    if (/(^|\s)\d+\s+\d+\s*\.?\s*$/.test(t) && where !== '题干') why.push(`${where}：疑似分数被拆成两个数字（如「17 2」「1 3 .」）`)
    if (/[+\-=]\s*$/.test(t.trim()) && where !== '题干') why.push(`${where}：以运算符结尾，公式可能丢了`)
    if (/^[A-Za-z]( [A-Za-z])+\s*[+\-]?\d*$/.test(t.trim())) why.push(`${where}：只剩零散字母，公式可能丢了（如「X Y+」）`)
    if (where === '题干' && /\$\s*[A-Za-z0-9]{2,}[\s\d]*$/.test(s.trim()) ) why.push('题干：最后一个公式后面有残字')
    if (!t.trim() && !/\$/.test(s)) why.push(`${where}：内容为空`)
  }
  if (/choice/.test(q.type) && (q.options ?? []).length !== 4) why.push(`选项数为 ${(q.options ?? []).length}`)
  for (const img of q.images ?? []) { const p = typeof img === 'string' ? img : img.path; if (p && !fs.existsSync(p) && !fs.existsSync(`/workspace/tiku/${p}`)) why.push(`图片不存在：${p}`) }
  if (why.length) { bad++; console.log(`${q.id}\n  - ${why.join('\n  - ')}`) }
}
console.log(bad ? `\n共 ${bad} 道题有问题` : '全部通过')
process.exit(bad ? 1 : 0)
