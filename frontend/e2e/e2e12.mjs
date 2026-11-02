import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms)), O='/workspace/kaoyan-ui/'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/wrong');await p.reload();await S(2500)
const t=async()=>p.$eval('main',e=>e.innerText.split('\n').filter(l=>/错 题 本|已掌握|后来做对|错过/.test(l)).join(' | '))
console.log(1,await t())
await p.evaluate(()=>[...document.querySelectorAll('.link')].find(x=>x.textContent.includes('已掌握，移出')).click());await S(1000)
console.log(2,await t())
await p.evaluate(()=>[...document.querySelectorAll('.link')].find(x=>/已掌握 \d/.test(x.textContent)).click());await S(500)
await p.screenshot({path:O+'r9-mastered.png'})
console.log(3,await t())
await p.evaluate(()=>[...document.querySelectorAll('.link')].find(x=>x.textContent.includes('放回')).click());await S(1000)
console.log(4,await t())
await p.goto('http://localhost:4173/#/words');await S(2000);console.log(await p.$eval('.cap',e=>e.textContent))
await b.close()
