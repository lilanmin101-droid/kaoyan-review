// e2e54：英语自评「自评·字数不足」换设备、去自评高亮、自评页回填后端档位（证明题整题 / 计算题按小问）
// 用法（在 frontend/ 下）：先自己注册测试号、token 写到 /tmp/fe-tok（密码不要写进任何文件），
//   node e2e/e2e54-setup.mjs  → 打印 E2E_EXAM=<英一> E2E_MATH=<数一>
//   E2E_EXAM=<id> [E2E_MATH=<id>] node e2e/e2e54.mjs <宽度> [base]   默认 base=http://localhost:4180（vite preview，API_TARGET=:3000），token 读 E2E_TOKEN_FILE（默认 /tmp/fe-tok）
// 不给 E2E_EXAM 时退回 mock 模式：用请求拦截造一场英一成绩（只测 a、b、c 的英语部分）
// 注意：带 E2E_MATH 时会给那场数一补评第 18 题，同一场只能完整跑一次，重跑先 setup
import puppeteer from 'puppeteer-core';import fs from 'fs'
const W=+process.argv[2],BASE=process.argv[3]||'http://localhost:4180',S=ms=>new Promise(r=>setTimeout(r,ms)),OUT='/workspace/kaoyan-ui'
const REAL=!!process.env.E2E_EXAM
const TOK=REAL?fs.readFileSync(process.env.E2E_TOKEN_FILE||'/tmp/fe-tok','utf8').trim():'e2e54-mock-token'
const EID=process.env.E2E_EXAM||'e2e54-eng1-2022',Y=2022,ID=n=>`english1-${Y}-${String(n).padStart(2,'0')}`
const bank=JSON.parse(fs.readFileSync(new URL('../../tiku/english1_2022.json',import.meta.url)))
const qids=[ID(1),ID(46),ID(47),ID(51),ID(52)]
const ans={[ID(1)]:['A'],[ID(46)]:['这是一场较量'],[ID(47)]:['它列出了许多从西班牙法军缴获的密码文件，其秘密由英国司令部的军官乔治·斯科韦尔破解。'],[ID(51)]:['Dear Professor, please come.'],[ID(52)]:['Short essay.']}
const pq=[
 {question_id:ID(1),number:1,section:'完形填空',type:'single_choice',objective:true,score:0.5,got:0.5,is_correct:true,answer:['A'],answered:true,time_spent_seconds:30},
 {question_id:ID(46),number:46,section:'翻译',type:'translation',objective:false,score:2,got:2,self_rating:'full',answer:ans[ID(46)],answered:true,unanswered:false,word_count:6,min_words:14,self_grade_flags:['word_count_low'],time_spent_seconds:60},
 {question_id:ID(47),number:47,section:'翻译',type:'translation',objective:false,score:2,got:2,self_rating:'full',answer:ans[ID(47)],answered:true,unanswered:false,word_count:40,min_words:18,self_grade_flags:[],time_spent_seconds:60},
 {question_id:ID(51),number:51,section:'小作文',type:'essay',objective:false,score:10,got:10,self_rating:'full',answer:ans[ID(51)],answered:true,unanswered:false,word_count:4,min_words:50,self_grade_flags:['word_count_low'],time_spent_seconds:60},
 {question_id:ID(52),number:52,section:'大作文',type:'essay',objective:false,score:20,got:null,answer:ans[ID(52)],answered:true,unanswered:false,word_count:2,min_words:80,self_grade_flags:[],time_spent_seconds:60}]
const result={score:14.5,max_score:34.5,score_rate:0.42,per_question:pq,pending_self_rating:[ID(52)],pending_points:20,sections:[],subjects:[],lost_by_kp:[],conclusions:['得分 14.5/34.5。'],coach:null,wrong_question_ids:[]}
const exam={id:EID,kind:'paper',title:`${Y} 英语一`,exam:'english1',exam_name:'英语一',year:Y,question_ids:qids,question_count:5,max_score:34.5,status:'submitted',score:14.5,duration_seconds:10800,elapsed_seconds:3600,remaining_seconds:7200,pause_count:0,paused_seconds:0,auto_submitted:false,non_continuous:false,counts_in_trend:true,server_time:new Date().toISOString(),started_at:'2026-11-01T02:00:00Z',submitted_at:'2026-11-01T03:00:00Z',started_date:'2026-11-01',submitted_date:'2026-11-01',
 progress:{answers:Object.fromEntries(Object.entries(ans).map(([k,v])=>[k,{answer:v,time_spent_seconds:60,flagged:false}])),current_question_id:ID(52),last_client_seq:5},result,pending_self_rating_count:1}
