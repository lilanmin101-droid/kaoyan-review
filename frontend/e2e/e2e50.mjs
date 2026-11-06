// 离线题包：/offline/pack 和带 source:offline_pack 的 /answers 用拦截模拟（后端接口上线前），断网做 5 道，联网补传
import puppeteer from 'puppeteer-core';import fs from 'fs'
const W=+process.argv[2],tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const real=process.argv[3]==='real'
const H={authorization:'Bearer '+tok}
const qr=await (await fetch('http://localhost:3000/api/v1/questions?exam=english1&year=2019&include_answer=true&page_size=100',{headers:H})).json()
const cloze=qr.items.filter(x=>x.passage_id==='english1-2019-P-cloze').slice(0,6), wrong=qr.items.filter(x=>x.section?.startsWith('reading')&&x.type.includes('choice')).slice(0,4)
const PACK={version:'t1',study_date:'2026-11-01',expires_at:'2026-11-01T10:00:00Z',questions:[...cloze.map((x,i)=>i===0?{...x,explanation_status:'pending'}:x),...wrong.map(x=>({...x,origin:'wrong'}))],passages:qr.groups.map(g=>g.passage).filter(p=>p&&(p.id==='english1-2019-P-cloze'||wrong.some(w=>w.passage_id===p.id)))}
let batches=[]
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'Mobile'});else await p.setViewport({width:W,height:800})
await p.setBypassServiceWorker(true)
if(!real){await p.setRequestInterception(true);p.on('request',r=>{const u=r.url()
 if(u.includes('/offline/pack'))return r.respond({status:200,contentType:'application/json',body:JSON.stringify(PACK)})
 if(r.method()==='POST'&&u.endsWith('/answers')&&(r.postData()||'').includes('offline_pack')){batches.push(JSON.parse(r.postData()));return r.respond({status:201,contentType:'application/json',body:JSON.stringify({is_correct:null})})}
 r.continue()})}
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
await p.goto('http://localhost:4173/#/quiz');await p.reload();await S(3000)
console.log('pack stored',await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:pack')||'null')?.questions?.length))
await p.setOfflineMode(true);await S(1500)
console.log('offline view',(await p.$eval('.offq .cap',e=>e.textContent).catch(()=>'none')))
console.log('stale:', await p.$eval('.offq', e=>e.querySelector('.stale')?.textContent ?? 'none'))
const tap=async sel=>{const e=await p.$(sel);await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(80);if(W<500){const bb=await e.boundingBox();await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2)}else await e.click()}
for(let i=0;i<5;i++){await tap('.offq .opts .op:nth-child('+(1+i%4)+')');await tap('.offq .acts .next');await S(150)
 console.log(i+1,await p.$eval('.offq .verdict',e=>e.innerText.includes('先记下这题')?'[全句]':e.innerText.includes('讲解还没出')?'[讲解还没出]':''),await p.$eval('.offq .verdict p',e=>e.textContent));if(i===0)await p.screenshot({path:`/workspace/kaoyan-ui/r30-offq-${W}.png`});await tap('.offq .acts .link:last-child');await S(150)}
console.log('cap',await p.$eval('.offq .cap',e=>e.textContent),'queue',await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:queue')).length))

await p.setOfflineMode(false);await S(7000)
console.log('online view',await p.$('.offq')?'still offline view':'normal quiz','queue',await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:queue')).length),'posts',batches.length,JSON.stringify(batches[0]))
await b.close()
