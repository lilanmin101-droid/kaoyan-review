import puppeteer from 'puppeteer-core'
import fs from 'fs'
const W=+process.argv[2],tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
const click=async(sel,txt)=>{const els=await p.$$(sel);let e=null;for(const x of els)if((!txt||(await x.evaluate(n=>n.textContent)).includes(txt))&&await x.boundingBox()){e=x;break}
 if(!e)throw new Error('no '+sel+' '+(txt??''));await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(250);const bb=await e.boundingBox();W<500?await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2):await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);await S(500)}
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
await p.goto('http://localhost:4173/#/today');await p.reload();await S(2500)
console.log('tabs',await p.evaluate(()=>[...document.querySelectorAll('nav a, nav span, .tabs span, .tabs a')].map(e=>e.textContent.trim()).filter(Boolean).join('|')))
await click('nav *, .tabs *','模考');await S(1500);console.log('hash',await p.evaluate(()=>location.hash))
await click('.chip','英语一');await click('.chip','2022');await S(300)
await p.screenshot({path:`/workspace/kaoyan-ui/r21-lobby-${W}.png`})
await click('.chip','数学一');await click('.chip','英语一');console.log('year kept',await p.$eval('.chip.on:not(:first-child)',e=>e.textContent).catch(()=>'?'),await p.$eval('.next',e=>e.textContent))
await p.goto('http://localhost:4173/#/exam/f0a82f07-f55e-438e-82d6-5d6938ea02b9/result');await p.reload();await S(3000)
await click('.slist .bigbtn','逐题对照');await S(500)
console.log('table rows',(await p.$$('table.each tr')).length,'ratebox',!!await p.$('.ratebox'))
await click('table.each .link','47');await S(1500)
console.log('peek',await p.$eval('.qpeek',e=>e.textContent.slice(0,160)))
await p.screenshot({path:`/workspace/kaoyan-ui/r21-peek47-${W}.png`})
await b.close()
