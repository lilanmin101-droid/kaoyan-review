import puppeteer from 'puppeteer-core'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:800})
const W=ms=>new Promise(r=>setTimeout(r,ms))
await p.goto('http://localhost:4173/#/quiz');await W(400)
if(await p.$('.login input')){const ins=await p.$$('.login input');await ins[0].type('fe_test');await ins[1].type('secret123');await p.click('.login .next')}
await p.waitForSelector('.cell.yr');await W(500)
await p.evaluate(()=>[...document.querySelectorAll('.cell.yr')].find(e=>e.textContent==='2023').click());await W(1500)
console.log('sub',await p.$eval('.wm em',e=>e.textContent),'count',await p.$eval('.no small',e=>e.textContent),'err',await p.$$eval('.tex-err',e=>e.length))
const cells=await p.$$('.cell:not(.yr)');await cells[cells.length-1].click();await W(300)
await p.evaluate(()=>[...document.querySelectorAll('.acts span')].find(s=>s.textContent.includes('参考答案'))?.click());await W(400)
await p.screenshot({path:'/workspace/kaoyan-ui/r5-2023.png',fullPage:true})
let bad=0;for(let i=0;i<22;i++){const rows=await p.$$('.sheet .row, .cell:not(.yr)');await rows[i].click();await W(120);bad+=await p.$$eval('.tex-err',e=>e.length)};console.log('tex errors across 2023:',bad)
await b.close()
