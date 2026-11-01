import { Module } from '@nestjs/common';
import { AnswersController } from './answers.controller';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
@Module({ controllers: [AnswersController, GradingController], providers: [GradingService] })
export class AnswersModule {}
