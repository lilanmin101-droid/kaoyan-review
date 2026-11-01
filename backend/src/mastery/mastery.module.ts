import { Global, Module } from '@nestjs/common';
import { MasteryController } from './mastery.controller';
import { LearningService } from './learning.service';

@Global()
@Module({ controllers: [MasteryController], providers: [LearningService], exports: [LearningService] })
export class MasteryModule {}
