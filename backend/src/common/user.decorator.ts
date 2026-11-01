import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser { id: string; username: string }

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
