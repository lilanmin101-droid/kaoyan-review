import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:390,height:844,isMobile:true})
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.setItem('paper:year','2024');localStorage.setItem('quiz:math1-2024:idx','18')},tok)
await p.reload();await S(2500)
await p.evaluate(()=>{const e=[...document.querySelectorAll('span')].find(x=>x.textContent.trim()==='看参考答案');e&&e.click()});await S(1000)
console.log(await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>{const c=getComputedStyle(e);return (/(auto|scroll)/.test(c.overflowY)&&e.scrollHeight>e.clientHeight+1)||(/(auto|scroll)/.test(c.overflowX)&&e.scrollWidth>e.clientWidth+1)}).map(e=>e.className+' '+e.scrollWidth+'x'+e.scrollHeight+' / '+e.clientWidth+'x'+e.clientHeight)))
await b.close()
