import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../scripts/env';
loadEnv();
import { AppModule } from './app.module';
import { assetsMiddleware, ASSETS_DIR } from './common/assets';
import { clockMiddleware } from './common/clock';
import { closePdfRenderer, warmPdfRenderer } from './wrong-questions/pdf';
import { HttpErrorFilter } from './common/http-error.filter';
import { preflightModels } from './ai/llm';

// 任何漏掉的异步错误只记日志，不让进程退出（以前这类错误会让 :3000 掉线，前端代理报 502）
process.on('unhandledRejection', (e: any) => console.error('[unhandledRejection]', e?.stack ?? e));
process.on('uncaughtException', (e: any) => console.error('[uncaughtException]', e?.stack ?? e));

// 收到 SIGTERM/SIGINT：关掉常驻 Chrome（PDF 渲染器），再兜底 5 秒内一定退出（测试脚本 kill 后要 wait 到进程结束）
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => { void closePdfRenderer(); setTimeout(() => process.exit(0), 5000).unref(); });

async function bootstrap() {
  // 生产环境不许用默认 / 过短的 JWT 密钥（auth.module 缺省会退回 'dev-secret'，谁都能伪造登录）
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (process.env.NODE_ENV === 'production' && (jwtSecret.length < 32 || jwtSecret === 'dev-secret')) {
    console.error('[fatal] NODE_ENV=production 但 JWT_SECRET 没设或太短（至少 32 位，openssl rand -hex 32）');
    process.exit(1);
  }
  const app = await NestFactory.create(AppModule, { cors: true });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpErrorFilter()); // 404 / 409 统一 {statusCode,error,message,field,code}
  app.use(clockMiddleware); // 开发/评测：X-Debug-Now 模拟「现在」（生产环境不生效）
  // 题目图片（不需要登录）：/api/v1/assets/images/xxx.png → ASSETS_DIR/images/xxx.png
  app.use('/api/v1/assets', assetsMiddleware);
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  void preflightModels('startup'); // 有 Key 时调提供方 /models 核对模型名（后台，不阻塞启动）
  void warmPdfRenderer(); // 导出 PDF 用的 Chrome 常驻 + 字体预热（后台，不阻塞启动）
  console.log(`kaoyan backend listening on http://localhost:${port}/api/v1 (assets: ${ASSETS_DIR})`);
}
bootstrap();
