import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms)), O='/workspace/kaoyan-ui/'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
p.on('response',async r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url(),(await r.text()).slice(0,200))})
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
const click=async t=>{const ok=await p.evaluate(t=>{const e=[...document.querySelectorAll('span,a')].find(x=>x.textContent.trim().startsWith(t));e?.click();return !!e},t);if(!ok)console.log('MISSING',t);await S(900)}
const bar=()=>p.$eval('.ebar',e=>e.innerText.replace(/\n/g,' ')).catch(()=>'-')
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
await click('接着做');await S(1500);await click('暂停');await p.screenshot({path:O+'r11-exam-paused.png'});console.log('paused',await bar())
await p.reload();await S(2500);console.log('lobby:',await p.$eval('main',e=>e.innerText.replace(/\n/g,' ')))
await click('接着做');await S(2000);console.log('resumed',await bar())
await p.evaluate(()=>[...document.querySelectorAll('.side .next')].find(x=>x.textContent.includes('交卷')).click());await S(2500)
await p.evaluate(()=>{document.querySelectorAll('.rq .rate').forEach(r=>r.querySelectorAll('.chip')[1].click())});await S(300)
await p.screenshot({path:O+'r11-exam-rate.png'})
await click('交卷，看成绩');await S(3000)
console.log('result:',await p.$eval('main',e=>e.innerText.replace(/\n/g,' ')))
await p.screenshot({path:O+'r11-exam-result.png'})
await b.close()
