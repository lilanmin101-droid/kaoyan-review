import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>console.log('ERR',e.message))
p.on('console',m=>console.log('CON',m.text()))
p.on('request',r=>{if(r.url().includes('/progress'))console.log('REQ',r.postData())})
p.on('response',async r=>{if(r.url().includes('/progress'))console.log('RES',r.status(),(await r.text()).slice(0,160).replace(/"question_ids":\[[^\]]*\]/,''))})
p.on('requestfailed',r=>{if(r.url().includes('/progress'))console.log('FAIL',r.postData())})
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
const click=async t=>{await p.evaluate(t=>[...document.querySelectorAll('span,a')].find(x=>x.textContent.trim().startsWith(t)).click(),t);await S(900)}
await p.goto('http://localhost:4173/#/exam');await p.reload();await S(2500)
await click('2016');await click('开考');await S(1500)
await p.click('.o');await S(1200)
await p.setOfflineMode(true);await click('下一题');await p.click('.o:nth-child(2)');await S(1200)
await p.setOfflineMode(false);await p.evaluate(()=>dispatchEvent(new Event('online')));await S(2500)
await b.close()
