<script setup lang="ts">
// 模考分数趋势：朱笔描点 + 细线；不计入趋势（non_continuous）的场次画空心点、不连线
import { computed, ref, watch } from 'vue'
type It = { id: string; title: string; exam?: string; kind?: string; status: string; score: number | null; max_score: number; non_continuous?: boolean; counts_in_trend?: boolean; submitted_at?: string; started_at?: string }
const props = defineProps<{ items: It[] }>()
const emit = defineEmits<{ open: [id: string] }>()
const SUBJ: Record<string, string> = { english1: '英语一', english2: '英语二', math1: '数学一', math2: '数学二', math3: '数学三', politics: '政治' }
const done = computed(() => props.items.filter(x => x.status === 'submitted' && x.score != null && (x.kind ?? 'paper') === 'paper')
  .sort((a, b) => Date.parse(a.submitted_at ?? a.started_at ?? '') - Date.parse(b.submitted_at ?? b.started_at ?? '')))
const subjects = computed(() => { const s: string[] = []; for (const x of [...done.value].reverse()) if (x.exam && !s.includes(x.exam)) s.push(x.exam); return s })
const subj = ref('')
watch(subjects, s => { if (!s.includes(subj.value)) subj.value = s[0] ?? '' }, { immediate: true })
const counts = (x: It) => x.counts_in_trend ?? !x.non_continuous
const pts = computed(() => done.value.filter(x => x.exam === subj.value).slice(-12))
const max = computed(() => pts.value.reduce((m, x) => Math.max(m, x.max_score || 0), 0) || 100)
const W = 600, H = 160, PL = 44, PR = 18, PT = 12, PB = 30
const xy = (i: number, s: number) => {
  const n = pts.value.length, x = n === 1 ? (PL + W - PR) / 2 : PL + (W - PL - PR) * i / (n - 1)
  return [x, PT + (H - PT - PB) * (1 - s / max.value)] as const
}
const dots = computed(() => pts.value.map((p, i) => ({ p, ok: counts(p), at: xy(i, p.score ?? 0) })))
// 连线只连计入趋势的点
const line = computed(() => dots.value.filter(d => d.ok).map(d => d.at.join(',')).join(' '))
const ticks = computed(() => [0, 0.5, 1].map(f => Math.round(max.value * f)))
const est = computed(() => {
  const ok = pts.value.filter(counts).slice(-3)
  if (!ok.length) return ''
  const v = Math.round(ok.reduce((s, x) => s + (x.score ?? 0), 0) / ok.length)
  return ok.length === 3 ? `按最近 3 次连续作答估：约 ${v} 分` : `连续作答只有 ${ok.length} 次，先按这 ${ok.length} 次估：约 ${v} 分`
})
const md = (x: It) => { const d = new Date(x.submitted_at ?? x.started_at ?? ''); return isNaN(+d) ? '' : `${d.getMonth() + 1}/${d.getDate()}` }
</script>

<template>
  <div v-if="pts.length" class="trend">
    <div class="trh"><span class="cap sm">模 考 趋 势</span>
      <span v-if="subjects.length > 1" class="seg sm"><span v-for="s in subjects" :key="s" :class="{ on: s === subj }" @click="subj = s">{{ SUBJ[s] ?? s }}</span></span></div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="trsvg" role="img" :aria-label="`${SUBJ[subj] ?? subj}模考分数趋势`">
      <g v-for="t in ticks" :key="t"><line :x1="PL" :x2="W - PR" :y1="xy(0, t)[1]" :y2="xy(0, t)[1]" class="grid" /><text :x="PL - 6" :y="xy(0, t)[1] + 4" class="tk">{{ t }}</text></g>
      <polyline v-if="line" :points="line" class="ln" />
      <g v-for="(d, i) in dots" :key="d.p.id" class="dot" @click="emit('open', d.p.id)">
        <title>{{ d.p.title }} · {{ d.p.score }} / {{ d.p.max_score }}{{ d.ok ? '' : ' · 不计入趋势' }}</title>
        <circle :cx="d.at[0]" :cy="d.at[1]" r="12" class="hit" />
        <circle :cx="d.at[0]" :cy="d.at[1]" r="4" :class="d.ok ? 'on' : 'off'" />
        <text v-if="i === 0 || i === dots.length - 1 || dots.length <= 6" :x="d.at[0]" :y="H - 4" class="dx" :text-anchor="dots.length > 1 && i === 0 ? 'start' : dots.length > 1 && i === dots.length - 1 ? 'end' : 'middle'">{{ md(d.p) }}</text>
      </g>
    </svg>
    <p v-if="est" class="sub trest">{{ est }}</p>
    <p v-else class="sub trest">还没有连续作答的模考，暂时估不出分。</p>
    <p v-if="dots.some(d => !d.ok)" class="sub trnote">空心点是中途暂停较久的场次，不算进趋势。</p>
  </div>
</template>
