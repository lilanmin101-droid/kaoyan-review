import puppeteer from 'puppeteer-core'
const D='/workspace/kaoyan-ui/r2-'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:800})
const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>m.type()==='error'&&errs.push(m.text()))
const W=ms=>new Promise(r=>setTimeout(r,ms))
await p.goto('http://localhost:4173/');await p.evaluate(()=>localStorage.clear());await p.reload()
await p.waitForSelector('.login input')
const ins=await p.$$('.login input');await ins[0].type('fe_test');await ins[1].type(process.env.TEST_PW||(await import('fs')).readFileSync('/workspace/.kaoyan_testpw','utf8').trim())
await p.click('.login .next');await p.waitForSelector('.sheet .row',{timeout:8000});await W(500)
console.log('toast:',await p.$eval('.toast',e=>e.textContent).catch(()=>'none'))
console.log('rows',(await p.$$('.sheet .row')).length,'cells',(await p.$$('.cell')).length)
// 第 9 题：给个思路
await (await p.$$('.sheet .row'))[8].click();await W(300)
await p.evaluate(()=>[...document.querySelectorAll('.acts span')].find(s=>s.textContent.includes('思路')).click());await W(600)
console.log('acts:',await p.$eval('.acts',e=>e.textContent), await p.$eval('.note',e=>e.textContent).catch(()=>'no note'))
await p.evaluate(()=>[...document.querySelectorAll('.acts span')].find(s=>s.textContent.includes('再给')).click());await W(600)
await p.screenshot({path:D+'q9-hint.png'})
// 选 D 对答案，看讲解
await (await p.$$('.opts .o'))[3].click();await p.click('.acts .next');await W(500)
await p.evaluate(()=>[...document.querySelectorAll('.acts span')].find(s=>s.textContent.includes('讲解')).click());await W(1500)
await p.screenshot({path:D+'q9-explain.png',fullPage:true})
// 第 11 题填空
await (await p.$$('.cell'))[0].click();await W(300)
await p.type('.blank input','6');await p.click('.acts .next');await W(600)
await p.screenshot({path:D+'q11-blank.png'})
// 第 19 题解答
const cells=await p.$$('.cell');for(const c of cells){if((await c.evaluate(e=>e.textContent))==='19'){await c.click();break}};await W(300)
await p.click('.acts .next');await W(300);await p.screenshot({path:D+'q19-essay.png',fullPage:true})
await p.evaluate(()=>[...document.querySelectorAll('.rate .chip')][1].click());await W(500)
// 刷新后恢复
await p.reload();await p.waitForSelector('.sheet .row');await W(600)
console.log('after reload no:',await p.$eval('.no',e=>e.textContent),'filled cells',(await p.$$('.cell.f')).length,'filled b',(await p.$$('.row .b.f')).length)
await p.click('.submit');await W(300);await p.screenshot({path:D+'summary.png'})
for(const t of ['today','wrong','words','me']){await p.goto('http://localhost:4173/#/'+t);await W(900);await p.screenshot({path:D+t+'.png'})}
await p.setViewport({width:390,height:844});await p.goto('http://localhost:4173/#/quiz');await W(1200);await p.screenshot({path:D+'phone.png'})
console.log('errors',errs)
await b.close()
