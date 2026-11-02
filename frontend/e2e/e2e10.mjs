import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms)), O='/workspace/kaoyan-ui/'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/today');await p.reload();await S(2000)

console.log(await p.$eval('main',e=>e.innerText))
await p.screenshot({path:O+'r8-today.png',fullPage:true})
await p.setViewport({width:390,height:844,isMobile:true});await p.reload();await S(2000)
await p.screenshot({path:O+'r8-m-today.png',fullPage:true})
await b.close()
