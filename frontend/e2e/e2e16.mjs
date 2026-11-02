import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms)), O='/workspace/kaoyan-ui/'
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
const click=async t=>{const ok=await p.evaluate(t=>{const e=[...document.querySelectorAll('span,a,div')].find(x=>x.textContent.trim().startsWith(t)&&x.children.length<3);if(e){e.click();return true}return false},t);if(!ok)console.log('MISSING',t);await S(700)}
const bar=()=>p.$eval('.ebar',e=>e.innerText.replace(/\n/g,' ')).catch(()=>'-')
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
await p.screenshot({path:O+'r11-exam-lobby.png'})
await click('2016');await click('开考');await S(1500);console.log('start',await bar())
await p.click('.o');await S(1200);console.log('ans1',await bar())
await p.setOfflineMode(true);await click('下一题');await p.click('.o:nth-child(2)');await S(1200);console.log('offline',await bar())
await p.screenshot({path:O+'r11-exam-offline.png'})
await p.setOfflineMode(false);await p.evaluate(()=>dispatchEvent(new Event('online')));await S(2000);console.log('online',await bar())
await click('暂停');console.log('paused',await bar());await p.screenshot({path:O+'r11-exam-paused.png'})
await p.reload();await S(2500);console.log('lobby:',await p.$eval('main',e=>e.innerText.replace(/\n/g,' ')))
await click('接着做');await S(1500);console.log('resumed',await bar(),await p.$eval('.cap',e=>e.textContent).catch(()=>''))
await p.screenshot({path:O+'r11-exam-run.png'})
await p.evaluate(()=>{[...document.querySelectorAll('.side .next')].find(x=>x.textContent.includes('交卷')).click()});await S(2500)
// 自评：每道解答题第一个选项（全对）
await p.evaluate(()=>{document.querySelectorAll('.rq .rate').forEach(r=>r.querySelector('.chip').click())});await S(300)
await p.screenshot({path:O+'r11-exam-rate.png',fullPage:true})
await click('交卷，看成绩');await S(3000)
console.log('result:',await p.$eval('main',e=>e.innerText.replace(/\n/g,' ')))
await p.screenshot({path:O+'r11-exam-result.png'})
await b.close()
