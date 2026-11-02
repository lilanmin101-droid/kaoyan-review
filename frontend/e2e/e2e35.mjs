import puppeteer from 'puppeteer-core'
import fs from 'fs'
const W=+process.argv[2],tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const H={Authorization:'Bearer '+tok,'Content-Type':'application/json'},A='http://localhost:3000/api/v1'
{const a=await (await fetch(A+'/exams/active',{headers:H})).json();if(a?.exam?.id)await fetch(`${A}/exams/${a.exam.id}/abandon`,{method:'POST',headers:H})}
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
const click=async(sel,txt)=>{const els=await p.$$(sel);let e=els[0];if(txt)for(const x of els)if((await x.evaluate(n=>n.textContent)).includes(txt)){e=x;break}
 if(!e)throw new Error('no '+sel+' '+(txt??''));await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(250);const bb=await e.boundingBox();W<500?await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2):await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);await S(500)}
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.setItem('exam:subj','english1')},tok)
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
await click('.chip','2022');await click('.next','开考');await S(2500)
await click('.bl[data-n="2"]');await S(600)
console.log('pop',!!await p.$('.cpop'),await p.$eval('.cpop .cph',e=>e.textContent).catch(()=>null))
await p.screenshot({path:`/workspace/kaoyan-ui/r20-exam-pop-${W}.png`})
if(W>=500){await p.keyboard.press('b');await S(500)}else{await click('.cpop .co:nth-of-type(3)')}
console.log('blank2',await p.$eval('.bl[data-n="2"]',e=>e.textContent),'next pop',await p.$eval('.cpop .cph',e=>e.textContent).catch(()=>null))
const y0=await p.evaluate(()=>scrollY);console.log('scrollY',y0)
if(W<500)await click('.t');
await click('.cell','41');await S(1200)
await p.evaluate(()=>scrollTo(0,document.body.scrollHeight));await S(500)
console.log('mopts top',await p.$eval('.mopts',e=>Math.round(e.getBoundingClientRect().top)),'ebar h',await p.$eval('.ebar',e=>e.offsetHeight))
await p.screenshot({path:`/workspace/kaoyan-ui/r20-exam-match-sticky-${W}.png`})
// submit via API then open result
const a=await (await fetch(A+'/exams/active',{headers:H})).json();const id=a.exam.id
const r=await fetch(`${A}/exams/${id}/submit`,{method:'POST',headers:H,body:JSON.stringify({self_ratings:{}})});console.log('submit',r.status)
await p.goto(`http://localhost:4173/#/exam/${id}/result`);await p.reload();await S(3000)
console.log('types',await p.$$eval('.brk table:first-child td:first-child',x=>x.map(e=>e.textContent).join(',')))
await click('.slist .chip.bad');await S(4000)
console.log('peek',await p.$eval('.qpeek',e=>e.textContent.slice(0,200)).catch(()=>'none'))
await p.screenshot({path:`/workspace/kaoyan-ui/r20-result-peek-${W}.png`})
await b.close()
