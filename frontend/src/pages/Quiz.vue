<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import Errata, { type Erratum } from '../components/Errata.vue'
import { dragHint } from '../lib/draghint'
import { renderStem, renderTex, type StemTable } from '../lib/tex'
import { api, sse, uid } from '../lib/api'
import { toast } from '../lib/toast'

type Sub = { number: number; stem: string; score: number | null; answer?: string[]; score_estimated?: boolean }
type Q = { errata?: Erratum[] | null; id: string; number: number; type: string; section?: string; stem: string; score: number;
  options: { key: string; content: string }[]; answer?: string[]; knowledge_points: string[]; review: { status: string };
  images?: string[]; asset_base?: string; tables?: StemTable[] | null; sub_scores_source?: string | null; sub_questions?: Sub[]; solution?: string | null; score_by_whole?: boolean }
type Rating = 'full' | 'approach_ok_calc_wrong' | 'no_idea'
type Step = { n: number; text: string }

const props = defineProps<{ year: number; years: number[] }>()
const emit = defineEmits<{ nav: [string]; year: [number]; subj: [string] }>()
const PAPER = { exam: 'math1', year: props.year }
const KEY = `quiz:${PAPER.exam}-${PAPER.year}`
const all = ref<Q[]>([])
const loadErr = ref('')
const idx = ref(Number(localStorage.getItem(KEY + ':idx') ?? 0))
const picks = ref<Record<string, string>>({})
const blanks = ref<Record<string, string>>({})
const thoughts = ref<Record<string, string>>({})
const ratings = ref<Record<string, Rating>>({})
const revealed = ref<Record<string, boolean>>({})
// 计算题按小问自评：subR[题id][小问号]；证明题、单问题只用 ratings 整题自评
const subR = ref<Record<string, Record<number, Rating>>>({})
const results = ref<Record<string, { correct: string[]; ok: boolean | null }>>({})
const hints = ref<Record<string, { steps: Step[]; more: boolean; loading: boolean; source?: string; label?: string | null; text?: string | null }>>({})
const explains = ref<Record<string, { steps: Step[]; status: string; loading: boolean; err?: string; source?: string; label?: string | null; notice?: string | null }>>({})
const showSummary = ref(false)
let startedAt = Date.now()

const q = computed(() => all.value[idx.value])
const kind = (x: Q) => x.type.includes('choice') ? 'choice' : x.type === 'fill_blank' ? 'blank' : 'essay'
const groups = computed(() => [
  { name: '选择题', items: all.value.filter(x => kind(x) === 'choice') },
  { name: '填空题', items: all.value.filter(x => kind(x) === 'blank') },
  { name: '解答题', items: all.value.filter(x => kind(x) === 'essay') },
].filter(g => g.items.length))
const kp = computed(() => q.value?.knowledge_points?.[0]?.split('/').slice(1).join(' · ') ?? '')
const srcLabel: Record<string, string> = { official: '官方解析', expert: '行业专家参考解答（非官方解析）', ai: 'AI 讲解' }
// 专家讲解后面标是否已核对；官方解析没核对的，后端的 source_label 里已经带了「（未核对）」
const label = (src?: string, l?: string | null, verified?: boolean) => {
  const t = l ?? srcLabel[src ?? ''] ?? null
  return t && src === 'expert' && verified != null ? `${t} · ${verified ? '已核对' : '待核对'}` : t
}
// 题干里已写了（1）/(I)/Ⅰ 这类小问标号，就不再单独列小问
const inStem = (x: Q) => /[（(]\s*(1|I|Ⅰ)\s*[）)]/.test(x.stem)
const statusText: Record<string, string> = { pending: '待核对', suspect: '可疑', confirmed: '已确认' }
const ratingText: Record<Rating, string> = { full: '全对', approach_ok_calc_wrong: '思路对，算错了', no_idea: '没思路' }
const perSub = (x: Q) => !x.score_by_whole && (x.sub_questions?.length ?? 0) > 1 && x.sub_questions!.every(s => s.score)
const subsRated = (x: Q) => perSub(x) && x.sub_questions!.every(s => subR.value[x.id]?.[s.number])
const rated = (x: Q) => !!ratings.value[x.id] || subsRated(x)
const done = (x: Q) => kind(x) === 'essay' ? rated(x) : !!results.value[x.id]
const factor = (r?: Rating) => r === 'full' ? 1 : r === 'approach_ok_calc_wrong' ? 0.5 : 0
// 整题自评优先看更新的那次：按小问评完会清掉整题自评，反之亦然
const essPoints = (x: Q) => ratings.value[x.id] ? x.score * factor(ratings.value[x.id])
  : subsRated(x) ? x.sub_questions!.reduce((t, s) => t + (s.score ?? 0) * factor(subR.value[x.id][s.number]), 0) : 0
