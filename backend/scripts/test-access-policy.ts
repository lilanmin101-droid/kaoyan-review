/** 隧道 profile 的开关（REGISTRATION_DISABLED / LOGIN_ALLOWLIST / DEBUG_NOW_DISABLED）单元测试：node dist/scripts/test-access-policy.js */
import * as assert from 'assert';
import { registrationDisabled, usernameAllowed, debugNowDisabledByEnv, loginAllowlist } from '../src/common/access-policy';
import { debugNowAllowed } from '../src/common/clock';

const keys = ['REGISTRATION_DISABLED', 'LOGIN_ALLOWLIST', 'DEBUG_NOW_DISABLED', 'DISABLE_DEBUG_NOW', 'NODE_ENV'];
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
const reset = () => keys.forEach((k) => delete process.env[k]);
let n = 0;
const t = (name: string, f: () => void) => { reset(); f(); n++; console.log('  ✓', name); };

t('默认：注册开着、谁都能登录、X-Debug-Now 生效', () => {
  assert.strictEqual(registrationDisabled(), false);
  assert.strictEqual(loginAllowlist(), null);
  assert.strictEqual(usernameAllowed('anyone'), true);
  assert.strictEqual(debugNowAllowed(), true);
});
t('REGISTRATION_DISABLED=1 关注册；=0 不关', () => {
  process.env.REGISTRATION_DISABLED = '1'; assert.strictEqual(registrationDisabled(), true);
  process.env.REGISTRATION_DISABLED = '0'; assert.strictEqual(registrationDisabled(), false);
});
t('LOGIN_ALLOWLIST 只放名单里的用户名', () => {
  process.env.LOGIN_ALLOWLIST = ' tony , ';
  assert.deepStrictEqual(loginAllowlist(), ['tony']);
  assert.strictEqual(usernameAllowed('tony'), true);
  assert.strictEqual(usernameAllowed('Tony'), false);
  assert.strictEqual(usernameAllowed('kaosheng_r13a'), false);
  assert.strictEqual(usernameAllowed(undefined), false);
});
t('DEBUG_NOW_DISABLED=1 或旧名 DISABLE_DEBUG_NOW=1 都忽略 X-Debug-Now', () => {
  process.env.DEBUG_NOW_DISABLED = '1'; assert.strictEqual(debugNowDisabledByEnv(), true); assert.strictEqual(debugNowAllowed(), false);
  reset(); process.env.DISABLE_DEBUG_NOW = '1'; assert.strictEqual(debugNowAllowed(), false);
  reset(); process.env.NODE_ENV = 'production'; assert.strictEqual(debugNowAllowed(), false);
});
for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
console.log(`access-policy: ${n} 项全部通过`);
