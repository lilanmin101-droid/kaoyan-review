import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { UserTimeService } from './user-time.service';

/** 全局：登录后的请求带 X-Timezone（IANA）就校验并写进 users.settings.timezone（拦截器在 JwtGuard 之后跑，能拿到 req.user） */
@Injectable()
export class TimezoneInterceptor implements NestInterceptor {
  constructor(private time: UserTimeService) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const tz = req?.headers?.['x-timezone'];
    if (!req?.user?.id || !tz) return next.handle();
    return from(this.time.rememberHeader(req.user.id, String(tz)).catch(() => undefined)).pipe(switchMap(() => next.handle()));
  }
}