const checked = computed(() => q.value && done(q.value))

watch(idx, v => localStorage.setItem(KEY + ':idx', String(v)))
// 填空和解答题思路边输入边存草稿，刷新不丢
watch(picks, v => localStorage.setItem(KEY + ':picks', JSON.stringify(v)), { deep: true })
watch(blanks, v => localStorage.setItem(KEY + ':blanks', JSON.stringify(v)), { deep: true })
watch(thoughts, v => localStorage.setItem(KEY + ':thoughts', JSON.stringify(v)), { deep: true })

async function load() {
  try {
    const [qs, mine] = await Promise.all([
      api<{ items: Q[] }>(`/questions?exam=${PAPER.exam}&year=${PAPER.year}&include_answer=true&page_size=100`),
      api<{ items: any[] }>(`/answers?exam=${PAPER.exam}&year=${PAPER.year}`),
    ])
    all.value = qs.items.sort((a, b) => a.number - b.number)
    const byId = new Map(all.value.map(x => [x.id, x]))
    // 回填上次的作答：每道题取最新一条
    const latest = new Map<string, any>(), subs = new Map<string, any[]>()
    for (const r of mine.items) {
      if (!byId.has(r.question_id)) continue
      if (r.sub_number != null && r.self_rating) { subs.set(r.question_id, [...(subs.get(r.question_id) ?? []), r]); continue }
      const prev = latest.get(r.question_id)
      if (!prev || r.answered_at > prev.answered_at) latest.set(r.question_id, r)
    }
    for (const [id, rs] of subs) {
      const x = byId.get(id)!, whole = latest.get(id)
      if (!perSub(x)) continue
      const newest = rs.reduce((m, r) => r.answered_at > m ? r.answered_at : m, '')
      if (whole?.self_rating && whole.answered_at > newest) continue
      latest.delete(id)
      subR.value[id] = Object.fromEntries(rs.map(r => [r.sub_number, r.self_rating]))
      revealed.value[id] = true; const t = rs.find(r => r.thought_text); if (t) thoughts.value[id] = t.thought_text
    }
    for (const [id, r] of latest) {
      const x = byId.get(id)!
      if (kind(x) === 'essay') {
        if (r.self_rating) { ratings.value[id] = r.self_rating; revealed.value[id] = true; thoughts.value[id] = r.thought_text ?? '' }
      } else if (r.answer?.length) {
        if (kind(x) === 'choice') picks.value[id] = r.answer[0]; else blanks.value[id] = r.answer[0]
        results.value[id] = { correct: x.answer ?? [], ok: r.is_correct }
      }
    }
    const draft = (k: string) => { try { return JSON.parse(localStorage.getItem(KEY + k) ?? '{}') } catch { return {} } }
    for (const [id, v] of Object.entries(draft(':picks'))) if (!results.value[id] && v) picks.value[id] = v as string
    for (const [id, v] of Object.entries(draft(':blanks'))) if (!results.value[id] && v) blanks.value[id] = v as string
    for (const [id, v] of Object.entries(draft(':thoughts'))) if (v) thoughts.value[id] = v as string
    if (idx.value >= all.value.length) idx.value = 0
    // 只在本次打开后第一次进刷题页时提示
    if ((latest.size || subs.size) && !sessionStorage.getItem('restored')) { sessionStorage.setItem('restored', '1'); toast(`已恢复上次的进度：做过 ${new Set([...latest.keys(), ...subs.keys()]).size} 道`) }
  } catch (e: any) { loadErr.value = e.message }
}
onMounted(load)

