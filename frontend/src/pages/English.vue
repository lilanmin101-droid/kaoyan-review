<script setup lang="ts">
// 英语一：按文章做题。完形空位、翻译划线句直接画在原文里；客观题一组一起对答案；翻译和作文交给 AI 批改（没接模型时是「批改生成中」，作答照样存着）
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import Errata, { type Erratum } from '../components/Errata.vue'
import { api, uid } from '../lib/api'
import { toast } from '../lib/toast'
import { renderStem, type StemTable } from '../lib/tex'
import { parseParas, type Seg } from '../lib/passage'

type Opt = { key: string; content: string }
type Q = { errata?: Erratum[] | null; id: string; number: number; type: string; section: string; stem: string; score: number; options: Opt[]; answer?: string[]
  passage_id?: string | null; review?: { status: string }; knowledge_points?: string[]; tables?: StemTable[] | null; images?: string[]; asset_base?: string }
type Passage = { id: string; title: string; directions?: string; text: string; options?: Opt[]; subtype?: string | null; section_name?: string }
type Group = { passage_id: string | null; section: string; section_name: string; passage: Passage | null; questions: Q[] }
type Grade = { status: string; score: number | null; max_score: number; band_name?: string | null; notice?: string | null; disagreement?: boolean; needs_review?: boolean
  result?: { points_hit?: string[]; points_missed?: string[]; errors?: { span: string; type: string; fix: string }[]; suggestions?: string[]; band_reason?: string; word_count?: number } | null }

const mfold = ref(matchMedia('(max-width:760px)').matches) // 手机上 A–G 默认收成一行一句，和考场一致
const props = defineProps<{ year: number; years: number[] }>()
const emit = defineEmits<{ nav: [string]; year: [number]; subj: [string] }>()
const KEY = `en:english1-${props.year}`
const groups = ref<Group[]>([]), err = ref(''), gi = ref(Number(localStorage.getItem(KEY + ':g') ?? 0))
const picks = reactive<Record<string, string>>({})          // 客观题选的
const res = reactive<Record<string, { ok: boolean | null; correct: string[] }>>({}) // 对过答案的
const texts = reactive<Record<string, string>>(JSON.parse(localStorage.getItem(KEY + ':draft') ?? '{}')) // 翻译/作文草稿（本机）
const grades = reactive<Record<string, Grade & { loading?: boolean; answer_id?: string }>>({})
const showRef = reactive<Record<string, boolean>>({})
const focusQ = ref<string | null>(null), showText = ref(true)
const g = computed(() => groups.value[gi.value])
const isObj = (q: Q) => q.type === 'choice' || q.type === 'match'
const isWrite = (q: Q) => q.section === 'translation' || q.section.startsWith('writing')
const NAME: Record<string, string> = { use_of_english: '完形', translation: '翻译', writing_a: '小作文', writing_b: '大作文' }
const gname = (x: Group) => x.section === 'reading_a' ? (x.passage?.title ?? '阅读') : x.section === 'reading_b' ? '新题型' : NAME[x.section] ?? x.section_name
const nums = (x: Group) => x.questions.length ? `${x.questions[0].number}${x.questions.length > 1 ? '–' + x.questions[x.questions.length - 1].number : ''}` : ''
const gdone = (x: Group) => x.questions.length > 0 && x.questions.every(q => isObj(q) ? !!res[q.id] : !!grades[q.id])
const pending = computed(() => groups.value.flatMap(x => x.questions).filter(q => q.review?.status && q.review.status !== 'confirmed').length)

