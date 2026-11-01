import { Module } from '@nestjs/common';
import { WordsController } from './words.controller';
import { WordsAudioController } from './words-audio.controller';
@Module({ controllers: [WordsController, WordsAudioController] })
export class WordsModule {}
