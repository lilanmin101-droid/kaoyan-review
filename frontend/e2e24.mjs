import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
p.on('response',r=>{const u=r.url();if(/exams|report/.test(u))console.log(r.request().method(),r.status(),u.replace(/.*api\/v1/,''))})
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
console.log((await p.$eval('main',e=>e.innerText)).slice(0,600))
await p.click('.hrow');await S(2500)
console.log((await p.$eval('main',e=>e.innerText)).slice(0,700))
await p.evaluate(()=>[...document.querySelectorAll('.link')].find(x=>x.textContent==='成绩单 PDF').click());await S(2500)
await p.screenshot({path:'/workspace/kaoyan-ui/r12-result-d.png',fullPage:true})
await b.close()