onMounted(load)
async function load() {
  try {
    const base = `/questions?exam=english1&year=${props.year}&include_answer=true&page_size=100`
    // 核对完的 + 还在核对的（翻译、作文目前都还在核对，先能做，标「待核对」）
    const [a, b, ans] = await Promise.all([api<{ items: Q[]; groups: Group[] }>(base), api<{ items: Q[]; groups: Group[] }>(base + '&review_status=pending').catch(() => ({ items: [], groups: [] })),
      api<{ items: any[] }>(`/answers?exam=english1&year=${props.year}`).catch(() => ({ items: [] }))])
    const m = new Map<string, Group>()
    for (const x of [...a.groups, ...b.groups]) {
      const k = x.passage_id ?? 'q:' + x.questions[0]?.id
      const old = m.get(k); if (old) { old.questions.push(...x.questions.filter(q => !old.questions.some(o => o.id === q.id))); old.questions.sort((p, q) => p.number - q.number) } else m.set(k, { ...x, questions: [...x.questions] })
    }
    groups.value = [...m.values()].sort((p, q) => (p.questions[0]?.number ?? 99) - (q.questions[0]?.number ?? 99))
    if (gi.value >= groups.value.length) gi.value = 0
    const jump = localStorage.getItem('en:jump'); localStorage.removeItem('en:jump')
    if (jump) { const k = groups.value.findIndex(x => x.passage_id === jump); if (k >= 0) gi.value = k }
    const qById = new Map(groups.value.flatMap(x => x.questions).map(q => [q.id, q]))
    for (const r of ans.items) {
      const q = qById.get(r.question_id); if (!q) continue
      if (isObj(q) && r.answer?.[0]) { picks[q.id] = r.answer[0]; res[q.id] = { ok: r.is_correct, correct: q.answer ?? [] } }
      if (isWrite(q) && r.answer?.[0]) { texts[q.id] ??= r.answer[0]; grades[q.id] = { status: r.grading_status ?? 'not_requested', score: r.grading_score, max_score: r.grading_max_score ?? q.score, answer_id: r.id, disagreement: r.grading_disagreement } }
    }
  } catch (e: any) { err.value = e.message }
}
watch(gi, v => { localStorage.setItem(KEY + ':g', String(v)); focusQ.value = null; pop.value = null; scrollTo({ top: 0 }); nextTick(() => document.querySelector('.en .gl.on')?.scrollIntoView({ block: 'nearest', inline: 'center' })) })

