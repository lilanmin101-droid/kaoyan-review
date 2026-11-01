import { Injectable, NotFoundException } from '@nestjs/common';
import { badRequest } from '../common/http-error.filter';
import { DbService } from '../db/db.service';
import { LearningService } from '../mastery/learning.service';
import { chat, isConfigured, parseJsonLoose } from '../ai/llm';
import { buildGradeMessages, countFor, countWords, disagrees, FAILED_GRADE_TEXT, fakeGrade, GradeKind, GradeResult, MAX_SCORE, normalizeGrade, PENDING_GRADE_TEXT, BAND_NAMES } from '../english/ai-grader';
import { gradingKind } from '../english/english-spec';
import { withTablesText } from '../common/tables';

export const aiFake = () => process.env.AI_FAKE === '1';
type Progress = (stage: string, data?: any) => void;

/** 翻译 / 作文 AI 批改：DeepSeek 主评 → 通义千问复评（有 Key 时）→ 存 answer_gradings → 错题本 + 掌握度 */
@Injectable()
export class GradingService {
  constructor(private db: DbService, private learning: LearningService) {}

  async load(userId: string, answerId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(answerId)) throw badRequest('answer id 格式不对', 'id', 'invalid_id');
    const a = await this.db.one(
      `SELECT a.id, a.user_id, a.question_id, a.answer, a.answered_at, a.exam_id, q.exam, q.year, q.number, q.section, q.type, q.stem, q.tables, q.answer AS reference, q.score::float score, q.passage_id
         FROM answer_records a JOIN questions q ON q.id=a.question_id WHERE a.id=$1 AND a.user_id=$2`, [answerId, userId]);
    if (!a) throw new NotFoundException('作答记录不存在');
    const kind = gradingKind(a);
    if (!kind) throw badRequest('这道题不需要 AI 批改（只批翻译和作文）', 'question_id', 'not_gradable');
    return { a, kind };
  }

  async get(userId: string, answerId: string) {
    const { a, kind } = await this.load(userId, answerId);
    const g = await this.db.one(`SELECT * FROM answer_gradings WHERE answer_id=$1`, [answerId]);
    return g ? present(g) : { answer_id: a.id, question_id: a.question_id, kind, status: 'not_requested', max_score: MAX_SCORE[kind], result: null };
  }

  /** 批改（幂等：已经 done 的直接返回，force=true 才重批，重批不重复计入错题本/掌握度） */
  async grade(userId: string, answerId: string, opts: { force?: boolean; device?: string } = {}, progress: Progress = () => {}) {
    const { a, kind } = await this.load(userId, answerId);
    const prev = await this.db.one(`SELECT * FROM answer_gradings WHERE answer_id=$1`, [answerId]);
    if (prev?.status === 'done' && !opts.force) return present(prev);
    const text = (Array.isArray(a.answer) ? a.answer : [a.answer]).filter((x: any) => x != null).map(String).join('\n').trim();
    const max = MAX_SCORE[kind];
    const upsert = async (f: Record<string, any>) => this.db.one(
      `INSERT INTO answer_gradings(answer_id,user_id,question_id,kind,status,result,cross_check,disagreement,score,max_score,model,error,attempts,wrong_question_id,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,now())
       ON CONFLICT (answer_id) DO UPDATE SET status=EXCLUDED.status,result=EXCLUDED.result,cross_check=EXCLUDED.cross_check,disagreement=EXCLUDED.disagreement,
         score=EXCLUDED.score,model=EXCLUDED.model,error=EXCLUDED.error,attempts=answer_gradings.attempts+1,
         wrong_question_id=COALESCE(EXCLUDED.wrong_question_id, answer_gradings.wrong_question_id),updated_at=now()
       RETURNING *`,
      [a.id, userId, a.question_id, kind, f.status, f.result ? JSON.stringify(f.result) : null, f.cross_check ? JSON.stringify(f.cross_check) : null,
        !!f.disagreement, f.score ?? null, max, f.model ?? null, f.error ?? null, f.wrong_question_id ?? null]);

    // 没有 DeepSeek Key（也不是测试假模型）：只记 pending，不给任何分数
    if (!aiFake() && !isConfigured('deepseek')) return present(await upsert({ status: 'pending' }));

    const words = countFor(kind, text); // 翻译（英译汉）数汉字 + 英文词，作文数英文词
    const prow = a.passage_id ? await this.db.one(`SELECT text, tables FROM passages WHERE id=$1`, [a.passage_id]) : null;
    const passageText = prow ? withTablesText(prow.text, prow.tables) : null;
    const q = { stem: withTablesText(a.stem, a.tables), answer: a.reference ?? [], passage_text: passageText };
    let result: GradeResult;
    try {
      progress('grading', { model: aiFake() ? 'fake-grader-v1' : 'deepseek' });
      result = await this.runModel('deepseek', kind, q, text, words);
    } catch (e: any) {
      return present(await upsert({ status: 'failed', error: String(e?.message ?? e).slice(0, 500) }));
    }
    let cross: any = null, dis = false;
    if (aiFake() || isConfigured('qwen')) {
      try {
        progress('cross_check', { model: aiFake() ? 'fake-qwen-v1' : 'qwen' });
        const r2 = await this.runModel('qwen', kind, q, text, words);
        dis = disagrees(kind, result, r2);
        cross = { band: r2.band, score: r2.score, model: r2.model, band_reason: r2.band_reason };
      } catch (e: any) { cross = { error: String(e?.message ?? e).slice(0, 300) }; }
    }
    // 错题本 + 掌握度：只在第一次出分时计入（重批不重复）
    let wrongId: string | null = null, wrongStatus: string | null = null;
    const first = prev?.status !== 'done';
    if (first) {
      const out = await this.db.tx((c) => this.learning.applyGradedOutcome(c, userId, a.question_id, result.score / max, new Date(a.answered_at), opts.device));
      wrongId = out.wrong?.id ?? null; wrongStatus = out.wrong?.status ?? null;
    }
    const g = await upsert({ status: 'done', result, cross_check: cross, disagreement: dis, score: result.score, model: result.model, wrong_question_id: wrongId });
    return { ...present(g), wrong_question_status: wrongStatus, counted: first };
  }

  private runModel(p: 'deepseek' | 'qwen', kind: GradeKind, q: any, text: string, words: number): Promise<GradeResult> {
    return gradeWithModel(p, kind, q, text, words);
  }
}

