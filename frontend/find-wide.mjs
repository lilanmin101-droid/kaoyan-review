import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
await p.emulate({viewport:{width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'})
await p.goto('http://localhost:4173/');
for(const y of [2019,2024]){
 await p.evaluate((t,y)=>{localStorage.clear();localStorage.setItem('token',t);localStorage.setItem('paper:subj','math1');localStorage.setItem('paper:year',String(y))},tok,y)
 const out=[]
 for(let i=0;i<23;i++){await p.evaluate((y,i)=>localStorage.setItem(`quiz:math1-${y}:idx`,String(i)),y,i);await p.goto('http://localhost:4173/#/quiz');await p.reload();await S(1500)
  const r=await p.evaluate(()=>({n:document.querySelector('.qhead b,.num,.meta')?.textContent?.slice(0,20),w:[...document.querySelectorAll('.katex-display,.tall,.wide')].filter(e=>e.scrollWidth>e.clientWidth+2).length,h:!!document.querySelector('.draghint')}))
  if(r.w)out.push(i+1+':'+r.w+(r.h?'H':''))}
 console.log(y,out.join(' '))}
await b.close()
