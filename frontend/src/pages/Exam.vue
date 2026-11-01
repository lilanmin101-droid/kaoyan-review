<script setup lang="ts">
// 考场模式：整卷限时。计时以服务端为准；每次作答都进本机队列，按 client_seq 递增、带 idempotency_key 发给后端，
// 断网时留在本机（localStorage），联网后按顺序补交。暂停时题目遮住、计时停。
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch , onUnmounted } from 'vue'
import { dragHint } from '../lib/draghint'
import { renderStem, renderTex, type StemTable, renderFor } from '../lib/tex'
import { api, ApiError, download, downloading, sse, uid } from '../lib/api'
import { enWords } from '../lib/passage'
import { toast } from '../lib/toast'
import EnPaper, { type EnGroup } from '../components/EnPaper.vue'
import Errata, { type Erratum } from '../components/Errata.vue'
import ExamTrend from '../components/ExamTrend.vue'

type Sub = { number: number; stem: string; score: number | null; answer?: string[]; score_estimated?: boolean }
type Q = { errata?: Erratum[] | null; id: string; number: number; type: string; section?: string; stem: string; score: number; options: { key: string; content: string }[]
  answer?: string[]; images?: string[]; asset_base?: string; tables?: StemTable[] | null; sub_scores_source?: string; sub_questions?: Sub[]; score_by_whole?: boolean; solution?: string | null; knowledge_points?: string[] }
type Ans = { answer?: string[]; time_spent_seconds?: number; flagged?: boolean }
type Exam = { id: string; title: string; exam: string; year: number; question_ids: string[]; status: string; remaining_seconds: number
  duration_seconds: number; progress: { answers: Record<string, Ans>; current_question_id?: string; last_client_seq?: number }; result: any }
type Rating = 'full' | 'approach_ok_calc_wrong' | 'no_idea'

const props = defineProps<{ years: number[]; enYears?: number[] }>()
const emit = defineEmits<{ nav: [string] }>()
const stage = ref<'lobby' | 'run' | 'rate' | 'result'>('lobby')
const wanted = localStorage.getItem('exam:wanted'); localStorage.removeItem('exam:wanted') // 开考撞上另一场没交卷（409）时，说清楚是哪两场
const active = ref<Exam | null>(null), ex = ref<Exam | null>(null), loading = ref(true), liveErr = ref(false)
// 科目：数学一 / 英语一，各记各的年份
const subjX = ref<'math1' | 'english1'>(localStorage.getItem('exam:subj') === 'english1' ? 'english1' : 'math1')
const yearsX = computed(() => subjX.value === 'english1' ? props.enYears ?? [] : props.years)
// 选的年份按科目记在本机，重新进入考场页、年份列表晚到都不会被换掉
const YK = () => `exam:year:${subjX.value}`
const pickYear = ref(Number(localStorage.getItem(YK())) || 0), minutes = ref(180)
watch(pickYear, y => { if (y) localStorage.setItem(YK(), String(y)) })
function setSubjX(s: 'math1' | 'english1') { if (s === subjX.value) return; subjX.value = s; localStorage.setItem('exam:subj', s); const y = Number(localStorage.getItem(YK())); pickYear.value = yearsX.value.includes(y) ? y : yearsX.value[0] }
watch(yearsX, ys => { if (ys.length && !ys.includes(pickYear.value)) pickYear.value = ys[0] }, { immediate: true })
const isEn = computed(() => ex.value?.exam === 'english1')
const enGroups = ref<EnGroup[]>([])
const gIdx = computed(() => Math.max(0, enGroups.value.findIndex(g => g.questions.some(x => x.id === q.value?.id))))
const curG = computed(() => enGroups.value[gIdx.value])
const SEC: Record<string, string> = { use_of_english: '完形', reading_b: '新题型', translation: '翻译', writing_a: '小作文', writing_b: '大作文' }
const gLabel = (g?: EnGroup) => !g ? '' : g.section === 'reading_a' ? (g.passage?.title ?? '阅读') : SEC[g.section] ?? g.section_name
const gRange = (g?: EnGroup) => { const a = g?.questions[0]?.number, z = g?.questions.at(-1)?.number; return a === z ? `第 ${a} 题` : `第 ${a}–${z} 题` }
const focusId = ref<string | null>(null)
function goG(d: number) { const g = enGroups.value[gIdx.value + d]; if (g) { go(qs.value.findIndex(x => x.id === g.questions[0].id)); focusId.value = null } }
const qs = ref<Q[]>([]), idx = ref(0), answers = ref<Record<string, Ans>>({})
// 整卷模考按墙上的时钟走：记下截止时刻，每秒用「截止 - 现在」算剩余；锁屏、切走回来也是准的
let deadline = 0
const setRem = (sec: number) => { remaining.value = sec; deadline = Date.now() + sec * 1000 }
const remaining = ref(0), paused = ref(false), online = ref(navigator.onLine), unsent = ref(0)
const kind = (x: Q) => x.type.includes('choice') || x.type === 'match' ? 'choice' : x.type === 'fill_blank' ? 'blank' : 'essay'
const q = computed(() => qs.value[idx.value])
const clock = (s: number) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` }

async function lobby(go = false) {
  loading.value = true
  // 服务重启或断网时退避重试 3 次；接不上也只给「再试一次」，绝不退回开考表单
  liveErr.value = false
  for (let k = 0; k <= 3; k++) {
    try { active.value = (await api<{ exam: Exam | null }>('/exams/active')).exam; break }
    catch (e: any) {
      if (e?.status && e.status < 500) { toast(e.message); break }
      if (k === 3) { liveErr.value = true; break }
      await new Promise(r => setTimeout(r, 800 * 2 ** k))
    }
  }
  if (go && active.value) { try { await resume(active.value); return } catch { /* 接不上就停在接着做那页 */ } finally { loading.value = false } }
  loading.value = false
}
// 成绩页有自己的地址 #/exam/<id>/result，刷新也停在这场的成绩
onMounted(async () => {
  const m = location.hash.match(/^#\/exam\/([\w-]+)\/(result|rate)/)
  if (m) {
    // 服务刚重启时会短暂 502：重试几次再放弃，别直接退回考场入口
    for (let k = 0; k < 4; k++) {
      try { const e = await api<Exam>(`/exams/${m[1]}`); if (e.status === 'submitted') { await open(e); loading.value = false; if (m[2] === 'rate') await rateLater(e.result?.pending_self_rating?.[0]); return } toast('这场还没交卷'); break }
      catch (e: any) {
        if (e?.status && e.status < 500) { toast('这场成绩没找到'); break }
        if (k === 3) { toast('成绩暂时没加载出来，过会儿刷新一下'); loading.value = false; return }
        await new Promise(r => setTimeout(r, 800 * (k + 1)))
      }
    }
  }
  // 从「开考」或考试条「继续」进来（#/exam/go）：直接进考场，不经过「还没交卷」那页
  const go = location.hash === '#/exam/go'
  history.replaceState(null, '', '#/exam')
  await lobby(go)
})
watch([stage, () => ex.value?.id], ([s, id]) => {
  const want = s === 'result' && id ? `#/exam/${id}/result` : '#/exam'
  if (location.hash !== want) history.replaceState(null, '', want)
})

