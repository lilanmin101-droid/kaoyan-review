import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

/**
 * 统一错误形状：所有 404 / 409 都返回 {statusCode, error, message, field, code, ...其它字段}，
 * message 是学生能看懂的一句中文（没写中文的默认 404「没找到这个内容」/ 409「这条已经处理过了」）。
 * 400 也补齐 field / code（没写的 field=null、code=bad_request）；其它状态码原样返回。
 */
const DEFAULTS: Record<number, { error: string; message: string; code: string }> = {
  404: { error: 'Not Found', message: '没找到这个内容，可能已经被删掉了，刷新一下再试', code: 'not_found' },
  409: { error: 'Conflict', message: '这条已经处理过了，刷新一下看看最新状态', code: 'conflict' },
};
const CJK = /[\u4e00-\u9fff]/;

/** 400 统一格式：{statusCode, error, message, field, code}（第 16 轮：各处直接抛的 400 都走这个） */
export const badRequest = (message: string, field: string | null, code: string, extra: Record<string, unknown> = {}) =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', message, field, code, ...extra });

export function normalizeHttpError(status: number, resp: any) {
  // 第 16 轮：只带 message 的 400（老代码 / 框架抛的）也补齐 field=null、code=bad_request，message 原样保留
  if (status === 400) {
    const obj = typeof resp === 'string' ? { message: resp } : { ...(resp ?? {}) };
    const message = Array.isArray(obj.message) ? obj.message.join('；') : obj.message;
    return { ...obj, statusCode: 400, error: obj.error && obj.error !== message ? obj.error : 'Bad Request', message, field: obj.field ?? null, code: obj.code ?? 'bad_request' };
  }
  const d = DEFAULTS[status];
  if (!d) return resp;
  const obj = typeof resp === 'string' ? { message: resp } : { ...(resp ?? {}) };
  const raw = Array.isArray(obj.message) ? obj.message.join('；') : obj.message;
  const message = typeof raw === 'string' && CJK.test(raw) ? raw : d.message;
  return { ...obj, statusCode: status, error: obj.error && obj.error !== message ? obj.error : d.error, message, field: obj.field ?? null, code: obj.code ?? d.code };
}

@Catch(HttpException)
export class HttpErrorFilter implements ExceptionFilter {
  catch(e: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const status = e.getStatus();
    res.status(status).json(normalizeHttpError(status, e.getResponse()));
  }
}