let lastAct = 0
function sheetGo(i: number, k?: string) { if (Date.now() - lastAct < 600) return; go(i); if (k) pick(k) }
function go(i: number) { idx.value = i; showSummary.value = false; startedAt = Date.now(); scrollTo({ top: 0 }) }
function next() { if (idx.value < all.value.length - 1) go(idx.value + 1); else submit() }
const spent = () => Math.round((Date.now() - startedAt) / 1000)

function pick(k: string) { if (!checked.value) picks.value[q.value.id] = k }
async function check(x: Q = q.value, quiet = false) {
  const a = kind(x) === 'choice' ? picks.value[x.id] : blanks.value[x.id]?.trim()
  if (!a) return
  try {
    const r = await api<{ correct_answer: string[]; is_correct: boolean | null }>('/answers', { method: 'POST',
      body: JSON.stringify({ question_id: x.id, answer: [a], time_spent_seconds: spent(), client_id: uid() }) })
    touched.value[x.id] = true
    results.value[x.id] = { correct: r.correct_answer ?? x.answer ?? [], ok: r.is_correct }
  } catch (e: any) { if (!quiet) toast('没交上去：' + e.message); else throw e }
}
// 交卷：选了 / 填了但没点「对答案」的题一起判分
const submitting = ref(false)
async function submit() {
  if (submitting.value) return
  const todo = all.value.filter(x => kind(x) !== 'essay' && !results.value[x.id] && (kind(x) === 'choice' ? picks.value[x.id] : blanks.value[x.id]?.trim()))
  submitting.value = true
  const rs = await Promise.allSettled(todo.map(x => check(x, true)))
  submitting.value = false
  const bad = rs.filter(r => r.status === 'rejected').length
  if (bad) toast(`有 ${bad} 道没交上去，网络好了再点一次交卷`)
  showSummary.value = true; scrollTo({ top: 0 })
}
// 自评随时可以改，再点一次就覆盖；sub 为小问号，不传就是整题
async function rate(r: Rating, sub?: number) {
  const x = q.value
  // 先在本地亮起来，再提交；没记上就退回去
  const before = { r: ratings.value[x.id], s: subR.value[x.id] }
  if (sub == null) { ratings.value[x.id] = r; delete subR.value[x.id] }
  else { subR.value[x.id] = { ...subR.value[x.id], [sub]: r }; delete ratings.value[x.id] }
  try {
    await api('/answers', { method: 'POST', body: JSON.stringify({ question_id: x.id, self_rating: r, sub_number: sub,
      thought_text: thoughts.value[x.id] || undefined, time_spent_seconds: spent(), client_id: uid() }) })
    touched.value[x.id] = true
  } catch (e: any) {
    toast('没记上：' + e.message)
    if (before.r) ratings.value[x.id] = before.r; else delete ratings.value[x.id]
    if (before.s) subR.value[x.id] = before.s; else delete subR.value[x.id]
  }
}

