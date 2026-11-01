import puppeteer from 'puppeteer-core'
import fs from 'fs'
const W=+(process.argv[2]||1280), mob=W<760
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage()
await p.emulate({viewport:{width:W,height:mob?844:860,deviceScaleFactor:mob?2:1,isMobile:mob,hasTouch:mob},userAgent:mob?'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1':'Mozilla/5.0 Chrome/130'})
p.on('pageerror',e=>console.log('ERR',e.message)); p.on('console',m=>m.type()==='error'&&console.log('CERR',m.text()))
const click=async h=>{await h.evaluate(e=>e.scrollIntoView({block:'center',inline:'center'}));await S(150);if(mob){const r=await h.boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2)}else await h.click()}
const byText=async (sel,t)=>{for(const h of await p.$$(sel))if((await h.evaluate(e=>e.textContent.trim())).startsWith(t))return h;return null}
const shot=n=>p.screenshot({path:`/workspace/kaoyan-ui/r16-${n}-${W}.png`,fullPage:false})
await p.goto('http://localhost:4173/');await p.evaluate(t=>{localStorage.setItem('token',t);localStorage.removeItem('en:english1-2024:g');localStorage.setItem('paper:subj','math1')},tok)
await p.goto('http://localhost:4173/#/quiz');await p.reload();await S(2500)
await click(await byText('.seg.subj span','英语一'));await S(2000)
console.log('sub:',await p.$eval('.wm em',e=>e.textContent),'groups:',await p.$$eval('.glist .gl',es=>es.map(e=>e.textContent.trim()).join(' | ')))
// 完形：空位数、点空位聚焦、选项填进原文
const blanks=await p.$$('.ptext .bl');console.log('cloze blanks',blanks.length,'questions',(await p.$$('.eq')).length)
await click(blanks[2]);await S(600);console.log('focused',await p.$eval('.eq.cur .qn b',e=>e.textContent))
const qs=await p.$$('.eq');for(let i=0;i<qs.length;i++){const os=await qs[i].$$('.o');await click(os[i%4]);await S(30)}
console.log('blank 1 shows:',await p.$eval('.ptext .bl',e=>e.textContent))
await shot('cloze')
await click(await p.$('.gact .next'));await S(1500)
console.log('checked: ok',(await p.$$('.ptext .bl.ok')).length,'bad',(await p.$$('.ptext .bl.bad')).length,'|',await p.$eval('.gact',e=>e.textContent))
await p.evaluate(()=>scrollTo(0,0));await shot('cloze-done')
// 阅读 Text 1
await click((await p.$$('.glist .gl'))[1]);await S(800)
console.log('text1 meta:',await p.$eval('.meta',e=>e.textContent.trim()),'paras',(await p.$$('.ptext .para')).length)
await shot('reading')
// 新题型
await click(await byText('.glist .gl','新题型'));await S(800)
console.log('partb options',(await p.$$('.qs .mopts .mo')).length,'match chips/q',(await p.$$('.qs .eq .mk'))[0]&&(await (await p.$$('.qs .eq'))[0].$$('.chip')).length)
await click((await (await p.$$('.qs .eq'))[0].$$('.chip'))[0]);await S(200);await shot('partb')
// 翻译
await click(await byText('.glist .gl','翻译'));await S(800)
console.log('underlines',(await p.$$('.ptext .ul')).length,'textareas',(await p.$$('.eq textarea')).length)
await click((await p.$$('.ptext .ul'))[1]);await S(600);console.log('focus after underline tap',await p.$eval('.eq.cur .qn b',e=>e.textContent))
const ta=(await p.$$('.eq textarea'))[1];await ta.focus();await p.keyboard.type('研究人员确信大象能用嗅觉分辨数量。')
await click(await (await p.$$('.eq'))[1].$('.wbar .next'));await S(1500)
console.log('grade state:',await (await p.$$('.eq'))[1].$eval('.grade',e=>e.textContent.trim().slice(0,40)))
await shot('translation')
// 大作文
await click(await byText('.glist .gl','大作文'));await S(800)
await (await p.$('.eq textarea')).focus();await p.keyboard.type('As is vividly shown in the chart, the number of students rose steadily. ');await S(300)
console.log('word count',await p.$eval('.wc',e=>e.textContent))
await shot('writing')
// 刷新后答案还在
await p.reload();await S(2500);await click(await byText('.glist .gl','完形'));await S(800)
console.log('after reload cloze ok/bad',(await p.$$('.ptext .bl.ok')).length+(await p.$$('.ptext .bl.bad')).length)
// 横向溢出
console.log('h-overflow',await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))
await b.close()
