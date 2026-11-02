<script setup lang="ts">
// 离线刷题：断网时刷题页改用本机题包；对答案在本地判，作答联网后补传
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { renderStem, renderFor, isEnId } from '../lib/tex'
import { pack, queue, done, answerLocal, offCur, packSummary, isRedo, type PQ, type PExp, type Rating } from '../lib/offline'
import { parseParas } from '../lib/passage'
defineProps<{ back?: boolean }>()
defineEmits<{ leave: [] }>()

const qs = computed(() => pack.value?.questions ?? [])
const pmap = computed(() => new Map((pack.value?.passages ?? []).map(p => [p.id, p])))
const IK = 'offline:idx'
const idx = ref(Math.min(Number(localStorage.getItem(IK) ?? 0), Math.max(0, qs.value.length - 1)))
watch(idx, v => localStorage.setItem(IK, String(v)))
const q = computed<PQ | undefined>(() => qs.value[idx.value])
// 顶栏跟着当前这题走（年份 + 科目），别再显示在线页选的那套卷子
watch(q, x => { offCur.value = x ? { year: x.year, exam: x.exam ?? (x.id.startsWith('english1') ? 'english1' : x.id.startsWith('math1') ? 'math1' : undefined) } : null }, { immediate: true })
onUnmounted(() => { offCur.value = null })
// 离线 F5 后浏览器会恢复到上次的滚动位置（停在题中间），回到顶上让离线状态和进度先露出来
onMounted(() => { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; scrollTo({ top: 0 }) })
onUnmounted(() => { if ('scrollRestoration' in history) history.scrollRestoration = 'auto' })
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// 完形：题干里可能带着同一句的几个空，当前这题问的那个空标出来，别的空淡化
const curN = computed(() => Number(q.value?.number ?? NaN))
const isCloze = computed(() => !!q.value?.passage_id && /cloze/i.test(q.value.passage_id))
function markStem(html: string) {
  if (!isCloze.value || !Number.isFinite(curN.value)) return html
  return html.replace(/[（(](\d+)[）)]\s*_{2,}/g, (m, n) => Number(n) === curN.value ? `<mark class="curb">${m}</mark>` : `<span class="othb">${m}</span>`)
}
// 原文：{{n}} 是完形空位、<u data-q="n"> 是翻译划线句，按段渲染，不把标签原样露出来
const ptextHtml = computed(() => {
  const p = passage.value; if (!p) return ''
  return parseParas(p.text).map(segs => '<p>' + segs.map(g => g.t === 'x' ? esc(g.v) : g.t === 'br' ? '<br>'
    : g.t === 'blank' ? (g.n === curN.value && isCloze.value ? `<mark class="curb">（${g.n}）____</mark>` : `（${g.n}）____`)
    : `<u class="uq${g.n === curN.value ? ' cur' : ''}"><sup>（${g.n}）</sup>${esc(g.v)}</u>`).join('') + '</p>').join('')
})
const passage = computed(() => q.value?.passage_id ? pmap.value.get(q.value.passage_id) : undefined)
const showText = ref(true)
watch(() => q.value?.passage_id, () => { showText.value = true })
const pick = ref<string[]>([]), text = ref('')
let qStart = Date.now()
const revealed = ref(false)
watch(q, () => { pick.value = []; text.value = ''; revealed.value = false; qStart = Date.now() })
const spent = () => (Date.now() - qStart) / 1000
// 主观题（objective:false）：先看参考答案，再自评
const subj = (x?: PQ) => !!x && x.objective === false
const RT_MATH: Record<Rating, string> = { full: '全对', approach_ok_calc_wrong: '思路对，算错了', no_idea: '没思路' }
// 英语主观题（翻译/作文）用考场里同一套说法
const RT_EN: Record<Rating, string> = { full: '基本到位', approach_ok_calc_wrong: '大概一半', no_idea: '没写或偏得多' }
const RT = computed(() => q.value && isEnId(q.value.id) ? RT_EN : RT_MATH)
function rate(r: Rating) { const x = q.value!; if (done.value[x.id]) return; answerLocal(x, [], spent(), { self_rating: r, thought_text: text.value.trim() || undefined }) }
// 讲解：explanation 是对象 {source_label, steps[]}；没有就用 solution 纯文本
const exp = (x: PQ): PExp | null => x.explanation && typeof x.explanation === 'object' ? x.explanation : null
const refAns = (x: PQ) => {
  if (x.sub_questions?.some(s => s.answer?.length)) return x.sub_questions.map((s, i) => `（${s.number ?? i + 1}）${(s.answer ?? []).join('；')}`).join('\n\n')
  const r = x.reference_answer
  if (r) return Array.isArray(r) ? r.join('\n\n') : r
  return (x.answer ?? []).join('、')
}
const isChoice = (x?: PQ) => !!x && x.type.includes('choice')
const multi = (x?: PQ) => !!x && (x.type.includes('multi') || (x.answer?.length ?? 0) > 1)
const opts = (x?: PQ) => x?.options?.length ? x.options : passage.value?.options ?? []
function toggle(k: string) {
  const d = done.value[q.value!.id]; if (d) return
  pick.value = multi(q.value) ? (pick.value.includes(k) ? pick.value.filter(x => x !== k) : [...pick.value, k]) : [k]
}
function check() {
  const x = q.value!; if (done.value[x.id]) return
  if (subj(x)) { revealed.value = true } else answerLocal(x, isChoice(x) ? pick.value : [text.value.trim()], spent())
  // 主观题滚到自评按钮那里（手机上留出底栏的高度，见 .offq .rates 的 scroll-margin）
  setTimeout(() => document.querySelector(subj(x) ? '.offq .rates' : '.offq .offv')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
}
const res = computed(() => q.value ? done.value[q.value.id] : undefined)
const doneN = computed(() => qs.value.filter(x => done.value[x.id]).length)
const rightN = computed(() => qs.value.filter(x => done.value[x.id]?.ok).length)
const cloze = (x: PQ) => !!x.passage_id && /cloze/i.test(x.passage_id)
const label = (x: PQ) => isRedo(x) ? '错题重做' : x.passage_id ? (pmap.value.get(x.passage_id)?.title ?? '阅读') : '今日题'
// 过了 expires_at（学习日的次日 04:00）还在用这包，就提示是昨天的
const now = ref(Date.now()); const tk = setInterval(() => { now.value = Date.now() }, 60000); onUnmounted(() => clearInterval(tk))
const stale = computed(() => { const e = pack.value?.expires_at; return !!e && now.value > Date.parse(e) })
const hint = computed(() => packSummary(pack.value).replace(/[。.；;，,\s]+$/, ''))
// 分组入口：今日题 / 错题重做，点一下直接跳到那组第一道（以前错题重做排在最后，要连点几十次「下一题」）
const groups = computed(() => {
  const g: { k: string; t: string; start: number; n: number; done: number }[] = []
  qs.value.forEach((x, i) => { const k = isRedo(x) ? 'redo' : 'today'; let e = g.find(y => y.k === k); if (!e) g.push(e = { k, t: k === 'redo' ? '错题重做' : '今日题', start: i, n: 0, done: 0 }); e.n++; if (done.value[x.id]) e.done++ })
  return g
})
const curG = computed(() => q.value && isRedo(q.value) ? 'redo' : 'today')
function jump(i: number) { idx.value = i; setTimeout(() => document.querySelector('.offq .meta')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30) }
const ans = (x: PQ) => (x.answer ?? []).join('、')
</script>
<template>
  <main class="main offq">
    <div v-if="back" class="backon"><span>已经联网了，{{ queue.length ? `离线做的 ${queue.length} 道正在补传` : "离线做的题都补传好了" }}</span><span class="link" @click="$emit('leave')">回到在线刷题</span></div>
    <div class="cap">离 线 题 包 · {{ pack?.study_date ?? '' }} <span class="cd">做了 {{ doneN }} / {{ qs.length }}<template v-if="queue.length"> · {{ queue.length }} 道等联网补传</template></span></div>
    <p v-if="stale" class="stale">这是昨天的题包，题照样能做，联网后会换成今天的。</p>
    <p class="sub hint">没网也能做：{{ hint }}。答案在本机判，联网后自动补传。</p>
    <div v-if="groups.length > 1" class="ogrp"><span v-for="g in groups" :key="g.k" class="chip" :class="{ on: curG === g.k }" @click="jump(g.start)">{{ g.t }} {{ g.done }}/{{ g.n }}</span></div>
    <template v-if="q">
      <div class="meta">{{ label(q) }} · 第 {{ q.number ?? idx + 1 }} {{ cloze(q) ? '空' : '题' }}<template v-if="q.year"> · {{ q.year }}</template></div>
      <section v-if="passage" class="ptext" :class="{ fold: !showText }">
        <div class="ph"><b>{{ passage.title ?? '原文' }}</b><span class="link" @click="showText = !showText">{{ showText ? '收起原文' : '展开原文' }}</span></div>
        <div v-if="showText" class="pt" v-html="ptextHtml"></div>
      </section>
      <div class="q" v-html="markStem(renderStem(q.stem, q.tables as any, undefined, isEnId(q.id)))"></div>
      <div v-if="isChoice(q)" class="opts">
        <div v-for="o in opts(q)" :key="o.key" class="op" :class="{ sel: (res?.answer ?? pick).includes(o.key), ok: res && q.answer?.includes(o.key), bad: res && res.answer.includes(o.key) && !q.answer?.includes(o.key) }" @click="toggle(o.key)">
          <span class="l">{{ o.key }}</span><span v-html="renderFor(q!.id, o.content)"></span>
        </div>
      </div>
      <textarea v-else v-model="text" :disabled="!!res || revealed" rows="4" :placeholder="subj(q) ? '先写写思路（可以不写），再看参考答案' : '写下你的答案，再看参考答案'"></textarea>
      <div class="acts flat">
        <span v-if="!res && !revealed" class="next" :class="{ dim: isChoice(q) ? !pick.length : false }" @click="(!isChoice(q) || pick.length) && check()">{{ isChoice(q) ? '对答案' : '看参考答案' }}</span>
        <span v-if="idx > 0" class="link" @click="idx--">上一题</span>
        <span v-if="idx < qs.length - 1" class="link" @click="idx++">下一题</span>
      </div>
      <div v-if="res || revealed" class="verdict offv">
        <template v-if="subj(q)">
          <p class="ref">参考答案</p><div class="refa" v-html="renderFor(q!.id, refAns(q))"></div>
        </template>
        <p v-else-if="res?.ok === true" class="good">对了</p>
        <p v-else-if="res?.ok === false" class="wrong">错了，正确答案 {{ ans(q) }}</p>
        <p v-else class="ref">参考答案 <span v-html="renderFor(q!.id, ans(q))"></span></p>
        <p v-if="q.explanation_status === 'pending'" class="sub">讲解还没出{{ res?.ok === false ? '，先记下这题，联网后在错题本里看' : '' }}</p>
        <div v-else-if="exp(q)?.steps?.length" class="zhu offexp">
          <p v-if="exp(q)!.source_label" class="src">{{ exp(q)!.source_label }}</p>
          <div v-for="(st, i) in exp(q)!.steps" :key="i" class="step" v-html="renderFor(q!.id, st.text)"></div>
        </div>
        <div v-else-if="q.solution || (typeof q.explanation === 'string' && q.explanation)" class="zhu" v-html="renderFor(q!.id, (q.solution || q.explanation) as string)"></div>
        <div v-if="subj(q) && !res" class="rates"><span class="cap sm">对照着自评</span>
          <span v-for="(t, k) in RT" :key="k" class="chip" @click="rate(k as Rating)">{{ t }}</span></div>
        <p v-if="res?.rating" class="sub">自评：{{ RT[res.rating as Rating] }}</p>
        <p v-if="res" class="sub">{{ queue.some(x => x.question_id === q!.id) ? '这题等联网后补传，教练点评到时候再更新' : '已经交上去了' }}</p>
      </div>
    </template>
    <p v-else class="sub">题包是空的。</p>
    <p v-if="doneN" class="sub tally">选择题对了 {{ rightN }} 道</p>
  </main>
</template>
