import { Controller, Get, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TimezoneInterceptor } from './common/timezone.interceptor';
import { RenderInterceptor } from './common/render.interceptor';
import { DbModule } from './db/db.module';
import { DbService } from './db/db.service';
import { aiMode, aiStatus } from './ai/llm';
import { AuthModule } from './auth/auth.module';
import { QuestionsModule } from './questions/questions.module';
import { AnswersModule } from './answers/answers.module';
import { ExamsModule } from './exams/exams.module';
import { WrongQuestionsModule } from './wrong-questions/wrong-questions.module';
import { WordsModule } from './words/words.module';
import { PlansModule } from './plans/plans.module';
import { CheckinsModule } from './checkins/checkins.module';
import { SyncModule } from './sync/sync.module';
import { EventsModule } from './events/events.module';
import { AgentModule } from './agent/agent.module';
import { FeynmanModule } from './feynman/feynman.module';
import { MasteryModule } from './mastery/mastery.module';
import { OfflineModule } from './offline/offline.module';

@Controller('health')
class HealthController {
  constructor(private db: DbService) {}
  @Get()
  async health() {
    const r = await this.db.one(`SELECT version() v, EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') pgvector, (SELECT count(*)::int FROM questions) questions`);
    return { ok: true, db: r!.v.split(' ').slice(0, 2).join(' '), pgvector: r!.pgvector, questions: r!.questions, ai: aiMode() === 'ai' ? 'configured' : 'mock', ai_providers: aiStatus().providers.map((p) => ({ id: p.id, configured: p.configured })) };
  }
}

@Module({
  imports: [DbModule, AuthModule, MasteryModule, PlansModule, QuestionsModule, AnswersModule, ExamsModule, WrongQuestionsModule, WordsModule,
    CheckinsModule, SyncModule, EventsModule, AgentModule, FeynmanModule, OfflineModule],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: TimezoneInterceptor }, { provide: APP_INTERCEPTOR, useClass: RenderInterceptor }],
})
export class AppModule {}
