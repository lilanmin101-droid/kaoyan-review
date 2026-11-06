import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
const click=async t=>{await p.evaluate(t=>[...document.querySelectorAll('.link,.fold,.next,span,div')].find(x=>x.textContent.trim().startsWith(t)&&x.children.length<2).click(),t);await S(150)}
await p.goto('http://localhost:4173/#/words');await p.reload();await S(2000)
const cap=()=>p.$eval('.cap',e=>e.textContent), wd=()=>p.$eval('.word',e=>e.textContent).catch(()=>'-')
console.log(await cap(),await wd());await click('看释义');await click('记住了');console.log('1click',await cap(),await wd())
await S(1500);await p.reload();await S(2000);console.log('F5',await cap(),await wd())
await p.goto('http://localhost:4173/#/today');await S(2500)
console.log(await p.$eval('main',e=>e.innerText.split('\n').filter(l=>/已撤回|撤回/.test(l)).join(' | ')))
await b.close()
