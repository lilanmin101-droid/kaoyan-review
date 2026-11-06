import puppeteer from 'puppeteer-core'
import fs from 'fs'
const W=+process.argv[2],tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
const click=async(sel,txt)=>{const els=await p.$$(sel);let e=null;for(const x of els)if((!txt||(await x.evaluate(n=>n.textContent)).includes(txt))&&await x.boundingBox()){e=x;break}
 if(!e)throw new Error('no '+sel+' '+(txt??''));await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(250);const bb=await e.boundingBox();W<500?await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2):await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);await S(500)}
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
const API='http://localhost:3000/api/v1',H={Authorization:'Bearer '+tok,'Content-Type':'application/json'}
const act=async()=>(await (await fetch(API+'/exams/active',{headers:H})).json()).exam
const ab=async()=>{const a=await act();if(a)await fetch(API+`/exams/${a.id}/abandon`,{method:'POST',headers:H})}
await ab();await fetch(API+'/exams',{method:'POST',headers:H,body:JSON.stringify({exam:'english1',year:2021,duration_minutes:180})})
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
await p.goto('http://localhost:4173/#/today');await p.reload();await S(2500)
console.log('tabs',await p.evaluate(s=>[...document.querySelectorAll(s)].map(e=>e.textContent).join('|'),W<500?'.btabs a':'.tabs a'))
console.log('banner',await p.$eval('.examlive',e=>e.textContent).catch(()=>'NONE'))
await p.screenshot({path:`/workspace/kaoyan-ui/r22-banner-${W}.png`})
await click('.examlive');await S(1500);console.log('hash',await p.evaluate(()=>location.hash),'banner in exam',!!await p.$('.examlive'))
await ab()
await p.goto('http://localhost:4173/#/quiz');await S(2000);console.log('banner after abandon',!!await p.$('.examlive'))
console.log('card',await p.$eval('.mockcard',e=>e.textContent).catch(()=>'NONE'))
// 教练任务预选：英语一 2022
await p.evaluate(()=>localStorage.setItem('exam:pre',JSON.stringify({exam:'english1',year:2022})));await p.reload();await S(2500)
console.log('pre',await p.$eval('.mockcard',e=>e.querySelector('.seg .on').textContent+' '+e.querySelector('.yr.on').textContent+' | '+e.querySelector('.next').textContent))
await S(2500);console.log('year still',await p.$eval('.mockcard .yr.on',e=>e.textContent))
await p.screenshot({path:`/workspace/kaoyan-ui/r22-card-${W}.png`})
await click('.mockcard .yr','2019');await S(1500);console.log('year click started?',!!(await act()),await p.evaluate(()=>location.hash),await p.$eval('.mockcard .yr.on',e=>e.textContent));await click('.mockcard .yr','2022');await click('.mockcard .next');await S(2500);const a=await act();console.log("started",await p.evaluate(()=>location.hash),a?.title)
await ab()
await p.goto('http://localhost:4173/#/exam/f0a82f07-f55e-438e-82d6-5d6938ea02b9/result');await p.reload();await S(3000)
console.log('table shown',!!await p.$('table.each'),'去自评',(await p.$$('table.each .rl')).length)
const rl=await p.$('table.each .rl');if(rl){await rl.evaluate(x=>x.scrollIntoView({block:'center'}));await p.screenshot({path:`/workspace/kaoyan-ui/r22-rate-${W}.png`})}
await click('table.each .link','47');await S(1500);console.log('peek',await p.$eval('.qpeek',e=>e.textContent.slice(0,90)))
await b.close()