async function start() {
  try { open(await api<Exam>('/exams', { method: 'POST', body: JSON.stringify({ exam: subjX.value, year: pickYear.value, duration_minutes: minutes.value }) })) }
  catch (e: any) {
    if (e instanceof ApiError && e.status === 409) { toast('还有一场没交卷的模考，先接着做完'); await lobby() }
    else if (e instanceof ApiError && e.status === 422) toast(`${pickYear.value} 年这套还没核对完，先换一年`)
    else toast('没开成：' + e.message)
  }
}
async function resume(e: Exam) { open(await api<Exam>(`/exams/${e.id}`)) }

// —— 本机队列 ——
const QKEY = (id: string) => `exam:${id}:queue`, SKEY = (id: string) => `exam:${id}:seq`
type Req = { idempotency_key: string; client_seq: number; answers?: { question_id: string } & Ans[] | any[]; current_question_id?: string; state?: 'running' | 'paused' }
let queue: Req[] = [], seq = 0, flushing = false, tick = 0, beat = 0, qStart = Date.now()
// 「存在本机」按题数算，不按保存次数（同一道题改几次只算一道）；心跳不算
const pendingQs = () => new Set(queue.flatMap(r => (r.answers ?? []).map((a: any) => a.question_id))).size
const saveQ = () => { if (ex.value) localStorage.setItem(QKEY(ex.value.id), JSON.stringify(queue)); unsent.value = pendingQs() }
let fails = 0, retry = 0

async function open(e: Exam) {
  ex.value = e
  const r = await api<{ items: Q[]; groups?: EnGroup[] }>(`/questions?exam=${e.exam}&year=${e.year}&page_size=100${e.status === 'submitted' ? '&include_answer=true' : ''}`)
  enGroups.value = e.exam === 'english1' ? (r.groups ?? []).filter(g => g.questions.some(x => e.question_ids.includes(x.id))).sort((a, b) => a.questions[0].number - b.questions[0].number) : []
  const order = new Map(e.question_ids.map((id, i) => [id, i]))
  qs.value = r.items.filter(x => order.has(x.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  answers.value = JSON.parse(JSON.stringify(e.progress?.answers ?? {}))
  queue = JSON.parse(localStorage.getItem(QKEY(e.id)) ?? '[]')
  seq = Math.max(Number(localStorage.getItem(SKEY(e.id)) ?? 0), e.progress?.last_client_seq ?? 0, ...queue.map(x => x.client_seq))
  // 本机还没交上去的答案盖在服务端进度上面
  for (const rq of queue) for (const a of rq.answers ?? []) answers.value[a.question_id] = { ...answers.value[a.question_id], ...a }
  idx.value = Math.max(0, qs.value.findIndex(x => x.id === e.progress?.current_question_id))
  setRem(e.remaining_seconds); paused.value = e.status === 'paused'; pzAcc.value = (e as any).paused_seconds ?? 0; pzWarned = pzAcc.value >= PZ_WARN * 60; if (paused.value) { pzStart(); const since = (e as any).paused_at; if (since) pzAt.value = Math.min(Date.now(), Date.parse(since)) }; unsent.value = pendingQs()
  if (e.status === 'submitted') { stage.value = 'result'; return }
  stage.value = 'run'; qStart = Date.now()
  if (paused.value) push({ state: 'running' }), paused.value = false
  clearInterval(tick); clearInterval(beat)
  tick = window.setInterval(() => { if (paused.value || remaining.value <= 0) return; remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); if (remaining.value === 0) toRate(true) }, 1000)
  beat = window.setInterval(() => { if (!paused.value) push({}) }, 60_000)
  flush()
}
function push(body: Partial<Req>) {
  if (!ex.value) return
  queue.push({ idempotency_key: uid(), client_seq: ++seq, ...body }); localStorage.setItem(SKEY(ex.value.id), String(seq)); saveQ(); flush()
}
async function flush() {
  if (flushing || !ex.value || !queue.length) return
  flushing = true
  try {
    while (queue.length) {
      const r = await api<Exam & { stale?: boolean }>(`/exams/${ex.value.id}/progress`, { method: 'PUT', body: JSON.stringify(queue[0]) })
      queue.shift(); saveQ(); online.value = true; fails = 0
      if (r.remaining_seconds != null && !paused.value) setRem(r.remaining_seconds)
    }
  } catch (e: any) {
    // 网络断了：留在队列里，联网或下次心跳再发；409 说明考试已结束
    if (e instanceof ApiError && e.status === 409) { queue = []; saveQ(); toast(e.code === 'exam_auto_submitted' ? '时间到了，已经自动交卷' : '这场已经交卷了'); clearInterval(tick); clearInterval(beat); stage.value = 'result'; ex.value = await api<Exam>(`/exams/${ex.value!.id}`) }
    // 偶发一次请求失败不算离线：浏览器报离线或连续两次失败才提示，3 秒后自己重试
    else { fails++; if (!navigator.onLine || fails >= 2) online.value = false; clearTimeout(retry); retry = window.setTimeout(flush, 3000) }
  } finally { flushing = false }
}
const onOnline = () => { online.value = true; flush() }, onOffline = () => { online.value = false }
addEventListener('online', onOnline); addEventListener('offline', onOffline); addEventListener('kaoyan:online', onOnline)
// 从锁屏/别的 App 回来：立刻按墙上时钟重算，再跟服务端对一次
const onVis = () => { if (document.visibilityState !== 'visible' || stage.value !== 'run' || paused.value) return; remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); if (remaining.value === 0) toRate(true); else push({}) }
document.addEventListener('visibilitychange', onVis)
onBeforeUnmount(() => { clearInterval(tick); clearInterval(beat); removeEventListener('online', onOnline); removeEventListener('offline', onOffline); removeEventListener('kaoyan:online', onOnline); document.removeEventListener('visibilitychange', onVis) })

