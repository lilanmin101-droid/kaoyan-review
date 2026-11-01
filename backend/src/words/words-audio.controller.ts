import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../db/db.service';
import { ACCENTS, Accent, AudioUpstreamError, ensureAudio } from './audio';

/**
 * GET /api/v1/words/{id}/audio?accent=us|uk → audio/mpeg。不需要登录（<audio src> 带不了 header，和题目图片一样；带 ?access_token 也行，忽略）。
 * 第一次从有道取并存盘，之后都读本地文件。上游失败返回 502 JSON（fallback: speech_synthesis），前端改用浏览器 speechSynthesis。
 */
@Controller('words')
export class WordsAudioController {
  constructor(private db: DbService) {}

  @Get(':id/audio')
  async audio(@Param('id') id: string, @Query('accent') accentQ: string | undefined, @Res() res: Response) {
    const accent = (accentQ || 'us').toLowerCase() as Accent;
    if (!ACCENTS.includes(accent)) throw new BadRequestException('accent 只能是 us / uk');
    if (!/^\d+$/.test(id)) throw new BadRequestException('id 是单词的数字 id');
    const w = await this.db.one('SELECT id, word FROM words WHERE id=$1', [Number(id)]);
    if (!w) throw new NotFoundException('单词不存在');
    try {
      const { file, cached } = await ensureAudio(w.word, accent);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Audio-Cache', cached ? 'hit' : 'miss');
      res.setHeader('X-Audio-Source', 'youdao-dictvoice');
      res.sendFile(file);
    } catch (e: any) {
      const upstream = e instanceof AudioUpstreamError;
      res.status(upstream ? 502 : 500).json({
        statusCode: upstream ? 502 : 500, error: upstream ? 'audio_upstream_failed' : 'audio_failed', message: e?.message ?? String(e),
        word_id: w.id, word: w.word, accent, fallback: 'speech_synthesis',
      });
    }
  }
}
