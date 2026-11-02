// e2e55-mock：离线题包说明走后端 summary + 错题重做分组入口（be/key-preflight 的 mock，经 preview 代理）
// 用法（在 frontend/ 下）：node e2e/e2e55-mock.mjs <宽度> [base]   默认 base=http://localhost:4181（API_TARGET 指向带 summary 的 mock）
// mock 不校验密码：直接放一个 mock token，不涉及任何真实账号
import puppeteer from 'puppeteer-core'
const W=+process.argv[2],BASE=process.argv[3]||'http://localhost:4181',S=ms=>new Promise(r=>setTimeout(r,ms)),OUT='/workspace/kaoyan-ui'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
let fails=0,errs=0;const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++}
const p=await (await b.createBrowserContext()).newPage();p.on('pageerror',e=>{errs++;console.log('ERR',e.message)})
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'iPhone Mobile'});else await p.setViewport({width:W,height:800})
const overflow=()=>p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)
await p.goto(BASE+'/');await p.evaluate(()=>{localStorage.clear();localStorage.setItem('token','mock')});await p.goto(BASE+'/#/quiz');await p.reload()
let pk=null;for(let i=0;i<30&&!pk;i++){await S(300);pk=await p.evaluate(()=>JSON.parse(localStorage.getItem('offline:pack')||'null'))}
ok(!!pk?.summary,'[⑤] 题包缓存里保留了后端 summary：'+pk?.summary);ok(!!pk?.counts&&pk.counts.wrong_redo_limit===10,'[⑤] 保留了 counts（含 wrong_redo_limit）')
await S(800);await p.setOfflineMode(true);await S(2000)
const hint=await p.$eval('.offq .hint',e=>e.textContent).catch(()=>'');console.log('[⑤] 说明',JSON.stringify(hint))
ok(hint.includes(pk.summary),'[⑤] 离线页说明就是后端 summary');ok(!/今天任务里|10 道错题/.test(hint),'[⑤⑦] 不再写死「今天任务里的…加 10 道错题」')
const chips=await p.$$eval('.offq .ogrp .chip',a=>a.map(x=>x.textContent.trim()));console.log('[⑤] 分组',chips)
const redo=pk.questions.filter(q=>q.origin==='wrong_redo').length
ok(chips.length===2&&chips[1]===`错题重做 0/${redo}`,'[⑤] 有今日题 / 错题重做两个入口')
await p.evaluate(()=>[...document.querySelectorAll('.offq .ogrp .chip')][1].click());await S(700)
const meta=await p.$eval('.offq .meta',e=>e.textContent);console.log('[⑤] 跳转后',JSON.stringify(meta))
ok(/错题重做/.test(meta),'[⑤] 点一下就到第一道错题重做');ok(await p.$eval('.offq .ogrp .chip.on',e=>e.textContent.startsWith('错题重做')),'[⑤] 当前分组高亮')
ok(!(await overflow()),'无横向溢出');await p.screenshot({path:`${OUT}/r25-m-mock-summary-${W}.png`})
await p.evaluate(()=>[...document.querySelectorAll('.offq .ogrp .chip')][0].click());await S(500)
ok(!/错题重做/.test(await p.$eval('.offq .meta',e=>e.textContent)),'[⑤] 点「今日题」回到第一组')
ok(errs===0,'无 pageerror');console.log(fails?`${fails} FAIL`:'ALL PASS');await b.close();process.exit(fails?1:0)
