<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, sse, uid } from '../lib/api'
import { toast } from '../lib/toast'
type Task = { id: string; kind: string; title: string; estimated_minutes?: number; status: string; changed_by_agent?: boolean }
type Action = { id: string; action_count?: number; summary: string; reason?: string; created_at: string; undoable?: boolean; undone_at?: string | null; trigger?: string }
type Plan = { date: string; plan: { plan_date?: string; tasks: Task[]; progress: { done: number; total: number } } | null; why_changed: string | null; days_to_exam?: number | null; exam_date?: string | null
  tips?: { tip?: { text: string } | null; review?: { text: string } | null; weekly?: { text: string } | null } }
const emit = defineEmits<{ nav: [string] }>()
const data = ref<Plan | null>(null), err = ref(''), actions = ref<Action[]>([])
const tmr = ref<{ tasks: Task[]; why_changed?: string | null; plan_date?: string; relative_day?: string | null } | null>(null)
const nextDay = (d: string) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) }
// 交了卷还没自评完的场次：今日页最上面放一张卡，「去自评」直接进自评页（不做任何自动跳转）
const pendEx = ref<{ id: string; title: string; pts: number; n: number } | null>(null)
async function loadPend() {
  try {
    const h = await api<{ items: any[] }>('/exams?limit=20')
    const x = h.items.find(e => e.status === 'submitted' && e.pending_self_rating_count > 0)
    if (!x) { pendEx.value = null; return }
    const d = await api<any>(`/exams/${x.id}`)
    const pts = ((d.result?.per_question ?? []) as any[]).filter(q => (d.result?.pending_self_rating ?? []).includes(q.question_id)).reduce((s, q) => s + (q.score ?? 0), 0)
    pendEx.value = { id: x.id, title: x.title, pts, n: x.pending_self_rating_count }
  } catch { pendEx.value = null }
}
loadPend()
async function load() {
  try {
    const [p, a] = await Promise.all([api<Plan>('/plans/today'), api<{ items: Action[] }>('/agent/actions?limit=8')])
    data.value = p; actions.value = a.items
    // 教练晚上排的是明天的，也一起列出来
    const d = nextDay((p as any).study_date ?? p.date), r = await api<{ items: any[] }>(`/plans?from=${d}&to=${d}`).catch(() => ({ items: [] }))
    tmr.value = r.items[0]?.tasks?.length ? r.items[0] : null
  } catch (e: any) { err.value = e.message }
}
onMounted(load)
const target: Record<string, string> = { practice: 'quiz', redo_wrong: 'wrong', words: 'words', review: 'wrong' }
// 教练排的模考：跳到刷题页顶上的「整卷模考」卡，科目和年份按任务标题预选好
function openTask(t: { kind: string; title: string; payload?: any }) {
  if (t.kind === 'mock_exam') {
    const y = t.payload?.year ?? (Number(t.title.match(/20\d\d/)?.[0]) || undefined)
    const ex = t.payload?.exam ?? (/英语/.test(t.title) ? 'english1' : /数学/.test(t.title) ? 'math1' : undefined)
    localStorage.setItem('exam:pre', JSON.stringify({ exam: ex, year: y }))
  }
  emit('nav', target[t.kind] ?? 'quiz')
}
// 距初试：后端按用户时区算好的 days_to_exam；没设考试日期就不显示
const days = computed(() => data.value?.days_to_exam ?? null)
// 教练说：一次只说一句（今日一句 > 昨晚复盘 > 周报），不堆一屏建议
// 主动消息（夜间复盘/周报）优先：只显示 headline，details 折叠；显示出来就报「看到了」，后端靠它决定要不要少打扰
type Prop = { status: 'pending' | 'confirmed' | 'dismissed' | 'expired'; items: { summary: string }[] }
type Msg = { id: string; kind: string; headline: string; details?: string | null; seen_at?: string | null; proposal?: Prop | null }
const msg = ref<Msg | null>(null), openMsg = ref(false), openWhy = ref(false)
async function loadMsg() {
  try {
    const r = await api<{ items: Msg[] }>('/agent/messages?limit=5')
    // 等你确认的改动最要紧，其次没看过的，再其次最新一条
    msg.value = r.items.find(m => m.proposal?.status === 'pending') ?? r.items.find(m => !m.seen_at) ?? r.items[0] ?? null
    if (msg.value && !msg.value.seen_at) api(`/agent/messages/${msg.value.id}/seen`, { method: 'POST' }).catch(() => {})
  } catch { msg.value = null }
}
onMounted(loadMsg)
// 「改动先问我」模式：教练想改计划会先问，确认了才改（改完照样能撤回）
const deciding = ref(false)
async function decide(ok: boolean) {
  const m = msg.value; if (!m?.proposal || deciding.value) return
  deciding.value = true
  try {
    const r = await api<{ proposal: Prop; message?: { headline?: string } }>(`/agent/messages/${m.id}/${ok ? 'confirm' : 'dismiss'}`, { method: 'POST', body: '{}' })
    m.proposal = r.proposal ?? { ...m.proposal, status: ok ? 'confirmed' : 'dismissed' }
    if (r.message?.headline) m.headline = r.message.headline
    toast(ok ? '好，改好了，不合适可以在下面撤回' : '好，这次不改'); if (ok) load()
  } catch (e: any) {
    if (e.status === 409) { toast(e.code ? e.message : '这条建议已经处理过了'); loadMsg() } else toast('没办成：' + e.message)
  } finally { deciding.value = false }
}
const pending = computed(() => msg.value?.proposal?.status === 'pending')
// 提议处理完后标题还是「等你确认后才执行：想…」，前端按状态改成已经发生的说法
const decided = (m: Msg) => { const its = (m.proposal?.items ?? []).map(x => x.summary.replace(/^想/, '')).filter(Boolean); const applied = (m.proposal as any)?.applied_items as number[] | undefined
  const done = applied ? its.filter((_, i) => applied.includes(i)) : its
  if (m.proposal?.status === 'expired') return `已过期，计划没动。${its.length ? '原本想' + its.join('；') + '。' : ''}`
  return m.proposal?.status === 'confirmed' ? `按你确认的改好了：${done.join('；') || '计划已更新'}` : `这次没改。${its.length ? '原本想' + its.join('；') + '。' : ''}` }
