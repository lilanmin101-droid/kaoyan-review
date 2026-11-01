import puppeteer from 'puppeteer-core';import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms)),H={authorization:'Bearer '+tok,'content-type':'application/json'}
const act=await (await fetch('http://localhost:3000/api/v1/exams/active',{headers:H})).json();if(act.exam){console.log('active exists',act.exam.title);process.exit(0)}
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1280,height:800})
p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
const e=await (await fetch('http://localhost:3000/api/v1/exams',{method:'POST',headers:H,body:JSON.stringify({exam:'english1',year:2018,duration_minutes:180})})).json()
await p.goto('http://localhost:4173/#/exam/go');await p.reload();await S(3000)
const clk=()=>p.$eval('.clk',e=>e.textContent)
console.log('start',await clk())
// 模拟锁屏 30 分钟：时钟往前拨，页面回到前台
await p.setRequestInterception(true);p.on('request',r=>r.url().includes('/progress')?r.abort():r.continue());await p.evaluate(()=>{const o=Date.now.bind(Date);Date.now=()=>o()+30*60e3;Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'))});await S(50)
console.log('after 30min (client)',await clk());await S(2500);console.log('after server sync',await clk())
await fetch(`http://localhost:3000/api/v1/exams/${e.exam?.id??e.id}/abandon`,{method:'POST',headers:H}).then(r=>r.json()).then(j=>console.log('abandon',j.status,j.discarded))
await b.close()
