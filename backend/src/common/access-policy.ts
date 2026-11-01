/**
 * 对外临时开放（隧道 profile）时的访问限制，全部默认关闭，只有设了环境变量才生效：
 * - REGISTRATION_DISABLED=1：注册一律 403（「现在不开放注册」）
 * - LOGIN_ALLOWLIST=tony,…：只有名单里的用户名能登录；JwtGuard 也只认名单里的用户名
 * - DEBUG_NOW_DISABLED=1（或旧名 DISABLE_DEBUG_NOW=1）：忽略 X-Debug-Now，见 common/clock.ts
 */
const on = (v?: string) => ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());

export const registrationDisabled = () => on(process.env.REGISTRATION_DISABLED);

export const REGISTRATION_DISABLED_MESSAGE = '现在不开放注册，请用已有账号登录';

export function loginAllowlist(): string[] | null {
  const raw = (process.env.LOGIN_ALLOWLIST ?? '').trim();
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** 没设名单 → 都允许；设了 → 只允许名单里的用户名 */
export function usernameAllowed(username: string | undefined | null): boolean {
  const list = loginAllowlist();
  return !list || (!!username && list.includes(username));
}

export const debugNowDisabledByEnv = () => on(process.env.DEBUG_NOW_DISABLED) || process.env.DISABLE_DEBUG_NOW === '1';
