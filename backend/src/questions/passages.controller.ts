import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { loadPassages, PASSAGE_COLS, serializePassage } from './passages';

/** 英语文章（完形 / 阅读 / 新题型 / 翻译原文） */
@Controller('passages')
@UseGuards(JwtGuard)
export class PassagesController {
  constructor(private db: DbService) {}

  @Get()
  async list(@Query('exam') exam?: string, @Query('year') year?: string, @Query('section') section?: string) {
    const where: string[] = [], p: any[] = [];
    if (exam) { p.push(exam); where.push(`exam=$${p.length}`); }
    if (year) { p.push(Number(year)); where.push(`year=$${p.length}`); }
    if (section) { p.push(section); where.push(`section=$${p.length}`); }
    const rows = (await this.db.query(`SELECT id FROM passages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY exam, year DESC, sort_order LIMIT 200`, p)).rows;
    const m = await loadPassages(this.db, rows.map((r: any) => r.id));
    return { items: rows.map((r: any) => m.get(r.id)) };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const p = await this.db.one(`SELECT ${PASSAGE_COLS} FROM passages WHERE id=$1`, [id]);
    if (!p) throw new NotFoundException('文章不存在');
    const qs = (await this.db.query(`SELECT id, number FROM questions WHERE passage_id=$1`, [id])).rows;
    return serializePassage(p, qs);
  }
}