const listItem={...exam,progress:undefined,result:undefined}
const qitems=bank.filter(q=>qids.includes(q.id)).map(q=>({...q,reference_answer:q.answer?.[0]??null}))
const hits={exam:0,list:0,q:0}
async function stub(p){if(REAL)return;await p.setRequestInterception(true);p.on('request',r=>{const u=new URL(r.url());const path=u.pathname,J=b=>r.respond({status:200,contentType:'application/json',body:JSON.stringify(b)})
 if(r.method()==='GET'&&path===`/api/v1/exams/${EID}`){hits.exam++;return J(exam)}
 if(r.method()==='GET'&&path==='/api/v1/exams'){hits.list++;return J({items:[listItem]})}
 if(r.method()==='GET'&&path==='/api/v1/exams/active')return J({exam:null})
 if(r.method()==='GET'&&path==='/api/v1/questions'&&u.searchParams.get('exam')==='english1'){hits.q++;return J({items:qitems,total:qitems.length,page:1,page_size:100})}
 r.continue()})}
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
let fails=0;const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++}
async function fresh(localExtra={}){const ctx=await b.createBrowserContext();const p=await ctx.newPage();p.on('pageerror',e=>console.log('ERR',e.message))
 if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
 await stub(p);await p.goto(BASE+'/');await p.evaluate((t,x)=>{localStorage.clear();localStorage.setItem('token',t);for(const[k,v]of Object.entries(x))localStorage.setItem(k,v)},TOK,localExtra);return{ctx,p}}
const tap=async(p,e)=>{await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(250);const bb=await e.boundingBox();W<500?await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2):await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)}
const nav=async(p,h)=>{await p.goto(BASE+'/'+h);await p.reload();await S(2800)}
const openEach=async p=>{if(!(await p.$('table.each'))){const b=(await p.$$('.bigbtn.sm'))[0];console.log('  展开',await b.evaluate(e=>e.textContent));await tap(p,b);await S(600)}else console.log('  逐题对照默认已展开')}
const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)

// ---------- (a) 全新配置打开成绩页 ----------
{const{ctx,p}=await fresh();const ls=await p.evaluate(()=>Object.keys(localStorage));console.log('[a] 打开前 localStorage keys',JSON.stringify(ls));await nav(p,`#/exam/${EID}/result`)
 ok(!ls.some(k=>k.startsWith('exam:short:')),'[a] 新配置里没有本机字数记录 exam:short:*')
 console.log('[a] hash',await p.evaluate(()=>location.hash),'cap',await p.$eval('.cap',e=>e.textContent).catch(()=>'none'))
 await p.screenshot({path:`${OUT}/r24-a-result-${W}.png`})
 await openEach(p)
 const rows=await p.$$eval('table.each tr',l=>l.slice(1).map(tr=>({n:tr.firstElementChild.textContent.trim(),score:tr.lastElementChild.textContent.trim(),tag:!!tr.querySelector('.shortag')})))
 console.log('[a] 逐题对照',JSON.stringify(rows))
 const t=n=>rows.find(r=>r.n===String(n))?.tag
 ok(t(46)===true,'[a] 46（flags=word_count_low）显示「自评·字数不足」');ok(t(51)===true,'[a] 51（flags=word_count_low）显示「自评·字数不足」')
 const others=rows.filter(r=>!['46','51'].includes(r.n)&&r.tag);ok(others.length===0&&t(47)===false&&t(52)===false,'[a] 其余题（47 flags=[]、52 待自评、没作答的、客观题）都不显示'+(others.length?' 多出:'+others.map(r=>r.n):''))
 ok(!(await overflow(p)),'[a] 无横向溢出')
 await p.evaluate(()=>{const t=document.querySelector('table.each .shortag');(t?.closest('tr')||document.querySelector('table.each')).scrollIntoView({block:'center'})});await S(300);await p.screenshot({path:`${OUT}/r24-a-each-${W}.png`})
 await ctx.close()}
