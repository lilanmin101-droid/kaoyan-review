// 离线题包：联网时预存今天的题（计划里的阅读/完形，没排计划时后端自动挑文章；外加最多 10 道错题重做，带答案和解析），每天 04:00 换新
// 题包里实际有什么以后端的 summary / counts 为准，前端不写死
// 离线作答先存本机（客户端时间 + client_id 幂等），联网后逐条走 POST /answers 补传（source:'offline_pack'），不会重复计分
import { ref } from 'vue'
import { api, offline, uid } from './api'
import { toast } from './toast'
import { ApiError } from './api'

export type POpt = { key: string; content: string }
export type PQ = { id: string; number?: number | string; type: string; section?: string; stem: string; score?: number | string; options?: POpt[]; answer?: string[]; solution?: string | null;
  passage_id?: string | null; tables?: any[] | null; exam?: string; year?: number | string; origin?: string; explanation?: PExp | string | null; explanation_status?: string; objective?: boolean; reference_answer?: string | string[] | null; sub_questions?: { stem: string; score?: number; answer?: string[]; number?: number }[] }
export type PExp = { source?: string; source_label?: string | null; verified?: boolean; steps?: { n?: number; text: string }[]; text?: string | null }
export type PPassage = { id: string; title?: string; directions?: string; text: string; options?: POpt[] }
export type PackCounts = { questions?: number; plan_questions?: number; wrong_redos?: number; wrong_redo_limit?: number; plan_tasks?: number; plan_passages?: number; auto_passages?: number }
export type Pack = { version: string; study_date?: string; expires_at?: string; fetched_at: number; questions: PQ[]; passages: PPassage[]; summary?: string | null; counts?: PackCounts }
export type Pending = { client_id: string; question_id: string; answer: string[]; answered_at: string; pack_version: string; local_correct: boolean | null ; time_spent_seconds?: number; self_rating?: string; thought_text?: string }

const PK = 'offline:pack', QK = 'offline:queue', DK = 'offline:done'
const read = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d } catch { return d } }
export const pack = ref<Pack | null>(read<Pack | null>(PK, null))
export const queue = ref<Pending[]>(read<Pending[]>(QK, []))
// 本机做过的（含已补传的），只为离线页显示对错；换包时清掉
export const done = ref<Record<string, { answer: string[]; ok: boolean | null; rating?: string }>>(read(DK, {}))
const save = () => { localStorage.setItem(QK, JSON.stringify(queue.value)); localStorage.setItem(DK, JSON.stringify(done.value)) }

