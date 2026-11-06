import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim()
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900})
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.setItem('paper:year','2023');localStorage.setItem('quiz:math1-2023:idx','21')},tok)
await p.reload();await new Promise(r=>setTimeout(r,2500))
console.log(await p.$$eval('.scoreline',e=>e.map(x=>x.textContent)))
await p.screenshot({path:'/workspace/kaoyan-ui/r6-q22.png'})
await p.evaluate(()=>localStorage.setItem('quiz:math1-2023:idx','19'));await p.reload();await new Promise(r=>setTimeout(r,2500))
console.log(await p.$$eval('.scoreline',e=>e.map(x=>x.textContent)))
await p.screenshot({path:'/workspace/kaoyan-ui/r6-q20.png'});await b.close()
