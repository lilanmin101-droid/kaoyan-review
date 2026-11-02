import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim()
const S=ms=>new Promise(r=>setTimeout(r,ms)), O='/workspace/kaoyan-ui/'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900})
p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t);localStorage.setItem('paper:year','2023');localStorage.setItem('quiz:math1-2023:idx','21')},tok)
await p.reload();await S(2500)
const clickText=async t=>{const ok=await p.evaluate(t=>{const e=[...document.querySelectorAll('span,a,button')].find(x=>x.textContent.trim()===t);if(e){e.click();return true}return false},t);if(!ok)console.log('no',t);await S(700)}
await clickText('看参考答案')
const chips=async()=>p.$$('.rate .chip')
let c=await chips();console.log('chips',c.length)
await c[0].click();await S(600);c=await chips();await c[4].click();await S(600);c=await chips();await c[8].click();await S(800)
console.log(await p.$eval('.essay',e=>e.innerText.split('\n').filter(l=>/记下了|（\d）/.test(l)).join(' | ')))
await p.screenshot({path:O+'r7-q22-subrate.png'})
// change (3) to full
c=await chips();await c[6].click();await S(800)
await p.reload();await S(2500)
console.log('after reload:',await p.evaluate(()=>[...document.querySelectorAll('.chip.on')].map(e=>e.textContent).join(','), await p.$eval('.essay',e=>(e.innerText.match(/记下了[^\n]*/)||[''])[0])))
console.log(await p.$eval('.essay',e=>(e.innerText.match(/记下了[^\n]*/)||[''])[0]))
// pick Q6 without checking, then submit
await p.evaluate(()=>localStorage.setItem('quiz:math1-2023:idx','5'));await p.reload();await S(2500)
await p.evaluate(()=>{const r=[...document.querySelectorAll('.sheet .row')][5];r.querySelectorAll('.b')[3].click()})
await S(900)
await clickText('交卷 · 看得分');await S(1500)
console.log(await p.$eval('main',e=>e.innerText.slice(0,600)))
await p.screenshot({path:O+'r7-summary.png'})
// phone
await p.setViewport({width:390,height:844,isMobile:true});await p.evaluate(()=>localStorage.setItem('quiz:math1-2023:idx','6'));await p.reload();await S(2500)
await p.screenshot({path:O+'r7-m-q7.png'})
await p.goto('http://localhost:4173/#/words');await S(2000)
console.log('words',await p.$eval('.cap',e=>e.textContent))
await clickText('认识，跳过');await S(500)
await p.setViewport({width:1280,height:900});await p.reload();await S(2000)
console.log('words desk',await p.$eval('.cap',e=>e.textContent))
await b.close()