// 反向：本机记录说 47、52 字数不足，46 不在本机记录里；后端 flags 为准
{const{ctx,p}=await fresh({[`exam:short:${EID}`]:JSON.stringify([ID(47),ID(52)])});await nav(p,`#/exam/${EID}/result`)
 await openEach(p)
 const rows=await p.$$eval('table.each tr',l=>l.slice(1).map(tr=>({n:tr.firstElementChild.textContent.trim(),tag:!!tr.querySelector('.shortag')})))
 const t=n=>rows.find(r=>r.n===String(n))?.tag
 ok(t(46)&&t(51)&&!t(47),'[a-ctrl] 本机记录与后端冲突时以后端 flags 为准（46/51 有、47 无）:'+JSON.stringify(rows.filter(r=>r.tag).map(r=>r.n)))
 await ctx.close()}
// (c) 换设备打开自评页：题卡回填后端已存的档位，「自评·字数不足」以后端 self_grade_flags 为准
const cards=p=>p.$$eval('.rq',l=>l.map(e=>({id:e.id.replace(/^rq-.*-(\d+)$/,'$1'),rows:[...e.querySelectorAll('.rate')].map(r=>r.querySelector('.chip.on')?.textContent??null),short:!!e.querySelector('.shortw')&&/自评·字数不足/.test(e.querySelector('.shortw').textContent)})))
{const{ctx,p}=await fresh();await nav(p,`#/exam/${EID}/rate`)
 const c=await cards(p),g=n=>c.find(x=>x.id===String(n))||{};console.log('[c] 英一自评页题卡',JSON.stringify(c))
 ok(['46','47','51'].every(n=>g(n).rows?.[0]==='基本到位'),'[c] 新配置自评页 46/47/51 回填「基本到位」选中')
 ok(g(52).rows?.[0]===null,'[c] 52（待自评）没有选中档')
 ok(g(46).short&&g(51).short&&!g(47).short&&!g(52).short,'[c] 自评页「自评·字数不足」只在 46/51（后端 flags）')
 await p.evaluate(()=>document.getElementById('rq-english1-2022-46')?.scrollIntoView({block:'start'}));await S(300);await p.screenshot({path:`${OUT}/r24-c-rate-en-${W}.png`})
 ok(!(await overflow(p)),'[c] 自评页无横向溢出');await ctx.close()}
{const{ctx,p}=await fresh({[`exam:short:${EID}`]:JSON.stringify([ID(47),ID(52)])});await nav(p,`#/exam/${EID}/rate`)
 const c=await cards(p),g=n=>c.find(x=>x.id===String(n))||{}
 ok(g(46).short&&g(51).short&&!g(47).short,'[c-ctrl] 本机记录（47/52）与后端冲突时自评页以后端为准')
 const ls=await p.evaluate(k=>JSON.parse(localStorage.getItem(k)||'[]'),`exam:short:${EID}`);ok(ls.sort().join()===[ID(46),ID(51)].join(),'[c-ctrl] 本机记录被后端 flags 校正为 46/51:'+JSON.stringify(ls));await ctx.close()}
