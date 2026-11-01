import { Module } from '@nestjs/common';
import { OfflineController } from './offline.controller';
@Module({ controllers: [OfflineController] })
export class OfflineModule {}
