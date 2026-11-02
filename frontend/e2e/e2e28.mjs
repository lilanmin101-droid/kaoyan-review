import puppeteer from 'puppeteer-core'
import fs from 'fs'
const tok=fs.readFileSync('/tmp/tok','utf8').trim(), S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})
const p=await b.newPage();await p.setViewport({width:390,height:844,deviceScaleFactor:2});p.on('pageerror',e=>console.log('ERR',e.message))
await p.setRequestInterception(true)
const M={id:'prop-1',kind:'proposal',date:'2026-11-01',headline:'教练想做 1 处改动，等你确认后才执行：在 11-02 的计划里加了「重做 1 道到期错题」',details:'你在「我的」里选了「先问我」，这些改动还没执行。',seen_at:null,proposal:{status:'pending',items:[{summary:'在 11-02 的计划里加了「重做 1 道到期错题」'}]}}
let hits=[]
p.on('request',r=>{const u=r.url()
 if(u.includes('/agent/messages?'))return r.respond({status:200,contentType:'application/json',body:JSON.stringify({items:[M],unseen:1,queued:0})})
 if(u.includes('/agent/messages/prop-1/')){hits.push(u.split('/').pop());if(u.endsWith('seen'))return r.respond({status:200,contentType:'application/json',body:'{}'})
   return hits.filter(h=>h!=='seen').length>1?r.respond({status:409,contentType:'application/json',body:'{"message":"已经处理过了"}'}):r.respond({status:201,contentType:'application/json',body:JSON.stringify({proposal:{...M.proposal,status:'dismissed'},actions:[]})})}
 r.continue()})
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/today');await p.reload();await S(2000)
console.log((await p.$eval('.coach',e=>e.innerText)))
await p.screenshot({path:'/workspace/kaoyan-ui/r14-proposal.png'})
await p.evaluate(()=>document.querySelector('.coach .ask .cn').click());await S(800)
console.log('after',(await p.$eval('.coach',e=>e.innerText)),hits, await p.evaluate(()=>document.body.innerText.includes('这次不改')))
await b.close()
