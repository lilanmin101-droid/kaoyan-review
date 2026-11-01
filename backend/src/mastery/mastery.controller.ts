import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';

@Controller('mastery')
@UseGuards(JwtGuard)
export class MasteryController {
  constructor(private db: DbService) {}

  /** 完整三层知识点树（科目/章/知识点），没练过的知识点 score 为 null；章和科目的分数是已练知识点的平均 */
  @Get('tree')
  async tree(@CurrentUser() u: AuthUser, @Query('subject') subject?: string) {
    const rows = (await this.db.query(
      `SELECT k.path,k.name,k.parent_path,k.level,k.sort_order,
              m.score::float AS score, m.recent_acc::float AS recent_acc, m.attempts, m.correct, m.last_practiced_at, m.feynman_result,
              (SELECT count(*)::int FROM questions q WHERE k.path = ANY(q.knowledge_points)) AS question_count
         FROM knowledge_points k LEFT JOIN mastery m ON m.kp_path=k.path AND m.user_id=$1
        ORDER BY k.sort_order`, [u.id])).rows;
    const byPath = new Map<string, any>();
    const roots: any[] = [];
    for (const r of rows) {
      const node: any = { path: r.path, name: r.name, level: r.level, score: r.level === 3 ? r.score : null };
      if (r.level === 3) Object.assign(node, {
        recent_acc: r.recent_acc, attempts: r.attempts ?? 0, correct: r.correct ?? 0,
        last_practiced_at: r.last_practiced_at, feynman: r.feynman_result, question_count: r.question_count,
      });
      else node.children = [];
      byPath.set(r.path, node);
      if (r.parent_path) byPath.get(r.parent_path)?.children.push(node); else roots.push(node);
    }
    const agg = (n: any): number[] => {
      if (n.level === 3) return n.score == null ? [] : [n.score];
      const s = n.children.flatMap(agg);
      n.score = s.length ? Math.round((s.reduce((a: number, b: number) => a + b, 0) / s.length) * 1000) / 1000 : null;
      n.practiced = s.length; n.total = n.children.reduce((a: number, c: any) => a + (c.level === 3 ? 1 : c.total), 0);
      return s;
    };
    roots.forEach(agg);
    const subjects = subject ? roots.filter((r) => r.name === subject) : roots;
    return { generated_at: new Date().toISOString(), total_points: rows.filter((r) => r.level === 3).length, subjects };
  }

  @Get('profile')
  async profile(@CurrentUser() u: AuthUser) {
    const [errors, habits, goals] = await Promise.all([
      this.db.query('SELECT kp_path,concept,calc,reading,method FROM error_profile WHERE user_id=$1 ORDER BY (concept+calc+reading+method) DESC', [u.id]),
      this.db.query('SELECT hour_bucket,acc::float,avg_seconds::float,samples FROM habits WHERE user_id=$1 ORDER BY hour_bucket', [u.id]),
      this.db.query(`SELECT * FROM goals WHERE user_id=$1 AND status='active' ORDER BY created_at DESC`, [u.id]),
    ]);
    return { error_profile: errors.rows, habits: habits.rows, goals: goals.rows };
  }
}
