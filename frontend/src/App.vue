<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { api, token, offline } from './lib/api'
import { toastMsg } from './lib/toast'
import Login from './Login.vue'
import Quiz from './pages/Quiz.vue'
import Today from './pages/Today.vue'
import Words from './pages/Words.vue'
import Wrong from './pages/Wrong.vue'
import Me from './pages/Me.vue'
import Exam from './pages/Exam.vue'
import ExamCard from './components/ExamCard.vue'
import English from './pages/English.vue'

const tabs = [['today', '今日'], ['quiz', '刷题'], ['words', '单词'], ['wrong', '错题本'], ['me', '我的']] as const
type Tab = typeof tabs[number][0] | 'exam'
// 电脑顶栏宽度够，留「模考」；手机底栏保持 5 个，入口走刷题页的「整卷模考」卡
const deskTabs = [tabs[0], tabs[1], ['exam', '模考'], ...tabs.slice(2)] as const
const authed = ref(!!token.get())
// 考场不占底部标签：刷题页顶上有「整卷模考」卡；考试进行中时每页顶上挂一条「继续」
const parse = (): Tab => location.hash.startsWith('#/exam') ? 'exam' : (tabs.find(t => '#/' + t[0] === location.hash)?.[0] ?? 'today')
const tab = ref<Tab>(parse())
addEventListener('hashchange', () => { tab.value = parse(); toastMsg.value = '' })
function nav(t: string) { location.hash = '/' + t; scrollTo({ top: 0 }) }
const comp = computed(() => ({ today: Today, quiz: Quiz, words: Words, wrong: Wrong, me: Me, exam: Me })[tab.value])
const year = ref(Number(localStorage.getItem('paper:year') ?? 2024))
const years = ref<number[]>([2024])
function setYear(y: number) { year.value = y; localStorage.setItem('paper:year', String(y)) }
// 刷题页的科目：数学一 / 英语一，各记各的年份
const subj = ref<'math1' | 'english1'>(localStorage.getItem('paper:subj') === 'english1' ? 'english1' : 'math1')
const enYear = ref(Number(localStorage.getItem('paper:enyear') ?? 2024))
const enYears = ref<number[]>([2024])
const enExamYears = ref<number[]>([]) // 整卷 52 题都确认了的年份才能进考场
const mathExamYears = ref<number[]>([]) // 后端列表到了才给考场用，别拿默认值覆盖学生选的年份
function setSubj(s: string) { subj.value = s === 'english1' ? 'english1' : 'math1'; localStorage.setItem('paper:subj', subj.value); scrollTo({ top: 0 }) }
// 单词页「看原文」：记下要打开的文章，切到英语一对应年份
function openPassage(y: number, pid: string) { localStorage.setItem('en:jump', pid); setSubj('english1'); setEnYear(y); nav('quiz') }
function setEnYear(y: number) { enYear.value = y; localStorage.setItem('paper:enyear', String(y)) }
// 年份只列全部核对完的（后端 /questions/years 的 ready）
async function probe() {
  try {
    const r = await api<{ ready: { exam: string; year: number }[] }>('/questions/years?exam=math1')
    years.value = r.ready.filter(x => x.exam === 'math1').map(x => x.year).sort((a, b) => b - a)
    mathExamYears.value = years.value
  } catch { return }
  if (years.value.length && !years.value.includes(year.value)) setYear(years.value[0])
  // 英语一还没有整套核对完的，先列有核对过题目的年份
  try {
    const e = await api<{ items: { year: number; confirmed: number }[] }>('/questions/years?exam=english1')
    enYears.value = e.items.filter(x => x.confirmed > 0).map(x => x.year).sort((a, b) => b - a)
    enExamYears.value = e.items.filter((x: any) => x.confirmed >= 52).map(x => x.year).sort((a, b) => b - a)
    if (enYears.value.length && !enYears.value.includes(enYear.value)) setEnYear(enYears.value[0])
  } catch { /* 留默认 */ }
}
if (authed.value) { probe(); pollLive() }
// 进行中的考试：每页顶上挂一条，切页或每分钟刷新一次
type Live = { id: string; title: string; status: string; remaining_seconds: number }
// 断网提示：PWA 断网也能打开，内容是上次同步的
const live = ref<Live | null>(null), liveLeft = ref(0)
let liveAt = 0
async function pollLive() {
  if (!token.get()) return
  try { const r = await api<{ exam: Live | null }>('/exams/active'); live.value = r.exam; liveLeft.value = r.exam?.remaining_seconds ?? 0; liveAt = Date.now() } catch { /* 网络不好就先不挂 */ }
}
addEventListener('hashchange', () => { if (tab.value !== 'exam') pollLive() })
const liveT = setInterval(() => { if (live.value?.status === 'in_progress') liveLeft.value = Math.max(0, (live.value.remaining_seconds ?? 0) - (Date.now() - liveAt) / 1000); if (Date.now() - liveAt > 60000 && tab.value !== 'exam') pollLive() }, 1000)
onUnmounted(() => clearInterval(liveT))
const sub = computed(() => tab.value === 'quiz' ? `${subj.value === 'english1' ? enYear.value : year.value} 真题` : tab.value === 'exam' ? '考场模式' : '')
</script>

<template>
  <Login v-if="!authed" @done="authed = true; probe(); pollLive()" />
  <div v-else class="desk">
    <header v-if="tab !== 'exam'" class="top">
      <div class="wm">研习<em>{{ sub }}</em></div>
      <nav class="tabs"><a v-for="[k, t] in deskTabs" :key="k" :href="'#/' + k" :class="{ on: tab === k }" @click.prevent="nav(k)" @auxclick.prevent>{{ t }}</a></nav>
      <div class="cd"><span v-if="tab === 'quiz'" class="seg subj"><span :class="{ on: subj === 'math1' }" @click="setSubj('math1')">数学一</span><span :class="{ on: subj === 'english1' }" @click="setSubj('english1')">英语一</span></span></div>
    </header>
    <div v-if="offline" class="offbar">现在没网，看到的是上次同步的内容，改动要连上网再做</div>
    <div v-if="live && tab !== 'exam'" class="examlive" @click="nav('exam/go')"><span class="dot"></span>考试进行中 · {{ live.title }} · {{ live.status === 'paused' ? '已暂停' : `剩 ${Math.max(0, Math.floor(liveLeft / 60))} 分钟` }}<span class="go">继续</span></div>
    <ExamCard v-if="tab === 'quiz'" :years="mathExamYears" :en-years="enExamYears" @nav="nav" />
    <English v-if="tab === 'quiz' && subj === 'english1'" :key="'en' + enYear" :year="enYear" :years="enYears" @nav="nav" @year="setEnYear" @subj="setSubj" />
    <Quiz v-else-if="tab === 'quiz'" :key="'quiz' + year" :year="year" :years="years" @nav="nav" @year="setYear" @subj="setSubj" />
 <Exam v-else-if="tab === 'exam'" :years="mathExamYears" :en-years="enExamYears" @nav="nav" />
    <component v-else :is="comp" :key="tab" @nav="nav" @passage="openPassage" />
    <nav v-if="tab !== 'exam'" class="btabs"><a v-for="[k, t] in tabs" :key="k" :href="'#/' + k" :class="{ on: tab === k }" @click.prevent="nav(k)" @auxclick.prevent>{{ t }}</a></nav>
  </div>
  <transition name="fade"><div v-if="toastMsg" class="toast">{{ toastMsg }}</div></transition>
</template>
