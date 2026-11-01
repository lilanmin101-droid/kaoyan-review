// 离线题包：联网时预存今天的题（今日任务里的阅读/完形 + 10 道错题重做，带答案和解析），每天 04:00 换新
// 离线作答先存本机（客户端时间 + client_id 幂等），联网后 POST /answers/batch 补传，不会重复计分
import { ref } from 'vue'
import { api, offline, uid } from './api'
import { toast } from './toast'

export type POpt = { key: string; content: string }
export type PQ = { id: string; number?: number | string; type: string; section?: string; stem: string; score?: number | string; options?: POpt[]; answer?: string[]; solution?: string | null;
  passage_id?: string | null; tables?: any[] | null; exam?: string; year?: number | string; origin?: string; explanation?: string | null }
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
    const r = await api<any>('/today/pack' + (v && packFresh() ? `?since_version=${encodeURIComponent(v)}` : ''), {}, { noReload: true })
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

let flushing = false
export async function flushQueue() {
  if (flushing || offline.value || !queue.value.length) return
  flushing = true
  try {
    const items = queue.value.slice(0, 50)
    await api('/answers/batch', { method: 'POST', body: JSON.stringify({ source: 'offline_pack', items }) }, { noReload: true })
    const sent = new Set(items.map(x => x.client_id))
    queue.value = queue.value.filter(x => !sent.has(x.client_id)); save()
    toast(`离线做的 ${items.length} 道题已经补传`)
    if (queue.value.length) { flushing = false; return flushQueue() }
  } catch { /* 下次联网再传 */ } finally { flushing = false }
}

addEventListener('kaoyan:online', () => { flushQueue(); refreshPack() })
setTimeout(() => { flushQueue(); refreshPack() }, 1500)
setInterval(() => { if (!packFresh()) refreshPack() }, 10 * 60e3)