async function hint() {
  const x = q.value; hints.value[x.id] ??= { steps: [], more: true, loading: false }; const h = hints.value[x.id]
  if (h.loading || !h.more) return
  h.loading = true
  try {
    const r = await api<{ hints: Step[]; has_more: boolean; source?: string; source_label?: string | null; text?: string | null }>(`/questions/${x.id}/hint?step=${h.steps.length + 1}`)
    h.steps = r.hints ?? []; h.more = r.source !== 'pending' && r.has_more; h.text = r.text; h.source = r.source; h.label = label(r.source, r.source_label, (r as any).verified)
  } catch (e: any) { toast('思路没拿到：' + e.message) } finally { h.loading = false }
}
async function explain() {
  const x = q.value; if (explains.value[x.id]?.loading) return
  explains.value[x.id] = { steps: [], status: '', loading: true }; const ex = explains.value[x.id]
  try {
    await sse(`/questions/${x.id}/explain`, {}, ev => {
      if (ev.type === 'meta') ex.source = ev.source
      if (ev.type === 'step') ex.steps.push({ n: ev.n, text: ev.text })
      if (ev.type === 'done') { ex.loading = false; ex.status = ev.status ?? (ev.verified ? 'verified' : 'pending_review'); ex.source = ev.source ?? ex.source; ex.label = label(ex.source, ev.source_label, ev.verified); ex.notice = ev.notice ?? (ev.source === 'pending' ? ev.text : null) }
    })
  } catch (e: any) { ex.err = e.message } finally { ex.loading = false }
}

function cls(k: string) {
  const x = q.value, p = picks.value[x.id], r = results.value[x.id]
  if (!r) return p === k ? 'sel' : ''
  if (r.correct.includes(k)) return 'ok'
  return p === k ? 'bad' : ''
}
const wrongRow = (x: Q) => results.value[x.id]?.ok === false || ratings.value[x.id] === 'no_idea' || Object.values(subR.value[x.id] ?? {}).includes('no_idea')

// 交卷汇总：客观题按判分，大题按自评估算（全对给满分、思路对给一半）
const summary = computed(() => {
  const obj = all.value.filter(x => kind(x) !== 'essay'), ess = all.value.filter(x => kind(x) === 'essay')
  const right = obj.filter(x => results.value[x.id]?.ok === true)
  const objScore = right.reduce((s, x) => s + x.score, 0)
  const essScore = ess.reduce((s, x) => s + essPoints(x), 0)
  return {
    total: all.value.reduce((s, x) => s + x.score, 0), objScore, essScore,
    objDone: obj.filter(x => results.value[x.id]).length, objAll: obj.length, objRight: right.length,
    essDone: ess.filter(rated).length, essAll: ess.length,
    wrong: all.value.filter(wrongRow), undone: all.value.filter(x => !done(x)),
  }
})
const answerOf = (x: Q) => (x.answer ?? []).join('，')

