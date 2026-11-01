import puppeteer from 'puppeteer-core'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:800})
const W=ms=>new Promise(r=>setTimeout(r,ms))
await p.goto('http://localhost:4173/#/quiz');await W(400)
if(await p.$('.login input')){const ins=await p.$$('.login input');await ins[0].type('fe_test');await ins[1].type('secret123');await p.click('.login .next')}
await p.waitForSelector('.cell');await W(800)
const clk=async t=>p.evaluate(t=>[...document.querySelectorAll('.acts span')].find(s=>s.textContent.includes(t))?.click(),t)
for(const n of ['17','12']){const cells=await p.$$('.cell');for(const c of cells){if((await c.evaluate(e=>e.textContent))===n){await c.click();break}};await W(300)
 if(n==='17'){await clk('思路');await W(500);await clk('参考答案');await W(300);await clk('讲解');await W(1500)}
 else{await clk('思路');await W(500);await p.type('.blank input','x');await clk('对答案');await W(500);await clk('讲解');await W(1000)}
 console.log(n,await p.$$eval('.note',ns=>ns.map(e=>e.textContent.slice(0,120))))
 await p.screenshot({path:`/workspace/kaoyan-ui/r4-${n}.png`,fullPage:true})}
await b.close()