const coachSays = computed(() => (msg.value?.proposal && msg.value.proposal.status !== 'pending' ? (/^(已|这次|按你)/.test(msg.value.headline ?? '') ? msg.value.headline : decided(msg.value)) : msg.value?.headline) || data.value?.tips?.tip?.text || data.value?.tips?.review?.text || data.value?.tips?.weekly?.text || '')
const tasks = computed(() => data.value?.plan?.tasks ?? [])
const left = computed(() => tasks.value.filter(t => t.status !== 'done' && t.status !== 'skipped').reduce((s, t) => s + (t.estimated_minutes ?? 0), 0))

async function toggle(t: Task) {
  const status = t.status === 'done' ? 'todo' : 'done'
  try { await api(`/plans/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); t.status = status } catch (e: any) { toast('没记上：' + e.message) }
}

// 命令栏：跟教练说一句话，它边做边说，改了什么列在下面，每条都能撤回
const cmd = ref(''), running = ref(false)
const run = ref<{ text: string; steps: string[]; acts: Action[]; done: string | null; err: string | null; date?: string; deduped?: boolean } | null>(null)
const otherDay = (d?: string) => d && data.value && d !== data.value.date ? `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日` : ''
const examples = ['今天只有一小时', '这周把极限练透', '错题太多了，先清错题']
async function send(text = cmd.value.trim()) {
  if (!text || running.value) return
  running.value = true; cmd.value = ''
  run.value = { text, steps: [], acts: [], done: null, err: null }; const r = run.value
  try {
    await sse('/agent/commands', { text, client_id: uid() }, ev => {
      if (ev.type === 'step' && !ev.text?.startsWith('收到')) r.steps.push(ev.text)
      if (ev.type === 'action') r.acts.push(ev.action)
      if (ev.type === 'done') { r.done = ev.reply || ev.summary || (ev.deduped ? '已经排过了，没有重复加' : '好了'); r.date = ev.date; r.deduped = ev.deduped }
      if (ev.type === 'error') r.err = ev.message
    })
  } catch (e: any) { r.err = e.message } finally { running.value = false; load() }
}
async function undo(a: Action) {
  try { await api(`/agent/actions/${a.id}/undo`, { method: 'POST' }); a.undone_at = new Date().toISOString(); toast('已撤回'); load() }
  catch (e: any) { toast(e.status === 409 ? (e.code ? e.message : '这条已经撤回过了') : '没撤回成功：' + e.message); if (e.status === 409) load() }
}
// 测试用：开发环境或本机设了 localStorage kaoyan:dev=1 时，显示「现在跑一次复盘」，调 /agent/jobs/run
const dev = import.meta.env.DEV || localStorage.getItem('kaoyan:dev') === '1'
const jobRunning = ref(false)
async function runJob(job = 'nightly') {
  if (jobRunning.value) return; jobRunning.value = true
  try { await api('/agent/jobs/run', { method: 'POST', body: JSON.stringify({ job, force: true }) }); toast('复盘跑完了'); await Promise.all([load(), loadMsg()]) }
  catch (e: any) { toast(e.status === 404 ? '这个环境没开复盘测试接口' : '没跑成：' + e.message) } finally { jobRunning.value = false }
}
const when = (s: string) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
// 撤回过的记录默认折起来，只留一行「已撤回 n 条」
const showUndone = ref(false)
const undoneN = computed(() => actions.value.filter(a => a.undone_at).length)
const shownActions = computed(() => showUndone.value ? actions.value : actions.value.filter(a => !a.undone_at))
</script>
<template>
  <div class="page col">
    <main class="main today">
      <div class="cap">今 日 · {{ data?.date ?? '' }}<span v-if="days != null && days >= 0" class="cd">距初试 {{ days }} 天</span><span v-else-if="days == null" class="cd link" @click="emit('nav', 'me')">设个考试日期</span></div>

      <div v-if="pendEx" class="pendex" @click="emit('nav', `exam/${pendEx.id}/rate`)">{{ pendEx.title }}还有 {{ pendEx.pts || pendEx.n }} {{ pendEx.pts ? '分' : '道' }}待自评<span class="go">去自评</span></div>
      <form class="cmd" @submit.prevent="send()">
        <input v-model="cmd" :disabled="running" maxlength="2000" placeholder="想怎么调，跟教练说一句" />
        <button :disabled="running || !cmd.trim()">{{ running ? '在办…' : '交给它' }}</button>
      </form>
      <div v-if="!run" class="ex"><span v-for="e in examples" :key="e" @click="send(e)">{{ e }}</span></div>
      <div v-else class="run">
        <p class="said">「{{ run.text }}」</p>
        <p v-for="(s, i) in run.steps" :key="i" class="st">{{ s }}</p>
        <p v-if="running" class="st pend">…</p>
        <p v-if="run.done" class="ok">{{ run.done }}<span v-if="!run.deduped && otherDay(run.date)" class="day">（改的是 {{ otherDay(run.date) }} 的计划）</span></p>
        <p v-if="run.err" class="pend">没办成：{{ run.err }}</p>
      </div>

      <p v-if="err" class="sub">{{ err }}</p>
      <template v-else-if="data">
        <div v-if="coachSays" class="coach"><span class="k">教练说</span>{{ coachSays }}
          <span v-if="msg?.headline && msg.details" class="more" @click="openMsg = !openMsg">{{ openMsg ? '收起' : '为什么' }}</span>
          <p v-if="openMsg && msg?.details" class="det">{{ msg.details }}</p>
          <span v-if="pending" class="ask"><span class="cy" :class="{ dim: deciding }" @click="decide(true)">确认，改吧</span><span class="cn" @click="decide(false)">不用了</span></span>
        </div>
        <p v-if="data.why_changed && tasks.length" class="why"><span class="k">计划改过</span><span class="more" @click="openWhy = !openWhy">{{ openWhy ? '收起' : '为什么' }}</span><span v-if="openWhy" class="det">{{ data.why_changed }}</span></p>
        <div v-if="tasks.length">
          <div class="cap sm">今天要做的 · {{ data.plan!.progress.done }} / {{ data.plan!.progress.total }}<span v-if="left" class="cd">还剩约 {{ left }} 分钟</span></div>
          <div class="tasks">
            <div v-for="t in tasks" :key="t.id" class="task" :class="{ done: t.status === 'done', agent: t.changed_by_agent }">
              <span class="box" :class="{ on: t.status === 'done' }" @click.stop="toggle(t)">{{ t.status === 'done' ? '✓' : '' }}</span>
              <span class="tt" @click="openTask(t)">{{ t.title }}</span>
              <span class="tm" v-if="t.estimated_minutes">{{ t.estimated_minutes }} 分钟</span>
            </div>
          </div>
        </div>
        <div v-else class="empty">
          <p class="sub">今天还没排任务，可以在上面跟教练说一句让它排，或者先做这些：</p>
          <div class="tasks">
            <div class="task" @click="emit('nav', 'quiz')"><span class="tt">接着刷数学一真题</span></div>
            <div class="task" @click="emit('nav', 'wrong')"><span class="tt">回看错题本</span></div>
            <div class="task" @click="emit('nav', 'words')"><span class="tt">背今天的单词</span></div>
          </div>
        </div>
        <template v-if="tmr">
          <div class="cap sm">{{ tmr.relative_day ?? '明天' }}{{ tmr.plan_date ? `（${tmr.plan_date.slice(5)}）` : '' }}已排好</div>
          <p v-if="tmr.why_changed" class="why">{{ tmr.why_changed }}</p>
          <div class="tasks">
            <div v-for="t in tmr.tasks" :key="t.id" class="task" :class="{ agent: t.changed_by_agent }" @click="openTask(t)">
              <span class="tt">{{ t.title }}</span><span class="tm" v-if="t.estimated_minutes">{{ t.estimated_minutes }} 分钟</span></div>
          </div>
        </template>


        <template v-if="actions.length">
          <div class="cap sm">教练改过的</div>
          <div class="log">
            <div v-for="a in shownActions" :key="a.id" class="li" :class="{ undone: a.undone_at }">
              <div class="l1"><span class="t">{{ when(a.created_at) }}</span><span class="s">{{ a.summary }}</span>
                <span v-if="a.undone_at" class="u dim">已撤回</span>
                <span v-else-if="a.undoable !== false" class="u" @click="undo(a)">撤回</span></div>
              <div v-if="a.reason" class="r">{{ a.reason }}</div>
            </div>
            <div v-if="undoneN" class="fold" @click="showUndone = !showUndone">{{ showUndone ? '收起已撤回的' : `已撤回 ${undoneN} 条，展开看看` }}</div>
          </div>
        </template>
        <div v-if="dev" class="devrun"><span v-if="jobRunning">正在复盘…</span><template v-else>现在跑一次复盘（测试用）：<span class="link sm" @click="runJob('nightly')">晚间</span> · <span class="link sm" @click="runJob('midday')">午间</span> · <span class="link sm" @click="runJob('weekly')">每周</span></template></div>
      </template>
      <p v-else class="sub">正在加载…</p>
    </main>
  </div>
</template>