function spentOn(x: Q) { return (answers.value[x.id]?.time_spent_seconds ?? 0) + Math.round((Date.now() - qStart) / 1000) }
function setAns(x: Q, patch: Ans) {
  const a = { ...answers.value[x.id], ...patch, time_spent_seconds: spentOn(x) }; answers.value[x.id] = a; qStart = Date.now()
  push({ answers: [{ question_id: x.id, ...a }], current_question_id: x.id })
}
let typing = 0
function typed(x: Q, v: string) { answers.value[x.id] = { ...answers.value[x.id], answer: v ? [v] : [] }; clearTimeout(typing); typing = window.setTimeout(() => setAns(x, { answer: v ? [v] : [] }), 800) }
// 手机：题号抽屉（点顶上「第 n 题」拉出来，选完自动收）
const drawer = ref(false)
function go(i: number) {
  drawer.value = false
  const x = q.value; if (x && Date.now() - qStart > 3000) answers.value[x.id] = { ...answers.value[x.id], time_spent_seconds: spentOn(x) }
  const sameG = isEn.value && curG.value?.questions.some(x => x.id === qs.value[i]?.id)
  idx.value = i; qStart = Date.now(); if (!sameG) scrollTo({ top: 0 }); if (isEn.value) focusId.value = qs.value[i].id; push({ current_question_id: qs.value[i].id })
}
// 暂停门槛：累计超过 15 分钟这场不计入模考趋势，10 分钟时提醒一次
const PZ_LIMIT = 15, PZ_WARN = 10
const pzAcc = ref(0), pzAt = ref(0), pzNow = ref(Date.now()); let pzT = 0, pzWarned = false
const pzMin = computed(() => Math.floor((pzAcc.value + (paused.value && pzAt.value ? (pzNow.value - pzAt.value) / 1000 : 0)) / 60))
const pzHint = computed(() => pzMin.value < 1 ? `暂停超过 ${PZ_LIMIT} 分钟，这场就不算进模考趋势` : pzMin.value >= PZ_LIMIT ? `已暂停 ${pzMin.value} 分钟，这场不算进模考趋势了，分数和错题照常保留` : `已暂停 ${pzMin.value} 分钟，超过 ${PZ_LIMIT} 分钟这场就不算进趋势了`)
function pzStart() { pzAt.value = Date.now(); pzNow.value = pzAt.value; clearInterval(pzT); pzT = window.setInterval(() => { pzNow.value = Date.now(); if (!pzWarned && pzMin.value >= PZ_WARN && pzMin.value < PZ_LIMIT) { pzWarned = true; toast(`已经暂停 ${pzMin.value} 分钟了，超过 ${PZ_LIMIT} 分钟这场就不算进模考趋势`) } }, 5000) }
function pzStop() { if (pzAt.value) pzAcc.value += (Date.now() - pzAt.value) / 1000; pzAt.value = 0; clearInterval(pzT) }
onUnmounted(() => clearInterval(pzT))
function pause() { paused.value = true; pzStart(); push({ state: 'paused' }) }
function cont() { pzStop(); paused.value = false; setRem(remaining.value); qStart = Date.now(); push({ state: 'running' }) }
const answered = (x: Q) => !!answers.value[x.id]?.answer?.some(v => v?.trim())
const flagged = (x: Q) => !!answers.value[x.id]?.flagged
const doneN = computed(() => qs.value.filter(answered).length)

