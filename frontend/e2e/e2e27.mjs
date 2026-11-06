import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
for (const w of [1280,390]) {
const p=await b.newPage();await p.setViewport({width:w,height:900,deviceScaleFactor:w<500?2:1});p.on('pageerror',e=>console.log('ERR',e.message))
p.on('response',async r=>{if(r.url().includes('/me/settings')&&r.request().method()==='PATCH')console.log('PATCH',r.status(),r.request().postData(),(await r.text()).slice(0,200))})
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.setItem('me:prefs',JSON.stringify({target_school:'浙大 计算机',exam_date:'2026-12-26'}))},tok)
await p.goto('http://localhost:4173/#/me');await p.reload();await S(2500)
if(w===1280){
  await p.evaluate(()=>[...document.querySelectorAll('.seg span')].find(x=>x.textContent==='改动先问我').click());await S(1500)
  const i=await p.$('.me input[type=number]');await i.click({clickCount:3});await i.type('900');await S(1500)
  await p.$eval('.me input[type=time]',e=>{e.value='23:00';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'))})
  await p.$$eval('.me input[type=time]',es=>{es[1].value='07:30';es[1].dispatchEvent(new Event('input'));es[1].dispatchEvent(new Event('change'))});await S(1500)
}
console.log(w,(await p.$eval('main',e=>e.innerText)).slice(0,900))
await p.screenshot({path:`/workspace/kaoyan-ui/r14-me-${w>500?'d':'m'}.png`,fullPage:true})
await p.goto('http://localhost:4173/#/today');await S(2000)
console.log('TODAY',(await p.$eval('main',e=>e.innerText)).slice(0,300))
await p.screenshot({path:`/workspace/kaoyan-ui/r14-today-${w>500?'d':'m'}.png`})
await p.close()}
await b.close()