// 朱批：题目旁一句话，只说最要紧的一件事。来源：这题自己的错题记录 > 这个知识点最近的正确率和常见错因。
// 点「知道了」算一次没理会；连着没理会 3 次以后，只在这道题你自己错过时才批。
type Leaf = { name: string; recent_acc: number | null; attempts: number; correct: number }
const wq = ref(new Map<string, any>()), leaves = ref(new Map<string, Leaf>()), errs = ref(new Map<string, Record<string, number>>())
const ZKEY = 'zhupi:ignored'
const ignored = ref(Number(localStorage.getItem(ZKEY) ?? 0))
const closed = ref<Record<string, boolean>>({})
// 这次打开后动过手的题就不再批，以前做过的照样批
const touched = ref<Record<string, boolean>>({})
const errText: Record<string, string> = { concept: '概念没吃透', calc: '计算', careless: '粗心', reading: '审题', method: '方法没想到' }
const errTip: Record<string, string> = {
  careless: '这类你常手滑，写完每一步扫一眼符号和抄写。',
  calc: '这类你常在计算上丢分，最后一步代回去验一下。',
  concept: '先想清楚这题考的是哪个定义或定理，再动笔。',
  reading: '先把条件再读一遍，圈出限定词。',
  method: '动笔前先想两条路，挑短的那条。',
}
async function loadCoach() {
  const walk = (n: any) => { if (n.level === 3) leaves.value.set(n.path, n); for (const c of n.children ?? []) walk(c) }
  const [w, t, pf] = await Promise.allSettled([
    api<{ items: any[] }>(`/wrong-questions?exam=${PAPER.exam}`), api<{ subjects: any[] }>('/mastery/tree'), api<{ error_profile: any[] }>('/mastery/profile')])
  if (w.status === 'fulfilled') wq.value = new Map(w.value.items.map(i => [i.question_id, i]))
  if (t.status === 'fulfilled') t.value.subjects.forEach(walk)
  if (pf.status === 'fulfilled') errs.value = new Map((pf.value.error_profile ?? []).map((e: any) => [e.kp_path, e]))
}
onMounted(loadCoach)
// 切回这个页面（或别处刚记了错题）时重新拉一遍，免得朱批用的是旧数据
const onVis = () => { if (document.visibilityState === 'visible') loadCoach() }
onMounted(() => document.addEventListener('visibilitychange', onVis))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVis))
const zhupi = computed(() => {
  const x = q.value; if (!x || closed.value[x.id] || touched.value[x.id]) return null
  const w = wq.value.get(x.id)
  if (w) {
    const why = w.error_type && w.error_type !== 'unclassified' ? `，错在${errText[w.error_type] ?? w.error_type}` : ''
    return { own: true, text: `${w.wrong_count > 1 ? `这题你错过 ${w.wrong_count} 次` : '这题你上次做错了'}${why}。${w.reminder ?? ''}` }
  }
  if (ignored.value >= 3) return null
  for (const path of x.knowledge_points ?? []) {
    const l = leaves.value.get(path)
    if (!l || l.attempts < 3 || l.recent_acc == null || l.recent_acc >= 0.5) continue
    const e = errs.value.get(path); let top = ''
    if (e) top = (['calc', 'careless', 'concept', 'reading', 'method'] as const).reduce((m, k) => (e[k] ?? 0) > (e[m] ?? 0) ? k : m, 'calc' as string)
    return { own: false, text: `「${l.name}」最近做对 ${l.correct} / ${l.attempts}。${top && e?.[top] ? errTip[top] : '慢一点，每步写全。'}` }
  }
  return null
})
function closeZhupi() { const z = zhupi.value; closed.value[q.value.id] = true; if (z && !z.own) localStorage.setItem(ZKEY, String(++ignored.value)) }
// 在这道题上跟教练说一句（带 question_id），比如做错后说「这题我会，是手滑」→ 记为粗心，不降掌握度，可在首页撤回
const said = ref<Record<string, { text: string; reply: string | null; busy: boolean }>>({})
const slip = (x: Q) => results.value[x.id]?.ok === false || ratings.value[x.id] === 'approach_ok_calc_wrong' || Object.values(subR.value[x.id] ?? {}).includes('approach_ok_calc_wrong')
async function tell(text: string) {
  const x = q.value; if (said.value[x.id]?.busy) return
  said.value[x.id] = { text, reply: null, busy: true }; const r = said.value[x.id]
  try {
    await sse('/agent/commands', { text, question_id: x.id, client_id: uid() }, ev => {
      if (ev.type === 'done') r.reply = ev.reply || ev.summary || (ev.deduped ? '记过了' : '记下了')
      if (ev.type === 'error') r.reply = '没记上：' + ev.message
    })
  } catch (e: any) { r.reply = '没记上：' + e.message } finally { r.busy = false }
}
// 批过的题做对了，说明这句有用，没理会计数清零
watch(() => q.value && results.value[q.value.id]?.ok, ok => { if (ok) { ignored.value = 0; localStorage.setItem(ZKEY, '0') } })
let dhT = 0
onUpdated(() => { clearTimeout(dhT); dhT = window.setTimeout(() => dragHint(), 300) })
</script>