// —— 交卷：先让解答题自评（证明题整题，计算题按小问），再提交 ——
const perSub = (x: Q) => !x.score_by_whole && (x.sub_questions?.length ?? 0) > 1 && x.sub_questions!.every(s => s.score)
const usedSub = computed(() => qs.value.some(x => perSub(x) && x.sub_scores_source !== 'official'))
const whole = ref<Record<string, Rating>>({}), subs = ref<Record<string, Record<number, Rating>>>({})
const ratingMath: Record<Rating, string> = { full: '全对', approach_ok_calc_wrong: '思路对，算错了', no_idea: '没思路' }
// 英语翻译、作文：对照参考答案估个档（全给 / 给一半 / 不给）
const ratingEn: Record<Rating, string> = { full: '基本到位', approach_ok_calc_wrong: '大概一半', no_idea: '没写或偏得多' }
const ratingText = computed(() => isEn.value ? ratingEn : ratingMath)
const essays = computed(() => qs.value.filter(x => kind(x) === 'essay'))
async function toRate(timeUp = false) {
  if (timeUp) toast('时间到，自动收卷')
  clearInterval(tick); clearInterval(beat); await flush()
  const r = await api<{ items: Q[] }>(`/questions?exam=${ex.value!.exam}&year=${ex.value!.year}&include_answer=true&page_size=100`).catch(() => null)
  if (r) { const m = new Map(r.items.map(x => [x.id, x])); qs.value = qs.value.map(x => m.get(x.id) ?? x) }
  stage.value = 'rate'; scrollTo({ top: 0 })
}
const submitting = ref(false)
// 交卷前确认：说清楚还有几道没答、几处没评
const ask = ref<null | 'leave' | 'submit' | 'end'>(null)
const unrated = computed(() => essays.value.reduce((n, x) => n + (perSub(x) ? x.sub_questions!.filter(sq => !subs.value[x.id]?.[sq.number]).length : whole.value[x.id] ? 0 : 1), 0))
function trySubmit() { if (ex.value?.status === 'submitted') return submit(); ask.value = 'submit' }
// 没交卷的旧考试：按现在的作答交掉，再开新的（后端有放弃接口后改成真放弃）
async function endActive() {
  ask.value = null; const a = active.value; if (!a) return
  try {
    // 放弃：不计分、不进错题本；已交卷的会 409
    try { const r = await api<{ discarded?: boolean }>(`/exams/${a.id}/abandon`, { method: 'POST' }); toast(r?.discarded ? '那场还没开始答，直接删掉了' : '那场已放弃，不计分') }
    catch (e: any) { if (e instanceof ApiError && e.status === 409) toast('那场已经交过卷了'); else throw e }
    localStorage.removeItem(QKEY(a.id)); await lobby(); loadHist()
  }
  catch (e: any) { toast('没结束成：' + e.message) }
}
async function submit() {
  if (submitting.value) return
  if (queue.length) { await flush(); if (queue.length) return toast('还有作答没传上去，联网后再交') }
  const self_ratings: Record<string, any> = {}
  for (const x of essays.value) {
    if (perSub(x) && subs.value[x.id] && Object.keys(subs.value[x.id]).length) self_ratings[x.id] = Object.fromEntries(Object.entries(subs.value[x.id]).map(([k, v]) => [String(k), v]))
    else if (whole.value[x.id]) self_ratings[x.id] = whole.value[x.id]
    else if (noAns(x)) self_ratings[x.id] = 'no_idea' // 没作答直接记 0 分
  }
  submitting.value = true
  // 已交卷的（交卷后补评/改评）走 self-ratings，可以重复评
  if (ex.value!.status === 'submitted') {
    try { ex.value = await api<Exam>(`/exams/${ex.value!.id}/self-ratings`, { method: 'POST', body: JSON.stringify({ self_ratings, idempotency_key: uid() }) }); stage.value = 'result'; scrollTo({ top: 0 }); toast('评好了') }
    catch (e: any) { toast('没评上：' + e.message) } finally { submitting.value = false }
    return
  }
  try { ex.value = await api<Exam>(`/exams/${ex.value!.id}/submit`, { method: 'POST', body: JSON.stringify({ self_ratings }) }); localStorage.removeItem(QKEY(ex.value.id)); stage.value = 'result'; scrollTo({ top: 0 }) }
  catch (e: any) { toast('没交上：' + e.message) } finally { submitting.value = false }
}
const res = computed(() => ex.value?.result)
// 结论里「得分率最低」「丢分最多」上面的表已经有了，不重复
const concl = computed(() => ((res.value?.conclusions ?? []) as string[]).filter(c => !/得分率最低|丢分最多的知识点/.test(c)))
async function rateLater(id?: string) { await toRate(); if (id) { await nextTick(); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60))); document.getElementById('rq-' + id)?.scrollIntoView({ block: 'start' }); hotRq.value = id; setTimeout(() => { if (hotRq.value === id) hotRq.value = '' }, 2500) } }
// 英语自评（统筹者定的线）：没作答直接记 0 分、不出选项；
// 小作文 <50 词、大作文 <80 词、翻译 < 参考译文词数的 30% 时，选「基本到位」先确认，坚持就照记，成绩页标「自评·字数不足」
// 成绩页「自评·字数不足」以后端 self_grade_flags 为准（换设备也一样）；只有后端没给这个字段时才看本机记录
const isShort = (p: any) => Array.isArray(p.self_grade_flags) ? p.self_grade_flags.includes('word_count_low') : shortSet.value.includes(p.question_id)
const noAns = (x: Q) => isEn.value && !answered(x)
const refOf = (x: Q) => (x as any).reference_answer ?? x.answer?.[0] ?? ''
// 英译汉的译文是中文：按汉字数 + 英文词数算「字数」
const cnt = (t: string) => (t.match(/[\u4e00-\u9fff]/g)?.length ?? 0) + enWords(t.replace(/[\u4e00-\u9fff]/g, ' '))
const mineW = (x: Q) => cnt(answers.value[x.id]?.answer?.[0] ?? '')
const minW = (x: Q) => x.section === 'writing_a' ? 50 : x.section === 'writing_b' ? 80 : x.section === 'translation' ? Math.ceil(cnt(refOf(x)) * 0.3) : 0
const SHKEY = () => `exam:short:${ex.value?.id}`
const shortSet = ref<string[]>([])
watch(() => ex.value?.id, () => { try { shortSet.value = JSON.parse(localStorage.getItem(SHKEY()) ?? '[]') } catch { shortSet.value = [] } }, { immediate: true })
function markShort(id: string, on: boolean) { const s = new Set(shortSet.value); on ? s.add(id) : s.delete(id); shortSet.value = [...s]; localStorage.setItem(SHKEY(), JSON.stringify(shortSet.value)) }
const pend = ref<{ id: string; n: number } | null>(null)
function pickWhole(x: Q, r: Rating) {
  if (noAns(x)) return
  if (isEn.value && r === 'full' && mineW(x) < minW(x)) { pend.value = { id: x.id, n: mineW(x) }; return }
  pend.value = null; whole.value[x.id] = r; markShort(x.id, false)
}
function keepFull(x: Q) { whole.value[x.id] = 'full'; markShort(x.id, true); pend.value = null }
const hotRq = ref('')
const tipQ = ref<string | null>(null)
const tipP = computed(() => tipQ.value ? pq.value.find(p => p.question_id === tipQ.value) : null)
// 成绩页点题号：就地展开这题的作答对照和讲解
type Exp = { steps: { n: number; text: string }[]; label: string | null; pending: string | null; loading: boolean }
const exps = ref<Record<string, Exp>>({})
function showQ(id: string) {
  tipQ.value = tipQ.value === id ? null : id
  if (!tipQ.value || exps.value[id]) return
  exps.value[id] = { steps: [], label: null, pending: null, loading: true }; const e = exps.value[id]
  sse(`/questions/${id}/explain`, {}, ev => {
    if (ev.type === 'step') e.steps.push({ n: ev.n, text: ev.text })
    if (ev.type === 'done') { e.label = ev.source_label ?? null; if (ev.source === 'pending') e.pending = ev.text || '讲解生成中' }
  }).catch((er: any) => { e.pending = '讲解没拿到：' + er.message }).finally(() => { e.loading = false })
}
const refQ = (p: any) => isEn.value && !p.objective
const nextTickTop = () => setTimeout(() => document.querySelector('.qpeek')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50)
const tex = (s: string) => isEn.value ? s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)) : renderTex(s)
async function report() { try { await download(`/exams/${ex.value!.id}/report.pdf`, `成绩单-${ex.value!.title}.pdf`); toast('成绩单已下载') } catch (e: any) { toast(e.message) } }
// 历史
type Hist = { id: string; non_continuous?: boolean; title: string; answered_count?: number; score: number | null; max_score: number; status: string; pending_self_rating_count?: number; coach_headline?: string | null; submitted_at?: string; created_at?: string }
const hist = ref<Hist[]>([])
// 加载文案：打开成绩页说「正在打开成绩」，只有从「继续」接回进行中的考试才说「接回考场」
const loadMsg = /^#\/exam\/[\w-]+\/(result|rate)/.test(location.hash) ? '正在打开成绩…' : /^#\/exam\/go/.test(location.hash) ? '正在接回考场…' : '正在加载…'
// 中途暂停：后端字段 pause_count / paused_seconds（在考试或成绩上都认）
const pauseLine = computed(() => { const o: any = { ...(ex.value ?? {}), ...(res.value ?? {}) }; const n = o.pause_count ?? 0, sec = o.paused_seconds ?? 0
  return n > 0 ? `中途暂停 ${n} 次，共 ${Math.max(1, Math.round(sec / 60))} 分钟` : '' })
