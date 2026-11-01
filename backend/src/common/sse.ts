import type { Response } from 'express';

/** POST 请求也能用的 SSE 输出（Nest 的 @Sse 只支持 GET） */
export function openSse(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return {
    send(type: string, data: any) {
      if (res.writableEnded || res.destroyed) return; // 客户端已断开：不再写，避免抛错
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    },
    end() { if (!res.writableEnded) res.end(); },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
