import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms)), O='/workspace/kaoyan-ui/'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
const click=async t=>{await p.evaluate(t=>[...document.querySelectorAll('.link,.fold,.next,span')].find(x=>x.textContent.trim().startsWith(t)).click(),t);await S(900)}
const txt=async()=>p.$eval('main',e=>e.innerText.split('\n').filter(l=>/错 题 本|已掌握|已 掌 握|后来做对|错过|收起/.test(l)).join(' | '))
await p.goto('http://localhost:4173/#/wrong');await p.reload();await S(2500)
await click('已掌握，移出');console.log(1,await txt())
await click('已掌握 1 道');console.log(2,await txt());await p.screenshot({path:O+'r9-wrong-fold.png',fullPage:true})
await click('放回错题本');console.log(3,await txt())
await p.goto('http://localhost:4173/#/words');await S(2000);console.log(await p.$eval('.cap',e=>e.textContent))
await click('看释义');await click('记住了');console.log(await p.$eval('.cap',e=>e.textContent))
await p.reload();await S(2000);console.log('F5',await p.$eval('.cap',e=>e.textContent))
await b.close()
