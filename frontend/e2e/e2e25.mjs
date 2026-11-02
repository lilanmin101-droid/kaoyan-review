import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
p.on('response',r=>{const u=r.url();if(/wrong-questions|mastery/.test(u))console.log(r.status(),u.replace(/.*api\/v1/,''))})
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.setItem('paper:year','2023')},tok)
await p.goto('http://localhost:4173/#/quiz');await p.reload();await S(3000)
await p.evaluate(()=>[...document.querySelectorAll('.cell')].find(c=>c.textContent.trim()==='22').click());await S(800)
console.log('zhupi:',await p.$eval('.zhupi',e=>e.innerText).catch(()=>'NONE'))
await b.close()
