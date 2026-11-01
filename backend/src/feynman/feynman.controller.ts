import { BadRequestException, Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../db/db.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/user.decorator';

const ALLOWED = ['audio/webm', 'audio/mp4', 'audio/x-m4a', 'video/webm' /* 部分浏览器 MediaRecorder 会这么标 */];
const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads/feynman');

/** 讲给它听：上传录音 + 知识点。语音转写和判断要等 AI 接入，现在返回模拟结果，不计入掌握度。跳过就不调这个接口。 */
@Controller('feynman')
@UseGuards(JwtGuard)
export class FeynmanController {
  constructor(private db: DbService) {}

  @Post()
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Body() b: { kp_path?: string; text?: string }) {
    if (!b?.kp_path) throw new BadRequestException('缺少 kp_path');
    const kp = await this.db.one('SELECT path FROM knowledge_points WHERE path=$1 AND level=3', [b.kp_path]);
    if (!kp) throw new BadRequestException('kp_path 不在知识点树里');
    if (!file && !b.text) throw new BadRequestException('需要 audio 文件（audio/webm 或 audio/mp4），或 text');
    let audioPath: string | null = null;
    const mime = file?.mimetype?.split(';')[0] ?? null;
    if (file) {
      if (!ALLOWED.includes(mime!)) throw new BadRequestException(`不支持的音频格式 ${file.mimetype}，只收 audio/webm、audio/mp4`);
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      audioPath = path.join(UPLOAD_DIR, `${randomUUID()}.${mime!.includes('mp4') || mime!.includes('m4a') ? 'm4a' : 'webm'}`);
      fs.writeFileSync(audioPath, file.buffer);
    }
    const verdict = { understood: null, mock: true, comment: '（模拟结果）语音转写和判断等 AI 接入后启用；这次不计入掌握度。', missing: [] as string[] };
    const r = await this.db.one(
      `INSERT INTO feynman_attempts(user_id,kp_path,audio_path,mime_type,transcript,verdict) VALUES($1,$2,$3,$4,$5,$6) RETURNING id, kp_path, mime_type, transcript, verdict, created_at`,
      [u.id, b.kp_path, audioPath, mime, b.text ?? null, JSON.stringify(verdict)]);
    return { ...r, audio_bytes: file?.size ?? 0, counted_in_mastery: false };
  }
}
