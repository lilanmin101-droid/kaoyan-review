import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1280,height:800})
p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.setItem('paper:subj','english1');localStorage.setItem('paper:enyear','2025');localStorage.setItem('en:english1-2025:g','0')},tok)
await p.goto('http://localhost:4173/#/quiz');await p.reload();await S(3000)
for(const id of ['14','15'])await p.click(`#q-english1-2025-${id} .eo .o`).catch(e=>console.log('x',e.message))
await S(300);const btn=(await p.$$('.next')).find(async()=>1);for(const e of await p.$$('.next'))if((await e.evaluate(n=>n.textContent)).includes('对答案'))await e.click()
await S(2000)
console.log(await p.$$eval('.errata',x=>x.map(e=>e.closest('.eq')?.id+': '+e.textContent.slice(0,60))))
const el=await p.$('.errata');if(el){await el.evaluate(x=>x.scrollIntoView({block:'center'}));await S(300);await p.screenshot({path:'/workspace/kaoyan-ui/r19-errata.png'})}
await b.close()
