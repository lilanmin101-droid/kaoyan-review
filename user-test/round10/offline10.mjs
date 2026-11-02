// round10 5c：离线题包断网刷 5 题（考生视角，真接口，不拦截题包）
// 用法：node offline10.mjs [宽度...]   默认 1280 390；截图从 START（默认 1）起编号 pNN.png
// 依赖：playwright-core（仓库前端只有 puppeteer-core，这里用装在 /tmp/pw10 的 playwright-core，可用 PW_DIR 改）+ /usr/bin/google-chrome
// 密码只从 /workspace/.kaoyan_testpw 读，不写进任何输出；token 也不落盘
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path'
const require = createRequire((process.env.PW_DIR || '/tmp/pw10') + '/'); const { chromium } = require('playwright-core')
const OUT = path.dirname(new URL(import.meta.url).pathname), FE = 'http://localhost:4173', API = 'http://localhost:3000/api/v1'
const PW = fs.readFileSync('/workspace/.kaoyan_testpw', 'utf8').trim()
const widths = process.argv.slice(2).map(Number).filter(Boolean); if (!widths.length) widths.push(1280, 390)
let shotN = +(process.env.START || 1); const S = ms => new Promise(r => setTimeout(r, ms))
const studyDay = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3 - 4 * 3600e3).toISOString().slice(0, 10) // 北京时间 04:00 换天
const bj = iso => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19)
const all = []
for (const W of widths) {
  const R = { width: W, shots: [], checks: {}, log: [] }; all.push(R)
  const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); R.log.push(s); console.log(`[${W}]`, s) }
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  const ctx = await b.newContext({ ...(W < 500 ? { viewport: { width: W, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } : { viewport: { width: W, height: 800 } }), locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'allow' })
  const p = await ctx.newPage()
  p.on('pageerror', e => log('PAGEERROR', e.message)); p.on('console', m => { if (/offline|补传/.test(m.text())) log('console:', m.text()) })
  const posts = []; ctx.on('requestfinished', async rq => { if (rq.method() === 'POST' && rq.url().endsWith('/api/v1/answers')) { try { const body = JSON.parse(rq.postData()); if (body.source === 'offline_pack') { const rs = await rq.response(); posts.push({ body, status: rs.status(), res: await rs.json(), at: Date.now() }) } } catch {} } })
  const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await S(120); if (W < 500) await loc.tap(); else await loc.click() }
  const layout = () => p.evaluate(() => { const cw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth, bad = [], clip = []
    const inScroll = el => { for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
    for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === 'hidden') continue
      if ((r.right > cw + 1 || r.left < -1) && !inScroll(el)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)},${Math.round(r.right)}]`)
      const cs = getComputedStyle(el); if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) clip.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}"`) }
    return { cw, sw, hOverflow: sw > cw + 1, outside: bad.slice(0, 6), clipped: clip.slice(0, 6) } })
  const shot = async (what, full = false) => { const f = `p${String(shotN++).padStart(2, '0')}.png`; await p.screenshot({ path: path.join(OUT, f), fullPage: full }); const l = await layout(); R.shots.push({ f, what, ...l }); log('shot', f, what, l.hOverflow ? 'H-OVERFLOW' : '', l.outside.length ? 'outside:' + l.outside.join(' | ') : '', l.clipped.length ? 'clipped:' + l.clipped.join(' | ') : ''); return f }
  const txt = async sel => (await p.locator(sel).count()) ? await p.locator(sel).first().textContent() : null
  const body = () => p.evaluate(() => document.body.innerText)
  const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), k)

  // 1 注册（界面上注册，不带时区——跟真实考生一样）
  await p.goto(FE + '/'); await S(1500); await shot('登录页')
  await tap(p.locator('.login .switch')); const U = `r10off_${W}_${Date.now().toString(36)}`; R.user = U
  await p.locator('.login input').nth(0).fill(U); await p.locator('.login input[type=password]').fill(PW)
  await tap(p.locator('.login .next')); await p.waitForSelector('.desk', { timeout: 10000 }); await S(800)
  R.toastAfterRegister = await txt('.toast'); await shot('注册成功后的今日页')
  const tok = await p.evaluate(() => localStorage.getItem('token')); const H = { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }
  const get = async u => (await fetch(API + u, { headers: H })).json()
  R.me = await get('/auth/me').then(r => ({ tz: r.timezone ?? r.user?.timezone ?? r.settings?.timezone, id: r.id ?? r.user?.id }))
  // 预置：一道翻译题联网时自评「没思路」进错题本，让题包里带一道主观题（错题重做）——新号题包只有完形/阅读
  const seed = await (await fetch(API + '/answers', { method: 'POST', headers: H, body: JSON.stringify({ question_id: 'english1-2025-47', self_rating: 'no_idea', client_id: 'seed-' + U }) })).json()
  log('seed subjective', seed.status, seed.wrong_question_status)

  // 2 打开刷题页等题包缓存（先不刷新，看注册后直接进刷题页会不会自己拉包）
  await tap(p.locator('.tabs a, .btabs a').filter({ hasText: '刷题' }).first()).catch(async () => { await p.goto(FE + '/#/quiz') })
  await S(6000); let pk = await ls('offline:pack'); R.checks.packWithoutReload = !!pk; log('注册后直接进刷题页 6s，题包已存：', !!pk)
  if (!pk) { await p.reload(); for (let i = 0; i < 20 && !(pk = await ls('offline:pack')); i++) await S(500); log('刷新后题包：', pk?.version, pk?.questions?.length) }
  const swOk = await p.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 20 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 250)); return !!navigator.serviceWorker.controller })
  if (!swOk) { await p.reload(); await S(2000) }
  R.pack = { version: pk.version, study_date: pk.study_date, n: pk.questions.length, origins: [...new Set(pk.questions.map(q => q.origin))], sw: swOk }
  log('pack', R.pack); await S(1500); await shot('联网刷题页（题包已缓存）')

  // 3 断网：setOffline + 拦截 /api
  await ctx.route('**/api/**', r => r.abort('internetdisconnected')); await ctx.setOffline(true); await S(2500)
  R.offbar = await txt('.offbar'); R.offView = await txt('.offq .cap')
  const t1 = await body(); R.checks.serverWordOffline = /服务器/.test(t1); log('offbar:', R.offbar, '| offq cap:', R.offView, '| 含「服务器」:', R.checks.serverWordOffline)
  await shot('断网后刷题页（离线题包）')

  // 4 刷题：4 道选择（第 2 道故意错）→ F5 → 1 道主观题自评
  const qs = pk.questions, ansOf = i => qs[i].answer ?? qs[i].correct_answer ?? []
  const plan = [{ i: 0, right: true }, { i: 1, right: false }, { i: 2, right: true }, { i: 3, right: true }]
  R.answers = []
  for (const [k, a] of plan.entries()) {
    const meta = await p.locator('.offq .meta').textContent(); const correct = ansOf(a.i)[0]
    const keys = await p.locator('.offq .opts .op .l').allTextContents(); const choose = a.right ? correct : keys.find(x => x !== correct)
    await S(3000 + k * 1500) // 读题时间
    await tap(p.locator('.offq .opts .op').filter({ has: p.locator('.l', { hasText: new RegExp('^' + choose + '$') }) }).first())
    await tap(p.locator('.offq .acts .next')); await S(400)
    const verdict = (await p.locator('.offq .verdict').innerText()).split('\n').filter(Boolean)
    R.answers.push({ qid: qs[a.i].id, meta, chose: choose, correct, expectRight: a.right, verdict: verdict.slice(0, 3).join(' / ') }); log('答', qs[a.i].id, choose, '正确', correct, '→', verdict.slice(0, 2).join(' / '))
    if (k <= 1) await shot(k === 0 ? '断网第 1 题答对后的判分' : '断网第 2 题故意答错后的判分')
    await tap(p.locator('.offq .acts .link').filter({ hasText: '下一题' })); await S(300)
  }
  const q4 = await ls('offline:queue'); log('F5 前队列', q4.length)
  await p.reload(); await S(3000)
  R.afterF5 = { offbar: await txt('.offbar'), cap: await txt('.offq .cap'), queue: (await ls('offline:queue'))?.length, done: Object.keys(await ls('offline:done') || {}).length, serverWord: /服务器/.test(await body()) }
  log('F5 后', R.afterF5); await shot('断网时 F5 刷新后')
  // 回看第 2 题（答错那道）还在不在
  for (let i = 0; i < 3; i++) await tap(p.locator('.offq .acts .link').filter({ hasText: '上一题' }))
  await S(300); R.afterF5.q2 = ((await txt('.offq .verdict')) ?? '无判分').split('\n')[0]; log('F5 后回看第 2 题：', R.afterF5.q2); await shot('F5 后回看答错的第 2 题')
  // 主观题：一直点「下一题」翻到错题重做
  let clicks = 0
  while (!/错题重做/.test(await p.locator('.offq .meta').textContent()) && clicks < 40) { await tap(p.locator('.offq .acts .link').filter({ hasText: '下一题' })); clicks++ }
  R.clicksToSubjective = clicks; log('翻到主观题点了「下一题」', clicks, '次', await p.locator('.offq .meta').textContent())
  await S(2500); await p.locator('.offq textarea').fill('只看懂了前半句，involving 那段不会断'); await S(1500)
  await tap(p.locator('.offq .acts .next')); await S(500); await shot('主观题看参考答案（自评前）')
  await tap(p.locator('.offq .rates .chip').filter({ hasText: '没思路' })); await S(400)
  R.subjVerdict = (await p.locator('.offq .verdict').innerText()).replace(/\n+/g, ' / ').slice(-120); log('主观题自评后', R.subjVerdict); await shot('主观题自评「没思路」后')
  R.queue = (await ls('offline:queue')).map(x => ({ qid: x.question_id, ans: x.answer.join(''), rating: x.self_rating, t: x.time_spent_seconds, at: x.answered_at, local_correct: x.local_correct, pack_version: x.pack_version }))
  R.cap = await p.locator('.offq .cap').textContent(); log('断网队列', R.queue.length, R.cap)
  await p.locator('.offq .tally').scrollIntoViewIfNeeded().catch(() => {}); await shot('断网做完 5 题（底部统计）')

  // 5 恢复联网，计时看提示条和补传
  const tOn = Date.now(); await ctx.unroute('**/api/**'); await ctx.setOffline(false)
  let barGone = null, qEmpty = null, toasts = new Set()
  for (let i = 0; i < 150; i++) { await S(100)
    if (barGone === null && !(await p.locator('.offbar').count())) barGone = Date.now() - tOn
    if (qEmpty === null && ((await ls('offline:queue')) || []).length === 0) qEmpty = Date.now() - tOn
    const t = await txt('.toast'); if (t) toasts.add(t)
    if (barGone !== null && qEmpty !== null && i > 40) break }
  R.online = { barGoneMs: barGone, queueEmptyMs: qEmpty, toasts: [...toasts], posts: posts.length, view: (await p.locator('.offq').count()) ? '仍是离线题包页' : '回到正常刷题页' }
  log('联网后', R.online); await shot('恢复联网后')

  // 6 后端核对
  const flow = await get('/answers?limit=50'); const items = (flow.items ?? flow).filter(x => x.source === 'offline_pack')
  const today = studyDay(); R.server = items.map(x => ({ qid: x.question_id, ans: (x.answer ?? []).join(''), self: x.self_rating, ok: x.is_correct, t: x.time_spent_seconds, at_bj: bj(x.answered_at), study_date: x.study_date, pv: x.pack_version }))
  R.today = today; log('后端 offline_pack 记录', R.server)
  const latest = await get('/answers?question_ids=' + R.queue.map(x => x.qid).join(',')); R.latestMode = { latest: latest.latest, n: (latest.items ?? []).length }
  R.posts = posts.map(x => ({ qid: x.body.question_id, keys: Object.keys(x.body).sort().join(','), status: x.status, rs: x.res.status, dup: x.res.duplicate, ok: x.res.is_correct, wq: x.res.wrong_question_status, clamped: x.res.answered_at_clamped }))
  log('补传请求', R.posts)
  const wq = await get('/wrong-questions?page_size=100'); const wl = (wq.items ?? wq); R.wrongBook = wl.map(x => ({ qid: x.question_id ?? x.question?.id, status: x.status }))
  log('错题本', R.wrongBook)
  // 7 重放补传：同样 body 再发两次（含答错那道），看 duplicate、记录数、错题本不变
  const statsBefore = await get('/me/stats'); const nBefore = (await get('/answers?limit=200')).items.length
  R.replay = []; for (const x of posts.slice(0, 2)) { const r = await (await fetch(API + '/answers', { method: 'POST', headers: H, body: JSON.stringify(x.body) })).json(); R.replay.push({ qid: x.body.question_id, status: r.status, duplicate: r.duplicate, score: r.score }) }
  const nAfter = (await get('/answers?limit=200')).items.length; const statsAfter = await get('/me/stats')
  R.replayCounts = { nBefore, nAfter, statsSame: JSON.stringify(statsBefore) === JSON.stringify(statsAfter) }
  if (!R.replayCounts.statsSame) R.replayCounts.statsDiff = { before: JSON.stringify(statsBefore).slice(0, 400), after: JSON.stringify(statsAfter).slice(0, 400) }
  log('重放', R.replay, R.replayCounts)
  // 8 界面上看错题本和今日页
  await tap(p.locator('.tabs a, .btabs a').filter({ hasText: '错题' }).first()).catch(() => p.goto(FE + '/#/wrong')); await S(2500); await shot('联网后错题本')
  await tap(p.locator('.tabs a, .btabs a').filter({ hasText: '今日' }).first()).catch(() => p.goto(FE + '/#/')); await S(2500); await shot('联网后今日页', W < 500)
  await b.close()
}
fs.writeFileSync(path.join(OUT, 'offline10_result.json'), JSON.stringify(all, null, 1))
console.log('done, next shot', shotN)
