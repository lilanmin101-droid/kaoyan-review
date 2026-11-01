import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DbService } from '../db/db.service';
import { JwtGuard } from './jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';
import { isValidTz } from '../common/user-time.service';
import { REGISTRATION_DISABLED_MESSAGE, registrationDisabled, usernameAllowed } from '../common/access-policy';

@Controller('auth')
export class AuthController {
  constructor(private db: DbService, private jwt: JwtService) {}

  private issue(u: { id: string; username: string; display_name?: string | null; exam_date?: string | null }) {
    return {
      access_token: this.jwt.sign({ sub: u.id, username: u.username }),
      token_type: 'Bearer',
      expires_in: process.env.JWT_EXPIRES_IN || '30d',
      user: { id: u.id, username: u.username, display_name: u.display_name ?? null, exam_date: u.exam_date ?? null },
    };
  }

  @Post('register')
  async register(@Body() b: { username?: string; password?: string; display_name?: string; exam_date?: string; timezone?: string }, @Headers('x-timezone') headerTz?: string) {
    if (registrationDisabled()) throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: REGISTRATION_DISABLED_MESSAGE, code: 'registration_disabled' });
    if (!b?.username || !/^[A-Za-z0-9_.\-\u4e00-\u9fa5]{2,32}$/.test(b.username)) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: '用户名要 2–32 个字，只能用汉字、字母、数字和 _ . -', field: 'username', code: 'invalid_username' });
    if (!b.password || b.password.length < 6) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: '密码至少 6 位', field: 'password', code: 'password_too_short' });
    const exists = await this.db.one('SELECT 1 FROM users WHERE username=$1', [b.username]);
    if (exists) throw new ConflictException({ message: '这个用户名已经有人用了，换一个试试', field: 'username', code: 'username_taken' });
    const hash = await bcrypt.hash(b.password, 10);
    // 时区：请求头 X-Timezone（合法 IANA）→ body.timezone → 默认 Asia/Shanghai（APP_TZ）
    const tz = isValidTz(headerTz) ? headerTz : isValidTz(b.timezone) ? b.timezone : (process.env.APP_TZ || 'Asia/Shanghai');
    const u = await this.db.one(
      `INSERT INTO users(username,password_hash,display_name,exam_date,settings) VALUES($1,$2,$3,$4,jsonb_build_object('timezone',$5::text))
       RETURNING id,username,display_name,to_char(exam_date,'YYYY-MM-DD') exam_date, settings->>'timezone' timezone`,
      [b.username, hash, b.display_name ?? null, b.exam_date ?? null, tz]);
    return { ...this.issue(u!), timezone: u!.timezone };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() b: { username?: string; password?: string }) {
    // 隧道 profile：名单外的用户名一律按「用户名或密码不对」处理（不透露账号是否存在）
    if (!usernameAllowed(b?.username)) throw new UnauthorizedException('用户名或密码不对');
    const u = await this.db.one(`SELECT id,username,password_hash,display_name,to_char(exam_date,'YYYY-MM-DD') exam_date FROM users WHERE username=$1`, [b?.username ?? '']);
    if (!u || !(await bcrypt.compare(b?.password ?? '', u.password_hash))) throw new UnauthorizedException('用户名或密码不对');
    return this.issue(u);
  }

  @Get('me')
  @UseGuards(JwtGuard)
  async me(@CurrentUser() user: AuthUser) {
    return this.db.one(`SELECT id,username,display_name,to_char(exam_date,'YYYY-MM-DD') exam_date,settings,created_at FROM users WHERE id=$1`, [user.id]);
  }
}
