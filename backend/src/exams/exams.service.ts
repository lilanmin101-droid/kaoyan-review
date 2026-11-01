import { subScoresSql } from '../common/grading';
import { referenceAnswer } from '../questions/reference-answer';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { LearningService } from '../mastery/learning.service';
import { UserTimeService } from '../common/user-time.service';
import { studyDate } from '../common/time';
import { AgentToolsService } from '../agent/agent-tools.service';
import { ENGLISH1_COUNT, ENGLISH1_MINUTES } from '../english/english-spec';
import { coachDetails, coachHeadline, PerQuestion, RATINGS, sectionOf, SelfRating, subjectOf, summarize } from './exam-summary';

/** 断网/没发心跳时，两次保存之间最多计这么多秒，避免关掉页面后时间一直在走 */
export const HEARTBEAT_CAP_SECONDS = 120;
/** 整卷题数与时长：数学 180 分钟、150 分；2021 年起 22 题（10 选 6 填 6 解答），之前 23 题（8 选 6 填 9 解答） */
function paperSpec(exam?: string, year?: number): { count: number | null; minutes: number } | undefined {
  if (exam === 'english1') return { count: ENGLISH1_COUNT, minutes: ENGLISH1_MINUTES }; // 52 题 / 100 分 / 180 分钟
  if (!exam || !/^math[123]$/.test(exam)) return undefined;
  return { count: year ? (year >= 2021 ? 22 : 23) : null, minutes: 180 };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkId(id: string) { if (!UUID_RE.test(id ?? '')) throw new NotFoundException('模考不存在'); }
const EXAM_CN: Record<string, string> = { math1: '数学一', math2: '数学二', math3: '数学三', english1: '英语一', english2: '英语二', politics: '政治' };

export interface ProgressBody {
  idempotency_key: string;
  client_seq: number;
  answers?: { question_id: string; answer: string[]; time_spent_seconds?: number; flagged?: boolean }[];
  current_question_id?: string | null;
  state?: 'running' | 'paused';
}
export type RatingInput = Record<string, SelfRating | Record<string, SelfRating>>;

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, 'ⅰ': 1, 'ⅱ': 2, 'ⅲ': 3, 'ⅳ': 4, 'ⅴ': 5, 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5, '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5 };
/** 小问键规范成题库里的小问号：2 / "2" / "(2)" / "（2）" / "第2问" / "sub2" / "ii" / "Ⅱ" / "②" → "2"；没有这个小问返回 null */
export function subKeyOf(k: unknown, subs: string[]): string | null {
  let t = String(k ?? '').trim();
  if (subs.includes(t)) return t;
  t = t.replace(/^[(（\[]\s*|\s*[)）\]]$/g, '').replace(/^(第|sub[_-]?|part[_-]?|q)/i, '').replace(/(小问|问|小题)$/, '').replace(/^[(（]|[)）]$/g, '').trim();
  const n = /^\d+$/.test(t) ? Number(t) : ROMAN[t] ?? ROMAN[t.toLowerCase()];
  return n != null && subs.includes(String(n)) ? String(n) : null;
}

@Injectable()
export class ExamsService {
  private log = new Logger('Exams');
  constructor(private db: DbService, private learning: LearningService, private time: UserTimeService, private tools: AgentToolsService) {}

  async create(userId: string, b: { exam?: string; year?: number; question_ids?: string[]; duration_minutes?: number; title?: string; kind?: string; include_unreviewed?: boolean }) {
    const active = await this.db.one(`SELECT id FROM exams WHERE user_id=$1 AND status IN ('in_progress','paused')`, [userId]);
    if (active) throw new ConflictException({ message: '还有一场没交卷的模考，先继续或交卷', active_exam_id: active.id });
    let ids = b.question_ids ?? [];
    const spec = paperSpec(b.exam, b.year ? Number(b.year) : undefined);
    if (!ids.length) {
      if (!b.exam || !b.year) throw new BadRequestException('需要 exam + year（如 {"exam":"math1","year":2017}），或 question_ids');
      const all = (await this.db.query('SELECT id, number, review_status FROM questions WHERE exam=$1 AND year=$2 ORDER BY number', [b.exam, Number(b.year)])).rows;
      if (!all.length) throw new NotFoundException(`${b.year} 年${EXAM_CN[b.exam] ?? b.exam}还没导入`);
      // 整卷：每道题都要在库里且已核对（confirmed），否则 422 并列出缺哪几题
      const expected = Math.max(spec?.count ?? 0, ...all.map((r) => Number(r.number)));
      const byNo = new Map(all.map((r) => [Number(r.number), r]));
      const notImported: number[] = [], unreviewed: number[] = [];
      for (let n = 1; n <= expected; n++) {
        const r = byNo.get(n);
        if (!r) notImported.push(n); else if (r.review_status !== 'confirmed') unreviewed.push(n);
      }
      const missing = [...notImported, ...unreviewed].sort((x, y) => x - y);
      if (missing.length && !b.include_unreviewed) {
        throw new UnprocessableEntityException({
          message: `${b.year} 年${EXAM_CN[b.exam] ?? b.exam}还有 ${missing.length} 道题没核对完（第 ${missing.join('、')} 题），暂时凑不成整卷`,
          code: 'paper_incomplete', exam: b.exam, year: Number(b.year), missing_numbers: missing, unreviewed_numbers: unreviewed, not_imported_numbers: notImported,
        });
      }
      ids = all.filter((r) => b.include_unreviewed || r.review_status === 'confirmed').map((r) => r.id);
    }
    const minutes = b.duration_minutes ?? spec?.minutes ?? 180;
    try {
      return await this.db.tx(async (c) => {
        const e = (await c.query(
          `INSERT INTO exams(user_id,kind,title,exam,year,question_ids,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [userId, b.kind ?? 'paper', b.title ?? `${b.year ?? ''} ${EXAM_CN[b.exam ?? ''] ?? b.exam ?? '模考'}`.trim(), b.exam ?? 'custom', b.year ?? null, ids, minutes * 60])).rows[0];
        await c.query(`INSERT INTO exam_progress(exam_id,current_question_id,last_tick_at) VALUES($1,$2,now())`, [e.id, ids[0]]);
        return this.view(c, e.id, userId);
      });
    } catch (err: any) {
      // 两端同时开考：唯一索引兜底
      if (err?.code === '23505') {
        const a = await this.db.one(`SELECT id FROM exams WHERE user_id=$1 AND status IN ('in_progress','paused')`, [userId]);
        throw new ConflictException({ message: '还有一场没交卷的模考，先继续或交卷', active_exam_id: a?.id ?? null });
      }
      throw err;
    }
  }

  /** 组装给前端的视图；remaining_seconds 由服务端算 */
  async view(c: PoolClient | null, examId: string, userId: string) {
    checkId(examId);
    const q = c ?? this.db.pool;
    const r = (await q.query(
      `SELECT e.*, p.answers, p.current_question_id, p.elapsed_seconds, p.last_tick_at, p.last_client_seq, p.updated_at AS progress_updated_at,
              (SELECT COALESCE(sum(score),0)::float FROM questions WHERE id = ANY(e.question_ids)) AS max_score
         FROM exams e JOIN exam_progress p ON p.exam_id=e.id WHERE e.id=$1 AND e.user_id=$2`, [examId, userId])).rows[0];
    if (!r) throw new NotFoundException('模考不存在');
    let elapsed = r.elapsed_seconds;
    if (r.status === 'in_progress' && r.last_tick_at) elapsed += Math.min(Math.floor((Date.now() - new Date(r.last_tick_at).getTime()) / 1000), HEARTBEAT_CAP_SECONDS);
    const tz = await this.time.tz(userId);
    return {
      id: r.id, kind: r.kind, title: r.title, exam: r.exam, year: r.year, question_ids: r.question_ids, question_count: r.question_ids.length, max_score: r.max_score,
      status: r.status, duration_seconds: r.duration_seconds, elapsed_seconds: elapsed, remaining_seconds: Math.max(r.duration_seconds - elapsed, 0),
      server_time: new Date().toISOString(), started_at: r.started_at, submitted_at: r.submitted_at, abandoned_at: r.abandoned_at ?? null,
      started_date: studyDate(new Date(r.started_at), tz), submitted_date: r.submitted_at ? studyDate(new Date(r.submitted_at), tz) : null, timezone: tz,
      progress: { answers: r.answers, current_question_id: r.current_question_id, last_client_seq: Number(r.last_client_seq), updated_at: r.progress_updated_at },
      result: await this.backfillResult(q, r.result),
    };
  }

  /** 老成绩补字段：per_question.correct_answer（标准答案）、自评过的解答题 answered=true；没评完的不带教练一句话 */
  private async backfillResult(q: { query: PoolClient['query'] } | any, result: any) {
    const per: any[] | undefined = result?.per_question;
    if (!per?.length) return result;
    // 标准答案只给老成绩补；小问分值来源（sub_scores_source）每次按题库当前值给，行业专家改了 kp_tags 也能跟上
    const qrows = new Map<string, any>((await q.query('SELECT id, type, answer, sub_scores_source FROM questions WHERE id = ANY($1)', [per.map((p) => p.question_id)])).rows.map((x: any) => [x.id, x]));
    const rated = (p: any) => !!p.self_rating || (p.sub_scores ?? []).some((x: any) => x.self_rating);
    return {
      ...result,
      coach: result.pending_self_rating?.length ? null : result.coach ?? null,
      per_question: per.map((p) => ({
        ...p, correct_answer: p.correct_answer ?? qrows.get(p.question_id)?.answer ?? [], answered: !!p.answered || (!p.objective && rated(p)),
        sub_scores_source: qrows.has(p.question_id) ? qrows.get(p.question_id).sub_scores_source ?? null : p.sub_scores_source ?? null,
        // 主观题参考答案（参考译文 / 范文 / 解答题答案）按题库当前值给；客观题为 null（看 correct_answer）
        reference_answer: qrows.has(p.question_id) ? referenceAnswer(qrows.get(p.question_id)) : p.reference_answer ?? null,
      })),
    };
  }

  async active(userId: string) {
    const e = await this.db.one(`SELECT id FROM exams WHERE user_id=$1 AND status IN ('in_progress','paused') ORDER BY started_at DESC LIMIT 1`, [userId]);
    return e ? this.view(null, e.id, userId) : null;
  }

  /** 模考历史（新的在前），cursor 是上一页最后一条的 next_cursor */
  async history(userId: string, limitRaw?: string, cursor?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
    const p: any[] = [userId];
    let w = 'e.user_id=$1';
    if (cursor) {
      let cur: { t: string; id: string };
      try { cur = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new BadRequestException('cursor 无效'); }
      if (!cur?.t || !cur?.id) throw new BadRequestException('cursor 无效');
      p.push(cur.t, cur.id); w += ` AND (e.started_at, e.id) < ($2::timestamptz, $3::uuid)`;
    }
    p.push(limit + 1);
    const rows = (await this.db.query(
      `SELECT e.id, e.kind, e.title, e.exam, e.year, e.status, e.duration_seconds, e.started_at, e.submitted_at, e.abandoned_at, e.question_ids,
              to_char(e.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at_cursor,
              p.elapsed_seconds, p.last_tick_at, e.result->'score' AS score,
              (SELECT count(*)::int FROM jsonb_each(p.answers) a WHERE jsonb_array_length(COALESCE(a.value->'answer','[]'::jsonb)) > 0) AS answered_count, e.result->'max_score' AS max_score,
              e.result->'pending_self_rating' AS pending, e.result->'coach' AS coach,
              (SELECT COALESCE(sum(score),0)::float FROM questions WHERE id = ANY(e.question_ids)) AS paper_max
         FROM exams e JOIN exam_progress p ON p.exam_id=e.id WHERE ${w}
        ORDER BY e.started_at DESC, e.id DESC LIMIT $${p.length}`, p)).rows;
    const tz = await this.time.tz(userId);
    const page = rows.slice(0, limit);
    const items = page.map((r: any) => {
      let elapsed = r.elapsed_seconds;
      if (r.status === 'in_progress' && r.last_tick_at) elapsed += Math.min(Math.floor((Date.now() - new Date(r.last_tick_at).getTime()) / 1000), HEARTBEAT_CAP_SECONDS);
      return {
        id: r.id, kind: r.kind, title: r.title, exam: r.exam, year: r.year, status: r.status, question_count: r.question_ids.length,
        score: r.score ?? null, max_score: r.max_score ?? r.paper_max, pending_self_rating_count: Array.isArray(r.pending) ? r.pending.length : 0,
        elapsed_seconds: elapsed, duration_seconds: r.duration_seconds, started_at: r.started_at, submitted_at: r.submitted_at, abandoned_at: r.abandoned_at ?? null,
        answered_count: r.answered_count ?? 0,
        started_date: studyDate(new Date(r.started_at), tz), coach_headline: r.coach?.headline ?? null,
      };
    });
    const last = page[page.length - 1];
    const next = rows.length > limit && last ? Buffer.from(JSON.stringify({ t: last.started_at_cursor, id: last.id })).toString('base64url') : null;
    return { items, next_cursor: next, timezone: tz };
  }

  /**
   * 保存进度（幂等）：
   * - 同一个 idempotency_key 重发 → 原样返回第一次的结果，不重复生效
   * - client_seq 比服务端已有的小（乱序到达的旧请求）→ 不覆盖答案，但仍计时
   * - 每道题保留 seq 最大的答案
   */
  async saveProgress(userId: string, examId: string, b: ProgressBody) {
    checkId(examId);
    if (!b?.idempotency_key) throw new BadRequestException('缺少 idempotency_key');
    if (typeof b.client_seq !== 'number') throw new BadRequestException('缺少 client_seq（客户端递增序号）');
    if (b.state && !['running', 'paused'].includes(b.state)) throw new BadRequestException('state 只能是 running/paused');
    return this.db.tx(async (c) => {
      const e = (await c.query(`SELECT e.*, p.* FROM exams e JOIN exam_progress p ON p.exam_id=e.id WHERE e.id=$1 AND e.user_id=$2 FOR UPDATE`, [examId, userId])).rows[0];
      if (!e) throw new NotFoundException('模考不存在');
      const prev = (await c.query('SELECT response FROM exam_progress_ops WHERE exam_id=$1 AND idempotency_key=$2', [examId, b.idempotency_key])).rows[0];
      if (prev) return { ...prev.response, duplicate: true };
      if (e.status === 'submitted' || e.status === 'abandoned') throw new ConflictException({ message: '这场模考已经结束', status: e.status });

      // 计时
      const now = Date.now();
      let elapsed = e.elapsed_seconds;
      if (e.status === 'in_progress' && e.last_tick_at) elapsed += Math.min(Math.floor((now - new Date(e.last_tick_at).getTime()) / 1000), HEARTBEAT_CAP_SECONDS);
      const nextStatus = b.state === 'paused' ? 'paused' : b.state === 'running' ? 'in_progress' : e.status;

      // 合并答案
      const answers = { ...(e.answers || {}) };
      const stale = b.client_seq <= Number(e.last_client_seq);
      const allowed = new Set<string>(e.question_ids);
      for (const a of b.answers ?? []) {
        if (!allowed.has(a.question_id)) throw new BadRequestException(`题目 ${a.question_id} 不在这场模考里`);
        const old = answers[a.question_id];
        if (old && old.client_seq >= b.client_seq) continue; // 同序号或更旧的重发不覆盖
        answers[a.question_id] = { answer: a.answer ?? [], time_spent_seconds: a.time_spent_seconds ?? old?.time_spent_seconds ?? null, flagged: a.flagged ?? old?.flagged ?? false, client_seq: b.client_seq, saved_at: new Date(now).toISOString() };
      }
      await c.query(
        `UPDATE exam_progress SET answers=$2, current_question_id=COALESCE($3,current_question_id), elapsed_seconds=$4,
           last_tick_at=$5, last_client_seq=GREATEST(last_client_seq,$6), updated_at=now() WHERE exam_id=$1`,
        [examId, JSON.stringify(answers), stale ? null : b.current_question_id ?? null, elapsed, nextStatus === 'in_progress' ? new Date(now) : null, b.client_seq]);
      if (nextStatus !== e.status) await c.query('UPDATE exams SET status=$2 WHERE id=$1', [examId, nextStatus]);
      const view = await this.view(c, examId, userId);
      const response = { ...view, stale };
      await c.query('INSERT INTO exam_progress_ops(exam_id,idempotency_key,client_seq,response) VALUES($1,$2,$3,$4)', [examId, b.idempotency_key, b.client_seq, JSON.stringify(response)]);
      return { ...response, duplicate: false };
    });
  }

  /**
   * 校验自评（交卷时附带的 / 交卷后补的同一套规则），返回规范化后的 { qid: string | {小问号: rating} }。
   * 接受的写法（前端各版本实际发过的都兼容）：
   * - 整题：{"math1-2017-18": "full"}；计算题给整题值 = 每个小问都按这个值
   * - 按小问：{"math1-2017-19": {"2": "full"}}，小问键可以是 2 / "2" / "(2)" / "（2）" / "第2问" / "sub2" / "ii" / "Ⅱ" / "②" / "二"
   * - 按小问数组：[{"sub_number": 2, "self_rating": "full"}]（也认 number/sub/rating），或按顺序 ["full", null]
   * - 组合键：{"math1-2017-19:2": "full"}（也认 # / . 分隔和 "math1-2017-19(2)"）
   * - 值为 null 表示这一项先不评（跳过，不报错）；只评一部分小问时，和之前评过的小问合并，不会清掉之前的
   */
  private normalizeRatings(per: PerQuestion[], qs: Map<string, any>, ratings: RatingInput | undefined) {
    const out = new Map<string, SelfRating | Record<string, SelfRating>>();
    if (ratings == null) return out;
    if (typeof ratings !== 'object' || Array.isArray(ratings)) throw new BadRequestException('self_ratings 应为 {question_id: rating 或 {小问号: rating}}');
    const byId = new Map(per.map((p) => [p.question_id, p]));
    const checkVal = (v: any) => {
      const t = typeof v === 'string' ? v.trim() : v;
      if (!RATINGS.includes(t)) throw new BadRequestException(`self_rating 只能是 ${RATINGS.join('/')}（收到 ${JSON.stringify(v)}）`);
      return t as SelfRating;
    };
    // 先把组合键拆开、数组转成对象，按题合并
    const merged = new Map<string, { whole?: SelfRating; subs: [string, any][] }>();
    const slot = (qid: string) => { const m = merged.get(qid) ?? { subs: [] }; merged.set(qid, m); return m; };
    for (const [rawKey, r] of Object.entries(ratings as Record<string, any>)) {
      let qid = rawKey.trim(), subKey: string | null = null;
      if (!byId.has(qid)) {
        const m = /^(.+?)(?:\s*[:#./]\s*|\s*[(（]\s*)([^()（）:#./]+?)\s*[)）]?$/.exec(qid);
        if (m && byId.has(m[1])) { qid = m[1]; subKey = m[2]; }
      }
      const p = byId.get(qid);
      if (!p) throw new BadRequestException(`题目 ${rawKey} 不在这场模考里`);
      if (p.objective) throw new BadRequestException(`第 ${p.number} 题是客观题，自动判分，不用自评`);
      if (r == null) continue; // 先不评
      if (subKey != null) { slot(qid).subs.push([subKey, r]); continue; }
      if (typeof r === 'string') { slot(qid).whole = checkVal(r); continue; }
      if (Array.isArray(r)) {
        r.forEach((x, i) => {
          if (x == null) return;
          if (typeof x === 'string') slot(qid).subs.push([String(i + 1), x]);
          else if (typeof x === 'object') slot(qid).subs.push([String(x.sub_number ?? x.number ?? x.sub ?? x.key ?? i + 1), x.self_rating ?? x.rating ?? x.value ?? null]);
          else throw new BadRequestException(`第 ${p.number} 题的自评格式不对`);
        });
        continue;
      }
      if (typeof r !== 'object') throw new BadRequestException(`第 ${p.number} 题的自评格式不对`);
      for (const kv of Object.entries(r)) slot(qid).subs.push(kv);
    }
    for (const [qid, m] of merged) {
      const p = byId.get(qid)!;
      const subs = ((qs.get(qid)?.sub_questions ?? []) as any[]).map((s) => String(s.number));
      const subMap: Record<string, SelfRating> = {};
      if (m.whole) {
        if (p.score_by_whole || !subs.length) { if (m.subs.some(([, v]) => v != null)) throw new BadRequestException(`第 ${p.number} 题按整题自评，不要再按小问给`); out.set(qid, m.whole); continue; }
        for (const n of subs) subMap[n] = m.whole; // 计算题给整题值 → 每个小问都按这个值
      }
      const given = m.subs.filter(([, v]) => v != null);
      if (given.length) {
        if (p.score_by_whole) throw new BadRequestException(`第 ${p.number} 题是证明题，按整题自评（self_ratings 里给一个值，不要按小问给）`);
        if (!subs.length) throw new BadRequestException(`第 ${p.number} 题没有小问，按整题自评`);
      }
      for (const [k, v] of given) {
        const n = subKeyOf(k, subs);
        if (!n) throw new BadRequestException(`第 ${p.number} 题没有第 ${k} 小问（有 ${subs.join('、')}）`);
        subMap[n] = checkVal(v);
      }
      if (Object.keys(subMap).length) out.set(qid, subMap);
    }
    return out;
  }

  /** 进错题本的题标上来源 exam */
  private async tagWrong(c: PoolClient, examId: string, rec: any) {
    if (rec?.is_correct === false && rec.wrong_question_id) {
      await c.query(`UPDATE wrong_questions SET source='exam', source_exam_id=$2 WHERE id=$1`, [rec.wrong_question_id, examId]);
    }
  }

  /** 把规范化后的自评写进作答记录（走 LearningService：错题本 / 掌握度照常），并更新 per_question。同一值重复自评不再记 */
  private async applyRatings(c: PoolClient, userId: string, examId: string, per: PerQuestion[], qs: Map<string, any>, ratings: Map<string, SelfRating | Record<string, SelfRating>>, opKey: string, device?: string) {
    for (const [qid, r] of ratings) {
      const p = per.find((x) => x.question_id === qid)!;
      const q = qs.get(qid);
      const common = { question_id: qid, answer: p.answer, exam_id: examId, time_spent_seconds: null as number | null };
      if (typeof r === 'string') {
        if (p.self_rating === r) continue;
        const rec: any = await this.learning.recordAnswer(c, userId, { ...common, self_rating: r, time_spent_seconds: p.time_spent_seconds || null, client_id: `exam:${examId}:${qid}:r:${opKey}` }, device);
        await this.tagWrong(c, examId, rec);
        p.self_rating = r; p.got = rec.points ?? 0; p.is_correct = r === 'full'; p.answered = true; // 自评过 = 做过（答案多半写在纸上）
        if (rec.wrong_question_id) p.wrong_question_id = rec.wrong_question_id;
        continue;
      }
      p.sub_scores = p.sub_scores ?? ((q.sub_questions ?? []) as any[]).map((s) => ({ sub_number: Number(s.number), score: s.score ?? null, score_estimated: !!s.score_estimated, self_rating: null, got: null }));
      for (const [n, v] of Object.entries(r)) {
        const s = p.sub_scores.find((x) => String(x.sub_number) === String(n))!;
        if (s.self_rating === v) continue;
        const rec: any = await this.learning.recordAnswer(c, userId, { ...common, sub_number: Number(n), self_rating: v, client_id: `exam:${examId}:${qid}:${n}:r:${opKey}` }, device);
        await this.tagWrong(c, examId, rec);
        s.self_rating = v; s.got = rec.points ?? 0; if (rec.max_points != null) s.score = rec.max_points;
        if (rec.wrong_question_id) p.wrong_question_id = rec.wrong_question_id;
      }
      const rated = p.sub_scores.filter((s) => s.self_rating);
      if (rated.length) { p.answered = true; p.self_rating = null; } // 按小问评了就以小问为准
      p.got = rated.length ? Math.round(rated.reduce((t, s) => t + (s.got ?? 0), 0) * 2) / 2 : null;
      p.is_correct = rated.length < p.sub_scores.length ? null : p.sub_scores.every((s) => s.self_rating === 'full');
    }
  }

  private async loadQuestions(c: PoolClient, ids: string[]) {
    const rows = (await c.query('SELECT id,number,type,section,score::float score,answer,score_by_whole,score_estimated,sub_scores_source,sub_questions,knowledge_points FROM questions WHERE id = ANY($1)', [ids])).rows;
    return new Map<string, any>(rows.map((q: any) => [q.id, q]));
  }

  private async lockExam(c: PoolClient, examId: string, userId: string) {
    checkId(examId);
    const e = (await c.query(`SELECT e.*, p.answers, p.elapsed_seconds, p.last_tick_at FROM exams e JOIN exam_progress p ON p.exam_id=e.id WHERE e.id=$1 AND e.user_id=$2 FOR UPDATE OF e`, [examId, userId])).rows[0];
    if (!e) throw new NotFoundException('模考不存在');
    return e;
  }

  /** 交卷：客观题自动判分，主观题等自评（可以随交卷一起给，也可以交卷后 POST /self-ratings）；出成绩汇总 */
  async submit(userId: string, examId: string, b: { self_ratings?: RatingInput; idempotency_key?: string }, device?: string) {
    const out = await this.db.tx(async (c) => {
      const e = await this.lockExam(c, examId, userId);
      if (e.status === 'submitted') return { done: true as const }; // 重复交卷：直接返回结果
      if (e.status === 'abandoned') throw new ConflictException({ message: '这场模考已经放弃', status: e.status });
      let elapsed = e.elapsed_seconds;
      if (e.status === 'in_progress' && e.last_tick_at) elapsed += Math.min(Math.floor((Date.now() - new Date(e.last_tick_at).getTime()) / 1000), HEARTBEAT_CAP_SECONDS);
      const qs = await this.loadQuestions(c, e.question_ids);
      const per: PerQuestion[] = [...qs.values()].sort((x, y) => x.number - y.number).map((q) => {
        const a = e.answers?.[q.id];
        const objective = /choice|fill/.test(q.type) || q.type === 'match'; // match：英语阅读 B
        const ans: string[] = (a?.answer ?? []).filter((x: any) => String(x ?? '').trim() !== '');
        return {
          question_id: q.id, number: q.number, type: q.type, section: sectionOf(q), objective, score: q.score ?? 0,
          score_by_whole: !!q.score_by_whole, score_estimated: !!q.score_estimated, sub_scores_source: q.sub_scores_source ?? null, subject: subjectOf(q.knowledge_points), knowledge_points: q.knowledge_points ?? [],
          answered: ans.length > 0, answer: a?.answer ?? [], correct_answer: q.answer ?? [], reference_answer: referenceAnswer(q), time_spent_seconds: a?.time_spent_seconds ?? 0,
          is_correct: null, got: null, ...(objective ? {} : { self_rating: null }),
        };
      });
      const ratings = this.normalizeRatings(per, qs, b?.self_ratings); // 先校验再写库
      // 客观题判分（没作答 = 错，也进错题本）
      for (const p of per.filter((x) => x.objective)) {
        const rec: any = await this.learning.recordAnswer(c, userId, { question_id: p.question_id, answer: p.answer, exam_id: examId, self_rating: null, time_spent_seconds: p.time_spent_seconds || null, client_id: `exam:${examId}:${p.question_id}` }, device);
        await this.tagWrong(c, examId, rec);
        p.is_correct = !!rec.is_correct; p.got = rec.points ?? 0; p.wrong_question_id = rec.wrong_question_id ?? null;
      }
      await this.applyRatings(c, userId, examId, per, qs, ratings, 'submit', device);
      const result = { ...summarize(per, { title: e.title, duration_seconds: e.duration_seconds, elapsed_seconds: elapsed }), coach: null as any, self_rated_at: ratings.size ? new Date().toISOString() : null };
      await c.query(`UPDATE exams SET status='submitted', submitted_at=now(), result=$2 WHERE id=$1`, [examId, JSON.stringify(result)]);
      await c.query(`UPDATE exam_progress SET elapsed_seconds=$2, last_tick_at=NULL, updated_at=now() WHERE exam_id=$1`, [examId, elapsed]);
      return { done: false as const, result, title: e.title };
    });
    if (!out.done && !out.result.pending_self_rating.length) await this.writeCoach(userId, examId, out.result, out.title);
    return this.view(null, examId, userId);
  }

  /** 交卷后自评（幂等；同一题再评一次覆盖上一次），重算成绩汇总；全部自评完写教练复盘 */
  async selfRate(userId: string, examId: string, b: { self_ratings?: RatingInput; idempotency_key?: string }, device?: string) {
    if (!b?.idempotency_key) throw new BadRequestException('缺少 idempotency_key');
    if (!b.self_ratings || typeof b.self_ratings !== 'object' || !Object.keys(b.self_ratings).length) throw new BadRequestException('self_ratings 不能为空');
    const opKey = `self-ratings:${b.idempotency_key}`;
    const out = await this.db.tx(async (c) => {
      const e = await this.lockExam(c, examId, userId);
      const prev = (await c.query('SELECT response FROM exam_progress_ops WHERE exam_id=$1 AND idempotency_key=$2', [examId, opKey])).rows[0];
      if (prev) return { duplicate: true as const, response: prev.response };
      if (e.status !== 'submitted' || !e.result) throw new ConflictException({ message: '先交卷再自评', status: e.status });
      const qs = await this.loadQuestions(c, e.question_ids);
      const per: PerQuestion[] = e.result.per_question;
      const ratings = this.normalizeRatings(per, qs, b.self_ratings);
      await this.applyRatings(c, userId, examId, per, qs, ratings, b.idempotency_key!.slice(0, 80), device);
      const summary = summarize(per, { title: e.title, duration_seconds: e.duration_seconds, elapsed_seconds: e.result.elapsed_seconds ?? e.elapsed_seconds });
      // 还有没评的：教练一句话不能出（以前写过的撤掉）
      if (summary.pending_self_rating.length && e.result.coach) await this.dropCoach(c, examId, e.result.coach);
      const result = { ...summary, coach: summary.pending_self_rating.length ? null : e.result.coach ?? null, self_rated_at: new Date().toISOString() };
      await c.query(`UPDATE exams SET result=$2 WHERE id=$1`, [examId, JSON.stringify(result)]);
      return { duplicate: false as const, result, title: e.title };
    });
    if (out.duplicate) return { ...out.response, duplicate: true };
    if (!out.result.pending_self_rating.length) await this.writeCoach(userId, examId, out.result, out.title);
    const view = await this.view(null, examId, userId);
    await this.db.query('INSERT INTO exam_progress_ops(exam_id,idempotency_key,client_seq,response) VALUES($1,$2,NULL,$3) ON CONFLICT DO NOTHING', [examId, opKey, JSON.stringify(view)]);
    return { ...view, duplicate: false };
  }

  /** 撤掉一条为没评完的模考写的教练消息（别的模考还引用它就只解除引用） */
  private async dropCoach(c: PoolClient, examId: string, coach: any) {
    const id = coach?.message_id;
    if (!id || !UUID_RE.test(id)) return;
    const other = (await c.query(`SELECT 1 FROM exams WHERE id<>$1 AND result->'coach'->>'message_id'=$2 LIMIT 1`, [examId, id])).rows[0];
    if (!other) await c.query(`DELETE FROM daily_tips WHERE id=$1 AND kind='exam_review'`, [id]);
  }

  /** 放弃这场：不判分、不进错题本，保留进度；腾出「进行中」的位置 */
  async abandon(userId: string, examId: string) {
    await this.db.tx(async (c) => {
      const e = await this.lockExam(c, examId, userId);
      if (e.status === 'abandoned') return; // 重复放弃：幂等
      if (e.status === 'submitted') throw new ConflictException({ message: '已经交卷，不能放弃', status: e.status });
      let elapsed = e.elapsed_seconds;
      if (e.status === 'in_progress' && e.last_tick_at) elapsed += Math.min(Math.floor((Date.now() - new Date(e.last_tick_at).getTime()) / 1000), HEARTBEAT_CAP_SECONDS);
      await c.query(`UPDATE exams SET status='abandoned', abandoned_at=now() WHERE id=$1`, [examId]);
      await c.query(`UPDATE exam_progress SET elapsed_seconds=$2, last_tick_at=NULL, updated_at=now() WHERE exam_id=$1`, [examId, elapsed]);
    });
    return this.view(null, examId, userId);
  }

  /** 教练一句话：写成 kind=exam_review 的主动消息（GET /agent/messages 能看到），id/headline 回填到 result.coach */
  private async writeCoach(userId: string, examId: string, result: ReturnType<typeof summarize>, title: string) {
    if (result.pending_self_rating.length) return; // 没评完不出教练一句话
    try {
      const headline = coachHeadline(result, title);
      const w = await this.tools.writeDailyTip({ userId, commandId: null, trigger: 'after_exam' }, { text: headline, kind: 'exam_review', details: coachDetails(result), reason: `${title}模考交卷后的复盘` });
      const tip = await this.db.one(`SELECT id, headline FROM daily_tips WHERE user_id=$1 AND tip_date=$2 AND kind='exam_review'`, [userId, w.date]);
      const coach = { message_id: tip?.id ?? null, headline, date: w.date, kind: 'exam_review' };
      await this.db.query(`UPDATE exams SET result = jsonb_set(result, '{coach}', $2::jsonb) WHERE id=$1`, [examId, JSON.stringify(coach)]);
    } catch (err: any) {
      this.log.warn(`exam ${examId} coach message failed: ${err?.message}`);
    }
  }

  /** PDF 报告用：成绩 + 错题（带题干、答案、讲解） */
  async reportData(userId: string, examId: string) {
    const view = await this.view(null, examId, userId);
    if (view.status !== 'submitted' || !view.result) throw new ConflictException({ message: '交卷后才能导出成绩报告', status: view.status });
    const wrongIds: string[] = view.result.wrong_question_ids ?? [];
    const rows = wrongIds.length ? (await this.db.query(
      `SELECT q.id, q.id AS question_id, q.exam, q.year, q.number, q.type, q.score::float score, q.score_by_whole, q.score_estimated, q.sub_scores_source, ${subScoresSql('q.')}, q.stem, q.tables, q.errata, q.options, q.answer, q.sub_questions,
              q.solution, q.review_status, q.review_checked_by, q.knowledge_points, q.source->>'assets_dir' AS assets_dir
         FROM questions q WHERE q.id = ANY($1) ORDER BY q.number`, [wrongIds])).rows : [];
    return { view, wrong: rows, today: await this.time.today(userId) };
  }
}
