import { Module } from '@nestjs/common';
import { CheckinsController } from './checkins.controller';
@Module({ controllers: [CheckinsController] })
export class CheckinsModule {}
