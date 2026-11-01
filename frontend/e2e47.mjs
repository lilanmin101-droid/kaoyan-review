// 暂停门槛：暂停后提示「已暂停 N 分钟，超过 15 分钟…」，10 分钟弹提醒，超过 15 分钟变红；成绩页 non_continuous 标注用拦截模拟
import puppeteer from 'puppeteer-core';import fs from 'fs'
const W=+process.argv[2]||1280
const tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms)),H={authorization:'Bearer '+tok,'content-type':'application/json'}
const act=await (await fetch('http://localhost:3000/api/v1/exams/active',{headers:H})).json();if(act.exam){console.log('active exists',act.exam.title);process.exit(0)}
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'Mobile'});else await p.setViewport({width:W,height:800})
p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
const e=await (await fetch('http://localhost:3000/api/v1/exams',{method:'POST',headers:H,body:JSON.stringify({exam:'english1',year:2018,duration_minutes:180})})).json();const id=e.exam?.id??e.id
await p.goto('http://localhost:4173/#/exam/go');await p.reload();await S(3000)
const clickTxt=t=>p.evaluate(t=>[...document.querySelectorAll('.ebar .link,.pausebox .next')].find(x=>x.textContent.trim()===t)?.click(),t)
await clickTxt('暂停');await S(500)
console.log('paused 0:',await p.$eval('.pzhint',e=>e.textContent))
await p.evaluate(()=>{const o=Date.now.bind(Date);window.__off=0;Date.now=()=>o()+window.__off})
await p.evaluate(()=>window.__off=11*60e3);await S(5600)
console.log('paused 11:',await p.$eval('.pzhint',e=>e.textContent),'| toast:',await p.evaluate(()=>document.body.innerText.match(/已经暂停 \d+ 分钟了[^\n]*/)?.[0]))
await p.evaluate(()=>window.__off=16*60e3);await S(5600)
console.log('paused 16:',await p.$eval('.pzhint',e=>e.textContent),await p.$eval('.pzhint',e=>getComputedStyle(e).color))
await p.screenshot({path:`/workspace/kaoyan-ui/r31-pause-${W}.png`})
await clickTxt('继续');await S(800)
console.log('ebar:',await p.$eval('.ebar .pzs',e=>e.textContent).catch(()=>'none'))
await fetch(`http://localhost:3000/api/v1/exams/${id}/abandon`,{method:'POST',headers:H}).then(r=>r.json()).then(j=>console.log('abandon',j.status))
// 成绩页 + 历史：拦截加 non_continuous
const h=await (await fetch('http://localhost:3000/api/v1/exams?limit=10',{headers:H})).json();const sub=h.items.find(x=>x.status==='submitted')
if(sub){await p.setBypassServiceWorker(true);await p.setRequestInterception(true);p.on('request',async r=>{const u=r.url();if(r.method()==='GET'&&(u.endsWith('/exams/'+sub.id)||u.includes('/exams?limit'))){const res=await fetch(u.replace('4173','3000'),{headers:H});const j=await res.json();if(j.items)j.items=j.items.map(x=>x.id===sub.id?{...x,non_continuous:true}:x);else{j.non_continuous=true;if(j.result)j.result.non_continuous=true}return r.respond({status:200,contentType:'application/json',body:JSON.stringify(j)})}r.continue()})
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
console.log('hist tag:',await p.$eval('.hrow .nc',e=>e.textContent).catch(()=>'none'))
await p.goto(`http://localhost:4173/#/exam/${sub.id}/result`);await p.reload();await S(2500)
console.log('result:',await p.$eval('.noncont',e=>e.textContent).catch(()=>'none'));await p.screenshot({path:`/workspace/kaoyan-ui/r31-noncont-${W}.png`})}
await b.close()
