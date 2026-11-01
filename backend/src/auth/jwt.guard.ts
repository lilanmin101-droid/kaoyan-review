import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private jwt: JwtService) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query?.access_token as string | undefined);
    if (!token) throw new UnauthorizedException('缺少登录凭证');
    try {
      const p = this.jwt.verify(token);
      req.user = { id: p.sub, username: p.username };
      return true;
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
  }
}