const paras = computed<Seg[][]>(() => parseParas(g.value?.passage?.text ?? ''))
const byNum = computed(() => new Map((g.value?.questions ?? []).map(q => [q.number, q])))
const optOf = (q: Q) => q.options?.length ? q.options : g.value?.passage?.options ?? []
const wordOf = (n: number) => { const q = byNum.value.get(n); const k = q && picks[q.id]; return k ? optOf(q!).find(o => o.key === k)?.content ?? k : '' }
const bcls = (n: number) => { const q = byNum.value.get(n); if (!q) return ''; const r = res[q.id]; return [focusQ.value === q.id ? 'cur' : '', r ? (r.ok ? 'ok' : 'bad') : picks[q.id] ? 'f' : ''] }
function jump(n: number) {
  const q = byNum.value.get(n); if (!q) return
  focusQ.value = q.id
  document.getElementById('q-' + q.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function pick(q: Q, k: string) { if (res[q.id]) return; picks[q.id] = k; focusQ.value = q.id }

// 完形：点原文的空位，就地弹出四个选项；选完自动跳到下一个没填的空
const ptextEl = ref<HTMLElement>(), pop = ref<{ n: number; x: number; y: number } | null>(null)
function openPop(n: number) {
  const q = byNum.value.get(n), box = ptextEl.value
  const el = box?.querySelector<HTMLElement>(`.bl[data-n="${n}"]`)
  if (!q || !box || !el || res[q.id] || !q.options?.length) { pop.value = null; jump(n); return }
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect()
  const w = Math.min(280, box.clientWidth)
  pop.value = { n, x: Math.max(0, Math.min(r.left - b.left + box.scrollLeft, box.clientWidth - w)), y: r.bottom - b.top + box.scrollTop + 6 }
  focusQ.value = q.id
  // 弹层要整个看得见：原文框自己能滚就滚原文框，否则滚页面
  nextTick(() => box.querySelector('.cpop')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
function popPick(k: string) {
  const n = pop.value?.n; const q = n != null ? byNum.value.get(n) : undefined; if (!q) return
  pick(q, k)
  const nx = [...byNum.value.values()].filter(x => x.number > q.number && isObj(x) && !picks[x.id] && !res[x.id]).sort((a, b) => a.number - b.number)[0]
  if (nx && g.value?.section === 'use_of_english') nextTick(() => openPop(nx.number))
  else pop.value = null
}
function tapBlank(n: number) { if (pop.value?.n === n) { pop.value = null; return } g.value?.section === 'use_of_english' ? openPop(n) : jump(n) }
function onKey(e: KeyboardEvent) {
  if (!pop.value) return
  if (e.key === 'Escape') pop.value = null
  const k = e.key.toUpperCase(); if (/^[A-D]$/.test(k) && !(e.target as HTMLElement)?.closest('textarea,input')) { e.preventDefault(); popPick(k) }
}
function onDoc(e: Event) { const t = e.target as HTMLElement; if (pop.value && !t.closest('.cpop,.bl')) pop.value = null }
onMounted(() => { addEventListener('keydown', onKey); document.addEventListener('pointerdown', onDoc) })
onUnmounted(() => { removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDoc) })
// 新题型：选项原文放在作答区上方，点选项也能直接填给当前这道题
const isMatchG = computed(() => (g.value?.questions ?? []).some(q => q.type === 'match'))
const optText = (q: Q, k?: string) => k ? optOf(q).find(o => o.key === k)?.content ?? '' : ''
function assign(k: string) {
  const qs = (g.value?.questions ?? []).filter(q => q.type === 'match')
  const q = qs.find(x => x.id === focusQ.value && !res[x.id]) ?? qs.find(x => !picks[x.id] && !res[x.id])
  if (!q) { toast('先点一道题，再选句子'); return }
  pick(q, k)
  const nx = qs.find(x => !picks[x.id] && !res[x.id]); if (nx) focusQ.value = nx.id
}
const objQs = computed(() => (g.value?.questions ?? []).filter(isObj))
const toCheck = computed(() => objQs.value.filter(q => picks[q.id] && !res[q.id]))
const checking = ref(false)
async function checkAll() {
  if (!toCheck.value.length || checking.value) return
  checking.value = true
  const items = toCheck.value.map(q => ({ question_id: q.id, answer: [picks[q.id]], client_id: uid() }))
  try {
    const r = await api<{ items: any[] }>('/answers', { method: 'POST', body: JSON.stringify({ items }) })
    for (const x of r.items ?? []) res[x.question_id] = { ok: x.is_correct, correct: x.correct_answer ?? [] }
    const bad = (r.items ?? []).filter(x => x.is_correct === false).length
    toast(bad ? `错了 ${bad} 道，已经进错题本` : '这组全对')
  } catch (e: any) { toast('没交上去：' + e.message) } finally { checking.value = false }
}
const score = computed(() => { const qs = objQs.value.filter(q => res[q.id]); return { n: qs.length, ok: qs.filter(q => res[q.id].ok).length } })

// 翻译 / 作文
let draftT = 0
function typed() { clearTimeout(draftT); draftT = window.setTimeout(() => localStorage.setItem(KEY + ':draft', JSON.stringify(texts)), 400) }
const words = (s = '') => (s.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length
const need = (q: Q) => q.section === 'writing_a' ? '约 100 词' : q.section === 'writing_b' ? '160–200 词' : ''
async function grade(q: Q) {
  const t = texts[q.id]?.trim(); if (!t) { toast('先写点再交'); return }
  const cur = grades[q.id]; if (cur?.loading) return
  grades[q.id] = { ...(cur ?? { status: 'pending', score: null, max_score: q.score }), loading: true }
  try {
    const a = await api<{ id: string }>('/answers', { method: 'POST', body: JSON.stringify({ question_id: q.id, answer: [t], client_id: uid() }) })
    const r = await api<Grade>(`/answers/${a.id}/grade`, { method: 'POST', body: '{}' })
    grades[q.id] = { ...r, answer_id: a.id }
    if (r.status === 'pending') toast('作答存好了，批改还在生成')
  } catch (e: any) { toast('没交上去：' + e.message); if (cur) grades[q.id] = cur; else delete grades[q.id] }
}
async function refresh(q: Q) {
  const cur = grades[q.id]; if (!cur?.answer_id || cur.loading) return
  cur.loading = true
  try { grades[q.id] = { ...(await api<Grade>(`/answers/${cur.answer_id}/grade`, { method: 'POST', body: '{}' })), answer_id: cur.answer_id } }
  catch (e: any) { toast(e.message); cur.loading = false }
}
// 打开时把「生成中」和只存了作答的那几条拉一下最新结果
watch(g, x => { for (const q of x?.questions ?? []) { const c = grades[q.id]; if (c?.answer_id && c.status !== 'done' && !c.result) api<Grade>(`/answers/${c.answer_id}/grade`).then(r => { grades[q.id] = { ...r, answer_id: c.answer_id } }).catch(() => {}) } }, { immediate: false })
const ERR: Record<string, string> = { spelling: '拼写', grammar: '语法', word_choice: '用词', mistranslation: '误译', omission: '漏译', format: '格式', punctuation: '标点', collocation: '搭配' }
</script>

<template>
  <div class="page en">
    <main class="main">
      <p v-if="err" class="sub">{{ err }}</p>
      <template v-else-if="g">
        <div class="meta">{{ year }} · 英语一 · {{ g.section_name }}<template v-if="g.passage && g.section === 'reading_a'"> · {{ g.passage.title }}</template> · 第 {{ nums(g) }} 题
          <span v-if="g.questions.some(q => q.review?.status && q.review.status !== 'confirmed')" class="pendtag">还在核对</span></div>
        <div class="enwrap" :class="{ two: !!g.passage && !isWrite(g.questions[0]) }">
          <section v-if="g.passage" ref="ptextEl" class="ptext" :class="{ fold: !showText }">
            <div class="phead"><b>{{ g.passage.title }}</b><span class="link sm tgl" @click="showText = !showText">{{ showText ? '收起原文' : '展开原文' }}</span></div>
            <template v-if="showText">
              <p v-if="g.passage.directions" class="dir">{{ g.passage.directions }}</p>
              <p v-for="(p, i) in paras" :key="i" class="para"><template v-for="(s, j) in p" :key="j">
                <span v-if="s.t === 'x'">{{ s.v }}</span><br v-else-if="s.t === 'br'" />
                <span v-else-if="s.t === 'blank'" class="bl tap" :data-n="s.n" :class="[bcls(s.n), { open: pop?.n === s.n }]" @click="tapBlank(s.n)"><i>{{ s.n }}</i>{{ wordOf(s.n) || '　　　' }}</span>
                <span v-else-if="s.t === 'u'" class="ul tap" :class="{ cur: focusQ === byNum.get(s.n)?.id }" @click="jump(s.n)"><i>{{ s.n }}</i>{{ s.v }}</span>
              </template></p>
              <div v-if="pop && byNum.get(pop.n)" class="cpop" :style="{ left: pop.x + 'px', top: pop.y + 'px' }">
                <div class="cph">第 {{ pop.n }} 空<span class="link sm" @click="pop = null">关闭</span></div>
                <div v-for="o in byNum.get(pop.n)!.options" :key="o.key" class="co" :class="{ on: picks[byNum.get(pop.n)!.id] === o.key }" @click="popPick(o.key)"><b>{{ o.key }}</b>{{ o.content }}</div>
              </div>
              <div v-if="g.passage.options?.length && !isMatchG" class="popts"><div v-for="o in g.passage.options" :key="o.key" class="po"><b>{{ o.key }}</b>{{ o.content }}</div></div>
            </template>
          </section>

          <section class="qs">
            <div v-if="isMatchG && g.passage?.options?.length" class="mopts" :class="{ fold: mfold }">
              <div class="mh">选项<small>先点题号，再点句子；也可以直接点下面的字母</small><span class="link sm" @click="mfold = !mfold">{{ mfold ? '展开' : '收起' }}</span></div>
              <div v-for="o in g.passage.options" :key="o.key" class="mo" :class="{ used: g.questions.some(q => picks[q.id] === o.key) }" @click="assign(o.key)"><b>{{ o.key }}</b><span>{{ o.content }}</span></div>
            </div>
            <div v-for="q in g.questions" :id="'q-' + q.id" :key="q.id" class="eq" :class="{ cur: focusQ === q.id, cloze: g.section === 'use_of_english' }">
              <!-- 客观题 -->
              <template v-if="isObj(q)">
                <div class="qn" @click="q.type === 'match' && (focusQ = q.id)"><b>{{ q.number }}</b><span v-if="g.section !== 'use_of_english' && q.type !== 'match'" class="st">{{ q.stem }}</span>
                  <span v-else-if="q.type === 'match'" class="st">{{ q.stem.split('\n')[0] }}</span></div>
                <div v-if="q.type === 'match'" class="mk">
                  <span v-for="o in optOf(q)" :key="o.key" class="chip" :class="{ on: picks[q.id] === o.key, ok: res[q.id]?.correct.includes(o.key), bad: res[q.id] && !res[q.id].ok && picks[q.id] === o.key }" @click="pick(q, o.key)">{{ o.key }}</span></div>
                <div v-else class="eo" :class="{ row: g.section === 'use_of_english' }">
                  <div v-for="o in q.options" :key="o.key" class="o" :class="{ sel: picks[q.id] === o.key, ok: res[q.id]?.correct.includes(o.key), bad: res[q.id] && !res[q.id].ok && picks[q.id] === o.key }" @click="pick(q, o.key)"><span class="l">{{ o.key }}</span><span>{{ o.content }}</span></div></div>
                <p v-if="q.type === 'match' && picks[q.id]" class="mpick"><b>{{ picks[q.id] }}</b>{{ optText(q, picks[q.id]) }}</p>
                <Errata v-if="res[q.id]" :list="q.errata" />
              </template>
              <!-- 翻译 / 作文 -->
              <template v-else>
                <div class="qn"><b>{{ q.number }}</b><span class="st">{{ q.section === 'translation' ? '把划线句译成中文' : (q.section === 'writing_a' ? '小作文' : '大作文') }} · {{ q.score }} 分<template v-if="need(q)"> · {{ need(q) }}</template></span></div>
                <p v-if="q.section === 'translation'" class="src tap" @click="jump(q.number)">{{ q.stem }}</p>
                <div v-else class="prompt" v-html="renderStem(q.stem, q.tables, undefined, true)"></div>
                <figure v-for="(src, i) in q.images ?? []" :key="src" class="fig"><img :src="(q.asset_base ?? '/api/v1/assets/') + src" :alt="`第 ${q.number} 题配图 ${i + 1}`" loading="lazy" /></figure>
                <textarea v-model="texts[q.id]" :rows="q.section === 'translation' ? 3 : 12" :placeholder="q.section === 'translation' ? '写下你的译文' : 'Write your essay here…'" @input="typed"></textarea>
                <div class="wbar"><span v-if="q.section !== 'translation'" class="wc" :class="{ low: words(texts[q.id]) < (q.section === 'writing_a' ? 80 : 140) }">{{ words(texts[q.id]) }} 词</span>
                  <span class="link sm" @click="showRef[q.id] = !showRef[q.id]">{{ showRef[q.id] ? '收起' : q.section === 'translation' ? '参考译文' : '参考范文' }}</span>
                  <span class="next" :class="{ dim: !texts[q.id]?.trim() || grades[q.id]?.loading }" @click="grade(q)">{{ grades[q.id]?.loading ? '正在交…' : grades[q.id] ? '改好了，重新批改' : '交给 AI 批改' }}</span></div>
                <p v-if="showRef[q.id]" class="ref">{{ (q as any).reference_answer ?? q.answer?.[0] ?? '还没有参考答案' }}<small>参考答案不是唯一标准，意思对、表达通顺就能得分</small></p>
                <!-- 批改 -->
                <div v-if="grades[q.id] && !grades[q.id].loading" class="grade">
                  <template v-if="grades[q.id].status === 'done'">
                    <div class="gs"><b>{{ grades[q.id].score }}</b><small> / {{ grades[q.id].max_score }}</small><span v-if="grades[q.id].band_name" class="band">{{ grades[q.id].band_name }}</span>
                      <span v-if="grades[q.id].disagreement || grades[q.id].needs_review" class="pendtag">批改待核对</span></div>
                    <p v-if="grades[q.id].result?.band_reason" class="sub sm">{{ grades[q.id].result!.band_reason }}</p>
                    <p v-if="grades[q.id].result?.points_hit?.length" class="pts"><span class="k">译到了</span>{{ grades[q.id].result!.points_hit!.join('；') }}</p>
                    <p v-if="grades[q.id].result?.points_missed?.length" class="pts miss"><span class="k">{{ q.section === 'translation' ? '漏了' : '没写到' }}</span>{{ grades[q.id].result!.points_missed!.join('；') }}</p>
                    <div v-if="grades[q.id].result?.errors?.length" class="errs"><div v-for="(e, i) in grades[q.id].result!.errors" :key="i" class="er"><s>{{ e.span }}</s><span class="to">{{ e.fix }}</span><span class="ty">{{ ERR[e.type] ?? e.type }}</span></div></div>
                    <p v-for="(s, i) in grades[q.id].result?.suggestions ?? []" :key="i" class="sug">{{ s }}</p>
                  </template>
                  <div v-else-if="grades[q.id].status === 'pending'" class="gpend"><span class="dot"></span>批改生成中。你的{{ q.section === 'translation' ? '译文' : '作文' }}已经存好，出分后这里会显示得分点和改错；先看看参考答案对照一下。
                    <span class="link sm" @click="refresh(q)">再看一下</span></div>
                  <div v-else-if="grades[q.id].status === 'failed' || grades[q.id].status === 'error'" class="gpend">这次没批成，<span class="link sm" @click="refresh(q)">重试</span></div>
                  <div v-else class="gpend">已经存好，还没批改。<span class="link sm" @click="grade(q)">交给 AI 批改</span></div>
                </div>
              </template>
            </div>
            <div v-if="objQs.length" class="acts flat gact">
              <span v-if="score.n" class="sub sm">对了 {{ score.ok }} / {{ score.n }}</span>
              <span v-if="gi < groups.length - 1 && (toCheck.length === 0 && score.n)" class="next" @click="gi++">下一篇</span>
              <span v-else class="next" :class="{ dim: !toCheck.length }" @click="checkAll">{{ checking ? '正在对…' : toCheck.length ? `对答案（${toCheck.length} 道）` : objQs.every(q => res[q.id]) ? '这组对完了' : '选好再对答案' }}</span>
            </div>
            <div v-else-if="gi < groups.length - 1" class="acts flat gact"><span class="link" @click="gi++">下一部分</span></div>
          </section>
        </div>
      </template>
      <p v-else class="sub">加载中…</p>
    </main>
    <aside class="side">
      <div v-if="years.length > 1" class="grp"><div class="cap">年 份</div>
        <div class="cells"><span v-for="y in years" :key="y" class="cell yr" :class="{ f: y === year }" @click="emit('year', y)">{{ y }}</span></div></div>
      <div class="grp"><div class="cap">这 套 卷</div>
        <div class="glist"><div v-for="(x, i) in groups" :key="i" class="gl tap" :class="{ on: i === gi, done: gdone(x) }" @click="gi = i"><span>{{ gname(x) }}</span><small>{{ nums(x) }}</small></div></div></div>
      <p v-if="pending" class="sub sm">有 {{ pending }} 道还在核对，可以先做，题面以后可能会微调。</p>
    </aside>
  </div>
</template>
