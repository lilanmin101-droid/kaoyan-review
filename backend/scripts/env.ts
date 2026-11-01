import * as fs from 'fs';
import * as path from 'path';
/** 极简 .env 读取，不引第三方依赖 */
export function loadEnv() {
  const p = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
