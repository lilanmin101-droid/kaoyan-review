import { Module } from '@nestjs/common';
import { WrongQuestionsController } from './wrong-questions.controller';
@Module({ controllers: [WrongQuestionsController] })
export class WrongQuestionsModule {}
