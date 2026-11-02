import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const W=+process.argv[2]||1280
const p=await b.newPage();await p.setViewport({width:W,height:844,deviceScaleFactor:W<500?2:1});p.on('pageerror',e=>console.log('ERR',e.message))
const T=t=>p.evaluate(t=>{const el=[...document.querySelectorAll('.link,.next,.chip,span')].find(x=>x.textContent.trim()===t&&x.offsetParent);if(!el)return 'MISS '+t;el.click()},t)
const shot=n=>p.screenshot({path:`/workspace/kaoyan-ui/r13-${n}-${W<500?'m':'d'}.png`})
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
console.log('lobby:',(await p.$eval('main',e=>e.innerText)).slice(0,120).replace(/\n/g,' | '))
if(await p.evaluate(()=>!!document.querySelector('.danger'))){await T('不做了，按现在的交掉');await S(300);await shot('end');await T('交掉，开新的');await S(2500)}
await T('2017');await S(200);await T('开考 · 2017 数学一');await S(3000)
for(let i=0;i<2;i++){await p.evaluate(()=>document.querySelectorAll('.exam .o')[1].click());await S(1200);await T('下一题');await S(300)}
await T('上一题');await S(400)
console.log('net:',await p.$eval('.ebar',e=>e.innerText.replace(/\n/g,' ')))
await p.evaluate(()=>scrollTo(0,400));await S(200);console.log('ebar top after scroll',await p.$eval('.ebar',e=>e.getBoundingClientRect().top));await p.evaluate(()=>scrollTo(0,0))
await shot('sel')
await p.evaluate(()=>[...document.querySelectorAll('.ebar .link')].find(x=>x.textContent==='交卷').click());await S(300);await shot('leave')
console.log('confirm:',await p.$eval('.cfm',e=>e.innerText.replace(/\n/g,' ')))
await p.click('.cfm .next');await S(3000)
// 只评第一道小问
await p.evaluate(()=>document.querySelector('.rate .chip').click());await S(200)
await T('交卷，看成绩');await S(300);console.log('confirm2:',await p.$eval('.cfm',e=>e.innerText.replace(/\n/g,' ')))
await T('确定交卷');await S(3500)
await T('逐题对照答案');await S(300)
console.log('result:',(await p.$eval('main',e=>e.innerText)).replace(/\n/g,' | ').slice(0,1600))
await p.screenshot({path:`/workspace/kaoyan-ui/r13-result-${W<500?'m':'d'}.png`,fullPage:true})
await b.close()
