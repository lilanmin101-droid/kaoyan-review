import puppeteer from 'puppeteer-core'; import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), SW='dist/sw.js', orig=fs.readFileSync(SW,'utf8')
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}); const p=await b.newPage()
const S=ms=>new Promise(r=>setTimeout(r,ms))
try{
await p.goto('http://localhost:4173/'); await p.evaluate(t=>localStorage.setItem('token',t),tok); await p.reload()
await p.waitForFunction(()=>navigator.serviceWorker.controller,{timeout:15000}); console.log('controlled')
p.on('framenavigated',f=>f===p.mainFrame()&&console.log('NAV',f.url()));p.on('console',m=>console.log('C',m.text()));console.log('bar before:', !!await p.$('.updbar'))
fs.writeFileSync(SW, orig+'\n// bump '+Date.now())
await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration(); await r.update()})
await p.waitForFunction(()=>document.querySelector('.updbar'),{timeout:15000}); console.log('bar after update:', await p.$eval('.updbar',e=>e.textContent))
await p.evaluate(()=>window.__mark=1)
await Promise.all([p.waitForNavigation({timeout:15000}), p.click('.updbar')])
console.log('reloaded:', await p.evaluate(()=>window.__mark===undefined), 'bar now:', !!await p.$('.updbar'))
// 作答中不弹
fs.writeFileSync(SW, orig+'\n// bump2 '+Date.now()); await p.evaluate(()=>window.dispatchEvent(new Event('x')))
await p.evaluate(()=>{const i=document.createElement('input');document.body.append(i);i.dispatchEvent(new Event('input',{bubbles:true}))})
await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration(); await r.update()}); await S(3000)
console.log('bar while answering:', !!await p.$('.updbar'))
} finally { fs.writeFileSync(SW, orig); await b.close() }
