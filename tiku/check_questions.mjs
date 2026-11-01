// 入库前质检：KaTeX 渲染 + 残字/图片规则。用法：node check_questions.mjs math1_2024.json [...]
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire('/workspace/kaoyan/frontend/package.json');
const katex = require('katex');
const RULES = [
  [/\d+\s+\d+(?![^$]*\$)/, '公式外有空格隔开的数字（分数丢失，如「6 1」「17 2」）'],
  [/[\uE000-\uF8FF]/, 'PDF 符号字体私用区字符（渲染成空框）'],
  [/!\[[^\]]*\]\(/, '文本里混进图片标记'],
  [/\b[A-Za-z]\s[A-Za-z][+\-−]/, '公式外的残片（如「X Y+」）'],
  [/\\tiny|\\hat\s*\{\s*\\prod/, 'OCR 乱码公式'],
  [/[=.。，,]\s*[\d.−\-][\d\s.−\-]{0,7}[A-Za-z]?\s*$/, '末尾疑似残字'],
  [/[\u4e00-\u9fff] [\u4e00-\u9fff] [\u4e00-\u9fff]/, '汉字之间多了空格（如「简 单 随 机」）'],
  [/（\d）\s*[.．]\s*($|\n)/, '小问编号后只剩句点的残片'],
  [/\n\s*[\w.−\-]{1,6}\s*$/, '末尾单独一行残字'],
];
const OPT_RULE=[/[0-9A-Za-z][^\u4e00-\u9fff]*$/, '选项里有没放进 $ 的数学内容（应为 LaTeX）'];
function stripMath(t){ return t.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g,' ') }
function mathSegs(t){ const out=[]; t.replace(/\$\$([\s\S]*?)\$\$|\$([^$]*)\$/g,(m,a,b)=>{out.push({tex:a??b,display:a!=null})}); return out }
let total=0;
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(fs.readFileSync(f,'utf8')); const qs = Array.isArray(d)?d:d.questions;
  for (const q of qs) {
    const texts = [['题干',q.stem], ...(q.options||[]).map(o=>[`选项${o.key}`,o.content]),
      ...(q.answer||[]).map((a,i)=>[`答案${i+1}`,a]),
      ...(q.sub_questions||[]).flatMap(s=>[[`小问${s.number}题干`,s.stem],...(s.answer||[]).map(a=>[`小问${s.number}答案`,a])]),
      ...(q.solution?[['解析',q.solution]]:[])];
    const probs=[];
    for (const [where,t] of texts) { if(!t) continue;
      if ((t.match(/\$/g)||[]).length%2) probs.push(`${where}：$ 不成对`);
      for (const s of mathSegs(t)) { try { katex.renderToString(s.tex,{throwOnError:true,displayMode:s.display,strict:'ignore'}) } catch(e){ probs.push(`${where}：KaTeX 报错 ${e.message.slice(0,80)}`) } }
      const plain = stripMath(t);
      if (where.startsWith('选项') && !t.includes('$') && OPT_RULE[0].test(t)) probs.push(`${where}：${OPT_RULE[1]}`);
      for (const [re,msg] of RULES) if (re.test(plain)) { if(where.startsWith('答案')||where.includes('解析')) { if(msg.includes('私用区')) probs.push(`${where}：${msg}`) } else probs.push(`${where}：${msg}`) }
    }
    for (const m of JSON.stringify([q.solution||'']).matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)) if (!fs.existsSync(path.join(path.dirname(path.resolve(f)),m[1]))) probs.push(`解析图片不存在：${m[1]}`);
    for (const img of q.images||[]) if (!fs.existsSync(path.join(path.dirname(path.resolve(f)),img))) probs.push(`图片不存在：${img}`);
    if (q.type==='single_choice' && /[，,]\s*$/.test(q.stem)) probs.push('选择题题干以逗号结尾，可能漏了「则」');
    if (/[（(]\s*$/.test(q.stem)) probs.push('题干以半个括号结尾');
    if (q.type==='single_choice' && (q.options||[]).length!==4) probs.push(`选择题选项数=${(q.options||[]).length}`);
    if (!q.answer || !q.answer.length) probs.push('缺答案');
    if (q.type==='essay' && !(q.sub_questions||[]).length) probs.push('大题缺 sub_questions（每小问的最终结论）');
    for (const s of q.sub_questions||[]) if (!s.answer || !s.answer.length || !String(s.answer[0]).trim()) probs.push(`小问${s.number}缺最终答案`);
    if (probs.length){ total++; console.log(`${q.id} [${q.review?.status}]`); probs.forEach(p=>console.log('   - '+p)) }
  }
}
console.log(total?`\n共 ${total} 道题有问题`:'全部通过'); process.exit(total?1:0);
