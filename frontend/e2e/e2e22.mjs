import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:390,height:844,deviceScaleFactor:2});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2000)
await p.evaluate(()=>{const n=document.querySelector('.next');n.click()});await S(2500)
const vis=()=>p.$eval('.exam .side',e=>e.getBoundingClientRect().top<844)
console.log('drawer visible before',await vis())
await p.click('.ebar .t');await S(400);console.log('after tap',await vis());await p.screenshot({path:'/workspace/kaoyan-ui/r12-exam-drawer.png'})
await p.evaluate(()=>[...document.querySelectorAll('.exam .cell')].find(c=>c.textContent==='7').click());await S(500)
console.log('after pick',await vis(),await p.$eval('.ebar .t',e=>e.textContent))
await b.close()
