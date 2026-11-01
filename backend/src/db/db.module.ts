import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { UserTimeService } from '../common/user-time.service';

@Global()
@Module({ providers: [DbService, UserTimeService], exports: [DbService, UserTimeService] })
export class DbModule {}
