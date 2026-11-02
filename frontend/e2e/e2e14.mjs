import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms)), O='/workspace/kaoyan-ui/'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
for (const [w,h,n] of [[1280,900,'d'],[390,844,'m']]) {
const p=await b.newPage();await p.setViewport({width:w,height:h,deviceScaleFactor:n==='m'?2:1});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.setItem('paper:year','2023');localStorage.setItem('quiz:math1-2023:idx','21');localStorage.removeItem('zhupi:ignored')},tok)
await p.goto('http://localhost:4173/#/quiz');await p.reload();await S(3000)
console.log(n, await p.$eval('.no',e=>e.textContent), await p.$$eval('.zhupi',e=>e.map(x=>x.innerText)))
await p.screenshot({path:O+`r10-zhupi-${n}.png`});await p.close()}
await b.close()
