import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
for (const w of [1280,390]) {
const p=await b.newPage();await p.setViewport({width:w,height:900,deviceScaleFactor:w<500?2:1});p.on('pageerror',e=>console.log('ERR',e.message))
p.on('response',r=>{if(r.url().includes('/me/settings')&&r.request().method()==='PATCH')console.log('PATCH',r.status(),r.request().postData())})
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.removeItem('me:prefs')},tok)
await p.goto('http://localhost:4173/#/me');await p.reload();await S(2000)
if(w===1280){await p.type('.me input[placeholder^="比如"]','浙江大学 计算机');await p.evaluate(()=>[...document.querySelectorAll('.seg span')].find(x=>x.textContent==='少打扰').click());await S(2500)}
await p.evaluate(()=>[...document.querySelectorAll('.link')].find(x=>x.textContent==='展开看').click());await S(300)
console.log(w,(await p.$eval('main',e=>e.innerText)).slice(0,500))
await p.screenshot({path:`/workspace/kaoyan-ui/r12-me-${w>500?'d':'m'}.png`,fullPage:true})
await p.close()}
await b.close()