// (c-math) 数一：证明题整题、计算题按小问的回填，补评后已评的不丢
const MID=process.env.E2E_MATH
if(REAL&&MID){const{ctx,p}=await fresh();await nav(p,`#/exam/${MID}/rate`)
 const c=await cards(p),g=n=>c.find(x=>x.id===String(n))||{};console.log('[c-math] 数一自评页题卡',JSON.stringify(c))
 const k20=await p.$eval('#rq-math1-2022-20 .rate .k',e=>e.textContent).catch(()=>'')
 ok(/证明题，整题/.test(k20)&&JSON.stringify(g(20).rows)==='["思路对，算错了"]','[c-math] 证明题 20 整题一行、回填「思路对，算错了」')
 ok(JSON.stringify(g(21).rows)==='["全对","没思路",null]','[c-math] 计算题 21 按小问三行：(1)全对 (2)没思路 (3)未评')
 ok(JSON.stringify(g(17).rows)==='["全对"]','[c-math] 只有一问的 17 整题回填「全对」')
 ok(JSON.stringify(g(18).rows)==='[null]','[c-math] 待自评的 18 没有选中档')
 await p.evaluate(()=>document.getElementById('rq-math1-2022-20')?.scrollIntoView({block:'start'}));await S(300);await p.screenshot({path:`${OUT}/r24-c-rate-math-${W}.png`})
 // 补评 18「全对」后点「评好了」：回填的档位一起提交，不丢
 const chip=(await p.$$('#rq-math1-2022-18 .chip'))[0];await tap(p,chip);await S(300)
 const resp=p.waitForResponse(r=>r.url().includes(`/exams/${MID}/self-ratings`)&&r.request().method()==='POST',{timeout:8000})
 await tap(p,await p.$('.acts .next'));const body=await (await resp).json();await S(800)
 const pq=n=>body.result.per_question.find(x=>x.question_id===`math1-2022-${n}`)
 const got={17:pq(17).sub_scores?.map(x=>x.self_rating)??pq(17).self_rating,18:pq(18).self_rating??pq(18).sub_scores?.map(x=>x.self_rating),20:pq(20).self_rating,21:pq(21).sub_scores.map(x=>x.self_rating)};console.log('[c-math] 补评后后端',JSON.stringify(got))
 ok(String(got[17])==='full'&&String(got[18])==='full'&&got[20]==='approach_ok_calc_wrong'&&JSON.stringify(got[21])==='["full","no_idea",null]','[c-math] 补评 18 后 17/20/21 原档位都在')
 ok(await p.evaluate(()=>/成 绩/.test(document.body.innerText)),'[c-math] 评好后回到成绩页');await ctx.close()}
else if(REAL)console.log('[c-math] 跳过：没给 E2E_MATH')

// ---------- (b) 高亮 2–2.5 秒后消失 ----------
async function watchHot(p,label,shot){const t0=Date.now();let on=null,off=null,id=null,inView=null,shotDone=false
 while(Date.now()-t0<7000){const h=await p.evaluate(()=>{const e=document.querySelector('.rq.hot');if(!e)return null;const r=e.getBoundingClientRect();return{id:e.id,top:Math.round(r.top),vis:r.top<innerHeight&&r.bottom>0}})
  const t=Date.now()-t0
  if(h&&on==null){on=t;id=h.id;inView=h}
  if(h&&!shotDone&&t-on>300){await p.screenshot({path:`${OUT}/r24-b-${shot}-hot-${W}.png`});shotDone=true}
  if(!h&&on!=null){off=t;break}
  await S(50)}
 await p.screenshot({path:`${OUT}/r24-b-${shot}-after-${W}.png`})
 const dur=on!=null&&off!=null?off-on:null
 console.log(`[b] ${label}: 点后 ${on}ms 出现高亮 id=${id} top=${inView?.top} 在视口=${inView?.vis}；${off}ms 消失；持续 ${dur}ms`)
 ok(id===`rq-${ID(52)}`,`[b] ${label} 高亮的是目标题 52`);ok(inView?.vis===true,`[b] ${label} 目标题滚进视口`);ok(dur!=null&&dur>=1900&&dur<=2800,`[b] ${label} 高亮约 2–2.5 秒后消失（${dur}ms）`)}
{const{ctx,p}=await fresh();await nav(p,'#/')
 const card=await p.$('.pendex');const txt=await card?.evaluate(e=>e.textContent);console.log('[b] 今日页卡片',txt)
 ok(!!card&&/还有 20 分待自评/.test(txt||''),'[b] 今日页出现「还有 20 分待自评 · 去自评」卡');await p.screenshot({path:`${OUT}/r24-b-today-${W}.png`})
 await tap(p,await p.$('.pendex .go')||card);await watchHot(p,'今日页卡→自评页','today')
 console.log('[b] hash',await p.evaluate(()=>location.hash));await ctx.close()}
{const{ctx,p}=await fresh();await nav(p,`#/exam/${EID}/result`)
 await openEach(p)
 const rl=await p.$$('table.each .rl');console.log('[b] 成绩页「去自评」个数',rl.length);ok(rl.length===1,'[b] 成绩页逐题对照里只有 52 带「去自评」')
 await tap(p,rl[0]);await watchHot(p,'成绩页「去自评」→自评页','result')
 ok(!(await overflow(p)),'[b] 自评页无横向溢出');await ctx.close()}
console.log(REAL?'mode real :3000':'mode mock+stub '+JSON.stringify(hits),fails?`FAILS ${fails}`:'ALL PASS')
await b.close();process.exit(fails?1:0)