const nonCont = computed(() => !!((res.value as any)?.non_continuous ?? (ex.value as any)?.non_continuous))
const trendItems = ref<any[]>([])
// 英一总分拆开写，保证加得上：客观 + 主观自评（含字数不够、不进估分的部分）= 总分
const splitLine = computed(() => {
  const e: any = ex.value, r: any = res.value; if (!e || !r) return ''
  const l: any = trendItems.value.find(x => x.id === e.id) ?? {}
  const g = (k: string) => r[k] ?? e[k] ?? l[k]
  const o = g('objective_score'), sub = g('subjective_self_score'); if (o == null || sub == null) return ''
  // 名字以统筹者定的 subjective_excluded_points 为准，后端旧名也认
  const xp = g('subjective_excluded_points') ?? g('subjective_excluded_score') ?? 0, raw = g('subjective_self_raw') ?? sub + xp, n = (v: number) => Math.round(v * 10) / 10
  return `客观 ${n(o)} + ${isEn.value ? "主观自评" : "解答题自评"} ${n(raw)}${xp ? `（其中 ${n(xp)} 分字数不够，不进估分）` : ''} = ${n(o + raw)}`
})
async function loadHist() { api<{ items: any[] }>('/exams?limit=50').then(r => trendItems.value = r.items ?? []).catch(() => {}); try { hist.value = ((await api<{ items: Hist[] }>('/exams?limit=10')).items ?? []).filter(h => h.status === 'submitted' || h.status === 'abandoned') } catch { /* 没有就不显示 */ } }
onMounted(loadHist)
async function openHist(h: Hist) { if (h.status !== 'submitted') return; open(await api<Exam>(`/exams/${h.id}`)) }
// —— 成绩拆分（前端按题算；后端给了 by_type / by_subject 就用后端的）——
const qById = computed(() => new Map(qs.value.map(x => [x.id, x])))
// 成绩只用后端算好的：sections / subjects / lost_by_kp / coach（未评的只进 pending_points，不算丢分）
const pct = (got: number, max: number) => max ? Math.round(got / max * 100) : 0
const SECN: Record<string, string> = { use_of_english: '完形填空', reading_a: '阅读 A', reading_b: '新题型', translation: '翻译', writing_a: '小作文', writing_b: '大作文' }
const byType = computed(() => ((res.value?.sections ?? []) as any[]).map(x => ({ k: SECN[x.section] ?? x.section.replace('题', ''), got: x.score, max: x.max_score, rate: pct(x.score, x.max_score - (x.pending_points ?? 0)), pend: x.pending_points ?? 0 })))
const bySubj = computed(() => ((res.value?.subjects ?? []) as any[]).map(x => ({ k: x.name, got: x.score, max: x.max_score, rate: x.graded_rate != null ? Math.round(x.graded_rate * 100) : x.rate == null ? 0 : Math.round(x.rate * 100), pend: x.pending_points ?? 0 })))
const lossKp = computed(() => ((res.value?.lost_by_kp ?? []) as any[]).slice(0, 5).map(x => ({ k: x.name, lost: x.lost, nums: x.question_numbers })))
// 教练一句只认这场的 result.coach（全部评完才有）
const coachLine = computed(() => res.value?.coach?.headline ?? null)
const pq = computed(() => (res.value?.per_question ?? []) as any[])
// 解答题在纸上做、自评过的也算作答了
const did = (p: any) => p.answered || !!p.self_rating || (p.sub_scores ?? []).some((x: any) => x.self_rating)
const wrongs = computed(() => pq.value.filter(p => did(p) && p.got != null && p.got < p.score))
const blanksQ = computed(() => pq.value.filter(p => !did(p) && p.is_correct !== null)) // 待自评的另外提示，不算没作答
// 逐题对照：你的答案 / 正确答案 / 得分
const showAll = ref(false)
// 有没自评的题时，逐题对照默认展开，「待自评」旁边直接给「去自评」
watch(() => res.value?.pending_self_rating?.length, n => { if (n) showAll.value = true }, { immediate: true })
const ansOf = (p: any) => ((p.answer?.length ? p.answer : ex.value?.progress?.answers?.[p.question_id]?.answer) ?? []).filter((v: string) => v?.trim?.()).join('、')
// 标准答案：per_question[].correct_answer（刷新、从历史打开都有）；解答题看自评页
const keyOf = (p: any) => { const x = qById.value.get(p.question_id); if (!p.objective && x && kind(x) === 'essay') return isEn.value ? (p.reference_answer ?? x.answer?.[0] ?? '') : ''; const k = p.correct_answer; return k?.length ? k.join('、') : '' }
async function pdf() {
  try { await download(`/wrong-questions/export.pdf?exam=${ex.value!.exam}`, `错题本-${ex.value!.title}.pdf`); toast('错题 PDF 已下载') } catch (e: any) { toast(e.message) }
}
function again() { stage.value = 'lobby'; ex.value = null; whole.value = {}; subs.value = {}; lobby() }
let dhT = 0
onUpdated(() => { const eb = document.querySelector<HTMLElement>('.ebar'); if (eb) document.documentElement.style.setProperty('--ebarh', eb.offsetHeight + 'px'); clearTimeout(dhT); dhT = window.setTimeout(() => dragHint(), 300) })
</script>

