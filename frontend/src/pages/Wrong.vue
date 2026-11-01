<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Errata, { type Erratum } from '../components/Errata.vue'
import { api, download, sse } from '../lib/api'
import { renderTex } from '../lib/tex'
import { toast } from '../lib/toast'
type Opt = { key: string; content: string }
type Sub = { number: number; stem: string; answer?: string[] }
type Full = { id: string; stem: string; options: Opt[]; answer?: string[]; images?: string[]; asset_base?: string; sub_questions?: Sub[]; solution?: string | null }
type W = { errata?: Erratum[] | null; id: string; question_id: string; number: number; year: number; exam: string; type: string; stem: string; options: Opt[]; answer?: string[];
  wrong_count: number; error_type: string | null; last_wrong_at: string; asset_base?: string; images?: string[]; sub_questions?: Sub[]; solution?: string | null }
const items = ref<W[]>([]), mine = ref<Record<string, string[]>>({}), fixed = ref<Record<string, boolean>>({})
const showMastered = ref(false), mastered = ref<W[]>([])
const open = ref<Record<string, boolean>>({}), loaded = ref(false), err = ref(''), busy = ref(false)
const types: Record<string, string> = { concept: '概念', calc: '计算', careless: '粗心', reading: '审题', method: '方法' }
onMounted(async () => {
  try {
    const [w, m] = await Promise.all([api<{ items: W[] }>('/wrong-questions?page_size=100'), api<{ items: W[] }>('/wrong-questions?status=mastered&page_size=100')])
    items.value = w.items; mastered.value = m.items
    // 读回我当时答错的答案；最后一次错之后重做对了（或自评全对）的标出来
    const ans = await api<{ items: { question_id: string; answer: string[] | null; is_correct: boolean | null; self_rating?: string | null; answered_at: string }[] }>('/answers?limit=500')
    const seen: Record<string, string> = {}
    for (const a of ans.items) if (a.is_correct === false && a.answer?.length && (!seen[a.question_id] || a.answered_at > seen[a.question_id])) { seen[a.question_id] = a.answered_at; mine.value[a.question_id] = a.answer }
    const last: Record<string, { at: string; ok: boolean }> = {}
    for (const a of ans.items) {
      const ok = a.is_correct === true || a.self_rating === 'full', bad = a.is_correct === false || a.self_rating === 'no_idea' || a.self_rating === 'approach_ok_calc_wrong'
      if ((ok || bad) && (!last[a.question_id] || a.answered_at > last[a.question_id].at)) last[a.question_id] = { at: a.answered_at, ok }
    }
    for (const x of items.value) if (last[x.question_id]?.ok && last[x.question_id].at > x.last_wrong_at) fixed.value[x.id] = true
  } catch (e: any) { err.value = e.message } finally { loaded.value = true }
})
const q = (w: W): Full => ({ id: w.question_id, stem: w.stem, options: w.options ?? [], answer: w.answer, images: w.images, asset_base: w.asset_base, sub_questions: w.sub_questions, solution: w.solution })
async function setType(w: W, t: string) {
  const old = w.error_type; w.error_type = t
  try { await api(`/wrong-questions/${w.id}`, { method: 'PATCH', body: JSON.stringify({ error_type: t }) }) } catch (e: any) { w.error_type = old; toast('没改成：' + e.message) }
}
// 掌握了就移出错题本（status=mastered），在「已掌握」里还能放回来
// 先在页面上挪过去，请求失败再挪回来，免得点了像没反应
async function setStatus(w: W, status: 'mastered' | 'active') {
  const [from, to] = status === 'mastered' ? [items, mastered] : [mastered, items]
  if (!from.value.some(x => x.id === w.id)) return
  from.value = from.value.filter(x => x.id !== w.id); to.value = [w, ...to.value]
  toast(status === 'mastered' ? '已移到「已掌握」' : '已放回错题本')
  try { await api(`/wrong-questions/${w.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }) }
  catch (e: any) { to.value = to.value.filter(x => x.id !== w.id); from.value = [w, ...from.value]; toast('没改成：' + e.message) }
}
async function exportPdf() {
  busy.value = true
  try { await download('/wrong-questions/export.pdf', `错题本-${new Date().toLocaleDateString('en-CA')}.pdf`); toast('错题本 PDF 已下载') }
  catch (e: any) { toast(e.message) } finally { busy.value = false }
}
const exps = ref<Record<string, { steps: { n: number; text: string }[]; label: string | null; pending: string | null; loading: boolean }>>({})
async function explain(w: W) {
  if (exps.value[w.id]) { delete exps.value[w.id]; return }
  exps.value[w.id] = { steps: [], label: null, pending: null, loading: true }; const ex = exps.value[w.id]
  try {
    await sse(`/questions/${w.question_id}/explain`, {}, ev => {
      if (ev.type === 'step') ex.steps.push({ n: ev.n, text: ev.text })
      if (ev.type === 'done') {
        ex.loading = false
        ex.label = ev.source_label ? ev.source_label + (ev.source === 'expert' && ev.verified != null ? (ev.verified ? ' · 已核对' : ' · 待核对') : '') : null
        if (ev.source === 'pending') ex.pending = ev.text || '讲解生成中'
      }
    })
  } catch (e: any) { ex.pending = '讲解没拿到：' + e.message } finally { ex.loading = false }
}
const examName: Record<string, string> = { math1: '数学一', english1: '英语一' }
const isChoice = (w: W) => w.type.includes('choice')
</script>
<template>
  <div class="page col">
    <main class="main">
      <div class="bar"><div class="cap">错 题 本 · {{ items.length }} 道</div>
        <span v-if="items.length && !showMastered" class="link" @click="!busy && exportPdf()">{{ busy ? '正在生成…' : '导出 PDF' }}</span></div>
      <p v-if="err" class="sub">{{ err }}</p>
      <p v-else-if="loaded && !items.length" class="sub">还没有错题。刷题时答错的题会自动记到这里。</p>
      <template v-for="sec in (showMastered && mastered.length ? [items, mastered] : [items])">
      <div v-if="sec === mastered" class="fold-h">已 掌 握 · {{ mastered.length }} 道　<span class="sub">到期会再出一次，做对归档，做错退回错题本</span></div>
      <div v-for="w in sec" :key="w.id" class="wq" :class="{ ms: sec === mastered }">
        <div class="meta">{{ w.year }} · {{ examName[w.exam] ?? w.exam }} · 第 {{ w.number }} 题 · 错过 {{ w.wrong_count }} 次<span v-if="sec === mastered" class="fixed">已掌握</span><span v-else-if="fixed[w.id]" class="fixed">后来做对了</span></div>
        <div class="q sm" v-html="renderTex(q(w).stem)"></div>
        <figure v-for="src in q(w).images ?? []" :key="src" class="fig sm"><img :src="(q(w).asset_base ?? w.asset_base ?? '/api/v1/assets/') + src" :alt="`第 ${w.number} 题配图`" loading="lazy" /></figure>
        <div v-if="isChoice(w) && q(w).options.length" class="opts sm">
          <div v-for="o in q(w).options" :key="o.key" class="o" :class="{ ok: open[w.id] && q(w).answer?.includes(o.key), bad: mine[w.question_id]?.includes(o.key) }">
            <span class="l">{{ o.key }}</span><span v-html="renderTex(o.content)"></span>
            <span v-if="open[w.id] && q(w).answer?.includes(o.key)" class="tick">✓</span>
            <span v-else-if="mine[w.question_id]?.includes(o.key)" class="mark">你当时选的</span>
          </div>
        </div>
        <p v-else-if="mine[w.question_id]" class="sub">你当时填的：<span v-html="renderTex(mine[w.question_id].join('，'))"></span></p>
        <div v-if="open[w.id]" class="zhu">
          <template v-if="!isChoice(w)">
            <template v-if="q(w).sub_questions?.some(s => s.answer?.length)"><div v-for="s in q(w).sub_questions" :key="s.number"><b>（{{ s.number }}）</b><span v-html="renderTex((s.answer ?? []).join(''))"></span></div></template>
            <div v-else-if="q(w).answer?.length">正确答案 <span v-html="renderTex((q(w).answer ?? []).join('，'))"></span></div>
          </template>
          <div v-if="q(w).solution" v-html="renderTex(q(w).solution!)"></div>
        </div>
        <div v-if="exps[w.id]" class="note flat">
          <p v-if="exps[w.id].label" class="src">{{ exps[w.id].label }}</p>
          <Errata :list="w.errata" />
          <p v-if="exps[w.id].pending" class="pend">{{ exps[w.id].pending }}</p>
          <p v-for="s in exps[w.id].steps" :key="s.n"><b>{{ s.n }}</b>　<span v-html="renderTex(s.text)"></span></p>
          <p v-if="exps[w.id].loading" class="pend">正在讲…</p>
        </div>
        <div class="etype"><span class="link" @click="open[w.id] = !open[w.id]">{{ open[w.id] ? '收起答案' : '看答案' }}</span>
          <span class="link" @click="explain(w)">{{ exps[w.id] ? '收起讲解' : '看讲解' }}</span>
          <span v-if="sec === mastered" class="link" @click="setStatus(w, 'active')">放回错题本</span>
          <span v-else class="link" :class="{ hi: fixed[w.id] }" @click="setStatus(w, 'mastered')">已掌握，移出</span>
          <span class="k">错因</span>
          <span v-for="(t, k) in types" :key="k" class="chip" :class="{ on: w.error_type === k }" @click="setType(w, k)">{{ t }}</span></div>
      </div>
      </template>
      <div v-if="mastered.length" class="fold" @click="showMastered = !showMastered">{{ showMastered ? '收起已掌握的题' : `已掌握 ${mastered.length} 道，展开看看` }}</div>
    </main>
  </div>
</template>
