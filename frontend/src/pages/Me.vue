<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, download, token } from '../lib/api'
import { toast } from '../lib/toast'
const emit = defineEmits<{ nav: [string] }>()
type Leaf = { path: string; name: string; attempts: number; correct: number; recent_acc: number | null }
type Node = { path: string; name: string; level: number; children?: Node[] } & Partial<Leaf>
const me = ref<{ username: string; display_name: string | null; exam_date: string | null } | null>(null)
// 设置：后端 /me/settings 平铺字段；本机只做缓存（离线时先显示）
const KEY = 'me:prefs'
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
const cached = JSON.parse(localStorage.getItem(KEY) ?? '{}')
const p = reactive({ target_school: '', target_score: '' as string | number, exam_date: '', timezone: browserTz,
  coach_frequency: 'normal', quiet_start: '', quiet_end: '', ...cached })
const eff = ref<{ days_to_exam: number | null; auto_reduced?: boolean; auto_reduced_every_days?: number | null } | null>(null)
const st = ref<any>(null)
const tree = ref<Node[]>([]), openMap = ref(false)
const tzs = computed(() => [...new Set([p.timezone, browserTz, 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Australia/Sydney'])])
const freqs = [['more', '勤一点'], ['normal', '正常'], ['less', '少打扰'], ['ask', '改动先问我']]
function fromServer(r: any) {
  const v = r.settings ?? {}
  p.timezone = v.timezone ?? r.timezone ?? p.timezone
  p.target_school = v.target_school ?? ''; p.target_score = v.target_score ?? ''; p.exam_date = v.exam_date ?? ''
  p.coach_frequency = v.coach_frequency ?? 'normal'; p.quiet_start = v.quiet_hours?.start ?? ''; p.quiet_end = v.quiet_hours?.end ?? ''
  eff.value = r.effective ?? null; localStorage.setItem(KEY, JSON.stringify(p))
}
onMounted(async () => {
  const [a, s, t, x] = await Promise.allSettled([api('/auth/me'), api('/me/settings'), api('/mastery/tree'), api('/me/stats?days=30')])
  if (a.status === 'fulfilled') me.value = a.value
  if (s.status === 'fulfilled') {
    const v = s.value.settings ?? {}
    // 以前后端收不下、只存在本机的设置：后端还空着就补传一次
    const legacy: Record<string, unknown> = {}
    if (!v.target_school && cached.target_school) legacy.target_school = cached.target_school
    if (v.target_score == null && cached.target_score !== '' && cached.target_score != null) legacy.target_score = Number(cached.target_score)
    if (!v.exam_date && cached.exam_date) legacy.exam_date = cached.exam_date
    if (!v.coach_frequency && cached.coach_frequency && cached.coach_frequency !== 'normal') legacy.coach_frequency = cached.coach_frequency
    if (!v.quiet_hours && cached.quiet_start && cached.quiet_end) legacy.quiet_hours = { start: cached.quiet_start, end: cached.quiet_end }
    if (Object.keys(legacy).length) { try { fromServer(await api('/me/settings', { method: 'PATCH', body: JSON.stringify(legacy) })) } catch { fromServer(s.value) } }
    else fromServer(s.value)
  }
  if (t.status === 'fulfilled') tree.value = t.value.subjects
  if (x.status === 'fulfilled') st.value = x.value
})
// 只传改了的那一项；空 = null（清空）；值不对后端回 400 带中文提示，改回原值
let timer = 0
const dirty = new Set<string>()
function save(k: string) {
  delete fieldErr[k]
  if (k === 'target_score') { if (!scoreOk()) { dirty.delete(k); return } scoreErr.value = '' }
  dirty.add(k); clearTimeout(timer); timer = setTimeout(push, 600)
}
// 目标分本地先校验：输入时不打扰，离开输入框或按回车时再提示
const scoreErr = ref('')
const fieldErr = reactive<Record<string, string>>({})
const scoreOk = () => { const v = String(p.target_score ?? '').trim(); return v === '' || (/^\d+$/.test(v) && +v <= 500) }
function scoreBlur() { if (!scoreOk()) { scoreErr.value = '目标分填 0–500 之间的整数'; toast(scoreErr.value) } }
// 后端的报错若带字段名，换成学生看得懂的话
const friendly = (m: string) => /target_score/.test(m) ? '目标分填 0–500 之间的整数' : /exam_date/.test(m) ? '考试日期格式不对' : /quiet_hours/.test(m) ? '免打扰时间要填完整的开始和结束' : /timezone/.test(m) ? '时区不认识，换一个试试' : m.replace(/，?清空传 null/, '')
async function push() {
  const body: Record<string, unknown> = {}
  for (const k of dirty) {
    if (k === 'quiet_hours') body.quiet_hours = p.quiet_start && p.quiet_end ? { start: p.quiet_start, end: p.quiet_end } : (!p.quiet_start && !p.quiet_end ? null : undefined)
    else if (k === 'target_score') body.target_score = p.target_score === '' ? null : Number(p.target_score)
    else body[k] = (p as any)[k] === '' ? null : (p as any)[k]
  }
  dirty.clear()
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k])
  if (!Object.keys(body).length) return
  try { fromServer(await api('/me/settings', { method: 'PATCH', body: JSON.stringify(body) })); toast('已保存') }
  catch (e: any) {
    const msg = e.status === 400 ? friendly(e.message) : '没存上：' + e.message
    if (e.status === 400 && e.field) { if (e.field === 'target_score') scoreErr.value = msg; else fieldErr[e.field] = msg }
    toast(msg)
    try { fromServer(await api('/me/settings')) } catch {}
  }
}
const leaves = computed(() => { const out: Leaf[] = []; const walk = (n: Node) => n.children ? n.children.forEach(walk) : out.push(n as Leaf); tree.value.forEach(walk); return out })
const pct = (x: number | null | undefined) => x == null ? '—' : Math.round(x * 100) + '%'
const hm = (m: number) => m < 60 ? m + ' 分钟' : Math.floor(m / 60) + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分' : '')
const week = computed(() => { const ser = st.value?.last_7?.series ?? []; const mx = Math.max(1, ...ser.map((d: any) => d.answers)); return ser.map((d: any) => ({ ...d, h: Math.round(d.answers / mx * 100), wd: '日一二三四五六'[new Date(d.date + 'T00:00:00').getDay()] })) })
const weak = computed(() => leaves.value.filter(l => l.attempts >= 3 && (l.recent_acc ?? 1) < 0.6).sort((a, b) => (a.recent_acc ?? 0) - (b.recent_acc ?? 0)).slice(0, 3))
// 掌握度地图：按章看，每章一条，格子是知识点（灰=没练，深浅=正确率）
const chapters = computed(() => tree.value.flatMap(s => (s.children ?? []).map(c => ({ subj: s.name, name: c.name, pts: leavesOf(c) }))))
function leavesOf(n: Node): Leaf[] { return n.children ? n.children.flatMap(leavesOf) : [n as Leaf] }
const shade = (l: Leaf) => !l.attempts ? 'n' : (l.correct / l.attempts) >= 0.8 ? 'a' : (l.correct / l.attempts) >= 0.5 ? 'b' : 'c'
const daysLeft = computed(() => eff.value?.days_to_exam ?? null)
async function pdf() { try { await download('/wrong-questions/export.pdf', `错题本-${new Date().toLocaleDateString('en-CA')}.pdf`); toast('错题本 PDF 已下载') } catch (e: any) { toast(e.message) } }
function logout() { token.set(null); location.hash = ''; location.reload() }
</script>
<template>
  <div class="page col">
    <main class="main me">
      <div class="cap">我 的<span class="cd">{{ me?.display_name || me?.username || '' }}</span></div>

      <section>
        <h3>目标</h3>
        <div class="row"><label>院校</label><input v-model="p.target_school" placeholder="比如 浙江大学 计算机" @input="save('target_school')" /><span v-if="fieldErr.target_school" class="hint err">{{ fieldErr.target_school }}</span></div>
        <div class="row"><label>目标分</label><input v-model="p.target_score" type="number" min="0" max="500" placeholder="总分" :class="{ bad: scoreErr }" @input="save('target_score')" @blur="scoreBlur" @keyup.enter="scoreBlur" /><span v-if="scoreErr" class="hint err">{{ scoreErr }}</span><span v-else-if="String(p.target_score ?? '') === ''" class="hint">空着就是不设目标分</span></div>
        <div class="row"><label>初试日期</label><input v-model="p.exam_date" type="date" @change="save('exam_date')" /><span v-if="fieldErr.exam_date" class="hint err">{{ fieldErr.exam_date }}</span><span v-if="daysLeft !== null && daysLeft >= 0" class="hint">还有 {{ daysLeft }} 天</span></div>
      </section>

      <section>
        <h3>教练</h3>
        <div class="row"><label>提醒</label><span class="seg"><span v-for="[k, t] in freqs" :key="k" :class="{ on: p.coach_frequency === k }" @click="p.coach_frequency = k; save('coach_frequency')">{{ t }}</span></span></div>
        <div class="row"><label>免打扰</label><input v-model="p.quiet_start" type="time" @change="save('quiet_hours')" /><span class="hint">到</span><input v-model="p.quiet_end" type="time" @change="save('quiet_hours')" /><span v-if="fieldErr.quiet_hours" class="hint err">{{ fieldErr.quiet_hours }}</span></div>
        <div class="row"><label>时区</label><select v-model="p.timezone" @change="save('timezone')"><option v-for="z in tzs" :key="z" :value="z">{{ z }}</option></select></div>
        <p v-if="eff?.auto_reduced" class="sub sm">最近教练的话你没怎么看，它已经自动少说了（{{ eff.auto_reduced_every_days ? `约 ${eff.auto_reduced_every_days} 天一次` : '少打扰' }}）。想听多点就点「勤一点」。</p>
        <p v-else-if="p.coach_frequency === 'ask'" class="sub sm">教练想改你的计划时，会先在「今天」页问你，点了确认才改。</p>
      </section>

      <section>
        <h3>学习统计</h3>
        <div class="nums">
          <div><b>{{ st?.streak_days ?? '—' }}<small> 天</small></b><span>连续在学{{ st && st.best_streak_days > st.streak_days ? `（最长 ${st.best_streak_days}）` : '' }}</span></div>
          <div><b>{{ pct(st?.accuracy) }}</b><span>正确率 · {{ st?.attempts ?? 0 }} 题次</span></div>
          <div><b>{{ st ? hm(st.study_minutes) : '—' }}</b><span>近 30 天学习</span></div>
          <div><b>{{ st?.wrong_questions?.active ?? '—' }}</b><span>错题本里{{ st?.wrong_questions?.mastered ? ` · 已拿下 ${st.wrong_questions.mastered}` : '' }}</span></div>
        </div>
        <div v-if="week.length" class="week"><div v-for="d in week" :key="d.date" class="d" :title="`${d.date} · ${d.answers} 题次${d.accuracy != null ? ' · 对 ' + pct(d.accuracy) : ''}`"><i :style="{ height: Math.max(d.h, d.answers ? 6 : 2) + '%' }" :class="{ off: !d.studied }"></i><span>{{ d.wd }}</span></div></div>
        <div v-if="st?.subjects?.length" class="subj"><div v-for="x in st.subjects" :key="x.subject" class="srow"><span class="nm">{{ x.subject }}</span><span class="bar"><i :style="{ width: (x.total_points ? x.practiced_points / x.total_points * 100 : 0) + '%' }"></i></span><span class="v">练过 {{ x.practiced_points }}/{{ x.total_points }} 个点 · {{ x.accuracy == null ? '还没做' : '对 ' + pct(x.accuracy) }}</span></div></div>
        <p v-if="st?.words" class="sub sm">单词：学过 {{ st.words.learned }} 个，记牢 {{ st.words.solid }} 个，今天该复习 {{ st.words.due }} 个。</p>
        <p v-if="weak.length" class="sub sm">最近最弱：<template v-for="(l, i) in weak" :key="l.path">{{ i ? '、' : '' }}「{{ l.name }}」{{ l.correct }}/{{ l.attempts }}</template></p>
      </section>

      <section>
        <h3>掌握度地图 <span class="link sm" @click="openMap = !openMap">{{ openMap ? '收起' : '展开看' }}</span></h3>
        <div v-if="openMap" class="map">
          <div v-for="c in chapters" :key="c.subj + c.name" class="ch"><span class="nm">{{ c.name }}</span>
            <span class="pts"><i v-for="l in c.pts" :key="l.path" :class="shade(l)" :title="`${l.name}${l.attempts ? ` · 对 ${l.correct}/${l.attempts}` : ' · 还没练'}`"></i></span></div>
          <p class="sub sm legend"><i class="n"></i>没练 <i class="c"></i>不到一半 <i class="b"></i>一半以上 <i class="a"></i>八成以上</p>
        </div>
      </section>

      <section>
        <h3>导出</h3>
        <div class="acts flat"><span class="link" @click="pdf">错题本 PDF</span><span class="link" @click="emit('nav', 'wrong')">去错题本</span></div>
      </section>

      <div class="acts flat out"><span class="link" @click="logout">退出登录</span></div>
    </main>
  </div>
</template>
