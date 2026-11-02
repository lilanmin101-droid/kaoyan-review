import puppeteer from 'puppeteer-core'
import fs from 'fs'
const W=+process.argv[2],tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
const click=async(sel,txt)=>{const els=await p.$$(sel);let e=null;for(const x of els)if((!txt||(await x.evaluate(n=>n.textContent)).includes(txt))&&await x.boundingBox()){e=x;break}
 if(!e)throw new Error('no '+sel+' '+(txt??''));await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(250);const bb=await e.boundingBox();W<500?await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2):await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);await S(500)}
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
await p.goto('http://localhost:4173/#/exam/f0a82f07-f55e-438e-82d6-5d6938ea02b9/result');await p.reload();await S(3000)
const rows=await p.$$('table.each .rl');await rows[1].evaluate(x=>x.scrollIntoView({block:'center'}));const row=await rows[1].evaluate(x=>x.closest('tr').textContent);await rows[1].click();await S(2500)
console.log('clicked row',row.slice(0,6),'top rq',await p.evaluate(()=>{const e=[...document.querySelectorAll('.rq')].find(e=>Math.abs(e.getBoundingClientRect().top)<80);return e?.querySelector('.meta').textContent}))
const off=await p.$$('.rq .chip.off');console.log('off chips',off.length)
if(off.length){await off[0].evaluate(x=>x.scrollIntoView({block:'center'}));await off[0].click();await S(400);console.log('toast',await p.$eval('.toast',e=>e.textContent).catch(()=>'none'),'on after',(await p.$$('.rq .chip.on.off')).length)}
// 502 重试：/exams/active 前两次返回 502
await p.setRequestInterception(true);let n=0;p.on('request',r=>{if(r.url().endsWith('/exams/active')&&n++<2)r.respond({status:502,body:'bad'});else r.continue()})
await p.goto('http://localhost:4173/#/quiz');await S(1500);await p.goto('http://localhost:4173/#/exam');await S(300);const flash=[];for(let i=0;i<12;i++){flash.push(await p.evaluate(()=>!!document.querySelector('.chip')&&!document.querySelector('.sub')?.textContent.includes('正在看看')));await S(300)}
console.log('502 hits',n,'toast',await p.$eval('.toast',e=>e.textContent).catch(()=>'none'),'loading text seen then lobby',flash.join(''))
await b.close()
