import puppeteer from 'puppeteer-core';import fs from 'fs'
const W=+process.argv[2],tok=fs.readFileSync('/tmp/tok','utf8').trim(),S=ms=>new Promise(r=>setTimeout(r,ms))
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage()
p.on('pageerror',e=>console.log('ERR',e.message))
if(W<500)await p.emulate({viewport:{width:W,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true},userAgent:'Mobile'});else await p.setViewport({width:W,height:800})
await p.goto('http://localhost:4173/');await p.evaluate(t=>localStorage.setItem('token',t),tok)
await p.goto('http://localhost:4173/#/');await S(2500);await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await S(2500)
const sw=await b.targets().find(t=>t.type()==='service_worker').createCDPSession();await sw.send('Network.enable')
const net=async off=>{await sw.send('Network.emulateNetworkConditions',{offline:off,latency:0,downloadThroughput:-1,uploadThroughput:-1});await p.setOfflineMode(off)}
const bar=()=>p.$eval('.offbar',e=>e.getBoundingClientRect().height>0?'visible':'hidden').catch(()=>'none')
await net(true)
for(let i=0;i<3;i++){await p.reload();await S(1500);console.log('offline F5 #'+i,await bar())}
await S(8000);console.log('offline +8s',await bar())
await net(false);for(let i=1;i<=8;i++){await S(1000);const v=await bar();if(v==='none'){console.log('back online, bar gone after',i,'s');break}if(i===8)console.log('still',v)}
console.log('cache',JSON.stringify(await p.evaluate(async()=>{const o={};for(const k of await caches.keys()){const c=await caches.open(k);for(const r of await c.keys()){const n=r.url.split('/').pop();if(/\.(css|js|html|png)$/.test(n)){const x=await c.match(r);o[k+':'+n]=(await x.arrayBuffer()).byteLength+'/'+x.headers.get('content-length')}}}return o})))
await b.close()
