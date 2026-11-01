import puppeteer from 'puppeteer-core'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:390,height:844})
const W=ms=>new Promise(r=>setTimeout(r,ms))
await p.goto('http://localhost:4173/');await W(300)
if(await p.$('.login input')){const ins=await p.$$('.login input');await ins[0].type('fe_test');await ins[1].type('secret123');await p.click('.login .next')}
await p.waitForSelector('.no');await W(3000)
for(const n of [19,5]){const cells=await p.$$('.cell, .sheet .row');for(const c of cells){const t=await c.evaluate(e=>(e.querySelector('.n')||e).textContent.trim());if(t==String(n)){await c.click();break}};await W(500)
console.log(n,'scrollW',await p.evaluate(()=>document.documentElement.scrollWidth))
await p.screenshot({path:`/workspace/kaoyan-ui/r2-phone-${n}.png`})}
await p.setViewport({width:1280,height:800});await W(300);await p.screenshot({path:'/workspace/kaoyan-ui/r2-q5-desk.png'})
await b.close()
