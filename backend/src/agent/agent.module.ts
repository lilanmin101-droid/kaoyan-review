import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgentController } from './agent.controller';
import { AgentActionsService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';
import { CoachService } from './coach.service';
import { JobsService } from './jobs.service';
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AgentController],
  providers: [AgentActionsService, AgentToolsService, CoachService, JobsService],
  exports: [AgentActionsService, AgentToolsService, CoachService],
})
export class AgentModule {}