/** 单个模型批一份作答（主评/复评、评测脚本 eval:grading 都走这里）；AI_FAKE=1 用确定性假模型 */
export async function gradeWithModel(p: 'deepseek' | 'qwen', kind: GradeKind, q: { stem: string; answer?: string[]; passage_text?: string | null },
  text: string, words: number = countFor(kind, text)): Promise<GradeResult> {
  if (aiFake()) return normalizeGrade(fakeGrade(kind, q, text, p === 'deepseek' ? 'primary' : 'cross'), kind, p === 'deepseek' ? 'fake-grader-v1' : 'fake-qwen-v1', words);
  const messages = buildGradeMessages(kind, q, text, words);
  let lastErr: any;
  for (let i = 0; i < 2; i++) { // JSON 不合格重试一次
    const r = await chat(p, { messages, json: true, temperature: 0.2, maxTokens: 1800 });
    try { return normalizeGrade(parseJsonLoose(r.text), kind, r.model, words); } catch (e) { lastErr = e; }
  }
  throw new Error(`模型输出不符合批改格式：${String(lastErr?.message ?? lastErr).slice(0, 200)}`);
}

/** 给前端的批改结果 */
export function present(g: any) {
  const status = g.status;
  const r = g.result;
  return {
    id: g.id, answer_id: g.answer_id, question_id: g.question_id, kind: g.kind, status,
    notice: status === 'pending' ? PENDING_GRADE_TEXT : status === 'failed' ? FAILED_GRADE_TEXT : null,
    text: status === 'pending' ? PENDING_GRADE_TEXT : status === 'failed' ? FAILED_GRADE_TEXT : null,
    score: g.score == null ? null : Number(g.score), max_score: Number(g.max_score),
    band: r?.band ?? null, band_name: r?.band == null ? null : BAND_NAMES[r.band],
    result: r ?? null, cross_check: g.cross_check ?? null, disagreement: !!g.disagreement,
    needs_review: !!g.disagreement, wrong_question_id: g.wrong_question_id ?? null,
    model: g.model ?? null, error: status === 'failed' ? g.error : null, attempts: g.attempts, updated_at: g.updated_at,
  };
}
