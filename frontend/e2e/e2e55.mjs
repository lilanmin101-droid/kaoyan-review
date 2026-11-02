// e2e55：离线题包 r25 修复（真后端 :3000，经 :4180 preview）
// 用法（在 frontend/ 下）：node e2e/e2e55.mjs <宽度> [base]   默认 base=http://localhost:4180（API_TARGET=:3000）
// 每次在 UI 里新注册一个号（密码运行时随机生成，只在内存里，不落盘、不打印）
// 覆盖：注册后不刷新就拉到题包；顶栏跟着题走；日期后空格；完形当前空标出；翻译原文不露 <u> 标签；英语自评措辞、手机上不被底栏挡；恢复联网不跳走
import puppeteer from 'puppeteer-core';import crypto from 'crypto'
const W=+process.argv[2],BASE=process.argv[3]||'http://localhost:4180',S=ms=>new Promise(r=>setTimeout(r,ms)),OUT='/workspace/kaoyan-ui'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
let fails=0,errs=0;const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++}
const ctx=await b.createBrowserContext();const p=await ctx.newPage();p.on('pageerror',e=>{errs++;console.log('ERR',e.message)})
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
const tap=async(p,e)=>{await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(250);const bb=await e.boundingBox();W<500?await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2):await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)}
const byText=async(sel,t)=>{for(const e of await p.$$(sel))if((await e.evaluate(x=>x.textContent.trim()))===t)return e;return null}
const overflow=()=>p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)
const hdr=()=>p.$eval('.top .wm em',e=>e.textContent.trim()).catch(()=>'')
const shot=n=>p.screenshot({path:`${OUT}/r25-${n}-${W}.png`})
const user=`fe_r25_${W}_${Date.now().toString(36)}`,pw=crypto.randomBytes(12).toString('base64url')