<template>
  <div class="page col exam">
    <!-- 入口：有没交卷的先接着做 -->
    <main v-if="stage === 'lobby'" class="main">
      <div class="cap">考 场 模 式</div>
      <p v-if="loading" class="sub">{{ loadMsg }}</p>
      <template v-else-if="liveErr"><p class="big">暂时没接上考场</p><p class="sub">网络刚才没响应，已经答过的都在，不会丢。</p><div class="acts flat"><span class="next" @click="lobby(true)">再试一次</span></div></template>
      <template v-else-if="active">
        <p class="big">{{ active.title }}还没交卷</p>
        <p v-if="wanted" class="sub">你刚才点的是 {{ wanted }}。同一时间只能有一场模考，先把 {{ active.title }} 接着做完，或者放弃它，再开新的。</p>
        <p class="sub">做了 {{ Object.values(active.progress?.answers ?? {}).filter(a => a.answer?.length).length }} / {{ active.question_ids.length }} 道，剩 {{ clock(active.remaining_seconds) }}{{ active.status === 'paused' ? '，现在是暂停状态' : '' }}。</p>
        <div class="acts flat"><span class="link danger" @click="ask = 'end'">放弃这场</span><span class="next" @click="resume(active)">接着做</span></div>
      </template>
      <template v-else>
        <p class="big">整卷限时，跟真考一样</p>
        <p class="sub">{{ subjX === 'english1' ? '中途可以暂停；断网也能接着答，联网后自动补交。选择题自动判分，翻译和作文交卷后对照参考答案自评，做错的进错题本。' : '中途可以暂停；断网也能接着答，联网后自动补交。交卷后解答题自己对答案打分，做错的进错题本。' }}</p>
        <div class="grp"><span class="k">科目</span>
          <span class="chip" :class="{ on: subjX === 'math1' }" @click="setSubjX('math1')">数学一</span><span class="chip" :class="{ on: subjX === 'english1' }" @click="setSubjX('english1')">英语一</span></div>
        <div class="grp"><span class="k">试卷</span>
          <span v-for="y in yearsX" :key="y" class="chip" :class="{ on: y === pickYear }" @click="pickYear = y">{{ y }}</span></div>
        <div class="grp"><span class="k">时长</span>
          <span v-for="m in [180, 120, 60]" :key="m" class="chip" :class="{ on: m === minutes }" @click="minutes = m">{{ m === 180 ? '3 小时' : m + ' 分钟' }}</span></div>
        <div class="acts flat"><span class="link" @click="emit('nav', 'quiz')">回刷题</span><span class="next" @click="start">开考 · {{ pickYear }} {{ subjX === 'english1' ? '英语一' : '数学一' }}</span></div>
      </template>
      <div v-if="!loading && hist.length" class="hist"><ExamTrend :items="trendItems" @open="id => openHist({ id, status: 'submitted' } as Hist)" /><div class="cap sm">考 过 的</div>
        <div v-for="h in hist" :key="h.id" class="hrow" @click="openHist(h)">
          <span class="t">{{ h.title }}<i v-if="h.non_continuous" class="nc">不计入趋势</i></span><span class="s">{{ h.status === 'abandoned' ? '—' : h.score ?? '—' }}<small> / {{ h.max_score }}</small></span>
          <span v-if="h.status === 'abandoned'" class="c">已放弃{{ h.answered_count ? ` · 做了 ${h.answered_count} 题` : '' }}</span><span v-else class="c">{{ h.pending_self_rating_count ? `${h.pending_self_rating_count} 道待自评` : (h.coach_headline ?? '') }}</span></div></div>
    </main>

    <!-- 作答中 -->
    <template v-else-if="stage === 'run' && q">
      <div class="ebar">
        <span class="t" @click="drawer = !drawer">{{ ex?.title }} · {{ isEn ? `${gLabel(curG)}（${gRange(curG)}）` : `第 ${q.number} / ${qs.length} 题` }}<i class="dw">{{ drawer ? ' ▴' : ' ▾' }}</i></span>
        <span class="net" v-if="!online">{{ online ? `${unsent} 道题在传` : `离线中，${unsent} 道题的答案存在本机，联网后自动补交` }}</span>
        <span class="clk" :class="{ low: remaining < 900 }">{{ clock(remaining) }}</span>
        <span class="link" @click="paused ? cont() : pause()">{{ paused ? '继续' : '暂停' }}</span><span v-if="!paused && pzMin > 0" class="pzs" :class="{ over: pzMin >= PZ_LIMIT }" :title="pzHint">停过 {{ pzMin }} 分</span>
        <span class="link" @click="ask = 'leave'">交卷</span>
      </div>
      <div v-if="paused" class="main pausebox"><p class="big">已暂停，计时停了</p><p class="sub">题目先遮住。回来点继续。</p><p class="sub pzhint" :class="{ over: pzMin >= PZ_LIMIT }">{{ pzHint }}</p><div class="acts flat"><span class="next" @click="cont">继续</span></div></div>
      <div v-else class="erow">
        <main v-if="isEn && curG" class="main enmain">
          <EnPaper :g="curG" :answers="answers" :focus="focusId" @pick="(x, k) => setAns(x as any, { answer: [k] })" @typed="(x, v) => typed(x as any, v)" @focus="id => focusId = id" @flag="x => setAns(x as any, { flagged: !flagged(x as any) })" />
          <div class="acts">
            <span v-if="gIdx > 0" @click="goG(-1)">上一篇</span>
            <span class="next" @click="gIdx < enGroups.length - 1 ? goG(1) : (ask = 'leave')">{{ gIdx < enGroups.length - 1 ? `下一篇 · ${gLabel(enGroups[gIdx + 1])}` : '交卷' }}</span>
          </div>
        </main>
        <main v-else class="main">
          <div class="head">
            <div class="no">{{ String(q.number).padStart(2, '0') }}<small>/ {{ qs.length }}</small></div>
            <div class="qbody">
              <div class="meta">第 {{ q.number }} 题 · {{ q.score }} 分<span class="flag" :class="{ on: flagged(q) }" @click="setAns(q, { flagged: !flagged(q) })">{{ flagged(q) ? '已标记' : '标记一下' }}</span></div>
              <div class="q" v-html="renderStem(q.stem, q.tables)"></div>
              <figure v-for="src in q.images ?? []" :key="src" class="fig"><img :src="(q.asset_base ?? '/api/v1/assets/') + src" alt="" /></figure>
              <div v-if="kind(q) === 'essay' && q.sub_questions?.length && !/[（(]\s*(1|I|Ⅰ)\s*[）)]/.test(q.stem)" class="subs">
                <div v-for="s in q.sub_questions" :key="s.number" class="subq"><span class="sn">（{{ s.number }}）</span><span v-html="renderTex(s.stem)"></span></div></div>
            </div>
          </div>
          <div v-if="kind(q) === 'choice'" class="opts">
            <div v-for="o in q.options" :key="o.key" class="o" :class="{ sel: answers[q.id]?.answer?.[0] === o.key }" @click="setAns(q, { answer: [o.key] })">
              <span class="l">{{ o.key }}</span><span v-html="renderTex(o.content)"></span></div>
          </div>
          <div v-else-if="kind(q) === 'blank'" class="blank"><label>你的答案</label>
            <input :value="answers[q.id]?.answer?.[0] ?? ''" placeholder="填数字或式子" @input="typed(q, ($event.target as HTMLInputElement).value)" /></div>
          <div v-else class="essay"><textarea rows="5" :value="answers[q.id]?.answer?.[0] ?? ''" placeholder="在纸上作答；写完在这里记一句结论，算作已答" @input="typed(q, ($event.target as HTMLTextAreaElement).value)"></textarea></div>
          <div class="acts">
            <span v-if="idx > 0" @click="go(idx - 1)">上一题</span>
            <span class="next" @click="idx < qs.length - 1 ? go(idx + 1) : (ask = 'leave')">{{ idx < qs.length - 1 ? '下一题' : '交卷' }}</span>
          </div>
        </main>
        <div v-if="drawer" class="dmask" @click="drawer = false"></div>
        <aside class="side" :class="{ open: drawer }">
          <div class="cap">答 题 卡 · {{ doneN }} / {{ qs.length }}</div>
          <div class="cells"><span v-for="(x, i) in qs" :key="x.id" class="cell" :class="{ f: answered(x), cur: i === idx, fl: flagged(x) }" @click="go(i)">{{ x.number }}</span></div>
          <p class="sub small">实心是答过的，红角是标记的。</p>
          <div class="acts flat"><span class="next" @click="ask = 'leave'">交卷</span></div>
        </aside>
      </div>
    </template>

    <!-- 交卷前：解答题对答案自评 -->
    <main v-else-if="stage === 'rate'" class="main">
      <div class="cap">{{ isEn ? '交 卷 · 翻译和作文自评' : '交 卷 · 解答题自评' }}</div>
      <p v-if="isEn" class="sub">选择题（含完形、新题型）会自动判分。翻译和作文对照参考答案给自己估个档：基本到位给满分，大概一半给一半。参考答案不是唯一标准，意思对、表达通顺就能得分。没评的先不计分，交卷后可以补评。</p>
      <p v-else class="sub">选择、填空会自动判分。解答题对照参考答案给自己打分：全对算满分，思路对算一半；证明题按整题评，计算题按小问评。没评的先不计分，交卷后可以补评。</p>
      <div v-for="x in essays" :id="'rq-' + x.id" :key="x.id" class="rq" :class="{ hot: hotRq === x.id }">
        <div class="meta">第 {{ x.number }} 题 · {{ x.score }} 分{{ answered(x) ? '' : ' · 没作答' }}</div>
        <template v-if="isEn">
          <p v-if="x.section === 'translation'" class="ensrc">{{ x.stem }}</p>
          <div class="enmine"><span class="k">你写的</span>{{ answers[x.id]?.answer?.[0]?.trim() || '没作答' }}</div>
          <div class="enref"><span class="k">{{ x.section === 'translation' ? '参考译文' : '参考范文' }}<i class="xtag">专家</i></span>{{ refOf(x) || '还没有参考答案' }}</div>
        </template>
        <div class="zhu" v-else-if="x.sub_questions?.some(s => s.answer?.length)"><div v-for="s in x.sub_questions" :key="s.number"><b>（{{ s.number }}）</b><span v-html="renderTex((s.answer ?? []).join(''))"></span></div></div>
        <div class="zhu" v-else-if="x.answer?.length" v-html="renderTex(x.answer.join('，'))"></div>
        <template v-if="perSub(x)">
          <div v-for="s in x.sub_questions" :key="s.number" class="rate"><span class="k">（{{ s.number }}）{{ s.score }} 分<i v-if="s.score_estimated" class="gu">估</i></span>
            <span v-for="(t, r) in ratingText" :key="r" class="chip" :class="{ on: subs[x.id]?.[s.number] === r }" @click="subs[x.id] = { ...subs[x.id], [s.number]: r as Rating }">{{ t }}</span></div>
          <p v-if="x.sub_scores_source !== 'official'" class="estnote">{{ x.sub_scores_source === 'even_split' ? '小问分值是把整题分平均拆开的，仅供自评参考' : '小问分值按常见阅卷细则估计，不是官方分值' }}；整题 {{ x.score }} 分是官方的。</p>
        </template>
        <div v-else class="rate"><span class="k">{{ x.score_by_whole ? '证明题，整题' : '整题' }}</span>
          <span v-if="noAns(x)" class="noans">没作答，记 0 分</span>
          <template v-else><span v-for="(t, r) in ratingText" :key="r" class="chip" :class="{ on: whole[x.id] === r }" @click="pickWhole(x, r as Rating)">{{ t }}</span></template></div>
        <p v-if="pend?.id === x.id" class="shortw">只写了 {{ pend.n }} 个{{ qs.find(q => q.id === pend!.id)?.section === 'translation' ? '字' : '词' }}，确定按『基本到位』算？<span class="link sm" @click="keepFull(x)">确定</span><span class="link sm" @click="pend = null">算了</span></p>
        <p v-else-if="shortSet.includes(x.id) && whole[x.id] === 'full'" class="shortw">自评·字数不足</p>
      </div>
      <div class="acts flat"><span v-if="remaining > 0 && ex?.status !== 'submitted'" class="link" @click="open(ex!)">回去接着做</span><span v-if="ex?.status === 'submitted'" class="link" @click="stage = 'result'">先不评</span><span class="next" @click="trySubmit">{{ submitting ? '正在交…' : ex?.status === 'submitted' ? '评好了，看成绩' : '交卷，看成绩' }}</span></div>
    </main>

    <!-- 成绩 -->
    <main v-else-if="stage === 'result' && res" class="main summary">
      <div class="cap">{{ ex?.title }} · 成 绩</div>
      <div class="score"><b>{{ res.score }}</b><small>/ {{ res.max_score }}</small></div>
      <p v-if="splitLine" class="sub splitln">{{ splitLine }}</p>
      <p v-if="pauseLine" class="sub pauseln">{{ pauseLine }}</p>
      <p v-if="nonCont" class="sub noncont">中途暂停较久，这次不计入模考趋势</p>
      <p v-if="coachLine" class="coach"><span class="k">教练说</span>{{ coachLine }}</p>
      <div class="brk">
        <table><tr><th>题型</th><th>得分</th><th>得分率</th></tr>
          <tr v-for="t in byType" :key="t.k"><td>{{ t.k }}</td><td>{{ t.got }} / {{ t.max }}<small v-if="t.pend" class="pd">（{{ t.pend }} 分待自评）</small></td><td><i class="bar"><i :style="{ width: t.rate + '%' }"></i></i>{{ t.rate }}%</td></tr></table>
        <table><tr><th>科目</th><th>得分</th><th>得分率</th></tr>
          <tr v-for="t in bySubj" :key="t.k"><td>{{ t.k }}</td><td>{{ t.got }} / {{ t.max }}<small v-if="t.pend" class="pd">（{{ t.pend }} 分待自评）</small></td><td><i class="bar"><i :style="{ width: t.rate + '%' }"></i></i>{{ t.rate }}%</td></tr></table>
      </div>
      <div v-if="lossKp.length" class="loss"><span class="k">丢分在哪</span>
        <div v-for="l in lossKp" :key="l.k" class="lrow"><span class="nm">{{ l.k }}</span><span class="pt">−{{ l.lost }}</span><span class="nums">第 {{ l.nums.join('、') }} 题</span></div></div>
      <p v-for="(c, i) in concl" :key="i" :class="i ? 'zhupi' : 'sline'">{{ c }}</p>
      <div v-if="wrongs.length" class="slist"><span class="k">做了没拿满</span>
        <span v-for="p in wrongs" :key="p.question_id" class="chip bad" :class="{ on: tipQ === p.question_id }" @click="showQ(p.question_id)">{{ p.number }}</span></div>
      <div v-if="blanksQ.length" class="slist"><span class="k">没作答</span>
        <span v-for="p in blanksQ" :key="p.question_id" class="chip" :class="{ on: tipQ === p.question_id }" @click="showQ(p.question_id)">{{ p.number }}</span></div>
      <div v-if="tipP" class="qpeek">
        <div class="ph"><b>第 {{ tipP.number }} 题</b>{{ tipP.got == null ? `待自评 · 满分 ${tipP.score} 分` : `得 ${tipP.got} / ${tipP.score} 分` }} · 用时 {{ Math.max(1, Math.round((tipP.time_spent_seconds ?? 0) / 60)) }} 分钟<span class="link sm" @click="tipQ = null">收起</span></div>
        <p class="pa"><span class="k">你的答案</span><span v-if="ansOf(tipP)" v-html="tex(ansOf(tipP))"></span><span v-else>{{ did(tipP) ? '纸上作答' : '没作答' }}</span></p>
        <p v-if="keyOf(tipP)" class="pa" :class="{ ref: refQ(tipP) }"><span class="k">{{ refQ(tipP) ? (qById.get(tipP.question_id)?.section === 'translation' ? '参考译文' : '参考范文') : '正确答案' }}<i v-if="refQ(tipP)" class="xtag">专家</i></span><span v-html="tex(keyOf(tipP))"></span></p>
        <div class="note"><p v-if="exps[tipP.question_id]?.label" class="src">{{ exps[tipP.question_id].label }}</p>
          <Errata :list="qById.get(tipP.question_id)?.errata" />
          <p v-for="st in exps[tipP.question_id]?.steps ?? []" :key="st.n"><b>{{ st.n }}</b>　<span v-html="renderFor(tipP.question_id, st.text)"></span></p>
          <p v-if="exps[tipP.question_id]?.pending" class="pend">{{ exps[tipP.question_id].pending }}</p>
          <p v-if="exps[tipP.question_id]?.loading" class="pend">正在讲…</p></div>
      </div>
      <div class="slist"><span class="bigbtn sm" @click="showAll = !showAll">{{ showAll ? '收起逐题对照 ▴' : `逐题对照答案（${pq.length} 题）▾` }}</span></div>
      <table v-if="showAll" class="each"><tr><th>题</th><th>你的答案</th><th>正确答案</th><th>得分</th></tr>
        <tr v-for="p in pq" :key="p.question_id" :class="{ bad: p.got != null && p.got < p.score }"><td><span class="link" @click="showQ(p.question_id); nextTickTop()">{{ p.number }}</span></td>
          <td v-if="refQ(p)" class="dim">{{ ansOf(p) ? '已作答' : '—' }}</td><td v-else-if="ansOf(p)" v-html="tex(ansOf(p))"></td><td v-else>{{ did(p) ? '纸上作答' : '—' }}</td>
          <td v-if="refQ(p)" class="dim"><span class="link" @click="showQ(p.question_id); nextTickTop()">点题号看参考</span></td><td v-else-if="keyOf(p)" v-html="tex(keyOf(p))"></td><td v-else class="dim">{{ p.objective ? '' : '看自评页' }}</td>
          <td>{{ p.got ?? '待自评' }} / {{ p.score }}<small v-if="isShort(p) && p.got != null" class="shortag">自评·字数不足</small><span v-if="p.got == null && res.pending_self_rating?.includes(p.question_id)" class="link sm rl" @click="rateLater(p.question_id)">去自评</span></td></tr></table>
      <div v-if="res.pending_self_rating?.length" class="ratebox"><p>还有 {{ res.pending_self_rating.length }} 道{{ isEn ? '翻译/作文' : '解答题' }}没自评（逐题对照里标『待自评』），评完才有最终分和教练点评。</p><span class="bigbtn pri" @click="rateLater()">现在评</span></div>
      <p class="sub">做了没拿满的题已经进了错题本。点题号能看这题的作答对照和讲解。</p>
      <p v-if="usedSub" class="estnote">分问自评的小问分值按常见阅卷细则估计，不是官方分值，和别人对分时以整题分为准。</p>
      <div class="btns"><span class="bigbtn" @click="report">{{ downloading?.includes('report.pdf') ? '生成中…' : '成绩单 PDF' }}</span><span class="bigbtn" @click="pdf">{{ downloading?.includes('wrong-questions') ? '生成中…' : '导出错题 PDF' }}</span><span class="bigbtn" @click="emit('nav', 'wrong')">去错题本</span><span class="bigbtn" :class="{ pri: !res.pending_self_rating?.length }" @click="again">再考一场</span></div>
    </main>
    <main v-else class="main"><p class="sub">正在加载…</p></main>
    <div v-if="ask" class="cfm-mask" @click.self="ask = null"><div class="cfm">
      <template v-if="ask === 'leave'"><p class="big">现在交卷？</p>
        <p class="sub">还有 {{ qs.length - doneN }} 道没作答{{ remaining > 0 ? `，时间还剩 ${clock(remaining)}` : '' }}。交卷后先给解答题自评，自评页还能回来接着做。</p>
        <div class="acts flat"><span class="link" @click="ask = null">再看看</span><span class="next" @click="ask = null; toRate()">交卷</span></div></template>
      <template v-else-if="ask === 'submit'"><p class="big">确定交卷？</p>
        <p class="sub">{{ unrated ? `还有 ${unrated} 处没自评，这几处先不计分，交卷后可以补评。` : '解答题都评好了。' }}交了就不能再改答案。</p>
        <div class="acts flat"><span class="link" @click="ask = null">再看看</span><span class="next" @click="ask = null; submit()">确定交卷</span></div></template>
      <template v-else><p class="big">结束「{{ active?.title }}」？</p>
        <p class="sub">这场作废，不计分，然后就能开新的一场。</p>
        <div class="acts flat"><span class="link" @click="ask = null">算了</span><span class="next danger" @click="endActive">放弃，开新的</span></div></template>
    </div></div>
  </div>
</template>
