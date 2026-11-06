import puppeteer from 'puppeteer-core'
import fs from 'fs'
const W=+process.argv[2],tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
{const H={Authorization:'Bearer '+tok};const a=await (await fetch('http://localhost:3000/api/v1/exams/active',{headers:H})).json();if(a?.exam?.id)await fetch(`http://localhost:3000/api/v1/exams/${a.exam.id}/abandon`,{method:'POST',headers:H})}
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
const click=async(sel,txt)=>{const els=await p.$$(sel);let e=els[0];if(txt)for(const x of els)if((await x.evaluate(n=>n.textContent)).includes(txt)){e=x;break}
 if(!e)throw new Error('no '+sel+' '+(txt??''));await e.evaluate(x=>x.scrollIntoView({block:'center'}));await S(250);const bb=await e.boundingBox();W<500?await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2):await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);await S(500)}
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t)},tok)
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
await click('.chip','英语一');await click('.chip','2022')
console.log('btn',await p.$$eval('.next',x=>x.map(e=>e.textContent).join('|')))
await click('.next','开考');await S(2500)
console.log('title',await p.$eval('.t',e=>e.textContent))
await p.screenshot({path:`/workspace/kaoyan-ui/r19-en-cloze-${W}.png`})
await click('.enx .eq .o','');await S(300)
console.log('blank1',await p.$eval('.enx .bl',e=>e.textContent))
// answer sheet → 41
if(W<500)await click('.t');
await click('.cell','41');await S(1200)
console.log('title',await p.$eval('.t',e=>e.textContent))
await click('.mo');await S(300);await click('.mo:nth-of-type(4)');await S(300)
console.log('match picks',await p.$$eval('.mpick',x=>x.map(e=>e.textContent.slice(0,25))))
await p.evaluate(()=>scrollTo(0,0));await S(300)
await p.screenshot({path:`/workspace/kaoyan-ui/r19-en-match-${W}.png`})
await click('.next','下一篇');await S(1000)
console.log('title',await p.$eval('.t',e=>e.textContent))
await p.type('.enx textarea','这是测试译文');await S(1500)
await p.screenshot({path:`/workspace/kaoyan-ui/r19-en-trans-${W}.png`})
await click('.next','下一篇');await click('.next','下一篇');await S(800)
console.log('title',await p.$eval('.t',e=>e.textContent),'imgs',await p.$$eval('.enx .fig img',x=>x.map(i=>i.naturalWidth)))
await p.type('.enx textarea','Dear Sir, I am writing to apply.');await S(1200)
console.log('wc',await p.$eval('.enx .wc',e=>e.textContent),'hov',await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))
await p.screenshot({path:`/workspace/kaoyan-ui/r19-en-write-${W}.png`,fullPage:true})
const id=await p.evaluate(async t=>{const r=await fetch('/api/v1/exams/active',{headers:{Authorization:'Bearer '+t}});return (await r.json())},tok)
console.log('active',JSON.stringify(id).slice(0,200))
await b.close()
