import { ArgumentsHost, BadRequestException, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * 统一错误形状：所有 404 / 409 都返回 {statusCode, error, message, field, code, ...其它字段}，
 * message 是学生能看懂的一句中文（没写中文的默认 404「没找到这个内容」/ 409「这条已经处理过了」）。
 * 400 也补齐 field / code（没写的 field=null、code=bad_request）；其它状态码原样返回。
 */
const DEFAULTS: Record<number, { error: string; message: string; code: string }> = {
  404: { error: 'Not Found', message: '没找到这个内容，可能已经被删掉了，刷新一下再试', code: 'not_found' },
  409: { error: 'Conflict', message: '这条已经处理过了，刷新一下看看最新状态', code: 'conflict' },
  413: { error: 'Payload Too Large', message: '请求体太大了，拆成几次再传', code: 'payload_too_large' },
};
/** body-parser 解析 JSON 失败抛的 400（英文 SyntaxError 文案）→ 统一中文 */
const JSON_PARSE_ERR = /JSON|Unexpected (token|end|non-whitespace)|position \d+/;
export const INVALID_JSON = { message: '请求格式不对', field: null, code: 'invalid_json' };
const CJK = /[\u4e00-\u9fff]/;

/** 400 统一格式：{statusCode, error, message, field, code}（第 16 轮：各处直接抛的 400 都走这个） */
export const badRequest = (message: string, field: string | null, code: string, extra: Record<string, unknown> = {}) =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', message, field, code, ...extra });

export function normalizeHttpError(status: number, resp: any) {
  // 第 16 轮：只带 message 的 400（老代码 / 框架抛的）也补齐 field=null、code=bad_request，message 原样保留
  if (status === 400) {
    const obj = typeof resp === 'string' ? { message: resp } : { ...(resp ?? {}) };
    const message = Array.isArray(obj.message) ? obj.message.join('；') : obj.message;
    // 第 17 轮：请求体不是合法 JSON（body-parser 抛的，没有 code、英文 message）→ 「请求格式不对」/ invalid_json
    if (!obj.code && typeof message === 'string' && !CJK.test(message) && JSON_PARSE_ERR.test(message)) return { statusCode: 400, error: 'Bad Request', ...INVALID_JSON };
    return { ...obj, statusCode: 400, error: obj.error && obj.error !== message ? obj.error : 'Bad Request', message, field: obj.field ?? null, code: obj.code ?? 'bad_request' };
  }
  const d = DEFAULTS[status];
  if (!d) return resp;
  const obj = typeof resp === 'string' ? { message: resp } : { ...(resp ?? {}) };
  const raw = Array.isArray(obj.message) ? obj.message.join('；') : obj.message;
  const message = typeof raw === 'string' && CJK.test(raw) ? raw : d.message; // 413（请求体超过上限）也走这里：中文 message + code=payload_too_large
  return { ...obj, statusCode: status, error: obj.error && obj.error !== message ? obj.error : d.error, message, field: obj.field ?? null, code: obj.code ?? d.code };
}

/** body-parser 抛的 http-errors（不是 Nest 的 HttpException）：entity.parse.failed（坏 JSON）、entity.too.large（超过上限）等 */
export function normalizeBodyParserError(e: any): { status: number; body: any } | null {
  const status = Number(e?.status ?? e?.statusCode);
  const bodyParserType = typeof e?.type === 'string' && (e.type.startsWith('entity.') || e.type.startsWith('encoding.') || e.type === 'charset.unsupported');
  if (!bodyParserType || !(status >= 400 && status < 500)) return null;
  if (e.type === 'entity.parse.failed') return { status: 400, body: { statusCode: 400, error: 'Bad Request', ...INVALID_JSON } };
  if (status === 413) return { status, body: normalizeHttpError(413, { message: e.message }) };
  return { status, body: { statusCode: status, error: 'Bad Request', message: '请求格式不对', field: null, code: e.type.replace(/\./g, '_') } };
}

/** 全局：Nest 的 HttpException 统一形状；body-parser 的错误（坏 JSON / 太大）也转成中文统一形状；其它异常交回 Nest 默认处理（500 + 日志） */
@Catch()
export class HttpErrorFilter extends BaseExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return host.switchToHttp().getResponse().status(status).json(normalizeHttpError(status, e.getResponse()));
    }
    const bp = normalizeBodyParserError(e);
    if (bp) return host.switchToHttp().getResponse().status(bp.status).json(bp.body);
    return super.catch(e, host);
  }
}
