<script setup lang="ts">
// 刷题页顶上的「整卷模考」卡：选科目和年份，写明时长和满分，直接开考
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { api, ApiError } from '../lib/api'
import { toast } from '../lib/toast'

const props = defineProps<{ years: number[]; enYears: number[] }>()
const emit = defineEmits<{ nav: [string] }>()
const INFO = { math1: { name: '数学一', max: 150 }, english1: { name: '英语一', max: 100 } } as const
type S = keyof typeof INFO
const subj = ref<S>(localStorage.getItem('exam:subj') === 'english1' ? 'english1' : 'math1')
const ys = computed(() => subj.value === 'english1' ? props.enYears : props.years)
// 选定的年份只由学生改；列表晚到时只在没选或选的不在列表里才补默认值
const YK = () => `exam:year:${subj.value}`
const year = ref(Number(localStorage.getItem(YK())) || 0)
const hot = ref(false), busy = ref(false), el = ref<HTMLElement>()
function fix() { if (ys.value.length && !ys.value.includes(year.value)) year.value = ys.value[0] }
watch(ys, fix, { immediate: true })
watch(year, y => { if (y) localStorage.setItem(YK(), String(y)) })
function setSubj(s: S) { if (s === subj.value) return; subj.value = s; localStorage.setItem('exam:subj', s); year.value = Number(localStorage.getItem(YK())) || 0; fix() }
onMounted(() => {
  // 教练建议模考时带过来的预选
  const pre = localStorage.getItem('exam:pre'); if (!pre) return
  localStorage.removeItem('exam:pre')
  try { const p = JSON.parse(pre); if (p.exam in INFO) setSubj(p.exam); if (p.year) year.value = Number(p.year); fix() } catch { /* 忽略 */ }
  hot.value = true; nextTick(() => el.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })); setTimeout(() => (hot.value = false), 2400)
})
async function start() {
  if (busy.value || !year.value) return
  busy.value = true
  try {
    await api('/exams', { method: 'POST', body: JSON.stringify({ exam: subj.value, year: year.value, duration_minutes: 180 }) })
    emit('nav', 'exam/go')
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 409) { localStorage.setItem('exam:wanted', `${year.value} ${INFO[subj.value].name}`); emit('nav', 'exam') }
    else if (e instanceof ApiError && e.status === 422) toast(`${year.value} 年这套还没核对完，先换一年`)
    else toast('没开成：' + e.message)
  } finally { busy.value = false }
}
</script>
<template>
  <section ref="el" class="mockcard" :class="{ hot }">
    <div class="mc-h"><b>整卷模考</b><span class="sub">180 分钟 · 满分 {{ INFO[subj].max }} · 跟真考一样限时，交卷出成绩</span></div>
    <div class="mc-r">
      <span class="seg"><span :class="{ on: subj === 'math1' }" @click="setSubj('math1')">数学一</span><span :class="{ on: subj === 'english1' }" @click="setSubj('english1')">英语一</span></span>
      <select v-model.number="year" aria-label="年份"><option v-for="y in ys" :key="y" :value="y">{{ y }} 年</option></select>
      <span class="next" @click="start">{{ busy ? '正在开考…' : `开考 · ${year || ''} ${INFO[subj].name}` }}</span>
    </div>
  </section>
</template>
