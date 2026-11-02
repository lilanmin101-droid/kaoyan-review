import puppeteer from 'puppeteer-core'; import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), ID=process.argv[2]
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}); const p=await b.newPage()
await p.goto('http://localhost:4173/'); await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto(`http://localhost:4173/#/exam/${ID}/result`); await p.reload(); await new Promise(r=>setTimeout(r,4000)); console.log(await p.evaluate(()=>document.body.innerText.slice(0,300))); await new Promise(r=>setTimeout(r,1500))
console.log(await p.$eval('.summary .splitln',e=>e.textContent).catch(()=>'none'))
await b.close()
