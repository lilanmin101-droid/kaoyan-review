import { Controller, Get, Headers, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { UserTimeService } from '../common/user-time.service';
import { renderDeep } from '../common/time';
import { clockNow } from '../common/clock';
import { assetBaseFor } from '../common/assets';
import { ENGLISH_SECTION_NAME } from '../english/english-spec';
import { loadPassages } from '../questions/passages';
import { isObjectiveType, referenceAnswer } from '../questions/reference-answer';
import { AI_VERIFIED_LABEL, officialSolution } from '../ai/explain';
import { WordsController } from '../words/words.controller';
import { assetUrls, packVersion, stepsText } from './offline';

/** 今日阅读 / 完形：这几部分按文章整篇带 */
export const PACK_SECTIONS = { cloze: ['use_of_english'], reading: ['reading_a', 'reading_b'] };
const READ_SECTIONS = [...PACK_SECTIONS.cloze, ...PACK_SECTIONS.reading];
export const WRONG_REDO_LIMIT = 10;
const Q_COLS = `id,exam,year,number,section,type,score::float score,stem,tables,errata,images,options,answer,sub_questions,solution,knowledge_points,source,passage_id,review_status,review_checked_by`;

/**
 * 离线题包：今天计划里的阅读 + 完形（整篇带全部小题；计划没指定就自动挑一篇完形 + 一篇阅读），最多 10 道错题重做，今日单词。
 * 每题带本地判分 / 看讲解要的东西；讲解只给库里已有的（不现场生成），没有 → explanation_status=pending。不含模考、不给整个题库。
 */
@Controller('offline')
@UseGuards(JwtGuard)
export class OfflineController {
  constructor(private db: DbService, private time: UserTimeService) {}

  @Get('pack')
  async pack(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('since_version') since?: string, @Headers('if-none-match') inm?: string) {
    const p = await this.build(u);
    res.setHeader('ETag', `"${p.version}"`);
    res.setHeader('Cache-Control', 'private, no-cache');
    const tags = String(inm ?? '').split(',').map((t) => t.trim().replace(/^W\//, '').replace(/"/g, '')).filter(Boolean);
    if (since === p.version || tags.includes(p.version) || tags.includes('*')) return res.status(304).end();
    res.status(200).json(renderDeep(p, p.study_date));
  }

  async build(u: AuthUser) {
    const day = await this.time.day(u.id);
    const today = day.date;
    const tasks = (await this.db.query(
      `SELECT t.kind, t.payload FROM plan_tasks t JOIN study_plans p ON p.id=t.plan_id WHERE p.user_id=$1 AND p.plan_date=$2 AND t.status <> 'skipped' AND t.kind <> 'mock_exam' ORDER BY t.sort_order, t.id`,
      [u.id, today])).rows;
    const planQids = new Set<string>(), planPassages = new Set<string>(), redoFirst: string[] = [];
    for (const t of tasks) {
      const pl = t.payload ?? {};
      for (const id of Array.isArray(pl.question_ids) ? pl.question_ids : []) (t.kind === 'redo_wrong' ? redoFirst : null)?.push(id) ?? planQids.add(id);
      for (const id of [pl.passage_id, ...(Array.isArray(pl.passage_ids) ? pl.passage_ids : [])]) if (typeof id === 'string') planPassages.add(id);
    }
    // 计划里点到的英语题 → 它所在的文章（只要阅读 / 完形）
    if (planQids.size) for (const r of (await this.db.query(`SELECT passage_id FROM questions WHERE id = ANY($1) AND passage_id IS NOT NULL AND section = ANY($2)`, [[...planQids], READ_SECTIONS])).rows) planPassages.add(r.passage_id);
    const pinfo = planPassages.size ? (await this.db.query(`SELECT id, section FROM passages WHERE id = ANY($1) AND section = ANY($2)`, [[...planPassages], READ_SECTIONS])).rows : [];
    const chosen: { id: string; pick: 'plan' | 'auto' }[] = pinfo.map((r: any) => ({ id: r.id, pick: 'plan' as const }));
    // 计划没指定完形 / 阅读：各挑一篇整卷已核对、今天之前没做过（做得最少）的，最新年份在前。只看今天 04:00 前的作答，免得当天做了一题包就换
    for (const [kind, secs] of Object.entries(PACK_SECTIONS)) {
      if (pinfo.some((r: any) => secs.includes(r.section))) continue;
      const pick = await this.db.one(
        `SELECT p.id FROM passages p
          WHERE p.section = ANY($2) AND p.exam LIKE 'english%'
            AND EXISTS (SELECT 1 FROM questions q WHERE q.passage_id=p.id)
            AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.passage_id=p.id AND q.review_status <> 'confirmed')
          ORDER BY (SELECT count(*) FROM answer_records a JOIN questions q ON q.id=a.question_id WHERE a.user_id=$1 AND q.passage_id=p.id AND a.answered_at < $3),
                   p.year DESC, p.section, p.sort_order, p.id
          LIMIT 1`, [u.id, kind === 'cloze' ? secs : ['reading_a'], day.start]);
      if (pick) chosen.push({ id: pick.id, pick: 'auto' });
    }
    const passageQs = chosen.length ? (await this.db.query(`SELECT ${Q_COLS} FROM questions WHERE passage_id = ANY($1) ORDER BY year DESC, number`, [chosen.map((c) => c.id)])).rows : [];
    // 错题重做：计划里 redo_wrong 点名的在前，再是到期复习的（已掌握、due_at 在今天结束前）和还在错题本里的（active），最多 10 道
    const inPack = new Set(passageQs.map((q: any) => q.id));
    const wrong = (await this.db.query(
      `SELECT w.id wrong_question_id, w.question_id, w.status wrong_status, w.due_at FROM wrong_questions w JOIN questions q ON q.id=w.question_id
        WHERE w.user_id=$1 AND (w.status='active' OR (w.status='mastered' AND w.due_at < $2)) AND NOT (w.question_id = ANY($3))
        ORDER BY (w.question_id = ANY($4)) DESC, (w.status='mastered') DESC, w.due_at NULLS LAST, w.last_wrong_at DESC, w.id
        LIMIT $5`, [u.id, day.end, [...inPack], redoFirst, WRONG_REDO_LIMIT])).rows;
    const wrongQs = wrong.length ? (await this.db.query(`SELECT ${Q_COLS} FROM questions WHERE id = ANY($1)`, [wrong.map((w: any) => w.question_id)])).rows : [];
    const wrongById = new Map(wrong.map((w: any) => [w.question_id, w]));
    wrongQs.sort((a: any, b: any) => wrong.findIndex((w: any) => w.question_id === a.id) - wrong.findIndex((w: any) => w.question_id === b.id));
    // 错题重做如果是阅读 / 完形小题，带上它的文章（不带别的小题）
    const extraPassages = [...new Set(wrongQs.map((q: any) => q.passage_id).filter((id: any) => id && !chosen.some((c) => c.id === id)))] as string[];
    const passages = await loadPassages(this.db, [...chosen.map((c) => c.id), ...extraPassages]);
    const all = [...passageQs.map((q: any) => ({ q, origin: 'plan' })), ...wrongQs.map((q: any) => ({ q, origin: 'wrong_redo' }))];
    // 讲解：已核对发布的 AI 讲解 > 行业专家 > 官方解析；都没有 → pending（不现场生成）
    const ai = all.length ? (await this.db.query(
      `SELECT DISTINCT ON (question_id) question_id, id, steps FROM ai_explanations WHERE question_id = ANY($1) AND status='published' AND verified ORDER BY question_id, version DESC`,
      [all.map((x) => x.q.id)])).rows : [];
    const aiBy = new Map(ai.map((r: any) => [r.question_id, r]));
    const questions = all.map(({ q, origin }) => {
      const base = assetBaseFor(q.source);
      const objective = isObjectiveType(q.type);
      let explanation: any = null;
      const v: any = aiBy.get(q.id);
      if (v) explanation = { source: 'ai', source_label: AI_VERIFIED_LABEL, verified: true, explanation_id: v.id, steps: (v.steps ?? []).map((s: any, i: number) => ({ n: s.n ?? i + 1, text: s.title ? `${s.title}：${s.text}` : s.text })) };
      else {
        const o = officialSolution(q);
        if (o) explanation = { source: o.kind === 'expert' ? 'expert' : 'official', source_label: o.label, verified: o.verified, explanation_id: null, steps: o.steps };
      }
      const w: any = wrongById.get(q.id);
      return {
        id: q.id, origin, exam: q.exam, year: q.year, number: q.number, section: q.section ?? null, section_name: ENGLISH_SECTION_NAME[q.section] ?? q.section ?? null,
        type: q.type, objective, score: q.score, stem: q.stem, options: q.options ?? null, images: q.images ?? [], tables: q.tables ?? null, errata: q.errata ?? [],
        sub_questions: q.sub_questions ?? null, passage_id: q.passage_id ?? null, knowledge_points: q.knowledge_points ?? [], asset_base: base,
        correct_answer: objective ? q.answer ?? [] : null, answer: objective ? q.answer ?? [] : null, reference_answer: referenceAnswer(q),
        explanation_status: explanation ? 'ready' : 'pending', solution: stepsText(explanation?.steps), explanation,
        wrong_question_id: w?.wrong_question_id ?? null, wrong_status: w?.wrong_status ?? null, due_at: w?.due_at ?? null,
      };
    });
    const passageList = [...chosen.map((c) => ({ ...passages.get(c.id), pick: c.pick })), ...extraPassages.map((id) => ({ ...passages.get(id), pick: 'wrong_redo' }))]
      .filter((p: any) => p?.id).map(({ updated_at, import_problems, ...p }: any) => p);
    const words = await new WordsController(this.db, this.time).today(u, '20', '100', undefined);
    const assets = [...new Set([
      ...questions.flatMap((q) => assetUrls(q.asset_base, q.images, q.stem, q.options, q.sub_questions, q.solution, q.reference_answer)),
      ...passageList.flatMap((p: any) => assetUrls(p.asset_base, p.images, p.text, p.options, p.directions)),
    ])].sort();
    const content = {
      study_date: today, passages: passageList, questions,
      words: { review: words.review.map((w: any) => w.id), new: words.new.map((w: any) => w.id), relearn: words.relearn.map((w: any) => w.id) }, assets,
    };
    // 题包说明（前端那句「没网也能做：…」直接用，不用自己猜）：按实际内容说，计划里没任务就别说「今天任务里的」
    const kindOf = (id: string) => { const sec = passageQs.find((q: any) => q.passage_id === id)?.section; return PACK_SECTIONS.cloze.includes(sec) ? '完形' : '阅读'; };
    const listOf = (pick: string) => { const ids = chosen.filter((c) => c.pick === pick).map((c) => c.id); if (!ids.length) return '';
      const n = (k: string) => ids.filter((id) => kindOf(id) === k).length; return ['完形', '阅读'].filter((k) => n(k)).map((k) => `${k} ${n(k)} 篇`).join('、'); };
    const planList = listOf('plan'), autoList = listOf('auto');
    const parts = [planList && `今天计划里的${planList}`, autoList && `${planList ? '另' : tasks.length ? '今天计划里没有阅读 / 完形，' : '今天还没排任务，'}自动挑了${autoList}`].filter(Boolean);
    const summary = `${parts.join('，') || '今天没有可离线做的阅读 / 完形'}（共 ${passageQs.length} 题），${wrongQs.length ? `加 ${wrongQs.length} 道错题重做` : '没有要重做的错题'}`;
    return {
      version: packVersion(content), summary, study_date: today, relative_day: '今天', timezone: day.tz,
      generated_at: clockNow().toISOString(), expires_at: day.end.toISOString(), // 用户时区下一个 04:00（同 UserTimeService.day().end）
      counts: { passages: passageList.length, questions: questions.length, plan_questions: passageQs.length, wrong_redos: wrongQs.length, wrong_redo_limit: WRONG_REDO_LIMIT,
        plan_tasks: tasks.length, plan_passages: chosen.filter((c) => c.pick === 'plan').length, auto_passages: chosen.filter((c) => c.pick === 'auto').length,
        words: words.review.length + words.new.length + words.relearn.length, assets: assets.length },
      passages: passageList, questions, words, assets,
    };
  }
}
