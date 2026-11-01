// 离线题包（真接口）：拉 /offline/pack，断网做 5 道选择 + 1 道主观题自评，联网后看 POST /answers 的返回
import puppeteer from 'puppeteer-core';import fs from 'fs'
const W=+process.argv[2]||390,tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message));p.on('console',m=>{if(/offline/.test(m.text()))console.log('console:',m.text())})
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'Mobile'});else await p.setViewport({width:W,height:800})
await p.setBypassServiceWorker(true)
const posts=[];p.on('response',async r=>{if(r.request().method()==='POST'&&r.url().endsWith('/answers')){try{const req=JSON.parse(r.request().postData());if(req.source==='offline_pack')posts.push({req,status:r.status(),res:await r.json()})}catch{}}})
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
await p.goto('http://localhost:4173/#/quiz');await p.reload();await S(3500)
const pk=await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:pack')||'null'));console.log('pack',pk?.version,pk?.questions?.length)
const essayIdx=pk.questions.findIndex(q=>q.objective===false&&q.explanation?.steps?.length)
await p.setOfflineMode(true);await S(1500)
console.log('offline view',(await p.$eval('.offq .cap',e=>e.textContent).catch(()=>'none')))
const tap=async sel=>{const e=await p.$(sel);await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(80);if(W<500){const bb=await e.boundingBox();await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2)}else await e.click()}
for(let i=0;i<5;i++){await S(1100);await tap('.offq .opts .op:nth-child('+(1+i%4)+')');await tap('.offq .acts .next');await S(150)
 console.log(i+1,await p.$eval('.offq .meta',e=>e.textContent),'|',await p.$eval('.offq .verdict',e=>e.innerText.split('\n').slice(0,2).join(' / ')));await tap('.offq .acts .link:last-child');await S(150)}
// 主观题：跳到一道带讲解步骤的错题重做
if(essayIdx>=0){await p.evaluate(i=>{localStorage.setItem('offline:idx',i)},essayIdx);await p.setOfflineMode(false);await p.reload();await p.setOfflineMode(true);await S(2000)
 console.log('essay',await p.$eval('.offq .meta',e=>e.textContent).catch(()=>'none'));await p.type('.offq textarea','先求边缘密度再算方差');await tap('.offq .acts .next');await S(300)
 console.log('essay verdict',await p.$eval('.offq .verdict',e=>e.innerText.slice(0,120).replace(/\n/g,' / ')));await p.screenshot({path:`/workspace/kaoyan-ui/r33-essay-${W}.png`,fullPage:true})
 const chips=await p.$$('.offq .rates .chip');if(chips[1]){await chips[1].evaluate(x=>x.scrollIntoView({block:'center'}));await chips[1].click()};await S(300)
 console.log('rated',await p.$eval('.offq .verdict',e=>e.innerText.match(/自评：.*/)?.[0]))}
console.log('queue',await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:queue')).map(x=>[x.question_id,x.time_spent_seconds,x.self_rating??x.answer.join('')].join(':'))))
await p.setOfflineMode(false);await S(8000)
console.log('queue after',await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:queue')).length),'posts',posts.length)
for(const x of posts)console.log(' ',x.status,x.res.status,x.req.question_id,'sent:',Object.keys(x.req).join(','),'| correct',x.res.is_correct,'wrong',x.res.wrong_question_status,'day',x.res.study_date)
// 重发第一条看 duplicate
if(posts[0]){const H={authorization:'Bearer '+tok,'content-type':'application/json'};const d=await (await fetch('http://localhost:3000/api/v1/answers',{method:'POST',headers:H,body:JSON.stringify(posts[0].req)})).json();console.log('resend',d.status,d.duplicate)}
await b.close()
