<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../lib/api'
import { toast } from '../lib/toast'
const emit = defineEmits<{ nav: [string]; passage: [number, string] }>()
// 真题出现情况：「真题出现 7 次 · 2012、2018、2024」，年份多了只列最近 4 个
function seen(w: Word) {
  const ys = [...new Set(w.exam_years ?? [])].sort((a, b) => b - a)
  if (!w.frequency && !ys.length) return ''
  const y = ys.length > 4 ? ys.slice(0, 4).join('、') + ` 等 ${ys.length} 年` : ys.join('、')
  return [w.frequency ? `真题出现 ${w.frequency} 次` : '', y].filter(Boolean).join(' · ')
}
// 例句里把这个词（含 -s/-ed/-ing 等变形）标出来
function mark(sent: string, word: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const stem = word.length > 4 ? word.replace(/(e|y)$/i, '') : word
  const re = new RegExp(`\\b(${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z]*)`, 'gi')
  return esc(sent).replace(re, '<b>$1</b>')
}
const exs = (w: Word) => (w.examples ?? []).filter(e => e?.sentence).slice(0, 2)
type Word = { id: number; word: string; phonetic_us?: string; phonetic_uk?: string; definition_cn: string; pos?: string; audio_us?: string | null; audio_url_us?: string | null; audio_url_uk?: string | null; frequency?: number; exam_years?: number[] | null; examples?: Ex[] | null; source?: string }
type Ex = { sentence: string; year?: number; question_id?: number; passage_id?: string }
const list = ref<Word[]>([]), i = ref(0), show = ref(false), loaded = ref(false), err = ref('')
// 计数口径：分母用后端当天第一次打开时冻结的 scheduled_today，分子 = done_today + 1。
// 今天点过「没记住」的词放在主列表后面再过一遍，不算进分母
type WordR = Word & { relearn?: boolean }
const done = ref(0), total = ref(0)
onMounted(async () => {
  try {
    const r = await api<{ review: Word[]; new: Word[]; relearn?: Word[]; counts?: { done_today?: number; scheduled_today?: number } }>('/words/today')
    list.value = [...r.review, ...r.new, ...(r.relearn ?? []).map(x => ({ ...x, relearn: true }))]
    done.value = r.counts?.done_today ?? 0; total.value = r.counts?.scheduled_today ?? done.value + r.review.length + r.new.length
  } catch (e: any) { err.value = e.message } finally { loaded.value = true }
})
const relearnLeft = computed(() => list.value.slice(i.value).filter(x => (x as WordR).relearn).length)
const w = computed(() => list.value[i.value])
function speak() {
  // 先放真人发音（后端缓存的有道音频），拿不到就用浏览器朗读
  const tts = () => { const u = new SpeechSynthesisUtterance(w.value.word); u.lang = 'en-US'; speechSynthesis.cancel(); speechSynthesis.speak(u) }
  const src = w.value.audio_url_us ?? w.value.audio_url_uk ?? w.value.audio_us
  if (!src) return tts()
  const a = new Audio(src); a.onerror = tts; a.play().catch(tts)
}
// 点了立刻翻到下一个，请求在后台发；失败就退回这个词。正在发的词不会被重复提交
const sending = new Set<number>()
async function rate(r: 'again' | 'good' | 'easy') {
  const cur = w.value, at = i.value; if (!cur || sending.has(cur.id)) return
  const main = !(cur as WordR).relearn
  sending.add(cur.id); if (main) done.value++; show.value = false; i.value++
  // 没记住的词今天末尾再出一次
  const requeued = r === 'again' && !list.value.slice(i.value).some(x => x.id === cur.id)
  if (requeued) list.value.push({ ...cur, relearn: true } as WordR)
  try { await api(`/words/${cur.id}/review`, { method: 'POST', body: JSON.stringify({ rating: r }) }) }
  catch (e: any) { toast('没记上：' + e.message); if (main) done.value--; i.value = at; if (requeued) list.value.pop() }
  finally { sending.delete(cur.id) }
}
</script>
<template>
  <div class="page col">
    <main class="main words">
      <div class="cap">单 词 · {{ !w ? `今日 ${done} / ${total}` : (w as WordR).relearn ? `再过一遍没记住的 · 还剩 ${relearnLeft}` : `今日第 ${Math.min(done + 1, total)} / ${total}` }}</div>
      <p v-if="err" class="sub">{{ err }}</p>
      <p v-else-if="loaded && !w" class="sub">今天的单词背完了。</p>
      <template v-else-if="w">
        <div class="word" @click="speak">{{ w.word }}</div>
        <div class="ph" @click="speak">{{ w.phonetic_us ?? w.phonetic_uk }}　<span class="link">发音</span></div>
        <div v-if="seen(w)" class="seen">{{ seen(w) }}</div>
        <div v-if="show" class="def">{{ /^\s*[a-z]+\.\s/.test(w.definition_cn ?? '') ? w.definition_cn : `${w.pos ?? ''} ${w.definition_cn ?? ''}` }}</div>
        <ul v-if="show && exs(w).length" class="wex">
          <li v-for="(e, k) in exs(w)" :key="k"><span v-html="mark(e.sentence, w.word)"></span><span class="src">{{ e.year ? e.year + ' 真题' : '真题' }}<a v-if="e.passage_id && e.year" class="link" @click="emit('passage', e.year, e.passage_id)">看原文</a></span></li>
        </ul>
        <div class="acts flat wacts">
          <template v-if="!show"><span class="link" @click="rate('easy')">认识，跳过</span><span class="next" @click="show = true">看释义</span></template>
          <template v-else><span class="link" @click="rate('again')">没记住</span><span class="next" @click="rate('good')">记住了</span></template>
        </div>
      </template>
    </main>
  </div>
</template>
