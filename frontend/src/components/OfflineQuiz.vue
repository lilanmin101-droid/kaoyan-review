<script setup lang="ts">
// 离线刷题：断网时刷题页改用本机题包；对答案在本地判，作答联网后补传
import { computed, ref, watch } from 'vue'
import { renderStem, renderTex } from '../lib/tex'
import { pack, queue, done, answerLocal, type PQ, type PExp, type Rating } from '../lib/offline'

const qs = computed(() => pack.value?.questions ?? [])
const pmap = computed(() => new Map((pack.value?.passages ?? []).map(p => [p.id, p])))
const IK = 'offline:idx'
const idx = ref(Math.min(Number(localStorage.getItem(IK) ?? 0), Math.max(0, qs.value.length - 1)))
watch(idx, v => localStorage.setItem(IK, String(v)))
const q = computed<PQ | undefined>(() => qs.value[idx.value])
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
const RT: Record<Rating, string> = { full: '全对', approach_ok_calc_wrong: '思路对，算错了', no_idea: '没思路' }
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
  setTimeout(() => document.querySelector('.offq .offv')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
}
const res = computed(() => q.value ? done.value[q.value.id] : undefined)
const doneN = computed(() => qs.value.filter(x => done.value[x.id]).length)
const rightN = computed(() => qs.value.filter(x => done.value[x.id]?.ok).length)
const label = (x: PQ) => x.origin === 'wrong_redo' || x.origin === 'wrong' ? '错题重做' : x.passage_id ? (pmap.value.get(x.passage_id)?.title ?? '阅读') : '今日题'
const ans = (x: PQ) => (x.answer ?? []).join('、')
</script>
<template>
  <main class="main offq">
    <div class="cap">离 线 题 包 · {{ pack?.study_date ?? '' }}<span class="cd">做了 {{ doneN }} / {{ qs.length }}<template v-if="queue.length"> · {{ queue.length }} 道等联网补传</template></span></div>
    <p class="sub hint">没网也能做：今天任务里的阅读、完形，加 10 道错题重做。答案在本机判，联网后自动补传。</p>
    <template v-if="q">
      <div class="meta">{{ label(q) }} · 第 {{ q.number ?? idx + 1 }} 题<template v-if="q.year"> · {{ q.year }}</template></div>
      <section v-if="passage" class="ptext" :class="{ fold: !showText }">
        <div class="ph"><b>{{ passage.title ?? '原文' }}</b><span class="link" @click="showText = !showText">{{ showText ? '收起原文' : '展开原文' }}</span></div>
        <div v-if="showText" class="pt">{{ passage.text.replace(/\{\{(\d+)\}\}/g, '（$1）____') }}</div>
      </section>
      <div class="q" v-html="renderStem(q.stem, q.tables as any)"></div>
      <div v-if="isChoice(q)" class="opts">
        <div v-for="o in opts(q)" :key="o.key" class="op" :class="{ sel: (res?.answer ?? pick).includes(o.key), ok: res && q.answer?.includes(o.key), bad: res && res.answer.includes(o.key) && !q.answer?.includes(o.key) }" @click="toggle(o.key)">
          <span class="l">{{ o.key }}</span><span v-html="renderTex(o.content)"></span>
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
          <p class="ref">参考答案</p><div class="refa" v-html="renderTex(refAns(q))"></div>
        </template>
        <p v-else-if="res?.ok === true" class="good">对了</p>
        <p v-else-if="res?.ok === false" class="wrong">错了，正确答案 {{ ans(q) }}</p>
        <p v-else class="ref">参考答案 <span v-html="renderTex(ans(q))"></span></p>
        <p v-if="q.explanation_status === 'pending'" class="sub">讲解还没出</p>
        <div v-else-if="exp(q)?.steps?.length" class="zhu offexp">
          <p v-if="exp(q)!.source_label" class="src">{{ exp(q)!.source_label }}</p>
          <div v-for="(st, i) in exp(q)!.steps" :key="i" class="step" v-html="renderTex(st.text)"></div>
        </div>
        <div v-else-if="q.solution || (typeof q.explanation === 'string' && q.explanation)" class="zhu" v-html="renderTex((q.solution || q.explanation) as string)"></div>
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