// ---------- 1. UI 注册 → 不刷新就拉到题包 ----------
await p.goto(BASE+'/');await p.evaluate(()=>localStorage.clear());await p.reload();await S(2500)
await tap(p,await p.$('.login .switch'));await S(200)
await p.type('.login input[autocomplete=username]',user);await p.type('.login input[type=password]',pw)
const t0=Date.now();await tap(p,await p.$('.login .next'))
let got=0;for(let i=0;i<40&&!got;i++){await S(200);got=await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:pack')||'null')?.questions?.length||0)}
console.log(`[1] 注册 ${user}，题包 ${got} 道，用时 ${Date.now()-t0}ms（没刷新页面）`)
ok(got>0&&Date.now()-t0<8000,'[1] 注册成功后不刷新页面就缓存了离线题包')
await shot('a-after-register')
// 种一道翻译错题，让题包里有 wrong_redo 的 2025-47（和用户 round10 一样），然后让题包重拉
const seed=await p.evaluate(async()=>{const r=await fetch('/api/v1/answers',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+localStorage.getItem('token')},body:JSON.stringify({question_id:'english1-2025-47',self_rating:'no_idea',client_id:'e2e55-seed-'+Date.now()})});return r.status})
console.log('[seed] POST /answers 2025-47 no_idea →',seed)
await p.evaluate(()=>{localStorage.removeItem('offline:pack');localStorage.removeItem('offline:idx')});await p.goto(BASE+'/#/quiz');await p.reload()
for(let i=0;i<30;i++){await S(300);if(await p.evaluate(()=>!!localStorage.getItem('offline:pack')))break}
const pk=await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:pack')))
const iT=pk.questions.findIndex(q=>q.id==='english1-2025-47');console.log('[seed] 题包',pk.questions.length,'道，2025-47 在第',iT+1,'道')
await S(1000)
// ---------- 2. 断网 → 离线页 ----------
await p.setOfflineMode(true);await S(2000)
ok(!!(await p.$('.offq')),'[2] 断网后显示离线题包页')
const cap=await p.$eval('.offq .cap',e=>e.textContent);console.log('[2] cap',JSON.stringify(cap))
ok(/\d{4}-\d{2}-\d{2} 做了/.test(cap),'[⑧] 日期和「做了」之间有空格')
const h1=await hdr();console.log('[④] 顶栏',h1);ok(/离线题包/.test(h1)&&/英语一/.test(h1)&&!/数学一/.test(h1)&&!(await p.$('.top .seg.subj')),'[④] 顶栏写离线题包+当前题的年份科目，不再显示在线页的数学一切换')
ok(!(await overflow()),'[2] 无横向溢出');await shot('b-offline')
// ---------- 3. 完形第 2 题：当前空标出 ----------
await tap(p,await byText('.offq .acts .link','下一题'));await S(400)
const st=await p.$eval('.offq .q',e=>({cur:[...e.querySelectorAll('mark.curb')].map(x=>x.textContent),oth:[...e.querySelectorAll('.othb')].map(x=>x.textContent)}))
const meta=await p.$eval('.offq .meta',e=>e.textContent);console.log('[③]',meta,JSON.stringify(st))
ok(st.cur.length===1&&/（2）/.test(st.cur[0])&&st.oth.some(x=>/（1）/.test(x)),'[③] 题干里只把第（2）空标出来，第（1）空淡化')
ok(/第 2 空/.test(meta),'[③] 题头写「第 2 空」')
const pcur=await p.$$eval('.offq .pt mark.curb',l=>l.map(x=>x.textContent));ok(pcur.length===1&&/（2）/.test(pcur[0]),'[③] 原文里也标出第（2）空')
await shot('c-cloze-blank')
// 选错 A → 整行标红
await tap(p,await p.$('.offq .opts .op'));await tap(p,await byText('.offq .acts .next','对答案'));await S(500)
const bad=await p.$eval('.offq .opts .op.bad',e=>getComputedStyle(e).backgroundColor).catch(()=>null);console.log('[细节9] 选错行底色',bad)
ok(bad&&bad!=='rgba(0, 0, 0, 0)','[细节9] 选错的选项整行有底色')
// ---------- 4. 错题重做：说明里的数量是真的，点分组入口一下就到 ----------
const redoN=pk.questions.filter(q=>q.origin==='wrong_redo'||q.origin==='wrong').length,hint=await p.$eval('.offq .hint',e=>e.textContent);console.log('[⑤] 说明',JSON.stringify(hint),'summary',JSON.stringify(pk.summary??null),'错题重做实际',redoN)
ok(pk.summary?hint.includes(pk.summary.replace(/[。.]$/,'')):(hint.includes(`${redoN} 道错题重做`)&&!(redoN!==10&&/10 道错题/.test(hint))),'[⑤] 说明用后端 summary，没有就按真实数量（不再写死 10 道）')
ok(!/今天任务里/.test(hint),'[⑤⑦] 说明不再说「今天任务里的…」')
const g=await byText('.offq .ogrp .chip',`错题重做 0/${redoN}`);ok(!!g,`[⑤] 有「错题重做 0/${redoN}」分组入口`)
if(iT<0||!g)ok(false,'[①⑥] 题包里没有 2025-47 或没有入口，跳过');else{
 await tap(p,g);await S(600);console.log('[①] meta',await p.$eval('.offq .meta',e=>e.textContent))
 const pt=await p.$eval('.offq .pt',e=>({text:e.textContent,u:e.querySelectorAll('u.uq').length}))
 ok(!/<u|data-q|<\/u>/.test(pt.text)&&pt.u>0,`[①] 翻译原文不露 <u data-q> 标签，划线句按下划线显示（${pt.u} 处）`)
 await p.evaluate(()=>document.querySelector('.offq .ptext').scrollIntoView());await S(200);await shot('d-translation-text')
 await tap(p,await byText('.offq .acts .next','看参考答案'));await S(1200)
 const chips=await p.$$eval('.offq .rates .chip',l=>l.map(x=>x.textContent.trim()));console.log('[⑥] 自评按钮',JSON.stringify(chips))
 ok(chips.join('|')==='基本到位|大概一半|没写或偏得多','[⑥] 翻译自评用英语说法，不再是「思路对，算错了」')
 const vis=await p.evaluate(()=>{const c=[...document.querySelectorAll('.offq .rates .chip')].pop().getBoundingClientRect(),bt=document.querySelector('.btabs');const top=bt&&getComputedStyle(bt).display!=='none'?bt.getBoundingClientRect().top:innerHeight;return{bottom:Math.round(c.bottom),top:Math.round(c.top),bar:Math.round(top)}})
 console.log('[⑥] 最后一个自评按钮',JSON.stringify(vis));ok(vis.bottom<=vis.bar&&vis.top>=0,'[⑥] 看参考答案后最后一个自评按钮整个露在底栏上面')
 ok(!(await overflow()),'[4] 无横向溢出');await shot('e-translation-rate')
 await tap(p,await byText('.offq .rates .chip','没写或偏得多'));await S(300)
 ok(/自评：没写或偏得多/.test(await p.$eval('.offq .verdict',e=>e.textContent)),'[⑥] 自评结果用同一套说法')}
