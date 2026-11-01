import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { UptimeService } from './uptime.service';
@Module({ imports: [AgentModule], controllers: [ExamsController], providers: [ExamsService, UptimeService] })
export class ExamsModule {}