<template>
  <div v-if="!q" class="page"><p class="sub pad">{{ loadErr || '正在加载题目…' }}</p></div>
  <div v-else class="page">
    <main v-if="showSummary" class="main summary">
      <div class="cap">交 卷</div>
      <div class="score"><b>{{ summary.objScore + summary.essScore }}</b><small>/ {{ summary.total }}</small></div>
      <p class="sline">客观题做了 {{ summary.objDone }} / {{ summary.objAll }} 道，对了 {{ summary.objRight }} 道，得 {{ summary.objScore }} 分。</p>
      <p class="sline">解答题自评了 {{ summary.essDone }} / {{ summary.essAll }} 道，按自评估 {{ summary.essScore }} 分（全对算满分，思路对算一半）。</p>
      <div v-if="summary.wrong.length" class="slist"><span class="k">错了或没思路</span>
        <span v-for="x in summary.wrong" :key="x.id" class="chip bad" @click="go(all.indexOf(x))">{{ x.number }}</span></div>
      <div v-if="summary.undone.length" class="slist"><span class="k">还没做</span>
        <span v-for="x in summary.undone" :key="x.id" class="chip" @click="go(all.indexOf(x))">{{ x.number }}</span></div>
      <p class="sub">做错的题已经自动进了错题本。</p>
      <div class="acts flat"><span class="next" @click="go(summary.undone.length ? all.indexOf(summary.undone[0]) : 0)">{{ summary.undone.length ? '接着做没做的' : '从头再看一遍' }}</span></div>
    </main>

    <main v-else class="main">
      <div class="head">
        <div class="no">{{ String(q.number).padStart(2, '0') }}<small>/ {{ all.length }}</small></div>
        <div class="qbody">
          <div class="meta">{{ PAPER.year }} · 数学一 · {{ groups.find(g => g.items.includes(q))?.name }} · 第 {{ q.number }} 题 · {{ q.score }} 分<template v-if="kp"> · {{ kp }}</template>
            <span v-if="q.review.status !== 'confirmed'" class="rv">题目{{ statusText[q.review.status] ?? q.review.status }}</span></div>
          <div class="q" v-html="renderStem(q.stem, q.tables)"></div>
          <aside v-if="zhupi" class="zhupi"><span v-html="renderTex(zhupi.text)"></span><a @click="closeZhupi">知道了</a></aside>
          <figure v-for="(src, i) in q.images ?? []" :key="src" class="fig">
            <img :src="(q.asset_base ?? '/api/v1/assets/') + src" :alt="`第 ${q.number} 题配图 ${i + 1}`" loading="lazy" />
            <figcaption v-if="(q.images ?? []).length > 1">图 {{ i + 1 }}</figcaption>
          </figure>
        </div>
      </div>

      <div v-if="kind(q) === 'choice'" class="opts">
        <div v-for="o in q.options" :key="o.key" class="o" :class="cls(o.key)" @click="pick(o.key)">
          <span class="l">{{ o.key }}</span><span v-html="renderTex(o.content)"></span>
          <span v-if="checked && results[q.id].correct.includes(o.key)" class="tick">✓</span>
          <span v-else-if="checked && cls(o.key) === 'bad'" class="mark">你的选择</span>
        </div>
      </div>

      <div v-else-if="kind(q) === 'blank'" class="blank">
        <label>你的答案</label>
        <input v-model="blanks[q.id]" :disabled="checked" placeholder="填数字或式子，比如 6、1/2、\sqrt{2}" @keyup.enter="check()" />
        <div v-if="checked" class="verdict" :class="{ bad: results[q.id].ok === false }">
          <span v-if="results[q.id].ok === true" class="tick s">✓</span>
          <span v-else-if="results[q.id].ok === false">不对。</span>
          <span v-else>对照一下：</span>
          正确答案 <span v-html="renderTex(answerOf(q))"></span>
        </div>
      </div>

      <div v-else class="essay">
        <div v-if="q.sub_questions?.length && !inStem(q)" class="subs">
          <div v-for="s in q.sub_questions" :key="s.number" class="subq">
            <span class="sn">（{{ s.number }}）</span><span v-html="renderTex(s.stem)"></span><span v-if="s.score" class="ss">{{ s.score }} 分<i v-if="s.score_estimated" class="gu" title="按整题分值平均拆分的估计">估</i></span>
          </div>
        </div>
        <p v-if="q.score && (q.score_by_whole || inStem(q))" class="scoreline">本题 {{ q.score }} 分<template v-if="q.score_by_whole">，证明题按整题自评</template><template v-else-if="q.sub_questions?.some(s => s.score_estimated)">：<span v-for="s in q.sub_questions" :key="s.number">（{{ s.number }}）{{ s.score }} 分<i class="gu" title="按整题分值平均拆分的估计">估</i> </span></template></p>
        <textarea v-model="thoughts[q.id]" rows="4" placeholder="在纸上做完后，可以在这里记一句思路或卡住的地方（可选）"></textarea>
        <div v-if="revealed[q.id]" class="ref">
          <div class="cap">参 考 答 案</div>
          <template v-if="q.sub_questions?.some(s => s.answer?.length)">
            <div v-for="s in q.sub_questions" :key="s.number" class="zhu"><b>（{{ s.number }}）</b><span v-html="renderTex((s.answer ?? []).join(''))"></span></div>
          </template>
          <div v-else-if="q.answer?.length" class="zhu" v-html="renderTex(answerOf(q))"></div>
          <div v-if="q.solution" class="zhu" v-html="renderTex(q.solution)"></div>
          <template v-if="perSub(q)">
            <div class="rate-k">对照完，每问自评一下{{ ratings[q.id] ? `（之前整题评的是「${ratingText[ratings[q.id]]}」）` : '' }}</div>
            <div v-for="s in q.sub_questions" :key="s.number" class="rate"><span class="k">（{{ s.number }}）{{ s.score }} 分<i v-if="s.score_estimated" class="gu" title="按整题分值平均拆分的估计">估</i></span>
              <span v-for="(t, r) in ratingText" :key="r" class="chip" :class="{ on: subR[q.id]?.[s.number] === r }" @click="rate(r as Rating, s.number)">{{ t }}</span></div>
            <p v-if="q.sub_scores_source !== 'official'" class="estnote">{{ q.sub_scores_source === 'even_split' || (!q.sub_scores_source && q.sub_questions?.some(s => s.score_estimated)) ? '小问分值是把整题分平均拆开的，仅供自评参考' : '小问分值按常见阅卷细则估计，不是官方分值' }}；整题 {{ q.score }} 分是官方的。</p>
          </template>
          <div v-else class="rate"><span class="k">{{ q.score_by_whole ? '证明题按整题，你这题' : '对照完，你这题' }}</span>
            <span v-for="(t, r) in ratingText" :key="r" class="chip" :class="{ on: ratings[q.id] === r }" @click="rate(r as Rating)">{{ t }}</span></div>
          <p v-if="rated(q)" class="sub">记下了，约 {{ essPoints(q) }} / {{ q.score }} 分。重做以后可以直接点上面重新评。</p>
        </div>
      </div>

      <div v-if="hints[q.id]?.source === 'pending' && !explains[q.id]" class="note"><p class="pend">{{ hints[q.id].text || '思路生成中' }}，好了会出现在这里。</p></div>
      <div v-if="hints[q.id]?.steps.length && !explains[q.id]?.steps.length" class="note">
        <p v-if="hints[q.id].label" class="src">{{ hints[q.id].label }}</p>
        <p v-for="h in hints[q.id].steps" :key="h.n"><b>思路 {{ h.n }}</b>　<span v-html="renderTex(h.text.replace(/^\s*思路\s*[:：]\s*/, ''))"></span></p>
      </div>
      <div v-if="explains[q.id]" class="note">
        <p v-if="explains[q.id].label" class="src">{{ explains[q.id].label }}</p>
        <Errata :list="q.errata" />
        <p v-if="explains[q.id].source === 'pending'" class="pend">{{ explains[q.id].notice || '讲解生成中' }}，好了会出现在这里。</p>
        <p v-else-if="explains[q.id].status === 'pending_review'" class="pend">这题讲解待核对</p>
        <p v-for="s in explains[q.id].steps" :key="s.n"><b>{{ s.n }}</b>　<span v-html="renderTex(s.text)"></span></p>
        <p v-if="explains[q.id].loading" class="pend">正在讲…</p>
        <p v-if="explains[q.id].err" class="pend">讲解没拿到：{{ explains[q.id].err }}</p>
      </div>

      <div v-if="slip(q)" class="tell">
        <template v-if="!said[q.id]"><span class="k">跟教练说</span><span class="chip" @click="tell('这题我会，是手滑')">这题我会，是手滑</span><span class="chip" @click="tell('这题我是真不会，过两天再出给我')">真不会，过两天再出</span></template>
        <p v-else class="zhupi">{{ said[q.id].busy ? '记着…' : said[q.id].reply }}</p>
      </div>

      <div class="acts" @click.capture="lastAct = Date.now()">
        <span v-if="!checked && !revealed[q.id] && (hints[q.id]?.more ?? true)" @click="hint">{{ hints[q.id]?.loading ? '想一想…' : hints[q.id]?.steps.length ? '再给一步' : '给个思路' }}</span>
        <span v-if="(kind(q) === 'essay' ? revealed[q.id] : checked) && !explains[q.id]" @click="explain">看讲解</span>
        <template v-if="kind(q) === 'essay'">
          <span class="next" v-if="!revealed[q.id]" @click="revealed[q.id] = true">看参考答案</span>
          <span class="next" v-else-if="rated(q)" @click="next">{{ idx < all.length - 1 ? '下一题' : '交卷' }}</span>
        </template>
        <template v-else>
          <span class="next" v-if="!checked" :class="{ dim: kind(q) === 'choice' ? !picks[q.id] : !blanks[q.id]?.trim() }" @click="check()">对答案</span>
          <span class="next" v-else @click="next">{{ idx < all.length - 1 ? '下一题' : '交卷' }}</span>
        </template>
      </div>
    </main>

    <aside class="side">
      <div v-if="years.length > 1" class="grp"><div class="cap">年 份</div>
        <div class="cells"><span v-for="y in years" :key="y" class="cell yr" :class="{ f: y === year }" @click="emit('year', y)">{{ y }}</span></div></div>
      <div v-for="g in groups" :key="g.name" class="grp">
        <div class="cap">{{ g.name }}</div>
        <div v-if="g.name === '选择题'" class="sheet">
          <div v-for="x in g.items" :key="x.id" class="row" :class="{ cur: x === q && !showSummary, wrong: wrongRow(x) }" @click="sheetGo(all.indexOf(x))">
            <span class="n">{{ x.number }}</span>
            <span v-for="k in ['A','B','C','D']" :key="k" class="b" :class="{ f: picks[x.id] === k }" @click.stop="sheetGo(all.indexOf(x), k)">{{ k }}</span>
          </div>
        </div>
        <div v-else class="cells">
          <span v-for="x in g.items" :key="x.id" class="cell" :class="{ cur: x === q && !showSummary, f: done(x), wrong: wrongRow(x) }" @click="sheetGo(all.indexOf(x))">{{ x.number }}</span>
        </div>
      </div>
      <span class="submit" @click="submit">{{ submitting ? '正在判分…' : '交卷 · 看得分' }}</span>
      <a class="submit exam-in" href="#/exam">考场模式 · 整卷限时</a>
    </aside>
  </div>
</template>
