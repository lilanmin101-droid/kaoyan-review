import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage()
await p.emulate({viewport:{width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'})
p.on('pageerror',e=>console.log('ERR',e.message))
const tap=async sel=>{const h=await p.$(sel);const r=await h.boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2)}
const tapText=async (sel,t)=>{const hs=await p.$$(sel);for(const h of hs){if((await h.evaluate(e=>e.textContent.trim()))===t){const r=await h.boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);return true}}return false}
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
await tapText('.chip','2016');await tapText('.chip','60 分钟');await S(200)
await tap('.acts .next');await S(2500)
// Q1 选 B，然后 20 次连点不同选项，每次立即检查
let miss=0
for(let i=0;i<20;i++){const k='ABCD'[i%4];await tapText('.o .k, .o b, .o span:first-child',k)||await p.evaluate(k=>{},k)
  const hs=await p.$$('.o');const h=hs[i%4];const r=await h.boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);await S(60)
  const sel=await p.$$eval('.o',es=>es.findIndex(e=>e.classList.contains('sel')));if(sel!==i%4)miss++}
console.log('option taps miss',miss,'/20')
// 标记一下：连点 20 次，应回到原状态（不能一次触发两遍）
const f0=await p.$eval('.flag',e=>e.classList.contains('on'))
let fm=0;for(let i=0;i<20;i++){await tap('.flag');await S(80);const on=await p.$eval('.flag',e=>e.classList.contains('on'));if(on===(i%2===0?f0:!f0))fm++}
console.log('flag toggles wrong',fm,'/20')
// 下一题到填空，输入后立刻点「下一题」（失焦+保存同时发生）
for(let i=0;i<9;i++){await tapText('.nav .next, .acts .next','下一题');await S(150)}
const inp=await p.$('.blank input');if(inp){await inp.tap();await p.keyboard.type('2');await tapText('.nav .next, .acts .next','下一题');await S(300);console.log('after typing+next:',await p.$eval('.ebar .t',e=>e.textContent))}
// 去自评页：交卷确认
await tapText('.ebar .link','交卷');await S(300);await tap('.cfm .next');await S(2500)
let rm=0,rc=0;const chips=await p.$$('.rate .chip, .rq .chip, .subs .chip, .chip')
const rateChips=[];for(const c of chips){const t=await c.evaluate(e=>e.textContent.trim());if(['全对','思路对，算错了','没思路'].includes(t))rateChips.push(c)}
for(const c of rateChips.slice(0,20)){await c.evaluate(e=>e.scrollIntoView({block:'center'}));await S(50);const r=await c.boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);await S(60);rc++;if(!(await c.evaluate(e=>e.classList.contains('on'))))rm++}
console.log('rate taps miss',rm,'/',rc)
// 宽公式：有没有超出屏幕又不能滑动的
const bad=await p.evaluate(()=>{const W=innerWidth;const out=[];for(const k of document.querySelectorAll('.katex')){const r=k.getBoundingClientRect();if(r.right<=W+1)continue;let a=k.parentElement,ok=false;while(a){const cs=getComputedStyle(a);if(/(auto|scroll)/.test(cs.overflowX)&&a.scrollWidth>a.clientWidth&&a.getBoundingClientRect().right<=W+1){ok=true;break}a=a.parentElement}if(!ok)out.push(k.textContent.slice(0,40))}return out})
console.log('unscrollable wide formulas',bad.length,bad.slice(0,5))
const q22=await p.evaluateHandle(()=>[...document.querySelectorAll('.katex-display,.tall')].find(e=>e.scrollWidth>e.clientWidth))
if(q22.asElement()){await q22.asElement().evaluate(e=>e.scrollIntoView({block:'center'}));await S(200)}
await p.screenshot({path:'/workspace/kaoyan-ui/r15-wide.png'})
await b.close()
