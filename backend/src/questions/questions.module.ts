import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { PassagesController } from './passages.controller';
@Module({ controllers: [QuestionsController, PassagesController] })
export class QuestionsModule {}
