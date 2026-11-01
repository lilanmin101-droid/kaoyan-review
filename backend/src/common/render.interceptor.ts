import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, switchMap, of } from 'rxjs';
import { UserTimeService } from './user-time.service';
import { renderDeep } from './time';

/**
 * 渲染层（全局，唯一一处）：存库文字里的日期占位符 {{date:YYYY-MM-DD}} 按「读者此刻的学习日」渲染成
 * 今天 / 明天（11-02）、周三（11-04）、11-20（周五）；X-Debug-Now 也算（往后挪 1 天 / 8 天看效果）。
 * /agent、/plans 下的文字再整理引号层级：第一层「」、第二层『』、更深的去掉引号。
 * SSE（/agent/commands）不经过这里，在 AgentController 里用同一个 renderDeep。
 */
@Injectable()
export class RenderInterceptor implements NestInterceptor {
  constructor(private time: UserTimeService) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req?.user?.id;
    const quotes = /\/api\/v1\/(agent|plans)(\/|\?|$)/.test(req?.originalUrl ?? req?.url ?? '');
    return next.handle().pipe(switchMap((body) => {
      if (!userId || body == null || typeof body !== 'object' || Buffer.isBuffer(body) || typeof (body as any).pipe === 'function') return of(body);
      if (!quotes && !JSON.stringify(body).includes('{{date:')) return of(body);
      return from(this.time.today(userId).then((today) => renderDeep(body, today, quotes)));
    }));
  }
}
