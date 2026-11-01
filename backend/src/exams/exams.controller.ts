import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { htmlToPdf, prerenderPdf, prerenderWrongExport } from '../wrong-questions/pdf';
import { examReportHtml } from './exam-report';
import { ExamsService, ProgressBody } from './exams.service';

@Controller('exams')
@UseGuards(JwtGuard)
export class ExamsController {
  constructor(private svc: ExamsService) {}

  /** 开考：{exam, year}（整卷须全部 confirmed，否则 422 + missing_numbers）；已有没交卷的 → 409 + active_exam_id */
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.svc.create(u.id, b ?? {}); }

  /** 模考历史 */
  @Get()
  list(@CurrentUser() u: AuthUser, @Query('limit') limit?: string, @Query('cursor') cursor?: string) { return this.svc.history(u.id, limit, cursor); }

  /** 有没交卷的模考就返回它（前端弹「继续上次」），没有返回 {exam: null} */
  @Get('active')
  async active(@CurrentUser() u: AuthUser) { return { exam: await this.svc.active(u.id) }; }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v: any = await this.svc.view(null, id, u.id);
    if (v?.result) this.prerender(u.id, id, v.exam);
    return v;
  }

  /** 成绩页一打开（或成绩变了）就后台预渲染「成绩单 PDF」和「导出错题 PDF」，点按钮时直接命中缓存 */
  private prerender(userId: string, id: string, exam: string | undefined, minGapMs = 3000) {
    prerenderPdf(`exam:${userId}:${id}`, async () => {
      const { view, wrong, today } = await this.svc.reportData(userId, id);
      return examReportHtml(view, wrong, { today });
    }, minGapMs);
    if (exam) prerenderWrongExport(userId, { exam }, minGapMs);
  }

  private async withPrerender(userId: string, id: string, p: Promise<any>) {
    const r = await p;
    if (r?.result) this.prerender(userId, id, r.exam, 0);
    return r;
  }

  /** 成绩报告 PDF（format=html 返回 HTML 预览） */
  @Get(':id/report.pdf')
  async report(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('format') format: string | undefined, @Res() res: Response) {
    const { view, wrong, today } = await this.svc.reportData(u.id, id);
    const html = examReportHtml(view, wrong, { today });
    if (format === 'html') { res.type('html').send(html); return; }
    const pdf = await htmlToPdf(html);
    const name = `${view.title}模考成绩报告-${view.submitted_date ?? today}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="exam-report-${view.year ?? ''}-${view.exam}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(pdf);
  }

  @Put(':id/progress')
  progress(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ProgressBody) { return this.svc.saveProgress(u.id, id, b); }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('x-device') device?: string) { return this.withPrerender(u.id, id, this.svc.submit(u.id, id, b ?? {}, device)); }

  /** 放弃这场模考（不判分、不进错题本，保留进度；之后可以开新的一场）。重复调用幂等 */
  @Post(':id/abandon')
  @HttpCode(200)
  abandon(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.abandon(u.id, id); }

  /** 交卷后自评主观题（幂等；再评一次覆盖） */
  @Post(':id/self-ratings')
  @HttpCode(200)
  selfRate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('x-device') device?: string) { return this.withPrerender(u.id, id, this.svc.selfRate(u.id, id, b ?? {}, device)); }
}
