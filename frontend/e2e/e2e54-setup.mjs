// e2e54 的数据准备（真后端 :3000，只动 token 对应的那个测试号）：用法 node e2e/e2e54-setup.mjs
// token 读 E2E_TOKEN_FILE（默认 /tmp/fe-tok）；测试号自己注册，密码不要写进任何文件
// 先建数一 2022（证明题 20 整题评「思路对，算错了」，计算题 21 按小问评 (1)全对 (2)没思路、(3) 不评，17 整题全对，其余待评），
// 再建英一 2022（46/51 写得很短仍评「基本到位」→ 后端标 word_count_low；47 正常评；52 不评，待自评 20 分）。英一后建，今日页待自评卡指向它
// 打印两个考试 id：E2E_EXAM=<英一> E2E_MATH=<数一> node e2e/e2e54.mjs <宽度>
import fs from 'fs'
const API=process.env.E2E_API||'http://localhost:3000/api/v1',tok=fs.readFileSync(process.env.E2E_TOKEN_FILE||'/tmp/fe-tok','utf8').trim()
const j=async(u,o={})=>{const r=await fetch(API+u,{...o,headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json','X-Timezone':'Asia/Shanghai'}});const t=await r.text();if(!r.ok)throw new Error(`${u} ${r.status} ${t.slice(0,200)}`);return t?JSON.parse(t):null}
const a0=(await j('/exams/active')).exam;if(a0)await j(`/exams/${a0.id}/abandon`,{method:'POST'})
async function make(exam,answers,self_ratings){const e=await j('/exams',{method:'POST',body:JSON.stringify({exam,year:2022,duration_minutes:180})})
 const id=n=>e.question_ids.find(x=>x.endsWith('-'+n))
 const A=Object.entries(answers).map(([n,v])=>({question_id:id(n),answer:[v]}))
 await j(`/exams/${e.id}/progress`,{method:'PUT',body:JSON.stringify({client_seq:1,idempotency_key:'e2e54-'+Date.now(),answers:A})})
 const s=await j(`/exams/${e.id}/submit`,{method:'POST',body:JSON.stringify({self_ratings:Object.fromEntries(Object.entries(self_ratings).map(([n,v])=>[id(n),v]))})})
 return s}
const m=await make('math1',{17:'略',18:'略',20:'证明略',21:'略'},{17:'full',20:'approach_ok_calc_wrong',21:{1:'full',2:'no_idea'}})
const e=await make('english1',{46:'这是一场较量',47:'它列出了许多从西班牙法军手中缴获的密码文件，这些文件的秘密由英国司令部的一名军官乔治·斯科韦尔破解。',51:'Dear Professor, please come.',52:'Short essay.'},{46:'full',47:'full',51:'full'})
const brief=s=>s.result.per_question.filter(p=>p.self_rating||p.sub_scores?.length||p.self_grade_flags?.length||s.result.pending_self_rating.includes(p.question_id)).map(p=>({q:p.question_id.slice(-2),sr:p.self_rating??null,subs:p.sub_scores?.map(x=>x.self_rating),flags:p.self_grade_flags,got:p.got}))
console.log('math',m.id,JSON.stringify(brief(m)))
console.log('english',e.id,JSON.stringify(brief(e)))
console.log(`E2E_EXAM=${e.id} E2E_MATH=${m.id}`)
