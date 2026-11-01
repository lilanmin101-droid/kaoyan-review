import { Module } from '@nestjs/common';
import { FeynmanController } from './feynman.controller';
@Module({ controllers: [FeynmanController] })
export class FeynmanModule {}
