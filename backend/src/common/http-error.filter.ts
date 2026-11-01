import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

/**
 * 统一错误形状：所有 404 / 409 都返回 {statusCode, error, message, field, code, ...其它字段}，
 * message 是学生能看懂的一句中文（没写中文的默认 404「没找到这个内容」/ 409「这条已经处理过了」）。
 * 其它状态码原样返回（400 已在各处按 {statusCode,error,message,field,code} 抛出）。
 */
const DEFAULTS: Record<number, { error: string; message: string; code: string }> = {
  404: { error: 'Not Found', message: '没找到这个内容，可能已经被删掉了，刷新一下再试', code: 'not_found' },
  409: { error: 'Conflict', message: '这条已经处理过了，刷新一下看看最新状态', code: 'conflict' },
};
const CJK = /[\u4e00-\u9fff]/;

export function normalizeHttpError(status: number, resp: any) {
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
