// 离线题包：联网时预存今天的题（今日任务里的阅读/完形 + 10 道错题重做，带答案和解析），每天 04:00 换新
// 离线作答先存本机（客户端时间 + client_id 幂等），联网后逐条走 POST /answers 补传（source:'offline_pack'），不会重复计分
import { ref } from 'vue'
import { api, offline, uid } from './api'
import { toast } from './toast'
import { ApiError } from './api'

export type POpt = { key: string; content: string }
export type PQ = { id: string; number?: number | string; type: string; section?: string; stem: string; score?: number | string; options?: POpt[]; answer?: string[]; solution?: string | null;
  passage_id?: string | null; tables?: any[] | null; exam?: string; year?: number | string; origin?: string; explanation?: string | null; explanation_status?: string }
export type PPassage = { id: string; title?: string; directions?: string; text: string; options?: POpt[] }
export type Pack = { version: string; study_date?: string; expires_at?: string; fetched_at: number; questions: PQ[]; passages: PPassage[] }
export type Pending = { client_id: string; question_id: string; answer: string[]; answered_at: string; pack_version: string; local_correct: boolean | null }

const PK = 'offline:pack', QK = 'offline:queue', DK = 'offline:done'
const read = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d } catch { return d } }
export const pack = ref<Pack | null>(read<Pack | null>(PK, null))
export const queue = ref<Pending[]>(read<Pending[]>(QK, []))
// 本机做过的（含已补传的），只为离线页显示对错；换包时清掉
export const done = ref<Record<string, { answer: string[]; ok: boolean | null }>>(read(DK, {}))
const save = () => { localStorage.setItem(QK, JSON.stringify(queue.value)); localStorage.setItem(DK, JSON.stringify(done.value)) }

// 学习日按凌晨 4 点切
export const studyDay = (d = new Date()) => { const t = new Date(d.getTime() - 4 * 3600e3); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
export const packFresh = () => !!pack.value && (pack.value.study_date ?? studyDay(new Date(pack.value.fetched_at))) === studyDay()

function normalize(r: any): Pack {
  const qs: PQ[] = r.questions ?? r.items ?? (r.groups ?? []).flatMap((g: any) => g.questions ?? [])
  const ps: PPassage[] = r.passages ?? (r.groups ?? []).map((g: any) => g.passage).filter(Boolean)
  return { version: String(r.version ?? r.pack_version ?? ''), study_date: r.study_date, expires_at: r.expires_at, fetched_at: Date.now(), questions: qs, passages: ps }
}
let loading = false
export async function refreshPack(force = false) {
  if (loading || offline.value || (!force && packFresh())) return
  loading = true
  try {
    const v = pack.value?.version
    const r = await api<any>('/offline/pack' + (v && packFresh() ? `?since_version=${encodeURIComponent(v)}` : ''), {}, { noReload: true })
    if (r && r.not_modified) return
    const p = normalize(r)
    if (!p.questions.length) return
    if (pack.value?.version !== p.version) { const keep: typeof done.value = {}; for (const x of queue.value) keep[x.question_id] = done.value[x.question_id]; done.value = keep; save() }
    pack.value = p; localStorage.setItem(PK, JSON.stringify(p))
  } catch { /* 没有题包接口或没网：保留旧包 */ } finally { loading = false }
}

// 本地判分：选择题比对答案；其它题型看参考答案自己对
export const sameAns = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
export function answerLocal(q: PQ, ans: string[]) {
  const ok = q.answer?.length && q.type.includes('choice') ? sameAns(ans, q.answer) : null
  done.value[q.id] = { answer: ans, ok }
  queue.value.push({ client_id: uid(), question_id: q.id, answer: ans, answered_at: new Date().toISOString(), pack_version: pack.value?.version ?? '', local_correct: ok })
  save(); flushQueue()
  return ok
}

let flushing = false, tries = 0, retryT = 0
export async function flushQueue() {
  if (flushing || offline.value || !queue.value.length) return
  flushing = true
  try {
    // 补传走现有作答接口，一题一条；client_id 幂等，后端按 answered_at 计入当天
    let n = 0
    while (queue.value.length && !offline.value) {
      const x = queue.value[0]
      try {
        await api('/answers', { method: 'POST', body: JSON.stringify({ question_id: x.question_id, answer: x.answer, client_id: x.client_id, answered_at: x.answered_at, source: 'offline_pack', pack_version: x.pack_version }) }, { noReload: true })
      } catch (e: any) { if (!(e instanceof ApiError) || e.code === 'offline' || e.status >= 500 || e.status === 401) throw e /* 4xx（题不存在等）丢掉这条，免得卡住队列 */ }
      queue.value = queue.value.slice(1); save(); n++
    }
    if (n) toast(`离线做的 ${n} 道题已经补传`)
    tries = 0
  } catch { /* 失败：指数退避重试，2s 起翻倍，最多 5 分钟 */ clearTimeout(retryT); retryT = window.setTimeout(flushQueue, Math.min(300e3, 2000 * 2 ** tries++)) } finally { flushing = false }
}

addEventListener('kaoyan:online', () => { flushQueue(); refreshPack() })
setTimeout(() => { flushQueue(); refreshPack() }, 1500)
setInterval(() => { if (!packFresh()) refreshPack() }, 10 * 60e3)
