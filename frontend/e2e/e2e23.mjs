import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2000)
await p.evaluate(()=>document.querySelector('.next').click());await S(2500)
// 选择题随手答 A/B，填空随手填
for(let i=0;i<16;i++){await p.evaluate(i=>{const os=document.querySelectorAll('.exam .o');if(os.length)os[i%3].click();const inp=document.querySelector('.exam .blank input');if(inp){inp.value='1';inp.dispatchEvent(new Event('input'))}},i);await S(900);await p.evaluate(()=>[...document.querySelectorAll('.acts span')].find(x=>x.textContent==='下一题')?.click());await S(200)}
await p.evaluate(()=>[...document.querySelectorAll('.ebar .link')].find(x=>x.textContent==='交卷').click());await S(3000)
await p.evaluate(()=>{document.querySelectorAll('.rq').forEach((r,i)=>{const c=r.querySelectorAll('.chip');c.forEach((x,j)=>{});}); [...document.querySelectorAll('.rate')].forEach((r,i)=>{const c=r.querySelectorAll('.chip');c[i%3]?.click()})});await S(300)
await p.evaluate(()=>[...document.querySelectorAll('.next')].find(x=>x.textContent.includes('交卷')).click());await S(3500)
console.log((await p.$eval('main',e=>e.innerText)).slice(0,900))
await p.screenshot({path:'/workspace/kaoyan-ui/r12-result-d.png',fullPage:true})
await p.setViewport({width:390,height:844,deviceScaleFactor:2});await S(500);await p.screenshot({path:'/workspace/kaoyan-ui/r12-result-m.png',fullPage:true})
await b.close()
