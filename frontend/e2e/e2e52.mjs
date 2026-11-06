import puppeteer from 'puppeteer-core'; import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), ID=process.argv[2]
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}); const p=await b.newPage()
await p.goto('http://localhost:4173/'); await p.evaluate(t=>localStorage.setItem('token',t),tok)
// 模拟后端新字段：列表里给这场补上 12 分字数不够
await p.evaluateOnNewDocument(id=>{const f=window.fetch;window.fetch=async(...a)=>{const r=await f(...a);if(String(a[0]).includes('/exams?limit=50')){const j=await r.clone().json();for(const x of j.items)if(x.id===id){x.objective_score=0.5;x.subjective_self_score=20;x.subjective_excluded_points=12}return new Response(JSON.stringify(j),{status:200,headers:{'content-type':'application/json'}})}return r}},ID)
await p.goto(`http://localhost:4173/#/exam/${ID}/result`); await p.reload(); await new Promise(r=>setTimeout(r,4000)); console.log(await p.evaluate(()=>document.body.innerText.slice(0,300))); await new Promise(r=>setTimeout(r,1500))
console.log(await p.$eval('.summary .splitln',e=>e.textContent).catch(()=>'none'))
await b.close()
