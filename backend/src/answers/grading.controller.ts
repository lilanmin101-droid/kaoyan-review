import { Body, Controller, Get, Headers, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { openSse } from '../common/sse';
import { GradingService } from './grading.service';

/**
 * 翻译 / 作文 AI 批改。先 POST /answers 存作答文本（answer: ["译文或作文全文"]），再：
 * - POST /answers/{id}/grade           → 批改结果（JSON）。没有 DeepSeek Key 时 status=pending、text「批改生成中」，不给分
 * - POST|GET /answers/{id}/grade/stream → SSE：meta → progress（grading / cross_check）→ result → done
 * - GET /answers/{id}/grade             → 读已有结果（status=not_requested 表示还没批）
 */
@Controller('answers')
@UseGuards(JwtGuard)
export class GradingController {
  constructor(private grading: GradingService) {}

  @Get(':id/grade')
  get(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.grading.get(u.id, id); }

  @Post(':id/grade')
  grade(@Param('id') id: string, @Body() b: { force?: boolean }, @Query('force') force: string | undefined, @CurrentUser() u: AuthUser, @Headers('x-device') device?: string) {
    return this.grading.grade(u.id, id, { force: !!b?.force || force === 'true' || force === '1', device });
  }

  @Post(':id/grade/stream')
  streamPost(@Param('id') id: string, @Body() b: { force?: boolean }, @CurrentUser() u: AuthUser, @Res() res: Response, @Headers('x-device') device?: string) {
    return this.stream(id, !!b?.force, u, res, device);
  }

  @Get(':id/grade/stream')
  streamGet(@Param('id') id: string, @Query('force') force: string | undefined, @CurrentUser() u: AuthUser, @Res() res: Response, @Headers('x-device') device?: string) {
    return this.stream(id, force === 'true' || force === '1', u, res, device);
  }

  private async stream(id: string, force: boolean, u: AuthUser, res: Response, device?: string) {
    let meta: any;
    try { meta = await this.grading.load(u.id, id); }
    catch (e: any) { const st = e?.getStatus?.() ?? 500; return res.status(st).json(typeof e?.getResponse === 'function' ? e.getResponse() : { statusCode: st, message: String(e?.message ?? e) }); }
    const sse = openSse(res);
    sse.send('meta', { answer_id: id, question_id: meta.a.question_id, kind: meta.kind });
    try {
      const g = await this.grading.grade(u.id, id, { force, device }, (stage, data) => sse.send('progress', { stage, ...(data ?? {}) }));
      if (g.status === 'done') sse.send('result', { grading: g });
      sse.send('done', { status: g.status, notice: g.notice, text: g.text, score: g.score, max_score: g.max_score, band: g.band, disagreement: g.disagreement });
    } catch (e: any) {
      sse.send('error', { message: String(e?.message ?? e) });
      sse.send('done', { status: 'failed' });
    }
    sse.end();
  }
}