// 学习日按凌晨 4 点切
export const studyDay = (d = new Date()) => { const t = new Date(d.getTime() - 4 * 3600e3); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
export const packFresh = () => !!pack.value && (pack.value.study_date ?? studyDay(new Date(pack.value.fetched_at))) === studyDay()

function normalize(r: any): Pack {
  const qs: PQ[] = r.questions ?? r.items ?? (r.groups ?? []).flatMap((g: any) => g.questions ?? [])
  const ps: PPassage[] = r.passages ?? (r.groups ?? []).map((g: any) => g.passage).filter(Boolean)
  return { version: String(r.version ?? r.pack_version ?? ''), study_date: r.study_date, expires_at: r.expires_at, fetched_at: Date.now(), questions: qs, passages: ps, summary: r.summary ?? null, counts: r.counts }
}
export const isRedo = (x: PQ) => x.origin === 'wrong_redo' || x.origin === 'wrong'
// 题包说明：优先用后端按实际内容生成的 summary；老后端没有 summary 就按真实数量拼一句（不再写死「今天任务里的… + 10 道错题」）
export function packSummary(p: Pack | null): string {
  if (!p) return ''
  if (p.summary) return p.summary
  const c = p.counts ?? {}, redo = p.questions.filter(isRedo).length, today = p.questions.length - redo
  const parts: string[] = []
  if (today) {
    if (c.plan_tasks === 0 || (c.plan_passages === 0 && c.auto_passages)) parts.push(`今天还没排任务，先自动挑了 ${c.auto_passages ?? p.passages.length} 篇文章（共 ${today} 题）`)
    else if (c.plan_passages != null && c.auto_passages) parts.push(`今天计划里的文章 ${c.plan_passages} 篇，另自动挑了 ${c.auto_passages} 篇（共 ${today} 题）`)
    else if (c.plan_passages != null) parts.push(`今天计划里的文章 ${c.plan_passages} 篇（共 ${today} 题）`)
    else parts.push(`文章 ${p.passages.length} 篇（共 ${today} 题）`)
  }
  if (redo) parts.push(`${today ? '加 ' : ''}${redo} 道错题重做`)
  return parts.join('，') || `共 ${p.questions.length} 题`
}
let loading = false
// force：不管本机包新不新都重拉；full：连 since_version 也不带（刚登录，本机的包可能是上一个账号的）
export async function refreshPack(force = false, full = false) {
  if (loading || offline.value || (!force && packFresh())) return
  loading = true
  try {
    const v = pack.value?.version
    const r = await api<any>('/offline/pack' + (v && packFresh() && !full ? `?since_version=${encodeURIComponent(v)}` : ''), {}, { noReload: true })
    if (r && r.not_modified) return
    const p = normalize(r)
    if (!p.questions.length) return
    if (pack.value?.version !== p.version) { const keep: typeof done.value = {}; for (const x of queue.value) keep[x.question_id] = done.value[x.question_id]; done.value = keep; save() }
    pack.value = p; localStorage.setItem(PK, JSON.stringify(p))
  } catch { /* 没有题包接口或没网：保留旧包 */ } finally { loading = false }
}

// 本地判分：选择题比对答案；其它题型看参考答案自己对
export const sameAns = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
export type Rating = 'full' | 'approach_ok_calc_wrong' | 'no_idea'
export function answerLocal(q: PQ, ans: string[], spent?: number, rating?: { self_rating: Rating; thought_text?: string }) {
  const ok = rating ? (rating.self_rating === 'full' ? true : rating.self_rating === 'no_idea' ? false : null)
    : q.answer?.length && q.type.includes('choice') ? sameAns(ans, q.answer) : null
  done.value[q.id] = { answer: ans, ok, rating: rating?.self_rating }
  queue.value.push({ client_id: uid(), question_id: q.id, answer: ans, answered_at: new Date().toISOString(), pack_version: pack.value?.version ?? '', local_correct: ok,
    ...(spent ? { time_spent_seconds: Math.max(1, Math.round(spent)) } : {}), ...(rating ?? {}) })
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
      const { local_correct: _lc, ...body } = x as any
      let r: any
      try {
        r = await api('/answers', { method: 'POST', body: JSON.stringify({ ...body, answer: body.self_rating ? undefined : body.answer, source: 'offline_pack' }) }, { noReload: true })
      } catch (e: any) {
        // 只有网络错误、5xx、401（等重新登录）才重试；其它 4xx 是字段问题，重试也没用，丢掉并记日志
        if (!(e instanceof ApiError) || e.code === 'offline' || e.status >= 500 || e.status === 401 || e.status === 0) throw e
        console.warn('[offline] 补传被拒，丢弃', e.status, e.code, x)
      }
      if (r?.status === 'rejected') console.warn('[offline] 补传被拒，丢弃', r.reason, x)
      else if (r?.answered_at_clamped) console.info('[offline] 作答时间被调整', r.answered_at_clamped)
      queue.value = queue.value.slice(1); save(); n++
    }
    if (n) toast(`离线做的 ${n} 道题已经补传`)
    tries = 0
  } catch { /* 失败：指数退避重试，2s 起翻倍，最多 5 分钟 */ clearTimeout(retryT); retryT = window.setTimeout(flushQueue, Math.min(300e3, 2000 * 2 ** tries++)) } finally { flushing = false }
}

// 注册/登录成功后马上拉一次题包（以前要等刷新页面才拉，登录完直接断网就没有题包）
let packT = 0
export function afterLogin() {
  flushQueue()
  if (loading) { clearTimeout(packT); packT = window.setTimeout(afterLogin, 500); return }
  refreshPack(true, true)
}
// 离线页正在做的题，给顶栏显示「离线题包 · 2025 英语一」
export const offCur = ref<{ year?: number | string; exam?: string } | null>(null)
addEventListener('kaoyan:online', () => { flushQueue(); refreshPack() })
setTimeout(() => { flushQueue(); refreshPack() }, 1500)
setInterval(() => { if (!packFresh()) refreshPack() }, 10 * 60e3)

// 过了有效期（当地下一个 04:00）：优先用接口自己的 expires_at，没有就跟题包一起算
export const packStale = (own?: string | null) => { const e = own ?? pack.value?.expires_at; return !!e && Date.now() > Date.parse(e) }
