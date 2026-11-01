import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { usernameAllowed } from '../common/access-policy';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private jwt: JwtService) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query?.access_token as string | undefined);
    if (!token) throw new UnauthorizedException('缺少登录凭证');
    let p: any;
    try {
      p = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    if (!usernameAllowed(p?.username)) throw new UnauthorizedException('登录已过期，请重新登录');
    req.user = { id: p.sub, username: p.username };
    return true;
  }
}
