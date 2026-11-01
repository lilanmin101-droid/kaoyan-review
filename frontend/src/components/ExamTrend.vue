<script setup lang="ts">
// 模考分数趋势：朱笔描点 + 细线；不计入趋势（non_continuous）的场次画空心点、不连线
import { computed, reactive, ref, watch } from 'vue'
import { api } from '../lib/api'
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
// 英语：翻译 + 作文 40 分是自评，趋势线只画客观题（完形 + 阅读 A + 新题型 = 60），主观题单独写；字数不够的自评不计入
const isEn = computed(() => subj.value.startsWith('english'))
const OBJ = ['use_of_english', 'reading_a', 'reading_b']
type Split = { obj: number; objMax: number; sub: number; subMax: number; low: number }
const split = reactive<Record<string, Split | null>>({})
async function loadSplit(id: string) {
  if (id in split) return
  // 后端列表带了拆分字段就直接用，不再逐场拉详情
  const it: any = props.items.find(x => x.id === id)
  if (it?.objective_score != null) { split[id] = { obj: it.objective_score, objMax: it.objective_max ?? 60, sub: it.subjective_ai_score ?? it.subjective_self_score ?? 0, subMax: it.subjective_max ?? 40, low: it.subjective_low_count ?? 0 }; return }
  split[id] = null
  try {
    const e = await api<any>(`/exams/${id}`), r = e.result ?? {}
    const secs: any[] = r.sections ?? [], pq: any[] = r.per_question ?? []
    const os = secs.filter(x => OBJ.includes(x.section))
    let sub = 0, low = 0
    for (const q of pq) if (q.objective === false) { if ((q.self_grade_flags ?? []).includes('word_count_low')) { if (q.got) low++ } else sub += q.ai_score ?? q.got ?? 0 }
    split[id] = { obj: os.reduce((a, x) => a + (x.score ?? 0), 0), objMax: os.reduce((a, x) => a + (x.max_score ?? 0), 0) || 60,
      sub, subMax: secs.filter(x => !OBJ.includes(x.section)).reduce((a, x) => a + (x.max_score ?? 0), 0) || 40, low }
  } catch { delete split[id] }
}
const all = computed(() => done.value.filter(x => x.exam === subj.value).slice(-12))
watch(all, v => { if (isEn.value) v.forEach(x => loadSplit(x.id)) }, { immediate: true })
const val = (x: It) => isEn.value ? split[x.id]?.obj ?? null : x.score
// 英语的点要等拆分数据回来才画
const pts = computed(() => all.value.filter(x => val(x) != null))
const max = computed(() => isEn.value ? (split[pts.value[0]?.id]?.objMax ?? 60) : pts.value.reduce((m, x) => Math.max(m, x.max_score || 0), 0) || 100)
const W = 600, H = 160, PL = 44, PR = 18, PT = 12, PB = 30
const xy = (i: number, s: number) => {
  const n = pts.value.length, x = n === 1 ? (PL + W - PR) / 2 : PL + (W - PL - PR) * i / (n - 1)
  return [x, PT + (H - PT - PB) * (1 - s / max.value)] as const
}
const dots = computed(() => pts.value.map((p, i) => ({ p, ok: counts(p), at: xy(i, val(p) ?? 0) })))
// 连线只连计入趋势的点
const line = computed(() => dots.value.filter(d => d.ok).map(d => d.at.join(',')).join(' '))
const ticks = computed(() => [0, 0.5, 1].map(f => Math.round(max.value * f)))
const est = computed(() => {
  const ok = pts.value.filter(counts).slice(-3)
  if (!ok.length) return ''
  const avg = (f: (x: It) => number) => Math.round(ok.reduce((a, x) => a + f(x), 0) / ok.length)
  const head = ok.length === 3 ? '按最近 3 次连续作答估' : `连续作答只有 ${ok.length} 次，先按这 ${ok.length} 次估`
  if (!isEn.value) return `${head}：约 ${avg(x => x.score ?? 0)} 分`
  const sp = ok.map(x => split[x.id]!), first = sp[0]
  return `${head}：客观题约 ${avg(x => split[x.id]!.obj)} / ${first.objMax} · 主观题自评 ${avg(x => split[x.id]!.sub)} / ${first.subMax}`
})
const lowN = computed(() => isEn.value ? pts.value.filter(counts).slice(-3).reduce((a, x) => a + (split[x.id]?.low ?? 0), 0) : 0)
const md = (x: It) => { const d = new Date(x.submitted_at ?? x.started_at ?? ''); return isNaN(+d) ? '' : `${d.getMonth() + 1}/${d.getDate()}` }
</script>

<template>
  <div v-if="pts.length" class="trend">
    <div class="trh"><span class="cap sm">模 考 趋 势{{ isEn ? ' · 客 观 题' : '' }}</span>
      <span v-if="subjects.length > 1" class="seg sm"><span v-for="s in subjects" :key="s" :class="{ on: s === subj }" @click="subj = s">{{ SUBJ[s] ?? s }}</span></span></div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="trsvg" role="img" :aria-label="`${SUBJ[subj] ?? subj}模考分数趋势`">
      <g v-for="t in ticks" :key="t"><line :x1="PL" :x2="W - PR" :y1="xy(0, t)[1]" :y2="xy(0, t)[1]" class="grid" /><text :x="PL - 6" :y="xy(0, t)[1] + 4" class="tk">{{ t }}</text></g>
      <polyline v-if="line" :points="line" class="ln" />
      <g v-for="(d, i) in dots" :key="d.p.id" class="dot" @click="emit('open', d.p.id)">
        <title>{{ d.p.title }} · {{ isEn ? `客观题 ${val(d.p)} / ${max}` : `${d.p.score} / ${d.p.max_score}` }}{{ d.ok ? '' : ' · 不计入趋势' }}</title>
        <circle :cx="d.at[0]" :cy="d.at[1]" r="12" class="hit" />
        <circle :cx="d.at[0]" :cy="d.at[1]" r="4" :class="d.ok ? 'on' : 'off'" />
        <text v-if="i === 0 || i === dots.length - 1 || dots.length <= 6" :x="d.at[0]" :y="H - 4" class="dx" :text-anchor="dots.length > 1 && i === 0 ? 'start' : dots.length > 1 && i === dots.length - 1 ? 'end' : 'middle'">{{ md(d.p) }}</text>
      </g>
    </svg>
    <p v-if="est" class="sub trest">{{ est }}<span v-if="lowN" class="low">（{{ lowN }} 道字数不够，没计入）</span></p>
    <p v-if="isEn && est" class="sub trnote">线只画客观题；翻译和作文是自评，单独算。</p>
    <p v-else class="sub trest">还没有连续作答的模考，暂时估不出分。</p>
    <p v-if="dots.some(d => !d.ok)" class="sub trnote">空心点是中途暂停较久的场次，不算进趋势。</p>
  </div>
</template>
