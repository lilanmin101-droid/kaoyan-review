import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
b.on('targetcreated',t=>console.log('NEW TARGET',t.type(),t.url()))
for (const w of [1280,390]) {
const p=await b.newPage();await p.setViewport({width:w,height:844});p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/today');await p.reload();await S(2000)
const st=async l=>console.log(w,l,await p.evaluate(()=>{const c=document.querySelector('.cmd');return {hash:location.hash,cmd:!!c,vis:c?c.getBoundingClientRect().height:0,txt:document.querySelector('main')?.innerText.slice(0,80)}}))
await st('today')
const sel=w>600?'.tabs a':'.btabs a'
for (const t of ['刷题','单词','今日','错题本','今日','我的','今日','刷题','今日']) {
  await p.evaluate((s,t)=>[...document.querySelectorAll(s)].find(a=>a.textContent===t).click(),sel,t); await S(t==='今日'?1500:600); if(t==='今日'||t==='刷题') await st(t)
}
await p.close()}
await b.close()