const qn=await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:queue')).length);console.log('[4] 等补传',qn)
// ---------- 5. 恢复联网：留在离线页，不跳去在线数学页 ----------
await p.evaluate(()=>scrollTo(0,400));await p.setOfflineMode(false);await p.evaluate(()=>dispatchEvent(new Event('online')))
let q2=qn;for(let i=0;i<40&&q2;i++){await S(200);q2=await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:queue')).length)}
await S(600)
const on=await p.evaluate(()=>({hash:location.hash,offq:!!document.querySelector('.offq'),bar:!!document.querySelector('.offbar'),back:document.querySelector('.offq .backon')?.textContent||'',toast:document.querySelector('.toast')?.textContent||''}))
console.log('[②] 联网后',JSON.stringify(on),'队列',q2,'顶栏',await hdr())
ok(q2===0,'[5] 补传完了');ok(!on.bar,'[5] 离线条消失')
ok(on.hash==='#/quiz'&&on.offq&&/已经联网/.test(on.back),'[②] 恢复联网后留在离线题包页，顶上提示已联网，不自动跳去在线数学页')
ok(/离线题包/.test(await hdr()),'[②] 顶栏仍对应眼前的题')
ok(!(await overflow()),'[5] 无横向溢出');await p.evaluate(()=>scrollTo(0,0));await S(200);await shot('f-back-online')
await tap(p,await byText('.offq .backon .link','回到在线刷题'));await S(1500)
const after=await p.evaluate(()=>({offq:!!document.querySelector('.offq'),y:scrollY}));console.log('[②] 点回到在线刷题',JSON.stringify(after),'顶栏',await hdr())
ok(!after.offq&&after.y<5&&/真题/.test(await hdr()),'[②] 点「回到在线刷题」才回在线页，从顶上开始')
ok(!(await overflow()),'[6] 无横向溢出');await shot('g-online-quiz')
// ---------- 7. 今日页：今天做了几题、不和题包说法打架 ----------
await p.evaluate(()=>{const a=[...document.querySelectorAll('.btabs a, .tabs a')].find(x=>x.textContent.trim()==='今日'&&x.offsetParent);a.click()});await S(2500)
const td=await p.evaluate(()=>({done:document.querySelector('.today .donetoday')?.textContent||'',empty:document.querySelector('.today .empty')?.textContent||'',pl:document.querySelector('.today .packline')?.textContent||''}))
console.log('[⑦] 今日页',JSON.stringify(td))
ok(/今天已经做了 [1-9]\d* 题/.test(td.done),'[⑦] 今日页显示今天已经做了几题（含补传）')
ok(!td.empty||(td.pl&&!/今天任务里/.test(td.pl)),'[⑦] 没排任务时题包那句照实说（自动挑的），不说「今天任务里的」')
ok(!(await overflow()),'[7] 无横向溢出');await shot('h-today')
ok(errs===0,'无 pageerror')
await ctx.close();await b.close();console.log(fails?`${fails} FAIL`:'ALL PASS');process.exit(fails?1:0)
