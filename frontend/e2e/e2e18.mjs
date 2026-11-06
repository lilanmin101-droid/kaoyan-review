import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms)), O='/workspace/kaoyan-ui/'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
for (const [w,h,n] of [[1280,900,'d'],[390,844,'m']]){
const p=await b.newPage();await p.setViewport({width:w,height:h});p.on('pageerror',e=>console.log('ERR',e.message))
p.on('response',async r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url(),(await r.text()).slice(0,200))})
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
const click=async t=>{const ok=await p.evaluate(t=>{const e=[...document.querySelectorAll('span,a')].find(x=>x.textContent.trim().startsWith(t));e?.click();return !!e},t);if(!ok)console.log('MISSING',t);await S(900)}
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
console.log(n,'lobby:',await p.$eval('main',e=>e.innerText.replace(/\n/g,' ')))
await click('接着做');await S(2000)
console.log(n,'bar',await p.$eval('.ebar',e=>e.innerText.replace(/\n/g,' ')).catch(()=>'-'), await p.$eval('.side .cap',e=>e.textContent).catch(()=>'-'))
await p.screenshot({path:O+`r11-exam-run-${n}.png`});await p.close()}
await b.close()
