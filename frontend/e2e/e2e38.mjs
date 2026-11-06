import puppeteer from 'puppeteer-core'
import fs from 'fs'
const W=+process.argv[2],tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
const click=async(sel,txt)=>{const els=await p.$$(sel);let e=null;for(const x of els)if((!txt||(await x.evaluate(n=>n.textContent)).includes(txt))&&await x.boundingBox()){e=x;break}
 if(!e)throw new Error('no '+sel+' '+(txt??''));await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(250);const bb=await e.boundingBox();W<500?await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2):await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);await S(500)}
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t);localStorage.setItem('paper:subj','english1');localStorage.setItem('paper:enyear','2022');localStorage.setItem('en:jump','english1-2022-P-partb')},tok)
await p.goto('http://localhost:4173/#/quiz');await p.reload();await S(3000)
const m=await p.$('.en .mopts');console.log('fold',await m.evaluate(e=>e.classList.contains('fold')),'rows',await m.$$eval('.mo',l=>l.map(e=>Math.round(e.getBoundingClientRect().height)).join(',')),'G visible',await m.evaluate(e=>{const g=[...e.querySelectorAll('.mo')].at(-1).getBoundingClientRect(),b=e.getBoundingClientRect();return g.bottom<=b.bottom+1}))
await m.evaluate(e=>e.scrollIntoView({block:'start'}));await p.screenshot({path:`/workspace/kaoyan-ui/r23-match-${W}.png`})
console.log('desk tabs',await p.evaluate(()=>[...document.querySelectorAll('.tabs a')].map(e=>e.textContent).join('|')),'btabs',await p.evaluate(()=>[...document.querySelectorAll('.btabs a')].map(e=>e.textContent).join('|')))
await b.close()
