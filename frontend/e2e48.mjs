// 模考趋势：/exams 列表里把一场标 non_continuous，看空心点、不连线、估分只用连续作答
import puppeteer from 'puppeteer-core';import fs from 'fs'
const W=+process.argv[2]||1280,S=ms=>new Promise(r=>setTimeout(r,ms))
const tok=fs.readFileSync('/tmp/tok','utf8').trim(),H={authorization:'Bearer '+tok}
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true},userAgent:'Mobile'});else await p.setViewport({width:W,height:800})
p.on('pageerror',e=>console.log('ERR',e.message))
await p.setBypassServiceWorker(true);await p.setRequestInterception(true)
let NC=null,EN=null
p.on('request',async r=>{const u=r.url();
if(r.method()==='GET'&&EN&&u.endsWith('/exams/'+EN)){const j=await (await fetch(u.replace('4173','3000'),{headers:H})).json();let k=0;for(const q of j.result.per_question){if(q.objective===false){if(q.section==='writing_b'){q.got=18;q.self_grade_flags=['word_count_low']}else if(q.section==='writing_a'){q.got=6;q.self_grade_flags=[]}}};for(const s of j.result.sections)if(s.section==='reading_a')s.score=30;return r.respond({status:200,contentType:'application/json',body:JSON.stringify(j)})}
if(r.method()==='GET'&&u.includes('/exams?limit=50')){const j=await (await fetch(u.replace('4173','3000'),{headers:H})).json();const m=j.items.filter(x=>x.status==='submitted'&&x.exam==='math1');NC=m[1]?.id;EN=j.items.filter(x=>x.status==='submitted'&&x.exam==='english1')[0]?.id;j.items=j.items.map(x=>x.id===NC?{...x,non_continuous:true,counts_in_trend:false,score:120}:x);return r.respond({status:200,contentType:'application/json',body:JSON.stringify(j)})}r.continue()})
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(3000)
const info=await p.evaluate(()=>({seg:[...document.querySelectorAll('.trend .seg span')].map(x=>x.textContent+(x.classList.contains('on')?'*':'')),on:document.querySelectorAll('.trsvg circle.on').length,off:document.querySelectorAll('.trsvg circle.off').length,line:document.querySelector('.trsvg .ln')?.getAttribute('points')?.split(' ').length,est:document.querySelector('.trest')?.textContent,note:[...document.querySelectorAll('.trnote')].map(x=>x.textContent).join(' | '),cap:document.querySelector('.trend .cap')?.textContent}))
console.log(JSON.stringify(info))
await (await p.$('.trend')).screenshot({path:`/workspace/kaoyan-ui/r32-trend-${W}.png`})
const segs=await p.$$('.trend .seg span');for(const s of segs){if((await s.evaluate(e=>e.textContent))==='数学一'){await s.click();await S(300)}}
console.log(JSON.stringify(await p.evaluate(()=>({on:document.querySelectorAll('.trsvg circle.on').length,off:document.querySelectorAll('.trsvg circle.off').length,line:document.querySelector('.trsvg .ln')?.getAttribute('points')?.split(' ').length,est:document.querySelector('.trest')?.textContent,note:document.querySelector('.trnote')?.textContent}))))
await (await p.$('.trend')).screenshot({path:`/workspace/kaoyan-ui/r32-trend-math-${W}.png`})
await p.evaluate(()=>document.querySelector('.trsvg .dot:last-of-type').dispatchEvent(new MouseEvent('click',{bubbles:true})));await S(2000)
console.log('open dot ->',await p.$eval('.summary .cap',e=>e.textContent).catch(()=>'no result'))
await b.close()
