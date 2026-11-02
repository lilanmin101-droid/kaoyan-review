import puppeteer from 'puppeteer-core';import fs from 'fs'
// 用法：node e2e/e2e42.mjs <宽度>；E2E_BASE（默认 http://localhost:4173）、E2E_TOKEN_FILE（默认 /tmp/tok）、E2E_TAG（截图名前缀，默认空）
const BASE=process.env.E2E_BASE||'http://localhost:4173'
const W=+process.argv[2],tok=fs.readFileSync(process.env.E2E_TOKEN_FILE||'/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
await p.goto(BASE+'/');await p.evaluate(t=>{localStorage.clear();localStorage.setItem('token',t)},tok)
await p.goto(BASE+'/#/');await p.reload();await S(3000)
console.log('hash',await p.evaluate(()=>location.hash),'card',await p.$eval('.pendex',e=>e.textContent).catch(()=>'none'))
await p.screenshot({path:`/workspace/kaoyan-ui/r26-pend-${process.env.E2E_TAG||""}${W}.png`})
await (await p.$('.pendex')).click();for(let i=0;i<12;i++){await S(300);const h=await p.$eval('.rq.hot',e=>e.id).catch(()=>null);if(h){console.log('hotAt',i*300,h);await p.screenshot({path:`/workspace/kaoyan-ui/r27-hot-${process.env.E2E_TAG||""}${W}.png`});break}}
console.log('stage',await p.evaluate(()=>document.querySelector('.cap')?.textContent),'hot',await p.$eval('.rq.hot .meta',e=>e.textContent).catch(()=>'none'))
await b.close()
