import { AsyncLocalStorage } from 'async_hooks';

/**
 * 「现在」：默认就是真实时间。开发/评测时（NODE_ENV≠production）请求可以带 `X-Debug-Now: <ISO 时间>`，
 * 只影响 UserTimeService 算「今天/现在」（用来测「洛杉矶凌晨 00:30 说今天」这类日界情况）；数据库时间戳不受影响。
 */
const als = new AsyncLocalStorage<{ now?: number }>();
export const debugNowAllowed = () => process.env.NODE_ENV !== 'production' && process.env.DISABLE_DEBUG_NOW !== '1';
export function clockNow(): Date {
  const n = als.getStore()?.now;
  return n != null ? new Date(n) : new Date();
}
export function clockMiddleware(req: any, _res: any, next: () => void) {
  const h = req.headers?.['x-debug-now'];
  const t = h && debugNowAllowed() ? Date.parse(String(h)) : NaN;
  if (Number.isFinite(t)) als.run({ now: t }, next);
  else next();
}
