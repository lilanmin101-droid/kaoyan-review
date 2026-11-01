<script setup lang="ts">
// 考场里的英语一：一屏一篇（完形 / 一篇阅读 / 新题型 / 翻译 / 两篇作文），左边原文、右边作答
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { parseParas, enWords } from '../lib/passage'
import { renderStem, type StemTable } from '../lib/tex'

type Opt = { key: string; content: string }
export type EnQ = { id: string; number: number; type: string; section?: string; stem: string; score: number; options: Opt[]; images?: string[]; asset_base?: string; tables?: StemTable[] | null }
export type EnGroup = { passage_id: string | null; section: string; section_name: string; passage: { title: string; directions?: string; text: string; options?: Opt[] } | null; questions: EnQ[] }
const props = defineProps<{ g: EnGroup; answers: Record<string, { answer?: string[]; flagged?: boolean }>; focus: string | null }>()
const emit = defineEmits<{ pick: [EnQ, string]; typed: [EnQ, string]; focus: [string]; flag: [EnQ] }>()

const paras = computed(() => parseParas(props.g.passage?.text ?? ''))
const byNum = computed(() => new Map(props.g.questions.map(q => [q.number, q])))
const ans = (q?: EnQ) => q ? props.answers[q.id]?.answer?.[0] ?? '' : ''
const optOf = (q: EnQ) => q.options?.length ? q.options : props.g.passage?.options ?? []
const wordOf = (n: number) => { const q = byNum.value.get(n); const k = ans(q); return k && q ? optOf(q).find(o => o.key === k)?.content ?? k : '' }
const isWrite = computed(() => ['translation', 'writing_a', 'writing_b'].includes(props.g.section))
const isMatch = computed(() => props.g.questions.some(q => q.type === 'match'))
const cloze = computed(() => props.g.section === 'use_of_english')
// 自己点出来的焦点不再滚动（不然在原文里选完空，页面会被拽到右栏题目那边）
const mfold = ref(matchMedia('(max-width:760px)').matches) // 手机上默认收成一行一句，吸顶不占太多屏
let own: string | null = null
const setFocus = (id: string) => { own = id; emit('focus', id) }
function jump(n: number) {
  const q = byNum.value.get(n); if (!q) return
  setFocus(q.id)
  document.getElementById('eq-' + q.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
// 答题卡点进来的题：滚到眼前
watch(() => props.focus, id => { if (id === own) return; own = null; if (id) nextTick(() => document.getElementById('eq-' + id)?.scrollIntoView({ block: 'center' })) }, { immediate: true })
function assign(k: string) {
  const qs = props.g.questions.filter(q => q.type === 'match')
  const q = qs.find(x => x.id === props.focus) ?? qs.find(x => !ans(x)); if (!q) return
  emit('pick', q, k)
  const nx = qs.find(x => x.id !== q.id && !ans(x)); if (nx) setFocus(nx.id)
}
// 完形：点原文空位就地弹四个选项，A–D 键也能选，选完跳到下一个没填的空
const ptextEl = ref<HTMLElement>(), pop = ref<{ n: number; x: number; y: number } | null>(null)
function openPop(n: number) {
  const q = byNum.value.get(n), box = ptextEl.value
  const el = box?.querySelector<HTMLElement>(`.bl[data-n="${n}"]`)
  if (!q || !box || !el || !q.options?.length) { pop.value = null; jump(n); return }
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), w = Math.min(280, box.clientWidth)
  pop.value = { n, x: Math.max(0, Math.min(r.left - b.left + box.scrollLeft, box.clientWidth - w)), y: r.bottom - b.top + box.scrollTop + 6 }
  setFocus(q.id)
  nextTick(() => box.querySelector('.cpop')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
function popPick(k: string) {
  const n = pop.value?.n; const q = n != null ? byNum.value.get(n) : undefined; if (!q) return
  emit('pick', q, k)
  const nx = props.g.questions.filter(x => x.number > q.number && !ans(x)).sort((a, b) => a.number - b.number)[0]
  if (nx) nextTick(() => openPop(nx.number)); else pop.value = null
}
function tapBlank(n: number) { if (pop.value?.n === n) { pop.value = null; return } cloze.value ? openPop(n) : jump(n) }
function onKey(e: KeyboardEvent) {
  if (!pop.value) return
  if (e.key === 'Escape') pop.value = null
  const k = e.key.toUpperCase(); if (/^[A-D]$/.test(k) && !(e.target as HTMLElement)?.closest('textarea,input')) { e.preventDefault(); popPick(k) }
}
function onDoc(e: Event) { const t = e.target as HTMLElement; if (pop.value && !t.closest('.cpop,.bl')) pop.value = null }
onMounted(() => { addEventListener('keydown', onKey); document.addEventListener('pointerdown', onDoc) })
onUnmounted(() => { removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDoc) })
watch(() => props.g, () => { pop.value = null })
const need = (s?: string) => s === 'writing_a' ? '约 100 词' : s === 'writing_b' ? '160–200 词' : ''
const sec = (q: EnQ) => q.section ?? props.g.section
</script>

<template>
  <div class="en enx">
    <div class="meta">{{ g.section_name }}<template v-if="g.passage && g.section === 'reading_a'"> · {{ g.passage.title }}</template></div>
    <div class="enwrap" :class="{ two: !!g.passage && !['writing_a', 'writing_b'].includes(g.section) }">
      <section v-if="g.passage" ref="ptextEl" class="ptext">
        <p v-if="g.passage.directions" class="dir">{{ g.passage.directions }}</p>
        <p v-for="(p, i) in paras" :key="i" class="para"><template v-for="(s, j) in p" :key="j">
          <span v-if="s.t === 'x'">{{ s.v }}</span><br v-else-if="s.t === 'br'" />
          <span v-else-if="s.t === 'blank'" class="bl tap" :data-n="s.n" :class="{ f: ans(byNum.get(s.n)), cur: focus === byNum.get(s.n)?.id, open: pop?.n === s.n }" @click="tapBlank(s.n)"><i>{{ s.n }}</i>{{ wordOf(s.n) || '　　　' }}</span>
          <span v-else-if="s.t === 'u'" class="ul tap" :class="{ cur: focus === byNum.get(s.n)?.id }" @click="jump(s.n)"><i>{{ s.n }}</i>{{ s.v }}</span>
        </template></p>
        <div v-if="pop && byNum.get(pop.n)" class="cpop" :style="{ left: pop.x + 'px', top: pop.y + 'px' }">
          <div class="cph">第 {{ pop.n }} 空<span class="link sm" @click="pop = null">关闭</span></div>
          <div v-for="o in byNum.get(pop.n)!.options" :key="o.key" class="co" :class="{ on: ans(byNum.get(pop.n)) === o.key }" @click="popPick(o.key)"><b>{{ o.key }}</b>{{ o.content }}</div>
        </div>
      </section>
      <section class="qs">
        <div v-if="isMatch && g.passage?.options?.length" class="mopts" :class="{ fold: mfold }">
          <div class="mh">选项<small>先点题号，再点句子</small><span class="link sm" @click="mfold = !mfold">{{ mfold ? '展开' : '收起' }}</span></div>
          <div v-for="o in g.passage.options" :key="o.key" class="mo" :class="{ used: g.questions.some(q => ans(q) === o.key) }" @click="assign(o.key)"><b>{{ o.key }}</b><span>{{ o.content }}</span></div>
        </div>
        <div v-for="q in g.questions" :id="'eq-' + q.id" :key="q.id" class="eq" :class="{ cur: focus === q.id, cloze }" @click="setFocus(q.id)">
          <template v-if="!isWrite">
            <div class="qn"><b>{{ q.number }}</b><span v-if="!cloze" class="st">{{ q.type === 'match' ? q.stem.split('\n')[0] : q.stem }}</span>
              <span class="flag" :class="{ on: answers[q.id]?.flagged }" @click.stop="emit('flag', q)">{{ answers[q.id]?.flagged ? '已标记' : '标记' }}</span></div>
            <div v-if="q.type === 'match'" class="mk">
              <span v-for="o in optOf(q)" :key="o.key" class="chip" :class="{ on: ans(q) === o.key }" @click.stop="emit('pick', q, o.key)">{{ o.key }}</span></div>
            <div v-else class="eo" :class="{ row: cloze }">
              <div v-for="o in q.options" :key="o.key" class="o" :class="{ sel: ans(q) === o.key }" @click.stop="emit('pick', q, o.key)"><span class="l">{{ o.key }}</span><span>{{ o.content }}</span></div></div>
            <p v-if="q.type === 'match' && ans(q)" class="mpick"><b>{{ ans(q) }}</b>{{ optOf(q).find(o => o.key === ans(q))?.content }}</p>
          </template>
          <template v-else>
            <div class="qn"><b>{{ q.number }}</b><span class="st">{{ sec(q) === 'translation' ? '把划线句译成中文' : sec(q) === 'writing_a' ? '小作文' : '大作文' }} · {{ q.score }} 分<template v-if="need(sec(q))"> · {{ need(sec(q)) }}</template></span>
              <span class="flag" :class="{ on: answers[q.id]?.flagged }" @click.stop="emit('flag', q)">{{ answers[q.id]?.flagged ? '已标记' : '标记' }}</span></div>
            <p v-if="sec(q) === 'translation'" class="src tap" @click="jump(q.number)">{{ q.stem }}</p>
            <div v-else class="prompt" v-html="renderStem(q.stem, q.tables, undefined, true)"></div>
            <figure v-for="src in q.images ?? []" :key="src" class="fig"><img :src="(q.asset_base ?? '/api/v1/assets/') + src" :alt="`第 ${q.number} 题配图`" /></figure>
            <textarea :value="ans(q)" :rows="sec(q) === 'translation' ? 3 : 12" :placeholder="sec(q) === 'translation' ? '写下你的译文' : 'Write your essay here…'" @input="emit('typed', q, ($event.target as HTMLTextAreaElement).value)"></textarea>
            <div v-if="sec(q) !== 'translation'" class="wbar"><span class="wc" :class="{ low: enWords(ans(q)) < (sec(q) === 'writing_a' ? 80 : 140) }">{{ enWords(ans(q)) }} 词</span></div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
